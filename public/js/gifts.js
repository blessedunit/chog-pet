// Chog Pet: pixel art for the Candle shop (snacks, room gifts, boosts, badges) and the gifts in a Chog's room.
// Gifts are drawn on the LCD pixel layer every frame through decor.js -> drawGifts(), so the lamp bubbles, the
// fish swim and the fairy lights blink. Everyone who opens that Chog sees them (they come from the worker).
import { S, PAL, draw, toCanvas } from "./sprites.js";

const ART = {
  // ---------- shop snacks (12x12, also used by the Feed menu and the eating animation) ----------
  boba: [
    ".......kk...",
    "......kk....",
    "..kkkkkkkk..",
    ".kWWWWkWWWk.",
    "..kvvvkvvk..",
    "..kvwvvvvk..",
    "..kvwvvvvk..",
    "..kvvvvvVk..",
    "..kvkvkvVk..",
    "..kkvkvkVk..",
    "...kVVVVk...",
    "....kkkk....",
  ],
  mochi: [
    "............",
    "............",
    "....kkkk....",
    "..kkvvvvkk..",
    ".kvwwvvvvvk.",
    ".kvwvvvvvvk.",
    "kvvkvvvvkvVk",
    "kvvvpvvpvvVk",
    "kVvvvkkvvVVk",
    ".kVVVVVVVVk.",
    "..kkkkkkkk..",
    "............",
  ],
  goldramen: [
    "..w...e..w..",
    "...e..e.e...",
    "..e..e..e.y.",
    "............",
    "kkkkkkkkkkkk",
    "kyywykggwyyk",
    "kywwwyGywwyk",
    ".kyyyyyyyyk.",
    ".kywyyyyyYk.",
    "..kYYYYYYk..",
    "...kkkkkk...",
    "............",
  ],
  candlecake: [
    "......y.....",
    "......o.....",
    ".....kgk....",
    ".....kgk....",
    "..kkkkgkkkk.",
    ".kwpwwwwpwwk",
    ".kpppppppppk",
    ".kvvvvvvvvvk",
    ".kwwwwwwwwwk",
    ".kvvvvvvvvVk",
    ".kVVVVVVVVVk",
    "..kkkkkkkkk.",
  ],

  // ---------- room gifts ----------
  g_poster: [
    "kkkkkkkkkk",
    "kvvvvvvvvk",
    "kvvvwwvvvk",
    "kvvwvvwvvk",
    "kvwvvvvwvk",
    "kvwvvvvwvk",
    "kvvwvvwvvk",
    "kvvvwwvvvk",
    "kvvvvvvvvk",
    "kvpvyvevvk",
    "kkkkkkkkkk",
  ],
  g_plush: [
    ".kk......kk.",
    "kpPk....kPpk",
    "kppkkkkkkppk",
    "kpppppppppPk",
    "kppkwppkwpPk",
    "kppkkppkkpPk",
    "kpPpppppPpPk",
    "kppppkkpppPk",
    ".kpppppppPk.",
    "..kPkkkkPk..",
    "..kPk..kPk..",
    "..kk....kk..",
  ],
  g_lamp: [
    "..kkk..",
    ".kSsSk.",
    ".kkkkk.",
    "kpppppk",
    "kpppppk",
    "kpppppk",
    "kpppppk",
    "kpppppk",
    "kpppppk",
    "kpppppk",
    ".kpppk.",
    ".kkkkk.",
    "kSsssSk",
    "kSSSSSk",
    ".kkkkk.",
  ],
  g_aquarium: [
    "kkkkkkkkkkkkkkkk",
    "kSssssssssssssSk",
    "kebbbbbbbbbbbbek",
    "kbbbbbbbbbbbbbbk",
    "kbbbbbbbbbbbbbbk",
    "kbbbbbbbbbbbbbbk",
    "kbgbbbbbbbbbbbbk",
    "kbgbbbbbbbbbgbbk",
    "kbGgbbbbbbbbGgbk",
    "kyyyyyyoyyyyyyyk",
    "kkkkkkkkkkkkkkkk",
    ".kNNNNNNNNNNNNk.",
    ".kk..........kk.",
  ],
  g_cushion: [
    "......y.y.y.....",
    "......yyyyy.....",
    "......kYYYk.....",
    "..kkkkkkkkkkkk..",
    ".kvvvvvvvvvvvvk.",
    "kvvwvvvvvvvvvvVk",
    "kvvvvvvvvvvvvvVk",
    "kVvvvvvvvvvvvVVk",
    ".kVVVVVVVVVVVVk.",
    "y.kkkkkkkkkkkk.y",
  ],
  g_disco: [
    "....k....",
    "....k....",
    "..kkkkk..",
    ".kswSwsk.",
    "kSwsSswSk",
    "kswSwsSsk",
    "kSsSwSwsk",
    ".kSsSsSk.",
    "..kkkkk..",
  ],
  g_lights: [ // a light wire drooping between two hooks, five glowing bulbs (bright enough for the dark shop cards)
    "ss.................ss",
    "..ss.............ss..",
    "..S.sss.......sss.S..",
    ".wpp..SsssssssS..woo.",
    ".ppP.wyy..S..wbb.ooY.",
    "..P..yyY.wgg.bbB..Y..",
    "......Y..ggG..B......",
    "..........G..........",
  ],

  // ---------- boosts ----------
  e_rush: [
    ".....kkkk",
    "....kyyyk",
    "...kyyyk.",
    "..kyyyk..",
    ".kyyyyyyk",
    "kkkkyyyk.",
    "...kyyk..",
    "..kyyk...",
    "..kyk....",
    "..kk.....",
  ],
  e_x2: [
    "kkkkkkkkkkkkk",
    "kyyyyyyyyyyYk",
    "yykyykyyykkYk",
    "kyykkyyyyykYk",
    "kyykkyyykkYYk",
    "yykyykyykyyYk",
    "kyyyyyyyykkYk",
    "kYYYYYYYYYYYk",
    "kkkkkkkkkkkkk",
  ],
  e_charm: [
    "..kk.kk..",
    ".kggkggk.",
    ".kgGkGgk.",
    "kkkGgGkkk",
    "kggGgGggk",
    "kgGkgkGgk",
    ".kgk.kgk.",
    "..k.k.k..",
    "....kk...",
  ],
  // ---------- name badges (7x7) ----------
  e_b_star: ["...y...", "..yyy..", "yyyyyyy", ".yyyyy.", "..yYy..", ".yY.Yy.", ".Y...Y."],
  e_b_heart: [".pp.pp.", "pwppppp", "ppppppp", "PpppppP", ".PpppP.", "..PpP..", "...P..."],
  e_b_flame: ["...o...", "..oo...", "..ooo..", ".oyoo..", ".oyyoo.", "ooyyyoo", ".oyyyo."],
  e_b_crown: ["y..y..y", "yy.y.yy", "yyyyyyy", "ypyyyey", "yyyyyyy", "YYYYYYY", "......."],
  // ---------- misc ----------
  e_capsule: [
    "..kkkkk..",
    ".kpppwpk.",
    "kpppppwpk",
    "kpppppppk",
    "kkkkkkkkk",
    "kwwwwwwWk",
    "kwwwwwwWk",
    ".kWWWWWk.",
    "..kkkkk..",
  ],
};
for (const [k, rows] of Object.entries(ART)) S[k] = rows;

/** The sprite key that draws a shop item (food keys are used as-is, so the Feed menu can draw them). */
export const spriteOf = (item) => (ART[item] ? item : ART["g_" + item] ? "g_" + item : ART["e_" + item] ? "e_" + item : null);
/** A crisp little canvas of an item for the shop. */
export function iconOf(item, scale = 3) {
  const k = spriteOf(item);
  if (k) return toCanvas(k, scale);
  const c = document.createElement("canvas");
  c.width = c.height = 8 * scale;
  return c;
}

// ---------- the gifts in the room of the Chog on screen ----------
let curId = 0;
let have = new Set();
const known = new Map(); // id -> [items]
export function setGifts(id, list) {
  const items = (list || []).map((g) => (typeof g === "string" ? g : g.item)).filter((k) => ART["g_" + k]);
  known.set(id, items);
  if (id === curId) have = new Set(items);
}
export const giftsOf = (id) => known.get(id) || [];
/** Which Chog is on screen (normally from the "chogpet:pet" event). */
export function setCurrent(id) {
  curId = id || 0;
  have = new Set(known.get(curId) || []);
}
if (typeof addEventListener === "function")
  addEventListener("chogpet:pet", (e) => {
    setCurrent(e.detail && e.detail.id);
  });

const BULBS = ["p", "y", "e", "g", "v", "o"];

/** Called from decor.js floorDecor() on the 128x128 pixel layer, every frame. `left` as in floorDecor (box side). */
export function drawGifts(g, left) {
  if (!have.size) return;
  const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const f = Math.floor(t * 6);
  const away = (xl, xr, w) => (left ? xl : xr);
  if (have.has("lights")) {
    // a drooping string of bulbs across the top of the room
    for (let x = 4; x < 124; x++) {
      const y = 1 + Math.round(3 * Math.sin(((x - 4) / 40) * Math.PI) ** 2);
      g.fillStyle = PAL.k;
      g.fillRect(x, y, 1, 1);
      if ((x - 4) % 8 === 4) {
        const c = BULBS[((x - 4) / 8 + Math.floor(t * 2)) % BULBS.length];
        const on = (Math.floor(t * 3) + x) % 5 !== 0;
        g.fillStyle = on ? PAL[c] : "#3a2f5c";
        g.fillRect(x - 1, y + 1, 3, 2);
        g.fillRect(x, y + 3, 1, 1);
        if (on) {
          g.fillStyle = "rgba(255,255,255,0.7)";
          g.fillRect(x - 1, y + 1, 1, 1);
        }
      }
    }
  }
  if (have.has("poster")) draw(g, "g_poster", 2, 4);
  if (have.has("disco")) {
    const x = 101, y = 0;
    draw(g, "g_disco", x, y);
    // the glints spin round the ball
    const k = f % 4;
    g.fillStyle = "#ffffff";
    g.fillRect(x + 2 + k, y + 4 + (k % 2), 1, 1);
    // light spots sweep over the walls
    for (let i = 0; i < 5; i++) {
      const a = t * 0.9 + i * 1.26;
      const sx = Math.round(64 + Math.cos(a) * 56), sy = Math.round(40 + Math.sin(a * 1.3) * 26);
      g.fillStyle = ["rgba(255,142,228,0.55)", "rgba(133,230,255,0.55)", "rgba(255,216,77,0.55)"][i % 3];
      g.fillRect(sx, sy, 2, 2);
    }
  }
  if (have.has("aquarium")) {
    const x = away(13, 99), y = 110;
    draw(g, "g_aquarium", x, y);
    // a fish swims across and back, bubbles rise
    const span = 9, p = (t * 3) % (span * 2);
    const fx = x + 2 + Math.round(p < span ? p : span * 2 - p), dir = p < span;
    g.fillStyle = PAL.o;
    g.fillRect(fx, y + 4, 3, 2);
    g.fillRect(dir ? fx - 1 : fx + 3, y + 4 + (f % 2), 1, 1);
    g.fillStyle = PAL.k;
    g.fillRect(dir ? fx + 2 : fx, y + 4, 1, 1);
    g.fillStyle = PAL.e;
    const by = y + 8 - (f % 6);
    if (by > y + 2) g.fillRect(x + 11, by, 1, 1);
  }
  if (have.has("cushion")) draw(g, "g_cushion", 56, 117);
  if (have.has("plush")) draw(g, "g_plush", away(97, 19), 115);
  if (have.has("lamp")) {
    const x = away(119, 2), y = 110;
    draw(g, "g_lamp", x, y);
    // two warm blobs drift up and down inside the glass
    for (let i = 0; i < 2; i++) {
      const by = y + 4 + Math.round((Math.sin(t * 0.8 + i * 2.4) + 1) * 2.6);
      g.fillStyle = i ? PAL.y : PAL.o;
      g.fillRect(x + 2 + i, by, 2, 2);
    }
    g.fillStyle = "rgba(255,174,69,0.18)";
    g.fillRect(x - 2, y + 2, 11, 10);
  }
}
