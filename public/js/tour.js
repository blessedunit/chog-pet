// Chog Pet: a short click-through tour for newcomers. The page dims, a cut-out lights up one thing at a time
// and a small pixel card says what it is in one line. Next / Back / Skip, dots, keys (Enter/→ next, ← back,
// Esc skip). Shown once after the intro (localStorage "pet.tour"); "?" in the header replays it.
import { sfx } from "./sfx.js";

const KEY = "pet.tour";
const vis = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== "hidden";
};
const q = (s) => document.querySelector(s);
const STEPS = [
  { t: "Your pet", x: "Every Chog Genesis NFT is a pet. Anyone can babysit it.", el: () => [q("#device"), q("#device .ring")], egg: true },
  { t: "Care", x: "Tap these to feed, play, bathe, tuck in and pet it.", el: () => [q("#iconsTop"), q("#iconsBot")] },
  { t: "Needs", x: "Food, fun, energy, clean. Low bar? Help it.", el: () => [q("#meters")] },
  { t: "Chogtown", x: "All 1,969 pets. Tap any face to visit it.", el: () => [q(".town-p")] },
  { t: "Candles", x: "Caring earns Candles. Spend them in the shop and games.", el: () => [q("#candleRoot > *") || q(".top-r")] },
  { t: "Chat", x: "Say hi to the other sitters.", el: () => [q(".cx-panel.cx-dock") || q(".cx-btn")] },
];

let on = null; // the running tour

export function tourSeen() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return true;
  }
}

export function startTour() {
  if (on) return on.done;
  const steps = STEPS.filter((s) => s.el().some(vis));
  if (!steps.length) return Promise.resolve(false);
  let i = 0;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const back = document.activeElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.createElement("div");
  root.className = "tour";
  root.innerHTML = `
    <svg class="tour-dim" aria-hidden="true"><defs><mask id="tourMask"><rect x="0" y="0" width="100%" height="100%" fill="#fff"/></mask></defs><rect x="0" y="0" width="100%" height="100%" mask="url(#tourMask)"/></svg>
    <div class="tour-ring" aria-hidden="true"></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourT" aria-describedby="tourX">
      <div class="tour-top"><b id="tourT"></b><span class="tour-n"></span></div>
      <p id="tourX"></p>
      <div class="tour-row">
        <div class="tour-dots" aria-hidden="true">${steps.map(() => "<i></i>").join("")}</div>
        <button type="button" class="tour-skip">Skip</button>
        <button type="button" class="tour-back">Back</button>
        <button type="button" class="tour-next">Next</button>
      </div>
    </div>`;
  document.body.append(root);
  const mask = root.querySelector("mask");
  const ring = root.querySelector(".tour-ring");
  const card = root.querySelector(".tour-card");
  const nextB = root.querySelector(".tour-next");
  const backB = root.querySelector(".tour-back");
  const skipB = root.querySelector(".tour-skip");

  let raf = 0;
  function layout() {
    const pad = 8;
    const rs = steps[i].el().filter(vis).map((e) => e.getBoundingClientRect());
    mask.querySelectorAll(".tm-h").forEach((h) => h.remove());
    let u = null;
    // the egg step: one soft ellipse around the whole egg (handle included), not a box laid over it
    const egg = steps[i].egg && rs.length;
    if (egg) {
      const b = rs.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2;
      const rx = ((b.r - b.l) / 2) * 1.06 + pad, ry = ((b.b - b.t) / 2) * 1.04 + pad;
      const h = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      h.setAttribute("class", "tm-h");
      h.setAttribute("cx", cx);
      h.setAttribute("cy", cy);
      h.setAttribute("rx", rx);
      h.setAttribute("ry", ry);
      h.setAttribute("fill", "#000");
      mask.append(h);
      u = { l: cx - rx + pad, t: cy - ry + pad, r: cx + rx - pad, b: cy + ry - pad };
    }
    for (const r of egg ? [] : rs) {
      const h = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      h.setAttribute("class", "tm-h");
      h.setAttribute("x", r.left - pad);
      h.setAttribute("y", r.top - pad);
      h.setAttribute("width", r.width + pad * 2);
      h.setAttribute("height", r.height + pad * 2);
      h.setAttribute("rx", 10);
      h.setAttribute("fill", "#000");
      mask.append(h);
      u = u ? { l: Math.min(u.l, r.left), t: Math.min(u.t, r.top), r: Math.max(u.r, r.right), b: Math.max(u.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    if (!u) return;
    // the ring hugs the whole lit area
    Object.assign(ring.style, { left: u.l - pad + "px", top: u.t - pad + "px", width: u.r - u.l + pad * 2 + "px", height: u.b - u.t + pad * 2 + "px" });
    ring.classList.toggle("multi", rs.length > 1 && !egg);
    ring.classList.toggle("egg", !!egg);
    // the card: below the target if it fits, else above, else pinned to the bottom of the screen
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, vw = innerWidth, vh = innerHeight;
    let top, left = (u.l + u.r) / 2 - cw / 2;
    const midY = Math.max(u.t, 8) + 4;
    if (u.b + pad + gap + ch < vh - 8) top = u.b + pad + gap;
    else if (u.t - pad - gap - ch > 8) top = u.t - pad - gap - ch;
    else if (vw - u.r - pad - gap > cw + 12) (left = u.r + pad + gap), (top = Math.min(midY, vh - ch - 16));
    else if (u.l - pad - gap > cw + 12) (left = u.l - pad - gap - cw), (top = Math.min(midY, vh - ch - 16));
    else top = vh - ch - 16;
    left = Math.max(12, Math.min(vw - cw - 12, left));
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(Math.max(8, top)) + "px";
  }
  const relayout = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  };

  function show(k) {
    i = k;
    const s = steps[i];
    root.querySelector("#tourT").textContent = s.t;
    root.querySelector("#tourX").textContent = s.x;
    root.querySelector(".tour-n").textContent = `${i + 1}/${steps.length}`;
    root.querySelectorAll(".tour-dots i").forEach((d, n) => d.classList.toggle("on", n === i));
    nextB.textContent = i === steps.length - 1 ? "Let's go" : "Next";
    backB.hidden = i === 0;
    skipB.hidden = i === steps.length - 1;
    // bring the target into view first (phones: Chogtown and the chat are further down)
    const el = s.el().find(vis);
    if (el) {
      const r = el.getBoundingClientRect();
      // tall targets (a whole column) only scroll when they're mostly off screen; the card then goes beside them
      const fits = r.height < innerHeight - 220;
      const shown = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const wide = innerWidth >= 1000; // wide screens can put the card beside the target
      const off = wide ? r.top < 8 || r.bottom > innerHeight - 8 : r.top < 64 || r.bottom > innerHeight - 180;
      if (fits ? off : shown < Math.min(r.height, innerHeight) * 0.6) el.scrollIntoView({ block: fits ? "center" : "start", behavior: "auto" });
      // phones: the egg goes to the top of the screen so the card fits under it, clear of the egg
      if (s.egg && !wide) {
        const top = el.getBoundingClientRect().top;
        if (Math.abs(top - 24) > 4) scrollBy({ top: top - 24, behavior: "auto" });
      }
    }
    card.classList.remove("pop");
    void card.offsetWidth;
    if (!reduce) card.classList.add("pop");
    layout();
    setTimeout(layout, 140); // after a scroll settles / fonts load
    nextB.focus({ preventScroll: true });
  }
  function end(finished) {
    try {
      localStorage.setItem(KEY, finished ? "done" : "skip");
    } catch {}
    removeEventListener("resize", relayout);
    removeEventListener("scroll", relayout, true);
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    on = null;
    if (back && back.focus && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("chogpet:tourdone", { detail: { finished } }));
    resolve(finished);
  }
  function next() {
    sfx.move();
    if (i < steps.length - 1) show(i + 1);
    else end(true);
  }
  function prev() {
    if (i > 0) sfx.move(), show(i - 1);
  }
  // while the tour runs, keys belong to it (the device's arrows/Enter must not fire underneath)
  function onKey(e) {
    const k = e.key;
    const a = document.activeElement;
    if (k === "Tab") {
      const f = [...card.querySelectorAll("button:not([hidden])")];
      const at = f.indexOf(a);
      f[(at + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
    } else if (k === "Escape") end(false);
    else if (k === "ArrowRight") next();
    else if (k === "ArrowLeft") prev();
    else if (k === "Enter" || k === " ") (a && card.contains(a) && a.tagName === "BUTTON" ? a : nextB).click();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  nextB.addEventListener("click", next);
  backB.addEventListener("click", prev);
  skipB.addEventListener("click", () => end(false));
  addEventListener("resize", relayout, { passive: true });
  addEventListener("scroll", relayout, { capture: true, passive: true });
  document.addEventListener("keydown", onKey, true);
  on = { done };
  show(0);
  return done;
}
