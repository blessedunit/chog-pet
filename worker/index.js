// Chog Pet worker: static site + a small API. One shared pet per Chog Genesis token, stored in D1.
// Anyone can babysit any Chog. The wallet that holds it on Monad (checked live with ownerOf) is its home;
// signing in is a free personal_sign, never a transaction. When the Chog changes hands the pet moves house:
// its old life goes into "past homes" and it starts fresh with the new owner.
//
// Abuse guards: a per-IP rate limit on every write, cooldowns claimed atomically, versioned pet rows (no lost
// updates between two visitors), and a signed play ticket so a Candle Catch score can't be made up.
// Red-team pass (19.10): IPv6 counts per /64, a network shares half of each cooldown on a Chog (throwaway anon ids
// can't hammer one pet), a tucked-in Chog can't be woken by strangers for 30 min, refusals don't touch the pet,
// a grumpy wake-up pays nothing, tickets are single-use, names go through the chat filters, pets log once / 10 min.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { personaOf, sitterName, quirks } from "../public/js/persona.js";
import { act, advance, fresh, lonely, mood, wellbeing, stageOf, COOLDOWN, SCORE_CAP } from "../public/js/sim.js";
import { award, flameOf } from "../public/js/stickers.js";
import CHOGS from "../public/data/chogs.json";
import { chat, netOf, forbidden, mask, badName, onlyMask, jsonBody } from "./chat.js";
import { econSchema, econRoute, econAct, econTake, econReturn, petGifts } from "./econ.js";
import { homeTierOf } from "../public/js/econ.js";

const CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const CHOG_TOKEN = "0x350035555e10d9afaf1566aaebfced5ba6c27777";
const RPCS = ["https://rpc2.monad.xyz", "https://rpc.monad.xyz", "https://rpc-mainnet.monadinfra.com"];
const UPSTREAM = "https://chog.exitliquid.fun";
// the original 1000 px art, by the number in the NFT name (two public gateways, the first that answers wins)
const IPFS_ART = "bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e";
const GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"];
const OS_SLUG = "chog-genesis";
const SUPPLY = 1969;
const ADDR = /^0x[0-9a-f]{40}$/;
const enc = new TextEncoder();

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const bad = (msg, status = 400) => json({ error: msg }, status);

// ---------- chain ----------
let rr = 0;
async function rpc(method, params) {
  let err;
  for (let i = 0; i < 2; i++) {
    const url = RPCS[rr++ % RPCS.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(2500),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "rpc");
      return j.result;
    } catch (e) {
      err = e;
    }
  }
  throw err;
}
const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const ownerCache = new Map();
async function ownerOf(id) {
  const c = ownerCache.get(id);
  if (c && Date.now() - c.at < 30_000) return c.v;
  const r = await rpc("eth_call", [{ to: CONTRACT, data: "0x6352211e" + pad(id.toString(16)) }, "latest"]);
  const v = "0x" + String(r).slice(-40).toLowerCase();
  if (!ADDR.test(v)) throw new Error("bad owner");
  ownerCache.set(id, { v, at: Date.now() });
  return v;
}
const balCache = new Map();
async function holdsChog(addr) {
  const c = balCache.get(addr);
  if (c && Date.now() - c.at < 300_000) return c.v;
  try {
    const r = await rpc("eth_call", [{ to: CHOG_TOKEN, data: "0x70a08231" + pad(addr) }, "latest"]);
    const v = BigInt(r) > 0n;
    balCache.set(addr, { v, at: Date.now() });
    return v;
  } catch {
    return false;
  }
}

// ---------- snapshot from Chog Line (owner + since) ----------
let lineMem = null;
async function line(ctx) {
  if (lineMem && Date.now() - lineMem.at < 120_000) return lineMem;
  const cache = caches.default;
  const key = new Request(UPSTREAM + "/data/line.json");
  let res = await cache.match(key);
  if (!res) {
    // never let a slow upstream hold a pet hostage: 5 s, then the last copy we had (if any)
    res = await fetch(UPSTREAM + "/data/line.json", { cf: { cacheTtl: 120 }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res || !res.ok) {
      if (lineMem) return (lineMem.at = Date.now() - 60_000), lineMem;
      throw new Error("line " + (res ? res.status : "timeout"));
    }
    res = new Response(res.body, res);
    res.headers.set("cache-control", "public, max-age=120");
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  const d = await res.json();
  const byId = new Map(d.tokens.map((t) => [t.id, t]));
  lineMem = { at: Date.now(), d, byId };
  return lineMem;
}

// ---------- auth: personal_sign -> HMAC token ----------
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.replace(/^0x/, "").match(/../g).map((x) => parseInt(x, 16)));
function recover(message, sigHex) {
  const m = enc.encode(message);
  const pre = enc.encode(`\x19Ethereum Signed Message:\n${m.length}`);
  const all = new Uint8Array(pre.length + m.length);
  all.set(pre);
  all.set(m, pre.length);
  const h = keccak_256(all);
  const sig = unhex(sigHex);
  if (sig.length !== 65) throw new Error("sig length");
  let v = sig[64];
  if (v >= 27) v -= 27;
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(h).toRawBytes(false);
  return "0x" + hex(keccak_256(pub.slice(1)).slice(-20));
}
// must match public/js/wallet.js
const signText = (host, addr, ts) =>
  `Chog Pet sign-in\n\nSite: ${host}\nWallet: ${addr}\nChain: Monad (143)\nTime: ${ts}\n\nFree. This is not a transaction and costs no gas.`;

function secret(env) {
  if (env.SECRET) return env.SECRET;
  if (env.DEV === "1") return "dev-only-secret";
  throw new Error("not configured"); // fail closed: never sign tokens with a known key in production
}
async function hmac(env, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)))).slice(0, 40);
}
async function makeToken(env, addr) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
  return `${addr}.${exp}.${await hmac(env, addr + "." + exp)}`;
}
async function readToken(env, tok) {
  if (!tok || typeof tok !== "string") return null;
  const [addr, exp, mac] = tok.split(".");
  if (!ADDR.test(addr || "") || !(Number(exp) > Date.now() / 1000)) return null;
  return (await hmac(env, addr + "." + exp)) === mac ? addr : null;
}
const bearer = (req) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || null;

// ---------- rate limit: per IP, on every write ----------
const ipHits = new Map(); // per-isolate fallback when the RL binding isn't there
const clientIp = (env, req) => netOf((env.DEV === "1" && req.headers.get("x-dev-ip")) || req.headers.get("cf-connecting-ip") || "local");
/** The network a request comes from, for the shared daily caps: a salted hash that changes every UTC day (no raw IPs stored). */
async function ipKey(env, req, now) {
  return "ip:" + (await hmac(env, `net:${Math.floor(now / 86400)}:${String(clientIp(env, req)).slice(0, 64)}`)).slice(0, 24);
}
async function limited(env, req, kind) {
  const ip = clientIp(env, req);
  if (env.RL) {
    const { success } = await env.RL.limit({ key: kind + ":" + ip });
    return !success;
  }
  const k = kind + ":" + ip;
  const t = Math.floor(Date.now() / 60000);
  const h = ipHits.get(k);
  if (!h || h.t !== t) {
    if (ipHits.size > 5000) ipHits.clear();
    ipHits.set(k, { t, n: 1 });
    return false;
  }
  return ++h.n > 40;
}

// ---------- storage ----------
let schemaReady = false;
async function ensure(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY, state TEXT NOT NULL, meta TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, ver INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS pets_updated ON pets (updated)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS visits (pet INTEGER NOT NULL, t INTEGER NOT NULL, who TEXT NOT NULL, a TEXT NOT NULL, code TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS visits_pet ON visits (pet, t)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS visits_t ON visits (t)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cool (pet INTEGER NOT NULL, actor TEXT NOT NULL, a TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (pet, actor, a))"),
    // the days Chogtown reached its goal (UTC day number), with the goal it reached
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fest (day INTEGER PRIMARY KEY, goal INTEGER NOT NULL, t INTEGER NOT NULL)"),
    // when a Chog's holder was last home (opened or cared for it), for the "Welcome home" note
    env.DB.prepare("CREATE TABLE IF NOT EXISTS seen (pet INTEGER NOT NULL, owner TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (pet, owner))"),
    ...econSchema(env), // Candles + gifts (worker/econ.js)
  ]);
  // tables made before these columns existed
  for (const col of ["ver INTEGER NOT NULL DEFAULT 0", "wb INTEGER NOT NULL DEFAULT 50", "away INTEGER NOT NULL DEFAULT 0"]) {
    try {
      await env.DB.prepare("ALTER TABLE pets ADD COLUMN " + col).run();
    } catch {}
  }
  schemaReady = true;
}

const persona = (id) => personaOf(id, CHOGS.t[id - 1]);
const nameOf = (id) => CHOGS.nm[String(id)] || `Chog #${CHOGS.n[id - 1]}`;
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

function newMeta(owner, since, now) {
  return { owner, since, name: "", care: 0, bond: 0, bestBy: "", history: [], movedAt: 0, born: now };
}

// local testing only (DEV=1): pretend a wallet holds a Chog, so the holder's side can be tested without the chain
const devOwner = new Map();

/** Load (or create) a pet, run it to now, and settle who it lives with. */
async function loadPet(env, ctx, id, now) {
  const row = await env.DB.prepare("SELECT state, meta, best, ver FROM pets WHERE id = ?").bind(id).first();
  let owner = null;
  let live = false;
  let since = now;
  let ln = null;
  try {
    ln = await line(ctx);
  } catch {}
  const snap = ln && ln.byId.get(id);
  const snapOwner = snap && ADDR.test((snap.owner || "").toLowerCase()) ? snap.owner.toLowerCase() : null;
  try {
    owner = env.DEV === "1" && devOwner.has(id) ? devOwner.get(id) : await ownerOf(id);
    live = true;
  } catch {
    owner = snapOwner;
  }
  if (snapOwner && owner && snapOwner === owner && Number(snap.sinceTs) > 0) since = Number(snap.sinceTs);
  const p = persona(id);
  let state, meta, moved = false;
  if (!row) {
    state = lonely(id, now); // nobody has been by yet: the first visitor gets to rescue it
    meta = newMeta(owner, since, now);
  } else {
    state = JSON.parse(row.state);
    meta = JSON.parse(row.meta);
    // only a live ownerOf can move a pet: a stale snapshot during an RPC outage must not wipe its life
    if (live && owner && meta.owner && meta.owner !== owner) {
      meta.history = [{ owner: meta.owner, since: meta.since, until: now, name: meta.name, bond: meta.bond }, ...(meta.history || [])].slice(0, 6);
      meta.owner = owner;
      meta.since = since === now ? now : since;
      meta.name = "";
      meta.bond = 0;
      meta.movedAt = now;
      state = fresh(now);
      moved = true;
    } else {
      if (!meta.owner && owner) meta.owner = owner;
      if (meta.owner === owner && since < now) meta.since = since;
    }
  }
  state = advance(state, p, now);
  return { id, p, state, meta, best: row ? row.best : 0, ver: row ? row.ver || 0 : -1, isNew: !row, moved };
}

/** Write a pet only if nobody else wrote it since we read it. Returns false on a lost race. */
async function savePet(env, pet, now) {
  const st = JSON.stringify(pet.state), mt = JSON.stringify(pet.meta);
  const wb = wellbeing(pet.state), away = pet.state.away ? 1 : 0;
  let r;
  if (pet.ver < 0) {
    r = await env.DB.prepare("INSERT INTO pets (id, state, meta, best, updated, ver, wb, away) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7) ON CONFLICT(id) DO NOTHING").bind(pet.id, st, mt, pet.best, now, wb, away).run();
  } else {
    r = await env.DB.prepare("UPDATE pets SET state = ?2, meta = ?3, best = ?4, updated = ?5, ver = ver + 1, wb = ?7, away = ?8 WHERE id = ?1 AND ver = ?6").bind(pet.id, st, mt, pet.best, now, pet.ver, wb, away).run();
  }
  const ok = r.meta && r.meta.changes > 0;
  if (ok) pet.ver = pet.ver < 0 ? 1 : pet.ver + 1;
  return ok;
}
const logMove = (env, pet, now) => env.DB.prepare("INSERT INTO visits (pet, t, who, a, code) VALUES (?, ?, ?, ?, ?)").bind(pet.id, now, short(pet.meta.owner), "move", "moved").run();

// ---------- the holder's side: bond with its home, best sitter, welcome home ----------
// Best sitter: the sitter (not its holder) with the most care on this Chog in the last 30 days (visits are kept 30
// days). Feed / play / bath / lights only: pets, gifts, names and moves don't count. One GROUP BY on the pet's
// own rows, kept a minute per isolate (and dropped when someone cares for it here).
const NOT_HOME = "who NOT LIKE '% (home)' AND who != ?3";
const bestMem = new Map();
async function bestSitter(env, pet, now) {
  const owner = ADDR.test(pet.meta.owner || "") ? short(pet.meta.owner) : "";
  const c = bestMem.get(pet.id);
  if (c && c.owner === owner && now - c.at < 60) return c.v;
  const r = await env.DB.prepare(`SELECT who, COUNT(*) AS n FROM visits WHERE pet = ?1 AND t >= ?2 AND ${DEEDS} AND ${NOT_HOME} GROUP BY who ORDER BY n DESC, MAX(t) DESC LIMIT 1`)
    .bind(pet.id, now - 30 * 86400, owner).first();
  const v = r ? { who: r.who, n: r.n } : null;
  if (bestMem.size > 4000) bestMem.clear();
  bestMem.set(pet.id, { at: now, owner, v });
  return v;
}
/** The holder's bond with its Chog (hearts from their own care XP) as a tier name, or "". */
async function homeTier(env, pet) {
  if (!ADDR.test(pet.meta.owner || "")) return "";
  const r = await env.DB.prepare("SELECT xp FROM bond WHERE pet = ? AND actor = ?").bind(pet.id, pet.meta.owner).first();
  return homeTierOf(r ? r.xp : 0);
}
// "Welcome home": the holder opens its Chog after 6 h or more away (or for the first time). Only ever worked out
// for the signed-in holder; everyone else pays nothing for it.
const AWAY_HOME = 6 * 3600;
const markHome = (env, id, owner, now) =>
  env.DB.prepare("INSERT INTO seen (pet, owner, t) VALUES (?1, ?2, ?3) ON CONFLICT(pet, owner) DO UPDATE SET t = excluded.t WHERE seen.t + 60 <= excluded.t").bind(id, owner, now).run();
async function welcomeHome(env, pet, owner, now) {
  const row = await env.DB.prepare("SELECT t FROM seen WHERE pet = ? AND owner = ?").bind(pet.id, owner).first();
  await markHome(env, pet.id, owner, now);
  const last = row ? row.t : 0;
  if (last && now - last < AWAY_HOME) return null;
  // first time: since it moved in with you, as far back as the visitors log goes
  const from = last || Math.max(Number(pet.meta.since) || 0, now - 30 * 86400);
  const { results } = await env.DB.prepare(`SELECT who, COUNT(*) AS n FROM visits WHERE pet = ?1 AND t > ?2 AND a != 'move' AND ${NOT_HOME} GROUP BY who ORDER BY n DESC, MAX(t) DESC LIMIT 3`)
    .bind(pet.id, from, short(owner)).all();
  return { from, first: !last, sitters: results.map((r) => ({ who: r.who, n: r.n })) };
}

async function view(env, pet, now, viewer) {
  const { results: log } = await env.DB.prepare("SELECT t, who, a, code FROM visits WHERE pet = ? ORDER BY t DESC LIMIT 12").bind(pet.id).all();
  const [best, tier] = await Promise.all([bestSitter(env, pet, now).catch(() => null), homeTier(env, pet).catch(() => "")]);
  const label = viewer ? (viewer.startsWith("anon:") ? sitterName(viewer.slice(5)) : short(viewer)) : "";
  let cool = {};
  if (viewer) {
    const { results } = await env.DB.prepare("SELECT a, t FROM cool WHERE pet = ? AND actor = ?").bind(pet.id, viewer).all();
    for (const c of results) {
      const left = c.t + (COOLDOWN[c.a] || 0) - now;
      if (left > 0) cool[c.a] = left;
    }
  }
  const m = pet.meta;
  return {
    id: pet.id,
    name: m.name || nameOf(pet.id),
    nftName: nameOf(pet.id),
    state: pet.state,
    mood: mood(pet.state),
    wellbeing: wellbeing(pet.state),
    owner: ADDR.test(m.owner || "") ? m.owner : null,
    since: m.since,
    care: m.care,
    bond: m.bond,
    best: pet.best,
    bestBy: m.bestBy,
    bestSitter: best && { ...best, you: best.who === label }, // most care in 30 days, its holder left out
    homeTier: tier, // its bond with its holder: "", Friend, Best friend, Soulmate
    history: (m.history || []).filter((h) => ADDR.test(h.owner || "")),
    movedAt: m.movedAt || 0,
    stickers: m.stickers || [],
    flame: flameOf(m, now),
    gifts: await petGifts(env, pet.id), // room gifts bought with Candles [{ item, who, t }]
    log,
    cool,
    now,
  };
}

async function actor(env, req, body) {
  const ipk = await ipKey(env, req, Math.floor(Date.now() / 1000));
  const addr = await readToken(env, bearer(req));
  if (addr) return { key: addr, who: short(addr), addr, ipk };
  const anon = String(body.anon || "");
  if (!/^[a-z0-9]{8,40}$/.test(anon)) return null;
  return { key: "anon:" + anon, who: sitterName(anon), addr: null, ipk };
}

/** Claim a cooldown slot atomically. Returns 0 if claimed, or the seconds left. */
async function claim(env, id, key, a, now, cd = COOLDOWN[a]) {
  const row = await env.DB.prepare(
    "INSERT INTO cool (pet, actor, a, t) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(pet, actor, a) DO UPDATE SET t = excluded.t WHERE cool.t + ?5 <= excluded.t RETURNING t",
  ).bind(id, key, a, now, cd).first();
  if (row) return 0;
  const c = await env.DB.prepare("SELECT t FROM cool WHERE pet = ? AND actor = ? AND a = ?").bind(id, key, a).first();
  return Math.max(1, (c ? c.t + cd : now) - now);
}

// One network (IP, or IPv6 /64) shares half of each cooldown on a Chog, so fresh anonymous ids can't hammer one
// pet; two people at home only ever wait a little for each other.
const netCool = (a) => Math.ceil(COOLDOWN[a] / 2);
// A Chog someone tucked in sleeps undisturbed for a while: only its holder can wake it (or feed it if it's starving)
const LET_SLEEP = 1800;

// signed play ticket: proves a round started on the server clock, so the score has to fit the time played
const ticketFor = async (env, id, key, t0) => `${t0}.${await hmac(env, `play:${id}:${key}:${t0}`)}`;
async function scoreFrom(env, id, key, ticket, score, now) {
  const [t0s, mac] = String(ticket || "").split(".");
  const t0 = Number(t0s);
  if (!(t0 > 0) || !mac || (await hmac(env, `play:${id}:${key}:${t0}`)) !== mac) return 0;
  const played = now - t0;
  if (played < 3 || played > 180) return 0;
  // one round, one score: a ticket counts once (the row keeps the newest ticket used on this Chog)
  const fresh = await env.DB.prepare(
    "INSERT INTO cool (pet, actor, a, t) VALUES (?1, ?2, 'ticket', ?3) ON CONFLICT(pet, actor, a) DO UPDATE SET t = excluded.t WHERE cool.t < excluded.t RETURNING t",
  ).bind(id, key, t0).first();
  if (!fresh) return 0;
  const s = Math.max(0, Math.round(Number(score) || 0));
  return Math.min(s, SCORE_CAP, Math.round(played * 8));
}

function cleanName(raw) {
  const s = String(raw || "")
    .normalize("NFC")
    .replace(/[\u115F\u1160\u3164\uFFA0\uFDFA\u200B-\u200F\u2028-\u202E\u2060-\u206F]/g, "")
    .replace(/[^\p{L}\p{N} '\-_.!]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const out = Array.from(s).slice(0, 16).join("").trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}
/** A Chog's name shows on the public board and records: same rules as chat (no links / addresses, swears masked). */
function nameFor(raw) {
  const name = cleanName(raw);
  if (name && forbidden(name)) return { error: "No links or wallet addresses in a name." };
  if (name && badName(name)) return { error: "That name sounds like staff. This is a fan project: pick another one." };
  const out = mask(name);
  if (onlyMask(out)) return { error: "Keep it friendly." };
  return { name: out };
}

async function board(env, now) {
  const { results: rows } = await env.DB.prepare("SELECT id, state, meta, best FROM pets ORDER BY updated DESC LIMIT 300").all();
  const pets = rows.map((r) => {
    const p = persona(r.id);
    const s = advance(JSON.parse(r.state), p, now);
    const m = JSON.parse(r.meta);
    return { id: r.id, name: m.name || nameOf(r.id), mood: mood(s), wellbeing: wellbeing(s), best: r.best, bestBy: m.bestBy, care: m.care };
  });
  const needy = pets.filter((p) => p.wellbeing < 55).sort((a, b) => a.wellbeing - b.wellbeing).slice(0, 6);
  // top it up with Chogs nobody has visited yet, a different handful every hour
  const seen = new Set(pets.map((p) => p.id));
  let seed = Math.floor(now / 3600);
  for (let guard = 0; needy.length < 6 && guard < 200; guard++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const id = 1 + (seed % SUPPLY);
    if (!seen.has(id)) {
      seen.add(id);
      needy.push({ id, name: nameOf(id), mood: "lonely", wellbeing: null, best: 0, bestBy: "", care: 0 });
    }
  }
  const records = pets.filter((p) => p.best > 0).sort((a, b) => b.best - a.best).slice(0, 5);
  const { results: recent } = await env.DB.prepare("SELECT pet, t, who, a, code FROM visits ORDER BY t DESC LIMIT 10").all();
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM pets").first();
  return { needy, records, recent: recent.map((v) => ({ ...v, name: nameOf(v.pet) })), pets: cnt.n, now };
}

// ---------- Chogtown: every Chog on one map ----------
// 0 nobody has visited · h happy · f fine · n needs care · s sad · x out looking for snacks · w waiting
// A visited pet's mood is estimated from its last saved wellbeing (it drops ~4 points an hour awake); the
// pet page always shows the exact state. The town isn't a hospital ward: a Chog nobody has cared for in 48 h is
// just "waiting" (grey), never "sad"; "x" stays only for a Chog that really left within the last week.
const WAIT_AFTER = 48 * 3600, AWAY_KEEP = 7 * 86400;
async function town(env, ctx, now) {
  const cells = new Array(SUPPLY).fill("0");
  const { results } = await env.DB.prepare("SELECT id, wb, away, updated FROM pets").all();
  let visited = 0, door = 0;
  for (const r of results) {
    if (!(r.id >= 1 && r.id <= SUPPLY)) continue;
    visited++;
    const quiet = Math.max(0, now - r.updated);
    const est = r.wb - (4 * quiet) / 3600;
    const left = r.away || est < -60;
    const c = quiet > WAIT_AFTER ? (left && quiet < AWAY_KEEP ? "x" : "w") : left ? "x" : est < 25 ? "s" : est < 45 ? "n" : est < 70 ? "f" : "h";
    if (c === "x") door++;
    cells[r.id - 1] = c;
  }
  // new homes this week, straight from the chain snapshot (a sale, a gift or a move to another wallet)
  let moved = [];
  try {
    const ln = await line(ctx);
    moved = ln.d.tokens.filter((t) => t.sinceTs && now - t.sinceTs < 7 * 86400).sort((a, b) => b.sinceTs - a.sinceTs).map((t) => [t.id, t.sinceTs]);
  } catch {}
  return { cells: cells.join(""), visited, door, moved, now };
}

// ---------- today: the shared town goal (UTC day) ----------
// Counts confirmed care actions in the visitors log (feed / play / bath / lights; pets and name changes don't
// count). The goal follows the town: yesterday's total + 10%, at least 30, at most GOAL_MAX. The day it's reached
// is a festival: every Chog cared for that day gets the "Festival day" sticker (a sticker only, no Candles).
const DEEDS = "a IN ('feed', 'play', 'clean', 'lights')";
const GOAL_MIN = 30, GOAL_MAX = 3000;
const goalFor = (y) => Math.min(GOAL_MAX, Math.max(GOAL_MIN, Math.round(y * 1.1)));
let goalMem = null; // { day, at, deeds, goal, helped, top }
async function goalNow(env, now, fresh = false) {
  const day = Math.floor(now / 86400);
  if (!fresh && goalMem && goalMem.day === day && (goalMem.reached || Date.now() - goalMem.at < 20000)) return goalMem;
  const start = day * 86400;
  const [cur, prev, top, fest] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT pet) AS p FROM visits WHERE t >= ? AND ${DEEDS}`).bind(start),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM visits WHERE t >= ? AND t < ? AND ${DEEDS}`).bind(start - 86400, start),
    env.DB.prepare(`SELECT pet, COUNT(*) AS n FROM visits WHERE t >= ? AND ${DEEDS} GROUP BY pet ORDER BY n DESC LIMIT 1`).bind(start),
    env.DB.prepare("SELECT goal FROM fest WHERE day = ?").bind(day),
  ]);
  const c = cur.results[0] || {}, t = top.results[0], f = fest.results[0];
  // once reached, the day's goal is fixed (a later recount can't take the festival away)
  const goal = f ? f.goal : goalFor((prev.results[0] || {}).n || 0);
  const deeds = c.n || 0;
  const reached = !!f || deeds >= goal;
  if (reached && !f) await env.DB.prepare("INSERT INTO fest (day, goal, t) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING").bind(day, goal, now).run();
  goalMem = { day, at: Date.now(), deeds, goal, reached, helped: c.p || 0, top: t ? { id: t.pet, n: t.n } : null };
  return goalMem;
}
async function today(env, now) {
  const g = await goalNow(env, now, true);
  const start = g.day * 86400;
  return {
    day: new Date(start * 1000).toISOString().slice(0, 10),
    deeds: g.deeds,
    goal: g.goal,
    reached: g.reached,
    helped: g.helped,
    top: g.top,
    ends: start + 86400,
    now,
  };
}
/** Was this Chog cared for on a festival day (a day the town reached its goal)? visits are kept 30 days. */
async function festDue(env, id) {
  const r = await env.DB.prepare(`SELECT 1 AS x FROM fest f WHERE EXISTS (SELECT 1 FROM visits v WHERE v.pet = ?1 AND v.${DEEDS} AND v.t >= f.day * 86400 AND v.t < f.day * 86400 + 86400) LIMIT 1`).bind(id).first();
  return !!r;
}

// ---------- routes ----------
async function api(req, env, ctx, url) {
  await ensure(env);
  const now = Math.floor(Date.now() / 1000);
  const parts = url.pathname.split("/").filter(Boolean); // api, ...
  const write = req.method === "POST";
  if (write && (await limited(env, req, parts[1] || "x"))) return bad("slow down", 429);

  if (parts[1] === "auth" && write) {
    const b = await jsonBody(req);
    const addr = String(b.address || "").toLowerCase();
    const ts = Number(b.ts);
    if (!ADDR.test(addr) || !(Math.abs(now - ts) < 300)) return bad("bad request");
    let who;
    try {
      who = recover(signText(url.host, addr, ts), String(b.signature || ""));
    } catch {
      return bad("bad signature", 401);
    }
    if (who !== addr) return bad("signature does not match wallet", 401);
    return json({ token: await makeToken(env, addr), address: addr, holder: await holdsChog(addr) });
  }

  if (parts[1] === "now") return json({ now });
  if (parts[1] === "econ") return await econRoute(req, env, ctx, url, parts, now, { json, bad, actor, readToken, bearer, sitterName, short, ipKey });
  if (parts[1] === "chat" && !parts[2]) return await chat(req, env, ctx, url, { json, bad, readToken, bearer, sitterName, short, line });
  // public config for the page: the Privy app id is public by design (it only works on the origins allowed in Privy)
  if (parts[1] === "config") return json({ privy: /^[a-z0-9]{10,40}$/i.test(env.PRIVY_APP_ID || "") ? env.PRIVY_APP_ID : null });

  if (parts[1] === "me") {
    const addr = await readToken(env, bearer(req));
    if (!addr) return bad("signed out", 401);
    return json({ address: addr, holder: await holdsChog(addr) });
  }

  if (parts[1] === "stats") return await stats(env, url, ctx);

  if (parts[1] === "line") {
    const ln = await line(ctx);
    const d = ln.d;
    // slim: who holds what, since when
    return json(
      { builtAt: d.builtAt, through: d.through, tokens: d.tokens.map((t) => [t.id, t.owner, t.sinceTs, t.moves]) },
      200,
      { "cache-control": "public, max-age=60" },
    );
  }

  if (parts[1] === "board") {
    // every open tab polls this: serve it from the edge cache, rebuilt at most every 20 s
    const cache = caches.default;
    const key = new Request(url.origin + "/api/board");
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = json(await board(env, now), 200, { "cache-control": "public, max-age=20" });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }

  if (parts[1] === "town") {
    const cache = caches.default;
    const key = new Request(url.origin + "/api/town");
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = json(await town(env, ctx, now), 200, { "cache-control": "public, max-age=30" });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }

  if (parts[1] === "today") {
    const cache = caches.default;
    const key = new Request(url.origin + "/api/today");
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = json(await today(env, now), 200, { "cache-control": "public, max-age=45" });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }

  if (parts[1] === "dev" && env.DEV === "1" && write) {
    // local testing only: force a pet's state (never enabled in production)
    const id = Number(parts[2]);
    const b = await jsonBody(req);
    if (b.nameTest != null) return json(nameFor(b.nameTest));
    // owner: "0x..." makes that wallet its holder here (null: back to the chain); seen: when its holder was last home
    if (b.owner !== undefined) ADDR.test(String(b.owner || "")) ? devOwner.set(id, String(b.owner)) : devOwner.delete(id);
    if (b.seen != null) await env.DB.prepare("DELETE FROM seen WHERE pet = ?").bind(id).run();
    if (b.seen > 0 && ADDR.test(String(b.owner || ""))) await env.DB.prepare("INSERT INTO seen (pet, owner, t) VALUES (?, ?, ?)").bind(id, String(b.owner), Number(b.seen)).run();
    const pet = await loadPet(env, ctx, id, now);
    pet.state = { ...pet.state, ...(b.state || {}), t: now };
    if (b.meta) pet.meta = { ...pet.meta, ...b.meta };
    if (b.best != null) pet.best = b.best;
    if ((await savePet(env, pet, now)) && pet.moved) await logMove(env, pet, now); // a pretend new holder moves it like a real one
    bestMem.delete(id);
    // clearCool: true clears every wait (and the used-ticket row); a string clears just that action's waits
    if (typeof b.clearCool === "string") await env.DB.prepare("DELETE FROM cool WHERE pet = ? AND a = ?").bind(id, b.clearCool).run();
    else if (b.clearCool) await env.DB.prepare("DELETE FROM cool WHERE pet = ?").bind(id).run();
    return json(await view(env, pet, now, null));
  }

  if (parts[1] === "pet") {
    if (!/^\d{1,4}$/.test(parts[2] || "")) return bad("no such Chog", 404);
    const id = Number(parts[2]);
    if (id < 1 || id > SUPPLY) return bad("no such Chog", 404);

    if (req.method === "GET" && !parts[3]) {
      const pet = await loadPet(env, ctx, id, now);
      // cared for on a festival day before the goal was reached: its sticker is waiting for it
      let fest = false;
      if (!pet.isNew && !(pet.meta.stickers || []).includes("festival")) fest = await festDue(env, id).catch(() => false);
      if (fest) award(pet.meta, { a: "fest", fest: true, now });
      if ((pet.isNew || pet.moved || fest) && (await savePet(env, pet, now)) && pet.moved) await logMove(env, pet, now);
      const v = url.searchParams.get("viewer");
      let vk = null;
      if (v && v.startsWith("0x")) vk = await readToken(env, bearer(req));
      else if (v && /^[a-z0-9]{8,40}$/.test(v)) vk = "anon:" + v;
      const out = await view(env, pet, now, vk);
      // the holder, signed in, back after a while: who looked after it (nobody else gets this, or pays for it)
      if (vk && ADDR.test(vk) && vk === pet.meta.owner) {
        const w = await welcomeHome(env, pet, vk, now).catch(() => null);
        if (w) out.welcome = { ...w, best: out.bestSitter };
      }
      return json(out);
    }

    if (write && parts[3] === "ticket") {
      const b = await jsonBody(req);
      const who = await actor(env, req, b);
      if (!who) return bad("who are you?", 401);
      return json({ ticket: await ticketFor(env, id, who.key, now) });
    }

    if (write && parts[3] === "act") {
      const b = await jsonBody(req);
      const who = await actor(env, req, b);
      if (!who) return bad("who are you?", 401);
      const a = String(b.action || "");
      if (!Object.hasOwn(COOLDOWN, a)) return bad("unknown action");
      const wait = await claim(env, id, who.key, a, now);
      if (wait) return json({ ok: false, code: "cooldown", wait });
      const nwait = await claim(env, id, who.ipk, a, now, netCool(a));
      if (nwait) {
        await env.DB.prepare("UPDATE cool SET t = ? WHERE pet = ? AND actor = ? AND a = ?").bind(now - COOLDOWN[a], id, who.key, a).run();
        return json({ ok: false, code: "cooldown", wait: nwait, net: true });
      }
      // give the claims back (down to a 5 s wait) if the action ends up not happening
      const release = () => [
        env.DB.prepare("UPDATE cool SET t = ? WHERE pet = ? AND actor = ? AND a = ?").bind(now - COOLDOWN[a] + Math.min(5, COOLDOWN[a]), id, who.key, a),
        env.DB.prepare("UPDATE cool SET t = ? WHERE pet = ? AND actor = ? AND a = ?").bind(now - netCool(a) + Math.min(5, netCool(a)), id, who.ipk, a),
      ];
      const nap = ["lights", "play", "feed"].includes(a) ? await env.DB.prepare("SELECT t FROM cool WHERE pet = ? AND actor = '*' AND a = 'nap'").bind(id).first() : null;
      let owned = false;
      try {
      // a festival day (the town reached its goal, this care included) or an earlier one this Chog was cared on
      const deed = ["feed", "play", "clean", "lights"].includes(a);
      const fest = deed && ((await goalNow(env, now).then((g) => g.reached || g.deeds + 1 >= g.goal).catch(() => false)) || (await festDue(env, id).catch(() => false)));
      const holder = who.addr ? await holdsChog(who.addr) : false;
      const score = a === "play" ? await scoreFrom(env, id, who.key, b.ticket, b.score, now) : 0;
      owned = await econTake(env, who, a, b.item, now); // a shop snack comes out of the bag first (econ.js)
      // two visitors at once: re-read and re-apply instead of overwriting each other
      let pet, r, isOwner;
      for (let tries = 0; ; tries++) {
        pet = await loadPet(env, ctx, id, now);
        const was = mood(pet.state);
        const before = pet.state;
        isOwner = !!(who.addr && pet.meta.owner === who.addr);
        const hush = nap && nap.t + LET_SLEEP > now && before.asleep && !isOwner && !(a === "feed" && before.food < 25);
        const out = hush ? { s: before, r: { ok: false, code: "letsleep", wait: nap.t + LET_SLEEP - now } } : act(pet.state, pet.p, a, { item: b.item, score, holder, owned }, now);
        r = out.r;
        // a refusal doesn't touch the shared pet (no annoying it to bits by overfeeding from many tabs)
        pet.state = r.ok ? out.s : before;
        if (r.ok) {
          pet.meta.care = (pet.meta.care || 0) + 1;
          if (isOwner) pet.meta.bond = (pet.meta.bond || 0) + 1;
          r.stickers = award(pet.meta, { a, code: r.code, score: r.score || 0, was, now, fest });
          if (a === "play" && r.score > pet.best && r.score >= 15) {
            pet.best = r.score;
            pet.meta.bestBy = who.who;
            r.record = true;
          }
        }
        if (!r.ok && !pet.isNew && !pet.moved) break;
        if (await savePet(env, pet, now)) break;
        if (tries >= 2) {
          if (owned) await econReturn(env, who, b.item, now);
          await env.DB.batch(release());
          return bad("busy, try again", 503);
        }
      }
      if (r.record) ctx.waitUntil(caches.default.delete(new Request(url.origin + "/api/board")));
      if (owned && !r.ok) await econReturn(env, who, b.item, now), (owned = false); // not eaten: back in the bag
      const stmts = [];
      if (pet.moved) stmts.push(env.DB.prepare("INSERT INTO visits (pet, t, who, a, code) VALUES (?, ?, ?, ?, ?)").bind(id, now, short(pet.meta.owner), "move", "moved"));
      if (r.ok) {
        const code = a === "feed" ? b.item + ":" + r.code : a === "play" ? "score:" + r.score : r.code;
        const label = isOwner ? who.who + " (home)" : who.who;
        // pets are endless: one line per sitter per 10 min in the visitors log, so nobody can flood it with them
        const quiet = a === "love" && (await env.DB.prepare("SELECT 1 AS x FROM visits WHERE pet = ? AND who = ? AND a = 'love' AND t > ?").bind(id, label, now - 600).first());
        if (!quiet) stmts.push(env.DB.prepare("INSERT INTO visits (pet, t, who, a, code) VALUES (?, ?, ?, ?, ?)").bind(id, now, label, a, code));
        if (a === "lights" && r.code === "nap") stmts.push(env.DB.prepare("INSERT INTO cool (pet, actor, a, t) VALUES (?, '*', 'nap', ?) ON CONFLICT(pet, actor, a) DO UPDATE SET t = excluded.t").bind(id, now));
      } else {
        // a refused action only costs a short wait, not the full cooldown
        stmts.push(...release());
      }
      if (stmts.length) await env.DB.batch(stmts);
      if (r.ok) bestMem.delete(id);
      if (r.ok && isOwner) ctx.waitUntil(markHome(env, id, who.addr, now).catch(() => {}));
      // keep the tables small: an occasional sweep
      if (Math.random() < 0.02) {
        ctx.waitUntil(
          env.DB.batch([
            env.DB.prepare("DELETE FROM visits WHERE t < ?").bind(now - 30 * 86400),
            env.DB.prepare("DELETE FROM cool WHERE t < ?").bind(now - 3600),
            env.DB.prepare("DELETE FROM pool WHERE day < ?").bind(Math.floor(now / 86400) - 2),
          ]),
        );
      }
      // waking a sleepy Chog just to annoy it isn't care: a grumpy wake-up pays nothing
      const pays = r.ok && !(a === "lights" && r.code === "grumpy");
      const candles = pays ? await econAct(env, who, { a, code: r.code, score: r.score || 0, pet: id, stickers: r.stickers || [], home: isOwner, now }).catch(() => null) : null;
      return json({ ...r, pet: await view(env, pet, now, who.key), owner: isOwner, holder, candles });
      } catch (e) {
        await env.DB.batch(release()).catch(() => {});
        if (owned) await econReturn(env, who, b.item, now).catch(() => {});
        throw e;
      }
    }

    if (write && parts[3] === "name") {
      const b = await jsonBody(req);
      const addr = await readToken(env, bearer(req));
      if (!addr) return bad("sign in first", 401);
      const pet = await loadPet(env, ctx, id, now);
      if (pet.meta.owner !== addr) return bad("only the wallet that holds this Chog can name it", 403);
      const nm = nameFor(b.name);
      if (nm.error) return bad(nm.error);
      const name = nm.name;
      pet.meta.name = name;
      award(pet.meta, { a: "name", code: name, now });
      if (!(await savePet(env, pet, now))) return bad("busy, try again", 503);
      await env.DB.prepare("INSERT INTO visits (pet, t, who, a, code) VALUES (?, ?, ?, ?, ?)").bind(id, now, short(addr) + " (home)", "name", name || "-").run();
      return json(await view(env, pet, now, addr));
    }
  }
  return bad("not found", 404);
}

// market numbers for the collection panel: OpenSea stats (secret OPENSEA_KEY) and the $CHOG price from GeckoTerminal.
// Edge-cached 5 min; a source that fails just leaves its fields out.
async function stats(env, url, ctx) {
  const cache = caches.default;
  const key = new Request(url.origin + "/api/stats");
  const hit = await cache.match(key);
  if (hit) return hit;
  const get = (u, h = {}) => fetch(u, { headers: { accept: "application/json", "user-agent": "chogpet.xyz (fan project)", ...h }, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [os, gt] = await Promise.all([
    // OpenSea wants a (free) key now; without OPENSEA_KEY the floor just isn't shown
    env.OPENSEA_KEY ? get(`https://api.opensea.io/api/v2/collections/${OS_SLUG}/stats`, { "x-api-key": env.OPENSEA_KEY }) : null,
    get(`https://api.geckoterminal.com/api/v2/networks/monad/tokens/${CHOG_TOKEN}`),
  ]);
  const out = {};
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : typeof x === "string" && x && isFinite(+x) ? +x : null);
  if (os && os.total) {
    const iv = Object.fromEntries((os.intervals || []).map((i) => [i.interval, i]));
    out.floor = num(os.total.floor_price);
    out.floorSym = typeof os.total.floor_price_symbol === "string" ? os.total.floor_price_symbol.slice(0, 8) : "MON";
    out.owners = num(os.total.num_owners);
    out.sales = num(os.total.sales);
    out.sales1d = iv.one_day ? num(iv.one_day.sales) : null;
    out.sales7d = iv.seven_day ? num(iv.seven_day.sales) : null;
  }
  const a = gt && gt.data && gt.data.attributes;
  if (a) {
    out.chogUsd = num(a.price_usd);
    out.chogMcap = num(a.market_cap_usd) || num(a.fdv_usd);
    out.chogVol = a.volume_usd ? num(a.volume_usd.h24) : null;
  }
  if (out.chogUsd == null) {
    // GeckoTerminal sometimes turns away Cloudflare's servers; DexScreener is the fallback (biggest CHOG pool, volume summed)
    const ds = await get(`https://api.dexscreener.com/latest/dex/tokens/${CHOG_TOKEN}`);
    const pairs = ((ds && ds.pairs) || []).filter((p) => p.chainId === "monad" && p.baseToken && String(p.baseToken.address).toLowerCase() === CHOG_TOKEN.toLowerCase());
    if (pairs.length) {
      const top = pairs.reduce((m, p) => (((p.liquidity && p.liquidity.usd) || 0) > ((m.liquidity && m.liquidity.usd) || 0) ? p : m));
      out.chogUsd = num(top.priceUsd);
      out.chogMcap = num(top.marketCap) || num(top.fdv);
      out.chogVol = pairs.reduce((t, p) => t + (num(p.volume && p.volume.h24) || 0), 0);
    }
  }
  // both price sources sometimes turn Cloudflare away: keep the last good answer for a day and fall back to it
  const lastKey = new Request(url.origin + "/api/stats-last");
  if (out.chogUsd != null) ctx.waitUntil(cache.put(lastKey, new Response(JSON.stringify(out), { headers: { "cache-control": "public, max-age=86400" } })));
  else {
    const last = await cache.match(lastKey).then((r) => (r ? r.json() : null)).catch(() => null);
    if (last) for (const k of ["chogUsd", "chogMcap", "chogVol", "floor", "floorSym", "owners", "sales", "sales1d", "sales7d"]) if (out[k] == null && last[k] != null) out[k] = last[k];
  }
  out.at = Math.floor(Date.now() / 1000);
  const res = json(out, 200, { "cache-control": `public, max-age=${Object.keys(out).length > 1 ? 300 : 30}` });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- link previews (X, Telegram, Discord): per-Chog og / twitter tags on "/?chog=N" ----------
// The page is static; only the head changes. The Chog's own clean art is the picture (the original from IPFS,
// same-origin under /chogs/), the title carries its day at home when that's known without a slow call.
const SITE_DESC = "A tamagotchi for every Chog Genesis NFT on Monad. Independent fan project.";
function chogFromQuery(url) {
  const tok = Number(url.searchParams.get("token"));
  if (Number.isInteger(tok) && tok >= 1 && tok <= SUPPLY) return tok;
  const n = Number(url.searchParams.get("chog"));
  if (!Number.isInteger(n) || n < 1 || n > SUPPLY) return 0;
  return CHOGS.n.indexOf(n) + 1; // 0 if no such number
}
async function sinceOf(env, ctx, id) {
  try {
    const row = await env.DB.prepare("SELECT meta FROM pets WHERE id = ?").bind(id).first();
    const m = row && JSON.parse(row.meta);
    if (m && m.since > 0 && ADDR.test(m.owner || "")) return { since: m.since, tier: await homeTier(env, { id, meta: m }).catch(() => "") };
  } catch {}
  // the chain snapshot only if it's at hand quickly (a crawler won't wait)
  try {
    const ln = await Promise.race([line(ctx), new Promise((r) => setTimeout(() => r(null), 1200))]);
    const t = ln && ln.byId.get(id);
    if (t && Number(t.sinceTs) > 0) return { since: Number(t.sinceTs), tier: "" };
  } catch {}
  return { since: 0, tier: "" };
}
async function page(req, env, ctx, url) {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const id = chogFromQuery(url);
  // previews need absolute https links (wrangler dev reports the custom domain over http)
  const origin = url.protocol === "http:" && !/^(127\.|localhost$|\[::1\]$)/.test(url.hostname) ? "https://" + url.host : url.origin;
  let title = "Chog Pet", desc = SITE_DESC, img = origin + "/og.png", w = 1200, h = 630, alt = "Chog Pet: a tamagotchi for every Chog Genesis NFT";
  let link = origin + "/";
  if (id) {
    const p = persona(id);
    const nm = nameOf(id);
    const { since, tier } = await sinceOf(env, ctx, id);
    const now = Math.floor(Date.now() / 1000);
    const days = since > 0 && since <= now ? Math.floor((now - since) / 86400) : -1;
    // its stage at home (days held), then its bond with its holder once it has one: "day 41 · Family · Soulmate"
    title = days >= 0 ? `${nm} · day ${days} · ${stageOf(days).name}${tier ? " · " + tier : ""}` : `${nm} · Chog Pet`;
    desc = `${p.title}. ${quirks(p).slice(0, 2).join(". ")}. Babysit it on Chog Pet, a tamagotchi for every Chog Genesis NFT. Independent fan project.`;
    img = `${origin}/chogs/${id}-xl.webp`;
    w = h = 1000;
    alt = `${nm}, a ${p.title}`;
    link = `${origin}/?chog=${CHOGS.n[id - 1]}`;
  }
  const set = (v) => ({ element: (e) => e.setAttribute("content", v) });
  const out = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(id ? `${nameOf(id)} · Chog Pet` : "Chog Pet") })
    .on('meta[property="og:title"]', set(title))
    .on('meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="twitter:description"]', set(desc))
    .on('meta[property="og:image"]', set(img))
    .on('meta[name="twitter:image"]', set(img))
    .on('meta[property="og:image:width"]', set(String(w)))
    .on('meta[property="og:image:height"]', set(String(h)))
    .on('meta[property="og:image:alt"]', set(alt))
    .on('meta[name="twitter:image:alt"]', set(alt))
    .on('meta[property="og:url"]', set(link))
    .transform(res);
  const r2 = new Response(out.body, out);
  r2.headers.set("cache-control", "public, max-age=60");
  return r2;
}

async function art(req, url, ctx) {
  // same-origin copy of the Chog art (so canvases can export the share card)
  const file = url.pathname.slice("/chogs/".length);
  const m = file.match(/^(\d{1,4})(-l|-xl)?\.webp$/);
  if (!m || +m[1] < 1 || +m[1] > SUPPLY) return new Response("not found", { status: 404 });
  const cache = caches.default;
  const key = new Request(url.origin + "/chogs/" + file);
  let res = await cache.match(key);
  if (res) return res;
  let up = null;
  if (m[2] === "-xl") {
    // full-size original from IPFS; the 384 px copy if both gateways are down
    for (const gw of GATEWAYS) {
      up = await fetch(`${gw}${IPFS_ART}/${CHOGS.n[+m[1] - 1]}.webp`, { cf: { cacheTtl: 2592000 }, signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (up && up.ok && (up.headers.get("content-type") || "").startsWith("image/")) break;
      up = null;
    }
    if (!up) up = await fetch(UPSTREAM + `/chogs/${m[1]}-l.webp`, { cf: { cacheTtl: 86400 } });
  } else up = await fetch(UPSTREAM + "/chogs/" + file, { cf: { cacheTtl: 86400 } });
  if (!up.ok) return new Response("not found", { status: 404 });
  res = new Response(up.body, { headers: { "content-type": "image/webp", "cache-control": "public, max-age=604800, immutable" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, env, ctx, url);
      if (url.pathname.startsWith("/chogs/")) return await art(req, url, ctx);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return await page(req, env, ctx, url).catch(() => env.ASSETS.fetch(req));
    } catch (e) {
      console.error("api", e && e.stack ? e.stack : e);
      return bad("server error", 500);
    }
    return env.ASSETS.fetch(req);
  },
};
