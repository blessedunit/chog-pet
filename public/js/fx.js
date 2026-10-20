// Interactive polish for the page (css/fx.css):
//  1. entrance: after the intro overlay is gone, what is on screen fades in where it stands (opacity only,
//     lightly staggered), once per load;
//  2. the same soft fade for everything below the fold as it scrolls in; numbers are never animated; a pixel
//     candle along the top edge shows the scroll depth;
//  3. LCD: when another Chog is opened the old picture softly fades into the new one;
//  4. microinteractions: sparkle burst on a confirmed action, panels lean a hair toward the cursor;
//  5. a pixel cursor on desktop (CURSOR = false switches it off).
// Only transforms/opacity move; nothing runs while idle; prefers-reduced-motion = no motion at all.

const CURSOR = true; // pixel arrow cursor on desktop
const TILT = true; // panels lean toward the cursor (desktop)

const root = document.documentElement;
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const raf = (f) => requestAnimationFrame(f);

if (!window.__chogFx) {
  window.__chogFx = true;
  if (CURSOR && FINE) cursor();
  // (no scroll progress bar on purpose)
  if (RM) {
    root.classList.add("fx-off", "fx-ready");
  } else {
    if (root.classList.contains("intro-boot") || $(".intro")) root.classList.add("fx-intro");
    introGone().then(firstPet).then(entrance);
    channelChange();
    sparkles();
    if (TILT && FINE) tilt();
  }
}

// ---------- wait for the intro overlay ----------
function introGone() {
  const gone = () => !root.classList.contains("intro-boot") && !$(".intro");
  if (gone()) return Promise.resolve();
  return new Promise((resolve) => {
    const t0 = performance.now();
    const mo = new MutationObserver(check);
    function check() {
      // the head snippet promised an intro that never showed up: don't hold the page for it
      const stuck = root.classList.contains("intro-boot") && !$(".intro") && performance.now() - t0 > 6000;
      if (gone() || stuck) { mo.disconnect(); clearInterval(iv); resolve(); }
    }
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    mo.observe(document.body, { childList: true });
    const iv = setInterval(check, 1000);
  });
}

// the first Chog's card (name, persona, quirks) is painted from local data a moment after load: fade the page in
// once it's there, so nothing changes shape after it became visible (never wait more than 1.2 s)
function firstPet() {
  if ($("#strip") && $("#strip").textContent.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 1200);
    addEventListener("chogpet:pet", () => { clearTimeout(t); requestAnimationFrame(() => resolve()); }, { once: true });
  });
}

// ---------- reveal helpers ----------
function reveal(el, kind, delay = 0) {
  el.classList.remove("fx-wait");
  el.style.setProperty("--fx-d", Math.round(delay) + "ms");
  el.classList.add("fx-in", kind);
  let t = 0;
  const done = () => {
    clearTimeout(t);
    el.removeEventListener("animationend", on);
    el.classList.remove("fx-in", kind);
    el.style.removeProperty("--fx-d");
  };
  const on = (e) => { if (e.target === el && e.animationName.startsWith("fx-")) done(); };
  el.addEventListener("animationend", on);
  t = setTimeout(done, delay + 2500); // in case animationend never comes
}

// ---------- 1 + 2. entrance and scroll reveals ----------
const LISTS = ["#tiles", "#lifers", "#moves", "#records"];
let io = null, ioBase = 0, started = 0, late = false;
const NOWAIT = (() => { try { return !!navigator.webdriver; } catch { return false; } })();

function entrance() {
  started = performance.now();
  const vh = innerHeight;
  const inView = (el) => {
    if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return null; // hidden
    const r = el.getBoundingClientRect();
    return r.top < vh - 8 && r.bottom > 0;
  };
  // calm entrance: everything on screen fades in where it already stands (opacity only, nothing flies, drops
  // or assembles), lightly staggered header -> left -> centre -> right; below the fold the same fade on scroll
  const head = $$(".top > *, .strip").map((el) => [el, inView(el)]);
  const wrap = $(".device-wrap");
  const devIn = wrap ? inView(wrap) : false;
  const left = $$(".col-l > .panel").map((el) => [el, inView(el)]);
  const right = $$(".col-r > .panel, .col-r > .cx-panel").map((el) => [el, inView(el)]);
  const quests = $$("#quests").map((el) => [el, inView(el)]);
  const later = $$(".coll-head, .coll-cols > .panel, .foot-brand, .foot-col, .fine");

  io = new IntersectionObserver(onSee, { rootMargin: "0px 0px -6% 0px" });
  // nothing may stay hidden: headless/full-page captures (webdriver) never hide anything, and after 1.5 s
  // whatever still waits below the fold is simply shown (a preview or a full-page shot never sees black bands)
  const wait = (el) => {
    if (NOWAIT || late) return;
    el.classList.add("fx-wait");
    io.observe(el);
  };
  setTimeout(() => {
    late = true;
    for (const el of $$(".fx-wait")) io.unobserve(el), reveal(el, "fx-fade", 0);
  }, 1500);
  const intro = root.classList.contains("fx-intro");

  head.forEach(([el, v]) => (v ? reveal(el, "fx-fade", 0) : v === false && wait(el)));
  // after the intro the egg is already sitting there (the intro zoomed into it): leave it alone
  if (wrap) { if (devIn) { if (!intro) reveal(wrap, "fx-fade", 40); } else wait(wrap); }
  left.forEach(([el, v], i) => (v ? reveal(el, "fx-fade", 60 + i * 40) : v === false && wait(el)));
  right.forEach(([el, v], i) => (v ? reveal(el, "fx-fade", 100 + i * 40) : v === false && wait(el)));
  quests.forEach(([el, v]) => (v ? reveal(el, "fx-fade", 140) : v === false && wait(el)));
  later.forEach(wait);

  // rows and tiles come in later from the API: watch the lists until their first rows are revealed
  for (const sel of LISTS) {
    const box = $(sel);
    if (!box) continue;
    const take = () => {
      if (box.dataset.fxDone) return;
      for (const c of box.children) if (c.matches(".row, .tile") && !c.dataset.fxSeen) { c.dataset.fxSeen = "1"; wait(c); }
    };
    take();
    new MutationObserver(take).observe(box, { childList: true });
  }
  ioBase = 160; // things already on screen join the entrance just after the stage
  setTimeout(() => (ioBase = 0), 600);
  root.classList.add("fx-ready");
}

function onSee(entries) {
  const vis = entries.filter((e) => e.isIntersecting).map((e) => e.target);
  if (!vis.length) return;
  vis.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const base = ioBase ? Math.max(0, ioBase - (performance.now() - started)) : 0;
  vis.forEach((el, i) => {
    io.unobserve(el);
    const box = el.parentElement;
    if (box && LISTS.some((s) => box.matches(s))) box.dataset.fxDone = "1";
    reveal(el, "fx-fade", base + Math.min(i, 8) * 35);
  });
}

// ---------- 2b. scroll depth: a pixel candle along the top ----------
function progress() {
  const bar = document.createElement("div");
  bar.className = "fx-prog";
  bar.setAttribute("aria-hidden", "true");
  bar.innerHTML = "<i></i>";
  document.body.appendChild(bar);
  let pending = false, idle = 0, lastX = null, max = 0, y = 0, w = 0;
  // read the geometry in the scroll/resize event (layout is clean there); the rAF only writes
  const measure = () => { max = document.documentElement.scrollHeight - innerHeight; y = scrollY; w = innerWidth; };
  const paint = () => {
    pending = false;
    const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    // whole 8px segments, so the pattern never slides; at the very top nothing shows
    const x = p > 0.002 ? Math.max(8, Math.round((p * w) / 8) * 8) : 0;
    if (x !== lastX) { lastX = x; bar.style.setProperty("--p", x + "px"); }
  };
  addEventListener("scroll", () => {
    measure();
    if (!pending) { pending = true; raf(paint); }
    if (!RM) {
      bar.classList.add("fx-prog-go"); // not "go": that's the page's button class (position: relative) and made the bar jump into the flow
      clearTimeout(idle);
      idle = setTimeout(() => bar.classList.remove("fx-prog-go"), 260);
    }
  }, { passive: true });
  addEventListener("resize", () => { lastX = null; measure(); if (!pending) { pending = true; raf(paint); } }, { passive: true });
  measure();
  paint();
}

// ---------- 3. the LCD: channel change ----------
function channelChange() {
  let last = 0, armed = false;
  // the first pet of the page load is the entrance's job
  addEventListener("chogpet:pet", (e) => {
    const d = (e && e.detail) || {};
    const id = Number(d.id) || 0;
    if (!last && id) { last = id; channel(id, ""); return; } // first pet: the loading screen melts into it
    if (!armed || id === last) { last = id || last; return; }
    last = id;
    channel(id, String(d.name || id));
  });
  introGone().then(() => setTimeout(() => (armed = true), 400));
}

// switching Chogs: the old picture is frozen on top of the LCD (so the "loading" screen never flashes), and once
// the new one is ready it dissolves away in a soft 320 ms fade; the new number sits in the corner for a moment
let snap = null, snapFor = 0;
function channel(id, num) {
  const lcd = $("#lcd"), art = $("#art"), scr = $("#scr");
  if (!lcd || !scr) return;
  if (snap) snap.remove();
  const box = document.createElement("div");
  box.className = "fx-snap";
  box.setAttribute("aria-hidden", "true");
  for (const src of [art, scr]) {
    if (!src || !src.width) continue;
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    try { c.getContext("2d").drawImage(src, 0, 0); } catch {}
    c.className = src === art ? "fx-snap-art" : "fx-snap-scr";
    box.appendChild(c);
  }
  lcd.appendChild(box);
  snap = box; snapFor = id;
  // never hold the old picture longer than 2.5 s, even if the new art never comes
  setTimeout(() => snap === box && fadeSnap(), 2500);
  if (!num) return;
  const tag = document.createElement("b");
  tag.textContent = num;
  // the number lives on its own, so it can stay after the picture has gone
  const old = lcd.querySelector(".fx-chan");
  if (old) old.remove();
  tag.className = "fx-chan";
  lcd.appendChild(tag);
  setTimeout(() => tag.classList.add("out"), 1400);
  setTimeout(() => tag.remove(), 1900);
}
function fadeSnap() {
  const box = snap;
  if (!box) return;
  snap = null;
  box.classList.add("out");
  setTimeout(() => box.remove(), 360);
}
addEventListener("chogpet:petready", (e) => {
  const id = Number(e && e.detail && e.detail.id);
  if (snap && id === snapFor) setTimeout(() => snap && snapFor === id && fadeSnap(), 60); // one frame for the new art to paint
});

// ---------- 4. microinteractions ----------
let lastDown = { x: 0, y: 0, t: -1e9 };
function sparkles() {
  addEventListener("pointerdown", (e) => (lastDown = { x: e.clientX, y: e.clientY, t: performance.now() }), { passive: true, capture: true });
  addEventListener("chogpet:act", () => {
    let { x, y, t } = lastDown;
    if (performance.now() - t > 5000) {
      const l = $("#lcd");
      if (!l) return;
      const r = l.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height * 0.4;
    }
    burst(x, y);
  });
}
function burst(x, y) {
  const cv = document.createElement("canvas");
  cv.className = "fx-spark";
  cv.width = cv.height = 32; // 4 css px per pixel
  cv.style.left = Math.round(x - 64) + "px";
  cv.style.top = Math.round(y - 64) + "px";
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  const COL = ["#ffd84d", "#ff7bb5", "#ffffff", "#8b6cff", "#46e38f"];
  const parts = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
    const v = 0.022 + Math.random() * 0.02;
    return { a, v, big: i % 3 === 0, col: COL[i % COL.length] };
  });
  const t0 = performance.now(), DUR = 560;
  const step = (now) => {
    const ms = now - t0;
    if (ms >= DUR) return cv.remove();
    c.clearRect(0, 0, 32, 32);
    for (const p of parts) {
      const d = p.v * ms * (1 - ms / (DUR * 2.2));
      const px = Math.round(16 + Math.cos(p.a) * d), py = Math.round(16 + Math.sin(p.a) * d + (ms * ms) / 90000);
      if (Math.floor(ms / 60 + p.a * 3) % 4 === 3) continue; // twinkle
      c.fillStyle = p.col;
      c.fillRect(px, py, 1, 1);
      if (p.big && ms < DUR * 0.7) { c.fillRect(px - 1, py, 3, 1); c.fillRect(px, py - 1, 1, 3); }
    }
    raf(step);
  };
  raf(step);
}

// panels lean a hair (≤ 0.8°) toward the cursor; the map panel stays flat so dragging stays exact
function tilt() {
  const SEL = ".stage .panel:not(.town-p), .coll-cols > .panel, .tile";
  let cur = null, ev = null, queued = false;
  const flat = (el) => { el.style.transform = ""; setTimeout(() => !el.style.transform && el.classList.remove("fx-tilt"), 200); };
  const run = () => {
    queued = false;
    const t = ev && ev.target instanceof Element ? ev.target.closest(SEL) : null;
    const el = t && !t.matches(".fx-in, .fx-wait") ? t : null;
    if (cur && cur !== el) flat(cur);
    cur = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width - 0.5, ny = (ev.clientY - r.top) / r.height - 0.5;
    const k = Math.min(1, 360 / Math.max(r.width, r.height)); // big panels lean less
    el.classList.add("fx-tilt");
    el.style.transform = `perspective(1200px) rotateX(${(-ny * 1.6 * k).toFixed(2)}deg) rotateY(${(nx * 1.6 * k).toFixed(2)}deg)`;
  };
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    ev = e;
    if (!queued) { queued = true; raf(run); }
  }, { passive: true });
  document.addEventListener("pointerleave", () => { if (cur) flat(cur); cur = null; });
  addEventListener("blur", () => { if (cur) flat(cur); cur = null; });
}

// ---------- 5. pixel cursor ----------
function cursor() {
  // pixel maps; a violet drop shadow is added 1px down-right
  const svg = (rows, cols, scale) => {
    const h = rows.length, w = rows[0].length;
    const on = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== ".";
    let sh = "", r = "";
    rows.forEach((line, y) => [...line].forEach((ch, x) => {
      if (on(x, y)) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${cols[ch]}"/>`;
      if (on(x - 1, y - 1) && !on(x, y)) sh += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      if (x === w - 1 && on(x, y - 1)) sh += `<rect x="${w}" y="${y}" width="1" height="1"/>`;
      if (y === h - 1 && on(x - 1, y)) sh += `<rect x="${x}" y="${h}" width="1" height="1"/>`;
    }));
    const W = w + 1, H = h + 1;
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><g fill="rgba(139,108,255,0.6)">${sh}</g>${r}</svg>`)}")`;
  };
  const arrow = [
    "X.........",
    "XX........",
    "XWX.......",
    "XWWX......",
    "XWWWX.....",
    "XWWWWX....",
    "XWWWWWX...",
    "XWWWWWWX..",
    "XWWWWWWWX.",
    "XWWWWWXXXX",
    "XWWXWWX...",
    "XWX.XWWX..",
    "XX...XWWX.",
    "X....XWWX.",
    "......XX..",
  ];
  const arrowCols = { X: "#0e091c", W: "#f5f0ff" };
  root.style.setProperty("--fx-cur", `${svg(arrow, arrowCols, 2)} 1 1, auto`);
  // the classic pointing hand over anything clickable, in the same pixel style as the arrow
  const hand = [
    ".....XX.........",
    "....XWWX........",
    "....XWWX........",
    "....XWWX........",
    "....XWWXXX......",
    "....XWWXWWXXX...",
    "....XWWXWWXWWXX.",
    ".XX.XWWXWWXWWXWX",
    "XWWXXWWWWWWWWXWX",
    "XWWWXWWWWWWWWWWX",
    ".XWWWWWWWWWWWWWX",
    "..XWWWWWWWWWWWWX",
    "..XWWWWWWWWWWWX.",
    "...XWWWWWWWWWWX.",
    "....XWWWWWWWWX..",
    "....XXXXXXXXXX..",
  ];
  root.style.setProperty("--fx-cur-pt", `${svg(hand, arrowCols, 2)} 11 1, pointer`);
  root.classList.add("fx-cursor");
}
