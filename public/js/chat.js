// Chog Pet town chat: one shared room for everyone on the site. A pixel button in the header (next to the
// Candles pill) with an unread count. On desktop (>= 1280 wide) the chat is docked at the bottom of the right
// column, always there; below that it's a small panel under the button (a bottom sheet on phones).
// Polls /api/chat?after=<id>: docked + on screen 10 s (20 s once the room has been quiet for 2 min, 30 s when you
// haven't touched the page for 3 min), pop-up open 8 s / 20 s, otherwise 120 s, never while the tab is hidden.
// Names are given by the server; "#953" in a message opens that Chog.
import { me, store } from "./api.js";
import { sitterName } from "./persona.js";

const MAX = 140;
const SUPPLY = 1969;
const OPEN_MS = 8000;
const DOCK_MS = 10000;
const QUIET_MS = 20000;
const AWAY_MS = 30000; // docked, but nobody has touched the page for a while
const IDLE_MS = 120000; // closed / off screen: just the unread badge, cheap on the Workers free plan
let active = Date.now(); // last time something happened in the room (or you opened / typed)
let touched = Date.now(); // last time you did anything on the page
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => (touched = Date.now()), { capture: true, passive: true });
const openMs = () => (docked && Date.now() - touched > 180000 ? AWAY_MS : Date.now() - active > 120000 ? QUIET_MS : docked ? DOCK_MS : OPEN_MS);
const root = document.getElementById("chatRoot");

// ---------- pixel icons (one rect per pixel) ----------
const PAL = { X: "#ddd7fe", V: "#6e54ff", Y: "#ffd84d", O: "#ffae45", P: "#ff8ee4", W: "#ffffff", K: "#2b2152", L: "#c9bfff", D: "#8a76ff", C: "#85e6ff" };
const ART = {
  bubble: ["..VVVVVVVV..", ".VXXXXXXXXV.", "VXXXXXXXXXXV", "VXXKXXKXXKXV", "VXXXXXXXXXXV", ".VXXXXXXXXV.", "..VVXVVVVV..", "...VXV......", "....V......."],
  wave: ["....Y.Y..", "..Y.Y.Y..", "..Y.Y.Y.Y", "..YYYYY.Y", "Y.YYYYYYY", "YYYYYYYYO", ".YYYYYYYO", "..YYYYYO.", "...OOOO.."],
  heart: [".PP...PP.", "PWPP.PPPP", "PWPPPPPPP", "PPPPPPPPP", ".PPPPPPP.", "..PPPPP..", "...PPP...", "....P...."],
  candle: ["...Y...", "..YY...", "..YOY..", "..YOY..", "...K...", "..LLL..", "..LWL..", "..LLL..", "..LLL..", ".DDDDD."],
  star: ["....Y....", "....Y....", "...YYY...", "YYYYWYYYY", ".YYYYYYY.", "..YYYYY..", "..YY.YY..", ".YO...OY.", ".O.....O."],
  send: ["..X.....", "..XX....", "..XXX...", "..XXXX..", "..XXX...", "..XX....", "..X....."],
};
function px(name, size) {
  const g = ART[name];
  const w = g[0].length, h = g.length;
  let r = "";
  g.forEach((row, y) => [...row].forEach((c, x) => { if (PAL[c]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[c]}"/>`; }));
  const s = size || 2;
  return `<svg class="cx-px" viewBox="0 0 ${w} ${h}" width="${w * s}" height="${h * s}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${r}</svg>`;
}
const EMOTES = [
  ["wave", "Wave"],
  ["heart", "Love"],
  ["candle", "Candle"],
  ["star", "Star"],
];
const EMO = new Set(EMOTES.map((e) => e[0]));

// ---------- helpers ----------
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
// "#953" is the number in the NFT name; the token id is ((n - 1460) mod 1969), with 0 meaning 1969
const tokenOf = (n) => ((((n - 1460) % SUPPLY) + SUPPLY) % SUPPLY) || SUPPLY;
const numOf = (id) => ((id + 1459) % SUPPLY) + 1;
const COLORS = ["#85e6ff", "#ff8ee4", "#ffae45", "#ffd84d", "#a594ff", "#7cf0b8", "#ff9f8e", "#c8f07c"];
const colorOf = (u) => COLORS[parseInt(String(u || "0").slice(0, 4), 16) % COLORS.length] || COLORS[0];
const LINKY = /[a-z][a-z0-9+.-]*:\/\/|\bwww\s*\.|\b[a-z0-9-]{2,}\.(?:com|net|org|io|xyz|gg|app|fun|ly|ru|dev|eth|me)\b|(^|[^\w])@\w{2,}|0x[0-9a-f]{6,}/i;
let skew = 0; // server clock minus ours, seconds
const nowS = () => Math.floor(Date.now() / 1000) + skew;
function ago(t) {
  const d = Math.max(0, nowS() - t);
  if (d < 45) return "now";
  if (d < 3600) return Math.round(d / 60) + "m";
  if (d < 86400) return Math.round(d / 3600) + "h";
  return Math.round(d / 86400) + "d";
}
const myName = () => (me.token && me.address ? me.address.slice(0, 6) + "…" + me.address.slice(-4) : sitterName(me.anon));
let myU = "";
async function computeU() {
  const key = me.token && me.address ? me.address.toLowerCase() : "anon:" + me.anon;
  try {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("chat:" + key));
    myU = [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 8);
  } catch {
    myU = "";
  }
}

// the Chog on screen: main.js says so with "chogpet:pet"; before that, the URL
let viewing = 0;
addEventListener("chogpet:pet", (e) => { viewing = Number(e.detail && e.detail.id) || 0; paintTag(); });
function currentPet() {
  if (viewing) return viewing;
  const q = new URLSearchParams(location.search);
  const t = Number(q.get("token")), c = Number(q.get("chog"));
  if (t >= 1 && t <= SUPPLY) return t;
  if (c >= 1 && c <= SUPPLY) return tokenOf(c);
  return 0;
}

// ---------- state ----------
let fetched = false; // until the first answer the list stays an empty box (no "quiet" flash before the messages)
let msgs = []; // {i,t,n,x,p,pn,k,b,u, pending?, failed?}
let last = 0;
let seen = Number(store.get("pet.chat.seen")) || 0;
let open = false;
let timer = 0;
let busy = false;
let tagOn = false;
let waitUntil = 0;
let docked = false; // desktop: the panel lives in the right column, always open
let onScreen = false; // docked panel is (at least partly) in the viewport
const live = () => open || (docked && onScreen); // messages are being looked at

// ---------- DOM ----------
const btn = el("button", "cx-btn", `<span class="cx-btn-ic">${px("bubble", 2)}</span><span class="cx-btn-t">Chat</span><span class="cx-badge" hidden>0</span>`);
btn.type = "button";
btn.setAttribute("aria-expanded", "false");
btn.setAttribute("aria-controls", "cxPanel");
btn.setAttribute("aria-label", "Town chat");
const badge = btn.querySelector(".cx-badge");

const panel = el("section", "cx-panel");
panel.id = "cxPanel";
panel.hidden = true;
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-modal", "false");
panel.setAttribute("aria-labelledby", "cxTitle");
panel.innerHTML = `
  <header class="cx-head">
    <span class="cx-head-ic">${px("bubble", 2)}</span>
    <div class="cx-head-t"><h2 id="cxTitle">Town chat</h2><p class="cx-sub">Everyone on Chog Pet · be kind</p></div>
    <button type="button" class="cx-x" aria-label="Close chat"><span aria-hidden="true">×</span></button>
  </header>
  <div class="cx-list" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages" tabindex="0"></div>
  <div class="cx-new" hidden><button type="button" class="cx-new-b">New messages ↓</button></div>
  <form class="cx-form" autocomplete="off">
    <div class="cx-tools">
      <div class="cx-emotes" role="group" aria-label="Quick emotes">${EMOTES.map(([k, l]) => `<button type="button" class="cx-emo" data-e="${k}" aria-label="Send ${l}">${px(k, 2)}</button>`).join("")}</div>
      <button type="button" class="cx-tag" aria-pressed="false" hidden></button>
    </div>
    <div class="cx-row">
      <input class="cx-in" maxlength="${MAX + 20}" placeholder="Say something nice" aria-label="Message" enterkeyhint="send" />
      <button type="submit" class="cx-send" aria-label="Send">${px("send", 2)}</button>
    </div>
    <div class="cx-foot"><span class="cx-as"></span><span class="cx-err" role="alert"></span><span class="cx-count" aria-hidden="true">0/${MAX}</span></div>
  </form>`;
const list = panel.querySelector(".cx-list");
const form = panel.querySelector(".cx-form");
const input = panel.querySelector(".cx-in");
const sendB = panel.querySelector(".cx-send");
const count = panel.querySelector(".cx-count");
const err = panel.querySelector(".cx-err");
const asEl = panel.querySelector(".cx-as");
const tagB = panel.querySelector(".cx-tag");
const newBar = panel.querySelector(".cx-new");

// the button lives in the header row, before the Candles pill, so it never covers a panel, a quest row or a toast;
// the panel stays in #chatRoot (fixed, on top of everything)
const headSlot = document.querySelector(".top-r");
if (root) {
  root.classList.add("cx-root");
  root.append(panel);
  if (headSlot) {
    btn.classList.add("cx-in-head");
    root.classList.add("cx-head-mode");
    const pillAt = document.getElementById("candleRoot");
    headSlot.insertBefore(btn, pillAt && pillAt.parentNode === headSlot ? pillAt : headSlot.firstChild);
  } else root.prepend(btn);
}
// desktop: hang the panel under the button (or at the top right once the header has scrolled away)
function place() {
  if (docked) return;
  if (!open || matchMedia("(max-width: 640px)").matches) return panel.style.removeProperty("--cx-top"), panel.style.removeProperty("--cx-right");
  const r = btn.getBoundingClientRect();
  const top = r.bottom > 0 && r.height ? Math.round(r.bottom + 12) : 16;
  const right = r.height ? Math.max(16, Math.round(innerWidth - r.right)) : 16;
  panel.style.setProperty("--cx-top", top + "px");
  panel.style.setProperty("--cx-right", right + "px");
}
addEventListener("resize", () => open && place(), { passive: true });

// ---------- rendering ----------
function textNodes(x, into) {
  // emote codes become pixel icons; "#953" becomes a button that opens that Chog
  const onlyEmo = /^(?:\s*:(wave|heart|candle|star):\s*)+$/.test(x);
  const re = /:(wave|heart|candle|star):|#(\d{1,4})\b/g;
  let at = 0, m;
  while ((m = re.exec(x))) {
    if (m.index > at) into.append(document.createTextNode(x.slice(at, m.index)));
    if (m[1] && EMO.has(m[1])) {
      const s = el("span", "cx-emo-i" + (onlyEmo ? " big" : ""), px(m[1], onlyEmo ? 3 : 2));
      s.setAttribute("role", "img");
      s.setAttribute("aria-label", m[1]);
      into.append(s);
    } else {
      const n = Number(m[2]);
      if (n >= 1 && n <= SUPPLY) {
        const b = el("button", "cx-ment");
        b.type = "button";
        b.textContent = "#" + n;
        b.dataset.id = tokenOf(n);
        b.setAttribute("aria-label", `Open Chog #${n}`);
        into.append(b);
      } else into.append(document.createTextNode(m[0]));
    }
    at = m.index + m[0].length;
  }
  if (at < x.length) into.append(document.createTextNode(x.slice(at)));
}

function row(m) {
  if (m.k === "sys") {
    const li = el("div", "cx-msg cx-sys");
    const sp = el("span", "cx-sys-t");
    textNodes(m.x, sp);
    li.append(el("span", "cx-sys-ic", px("star", 1.5)), sp);
    return li;
  }
  const mine = (myU && m.u === myU) || m.pending;
  const li = el("div", "cx-msg" + (mine ? " mine" : "") + (m.pending ? " pending" : "") + (m.failed ? " failed" : ""));
  li.dataset.i = m.i;
  const meta = el("div", "cx-meta");
  const nm = el("span", "cx-name");
  nm.textContent = m.n;
  nm.style.color = colorOf(m.u);
  meta.append(nm);
  if (m.b === "h") meta.append(el("span", "cx-hold", "holder"));
  if (mine) meta.append(el("span", "cx-you", "you"));
  if (m.p) {
    const pb = el("button", "cx-on");
    pb.type = "button";
    pb.dataset.id = m.p;
    pb.textContent = "on #" + (m.pn || numOf(m.p));
    pb.setAttribute("aria-label", `Open Chog #${m.pn || numOf(m.p)}`);
    meta.append(pb);
  }
  const tm = el("time", "cx-time");
  tm.dataset.t = m.t;
  tm.textContent = m.pending ? "sending" : ago(m.t);
  meta.append(tm);
  const body = el("div", "cx-text");
  textNodes(m.x, body);
  li.append(meta, body);
  return li;
}

function atBottom() {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
}
function paint(stick) {
  const wasBottom = atBottom();
  list.textContent = "";
  if (!msgs.length) {
    if (!fetched) return;
    const e = el("div", "cx-empty", `${px("wave", 3)}<p>It's quiet in Chogtown.<br />Say hi to the other sitters.</p>`);
    list.append(e);
    return;
  }
  const frag = document.createDocumentFragment();
  msgs.forEach((m) => frag.append(row(m)));
  list.append(frag);
  if (stick || wasBottom) {
    list.scrollTop = list.scrollHeight;
    newBar.hidden = true;
  } else newBar.hidden = false;
}
function append(newOnes) {
  // incremental add keeps the aria-live log announcing only the new lines
  const wasBottom = atBottom();
  const empty = list.querySelector(".cx-empty");
  if (empty) empty.remove();
  for (const m of newOnes) list.append(row(m));
  while (list.children.length > 120) list.firstChild.remove();
  if (wasBottom) list.scrollTop = list.scrollHeight;
  else newBar.hidden = false;
}
function tickTimes() {
  list.querySelectorAll("time[data-t]").forEach((t) => {
    if (!t.closest(".pending")) t.textContent = ago(Number(t.dataset.t));
  });
}

function unread() {
  return msgs.filter((m) => m.i > seen && !m.pending && m.u !== myU && m.k !== "sys").length;
}
function paintBadge() {
  const n = live() ? 0 : unread();
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? "9+" : String(n);
  btn.setAttribute("aria-label", n ? `Town chat, ${n} new` : "Town chat");
  btn.classList.toggle("has-new", n > 0);
}
function markSeen() {
  if (last > seen) {
    seen = last;
    store.set("pet.chat.seen", String(seen));
  }
  paintBadge();
}
function paintTag() {
  const id = currentPet();
  tagB.hidden = !id;
  if (!id) return;
  const n = numOf(id);
  tagB.setAttribute("aria-pressed", tagOn ? "true" : "false");
  tagB.innerHTML = tagOn ? `on #${n} <span aria-hidden="true">×</span>` : `+ tag #${n}`;
  tagB.setAttribute("aria-label", tagOn ? `Tagged Chog #${n}. Remove tag` : `Tag Chog #${n} in your message`);
}
function paintCount() {
  const n = Array.from(input.value).length;
  count.textContent = `${n}/${MAX}`;
  count.classList.toggle("near", n > MAX - 20);
  count.classList.toggle("over", n > MAX);
}
function paintAs() {
  asEl.textContent = "as " + myName();
}

// ---------- network ----------
async function fetchNew() {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(`/api/chat${last ? "?after=" + last : ""}`);
    if (!r.ok) return;
    const j = await r.json();
    if (typeof j.now === "number") skew = j.now - Math.floor(Date.now() / 1000);
    // a line that is nothing but masked swears ("**** ****") isn't shown (the server stops new ones too)
    const fresh = (j.m || []).filter((m) => m.i > last && !msgs.some((x) => x.i === m.i) && !(String(m.x).includes("*") && !/[\p{L}\p{N}]/u.test(m.x)));
    const first = !last;
    if (first && !fetched) list.classList.add("cx-fadein");
    fetched = true;
    if (first && !seen) {
      seen = j.last || 0; // first visit ever: start counting from here, don't greet with a pile of "unread"
      store.set("pet.chat.seen", String(seen));
    }
    if (fresh.length) {
      msgs = msgs.filter((x) => !x.pending || !fresh.some((m) => m.u === myU && m.x === x.x)).concat(fresh).slice(-120);
      last = Math.max(last, ...fresh.map((m) => m.i));
      active = Date.now();
      if (open || docked) first ? paint(true) : append(fresh);
    } else if (first && (open || docked)) paint(true);
    if (j.last > last && !fresh.length) last = j.last;
    if (live() && !document.hidden) markSeen();
    else paintBadge();
  } catch {
    // offline: try again next tick
  } finally {
    busy = false;
  }
}
function schedule(ms) {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(async () => {
    await fetchNew();
    tickTimes();
    schedule(live() ? openMs() : IDLE_MS);
  }, ms);
}

function setErr(msg) {
  err.textContent = msg || "";
  form.classList.toggle("has-err", !!msg);
}
async function send(text) {
  text = String(text || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  if (Array.from(text).length > MAX) return setErr(`Keep it under ${MAX} characters.`);
  if (LINKY.test(text)) return setErr("No links, @handles or wallet addresses.");
  const left = waitUntil - Date.now();
  if (left > 0) return setErr(`Slow down: ${Math.ceil(left / 1000)}s.`);
  setErr("");
  const pet = tagOn ? currentPet() : 0;
  const tmp = { i: 1e12 + Date.now(), t: nowS(), n: myName(), x: text, u: myU, pending: true };
  if (pet) (tmp.p = pet), (tmp.pn = numOf(pet));
  msgs.push(tmp);
  append([tmp]);
  list.scrollTop = list.scrollHeight;
  const headers = { "content-type": "application/json" };
  if (me.token) headers.authorization = "Bearer " + me.token;
  let j = null, status = 0;
  try {
    const r = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify({ text, pet: pet || undefined, anon: me.anon }) });
    status = r.status;
    j = await r.json().catch(() => null);
  } catch {}
  const node = list.querySelector(`[data-i="${tmp.i}"]`);
  if (j && j.ok && j.m) {
    // swap the optimistic line for the real one (unless a poll already brought it in)
    msgs = msgs.filter((x) => x !== tmp);
    if (!msgs.some((x) => x.i === j.m.i)) {
      msgs.push(j.m);
      msgs.sort((a, b) => a.i - b.i);
      if (node) node.replaceWith(row(j.m));
    } else if (node) node.remove();
    last = Math.max(last, j.m.i);
    if (j.m.u) myU = j.m.u;
    markSeen();
    waitUntil = Date.now() + 8000;
    active = Date.now();
    cooldownUI();
    if (j.masked) setErr("Some words were bleeped.");
    return true;
  }
  msgs = msgs.filter((x) => x !== tmp);
  if (node) node.remove();
  if (!msgs.length) paint(true);
  if (j && j.wait && (j.code === "slow" || j.code === "hour")) {
    waitUntil = Date.now() + j.wait * 1000;
    cooldownUI();
  }
  setErr((j && j.error) || (status === 401 ? "Your sign-in expired. Reconnect your wallet." : "Couldn't send. Check your connection."));
  if (!input.value) input.value = text;
  paintCount();
  return false;
}
let cdTimer = 0;
function cooldownUI() {
  clearInterval(cdTimer);
  const tick = () => {
    const left = Math.ceil((waitUntil - Date.now()) / 1000);
    sendB.classList.toggle("cool", left > 0);
    panel.querySelectorAll(".cx-emo").forEach((b) => b.classList.toggle("cool", left > 0));
    sendB.dataset.left = left > 0 ? left : "";
    if (left <= 0) {
      clearInterval(cdTimer);
      if (/^Slow down/.test(err.textContent)) setErr("");
    }
  };
  tick();
  cdTimer = setInterval(tick, 250);
}

// ---------- open / close ----------
let lastFocus = null;
function setOpen(v) {
  if (docked) {
    // the docked chat never closes: the header button brings it into view and puts the cursor in it
    if (!v) return;
    const r = panel.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    panel.classList.remove("cx-flash");
    void panel.offsetWidth;
    panel.classList.add("cx-flash");
    input.focus({ preventScroll: true });
    markSeen();
    return;
  }
  if (v === open) return;
  open = v;
  const wasInside = panel.contains(document.activeElement);
  panel.hidden = !v;
  // the phone sheet holds the page still underneath, like the shop does
  document.documentElement.style.overflow = v && innerWidth <= 640 ? "hidden" : "";
  btn.setAttribute("aria-expanded", v ? "true" : "false");
  root.classList.toggle("is-open", v);
  btn.classList.toggle("is-open", v);
  if (v) {
    place();
    lastFocus = document.activeElement;
    active = Date.now();
    paintAs();
    paintTag();
    computeU().then(() => paint(true));
    paint(true);
    markSeen();
    fetchNew();
    schedule(openMs());
    if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
    else panel.querySelector(".cx-x").focus({ preventScroll: true });
  } else {
    schedule(IDLE_MS);
    paintBadge();
    // give focus back only if it was in the panel; focus that already moved elsewhere stays where it is
    if (wasInside || document.activeElement === document.body) {
      const back = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : btn;
      back.focus({ preventScroll: true });
    }
  }
}

btn.addEventListener("click", () => setOpen(docked ? true : !open));
panel.querySelector(".cx-x").addEventListener("click", () => setOpen(false));
// keys pressed inside the panel are the panel's: the page's device keys (arrows, Enter, Space, 1-6, a/d) never see them
panel.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") docked ? document.activeElement && document.activeElement.blur() : setOpen(false);
});
panel.addEventListener("keyup", (e) => e.stopPropagation());
// Esc closes the chat wherever focus is (the shop sheet, when open, takes Esc first)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !open || e.defaultPrevented) return;
  if (document.querySelector("dialog[open]") || privyOpen()) return; // Esc belongs to the wallet modal first
  setOpen(false);
});
// the wallet modal (Privy) lives in its own portal; while it's up, the chat leaves Esc and clicks alone
const privyOpen = () => !!document.querySelector('[id*="privy-modal"], #privy-dialog, [data-privy-modal]');
// a click anywhere outside the chat closes it (desktop panel and phone sheet alike)
document.addEventListener("pointerdown", (e) => {
  if (!open || docked || privyOpen()) return;
  const t = e.target;
  if (panel.contains(t) || btn.contains(t)) return;
  setOpen(false);
}, true);
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = input.value;
  if (!t.trim()) return input.focus();
  input.value = "";
  paintCount();
  const ok = await send(t);
  if (ok && tagOn) {
    tagOn = false;
    paintTag();
  }
});
input.addEventListener("input", () => {
  active = Date.now();
  paintCount();
  if (err.textContent && !/^Slow down/.test(err.textContent)) setErr("");
});
panel.querySelectorAll(".cx-emo").forEach((b) => b.addEventListener("click", () => send(`:${b.dataset.e}:`)));
tagB.addEventListener("click", () => {
  tagOn = !tagOn;
  paintTag();
});
newBar.querySelector("button").addEventListener("click", () => {
  list.scrollTop = list.scrollHeight;
  newBar.hidden = true;
});
list.addEventListener("scroll", () => {
  if (atBottom()) newBar.hidden = true;
});
list.addEventListener("click", (e) => {
  const b = e.target.closest(".cx-ment, .cx-on");
  if (!b) return;
  const id = Number(b.dataset.id);
  if (!(id >= 1 && id <= SUPPLY)) return;
  window.dispatchEvent(new CustomEvent("chogpet:open", { detail: { id } }));
  // on a phone the sheet covers the pet: get out of the way
  if (!docked && matchMedia("(max-width: 640px)").matches) setOpen(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else {
    fetchNew();
    schedule(live() ? openMs() : IDLE_MS);
  }
});
// a sign-in or sign-out changes who "you" are
addEventListener("storage", (e) => {
  if (e.key === "pet.token" || e.key === "pet.addr") computeU();
});

// ---------- docking (desktop) ----------
const dockMQ = matchMedia("(min-width: 1280px) and (min-height: 640px)");
const colR = document.querySelector(".col-r");
const seenIO = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
  const was = onScreen;
  onScreen = es.some((x) => x.isIntersecting);
  if (onScreen && !was && docked) {
    // scrolled back to it: catch up now, then the faster rhythm
    markSeen();
    fetchNew();
    schedule(openMs());
  } else if (!onScreen && was) paintBadge();
}) : null;
function applyDock() {
  const want = !!(dockMQ.matches && colR && root);
  if (want === docked) return;
  if (want) {
    if (open) setOpen(false);
    docked = true;
    colR.append(panel);
    panel.hidden = false;
    panel.classList.add("cx-dock");
    panel.setAttribute("role", "region");
    panel.removeAttribute("aria-modal");
    btn.setAttribute("aria-expanded", "true");
    onScreen = true;
    if (seenIO) seenIO.observe(panel);
    paintAs();
    paintTag();
    paint(true);
    computeU().then(() => paint(true));
  } else {
    docked = false;
    if (seenIO) seenIO.unobserve(panel);
    onScreen = false;
    panel.classList.remove("cx-dock", "cx-flash");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    root.append(panel);
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  paintBadge();
  schedule(live() ? openMs() : IDLE_MS);
}

// start: docked chats fill right away; otherwise one quiet fetch a moment after the page settles, then the idle rhythm
if (root) {
  computeU();
  paintCount();
  applyDock();
  if (dockMQ.addEventListener) dockMQ.addEventListener("change", applyDock);
  setTimeout(() => {
    fetchNew();
    schedule(live() ? openMs() : IDLE_MS);
  }, docked ? 0 : 2500);
}
