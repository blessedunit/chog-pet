// Arrival intro: a sleeping pixel egg (the site icon) waits under a dusk sky while the page loads, its LCD bar filling.
// Tap or any key wakes it: it shakes, opens its eyes, throws stars and hearts, and the view dives through its screen into the page.
// Returning visitors get a short dive, reduced motion gets a plain fade, Esc skips. Everything is drawn here; no assets.
//
//   import { startIntro } from "./intro.js";
//   const done = startIntro({ ready: somePromise, onDone() {} }); // resolves when the overlay is gone
//
// ?intro=1 forces the full version, ?intro=short the returning-visitor one, ?intro=0 turns it off. Automated browsers (navigator.webdriver) skip it unless forced.

const SEEN = "pet.introSeen";
const MAX_WAIT = 4000; // never hold the page longer than this for `ready`

// the egg from icon-512.png, 24 x 30 egg pixels. L = LCD (drawn live), Y = the three buttons (drawn live)
const EGG = [
  "..........AAAA..........",
  ".........A....A.........",
  ".........AAAAAA.........",
  ".......AABBBBCCAA.......",
  "......ABBBBBCCCCCA......",
  ".....ABBBBBCCCCCCCA.....",
  "....ABBBBBCCCCCCCCCA....",
  "...ABBBBBCCCCCCCCCCCA...",
  "...ABBBBCCCCCCCCCCCCA...",
  "..ABBDDDDDDDDDDDDDDCCA..",
  "..ABDLLLLLLLLLLLLLLDCA..",
  ".ABBDLLLLLLLLLLLLLLDCCA.",
  ".ABBDLLLLLLLLLLLLLLDCCA.",
  "ABBCDLLLLLLLLLLLLLLDCCGA",
  "ABCCDLLLLLLLLLLLLLLDCGGA",
  "ABCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCDLLLLLLLLLLLLLLDGGGA",
  "ACCCCDDDDDDDDDDDDDDGGGGA",
  ".ACCCCCCCCCCCGGGGGGGGGA.",
  ".ACCCCCCCCCCGGGGGGGGGGA.",
  "..ACCCCYYCCYYGGYYGGGGA..",
  "...ACCCYYCGYYGGYYGGGA...",
  "...AACCCCGGGGGGGGGGAA...",
  "....AACCGGGGGGGGGGAA....",
  "......AAGGGGGGGGAA......",
  ".......AAAAAAAAAA.......",
];
const EW = 24, EH = 30;
const PAL = { A: "#3a2496", B: "#c4b6ff", C: "#8b6cff", D: "#180e36", G: "#6e54ff" };
const LCD = { x: 5, y: 10, w: 14, h: 11, band: 8 }; // rows 0-7 screen, 8-10 the pink band
const BTN = [7, 11, 15]; // x of each 2x2 button, at y 24
// dusk sky, same bands and hills as the page background
const SKY = ["#0e091c", "#110a24", "#160d33", "#1f1450", "#2a1a6e", "#3a259a", "#5139c4", "#6e54ff", "#9a6cf0", "#d77fe6", "#ff8ee4"];
const HILLS = ["#3b2790", "#2a1a6e", "#170e3c"];
const GROUND = ["#22155a", "#120a2e"];

let started = false;

export function startIntro({ ready, onDone } = {}) {
  const done = () => { unboot(); try { onDone && onDone(); } catch {} };
  if (started) return Promise.resolve();
  started = true;
  let mode = "none";
  try { mode = pickMode(); } catch {}
  if (mode === "none") { done(); return Promise.resolve(); }
  return new Promise((resolve) => {
    try {
      run(mode, ready, () => { done(); resolve(); });
    } catch (e) {
      document.querySelectorAll(".intro").forEach((n) => n.remove());
      done();
      resolve();
    }
  });
}

function pickMode() {
  const q = new URLSearchParams(location.search).get("intro");
  if (q === "0") return "none";
  const force = q === "1" || q === "short";
  if (!force && navigator.webdriver) return "none";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "fade";
  if (q === "short") return "short";
  if (force) return "full";
  return store(SEEN) === "1" ? "short" : "full";
}
function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
  return null;
}
function unboot() {
  document.documentElement.classList.remove("intro-boot");
}
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function run(mode, ready, finish) {
  const still = mode === "fade";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const root = document.createElement("div");
  root.className = "intro";
  root.dataset.mode = mode;
  root.setAttribute("aria-hidden", "true");
  root.innerHTML =
    '<canvas class="intro-cv"></canvas>' +
    '<div class="intro-brand">CHOG<i>·</i>PET</div>' +
    '<div class="intro-cta">' + (coarse ? "<b>Tap to wake your Chog</b>" : "<b>Press any key</b><span>or click to wake your Chog</span>") + "</div>";
  document.body.append(root);
  const cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
  const cta = root.querySelector(".intro-cta");
  const prevFocus = document.activeElement;

  // ---- layout, in art pixels (P screen px each) ----
  let P, BW, BH, k, ex, ey, back, eggCv, stars, clouds, flies, R;
  function layout() {
    const W = innerWidth, H = innerHeight;
    P = W < 700 ? 3 : 4;
    BW = Math.ceil(W / P); BH = Math.ceil(H / P);
    k = Math.max(2, Math.floor(Math.min((BH * 0.42) / EH, (BW * 0.62) / EW)));
    ex = Math.round(BW / 2 - (EW * k) / 2);
    ey = Math.round(BH * 0.47 - (EH * k) / 2);
    cv.width = BW; cv.height = BH;
    cv.style.width = BW * P + "px"; cv.style.height = BH * P + "px";
    cta.style.top = (ey + EH * k + 7 * k) * P + "px";
    R = rng(1969);
    back = paintBack();
    eggCv = paintEgg();
  }
  function paintBack() {
    const c = document.createElement("canvas"); c.width = BW; c.height = BH;
    const b = c.getContext("2d");
    const narrow = BW * P < 700;
    const hz = Math.round(BH * 0.66);
    for (let y = 0; y < hz; y++) {
      const f = (y / hz) * (SKY.length - 1), i = Math.floor(f), fr = f - i;
      for (let x = 0; x < BW; x++) {
        const d = ((x + y) % 2 === 0 ? 0.25 : 0.75) + ((x >> 1) % 2 ? 0.1 : -0.1);
        b.fillStyle = SKY[fr > d && i + 1 < SKY.length ? i + 1 : i];
        b.fillRect(x, y, 1, 1);
      }
    }
    b.fillStyle = SKY[SKY.length - 1]; b.fillRect(0, hz, BW, BH - hz);
    // a big soft halo behind the egg, like the glow behind the device on the page
    const cx = BW / 2, cy = ey + (EH * k) / 2, r0 = EH * k * 0.78;
    for (let y = Math.floor(cy - r0 - 4); y < cy + r0 + 4; y++) for (let x = Math.floor(cx - r0 - 4); x < cx + r0 + 4; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.02) / r0;
      if (d > 1.06) continue;
      const chk = (x + y) % 2 === 0, chk4 = x % 2 === 0 && y % 2 === 0;
      if (d > 1) { if (chk4) { b.fillStyle = "rgba(185,173,255,0.32)"; b.fillRect(x, y, 1, 1); } }
      else if (d > 0.93) { if (chk) { b.fillStyle = "rgba(185,173,255,0.32)"; b.fillRect(x, y, 1, 1); } }
      else { b.fillStyle = d > 0.82 && !chk ? "rgba(185,173,255,0.2)" : "rgba(185,173,255,0.32)"; b.fillRect(x, y, 1, 1); }
    }
    // moon
    const mx = Math.round(BW * (narrow ? 0.84 : 0.8)), my = Math.round(BH * (narrow ? 0.2 : 0.2)), mr = narrow ? 7 : Math.max(9, Math.round(BW * 0.02));
    for (let y = -mr - 3; y <= mr + 3; y++) for (let x = -mr - 3; x <= mr + 3; x++) {
      const d = Math.hypot(x, y);
      if (d <= mr) { b.fillStyle = d > mr - 1.2 ? "#cfc6ff" : (x + y) % 5 === 0 && d < mr - 3 ? "#e6e0ff" : "#f5f0ff"; b.fillRect(mx + x, my + y, 1, 1); }
      else if (d <= mr + 3 && (x + y) % 2 === 0) { b.fillStyle = "rgba(245,240,255,0.18)"; b.fillRect(mx + x, my + y, 1, 1); }
    }
    b.fillStyle = "#d9d2ff";
    [[-3, -2, 2], [2, 3, 2], [3, -4, 1]].forEach(([x, y, r]) => { for (let a = -r; a <= r; a++) for (let q = -r; q <= r; q++) if (a * a + q * q <= r * r) b.fillRect(mx + x + a, my + y + q, 1, 1); });
    // three ridges of hills, far to near
    const ridge = (base, amp, freq, col, seed, trees) => {
      const r = rng(seed), o = r() * 100, hs = [];
      for (let x = 0; x < BW; x++) {
        const y = Math.round(base - amp * (0.5 + 0.5 * Math.sin((x + o) * freq) * Math.cos((x + o) * freq * 0.37)));
        hs.push(y);
        b.fillStyle = col; b.fillRect(x, y, 1, BH - y);
      }
      if (trees) for (let x = 2; x < BW - 2; x += 3 + Math.floor(r() * 5)) {
        if (trees === 2 && Math.abs(x - BW / 2) < BW * 0.14) continue;
        const th = 3 + Math.floor(r() * 5), y = hs[x];
        for (let q = 0; q < th; q++) b.fillRect(x - Math.floor((th - q) / 3), y - q, 1 + 2 * Math.floor((th - q) / 3), 1);
      }
      return hs;
    };
    ridge(hz + 2, BH * 0.1, 0.035, HILLS[0], 1, 0);
    ridge(hz + 10, BH * 0.08, 0.06, HILLS[1], 2, 1);
    const near = ridge(BH * 0.86, BH * 0.06, 0.02, HILLS[2], 3, 2);
    // the little house with lit windows
    const hx = Math.round(BW * (narrow ? 0.12 : 0.16)), hy = near[hx];
    b.fillStyle = HILLS[2]; b.fillRect(hx - 6, hy - 9, 13, 10);
    for (let q = 0; q < 6; q++) b.fillRect(hx - 7 + q, hy - 10 - q, 15 - 2 * q, 1);
    b.fillStyle = "#ffae45"; b.fillRect(hx - 4, hy - 6, 2, 2); b.fillRect(hx + 2, hy - 6, 2, 2);
    b.fillStyle = "rgba(255,174,69,0.25)"; b.fillRect(hx - 6, hy - 8, 6, 6); b.fillRect(hx, hy - 8, 6, 6);
    for (let y = Math.round(BH * 0.9); y < BH; y++) for (let x = 0; x < BW; x++) { b.fillStyle = (x * 7 + y * 3) % 11 === 0 ? GROUND[0] : GROUND[1]; b.fillRect(x, y, 1, 1); }
    stars = Array.from({ length: narrow ? 40 : 80 }, () => {
      let x, y, n = 0;
      do { x = Math.floor(R() * BW); y = Math.floor(hz * R() * 0.7); n++; } while (n < 8 && Math.hypot(x - cx, y - cy) < r0 + 6);
      return { x, y, ph: R() * 6, big: R() < 0.14 };
    });
    clouds = Array.from({ length: narrow ? 3 : 5 }, (_, i) => ({ x: R() * BW, y: BH * (0.1 + R() * 0.42), w: 16 + Math.floor(R() * 24), v: 0.8 + R() * 1.4, c: i % 2 ? "#8f78ff" : "#6a52d6" }));
    flies = Array.from({ length: narrow ? 12 : 22 }, () => ({ x: R() * BW, y: BH * (0.72 + R() * 0.24), ph: R() * 6 }));
    return c;
  }
  function paintEgg() {
    const c = document.createElement("canvas"); c.width = EW * k; c.height = EH * k;
    const g = c.getContext("2d");
    EGG.forEach((row, y) => [...row].forEach((ch, x) => { if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x * k, y * k, k, k); } }));
    // gloss blob, as on the page's shell
    g.fillStyle = "#ffffff";
    [[6, 4], [7, 4], [5, 5], [6, 5]].forEach(([x, y]) => g.fillRect(x * k, y * k, k, k));
    return c;
  }

  // ---- state ----
  const T0 = performance.now();
  let phase = "load"; // load -> prompt -> wake -> zoom -> out
  let tPhase = T0, readyAt = 0, wantWake = false, closing = false, raf = 0, last = T0;
  let pFrom = 0; // progress when ready arrived
  const parts = [];
  let shoot = null, nextShoot = T0 + 700;
  let ac = null;
  const muted = store("pet.mute") === "1";
  const minLoad = mode === "full" ? 1100 : mode === "short" ? 150 : 0;

  Promise.race([Promise.resolve(ready).catch(() => {}), new Promise((r) => setTimeout(r, MAX_WAIT))]).then(() => {
    if (!readyAt) { pFrom = fakeProgress(performance.now() - T0); readyAt = performance.now(); }
  });
  const fakeProgress = (dt) => 0.86 * (1 - Math.exp(-dt / 1100));
  const progress = (now) => {
    if (mode !== "full") return 1;
    if (!readyAt) return fakeProgress(now - T0);
    return Math.min(1, pFrom + (1 - pFrom) * ((now - readyAt) / 280));
  };
  const loaded = (now) => readyAt && now - readyAt >= (mode === "full" ? 300 : 0) && now - T0 >= minLoad;

  // ---- sound (only after the tap, very quiet) ----
  function unlock() {
    if (muted || ac) return;
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (A) { ac = new A(); if (ac.state === "suspended") ac.resume(); }
    } catch { ac = null; }
  }
  function tone(f, dur, at, { type = "square", vol = 0.03, to = 0 } = {}) {
    if (!ac) return;
    try {
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  function wakeSound(full) {
    if (full) [0, 0.12, 0.24].forEach((at, i) => tone(i % 2 ? 740 : 620, 0.05, at, { vol: 0.022 }));
    const o = full ? 0.42 : 0;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.09, o + i * 0.07, { type: "triangle", vol: 0.05 }));
    tone(1568, 0.14, o + 0.3, { type: "square", vol: 0.012 });
    tone(330, full ? 0.55 : 0.4, full ? 1.12 : 0.15, { type: "triangle", vol: 0.025, to: 1320 });
  }

  // ---- input ----
  function act() {
    if (closing) return;
    unlock();
    if (phase === "load") wantWake = true;
    else if (phase === "prompt") wake(performance.now());
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(F\d+|Shift|Control|Alt|Meta|CapsLock|Fn|OS|Dead|Unidentified)$/.test(e.key)) return;
    if (phase === "zoom" || phase === "out") return; // let the page have keys again
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    if (e.key === "Escape") return skip();
    act();
  }
  const onDown = (e) => { e.preventDefault(); act(); };
  const block = (e) => e.preventDefault();
  addEventListener("keydown", onKey, true);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("wheel", block, { passive: false });
  root.addEventListener("touchmove", block, { passive: false });
  const onResize = () => { if (phase === "load" || phase === "prompt") { layout(); draw(performance.now()); } };
  addEventListener("resize", onResize);

  function wake(now) {
    phase = mode === "full" ? "wake" : "zoom";
    tPhase = now;
    root.classList.add("intro--go");
    wakeSound(mode === "full");
    // a hard stop in case frames stop (hidden tab)
    setTimeout(end, 4000);
  }
  function skip() {
    if (closing) return;
    closing = true;
    root.style.transition = "opacity .22s steps(4)";
    root.style.opacity = "0";
    setTimeout(end, 240);
  }
  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    removeEventListener("keydown", onKey, true);
    removeEventListener("resize", onResize);
    root.remove();
    store(SEEN, "1");
    try { if (prevFocus && prevFocus.focus && document.contains(prevFocus) && document.activeElement !== prevFocus) prevFocus.focus({ preventScroll: true }); } catch {}
    if (ac) setTimeout(() => { try { ac.close(); } catch {} }, 1500);
    finish();
  }

  // ---- drawing ----
  const lcdBox = () => ({ x: ex + LCD.x * k, y: ey + LCD.y * k, w: LCD.w * k, h: LCD.h * k });
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function heart(x, y, s, c) {
    const m = [".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."];
    m.forEach((r, j) => [...r].forEach((ch, i) => ch === "X" && px(x + i * s, y + j * s, s, s, c)));
  }
  function star(x, y, s, c) { px(x, y - s, s, s * 3, c); px(x - s, y, s * 3, s, c); }
  function zz(x, y, s, c) { px(x, y, 4 * s, s, c); px(x + 2 * s, y + s, s, s, c); px(x + s, y + 2 * s, s, s, c); px(x, y + 3 * s, 4 * s, s, c); }

  function lcd(ox, oy, now, eyes, lit) {
    const L = (x, y, w, h, c) => px(ox + (LCD.x + x) * k, oy + (LCD.y + y) * k, w * k, h * k, c);
    L(0, 0, LCD.w, LCD.band, lit ? "#f5eeff" : "#a99be6");
    if (lit) L(0, 0, 1, 1, "#ffffff");
    const ink = lit ? "#0e091c" : "#3a2496";
    for (const bx of [1, 8]) {
      if (eyes === "open") {
        L(bx + 1, 2, 3, 1, ink); L(bx, 3, 5, 3, ink); L(bx + 1, 6, 3, 1, ink);
        L(bx + 1, 3, 1, 1, "#ffffff");
      } else if (eyes === "half") {
        L(bx, 4, 5, 1, ink); L(bx + 1, 5, 3, 1, ink);
      } else { // asleep: a soft closed arc
        L(bx, 4, 1, 1, ink); L(bx + 4, 4, 1, 1, ink); L(bx + 1, 5, 3, 1, ink);
      }
    }
    // the pink band doubles as the loading bar
    const p = progress(now), n = Math.round(p * LCD.w);
    for (let x = 0; x < LCD.w; x++) {
      const on = x < n;
      L(x, LCD.band, 1, 3, on ? "#ff8ee4" : "#2a1a6e");
      if (on) L(x, LCD.band, 1, 1, "#ffb6ef");
      else if (x % 2 === 0) L(x, LCD.band + 1, 1, 1, "#3a2496");
    }
    if (n > 0 && n < LCD.w && Math.floor(now / 120) % 2) L(n - 1, LCD.band, 1, 3, "#ffffff");
  }
  function buttons(ox, oy, now, state) {
    BTN.forEach((bx, i) => {
      let on = true;
      if (state === "load") on = Math.floor((now - T0) / 220) % 3 === i;
      else if (state === "prompt") on = Math.floor((now - T0) / 500) % 2 === 0;
      else if (state === "press") on = false;
      const c = on ? "#ffd84d" : "#4a32b0";
      const x = ox + bx * k, y = oy + 24 * k;
      px(x, y, 2 * k, 2 * k, c);
      if (on) px(x, y, k, k, "#fff3a0");
    });
  }

  function spawnBurst(cx, cy) {
    const cols = ["#ffd84d", "#ff8ee4", "#85e6ff", "#ddd7fe", "#ffae45"];
    const s = Math.max(1, Math.round(k / 2));
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (R() - 0.5) * Math.PI * 1.5, v = 50 + R() * 90;
      const kind = i % 5 === 0 ? "heart" : i % 2 ? "star" : "dot";
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, age: 0, life: 0.8 + R() * 0.6, kind, s: kind === "dot" ? s : Math.max(1, s - (R() < 0.5 ? 1 : 0)), c: kind === "heart" ? "#ff8ee4" : cols[i % cols.length] });
    }
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - T0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(back, 0, 0);
    if (!still) {
      for (const s of stars) {
        const v = Math.sin(t * 2.2 + s.ph);
        if (v < -0.3) continue;
        px(s.x, s.y, 1, 1, s.big ? "#ffd84d" : "#f5f0ff");
        if (s.big && v > 0.6) { px(s.x - 1, s.y, 3, 1, "#ffd84d"); px(s.x, s.y - 1, 1, 3, "#ffd84d"); }
      }
      for (const c of clouds) {
        const x = Math.round(((c.x + t * c.v) % (BW + 60)) - 50), y = Math.round(c.y);
        px(x, y, c.w, 3, c.c); px(x + 3, y - 2, c.w - 8, 2, c.c); px(x + Math.floor(c.w * 0.3), y - 4, Math.floor(c.w * 0.35), 2, c.c);
        px(x + 1, y + 2, c.w - 2, 1, "rgba(14,9,28,0.25)");
      }
      for (const f of flies) {
        const a = Math.sin(t * 1.5 + f.ph);
        if (a < 0) continue;
        px(Math.round(f.x + Math.sin(t * 0.4 + f.ph) * 6), Math.round(f.y + Math.cos(t * 0.5 + f.ph) * 3), 1, 1, a > 0.6 ? "#fff3a0" : "#b8ff8c");
      }
      // a shooting star now and then while it sleeps
      if (!shoot && now > nextShoot && (phase === "load" || phase === "prompt")) {
        shoot = { x: BW * (0.55 + R() * 0.4), y: BH * (0.04 + R() * 0.16), t: now };
        nextShoot = now + 4500 + R() * 3000;
      }
      if (shoot) {
        const u = (now - shoot.t) / 650;
        if (u > 1) shoot = null;
        else for (let i = 0; i < 7; i++) {
          const d = u * 70 - i * 2;
          if (d < 0) continue;
          px(Math.round(shoot.x - d), Math.round(shoot.y + d * 0.45), 1, 1, i === 0 ? "#ffffff" : i < 3 ? "#ddd7fe" : "rgba(221,215,254,0.45)");
        }
      }
    }

    // ---- the egg ----
    const since = now - tPhase;
    let ox = ex, oy = ey, eyes = "sleep", lit = false, bstate = phase;
    if (phase === "load" || phase === "prompt") {
      if (!still) oy += Math.round(Math.sin(t * 2.4) * 1.6);
      if (mode === "short" || (mode === "fade" && readyAt)) { eyes = "open"; lit = true; bstate = "on"; }
    } else if (phase === "wake") {
      if (since < 420) { // shake
        const seq = [0, -2, 2, -2, 2, -1, 1, 0];
        ox += seq[Math.min(seq.length - 1, Math.floor(since / 55))];
        bstate = since < 200 ? "press" : "on";
      } else {
        lit = true;
        bstate = "on";
        eyes = since < 500 ? "half" : since > 900 && since < 980 ? "half" : "open";
        if (since < 780) oy -= Math.round(Math.sin(((since - 420) / 360) * Math.PI) * 3 * k);
        if (!parts.burst) { parts.burst = 1; spawnBurst(ex + (EW * k) / 2, ey + 4 * k); }
      }
    } else { lit = true; eyes = "open"; bstate = "on"; }
    // shadow on the ground, smaller while it hops
    const lift = ey - oy, sw = Math.max(4, Math.round(EW * k * 0.7 - lift * 1.2)), sy = ey + EH * k + Math.round(2.5 * k);
    for (let x = 0; x < sw; x++) for (let y = 0; y < k; y++) if ((x + y) % 2 === 0 || (x > sw * 0.15 && x < sw * 0.85)) px(Math.round(BW / 2 - sw / 2) + x, sy + y, 1, 1, "rgba(14,9,28,0.45)");
    ctx.drawImage(eggCv, ox, oy);
    lcd(ox, oy, now, eyes, lit);
    buttons(ox, oy, now, bstate);
    // sleepy z's drifting up from the egg
    if ((phase === "load" || phase === "prompt") && mode !== "short" && !still) {
      for (let i = 0; i < 3; i++) {
        const u = ((t * 0.45 + i / 3) % 1);
        const s = Math.max(1, Math.round(k / 3)) + (u > 0.55 ? 1 : 0);
        if (u > 0.85 && Math.floor(t * 12) % 2) continue;
        zz(Math.round(ox + EW * k - 2 * k + u * Math.min(9 * k, BW - ox - EW * k - 4 * k) + Math.sin(u * 6 + i) * k), Math.round(oy + 2 * k - u * 12 * k), Math.max(1, s), u < 0.5 ? "#ddd7fe" : "#b9adff");
      }
    }
    // ring that pops out when it wakes
    if (phase === "wake" && since > 420 && since < 760) {
      const u = (since - 420) / 340, r = (0.35 + u * 0.75) * EH * k, cx = BW / 2, cy = ey + (EH * k) / 2;
      const n = Math.round(r * 2.4);
      for (let i = 0; i < n; i++) if (i % 2 === 0) { const a = (i / n) * Math.PI * 2; px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.92), Math.max(1, k - 1), Math.max(1, k - 1), u < 0.6 ? "#ddd7fe" : "#8f7bff"); }
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt; q.vy += 150 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 0.8 * dt;
      if (q.age > q.life) { parts.splice(i, 1); continue; }
      if (q.age > q.life * 0.65 && Math.floor(q.age * 18) % 2) continue;
      const x = Math.round(q.x), y = Math.round(q.y);
      if (q.kind === "heart") heart(x, y, q.s, q.c);
      else if (q.kind === "star") star(x, y, q.s, q.c);
      else px(x, y, q.s, q.s, q.c);
    }
    // the screen turns on, flashes, then becomes a window into the page
    if (phase === "zoom") {
      const b = lcdBox(), z = since;
      const flash = mode === "full" ? 70 : 60;
      if (z < flash) px(b.x, b.y, b.w, b.h, "#ffffff");
      else ctx.clearRect(b.x, b.y, b.w, b.h);
    }
  }

  // ---- loop ----
  function frame(now) {
    raf = 0;
    try {
      if (phase === "load" && loaded(now)) {
        if (mode === "fade") return fadeOut();
        if (mode === "short") wake(now);
        else if (wantWake) wake(now);
        else { phase = "prompt"; tPhase = now; root.classList.add("intro--ready"); }
      }
      if (phase === "wake" && now - tPhase >= 1120) { phase = "zoom"; tPhase = now; }
      draw(now);
      if (phase === "zoom") {
        const dur = mode === "full" ? 760 : 620;
        const u = Math.min(1, (now - tPhase) / dur);
        const b = lcdBox();
        const cx = (b.x + b.w / 2) * P, cy = (b.y + b.h / 2) * P;
        const S = 1.08 * Math.max(cx / ((b.w * P) / 2), (innerWidth - cx) / ((b.w * P) / 2), cy / ((b.h * P) / 2), (innerHeight - cy) / ((b.h * P) / 2));
        const e = u * u * u;
        cv.style.transformOrigin = `${cx}px ${cy}px`;
        cv.style.transform = `scale(${1 + (S - 1) * e})`;
        root.style.opacity = String(u < 0.72 ? 1 : 1 - (u - 0.72) / 0.28);
        if (u >= 1) return end();
      }
      if (still && phase === "load") { setTimeout(() => (raf = requestAnimationFrame(frame)), 100); return; }
      raf = requestAnimationFrame(frame);
    } catch (e) {
      end();
    }
  }
  function fadeOut() {
    draw(performance.now());
    root.style.transition = "opacity .4s linear";
    root.style.opacity = "0";
    setTimeout(end, 420);
  }

  layout();
  draw(T0);
  root.classList.add("intro--on");
  requestAnimationFrame(() => unboot());
  raf = requestAnimationFrame(frame);
}
