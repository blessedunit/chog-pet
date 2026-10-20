// Background behind the page: one calm, low-res pixel sky on a fixed canvas (?bg=studio keeps the plain backdrop).
// It follows the opened pet, not the clock: awake = a soft lavender DAY (pixel sun, a few slow clouds, day hills),
// asleep = NIGHT (small moon, sparse twinkling stars, dark hills, a few far windows and fireflies). Falling asleep
// plays a ~2.6 s dusk, waking a dawn. The #skyline city follows the same state: we set <html data-sky="day|night">,
// keep window.CHOG_SKY = {phase, t, to} and dispatch "chogpet:sky" with it (t: 0 = day … 1 = night).
// Sleep hooks: "chogpet:pet" (→ GET /api/pet/:id), "chogpet:act" (nap / wake / grumpy), the printed mood.
// Test pins: ?asleep=1|0 fixes the sleep, ?sky=dawn|day|dusk|night fixes the look, ?debug=1 → window.__scene(),
// window.__pinSleep(v). Chogoween 20.10-02.11 (?season=halloween|off) tints the moon and sends a few far bats.
// Cheap: day/night skies, hills, sun, moon and clouds are cached per resize (a dusk is a blend of those);
// a frame is a few drawImage calls at ≤ 20 fps (≤ 5 fps in a still day), nothing runs while the tab is hidden,
// and with prefers-reduced-motion it only draws when something changes (phase changes are instant).

const Q = new URLSearchParams(location.search);
const KIND = Q.get("bg") || "pixel";
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEBUG = Q.has("debug");

// ---------- seasons ----------
function seasonNow() {
  const q = Q.get("season");
  if (q === "halloween") return "halloween";
  if (q === "off") return "";
  const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  return (m === 10 && day >= 20) || (m === 11 && day <= 2) ? "halloween" : "";
}
const SEASON = seasonNow();
window.CHOG_SEASON = SEASON;
if (SEASON) document.documentElement.dataset.season = SEASON;
const SPOOKY = SEASON === "halloween";

/* ---------------- palettes (Monad: night #0e091c, violet #6e54ff, lav #ddd7fe, pink #ff8ee4) ---------------- */
// sky: top → bottom stops; far/near: hill silhouettes; rim: a lit edge on the hills
const DAY = { sky: ["#8794f0", "#929ef3", "#9ea9f6", "#abb4f8", "#b9c0fa", "#c7ccfc", "#d5d7fd", "#e2e1fe", "#ece9ff"], far: "#aaa6f1", near: "#8a83e2", rim: "#cfccfc", nearRim: "#a39df0" };
const NIGHT = { sky: ["#07040f", "#0b0718", "#0e091c", "#130b28", "#1a1038", "#22154c", "#2c1b63"], far: "#1a1046", near: "#0f0926", rim: "#2c1f6a" };
// the low warm band of a dusk / dawn, laid over the blend at its middle
const GLOW = {
  dusk: [[0, "rgba(110,84,255,0)"], [0.45, "rgba(176,124,240,0.5)"], [0.78, "rgba(255,142,228,0.8)"], [1, "rgba(255,170,150,0.95)"]],
  dawn: [[0, "rgba(150,140,255,0)"], [0.5, "rgba(214,160,240,0.45)"], [0.8, "rgba(255,178,206,0.8)"], [1, "rgba(255,206,160,1)"]],
};
// ?sky= pins: how far into the night (t) and which glow
const PINS = { day: [0, ""], dawn: [0.46, "dawn"], dusk: [0.56, "dusk"], night: [1, ""] };
const PIN = PINS[Q.get("sky")] ? Q.get("sky") : null;
const TRANS = 2.6; // seconds for a dusk / dawn

/* ---------------- tiny helpers ---------------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
// a vertical gradient through the stops, ordered-dithered between neighbours (smooth, still pixel art)
function ditherSky(W, H, stops) {
  const c = canvas(W, H), b = c.getContext("2d"), img = b.createImageData(W, H), d = img.data;
  const cols = stops.map(hex), n = cols.length - 1;
  for (let y = 0; y < H; y++) {
    const t = (y / Math.max(1, H - 1)) * n, i = Math.min(n - 1, Math.floor(t)), f = t - i;
    for (let x = 0; x < W; x++) {
      const k = f > BAYER[(y & 3) * 4 + (x & 3)] ? cols[i + 1] : cols[i], o = (y * W + x) * 4;
      d[o] = k[0]; d[o + 1] = k[1]; d[o + 2] = k[2]; d[o + 3] = 255;
    }
  }
  b.putImageData(img, 0, 0);
  return c;
}
const smooth = (x) => x * x * (3 - 2 * x);

const perf = { n: 0, sum: 0, max: 0 };

function start() {
  document.documentElement.dataset.bg = "pixel";
  const cv = document.createElement("canvas");
  cv.className = "scene";
  cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  const ctx = cv.getContext("2d");

  let P = 4, BW = 0, BH = 0, narrow = false, w = 0, h = 0;
  let daySky, nightSky, moonC, sunC, dayFar, dayNear, nightFar, nightNear;
  let glowC = {}, clouds = [], stars = [], flies = [], lights = [];
  let raf = 0, last = 0, timer = 0;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const request = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };

  /* ---- static layers (rebuilt on resize only) ---- */
  function build() {
    w = innerWidth; h = innerHeight;
    narrow = w < 700;
    P = narrow ? 3 : 4;
    BW = Math.ceil(w / P); BH = Math.ceil(h / P);
    cv.width = BW; cv.height = BH;
    daySky = ditherSky(BW, BH, DAY.sky);
    nightSky = ditherSky(BW, BH, NIGHT.sky);
    for (const k in GLOW) {
      const c = canvas(BW, BH), b = c.getContext("2d"), gr = b.createLinearGradient(0, BH * 0.3, 0, BH);
      for (const [o, col] of GLOW[k]) gr.addColorStop(o, col);
      b.fillStyle = gr; b.fillRect(0, 0, BW, BH);
      glowC[k] = c;
    }
    moonC = body(false); sunC = body(true);
    // the same two hill lines in day and night colours (tall enough to slide up with the scroll)
    const far = hillTop(BW, Math.round(BH * 0.26), 11, 0.1, 0.04), nr = hillTop(BW, Math.round(BH * 0.17), 29, 0.07, 0.08);
    dayFar = paintHills(far, DAY.far, DAY.rim); dayNear = paintHills(nr, DAY.near, DAY.nearRim);
    nightFar = paintHills(far, NIGHT.far, NIGHT.rim); nightNear = paintHills(nr, NIGHT.near, null);
    const R2 = rng(77);
    const n = Math.round(Math.min(narrow ? 30 : 60, (BW * BH) / (narrow ? 280 : 460)));
    stars = Array.from({ length: n }, () => ({ x: Math.floor(R2() * BW), y: Math.floor(BH * 0.6 * Math.pow(R2(), 1.3)), ph: R2() * 6.28, sp: 0.6 + R2() * 1.4, big: R2() < 0.08, pink: R2() < 0.15 }));
    flies = Array.from({ length: narrow ? 3 : 5 }, () => ({ x: R2() * BW, y: BH * (0.84 + R2() * 0.1), ph: R2() * 6.28, vx: (R2() < 0.5 ? -1 : 1) * (0.6 + R2() * 0.8) }));
    lights = Array.from({ length: narrow ? 2 : 4 }, () => ({ x: Math.floor(BW * (0.08 + R2() * 0.84)), ph: R2() * 6.28 }));
    // a few soft clouds, spread across the width, high up; they drift very slowly
    const RC = rng(5);
    const nc = narrow ? 1 : 3;
    clouds = Array.from({ length: nc }, (_, i) => {
      const c = cloud(RC, narrow ? 18 + RC() * 10 : 22 + RC() * 16);
      return { c, x: BW * ((i + 0.15 + RC() * 0.6) / nc) - c.width / 2, y: Math.round(BH * (0.1 + RC() * 0.28)), v: 0.12 + RC() * 0.12 };
    });
  }
  function hillTop(W, H, seed, amp, base) {
    const r = rng(seed);
    const waves = [[0.9, 1], [2.3, 0.35], [5.1, 0.08]].map(([n, a]) => ({ f: ((n + r() * 0.6) * 6.283) / W, p: r() * 6.28, a }));
    const top = new Array(W);
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (const q of waves) v += Math.sin(x * q.f + q.p) * q.a;
      top[x] = Math.round(H * base + (1 - (v / 1.43 + 1) / 2) * BH * amp);
    }
    return { W, H, top };
  }
  function paintHills({ W, H, top }, col, rim) {
    const c = canvas(W, H), b = c.getContext("2d");
    b.fillStyle = col;
    for (let x = 0; x < W; x++) b.fillRect(x, top[x], 1, H - top[x]);
    if (rim) { b.fillStyle = rim; for (let x = 0; x < W; x++) if (x % 3 !== 1) b.fillRect(x, top[x], 1, 1); }
    c.top = top;
    return c;
  }
  function body(sun) {
    const r = sun ? 8 : 7, g = sun ? 7 : 4, s = (r + g) * 2 + 1, c = canvas(s, s), b = c.getContext("2d");
    const harvest = SPOOKY && !sun;
    const [rim, face, spot, halo] = sun ? ["#ffe2b0", "#fffaf0", "#fff3dc", "rgba(255,246,226,0.34)"]
      : harvest ? ["#f0b27a", "#ffe9d2", "#f7d2ad", "rgba(255,190,130,0.12)"]
        : ["#b9adff", "#e6e0ff", "#d2c9ff", "rgba(221,215,254,0.1)"];
    const m = r + g;
    for (let y = -m; y <= m; y++) for (let x = -m; x <= m; x++) {
      const d = Math.hypot(x, y);
      if (d <= r) { b.fillStyle = d > r - 1 ? rim : face; b.fillRect(m + x, m + y, 1, 1); }
      else if (d <= r + g && ((x + y) & 1) === 0 && d <= r + g * (0.4 + 0.6 * BAYER[((y + 64) & 3) * 4 + ((x + 64) & 3)])) { b.fillStyle = halo; b.fillRect(m + x, m + y, 1, 1); }
    }
    if (sun) { b.fillStyle = "#ffffff"; [[-3, -4], [-4, -3], [-3, -3], [-2, -4]].forEach(([x, y]) => b.fillRect(m + x, m + y, 1, 1)); }
    else { b.fillStyle = spot; [[-2, -2], [-1, -2], [-2, -1], [2, 2], [3, 1], [1, -4]].forEach(([x, y]) => b.fillRect(m + x, m + y, 1, 1)); }
    return c;
  }
  // a flat-bottomed pixel cloud: a few overlapping puffs, white with a lavender belly and a bright top edge
  function cloud(r, cw) {
    cw = Math.round(cw);
    const ch = Math.round(cw * 0.36) + 2, c = canvas(cw + 2, ch + 2), b = c.getContext("2d");
    const puffs = [];
    const k = 3 + Math.floor(r() * 2);
    for (let i = 0; i < k; i++) {
      const u = (i + 0.5) / k, rad = ch * (0.42 + 0.5 * Math.sin(u * Math.PI) * (0.7 + r() * 0.3));
      puffs.push({ x: 1 + cw * (0.12 + u * 0.76), y: ch + 1 - Math.max(2, ch * 0.28), r: rad });
    }
    const inside = (x, y) => y <= ch && puffs.some((p) => Math.hypot(x - p.x, (y - p.y) * 1.15) <= p.r);
    for (let y = 0; y < ch + 2; y++) for (let x = 0; x < cw + 2; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const topEdge = !inside(x + 0.5, y - 0.5), belly = y > ch - 2 - Math.round(ch * 0.12);
      b.fillStyle = topEdge ? "#ffffff" : belly ? "#d9d8fb" : "#f3f2ff";
      b.fillRect(x, y, 1, 1);
    }
    return c;
  }

  /* ---- the #skyline section has its own sun/moon: ours steps aside while it is on screen ---- */
  // it also steps aside while a panel covers its spot: behind the glass it only reads as a smudge
  // a few calm spots to choose from; it only moves to another one while it is fully faded out. Phones have no room.
  const SPOTS = [[0.86, 0.16], [0.94, 0.13], [0.06, 0.13], [0.5, 0.1], [0.3, 0.11], [0.7, 0.11]];
  let bodyVis = 0, bodyT = 0, skylineOn = false, coverAt = 0, spot = 0;
  const bodyXY = (i = spot) => [Math.round(BW * SPOTS[i][0]), Math.round(BH * SPOTS[i][1])];
  const solid = (el) => {
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (/^(IMG|CANVAS|VIDEO|svg|BUTTON|INPUT)$/.test(el.tagName)) return true;
      const cs = getComputedStyle(el), m = cs.backgroundColor.match(/[\d.]+/g);
      if (cs.backgroundImage !== "none" || (m && (m.length < 4 || +m[3] > 0.15))) return true;
    }
    return false;
  };
  function checkBody() {
    coverAt = performance.now();
    const open = (i) => {
      // the disc plus a wide margin: it must sit in open sky, never wedged between panels
      const [bx, by] = bodyXY(i), r = (sunC.width >> 1) * P + 48;
      const pts = [[0, 0]];
      for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283; pts.push([Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55]); }
      for (const [dx, dy] of pts) {
        const x = bx * P + dx, y = by * P + dy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || solid(document.elementFromPoint(x, y))) return false;
      }
      return true;
    };
    let free = !skylineOn && !narrow && open(spot);
    if (!free && !skylineOn && !narrow && bodyVis === 0) {
      const i = SPOTS.findIndex((_, k) => k !== spot && open(k));
      if (i >= 0) { spot = i; free = true; }
    }
    const v = free ? 1 : 0;
    if (v !== bodyT) { bodyT = v; if (still) bodyVis = v; request(); }
  }
  const watchSkyline = () => {
    const el = document.getElementById("skyline");
    if (el && "IntersectionObserver" in window) new IntersectionObserver((es) => { skylineOn = es.some((e) => e.isIntersecting); checkBody(); }).observe(el);
    checkBody();
    setInterval(() => { if (!document.hidden) checkBody(); }, 1500);
  };

  /* ---- gentle parallax: the hills rise a little as the page scrolls ---- */
  let prog = 0;
  const measure = () => { const max = document.documentElement.scrollHeight - innerHeight; prog = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  let coverT = 0;
  addEventListener("scroll", () => {
    measure(); request();
    if (!coverT) coverT = setTimeout(() => { coverT = 0; checkBody(); }, Math.max(0, 180 - (performance.now() - coverAt)));
  }, { passive: true });

  /* ---- day ↔ night: t = 0 day … 1 night; the city (#skyline) and the page CSS follow it ---- */
  let pinSleep = Q.has("asleep") ? Q.get("asleep") === "1" : null;
  let petId = null, asleep = pinSleep === true, decided = pinSleep != null;
  let tSky = PIN ? PINS[PIN][0] : asleep ? 1 : 0, tGoal = tSky, glowKind = PIN ? PINS[PIN][1] : "";
  let sent = "";
  function phase() {
    if (PIN) return PIN;
    if (tSky === tGoal) return tSky >= 1 ? "night" : "day";
    return tGoal > tSky ? "dusk" : "dawn";
  }
  function emit() {
    const ph = phase(), t = +tSky.toFixed(3);
    const key = ph + "|" + t;
    if (key === sent) return;
    sent = key;
    const look = PIN === "dusk" || PIN === "dawn" ? PIN : t < 0.5 ? "day" : "night";
    if (document.documentElement.dataset.sky !== look) document.documentElement.dataset.sky = look;
    window.CHOG_SKY = { phase: ph, t, to: tGoal };
    window.dispatchEvent(new CustomEvent("chogpet:sky", { detail: window.CHOG_SKY }));
  }
  function setAsleep(v) {
    if (pinSleep != null) v = pinSleep;
    const first = !decided;
    decided = true;
    if (v === asleep) return;
    asleep = v;
    if (PIN) return;
    tGoal = v ? 1 : 0;
    glowKind = v ? "dusk" : "dawn";
    // the very first answer right after load just sets the scene (no dusk on arrival)
    if (still || (first && now() < 6)) tSky = tGoal;
    emit();
    request();
  }
  async function fetchSleep() {
    if (!petId) return;
    try {
      const r = await fetch("/api/pet/" + petId);
      if (!r.ok) return;
      const j = await r.json();
      setAsleep(!!((j.state && j.state.asleep) || j.mood === "asleep"));
    } catch {}
  }
  const moodEl = () => document.querySelector("#pcMood .mood, #strip .mood");
  function domSleep() { const el = moodEl(); if (el && el.textContent.trim()) setAsleep(el.classList.contains("asleep")); return !!el; }
  addEventListener("chogpet:pet", (e) => { petId = e.detail && e.detail.id; fetchSleep(); });
  addEventListener("chogpet:act", (e) => {
    const c = e.detail && e.detail.code;
    if (c === "nap") setAsleep(true);
    else if (c === "wake" || c === "grumpy") setAsleep(false);
    else setTimeout(domSleep, 700);
  });
  // the page refreshes the pet every 30 s and prints its mood: read that (free); poll the API only without it
  setInterval(() => { if (!document.hidden && !domSleep()) fetchSleep(); }, 60000);
  setInterval(() => { if (!document.hidden) domSleep(); }, 4000);

  /* ---- rare sky events: a shooting star, Chogoween bats ---- */
  const ev = { star: null, nextStar: 8 + Math.random() * 10, bats: null, nextBats: 6 + Math.random() * 10 };
  function events(t, dark) {
    if (still) return;
    if (dark > 0.9 && !ev.star && t > ev.nextStar) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      ev.star = { x: BW * (0.2 + Math.random() * 0.6), y: BH * (0.06 + Math.random() * 0.22), dx: dir * (60 + Math.random() * 25), dy: 22 + Math.random() * 10, t0: t, life: 0.7 };
    }
    if (ev.star) {
      const s = ev.star, e = t - s.t0;
      if (e > s.life) { ev.star = null; ev.nextStar = t + 25 + Math.random() * 30; }
      else {
        const L = Math.hypot(s.dx, s.dy), ux = s.dx / L, uy = s.dy / L, hx = s.x + s.dx * e, hy = s.y + s.dy * e, fade = Math.sin((e / s.life) * Math.PI);
        for (let i = 0; i < 7; i++) {
          ctx.globalAlpha = dark * fade * (1 - i / 7) * 0.9;
          ctx.fillStyle = i < 2 ? "#ffffff" : "#ddd7fe";
          ctx.fillRect(Math.round(hx - ux * i * 1.4), Math.round(hy - uy * i * 1.4), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (SPOOKY && dark > 0.9) {
      if (!ev.bats && t > ev.nextBats) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        ev.bats = { t0: t, dir, y: BH * (0.12 + Math.random() * 0.2), v: 7 + Math.random() * 4, k: [0, 1, 2].map((i) => ({ dx: -i * (5 + Math.random() * 3), dy: (Math.random() - 0.5) * 6, ph: Math.random() * 6 })) };
      }
      if (ev.bats) {
        const b = ev.bats, e = t - b.t0, x0 = b.dir > 0 ? -12 + b.v * e : BW + 12 - b.v * e;
        if (e * b.v > BW + 40) { ev.bats = null; ev.nextBats = t + 40 + Math.random() * 40; }
        else {
          ctx.fillStyle = "#05030c";
          for (const q of b.k) {
            const x = Math.round(x0 + q.dx * b.dir), y = Math.round(b.y + q.dy + Math.sin(e * 2 + q.ph) * 2), up = Math.sin(e * 14 + q.ph) > 0;
            ctx.fillRect(x, y, 1, 1);
            ctx.fillRect(x - 1, y + (up ? -1 : 0), 1, 1); ctx.fillRect(x + 1, y + (up ? -1 : 0), 1, 1);
          }
        }
      }
    }
  }

  /* ---- one frame ---- */
  let lastT = 0;
  function frame(nowMs) {
    raf = 0;
    if (document.hidden) return;
    const t = now(), dt = Math.min(0.2, t - lastT);
    const moving = tSky !== tGoal || bodyVis !== bodyT;
    // ≤ 20 fps while stars twinkle or the light changes; a still day only has slow clouds: ≤ 5 fps
    const gap = moving || tSky > 0.02 ? 50 : 200;
    if (!still && nowMs - last < gap) { raf = requestAnimationFrame(frame); return; }
    last = nowMs; lastT = t;
    const a = performance.now();

    // eases
    if (!still && tSky !== tGoal) { tSky += Math.sign(tGoal - tSky) * Math.min(Math.abs(tGoal - tSky), dt / TRANS); emit(); }
    if (!still && bodyVis !== bodyT) bodyVis += Math.sign(bodyT - bodyVis) * Math.min(Math.abs(bodyT - bodyVis), dt / 0.6);
    const k = smooth(tSky); // how much of a night it is
    const glow = glowKind && k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;

    // sky: the day, the night laid over it, and the warm band of a dusk / dawn in between
    ctx.globalAlpha = 1;
    if (k < 1) ctx.drawImage(daySky, 0, 0);
    if (k > 0) { ctx.globalAlpha = k; ctx.drawImage(nightSky, 0, 0); }
    if (glow > 0) { ctx.globalAlpha = glow * 0.75; ctx.drawImage(glowC[glowKind], 0, 0); }
    ctx.globalAlpha = 1;

    // clouds (day), drifting a pixel every few seconds
    if (k < 1) {
      for (const c of clouds) {
        if (!still) { c.x += c.v * dt; if (c.x > BW + 4) c.x = -c.c.width - 4; }
        ctx.globalAlpha = (1 - k) * 0.95;
        ctx.drawImage(c.c, Math.round(c.x), c.y + Math.round(k * 4));
      }
      ctx.globalAlpha = 1;
    }

    // stars
    const dark = k * k;
    if (dark > 0.01) {
      for (const s of stars) {
        const tw = still ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.globalAlpha = dark * tw * (s.big ? 1 : 0.7);
        ctx.fillStyle = s.pink ? "#ffc2f0" : s.big ? "#f5f0ff" : "#ddd7fe";
        ctx.fillRect(s.x, s.y, 1, 1);
        if (s.big && tw > 0.8) { ctx.globalAlpha *= 0.35; ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); }
      }
      ctx.globalAlpha = 1;
    }

    // the sun sets as the moon comes up (in the same calm spot)
    if (bodyVis > 0) {
      const [bx, by] = bodyXY();
      if (k < 1) { ctx.globalAlpha = bodyVis * (1 - k); ctx.drawImage(sunC, bx - (sunC.width >> 1), by - (sunC.height >> 1) + Math.round(k * 10)); }
      if (k > 0) { ctx.globalAlpha = bodyVis * k; ctx.drawImage(moonC, bx - (moonC.width >> 1), by - (moonC.height >> 1) + Math.round((1 - k) * 8)); }
      ctx.globalAlpha = 1;
    }

    events(t, dark);

    // hills, rising gently with the scroll (far less than near)
    const fy = BH - dayFar.height + Math.round((1 - prog) * BH * 0.03);
    const ny = BH - dayNear.height + Math.round((1 - prog) * BH * 0.06);
    if (k < 1) ctx.drawImage(dayFar, 0, fy);
    if (k > 0) { ctx.globalAlpha = k; ctx.drawImage(nightFar, 0, fy); ctx.globalAlpha = 1; }
    if (k < 1) ctx.drawImage(dayNear, 0, ny);
    if (k > 0) { ctx.globalAlpha = k; ctx.drawImage(nightNear, 0, ny); ctx.globalAlpha = 1; }

    // night: a few warm windows on the near hills, and fireflies above them
    if (k > 0.05) {
      for (const l of lights) {
        const ty = ny + nightNear.top[l.x] + 3;
        if (ty >= BH) continue;
        ctx.globalAlpha = k * 0.55 * (still ? 1 : 0.85 + 0.15 * Math.sin(t * 0.7 + l.ph));
        ctx.fillStyle = "#ffcf7a"; ctx.fillRect(l.x, ty, 1, 1);
      }
      if (!still) {
        for (const f of flies) {
          f.x += f.vx * dt; if (f.x < -2) f.x = BW + 2; if (f.x > BW + 2) f.x = -2;
          const y = f.y + Math.sin(t * 0.8 + f.ph) * 3, p = 0.5 + 0.5 * Math.sin(t * 1.6 + f.ph);
          ctx.globalAlpha = dark * p * 0.8;
          ctx.fillStyle = "#ffe9a6"; ctx.fillRect(Math.round(f.x), Math.round(y), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    const d = performance.now() - a;
    if (DEBUG) { perf.n++; perf.sum += d; perf.max = Math.max(perf.max, d); }
    if (!still) raf = requestAnimationFrame(frame);
    else if (bodyVis !== bodyT || tSky !== tGoal) request();
  }

  function size() { build(); measure(); if (coverAt) checkBody(); request(); }
  size();
  emit();
  watchSkyline();
  // phones resize on every address-bar move: rebuild only on a real change, once things settle
  addEventListener("resize", () => {
    if (innerWidth === w && Math.abs(innerHeight - h) < 90) return;
    clearTimeout(timer); timer = setTimeout(size, 140);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { last = 0; lastT = now(); request(); } });

  if (DEBUG) {
    window.__scene = () => { const o = { phase: phase(), tSky, tGoal, asleep, bodyVis, prog, BW, BH, P, frames: perf.n, avgMs: +(perf.sum / Math.max(1, perf.n)).toFixed(2), maxMs: +perf.max.toFixed(2) }; perf.n = 0; perf.sum = 0; perf.max = 0; return o; };
    window.__pinSleep = (v) => { pinSleep = v; if (v != null) setAsleep(v); };
  }
}

if (KIND === "pixel") start(); // anything else (e.g. ?bg=studio) keeps the plain backdrop (and a night city)
