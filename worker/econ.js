// Chog Pet economy, server side. Candles are a game currency only (no buying, selling, sending or cashing out).
// One row per actor (a signed wallet or an anonymous sitter "anon:<id>"), versioned like the pets so two tabs
// can't spend the same Candle twice. Every random roll uses crypto.getRandomValues. Daily caps reset at 00:00 UTC.
import {
  ITEMS, EARN, BOUNTIES, BOUNTY_ALL, CAPSULE, BET, WHEEL, DUP_REFUND, MAX_STACK, TIERS, PULLS_PER_DAY, XP, POOL,
  dayOf, rollCapsule, rollWheel, payout, levelOf, frameOf, bondOf, growOf, xpFor, unlocks,
} from "../public/js/econ.js";
import { STICKERS } from "../public/js/stickers.js";
import { FOODS, COOLDOWN } from "../public/js/sim.js";
import { jsonBody } from "./chat.js";

const SUPPLY = 1969;
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

class Refuse extends Error {
  constructor(code, msg, status = 409, extra = {}) {
    super(msg);
    Object.assign(this, { code, status, extra });
  }
}

/** Tables for ensure() in index.js. */
export function econSchema(env) {
  return [
    env.DB.prepare("CREATE TABLE IF NOT EXISTS econ (actor TEXT PRIMARY KEY, bal INTEGER NOT NULL DEFAULT 0, s TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', ver INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS econ_label ON econ (label)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gifts (pet INTEGER NOT NULL, item TEXT NOT NULL, who TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (pet, item))"),
    // what one network (salted IP hash, k) has been paid today, per field f; g = what the last claim got
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pool (k TEXT NOT NULL, day INTEGER NOT NULL, f TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, g INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (k, day, f))"),
    // you and one Chog: bond XP, and how many XP actions you did on it today (the diminishing returns)
    env.DB.prepare("CREATE TABLE IF NOT EXISTS bond (pet INTEGER NOT NULL, actor TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, day INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pet, actor))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS bond_actor ON bond (actor)"),
  ];
}

const blank = () => ({ bal: 0, inv: {}, own: [], c: "", b: "", d: { day: 0 }, st: { d: 0, n: 0 }, ws: 0, xp: 0, mfrom: [], tot: { in: 0, out: 0 } });
const DAYKEYS = ["acts", "careC", "catchC", "stkC", "first", "bets", "net", "pulls", "wheel", "best", "xp"];
function rollDay(e, now) {
  const day = dayOf(now);
  if (e.d && e.d.day === day) return;
  e.d = { day, acts: 0, careC: 0, catchC: 0, stkC: 0, first: 0, bets: 0, net: 0, pulls: 0, wheel: 0, pets: [], best: 0, bty: [], xp: 0 };
}
const styleStr = (e) => (e.c || e.b ? `${e.c || ""}|${e.b || ""}` : "");

// The Rush pass (skip your waits) is gone: skipping cooldowns for Candles undid "don't spam a Chog". Any still in a
// bag turn into Candles at the shop price. Done on read, saved with the next versioned write, so it happens once.
const RUSH_REFUND = 15;
function refundRush(e) {
  const n = Math.max(0, Math.floor((e.inv && e.inv.rush) || 0));
  if (e.inv && "rush" in e.inv) delete e.inv.rush;
  if (!n) return 0;
  e.bal += n * RUSH_REFUND;
  e.tot = { ...(e.tot || {}), in: ((e.tot && e.tot.in) || 0) + n * RUSH_REFUND };
  return n;
}

async function read(env, key, now) {
  const row = await env.DB.prepare("SELECT bal, s, ver FROM econ WHERE actor = ?").bind(key).first();
  const old = row ? JSON.parse(row.s) : null;
  const e = old ? { ...blank(), ...old } : blank();
  e.bal = row ? row.bal : 0;
  e.rushBack = refundRush(e); // not stored (see mutate)
  // everyone starts levels at Lv 1, including sitters from before levels existed (blank() gives xp: 0)
  rollDay(e, now);
  return { e, ver: row ? row.ver : -1 };
}

/** Read-modify-write one actor's wallet. fn(e) mutates e and returns a result (or throws Refuse). */
async function mutate(env, who, now, fn) {
  for (let tries = 0; tries < 4; tries++) {
    const { e, ver } = await read(env, who.key, now);
    const out = fn(e) || {};
    if (e.bal < 0) throw new Refuse("funds", "Not enough Candles", 402);
    const bal = e.bal;
    const s = JSON.stringify({ ...e, bal: undefined, rushBack: undefined });
    let r;
    if (ver < 0)
      r = await env.DB.prepare("INSERT INTO econ (actor, bal, s, label, style, ver, updated) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6) ON CONFLICT(actor) DO NOTHING").bind(who.key, bal, s, who.who, styleStr(e), now).run();
    else
      r = await env.DB.prepare("UPDATE econ SET bal = ?2, s = ?3, label = ?4, style = ?5, ver = ver + 1, updated = ?6 WHERE actor = ?1 AND ver = ?7").bind(who.key, bal, s, who.who, styleStr(e), now, ver).run();
    if (r.meta && r.meta.changes > 0) return { ...out, e };
  }
  throw new Refuse("busy", "Busy, try again", 503);
}

function earn(e, n, why, list) {
  if (!(n > 0)) return;
  e.bal += n;
  e.tot.in = (e.tot.in || 0) + n;
  list.push([why, n]);
}
function spend(e, n) {
  if (e.bal < n) throw new Refuse("funds", "Not enough Candles", 402, { need: n - e.bal });
  e.bal -= n;
  e.tot.out = (e.tot.out || 0) + n;
}
function addItem(e, k, n) {
  e.inv[k] = Math.min(MAX_STACK, (e.inv[k] || 0) + n);
}

function bountyProgress(d) {
  return { care: d.acts || 0, help: (d.pets || []).length, catch: d.best || 0 };
}

// ---------- one network's daily pool (POOL in econ.js) ----------
// claim(): take up to `want` per field from what this network may still be paid today; returns what it got.
// One atomic upsert per field (SQLite evaluates every SET against the old row), so parallel sitters on one
// network can never get more than the pool between them. What a claim doesn't use goes back with give().
const CLAIM =
  "INSERT INTO pool (k, day, f, n, g) VALUES (?1, ?2, ?3, min(?4, ?5), min(?4, ?5)) ON CONFLICT(k, day, f) DO UPDATE SET g = max(0, min(n + ?4, ?5) - n), n = max(n, min(n + ?4, ?5)) RETURNING g";
async function claim(env, ipk, day, want) {
  const fs = Object.keys(want).filter((f) => want[f] > 0 && POOL[f] != null);
  const got = {};
  for (const f of Object.keys(want)) got[f] = POOL[f] == null ? want[f] : 0;
  if (!fs.length) return got;
  if (!ipk) return { ...want }; // no network known (never in practice: the worker always sees one)
  const res = await env.DB.batch(fs.map((f) => env.DB.prepare(CLAIM).bind(ipk, day, f, Math.floor(want[f]), POOL[f])));
  fs.forEach((f, i) => (got[f] = Number(((res[i].results || [])[0] || {}).g) || 0));
  return got;
}
async function give(env, ipk, day, back) {
  const fs = Object.keys(back).filter((f) => back[f] > 0 && POOL[f] != null);
  if (!ipk || !fs.length) return;
  await env.DB.batch(fs.map((f) => env.DB.prepare("UPDATE pool SET n = max(0, n - ?4) WHERE k = ?1 AND day = ?2 AND f = ?3").bind(ipk, day, f, Math.floor(back[f]))));
}
async function poolLeft(env, ipk, day) {
  const left = { ...POOL };
  if (!ipk) return left;
  const { results } = await env.DB.prepare("SELECT f, n FROM pool WHERE k = ? AND day = ?").bind(ipk, day).all();
  for (const r of results) if (POOL[r.f] != null) left[r.f] = Math.max(0, POOL[r.f] - r.n);
  return left;
}
/** Claim one go of a counted thing (a pull, a bet, the wheel) for the network, or refuse. */
async function claimOne(env, who, now, f, msg) {
  const day = dayOf(now);
  const got = await claim(env, who.ipk, day, { [f]: 1 });
  if (!got[f]) throw new Refuse("net", msg, 409, { ends: (day + 1) * 86400 });
  return () => give(env, who.ipk, day, { [f]: 1 });
}

function lvState(e) {
  const L = levelOf(e.xp || 0);
  return { ...L, frame: frameOf(L.lv).k, today: e.d.xp || 0, cap: XP.dayCap };
}

/** The public picture of a wallet (what the hub shows). left = what the network may still be paid today. */
function state(e, signed, left) {
  const d = e.d;
  const prog = bountyProgress(d);
  const inv = {};
  for (const [k, n] of Object.entries(e.inv || {})) if (n > 0 && ITEMS[k]) inv[k] = n;
  const streak = e.st && e.st.d >= d.day - 1 ? e.st.n : 0;
  // what the first care pays: today's if it's still to come, else tomorrow's (one more day of streak)
  const nextN = d.first ? streak + 1 : e.st && e.st.d === d.day - 1 ? streak + 1 : 1;
  return {
    bal: e.bal,
    inv,
    own: e.own || [],
    c: e.c || "",
    b: e.b || "",
    streak,
    ws: e.ws || 0,
    lv: lvState(e),
    day: {
      care: d.careC, careCap: EARN.careCap,
      catch: d.catchC, catchCap: EARN.catchCap,
      stk: d.stkC, stkCap: EARN.stickerCap,
      bets: d.bets, betsCap: BET.perDay,
      loss: Math.max(0, -d.net), lossCap: BET.lossCap,
      won: Math.max(0, d.net), winCap: BET.winCap,
      pulls: d.pulls, pullsCap: PULLS_PER_DAY,
      wheel: !!d.wheel,
      first: !!d.first,
      firstPay: EARN.first + Math.min(nextN - 1, EARN.firstStreakMax),
      firstXp: XP.first + XP.streakStep * Math.min(nextN - 1, XP.streakMax),
      bounties: BOUNTIES.map((b) => ({ k: b.k, t: b.t, n: b.n, pay: b.pay, at: Math.min(b.n, prog[b.k]), done: d.bty.includes(b.k) })),
      all: d.bty.includes("all"),
      net: left || null, // the network's pool left today (shared with other sitters on it)
    },
    ends: (d.day + 1) * 86400,
    signed: !!signed,
  };
}

// ---------- hooks for the act handler ----------
/** A shop snack about to be fed: take one from the bag first. Returns true if taken, false if not a shop snack. */
export async function econTake(env, who, a, item, now) {
  if (a !== "feed" || !FOODS[item] || !FOODS[item].shop) return false;
  try {
    await mutate(env, who, now, (e) => {
      if (!(e.inv[item] > 0)) throw new Refuse("noitem", "You don't have that snack", 409);
      e.inv[item]--;
    });
    return true;
  } catch (err) {
    if (err instanceof Refuse && err.code === "noitem") return false;
    throw err;
  }
}
/** The snack wasn't eaten after all (it was full, asleep, ...): back in the bag. */
export async function econReturn(env, who, item, now) {
  await mutate(env, who, now, (e) => addItem(e, item, 1));
}

/**
 * Apply one care action's Candles and XP to e. nth = how many XP actions this sitter did on this Chog today
 * (this one included). lim = what the network pool allows per field (null: no limit, for a dry run).
 * Returns what it used per pool field, plus bond (the XP that counts for this Chog).
 */
function settle(e, ev, nth, lim, why) {
  const d = e.d, day = d.day;
  const L = lim ? { ...lim } : null;
  const used = { care: 0, catch: 0, stk: 0, bty: 0, first: 0, xp: 0, bond: 0 };
  const take = (f, n) => {
    n = Math.max(0, Math.floor(n));
    if (L) (n = Math.min(n, L[f] || 0)), (L[f] = (L[f] || 0) - n);
    used[f] += n;
    return n;
  };
  let xp = 0;
  if (!d.first) {
    d.first = 1;
    const n = e.st && e.st.d === day - 1 ? e.st.n + 1 : e.st && e.st.d === day ? e.st.n : 1;
    e.st = { d: day, n };
    // the streak counts either way; the bonus only if this network hasn't had its two today
    if (take("first", 1)) {
      earn(e, EARN.first + Math.min(n - 1, EARN.firstStreakMax), n > 1 ? `Day ${n} streak` : "First care today", why);
      xp += XP.first + XP.streakStep * Math.min(n - 1, XP.streakMax);
    }
  }
  d.acts++;
  if (!d.pets.includes(ev.pet) && d.pets.length < 60) d.pets.push(ev.pet);
  if (["feed", "clean", "lights"].includes(ev.a)) {
    const c = take("care", Math.min(EARN.care, EARN.careCap - d.careC));
    if (c > 0) (d.careC += c), earn(e, c, "Care", why);
  }
  const score = Math.max(0, Math.round(ev.score || 0));
  if (ev.a === "play") {
    d.best = Math.max(d.best, score);
    const base = take("catch", Math.min(Math.floor(score / EARN.catchDiv), EARN.catchRound, EARN.catchCap - d.catchC));
    if (base > 0) {
      d.catchC += base;
      earn(e, base, "Candle Catch", why);
      if (e.inv.x2 > 0) {
        // the ticket was bought with Candles already earned: its half doesn't come out of any pool
        e.inv.x2--;
        earn(e, base, "x2 ticket", why);
      }
    }
  }
  for (const k of ev.stickers || []) {
    const st = STICKERS.find((s) => s.k === k);
    const c = take("stk", Math.min((st && st.pay) || 0, EARN.stickerCap - d.stkC));
    if (c > 0) (d.stkC += c), earn(e, c, `Sticker: ${st.name}`, why);
  }
  const prog = bountyProgress(d);
  for (const b of BOUNTIES)
    if (!d.bty.includes(b.k) && prog[b.k] >= b.n) {
      d.bty.push(b.k);
      const c = take("bty", b.pay);
      if (c > 0) earn(e, c, `Bounty: ${b.t}`, why);
      xp += XP.bounty;
    }
  if (!d.bty.includes("all") && BOUNTIES.every((b) => d.bty.includes(b.k))) {
    d.bty.push("all");
    const c = take("bty", BOUNTY_ALL);
    if (c > 0) earn(e, c, "All bounties done", why);
    xp += XP.all;
  }
  // the action itself: full XP the first two times on a Chog today, then less, then none
  const m = XP.chog[nth - 1] || 0;
  let ax = Math.round((XP.act[ev.a] || 0) * m);
  if (ev.a === "play" && m > 0) ax += Math.min(XP.playMax, Math.floor(score / XP.playDiv));
  // at home (ev.home: the worker saw this wallet hold the Chog live, never the page's word): x1.5, same caps
  if (ev.home) ax = Math.round(ax * XP.home);
  xp += ax;
  xp = take("xp", Math.min(xp, XP.dayCap - (d.xp || 0)));
  if (xp > 0) (d.xp = (d.xp || 0) + xp), (e.xp = (e.xp || 0) + xp);
  used.bond = Math.min(ax, xp);
  used.home = ev.home && ax > 0 && xp > 0 ? 1 : 0; // not a pool field: claim() skips it
  return used;
}

// one more XP action on this Chog today (atomic): returns n (1 = the first today) and the bond XP so far
const TICK =
  "INSERT INTO bond (pet, actor, xp, day, n) VALUES (?1, ?2, 0, ?3, 1) ON CONFLICT(pet, actor) DO UPDATE SET n = CASE WHEN day = ?3 THEN n + 1 ELSE 1 END, day = ?3 RETURNING n, xp";

async function bondInfo(env, key, pet) {
  const [mine, all] = await env.DB.batch([
    env.DB.prepare("SELECT xp, day, n FROM bond WHERE pet = ? AND actor = ?").bind(pet, key),
    env.DB.prepare("SELECT SUM(xp) AS x FROM bond WHERE pet = ?").bind(pet),
  ]);
  const m = (mine.results || [])[0];
  return { bond: { ...bondOf(m ? m.xp : 0), pet }, grow: { ...growOf(Number(((all.results || [])[0] || {}).x) || 0), pet } };
}

/**
 * Candles + XP for an action that went ahead. Returns
 * { bal, gain, why: [[label, n], ...], xp: { gain, lv, up, unlocked, bond, grow, ... } } or null for a pet.
 */
export async function econAct(env, who, ev) {
  if (ev.a === "love") return null; // pets are free and endless: they don't pay
  const day = dayOf(ev.now);
  const tick = await env.DB.prepare(TICK).bind(ev.pet, who.key, day).first();
  const nth = Number(tick && tick.n) || 1;
  // a dry run on a copy says what to ask the network pool for; the real run can't take more than it got
  const snap = (await read(env, who.key, ev.now)).e;
  const want = settle(structuredClone(snap), ev, nth, null, []);
  delete want.bond;
  delete want.home;
  const got = await claim(env, who.ipk, day, want);
  let why = [], used = null, lvBefore = 1, e;
  try {
    ({ e } = await mutate(env, who, ev.now, (x) => {
      why = [];
      lvBefore = levelOf(x.xp || 0).lv;
      used = settle(x, ev, nth, got, why);
    }));
  } finally {
    const back = {};
    for (const f of Object.keys(got)) back[f] = got[f] - ((used && used[f]) || 0);
    await give(env, who.ipk, day, back);
  }
  if (used.bond > 0) await env.DB.prepare("UPDATE bond SET xp = xp + ?3 WHERE pet = ?1 AND actor = ?2").bind(ev.pet, who.key, used.bond).run();
  const info = await bondInfo(env, who.key, ev.pet);
  const was = bondOf(info.bond.xp - used.bond);
  const lv = levelOf(e.xp || 0);
  return {
    bal: e.bal,
    gain: why.reduce((t, w) => t + w[1], 0),
    why,
    xp: {
      gain: used.xp,
      ...lvState(e),
      up: lv.lv > lvBefore ? lv.lv : 0,
      unlocked: lv.lv > lvBefore ? unlocks().filter((u) => u.lv > lvBefore && u.lv <= lv.lv) : [],
      nth,
      home: !!used.home, // the x1.5 at home went in (the gain line says so)
      bond: { ...info.bond, gain: used.bond, up: info.bond.lv > was.lv ? info.bond.lv : 0 },
      grow: info.grow,
    },
  };
}

/** Gifts in a Chog's room, for view(). */
export async function petGifts(env, id) {
  try {
    const { results } = await env.DB.prepare("SELECT item, who, t FROM gifts WHERE pet = ? ORDER BY t").bind(id).all();
    return results.filter((g) => ITEMS[g.item] && ITEMS[g.item].kind === "gift");
  } catch {
    return [];
  }
}


// ---------- routes: /api/econ[/...] ----------
export async function econRoute(req, env, ctx, url, parts, now, h) {
  const { json, bad } = h;
  try {
    if (req.method === "GET" && !parts[2]) return json(await getState(env, req, url, now, h));
    if (req.method !== "POST") return bad("not found", 404);
    const b = await jsonBody(req);
    const who = await h.actor(env, req, b);
    if (!who) return bad("who are you?", 401);
    const op = parts[2];
    let out;
    if (op === "buy") out = await buy(env, who, b, now);
    else if (op === "gift") out = await gift(env, who, b, now, h);
    else if (op === "equip") out = await equip(env, who, b, now);
    else if (op === "use") throw new Refuse("gone", "Nothing to use: boosts work by themselves", 400);
    else if (op === "pull") out = await pull(env, who, now);
    else if (op === "bet") out = await bet(env, who, b, now);
    else if (op === "spin") out = await spin(env, who, now);
    else if (op === "merge") out = await merge(env, who, b, now);
    else if (op === "dev" && env.DEV === "1") out = await dev(env, who, b, now);
    else return bad("not found", 404);
    // every answer carries the network's pool, so the hub's "left today" stays honest
    if (out && out.me) out.me.day.net = await poolLeft(env, who.ipk, dayOf(now));
    return json(out);
  } catch (err) {
    if (err instanceof Refuse) return json({ ok: false, code: err.code, error: err.message, ...err.extra }, err.status);
    throw err;
  }
}

async function getState(env, req, url, now, h) {
  const addr = await h.readToken(env, h.bearer(req));
  const anon = url.searchParams.get("anon") || "";
  let key = null, label = "";
  if (addr) (key = addr), (label = h.short(addr));
  else if (/^[a-z0-9]{8,40}$/.test(anon)) (key = "anon:" + anon), (label = h.sitterName(anon));
  if (!key) throw new Refuse("who", "who are you?", 401);
  let { e } = await read(env, key, now);
  let refund = null;
  if (e.rushBack) {
    // save the swap now (the versioned write re-reads, so two tabs can't both be paid)
    const n = e.rushBack;
    ({ e } = await mutate(env, { key, who: label }, now, () => {}));
    refund = { rush: n, candles: n * RUSH_REFUND };
  }
  const left = await poolLeft(env, await h.ipKey(env, req, now), dayOf(now));
  const out = { ok: true, me: { ...state(e, addr, left), label, style: styleStr(e) } };
  if (refund) out.refund = refund;
  // a signed-in visitor whose browser also has an anonymous wallet with something in it can bring it along
  if (addr && /^[a-z0-9]{8,40}$/.test(anon)) {
    const a = await env.DB.prepare("SELECT bal, s FROM econ WHERE actor = ?").bind("anon:" + anon).first();
    if (a) {
      const src = JSON.parse(a.s);
      const inv = src.inv || {};
      const has = a.bal > 0 || Object.values(inv).some((n) => n > 0) || (src.xp || 0) > 0 || (src.own || []).length > 0;
      if (has && (!src.merged || src.merged === addr)) out.mergeable = { bal: a.bal, xp: src.xp || 0 };
    }
  }
  const pet = Number(url.searchParams.get("pet"));
  if (Number.isInteger(pet) && pet >= 1 && pet <= SUPPLY) {
    out.gifts = await petGifts(env, pet);
    Object.assign(out, await bondInfo(env, key, pet));
    // how the names in its visitors log look (colour + badge)
    const { results } = await env.DB.prepare("SELECT who FROM visits WHERE pet = ? ORDER BY t DESC LIMIT 40").bind(pet).all();
    const labels = [...new Set(results.map((r) => String(r.who).replace(/ \(home\)$/, "")))].slice(0, 30);
    out.styles = {};
    if (labels.length) {
      const q = `SELECT label, style FROM econ WHERE style != '' AND label IN (${labels.map(() => "?").join(",")})`;
      const { results: st } = await env.DB.prepare(q).bind(...labels).all();
      for (const r of st) out.styles[r.label] = r.style;
    }
  }
  return out;
}

const locked = (e, it) => it.lv > 1 && levelOf(e.xp || 0).lv < it.lv;

async function buy(env, who, b, now) {
  const k = String(b.item || "");
  const it = Object.hasOwn(ITEMS, k) ? ITEMS[k] : null;
  if (!it) throw new Refuse("bad", "No such thing", 400);
  const stack = it.kind === "food" || it.kind === "boost" || it.kind === "gift";
  const qty = stack ? Math.max(1, Math.min(10, Math.floor(Number(b.qty) || 1))) : 1;
  const { e } = await mutate(env, who, now, (e) => {
    if (locked(e, it)) throw new Refuse("locked", `Unlocks at Sitter Lv ${it.lv}`, 403, { lv: it.lv });
    if (!stack && e.own.includes(k)) throw new Refuse("owned", "You already have it", 409);
    if (stack && (e.inv[k] || 0) + qty > MAX_STACK) throw new Refuse("full", "Your bag is full of those", 409);
    spend(e, it.price * qty);
    if (stack) addItem(e, k, qty);
    else {
      e.own.push(k);
      if (it.kind === "color") e.c = k;
      else e.b = k;
    }
  });
  return { ok: true, item: k, qty, me: state(e, who.addr), style: styleStr(e) };
}

async function gift(env, who, b, now, h) {
  const k = String(b.item || "");
  const pet = Number(b.pet);
  if (!Object.hasOwn(ITEMS, k) || ITEMS[k].kind !== "gift") throw new Refuse("bad", "That isn't a gift", 400);
  if (!Number.isInteger(pet) || pet < 1 || pet > SUPPLY) throw new Refuse("bad", "No such Chog", 400);
  // claim the spot in the room first (one of each per Chog), then pay; undo the spot if paying fails
  const ins = await env.DB.prepare("INSERT INTO gifts (pet, item, who, t) VALUES (?, ?, ?, ?) ON CONFLICT(pet, item) DO NOTHING").bind(pet, k, who.who, now).run();
  if (!(ins.meta && ins.meta.changes > 0)) throw new Refuse("has", "It already has one", 409);
  let e;
  try {
    ({ e } = await mutate(env, who, now, (e) => {
      if (e.inv[k] > 0) e.inv[k]--;
      else if (b.buy) {
        // one from your bag (a capsule prize) can go in any time; buying one needs the level
        if (locked(e, ITEMS[k])) throw new Refuse("locked", `Unlocks at Sitter Lv ${ITEMS[k].lv}`, 403, { lv: ITEMS[k].lv });
        spend(e, ITEMS[k].price);
      } else throw new Refuse("noitem", "You don't have that gift", 409);
    }));
  } catch (err) {
    await env.DB.prepare("DELETE FROM gifts WHERE pet = ? AND item = ? AND t = ? AND who = ?").bind(pet, k, now, who.who).run();
    throw err;
  }
  await env.DB.prepare("INSERT INTO visits (pet, t, who, a, code) VALUES (?, ?, ?, ?, ?)").bind(pet, now, who.who, "gift", k).run();
  return { ok: true, item: k, pet, gifts: await petGifts(env, pet), me: state(e, who.addr) };
}

async function equip(env, who, b, now) {
  const c = String(b.c ?? ""), bd = String(b.b ?? "");
  const { e } = await mutate(env, who, now, (e) => {
    if (b.c != null) {
      if (c && !(e.own.includes(c) && ITEMS[c].kind === "color")) throw new Refuse("bad", "You don't have that colour", 409);
      e.c = c;
    }
    if (b.b != null) {
      if (bd && !(e.own.includes(bd) && ITEMS[bd].kind === "badge")) throw new Refuse("bad", "You don't have that badge", 409);
      e.b = bd;
    }
  });
  return { ok: true, me: state(e, who.addr), style: styleStr(e) };
}

// the games of chance: each go is claimed from the network's pool first and handed back if it doesn't happen
async function onNet(env, who, now, f, msg, fn) {
  const back = await claimOne(env, who, now, f, msg);
  try {
    return await fn();
  } catch (err) {
    await back();
    throw err;
  }
}

async function pull(env, who, now) {
  const { e, res } = await onNet(env, who, now, "pulls", "This network's machine is empty for today", () =>
    mutate(env, who, now, (e) => {
      const d = e.d;
      if (d.pulls >= PULLS_PER_DAY) throw new Refuse("cap", "The machine is empty for today", 409, { ends: (d.day + 1) * 86400 });
      spend(e, CAPSULE);
      d.pulls++;
      const charm = e.inv.charm > 0;
      if (charm) e.inv.charm--;
      const r = rollCapsule(rnd, charm);
      const res = { ...r, charm, dup: false, refund: 0 };
      if (r.candles) earn(e, r.candles, "Capsule", []);
      else {
        const it = ITEMS[r.item];
        if (it.kind === "color" || it.kind === "badge") {
          if (e.own.includes(r.item)) {
            res.dup = true;
            res.refund = Math.floor(it.price * DUP_REFUND);
            earn(e, res.refund, "Duplicate", []);
          } else {
            e.own.push(r.item);
            if (it.kind === "color" && !e.c) e.c = r.item;
            if (it.kind === "badge" && !e.b) e.b = r.item;
          }
        } else addItem(e, r.item, r.n);
      }
      return { res };
    }),
  );
  return { ok: true, ...res, me: state(e, who.addr), style: styleStr(e) };
}

async function bet(env, who, b, now) {
  const amt = Number(b.amt);
  const dir = b.dir === "up" ? "up" : b.dir === "down" ? "down" : null;
  if (!BET.sizes.includes(amt) || !dir) throw new Refuse("bad", "Pick a bet and a side", 400);
  const { e, res } = await onNet(env, who, now, "bets", "That's all the bets for this network today", () =>
    mutate(env, who, now, (e) => {
      const d = e.d;
      const ends = (d.day + 1) * 86400;
      if (d.bets >= BET.perDay) throw new Refuse("cap", "That's all the bets for today", 409, { ends });
      if (Math.max(0, -d.net) + amt > BET.lossCap) throw new Refuse("cap", "Today's loss limit is reached", 409, { ends });
      if (d.net >= BET.winCap) throw new Refuse("cap", `You're up ${d.net} today. The table is closed till tomorrow`, 409, { ends });
      // no overshoot: a win may take today's net up to the cap, never past it
      if (d.net + payout(amt) - amt > BET.winCap) {
        const fits = BET.sizes.some((s) => d.net + payout(s) - s <= BET.winCap);
        throw new Refuse("cap", fits ? `A win would go past +${BET.winCap} today. Try a smaller bet` : `You're up ${d.net} today. The table is closed till tomorrow`, 409, { ends });
      }
      spend(e, amt);
      d.bets++;
      const up = rnd() < 0.5;
      const win = (dir === "up") === up;
      const pay = win ? payout(amt) : 0;
      if (pay) earn(e, pay, "Green or Red", []);
      d.net += pay - amt;
      e.ws = win ? (e.ws || 0) + 1 : 0;
      // the size of the move only decides how the candle looks
      return { res: { up, win, pay, amt, dir, move: 1 + Math.floor(rnd() * 6), ws: e.ws } };
    }),
  );
  return { ok: true, ...res, me: state(e, who.addr) };
}

async function spin(env, who, now) {
  const ends = (dayOf(now) + 1) * 86400;
  // your own spin first (so a second try doesn't use up the network's), then the network's one a day
  const pre = (await read(env, who.key, now)).e;
  if (pre.d.wheel) throw new Refuse("cap", "One spin a day. Come back tomorrow", 409, { ends });
  const { e, res } = await onNet(env, who, now, "wheel", "Someone on this network already spun today", () =>
    mutate(env, who, now, (e) => {
      if (e.d.wheel) throw new Refuse("cap", "One spin a day. Come back tomorrow", 409, { ends });
      e.d.wheel = 1;
      const i = rollWheel(rnd);
      const s = WHEEL[i];
      if (s.candles) earn(e, s.candles, "Wheel", []);
      else addItem(e, s.item, 1);
      return { res: { i, candles: s.candles || 0, item: s.item || null } };
    }),
  );
  return { ok: true, ...res, me: state(e, who.addr) };
}

// A signed-in visitor brings this browser's anonymous sitter along: Candles, bag, name styles, XP and bonds.
// Once: the anon wallet is emptied first (versioned), so two tabs can't both bring it. Today's counters are
// added to the wallet's (capped), so what the anon earned today still counts against today's caps.
// A browser goes to one wallet only, and a wallet takes at most MERGE_MAX browsers (no funnelling).
const MERGE_MAX = 3;
const DAYCAP = { careC: EARN.careCap, catchC: EARN.catchCap, stkC: EARN.stickerCap, bets: BET.perDay, pulls: PULLS_PER_DAY, xp: XP.dayCap };
async function merge(env, who, b, now) {
  if (!who.addr) throw new Refuse("signin", "Sign in first", 401);
  const anon = String(b.anon || "");
  if (!/^[a-z0-9]{8,40}$/.test(anon)) throw new Refuse("bad", "Nothing to bring", 400);
  const akey = "anon:" + anon;
  const row = await env.DB.prepare("SELECT bal, s, style, ver FROM econ WHERE actor = ?").bind(akey).first();
  if (!row) throw new Refuse("empty", "Nothing to bring", 409);
  const src = JSON.parse(row.s);
  if (src.merged && src.merged !== who.addr) throw new Refuse("taken", "This browser already went to another wallet", 409);
  const inv = src.inv || {};
  const own = (src.own || []).filter((k) => ITEMS[k]);
  const xp = Math.max(0, Math.floor(src.xp || 0));
  if (!(row.bal > 0) && !Object.values(inv).some((n) => n > 0) && !own.length && !xp) throw new Refuse("empty", "Nothing to bring", 409);
  const mine = (await read(env, who.key, now)).e;
  if (!(mine.mfrom || []).includes(anon) && (mine.mfrom || []).length >= MERGE_MAX) throw new Refuse("limit", `This wallet already took ${MERGE_MAX} browsers along`, 409);
  // today's counters stay on the anon too: signing out again doesn't reset them
  const emptied = JSON.stringify({ ...src, inv: {}, own: [], c: "", b: "", xp: 0, merged: who.addr });
  const r = await env.DB.prepare("UPDATE econ SET bal = 0, s = ?2, style = '', ver = ver + 1, updated = ?3 WHERE actor = ?1 AND ver = ?4").bind(akey, emptied, now, row.ver).run();
  if (!(r.meta && r.meta.changes > 0)) throw new Refuse("busy", "Busy, try again", 503);
  const sd = src.d || {};
  let e;
  try {
  ({ e } = await mutate(env, who, now, (e) => {
    // checked again here: two browsers merging at once must not both squeeze under the limit
    if (!e.mfrom.includes(anon) && e.mfrom.length >= MERGE_MAX) throw new Refuse("limit", `This wallet already took ${MERGE_MAX} browsers along`, 409);
    e.bal += row.bal + Math.max(0, Math.floor(inv.rush || 0)) * RUSH_REFUND; // an old Rush pass comes over as Candles
    for (const [k, n] of Object.entries(inv)) if (ITEMS[k] && n > 0) addItem(e, k, n);
    for (const k of own) if (!e.own.includes(k)) e.own.push(k);
    e.xp = (e.xp || 0) + xp;
    if (!e.mfrom.includes(anon)) e.mfrom.push(anon);
    if (sd.day === e.d.day) {
      const d = e.d;
      for (const [k, cap] of Object.entries(DAYCAP)) d[k] = Math.min(cap, (d[k] || 0) + (sd[k] || 0));
      d.acts = (d.acts || 0) + (sd.acts || 0);
      d.net = (d.net || 0) + (sd.net || 0);
      d.best = Math.max(d.best || 0, sd.best || 0);
      d.first = d.first || sd.first ? 1 : 0;
      d.wheel = d.wheel || sd.wheel ? 1 : 0;
      d.bty = [...new Set([...(d.bty || []), ...(sd.bty || [])])];
      d.pets = [...new Set([...(d.pets || []), ...(sd.pets || [])])].slice(0, 60);
    }
    // a streak from either side carries on
    if (src.st && (!e.st || src.st.d > e.st.d || (src.st.d === e.st.d && src.st.n > e.st.n))) e.st = { ...src.st };
  }));
  } catch (err) {
    // the wallet didn't take it: put the browser's wallet back as it was
    await env.DB.prepare("UPDATE econ SET bal = ?2, s = ?3, style = ?4, ver = ver + 1, updated = ?5 WHERE actor = ?1").bind(akey, row.bal, row.s, row.style || "", now).run();
    throw err;
  }
  // bonds move too (added up per Chog; today's action counts too, so the diminishing returns carry over)
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO bond (pet, actor, xp, day, n) SELECT pet, ?2, xp, day, n FROM bond WHERE actor = ?1 ON CONFLICT(pet, actor) DO UPDATE SET xp = xp + excluded.xp, n = CASE WHEN excluded.day = day THEN n + excluded.n WHEN excluded.day > day THEN excluded.n ELSE n END, day = max(day, excluded.day)",
    ).bind(akey, who.key),
    env.DB.prepare("DELETE FROM bond WHERE actor = ?").bind(akey),
  ]);
  return { ok: true, moved: row.bal, xp, me: state(e, who.addr), style: styleStr(e) };
}

// local testing only (DEV=1): grant Candles, reset the day, or roll the machines many times without paying
async function dev(env, who, b, now) {
  if (b.sim) {
    const n = Math.min(200000, Number(b.sim) || 1000);
    const tiers = Object.fromEntries(TIERS.map((t) => [t.k, 0]));
    const charmTiers = { ...tiers };
    const wheel = WHEEL.map(() => 0);
    let candles = 0, up = 0, wheelCandles = 0;
    for (let i = 0; i < n; i++) {
      const r = rollCapsule(rnd);
      tiers[r.tier]++;
      candles += r.candles;
      charmTiers[rollCapsule(rnd, true).tier]++;
      const w = rollWheel(rnd);
      wheel[w]++;
      wheelCandles += WHEEL[w].candles || 0;
      if (rnd() < 0.5) up++;
    }
    return { ok: true, n, tiers, charmTiers, wheel, capsuleCandles: candles / n, wheelCandles: wheelCandles / n, up: up / n };
  }
  if (b.clearGifts) await env.DB.prepare("DELETE FROM gifts WHERE pet = ?").bind(Number(b.clearGifts)).run();
  // set what this network has used today, e.g. { care: 59 }
  if (b.pool) for (const [f, n] of Object.entries(b.pool)) if (POOL[f] != null) await env.DB.prepare("INSERT INTO pool (k, day, f, n, g) VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT(k, day, f) DO UPDATE SET n = ?4").bind(who.ipk, dayOf(now), f, Math.max(0, n | 0)).run();
  const { e } = await mutate(env, who, now, (e) => {
    if (b.grant) e.bal += Math.max(-e.bal, Math.floor(Number(b.grant) || 0));
    if (b.xp != null) e.xp = Math.max(0, Math.floor(Number(b.xp) || 0));
    if (b.reset) (e.d = { day: 0 }), rollDay(e, now);
    if (b.day) for (const k of DAYKEYS) if (k in b.day) e.d[k] = Number(b.day[k]) || 0;
    if (b.streak) e.st = { d: e.d.day - 1, n: Math.max(1, b.streak | 0) };
    if (b.items) for (const [k, n] of Object.entries(b.items)) if (ITEMS[k]) e.inv[k] = Math.max(0, Math.min(MAX_STACK, n | 0));
    if (b.rush != null) e.inv.rush = Math.max(0, b.rush | 0); // an old Rush pass in the bag (to test the refund)
  });
  return { ok: true, me: state(e, who.addr) };
}
