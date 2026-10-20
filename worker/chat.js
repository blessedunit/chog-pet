// Chog Pet global chat: one shared room, small and cheap.
//  GET  /api/chat?after=<id>  the last 60 messages (or only the ones newer than <id>), edge-cached ~2 s
//  POST /api/chat {text, pet?, anon?}  -> {ok, m} | {error, code, wait?}
// Names come from the server (sitter name or short wallet + holder badge), never from the client.
// Guards: per-actor (1 / 8 s, 30 / h) and per-IP (1 / 2 s, 90 / h) limits claimed atomically in D1, 140 chars,
// no links / @handles / 0x addresses, a small profanity mask, no repeating yourself. Keeps the last ~500 rows.
import CHOGS from "../public/data/chogs.json";

const KEEP = 500;
const LIST = 60;
const MAX = 140;
const SUPPLY = 1969;
const ACTOR = { gap: 8, hour: 30 };
const IP = { gap: 2, hour: 90 };
const DUP = 120; // seconds before you may say the exact same thing again
const enc = new TextEncoder();

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, who_key TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, pet INTEGER NULL, kind TEXT NOT NULL DEFAULT 'msg', badge TEXT NOT NULL DEFAULT '', u TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS chat_rl (k TEXT PRIMARY KEY, hr INTEGER NOT NULL, n INTEGER NOT NULL, last INTEGER NOT NULL, h TEXT NOT NULL DEFAULT '')"),
  ]);
  ready = true;
}

// ---------- text hygiene ----------
// zero-width, bidi and other invisible tricks, then every control / format / unassigned code point
// (hangul fillers look blank but count as letters; zero-width and bidi marks are format chars, removed below)
const INVISIBLE = new RegExp("[" + String.fromCharCode(0x115f, 0x1160, 0x3164, 0xffa0) + "]", "g");
export function clean(raw) {
  let s = String(raw == null ? "" : raw).normalize("NFC").replace(INVISIBLE, "");
  s = s.replace(/\p{Cc}/gu, " ").replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, "");
  s = s.replace(/(\p{M}{2})\p{M}+/gu, "$1"); // no zalgo towers
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/(.)\1{7,}/gu, "$1$1$1$1$1$1"); // "aaaaaaaaaaaa" -> 6
  return s;
}

const TLD = "com|net|org|io|xyz|gg|co|app|fun|link|ly|ru|tk|sh|dev|site|online|top|club|info|biz|live|art|ai|cc|vip|pro|fi|finance|money|claim|lol|wtf|uk|tv|eth|mon|nad|sol|bio|page|store|shop|cash|network|exchange|games|ws|cn";
const LINKY = new RegExp(
  [
    "[a-z][a-z0-9+.-]*:\\/\\/", // any scheme://
    "\\bwww\\s*\\.",
    "\\b(?:t\\.me|discord(?:app)?\\s*\\.\\s*(?:gg|com)|bit\\.ly)\\b",
    `\\b[a-z0-9-]{2,}\\s?(?:\\.|[([{]\\s?(?:dot|\\.)\\s?[)\\]}])\\s?(?:${TLD})\\b`,
  ].join("|"),
  "i",
);
const HANDLE = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]{2,}/u;
const HEXADDR = /0x[0-9a-f]{6,}/i;
// What each character looks like, for the filters only (the message keeps its own letters): one folded char per
// code point (so positions line up), with compatibility forms (fullwidth, math bold, ...) and accents taken off,
// the Cyrillic / Greek letters that pass for Latin ones and the look-alike dots turned into plain ones.
const CONF = { "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ɡ": "g", "ո": "n", "ս": "u", "օ": "o", "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "γ": "y", "ω": "w", "ı": "i", "ł": "l", "ø": "o", "đ": "d" };
const DOTS = /[。．｡․‧·•∙⋅٫⸱⸳܁܂﹒]/;
export function fold(s) {
  return Array.from(String(s), (ch) => {
    let f = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    f = CONF[f] || f;
    if (DOTS.test(f)) f = ".";
    return f.length === 1 ? f : "~";
  });
}
export function forbidden(s) {
  for (const t of [s, fold(s).join("")]) {
    if (LINKY.test(t)) return "links";
    if (HANDLE.test(t)) return "handles";
    if (HEXADDR.test(t)) return "addresses";
  }
  return null;
}

// leet look-alikes, for the filters only
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i", "|": "i" };

// ---------- no pretending to be staff ----------
// "i am admin", "official", "monad team", "[mod]", "support here": nobody in a fan project's chat speaks for Monad,
// the Chog team, Benja or Toad. Checked on the folded text (look-alike letters, leet, s p a c e d letters).
const ROLE = "admins?|mods?|moderators?|devs?|developers?|team|support|staff|founders?|ceo|official|benja|toad";
const STAFF = "team|support|admins?|mods?|moderators?|devs?|developers?|staff|founders?|ceo|official";
const ENT = "monad|chogs?|chog ?pet|benja|toad";
const CLAIM = new RegExp(
  [
    String.raw`\b(?:i ?am|i m|im|we ?are|we re|this is|its|it s|here s|heres|speaking for|on behalf of|i work (?:for|at|with))(?: from)?(?: (?:the|a|an|ur|your|ya|official))* (?:(?:${ENT}) )?(?:${ROLE})\b`,
    String.raw`\b(?:i ?am|i m|im|we ?are|we re|i work (?:for|at|with)) (?:from )?(?:the )?monad\b`,
    String.raw`\b(?:${ENT}) (?:${STAFF})\b`,
    String.raw`\b(?:admins?|mods?|moderators?|devs?|team|support|staff|official) (?:here|speaking|announcement|notice|update)\b`,
    String.raw`\b(?:admins?|moderators?|official|officially)\b`,
  ].join("|"),
);
const TAG = /(?:^|[\s[(<{])[[(<{]\s*(?:admin|mod|moderator|support|team|dev|staff|official)\s*[\])>}]|^\s*(?:admin|mod|moderator|support|team|dev|staff|official)\s*[:|>-]/;
function plain(s) {
  const f = fold(s).map((c) => LEET[c] || c).join("");
  let w = f.replace(/[^a-z0-9]+/g, " ").trim();
  w = w.replace(/\b([a-z0-9])\s(?=[a-z0-9]\b)/g, "$1"); // "a d m i n" -> "admin"
  return { f, w };
}
/** A role claim in chat ("i am a mod", "monad team", "[admin]")? */
export function impersonates(s) {
  const { f, w } = plain(s);
  return CLAIM.test(w) || TAG.test(f);
}
/** A Chog's name can't be a role or a team name at all: "Admin", "Monad Team", "Toad", "xModx"... */
const NAME_WORD = /\b(?:admins?|mods?|moderators?|devs?|team|support|staff|official|benja|toad|monad|founder|ceo)\b/;
const NAME_PART = /admin|moderator|official|support|monadteam|chogteam|devteam/;
export function badName(s) {
  const { w } = plain(s);
  return NAME_WORD.test(w) || NAME_PART.test(w.replace(/ /g, ""));
}
/** Nothing left to read once the swears are masked: "**** ****!" */
export const onlyMask = (s) => String(s).includes("*") && !/[\p{L}\p{N}]/u.test(s);

// a small mask list: slurs and the usual swears (matched on a leet-folded copy, same length, so positions line up)
const BAD = new RegExp(
  "\\b(?:" +
    [
      "n+i+g{2,}\\w*", "n+i+g+a+[sz]?","f+a+g+(?:s|g\\w*|ot\\w*)?", "k+i+k+e+s?", "s+p+i+c+s?", "c+h+i+n+k+s?", "c+o+o+n+s?",
      "t+r+a+n+n+(?:y|ie)s?", "r+e+t+a+r+d\\w*", "d+y+k+e+s?", "w+e+t+b+a+c+k+s?", "g+o+o+k+s?",
      "f+u+c+k\\w*", "f+u+k+\\w*", "f+c+k\\w*", "m+o+t+h+e+r+f+\\w*", "s+h+i+t+\\w*", "b+u+l+l+s+h+i+t\\w*", "c+u+n+t+s?", "b+i+t+c+h\\w*",
      "w+h+o+r+e+s?", "s+l+u+t+s?", "d+i+c+k+(?:s|head\\w*)?", "c+o+c+k+s?", "p+u+s+s+y", "a+s+s+h+o+l+e+s?", "b+a+s+t+a+r+d+s?",
      "t+w+a+t+s?", "w+a+n+k\\w*", "r+a+p+e+(?:s|d)?", "k+y+s", "k+i+l+l+\\s*y+o+u+r+s+e+l+f",
    ].join("|") +
    ")\\b",
  "gi",
);
export function mask(s) {
  const chars = Array.from(s);
  const folded = fold(s).map((c) => LEET[c] || c).join(""); // one char per code point: offsets index chars
  let hit = false;
  folded.replace(BAD, (m, off) => {
    hit = true;
    for (let i = off; i < off + m.length; i++) chars[i] = "*";
    return m;
  });
  return hit ? chars.join("") : s;
}

// IPv6: one home / one VPS gets a whole /64, so the /64 is the "network" (else every request could come from a new IP)
export function netOf(ip) {
  ip = String(ip || "local").trim().toLowerCase().slice(0, 64);
  if (!ip.includes(":")) return ip;
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1];
  const [l, r = null] = ip.split("::");
  const L = l ? l.split(":") : [], R = r ? r.split(":") : [];
  const all = r == null ? L : [...L, ...new Array(Math.max(0, 8 - L.length - R.length)).fill("0"), ...R];
  return all.slice(0, 4).map((x) => (x || "0").replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** The request body as a plain object: null, an array, a number or bad JSON all read as {} (no 500s, no type games). */
export async function jsonBody(req) {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}

// ---------- helpers ----------
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** Public, non-reversible id of the sender so a page can mark its own lines: sha256("chat:" + key), 8 hex. */
const uid = async (key) => (await sha("chat:" + key)).slice(0, 8);
const nameNum = (id) => CHOGS.n[id - 1];

// wallets that hold at least one Chog Genesis, from the Chog Line snapshot (built once per snapshot)
let ownersFor = null, owners = new Set();
async function isHolder(deps, ctx, addr) {
  try {
    const ln = await deps.line(ctx);
    if (ln !== ownersFor) {
      owners = new Set(ln.d.tokens.map((t) => String(t.owner || "").toLowerCase()));
      ownersFor = ln;
    }
    return owners.has(addr);
  } catch {
    return false;
  }
}

/** Claim one message slot for a limiter key. Returns null when claimed, else {code, wait}. */
function claimStmt(env, k, lim, h, now, dupCheck) {
  return env.DB.prepare(
    `INSERT INTO chat_rl (k, hr, n, last, h) VALUES (?1, ?2, 1, ?3, ?4)
     ON CONFLICT(k) DO UPDATE SET n = CASE WHEN chat_rl.hr = excluded.hr THEN chat_rl.n + 1 ELSE 1 END, hr = excluded.hr, last = excluded.last, h = excluded.h
     WHERE chat_rl.last + ?5 <= excluded.last
       AND (chat_rl.hr <> excluded.hr OR chat_rl.n < ?6)
       ${dupCheck ? "AND (chat_rl.h <> excluded.h OR chat_rl.last + ?7 <= excluded.last)" : "AND ?7 >= 0"}
     RETURNING n`,
  ).bind(k, Math.floor(now / 3600), now, h, lim.gap, lim.hour, DUP);
}
async function whyNot(env, k, lim, h, now, dupCheck) {
  const r = await env.DB.prepare("SELECT hr, n, last, h FROM chat_rl WHERE k = ?").bind(k).first();
  if (!r) return { code: "slow", wait: 1 };
  if (dupCheck && r.h === h && r.last + DUP > now) return { code: "dup", wait: 0 };
  if (r.last + lim.gap > now) return { code: "slow", wait: r.last + lim.gap - now };
  return { code: "hour", wait: (Math.floor(now / 3600) + 1) * 3600 - now };
}

// ---------- read: the latest 60, cached at the edge and in the isolate ----------
let mem = null; // {at, list}
async function latest(env, ctx, url) {
  if (mem && Date.now() - mem.at < 2000) return mem.list;
  const cache = caches.default;
  const key = new Request(url.origin + "/api/chat-latest");
  const hit = await cache.match(key);
  if (hit) {
    const list = await hit.json();
    mem = { at: Date.now(), list };
    return list;
  }
  const { results } = await env.DB.prepare("SELECT id, t, name, text, pet, kind, badge, u FROM chat ORDER BY id DESC LIMIT ?").bind(LIST).all();
  const list = results.reverse().filter((r) => !onlyMask(r.text)).map((r) => {
    const m = { i: r.id, t: r.t, n: r.name, x: r.text };
    if (r.pet) (m.p = r.pet), (m.pn = nameNum(r.pet));
    if (r.kind && r.kind !== "msg") m.k = r.kind;
    if (r.badge) m.b = r.badge;
    if (r.u) m.u = r.u;
    return m;
  });
  mem = { at: Date.now(), list };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(list), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } })));
  return list;
}
async function bust(url, ctx) {
  mem = null;
  ctx.waitUntil(caches.default.delete(new Request(url.origin + "/api/chat-latest")));
}

/** Post a system line (kind 'sys'), e.g. from another route. Cheap: one insert. */
export async function chatSys(env, ctx, url, text) {
  await ensure(env);
  await env.DB.prepare("INSERT INTO chat (t, who_key, name, text, kind) VALUES (?, 'sys', 'Chogtown', ?, 'sys')").bind(Math.floor(Date.now() / 1000), String(text).slice(0, MAX)).run();
  await bust(url, ctx);
}

/**
 * deps from worker/index.js: { json, bad, readToken, bearer, sitterName, short, line }
 */
export async function chat(req, env, ctx, url, deps) {
  await ensure(env);
  const { json, bad } = deps;
  const now = Math.floor(Date.now() / 1000);

  if (req.method === "GET") {
    const list = await latest(env, ctx, url);
    const after = Number(url.searchParams.get("after") || 0);
    const m = after > 0 ? list.filter((x) => x.i > after) : list;
    return json({ m, last: list.length ? list[list.length - 1].i : 0, now }, 200, { "cache-control": "public, max-age=2" });
  }
  if (req.method !== "POST") return bad("not found", 404);

  const b = await jsonBody(req);
  // who: a signed wallet, else the anonymous sitter id of this browser
  let key, name, addr = null;
  const tokAddr = await deps.readToken(env, deps.bearer(req));
  if (tokAddr) (addr = tokAddr), (key = tokAddr), (name = deps.short(tokAddr));
  else {
    const anon = String(b.anon || "");
    if (!/^[a-z0-9]{8,40}$/.test(anon)) return bad("who are you?", 401);
    key = "anon:" + anon;
    name = deps.sitterName(anon);
  }

  const text = clean(b.text);
  if (!text) return json({ error: "Say something first.", code: "empty" }, 400);
  if (Array.from(text).length > MAX) return json({ error: `Keep it under ${MAX} characters.`, code: "long" }, 400);
  const no = forbidden(text);
  if (no) return json({ error: "No links, @handles or wallet addresses in chat.", code: no }, 400);
  if (impersonates(text)) return json({ error: "No playing staff here: this is an independent fan project, nobody in chat speaks for a team.", code: "role" }, 400);
  const out = mask(text);
  if (onlyMask(out)) return json({ error: "Keep it friendly.", code: "masked" }, 400);
  const pid = Number(b.pet);
  const pet = Number.isInteger(pid) && pid >= 1 && pid <= SUPPLY ? pid : null;

  // limits: the actor (with the no-repeat rule) and the IP, claimed together
  const ip = netOf(req.headers.get("cf-connecting-ip") || "local");
  const h = (await sha(text.toLowerCase())).slice(0, 12);
  const ipKey = "ip:" + (await sha("ip:" + ip)).slice(0, 16);
  const [ra, ri] = await env.DB.batch([claimStmt(env, key, ACTOR, h, now, true), claimStmt(env, ipKey, IP, h, now, false)]);
  const okA = ra.results && ra.results.length, okI = ri.results && ri.results.length;
  if (!okA || !okI) {
    // give back whichever slot we did take, so a refused message doesn't cost a turn
    const giveBack = [];
    if (okA) giveBack.push(env.DB.prepare("UPDATE chat_rl SET last = ?, n = n - 1, h = '' WHERE k = ?").bind(now - ACTOR.gap, key));
    if (okI) giveBack.push(env.DB.prepare("UPDATE chat_rl SET last = ?, n = n - 1, h = '' WHERE k = ?").bind(now - IP.gap, ipKey));
    if (giveBack.length) await env.DB.batch(giveBack);
    const r = !okA ? await whyNot(env, key, ACTOR, h, now, true) : await whyNot(env, ipKey, IP, h, now, false);
    const msg = r.code === "dup" ? "You just said that." : r.code === "hour" ? "That's a lot of chat for one hour. Take a break and come back." : `Slow down a little: wait ${r.wait}s.`;
    return json({ error: msg, code: r.code, wait: r.wait }, 429);
  }

  const badge = addr && (await isHolder(deps, ctx, addr)) ? "h" : "";
  const u = await uid(key);
  const row = await env.DB.prepare("INSERT INTO chat (t, who_key, name, text, pet, kind, badge, u) VALUES (?, ?, ?, ?, ?, 'msg', ?, ?) RETURNING id")
    .bind(now, key, name, out, pet, badge, u)
    .first();
  await bust(url, ctx);
  if (Math.random() < 0.05) {
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare("DELETE FROM chat WHERE id <= (SELECT MAX(id) FROM chat) - ?").bind(KEEP),
        env.DB.prepare("DELETE FROM chat_rl WHERE last < ?").bind(now - 3600),
      ]),
    );
  }
  const m = { i: row.id, t: now, n: name, x: out, u };
  if (pet) (m.p = pet), (m.pn = nameNum(pet));
  if (badge) m.b = badge;
  return json({ ok: true, m, masked: out !== text });
}
