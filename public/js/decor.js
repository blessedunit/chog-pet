// Chog Pet: the room grows with the Chog's stage in this home (days the current wallet has held it).
//   New home   -> a moving box in the corner and a strip of tape on the frame
//   Settled in -> a rug under the card
//   Family     -> a framed photo on the wall
//   Old friend -> a plant (the box is unpacked by now)
//   Lifer      -> a gold frame and a tiny crown on top
// Higher stages keep the earlier decor that still makes sense. Drawn in LCD-pixel blocks on the 4x art canvas,
// into the cached room picture, so it costs nothing per frame (only the frame trim moves with the card).

import { drawGifts } from "./gifts.js";

const C = {
  k: "#1d1233", n: "#8a5a35", N: "#5a3a20", b: "#c98b4f", B: "#e0a868", t: "#efd9a7", y: "#ffd84d", Y: "#e39a1c",
  o: "#ffae45", p: "#ff8ee4", P: "#d1478a", v: "#6e54ff", l: "#ddd7fe", c: "#85e6ff", g: "#46e38f", G: "#1f9c5a",
  w: "#fff8ee", r: "#d9673f", R: "#a8462b",
};

function spr(g, rows, x, y, HI) {
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i];
      if (ch === ".") continue;
      g.fillStyle = C[ch];
      g.fillRect((x + i) * HI, (y + j) * HI, HI, HI);
    }
}

// 15x13 cardboard box with its flaps open and a heart doodled on the side
const BOX = [
  ".NN.........NN.",
  "NBBN.......NBbN",
  ".NbbN.....NbbN.",
  "..NbbNNNNNbbN..",
  "NNNNNNNtNNNNNNN",
  "NBbbbbbtbbbbbbN",
  "NBbbbbbtbbbbbbN",
  "NBbbbbbtbbPbPbN",
  "NBbbbbbtbbPPPbN",
  "NBbbbbbtbbbPbbN",
  "NnbbbbbtbbbbbnN",
  "NnnnnnntnnnnnnN",
  ".NNNNNNNNNNNNN.",
];
// 10x9 family photo: wooden frame, sky, two tiny Chogs
const PHOTO = [
  "NNNNNNNNNN",
  "NooooooooN",
  "NoccccccoN",
  "NocppcwcoN",
  "NoppppwwoN",
  "NoppplwwoN",
  "NogggggwoN",
  "NooooooooN",
  "NNNNNNNNNN",
];
// 10x24 potted plant: it has grown tall over three months
const PLANT = [
  "....g.....",
  "...gGg....",
  "..gGg..g..",
  "...G..gGg.",
  ".g.G.gGg..",
  "gGgG..G...",
  ".gGG..G.g.",
  "..GG.GgGg.",
  "...GGG.g..",
  "g...G.....",
  "Gg..G..g..",
  "gGg.G.gG..",
  ".gGgGgG...",
  "...GG.....",
  "....G.....",
  "..RRRRRR..",
  ".RrrrrrrR.",
  "..RrrrrR..",
  "..RrrrrR..",
  "..RrrrrR..",
  "...RRRR...",
];
// 11x7 crown
const CROWN = [
  ".y...y...y.",
  "kyk.kyk.kyk",
  "kyykyyykyyk",
  "kyyyyyyyyyk",
  "kypyycyypyk",
  "kYYYYYYYYYk",
  ".kkkkkkkkk.",
];

/** Room decor for stage index `i` (0..4), drawn once into the room canvas. */
export function roomDecor(g, i, HI) {
  if (i == null || i < 0) return;
  // rug from Settled in on: a soft oval in Monad pink with a dotted border
  if (i >= 1) {
    const cx = 64, top = 118, rows = 9, half = 60;
    for (let j = 0; j < rows; j++) {
      const k = (j + 0.5) / rows - 0.5;
      const w = Math.round(half * Math.sqrt(Math.max(0, 1 - 4 * k * k)));
      const y = top + j;
      g.fillStyle = "rgba(29,18,51,0.35)";
      g.fillRect((cx - w - 1) * HI, (y + 1) * HI, (2 * w + 2) * HI, HI);
      g.fillStyle = C.P;
      g.fillRect((cx - w) * HI, y * HI, 2 * w * HI, HI);
      if (j > 0 && j < rows - 1) {
        g.fillStyle = C.p;
        g.fillRect((cx - w + 2) * HI, y * HI, (2 * w - 4) * HI, HI);
      }
      if (j === 2 || j === rows - 3) {
        g.fillStyle = C.y;
        for (let x = cx - w + 4; x < cx + w - 4; x += 3) g.fillRect(x * HI, y * HI, HI, HI);
      }
    }
  }
  if (i >= 2) {
    // a nail and a string, then the photo
    g.fillStyle = "rgba(29,18,51,0.35)";
    g.fillRect(118 * HI, 4 * HI, 10 * HI, 9 * HI);
    spr(g, PHOTO, 117, 3, HI);
  }
}

/** Floor things in front of the card's corner (pixel layer, 1x): the moving box, then the plant. */
export function floorDecor(g, i, left) {
  drawGifts(g, left); // room gifts bought with Candles (gifts.js)
  if (i == null || i < 0) return;
  // on the side away from the face, so they never cover it
  if (i === 0) spr(g, BOX, left ? 1 : 112, 110, 1);
  else if (i >= 3) spr(g, PLANT, left ? 1 : 117, 101, 1);
}

/** The card's frame colour for this stage (gold for Lifers). */
export function frameFill(a, i, X, Y, Wd, Hd) {
  if (i !== 4) return "#fff8ec";
  const gr = a.createLinearGradient(X, Y, X + Wd, Y + Hd);
  gr.addColorStop(0, "#fff1a8");
  gr.addColorStop(0.35, "#ffd84d");
  gr.addColorStop(0.7, "#e39a1c");
  gr.addColorStop(1, "#ffd84d");
  return gr;
}

/** Things that sit on the card and move with it: tape on a new home's frame, the Lifer crown. */
export function cardDecor(a, i, X, Y, Wd, Hd, HI, f, left) {
  if (i === 0) {
    // a strip of packing tape across a top corner (away from the need bubble)
    a.save();
    a.translate(left ? X + Wd - 3 * HI : X + 3 * HI, Y + 3 * HI);
    a.rotate(left ? Math.PI / 4 : -Math.PI / 4);
    a.fillStyle = "rgba(239,217,167,0.86)";
    a.fillRect(-8 * HI, -2 * HI, 16 * HI, 4 * HI);
    a.fillStyle = "rgba(255,255,255,0.35)";
    a.fillRect(-8 * HI, -2 * HI, 16 * HI, HI);
    a.restore();
  }
  if (i === 4) {
    // gold frame inner line, and the crown sitting on the top edge
    a.strokeStyle = "rgba(168,101,11,0.9)";
    a.lineWidth = HI * 0.75;
    a.beginPath();
    a.roundRect(X - HI * 0.5, Y - HI * 0.5, Wd + HI, Hd + HI, 7.5 * HI);
    a.stroke();
    const cx = Math.round((X + Wd / 2) / HI) - 5, cy = Math.round(Y / HI) - 8;
    spr(a, CROWN, cx, cy, HI);
    // a glint runs over the crown every few seconds
    const t = f % 48;
    if (t < 6) {
      a.fillStyle = "rgba(255,255,255,0.9)";
      a.fillRect((cx + 1 + t * 2) * HI, (cy + 2) * HI, HI, 3 * HI);
    }
  }
}

/** Where to throw sparkles when a new stage is seen for the first time (LCD px). */
export function decorSpots(i, left) {
  const s = [];
  const away = left ? 6 : 120;
  if (i === 0) s.push([away, 114]);
  if (i >= 1) s.push([30, 122], [98, 122]);
  if (i >= 2) s.push([122, 7]);
  if (i >= 3) s.push([away, 104]);
  if (i >= 4) s.push([64, 10], [20, 30], [108, 30]);
  return s;
}
