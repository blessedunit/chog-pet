// Chog Pet: Candles + levels. The balance pill with the level badge in the header (#candleRoot) and the hub
// sheet (#shopRoot) with four tabs: Daily · Games · Shop · Level. Candles are a game currency only: earned by
// caring and playing, spent in the shop and the games, worth nothing outside. The worker decides everything.
//
// Listens to "chogpet:pet" {id,name} and "chogpet:act" {id,a,code,score,candles?} from main.js.
// Exposes window.chogEcon = { foods(), count(k), open(tab), refresh(), wallet(), styleFor(label), decorate(el, label) }.
// Fires "chogpet:wallet" {wallet} whenever the wallet changes (Today under the device draws the bounties from it).
import { ITEMS, styleOf, levelOf } from "./econ.js";
import { iconOf, setGifts, giftsOf, setCurrent } from "./gifts.js";
import { toCanvas } from "./sprites.js";
import { sfx } from "./sfx.js";
import { me } from "./api.js";
import { badge, renderDailyTab, renderGamesTab, renderLevelTab, levelUpToast, bondToast } from "./hub.js";

const pillRoot = document.getElementById("candleRoot");
const sheetRoot = document.getElementById("shopRoot");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- talking to the worker ----------
let W = null; // my wallet: { bal, inv, own, c, b, day, ... }
let pet = { id: 0, name: "" };
let petGifts = [];
let styles = {}; // label -> "c_pink|b_star" for names in the open Chog's visitors log
let mergeable = null;
let lastToken = me.token;
let bond = null, grow = null; // you and the Chog on screen, from the worker

function headers(body) {
  const h = {};
  if (me.token) h.authorization = "Bearer " + me.token;
  if (body) h["content-type"] = "application/json";
  return h;
}
async function get() {
  const q = `/api/econ?anon=${encodeURIComponent(me.anon)}${pet.id ? "&pet=" + pet.id : ""}`;
  const r = await fetch(q, { headers: headers(false) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw Object.assign(new Error((j && j.error) || "network"), { status: r.status });
  return j;
}
async function post(op, body = {}) {
  const r = await fetch(`/api/econ/${op}`, { method: "POST", headers: headers(true), body: JSON.stringify({ ...body, anon: me.anon }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.ok === false) {
    const msg = r.status === 429 ? "Slow down a little" : (j && j.error) || "Couldn't reach the shop";
    throw Object.assign(new Error(msg), { status: r.status, body: j });
  }
  if (j.me) setWallet(j.me);
  if (j.style != null) myStyle = j.style;
  return j;
}

let myStyle = "";
let loading = null;
async function refresh() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const j = await get();
      setWallet(j.me);
      myStyle = j.me.style || "";
      myLabel = j.me.label || myLabel;
      mergeable = j.mergeable || null;
      // an old Rush pass (gone from the game) came back as Candles
      if (j.refund && j.refund.candles > 0) showGain({ gain: j.refund.candles, why: [[`Rush pass${j.refund.rush > 1 ? "es" : ""} refunded`, j.refund.candles]] });
      if (pet.id && j.gifts) (petGifts = j.gifts), setGifts(pet.id, j.gifts);
      if (j.styles) styles = j.styles;
      if (j.bond && j.bond.pet === pet.id) (bond = j.bond), (grow = j.grow), paintPetChip();
      decorateAll();
      if (open) paint();
    } catch {}
  })().finally(() => (loading = null));
  return loading;
}
let myLabel = "";

// ---------- sound (own tiny synth; respects the page's mute button) ----------
let ac = null;
function tone(f, dur, { type = "square", vol = 0.04, at = 0, to = null } = {}) {
  if (sfx.muted) return;
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    const t = ac.currentTime + at;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {}
}
const seq = (ns, step = 0.07, o = {}) => ns.forEach((f, i) => f && tone(f, step * 0.9, { ...o, at: i * step }));
export const snd = {
  tick: () => tone(1400, 0.025, { vol: 0.025 }),
  tab: () => tone(760, 0.035, { vol: 0.025 }),
  buy: () => seq([988, 1318, 1568], 0.06),
  coin: () => seq([1318, 1760], 0.05, { vol: 0.03 }),
  rattle: () => { for (let i = 0; i < 6; i++) tone(200 + Math.random() * 160, 0.03, { vol: 0.03, at: i * 0.07 }); },
  crack: () => (tone(700, 0.12, { type: "sawtooth", vol: 0.04, to: 160 }), tone(2200, 0.05, { vol: 0.02, at: 0.08 })),
  win: () => seq([523, 659, 784, 1047, 1318], 0.07),
  big: () => seq([523, 659, 784, 1047, 784, 1047, 1318, 1568], 0.075),
  lose: () => seq([392, 330, 262], 0.11, { type: "triangle", vol: 0.06 }),
  no: () => sfx.no(),
  rise: () => tone(300, 0.5, { type: "triangle", vol: 0.04, to: 900 }),
};

// ---------- effects ----------
let fxCan = null, bits = [], fxRun = false;
export function confetti(x, y, n = 60, cols) {
  if (calm.matches) return;
  if (!fxCan) {
    fxCan = document.createElement("canvas");
    fxCan.className = "cdl-fx";
    document.body.appendChild(fxCan);
  }
  const C = cols || ["#6e54ff", "#ddd7fe", "#85e6ff", "#ff8ee4", "#ffae45", "#ffd84d", "#46e38f"];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 5 + Math.random() * 9;
    bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: C[i % C.length], s: Math.random() < 0.3 ? 6 : 4, life: 60 + Math.random() * 40 });
  }
  if (!fxRun) (fxRun = true), requestAnimationFrame(fxStep);
}
function fxStep() {
  const dpr = 1;
  if (fxCan.width !== innerWidth || fxCan.height !== innerHeight) (fxCan.width = innerWidth * dpr), (fxCan.height = innerHeight * dpr);
  const g = fxCan.getContext("2d");
  g.clearRect(0, 0, fxCan.width, fxCan.height);
  bits = bits.filter((b) => b.life-- > 0);
  for (const b of bits) {
    b.vy += 0.42;
    b.vx *= 0.985;
    b.x += b.vx;
    b.y += b.vy;
    g.fillStyle = b.c;
    g.globalAlpha = Math.min(1, b.life / 20);
    g.fillRect(Math.round(b.x / 2) * 2, Math.round(b.y / 2) * 2, b.s, b.s);
  }
  g.globalAlpha = 1;
  if (bits.length) requestAnimationFrame(fxStep);
  else (fxRun = false), g.clearRect(0, 0, fxCan.width, fxCan.height);
}

/** Count a number up (or down) in an element. */
export function rollTo(el, from, to, ms = 650) {
  if (!el) return;
  if (calm.matches || from === to) return void (el.textContent = fmt(to));
  const t0 = performance.now();
  let lastTick = from;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = fmt(v);
    if (to > from && v - lastTick >= Math.max(1, Math.ceil((to - from) / 8))) (lastTick = v), snd.tick();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : String(n));

// ---------- the pill ----------
let shown = null; // balance on screen
const pill = document.createElement("button");
pill.className = "cdl-pill";
pill.setAttribute("aria-haspopup", "dialog");
pill.innerHTML = `<span class="cdl-ic"></span><span class="cdl-n">0</span><span class="cdl-lv"></span>`;
pill.querySelector(".cdl-ic").appendChild(toCanvas("gcandle", 2));
const pillLv = pill.querySelector(".cdl-lv");
function paintPill() {
  const lv = W && W.lv ? W.lv.lv : 1;
  if (pillLv.dataset.lv !== String(lv)) {
    pillLv.dataset.lv = String(lv);
    const b = badge(lv, "pill");
    b.querySelector("b").innerHTML = `<small>Lv</small>${lv}`;
    pillLv.replaceChildren(b);
  }
  pill.setAttribute("aria-label", `${W ? W.bal : 0} Candles, Sitter level ${lv}. Open Daily, Games, Shop and Level`);
}
pill.addEventListener("click", () => (open ? close() : openSheet()));
if (pillRoot) pillRoot.appendChild(pill);
const floats = document.createElement("div");
floats.className = "cdl-floats";
document.body.appendChild(floats);

function setWallet(w) {
  if (!w) return;
  const before = W ? W.bal : null;
  W = w;
  const n = pill.querySelector(".cdl-n");
  if (shown == null || before == null) (shown = w.bal), (n.textContent = fmt(w.bal));
  else if (w.bal !== shown) {
    rollTo(n, shown, w.bal);
    pill.classList.remove("pop", "down");
    void pill.offsetWidth;
    pill.classList.add(w.bal > shown ? "pop" : "down");
    clearTimeout(setWallet.t);
    setWallet.t = setTimeout(() => pill.classList.remove("pop", "down"), 1600);
    shown = w.bal;
  }
  const hb = sheetRoot && sheetRoot.querySelector(".shp-bal b");
  if (hb && hb.dataset.v !== String(w.bal)) {
    rollTo(hb, Number(hb.dataset.v || w.bal), w.bal);
    hb.dataset.v = String(w.bal);
  }
  paintPill();
  paintHeadLevel();
  dispatchEvent(new CustomEvent("chogpet:wallet", { detail: { wallet: W } }));
}

/** "+12 Candle Catch" chips that drop out of the pill. */
function showGain(c, tiny = false) {
  if (!c || !(c.gain > 0 || (c.xp && c.xp.gain > 0))) return;
  // gains float up over the pet's screen (where the action happened), not over the pet card; the pill if the screen is off-view
  const lcd = document.getElementById("lcd");
  const lr = lcd && lcd.getBoundingClientRect();
  const onScreen = lr && lr.bottom > 40 && lr.top < innerHeight - 40;
  const r = onScreen ? lr : pill.getBoundingClientRect();
  floats.style.left = Math.round(r.left + r.width / 2) + "px";
  floats.style.top = Math.round(onScreen ? r.top + r.height * (tiny ? 0.84 : 0.18) : r.bottom + 8) + "px"; // tiny: low on the screen, clear of the speech line
  let list = (c.why && c.why.length ? c.why : c.gain > 0 ? [["", c.gain]] : []).slice(0, 4);
  if (c.xp && c.xp.gain > 0) list.push(["XP", c.xp.gain, "xp"]);
  if (tiny) {
    // one quiet line for a care action: "+2 candles · +12 xp"
    const parts = [];
    if (c.gain > 0) parts.push(`+${c.gain} candle${c.gain === 1 ? "" : "s"}`);
    if (c.xp && c.xp.gain > 0) parts.push(`+${c.xp.gain} xp`);
    if (c.xp && c.xp.home && c.xp.gain > 0) parts.push("home ×1.5"); // the holder caring for its own Chog
    list = [[parts.join(" · "), 0, "tiny"]];
  }
  // a second batch that lands while the first is still floating goes below it, never on top of it
  const busy = new Set([...floats.children].map((x) => Number(x.style.getPropertyValue("--row")) || 0));
  let row = 0;
  list.forEach(([why, n, kind], i) => {
    while (busy.has(row)) row++;
    busy.add(row);
    const d = document.createElement("div");
    d.className = "cdl-float" + (kind ? " " + kind : "");
    d.style.animationDelay = i * 0.22 + "s";
    d.style.setProperty("--row", row);
    d.innerHTML = kind === "tiny" ? `<span>${esc(why)}</span>` : `<b>+${n}</b>${why ? `<span>${esc(why)}</span>` : ""}`;
    floats.appendChild(d);
    setTimeout(() => d.remove(), 2600 + i * 220);
  });
  if (c.gain >= 10 && !tiny) confetti(r.left + r.width / 2, r.bottom, Math.min(40, c.gain * 2));
  if (c.gain > 0) snd.coin();
}
/** XP from an action: level, bond, growth, toasts. */
function takeXp(x) {
  if (!x || !W) return;
  W = { ...W, lv: { ...W.lv, ...x, unlocked: undefined } };
  if (x.bond && x.bond.pet === pet.id) (bond = x.bond), (grow = x.grow), paintPetChip(true);
  paintPill();
  paintHeadLevel();
  if (x.up || (x.bond && x.bond.up)) window.__chogBeat = Date.now();
  if (x.up) {
    setTimeout(() => {
      levelUpToast(x, () => openSheet("level"));
      snd.big();
      const r = pill.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.bottom, 90, ["#ffd84d", "#ffae45", "#fff8ee", "#85e6ff", "#ff8ee4"]);
      pill.classList.remove("lvup");
      void pill.offsetWidth;
      pill.classList.add("lvup");
    }, 900);
  } else if (x.bond && x.bond.up) setTimeout(() => bondToast(x.bond, petLabel(), () => openSheet("level")), 900);
  if (open) paint();
}

// ---------- page events ----------
addEventListener("chogpet:pet", (e) => {
  const d = e.detail || {};
  if (!d.id || d.id === pet.id) return;
  pet = { id: d.id, name: d.name || "" };
  petGifts = giftsOf(d.id).map((item) => ({ item }));
  bond = grow = null;
  paintPetChip();
  refresh();
});
addEventListener("chogpet:act", (e) => {
  const d = e.detail || {};
  if (d.candles) {
    // one reaction per action: the Chog's line + at most one toast (level-up, else bond-up); otherwise one tiny
    // "+2 candles · +12 xp" float. The pill ticks quietly either way
    const x = d.candles.xp;
    const big = !!(x && (x.up || (x.bond && x.bond.up && x.bond.pet === pet.id)));
    setWallet({ ...W, bal: d.candles.bal });
    if (!big) showGain(d.candles, true);
    takeXp(x);
    // counters (caps, bounties) changed too: fetch quietly, the balance is already right
    setTimeout(refresh, 400);
  } else if (d.a !== "love") {
    // main.js didn't pass the worker's answer on: find out from the balance
    const was = W ? W.bal : null;
    refresh().then(() => {
      if (was != null && W && W.bal > was) showGain({ gain: W.bal - was, why: [] }, true);
    });
  }
});
// sign-in / sign-out happens in main.js: notice it and switch wallets
setInterval(() => {
  if (me.token !== lastToken) {
    lastToken = me.token;
    shown = null;
    refresh();
  }
}, 1500);
addEventListener("focus", () => refresh());

// ---------- names in visitor logs: colour + badge ----------
export function styleFor(label) {
  if (!label) return { c: "", b: "" };
  if (label === "You" || label === myLabel) return styleOf(myStyle);
  return styleOf(styles[label]);
}
export function decorate(el, label) {
  const st = styleFor(label);
  const key = `${st.c}|${st.b}`;
  if (el.dataset.cdl === key) return;
  el.dataset.cdl = key;
  el.style.color = st.c || "";
  const old = el.querySelector(".cdl-badge");
  if (old) old.remove();
  if (st.b) {
    const c = iconOf(st.b, 2);
    c.className = "cdl-badge";
    el.prepend(c);
  }
}
function decorateAll() {
  for (const el of document.querySelectorAll("#log .who, #pcRecent .who, [data-sitter]")) {
    const label = el.dataset.sitter || el.textContent.replace(/ · home$/, "").trim();
    decorate(el, label);
  }
}
// main.js rewrites both visitor lists on every refresh: colour the names again each time
const nameObs = new MutationObserver(() => decorateAll());
for (const id of ["log", "pcRecent"]) {
  const el = document.getElementById(id);
  if (el) nameObs.observe(el, { childList: true });
}

// ---------- the hub sheet ----------
const TABS = [
  { k: "daily", t: "Daily", ic: "e_b_star" },
  { k: "games", t: "Games", ic: "e_capsule" },
  { k: "shop", t: "Shop", ic: "candlecake" },
  { k: "level", t: "Level", ic: "heart" },
];
const OLD_TAB = { caps: ["games", "caps"], pump: ["games", "pump"], wheel: ["daily", ""], bag: ["shop", "bag"] };
let open = false;
let tab = "daily";
let game = ""; // the open game in the Games tab ("" = the list)
let cat = "snacks"; // the Shop tab's shelf
const store = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
try {
  tab = localStorage.getItem("pet.hubTab") || "daily";
  if (!TABS.some((t) => t.k === tab)) tab = "daily";
  cat = localStorage.getItem("pet.shopCat") || "snacks";
} catch {}
let lastFocus = null;

function build() {
  sheetRoot.innerHTML = `
    <div class="shp" role="dialog" aria-modal="true" aria-labelledby="shpTitle" hidden>
      <div class="shp-back"></div>
      <div class="shp-box">
        <h2 id="shpTitle" class="sr">Candles</h2>
        <header class="shp-head">
          <div class="shp-bal"><span class="shp-bic"></span><b data-v="0">0</b><small>Candles</small></div>
          <button class="shp-lvl" aria-label="Your level"><span class="bd"></span><span class="tx"><span class="nm"></span><span class="hub-bar"><i></i></span><span class="xp"></span></span></button>
          <button class="shp-x" aria-label="Close">✕</button>
        </header>
        <nav class="shp-tabs" role="tablist" aria-label="Candles"></nav>
        <div class="shp-body" role="tabpanel" tabindex="-1"></div>
        <footer class="shp-foot">Candles are for this game only. They can't be bought, sold or sent, and have no value.</footer>
      </div>
    </div>`;
  sheetRoot.querySelector(".shp-bic").appendChild(toCanvas("gcandle", 3));
  const nav = sheetRoot.querySelector(".shp-tabs");
  for (const t of TABS) {
    const b = document.createElement("button");
    b.className = "shp-tab";
    b.id = "shpTab-" + t.k;
    b.setAttribute("role", "tab");
    b.dataset.k = t.k;
    b.appendChild(t.ic === "heart" ? toCanvas("heart", 2) : iconOf(t.ic, 2));
    b.insertAdjacentHTML("beforeend", `<span class="l">${t.t}</span><span class="dot" hidden></span>`);
    b.addEventListener("click", () => setTab(t.k));
    nav.appendChild(b);
  }
  // arrows move between tabs (the usual tablist keys)
  nav.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = TABS.findIndex((t) => t.k === tab);
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(n.k);
    sheetRoot.querySelector("#shpTab-" + n.k).focus();
  });
  sheetRoot.querySelector(".shp-x").addEventListener("click", close);
  sheetRoot.querySelector(".shp-back").addEventListener("click", close);
  sheetRoot.querySelector(".shp-lvl").addEventListener("click", () => setTab("level"));
}

/** The level strip in the hub's header. */
function paintHeadLevel() {
  const box = sheetRoot && sheetRoot.querySelector(".shp-lvl");
  if (!box || !W || !W.lv) return;
  const L = W.lv;
  const bd = box.querySelector(".bd");
  if (bd.dataset.lv !== String(L.lv)) (bd.dataset.lv = String(L.lv)), bd.replaceChildren(badge(L.lv));
  box.querySelector(".nm").textContent = `Sitter Lv ${L.lv}`;
  box.querySelector(".hub-bar i").style.width = (L.max ? 100 : Math.round((100 * L.cur) / Math.max(1, L.need))) + "%";
  box.querySelector(".xp").textContent = L.max ? "Max level" : `${L.cur}/${L.need} XP`;
  box.setAttribute("aria-label", `Sitter level ${L.lv}, ${L.cur} of ${L.need} XP. Open Level`);
}

function openSheet(t) {
  if (!sheetRoot) return;
  if (!sheetRoot.querySelector(".shp")) build();
  if (t && OLD_TAB[t]) {
    const [k, sub] = OLD_TAB[t];
    t = k;
    if (k === "games") game = sub;
    if (k === "shop" && sub) cat = sub;
  }
  if (t && TABS.some((x) => x.k === t)) tab = t;
  const wasOpen = open;
  open = true;
  if (!wasOpen) lastFocus = document.activeElement;
  const el = sheetRoot.querySelector(".shp");
  el.hidden = false;
  document.documentElement.classList.add("shp-open");
  requestAnimationFrame(() => el.classList.add("in"));
  const hb = sheetRoot.querySelector(".shp-bal b");
  hb.dataset.v = String(W ? W.bal : 0);
  hb.textContent = fmt(W ? W.bal : 0);
  paintHeadLevel();
  const body = sheetRoot.querySelector(".shp-body");
  body.dataset.tab = ""; // a fresh open always redraws
  paint();
  if (!wasOpen) sfx.click();
  refresh();
  if (!wasOpen) setTimeout(() => sheetRoot.querySelector("#shpTab-" + tab).focus({ preventScroll: true }), 30);
}
function close() {
  if (!open) return;
  open = false;
  const el = sheetRoot.querySelector(".shp");
  el.classList.remove("in");
  document.documentElement.classList.remove("shp-open");
  if (cleanup) cleanup(), (cleanup = null);
  hush();
  setTimeout(() => !open && (el.hidden = true), 180);
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
// while the sheet is open the page's keys (1-6, arrows, Enter, Esc) must not drive the pet behind it.
// Stopping propagation keeps default actions (Tab, Enter/Space on a button) working inside the sheet.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
function focusables() {
  const box = sheetRoot.querySelector(".shp-box");
  return box ? [...box.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.getClientRects().length) : [];
}
addEventListener("keydown", (e) => {
  if (!open) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") return e.preventDefault(), close();
  if (e.key === "Tab") {
    // aria-modal: Tab and Shift+Tab cycle inside the sheet
    const f = focusables();
    if (!f.length) return e.preventDefault();
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) e.preventDefault(), f[f.length - 1].focus();
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) e.preventDefault(), f[0].focus();
  }
}, true);
// focus that lands behind the sheet some other way (a click on the backdrop, a script) comes back in
addEventListener("focusin", (e) => {
  if (!open || !sheetRoot || sheetRoot.contains(e.target)) return;
  const x = sheetRoot.querySelector(".shp-x");
  if (x) x.focus({ preventScroll: true });
});

function setTab(k) {
  if (k === tab) {
    // tapping Games again goes back to the list
    if (k === "games" && game) (game = ""), paint();
    return;
  }
  tab = k;
  store("pet.hubTab", k);
  snd.tab();
  hush();
  paint();
}
/** Hide the sheet's message line at once (a new tab starts clean). */
function hush() {
  clearTimeout(say.t);
  const el = sheetRoot && sheetRoot.querySelector(".shp-msg");
  if (el) (el.className = "shp-msg"), (el.textContent = "");
}

let cleanup = null;
const ctx = {
  get W() {
    return W;
  },
  get pet() {
    return pet;
  },
  get bond() {
    return bond;
  },
  get grow() {
    return grow;
  },
  petLabel: () => petLabel(),
  post,
  snd,
  confetti,
  rollTo,
  fmt,
  say,
  candle: (s = 2) => toCanvas("gcandle", s),
  repaint: () => paint(),
  // Candle Catch lives on the pet's screen: close the hub and press the device's Play key
  playCatch: () => {
    close();
    const b = [...document.querySelectorAll("#iconsTop .ico, #iconsBot .ico")].find((x) => x.getAttribute("aria-label") === "Play");
    const dev = document.querySelector(".device-wrap");
    if (dev) dev.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" });
    if (b) setTimeout(() => b.click(), calm.matches ? 0 : 350);
  },
  // the day's bounties live under the device (Today, quests.js): close the hub and show them
  showToday: () => {
    close();
    const q = document.getElementById("quests");
    if (q) q.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth", block: "center" });
  },
};

function paint() {
  if (!open) return;
  for (const b of sheetRoot.querySelectorAll(".shp-tab")) {
    const on = b.dataset.k === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  }
  // a dot on Daily while the free spin waits
  const dot = sheetRoot.querySelector("#shpTab-daily .dot");
  if (dot) dot.hidden = !(W && W.day && !W.day.wheel);
  const body = sheetRoot.querySelector(".shp-body");
  body.setAttribute("aria-labelledby", "shpTab-" + tab);
  const view = tab + ":" + (tab === "games" ? game : tab === "shop" ? cat : "");
  // the animated views keep their canvases between wallet updates; only rebuild on a view change
  if (body.dataset.tab === view && body._update) return body._update();
  if (cleanup) cleanup(), (cleanup = null);
  const keep = body.dataset.tab && body.dataset.tab.split(":")[0] === tab ? body.scrollTop : 0;
  body.dataset.tab = view;
  body._update = null;
  body.innerHTML = "";
  if (!W) {
    body.innerHTML = `<div class="shp-empty">Loading…</div>`;
    body.dataset.tab = "";
    return;
  }
  if (tab === "daily") cleanup = renderDailyTab(body, ctx);
  else if (tab === "games") cleanup = renderGamesTab(body, ctx, game, (g) => ((game = g), snd.tab(), hush(), paint(), body.focus({ preventScroll: true })));
  else if (tab === "shop") paintShop(body);
  else if (tab === "level") renderLevelTab(body, ctx);
  body.scrollTop = keep;
}

/** A one-line message at the top of the sheet. */
function say(msg, kind = "") {
  const box = sheetRoot && sheetRoot.querySelector(".shp-box");
  if (!box) return;
  let el = box.querySelector(".shp-msg");
  if (!el) {
    el = document.createElement("div");
    el.className = "shp-msg";
    box.appendChild(el);
  }
  el.textContent = msg;
  el.className = "shp-msg show " + kind;
  clearTimeout(say.t);
  say.t = setTimeout(() => el.classList.remove("show"), 2400);
}

// a price button: tap once to arm it if it's a big spend, again to confirm
function priceBtn(price, label, onBuy, { big = price >= 50, disabled = false } = {}) {
  const b = document.createElement("button");
  b.className = "shp-buy";
  const can = W && W.bal >= price;
  b.innerHTML = `<span class="ci"></span><b>${price}</b>${label ? `<span class="lb">${label}</span>` : ""}`;
  b.querySelector(".ci").appendChild(toCanvas("gcandle", 2));
  if (!can) {
    b.classList.add("short");
    b.setAttribute("aria-disabled", "true");
    b.setAttribute("aria-label", `${price} Candles, you need ${price - (W ? W.bal : 0)} more`);
  }
  if (disabled) b.disabled = true;
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    if (!(W && W.bal >= price)) {
      snd.no();
      say(`You need ${price - (W ? W.bal : 0)} more Candles`, "bad");
      b.classList.remove("nope");
      void b.offsetWidth;
      b.classList.add("nope");
      return;
    }
    if (big && !b.classList.contains("arm")) {
      b.classList.add("arm");
      b.querySelector("b").textContent = "Sure?";
      sfx.click();
      setTimeout(() => {
        if (!b.isConnected) return;
        b.classList.remove("arm");
        b.querySelector("b").textContent = String(price);
      }, 2600);
      return;
    }
    b.disabled = true;
    try {
      await onBuy(b);
    } catch (e) {
      snd.no();
      say(e.message, "bad");
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  });
  return b;
}

function card(item, { sub = "", count = 0, tagText = "" } = {}) {
  const it = ITEMS[item];
  const c = document.createElement("div");
  c.className = `shp-card k-${it.kind}`;
  c.dataset.item = item;
  const art = document.createElement("div");
  art.className = "art";
  if (it.kind === "color") {
    art.innerHTML = `<span class="sw" style="--sw:${it.hex}"></span>`;
  } else art.appendChild(iconOf(item, it.kind === "badge" ? 5 : 4));
  c.appendChild(art);
  c.insertAdjacentHTML("beforeend", `<div class="nm">${esc(it.name)}</div>${sub ? `<div class="fx">${esc(sub)}</div>` : ""}`);
  if (count) c.insertAdjacentHTML("beforeend", `<span class="cnt">×${count}</span>`);
  if (tagText) c.insertAdjacentHTML("beforeend", `<span class="tag">${esc(tagText)}</span>`);
  return c;
}
function section(body, title, note) {
  const s = document.createElement("section");
  s.className = "shp-sec";
  s.innerHTML = `<h3>${esc(title)}${note ? `<small>${esc(note)}</small>` : ""}</h3><div class="shp-grid"></div>`;
  body.appendChild(s);
  return s.querySelector(".shp-grid");
}
// "#953": the number in the NFT name (main.js passes it as the name; the token id maps to it the same way)
const petNum = () => (/^\d+$/.test(pet.name) ? pet.name : String(((pet.id + 1459) % 1969) + 1));
const petLabel = () => (pet.id ? "#" + petNum() : "this Chog");

function bought(card, msg) {
  snd.buy();
  say(msg, "good");
  const r = card.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 2, 24);
}

const STYLE_KEYS = ["c_pink", "c_cyan", "c_orange", "c_violet", "c_gold", "b_star", "b_heart", "b_flame", "b_crown"];
/** An owned name colour or badge: Wear switches to it (one colour and one badge at a time), Take off clears it. */
function styleCard(k) {
  const it = ITEMS[k];
  const on = (it.kind === "color" ? W.c : W.b) === k;
  const c = card(k, { tagText: on ? "On" : "" });
  if (on) c.classList.add("got");
  const b = document.createElement("button");
  b.className = "shp-buy wear" + (on ? " on" : "");
  b.innerHTML = `<b>${on ? "Take off" : "Wear"}</b>`;
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.setAttribute("aria-label", `${on ? "Take off" : "Wear"} ${it.name}`);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await post("equip", it.kind === "color" ? { c: on ? "" : k } : { b: on ? "" : k });
      sfx.click();
      decorateAll();
      paint();
      const again = sheetRoot.querySelector(`.shp-card[data-item="${k}"] .wear`);
      if (again) again.focus({ preventScroll: true });
    } catch (e) {
      say(e.message, "bad");
      if (b.isConnected) b.disabled = false;
    }
  });
  c.appendChild(b);
  return c;
}

const SHELVES = [
  { k: "snacks", t: "Snacks", line: "Unlock in the Feed menu. One use each." },
  { k: "gifts", t: "Gifts", line: "" },
  { k: "boosts", t: "Boosts", line: "One use each." },
  { k: "style", t: "Name style", line: "How your name looks in visitor logs and chat." },
  { k: "bag", t: "Bag", line: "What you have." },
];
const myLv = () => (W && W.lv ? W.lv.lv : 1);
const isLocked = (k) => (ITEMS[k].lv || 1) > myLv();
/** A shop card that needs a level you don't have yet: no price button, just when it opens. */
function lockCard(c, k) {
  c.classList.add("locked");
  const t = document.createElement("div");
  t.className = "shp-lock";
  t.innerHTML = `<span class="lk" aria-hidden="true"></span>Lv ${ITEMS[k].lv}`;
  t.setAttribute("aria-label", `${ITEMS[k].name}: unlocks at Sitter level ${ITEMS[k].lv}`);
  c.appendChild(t);
}

function paintShop(body) {
  if (!SHELVES.some((s) => s.k === cat)) cat = "snacks";
  const bar = document.createElement("div");
  bar.className = "shp-shelves";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Shelves");
  const inv = W.inv || {};
  const bagN = Object.keys(inv).filter((k) => inv[k] > 0 && ITEMS[k]).length;
  for (const s of SHELVES) {
    const b = document.createElement("button");
    b.className = "shelf" + (s.k === cat ? " on" : "");
    b.setAttribute("aria-pressed", s.k === cat ? "true" : "false");
    b.innerHTML = `${s.t}${s.k === "bag" && bagN ? ` <b>${bagN}</b>` : ""}`;
    b.addEventListener("click", () => {
      if (cat === s.k) return;
      cat = s.k;
      store("pet.shopCat", cat);
      snd.tab();
      paint();
      const again = sheetRoot.querySelector(".shelf.on");
      if (again) again.focus({ preventScroll: true });
    });
    bar.appendChild(b);
  }
  body.appendChild(bar);
  const sh = SHELVES.find((s) => s.k === cat);
  const line = cat === "gifts" ? (pet.id ? `For ${petLabel()}'s room. Everyone who visits sees them. One of each.` : "Open a Chog to give it a gift.") : sh.line;
  body.insertAdjacentHTML("beforeend", `<p class="hub-intro">${esc(line)}</p>`);
  if (cat === "bag") return paintBag(body);
  const g = document.createElement("div");
  g.className = "shp-grid" + (cat === "style" ? " tight" : "");
  if (cat === "snacks") {
    for (const k of ["boba", "mochi", "goldramen", "candlecake"]) {
      const c = card(k, { sub: ITEMS[k].fx, count: inv[k] || 0 });
      if (isLocked(k)) lockCard(c, k);
      else
        c.appendChild(priceBtn(ITEMS[k].price, "", async () => {
          await post("buy", { item: k });
          bought(c, `${ITEMS[k].name} is in your bag. Find it in Feed`);
          paint();
        }));
      g.appendChild(c);
    }
  } else if (cat === "gifts") {
    const has = new Set(petGifts.map((x) => x.item));
    for (const k of ["poster", "plush", "lights", "lamp", "aquarium", "cushion", "disco"]) {
      const inRoom = has.has(k);
      const c = card(k, { count: inv[k] || 0, tagText: inRoom ? "In room" : "" });
      if (inRoom) c.classList.add("got");
      if (pet.id && inRoom) {
        const d = document.createElement("div");
        d.className = "shp-done";
        d.textContent = "It has one";
        c.appendChild(d);
      } else if (pet.id && inv[k] > 0) {
        const b = document.createElement("button");
        b.className = "shp-buy give";
        b.innerHTML = `<b>Give</b>`;
        b.setAttribute("aria-label", `Give ${ITEMS[k].name} from your bag`);
        b.addEventListener("click", () => giveGift(k, c, b));
        c.appendChild(b);
      } else if (isLocked(k)) lockCard(c, k);
      else if (!pet.id) c.appendChild(priceBtn(ITEMS[k].price, "", async () => {}, { disabled: true }));
      else c.appendChild(priceBtn(ITEMS[k].price, "", async () => doGift(k, c, true)));
      g.appendChild(c);
    }
  } else if (cat === "boosts") {
    for (const k of ["x2", "charm"]) {
      const c = card(k, { sub: ITEMS[k].fx, count: inv[k] || 0 });
      if (isLocked(k)) lockCard(c, k);
      else
        c.appendChild(priceBtn(ITEMS[k].price, "", async () => {
          await post("buy", { item: k });
          bought(c, `${ITEMS[k].name} is in your bag`);
          paint();
        }));
      g.appendChild(c);
    }
  } else if (cat === "style") {
    const own = new Set(W.own || []);
    const meEl = document.createElement("div");
    meEl.className = "shp-me";
    meEl.innerHTML = `<span class="who"></span>`;
    const who = meEl.querySelector(".who");
    who.textContent = myLabel || "You";
    who.dataset.sitter = "You";
    decorate(who, "You");
    body.appendChild(meEl);
    for (const k of STYLE_KEYS) {
      const it = ITEMS[k];
      if (own.has(k)) {
        g.appendChild(styleCard(k));
        continue;
      }
      const c = card(k);
      if (isLocked(k)) lockCard(c, k);
      else
        c.appendChild(priceBtn(it.price, "", async () => {
          await post("buy", { item: k });
          bought(c, `${it.name}: on`);
          decorateAll();
          paint();
        }));
      g.appendChild(c);
    }
  }
  body.appendChild(g);
}

async function doGift(k, c, buy) {
  if (!pet.id) return;
  const j = await post("gift", { item: k, pet: pet.id, buy });
  petGifts = j.gifts || petGifts.concat([{ item: k }]);
  setGifts(pet.id, petGifts);
  snd.big();
  say(`${ITEMS[k].name} is in ${petLabel()}'s room!`, "good");
  const r = c.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 2, 50);
  // land it in the room on screen too
  const scr = document.getElementById("scr");
  if (scr) {
    const s = scr.getBoundingClientRect();
    setTimeout(() => confetti(s.left + s.width / 2, s.top + s.height * 0.8, 40), 350);
  }
  paint();
}
async function giveGift(k, c, b) {
  b.disabled = true;
  try {
    await doGift(k, c, false);
  } catch (e) {
    snd.no();
    say(e.message, "bad");
    b.disabled = false;
  }
}

function paintBag(body) {
  const inv = W.inv || {};
  const keys = Object.keys(inv).filter((k) => inv[k] > 0 && ITEMS[k]);
  const own = (W.own || []).filter((k) => ITEMS[k]);
  if (!keys.length && !own.length) {
    body.innerHTML = `<div class="shp-empty"><div class="big"></div><p>Your bag is empty.</p><p class="dim">Care for Chogs and play Candle Catch to earn Candles.</p></div>`;
    body.querySelector(".big").appendChild(iconOf("e_capsule", 6));
    const b = document.createElement("button");
    b.className = "shp-cta";
    b.textContent = "Ways to earn";
    b.addEventListener("click", () => setTab("daily"));
    body.querySelector(".shp-empty").appendChild(b);
    return;
  }
  const order = { food: 0, gift: 1, boost: 2 };
  keys.sort((a, b) => order[ITEMS[a].kind] - order[ITEMS[b].kind]);
  const g = keys.length ? section(body, "In your bag") : null;
  for (const k of keys) {
    const it = ITEMS[k];
    const c = card(k, { count: inv[k] });
    const note = (t) => {
      const d = document.createElement("div");
      d.className = "shp-done";
      d.textContent = t;
      c.appendChild(d);
    };
    if (it.kind === "food") note("In the Feed menu");
    else if (it.kind === "gift") {
      const inRoom = petGifts.some((x) => x.item === k);
      if (!pet.id || inRoom) note(inRoom ? `${petLabel()} has one` : "Open a Chog to give");
      else {
        const b = document.createElement("button");
        b.className = "shp-buy give";
        b.innerHTML = `<b>Give</b>`;
        b.addEventListener("click", () => giveGift(k, c, b));
        c.appendChild(b);
      }
    } else note(k === "x2" ? "Next Candle Catch" : "Next capsule");
    g.appendChild(c);
  }
  if (own.length) {
    const g2 = section(body, "Name style", "one colour and one badge at a time");
    for (const k of STYLE_KEYS.filter((x) => own.includes(x)).concat(own.filter((x) => !STYLE_KEYS.includes(x)))) g2.appendChild(styleCard(k));
  }
}

// ---------- merge: a signed-in visitor brings this browser's anonymous Candles along ----------
async function maybeMerge() {
  if (!(me.token && mergeable && mergeable.bal >= 0)) return;
  try {
    const j = await post("merge", {});
    mergeable = null;
    if (j.moved > 0) showGain({ gain: j.moved, why: [["From this browser", j.moved]] });
  } catch {}
}
const _refresh = refresh;
async function refreshAndMerge() {
  await _refresh();
  await maybeMerge();
}

// ---------- on the pet card: your bond with this Chog, a quiet "♥ 3" next to its name ----------
function paintPetChip(pop) {
  const el = document.getElementById("pcBond");
  if (!el) return;
  const lv = pet.id && bond ? bond.lv : 0;
  if (!lv) return void (el.hidden = true);
  if (el.dataset.lv !== String(lv)) {
    el.dataset.lv = String(lv);
    el.replaceChildren(toCanvas("heartS", 2), document.createTextNode(String(lv)));
  }
  el.hidden = false;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `bond ${lv} with you`);
  if (pop) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
}

// ---------- start ----------
window.chogEcon = {
  foods: () => (W ? Object.keys(W.inv || {}).filter((k) => W.inv[k] > 0 && ITEMS[k] && ITEMS[k].kind === "food") : []),
  count: (k) => (W && W.inv && W.inv[k]) || 0,
  open: (t) => openSheet(t),
  refresh: () => refreshAndMerge(),
  wallet: () => W, // Today (quests.js) shows the bounties from it; it also hears "chogpet:wallet"
  styleFor,
  decorate,
};
// loaded after main.js already opened a Chog: read it off the pet card (thumb /chogs/<id>.webp)
function petFromCard() {
  const m = ((document.getElementById("pcThumb") || {}).src || "").match(/\/chogs\/(\d{1,4})\.webp/);
  const id = m ? Number(m[1]) : 0;
  if (!(id >= 1 && id <= 1969) || id === pet.id) return false;
  const nm = document.getElementById("pcName");
  pet = { id, name: nm ? nm.textContent : "" };
  setCurrent(id);
  refresh();
  return true;
}
if (!petFromCard()) {
  let n = 0;
  const t = setInterval(() => (petFromCard() || pet.id || ++n > 20) && clearInterval(t), 500);
}
refreshAndMerge();
setInterval(() => {
  if (me.token && mergeable) maybeMerge();
}, 3000);
