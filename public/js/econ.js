// Chog Pet economy: the catalog and the rules, shared by the worker (which is the only one that moves Candles)
// and the page (which shows prices and odds). Pure data + pure functions, no DOM, no network.
//
// Candles are a game currency and nothing else: they can't be bought, sold, sent to anyone or cashed out, and
// they're worth nothing outside the game. Everything here is earned by playing and caring, and capped per UTC day.

export const DAY = 86400;
export const dayOf = (t) => Math.floor(t / DAY);

// ---------- earning ----------
export const EARN = {
  care: 2, // feed / bath / lights that went ahead
  careCap: 40, // a day
  catchDiv: 4, // Candle Catch: floor(score / 4)
  catchRound: 25, // most one round can pay (before a x2 ticket)
  catchCap: 100, // a day (a x2 ticket doubles on top of it)
  first: 5, // first care of the day, +1 for each day of the streak (up to +5)
  firstStreakMax: 5,
  stickerCap: 45, // sticker bounties a day
};

// daily bounties, checked by the worker from its own counters (no claim button: they pay the moment they're done)
export const BOUNTIES = [
  { k: "care", t: "Do 6 care actions", n: 6, pay: 10, ic: "flame" },
  { k: "help", t: "Help 3 different Chogs", n: 3, pay: 10, ic: "heart" },
  { k: "catch", t: "Score 20+ in Candle Catch", n: 20, pay: 10, ic: "gcandle" },
];
export const BOUNTY_ALL = 15;

// ---------- the shop ----------
// lv: the Sitter level that unlocks buying it (a capsule or the wheel can still hand it out earlier)
// kind: food (consumable, unlocks in the Feed menu) · gift (placed in a Chog's room, everyone sees it) ·
// boost (consumable) · color / badge (how your name looks in visitor logs and chat)
export const ITEMS = {
  boba: { kind: "food", lv: 1, name: "Purple Boba", price: 15, fx: "+35 fun +15 energy" },
  mochi: { kind: "food", lv: 2, name: "Monad Mochi", price: 20, fx: "+30 food +30 fun" },
  goldramen: { kind: "food", lv: 4, name: "Golden Ramen", price: 30, fx: "+60 food +20 fun" },
  candlecake: { kind: "food", lv: 6, name: "Candle Cake", price: 45, fx: "+40 food +45 fun" },

  poster: { kind: "gift", lv: 1, name: "Monad poster", price: 50 },
  plush: { kind: "gift", lv: 2, name: "Chog plushie", price: 60 },
  lights: { kind: "gift", lv: 3, name: "Fairy lights", price: 70 },
  lamp: { kind: "gift", lv: 5, name: "Lava lamp", price: 80 },
  aquarium: { kind: "gift", lv: 7, name: "Aquarium", price: 120 },
  cushion: { kind: "gift", lv: 9, name: "Crown cushion", price: 150 },
  disco: { kind: "gift", lv: 12, name: "Disco ball", price: 200 },

  x2: { kind: "boost", lv: 3, name: "x2 ticket", price: 25, fx: "Next Candle Catch pays double" },
  charm: { kind: "boost", lv: 5, name: "Lucky charm", price: 40, fx: "Next capsule is Rare or better" },

  c_pink: { kind: "color", lv: 2, name: "Pink name", price: 80, hex: "#ff8ee4" },
  c_cyan: { kind: "color", lv: 2, name: "Cyan name", price: 80, hex: "#85e6ff" },
  c_orange: { kind: "color", lv: 4, name: "Orange name", price: 80, hex: "#ffae45" },
  c_violet: { kind: "color", lv: 6, name: "Violet name", price: 80, hex: "#a68bff" },
  c_gold: { kind: "color", lv: 10, name: "Gold name", price: 200, hex: "#ffd84d" },

  b_star: { kind: "badge", lv: 3, name: "Star badge", price: 60 },
  b_heart: { kind: "badge", lv: 3, name: "Heart badge", price: 60 },
  b_flame: { kind: "badge", lv: 8, name: "Flame badge", price: 100 },
  b_crown: { kind: "badge", lv: 15, name: "Crown badge", price: 250 },
};
export const GIFTS = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === "gift");
export const MAX_STACK = 99;

// ---------- capsule machine ----------
export const CAPSULE = 25;
export const PULLS_PER_DAY = 20;
export const TIERS = [
  { k: "common", name: "Common", p: 0.6, col: "#ddd7fe" },
  { k: "rare", name: "Rare", p: 0.28, col: "#85e6ff" },
  { k: "epic", name: "Epic", p: 0.1, col: "#ff8ee4" },
  { k: "legendary", name: "Legendary", p: 0.02, col: "#ffd84d" },
];
// each entry: [item or "candles", amount]; one entry of the tier is picked evenly
export const POOLS = {
  common: [["boba", 1], ["mochi", 1], ["candles", 8], ["candles", 12]],
  rare: [["goldramen", 1], ["x2", 1], ["boba", 2], ["candles", 30]],
  epic: [["poster", 1], ["plush", 1], ["lights", 1], ["lamp", 1], ["color", 1], ["badge", 1], ["candles", 60]],
  legendary: [["aquarium", 1], ["cushion", 1], ["disco", 1], ["c_gold", 1], ["b_crown", 1], ["candlecake", 3], ["candles", 150]],
};
// "color" / "badge" in a pool means one of the cheaper ones at random
export const POOL_COLORS = ["c_pink", "c_cyan", "c_orange", "c_violet"];
export const POOL_BADGES = ["b_star", "b_heart", "b_flame"];
export const DUP_REFUND = 0.5; // a name colour or badge you already own turns into half its price

/** Roll one capsule. rnd() -> [0,1). charm = Rare or better. Returns { tier, item, n, candles }. */
export function rollCapsule(rnd, charm = false) {
  let tiers = TIERS;
  if (charm) {
    const rest = TIERS.slice(1);
    const sum = rest.reduce((t, x) => t + x.p, 0);
    tiers = rest.map((x) => ({ ...x, p: x.p / sum }));
  }
  let r = rnd(), tier = tiers[tiers.length - 1];
  for (const t of tiers) {
    if (r < t.p) {
      tier = t;
      break;
    }
    r -= t.p;
  }
  const pool = POOLS[tier.k];
  let [item, n] = pool[Math.floor(rnd() * pool.length)];
  if (item === "color") item = POOL_COLORS[Math.floor(rnd() * POOL_COLORS.length)];
  if (item === "badge") item = POOL_BADGES[Math.floor(rnd() * POOL_BADGES.length)];
  return item === "candles" ? { tier: tier.k, item: null, n: 0, candles: n } : { tier: tier.k, item, n, candles: 0 };
}

// ---------- Green or Red (internally "bet") ----------
// EV of a bet = 0.5 x 1.9 = 0.95: on average every bet loses 5%. Win cap: a bet whose win would take you past +150
// today is refused (so the day never ends above it), and at +150 the table closes.
export const BET = { sizes: [10, 20, 50], pay: 1.9, perDay: 30, lossCap: 150, winCap: 150 };
export const payout = (amt) => Math.floor(amt * BET.pay);

// ---------- daily wheel (free, once per UTC day) ----------
export const WHEEL = [
  { w: 20, candles: 5, col: "#2b2152" },
  { w: 20, candles: 10, col: "#6e54ff" },
  { w: 15, candles: 15, col: "#2b2152" },
  { w: 15, candles: 20, col: "#85e6ff" },
  { w: 10, candles: 30, col: "#2b2152" },
  { w: 10, item: "mochi", col: "#ff8ee4" },
  { w: 7, item: "x2", col: "#2b2152" },
  { w: 3, candles: 100, col: "#ffd84d" },
];
export function rollWheel(rnd) {
  const tot = WHEEL.reduce((t, s) => t + s.w, 0);
  let r = rnd() * tot;
  for (let i = 0; i < WHEEL.length; i++) {
    if (r < WHEEL[i].w) return i;
    r -= WHEEL[i].w;
  }
  return WHEEL.length - 1;
}

/** How a sitter's name looks: { c: hex or "", b: badge key or "" } from the stored "c_pink|b_star" string. */
export function styleOf(s) {
  const [c, b] = String(s || "").split("|");
  return { c: ITEMS[c] && ITEMS[c].kind === "color" ? ITEMS[c].hex : "", b: ITEMS[b] && ITEMS[b].kind === "badge" ? b : "" };
}

// ---------- progression: Sitter level (you) + bond (you and one Chog) + growth (one Chog, everyone) ----------
// XP only comes from care that went ahead (feed, bath, lights, Candle Catch), never from the games of chance.
// The same Chog pays less each time on the same day, so helping many Chogs beats farming one.
export const XP = {
  act: { feed: 12, clean: 10, lights: 6, play: 10 },
  chog: [1, 1, 0.6, 0.6, 0.3, 0.3], // nth XP action on the same Chog today (7th and later: 0)
  playDiv: 10, // Candle Catch: + score / 10 ...
  playMax: 8, // ... up to +8
  first: 20, // first care of the day ...
  streakStep: 5, // ... +5 for each day of the streak ...
  streakMax: 6, // ... up to +30 (a week in a row)
  bounty: 20, // each daily bounty
  all: 30, // all three
  dayCap: 400, // a UTC day
  home: 1.5, // the holder caring for its own Chog: x1.5 on the action's XP (still under the caps above)
};
export const MAX_LV = 30;
/** Total XP to reach level L: 100 for Lv 2, then each level asks 40 more than the last. */
export const xpFor = (L) => (L - 1) * (60 + 20 * L);
export function levelOf(xp) {
  xp = Math.max(0, xp || 0);
  let lv = 1;
  while (lv < MAX_LV && xp >= xpFor(lv + 1)) lv++;
  const max = lv >= MAX_LV;
  return { lv, xp, cur: xp - xpFor(lv), need: max ? 0 : xpFor(lv + 1) - xpFor(lv), max };
}
// the frame around your level badge
export const FRAMES = [
  { lv: 1, k: "bronze", name: "Bronze frame", col: "#d08a4e" },
  { lv: 5, k: "silver", name: "Silver frame", col: "#cfd8ea" },
  { lv: 10, k: "gold", name: "Gold frame", col: "#ffd84d" },
  { lv: 15, k: "neon", name: "Neon frame", col: "#85e6ff" },
  { lv: 20, k: "cosmic", name: "Cosmic frame", col: "#ff8ee4" },
  { lv: 30, k: "monad", name: "Monad frame", col: "#a68bff" },
];
export const frameOf = (lv) => FRAMES.filter((f) => f.lv <= lv).pop();
/** What each level unlocks: [{ lv, items: [...], frame }] for levels 2..MAX_LV that unlock something. */
export function unlocks() {
  const out = [];
  for (let L = 2; L <= MAX_LV; L++) {
    const items = Object.keys(ITEMS).filter((k) => ITEMS[k].lv === L);
    const frame = FRAMES.find((f) => f.lv === L);
    if (items.length || frame) out.push({ lv: L, items, frame: frame || null });
  }
  return out;
}
// bond: hearts you earn with one Chog (XP from your care on it); 0 = just met
export const BOND = [10, 40, 90, 160, 250, 360, 500, 680, 900, 1200];
export function bondOf(xp) {
  xp = Math.max(0, xp || 0);
  let lv = 0;
  while (lv < BOND.length && xp >= BOND[lv]) lv++;
  const from = lv ? BOND[lv - 1] : 0;
  return { lv, xp, cur: xp - from, need: lv >= BOND.length ? 0 : BOND[lv] - from, max: lv >= BOND.length };
}
// the Chog's bond with its home: what its holder's hearts with it add up to (shown on its card and link preview).
// Not the stages (New home, Family, ...): those count days at home, this counts care.
export const HOME_TIERS = [
  { lv: 2, name: "Friend" },
  { lv: 5, name: "Best friend" },
  { lv: 9, name: "Soulmate" },
];
export const homeTierOf = (xp) => {
  const t = HOME_TIERS.filter((x) => bondOf(xp).lv >= x.lv).pop();
  return t ? t.name : "";
};
// growth: a Chog's level from everyone's care XP on it
export const GROW_MAX = 50;
export const growFor = (L) => 25 * L * (L - 1);
export function growOf(xp) {
  xp = Math.max(0, xp || 0);
  let lv = 1;
  while (lv < GROW_MAX && xp >= growFor(lv + 1)) lv++;
  return { lv, xp, cur: xp - growFor(lv), need: lv >= GROW_MAX ? 0 : growFor(lv + 1) - growFor(lv) };
}

// ---------- one network, shared caps ----------
// New anonymous sitters are free to make, so what a day can pay is also capped per network (a salted hash of the
// IP, never the IP itself). 1.5x one person's cap leaves room for two people at home; a third sitter gets nothing.
export const POOL = {
  care: 60, catch: 150, stk: 68, bty: 68, first: 2, xp: 600,
  wheel: 1, // the free wheel: once per network a day
  pulls: 30, bets: 45,
};
