// Today: the day's three bounties (the server's list, the same one the Candles hub pays out) and the shared
// Chogtown goal. Progress and payouts come from the worker (window.chogEcon / "chogpet:wallet" from shop.js);
// this panel only shows them and points the way: "Go" opens a fitting Chog with "chogpet:open" and a button hint.
// Candles are a game currency only: they have no value outside Chog Pet.
import { S as SPR, PAL } from "./sprites.js";
import { sfx } from "./sfx.js";
import { lonely, bedtime } from "./sim.js";
import { personaOf } from "./persona.js";
import { BOUNTIES, BOUNTY_ALL, XP } from "./econ.js";

const SUPPLY = 1969;
const root = document.getElementById("quests");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

// where each bounty's Go leads, and which device button it is about (0 feed · 1 play · 2 bath · 3 lights · 4 pet)
const GO = {
  care: { go: "needy", hint: 0 },
  help: { go: "needy", hint: 0 },
  catch: { go: "play", hint: 1 },
};

// ---------- clock ----------
let skew = 0; // server clock minus ours, from /api/today
const nowMs = () => Date.now() + skew;
const get = (k, dflt) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : dflt;
  } catch {
    return dflt;
  }
};
const put = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- town data (for "Go") ----------
let town = null, townAt = 0, townP = null;
function loadTown(force) {
  if (townP) return townP;
  if (town && !force && Date.now() - townAt < 60000) return Promise.resolve(town);
  townP = fetch("/api/town")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && typeof d.cells === "string") (town = d), (townAt = Date.now());
      return town;
    })
    .catch(() => town)
    .finally(() => (townP = null));
  return townP;
}

let traits = null, nums = null;
async function loadTraits() {
  if (traits) return traits;
  try {
    const r = await fetch("/data/chogs.json");
    if (r.ok) {
      const d = await r.json();
      (traits = d.t), (nums = d.n);
    }
  } catch {}
  return traits;
}
// the Chog on screen when this script loaded after main.js had already opened it (?chog= is the name number)
async function shownId() {
  if (curId) return curId;
  const q = new URLSearchParams(location.search);
  const tok = Number(q.get("token"));
  if (tok >= 1 && tok <= SUPPLY) return tok;
  const n = Number(q.get("chog"));
  if (!n) return 0;
  await loadTraits();
  return nums ? nums.indexOf(n) + 1 : 0;
}

let curId = 0;
const touched = new Set(); // Chogs this visitor opened today: Go sends them somewhere else ("help 3 different")
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function pick(kind) {
  const t = await loadTown();
  const cur = await shownId();
  const cells = t ? t.cells : "";
  const ids = (chars) => {
    const out = [];
    for (let i = 0; i < cells.length; i++) if (chars.includes(cells[i]) && !touched.has(i + 1) && i + 1 !== cur) out.push(i + 1);
    return out;
  };
  const first = (...groups) => {
    for (const g of groups) if (g.length) return rnd(g);
    return 0;
  };
  let id = 0;
  if (kind === "needy") id = first(ids("sx"), ids("n"), ids("w0"));
  else if (kind === "play") {
    // Candle Catch needs a Chog that's awake and has the energy: one nobody met lately, not in bed right now
    const tr = await loadTraits();
    const now = Math.floor(nowMs() / 1000);
    const pool = ids("hf").concat(ids("w0"));
    for (let i = 0; i < 80 && pool.length && !id; i++) {
      const c = rnd(pool);
      if (tr && bedtime(personaOf(c, tr[c - 1]), now)) continue;
      if (cells[c - 1] === "0" && lonely(c, now).energy < 40) continue;
      id = c;
    }
    if (!id) id = first(pool);
  } else id = first(ids("0sn"), ids("fh"));
  return id || 1 + Math.floor(Math.random() * SUPPLY);
}

// ---------- the wallet's bounties (from the worker) ----------
let W = null; // the Candles wallet as shop.js has it: W.day.bounties = [{ k, t, n, pay, at, done }], W.day.all
const doneKeys = (w) => new Set(((w && w.day && w.day.bounties) || []).filter((b) => b.done).map((b) => b.k));
function setW(w) {
  if (!w || !w.day || !Array.isArray(w.day.bounties)) return;
  const was = W ? doneKeys(W) : null;
  const wasAll = !!(W && W.day && W.day.all);
  const sameDay = W && W.ends === w.ends;
  W = w;
  const now = doneKeys(W);
  // celebrate only what just got done in front of us (not what was done before the page loaded)
  const fresh = was && sameDay ? [...now].filter((k) => !was.has(k)) : [];
  paint(fresh);
  if (fresh.length) celebrate(fresh, !wasAll && !!W.day.all);
}
addEventListener("chogpet:wallet", (e) => setW(e.detail && e.detail.wallet));

addEventListener("chogpet:pet", (e) => {
  const d = e.detail || {};
  curId = Number(d.id) || 0;
  if (curId) touched.add(curId);
});
addEventListener("chogpet:act", (e) => {
  const d = e.detail || {};
  if (d.a && d.a !== "love") bumps.push(Math.floor(nowMs() / 1000));
  paintGoal();
});

// ---------- the shared goal ----------
let goal = null;
const bumps = []; // our own deeds since the server last counted
let goalTried = false; // until the first /api/today answer the town row keeps its place (invisible), so the panel doesn't grow
async function loadGoal() {
  try {
    const r = await fetch("/api/today");
    if (!r.ok) return;
    const g = await r.json();
    if (typeof g.deeds !== "number") return;
    if (typeof g.now === "number") skew = Math.abs(g.now * 1000 - Date.now()) > 120000 ? g.now * 1000 - Date.now() : 0;
    goal = g;
    while (bumps.length && bumps[0] <= g.now) bumps.shift();
    paintGoal();
  } catch {} finally {
    if (!goalTried) {
      goalTried = true;
      paintGoal();
    }
  }
}
const deedsNow = () => (goal ? goal.deeds + bumps.length : 0);

// ---------- view ----------
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};
// sprite -> canvas; the dark ink outline turns lavender so it reads on the dark panel
function icon(name, box = 24) {
  const rows = SPR[name] || SPR.flame;
  const w = rows[0].length, h = rows.length;
  const sc = Math.max(1, Math.floor(box / Math.max(w, h)));
  const c = document.createElement("canvas");
  c.width = w * sc;
  c.height = h * sc;
  const x = c.getContext("2d");
  rows.forEach((row, j) => {
    for (let i = 0; i < w; i++) {
      const k = row[i];
      if (k === ".") continue;
      x.fillStyle = name.startsWith("i_") ? "#efe8ff" : k === "k" ? "#ddd7fe" : PAL[k] || k;
      x.fillRect(i * sc, j * sc, sc, sc);
    }
  });
  c.setAttribute("aria-hidden", "true");
  return c;
}
// a 7x6 pixel tick, drawn one pixel at a time when a bounty is done
const TICK = [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0]];
const SVGNS = "http://www.w3.org/2000/svg";
function tick() {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "-1 -1 9 8");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("shape-rendering", "crispEdges");
  [...TICK].sort((a, b) => a[0] - b[0]).forEach(([x, y], i) => {
    const r = document.createElementNS(SVGNS, "rect");
    r.setAttribute("x", x);
    r.setAttribute("y", y);
    r.setAttribute("width", 1);
    r.setAttribute("height", 1);
    r.style.setProperty("--i", i);
    s.appendChild(r);
  });
  return s;
}
const payText = (pay, xp) => `+${pay} Candles · +${xp} XP`;

let ui = null;
function build() {
  root.innerHTML = "";
  root.classList.add("panel");
  const head = el("div", "q-head");
  const h = el("h2", "q-h", "Today");
  const strk = el("span", "q-streak");
  strk.append(icon("flame", 11), el("b"));
  strk.hidden = true;
  const left = el("span", "q-left");
  head.append(h, strk, left);

  const ol = el("ol", "q-list");
  const rows = {};
  for (const b of BOUNTIES) {
    const li = el("li", "q");
    li.dataset.q = b.k;
    const box = el("span", "q-box");
    box.appendChild(tick());
    const ic = el("span", "q-ic");
    ic.appendChild(icon(b.ic));
    // title on top; what it pays and how far along you are on one small line under it
    const t = el("span", "q-t");
    const sub = el("span", "q-sub");
    const n = el("span", "q-n");
    sub.append(el("small", "q-pay", payText(b.pay, XP.bounty)), n);
    t.append(el("span", "q-tt", b.t), sub);
    const go = el("button", "q-go", "Go");
    go.type = "button";
    go.setAttribute("aria-label", "Go: " + b.t);
    const g = GO[b.k] || { go: "any" };
    go.addEventListener("click", () => goTo(g.go, go, g.hint));
    li.append(box, ic, t, go);
    ol.appendChild(li);
    rows[b.k] = { li, n, go };
  }

  const done = el("div", "q-done");
  const dIc = el("span", "q-done-ic");
  for (let i = 0; i < BOUNTIES.length; i++) {
    const b = el("span", "q-box on");
    b.appendChild(tick());
    dIc.appendChild(b);
  }
  const dT = el("span", "q-done-t");
  dT.append(el("b", "", "Day complete"), el("i"));
  const dGo = el("button", "q-go", "One more");
  dGo.type = "button";
  dGo.setAttribute("aria-label", "Go: a Chog that needs help");
  dGo.addEventListener("click", () => goTo("needy", dGo, 0));
  done.append(dIc, dT, dGo);
  done.hidden = true;

  const tw = el("div", "q-town");
  const tTop = el("div", "q-town-top");
  const tL = el("span", "q-town-l", "Chogtown today");
  const tN = el("span", "q-town-n");
  tTop.append(tL, tN);
  const bar = el("div", "q-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Good deeds in Chogtown today");
  const fill = el("i");
  bar.appendChild(fill);
  tw.append(tTop, bar);

  root.append(head, ol, done, tw);
  ui = { strk, left, ol, rows, done, dT, tw, tL, tN, bar, fill };
  root.hidden = false;
}

function paint(fresh = []) {
  if (!ui) return;
  const d = W && W.day;
  const list = (d && d.bounties) || [];
  for (const b of BOUNTIES) {
    const { li, n, go } = ui.rows[b.k];
    const s = list.find((x) => x.k === b.k);
    const isDone = !!(s && s.done);
    li.classList.toggle("done", isDone);
    li.classList.toggle("just", fresh.includes(b.k));
    // progress from the server; until the wallet answers, the row just waits (no made-up numbers)
    n.textContent = s && !isDone && b.n > 1 ? `${Math.min(s.at, b.n)}/${b.n}` : "";
    go.hidden = isDone;
  }
  const all = !!(d && d.all);
  // the "Day complete" block takes the rows' place at their height (no jump under the panel)
  if (all && !ui.ol.hidden && ui.ol.offsetHeight) root.style.setProperty("--q-list-h", ui.ol.offsetHeight + "px");
  ui.ol.hidden = all;
  ui.done.hidden = !all;
  root.classList.toggle("all", all);
  ui.done.classList.toggle("just", all && fresh.length > 0);
  const st = (W && W.streak) || 0;
  ui.strk.hidden = st < 1;
  ui.strk.querySelector("b").textContent = String(st);
  ui.strk.setAttribute("aria-label", `Streak: ${st} day${st === 1 ? "" : "s"}`);
  ui.dT.querySelector("i").textContent = all ? `All three paid, +${BOUNTY_ALL} bonus. New ones in ${leftText()}` : "";
  ui.left.textContent = `${leftText()} left`;
}
function leftText() {
  const end = W && W.ends ? W.ends * 1000 : Date.parse(dayKey(nowMs())) + 86400000;
  const h = Math.max(0, (end - nowMs()) / 3600000);
  return h >= 1 ? `${Math.floor(h)}h` : `${Math.max(1, Math.ceil(h * 60))}m`;
}

let shownGoal = false;
function paintGoal() {
  if (!ui) return;
  if (!goal) {
    ui.tw.hidden = goalTried;
    ui.tw.classList.toggle("q-wait", !goalTried);
    return;
  }
  ui.tw.hidden = false;
  if (ui.tw.classList.contains("q-wait")) {
    ui.tw.classList.remove("q-wait");
    ui.tw.classList.add("q-in");
  }
  const n = deedsNow();
  const reached = n >= goal.goal;
  ui.tw.classList.toggle("won", reached);
  ui.tL.textContent = reached ? "Festival day!" : "Chogtown today";
  ui.tN.innerHTML = "";
  const b = el("b", "", n.toLocaleString("en-US"));
  ui.tN.append(b, document.createTextNode(` / ${goal.goal.toLocaleString("en-US")} good deeds`));
  const pct = Math.min(100, (n / goal.goal) * 100);
  ui.fill.style.width = `${pct}%`;
  ui.bar.setAttribute("aria-valuemin", "0");
  ui.bar.setAttribute("aria-valuemax", String(goal.goal));
  ui.bar.setAttribute("aria-valuenow", String(n));
  ui.tw.title = reached ? "The town hit its goal: every Chog cared for today gets the Festival day sticker" : "";
  const day = goal.day || dayKey(nowMs());
  if (reached && get("pet.q.fw", "") !== day) {
    put("pet.q.fw", day);
    setTimeout(fireworks, shownGoal ? 200 : 700);
  }
  shownGoal = true;
}

async function goTo(kind, btn, hint) {
  sfx.click();
  btn.disabled = true;
  try {
    const id = await pick(kind);
    touched.add(id);
    window.dispatchEvent(new CustomEvent("chogpet:open", { detail: { id, hint } }));
  } finally {
    setTimeout(() => (btn.disabled = false), 400);
  }
}

// ---------- pixel confetti / fireworks ----------
const COLORS = ["#6e54ff", "#ddd7fe", "#85e6ff", "#ff8ee4", "#ffae45", "#ffd84d"];
let fx = null, parts = [], raf = 0;
function fxCanvas() {
  if (!fx) {
    fx = document.createElement("canvas");
    fx.className = "q-fx";
    fx.setAttribute("aria-hidden", "true");
    document.body.appendChild(fx);
  }
  if (fx.width !== innerWidth || fx.height !== innerHeight) (fx.width = innerWidth), (fx.height = innerHeight);
  return fx;
}
function burst(x, y, n, speed, up, big) {
  if (calm.matches) return;
  fxCanvas();
  const shell = [rnd(COLORS.slice(1)), rnd(COLORS.slice(1))];
  for (let i = 0; i < n; i++) {
    // confetti fans upward; a firework is a ring (two shells, one colour each)
    const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : (i / n) * Math.PI * 4 + Math.random() * 0.08;
    const v = up ? speed * (0.45 + Math.random() * 0.75) : speed * (i % 2 ? 0.55 : 1) * (0.92 + Math.random() * 0.12);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: up ? rnd(COLORS) : shell[i % 2], life: up ? 50 + Math.random() * 40 : 64 + Math.random() * 10, s: big ? (Math.random() < 0.4 ? 8 : 6) : Math.random() < 0.3 ? 6 : 4, g: big ? 0.05 : 0.12, f: big ? 0.95 : 0.985 });
  }
  if (!raf) raf = requestAnimationFrame(frame);
}
function frame() {
  const c = fx.getContext("2d");
  c.clearRect(0, 0, fx.width, fx.height);
  parts = parts.filter((p) => p.life > 0 && p.y < fx.height + 10);
  for (const p of parts) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.g;
    p.vx *= p.f;
    p.vy *= p.f;
    p.life--;
    if (p.life < 14 && p.life % 4 < 2) continue; // twinkle out
    c.fillStyle = p.c;
    c.fillRect(Math.round(p.x / 2) * 2, Math.round(p.y / 2) * 2, p.s, p.s);
  }
  if (parts.length) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    c.clearRect(0, 0, fx.width, fx.height);
  }
}
function centre(node) {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}
function celebrate(fresh, whole) {
  if (!ui) return;
  if (whole) {
    sfx.record();
    const [x, y] = centre(ui.done.querySelector(".q-done-ic") || root);
    burst(x, y, 60, 7, true);
    setTimeout(() => burst(x + 60, y, 30, 6, true), 180);
    return;
  }
  sfx.coin();
  for (const k of fresh) {
    const r = ui.rows[k];
    if (!r) continue;
    const [x, y] = centre(r.li.querySelector(".q-box"));
    burst(x, y, 22, 5, true);
  }
}
function fireworks() {
  if (!ui) return;
  sfx.record();
  ui.tw.classList.remove("boom");
  void ui.tw.offsetWidth;
  ui.tw.classList.add("boom");
  if (calm.matches) return;
  const w = innerWidth, h = innerHeight;
  for (let i = 0; i < 6; i++) {
    setTimeout(() => burst(w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.3), 56, 6.5, false, true), i * 320);
  }
}

// ---------- start ----------
if (root) {
  build();
  paint();
  paintGoal();
  // shop.js may have loaded the wallet before this script listened
  if (window.chogEcon && window.chogEcon.wallet) setW(window.chogEcon.wallet());
  loadTown();
  loadGoal();
  // a quiet refresh while the tab is open; the endpoint is edge-cached, so this is cheap
  let lastDay = dayKey(nowMs());
  setInterval(() => {
    if (document.hidden) return;
    const d = dayKey(nowMs());
    if (d !== lastDay) {
      // a new UTC day: new bounties (the wallet refetch brings them) and a fresh goal
      lastDay = d;
      touched.clear();
      if (window.chogEcon) window.chogEcon.refresh();
    }
    paint();
    loadGoal();
  }, 60000);
  document.addEventListener("visibilitychange", () => !document.hidden && loadGoal());
  // a test hook, like ?debug=1 elsewhere
  if (window.__pet || /[?&]debug=1/.test(location.search)) window.__quests = { wallet: () => W, fireworks, pick };
}
