// Chog Pet pixel art. Every sprite is a list of rows; each letter is a palette colour, "." is clear.
// Drawn at 1 logical pixel per cell on the 128x128 screen, or blown up for buttons and the share card.

export const PAL = {
  k: "#1d1233", // ink
  w: "#fff8ee",
  W: "#d9cfe6",
  p: "#ff7bb5", // chog pink
  P: "#d1478a",
  y: "#ffd84d",
  Y: "#e39a1c",
  o: "#ff9d42",
  g: "#46e38f",
  G: "#1f9c5a",
  q: "#243a33", // nori
  r: "#ff4f5e",
  R: "#a82645",
  b: "#7cc4ff",
  B: "#3a78e0",
  e: "#c9f3ff",
  v: "#a68bff", // monad violet
  V: "#6a4be0",
  n: "#8a5a35",
  N: "#5a3a20",
  s: "#d6d1e4",
  S: "#8d86a3",
  x: "#2fe27c", // EXIT green
};

export const S = {
  // ---------- food ----------
  rice: [
    "....kkkk....",
    "...kwwwwk...",
    "..kwwwwwwk..",
    "..kwwwwwwk..",
    ".kwwwwwwwwk.",
    ".kwwwwwwwwk.",
    "kwwwwwwwwwWk",
    "kwwwkkkkwwWk",
    "kwwwkqqkwwWk",
    "kwwwkqqkwWWk",
    ".kWWkqqkWWk.",
    "..kkkkkkkk..",
  ],
  candy: [
    "............",
    "............",
    "............",
    "kk...kk...kk",
    "kpk.kppk.kpk",
    "kppkpwppkppk",
    "kpPkppppkpPk",
    "kPk.kpPk.kPk",
    "kk...kk...kk",
    "............",
    "............",
    "............",
  ],
  banana: [
    ".........kk.",
    "........knk.",
    "........kyk.",
    ".......kyyk.",
    ".......kyyk.",
    "......kyyYk.",
    ".....kyyyYk.",
    "...kkyyyyk..",
    ".kkyyyyyYk..",
    "kyyyyyyYk...",
    "kYYyyYYk....",
    ".kkkkkk.....",
  ],
  gum: [
    "...kkkkkk...",
    "..kppppppk..",
    ".kpwwpppppk.",
    "kpwwppppppPk",
    "kpwppppppppk",
    "kppppppppppk",
    "kppppppppppk",
    "kppppppppPPk",
    ".kppppppPPk.",
    "..kPPPPPPk..",
    "...kkkkkk...",
    "............",
  ],
  ramen: [
    "...e..e..e..",
    "..e..e..e...",
    "...e..e..e..",
    "............",
    "kkkkkkkkkkkk",
    "kyywykGGwyyk",
    "kywwwyGywwyk",
    ".krrrrrrrrk.",
    ".krwrrrrwrk.",
    "..kRRRRRRk..",
    "...kkkkkk...",
    "............",
  ],
  sushi: [
    "............",
    "............",
    "...kkkkkk...",
    "..kooooook..",
    ".kowooowook.",
    ".kooowoooook",
    "kkkkkkkkkkkk",
    "kqwwwwwwwwqk",
    "kqwwwwwwwWqk",
    "kqWWWWWWWWqk",
    ".kkkkkkkkkk.",
    "............",
  ],
  moncookie: [
    "...kkkkkk...",
    "..kvvvvvvk..",
    ".kvwvvvvvvk.",
    "kvvvvkkvvvVk",
    "kvvvkwwkvvVk",
    "kvvkwvvwkvVk",
    "kvvkwvvwkvVk",
    "kvvvkwwkvvVk",
    "kvvvvkkvvvVk",
    ".kvvvvvvvVk.",
    "..kVVVVVVk..",
    "...kkkkkk...",
  ],
  cake: [
    ".....kk.....",
    "....krrk....",
    "....kRrk....",
    "..kkkkkkkk..",
    ".kwwwwwwwwk.",
    "kwwwwwwwwwwk",
    "kppppppppppk",
    "kyyyyyyyyyyk",
    "kppppppppppk",
    "kyyyyyyyyyyk",
    "kPPPPPPPPPPk",
    ".kkkkkkkkkk.",
  ],
  chili: [
    "..........G.",
    ".........GG.",
    "........kGk.",
    ".......krrk.",
    "......krrrk.",
    ".....krwrrk.",
    "....krwrrk..",
    "...krrrrk...",
    "..krrrRk....",
    ".krrRRk.....",
    "kRRRkk......",
    ".kkk........",
  ],
  fly: [
    "............",
    "..kk....kk..",
    ".kebk..kbek.",
    ".keebkkbeek.",
    "..kebkkbek..",
    "...kkSSkk...",
    "...kwSSwk...",
    "...kSkkSk...",
    "...kSSSSk...",
    "....kSSk....",
    ".....kk.....",
    "............",
  ],
  chog: [
    "...kkkkkk...",
    "..kyyyyyyk..",
    ".kywyyyyyYk.",
    "kyyykkkkyyYk",
    "kyykvvvvkyYk",
    "kyykvkkkkyYk",
    "kyykvkyyyyYk",
    "kyykvkkkkyYk",
    "kyykvvvvkyYk",
    ".kyykkkkyYk.",
    "..kYYYYYYk..",
    "...kkkkkk...",
  ],

  // ---------- page buttons ----------
  dice: [
    ".kkkkkkkk.",
    "kwwwwwwwWk",
    "kwkwwwwwWk",
    "kwwwwwwwWk",
    "kwwwkwwwWk",
    "kwwwwwwwWk",
    "kwwwwwwkWk",
    "kwwwwwwwWk",
    "kWWWWWWWWk",
    ".kkkkkkkk.",
  ],
  spk: [
    "....k.....",
    "...kk...k.",
    "..kwk.k..k",
    "kkwwk..k.k",
    "kwwwk..k.k",
    "kwwwk..k.k",
    "kkwwk..k.k",
    "..kwk.k..k",
    "...kk...k.",
    "....k.....",
  ],
  spkOff: [
    "....k.....",
    "...kk.....",
    "..kwk.....",
    "kkwwk.r..r",
    "kwwwk..rr.",
    "kwwwk..rr.",
    "kkwwk.r..r",
    "..kwk.....",
    "...kk.....",
    "....k.....",
  ],

  // ---------- bezel icons ----------
  i_feed: [
    "............",
    ".k.k.k...kk.",
    ".k.k.k..kwwk",
    ".k.k.k..kwwk",
    ".kkkkk..kwwk",
    "..kkk...kwwk",
    "...k....kkkk",
    "...k.....kk.",
    "...k.....kk.",
    "...k.....kk.",
    "...k.....kk.",
    "...k.....kk.",
  ],
  i_play: [
    "............",
    "............",
    "..kkkkkkkk..",
    ".kSSSSSSSSk.",
    "kSSkSSSSrSSk",
    "kSkkkSSrSrSk",
    "kSSkSSSSrSSk",
    "kSSSSkkSSSSk",
    "kSSSk..kSSSk",
    ".kkk....kkk.",
    "............",
    "............",
  ],
  i_clean: [
    "............",
    "..kkk.......",
    ".kyyyk......",
    ".kykyyk.....",
    ".kyyyyook...",
    "..kyyykk....",
    "kkkyyyykkk..",
    "kyyyyyyyyyk.",
    "kyyywyyyyyyk",
    ".kyyyyyyyyk.",
    "..kYYYYYYk..",
    "...kkkkkk...",
  ],
  i_lights: [
    "....kkkk....",
    "...kyyyyk...",
    "..kywwyyyk..",
    "..kwyyyyyk..",
    "..kyyyyyyk..",
    "...kyyyyk...",
    "....kyyk....",
    "....kssk....",
    "....kSSk....",
    "....kssk....",
    ".....kk.....",
    "............",
  ],
  i_love: [
    "............",
    "..kk....kk..",
    ".kppk..kppk.",
    "kpwppkkppppk",
    "kpwppppppppk",
    "kppppppppppk",
    ".kppppppppk.",
    "..kppppppk..",
    "...kppppk...",
    "....kppk....",
    ".....kk.....",
    "............",
  ],
  i_card: [
    "............",
    "............",
    "...kkk......",
    ".kkkkkkkkkk.",
    "kssssssssssk",
    "ksssskkksssk",
    "ksssk..bkssk",
    "kssk.ebbkssk",
    "ksssk.bbkssk",
    "ksssskkksssk",
    ".kkkkkkkkkk.",
    "............",
  ],

  // ---------- hud (7x7) ----------
  h_food: [
    "..kkk..",
    ".knnnk.",
    "knnnnnk",
    "knnnnnk",
    ".knnnk.",
    "..kwk..",
    ".kw.wk.",
  ],
  h_fun: [
    "...y...",
    "..yyy..",
    "yyyyyyy",
    ".yyyyy.",
    ".yy.yy.",
    "yy...yy",
    ".......",
  ],
  h_energy: [
    "...yyy.",
    "..yyy..",
    ".yyyyy.",
    "...yy..",
    "..yy...",
    ".yy....",
    "y......",
  ],
  h_clean: [
    "...b...",
    "..bbb..",
    ".bbbbb.",
    ".bwbbb.",
    ".bbbbb.",
    "..bbb..",
    ".......",
  ],

  // ---------- fx ----------
  heart: [".pp.pp.", "pwppppp", "ppppppp", ".ppppp.", "..ppp..", "...p..."],
  flame: [
    "....r....",
    "...rr....",
    "...rrr.r.",
    "..rrorrr.",
    ".rrrorrr.",
    ".rrooorrr",
    "rrooyoorr",
    "rroyyyorr",
    "rroyyyorr",
    ".rroyorr.",
    "..rrrrr..",
  ],
  heartS: [".p.p.", "ppppp", ".ppp.", "..p.."],
  poop: [
    "....kk....",
    "...knnk...",
    "....knnk..",
    "..kknnnnk.",
    ".knnNnnnnk",
    "kkknnnnNkk",
    "knnnnnnnnk",
    ".kkkkkkkk.",
  ],
  anger: [".r...r.", "rr...rr", ".......", ".......", "rr...rr", ".r...r."],
  sweat: [".b.", "bbb", "bwb", ".b."],
  sparkle: ["..w..", "..y..", "wyyyw", "..y..", "..w.."],
  sparkleS: [".w.", "wyw", ".w."],
  note: ["..kkk", "..k.k", "..k.k", "..k..", "kkk..", "kkk.."],
  bubble: ["..w..", ".w.w.", "w...w", ".w.w.", "..w.."],
  crumb: ["y"],
  drop: ["b", "b", "e"],
  stink: [".g.", "g..", ".g.", "..g", ".g."],
  x: ["r...r", ".r.r.", "..r..", ".r.r.", "r...r"],
  suitcase: [
    "...kkk...",
    "...k.k...",
    "kkkkkkkkk",
    "knnnnnnnk",
    "knNnnnNnk",
    "knnnnnnnk",
    "knNnnnNnk",
    "kkkkkkkkk",
  ],
  note2: [
    "kkkkkkk",
    "kwwwwwk",
    "kwkkkwk",
    "kwwwwwk",
    "kwkkwwk",
    "kwwwwwk",
    "kkkkkkk",
  ],
  // game
  gcandle: ["...k...", "..kgk..", ".kgggk.", ".kgwgk.", ".kgwgk.", ".kgggk.", ".kGGGk.", "..kgk..", "...k..."],
  rcandle: ["...k...", "..krk..", ".krrrk.", ".krwrk.", ".krrrk.", ".krrrk.", ".kRRRk.", "..krk..", "...k..."],
  coin: [".kkkkk.", "kyyyyyk", "kywvvYk", "kyvwvYk", "kyvvvYk", "kYYYYYk", ".kkkkk."],
  life: [".p.p.", "ppppp", ".ppp.", "..p.."],
  lifeOff: [".S.S.", "SSSSS", ".SSS.", "..S.."],
};

// 3x5 pixel font for the screen
const F = {
  A: ".X.X.XXXXX.XX.X", B: "XX.X.XXX.X.XXX.", C: ".XXX..X..X...XX", D: "XX.X.XX.XX.XXX.", E: "XXXX..XX.X..XXX",
  F: "XXXX..XX.X..X..", G: ".XXX..X.XX.X.XX", H: "X.XX.XXXXX.XX.X", I: "XXX.X..X..X.XXX", J: "..X..X..XX.X.X.",
  K: "X.XX.XXX.X.XX.X", L: "X..X..X..X..XXX", M: "X.XXXXXXXX.XX.X", N: "XX.X.XX.XX.XX.X", O: ".X.X.XX.XX.X.X.",
  P: "XX.X.XXX.X..X..", Q: ".X.X.XX.XXX..XX", R: "XX.X.XXX.X.XX.X", S: ".XXX...X...XXX.", T: "XXX.X..X..X..X.",
  U: "X.XX.XX.XX.XXXX", V: "X.XX.XX.XX.X.X.", W: "X.XX.XXXXXXXX.X", X: "X.XX.X.X.X.XX.X", Y: "X.XX.X.X..X..X.",
  Z: "XXX..X.X.X..XXX", 0: "XXXX.XX.XX.XXXX", 1: ".X.XX..X..X.XXX", 2: "XX...X.X.X..XXX", 3: "XX...X.X...XXX.",
  4: "X.XX.XXXX..X..X", 5: "XXXX..XX...XXX.", 6: ".XXX..XXXX.XXXX", 7: "XXX..X.X..X..X.", 8: "XXXX.XXXXX.XXXX",
  9: "XXXX.XXXX..XXX.", "!": ".X..X..X.....X.", "?": "XX...X.X.....X.", ".": ".............X.", ":": "....X.....X....",
  "-": "......XXX......", "+": "....X.XXX.X....", "#": "X.XXXXX.XXXXX.X", "/": "..X..X.X.X..X..", $: ".XXXX..X..XXXX.",
  " ": "...............", "<": "..X.X.X...X...X", ">": "X...X...X.X.X..", "*": "...X.X.X.X.X...", "'": ".X..X..........",
  "%": "X.X..X.X.X..X.X",
};

/** Draw text with the 3x5 font at logical pixel (x, y). Returns the width drawn. */
export function text(ctx, str, x, y, color, scale = 1) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    const g = F[ch] || F["?"];
    for (let i = 0; i < 15; i++) if (g[i] === "X") ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    cx += 4 * scale;
  }
  return cx - x - scale;
}
export const textWidth = (str, scale = 1) => String(str).length * 4 * scale - scale;

/** Draw a sprite at logical (x, y). `flip` mirrors it, `cut` keeps only the first n columns (for bites). */
export function draw(ctx, name, x, y, opt = {}) {
  const rows = S[name];
  if (!rows) return;
  const sc = opt.scale || 1;
  const w = rows[0].length;
  const cut = opt.cut == null ? w : opt.cut;
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < w; i++) {
      const c = row[i];
      if (c === ".") continue;
      const col = opt.flip ? w - 1 - i : i;
      if (col >= cut) continue;
      ctx.fillStyle = opt.tint || PAL[c] || c;
      ctx.fillRect(x + col * sc, y + j * sc, sc, sc);
    }
  }
}
export const size = (name) => [S[name][0].length, S[name].length];

/** Render a sprite into its own small canvas (for HTML buttons / menu). */
export function toCanvas(name, scale = 3, tint) {
  const [w, h] = size(name);
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d");
  draw(ctx, name, 0, 0, { scale, tint });
  return c;
}
