// Chog Pet: the page. Wires the LCD, the bezel icons, the A/B/C keys, the food menu, the mini-game and the
// side panels to the worker. The worker owns the truth; the page runs the same simulation in between so
// meters move smoothly and actions feel instant (the server's answer then settles the state).
import { personaOf, quirks, lineFor, REACT, pick, ageLine, sitterName } from "./persona.js";
import { advance, act, mood as moodOf, FOODS, menu as menuOf, COOLDOWN, stageOf } from "./sim.js";
import { Screen } from "./screen.js";
import { CandleCatch } from "./game.js";
import { toCanvas } from "./sprites.js";
import { sfx } from "./sfx.js";
import { api, me, store } from "./api.js";
import { signIn, signOut, hasWallet, backFromSocial } from "./wallet.js";
import { makeCard } from "./card.js";
import { Town, softImgs, TOWN_LABEL } from "./town.js";
import { startIntro } from "./intro.js";
import { startTour, tourSeen } from "./tour.js";
import { ITEMS } from "./econ.js";
import { setGifts } from "./gifts.js";
import { STICKERS } from "./stickers.js";

const $ = (id) => document.getElementById(id);
const now = () => Math.floor(Date.now() / 1000);
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const EXPLORER = "https://monadvision.com/address/";

const ACTIONS = [
  { k: "feed", icon: "i_feed", label: "Feed" },
  { k: "play", icon: "i_play", label: "Play" },
  { k: "clean", icon: "i_clean", label: "Bath" },
  { k: "lights", icon: "i_lights", label: "Lights" },
  { k: "love", icon: "i_love", label: "Pet" },
  { k: "card", icon: "i_card", label: "Card" },
];
const MOOD_LABEL = { happy: "happy", content: "fine", hungry: "hungry", bored: "bored", sleepy: "sleepy", stinky: "stinky", miserable: "sad", asleep: "asleep", away: "away", lonely: "lonely" };

let DATA = null; // names + traits
let LINE = null; // owners
const screen = new Screen($("scr"), $("art"));
const cur = { id: 0, p: null, view: null, base: null, skew: 0, cool: {}, busy: false };
let sel = 0;
let menuOpen = false;
let menuSel = 0;
let menuItems = [];
let game = null;
let chatterAt = 0;
let speechT = 0;
let town = null;
const wait = (s) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`);
const daysOf = (v) => Math.max(0, Math.floor((now() - (v.since || now())) / 86400));
function myLabel() {
  if (me.token && me.address) return short(me.address);
  return sitterName(me.anon);
}

// ---------- helpers ----------
const nameNum = (id) => DATA.n[id - 1];
const nftName = (id) => DATA.nm[String(id)] || `Chog #${nameNum(id)}`;
const persona = (id) => personaOf(id, DATA.t[id - 1]);
const thumb = (id) => `/chogs/${id}.webp`;
function idFromName(n) {
  const i = DATA.n.indexOf(n);
  return i >= 0 ? i + 1 : 0;
}
function ago(t) {
  const d = now() - t;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), ms);
}
function say(text, ms = 3200) {
  const s = $("speech");
  if (!text) {
    s.classList.remove("show");
    screen.talking = false;
    return;
  }
  s.textContent = text;
  // nobody home: speak from the note on the floor, not from the empty spot over the sign
  s.classList.toggle("low", !!simNow()?.away);
  s.classList.add("show");
  screen.talking = true;
  clearTimeout(speechT);
  speechT = setTimeout(() => {
    s.classList.remove("show");
    screen.talking = false;
  }, ms);
  chatterAt = Date.now() + 9000 + Math.random() * 9000;
}
function device(cls) {
  const d = $("device");
  d.classList.remove("wiggle", "jump");
  void d.offsetWidth;
  d.classList.add(cls);
}
const simNow = () => (cur.base && cur.p ? advance(cur.base, cur.p, now() + cur.skew) : null);

// ---------- meters (under the screen) ----------
const METERS = [["food", "h_food", "Food"], ["fun", "h_fun", "Fun"], ["energy", "h_energy", "Energy"], ["clean", "h_clean", "Clean"]];
function buildMeters() {
  $("meters").innerHTML = "";
  for (const [k, icon, label] of METERS) {
    const m = document.createElement("div");
    m.className = "meter";
    m.dataset.k = k;
    m.appendChild(toCanvas(icon, 2));
    m.insertAdjacentHTML("beforeend", `<span class="m-l">${label}</span><span class="m-bar"><i></i></span>`);
    $("meters").appendChild(m);
  }
}
function paintMeters(s) {
  if (!s) return;
  for (const m of $("meters").children) {
    const v = Math.max(0, Math.min(100, Math.round(s[m.dataset.k] ?? 0)));
    m.querySelector("i").style.width = v + "%";
    m.classList.toggle("low", v <= 25);
    m.classList.toggle("mid", v > 25 && v <= 50);
    m.setAttribute("aria-label", `${m.dataset.k} ${v} of 100`);
  }
}

// ---------- icons ----------
function buildIcons() {
  const top = $("iconsTop"), bot = $("iconsBot");
  ACTIONS.forEach((a, i) => {
    const b = document.createElement("button");
    b.className = "ico";
    b.dataset.i = i;
    b.setAttribute("aria-label", a.label);
    b.appendChild(toCanvas(a.icon, 2, "#efe8ff"));
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = a.label;
    b.appendChild(lbl);
    const cd = document.createElement("span");
    cd.className = "cd";
    b.appendChild(cd);
    b.addEventListener("click", () => {
      sfx.unlock();
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
      if (game) return toast("Finish the round first, or tap Quit.");
      if (menuOpen) closeMenu();
      setSel(i);
      if (a.k === "feed" || a.k === "card") sfx.click();
      run(a.k);
    });
    (i < 3 ? top : bot).appendChild(b);
  });
  setSel(0);
}
function setSel(i) {
  sel = (i + ACTIONS.length) % ACTIONS.length;
  document.querySelectorAll(".ico").forEach((b, k) => {
    b.classList.toggle("sel", k === sel);
    b.querySelector(".lbl").classList.remove("show");
  });
}
function flashLabel() {
  const b = document.querySelectorAll(".ico")[sel];
  const l = b.querySelector(".lbl");
  l.classList.add("show");
  clearTimeout(flashLabel.t);
  flashLabel.t = setTimeout(() => l.classList.remove("show"), 900);
}
function paintCooldowns() {
  const t = now();
  document.querySelectorAll(".ico").forEach((b, k) => {
    const a = ACTIONS[k].k;
    const left = (cur.cool[a] || 0) - t;
    const cd = b.querySelector(".cd");
    if (left > 0 && a !== "love") {
      b.classList.add("cool");
      cd.textContent = left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`;
    } else {
      b.classList.remove("cool");
      cd.textContent = "";
    }
  });
}

// ---------- the food menu (on the LCD) ----------
function openMenu() {
  const p = cur.p;
  menuItems = menuOf(p, window.chogEcon ? window.chogEcon.foods() : []);
  const m = $("menu");
  m.innerHTML = "";
  const h = document.createElement("h4");
  const full = (simNow() || {}).food >= 92;
  h.textContent = full ? "It's full! Maybe later" : "What's for dinner?";
  m.appendChild(h);
  const grid = document.createElement("div");
  grid.className = "menu-grid";
  menuItems.forEach((it, i) => {
    const b = document.createElement("button");
    b.className = "food";
    const locked = it === "chog" && !me.holder;
    if (locked) b.classList.add("locked");
    b.appendChild(toCanvas(it, 3));
    const n = document.createElement("span");
    n.textContent = FOODS[it].name;
    b.appendChild(n);
    if (it === p.fav) {
      const f = document.createElement("span");
      f.className = "fav";
      f.textContent = "★";
      b.appendChild(f);
    }
    if (FOODS[it].shop) {
      // a snack from the shop: how many are left in the bag
      const q = document.createElement("span");
      q.className = "fav";
      q.textContent = "×" + (window.chogEcon ? window.chogEcon.count(it) : 1);
      b.appendChild(q);
    }
    if (locked) {
      const l = document.createElement("span");
      l.className = "lock";
      l.textContent = "for $CHOG holders";
      b.appendChild(l);
    }
    b.addEventListener("click", () => {
      menuSel = i;
      chooseFood();
    });
    grid.appendChild(b);
  });
  m.appendChild(grid);
  const x = document.createElement("button");
  x.className = "menu-x";
  x.textContent = "Back";
  x.addEventListener("click", closeMenu);
  m.appendChild(x);
  m.hidden = false;
  menuOpen = true;
  menuSel = Math.max(0, menuItems.indexOf(p.fav));
  paintMenu();
}
function paintMenu() {
  document.querySelectorAll(".food").forEach((b, i) => b.classList.toggle("sel", i === menuSel));
}
function closeMenu() {
  $("menu").hidden = true;
  menuOpen = false;
}
function chooseFood() {
  const item = menuItems[menuSel];
  if (item === "chog" && !me.holder) {
    sfx.no();
    toast(me.token ? "The $CHOG treat is for wallets that hold $CHOG." : "Sign in with a wallet that holds $CHOG to unlock the treat. Free, no transaction.");
    return;
  }
  closeMenu();
  send("feed", FOODS[item].shop ? { item, owned: 1 } : { item });
}

// ---------- actions ----------
function run(k) {
  if (!cur.p || cur.busy || game) return;
  if (k === "card") return share();
  const left = (cur.cool[k] || 0) - now();
  if (left > 0) {
    if (k === "love") {
      // more pets are always welcome; they just don't count again yet
      if (!screen.anim) screen.play(simNow().asleep ? "purr" : "love"), sfx.love();
      return;
    }
    sfx.no();
    say(k === "feed" ? "still full from last time" : k === "play" ? "need a break first" : k === "clean" ? "already clean!" : "give it a minute");
    toast(`You can do that again in ${wait(left)}.`);
    return;
  }
  if (k === "feed") return openMenu();
  if (k === "play") return startGame();
  send(k, {});
}

const ANIM = { spotless: "refuse", eat: "eat", fav: "fav", yuck: "yuck", treat: "treat", full: "refuse", asleep: "refuse", notsleepy: "refuse", tired: "refuse", return: "return", clean: "clean", bathlove: "bathlove", bathhate: "bathhate", nap: "nap", wake: "wake", grumpy: "grumpy", love: "love", purr: "purr", play: "play" };
const SOUND = { spotless: "no", eat: "eat", fav: "fav", yuck: "yuck", treat: "treat", full: "no", asleep: "no", notsleepy: "no", tired: "no", return: "door", clean: "clean", bathlove: "clean", bathhate: "grumpy", nap: "sleep", wake: "wake", grumpy: "grumpy", love: "love", purr: "love", play: "happy" };

function react(r, item) {
  const code = r.code;
  const anim = ANIM[code];
  if (anim) screen.play(anim, { item });
  const snd = SOUND[code];
  if (snd) sfx[snd]();
  const seed = Math.floor(Math.random() * 1000);
  if (code === "away") say("it's not here. feed it to call it back");
  else if (r.rescue) say(pick(REACT.rescued, seed));
  else if (r.woke) say(pick(REACT.woke, seed));
  else if (code === "asleep") say(pick(REACT.asleep, seed));
  else if (REACT[code]) say(pick(REACT[code], seed));
  if (["fav", "treat", "return", "wake", "bathlove"].includes(code)) device("jump");
  if (["grumpy", "bathhate", "yuck"].includes(code)) device("wiggle");
}

async function send(action, extra) {
  if (!cur.p) return;
  const id = cur.id;
  cur.busy = true;
  // predict locally so it reacts at once
  const before = simNow();
  const cellBefore = town ? town.cells[id - 1] : "0";
  const local = act(cur.base, cur.p, action, { ...extra, holder: me.holder }, now() + cur.skew);
  if (local.r.ok && action === "feed" && before && !before.away && (moodOf(before) === "miserable" || (cur.view && !cur.view.care && moodOf(before) === "hungry"))) local.r.rescue = true;
  react(local.r, extra.item);
  if (local.r.ok) cur.base = local.s;
  screen.setState(simNow());
  paintMeters(simNow());
  if (local.r.ok) deltas(before, simNow());
  try {
    const res = await api.act(id, action, extra);
    if (cur.id !== id) return;
    if (res.code === "cooldown") {
      cur.cool[action] = now() + res.wait;
      toast(`You can do that again in ${wait(res.wait)}.`);
      await refresh();
    } else {
      if (res.ok) cur.cool[action] = now() + COOLDOWN[action];
      if (res.record) {
        sfx.record();
        say("NEW RECORD!");
        screen.play("record");
        paintBoard();
      }
      if (!res.ok && res.code === "letsleep") say("shhh... someone just tucked it in"), toast(`It was just tucked in. Let it sleep for ${wait(res.wait || 60)}.`);
      if (typeof res.holder === "boolean" && me.token) me.holder = res.holder;
      if (res.stickers && res.stickers.length) {
        const st = STICKERS.find((x) => x.k === res.stickers[0]);
        setTimeout(() => {
          if (cur.id !== id) return;
          sfx.record();
          screen.burst("sparkle", 6, 64, 50, 34);
          // one reaction per action: if a level-up / bond toast already spoke, the sticker just pops in the book
          if (!(window.__chogBeat && Date.now() - window.__chogBeat < 3000)) toast(`New sticker: ${st.name}`, 3000);
          const el = document.querySelector(`.stk[data-k="${st.k}"]`);
          if (el) el.classList.add("pop");
        }, 1500);
      }
      applyView(res.pet);
      // other modules (daily quests, world, effects) listen for this; it fires once per confirmed action
      if (res.ok) {
        const c = moodCell(res.pet);
        window.dispatchEvent(new CustomEvent("chogpet:act", { detail: { id, a: action, code: res.code || "", score: typeof res.score === "number" ? res.score : null, cellBefore: cellBefore, cell: c, stickers: res.stickers || [], candles: res.candles || null } }));
      }
      if (res.ok && action === "play" && typeof res.score === "number") {
        const gain = Math.round(res.pet.state.fun - (before ? before.fun : 0));
        setTimeout(() => cur.id === id && say(gain > 0 ? `gg! fun +${gain}` : "gg!"), 1600);
      }
    }
  } catch (e) {
    if (cur.id !== id) return;
    toast(e.status === 401 ? "Your sign-in expired. Connect again." : e.status === 429 ? "Slow down a little and try again." : "Couldn't reach the pet. Check your connection.");
    if (e.status === 401) signOut(), paintWallet();
    refresh();
  } finally {
    cur.busy = false;
  }
}

// ---------- mini-game ----------
function startGame() {
  const s = simNow();
  if (s.away) return react({ code: "away" });
  if (s.energy < 12) return react({ code: "tired" });
  say("");
  sfx.click();
  const id = cur.id;
  const ticket = api.ticket(id).then((r) => r.ticket).catch(() => "");
  game = new CandleCatch(screen, cur.p, async (score) => {
    game = null;
    screen.game = null;
    screen.mode = "pet";
    $("hint").innerHTML = HINT;
    $("pad").hidden = true;
    $("meters").hidden = false;
    if (score == null) return say("ok, later");
    if (cur.id === id) send("play", { score, ticket: await ticket });
  });
  screen.game = game;
  screen.mode = "game";
  $("pad").hidden = false;
  $("meters").hidden = true;
  $("hint").innerHTML = matchMedia("(pointer: coarse)").matches ? "Drag on the screen or hold the arrows to move." : "Move with the arrow keys, the buttons, or drag on the screen. <b>Esc</b> quits.";
}
const HINT = "";

// ---------- keys ----------
function key(k, down) {
  const el = document.querySelector(`.key[data-key="${k}"]`);
  if (el) el.classList.toggle("down", down);
  if (game) {
    if (k === "a") game.press(-1, down);
    if (k === "c") game.press(1, down);
    return;
  }
  if (!down) return;
  sfx.unlock();
  if (menuOpen) {
    if (k === "a") menuSel = (menuSel + menuItems.length - 1) % menuItems.length, sfx.move(), paintMenu();
    if (k === "c") menuSel = (menuSel + 1) % menuItems.length, sfx.move(), paintMenu();
    if (k === "b") chooseFood();
    return;
  }
  if (k === "a") setSel(sel - 1), sfx.move(), flashLabel();
  if (k === "c") setSel(sel + 1), sfx.move(), flashLabel();
  if (k === "b") sfx.click(), run(ACTIONS[sel].k);
}
document.querySelectorAll(".key").forEach((b) => {
  const k = b.dataset.key;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    key(k, true);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => game && key(k, false));
  b.addEventListener("pointerup", () => b.classList.remove("down"));
  b.addEventListener("pointerleave", () => b.classList.remove("down"));
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog, [aria-modal='true'], [role='dialog'], .cx-panel")) return;
  // pet card tabs: arrows move between them
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.target.closest(".side-tabs")) {
    e.preventDefault();
    const tabs = [...document.querySelectorAll(".side-tabs button")];
    const i = tabs.indexOf(e.target.closest("button"));
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    showTab(n.dataset.tab);
    return n.focus();
  }
  // Enter/Space belong to the device keys when focus is on the device; elsewhere they press the focused button.
  // With the food menu open, they choose the food even if focus is still on the Feed button.
  if ((e.key === "Enter" || e.key === " ") && e.target.closest("button, a") && !(menuOpen && e.target.closest(".ico")) && (!e.target.closest(".device") || e.target.closest(".ico, .food, .menu-x"))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const m = { ArrowLeft: "a", ArrowRight: "c", Enter: "b", " ": "b", a: "a", d: "c" }[e.key];
  if (e.key === "Escape" && menuOpen) return closeMenu();
  if (e.key === "Escape" && game) return game.quit();
  if (e.key === "Escape") return;
  if (m) {
    e.preventDefault();
    if (!e.repeat) key(m, true);
  } else if (/^[1-6]$/.test(e.key) && !game && !menuOpen) {
    setSel(Number(e.key) - 1);
    run(ACTIONS[sel].k);
  }
});
document.addEventListener("keyup", (e) => {
  const m = { ArrowLeft: "a", ArrowRight: "c", a: "a", d: "c", Enter: "b", " ": "b" }[e.key];
  if (m) {
    key(m, false);
    const el = document.querySelector(`.key[data-key="${m}"]`);
    if (el) el.classList.remove("down");
  }
});
$("padQuit").addEventListener("click", () => game && game.quit());
// tap the pet to pet it; drag during the game to steer
const scr = $("scr");
function lx(e) {
  const r = scr.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * 128;
}
scr.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if (game) {
    scr.setPointerCapture(e.pointerId);
    game.pointer(lx(e));
    return;
  }
  if (!menuOpen && cur.p && screen.mode === "pet") run("love");
});
scr.addEventListener("pointermove", (e) => {
  if (game && (e.buttons || e.pointerType === "touch")) game.pointer(lx(e));
});
scr.addEventListener("pointerup", () => game && game.pointer(null));

// ---------- loading a pet ----------
let bootPick = 0; // the Chog picked for a first-time visitor, not by them
async function loadPet(id, push = true) {
  id = Number(id);
  if (!(id >= 1 && id <= 1969)) return toast("There are 1,969 Chogs. Try another number.");
  if (push !== "keepMsg") $("findMsg").textContent = "";
  if (game) return toast("Finish the round first, or tap Quit.");
  // remember the Chog this visitor picked, so the next visit opens on it (the random first pick doesn't count)
  if (id !== bootPick) store.set("pet.last", String(id));
  bootPick = 0;
  closeMenu();
  say("");
  cur.id = id;
  cur.p = persona(id);
  cur.view = null;
  cur.base = null;
  cur.cool = {};
  if (push) history.replaceState(null, "", `?chog=${nameNum(id)}`);
  const dev = document.querySelector(".device-wrap");
  if (dev && dev.getBoundingClientRect().top < -120) document.querySelector(".col-c").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  $("device").dataset.tier = cur.p.tier;
  paintCardStatic();
  document.querySelectorAll(".thumbs button").forEach((b) => b.classList.toggle("on", Number(b.dataset.id) === id));
  if (town) (town.cur = id), town.draw();
  paintPins();
  window.dispatchEvent(new CustomEvent("chogpet:pet", { detail: { id, name: nameNum(id), tier: cur.p.tier } }));
  paintTraits(id);
  const bgP = screen.setPet(id, cur.p).catch(() => null).then((r) => {
    if (cur.id === id) window.dispatchEvent(new CustomEvent("chogpet:petready", { detail: { id } }));
    return r;
  });
  try {
    const v = await api.pet(id);
    if (cur.id !== id) return;
    const rgb = await bgP;
    if (rgb) document.documentElement.style.setProperty("--glow", rgb.map((c) => Math.min(255, Math.round(c * 1.1))).join(","));
    const seen = Number(store.get(`pet.seen.${id}`)) || 0;
    applyView(v, true);
    readyOnce();
    paintSince(v, seen);
    const movedAt = v.movedAt || (!(v.history || []).length && v.owner && v.since > now() - 3 * 86400 ? v.since : 0);
    const key = `pet.seenMove.${id}.${movedAt}`;
    await introGone; // so the first line and sound aren't lost under the intro
    if (cur.id !== id) return;
    if (movedAt && now() - movedAt < 3 * 86400 && !store.get(key)) {
      store.set(key, "1");
      sfx.door();
      screen.play("moved").then(() => cur.id === id && say(pick(REACT.moved, id)));
    } else {
      greet();
    }
    maybeTour();
  } catch (e) {
    await bgP;
    readyOnce();
    toast("Couldn't reach the pet server. Showing it offline.");
  }
}
// first visit: a short spotlight tour (js/tour.js) right after the intro, then the pet asks for its first meal
// with the Feed button pulsing. Automated browsers skip it unless the intro ran or the URL says ?tour=1.
const introShown = document.documentElement.classList.contains("intro-boot");
const tourAsked = /[?&]tour=1/.test(location.search); // read now: loadPet rewrites the URL
function maybeTour() {
  if (maybeTour.ran || tourSeen()) return;
  if (navigator.webdriver && !introShown && !tourAsked) return;
  maybeTour.ran = true;
  setTimeout(() => startTour(), 900);
}
addEventListener("chogpet:tourdone", () => {
  const b = document.querySelectorAll(".ico")[0];
  if (!b || game || !cur.p) return;
  setSel(0);
  b.classList.add("coach");
  setTimeout(() => say("hi! wanna feed me? tap FEED"), 300);
  const off = () => b.classList.remove("coach");
  setTimeout(off, 9000);
  addEventListener("chogpet:act", off, { once: true });
});

function greet() {
  const s = simNow();
  if (!s) return;
  const m = moodOf(s);
  const v = cur.view;
  const mine = me.address && v && v.owner === me.address;
  // a pet that's fine talks about its home now and then; one in need says what it needs
  const home = v && v.owner && (m === "content" || m === "happy") && Math.random() < 0.5;
  setTimeout(() => cur.p && say(home ? ageLine(daysOf(v), mine) : lineFor(cur.p, m, Math.floor(Date.now() / 20000) + cur.id)), 700);
}
async function refresh() {
  if (!cur.id) return;
  try {
    const v = await api.pet(cur.id);
    if (v.id === cur.id) applyView(v);
  } catch {}
}
// the same 0/h/f/n/s/x code the town map uses
const moodCell = (v) => (v.state && v.state.away ? "x" : v.wellbeing < 25 ? "s" : v.wellbeing < 45 ? "n" : v.wellbeing < 70 ? "f" : "h");

function applyView(v, first = false) {
  cur.view = v;
  store.set(`pet.seen.${v.id}`, String(v.now));
  if (town) {
    // the square on the map follows the pet right away, so a rescue shows up on the town at once
    town.local(v.id, moodCell(v));
  }
  if (pinsGet().includes(v.id)) pinMoodSave(v.id, moodCell(v)), paintPins();
  cur.base = v.state;
  cur.skew = v.now - now();
  for (const [a, left] of Object.entries(v.cool || {})) cur.cool[a] = now() + left;
  screen.setState(simNow());
  if (screen.setAge) screen.setAge(daysOf(v));
  if (v.gifts) setGifts(v.id, v.gifts);
  paintMeters(simNow());
  paintCard();
  paintLog();
  paintCooldowns();
  paintWallet();
  if (v.welcome && me.address && v.owner === me.address) introGone.then(() => cur.id === v.id && welcomeHome(v));
}

// ---------- welcome home: the holder back after 6 h or more (the worker sends it once, only to them) ----------
function awayFor(s) {
  if (s < 86400) return `${Math.max(6, Math.floor(s / 3600))} hours`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "a day" : `${d} days`;
}
function welcomeHome(v) {
  const w = v.welcome;
  if (!w || document.querySelector(".wh")) return;
  const card = $("petCard");
  const list = (w.sitters || []).slice(0, 3);
  const el = document.createElement("div");
  el.className = "wh";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Welcome home");
  el.innerHTML = `<div class="wh-box"><div class="wh-t">Welcome home</div><div class="wh-s">${w.first ? `${esc(v.name)} since it moved in` : `You were away ${awayFor(v.now - w.from)}`}</div>${
    list.length
      ? `<div class="wh-h">Looked after it</div><ol class="wh-l">${list.map((s) => `<li><span>${esc(s.who)}</span><b>×${s.n}</b></li>`).join("")}</ol>`
      : `<div class="wh-q">Quiet while you were away.</div>`
  }${w.best ? `<div class="wh-b">Best sitter <b>${esc(w.best.who)}</b></div>` : ""}<div class="wh-k">tap or press any key</div></div>`;
  card.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  const close = (e) => {
    // a tap elsewhere only closes it once it has been on screen (a phone may not have scrolled to the card yet)
    if (e && e.type === "pointerdown" && !el.contains(e.target)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
    }
    removeEventListener("keydown", close, true);
    removeEventListener("pointerdown", close, true);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  };
  setTimeout(() => {
    addEventListener("keydown", close, true);
    addEventListener("pointerdown", close, true);
  }, 300);
  addEventListener("chogpet:pet", () => el.isConnected && close(), { once: true });
}

// ---------- right panel ----------
const locHour = (h) => {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
// what it needs right now, in two words or less each
const NEED = [["food", "food"], ["fun", "play"], ["clean", "bath"], ["energy", "sleep"]];
const NEED_IC = { food: "h_food", fun: "h_fun", clean: "h_clean", energy: "h_energy" };
function needKeys(s) {
  if (!s || s.away || s.asleep) return [];
  return NEED.filter(([k]) => (s[k] ?? 100) < 40).sort((a, b) => s[a[0]] - s[b[0]]).map(([k]) => k);
}
// what it needs as the meters' own small icons, never a sentence that gets cut
function needsHTML(s, keys) {
  if (!keys.length) return `<span class="st-need">${s.asleep ? "sleeping" : s.away ? "it ran away" : "all good"}</span>`;
  const words = keys.map((k) => NEED.find((x) => x[0] === k)[1]);
  return `<span class="st-need st-ics" role="img" aria-label="needs ${words.join(", ")}"><span class="st-nw" aria-hidden="true">needs</span>${keys.map((k) => `<i class="nd" data-ic="${NEED_IC[k]}"></i>`).join("")}${keys.length === 1 ? `<span class="st-nw" aria-hidden="true">${words[0]}</span>` : ""}</span>`;
}
// while a Chog loads, its card keeps its exact shape: the same rows with soft placeholders, so nothing below jumps
const SK_MOOD = `<div class="st-top"><span class="mood sk-shim sk-chip">&nbsp;</span><span class="st-need">&nbsp;</span></div><div class="st-wl"><span>Wellbeing</span><span class="st-bar"><i style="width:0"></i></span><b class="st-wb sk-txt">–</b></div>`;
const SK_HOME = `<div class="days sk-txt">–<small>days home</small></div><div class="home-l"><div class="age"><span class="pips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="nw sk-line sk-shim">&nbsp;</span></div><div class="owner sk-txt">with …</div></div>`;
const SK_MINI = ["Flame", "Cared", "Record"].map((k) => `<div class="mini"><b class="sk-txt">–</b><span>${k}</span></div>`).join("");
function paintCardStatic() {
  const id = cur.id, p = cur.p;
  $("pcThumb").src = thumb(id);
  softImgs($("petCard").querySelector(".pc-head"));
  $("pcName").textContent = nftName(id);
  $("pcSub").textContent = DATA.nm[String(id)] ? `#${nameNum(id)}` : "";
  const t = $("pcTier");
  t.textContent = p.tier;
  t.className = "tier " + p.tier;
  $("pcPersona").textContent = p.title;
  // quirks + its bedtime (in your clock) as one compact row of chips
  $("pcQuirks").innerHTML = quirks(p).map((q) => `<li>${esc(q)}</li>`).join("") + `<li class="q-bed">Sleeps ${locHour(p.sleep[0])}–${locHour(p.sleep[1])}</li>`;
  $("pcHome").innerHTML = SK_HOME;
  $("strip").innerHTML = `<b>${esc(nftName(id))}</b><span>${esc(p.title)}</span><span class="s-day sk-txt">day –</span><span class="mood sk-shim sk-chip">&nbsp;</span>`;
  $("since").hidden = true;
  $("pcMood").innerHTML = SK_MOOD;
  $("pcStick").innerHTML = "";
  $("pcStick").dataset.sig = "-";
  $("pcStickN").textContent = "";
  $("log").innerHTML = "";
  // nothing from the previous Chog may linger while this one loads
  $("pcMini").innerHTML = SK_MINI;
  $("pcRecent").innerHTML = "";
  $("logN").textContent = "";
  $("nameBtn").hidden = true;
}
function paintCard() {
  const v = cur.view;
  if (!v) return;
  const s = simNow();
  const m = moodOf(s);
  $("pcName").textContent = v.name;
  const num = DATA.nm[String(v.id)] ? `#${nameNum(v.id)} · ` : "";
  $("pcSub").textContent = v.name !== v.nftName ? v.nftName : num.replace(/ · $/, "");
  const mine = me.address && v.owner === me.address;
  const days = daysOf(v);
  const st = stageOf(days);
  const owner = /^0x[0-9a-f]{40}$/.test(v.owner || "") ? v.owner : "";
  const pips = [0, 1, 2, 3, 4].map((i) => `<i class="${i <= st.i ? "on" : ""}"></i>`).join("");
  // its bond with its holder (Friend, Best friend, Soulmate) as a small chip after the stage
  const tier = v.homeTier ? `<span class="htier" role="img" aria-label="Bond with its holder: ${esc(v.homeTier)}"><i data-ic="heartS"></i>${esc(v.homeTier)}</span>` : "";
  // sitters see who looks after it most (the holder gets that in Welcome home instead)
  const bs = v.bestSitter;
  const best = owner && !mine && bs ? `<div class="bsit${bs.you ? " you-best" : ""}">${bs.you ? "You're the best sitter" : `Best sitter <b>${esc(bs.who)}</b>`}</div>` : "";
  // age at home: the big number, its stage, and whose wallet it lives in (one small line)
  $("pcHome").innerHTML = owner
    ? `<div class="days">${days}<small>${days === 1 ? "day" : "days"} home</small></div><div class="home-l"><div class="age"><span class="pips" aria-hidden="true">${pips}</span><span class="nw">${esc(st.name)}</span>${tier}</div><div class="owner">with <a href="${EXPLORER + owner}" target="_blank" rel="noopener">${short(owner)}</a>${mine ? '<span class="you">you</span>' : ""}</div>${best}</div>`
    : `<span class="muted">Home unknown right now</span>`;
  for (const i of $("pcHome").querySelectorAll("i[data-ic]")) i.appendChild(toCanvas(i.dataset.ic, 2));
  $("strip").innerHTML = `<b>${esc(v.name)}</b><span>${esc(cur.p.title)}</span>${owner ? `<span class="s-day">day ${days}</span>` : ""}<span class="mood ${m}">${MOOD_LABEL[m] || m}</span>`;
  // mood + what it needs, and its overall wellbeing as one bar
  const wb = Math.max(0, Math.min(100, Math.round(v.wellbeing || 0)));
  const need = needKeys(s);
  const wcls = wb <= 25 ? "low" : wb <= 50 ? "mid" : "";
  $("pcMood").innerHTML = `<div class="st-top"><span class="mood ${m}">${MOOD_LABEL[m] || m}</span>${s.poop ? `<span class="mood stinky">${s.poop} poop${s.poop > 1 ? "s" : ""}</span>` : ""}${needsHTML(s, need)}</div><div class="st-wl"><span>Wellbeing</span><span class="st-bar ${wcls}" role="meter" aria-label="Wellbeing" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${wb}"><i style="width:${wb}%"></i></span><b class="st-wb">${wb}%</b></div>`;
  for (const i of $("pcMood").querySelectorAll("i.nd[data-ic]")) i.appendChild(toCanvas(i.dataset.ic, 2));
  $("nameBtn").hidden = !mine;
  paintStickers(v);
  const url = location.origin + `/?chog=${nameNum(v.id)}`;
  const text = mine
    ? `${v.name} has lived with me for ${days} day${days === 1 ? "" : "s"} (${st.name}). Today it's ${MOOD_LABEL[m] || m}. Come babysit it:`
    : `I just babysat ${v.name}, a ${cur.p.title}, on Chog Pet. It's ${MOOD_LABEL[m] || m} today. Your turn:`;
  $("xBtn").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  // past homes
  const past = v.history || [];
  $("pastPanel").hidden = !past.length;
  $("past").innerHTML = past
    .map((h) => `<div class="log-i"><span class="who">${esc(short(h.owner))}</span><span class="what">${h.name ? esc(h.name) + ", " : ""}${Math.max(0, Math.round((h.until - h.since) / 86400))} days</span><span class="when">${ago(h.until)}</span></div>`)
    .join("");
}
function logText(e) {
  const [a, b] = String(e.code).split(":");
  switch (e.a) {
    case "feed":
      return b === "treat" ? "gave it a $CHOG treat" : b === "return" ? "fed it and it came back home" : b === "yuck" ? `fed it ${FOODS[a] ? FOODS[a].name.toLowerCase() : a} (yuck)` : `fed it ${FOODS[a] ? FOODS[a].name.toLowerCase() : a}${b === "fav" ? " ★" : ""}`;
    case "play":
      return `played Candle Catch (${b})`;
    case "clean":
      return e.code === "bathhate" ? "gave it a bath (it hated it)" : "gave it a bath";
    case "lights":
      return e.code === "nap" ? "tucked it in" : e.code === "grumpy" ? "woke it up (grumpy)" : "woke it up";
    case "love":
      return e.code === "purr" ? "petted it in its sleep" : "petted it";
    case "name":
      return e.code === "-" ? "cleared its name" : `named it ${esc(e.code)}`;
    case "move":
      return "moved in. New home!";
    case "gift":
      return `gave it a ${ITEMS[e.code] ? ITEMS[e.code].name.toLowerCase() : "gift"}`;
  }
  return e.a;
}
function paintLog() {
  const v = cur.view;
  const log = (v && v.log) || [];
  $("logN").textContent = log.length ? String(log.length) : "";
  // pet tab: four numbers at a glance and the three latest visitors (tap to see them all)
  if (v) {
    // three numbers: the care flame (days in a row), how often it was cared for, the Candle Catch record
    const fl = v.flame || {};
    const tiles = [
      [fl.n ? (fl.today ? "Flame lit" : "Care today") : "No flame", (fl.n || 0) + "d", "fl" + (fl.n ? (fl.today ? "" : " warn") : " out")],
      ["Cared", String(v.care || 0), ""],
      ["Record", v.best ? String(v.best) : "–", ""],
    ];
    $("pcMini").innerHTML = tiles.map(([k, x, c]) => `<div class="mini ${c}"><b>${x}</b><span>${k}</span></div>`).join("");
    const flb = $("pcMini").querySelector(".fl b");
    if (flb) flb.prepend(toCanvas("flame", 2));
    $("pcRecent").innerHTML = log.length
      ? log.slice(0, 3).map((e) => `<div class="log-i"><span class="who">${e.who.replace(" (home)", "") === myLabel() ? "You" : esc(e.who.replace(" (home)", ""))}</span><span class="what">${logText(e)}</span><span class="when">${ago(e.t)}</span></div>`).join("") + (log.length > 3 ? `<button class="chip-btn more-log" type="button">All ${log.length} visitors</button>` : "")
      : "";
    const more = document.querySelector(".more-log");
    if (more) more.addEventListener("click", () => showTab("log"));
  }
  $("log").innerHTML = log.length
    ? log.map((e) => `<div class="log-i ${/\(home\)/.test(e.who) || e.a === "move" ? "home" : ""}"><span class="who">${e.who.replace(" (home)", "") === myLabel() ? "You" : esc(e.who.replace(" (home)", " · home"))}</span><span class="what">${logText(e)}</span><span class="when">${ago(e.t)}</span></div>`).join("")
    : `<div class="empty">No visitors yet. Feed it, play or give it a bath and you'll be the first name in its log.</div>`;
}
function paintSince(v, seen) {
  const el = $("since");
  const news = seen ? (v.log || []).filter((e) => e.t > seen && e.a !== "move") : [];
  if (!news.length) return (el.hidden = true);
  const who = new Set(news.map((e) => e.who.replace(" (home)", "")));
  const n = (a) => news.filter((e) => e.a === a).length;
  const bits = [["feed", "fed"], ["play", "played"], ["clean", "bathed"], ["lights", "tucked in"], ["love", "petted"]]
    .filter(([a]) => n(a))
    .map(([a, w]) => `${w} ${n(a)}×`);
  el.innerHTML = `<b>Since your last visit</b> ${who.size} sitter${who.size === 1 ? "" : "s"} came by: ${bits.join(", ")}.`;
  el.hidden = false;
}
// floating "+12" next to a bar when a stat moves
function deltas(a, b) {
  if (!a || !b) return;
  const rows = $("meters").children;
  ["food", "fun", "energy", "clean"].forEach((k, i) => {
    const d = Math.round(b[k] - a[k]);
    if (Math.abs(d) < 3 || !rows[i]) return;
    const el = document.createElement("span");
    el.className = "delta " + (d > 0 ? "up" : "down");
    el.textContent = (d > 0 ? "+" : "") + d;
    rows[i].appendChild(el);
    setTimeout(() => el.remove(), 1300);
  });
}

// sticker book + the care flame
function paintStickers(v) {
  const have = new Set(v.stickers || []);
  $("pcStickN").textContent = `${have.size}/${STICKERS.length}`;
  const box = $("pcStick");
  if (box.dataset.sig !== [...have].join()) {
    box.dataset.sig = [...have].join();
    box.innerHTML = "";
    for (const s of STICKERS) {
      const b = document.createElement("button");
      b.className = "stk" + (have.has(s.k) ? " got" : "");
      b.dataset.k = s.k;
      b.setAttribute("aria-label", `${s.name}${have.has(s.k) ? "" : " (not yet)"}: ${s.how}`);
      b.appendChild(toCanvas(s.icon, 2));
      b.addEventListener("click", () => toast(`${s.name}: ${s.how.toLowerCase()}.${have.has(s.k) ? " Got it!" : ""}`, 2600));
      box.appendChild(b);
    }
  }
}

// traits, with how many of the 1,969 share each one
let traitCount = null;
const pct = (n) => {
  const p = (n / 1969) * 100;
  return (p < 1 ? p.toFixed(1) : Math.round(p)) + "%";
};
function paintTraits(id) {
  if (!traitCount) {
    traitCount = DATA.k.map(() => new Map());
    for (const t of DATA.t) t.forEach((v, i) => traitCount[i].set(v, (traitCount[i].get(v) || 0) + 1));
  }
  const skip = new Set(["Form", "Tier", "Naked", "Side", "Base"]);
  const rows = DATA.k
    .map((k, i) => [k, DATA.t[id - 1][i], traitCount[i].get(DATA.t[id - 1][i]) || 0])
    .filter(([k, v]) => !skip.has(k) && v && !/^(none|no)$/i.test(v));
  const rarest = rows.reduce((a, r) => (!a || r[2] < a[2] ? r : a), null);
  $("pcRare").textContent = rarest ? `· rarest: ${rarest[1]} (${pct(rarest[2])})` : "";
  $("pcTraitList").innerHTML = rows
    .map(([k, v, n]) => `<li><span class="tk">${esc(k)}</span><span class="tv">${esc(v)}</span><span class="tp${n <= 40 ? " rare" : ""}">${pct(n)}</span></li>`)
    .join("");
  // pet tab: its rarest traits, so the card reads as this Chog's ID at a glance
  $("pcTraitsMini").innerHTML = `<div class="pt-h">Rarest traits</div>` + [...rows].sort((a, b) => a[2] - b[2]).slice(0, 3)
    .map(([k, v, n]) => `<div class="pt-i"><span class="tk">${esc(k)}</span><span class="tv">${esc(v)}</span><span class="tp${n <= 40 ? " rare" : ""}">${pct(n)}</span></div>`).join("");
}

// ---------- left panel ----------
function thumbs(ids, note) {
  $("results").innerHTML = ids
    .slice(0, 30)
    .map((id) => `<button data-id="${id}" class="${id === cur.id ? "on" : ""}"><img src="${thumb(id)}" alt="${esc(nftName(id))}" loading="lazy" width="48" height="48"/></button>`)
    .join("");
  softImgs($("results"));
  $("findMsg").textContent = note || "";
  $("results").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => loadPet(b.dataset.id, "keepMsg")));
}
async function ensureLine() {
  if (LINE) return LINE;
  const d = await api.line();
  LINE = new Map();
  for (const [id, owner] of d.tokens) {
    const o = (owner || "").toLowerCase();
    if (!LINE.has(o)) LINE.set(o, []);
    LINE.get(o).push(id);
  }
  return LINE;
}
async function showWallet(addr, mine, autoload = true) {
  $("findMsg").textContent = "Looking up…";
  try {
    const l = await ensureLine();
    const ids = l.get(addr.toLowerCase()) || [];
    if (!ids.length) return thumbs([], mine ? "No Chogs in this wallet. You can still babysit any Chog." : "This wallet holds no Chogs right now.");
    thumbs(ids, `${mine ? "Your" : short(addr)} Chogs: ${ids.length}${ids.length > 30 ? " (first 30)" : ""}`);
    if (autoload && (mine || ids.length === 1)) loadPet(ids[0], "keepMsg");
  } catch {
    $("findMsg").textContent = "Couldn't load owners right now.";
  }
}
$("findForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("findIn").value.trim();
  if (!q) return;
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return showWallet(q, false);
  const tok = q.match(/^(?:t|token)\s*#?\s*(\d+)$/i);
  if (tok) return loadPet(tok[1]);
  const n = q.match(/^#?\s*(\d{1,4})$/);
  if (n) {
    const id = idFromName(Number(n[1]));
    if (!id) return toast("Chog numbers go from 1 to 1,969.");
    thumbs([id], "");
    return loadPet(id, "keepMsg");
  }
  const named = Object.entries(DATA.nm).find(([, v]) => v.toLowerCase() === q.toLowerCase());
  if (named) return loadPet(named[0]);
  toast("Type the # from its name (like 953), a wallet 0x…, or token 1462.");
});
$("randomBtn").addEventListener("click", () => {
  sfx.unlock();
  $("results").innerHTML = "";
  $("findMsg").textContent = "";
  loadPet(1 + Math.floor(Math.random() * 1969));
});
// pet card tabs: Pet / Stickers / Visitors
document.querySelector(".side-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  sfx.click && sfx.click();
  showTab(b.dataset.tab);
});
function showTab(k) {
  document.querySelectorAll(".side-tabs button").forEach((x) => { x.classList.toggle("on", x.dataset.tab === k); x.setAttribute("aria-selected", String(x.dataset.tab === k)); });
  document.querySelectorAll("#petCard .tabp").forEach((p) => (p.hidden = p.dataset.tab !== k));
}
$("mineBtn").addEventListener("click", () => me.address && showWallet(me.address, true));

async function paintTown() {
  if (!town) return;
  try {
    town.set(await api.town());
    paintPins();
    pinsWhileAway();
  } catch {
    toast("Couldn't read the town right now.");
  }
}

// ---------- My sitters: up to 3 pinned Chogs (localStorage "pet.pins"), faces in the header / by the device ----------
const PIN_MAX = 3;
const PIN_RANK = { h: 0, f: 1, w: 1, 0: 1, n: 2, s: 3, x: 4 };
const PIN_COL = { h: "good", f: "good", n: "mid", s: "bad", x: "bad", w: "", 0: "" };
function readJSON(k, d) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v == null ? d : v;
  } catch {
    return d;
  }
}
function writeJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}
function pinsGet() {
  const a = readJSON("pet.pins", []);
  return Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1969))].slice(0, PIN_MAX) : [];
}
function pinMoodSave(id, c) {
  const m = readJSON("pet.pins.mood", {});
  if (!m || typeof m !== "object" || Array.isArray(m)) return;
  m[id] = c;
  writeJSON("pet.pins.mood", m);
}
const pinCell = (id) => (town && town.ready ? town.status(id) : "");
function paintPins() {
  if (!DATA) return;
  const ids = pinsGet();
  for (const box of [$("pinsTop"), $("pinsStrip")]) {
    if (!box) continue;
    box.hidden = !ids.length;
    const sig = ids.map((id) => id + pinCell(id) + (id === cur.id ? "*" : "")).join(",");
    if (box.dataset.sig === sig) continue;
    box.dataset.sig = sig;
    box.innerHTML = ids
      .map((id) => {
        const c = pinCell(id);
        const word = c ? TOWN_LABEL[c] || "" : "";
        return `<button type="button" class="pin${id === cur.id ? " on" : ""}" data-id="${id}" aria-label="#${nameNum(id)}${word ? ", " + word : ""}"${id === cur.id ? ' aria-current="true"' : ""}><img src="${thumb(id)}" alt="" width="32" height="32" /><i class="pd ${PIN_COL[c] || ""}" aria-hidden="true"></i></button>`;
      })
      .join("");
  }
  const b = $("pinBtn");
  if (b && cur.id) {
    const on = ids.includes(cur.id);
    if (!b.firstChild) b.appendChild(toCanvas("heart", 2));
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? `Unpin #${nameNum(cur.id)}` : `Pin #${nameNum(cur.id)} to my sitters`);
  }
}
function togglePin() {
  if (!cur.id) return;
  let ids = pinsGet();
  if (ids.includes(cur.id)) ids = ids.filter((x) => x !== cur.id);
  else {
    if (ids.length >= PIN_MAX) return toast(`You can pin ${PIN_MAX}. Unpin one first.`);
    ids.push(cur.id);
    const c = cur.view ? moodCell(cur.view) : pinCell(cur.id);
    if (c) pinMoodSave(cur.id, c);
  }
  writeJSON("pet.pins", ids);
  paintPins();
}
$("pinBtn").addEventListener("click", togglePin);
for (const box of [$("pinsTop"), $("pinsStrip")])
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) loadPet(Number(b.dataset.id));
  });
// back after a while: one quiet line if a pinned Chog got worse since this browser last saw it
const AWAY_WORD = { food: "got hungry", fun: "got bored", clean: "got dirty", energy: "got sleepy" };
async function pinsWhileAway() {
  if (pinsWhileAway.done || !town || !town.ready) return;
  pinsWhileAway.done = true;
  const ids = pinsGet();
  const was = readJSON("pet.pins.mood", {});
  if (!ids.length || !was || typeof was !== "object") return;
  const rank = (c) => PIN_RANK[c] ?? 1;
  const worse = ids.find((id) => id !== cur.id && was[id] != null && rank(town.status(id)) > rank(was[id]) && rank(town.status(id)) >= 2);
  for (const id of ids) if (id !== cur.id) pinMoodSave(id, town.status(id));
  if (!worse) return;
  const c = town.status(worse);
  let what = c === "x" ? "ran off" : c === "s" ? "got sad" : "needs you";
  if (c !== "x") {
    try {
      const k = needKeys((await api.pet(worse)).state)[0];
      if (k) what = AWAY_WORD[k];
    } catch {}
  }
  setTimeout(() => toast(`#${nameNum(worse)} ${what} while you were away`, 4200), 1200);
}

// ---------- the collection (bottom of the page) ----------
const fmt = (x, d = 0) => (x == null ? "-" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d }));
const usd = (x) => (x == null ? "-" : x >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? "$" + (x / 1e3).toFixed(1) + "K" : x < 0.01 ? "$" + x.toPrecision(3) : "$" + x.toFixed(2));
async function paintCollection() {
  let toks;
  try {
    toks = (await api.line()).tokens; // [id, owner, since, moves]
  } catch {
    $("tiles").innerHTML = `<div class="empty">Couldn't read the chain right now.</div>`;
    return;
  }
  const t = now();
  const byOwner = new Map();
  for (const [id, o, since] of toks) {
    if (!o || /^0x0{40}$/.test(o)) continue;
    if (!byOwner.has(o)) byOwner.set(o, []);
    byOwner.get(o).push([id, since]);
  }
  const holds = toks.map(([, , s]) => (t - s) / 86400).sort((a, b) => a - b);
  const median = holds[Math.floor(holds.length / 2)] || 0;
  const week = toks.filter(([, , s, mv]) => mv > 0 && s > t - 7 * 86400);
  const single = [...byOwner.values()].filter((l) => l.length === 1).length;
  const tiles = [
    ["Holders", fmt(byOwner.size), `${fmt(single)} of them hold just one`],
    ["Typical hold", `${Math.floor(median)} days`, "half the Chogs have been home longer"],
    ["New homes", fmt(week.length), "Chogs that changed wallets this week"],
  ];
  $("tiles").innerHTML =
    tiles.map(([k, v, s]) => `<div class="tile"><span class="t-k">${k}</span><b class="t-v">${v}</b><span class="t-s">${s}</span></div>`).join("") +
    `<div class="tile" id="tMkt"><span class="t-k">Supply</span><b class="t-v">1,969</b><span class="t-s">Chog Genesis on Monad</span></div><div class="tile" id="tChog"><span class="t-k">$CHOG</span><b class="t-v">…</b><span class="t-s"></span></div>`;
  api.stats().then((s) => {
    if (s.floor != null) $("tMkt").innerHTML = `<span class="t-k">Floor</span><b class="t-v">${fmt(s.floor, 1)} <small>${esc(s.floorSym || "MON")}</small></b><span class="t-s">${s.sales1d != null ? fmt(s.sales1d) + " sales today" : "on OpenSea"}</span>`;
    $("tChog").innerHTML = s.chogUsd != null ? `<span class="t-k">$CHOG</span><b class="t-v">${usd(s.chogUsd)}</b><span class="t-s">mcap ${usd(s.chogMcap)} · 24h vol ${usd(s.chogVol)}</span>` : `<span class="t-k">$CHOG</span><b class="t-v">-</b><span class="t-s">price unavailable right now</span>`;
  }).catch(() => {});
  // Hall of Lifers: the longest single hold first, then how many Chogs have been home that long
  const lifers = [...byOwner.entries()]
    .map(([o, l]) => {
      const first = Math.min(...l.map(([, s]) => s));
      return { o, n: l.length, days: Math.floor((t - first) / 86400), id: l.find(([, s]) => s === first)[0], long: l.filter(([, s]) => s - first < 86400).length };
    })
    .sort((a, b) => b.days - a.days || b.long - a.long)
    .slice(0, 8);
  $("lifers").innerHTML = lifers
    .map((w, i) => `<button class="row" data-o="${w.o}"><span class="r-n">${i + 1}</span><img src="${thumb(w.id)}" alt="" loading="lazy"/><span class="r-main"><span class="r-t">${short(w.o)}</span><span class="r-s">${w.n} Chog${w.n > 1 ? "s" : ""}, ${w.long} home since day one</span></span><span class="r-v">${w.days}d</span></button>`)
    .join("");
  document.querySelectorAll("#lifers .row").forEach((r) =>
    r.addEventListener("click", () => {
      showWallet(r.dataset.o, false);
      document.querySelector(".find").scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
  $("moves").innerHTML =
    week
      .sort((a, b) => b[2] - a[2])
      .slice(0, 8)
      .map(([id, o, s, mv]) => `<button class="row" data-id="${id}"><img src="${thumb(id)}" alt="" loading="lazy"/><span class="r-main"><span class="r-t">${esc(nftName(id))}</span><span class="r-s">to ${short(o)}${mv > 1 ? ` · ${mv} moves` : " · first move"}</span></span><span class="r-w">${ago(s)}</span></button>`)
      .join("") || `<div class="empty">No moves this week.</div>`;
  document.querySelectorAll("#moves .row").forEach((r) => r.addEventListener("click", () => loadPet(r.dataset.id)));
}
async function paintBoard() {
  try {
    const b = await api.board();
    const recs = b.records.slice(0, 3);
    $("records").innerHTML = recs.length
      ? recs.map((p, i) => `<button class="row${p.id === cur.id ? " cur" : ""}" data-id="${p.id}"><span class="r-n">${i + 1}</span><img src="${thumb(p.id)}" alt="" loading="lazy"/><span class="r-main"><span class="r-t">${esc(p.name)}</span><span class="r-s">by ${esc(p.bestBy)}</span></span><span class="r-v">${p.best}</span></button>`).join("")
      : `<div class="empty">No records yet. Score 15 or more in Candle Catch and it's yours.</div><button class="chip-btn" id="playFirst">Play Candle Catch</button>`;
    document.querySelectorAll("#records .row").forEach((r) => r.addEventListener("click", () => loadPet(r.dataset.id)));
    // live feed: the latest care anywhere in town
    const live = (b.recent || []).slice(0, Math.max(4, 7 - recs.length)); // live + records ≈ the 8 rows of the other two columns
    $("live").innerHTML = live.length
      ? live.map((e) => `<button class="row" data-id="${e.pet}"><img src="${thumb(e.pet)}" alt="" loading="lazy"/><span class="r-main"><span class="r-t">${esc(e.who.replace(" (home)", ""))}</span><span class="r-s">${logText(e).replace(/it/, esc(e.name || "a Chog"))}</span></span><span class="r-v when">${ago(e.t)}</span></button>`).join("")
      : `<div class="empty">Quiet right now. Be the first.</div>`;
    document.querySelectorAll("#live .row").forEach((r) => r.addEventListener("click", () => loadPet(r.dataset.id)));
    const pf = $("playFirst");
    if (pf) pf.addEventListener("click", () => (setSel(1), run("play")));
    return b;
  } catch {
    $("records").innerHTML = `<div class="empty">Couldn't load right now.</div>`;
    return null;
  }
}

// ---------- wallet ----------
function paintWallet() {
  const b = $("walletBtn");
  if (me.token && me.address) {
    b.textContent = short(me.address);
    b.classList.add("on");
    $("walAddr").textContent = short(me.address) + (me.holder ? " · $CHOG holder" : "");
    $("mineBtn").hidden = false;
  } else {
    b.textContent = "Sign in"; // a wallet, X, email or Google (Privy)
    b.classList.remove("on");
    $("mineBtn").hidden = true;
    walMenu(false);
  }
}
// signed in: the address button opens a small menu, like any dapp
function walMenu(open) {
  $("walMenu").hidden = !open;
  $("walletBtn").setAttribute("aria-expanded", String(open));
}
document.addEventListener("click", (e) => {
  if (!$("walMenu").hidden && !e.target.closest(".wal")) walMenu(false);
});
document.addEventListener("keydown", (e) => e.key === "Escape" && walMenu(false));
$("walMine").addEventListener("click", () => {
  walMenu(false);
  showWallet(me.address, true);
  document.querySelector(".find").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("walCopy").addEventListener("click", async () => {
  walMenu(false);
  try {
    await navigator.clipboard.writeText(me.address);
    toast("Address copied.");
  } catch {
    toast(me.address, 5000);
  }
});
$("walOut").addEventListener("click", () => {
  walMenu(false);
  signOut();
  paintWallet();
  refresh();
  toast("Disconnected.");
});
$("walletBtn").addEventListener("click", async () => {
  sfx.unlock();
  if (me.token) return walMenu($("walMenu").hidden);
  if (!(await hasWallet())) return toast("No wallet found in this browser. You don't need one: anyone can babysit any Chog.", 4200);
  finishSignIn(false);
});
async function finishSignIn(resume) {
  try {
    await signIn(resume);
    paintWallet();
    toast(me.holder ? "Signed in. You hold $CHOG: the treat is unlocked." : "Signed in.");
    await refresh();
    showWallet(me.address, true);
  } catch (e) {
    toast(e && e.code === 4001 ? "Signature cancelled." : (e && e.message) || "Sign-in failed.");
  }
}
if (backFromSocial && !me.token) finishSignIn(true);

// ---------- share ----------
async function share() {
  if (!cur.view) return;
  sfx.click();
  const v = cur.view;
  const s = simNow();
  const days = daysOf(v);
  try {
    const c = await makeCard({ screenCanvas: screen.snapshot({ clean: true }), pet: { ...v, state: s, mood: moodOf(s) }, persona: cur.p, days, ownerView: me.address && v.owner === me.address, bg: screen.bgRGB });
    const fname = `chog-pet-${nameNum(v.id)}.png`;
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = blob && new File([blob], fname, { type: "image/png" });
    if (file && matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${v.name} on Chog Pet`, url: location.origin + `/?chog=${nameNum(v.id)}` });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.download = fname;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Card saved. Post it with the X button.");
  } catch {
    toast("Couldn't make the card.");
  }
}
$("shareBtn").addEventListener("click", share);
$("nameBtn").addEventListener("click", () => {
  $("nameIn").value = cur.view && cur.view.name !== cur.view.nftName ? cur.view.name : "";
  $("nameDlg").showModal();
});
$("nameDlg").addEventListener("close", async () => {
  if ($("nameDlg").returnValue !== "ok") return;
  try {
    const v = await api.name(cur.id, $("nameIn").value);
    applyView(v);
    sfx.happy();
    screen.play("happy");
    say(v.name !== v.nftName ? `i'm ${v.name}!` : "ok, no name");
  } catch (e) {
    toast(e.message || "Couldn't save the name.");
  }
});
function paintMute() {
  $("mute").replaceChildren(toCanvas(sfx.muted ? "spkOff" : "spk", 2, sfx.muted ? null : "#efe8ff"));
  $("mute").classList.toggle("off", sfx.muted);
  $("mute").setAttribute("aria-pressed", String(sfx.muted));
}
$("mute").addEventListener("click", () => {
  sfx.setMuted(!sfx.muted);
  paintMute();
  if (!sfx.muted) sfx.on();
  toast(sfx.muted ? "Sound off" : "Sound on", 1200);
});
paintMute();
$("helpBtn").addEventListener("click", () => {
  sfx.click();
  if (game) return toast("Finish the round first, or tap Quit.");
  closeMenu();
  startTour();
});
$("randomBtn").prepend(toCanvas("dice", 2));

// ---------- clock ----------
setInterval(() => {
  if (!cur.p || !cur.base) return;
  const s = simNow();
  const h = new Date().getHours();
  screen.night = h >= 21 || h < 6;
  if (!game) screen.setState(s);
  paintMeters(s);
  paintCooldowns();
  if (Date.now() > chatterAt && !game && !menuOpen && !screen.anim && screen.mode !== "moved") {
    const m = moodOf(s);
    say(lineFor(cur.p, m, Math.floor(Math.random() * 997)), 3400);
  }
}, 1000);
setInterval(() => cur.view && !game && !document.hidden && paintCard(), 5000);
setInterval(() => !game && !document.hidden && refresh(), 30000);
setInterval(() => !document.hidden && (paintBoard(), paintTown()), 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && cur.id && !game) refresh(), paintBoard();
});

// ---------- boot ----------
// the intro overlay (tap the egg to wake your Chog) waits for the first pet to be ready
let introReady = () => {};
let introGone = Promise.resolve();
const readyOnce = () => { introReady(); introReady = () => {}; };

(async function boot() {
  introGone = startIntro({ ready: new Promise((r) => (introReady = r)) });
  // pinned faces keep their row from the first frame (filled once the names load), so nothing below moves
  if (pinsGet().length) $("pinsTop").hidden = $("pinsStrip").hidden = false;
  if (new URLSearchParams(location.search).has("debug")) window.__pet = { screen, cur, simNow, react, send, loadPet, applyView, say };
  buildIcons();
  buildMeters();
  paintWallet();
  for (let i = 0; i < 3 && !DATA; i++) {
    try {
      const r = await fetch("/data/chogs.json");
      if (r.ok) DATA = await r.json();
    } catch {}
    if (!DATA) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  if (!DATA) {
    readyOnce();
    $("pcName").textContent = "Offline";
    $("pcSub").textContent = "Couldn't load the Chogs. Reload the page.";
    return toast("Couldn't load the Chogs. Check your connection and reload.", 8000);
  }
  const q = new URLSearchParams(location.search);
  // ?chog= is the number in the NFT name (same as Chog Line); ?token= is the raw token id
  let id = q.get("chog") ? idFromName(Number(q.get("chog"))) : Number(q.get("token")) || 0;
  if (!(id >= 1 && id <= 1969)) id = 0;
  if (!id && (q.get("chog") || q.get("token"))) setTimeout(() => toast("No Chog with that number. Here's one that needs a sitter.", 4200), 600);
  // Chogtown: the mood bar, four crowds (need help / new homes / happy / not met) and their faces, filling the column
  town = new Town({ bar: $("townBar"), tabs: $("townTabs"), grid: $("townGrid"), more: $("townMore") }, { onPick: (id) => loadPet(id), nameOf: (id) => "#" + nameNum(id), thumbOf: thumb });
  // the grid loads more faces by itself as it's scrolled to the end
  $("townScroll").addEventListener("scroll", (e) => {
    const el = e.currentTarget;
    if (!$("townMore").hidden && el.scrollTop + el.clientHeight > el.scrollHeight - 80) $("townMore").click();
  }, { passive: true });
  paintPins();
  const townReady = paintTown();
  paintCollection();
  window.addEventListener("chogpet:open", async (e) => {
    const t = Number(e.detail && e.detail.id);
    if (!(t >= 1 && t <= 1969)) return;
    await loadPet(t);
    // a quest can say which button it's about: select it and make it pulse for a few seconds
    const h = e.detail.hint;
    if (h >= 0 && h < ACTIONS.length) {
      setSel(h);
      const b = document.querySelectorAll(".ico")[h];
      b.classList.add("coach");
      setTimeout(() => b.classList.remove("coach"), 5000);
      document.querySelector(".device-wrap").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    }
  });
  const board = paintBoard();
  // first Chog: the link's > the last one this visitor picked > one of their own (signed in) > a random one that's home
  const urlPick = !!id;
  const last = Number(store.get("pet.last")) || 0;
  if (!id && last >= 1 && last <= 1969) id = last;
  // the last one wandered off meanwhile: open on one that's home instead of an empty room
  if (id && !urlPick) {
    await Promise.race([townReady, new Promise((r) => setTimeout(r, 1500))]);
    if (town.status(id) === "x") id = 0;
  }
  if (!id) {
    await Promise.race([townReady, new Promise((r) => setTimeout(r, 1500))]);
    for (let i = 0; i < 40 && !id; i++) {
      const r = 1 + Math.floor(Math.random() * 1969);
      if (town.status(r) !== "x" || i === 39) id = r;
    }
    bootPick = id;
  }
  loadPet(id);
  if (me.token) {
    api.meCheck().then((r) => { me.holder = !!r.holder; }).catch((e) => { if (e.status === 401) { signOut(); paintWallet(); } });
    // a holder with nothing picked yet opens on their own Chog
    showWallet(me.address, true, !urlPick && !last).catch(() => {});
  }
})();
