// Chogtown: how all 1,969 Chogs are doing, at a glance and in big tappable faces. A bar shows the whole town
// by mood; tabs pick a crowd (who needs help, who just moved in, who's happy, who nobody has met yet) and the
// grid shows them, worst off first. Every rescue moves a Chog from "Need help" to "Happy" for everybody.
export const TOWN_LABEL = { 0: "no visitors yet", h: "happy", f: "doing fine", n: "needs care", s: "needs you", x: "out looking for snacks", w: "waiting" };
const PAGE = 24;
const TABS = [
  { k: "help", label: "Need you", has: (c) => c === "s" || c === "n" || c === "x" },
  { k: "moved", label: "New homes" },
  { k: "happy", label: "Happy", has: (c) => c === "h" || c === "f" },
  { k: "quiet", label: "Not met", has: (c) => c === "0" || c === "w" },
];
// "w" = waiting (nobody came for a while): neutral grey, never counted as needing help
const ORDER = { x: 0, s: 1, n: 2, f: 3, h: 4, w: 5, 0: 6 };

// images that still have to come over the network fade in when they land; ones already in the cache just show
export function softImgs(root) {
  for (const im of root.querySelectorAll("img")) {
    if (im.complete) continue;
    im.classList.add("ld-fade");
    const done = () => im.classList.remove("ld-fade");
    im.addEventListener("load", done, { once: true });
    im.addEventListener("error", done, { once: true });
  }
}

export class Town {
  constructor(el, { onPick, nameOf, thumbOf }) {
    this.el = el;
    this.onPick = onPick;
    this.nameOf = nameOf;
    this.thumbOf = thumbOf;
    this.cells = "0".repeat(1969);
    this.moved = new Map();
    this.mine = new Map(); // id -> [cell, at]: what this browser just saw, kept over the cached map for a minute
    this.cur = 0;
    this.tab = "help";
    this.shown = PAGE;
    this.ready = false; // until the first /api/town answer: a calm placeholder of the same size, never fake numbers
    this._sig = "";
    this.skeleton();
    el.more.addEventListener("click", () => {
      this.shown += PAGE;
      this.draw();
    });
    el.grid.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) this.onPick(Number(b.dataset.id));
    });
    el.tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      this.tab = b.dataset.k;
      this.shown = PAGE;
      this.draw();
    });
  }

  skeleton() {
    const { bar, tabs, grid, more } = this.el;
    bar.innerHTML = `<div class="tb-line sk-shim"></div>`;
    tabs.innerHTML = TABS.map((t) => `<button role="tab" data-k="${t.k}" aria-selected="${t.k === this.tab}" class="${t.k === this.tab ? "on" : ""}" disabled><i class="td td-${t.k}" aria-hidden="true"></i>${t.label}<span>…</span></button>`).join("");
    grid.innerHTML = Array.from({ length: PAGE }, () => `<div class="tc tc-sk" aria-hidden="true"><i class="sk-shim"></i><span>&nbsp;</span></div>`).join("");
    grid.setAttribute("aria-busy", "true");
    more.hidden = true;
  }

  set(data) {
    if (!data || typeof data.cells !== "string") return;
    this.ready = true;
    this.el.grid.removeAttribute("aria-busy");
    this.cells = data.cells;
    this.moved = new Map(data.moved || []);
    const now = Date.now();
    for (const [id, [c, at]] of this.mine) {
      if (now - at > 90_000) this.mine.delete(id);
      else this._put(id, c);
    }
    this.draw();
  }
  local(id, c) {
    this.mine.set(id, [c, Date.now()]);
    this._put(id, c);
    this.draw();
  }
  _put(id, c) {
    this.cells = this.cells.slice(0, id - 1) + c + this.cells.slice(id);
  }
  status(id) {
    return this.cells[id - 1] || "0";
  }

  _ids(tab) {
    if (tab.k === "moved") return [...this.moved.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const out = [];
    for (let i = 0; i < 1969; i++) if (tab.has(this.cells[i] || "0")) out.push(i + 1);
    // worst off first; the quiet ones in a shuffled-but-stable order so it isn't always #1, #2, #3…
    if (tab.k === "quiet") return out.sort((a, b) => ((a * 7919) % 1969) - ((b * 7919) % 1969));
    return out.sort((a, b) => ORDER[this.status(a)] - ORDER[this.status(b)]);
  }

  draw() {
    if (!this.ready) return;
    const { bar, tabs, grid, more } = this.el;
    const n = { h: 0, f: 0, n: 0, s: 0, x: 0, w: 0, 0: 0 };
    for (const c of this.cells) n[c] = (n[c] || 0) + 1;
    // one slim bar (its numbers live in the tabs below, once): happy · needs care · needs you · waiting · not met
    const seg = [["h", n.h + n.f, "happy"], ["n", n.n, "need care"], ["s", n.s + n.x, "need you"], ["w", n.w, "waiting"], ["0", n[0], "not met yet"]];
    const barHTML = `<div class="tb-line" role="img" aria-label="${seg.filter(([, v]) => v).map(([, v, l]) => `${v.toLocaleString("en-US")} ${l}`).join(", ")}">${seg.map(([k, v]) => (v ? `<i class="k-${k}" style="flex:${v}"></i>` : "")).join("")}</div>`;
    if (bar.innerHTML !== barHTML) bar.innerHTML = barHTML;
    const counts = Object.fromEntries(TABS.map((t) => [t.k, t.k === "moved" ? this.moved.size : this._ids(t).length]));
    const quietLabel = n.w ? "Waiting" : "Not met";
    const tabsHTML = TABS.map((t) => `<button role="tab" data-k="${t.k}" aria-selected="${t.k === this.tab}" class="${t.k === this.tab ? "on" : ""}${counts[t.k] ? "" : " zero"}"><i class="td td-${t.k}" aria-hidden="true"></i>${t.k === "quiet" ? quietLabel : t.label}<span>${counts[t.k].toLocaleString("en-US")}</span></button>`).join("");
    if (tabs.innerHTML !== tabsHTML) tabs.innerHTML = tabsHTML;
    const tab = TABS.find((t) => t.k === this.tab);
    let ids = this._ids(tab);
    // a short help list tops up with Chogs nobody has met yet, so the column never sits half empty
    let topUp = -1;
    if (tab.k === "help" && ids.length < PAGE) {
      topUp = ids.length;
      ids = ids.concat(this._ids(TABS[3]));
    }
    if (!ids.length) {
      this._sig = "";
      grid.innerHTML = `<div class="empty">${this.tab === "help" ? "Nobody needs help right now. Everyone you can see is fed and happy." : this.tab === "moved" ? "No Chog changed homes this week." : "Nobody here yet."}</div>`;
      more.hidden = true;
      return;
    }
    // the same faces as before (only the opened Chog changed): just move the highlight; "show more" only appends.
    // Either way the grid doesn't rebuild, flicker or lose its scroll
    const list = ids.slice(0, this.shown);
    const sig = this.tab + "|" + topUp + "|" + list.map((id) => id + this.status(id) + (this.moved.has(id) ? "m" : "")).join(",");
    const cell = (id, i) => {
      const st = this.status(id);
      const mv = this.moved.has(id);
      const sep = i === topUp ? `<div class="tc-sep">${topUp ? "Nobody's met these yet" : "All fine. Nobody's met these yet"}</div>` : "";
      return sep + `<button data-id="${id}" class="tc s-${st}${mv ? " mv" : ""}${id === this.cur ? " on" : ""}" aria-label="${this.nameOf(id)}, ${TOWN_LABEL[st]}"><img src="${this.thumbOf(id)}" alt="" loading="lazy" width="48" height="48"/><span>${this.nameOf(id).replace(/^Chog /i, "")}</span></button>`;
    };
    if (sig === this._sig) {
      for (const b of grid.querySelectorAll("button[data-id]")) b.classList.toggle("on", Number(b.dataset.id) === this.cur);
    } else if (this._sig && sig.startsWith(this._sig + ",")) {
      const had = grid.querySelectorAll("button[data-id]").length;
      const t = document.createElement("template");
      t.innerHTML = list.slice(had).map((id, k) => cell(id, had + k)).join("");
      grid.append(t.content);
      softImgs(grid);
      this._sig = sig;
    } else {
      this._sig = sig;
      grid.innerHTML = list.map(cell).join("");
      softImgs(grid);
    }
    more.hidden = ids.length <= this.shown;
    more.textContent = `Show more (${(ids.length - this.shown).toLocaleString("en-US")})`;
  }
}
