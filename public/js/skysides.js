// Chogtown's empty sides (js/skyline.js): footpaths that lead in from the left and right edges to the ring, with a
// few trees, lamps, a bench and flowers; tiny walkers - every real care action in town (yours at once, everyone
// else's from /api/board) sends the cared-for Chog walking up a path into the ring; and some sky life - a slow blimp
// towing the $CHOG price (/api/stats), a hot-air balloon or two by day, and on a night the town's daily goal is met
// (/api/today) the odd pixel firework over the ring.
// Cheap: the paths and props are one tiny pixel canvas per look (day / night) and layout, scaled up without
// smoothing; sprites are cached; nothing here touches the DOM per frame. Overview only: everything fades out while
// a tower is framed. prefers-reduced-motion: walkers stand still, the blimp is parked, no fireworks.
import * as K from "./skykit.js";

const R = Math.round;
const TAU = Math.PI * 2;
const VERB = { feed: "fed", play: "played", clean: "bathed", lights: "tucked in", love: "petted", gift: "got a gift", name: "named", move: "moved in" };
const verbOf = (a, code) => (a === "lights" && code && code !== "nap" ? "woke up" : VERB[a] || "visited");
const FW = ["#ffd84d", "#46e38f", "#ff8fc8", "#9fb4ff", "#ffae45", "#f5f0ff"];
const Q = new URLSearchParams(location.search);

/** o: { a24, RM, sideOf(id) -> -1 | 1, onArrive(id), dirty() } */
export function makeSides(o) {
  const RM = o.RM;
  let g = null, gk = ""; // layout (css px)
  let routes = { l: null, r: null }, wide = false, P = 4;
  const layers = { d: null, n: null };
  const walkers = [];
  const queue = [];
  const seen = new Set();
  const mine = new Map(); // pet -> when you cared for it here (the board will list it again)
  let lastT = 0, boardAt = 0, seeded = false, price = null, priceAt = -1e9, today = null, todayAt = -1e9;
  let lamps = []; // lamp bulbs on the side paths, css px (their night glow is painted live, soft)
  let nextFw = 0;
  const bursts = [];
  const sprites = new Map();
  const t0 = performance.now() - 22000; // the blimp starts a little way in

  // ---------- layout ----------
  /** geo: { W, H, dpr, phone, cx, cy, rxR, ryR (ring), rxG, ryG (outer ground), rxL, ryL (lamp road), gy, headB, headR, ringTop, p } */
  function layout(geo) {
    const k = [geo.W, geo.H, geo.dpr, R(geo.cx), R(geo.cy), R(geo.rxG), R(geo.ryG), R(geo.gy), R(geo.headB), R(geo.ringTop)].join("|");
    g = geo;
    if (k === gk) return;
    gk = k;
    P = geo.p;
    layers.d = layers.n = null;
    const side = geo.cx - geo.rxG;
    wide = !geo.phone && side >= 90;
    if (wide) {
      routes.l = bez(path(-1));
      routes.r = bez(path(1));
    } else {
      routes.l = road(-1);
      routes.r = road(1);
    }
    for (const w of walkers) w.rt = routes[w.side < 0 ? "l" : "r"];
  }
  // a gentle S from the screen edge (low, near the viewer) up to the rim of the ring
  function path(s) {
    const { W, H, cx, cy, rxG, ryG, gy } = g;
    const side = cx - rxG;
    const ex = cx + s * (rxG - 3), ey = cy + ryG * (s < 0 ? 0.06 : 0.12);
    const sy = K.clamp(cy + ryG * (s < 0 ? 0.78 : 0.6), gy + 60, H * 0.8);
    const sx = s < 0 ? -14 : W + 14;
    const x = (f) => (s < 0 ? f : W - f);
    // leaves the edge level, swings up in an S and meets the rim of the ring head-on
    return [
      [sx, sy],
      [x(side * (s < 0 ? 0.5 : 0.44)), sy + (s < 0 ? 4 : 2)],
      [x(side * (s < 0 ? 0.42 : 0.5)), ey + (s < 0 ? -6 : -4)],
      [ex, ey],
    ];
  }
  function bez(c) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, u = 1 - t;
      pts.push([
        u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0],
        u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1],
      ]);
    }
    return poly(pts, c);
  }
  // phones: no free ground beside the ring, so walkers come in along the near side of the ring road
  function road(s) {
    const { W, cx, cy, rxL, ryL } = g;
    const pts = [];
    const x0 = s < 0 ? -12 : W + 12, x1 = s < 0 ? W * 0.24 : W * 0.76;
    for (let i = 0; i <= 24; i++) {
      const x = x0 + (x1 - x0) * (i / 24);
      const c = K.clamp((x - cx) / rxL, -1, 1);
      pts.push([x, cy + ryL * Math.sqrt(1 - c * c)]);
    }
    return poly(pts, null);
  }
  function poly(pts, c) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, L, len: L[L.length - 1], c };
  }
  function at(rt, d) {
    const { pts, L } = rt;
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const f = K.clamp((d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]), 0, 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  }

  // ---------- the static ground layer: paths + props on a tiny pixel canvas ----------
  const PAL = {
    d: {
      edge: "#b4ace8", body: "#e3dffc", tile: "#efecff", rim: "#d9d3fb",
      leaf: [["#a6dcc1", "#d3f2e1", "#7fbea4"], ["#f3c2da", "#fde3ef", "#d69ec2"]], trunk: "#8f7bc6",
      shadow: "rgba(84,70,176,0.16)", post: "#6f62b8", bulb: "#fff6dc", seat: "#c9b0ec", seatD: "#a891d8",
      flowers: ["#ff9fc6", "#ffe08a", "#ffffff", "#b9a6ff"],
    },
    n: {
      edge: "#08060f", body: "#18123a", tile: "#1f1846", rim: "#140f2e",
      leaf: [["#1b2a43", "#26395a", "#121b31"], ["#2b1f47", "#3a2b5c", "#1d1533"]], trunk: "#110d24",
      shadow: "rgba(0,0,0,0.25)", post: "#0c0a1c", bulb: "#ffe3a8", seat: "#231a46", seatD: "#17112f",
      flowers: ["#4a3a78", "#3b3070", "#5a4a8a", "#2f2860"],
    },
  };
  const PROPS = {
    l: [["tree", 0.1, -1, 9, 0, 4], ["flow", 0.2, 1, 7, 0], ["lamp", 0.3, 1, 6.5], ["tree", 0.42, 1, 10, 1, 3], ["bench", 0.54, -1, 6.5], ["flow", 0.6, -1, 9, 1], ["lamp", 0.72, -1, 5.5], ["tree", 0.83, 1, 7.5, 0, 3]],
    r: [["flow", 0.1, -1, 7, 2], ["tree", 0.2, 1, 10, 1, 4], ["lamp", 0.36, -1, 6.5], ["tree", 0.5, -1, 9.5, 0, 3], ["flow", 0.58, 1, 6.5, 3], ["lamp", 0.7, 1, 5.5], ["tree", 0.84, -1, 7, 1, 3]],
  };
  function layer(look) {
    if (layers[look]) return layers[look];
    const { W, H, gy } = g;
    lamps = [];
    const c = document.createElement("canvas");
    c.width = Math.ceil(W / P);
    c.height = Math.ceil(H / P);
    const x = c.getContext("2d");
    if (wide) {
      const pl = PAL[look];
      const items = [];
      for (const s of ["l", "r"]) {
        const rt = routes[s];
        stamp(x, rt, pl);
        const cp = rt.c;
        for (const [kind, t, side, off, v, size] of PROPS[s]) {
          const p0 = bp(cp, t), p1 = bp(cp, t + 0.01);
          let nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0];
          const l = Math.hypot(nx, ny) || 1;
          nx /= l; ny /= l;
          if (ny > 0) (nx = -nx), (ny = -ny); // "side -1" is always the far (upper) side
          const sg = side < 0 ? 1 : -1;
          const u = p0[0] / P + nx * off * sg, vv = p0[1] / P + ny * off * sg * 0.75;
          if (vv * P < gy + 6 || u < 1 || u > W / P - 1) continue;
          // stay off the ring's ground
          const ex = (u * P - g.cx) / (g.rxG + 6), ey = (vv * P - g.cy) / (g.ryG + 6);
          if (ex * ex + ey * ey < 1) continue;
          items.push({ kind, u: R(u), v: R(vv), var: v || 0, size: size || 3 });
        }
      }
      items.sort((a, b) => a.v - b.v);
      for (const it of items) prop(x, it, pl, look === "n");
    }
    return (layers[look] = c);
  }
  const bp = (c, t) => {
    t = K.clamp(t, 0, 1);
    const u = 1 - t;
    return [
      u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0],
      u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1],
    ];
  };
  function stamp(x, rt, pl) {
    const n = rt.pts.length;
    const pass = (col, dy, grow) => {
      x.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const hw = (P >= 4 ? 4.6 : 5.2) * (1 - 0.45 * t) + grow, hv = Math.max(1, hw * 0.42);
        const [u, v] = rt.pts[i];
        x.fillRect(R(u / P - hw), R(v / P - hv + dy), R(hw * 2), R(hv * 2));
      }
    };
    pass(pl.edge, 1, 0.3);
    pass(pl.body, 0, 0);
    // paving: a lighter stone now and then down the middle
    x.fillStyle = pl.tile;
    for (let i = 2; i < n - 3; i += 3) {
      const [u, v] = rt.pts[i];
      const o = (i / 3) % 2 ? -1 : 0;
      x.fillRect(R(u / P) + o, R(v / P), 2, 1);
    }
  }
  function prop(x, it, pl, night) {
    const { u, v } = it;
    const f = (col, a, b, w = 1, h = 1) => ((x.fillStyle = col), x.fillRect(a, b, w, h));
    if (it.kind === "tree") {
      const r = it.size, [mid, hi, sh] = pl.leaf[it.var];
      f(pl.shadow, u - r - 1, v, r * 2 + 1, 1);
      f(pl.trunk, u, v - 2, 1, 2);
      const cy = v - 2 - r;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy * 1.1 > r * r + 0.6) continue;
          const s = dx + dy;
          f(s <= -r * 0.7 ? hi : s >= r * 0.6 ? sh : mid, u + dx, cy + dy);
        }
    } else if (it.kind === "lamp") {
      lamps.push([(u + 0.5) * P, (v - 5.5) * P, v * P]);
      if (!night) f(pl.shadow, u - 2, v, 3, 1);
      f(pl.post, u, v - 5, 1, 5);
      f(pl.post, u - 1, v - 6, 3, 1);
      f(pl.bulb, u, v - 6, 1, 1);
    } else if (it.kind === "bench") {
      f(pl.shadow, u - 3, v, 6, 1);
      f(pl.seatD, u - 2, v - 3, 5, 1);
      f(pl.seat, u - 2, v - 2, 5, 1);
      f(pl.seatD, u - 2, v - 1, 1, 1);
      f(pl.seatD, u + 2, v - 1, 1, 1);
    } else if (it.kind === "flow") {
      const n = night ? 3 : 6;
      for (let i = 0; i < n; i++) {
        const h = K.hash(u * 31 + v * 7 + i * 13 + it.var);
        f(pl.flowers[(i + it.var) % pl.flowers.length], u + R((h - 0.5) * 6), v + R((K.hash(h * 999 + i) - 0.5) * 3));
      }
    }
  }

  // ---------- walkers ----------
  const cap = () => (g && g.phone ? 4 : 12);
  function spawn(e, now, at0) {
    if (!g || !routes.l) return;
    const id = e.pet;
    const live = walkers.filter((w) => !w.done).length;
    if (live >= cap()) {
      if (queue.length >= 16) queue.shift();
      queue.push(e);
      return;
    }
    const side = o.sideOf(id) || (K.hash(id) < 0.5 ? -1 : 1);
    const rt = routes[side < 0 ? "l" : "r"];
    walkers.push({
      id, a: e.a, who: e.who || "", code: e.code || "", side, rt,
      d: at0 != null ? at0 * rt.len : 0,
      v: (g.phone ? 13 : 19) * (0.85 + K.hash(id * 7 + now) * 0.3), // px / s
      lane: R((K.hash(id * 3 + 1) - 0.5) * 4),
      ph: K.hash(id) * 1000, t: now, done: false, x: -99, y: -99, al: 0,
    });
  }
  // your own care: a walker right away (or, reduced motion, one standing on the path)
  function local(d) {
    const id = Number(d && d.id);
    if (!(id >= 1 && id <= K.N)) return;
    mine.set(id, Date.now());
    const e = { pet: id, a: d.a || "feed", who: "you", code: d.code || "" };
    if (RM) return still([e]);
    if (queue.length >= 16) queue.pop();
    queue.unshift(e); // the next free start on the path (a crowd of clicks walks in single file)
    o.dirty();
  }
  function still(list) {
    // reduced motion: up to three walkers stand along the paths, the newest nearest the ring
    for (const e of list) {
      const n = walkers.length;
      if (n >= 3) walkers.shift();
      spawn(e, performance.now(), 0);
    }
    walkers.forEach((w, i) => (w.d = w.rt.len * (0.28 + 0.2 * ((i + (w.side < 0 ? 0 : 1)) % 3)), (w.v = 0)));
    o.dirty();
  }
  async function poll(now) {
    if (now - boardAt < 40000 && seeded) return;
    boardAt = now;
    let b = null;
    try {
      const r = await fetch("/api/board");
      b = r.ok ? await r.json() : null;
    } catch (e) {}
    const rec = (b && b.recent) || [];
    const key = (e) => `${e.pet}|${e.t}|${e.a}`;
    if (!seeded) {
      seeded = true;
      for (const e of rec) seen.add(key(e)), (lastT = Math.max(lastT, e.t || 0));
      // first view: a few of the latest already on their way
      const first = rec.filter((e) => e.pet >= 1 && e.pet <= K.N).slice(0, g && g.phone ? 2 : 4).reverse();
      if (RM) return still(first.slice(-3));
      first.forEach((e, i) => spawn(e, performance.now(), 0.1 + (i / Math.max(1, first.length)) * 0.6));
      o.dirty();
      return;
    }
    const fresh = rec
      .filter((e) => !seen.has(key(e)) && (e.t || 0) >= lastT && e.pet >= 1 && e.pet <= K.N)
      .filter((e) => !(mine.has(e.pet) && Date.now() - mine.get(e.pet) < 180000))
      .reverse();
    for (const e of rec) seen.add(key(e)), (lastT = Math.max(lastT, e.t || 0));
    if (RM) return fresh.length && still(fresh.slice(-3));
    // spread them out so they don't arrive in a crowd
    const gap = Math.max(2600, 38000 / Math.max(1, fresh.length));
    fresh.forEach((e, i) => setTimeout(() => queue.push(e), i * gap + K.hash(e.pet) * 1200));
  }

  // once per frame (not per look): move everything, pull from the queue, launch fireworks
  let lastNow = 0;
  function tick(now, geo, onScreen) {
    layout(geo);
    const dt = Math.min(0.1, lastNow ? (now - lastNow) / 1000 : 0);
    lastNow = now;
    if (onScreen) {
      poll(now);
      if (now - priceAt > 300000) fetchPrice(now);
      if (now - todayAt > 300000) fetchToday(now);
    }
    if (queue.length && walkers.filter((w) => !w.done).length < cap() && !RM) {
      const busyStart = walkers.some((w) => w.d < 26 && !w.done && w.v);
      if (!busyStart) spawn(queue.shift(), now);
    }
    for (const w of walkers) {
      if (w.done) continue;
      w.d += w.v * dt;
      if (w.d >= w.rt.len) {
        w.done = true;
        o.onArrive(w.id);
      }
    }
    for (let i = walkers.length - 1; i >= 0; i--) if (walkers[i].done) walkers.splice(i, 1);
    // fireworks: a night after the town's goal was reached
    if (!RM && geo.night && goalMet()) {
      if (!nextFw) nextFw = now + 1200;
      if (now >= nextFw) {
        nextFw = now + 3800 + Math.random() * 5200;
        burst(now);
        if (Math.random() < 0.3) setTimeout(() => burst(performance.now()), 450);
      }
    } else nextFw = 0;
    for (let i = bursts.length - 1; i >= 0; i--) if (now - bursts[i].t0 > 2700) bursts.splice(i, 1);
  }
  const goalMet = () => Q.get("fw") === "1" || !!(today && today.goal && today.deeds >= today.goal);
  function burst(now) {
    if (!g) return;
    const span = Math.min(g.rxR * 0.62, g.W * 0.3);
    const top = Math.max(g.headB + 40, g.ringTop - g.H * 0.17), bot = Math.max(top + 10, g.ringTop - 18);
    bursts.push({
      x: g.cx + (Math.random() * 2 - 1) * span, y: top + Math.random() * (bot - top), t0: now,
      col: FW[(Math.random() * FW.length) | 0], col2: FW[(Math.random() * FW.length) | 0],
      r: (g.phone ? 26 : 44) * (0.8 + Math.random() * 0.4), n: 24 + ((Math.random() * 10) | 0), rot: Math.random() * TAU,
    });
  }
  async function fetchPrice(now) {
    priceAt = now;
    try {
      const s = await (await fetch("/api/stats")).json();
      price = s && s.chogUsd != null ? s.chogUsd : null;
      sprites.forEach((v, k) => k.startsWith("b") && sprites.delete(k));
      o.dirty();
    } catch (e) {}
  }
  async function fetchToday(now) {
    todayAt = now;
    try {
      today = await (await fetch("/api/today")).json();
    } catch (e) {}
  }
  addEventListener("chogpet:act", (e) => local(e.detail));

  // ---------- drawing ----------
  // the sky: balloons (day), the blimp, fireworks (night)
  function sky(G, look, now, vis) {
    if (!g || vis <= 0) return;
    const day = look === "d";
    G.globalAlpha = vis;
    G.imageSmoothingEnabled = false;
    if (day && !g.phone) balloons(G, now);
    blimp(G, look, now);
    G.globalAlpha = 1;
    G.imageSmoothingEnabled = true;
    if (!day && bursts.length) fireworks(G, now, vis);
  }
  function balloons(G, now) {
    const { W, H, headB, gy, cx, rxR } = g;
    const list = [
      { s: 0, fx: 0.085, top: headB + 70, bot: gy - 60, u: W >= 1700 ? 4 : 3 },
      { s: 1, fx: 0.94, top: Math.max(headB + 60, H * 0.22), bot: gy - 50, u: W >= 1700 ? 3 : 2 },
    ];
    for (const b of list) {
      if (b.bot - b.top < 30) continue;
      const sp = balloonSprite(b.s, b.u);
      const t = RM ? 0 : now / 1000;
      let x = W * b.fx + Math.sin(t / 26 + b.s * 2) * W * 0.012 - sp.w / 2;
      const y = b.top + (b.bot - b.top) * (b.s ? 0.35 : 0.3) + (RM ? 0 : Math.sin(t / 5.5 + b.s * 3) * 5) - sp.h / 2;
      // keep clear of the ring
      if (b.s === 0) x = Math.min(x, cx - rxR - sp.w - 20);
      else x = Math.max(x, cx + rxR + 20);
      if (x < 4 || x + sp.w > W - 4) continue;
      G.drawImage(sp.c, R(x), R(y), sp.w, sp.h);
    }
  }
  function balloonSprite(s, u) {
    const key = `l${s}|${u}|${g.dpr}`;
    if (sprites.has(key)) return sprites.get(key);
    const rows = [3, 5, 7, 7, 7, 7, 5, 3, 1];
    const cols = s ? ["#b9ecd3", "#e6deff", "#8fd3b4"] : ["#ffb8d3", "#fff1d9", "#e99abd"];
    const w = 7 * u, h = 14 * u;
    const c = document.createElement("canvas");
    c.width = R(w * g.dpr);
    c.height = R(h * g.dpr);
    const x = c.getContext("2d");
    x.scale(g.dpr, g.dpr);
    rows.forEach((n, r) => {
      const x0 = (7 - n) / 2;
      for (let i = 0; i < n; i++) {
        const cx = x0 + i;
        const stripe = Math.floor(cx) % 2 ? cols[0] : cols[1];
        x.fillStyle = cx >= 5 && r > 1 ? cols[2] : stripe;
        if (r === 0 || (r === 1 && i === 1)) x.fillStyle = "#ffffff";
        x.fillRect(cx * u, r * u, u, u);
      }
    });
    x.fillStyle = "rgba(90,76,170,0.55)";
    x.fillRect(2 * u, 9 * u, Math.max(1, u / 3), 2 * u);
    x.fillRect(5 * u - Math.max(1, u / 3), 9 * u, Math.max(1, u / 3), 2 * u);
    x.fillStyle = "#9a7a5e";
    x.fillRect(2 * u, 11 * u, 3 * u, 2 * u);
    x.fillStyle = "#b8977a";
    x.fillRect(2 * u, 11 * u, 3 * u, u * 0.5);
    const o2 = { c, w, h };
    sprites.set(key, o2);
    return o2;
  }
  const priceText = () => (price == null ? "CHOGTOWN" : "$CHOG " + (price >= 1 ? "$" + price.toFixed(2) : price < 0.01 ? "$" + price.toPrecision(3) : "$" + price.toFixed(4)));
  function blimpLane() {
    const { headB, ringTop, phone, H } = g;
    const room = ringTop - headB;
    return K.clamp(headB + room * (phone ? 0.6 : 0.58), headB + (phone ? 22 : 34), Math.max(headB + 34, H * 0.4));
  }
  let blimpBox = null;
  function blimp(G, look, now) {
    const sp = blimpSprite(look);
    const { W } = g;
    const loop = W + sp.w + W * 0.25;
    const speed = g.phone ? 9 : 15;
    // reduced motion: parked in the clear sky left of the ring
    let x = RM ? K.clamp(g.cx - g.rxR - sp.w * 0.8, 8, W - sp.w - 8) : ((((now - t0) / 1000) * speed) % loop) - sp.w;
    const y = blimpLane() - sp.ay + (RM ? 0 : R(Math.sin(now / 2100) * 2));
    if (look === "n") {
      // the lit banner throws a soft glow
      G.save();
      G.globalCompositeOperation = "lighter";
      G.globalAlpha *= 0.45;
      G.drawImage(lanternGlow(), R(x) - sp.bw * 0.25, R(y + sp.by + sp.bh / 2) - sp.bh * 1.6, sp.bw * 1.5, sp.bh * 3.2);
      G.restore();
    }
    G.drawImage(sp.c, R(x), R(y), sp.w, sp.h);
    blimpBox = { x: R(x), y: R(y), w: sp.w, h: sp.h, text: priceText() };
    if (look === "n" && !RM) {
      // nav lights: red on the tail fin, white under the nose
      const on = (now / 1000) % 1.6 < 0.18, on2 = ((now / 1000) + 0.8) % 1.6 < 0.18;
      const u = sp.u;
      if (on) {
        G.fillStyle = "#ff4f5e";
        G.fillRect(R(x + sp.tx), R(y + sp.ty), u, u);
      }
      if (on2) {
        G.fillStyle = "#f5f0ff";
        G.fillRect(R(x + sp.nx), R(y + sp.ny), u, u);
      }
    }
  }
  function blimpSprite(look) {
    const u = g.phone ? 2 : g.W >= 1700 ? 3 : 2;
    const text = priceText();
    const key = `b${look}|${u}|${g.dpr}|${text}`;
    if (sprites.has(key)) return sprites.get(key);
    const day = look === "d";
    const px = g.phone ? 8 : 8;
    const mg = document.createElement("canvas").getContext("2d");
    const font = `700 ${px}px Silkscreen, monospace`;
    mg.font = font;
    const tw = Math.ceil(mg.measureText(text).width);
    const bw = tw + 14, bh = px + 8; // banner
    const ew = 24 * u, eh = 9 * u; // envelope
    const rope = 6 * u;
    const w = bw + rope + ew + 2 * u, h = Math.max(eh + 4 * u, bh) + 4 * u + 6;
    const c = document.createElement("canvas");
    c.width = R(w * g.dpr);
    c.height = R(h * g.dpr);
    const x = c.getContext("2d");
    x.scale(g.dpr, g.dpr);
    const ex = bw + rope, ey = 3;
    const C = day
      ? { body: "#f4f1ff", hi: "#ffffff", sh: "#c7bef1", band: "#8d7ef0", fin: "#a597f4", gon: "#5f50c0", win: "#d8e2ff", ban: "#fffaf0", banE: "#c3b9ef", txt: "#2e1e8c", rope: "rgba(70,58,150,0.6)" }
      : { body: "#2a2352", hi: "#3a3170", sh: "#1a1538", band: "#5848b0", fin: "#3a2f7a", gon: "#14102c", win: "#ffd27a", ban: "#2a1f55", banE: "#ffd84d", txt: "#ffe7a0", rope: "rgba(160,140,230,0.5)" };
    // envelope: a pixel ellipse, lit from above
    const rx = 12, ry = 4.5;
    for (let j = 0; j < 9; j++)
      for (let i = 0; i < 24; i++) {
        const dx = (i + 0.5 - rx) / rx, dy = (j + 0.5 - ry) / ry;
        if (dx * dx + dy * dy > 1) continue;
        x.fillStyle = j === 4 && i > 3 && i < 21 ? C.band : dy < -0.45 && dx > -0.6 ? C.hi : dy > 0.5 ? C.sh : C.body;
        x.fillRect(ex + i * u, ey + j * u, u, u);
      }
    // tail fins (left end; it flies to the right)
    x.fillStyle = C.fin;
    x.fillRect(ex, ey - u, 3 * u, 2 * u);
    x.fillRect(ex - u, ey - 2 * u, 2 * u, u);
    x.fillRect(ex, ey + 8 * u, 3 * u, 2 * u);
    x.fillRect(ex - u, ey + 10 * u, 2 * u, u);
    // gondola with two little windows
    x.fillStyle = C.gon;
    x.fillRect(ex + 9 * u, ey + 9 * u, 6 * u, 2 * u);
    x.fillStyle = C.win;
    x.fillRect(ex + 10 * u, ey + 9 * u + R(u / 2), u, u);
    x.fillRect(ex + 12 * u, ey + 9 * u + R(u / 2), u, u);
    // tow rope and banner
    const by = ey + eh / 2 - bh / 2;
    x.fillStyle = C.rope;
    x.fillRect(bw, R(ey + eh / 2), rope + u, 1);
    x.fillStyle = C.banE;
    x.fillRect(0, R(by) - 1, bw, bh + 2);
    x.fillStyle = C.ban;
    x.fillRect(1, R(by), bw - 2, bh);
    // a swallowtail notch on the trailing end
    x.clearRect(0, R(by + bh / 2) - 1, 3, 2);
    x.font = font;
    x.textBaseline = "middle";
    x.fillStyle = C.txt;
    x.fillText(text, 8, R(by + bh / 2) + 0.5);
    const o2 = { c, w, h, u, bw, bh, by, ay: ey + eh / 2, tx: ex - u, ty: ey - 2 * u, nx: ex + 23 * u, ny: ey + 5 * u };
    sprites.set(key, o2);
    return o2;
  }
  function fireworks(G, now, vis) {
    G.save();
    G.globalCompositeOperation = "lighter";
    for (const b of bursts) {
      const t = (now - b.t0) / 1000;
      const rise = 0.8;
      if (t < rise) {
        // the shell climbing, a short fading trail under it
        const k = t / rise;
        const y = b.y + (1 - k) * (1 - k) * 130;
        for (let i = 0; i < 5; i++) {
          G.globalAlpha = (0.9 - i * 0.17) * vis;
          G.fillStyle = i ? "#ffcf8a" : "#fff3d6";
          G.fillRect(R(b.x), R(y + i * 3), 2, 2);
        }
        continue;
      }
      const k = Math.min(1, (t - rise) / 1.8);
      const a = (1 - Math.pow(k, 2.2)) * vis;
      if (a <= 0.02) continue;
      if (k < 0.35) {
        G.globalAlpha = (1 - k / 0.35) * 0.7 * vis;
        G.drawImage(lanternGlow(), b.x - b.r * 0.9, b.y - b.r * 0.9, b.r * 1.8, b.r * 1.8);
      }
      const ex = (q) => 1 - (1 - q) * (1 - q) * (1 - q);
      for (let i = 0; i < b.n; i++) {
        const an = b.rot + (i / b.n) * TAU;
        const rr = b.r * (i % 3 === 1 ? 0.62 : 1);
        const ca = Math.cos(an), sa = Math.sin(an) * 0.92;
        G.fillStyle = i % 3 === 1 ? b.col2 : b.col;
        // the spark and two fading points behind it (a short streak)
        for (let j = 0; j < 3; j++) {
          const q = ex(Math.max(0, k - j * 0.045));
          const x = b.x + ca * rr * q, y = b.y + sa * rr * q + k * k * 16;
          G.globalAlpha = a * (j ? 0.45 / j : 1);
          const z = j ? 2 : k < 0.45 ? 3 : 2;
          G.fillRect(R(x - z / 2), R(y - z / 2), z, z);
        }
      }
    }
    G.globalAlpha = 1;
    G.restore();
  }
  // the ground layer (before the towers)
  function ground(G, look, vis) {
    if (!g || !wide || vis <= 0) return;
    const c = layer(look);
    G.globalAlpha = vis;
    G.imageSmoothingEnabled = false;
    G.drawImage(c, 0, 0, c.width * P, c.height * P);
    G.imageSmoothingEnabled = true;
    if (look === "n") {
      // lamps: a warm pool on the path and a soft halo round the bulb
      G.save();
      G.globalCompositeOperation = "lighter";
      const gl = lanternGlow();
      for (const [x, y, gy2] of lamps) {
        G.globalAlpha = vis * 0.55;
        G.drawImage(gl, x - P * 9, gy2 - P * 2.2, P * 18, P * 4.4);
        G.globalAlpha = vis * 0.8;
        G.drawImage(gl, x - P * 4, y - P * 4, P * 8, P * 8);
      }
      G.restore();
    }
    G.globalAlpha = 1;
  }
  // walkers (after the towers: the paths and the near road are in front of the ring)
  function people(G, look, now, vis) {
    if (!g || vis <= 0 || !walkers.length) return;
    const day = look === "d";
    const S = g.phone ? 12 : P >= 4 ? 16 : 14;
    for (const w of walkers) {
      const len = w.rt.len;
      const [x0, y0] = at(w.rt, w.d);
      const fin = K.clamp((len - w.d) / 34, 0, 1), fadeIn = K.clamp(w.d / 18, 0, 1);
      const al = Math.min(fin, fadeIn) * vis;
      const x = R(x0), y = R(y0 + w.lane);
      w.x = x; w.y = y; w.al = al; w.S = S;
      if (al <= 0.02) continue;
      const moving = w.v > 0;
      const step = moving ? Math.floor((now + w.ph) / 230) % 2 : 0;
      const sp = walkerSprite(w.id, S, day);
      G.globalAlpha = al;
      // shadow, legs, head (the face), a 1px bob in step
      G.fillStyle = day ? "rgba(70,56,160,0.22)" : "rgba(0,0,0,0.35)";
      G.fillRect(x - R(S * 0.4), y, R(S * 0.8), 2);
      G.fillStyle = day ? "#4a3d96" : "#0c0a1c";
      const lh = 3;
      G.fillRect(x - 4, y - lh - (step ? 1 : 0), 2, lh + (step ? 1 : 0) - 0);
      G.fillRect(x + 2, y - lh - (step ? 0 : 1), 2, lh + (step ? 0 : 1) - 0);
      const hy = y - lh - S - (moving && step ? 1 : 0);
      G.drawImage(sp, x - S / 2 - 1, hy - 1, S + 2, S + 2);
      if (!day) {
        // a tiny lantern
        const lx = x + S / 2 + 2, ly = y - lh - R(S * 0.35) + (step ? 1 : 0);
        G.fillStyle = "#0c0a1c";
        G.fillRect(lx, ly - 3, 1, 3);
        G.save();
        G.globalCompositeOperation = "lighter";
        G.globalAlpha = al * 0.7;
        G.drawImage(lanternGlow(), lx - 14, ly - 12, 30, 30);
        G.restore();
        G.globalAlpha = al;
        G.fillStyle = "#ffd27a";
        G.fillRect(lx - 1, ly, 3, 3);
      }
      G.globalAlpha = 1;
    }
  }
  let lg = null;
  function lanternGlow() {
    if (lg) return lg;
    lg = document.createElement("canvas");
    lg.width = lg.height = 32;
    const x = lg.getContext("2d");
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,210,122,0.55)");
    gr.addColorStop(0.4, "rgba(255,210,122,0.16)");
    gr.addColorStop(1, "rgba(255,210,122,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    return lg;
  }
  // the face, framed in a 1px outline with the corners nipped off (a little round head)
  function walkerSprite(id, S, day) {
    const key = `w${id}|${S}|${day ? 1 : 0}|${g.dpr}`;
    if (sprites.has(key)) return sprites.get(key);
    if (sprites.size > 220) for (const k of [...sprites.keys()]) if (k[0] === "w") sprites.delete(k);
    const d = g.dpr, n = S + 2;
    const c = document.createElement("canvas");
    c.width = R(n * d);
    c.height = R(n * d);
    const x = c.getContext("2d");
    x.scale(d, d);
    x.fillStyle = day ? "#3e3288" : "#06040e";
    x.fillRect(1, 0, S, n);
    x.fillRect(0, 1, n, S);
    x.save();
    x.beginPath();
    x.rect(2, 1, S - 2, S);
    x.rect(1, 2, S, S - 2);
    x.clip();
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    K.tile(x, o.a24, 24, id, 1, 1, S);
    if (!day) {
      x.fillStyle = "rgba(14,10,34,0.3)";
      x.fillRect(1, 1, S, S);
      x.fillStyle = "rgba(255,200,120,0.18)";
      x.fillRect(1 + S / 2, 1, S / 2, S);
    }
    x.restore();
    sprites.set(key, c);
    return c;
  }

  // ---------- input ----------
  /** a walker exactly under the point, out on the side ground (not over the ring) */
  function hit(x, y) {
    if (!g) return null;
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i];
      if (w.al < 0.5) continue;
      const S = w.S || 14;
      if (x < w.x - S / 2 - 3 || x > w.x + S / 2 + 3 || y < w.y - S - 6 || y > w.y + 3) continue;
      const ex = (w.x - g.cx) / g.rxR, ey = (w.y - g.cy) / g.ryR;
      if (wide && ex * ex + ey * ey < 1.04) continue;
      return w;
    }
    return null;
  }
  const busy = () => !RM && (walkers.length > 0 || queue.length > 0 || bursts.length > 0 || true);
  return {
    tick, sky, ground, people, hit, busy, verbOf,
    debug: () => ({ walkers: walkers.map((w) => ({ id: w.id, a: w.a, x: w.x, y: w.y, al: +w.al.toFixed(2), side: w.side })), queue: queue.length, price, text: priceText(), blimp: blimpBox, goal: today, wide, fw: bursts.length }),
  };
}
