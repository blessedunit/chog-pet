// Helpers for the skyline section (js/skyline.js). A production copy of the bits we need from the map lab
// (originally from the map lab): data loaders, atlas tiles, faces, a 2D camera and pointer gestures.
export const N = 1969;
export const COLS = 45; // atlas columns, tile index = tokenId - 1

export const MOOD = {
  h: { c: "#46e38f", t: "happy" },
  f: { c: "#b5e35b", t: "doing fine" },
  n: { c: "#ffae45", t: "needs care" },
  s: { c: "#ff4f5e", t: "sad" },
  x: { c: "#8f87ad", t: "out looking for snacks" },
  w: { c: "#7a7398", t: "waiting for a visit" },
  0: { c: "#6d6496", t: "not met yet" },
};

export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const fmt = (n) => n.toLocaleString("en-US");
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const hash = (n) => {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
export const mix = (c, d, t) => [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t].map((v) => v | 0);
export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());
export const atlas = (s = 24) => once("a" + s, () => loadImg(`/img/atlas-${s}.webp`));
/** { v, k:[13 keys], n:[display number per tokenId-1], nm:{tokenId:name}, t:[trait rows] } */
export const data = () => once("data", () => fetch("/data/chogs.json").then((r) => r.json()));
/** live moods, never rejects: { cells: 1969 chars h/f/n/s/x/0, moved } */
export function town() {
  return fetch("/api/town", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((t) => ({ cells: (((t && t.cells) || "") + "0".repeat(N)).slice(0, N), moved: (t && t.moved) || [], ok: !!t }));
}

let D = null;
export const setData = (d) => (D = d);
export const num = (id) => (D ? D.n[id - 1] : id);
export const name = (id) => (D && D.nm[String(id)]) || `Chog #${num(id)}`;
export function traits(id) {
  if (!D) return {};
  const o = {};
  const row = D.t[id - 1] || [];
  D.k.forEach((k, j) => (o[k] = row[j] || ""));
  return o;
}

export function tile(g, im, s, id, dx, dy, dw, dh = dw) {
  const i = id - 1;
  g.drawImage(im, (i % COLS) * s, Math.floor(i / COLS) * s, s, s, dx, dy, dw, dh);
}

// single 96px faces, small LRU
const faces = new Map();
const pending = new Map();
export function face(id) {
  if (faces.has(id)) return Promise.resolve(faces.get(id));
  if (pending.has(id)) return pending.get(id);
  const p = loadImg(`/chogs/${id}.webp`).then(
    (im) => {
      pending.delete(id);
      faces.set(id, im);
      while (faces.size > 360) faces.delete(faces.keys().next().value);
      return im;
    },
    (e) => (pending.delete(id), Promise.reject(e)),
  );
  pending.set(id, p);
  return p;
}
/** the face if loaded, else null (and starts loading a few at a time) */
export function faceNow(id, onload) {
  if (faces.has(id)) return faces.get(id);
  if (pending.size < 16) face(id).then(onload || (() => {}), () => {});
  return null;
}

/** per-tile colours from the 24px atlas: avg face colour and bg (corner pixel) as [r,g,b] */
export function tileColors(a) {
  const c = document.createElement("canvas");
  c.width = a.width;
  c.height = a.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(a, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const W = c.width;
  const avg = new Array(N), bg = new Array(N);
  for (let i = 0; i < N; i++) {
    const x0 = (i % COLS) * 24, y0 = Math.floor(i / COLS) * 24;
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = 2; y < 24; y += 3)
      for (let x = 2; x < 24; x += 3) {
        const o = ((y0 + y) * W + x0 + x) * 4;
        r += px[o]; gg += px[o + 1]; b += px[o + 2]; k++;
      }
    avg[i] = [(r / k) | 0, (gg / k) | 0, (b / k) | 0];
    const o = ((y0 + 1) * W + x0 + 1) * 4;
    bg[i] = [px[o], px[o + 1], px[o + 2]];
  }
  return { avg, bg };
}

/** 2D camera: screen = (world - c) * s + view/2, kept inside bounds */
export class Cam {
  constructor() {
    this.minS = 1; this.maxS = 64; this.b = { x0: 0, x1: 1, y0: 0, y1: 1 };
    this.W = 1; this.H = 1; this.cx = 0; this.cy = 0; this.s = 1;
    this.anim = null; this.vel = null;
  }
  sx(x) { return (x - this.cx) * this.s + this.W / 2; }
  sy(y) { return (y - this.cy) * this.s + this.H / 2; }
  wx(x) { return (x - this.W / 2) / this.s + this.cx; }
  wy(y) { return (y - this.H / 2) / this.s + this.cy; }
  clamp() {
    this.s = clamp(this.s, this.minS, this.maxS);
    const b = this.b;
    const hw = this.W / 2 / this.s, hh = this.H / 2 / this.s;
    this.cx = b.x1 - b.x0 <= hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.cx, b.x0 + hw, b.x1 - hw);
    this.cy = b.y1 - b.y0 <= hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.cy, b.y0 + hh, b.y1 - hh);
  }
  pan(dx, dy) { this.anim = null; this.cx -= dx / this.s; this.cy -= dy / this.s; this.clamp(); }
  zoomAt(f, x, y) {
    this.anim = null;
    const wx = this.wx(x), wy = this.wy(y);
    this.s = clamp(this.s * f, this.minS, this.maxS);
    this.cx = wx - (x - this.W / 2) / this.s;
    this.cy = wy - (y - this.H / 2) / this.s;
    this.clamp();
  }
  /** cinematic move: big zooms keep the target point steady on screen; bump > 0 dips the zoom mid-way (tower to tower) */
  animTo(cx, cy, s, dur = 650, bump = 0) {
    s = clamp(s, this.minS, this.maxS);
    this.vel = null;
    if (reduced()) { this.cx = cx; this.cy = cy; this.s = s; this.anim = null; this.clamp(); return; }
    this.anim = { t0: performance.now(), dur, bump, a: { cx: this.cx, cy: this.cy, s: this.s }, b: { cx, cy, s } };
  }
  /** where the camera is heading (or is) */
  goal() { return this.anim ? this.anim.b : { cx: this.cx, cy: this.cy, s: this.s }; }
  fling(vx, vy) { if (!reduced() && Math.hypot(vx, vy) >= 1) this.vel = { vx, vy }; }
  /** advance animations; true while something moves */
  step(now) {
    if (this.anim) {
      const { t0, dur, a, b, bump } = this.anim;
      const t = Math.min(1, (now - t0) / dur);
      const e = ease(t);
      const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e);
      // centre follows 1/s so the zoom pivots on a fixed point instead of drifting
      const big = Math.abs(Math.log(b.s / a.s)) > 0.08;
      const u = big ? (1 / s - 1 / a.s) / (1 / b.s - 1 / a.s) : e;
      this.s = bump ? s * (1 - bump * Math.sin(Math.PI * e)) : s;
      this.cx = a.cx + (b.cx - a.cx) * u;
      this.cy = a.cy + (b.cy - a.cy) * u;
      this.clamp();
      if (t >= 1) this.anim = null;
      return true;
    }
    if (this.vel) {
      this.pan(this.vel.vx, this.vel.vy);
      this.vel.vx *= 0.9; this.vel.vy *= 0.9;
      if (Math.hypot(this.vel.vx, this.vel.vy) < 0.3) this.vel = null;
      return true;
    }
    return false;
  }
}

/** pointer + wheel gestures; handlers get element-local coordinates. wheel(...) returns true to consume the event */
export function gestures(target, h) {
  const ptrs = new Map();
  let drag = null, pinch = null;
  // the element rect is cached and re-read lazily after a scroll/resize (no layout reads per pointermove)
  let rc = null;
  const stale = () => (rc = null);
  addEventListener("scroll", stale, { passive: true });
  addEventListener("resize", stale, { passive: true });
  const loc = (e) => {
    if (!rc) rc = target.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  };
  target.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    rc = null;
    const p = loc(e);
    ptrs.set(e.pointerId, p);
    h.down && h.down(p.x, p.y, e.pointerType);
    if (ptrs.size === 1) {
      drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, vx: 0, vy: 0, lt: performance.now(), type: e.pointerType, id: e.pointerId };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (drag) drag.moved = true;
    }
  });
  target.addEventListener("pointermove", (e) => {
    const p = loc(e);
    if (!ptrs.has(e.pointerId)) {
      if (e.pointerType === "mouse") h.hover && h.hover(p.x, p.y);
      return;
    }
    ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      h.pan && h.pan(cx - pinch.cx, cy - pinch.cy);
      h.zoom && pinch.d > 0 && h.zoom(d / pinch.d, cx, cy);
      pinch = { d, cx, cy };
      return;
    }
    if (!drag) return;
    const dx = p.x - drag.x, dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > (drag.type === "mouse" ? 4 : 8)) {
      drag.moved = true;
      try { target.setPointerCapture(e.pointerId); } catch (er) {}
      target.classList.add("drag");
      h.hover && h.hover(-1, -1);
    }
    if (drag.moved) {
      const now = performance.now();
      const dt = Math.max(1, now - drag.lt);
      drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4 * 16;
      drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4 * 16;
      drag.lt = now;
      h.pan && h.pan(dx, dy);
    }
    drag.x = p.x;
    drag.y = p.y;
  });
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 1 && pinch) {
      pinch = null;
      const p = [...ptrs.values()][0];
      if (drag) (drag.x = p.x), (drag.y = p.y), (drag.vx = drag.vy = 0);
      return;
    }
    if (ptrs.size) return;
    pinch = null;
    target.classList.remove("drag");
    if (!drag) return;
    const d = drag;
    drag = null;
    if (e.type === "pointercancel") return;
    if (!d.moved) h.tap && h.tap(d.x0, d.y0, d.type);
    else {
      const still = performance.now() - d.lt > 80;
      h.release && h.release(still ? 0 : d.vx, still ? 0 : d.vy);
    }
  };
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
  target.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !ptrs.size) h.leave && h.leave();
  });
  target.addEventListener(
    "wheel",
    (e) => {
      const p = loc(e);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1);
      const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (h.wheel && h.wheel(dx, dy, p.x, p.y, e.ctrlKey)) e.preventDefault();
    },
    { passive: false },
  );
}
