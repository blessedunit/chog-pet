// Chog Pet: a Chog's personality, read straight from its NFT traits. Same code runs in the browser and in the
// worker, so the rules the player sees are the rules the server applies.
//
//   Mouth  -> what it is (Foodie, Degen, Worrier...) and what it loves to eat
//   Eyes   -> how it is (Sleepy, Gamer, Smug...) and how it plays, sleeps and takes love
//   Head / Body / Accessory -> favourite food, bath mood, bedtime
//   Form=Skull -> a ghost: barely gets dirty, floats.  Tier Rare+ -> sparkles.

export const KEYS = ["Background", "Aura", "Base", "Skin", "Side", "Body", "Mouth", "Eyes", "Head", "Accessory", "Form", "Tier", "Naked"];

const has = (v, ...words) => words.some((w) => v.toLowerCase().includes(w.toLowerCase()));

// what it is: [noun, food mod, fun mod, line flavour, default favourite]
function core(mouth) {
  if (has(mouth, "Drooling")) return { noun: "Foodie", food: 1.25, fun: 1, fav: "ramen", key: "foodie" };
  if (has(mouth, "Bubblegum")) return { noun: "Sweet Tooth", food: 1, fun: 1, fav: "gum", key: "sweet" };
  if (has(mouth, "Rainbow Puke")) return { noun: "Picky Eater", food: 0.9, fun: 1, fav: "sushi", key: "picky", picky: true };
  if (has(mouth, "Gold Tooth", "BTC Coin", "Mon coin")) return { noun: "Degen", food: 1, fun: 1.1, fav: "moncookie", key: "degen" };
  if (has(mouth, "Sad", "Worried") || mouth === "wo") return { noun: "Worrier", food: 1, fun: 1.3, fav: "cake", key: "worrier" };
  if (has(mouth, "smile")) return { noun: "Sunshine", food: 1, fun: 0.7, fav: "banana", key: "sunny" };
  return { noun: "Gremlin", food: 1.05, fun: 1.05, fav: "chili", key: "gremlin" };
}

// how it is: [adjective, mods]
function mind(eyes) {
  if (has(eyes, "Tired", "Closed")) return { adj: "Sleepy", energy: 1.4, play: 1, love: 1.2, key: "sleepy" };
  if (has(eyes, "laser", "visor", "VR", "3D")) return { adj: "Gamer", energy: 1.1, play: 1.4, love: 0.9, key: "gamer" };
  if (has(eyes, "Heart")) return { adj: "Romantic", energy: 1, play: 1, love: 2, key: "romantic" };
  if (has(eyes, "Dead", "Crying", "Tear", "Teary")) return { adj: "Dramatic", energy: 1, play: 1.1, love: 1.4, fun: 1.15, key: "drama" };
  if (has(eyes, "Side Eye", "Smirk", "MOG", "Thug", "Viper", "Glass")) return { adj: "Smug", energy: 0.9, play: 1.15, love: 0.7, key: "smug" };
  if (has(eyes, "Angry")) return { adj: "Grumpy", energy: 1, play: 1, love: 0.8, fun: 1.2, key: "grumpy" };
  if (has(eyes, "Retard", "XD", "Clown", "Frog", "Up", "Vertical")) return { adj: "Chaotic", energy: 1.2, play: 1.25, love: 1, key: "chaotic" };
  return { adj: "Chill", energy: 0.9, play: 1, love: 1, fun: 0.9, key: "chill" };
}

export const FAV_NAMES = {
  ramen: "Ramen", gum: "Bubblegum", sushi: "Sushi", moncookie: "Mon cookie", cake: "Strawberry cake",
  banana: "Banana", chili: "Hot chili", fly: "Crunchy fly",
};

/** Personality from a trait array in KEYS order (or a {trait: value} object). Pure and deterministic. */
export function personaOf(id, tr) {
  const t = Array.isArray(tr) ? Object.fromEntries(KEYS.map((k, i) => [k, tr[i] || ""])) : tr;
  const c = core(t.Mouth || "");
  const m = mind(t.Eyes || "");
  let fav = c.fav;
  if (has(t.Accessory || "", "Fwog", "PEPE") || has(t.Head || "", "Shroom") || has(t.Body || "", "Toad")) fav = "fly";
  else if (has(t.Body || "", "Banana") || has(t.Head || "", "Banana")) fav = "banana";
  else if (has(t.Body || "", "Dragon", "Fire") || has(t.Eyes || "", "fire laser") || has(t.Head || "", "Demon", "devil")) fav = "chili";
  else if (has(t.Head || "", "Crown", "Krown", "wreath") || has(t.Body || "", "Kings Robe", "Golden Armor")) fav = "cake";
  else if (has(t.Body || "", "Yukata", "Chinese") || has(t.Head || "", "Japan")) fav = "sushi";

  const ghost = t.Form === "Skull" || t.Base === "Skull";
  // bath: + loves water, - hates it
  let bath = 2;
  if (t.Naked === "Yes" || has(t.Body || "", "Duck", "Shark", "Hawaiian", "Tank")) bath = 9;
  else if (has(t.Body || "", "Inmate", "Prisoner", "Gangster", "Mafia", "Homeless", "Squid Game Guard") || has(t.Head || "", "Robber")) bath = -7;
  if (ghost) bath = 0;

  // bedtime in UTC hours [sleep, wake]: owls stay up, sleepyheads go early
  let sleep = [21, 3]; // 6 h: 00:00-06:00 MSK
  let sched = "normal";
  if (has(t.Head || "", "Wizard") || has(t.Body || "", "Wizard", "Sci Fi", "Glitch", "Electro") || m.key === "gamer") { sleep = [0, 6]; sched = "owl"; }
  else if (m.key === "sleepy" || has(t.Body || "", "Farmer")) { sleep = [19, 1]; sched = "early"; }

  // no two neighbours keep exactly the same hours: shift bedtime by up to 2 h either way
  const shift = (((id * 7919) >>> 0) % 5) - 2;
  sleep = sleep.map((h) => (h + shift + 24) % 24);

  const tier = t.Tier || "Common";
  return {
    id,
    title: `${m.adj} ${c.noun}`,
    core: c.key,
    mind: m.key,
    fav,
    favName: FAV_NAMES[fav],
    picky: !!c.picky,
    ghost,
    bath,
    sleep,
    sched,
    side: t.Side === "Left" ? "left" : "right",
    sparkle: ["Rare", "Epic", "Legendary"].includes(tier) || t.Base === "1:1",
    tier: t.Base === "1:1" ? "1:1" : tier,
    m: {
      food: c.food,
      fun: (c.fun || 1) * (m.fun || 1),
      energy: m.energy,
      clean: ghost ? 0.3 : 1,
      play: m.play,
      love: m.love,
    },
    traits: t,
  };
}

// an anonymous sitter's name, the same in the browser and in the worker
const SIT_A = ["Mint", "Sleepy", "Lucky", "Fuzzy", "Brave", "Tiny", "Salty", "Comfy", "Night", "Sunny", "Wobbly", "Quiet", "Speedy", "Velvet", "Pixel", "Bubbly", "Cosmic", "Soft", "Chunky", "Gentle"];
const SIT_B = ["Frog", "Bean", "Mochi", "Pebble", "Noodle", "Moth", "Dumpling", "Sprout", "Biscuit", "Otter", "Pancake", "Comet", "Tofu", "Puffin", "Waffle", "Gecko", "Muffin", "Turnip", "Kiwi", "Nugget"];
export function sitterName(anon) {
  let h = 0;
  for (const ch of String(anon)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${SIT_A[h % SIT_A.length]} ${SIT_B[(h >>> 8) % SIT_B.length]}`;
}

/** Short human list of what makes this one tick. */
export function quirks(p) {
  const q = [];
  q.push(`Loves ${p.favName.toLowerCase()}`);
  if (p.picky) q.push("Candy upsets its tummy");
  if (p.bath >= 8) q.push("Loves bath time");
  else if (p.bath < 0) q.push("Hates baths");
  if (p.ghost) q.push("A ghost: barely gets dirty");
  if (p.m.play >= 1.3) q.push("Games make it extra happy");
  if (p.m.love >= 1.4) q.push("Melts when you pet it");
  if (p.m.love <= 0.8) q.push("Plays hard to get");
  if (p.m.fun >= 1.15) q.push("Gets bored fast");
  if (p.m.fun <= 0.75) q.push("Hard to bore");
  if (p.m.food >= 1.2) q.push("Always hungry");
  if (p.m.energy >= 1.3) q.push("Tires out quickly");
  if (p.sched === "owl") q.push("Night owl");
  if (p.sched === "early") q.push("Early to bed");
  return q.slice(0, 4);
}

// what it says. Mood lines first, then a pinch of personality.
const LINES = {
  hungry: ["wen food?", "my tummy is in a bear market", "feed me ser", "i could eat a whole candle", "so... hungry..."],
  bored: ["so bored. play with me?", "nothing ever happens", "entertain me", "let's play a game!"],
  sleepy: ["eyes closing...", "low battery", "nap time?", "*yawn*"],
  stinky: ["i smell like a rug pull", "bath pls", "the flies like me. i don't.", "something stinks. it's me."],
  miserable: ["nobody loves me", "i don't feel good", "help...", "is anyone there?"],
  happy: ["gm!", "life is good", "best day ever", "i love it here", "you're the best"],
  content: ["gm", "just vibing", "hi :)", "chillin", "what's up?"],
  asleep: ["zzz", "mmm... rice ball...", "zzz... number go up... zzz"],
  away: ["(it left a note)"],
};
const FLAVOUR = {
  foodie: ["is it snack time?", "i smell food", "food is love"],
  sweet: ["candy?", "pop! hehe", "life is sweet"],
  picky: ["not that one.", "is it fresh?", "hmm."],
  degen: ["number go up?", "wen chog?", "i'm early, right?", "we're so back"],
  worrier: ["are you still here?", "don't go, ok?", "is everything ok?"],
  sunny: ["today is great!", "hehe :)", "love you!"],
  gremlin: ["hehe", "*bites you gently*", "chaos time"],
  sleepy: ["*yawn*", "5 more minutes"],
  gamer: ["one more round", "gg", "skill issue"],
  romantic: ["<3", "you came back!", "my favourite human"],
  drama: ["i am DYING (of boredom)", "this is the worst day ever (it's fine)"],
  smug: ["i knew you'd come back", "took you long enough", "obviously."],
  grumpy: ["hmph.", "what.", "fine. hi."],
  chaotic: ["AAAAA", "beep boop", "i licked the screen"],
  chill: ["all good", "no rush", "vibes"],
};
export const REACT = {
  full: ["too full!", "no more, pls", "i'll explode"],
  fav: ["MY FAVOURITE!!", "you remembered!", "yesss"],
  yuck: ["ugh, my tummy", "bleh", "why candy, why"],
  eat: ["nom nom", "yum!", "thanks!", "tasty"],
  treat: ["$CHOG treat!!", "so shiny. so tasty.", "this is the good stuff"],
  notsleepy: ["not sleepy!", "i want to play!", "lights on pls"],
  nap: ["night night", "zzz...", "tuck me in"],
  grumpy: ["WHY", "i was sleeping!!", "rude."],
  wake: ["gm!", "*stretch*", "good nap"],
  tired: ["too tired to play", "need a nap first", "can't... move..."],
  asleep: ["zzz", "(it's asleep)", "shhh, sleeping"],
  bathlove: ["splash splash!", "bubbles!!", "i love baths"],
  bathhate: ["i hate baths!!", "not the water!!", "fine. clean now."],
  clean: ["so fresh", "squeaky clean", "ahh, better"],
  love: ["<3", "hehe", "more pets pls"],
  purr: ["*purr*", "zzz <3"],
  return: ["i'm back! missed me?", "found no snacks out there", "home sweet home"],
  play: ["gg!", "again!", "that was fun"],
  moved: ["new home!", "hi new human", "where am i?"],
  spotless: ["already squeaky clean", "i'm clean, promise", "no bath needed"],
  woke: ["*yawn* ...food?", "you woke me up. fine.", "5 more min... ok ok"],
  rescued: ["you came! i was so lonely", "finally, a visitor!", "thank you thank you"],
};

/** A line about how long it has lived with this wallet. */
export function ageLine(days, mine) {
  if (days < 1) return mine ? "first day with you!" : "first day in this home";
  if (days < 7) return mine ? `day ${days} with you` : `day ${days} in this home`;
  return mine ? `${days} days together` : `${days} days in this home`;
}

/** Deterministic-ish pick so a line doesn't flicker every frame: seed changes every ~20 s. */
export function lineFor(p, mood, seed) {
  const base = LINES[mood] || LINES.content;
  const fl = FLAVOUR[p.core] || [];
  const fm = FLAVOUR[p.mind] || [];
  const pool = mood === "content" || mood === "happy" ? [...base, ...fl, ...fm] : mood === "asleep" || mood === "away" ? base : [...base, ...base, ...fl];
  return pool[Math.abs(seed) % pool.length];
}

export function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}
