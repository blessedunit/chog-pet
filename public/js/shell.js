// The device shell as pixel art (like the site icon and the pixel sky) instead of smooth plastic gradients.
// Drawn on a canvas behind the bezel in the tier's colours; redrawn when the size or tier changes.

// 4x4 ordered dither so the shading steps look hand-pixelled, not banded
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const dev = document.getElementById("device");

// Size the device to the room it has: the biggest LCD pixel (--u) whose egg fits the centre column and the
// window height, so it never runs over the side panels at awkward widths. Phones keep their CSS sizes.
const STEPS = [1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4];
function fitU() {
  const col = document.querySelector(".col-c");
  if (!col || !dev) return;
  if (innerWidth <= 700) return void document.documentElement.style.removeProperty("--u");
  const cs = getComputedStyle(dev);
  const fr = parseFloat(cs.getPropertyValue("--fr")) || 1.44, rim = parseFloat(cs.getPropertyValue("--rim")) || 66;
  const byW = (col.clientWidth - 2 * rim - 8) / (128 * fr);
  const byH = (innerHeight - 250 - 1.9 * rim) / (128 * 1.3);
  const max = Math.min(byW, Math.max(byH, 2));
  const u = STEPS.filter((v) => v <= max).pop() || STEPS[0];
  document.documentElement.style.setProperty("--u", u + "px");
}
fitU();
addEventListener("resize", fitU);
const shell = dev && dev.querySelector(".shell");
if (shell) {
  const cv = document.createElement("canvas");
  cv.className = "shell-px";
  cv.setAttribute("aria-hidden", "true");
  shell.prepend(cv);
  let last = "";
  const draw = () => {
    const w = shell.offsetWidth, h = shell.offsetHeight;
    const u = Math.max(3, Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u")) * 2) || 4);
    const bz = shell.querySelector(".bezel");
    const face = bz ? [bz.offsetLeft, bz.offsetTop, bz.offsetWidth, bz.offsetHeight] : null;
    const key = [w, h, u, dev.dataset.tier, face].join();
    if (!w || !h || key === last) return;
    last = key;
    paint(cv, w, h, u, colours(), face);
  };
  new ResizeObserver(draw).observe(shell);
  new MutationObserver(draw).observe(dev, { attributes: true, attributeFilter: ["data-tier"] });
  draw();
}

function colours() {
  const cs = getComputedStyle(dev);
  const v = (n) => cs.getPropertyValue(n).trim() || "#8b6cff";
  return { s0: v("--s0"), s1: v("--s1"), s2: v("--s2"), s3: v("--s3"), holo: ["Legendary", "1:1"].includes(dev.dataset.tier) };
}

function paint(cv, w, h, u, c, face) {
  const W = Math.ceil(w / u), H = Math.ceil(h / u);
  cv.width = W; cv.height = H;
  cv.style.width = W * u + "px"; cv.style.height = H * u + "px";
  const g = cv.getContext("2d");
  const img = g.createImageData(W, H), d = img.data;
  // the same egg the layout was built around: elliptical corners, wider and rounder at the top
  const inside = (x, y) => eggAt((x + 0.5) / W, (y + 0.5) / H);
  const mask = new Uint8Array(W * H);
  // the dark face: an egg of its own around the screen and buttons, set into the shell
  let fx0 = 0, fy0 = 0, fw = 0, fh = 0;
  if (face) { fx0 = Math.round(face[0] / u); fy0 = Math.round(face[1] / u); fw = Math.round(face[2] / u); fh = Math.round(face[3] / u); }
  const inFace = (x, y) => fw > 0 && eggAt((x - fx0 + 0.5) / fw, (y - fy0 + 0.5) / fh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = inside(x, y) ? 1 : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const pal = [c.s0, c.s1, c.s2, c.s3].map(rgb);
  const outline = mix(pal[3], [14, 9, 28], 0.55);
  const rim = mix(pal[0], [255, 255, 255], 0.5);
  const holo = [[255, 209, 240], [159, 216, 255], [199, 255, 223], [255, 243, 168]];
  // distance to the outside, in art pixels (for the outline and the rim light)
  const near = (x, y, r) => { for (let k = 1; k <= r; k++) if (!at(x - k, y) || !at(x + k, y) || !at(x, y - k) || !at(x, y + k)) return k; return 0; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    const i = (y * W + x) * 4;
    let col;
    const e = near(x, y, 3);
    const nx = x / W - 0.5, ny = y / H - 0.5;
    if (e === 1 || e === 2) col = outline; // a chunky two-pixel outline
    else if (e === 3 && nx + ny < -0.15) col = rim; // light catches the top-left lip
    else if (e === 3 && nx + ny > 0.35) col = mix(pal[3], [14, 9, 28], 0.25); // and the bottom-right lip sits in shadow
    else {
      // light from the top left: flat bands with a narrow dithered seam between them
      let L = 0.47 - nx * 0.6 - ny * 0.9;
      L = Math.max(0, Math.min(0.999, L)) * 3;
      const k = Math.floor(L), f = L - k;
      const tone = f > 0.5 + (BAYER[(y % 4) * 4 + (x % 4)] - 0.5) * 0.3 ? k + 1 : k;
      col = c.holo ? holo[(Math.floor((x + y) / 6) + tone) % 4] : pal[3 - Math.min(3, tone)];
    }
    if (inFace(x, y)) {
      const fe = !inFace(x - 1, y) || !inFace(x + 1, y) || !inFace(x, y - 1) || !inFace(x, y + 1);
      const fe2 = !fe && (!inFace(x - 2, y) || !inFace(x + 2, y) || !inFace(x, y - 2) || !inFace(x, y + 2));
      const fnx = (x - fx0) / fw - 0.5, fny = (y - fy0) / fh - 0.5;
      if (fe) col = [11, 6, 24]; // hard dark edge where the face sinks into the shell
      else if (fe2) col = fnx + fny > 0.1 ? mix(pal[0], [255, 255, 255], 0.2) : [8, 4, 18]; // lit lower lip, shadowed upper lip
      else {
        // the recessed face: deep violet, a little lighter towards the bottom where light falls in
        const L = Math.max(0, Math.min(0.999, 0.35 + fny * 0.7 + fnx * 0.15)) * 2;
        const k = Math.floor(L), f = L - k;
        const tone = f > 0.5 + (BAYER[(y % 4) * 4 + (x % 4)] - 0.5) * 0.3 ? k + 1 : k;
        col = [[20, 11, 46], [29, 17, 64], [37, 23, 82]][Math.min(2, tone)];
      }
    }
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a glossy highlight blob and a second small one, the way a toy shell catches light
  g.fillStyle = "rgba(255,255,255,0.9)";
  const hx = Math.round(W * 0.2), hy = Math.round(H * 0.13);
  for (let y = -2; y <= 2; y++) for (let x = -4; x <= 4; x++) if ((x / 4.5) ** 2 + (y / 2.2) ** 2 <= 1 && at(hx + x, hy + y)) g.fillRect(hx + x - y, hy + y, 1, 1);
  g.fillRect(hx + 7, hy - 3, 2, 2);
  const dots = [[0.86, 0.3, "#ffd84d"], [0.12, 0.62, "#ffffff"], [0.9, 0.7, "#ff8ee4"], [0.18, 0.86, "#ffd84d"], [0.8, 0.9, "#ffffff"]];
  for (const [fx, fy, col] of dots) {
    const x = Math.round(W * fx), y = Math.round(H * fy);
    if (!at(x - 1, y) || !at(x + 1, y)) continue;
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
}

// an egg in the unit square: elliptical corners, wider and rounder at the top
function eggAt(px, py) {
  if (px < 0 || px > 1 || py < 0 || py > 1) return false;
  const top = py < 0.5;
  const rx = top ? 0.5 : 0.48, ry = top ? 0.44 : 0.36;
  const cx = px < 0.5 ? rx : 1 - rx, cy = top ? ry : 1 - ry;
  if ((px < rx || px > 1 - rx) && (top ? py < ry : py > 1 - ry)) return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
  return true;
}

function rgb(hex) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.replace(/./g, "$&$&") : m, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
