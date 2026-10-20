// Chog Pet: the life simulation. Pure functions, shared by the browser (to animate between server answers)
// and the worker (which is the only one allowed to write). Time is unix seconds. Stats run 0..100.
//
// A pet gets hungry, bored, tired and dirty on its own. It sleeps on a schedule set by its traits (or naps
// when it runs out of energy). Meals turn into poop a while later. Starve it for a day and a half and it
// wanders off looking for snacks; any meal brings it back. Nothing ever dies.

export const STEP = 600; // simulate in 10-minute steps
export const AWAY_AFTER = 36 * 3600;
export const COOLDOWN = { feed: 120, play: 45, clean: 60, lights: 20, love: 12 };
export const DIGEST = 20 * 60; // a meal turns into poop 20 min later
export const SCORE_CAP = 160; // the most a 20 s round of Candle Catch can plausibly score (degen coins, x2 combo, the final rally)
export const GAME_LEN = 20;

/** How long it has lived in this home, as a stage name. */
export const STAGES = [
  [0, "New home"],
  [7, "Settled in"],
  [30, "Family"],
  [90, "Old friend"],
  [180, "Lifer"],
];
export function stageOf(days) {
  let i = 0;
  while (i + 1 < STAGES.length && days >= STAGES[i + 1][0]) i++;
  return { i, name: STAGES[i][1], next: STAGES[i + 1] ? STAGES[i + 1][0] : null };
}

export const FOODS = {
  rice: { name: "Rice ball", food: 30, fun: 2, clean: 0 },
  candy: { name: "Candy", food: 10, fun: 15, clean: -4 },
  chog: { name: "$CHOG treat", food: 34, fun: 30, clean: 0, holder: true },
  ramen: { name: "Ramen", food: 42, fun: 8, clean: -2 },
  gum: { name: "Bubblegum", food: 14, fun: 22, clean: 0 },
  sushi: { name: "Sushi", food: 34, fun: 10, clean: 0 },
  moncookie: { name: "Mon cookie", food: 26, fun: 16, clean: -1 },
  cake: { name: "Strawberry cake", food: 28, fun: 18, clean: -3 },
  banana: { name: "Banana", food: 30, fun: 10, clean: 0 },
  chili: { name: "Hot chili", food: 24, fun: 20, clean: 0 },
  fly: { name: "Crunchy fly", food: 28, fun: 14, clean: -2 },
  // shop snacks (bought with Candles, see econ.js): only in the menu while you have one
  boba: { name: "Purple Boba", food: 20, fun: 35, energy: 15, clean: 0, shop: true },
  mochi: { name: "Monad Mochi", food: 30, fun: 30, clean: 0, shop: true },
  goldramen: { name: "Golden Ramen", food: 60, fun: 20, clean: 0, shop: true },
  candlecake: { name: "Candle Cake", food: 40, fun: 45, energy: 10, clean: -2, shop: true },
};

const clamp = (v) => Math.max(0, Math.min(100, v));
function clampAll(s) {
  s.food = clamp(s.food);
  s.fun = clamp(s.fun);
  s.energy = clamp(s.energy);
  s.clean = clamp(s.clean);
}

export function fresh(t) {
  return { food: 64, fun: 60, energy: 78, clean: 80, poop: 0, digest: 0, nap: 0, awake: 0, starve: 0, away: false, asleep: false, t };
}

/** A Chog nobody has visited yet: it has been alone a while, so the first visitor gets to rescue it. */
export function lonely(id, t) {
  const r = (k) => ((id * 2654435761 + k * 40503) >>> 0) % 1000 / 1000;
  return { ...fresh(t), food: 6 + r(1) * 22, fun: 16 + r(2) * 18, energy: 46 + r(3) * 30, clean: 30 + r(4) * 22, poop: 1 + (r(5) > 0.55 ? 1 : 0) };
}

/** Is it inside this pet's bedtime window (UTC hours) at `ts`? */
export function bedtime(p, ts) {
  const d = new Date(ts * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const [b, w] = p.sleep;
  return b > w ? h >= b || h < w : h >= b && h < w;
}

function sleepingAt(s, p, t) {
  return s.nap > t || (bedtime(p, t) && s.awake <= t);
}

/** Run the pet forward to `now`. Never mutates its input. */
export function advance(s0, p, now) {
  const s = { ...s0 };
  if (!(now > s.t)) {
    s.asleep = !s.away && sleepingAt(s, p, Math.max(now, s.t));
    return s;
  }
  let t = Math.max(s.t, now - 7 * 86400);
  const m = p.m;
  while (t < now) {
    const dt = Math.min(STEP, now - t);
    const h = dt / 3600;
    t += dt;
    if (s.away) continue; // out at the door: time stands still for it
    const asleep = sleepingAt(s, p, t);
    s.food -= 5.4 * m.food * h * (asleep ? 0.45 : 1);
    s.fun -= 4.8 * m.fun * h * (asleep ? 0.15 : 1);
    s.energy += asleep ? 13 * h : -4.2 * m.energy * h;
    s.clean -= (2.2 + 3.5 * s.poop) * m.clean * h;
    if (s.digest > 0) {
      s.digest -= dt;
      if (s.digest <= 0) {
        s.digest = 0;
        if (s.poop < 3 && !p.ghost) s.poop++;
      }
    }
    clampAll(s);
    if (!asleep && s.energy <= 0) s.nap = t + 3 * 3600; // passes out
    if (s.nap > t && s.energy >= 100 && !bedtime(p, t)) s.nap = 0; // slept enough
    s.starve = s.food <= 0 ? s.starve + dt : 0;
    if (s.starve >= AWAY_AFTER) s.away = true;
  }
  s.t = now;
  s.asleep = !s.away && sleepingAt(s, p, now);
  return s;
}

export function mood(s) {
  if (s.away) return "away";
  if (s.asleep) return "asleep";
  const low = Math.min(s.food, s.fun, s.energy, s.clean);
  if (low < 12) return "miserable";
  if (s.food < 30) return "hungry";
  if (s.clean < 30 || s.poop >= 2) return "stinky";
  if (s.energy < 22) return "sleepy";
  if (s.fun < 30) return "bored";
  if ((s.food + s.fun + s.energy + s.clean) / 4 >= 76) return "happy";
  return "content";
}

export function wellbeing(s) {
  if (s.away) return 0;
  return Math.round((s.food + s.fun + s.energy + s.clean) / 4 - s.poop * 4);
}

/** Foods this pet can be offered. The $CHOG treat only when the carer holds $CHOG. `owned`: shop snacks you have. */
export function menu(p, owned) {
  const base = ["rice", "candy", p.fav, "chog"];
  return owned ? base.concat(owned.filter((k) => FOODS[k] && FOODS[k].shop && !base.includes(k))) : base;
}

/**
 * Apply one action at `now`. Returns { s, r } where r = { ok, code, ... } describes what happened (for the
 * animation and the speech bubble). A refusal can still change the state (overfeeding annoys it).
 */
export function act(s0, p, action, opt, now) {
  const s = advance(s0, p, now);
  const r = { ok: true, code: action };
  const fail = (code) => {
    clampAll(s);
    return { s, r: { ok: false, code } };
  };
  if (s.away && action !== "feed") return fail("away");
  // food or a game wakes it up, a bit grumpy (better than a pet that just says zzz to a visitor).
  // Called only once the action is sure to go ahead: a refusal must never disturb its sleep.
  const wake = () => {
    if (!s.asleep) return;
    s.nap = 0;
    s.awake = now + 2 * 3600;
    s.fun -= 4;
    s.asleep = false;
    r.woke = true;
  };

  switch (action) {
    case "feed": {
      const item = opt && opt.item;
      const f = FOODS[item];
      // a shop snack needs one in your bag (the worker checks and takes it; opt.owned is set by the worker)
      if (!f || !(menu(p).includes(item) || (f.shop && opt && opt.owned))) return fail("bad");
      if (f.holder && !(opt && opt.holder)) return fail("holder");
      if (s.away) {
        s.away = false;
        s.starve = 0;
        s.food = 46;
        s.fun = Math.max(s.fun, 40);
        s.energy = Math.max(s.energy, 45);
        s.awake = now + 3600;
        r.code = "return";
        break;
      }
      if (s.food >= 92) {
        if (!s.asleep) s.fun -= 2;
        return fail("full");
      }
      wake();
      let food = f.food;
      let fun = f.fun;
      r.code = "eat";
      if (item === p.fav) {
        food *= 1.25;
        fun += 10;
        r.code = "fav";
      }
      if (item === "candy" && p.picky) {
        fun = -6;
        r.code = "yuck";
      }
      if (item === "chog") r.code = "treat";
      s.food += food;
      s.fun += fun;
      s.clean += f.clean;
      if (f.energy) s.energy += f.energy;
      if (f.shop) r.special = item;
      if (!s.digest && !p.ghost) s.digest = DIGEST;
      r.item = item;
      break;
    }
    case "play": {
      if (s.energy < 12) return fail("tired");
      wake();
      const score = Math.max(0, Math.min(SCORE_CAP, Math.round(Number(opt && opt.score) || 0)));
      s.fun += Math.min(60, 8 + score * 0.8) * p.m.play;
      s.energy -= 12;
      s.food -= 6;
      s.clean -= 7;
      r.score = score;
      break;
    }
    case "clean": {
      if (s.clean >= 95 && !s.poop) return fail("spotless");
      const was = s.poop;
      s.clean = 100;
      s.poop = 0;
      if (!s.asleep) s.fun += p.bath;
      r.code = s.asleep ? "clean" : p.bath >= 8 ? "bathlove" : p.bath < 0 ? "bathhate" : "clean";
      r.poop = was;
      break;
    }
    case "lights": {
      if (s.asleep) {
        s.nap = 0;
        if (s.energy >= 90) {
          s.awake = now + 2 * 3600;
          r.code = "wake";
        } else {
          s.awake = now + 5400;
          s.fun -= 10;
          r.code = "grumpy";
        }
      } else {
        if (s.energy >= 75 && !bedtime(p, now)) return fail("notsleepy");
        s.nap = now + Math.max(1, (100 - s.energy) / 13) * 3600;
        s.awake = 0;
        r.code = "nap";
      }
      break;
    }
    case "love": {
      if (s.asleep) {
        s.fun += 1;
        r.code = "purr";
      } else {
        s.fun += 5 * p.m.love;
        r.code = "love";
      }
      break;
    }
    default:
      return fail("bad");
  }
  clampAll(s);
  s.asleep = !s.away && sleepingAt(s, p, now);
  return { s, r };
}
