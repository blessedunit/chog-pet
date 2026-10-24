// The trailer near the bottom, as Chogtown's open-air cinema: a marquee, a still with a play button and, on both
// sides of it and exactly as tall as it, pixel bleachers full of tiny Chogs under a string of bunting, drawn like
// the town's walkers (a face with a 1px outline on two little legs). They bob in step to one beat, now and then
// one hops with a note or a heart, some wave glow sticks; at night the risers go dark and the bulbs light up.
// Once the trailer plays a wave runs out from the screen and the beat speeds up.
// Cheap: two canvases drawn on a 3px pixel grid (faces at full resolution), the risers cached per look, ~24 fps only while on screen.
// The YouTube player loads only on a tap (no cookies until then).
const sec = document.getElementById("trailer");
const box = document.getElementById("trVideo");
const cvs = [document.getElementById("trPartyL"), document.getElementById("trPartyR")];

// #953 (token 1462) plus a hand-checked pool (token ids; some hats carry words we don't want here)
const POOL = [309, 1942, 149, 1040, 1292, 127, 99, 177, 870, 144, 186, 1864, 122, 1682, 338, 1413, 577, 982, 1655, 1050,
  376, 1035, 484, 1911, 142, 1888, 1960, 1107, 1019, 1950, 755, 1513, 1921];
const FLAGS = ["#ff8fc8", "#ffd84d", "#46e38f", "#9fb4ff", "#ffae45"];
const STICK = ["#46e38f", "#ff8fc8", "#ffd84d", "#9fb4ff"];
const LOOK = {
  d: { tread: "#f6f3ff", riser: "#d6cffb", line: "#9c8ff0", post: "#8d7ef0", out: "#3e3288", leg: "#4a3d96", rope: "#7d6fd6", shade: "rgba(70,56,160,0.16)" },
  n: { tread: "#2a2352", riser: "#1f1846", line: "#0c0a1c", post: "#3a3170", out: "#06040e", leg: "#0c0a1c", rope: "#4a3f8a", shade: "rgba(0,0,0,0.3)" },
};
const HEART = ["01010", "11111", "11111", "01110", "00100"];
const NOTE = ["0011", "0010", "0010", "1110", "1110"];
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const R = Math.round;
const rnd = (a, b) => a + Math.random() * (b - a);
const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);

let P = 3, DPR = 1, atlas = null, sides = [], seen = false, playing = false, night = false, raf = 0, last = 0, beat = 0, nextHop = 0;
const S = 16; // face size in pixels

function loadAtlas() {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = "/img/atlas-48.webp";
  });
}

// a face with a 1px outline and nipped corners, cached per token and look; drawn at full resolution so it stays sharp
const faces = new Map();
function face(t) {
  const key = t + (night ? "n" : "d");
  if (faces.has(key)) return faces.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = (S + 2) * P * DPR;
  const g = c.getContext("2d");
  g.scale(P * DPR, P * DPR);
  g.fillStyle = LOOK[night ? "n" : "d"].out;
  g.fillRect(1, 0, S, S + 2);
  g.fillRect(0, 1, S + 2, S);
  g.save();
  g.beginPath();
  g.rect(2, 1, S - 2, S);
  g.rect(1, 2, S, S - 2);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const i = t - 1;
  if (atlas) g.drawImage(atlas, (i % 45) * 48, Math.floor(i / 45) * 48, 48, 48, 1, 1, S, S);
  if (night) {
    g.fillStyle = "rgba(14,10,34,0.28)";
    g.fillRect(1, 1, S, S);
  }
  g.restore();
  faces.set(key, c);
  return c;
}

function bits(g, rows, x, y, col) {
  g.fillStyle = col;
  rows.forEach((row, j) => [...row].forEach((b, i) => b === "1" && g.fillRect(x + i, y + j, 1, 1)));
}

// lay out both sides: rows of risers from the back (narrow, high) to the front (wide, standing on the video's
// bottom edge), the bunting above, and who sits where
function build() {
  const s = sec.getBoundingClientRect(), v = box.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  P = 3;
  DPR = Math.min(2, devicePixelRatio || 1);
  faces.clear();
  const ids = [1462, ...shuffle(POOL), ...shuffle(POOL), ...shuffle(POOL)];
  sides = [[-s.left, v.left], [v.right - s.left, vw - v.right]].map(([x0, Wc], side) => {
    const c = cvs[side];
    const w = Math.floor((Wc - 24) / P), h = Math.floor(v.height / P);
    if (w < 60) {
      c.hidden = true;
      return null;
    }
    c.hidden = false;
    c.width = w * P * DPR;
    c.height = h * P * DPR;
    Object.assign(c.style, { left: x0 + (Wc - w * P) / 2 + "px", top: v.top - s.top + (v.height - h * P) / 2 + "px", width: w * P + "px", height: h * P + "px" });
    const rows = h >= 140 ? 4 : 3, pitch = Math.floor((h - 26) / rows);
    const tiers = [], fans = [];
    for (let r = 0; r < rows; r++) {
      const k = 0.72 + (0.28 * r) / (rows - 1);
      const rw = Math.round((w - 4) * k), rx = side ? 2 : w - 2 - rw; // the narrow back rows lean toward the screen
      const ty = h - 9 - (rows - 1 - r) * pitch; // tread top
      tiers.push({ x: rx, y: ty, w: rw });
      const n = Math.max(1, Math.floor((rw - 6) / (S + 5)));
      const sp = (rw - 6) / n;
      for (let i = 0; i < n; i++) {
        if (r < rows - 1 && i > 0 && i < n - 1 && Math.random() < 0.08) continue; // the odd empty seat
        const x = R(rx + 3 + sp * i + sp / 2 + rnd(-1.5, 1.5));
        const near = side ? x : w - x; // distance from the screen, for the play wave
        fans.push({ t: ids.shift() || 1462, x, y: ty, near, off: Math.random() < 0.5 ? 0 : 0.5, stick: Math.random() < 0.3 ? STICK[Math.floor(Math.random() * 4)] : "", hop: -1 });
      }
    }
    const g = c.getContext("2d");
    g.setTransform(P * DPR, 0, 0, P * DPR, 0, 0);
    return { c, g, w, h, side, tiers, fans, emo: [], bg: null, bgN: null };
  });
}

// the risers, cached per look
function risers(sd) {
  const key = night ? "bgN" : "bg";
  if (sd[key]) return sd[key];
  const L = LOOK[night ? "n" : "d"];
  const c = document.createElement("canvas");
  c.width = sd.w * P * DPR;
  c.height = sd.h * P * DPR;
  const g = c.getContext("2d");
  g.scale(P * DPR, P * DPR);
  sd.tiers.forEach((t, r) => {
    const bottom = r === sd.tiers.length - 1 ? sd.h : sd.tiers[r + 1].y + 3;
    // posts down to the next row, then the tread and the riser face
    g.fillStyle = L.post;
    g.fillRect(t.x + 1, t.y, 2, bottom - t.y);
    g.fillRect(t.x + t.w - 3, t.y, 2, bottom - t.y);
    g.fillStyle = L.line;
    g.fillRect(t.x, t.y - 1, t.w, 1);
    g.fillStyle = L.tread;
    g.fillRect(t.x, t.y, t.w, 3);
    g.fillStyle = L.riser;
    g.fillRect(t.x, t.y + 3, t.w, 5);
    g.fillStyle = L.line;
    g.fillRect(t.x, t.y + 8, t.w, 1);
    // slats on the riser
    g.fillStyle = L.shade;
    for (let x = t.x + 6; x < t.x + t.w - 4; x += 7) g.fillRect(x, t.y + 4, 1, 3);
  });
  return (sd[key] = c);
}

// a string of bunting across the top; bulbs between the flags light up at night
function bunting(sd, now) {
  const { g, w } = sd, L = LOOK[night ? "n" : "d"];
  const y0 = 4, sag = 8, sway = Math.sin(now / 900) * (playing ? 1.2 : 0.6);
  const yAt = (x) => y0 + (sag + sway) * Math.sin((Math.PI * x) / w);
  g.fillStyle = L.rope;
  for (let x = 0; x < w; x++) g.fillRect(x, R(yAt(x)), 1, 1);
  let k = 0;
  for (let x = 4; x < w - 8; x += 10, k++) {
    const y = R(yAt(x + 2.5)) + 1;
    g.fillStyle = FLAGS[k % FLAGS.length];
    for (let j = 0; j < 6; j++) g.fillRect(x + (j >> 1), y + j, 6 - (j >> 1) * 2, 1);
    if (night) {
      const bx = x + 8, by = R(yAt(bx)) + 1, on = (Math.floor(now / 500) + k) % 3 !== 0;
      if (on) {
        g.fillStyle = "rgba(255,216,77,0.25)";
        g.fillRect(bx - 1, by - 1, 3, 4);
      }
      g.fillStyle = on ? "#ffd84d" : "#8a7a3a";
      g.fillRect(bx, by, 1, 2);
    }
  }
}

function draw(now) {
  const L = LOOK[night ? "n" : "d"];
  beat += last ? ((now - last) / 60000) * (playing ? 150 : 96) : 0;
  last = now;
  for (const sd of sides) {
    if (!sd) continue;
    const { g, w, h } = sd;
    g.clearRect(0, 0, w, h);
    g.drawImage(risers(sd), 0, 0, w, h);
    bunting(sd, now);
    for (const f of sd.fans) {
      const step = RM ? 0 : (beat + f.off) % 1 < 0.5 ? 0 : 1;
      let lift = 0;
      if (f.hop >= 0) {
        const t = (now - f.hop) / 520;
        if (t >= 1) f.hop = -1;
        else lift = R(Math.sin(Math.PI * t) * 7);
      }
      const fx = f.x - (S + 2) / 2, legY = f.y - 3;
      g.fillStyle = L.shade;
      g.fillRect(f.x - 5, f.y - 1, 10, 1);
      // legs: one bends on each beat; both tuck in mid-hop
      g.fillStyle = L.leg;
      g.fillRect(f.x - 4, legY - lift + (lift ? 0 : step), 2, 3 - (lift ? 1 : step));
      g.fillRect(f.x + 2, legY - lift + (lift ? 0 : 1 - step), 2, 3 - (lift ? 1 : 1 - step));
      const hy = legY - (S + 2) - lift + (lift ? 0 : step);
      if (f.stick) {
        // a glow stick held up, tipping left and right on the beat
        const sx = sd.side ? fx + S + 2 : fx - 1, dir = step ? 1 : -1;
        if (night) {
          g.fillStyle = f.stick + "44";
          g.fillRect(sx - 3, hy - 9, 7, 12);
        }
        g.fillStyle = f.stick;
        for (let j = 0; j < 9; j++) g.fillRect(sx + R((dir * (8 - j)) / 4), hy - 7 + j, 1, 1);
        g.fillStyle = "#fff";
        g.fillRect(sx + R((dir * 8) / 4), hy - 7, 1, 1);
      }
      g.drawImage(face(f.t), fx, hy, S + 2, S + 2);
    }
    // notes and hearts drift up and fade
    sd.emo = sd.emo.filter((e) => now - e.at < 1500);
    for (const e of sd.emo) {
      const t = (now - e.at) / 1500;
      g.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      bits(g, e.heart ? HEART : NOTE, R(e.x + Math.sin(t * 7) * 1.5), R(e.y - t * 16), e.col);
    }
    g.globalAlpha = 1;
  }
  if (!RM && now > nextHop) {
    nextHop = now + (playing ? 380 : 800) + rnd(0, 400);
    const live = sides.filter(Boolean);
    const sd = live[Math.floor(Math.random() * live.length)];
    if (sd && sd.fans.length) hop(sd, sd.fans[Math.floor(Math.random() * sd.fans.length)], now, true);
  }
}

function hop(sd, f, now, emo) {
  if (f.hop >= 0) return;
  f.hop = now;
  if (!emo) return;
  const heart = Math.random() < (playing ? 0.65 : 0.4);
  sd.emo.push({ x: f.x - 2, y: f.y - S - 12, at: now, heart, col: heart ? "#ff4fa0" : night ? "#ffd84d" : "#6b4cff" });
}

function loop(now) {
  raf = 0;
  if (!seen || document.hidden) return (last = 0);
  if (!last || now - last >= 40) draw(now);
  if (!RM) raf = requestAnimationFrame(loop);
}
const wake = () => seen && !raf && !document.hidden && (raf = requestAnimationFrame(loop));
const skyNight = () => (window.CHOG_SKY ? window.CHOG_SKY.t : 1) > 0.5;

if (sec && box && cvs[0] && cvs[1]) {
  let ready = null;
  new IntersectionObserver((es) => {
    seen = es[0].isIntersecting;
    if (seen && !ready) {
      ready = loadAtlas().then((im) => {
        atlas = im;
        night = skyNight();
        build();
        wake();
      });
    } else if (ready) ready.then(wake);
  }, { rootMargin: "200px" }).observe(sec);
  addEventListener("chogpet:sky", () => {
    if (skyNight() === night) return;
    night = !night;
    if (RM && sides.length) draw(performance.now());
  });
  document.addEventListener("visibilitychange", () => ready && ready.then(wake));
  let rz = 0;
  const relayout = () => {
    clearTimeout(rz);
    rz = setTimeout(() => ready && ready.then(() => (build(), RM && draw(performance.now()))), 150);
  };
  new ResizeObserver(relayout).observe(box);
  addEventListener("resize", relayout);
  document.getElementById("trPlay")?.addEventListener("click", () => {
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    sec.classList.add("playing");
    playing = true;
    // a wave runs out from the screen on both sides
    if (!RM) for (const sd of sides) if (sd) for (const f of sd.fans) setTimeout(() => hop(sd, f, performance.now(), Math.random() < 0.3), 100 + f.near * 7);
    wake();
  });
}
