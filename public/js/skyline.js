// "Chogtown" — Orbit: a full-bleed round city between the device and the collection. Every tower is one Background
// trait, standing in a ring around a plaza with its facade turned inward; every window is a Chog (moods from
// /api/town). Seen from above with an orthographic camera: drag sideways to turn the ring (it drifts very slowly
// on its own), click a tower and the camera swings round the ring and dollies up to its facade until the faces
// read; click a face to open that Chog; click the sky / empty ground (or Esc, or scroll away) to pull back out.
// It shares the page sky (js/scene.js → "chogpet:sky" {phase, t}: 0 = day … 1 = night): by DAY pastel facades,
// glass windows with the faces behind them, a sun, soft clouds and cast shadows; AFTER DARK the windows are lit in
// each Chog's live mood colour under a moon and stars. A dusk / dawn cross-fades the two looks.
// Talks to main.js only through window events: listens to "chogpet:pet", opens a Chog with "chogpet:open".
// Page scroll is never hijacked: the canvas is touch-action: pan-y, so a vertical swipe always scrolls the page
// (and, inside a tower on touch, also glides along the facade); the wheel scrolls the page at the overview and
// only walks a framed facade on desktop until its end.
// Cheap frames: every facade / wall is a cached texture per look (day / night), drawn with one affine blit; only
// the framed tower is painted live. The loop runs only while the section is on screen and the tab visible
// (30 fps for the drift, full rate only while the camera flies or is dragged), DPR <= 1.5; prefers-reduced-motion
// = no drift, instant moves, frames on demand.
import * as K from "./skykit.js";
import { makeSides } from "./skysides.js";

const sec = document.getElementById("skyline");
const RM = K.reduced();
const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
const LAMP = { h: "#46e38f", f: "#b5e35b", n: "#ffae45", s: "#ff4f5e", x: "#a99fc9" };
const NIGHT = [12, 9, 26];
const DAYW = [238, 236, 255]; // the daylight the facades are washed toward
const DAYS = [92, 82, 170]; // ...and their shade
const TAU = Math.PI * 2;
const R = Math.round;
const WIN = 0.78; // window size in world units (1 unit = one floor / one column)
const ROOFU = 1.6; // roof furniture above the top floor
const PD = 0.17; // camera pitch once it has moved in on a facade
const GAP = 1.5; // street between two towers of the ring

// day ↔ night, shared with the page background (js/scene.js); no scene.js (?bg=studio) = night
let skyT = window.CHOG_SKY ? window.CHOG_SKY.t : 1;
addEventListener("chogpet:sky", (e) => {
  const t = Number(e.detail && e.detail.t);
  if (!Number.isFinite(t) || t === skyT) return;
  skyT = t;
  city && city.onSky();
});
let petId = 0;
let city = null;
addEventListener("chogpet:pet", (e) => {
  const id = Number(e.detail && e.detail.id) || 0;
  if (id >= 1 && id <= K.N) {
    petId = id;
    city && city.onPet();
  }
});

if (sec) boot();

function boot() {
  sec.innerHTML = `
<div class="nc-stage"><canvas class="nc-cv" tabindex="0" role="img" aria-label="Chogtown: every tower is one Background, every window is a Chog"></canvas></div>
<div class="nc-head">
  <h2 class="nc-title">Chogtown after dark</h2>
  <p class="nc-stat">1,969 windows · <b class="nc-lit">…</b> <span class="nc-lw">lit</span></p>
</div>
<div class="nc-tip" hidden><canvas class="nc-face" width="96" height="96"></canvas><div class="nc-tx"><b class="nc-t1"></b><span class="nc-t2"></span></div></div>`;
  const near = new IntersectionObserver(
    (es) => {
      if (es.some((e) => e.isIntersecting)) {
        near.disconnect();
        init().catch((e) => console.warn("skyline", e));
      }
    },
    { rootMargin: "700px 0px" },
  );
  near.observe(sec);
}

async function init() {
  const [d, t, a24] = await Promise.all([K.data(), K.town(), K.atlas(24)]);
  K.setData(d);
  await Promise.all([document.fonts.load('700 16px "Silkscreen"'), document.fonts.load('400 16px "Departure Mono"')]).catch(() => {});
  const cols = K.tileColors(a24);
  let a48 = null;
  // decode the big atlas off the main thread (a first drawImage of a lazily decoded 2k image = 100+ ms hitch mid-zoom)
  K.atlas(48)
    .then((a) => (typeof createImageBitmap === "function" ? createImageBitmap(a).catch(() => a) : a))
    .then((a) => ((a48 = a), (texVer++), kick()), () => {});
  let cells = t.cells;

  const cv = sec.querySelector(".nc-cv");
  const G0 = cv.getContext("2d");
  const head = sec.querySelector(".nc-head");
  const litEl = sec.querySelector(".nc-lit");
  const tip = sec.querySelector(".nc-tip");
  const tipFace = tip.querySelector(".nc-face");
  const tg = tipFace.getContext("2d");
  const t1 = tip.querySelector(".nc-t1"), t2 = tip.querySelector(".nc-t2");
  const sides = makeSides({
    a24, RM,
    // which side of the screen the Chog's tower stands on right now
    sideOf(id) {
      const b = towerOf[id];
      if (!b) return 0;
      setup();
      return b.ctr[0] * cth + b.ctr[1] * sth < 0 ? -1 : 1;
    },
    // a walker reached the ring: its window gives a little blink
    onArrive(id) {
      if (!focusB && towerOf[id]) flash = { id, b: towerOf[id], t0: performance.now() };
    },
    dirty: () => dirty(),
  });

  // ---------- towers: one per Background ----------
  const byBg = new Map();
  for (let id = 1; id <= K.N; id++) {
    const bg = d.t[id - 1][0] || "";
    if (!byBg.has(bg)) byBg.set(bg, []);
    byBg.get(bg).push(id);
  }
  const groups = [...byBg.entries()].map(([bg, ids], i) => {
    ids.sort((a, b) => d.n[a - 1] - d.n[b - 1]);
    const cnt = new Map();
    for (const id of ids) {
      const k = cols.bg[id - 1].join(",");
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    const col = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
    const neon = neonOf(col);
    const f0 = K.mix(K.mix(col, DAYW, 0.3), DAYS, 0.14);
    return {
      gi: i, bg, ids, col,
      h: K.hash(ids.length * 131 + bg.length * 7 + i * 17),
      name: bg ? bg.toUpperCase() : "1:1 SPECIALS",
      tint: K.rgb(K.mix(K.hex(neon), [236, 230, 255], 0.45)),
      tintD: K.rgb(K.mix(K.hex(neon), [34, 24, 96], 0.55)), // the same name, legible on a day sky
      roof: Math.floor(K.hash(ids.length * 31 + i) * 4),
      wv: K.hash(i * 41 + 9) < 0.3 ? 1.5 + K.hash(i * 5 + 1) * 0.5 : 0.62 + K.hash(i * 41 + 9) * 0.6, // stocky or slim
      pal: {
        n: {
          body: K.rgb(K.mix(col, NIGHT, 0.86)), lit: K.rgb(K.mix(col, NIGHT, 0.7)), dark: K.rgb(K.mix(col, [5, 3, 12], 0.9)),
          top0: K.rgb(K.mix(col, NIGHT, 0.8)), bot0: K.rgb(K.mix(col, [8, 5, 18], 0.9)), roof: K.rgb(K.mix(col, NIGHT, 0.74)),
          frame: "#06040e", door: "#c99a4b", doorIn: "#8a5a2a", edge: K.rgb(K.mix(col, NIGHT, 0.55)),
        },
        d: {
          body: K.rgb(f0), lit: K.rgb(K.mix(f0, [255, 255, 255], 0.5)), dark: K.rgb(K.mix(f0, DAYS, 0.42)),
          top0: K.rgb(K.mix(f0, DAYW, 0.22)), bot0: K.rgb(K.mix(f0, DAYS, 0.3)), roof: K.rgb(K.mix(f0, DAYW, 0.42)),
          frame: K.rgb(K.mix(f0, DAYS, 0.5)), door: "#f4ead6", doorIn: "#6a5a9e", edge: K.rgb(K.mix(f0, [255, 255, 255], 0.62)),
        },
      },
      tex: { d: null, n: null }, // cached walls per look
    };
  });
  const towerOf = {}, slotK = {};
  groups.forEach((b) => b.ids.forEach((id, k) => ((towerOf[id] = b), (slotK[id] = k))));
  const litCount = () => {
    let n = 0;
    for (const c of cells) if (c !== "0") n++;
    return n;
  };
  const dimCol = cols.avg.map((c, i) => K.rgb(K.mix(c, [16, 12, 40], 0.72 + K.hash(i * 3 + 1) * 0.12)));
  // daylight: glass that mirrors the sky, and (far away) a hint of the face behind it
  const GLASS_A = [212, 218, 254], GLASS_B = [158, 168, 238];
  const glassCol = cols.avg.map((_, i) => K.rgb(K.mix(GLASS_A, GLASS_B, 0.2 + K.hash(i * 7 + 3) * 0.55)));
  const dayDot = cols.avg.map((c, i) => K.rgb(K.mix(c, K.mix(GLASS_A, GLASS_B, 0.4), 0.35 + K.hash(i * 5 + 2) * 0.1)));

  // ---------- the ring ----------
  let blds = [], RR = 1, maxD = 1, maxH = 1, layK = 0, downtown = null;
  function build(kf) {
    layK = kf;
    const bl = groups.map((gr) => {
      const n = gr.ids.length;
      const c = n <= 3 ? n : K.clamp(Math.round(Math.sqrt(n / kf) * gr.wv), 3, 26);
      return Object.assign(gr, { c, r: Math.ceil(n / c), shop: n <= 3 });
    });
    // downtown on one side of the ring: tallest first, dealt alternately to the left and right
    bl.sort((a, b) => b.r * (0.8 + b.h * 0.5) - a.r * (0.8 + a.h * 0.5));
    downtown = bl[0];
    const row = [];
    bl.forEach((b, i) => (i % 2 ? row.push(b) : row.unshift(b)));
    let x = 1;
    for (const b of row) {
      b.pad = b.shop ? 0.4 : 0.55;
      b.w = b.c + b.pad * 2;
      b.x = x;
      b.top = -b.r - 1.1; // body top (the lobby is the last unit)
      b.empty = b.c * b.r - b.ids.length;
      x += b.w + 1;
      b.d = K.clamp(b.w * 0.45, 2, 4.2);
      b.Hb = -b.top;
      b.Hh = b.Hb + ROOFU;
      b.tex = { d: null, n: null };
    }
    let circ = 0;
    for (const b of row) circ += b.w + GAP;
    RR = circ / TAU;
    maxD = Math.max(...row.map((b) => b.d));
    maxH = Math.max(...row.map((b) => b.Hb)) + ROOFU * 2.4;
    let acc = 0;
    for (const b of row) {
      const a = ((acc + b.w / 2) / circ) * TAU;
      acc += b.w + GAP;
      b.al = a;
      const sa = Math.sin(a), ca = Math.cos(a);
      b.Rw = [-ca, sa]; // along the facade, left to right seen from the plaza
      b.Nw = [-sa, -ca]; // facade normal, toward the plaza centre
      const cx = (RR + b.d / 2) * sa, cz = (RR + b.d / 2) * ca;
      b.ctr = [cx, cz];
      b.flb = [cx + b.Nw[0] * (b.d / 2) - b.Rw[0] * (b.w / 2), cz + b.Nw[1] * (b.d / 2) - b.Rw[1] * (b.w / 2)];
    }
    blds = row;
  }
  // a point on tower b: u along the facade, t back from it, y up
  const P = (b, u, t, y) => [b.flb[0] + b.Rw[0] * u - b.Nw[0] * t, y, b.flb[1] + b.Rw[1] * u - b.Nw[1] * t];

  // ---------- view state ----------
  let W = 0, H = 0, dpr = 1, phone = false, headB = 0, headT = 0;
  let s0 = 4, F0 = [0, 0, 0], PITCH = 0.5;
  const cam = { th: 0, s: 4, F: [0, 0, 0], p: 0.5, ay: 0.5 };
  let held = false, anim = null, vel = 0, focusB = null, lastUse = -1e9, touched = false, introDone = false;
  let hover = null, flash = null, hits = [], frontOf = new Map();
  let ptrType = "mouse";
  let sp = 0, cp = 1, cth = 1, sth = 0, fx = 0, fy = 0, cyA = 0;
  let texVer = 0, kTex = 8;

  function setup() {
    sp = Math.sin(cam.p);
    cp = Math.cos(cam.p);
    cth = Math.cos(cam.th);
    sth = Math.sin(cam.th);
    cyA = H * cam.ay;
    const q = raw(cam.F[0], cam.F[1], cam.F[2]);
    fx = q[0];
    fy = q[1];
  }
  function raw(X, Y, Z) {
    const xr = X * cth + Z * sth, zr = -X * sth + Z * cth;
    return [xr, zr * sp - Y * cp, zr];
  }
  const scr = (p) => {
    const q = raw(p[0], p[1], p[2]);
    return [W / 2 + cam.s * (q[0] - fx), cyA + cam.s * (q[1] - fy)];
  };
  const facing = (n) => -n[0] * sth + n[1] * cth; // > 0: the face looks at the viewer
  const camX = (n) => n[0] * cth + n[1] * sth; // > 0: the face turns to the right of the screen
  function aff(p0, U, V) {
    const a = scr(p0), b = scr([p0[0] + U[0], p0[1] + U[1], p0[2] + U[2]]), c = scr([p0[0] + V[0], p0[1] + V[1], p0[2] + V[2]]);
    return [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]];
  }
  const Y3 = [0, -1, 0];
  const v3 = (v2) => [v2[0], 0, v2[1]];
  // (u along the wall, v down from the top of the roof furniture) -> screen
  const frontAff = (b) => aff(P(b, 0, 0, b.Hh), v3(b.Rw), Y3);
  function inv(A, x, y) {
    const [a, b, c, dd, e, f] = A;
    const det = a * dd - b * c;
    if (Math.abs(det) < 1e-9) return null;
    const X = x - e, Y = y - f;
    return [(dd * X - c * Y) / det, (-b * X + a * Y) / det];
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    const nW = Math.max(1, R(r.width)), nH = Math.max(1, R(r.height));
    const nd = Math.min(1.5, window.devicePixelRatio || 1); // big canvas: 1.5x is crisp enough and far cheaper than 2x
    if (nW === W && nH === H && nd === dpr) return;
    W = nW; H = nH; dpr = nd;
    cv.width = R(W * dpr);
    cv.height = R(H * dpr);
    phone = W < 700;
    PITCH = phone ? 0.58 : 0.5;
    headT = head.offsetTop; // resize only: never per frame
    headB = headT + head.offsetHeight;
    const kf = phone ? 2.6 : 3.2;
    if (kf !== layK) {
      const keep = focusB;
      build(kf);
      if (keep) (focusB = null), sec.classList.remove("zoomed");
    }
    fitOverview();
    if (focusB) {
      const g = dollyOf(focusB);
      Object.assign(cam, { th: g.th, s: g.s, F: g.F, p: g.p, ay: g.ay });
    } else Object.assign(cam, { s: s0, F: F0.slice(), p: PITCH, ay: 0.5 });
    if (!introDone && !touched) cam.th = frontTh();
    anim = null;
    kTex = K.clamp(R(s0 * dpr * 1.25), 5, 26);
    texVer++;
    signs.clear();
    stars = makeStars();
    fadeK = "";
    kick();
  }
  // the whole ring, centred in the band under the heading (phones: a touch wider than the screen)
  function fitOverview() {
    const s = Math.sin(PITCH), c = Math.cos(PITCH);
    const top = phone ? headB + 18 : H * 0.07, bot = H * (phone ? 0.95 : 0.97);
    const wU = 2 * (RR + maxD) + 3;
    const top0 = -(RR + maxD) * s - maxH * c, bot0 = (RR + maxD + 2.4) * s;
    s0 = Math.min((W * (phone ? 1.3 : 0.92)) / wU, (bot - top) / (bot0 - top0));
    const mid = (top0 + bot0) / 2 - ((top + bot) / 2 - H / 2) / s0;
    F0 = [0, -mid / c, 0];
  }
  const overview = () => ({ th: cam.th, s: s0, F: F0.slice(), p: PITCH, ay: 0.5 });
  // the yaw that turns tower b's facade square to the viewer (it then stands on the far side of the plaza)
  const thOf = (b) => cam.th + ((((Math.PI - b.al - cam.th) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  // first view: your own Chog's tower faces you, nudged toward downtown so the tall towers stay at the back
  function frontTh() {
    const b = (petId && towerOf[petId]) || downtown;
    const a = Math.PI - b.al, dn = Math.PI - downtown.al;
    let dlt = ((((a - dn) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    dlt = K.clamp(dlt, -1.1, 1.1);
    return dn + dlt;
  }
  // the band a framed facade sits in (clear of the soft top edge and the name above it)
  const band = () => ({ top: H * (phone ? 0.15 : 0.14), bot: H * (phone ? 0.95 : 0.93) });
  function dollyOf(b, at) {
    const cpD = Math.cos(PD);
    const { top, bot } = band();
    const tgt = phone ? 27 : W >= 1800 ? 38 : W >= 1400 ? 34 : 32; // window size in css px
    const margin = phone ? 18 : 120;
    let sD = Math.min(tgt / (WIN * cpD), (W - margin * 2) / (b.w + 1));
    sD = Math.max(sD, (phone ? 22 : 26) / (WIN * cpD));
    if (b.shop) sD = Math.min(sD * 1.5, (W - margin * 2) / (b.w + 1.5), 70 / (WIN * cpD));
    const visH = (bot - top) / (sD * cpD), visW = W / sD;
    const y = b.Hh <= visH ? b.Hh / 2 : K.clamp(at ? at.y : b.Hh - visH / 2, visH / 2 - 0.3, b.Hh - visH / 2 + 0.6);
    const u = b.w + 1 <= visW ? b.w / 2 : K.clamp(at ? at.u : b.w / 2, visW / 2 - 0.6, b.w - visW / 2 + 0.6);
    return { th: thOf(b), s: sD, F: P(b, u, 0, y), b, p: PD, ay: (top + bot) / 2 / H };
  }
  function animTo(goal, dur = 1150) {
    vel = 0;
    if (RM) {
      Object.assign(cam, { th: goal.th, s: goal.s, F: goal.F.slice(), p: goal.p, ay: goal.ay });
      anim = null;
      return;
    }
    anim = { t0: performance.now(), dur, a: { th: cam.th, s: cam.s, F: cam.F.slice(), p: cam.p, ay: cam.ay }, b: goal };
  }
  const zoomedNow = () => !!focusB;
  function stepCam(now, dt) {
    if (anim) {
      const tt = Math.min(1, (now - anim.t0) / anim.dur);
      const e = K.ease(tt);
      const { a, b } = anim;
      cam.th = a.th + (b.th - a.th) * e;
      cam.s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e);
      cam.F = a.F.map((v, i) => v + (b.F[i] - v) * e);
      cam.p = a.p + (b.p - a.p) * e;
      cam.ay = a.ay + (b.ay - a.ay) * e;
      if (tt >= 1) anim = null;
      return true;
    }
    if (vel) {
      // a flung ring coasts like a heavy wheel and settles back into the slow drift, in the direction it was spun
      cam.th += vel * dt;
      const tgt = DRIFT * driftDir;
      vel = tgt + (vel - tgt) * Math.exp(-dt / 1400);
      if (Math.abs(vel - tgt) < 0.000004) {
        vel = 0;
        driftT0 = 1; // hand over to the drift already at full speed
        lastUse = -1e9;
      }
      return true;
    }
    return false;
  }
  let driftT0 = 0, driftDir = 1;
  const DRIFT = 0.0001; // rad per ms: about one full turn a minute
  const drifting = (now) => !RM && !focusB && !anim && !vel && now - lastUse > 1500 && introDone;

  // ---------- textures (per tower, per look) ----------
  const TX = 4; // backs and sides: 4 px per unit
  function wallTex(b, wu, seed, day) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, R(wu * TX));
    c.height = Math.max(1, R(b.Hb * TX));
    const x = c.getContext("2d");
    const pl = b.pal[day ? "d" : "n"];
    const gr = x.createLinearGradient(0, 0, 0, c.height);
    gr.addColorStop(0, pl.top0);
    gr.addColorStop(0.5, pl.body);
    gr.addColorStop(1, pl.bot0);
    x.fillStyle = gr;
    x.fillRect(0, 0, c.width, c.height);
    const n = Math.max(1, Math.floor(wu - 0.4));
    const off = (wu - n) / 2;
    for (let r = 0; r < b.r; r++)
      for (let k = 0; k < n; k++) {
        const h = K.hash(seed * 977 + r * 131 + k * 17 + b.gi * 7);
        if (day) x.fillStyle = h > 0.9 ? "rgba(255,255,255,0.7)" : h > 0.55 ? "rgba(196,204,252,0.75)" : "rgba(150,158,232,0.7)";
        else x.fillStyle = h > 0.965 ? "rgba(255,210,130,0.55)" : h > 0.9 ? "rgba(150,130,230,0.22)" : "rgba(5,3,14,0.55)";
        x.fillRect(R((off + k + 0.15) * TX), R((0.4 + r + 0.15) * TX), R(0.7 * TX), R(0.7 * TX));
      }
    return c;
  }
  function texOf(b, look) {
    let T = b.tex[look];
    if (!T) T = b.tex[look] = { back: wallTex(b, b.w, 1, look === "d"), side: wallTex(b, b.d, 2, look === "d"), front: null, fk: "" };
    const fk = texVer + "|" + kTex;
    if (T.fk !== fk) {
      T.fk = fk;
      const c = T.front || document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(b.w * kTex));
      c.height = Math.max(1, Math.ceil(b.Hb * kTex));
      const x = c.getContext("2d");
      x.clearRect(0, 0, c.width, c.height);
      x.imageSmoothingEnabled = true;
      facade(x, b, { x: -b.x * kTex, y: b.Hb * kTex, s: kTex }, { day: look === "d", css: s0 / kTex, dpr, cull: null });
      T.front = c;
    }
    return T;
  }
  function dropTex(look) {
    for (const b of blds) {
      const T = b.tex[look];
      if (!T) continue;
      for (const c of [T.back, T.side, T.front]) if (c) c.width = c.height = 1;
      b.tex[look] = null;
    }
  }

  // one facade in a tower transform T = {x, y, s}: screen = (T.x + wx * s, T.y + wy * s), world y < 0 is up.
  // o = { day, css: css px per T unit (picks how much detail a window gets), dpr, cull: [wx0, wx1, wy0, wy1] | null }
  function facade(G, b, T, o) {
    const day = o.day, s = T.s, pl = b.pal[day ? "d" : "n"];
    const X = (wx) => T.x + wx * s, Y = (wy) => T.y + wy * s;
    const rect = (x0, y0, w, h, col) => {
      const a = R(X(x0)), c = R(Y(y0));
      G.fillStyle = col;
      G.fillRect(a, c, Math.max(1, R(X(x0 + w)) - a), Math.max(1, R(Y(y0 + h)) - c));
    };
    const XL = R(X(b.x)), XR = R(X(b.x + b.w)), Y0 = R(Y(b.top)), Y1 = R(Y(0));
    const gr = G.createLinearGradient(0, Y0, 0, Y1);
    gr.addColorStop(0, pl.top0);
    gr.addColorStop(day ? 0.55 : 0.5, pl.body);
    gr.addColorStop(1, pl.bot0);
    G.fillStyle = gr;
    G.fillRect(XL, Y0, XR - XL, Y1 - Y0);
    // lit right edge, shaded left edge, a thin coping line
    rect(b.x + b.w - 0.12, b.top, 0.12, -b.top, pl.lit);
    if (day) {
      G.fillStyle = "rgba(60,48,140,0.12)";
      G.fillRect(XL, Y0, Math.max(1, R(Math.min(b.w * 0.22, 1.1) * s)), Y1 - Y0);
    }
    rect(b.x, b.top, 0.1, -b.top, pl.dark);
    G.fillStyle = day ? pl.dark : pl.lit;
    G.fillRect(XL, Y0, XR - XL, Math.max(1, R(s * 0.06)));
    // lobby: one door (warm-lit at night)
    const cx = b.x + b.w / 2;
    rect(cx - 0.36, -0.7, 0.72, 0.7, pl.door);
    rect(cx - 0.28, -0.62, 0.56, 0.62, pl.doorIn);
    // windows
    const fs = s * WIN;
    const iw = Math.max(1, R(fs));
    const fc = fs * o.css; // the window in css px
    const cl = o.cull;
    for (let j = 0; j < b.c * b.r; j++) {
      const col = j % b.c, rw = Math.floor(j / b.c);
      const wx = b.x + b.pad + col + 0.11, wy = b.top + 0.3 + rw + 0.11;
      if (cl && (wx > cl[1] || wx + 1 < cl[0] || wy > cl[3] || wy + 1 < cl[2])) continue;
      const x = R(X(wx)), y = R(Y(wy));
      const k = j - b.empty;
      if (fc >= 2.5) {
        G.fillStyle = pl.frame;
        const f = Math.max(1, R(s * 0.05));
        G.fillRect(x - f, y - f, iw + f * 2, iw + f * 2);
      }
      if (k < 0) {
        G.fillStyle = day ? glassCol[(b.ids[0] + j) % K.N] : "#0b0819";
        G.fillRect(x, y, iw, iw);
        continue;
      }
      const id = b.ids[k];
      const c = cells[id - 1];
      const on = !!LAMP[c];
      if (fc < 4.5 || (fc < 11 && !on)) {
        G.fillStyle = day ? (on ? dayDot[id - 1] : glassCol[id - 1]) : on ? LAMP[c] : dimCol[id - 1];
        G.fillRect(x, y, iw, iw);
        if (day && on && fc >= 3) {
          // a sliver of the mood on the sill, even far away
          G.fillStyle = LAMP[c];
          G.fillRect(x, y + iw - Math.max(1, R(iw * 0.22)), iw, Math.max(1, R(iw * 0.22)));
        }
        continue;
      }
      let im = null;
      const px = fc * o.dpr;
      if (px > 52) im = K.faceNow(id, faceArrived);
      if (im) G.drawImage(im, x, y, iw, iw);
      else if (px > 26 && a48) K.tile(G, a48, 48, id, x, y, iw);
      else K.tile(G, a24, 24, id, x, y, iw);
      if (day) {
        // the glass: a light sky sheen (heavier on empty flats) and one diagonal glint
        G.fillStyle = on ? "rgba(214,222,255,0.08)" : fc >= 20 ? "rgba(206,212,252,0.4)" : "rgba(206,212,252,0.72)";
        G.fillRect(x, y, iw, iw);
        if (fc >= 8) {
          G.fillStyle = "rgba(255,255,255,0.22)";
          G.beginPath();
          G.moveTo(x, y + iw * 0.62);
          G.lineTo(x + iw * 0.62, y);
          G.lineTo(x + iw * 0.86, y);
          G.lineTo(x, y + iw * 0.86);
          G.closePath();
          G.fill();
        }
      } else if (!on) {
        G.fillStyle = fc >= 20 ? "rgba(8,6,24,0.46)" : "rgba(8,6,24,0.72)"; // close up, dark windows still show the face
        G.fillRect(x, y, iw, iw);
      }
      if (on) {
        const sh = Math.max(1, R(fs * (day ? 0.09 : 0.1)));
        G.fillStyle = LAMP[c];
        G.fillRect(x, y + iw - sh, iw, sh);
      }
    }
    if (day) return;
    // night: a soft bloom around the lit windows
    G.save();
    G.globalCompositeOperation = "lighter";
    G.globalAlpha = 0.55;
    const rr = Math.max(6 / o.css, s * 1.1);
    for (let k = 0; k < b.ids.length; k++) {
      const c = cells[b.ids[k] - 1];
      if (!LAMP[c]) continue;
      const j = k + b.empty;
      const wx = b.x + b.pad + (j % b.c) + 0.5, wy = b.top + 0.3 + Math.floor(j / b.c) + 0.5;
      if (cl && (wx > cl[1] + 1 || wx < cl[0] - 1 || wy > cl[3] + 1 || wy < cl[2] - 1)) continue;
      G.drawImage(glow(LAMP[c]), X(wx) - rr, Y(wy) - rr, rr * 2, rr * 2);
    }
    G.restore();
  }
  // faces arriving one by one: one repaint per batch
  let faceT = 0;
  function faceArrived() {
    if (!faceT) faceT = setTimeout(() => ((faceT = 0), dirty()), 120);
  }
  const glows = {};
  function glow(col) {
    if (glows[col]) return glows[col];
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, col + "88");
    gr.addColorStop(0.35, col + "2c");
    gr.addColorStop(1, col + "00");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return (glows[col] = c);
  }

  // ---------- drawing ----------
  function setA(G, A, k = 1) {
    G.setTransform((dpr * A[0]) / k, (dpr * A[1]) / k, (dpr * A[2]) / k, (dpr * A[3]) / k, dpr * A[4], dpr * A[5]);
  }
  const poly = (pts) => pts.map(scr);
  function fillPoly(G, pts, col) {
    G.fillStyle = col;
    G.beginPath();
    G.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) G.lineTo(pts[i][0], pts[i][1]);
    G.closePath();
    G.fill();
  }
  // the light comes from the sun / moon, high on the right: faces turned right are brighter
  const SH = { n: "4,3,10", d: "66,54,150" };
  const lightOf = (n, day) => {
    const xr = camX(n);
    return day ? 0.1 - 0.1 * xr : 0.42 - 0.22 * xr;
  };
  function shadeRect(G, w, h, a, day) {
    if (a <= 0.01) return;
    G.fillStyle = `rgba(${SH[day ? "d" : "n"]},${a.toFixed(3)})`;
    G.fillRect(0, 0, w, h);
  }
  // a small solid on the roof (setback, tank, crown step)
  function solid(G, b, u0, t0, w, dd, y0, h, col, day) {
    const faces = [
      { n: b.Nw, q: [P(b, u0, t0, y0), P(b, u0 + w, t0, y0), P(b, u0 + w, t0, y0 + h), P(b, u0, t0, y0 + h)] },
      { n: [-b.Nw[0], -b.Nw[1]], q: [P(b, u0, t0 + dd, y0), P(b, u0 + w, t0 + dd, y0), P(b, u0 + w, t0 + dd, y0 + h), P(b, u0, t0 + dd, y0 + h)] },
      { n: b.Rw, q: [P(b, u0 + w, t0, y0), P(b, u0 + w, t0 + dd, y0), P(b, u0 + w, t0 + dd, y0 + h), P(b, u0 + w, t0, y0 + h)] },
      { n: [-b.Rw[0], -b.Rw[1]], q: [P(b, u0, t0, y0), P(b, u0, t0 + dd, y0), P(b, u0, t0 + dd, y0 + h), P(b, u0, t0, y0 + h)] },
    ];
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of faces) {
      if (facing(f.n) <= 0) continue;
      const pts = poly(f.q);
      fillPoly(G, pts, col);
      fillPoly(G, pts, `rgba(${SH[day ? "d" : "n"]},${(lightOf(f.n, day) + (day ? 0.06 : 0)).toFixed(2)})`);
    }
    fillPoly(G, poly([P(b, u0, t0, y0 + h), P(b, u0 + w, t0, y0 + h), P(b, u0 + w, t0 + dd, y0 + h), P(b, u0, t0 + dd, y0 + h)]), b.pal[day ? "d" : "n"].roof);
  }
  function tower(G, b, look, now, live) {
    const day = look === "d";
    const pl = b.pal[look];
    const polys = [];
    let front = null;
    const T = texOf(b, look);
    const nBack = [-b.Nw[0], -b.Nw[1]], nL = [-b.Rw[0], -b.Rw[1]];
    // back
    if (facing(nBack) > 0) {
      const A = aff(P(b, b.w, b.d, b.Hb), v3(nL), Y3);
      setA(G, A, TX);
      G.drawImage(T.back, 0, 0);
      shadeRect(G, T.back.width, T.back.height, lightOf(nBack, day) + (day ? 0.05 : 0.08), day);
      polys.push(poly([P(b, b.w, b.d, b.Hb), P(b, 0, b.d, b.Hb), P(b, 0, b.d, 0), P(b, b.w, b.d, 0)]));
    }
    // sides
    for (const [n, o, U] of [[nL, P(b, 0, b.d, b.Hb), v3(b.Nw)], [b.Rw, P(b, b.w, 0, b.Hb), v3(nBack)]]) {
      if (facing(n) <= 0) continue;
      const A = aff(o, U, Y3);
      setA(G, A, TX);
      G.drawImage(T.side, 0, 0);
      shadeRect(G, T.side.width, T.side.height, lightOf(n, day) + (day ? 0.08 : 0.12), day);
      const u2 = [o[0] + U[0] * b.d, o[1], o[2] + U[2] * b.d];
      polys.push(poly([o, u2, [u2[0], 0, u2[2]], [o[0], 0, o[2]]]));
    }
    // the facade: the tower drawing, skewed onto the wall (cached texture; the framed tower is painted live)
    if (facing(b.Nw) > 0.01) {
      const A = frontAff(b);
      const Ab = aff(P(b, 0, 0, b.Hb), v3(b.Rw), Y3);
      if (live) {
        const fsc = Math.hypot(A[0], A[1]); // css px per unit along the wall
        const k = Math.max(0.5, Math.min(Math.hypot(A[2], A[3]), fsc * 1.4));
        // what of the facade is on screen (in world units of the facade drawing)
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
          const q = inv(Ab, x, y);
          if (!q) continue;
          u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]);
        }
        setA(G, Ab, k);
        G.save();
        G.beginPath();
        G.rect(0, 0, b.w * k + 0.5, b.Hb * k + 0.5);
        G.clip();
        facade(G, b, { x: -b.x * k, y: b.Hb * k, s: k }, { day, css: fsc / k, dpr, cull: [b.x + u0, b.x + u1, v0 - b.Hb, v1 - b.Hb] });
        G.restore();
        const lf = lightOf(b.Nw, day) - (day ? 0.08 : 0.3);
        if (lf > 0.01) shadeRect(G, b.w * k, b.Hb * k, lf, day);
      } else {
        setA(G, Ab, kTex);
        G.drawImage(T.front, 0, 0);
        const lf = lightOf(b.Nw, day) - (day ? 0.08 : 0.3);
        if (lf > 0.01) shadeRect(G, T.front.width, T.front.height, lf, day);
      }
      front = A;
      polys.push(poly([P(b, 0, 0, b.Hb), P(b, b.w, 0, b.Hb), P(b, b.w, 0, 0), P(b, 0, 0, 0)]));
    }
    // roof + a little furniture
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rp = poly([P(b, 0, 0, b.Hb), P(b, b.w, 0, b.Hb), P(b, b.w, b.d, b.Hb), P(b, 0, b.d, b.Hb)]);
    fillPoly(G, rp, pl.roof);
    G.strokeStyle = day ? pl.edge : pl.lit;
    G.lineWidth = Math.max(0.6, cam.s * 0.05);
    G.beginPath();
    G.moveTo(rp[0][0], rp[0][1]);
    for (let i = 1; i < 4; i++) G.lineTo(rp[i][0], rp[i][1]);
    G.closePath();
    G.stroke();
    polys.push(rp);
    if (!b.shop) {
      const cu = b.w / 2, ct = b.d / 2;
      if (b.roof === 0 && b.c >= 4) solid(G, b, 0.7, 0.4, b.w - 1.4, b.d - 0.8, b.Hb, 0.6, pl.body, day);
      else if (b.roof === 2 && b.c >= 4) {
        for (let q = 0; q < 3; q++) {
          const ww = (1.5 - q * 0.45) * 2;
          solid(G, b, cu - ww / 2, Math.max(0.2, ct - ww / 3), ww, Math.min(b.d - 0.4, (ww * 2) / 3), b.Hb + q * 0.4, 0.41, pl.body, day);
        }
      } else if (b.roof === 3 && b.c >= 3) solid(G, b, b.w * 0.66, ct - 0.5, Math.min(1.2, b.w * 0.2), 1, b.Hb, 0.5, pl.dark, day);
      else if (b.roof === 1) {
        solid(G, b, cu - 0.4, ct - 0.4, 0.8, 0.8, b.Hb, 0.6, pl.body, day);
        const a = scr(P(b, cu, ct, b.Hb + 0.6)), tp = scr(P(b, cu, ct, b.Hb + 0.6 + ROOFU * 1.4));
        G.strokeStyle = day ? pl.dark : pl.lit;
        G.lineWidth = Math.max(1, cam.s * 0.12);
        G.beginPath();
        G.moveTo(a[0], a[1]);
        G.lineTo(tp[0], tp[1]);
        G.stroke();
        const r = Math.max(1.5, cam.s * 0.16);
        if (day) G.fillStyle = "#ffffff";
        else {
          const blink = RM ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(now / 700 + b.gi));
          G.fillStyle = `rgba(255,79,94,${blink.toFixed(2)})`;
        }
        G.fillRect(R(tp[0] - r / 2), R(tp[1] - r / 2), R(r), R(r));
      }
    }
    return { b, polys, front };
  }

  // ---------- sky ----------
  let stars = [];
  function makeStars() {
    const n = R(K.clamp((W * H) / 9000, 40, 200));
    return Array.from({ length: n }, (_, i) => ({ x: K.hash(i * 3 + 11), y: K.hash(i * 3 + 12), b: K.hash(i * 3 + 13) }));
  }
  const orbR = () => K.clamp(Math.min(W, H) * 0.03, 11, 24);
  const orbAt = () => {
    const mr = orbR();
    return { x: W * (phone ? 0.86 : 0.83), y: phone ? headB + mr + 14 : Math.max(mr + 40, H * 0.2), r: mr }; // phone: under the centred heading
  };
  const sprites = {};
  function orbSprite(day, mr) {
    const key = (day ? "s" : "m") + R(mr * dpr);
    if (sprites[key]) return sprites[key];
    const k = mr * (day ? 1.1 : 1);
    const pad = R(k * (day ? 6 : 5));
    const c = document.createElement("canvas");
    c.width = c.height = R(pad * 2 * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const halo = g.createRadialGradient(pad, pad, k * 0.8, pad, pad, pad);
    halo.addColorStop(0, day ? "rgba(255,248,226,0.5)" : "rgba(240,232,200,0.12)");
    halo.addColorStop(1, day ? "rgba(255,248,226,0)" : "rgba(240,232,200,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, pad * 2, pad * 2);
    const p = Math.max(2, R(k / 7));
    for (let yy = -k; yy <= k; yy += p)
      for (let xx = -k; xx <= k; xx += p) {
        const dd = Math.hypot(xx + p / 2, yy + p / 2);
        if (dd > k) continue;
        if (day) g.fillStyle = dd > k - p * 1.2 ? "#ffe6b8" : Math.hypot(xx + p / 2 + k * 0.35, yy + p / 2 + k * 0.35) < k * 0.35 ? "#ffffff" : "#fff8ea";
        else g.fillStyle = Math.hypot(xx + p / 2 + k * 0.45, yy + p / 2 - k * 0.2) < k * 0.95 ? "#e9dfbd" : "#f7f1dc";
        g.fillRect(R(pad + xx), R(pad + yy), p, p);
      }
    if (!day) {
      g.fillStyle = "rgba(190,176,130,0.35)";
      for (const [a, b2, r] of [[0.28, -0.36, 0.16], [-0.3, 0.2, 0.12], [0.34, 0.32, 0.09]]) g.fillRect(R(pad + a * k), R(pad + b2 * k), R(r * k * 2), R(r * k * 2));
    }
    return (sprites[key] = { c, pad });
  }
  function cloudSprite(n, seed) {
    const p = Math.max(3, R(orbR() / 6));
    const key = `c${n}|${seed}|${p}|${dpr}`;
    if (sprites[key]) return sprites[key];
    const ch = Math.ceil(n * 0.38);
    const puffs = [];
    for (let i = 0; i < 4; i++) {
      const u = (i + 0.5) / 4;
      puffs.push({ x: (u - 0.5) * n * 0.78, r: ch * (0.48 + 0.55 * Math.sin(u * Math.PI) * (0.75 + K.hash(seed * 9 + i) * 0.25)) });
    }
    const inside = (x, y) => y <= 0 && puffs.some((q) => Math.hypot(x - q.x, (y + ch * 0.25) * 1.2) <= q.r);
    const w = (n * 2 + 1) * p, h = (ch * 2 + 1) * p;
    const c = document.createElement("canvas");
    c.width = R(w * dpr);
    c.height = R(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    for (let y = -ch * 2; y <= 0; y++)
      for (let x = -n; x <= n; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const topE = !inside(x + 0.5, y - 0.5), belly = y >= -1;
        g.fillStyle = topE ? "#ffffff" : belly ? "rgba(214,212,250,0.96)" : "rgba(246,245,255,0.96)";
        g.fillRect((x + n) * p, (y + ch * 2) * p, p, p);
      }
    return (sprites[key] = { c, w, h, ox: n * p, oy: ch * 2 * p });
  }
  function sky(G, day, gy, now, zr) {
    const sk = G.createLinearGradient(0, 0, 0, Math.max(10, gy));
    if (day) {
      sk.addColorStop(0, "#8592ee");
      sk.addColorStop(0.5, "#a3adf6");
      sk.addColorStop(0.85, "#c9cdfc");
      sk.addColorStop(1, "#e4e1ff");
    } else {
      sk.addColorStop(0, "#05040b");
      sk.addColorStop(0.45, "#0a0818");
      sk.addColorStop(0.8, "#151033");
      sk.addColorStop(1, "#231845");
    }
    G.fillStyle = sk;
    G.fillRect(0, 0, W, H);
    // a faint glow on the horizon (city lights at night, haze by day)
    const cg = G.createRadialGradient(W / 2, gy, 0, W / 2, gy, Math.max(W, H) * 0.55);
    cg.addColorStop(0, day ? "rgba(255,255,255,0.24)" : "rgba(150,120,255,0.10)");
    cg.addColorStop(1, day ? "rgba(255,255,255,0)" : "rgba(150,120,255,0)");
    G.fillStyle = cg;
    G.fillRect(0, 0, W, H);
    const pan = cam.th * W * 0.12;
    const vis = 1 - K.clamp((zr - 1.15) / 0.5, 0, 1); // close up, sun / moon / clouds step out of the way
    if (day) {
      if (vis > 0) {
        G.globalAlpha = vis;
        const list = phone ? [[0.28, 0.34, 11, 1]] : [[0.36, 0.3, 15, 1], [0.6, 0.62, 11, 2], [0.08, 0.7, 9, 3]];
        for (const [fx2, fy2, n, seed] of list) {
          const sp1 = cloudSprite(n, seed);
          const span = W + sp1.w * 2;
          const x = ((((W * fx2 - pan * (0.6 + seed * 0.15)) % span) + span) % span) - sp1.w;
          const y = Math.max(headB + 26, 0) + (Math.max(gy, H * 0.3) - headB) * fy2 * 0.55;
          G.drawImage(sp1.c, R(x - sp1.ox), R(y - sp1.oy), sp1.w, sp1.h);
        }
        G.globalAlpha = 1;
      }
    } else {
      const sh = pan * 0.25;
      for (const st of stars) {
        const x = (((st.x * (W + 40) - sh) % (W + 40)) + W + 40) % (W + 40) - 20;
        const y = st.y * gy * 0.85;
        if (y > gy) continue;
        const fade = 1 - Math.max(0, (y / gy - 0.45) / 0.35);
        const live = st.b > 0.94;
        const tw = live && !RM ? 0.6 + 0.4 * Math.sin(now / 900 + st.b * 80) : 0.7;
        const a = (0.12 + 0.5 * st.b * tw) * fade;
        if (a <= 0.03) continue;
        G.fillStyle = `rgba(226,222,255,${a.toFixed(2)})`;
        const z = live ? 2 : 1;
        G.fillRect(R(x), R(y), z, z);
      }
    }
    if (vis > 0) {
      const o = orbAt();
      const sp1 = orbSprite(day, o.r);
      G.globalAlpha = vis;
      G.drawImage(sp1.c, R(o.x - sp1.pad), R(o.y - sp1.pad), sp1.pad * 2, sp1.pad * 2);
      G.globalAlpha = 1;
    }
  }
  // a far skyline silhouette standing on the horizon
  function farLayer(G, gy, pan, seed, col, hMin, hMax, slot, area) {
    const k0 = Math.floor((pan - W / 2) / slot) - 2, k1 = Math.ceil((pan + W / 2) / slot) + 2;
    G.fillStyle = col;
    for (let k = k0; k <= k1; k++) {
      for (let q = 0; q < 2; q++) {
        const hs = K.hash(seed * 7919 + k * 31 + q * 7);
        if (q === 1 && hs < 0.5) continue;
        const w = slot * (0.45 + K.hash(seed + k * 13 + q) * 0.5);
        const x = W / 2 + k * slot - pan + (q ? slot * 0.5 : 0) - w / 2;
        const h = (hMin + (hMax - hMin) * hs) * area;
        const top = gy - h;
        G.fillRect(R(x), R(top), R(w), R(gy - top + 2));
        if (K.hash(seed * 3 + k * 5 + q) < 0.25) G.fillRect(R(x + w * 0.45), R(top - h * 0.1), Math.max(1, R(w * 0.05)), R(h * 0.1));
      }
    }
  }

  // ---------- ground: the land, a ring road with lamps, the plaza and its pond ----------
  function ground(G, day, gy, now) {
    const g0 = Math.max(0, gy);
    if (g0 < H) {
      const gg = G.createLinearGradient(0, g0, 0, H);
      gg.addColorStop(0, day ? "#cdc8f6" : "#0d0a20");
      gg.addColorStop(1, day ? "#b4adeb" : "#07060f");
      G.fillStyle = gg;
      G.fillRect(0, g0, W, H - g0);
    }
    const c0 = scr([0, 0, 0]);
    const ell = (r, col, stroke) => {
      G.beginPath();
      G.ellipse(c0[0], c0[1], Math.max(0.1, r * cam.s), Math.max(0.1, r * cam.s * sp), 0, 0, TAU);
      if (stroke) {
        G.strokeStyle = col;
        G.lineWidth = stroke;
        G.stroke();
      } else {
        G.fillStyle = col;
        G.fill();
      }
    };
    const outer = RR + maxD + 2.4;
    if (day) {
      ell(RR + maxD + 5, "#c2bcf0");
      ell(outer, "#a6a0d8");
      ell(outer - 0.9, "rgba(255,255,255,0.28)", Math.max(1, cam.s * 0.08));
      ell(outer, "rgba(255,255,255,0.45)", 1);
      ell(RR - 1.2, "#dcd7fa");
      ell(RR - 1.2, "rgba(255,255,255,0.7)", 1.2);
      ell(RR * 0.62, "rgba(150,140,226,0.16)", Math.max(1, cam.s * 0.12));
      // a round pond in the middle of the plaza, mirroring the sky
      ell(RR * 0.36 + 0.5, "#f1efff");
      ell(RR * 0.36, "#a9b1f4");
      ell(RR * 0.26, "rgba(214,220,255,0.5)");
    } else {
      ell(RR + maxD + 5, "#100c25");
      ell(outer, "#0b0819");
      ell(outer, "rgba(160,140,230,0.10)", 1);
      ell(RR - 1.2, "#150f30");
      ell(RR - 1.2, "rgba(160,140,230,0.16)", 1);
      ell(RR * 0.62, "rgba(150,120,255,0.06)", Math.max(1, cam.s * 0.12));
      ell(RR * 0.36 + 0.5, "#1d1640");
      ell(RR * 0.36, "#0a0820");
      ell(RR * 0.26, "rgba(120,100,230,0.08)");
    }
    // the sun / moon caught in the pond: a soft sheen on its far side
    G.fillStyle = day ? "rgba(255,255,255,0.32)" : "rgba(240,232,200,0.07)";
    G.beginPath();
    G.ellipse(c0[0] + RR * 0.08 * cam.s, c0[1] - RR * 0.12 * cam.s * sp, RR * 0.13 * cam.s, Math.max(0.5, RR * 0.05 * cam.s * sp), 0, 0, TAU);
    G.fill();
    // lamps on the ring road (warm dots at night, quiet posts by day)
    const lr = RR + maxD + 3.6;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const p = scr([lr * Math.sin(a), 0, lr * Math.cos(a)]);
      if (p[0] < -10 || p[0] > W + 10 || p[1] < -10 || p[1] > H + 10) continue;
      const z = Math.max(1, R(cam.s * 0.15));
      if (day) {
        G.fillStyle = "rgba(90,78,170,0.55)";
        G.fillRect(R(p[0]), R(p[1] - z * 2), z, z * 2);
        continue;
      }
      const rr = Math.max(4, cam.s * 1.4);
      G.globalAlpha = 0.5;
      G.drawImage(glow("#ffd27a"), p[0] - rr, p[1] - rr * sp, rr * 2, rr * 2 * sp);
      G.globalAlpha = 1;
      G.fillStyle = "#ffe3a8";
      G.fillRect(R(p[0]), R(p[1] - z), z, z);
    }
  }
  // by day every tower casts a soft shadow onto the plaza, away from the sun (high on the right, behind the ring)
  function shadows(G) {
    // the shadow direction in camera space (left, toward the viewer), back into world space
    const xr = -0.62, zr = 0.42;
    const dx = xr * cth - zr * sth, dz = xr * sth + zr * cth;
    G.beginPath();
    for (const b of blds) {
      const L = b.Hb * 0.34;
      const pts = [];
      for (const [u, tt] of [[0, 0], [b.w, 0], [b.w, b.d], [0, b.d]]) {
        const p = P(b, u, tt, 0);
        pts.push(scr(p), scr([p[0] + dx * L, 0, p[2] + dz * L]));
      }
      const h = hull(pts);
      G.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) G.lineTo(h[i][0], h[i][1]);
      G.closePath();
    }
    G.fillStyle = "rgba(84,70,176,0.13)";
    G.fill("nonzero");
  }
  // convex hull (monotone chain), always the same winding so the union of all shadows fills once
  function hull(p) {
    p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // ---------- one whole look (day or night) ----------
  let dimV = 0; // 0..1: everything but the framed tower steps back
  function scene(G, look, now, keepHits) {
    const day = look === "d";
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    G.globalAlpha = 1;
    G.globalCompositeOperation = "source-over";
    G.imageSmoothingEnabled = true;
    G.imageSmoothingQuality = "low";
    // horizon: just behind the far side of the ring
    const gy = K.clamp(cyA + cam.s * (-(RR + maxD + 10) * sp - fy), -H, H * 2);
    const zr = cam.s / s0;
    sky(G, day, Math.max(gy, 20), now, zr);
    if (gy > 0 && gy < H * 1.2) {
      const area = Math.min(gy, H) * 0.55;
      const pan = cam.th * W * 0.9;
      G.globalAlpha = 1 - K.clamp((zr - 1) / 2.5, 0, 0.6);
      farLayer(G, gy, pan * 0.3, 3, day ? "#bdb9f2" : "#150f33", 0.18, 0.5, 30, area);
      farLayer(G, gy, pan * 0.55, 7, day ? "#aaa4ea" : "#0f0b26", 0.1, 0.34, 38, area);
      G.globalAlpha = 1;
    }
    sides.sky(G, look, now, sideV);
    ground(G, day, gy, now);
    sides.ground(G, look, sideV);
    if (day) shadows(G);
    // towers far to near
    const order = blds.map((b) => ({ b, z: -b.ctr[0] * sth + b.ctr[1] * cth })).sort((a, c) => a.z - c.z);
    const hs = [];
    const dk = dimV;
    for (const { b } of order) {
      if (focusB && b === focusB && dk > 0.02) continue;
      hs.push(tower(G, b, look, now, focusB === b));
    }
    if (focusB && dk > 0.02) {
      // everything else steps back (into the dark at night, into the haze by day), the framed tower on top
      G.setTransform(dpr, 0, 0, dpr, 0, 0);
      G.fillStyle = day ? `rgba(214,210,250,${(0.64 * dk).toFixed(3)})` : `rgba(6,4,14,${(0.8 * dk).toFixed(3)})`;
      G.fillRect(0, 0, W, H);
      hs.push(tower(G, focusB, look, now, true));
    }
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    sides.people(G, look, now, sideV);
    if (keepHits) {
      hits = hs;
      frontOf = new Map(hs.map((h) => [h.b, h.front]));
    }
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    return gy;
  }

  // ---------- labels ----------
  const signs = new Map();
  function label(text, px, col, day, weight = 700) {
    const key = text + "|" + px + "|" + col + "|" + dpr + "|" + day + "|" + weight;
    if (signs.has(key)) return signs.get(key);
    const font = weight === 700 ? `700 ${px}px Silkscreen, monospace` : `400 ${px}px "Departure Mono", ui-monospace, monospace`;
    const mg = document.createElement("canvas").getContext("2d");
    mg.font = font;
    const w = Math.ceil(mg.measureText(text).width) + 2, h = Math.ceil(px * 1.25);
    const c = document.createElement("canvas");
    c.width = Math.max(1, R(w * dpr));
    c.height = Math.max(1, R(h * dpr));
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    x.font = font;
    x.textBaseline = "top";
    x.fillStyle = day ? "rgba(255,255,255,0.7)" : "rgba(5,4,12,0.85)";
    x.fillText(text, 1, 1);
    x.fillStyle = col;
    x.fillText(text, 0, 0);
    const o = { c, w, h };
    if (signs.size > 400) signs.clear();
    signs.set(key, o);
    return o;
  }
  function blit(G, sp1, x, y, a = 1) {
    if (a <= 0) return;
    G.globalAlpha = a;
    G.drawImage(sp1.c, R(x), R(y), sp1.w, sp1.h);
    G.globalAlpha = 1;
  }
  function pill(G, sp1, x, y, a, day, padX = 8, padY = 5) {
    if (a <= 0) return null;
    G.globalAlpha = a * (day ? 0.8 : 0.9);
    G.fillStyle = day ? "rgba(250,249,255,0.92)" : "rgba(10,8,22,0.92)";
    const w = sp1.w + padX * 2, h = sp1.h + padY * 2;
    G.beginPath();
    if (G.roundRect) G.roundRect(R(x - padX), R(y - padY), R(w), R(h), 6);
    else G.rect(R(x - padX), R(y - padY), R(w), R(h));
    G.fill();
    G.globalAlpha = 1;
    blit(G, sp1, x, y, a);
    return { x: x - padX, y: y - padY, w, h };
  }

  // ---------- overlay: the hovered tower / face, your Chog, a flash on pick, the framed tower's name ----------
  function winQuad(b, id) {
    const A = frontOf.get(b);
    if (!A) return null;
    const k = slotK[id] + b.empty;
    const u = b.pad + (k % b.c) + 0.11 + 0, v = b.Hh + b.top + 0.3 + Math.floor(k / b.c) + 0.11;
    const at = (du, dv) => [A[0] * (u + du) + A[2] * (v + dv) + A[4], A[1] * (u + du) + A[3] * (v + dv) + A[5]];
    return [at(0, 0), at(WIN, 0), at(WIN, WIN), at(0, WIN)];
  }
  function strokeQuad(G, p, col, lw, grow = 0) {
    const cx = (p[0][0] + p[2][0]) / 2, cy = (p[0][1] + p[2][1]) / 2;
    G.strokeStyle = col;
    G.lineWidth = lw;
    G.beginPath();
    for (let i = 0; i < 4; i++) {
      const dx = p[i][0] - cx, dy = p[i][1] - cy, l = Math.hypot(dx, dy) || 1;
      const x = p[i][0] + (dx / l) * grow, y = p[i][1] + (dy / l) * grow;
      i ? G.lineTo(x, y) : G.moveTo(x, y);
    }
    G.closePath();
    G.stroke();
  }
  let nameV = 0, pillRect = null;
  function overlay(G, now, day) {
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the hovered tower (whole-city view): a hairline outline and its name above the roof
    if (hover && hover.b && !hover.id && !anim && (!focusB || hover.b !== focusB)) {
      const b = hover.b;
      const h = hits.find((q) => q.b === b);
      const tint = day ? b.tintD : b.tint;
      if (h && !focusB) {
        G.globalAlpha = 0.6;
        for (const p of h.polys) {
          G.strokeStyle = tint;
          G.lineWidth = 1;
          G.beginPath();
          p.forEach(([x, y], i) => (i ? G.lineTo(x, y) : G.moveTo(x, y)));
          G.closePath();
          G.stroke();
        }
        G.globalAlpha = 1;
      }
      const top = scr(P(b, b.w / 2, b.d / 2, b.Hb + ROOFU * 2));
      const sp1 = label(b.name, 8, tint, day);
      pill(G, sp1, K.clamp(top[0] - sp1.w / 2, 12, W - sp1.w - 12), K.clamp(top[1] - sp1.h - 10, 12, H - 30), 0.95, day, 6, 4);
    }
    // your Chog: a gold frame (a glow at night) and its number
    if (petId && towerOf[petId]) {
      const b = towerOf[petId];
      const q = winQuad(b, petId);
      const show = !focusB || b === focusB;
      if (show && q) {
        const ws = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
        const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
        if (cx > -60 && cx < W + 60 && cy > -60 && cy < H + 60) {
          if (day) {
            strokeQuad(G, q, "rgba(46,30,140,0.85)", 1, 3.5);
            strokeQuad(G, q, "#ffd84d", 2, 2);
          } else {
            G.save();
            G.globalCompositeOperation = "lighter";
            const rr = Math.max(10, ws * 2.3) * (RM ? 1 : 1 + 0.08 * Math.sin(now / 600));
            G.globalAlpha = 0.7;
            G.drawImage(glow("#ffd84d"), cx - rr, cy - rr, rr * 2, rr * 2);
            G.restore();
            strokeQuad(G, q, "rgba(255,216,77,0.9)", 1.5, 2);
          }
          const sp1 = label(`#${K.num(petId)}`, 8, day ? "#2e1e8c" : "#ffd84d", day);
          let ly = Math.min(q[0][1], q[1][1]) - sp1.h - 6;
          if (ly < 6) ly = Math.max(q[2][1], q[3][1]) + 6;
          blit(G, sp1, K.clamp(cx - sp1.w / 2, 4, W - sp1.w - 4), ly, 0.95);
        }
      } else if (show && !focusB) {
        // its facade is turned away: a small pin over the roof
        const tp = scr(P(b, b.w / 2, b.d / 2, b.Hb + ROOFU * 1.2));
        const sp1 = label(`#${K.num(petId)}`, 8, day ? "#2e1e8c" : "#ffd84d", day);
        G.fillStyle = day ? "#2e1e8c" : "#ffd84d";
        G.fillRect(R(tp[0]) - 1, R(tp[1]) - 1, 3, 3);
        blit(G, sp1, K.clamp(tp[0] - sp1.w / 2, 4, W - sp1.w - 4), tp[1] - sp1.h - 6, 0.9);
      }
    }
    // the hovered face (inside a tower)
    if (hover && hover.id && focusB && hover.b === focusB && !anim) {
      const p = winQuad(hover.b, hover.id);
      if (p) strokeQuad(G, p, day ? "rgba(46,30,140,0.9)" : "rgba(245,240,255,0.92)", 1.5, 2);
    }
    if (flash && now - flash.t0 < 900) {
      const p = winQuad(flash.b, flash.id);
      if (p) {
        const tt = (now - flash.t0) / 900;
        const ws = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
        strokeQuad(G, p, day ? `rgba(46,30,140,${(1 - tt).toFixed(2)})` : `rgba(255,216,77,${(1 - tt).toFixed(2)})`, 2, 3 + tt * ws * 1.2);
      }
    }
  }
  // the framed tower's name, centred at the top (over the soft edge); on touch it doubles as the way back
  function focusName(G, day) {
    const want = focusB && !anim ? 1 : 0;
    if (RM) nameV = want;
    else {
      nameV += (want - nameV) * 0.2;
      if (Math.abs(want - nameV) < 0.02) nameV = want;
    }
    pillRect = null;
    if (!focusB || nameV <= 0) return;
    const b = focusB;
    const n = b.ids.length;
    let on = 0;
    for (const id of b.ids) if (cells[id - 1] !== "0") on++;
    const txt = `${FINE ? "" : "‹ "}${b.name} · ${n}${on ? ` · ${on} ${day ? "home" : "lit"}` : ""}`;
    const sp1 = label(txt, phone ? 8 : 10, day ? b.tintD : b.tint, day);
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    pillRect = pill(G, sp1, W / 2 - sp1.w / 2, H * (phone ? 0.055 : 0.06), nameV, day, 10, 6);
  }

  // ---------- frame ----------
  // 30 fps for the drift while on screen and visible; full rate only while the camera flies / is dragged.
  let raf = 0, last = 0, onScreen = false, want = true, lastT = 0;
  const mixC = document.createElement("canvas"), mixG = mixC.getContext("2d");
  function kick() {
    if (!raf && W) raf = requestAnimationFrame(frame);
  }
  function dirty() {
    want = true;
    kick();
  }
  const smooth = (x) => x * x * (3 - 2 * x);
  let fadeK = "", fadeT = null, fadeB = null, skyGlow = null, skyGlowK = "", shownLook = "";
  function frame(now) {
    raf = 0;
    if (!W) return;
    const dt = Math.min(60, lastT ? now - lastT : 16);
    lastT = now;
    let moving = stepCam(now, dt);
    const drift = drifting(now) && onScreen && !document.hidden;
    const dimT = focusB ? 1 : 0;
    if (dimV !== dimT) {
      dimV = RM ? dimT : dimV + (dimT - dimV) * 0.14;
      if (Math.abs(dimT - dimV) < 0.01) dimV = dimT;
      moving = true;
    }
    const settling = (nameV > 0 && nameV < 1) || (flash && now - flash.t0 < 900) || (focusB && !anim && nameV < 1);
    const k = smooth(K.clamp(skyT, 0, 1));
    const look = k <= 0 ? "d" : k >= 1 ? "n" : "dn";
    if (look !== shownLook) (shownLook = look), (want = true);
    const life = onScreen && !document.hidden && sideV > 0 && sides.busy();
    if (want || moving || settling || ((drift || life) && now - last >= 32)) {
      // the ring turns slowly on its own (about one full turn a minute); after any touch it eases back up to speed
      if (drift && !moving) {
        if (!driftT0) driftT0 = now;
        const ease = Math.min(1, (now - driftT0) / 1800);
        cam.th += Math.min(now - last, 70) * DRIFT * driftDir * ease * ease * (3 - 2 * ease);
      } else if (!drift) driftT0 = 0;
      last = now;
      want = false;
      draw(now, k);
    }
    if (moving || settling || want || drift || life) kick();
  }
  // the empty sides (js/skysides.js) are laid out for the whole-city view and fade out while the camera moves in
  let sideV = 0;
  function sidesGeo(k) {
    const sP = Math.sin(PITCH), cP = Math.cos(PITCH);
    const fy0 = -F0[1] * cP;
    const Y = (v) => H / 2 + s0 * (v - fy0);
    const rr = RR + maxD;
    return {
      W, H, dpr, phone, night: k >= 0.5, cx: W / 2, cy: Y(0),
      rxR: rr * s0, ryR: rr * s0 * sP, rxG: (rr + 5) * s0, ryG: (rr + 5) * s0 * sP, rxL: (rr + 3.6) * s0, ryL: (rr + 3.6) * s0 * sP,
      gy: K.clamp(Y(-(rr + 10) * sP), 0, H), headB, ringTop: Y(-rr * sP - maxH * cP), p: Math.max(3, R(orbR() / 6)),
    };
  }
  function draw(now, k) {
    setup();
    sideV = K.clamp(1 - (cam.s / s0 - 1.02) / 0.25, 0, 1) * (1 - dimV);
    sides.tick(now, sidesGeo(k), onScreen && !document.hidden);
    const G = G0;
    G.setTransform(1, 0, 0, 1, 0, 0);
    G.globalAlpha = 1;
    G.globalCompositeOperation = "source-over";
    G.clearRect(0, 0, cv.width, cv.height);
    let gy;
    if (k < 1) gy = scene(G, "d", now, true);
    if (k >= 1) gy = scene(G, "n", now, true);
    else if (k > 0) {
      // a dusk / dawn: the night look over the day one, and a warm band low over the city
      if (mixC.width !== cv.width || mixC.height !== cv.height) (mixC.width = cv.width), (mixC.height = cv.height);
      mixG.setTransform(1, 0, 0, 1, 0, 0);
      mixG.clearRect(0, 0, mixC.width, mixC.height);
      scene(mixG, "n", now, false);
      G.setTransform(1, 0, 0, 1, 0, 0);
      G.globalAlpha = k;
      G.drawImage(mixC, 0, 0);
      G.globalAlpha = 1;
      G.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gk = `${H}|${R(gy)}`;
      if (gk !== skyGlowK) {
        skyGlowK = gk;
        skyGlow = G.createLinearGradient(0, gy - H * 0.55, 0, gy + H * 0.4);
        skyGlow.addColorStop(0, "rgba(255,142,228,0)");
        skyGlow.addColorStop(0.6, "rgba(255,150,210,0.3)");
        skyGlow.addColorStop(1, "rgba(255,180,160,0.08)");
      }
      G.globalAlpha = Math.sin(k * Math.PI);
      G.fillStyle = skyGlow;
      G.fillRect(0, 0, W, H);
      G.globalAlpha = 1;
    }
    // only the look on screen keeps its textures
    if (k <= 0 && blds[0] && blds[0].tex.n) dropTex("n");
    if (k >= 1 && blds[0] && blds[0].tex.d) dropTex("d");
    if ((k <= 0 || k >= 1) && mixC.width > 1) mixC.width = mixC.height = 1;
    const day = k < 0.5;
    G.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlay(G, now, day);
    // soft top/bottom edges into the page (painted here: a CSS mask would re-composite the big canvas every frame)
    const fk = `${H}|${phone}`;
    if (fk !== fadeK) {
      fadeK = fk;
      const a = H * (phone ? 0.1 : 0.12), b = H * (phone ? 0.9 : 0.86);
      fadeT = G.createLinearGradient(0, 0, 0, a);
      fadeT.addColorStop(0, "rgba(0,0,0,1)");
      fadeT.addColorStop(1, "rgba(0,0,0,0)");
      fadeB = G.createLinearGradient(0, b, 0, H);
      fadeB.addColorStop(0, "rgba(0,0,0,0)");
      fadeB.addColorStop(1, "rgba(0,0,0,1)");
      fadeB.y0 = b;
      fadeT.y1 = a;
    }
    G.globalCompositeOperation = "destination-out";
    G.fillStyle = fadeT;
    G.fillRect(0, 0, W, fadeT.y1);
    G.fillStyle = fadeB;
    G.fillRect(0, fadeB.y0, W, H - fadeB.y0);
    if (nameV > 0.01) {
      // inside a tower: a deeper soft edge at the top, so the name sits on the page instead of on faces
      const fe = H * (phone ? 0.15 : 0.14);
      const fg = G.createLinearGradient(0, 0, 0, fe);
      fg.addColorStop(0, `rgba(0,0,0,${nameV.toFixed(3)})`);
      fg.addColorStop(0.55, `rgba(0,0,0,${(0.85 * nameV).toFixed(3)})`);
      fg.addColorStop(1, "rgba(0,0,0,0)");
      G.fillStyle = fg;
      G.fillRect(0, 0, W, fe);
    }
    G.globalCompositeOperation = "source-over";
    focusName(G, day); // over the soft edge, so it stays crisp
  }

  // ---------- input ----------
  function pointIn(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** screen point -> {b, id?, q: facade coords} | null (nearest tower first) */
  function hitAt(x, y) {
    setup();
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (!h.polys.some((p) => pointIn(p, x, y))) continue;
      if (h.front) {
        const q = inv(h.front, x, y);
        if (q && q[0] >= 0 && q[0] <= h.b.w && q[1] >= ROOFU && q[1] <= h.b.Hh) {
          const b = h.b;
          const col = Math.floor(q[0] - b.pad), rw = Math.floor(q[1] - b.Hh - b.top - 0.3);
          if (col >= 0 && col < b.c && rw >= 0 && rw < b.r) {
            const k = rw * b.c + col - b.empty;
            if (k >= 0 && k < b.ids.length) return { b, id: b.ids[k], q };
          }
          return { b, q };
        }
      }
      return { b: h.b };
    }
    return null;
  }
  const readable = () => focusB && !anim && cam.s * cp * WIN >= (phone ? 12 : 14);
  function goTower(b, q) {
    let at = q ? { u: q[0], y: b.Hh - q[1] } : null;
    if (!at && petId && towerOf[petId] === b) {
      // your own Chog's tower: frame its window
      const k = slotK[petId] + b.empty;
      at = { u: b.pad + (k % b.c) + 0.5, y: -(b.top + 0.3 + Math.floor(k / b.c) + 0.5) };
    }
    const hop = focusB && focusB !== b;
    focusB = b;
    hover = null;
    hideTip();
    touched = true;
    introDone = true;
    animTo(dollyOf(b, at), hop ? 950 : 1250);
    sec.classList.add("zoomed");
    syncCursor();
    dirty();
  }
  function goOut(instant) {
    if (!focusB) return;
    focusB = null;
    hover = null;
    hideTip();
    if (instant || RM) {
      Object.assign(cam, overview());
      anim = null;
      dimV = 0;
    } else animTo(overview(), 1000);
    sec.classList.remove("zoomed");
    lastUse = performance.now();
    syncCursor();
    dirty();
  }
  // look along / up and down the framed facade; returns true if the view moved
  function look(dx, dy) {
    const b = focusB;
    if (!b || anim) return false;
    const s = cam.s;
    const { top, bot } = band();
    const visW = W / s, visH = (bot - top) / (s * cp);
    const du = (cam.F[0] - b.flb[0]) * b.Rw[0] + (cam.F[2] - b.flb[1]) * b.Rw[1];
    let u = du - dx / s, y = cam.F[1] + dy / (s * cp);
    u = b.w + 1 <= visW ? b.w / 2 : K.clamp(u, visW / 2 - 0.6, b.w - visW / 2 + 0.6);
    y = b.Hh <= visH ? b.Hh / 2 : K.clamp(y, visH / 2 - 0.3, b.Hh - visH / 2 + 0.6);
    const nF = P(b, u, 0, y);
    const moved = Math.abs(nF[0] - cam.F[0]) + Math.abs(nF[1] - cam.F[1]) + Math.abs(nF[2] - cam.F[2]) > 1e-4;
    cam.F = nF;
    return moved;
  }
  // the tower next to the framed one, on the left (-1) or the right (+1) of the screen
  function neighbour(dir) {
    const i = blds.indexOf(focusB);
    const a = blds[(i + 1) % blds.length], c = blds[(i - 1 + blds.length) % blds.length];
    setup();
    const xa = scr(P(a, a.w / 2, 0, 0))[0], xc = scr(P(c, c.w / 2, 0, 0))[0];
    return (xa < xc) === dir < 0 ? a : c;
  }
  let over = 0; // touch: how far a sideways swipe pushed past the facade's end
  K.gestures(cv, {
    down(x, y, type) {
      held = true;
      ptrType = type || "mouse";
      over = 0;
      lastUse = performance.now();
    },
    pan(dx, dy) {
      lastUse = performance.now();
      hideTip();
      if (focusB) {
        // touch: sideways only (a vertical swipe is the page's); mouse: both ways
        const ddy = ptrType === "mouse" ? dy : 0;
        if (look(dx, ddy)) dirty();
        else if (ptrType !== "mouse") over += dx;
        return;
      }
      anim = null;
      introDone = true;
      touched = true;
      cam.th += dx / (cam.s * RR);
      vel = 0;
      dirty();
    },
    release(vx) {
      held = false;
      lastUse = performance.now();
      if (focusB) {
        if (Math.abs(over) > 70 && !anim) goTower(neighbour(over > 0 ? -1 : 1));
        over = 0;
        return;
      }
      // vx is px per 16 ms from the gesture: turn it into rad per ms
      if (!RM && Math.abs(vx) > 0.5) {
        vel = K.clamp(vx / 16 / (cam.s * RR), -0.003, 0.003);
        driftDir = vel < 0 ? -1 : 1;
      }
      dirty();
    },
    wheel(dx, dy, x, y, ctrl) {
      if (ctrl) return false;
      if (focusB) {
        if (anim) return true;
        hideTip();
        const used = look(-dx, -dy);
        if (used) dirty();
        return used || Math.abs(dx) > Math.abs(dy);
      }
      // whole city: the page keeps its wheel; only a sideways trackpad swipe turns the ring
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        cam.th -= dx / (cam.s * RR);
        lastUse = performance.now();
        introDone = touched = true;
        dirty();
        return true;
      }
      return false;
    },
    tap(x, y, type) {
      lastUse = performance.now();
      const touch = type && type !== "mouse";
      if (focusB && pillRect && x >= pillRect.x - 6 && x <= pillRect.x + pillRect.w + 6 && y >= pillRect.y - 8 && y <= pillRect.y + pillRect.h + 8) return goOut();
      if (!focusB && sideV > 0.5) {
        const w = sides.hit(x, y);
        if (w) return open(w.id);
      }
      const h = hitAt(x, y);
      if (!focusB) {
        if (h) goTower(h.b, h.q);
        return;
      }
      if (!h) return goOut();
      if (h.b === focusB) {
        if (h.id && readable()) open(h.id, h.b);
        return;
      }
      // another tower: fly to it (desktop); on touch the dimmed neighbours are "outside", i.e. the way back
      if (touch) goOut();
      else goTower(h.b, h.q);
    },
    hover(x, y) {
      const wk = x >= 0 && !focusB && sideV > 0.5 ? sides.hit(x, y) : null;
      if (wk) {
        lastUse = performance.now();
        const ch = hover !== null;
        hover = null;
        hoverKind = "pt";
        syncCursor();
        walkerTip(wk, x, y);
        if (ch) dirty();
        return;
      }
      const h = x < 0 ? null : hitAt(x, y);
      const face = !!(h && h.id && focusB && h.b === focusB && readable());
      const hv = face ? h : h && (!focusB || h.b !== focusB) ? { b: h.b } : null;
      if (x >= 0) lastUse = performance.now();
      const same = (hv && hover && hv.id === hover.id && hv.b === hover.b) || (!hv && !hover);
      hover = hv;
      hoverKind = face ? "pt" : hv ? "zi" : focusB ? (h ? "" : "out") : "";
      syncCursor();
      if (face) showTip(x, y);
      else hideTip();
      if (!same) dirty();
    },
    leave() {
      hover = null;
      hoverKind = "";
      syncCursor();
      hideTip();
      dirty();
    },
  });
  let hoverKind = "";
  function syncCursor() {
    cv.classList.toggle("pt", hoverKind === "pt");
    cv.classList.toggle("zi", hoverKind === "zi");
    cv.classList.toggle("out", hoverKind === "out");
  }
  cv.addEventListener("keydown", (e) => {
    if (focusB) return; // the window handler below drives the zoomed mode
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      introDone = touched = true;
      animTo({ th: cam.th + (e.key === "ArrowLeft" ? -0.35 : 0.35), s: cam.s, F: cam.F.slice(), p: cam.p, ay: cam.ay }, 500);
    } else if (e.key === "Enter" || e.key === " ") {
      // the tower whose facade faces the viewer most squarely
      setup();
      let best = blds[0], bv = -2;
      for (const b of blds) {
        const v = facing(b.Nw);
        if (v > bv) (bv = v), (best = b);
      }
      goTower(best);
    } else return;
    e.preventDefault();
    dirty();
  });
  // capture on window: runs before page-level arrow/esc shortcuts while a tower is framed on screen
  addEventListener("keydown", (e) => {
    if (!focusB || !onScreen || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tt = e.target;
    if (tt && (tt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tt.tagName))) return;
    if (document.querySelector("dialog[open], [aria-modal='true']:not([hidden])")) return;
    if (e.key === "ArrowLeft") goTower(neighbour(-1));
    else if (e.key === "ArrowRight") goTower(neighbour(1));
    else if (e.key === "Escape") goOut();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // ---------- hover card (desktop, inside a tower) ----------
  let tipId = 0;
  function showTip(x, y) {
    if (!hover || !hover.id || !FINE) return hideTip();
    const m = K.MOOD[cells[hover.id - 1] || "0"] || K.MOOD[0];
    paintTip(hover.id, x, y, `<i style="background:${m.c}"></i>${m.t}`);
  }
  // a walker on the side paths: who it is and what just happened
  function walkerTip(w, x, y) {
    if (!FINE) return hideTip();
    const m = K.MOOD[cells[w.id - 1] || "0"] || K.MOOD[0];
    const who = String(w.who || "").replace(" (home)", "");
    paintTip(w.id, x, y, `<i style="background:${m.c}"></i>${sides.verbOf(w.a, w.code)}${who ? ` by ${K.esc(who)}` : ""}`);
  }
  function paintTip(id, x, y, line2) {
    const nm = K.name(id);
    t1.innerHTML = nm.startsWith("Chog #") ? `Chog <span>#${K.num(id)}</span>` : `${K.esc(nm)} <span>#${K.num(id)}</span>`;
    t2.innerHTML = line2;
    if (tipId !== id) {
      tipId = id;
      tg.fillStyle = "#0e091c";
      tg.fillRect(0, 0, 96, 96);
      K.atlas(48).then((a) => tipId === id && ((tg.imageSmoothingEnabled = false), K.tile(tg, a, 48, id, 0, 0, 96)));
      K.face(id).then((im) => tipId === id && ((tg.imageSmoothingEnabled = true), tg.drawImage(im, 0, 0, 96, 96)), () => {});
    }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = x + 16, ty = y + 14;
    if (tx + tw > W - 8) tx = x - tw - 12;
    if (ty + th > H - 8) ty = y - th - 10;
    tip.style.transform = `translate(${R(Math.max(8, tx))}px, ${R(Math.max(8, ty))}px)`;
  }
  function hideTip() {
    if (!tip.hidden) tip.hidden = true;
  }
  function open(id, b) {
    flash = { id, b: b || towerOf[id], t0: performance.now() };
    hideTip();
    window.dispatchEvent(new CustomEvent("chogpet:open", { detail: { id } }));
    const dev = document.querySelector(".device-wrap");
    if (dev) setTimeout(() => dev.scrollIntoView({ behavior: K.reduced() ? "auto" : "smooth", block: "center" }), RM ? 0 : 260);
    dirty();
  }

  // ---------- stats ----------
  // the heading follows the light: "after dark … lit" at night, "by day … home" by day
  const titleEl = sec.querySelector(".nc-title"), litWord = sec.querySelector(".nc-lw");
  let looked = "";
  function paintStats() {
    const day = skyT < 0.5;
    looked = day ? "d" : "n";
    titleEl.textContent = day ? "Chogtown by day" : "Chogtown after dark";
    litWord.textContent = day ? "home" : "lit";
    litEl.textContent = K.fmt(litCount());
    cv.setAttribute("aria-label", `Chogtown ${day ? "by day" : "at night"}: ${K.fmt(K.N)} windows, ${K.fmt(litCount())} ${day ? "with a Chog at home" : "lit tonight"}. A ring of towers, one per Background, every window a Chog. Drag to turn it, click a tower to look inside.`);
  }
  paintStats();

  // ---------- live moods ----------
  async function refresh() {
    const t3 = await K.town();
    if (!t3.ok || t3.cells === cells) return;
    cells = t3.cells;
    paintStats();
    texVer++;
    dirty();
  }
  setInterval(() => onScreen && !document.hidden && refresh(), 90000);
  addEventListener("chogpet:act", () => setTimeout(refresh, 1500));

  // ---------- visibility, scroll, resize ----------
  new IntersectionObserver(
    (es) => {
      const was = onScreen;
      onScreen = es.some((e) => e.isIntersecting);
      if (onScreen) {
        if (!was && !introDone && !touched) intro();
        dirty();
      } else if (focusB) goOut(true); // scrolled away: next time the whole city greets you
    },
    { rootMargin: "0px" },
  ).observe(sec);
  // first view: the ring swings gently round until your Chog's tower faces you
  function intro() {
    const th = frontTh();
    if (RM) {
      cam.th = th;
      introDone = true;
      return;
    }
    cam.th = th - 0.55;
    anim = { t0: performance.now(), dur: 2600, a: { th: cam.th, s: cam.s, F: cam.F.slice(), p: cam.p, ay: cam.ay }, b: { th, s: cam.s, F: cam.F.slice(), p: cam.p, ay: cam.ay } };
    setTimeout(() => (introDone = true), 2600);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && dirty());
  // touch, inside a tower: the page scrolls as always, and the view glides along the facade with it
  let lastSY = scrollY;
  addEventListener("scroll", () => {
    const dy = scrollY - lastSY;
    lastSY = scrollY;
    if (!focusB || FINE || anim || !onScreen) return;
    if (look(0, -dy * 0.8)) dirty();
  }, { passive: true });
  new ResizeObserver(() => resize()).observe(cv);
  city = {
    onSky() {
      if ((skyT < 0.5 ? "d" : "n") !== looked) paintStats();
      dirty();
    },
    onPet() {
      if (!touched && !focusB) {
        const th = frontTh();
        if (introDone && !RM) animTo({ th: cam.th + ((((th - cam.th) % TAU) + TAU + Math.PI) % TAU) - Math.PI, s: cam.s, F: cam.F.slice(), p: cam.p, ay: cam.ay }, 1400);
        else if (!onScreen || RM) cam.th = th;
      }
      dirty();
    },
  };
  resize();
  sec.classList.add("on");
  dirty();
  // debug hook (tools / Playwright)
  window.__skyline = {
    get focus() { return focusB && focusB.name; },
    get blds() { return blds; },
    get busy() { return !!anim; },
    get pet() { return petId; },
    sides: () => sides.debug(),
    cam,
    goTower: (i) => goTower(typeof i === "number" ? blds[i] : blds.find((b) => b.name === i)),
    goOut,
    hitAt,
    open,
    /** css px (canvas-local) of a tower's facade centre, or of a Chog's window */
    towerAt(i) { setup(); const b = blds[i]; return facing(b.Nw) > 0.01 ? scr(P(b, b.w / 2, 0, b.Hb * 0.5)) : null; },
    winCenter(id) { const q = winQuad(towerOf[id], id); return q ? { x: (q[0][0] + q[2][0]) / 2, y: (q[0][1] + q[2][1]) / 2 } : null; },
  };
}

// a Background colour pushed into a bright tube colour (used, softened, for the tower names)
function neonOf(c) {
  let [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0;
  const d = mx - mn;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = d < 0.04 ? 0.15 : 1, lig = 0.68;
  const C = (1 - Math.abs(2 * lig - 1)) * sat, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = lig - C / 2;
  const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + to(r1) + to(g1) + to(b1);
}
