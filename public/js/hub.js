// Chog Pet: the Candles hub's Daily, Games and Level tabs, the level badge and the level-up toast.
// shop.js owns the sheet, the wallet and the Shop tab; it passes a ctx in. The worker decides every number.
import { ITEMS, XP, BET, CAPSULE, FRAMES, BOND, unlocks, frameOf } from "./econ.js";
import { iconOf } from "./gifts.js";
import { S, toCanvas } from "./sprites.js";
import { renderCapsules, renderPump, renderWheel } from "./arcade.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export function left(ends) {
  const s = Math.max(0, ends - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
const icon = (k, s = 2) => (S[k] ? toCanvas(k, s, k.startsWith("i_") ? "#efe8ff" : undefined) : iconOf(k, s));
const bar = (a, b, cls = "") => `<span class="hub-bar ${cls}"><i style="width:${Math.round((100 * Math.min(a, b)) / Math.max(1, b))}%"></i></span>`;
const itemName = (k) => (ITEMS[k] ? ITEMS[k].name : k);

/** A small level badge: the number in a frame whose colour grows with the level. */
export function badge(lv, size = "") {
  const f = frameOf(lv || 1);
  const b = el("span", `lvb f-${f.k} ${size}`);
  b.style.setProperty("--fc", f.col);
  b.innerHTML = `<b>${lv || 1}</b>`;
  return b;
}

/** A titled card: <section><h3>title</h3><p>one line</p>...</section>. */
function card(title, line, cls = "") {
  const c = el("section", "hub-card " + cls);
  c.innerHTML = `<header><h3>${esc(title)}</h3>${line ? `<p>${line}</p>` : ""}</header>`;
  return c;
}

// ======================= DAILY =======================
export function renderDailyTab(body, ctx) {
  const grid = el("div", "hub-grid");
  body.appendChild(grid);
  // the free wheel keeps its canvas (it may be spinning); the other cards are redrawn on every wallet update
  const spin = card("Daily spin", "Free, once a day.", "c-spin");
  const wbox = el("div", "spin-box");
  spin.appendChild(wbox);
  grid.appendChild(spin);
  const stopWheel = renderWheel(wbox, ctx);
  const update = () => {
    for (const c of [...grid.children]) if (c !== spin) c.remove();
    dailyCards(grid, ctx);
    if (wbox._update) wbox._update();
  };
  dailyCards(grid, ctx);
  body._update = update;
  return () => stopWheel && stopWheel();
}
function dailyCards(grid, ctx) {
  const W = ctx.W, d = W.day;

  // streak + first care of the day
  const st = card("Streak", "Care for any Chog once a day to keep it going.", "c-streak");
  const n = W.streak || 0;
  const wk = el("div", "streak-wk");
  const inWeek = n ? ((n - 1) % 7) + 1 : 0;
  for (let i = 1; i <= 7; i++) wk.appendChild(el("span", "sd" + (i <= inWeek ? " on" : "") + (i === 7 ? " big" : ""), `<i>${i}</i>`));
  st.insertAdjacentHTML("beforeend", `<div class="streak-n"><b>${n}</b><span>${n === 1 ? "day" : "days"} in a row</span></div>`);
  st.appendChild(wk);
  const firstRow = el("div", "hub-row" + (d.first ? " done" : ""));
  firstRow.innerHTML = `<span class="t">${d.first ? "Today's first care" : "First care today"}</span><span class="v">${d.first ? "Done" : `+${d.firstPay} <i class="ci"></i> +${d.firstXp} XP`}</span>`;
  const ci = firstRow.querySelector(".ci");
  if (ci) ci.appendChild(ctx.candle(1));
  st.appendChild(firstRow);
  if (d.first) st.insertAdjacentHTML("beforeend", `<p class="hub-note">Tomorrow: +${d.firstPay} Candles, +${d.firstXp} XP. Resets in ${left(W.ends)}.</p>`);
  grid.appendChild(st);

  // the day's three bounties are under the pet (Today): one list, in one place
  const bt = card("Today's three", "Bounties pay the moment they're done. They're under your pet.", "c-bty");
  const go = el("button", "hub-link", `See today's three <span aria-hidden="true">→</span>`);
  go.type = "button";
  go.addEventListener("click", () => ctx.showToday && ctx.showToday());
  bt.appendChild(go);
  grid.appendChild(bt);
}

// ======================= GAMES =======================
const GAMES = [
  { k: "caps", t: "Capsules", ic: "e_capsule", line: "A random snack, gift, boost or name style." },
  { k: "pump", t: "Green or Red", ic: "gcandle", line: "Guess the next candle: green or red. A win pays ×" + BET.pay + "." },
  { k: "catch", t: "Candle Catch", ic: "i_play", line: "Catch candles on the pet's screen. Pays Candles and XP." },
];
export function renderGamesTab(body, ctx, sel, setSel) {
  const W = ctx.W, d = W.day;
  if (sel === "caps" || sel === "pump") {
    const g = GAMES.find((x) => x.k === sel);
    const head = el("div", "game-head");
    const back = el("button", "hub-back", `<span aria-hidden="true">←</span> Games`);
    back.addEventListener("click", () => setSel(""));
    head.append(back, el("h3", "", esc(g.t)));
    body.appendChild(head);
    const box = el("div", "game-box");
    body.appendChild(box);
    const stop = sel === "caps" ? renderCapsules(box, ctx) : renderPump(box, ctx);
    body._update = box._update;
    return stop;
  }
  const list = el("div", "game-list");
  for (const g of GAMES) {
    const c = el("button", "game-card k-" + g.k);
    let meta = "";
    if (g.k === "caps") meta = `<span class="price"><i></i>${CAPSULE}</span><span>${Math.max(0, d.pullsCap - d.pulls)} left today</span>`;
    if (g.k === "pump") meta = `<span class="price"><i></i>${BET.sizes[0]}–${BET.sizes[BET.sizes.length - 1]}</span><span>${Math.max(0, d.betsCap - d.bets)} bets left</span>`;
    if (g.k === "catch") meta = `<span class="price free">Free</span><span>${d.catch}/${d.catchCap} Candles today</span>`;
    c.innerHTML = `<span class="art"></span><span class="txt"><b>${esc(g.t)}</b><span class="ln">${esc(g.line)}</span><span class="meta">${meta}</span></span><span class="go">${g.k === "catch" ? "Play" : "Open"}</span>`;
    c.querySelector(".art").appendChild(icon(g.ic, 4));
    const pi = c.querySelector(".price i");
    if (pi) pi.appendChild(ctx.candle(1));
    c.addEventListener("click", () => (g.k === "catch" ? ctx.playCatch() : setSel(g.k)));
    list.appendChild(c);
  }
  body.appendChild(list);
  body.appendChild(el("p", "hub-note", "Capsules and Green or Red pay back less than they cost, on average. They're for fun, and capped each day. No XP from them."));
  return null;
}

// ======================= LEVEL =======================
function hearts(lv) {
  const h = el("span", "hearts");
  for (let i = 0; i < BOND.length; i++) {
    const c = toCanvas("heartS", 2);
    if (i >= lv) c.classList.add("off");
    h.appendChild(c);
  }
  return h;
}
export function renderLevelTab(body, ctx) {
  const W = ctx.W, L = W.lv;
  const hero = el("section", "lv-hero");
  hero.appendChild(badge(L.lv, "big"));
  const frame = frameOf(L.lv);
  hero.insertAdjacentHTML(
    "beforeend",
    `<div class="lv-txt"><h3>Sitter Lv ${L.lv}</h3>${bar(L.cur, L.need || 1, "big")}<p>${L.max ? "Top level. Thanks for all the care." : `<b>${L.cur}</b> / ${L.need} XP · ${L.need - L.cur} to Lv ${L.lv + 1}`}</p><p class="dim">Today ${L.today}/${L.cap} XP · ${esc(frame.name)}</p></div>`,
  );
  body.appendChild(hero);

  const grid = el("div", "hub-grid");
  body.appendChild(grid);
  // you and the Chog on screen
  const pet = ctx.pet;
  if (pet.id && ctx.bond) {
    const b = ctx.bond;
    const c = card(`You and ${ctx.petLabel()}`, "Bond grows with your care for this Chog.", "c-bond");
    const r1 = el("div", "bond-row");
    r1.innerHTML = `<span class="k">Bond</span>`;
    r1.appendChild(hearts(b.lv));
    r1.insertAdjacentHTML("beforeend", `<span class="n">${b.max ? "Max" : `${b.cur}/${b.need}`}</span>`);
    c.append(r1);
    grid.appendChild(c);
  }
  // how XP comes
  const how = card("How to get XP", "Only real care counts. The same Chog gives less after two actions a day.", "c-how");
  const rows = [
    ["i_feed", "Feed", `+${XP.act.feed}`],
    ["i_clean", "Bath", `+${XP.act.clean}`],
    ["i_lights", "Lights", `+${XP.act.lights}`],
    ["i_play", "Candle Catch", `+${XP.act.play} +score÷${XP.playDiv}`],
    ["flame", "First care of the day", `+${XP.first} +${XP.streakStep}/streak day`],
    ["sparkle", "Each bounty · all three", `+${XP.bounty} · +${XP.all}`],
  ];
  const l = el("div", "hub-list");
  for (const [ic, t, v] of rows) {
    const r = el("div", "hub-row");
    r.innerHTML = `<span class="ic"></span><span class="t">${t}</span><span class="v">${v}</span>`;
    r.querySelector(".ic").appendChild(icon(ic));
    l.appendChild(r);
  }
  how.appendChild(l);
  how.insertAdjacentHTML("beforeend", `<p class="hub-note">Same Chog, same day: 100% · 100% · 60% · 60% · 30% · 30% · then 0. Up to ${XP.dayCap} XP a day.</p>`);
  grid.appendChild(how);

  // the road: what each level unlocks
  const road = card("Unlocks", "Levels open new things in the shop and new badge frames.", "c-road wide");
  const ol = el("ol", "road");
  for (const u of unlocks()) {
    const st = u.lv <= L.lv ? "got" : u.lv === nextUnlock(L.lv) ? "next" : "";
    const li = el("li", st);
    li.appendChild(badge(u.lv, "sm"));
    const things = el("span", "things");
    for (const k of u.items) {
      const t = el("span", "thing");
      const it = ITEMS[k];
      if (it.kind === "color") t.appendChild(el("span", "sw")).style.setProperty("--sw", it.hex);
      else t.appendChild(iconOf(k, 2));
      t.appendChild(document.createTextNode(it.name));
      things.appendChild(t);
    }
    if (u.frame) {
      const t = el("span", "thing fr");
      t.appendChild(badge(u.lv, "xs"));
      t.appendChild(document.createTextNode(u.frame.name));
      things.appendChild(t);
    }
    li.appendChild(things);
    li.insertAdjacentHTML("beforeend", `<span class="st">${st === "got" ? "Open" : st === "next" ? "Next" : ""}</span>`);
    ol.appendChild(li);
  }
  road.appendChild(ol);
  grid.appendChild(road);
  return null;
}
const nextUnlock = (lv) => (unlocks().find((u) => u.lv > lv) || {}).lv;

// ======================= toasts =======================
let toastBox = null;
export function toast(html, { kind = "", ms = 4200, onClick = null } = {}) {
  if (!toastBox) {
    toastBox = el("div", "cdl-toasts");
    toastBox.setAttribute("role", "status");
    toastBox.setAttribute("aria-live", "polite");
    document.body.appendChild(toastBox);
  }
  const t = el(onClick ? "button" : "div", "cdl-toast " + kind, html);
  if (onClick) t.addEventListener("click", () => (t.remove(), onClick()));
  toastBox.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => {
    t.classList.remove("in");
    setTimeout(() => t.remove(), 300);
  }, ms);
  return t;
}
/** "LEVEL UP · Sitter Lv 5 · New: ..." */
export function levelUpToast(x, openLevel) {
  const names = [];
  for (const u of x.unlocked || []) {
    for (const k of u.items) names.push(itemName(k));
    if (u.frame) names.push(u.frame.name);
  }
  const t = toast(
    `<span class="tb"></span><span class="tt"><b class="h">Level up</b><span>Sitter Lv ${x.up}</span>${names.length ? `<small>New: ${esc(names.slice(0, 4).join(", "))}${names.length > 4 ? "…" : ""}</small>` : ""}</span>`,
    { kind: "up", ms: 5200, onClick: openLevel },
  );
  t.querySelector(".tb").appendChild(badge(x.up, "big"));
  return t;
}
export function bondToast(b, label, openLevel) {
  const t = toast(`<span class="tb"></span><span class="tt"><b class="h">Bond ${b.up}</b><span>with ${esc(label)}</span></span>`, { kind: "bond", onClick: openLevel });
  t.querySelector(".tb").appendChild(toCanvas("heart", 3));
  return t;
}
export { FRAMES };
