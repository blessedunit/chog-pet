// Stickers and the care flame. Shared by the worker (which awards them) and the page (which shows them).
// Stickers belong to the Chog, not to a wallet: they stay when it moves house, like a scrapbook it carries.
// The flame counts days in a row that somebody (anybody) looked after it: babysitters keep it alive too.
// `pay`: the Candle bounty for the sitter whose action earned the sticker (see econ.js, capped per day).

export const STICKERS = [
  { k: "meal", name: "First meal", how: "Feed it once", icon: "rice", pay: 3 },
  { k: "fav", name: "Favourite dish", how: "Feed it the food it loves", icon: "heart", pay: 10 },
  { k: "rescue", name: "Rescued", how: "Feed it when it's sad", icon: "life", pay: 15 },
  { k: "bath", name: "Squeaky clean", how: "Give it a bath", icon: "bubble", pay: 3 },
  { k: "nap", name: "Tucked in", how: "Put it to bed", icon: "i_lights", pay: 3 },
  { k: "catch", name: "Candle catcher", how: "Score 15+ in Candle Catch", icon: "gcandle", pay: 8 },
  { k: "pro", name: "Candle pro", how: "Score 40+ in Candle Catch", icon: "coin", pay: 20 },
  { k: "flame3", name: "3-day flame", how: "Cared for 3 days in a row", icon: "flame", pay: 15 },
  { k: "flame7", name: "7-day flame", how: "Cared for 7 days in a row", icon: "flame", pay: 30 },
  { k: "loved", name: "Well loved", how: "50 visits from sitters", icon: "heartS", pay: 25 },
  { k: "named", name: "Has a name", how: "Its holder named it", icon: "note2", pay: 10 },
  { k: "treat", name: "$CHOG treat", how: "A $CHOG holder gave it a treat", icon: "chog", pay: 10 },
  // the day Chogtown reaches its goal, every Chog cared for that day gets this one (a sticker only: no Candles)
  { k: "festival", name: "Festival day", how: "Cared for on a day Chogtown hit its goal", icon: "sparkle", pay: 0 },
];

export const dayOf = (t) => Math.floor(t / 86400); // UTC days

/** The flame as shown right now: it stays lit through the day after the last care, then goes out. */
export function flameOf(meta, now) {
  const f = meta && meta.flame;
  if (!f || !f.n) return { n: 0, best: (f && f.best) || 0, today: false };
  const d = dayOf(now);
  const alive = f.d >= d - 1;
  return { n: alive ? f.n : 0, best: f.best || f.n, today: f.d === d };
}

/**
 * Update the flame and stickers after an action that went ahead. Mutates meta; returns the new sticker keys.
 * ev: { a: action, code: result code, score, was: mood before, now, fest: a festival day (the town hit its goal) }
 */
export function award(meta, ev) {
  const got = new Set(meta.stickers || []);
  const add = [];
  const give = (k) => !got.has(k) && (got.add(k), add.push(k));
  if (["feed", "play", "clean", "lights"].includes(ev.a)) {
    const d = dayOf(ev.now);
    const f = meta.flame || { n: 0, d: 0, best: 0 };
    if (f.d !== d) {
      f.n = f.d === d - 1 ? f.n + 1 : 1;
      f.d = d;
      f.best = Math.max(f.best || 0, f.n);
    }
    meta.flame = f;
    if (f.n >= 3) give("flame3");
    if (f.n >= 7) give("flame7");
  }
  if (ev.a === "feed") {
    give("meal");
    if (ev.code === "fav") give("fav");
    if (ev.code === "treat") give("treat");
    if (ev.was === "miserable") give("rescue");
  }
  if (ev.a === "clean") give("bath");
  if (ev.a === "lights" && ev.code === "nap") give("nap");
  if (ev.a === "play" && ev.score >= 15) give("catch");
  if (ev.a === "play" && ev.score >= 40) give("pro");
  if (ev.a === "name" && ev.code) give("named");
  if ((meta.care || 0) >= 50) give("loved");
  if (ev.fest) give("festival");
  meta.stickers = STICKERS.map((s) => s.k).filter((k) => got.has(k));
  return add;
}
