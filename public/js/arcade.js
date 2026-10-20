// Chog Pet arcade: the capsule machine, Green or Red and the daily wheel. (The daily bounties live in Today, quests.js.)
// All rolls happen in the worker (crypto RNG); these only animate the answer. Candles have no real value.
import { ITEMS, TIERS, POOLS, CAPSULE, BET, WHEEL, payout } from "./econ.js";
import { iconOf } from "./gifts.js";
import { S, PAL, draw, text, textWidth, toCanvas } from "./sprites.js";

const calm = matchMedia("(prefers-reduced-motion: reduce)");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TIER = Object.fromEntries(TIERS.map((t) => [t.k, t]));
const pct = (p) => (p * 100 >= 10 ? Math.round(p * 100) : +(p * 100).toFixed(1)) + "%";
function left(ends) {
  const s = Math.max(0, ends - Math.floor(Date.now() / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function pixCanvas(w, h, cls) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  if (cls) c.className = cls;
  return c;
}
const candleBtn = (ctx, label, price) => {
  const b = el("button", "arc-go");
  b.innerHTML = `<span class="l">${label}</span>${price != null ? `<span class="p"><i></i>${price}</span>` : ""}`;
  if (price != null) b.querySelector("i").appendChild(ctx.candle(2));
  return b;
};
const label = (it) => (ITEMS[it] ? ITEMS[it].name : it);

// ======================= capsule machine =======================
const CAPCOL = { common: ["#ddd7fe", "#a99fc9"], rare: ["#85e6ff", "#3a9cc4"], epic: ["#ff8ee4", "#c24fa6"], legendary: ["#ffd84d", "#e39a1c"] };
const DOME = [["#ff8ee4", 30, 30], ["#85e6ff", 42, 24], ["#ffd84d", 56, 30], ["#ddd7fe", 66, 40], ["#6e54ff", 36, 44], ["#ffae45", 50, 42], ["#85e6ff", 26, 48], ["#ff8ee4", 62, 52], ["#ffd84d", 44, 54], ["#ddd7fe", 54, 56], ["#ffae45", 34, 56]];

function drawMachine(g, st) {
  const W = 96, H = 124, k = PAL.k;
  g.clearRect(0, 0, W, H);
  const r = (x, y, w, h, c) => ((g.fillStyle = c), g.fillRect(x, y, w, h));
  // dome: a pixel circle of glass
  const cx = 48, cy = 40, R = 30;
  for (let y = -R - 1; y <= R + 1; y++)
    for (let x = -R - 1; x <= R + 1; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= R + 1 && d > R - 0.2) r(cx + x, cy + y, 1, 1, k);
      else if (d <= R - 0.2) r(cx + x, cy + y, 1, 1, "rgba(133,230,255,0.10)");
    }
  // capsules inside (they jump when it's turning)
  DOME.forEach(([c, x, y], i) => {
    const j = st.shake ? Math.round(Math.sin(st.t * 40 + i * 2) * 2) : Math.round(Math.sin(st.t * 1.4 + i) * 0.6);
    const yy = y + 2 + j;
    r(x - 3, yy - 3, 7, 7, k);
    r(x - 2, yy - 2, 5, 2, c);
    r(x - 2, yy, 5, 2, "#fff8ee");
    r(x - 2, yy + 2, 5, 1, "#d9cfe6");
    r(x - 3, yy - 3, 1, 1, "rgba(0,0,0,0)");
  });
  // lid on top of the dome
  r(40, 7, 16, 5, k);
  r(41, 8, 14, 3, "#ff8ee4");
  r(41, 8, 14, 1, "#ffc2f0");
  r(45, 4, 6, 4, k);
  r(46, 5, 4, 2, "#ffd84d");
  // glass shine
  r(28, 20, 2, 8, "rgba(255,255,255,0.55)");
  r(30, 17, 3, 2, "rgba(255,255,255,0.55)");
  r(26, 30, 2, 3, "rgba(255,255,255,0.35)");
  // collar
  r(20, 66, 56, 6, k);
  r(21, 67, 54, 4, "#ffd84d");
  r(21, 70, 54, 1, "#e39a1c");
  // body
  r(16, 72, 64, 44, k);
  r(17, 73, 62, 42, "#6e54ff");
  r(17, 73, 4, 42, "#8b74ff");
  r(75, 73, 4, 42, "#5038d8");
  // price plate
  r(24, 77, 22, 9, k);
  r(25, 78, 20, 7, "#0e091c");
  draw(g, "gcandle", 26, 77, { scale: 1 });
  text(g, String(CAPSULE), 34, 79, "#ffd84d");
  // knob
  const kx = 62, ky = 82;
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (x * x + y * y <= 49) r(kx + x, ky + y, 1, 1, x * x + y * y > 36 ? k : "#ffd84d");
  const a = st.knob;
  for (let i = -5; i <= 5; i++) r(Math.round(kx + Math.cos(a) * i), Math.round(ky + Math.sin(a) * i), 2, 2, "#1d1233");
  // chute
  r(30, 94, 30, 16, k);
  r(31, 95, 28, 14, "#0e091c");
  r(31, 95, 28, 2, "#1a1036");
  // the capsule that came out
  if (st.drop != null) {
    const [c1, c2] = CAPCOL[st.tier] || CAPCOL.common;
    const y = Math.round(st.drop);
    r(40, y, 10, 10, k);
    r(41, y + 1, 8, 4, c1);
    r(41, y + 5, 8, 4, "#fff8ee");
    r(41, y + 4, 8, 1, c2);
    r(42, y + 2, 2, 1, "rgba(255,255,255,0.8)");
  }
  // feet
  r(18, 116, 12, 6, k);
  r(66, 116, 12, 6, k);
  r(19, 117, 10, 4, "#2b2152");
  r(67, 117, 10, 4, "#2b2152");
}

function capsuleHalf(tier, top) {
  // a 16x8 half of a big capsule, drawn as pixels
  const c = pixCanvas(18, 9);
  const g = c.getContext("2d");
  const [c1, c2] = CAPCOL[tier] || CAPCOL.common;
  const R = 8;
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 18; x++) {
      const dy = top ? 8.5 - y : y + 0.5, dx = x - 8.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R + 0.6) continue;
      g.fillStyle = d > R - 0.6 ? PAL.k : top ? (y < 3 && x > 3 && x < 7 ? "#ffffff" : y > 6 ? c2 : c1) : y < 1 ? c2 : y > 5 ? "#d9cfe6" : "#fff8ee";
      g.fillRect(x, y, 1, 1);
    }
  return c;
}

export function renderCapsules(body, ctx) {
  const wrap = el("div", "arc arc-caps");
  const stage = el("div", "cap-stage");
  const mc = pixCanvas(96, 124, "cap-machine");
  stage.appendChild(mc);
  const reveal = el("div", "cap-reveal");
  reveal.hidden = true;
  stage.appendChild(reveal);
  wrap.appendChild(stage);

  const side = el("div", "cap-side");
  const go = candleBtn(ctx, "Pull", CAPSULE);
  const chips = el("div", "arc-chips");
  side.appendChild(go);
  side.appendChild(chips);
  // odds, openly
  const odds = el("details", "cap-odds");
  odds.open = matchMedia("(min-width: 721px)").matches;
  odds.innerHTML = `<summary>Odds</summary>`;
  for (const t of TIERS) {
    const row = el("div", "odd");
    row.innerHTML = `<span class="dot" style="--c:${t.col}"></span><span class="t">${t.name}</span><span class="p">${pct(t.p)}</span><span class="pool"></span>`;
    const pool = row.querySelector(".pool");
    const seen = new Set();
    for (const [it] of POOLS[t.k]) {
      const k = it === "color" ? "c_pink" : it === "badge" ? "b_star" : it;
      if (seen.has(k)) continue;
      seen.add(k);
      if (k === "candles") pool.appendChild(ctx.candle(2));
      else if (ITEMS[k] && ITEMS[k].kind === "color") pool.appendChild(el("span", "sw", "")).style.setProperty("--sw", ITEMS[k].hex);
      else pool.appendChild(iconOf(k, 2));
    }
    odds.appendChild(row);
  }
  odds.insertAdjacentHTML("beforeend", `<p class="dim">Lucky charm: Rare or better. A name style you own: half back.</p>`);
  side.appendChild(odds);
  wrap.appendChild(side);
  body.appendChild(wrap);

  const st = { t: 0, knob: -Math.PI / 4, shake: false, drop: null, tier: "common" };
  let raf = 0, busy = false;
  const loop = (t) => {
    st.t = t / 1000;
    drawMachine(mc.getContext("2d"), st);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const update = () => {
    const W = ctx.W;
    const can = W.bal >= CAPSULE && W.day.pulls < W.day.pullsCap;
    go.classList.toggle("short", !can);
    chips.innerHTML = "";
    chips.appendChild(el("span", "chip", `${W.day.pullsCap - W.day.pulls} left today`));
    if (W.inv.charm) chips.appendChild(el("span", "chip hot", `Lucky charm ×${W.inv.charm}`));
  };
  update();
  body._update = update;

  const anim = (ms, fn) =>
    new Promise((res) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });

  go.addEventListener("click", async () => {
    if (busy) return;
    const W = ctx.W;
    if (W.day.pulls >= W.day.pullsCap) return ctx.snd.no(), ctx.say(`The machine is empty for today. Back in ${left(W.ends)}`, "bad");
    if (W.bal < CAPSULE) return ctx.snd.no(), ctx.say(`You need ${CAPSULE - W.bal} more Candles`, "bad");
    busy = true;
    go.disabled = true;
    reveal.hidden = true;
    st.drop = null;
    let res;
    try {
      const p = ctx.post("pull");
      // turn the knob while the worker rolls
      ctx.snd.rattle();
      st.shake = true;
      const k0 = st.knob;
      await anim(calm.matches ? 10 : 700, (k) => (st.knob = k0 + k * Math.PI * 2));
      res = await p;
      st.shake = false;
      st.tier = res.tier;
      // the capsule drops into the tray and bounces
      await anim(calm.matches ? 10 : 520, (k) => {
        const b = k < 0.7 ? (k / 0.7) ** 2 : 1 - Math.sin(((k - 0.7) / 0.3) * Math.PI) * 0.12;
        st.drop = 86 + b * 12;
      });
      await showReveal(res);
    } catch (e) {
      st.shake = false;
      ctx.snd.no();
      ctx.say(e.message, "bad");
    } finally {
      busy = false;
      go.disabled = false;
      update();
    }
  });

  async function showReveal(res) {
    const t = TIER[res.tier];
    reveal.innerHTML = "";
    reveal.style.setProperty("--tc", t.col);
    reveal.className = `cap-reveal t-${res.tier}`;
    const rays = el("div", "rays");
    const cap = el("div", "cap");
    const top = capsuleHalf(res.tier, true), bot = capsuleHalf(res.tier, false);
    top.className = "half top";
    bot.className = "half bot";
    cap.append(top, bot);
    const prize = el("div", "prize");
    if (res.candles) {
      prize.appendChild(toCanvas("gcandle", 6));
    } else if (ITEMS[res.item] && ITEMS[res.item].kind === "color") {
      prize.appendChild(el("span", "sw big")).style.setProperty("--sw", ITEMS[res.item].hex);
    } else prize.appendChild(iconOf(res.item, 5));
    const name = res.candles ? `+${res.candles} Candles` : `${label(res.item)}${res.n > 1 ? ` ×${res.n}` : ""}`;
    const cap2 = el("div", "cap-txt", `<b class="tier">${t.name}</b><span class="nm">${esc(name)}</span>${res.dup ? `<span class="dup">Already yours: +${res.refund} Candles</span>` : ""}${res.charm ? `<span class="dup">Lucky charm used</span>` : ""}`);
    const show = el("div", "show");
    show.append(rays, cap, prize);
    reveal.append(show, cap2);
    const ok = el("button", "cap-ok", "Nice");
    ok.addEventListener("click", () => {
      reveal.hidden = true;
      st.drop = null;
    });
    reveal.appendChild(ok);
    reveal.hidden = false;
    if (calm.matches) return void reveal.classList.add("open");
    reveal.classList.add("shake");
    for (let i = 0; i < 3; i++) setTimeout(() => ctx.snd.tick(), i * 220);
    await new Promise((r) => setTimeout(r, 760));
    ctx.snd.crack();
    reveal.classList.remove("shake");
    reveal.classList.add("open");
    setTimeout(() => {
      if (res.tier === "legendary" || res.tier === "epic") ctx.snd.big();
      else ctx.snd.win();
      const r = prize.getBoundingClientRect();
      const n = { common: 16, rare: 30, epic: 60, legendary: 110 }[res.tier];
      ctx.confetti(r.left + r.width / 2, r.top + r.height / 2, n, res.tier === "legendary" ? ["#ffd84d", "#ffae45", "#fff8ee", "#ff8ee4"] : null);
    }, 120);
  }

  return () => cancelAnimationFrame(raf);
}

// ======================= Green or Red =======================
// (the internal names stay "pump" / bet: only the words on screen changed)
const UP = "#46e38f", DN = "#ff4f5e";
const PD_HIST = []; // this visit's results, newest first
// a win may not take today's net past the win cap (the worker refuses such a bet)
const overCap = (W, amt) => W.day.won - W.day.loss + payout(amt) - amt > W.day.winCap;
export function renderPump(body, ctx) {
  const wrap = el("div", "arc arc-pump");
  const chartBox = el("div", "pd-chart");
  const cv = pixCanvas(160, 80);
  chartBox.appendChild(cv);
  const banner = el("div", "pd-banner");
  chartBox.appendChild(banner);
  const left2 = el("div", "pd-left");
  left2.appendChild(chartBox);
  const hist = el("div", "pd-hist");
  left2.appendChild(hist);
  wrap.appendChild(left2);
  const paintHist = () => {
    hist.innerHTML = `<span class="h">Last</span>` + (PD_HIST.length ? PD_HIST.map((r) => `<span class="r ${r.win ? "w" : "l"}">${r.up ? "▲" : "▼"}</span>`).join("") : `<span class="none">no bets yet</span>`);
  };
  paintHist();

  const ctl = el("div", "pd-ctl");
  const bets = el("div", "pd-bets");
  let amt = BET.sizes[0];
  try {
    const v = Number(localStorage.getItem("pet.bet"));
    if (BET.sizes.includes(v)) amt = v;
  } catch {}
  for (const s of BET.sizes) {
    const b = el("button", "pd-chip");
    b.dataset.v = s;
    b.innerHTML = `<i></i>${s}`;
    b.querySelector("i").appendChild(ctx.candle(1));
    b.addEventListener("click", () => {
      amt = s;
      try {
        localStorage.setItem("pet.bet", String(s));
      } catch {}
      ctx.snd.tick();
      update();
    });
    bets.appendChild(b);
  }
  const win = el("div", "pd-win");
  const row = el("div", "pd-row");
  const pump = el("button", "pd-btn up", `<span class="ar">▲</span><span>Green</span>`);
  const dump = el("button", "pd-btn dn", `<span class="ar">▼</span><span>Red</span>`);
  row.append(pump, dump);
  const chips = el("div", "arc-chips");
  ctl.append(bets, win, row, chips);
  wrap.appendChild(ctl);
  wrap.appendChild(el("p", "dim arc-note", `50/50, a win pays ×${BET.pay}: on average you lose a little. A day: ${BET.perDay} bets, ${BET.lossCap} lost or ${BET.winCap} won at most.`));
  body.appendChild(wrap);

  // a made-up price walk (only the last candle is real: the worker's answer)
  const series = [];
  let p = 40;
  for (let i = 0; i < 22; i++) {
    const o = p;
    p = Math.max(14, Math.min(66, p + Math.round((Math.random() - 0.5) * 10)));
    series.push({ o, c: p, h: Math.max(o, p) + Math.round(Math.random() * 3), l: Math.min(o, p) - Math.round(Math.random() * 3) });
  }
  let live = null; // { o, c, h, l } being drawn
  let raf = 0, busy = false;
  const draw2 = (t) => {
    const g = cv.getContext("2d");
    g.fillStyle = "#0e091c";
    g.fillRect(0, 0, 160, 80);
    g.fillStyle = "#1a1036";
    for (let y = 8; y < 80; y += 16) for (let x = 0; x < 160; x += 4) g.fillRect(x, y, 2, 1);
    const all = live ? series.concat([live]) : series;
    const show = all.slice(-20); // leave the right end free for the price tag
    const lo = Math.min(...show.map((c) => c.l)) - 4, hi = Math.max(...show.map((c) => c.h)) + 4;
    const Y = (v) => Math.round(76 - ((v - lo) / Math.max(1, hi - lo)) * 70);
    show.forEach((c, i) => {
      const x = 4 + i * 6;
      const col = c.c >= c.o ? UP : DN;
      g.fillStyle = col;
      g.fillRect(x + 1, Y(c.h), 1, Math.max(1, Y(c.l) - Y(c.h)));
      const y0 = Y(Math.max(c.o, c.c)), y1 = Y(Math.min(c.o, c.c));
      g.fillRect(x, y0, 3, Math.max(2, y1 - y0));
      if (c === live) {
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.fillRect(x, y0, 1, Math.max(2, y1 - y0));
      }
    });
    // price tag
    const last = show[show.length - 1];
    const ly = Y(last.c);
    g.fillStyle = last.c >= last.o ? UP : DN;
    // the tag stays inside the chart (6 px clear of the rounded right edge and of the top/bottom)
    const lbl = String(Math.round(last.c)), tw = textWidth(lbl), bx = 154 - (tw + 6), by = Math.max(3, Math.min(73, ly - 3));
    for (let x = 4 + show.length * 6; x < bx - 1; x += 3) g.fillRect(x, ly, 2, 1);
    g.fillRect(bx, by, tw + 6, 7);
    text(g, lbl, bx + 3, by + 1, "#0e091c");
    raf = requestAnimationFrame(draw2);
  };
  raf = requestAnimationFrame(draw2);

  const update = () => {
    const W = ctx.W;
    for (const b of bets.children) b.classList.toggle("on", Number(b.dataset.v) === amt);
    win.innerHTML = `Win <b>+${payout(amt)}</b>`;
    const can = W.bal >= amt && W.day.bets < W.day.betsCap && W.day.loss + amt <= W.day.lossCap && !overCap(W, amt);
    pump.classList.toggle("short", !can);
    dump.classList.toggle("short", !can);
    chips.innerHTML = "";
    chips.appendChild(el("span", "chip", `${W.day.betsCap - W.day.bets} bets left`));
    chips.appendChild(el("span", "chip", `Loss limit ${W.day.lossCap - W.day.loss}`));
    if (W.day.won > 0) chips.appendChild(el("span", "chip", `Up ${W.day.won} of ${W.day.winCap}`));
    if (W.ws >= 2) chips.appendChild(el("span", "chip hot", `Streak ${W.ws}`));
  };
  update();
  body._update = update;

  async function play(dir) {
    if (busy) return;
    const W = ctx.W;
    if (W.day.bets >= W.day.betsCap) return ctx.snd.no(), ctx.say(`That's all the bets for today. Back in ${left(W.ends)}`, "bad");
    if (W.day.loss + amt > W.day.lossCap) return ctx.snd.no(), ctx.say(`Today's loss limit is reached. Back in ${left(W.ends)}`, "bad");
    if (W.day.won >= W.day.winCap) return ctx.snd.no(), ctx.say(`You're up ${W.day.won} today. Table opens in ${left(W.ends)}`, "bad");
    if (overCap(W, amt)) return ctx.snd.no(), ctx.say(BET.sizes.some((s) => !overCap(W, s)) ? `A win would go past +${W.day.winCap} today. Try a smaller bet` : `You're up ${W.day.won} today. Table opens in ${left(W.ends)}`, "bad");
    if (W.bal < amt) return ctx.snd.no(), ctx.say(`You need ${amt - W.bal} more Candles`, "bad");
    busy = true;
    pump.disabled = dump.disabled = true;
    (dir === "up" ? pump : dump).classList.add("picked");
    banner.className = "pd-banner";
    banner.textContent = "";
    const o = series[series.length - 1].c;
    live = { o, c: o, h: o, l: o };
    ctx.snd.rise();
    try {
      const p = ctx.post("bet", { amt, dir });
      // the candle wiggles while we wait (at least 1.3 s, it's the fun part)
      const t0 = performance.now();
      const wig = setInterval(() => {
        const k = (performance.now() - t0) / 1000;
        live.c = o + Math.sin(k * 11) * (3 + k * 3) + Math.sin(k * 23) * 1.5;
        live.h = Math.max(live.h, live.c);
        live.l = Math.min(live.l, live.c);
        if (Math.random() < 0.3) ctx.snd.tick();
      }, 40);
      const [res] = await Promise.all([p, new Promise((r) => setTimeout(r, calm.matches ? 0 : 1300))]);
      clearInterval(wig);
      const target = o + (res.up ? 1 : -1) * (3 + res.move * 2);
      // settle on the real close
      const from = live.c;
      await new Promise((r) => {
        const t1 = performance.now();
        const st = (t) => {
          const k = Math.min(1, (t - t1) / 380);
          live.c = from + (target - from) * (1 - (1 - k) ** 3);
          live.h = Math.max(live.h, live.c);
          live.l = Math.min(live.l, live.c);
          if (k < 1) requestAnimationFrame(st);
          else r();
        };
        requestAnimationFrame(st);
      });
      PD_HIST.unshift({ up: res.up, win: res.win });
      PD_HIST.length = Math.min(PD_HIST.length, 12);
      paintHist();
      series.push({ ...live });
      if (series.length > 40) series.shift();
      live = null;
      banner.className = "pd-banner show " + (res.win ? "win" : "lose");
      banner.innerHTML = res.win ? `${res.up ? "GREEN" : "RED"}! <b>+${res.pay}</b>` : `${res.up ? "GREEN" : "RED"}. <b>-${res.amt}</b>`;
      chartBox.classList.remove("jolt");
      void chartBox.offsetWidth;
      chartBox.classList.add("jolt");
      if (res.win) {
        ctx.snd.win();
        const r = chartBox.getBoundingClientRect();
        ctx.confetti(r.left + r.width / 2, r.top + r.height / 2, 30 + Math.min(40, res.ws * 8), [UP, "#ffd84d", "#ddd7fe"]);
      } else ctx.snd.lose();
    } catch (e) {
      live = null;
      ctx.snd.no();
      ctx.say(e.message, "bad");
    } finally {
      busy = false;
      pump.disabled = dump.disabled = false;
      pump.classList.remove("picked");
      dump.classList.remove("picked");
      update();
    }
  }
  pump.addEventListener("click", () => play("up"));
  dump.addEventListener("click", () => play("down"));
  return () => cancelAnimationFrame(raf);
}

// ======================= daily wheel =======================
function drawWheel(g, ang, hi) {
  const N = WHEEL.length, R = 46, cx = 50, cy = 52;
  g.clearRect(0, 0, 100, 104);
  // the wheel, pixel by pixel
  for (let y = -R - 2; y <= R + 2; y++)
    for (let x = -R - 2; x <= R + 2; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > R + 1.5) continue;
      let c;
      if (d > R - 0.5) c = PAL.k;
      else if (d > R - 3) c = (Math.floor((Math.atan2(y, x) - ang) / (Math.PI / 16)) & 1) ? "#ffd84d" : "#fff8ee";
      else if (d < 7) c = d > 6 ? PAL.k : "#ffd84d";
      else {
        let a = Math.atan2(y, x) - ang;
        a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const i = Math.floor(a / ((Math.PI * 2) / N));
        const edge = Math.abs(((a / ((Math.PI * 2) / N)) % 1) - 0) < 0.03 * (R / Math.max(8, d)) || (a / ((Math.PI * 2) / N)) % 1 > 1 - 0.03 * (R / Math.max(8, d));
        c = edge ? PAL.k : i === hi ? "#ffffff" : WHEEL[i].col;
      }
      g.fillStyle = c;
      g.fillRect(cx + x, cy + y, 1, 1);
    }
  // labels stay upright while it turns
  for (let i = 0; i < N; i++) {
    const a = ang + ((i + 0.5) * Math.PI * 2) / N;
    const lx = Math.round(cx + Math.cos(a) * 30), ly = Math.round(cy + Math.sin(a) * 30);
    const s = WHEEL[i];
    const dark = ["#ffd84d", "#85e6ff", "#ff8ee4"].includes(s.col) || i === hi;
    if (s.candles) {
      const t = String(s.candles);
      text(g, t, lx - Math.floor(textWidth(t) / 2), ly - 2, dark ? "#1d1233" : "#fff8ee");
    } else {
      const k = s.item === "mochi" ? "mochi" : "e_x2";
      const [w, h] = [S[k][0].length, S[k].length];
      draw(g, k, lx - Math.floor(w / 2), ly - Math.floor(h / 2));
    }
  }
  // hub
  draw(g, "gcandle", cx - 3, cy - 4);
  // pointer
  const px = cx, py = 3;
  for (let j = 0; j < 7; j++) {
    g.fillStyle = PAL.k;
    g.fillRect(px - 5 + j, py + j, 11 - 2 * j, 1);
    g.fillStyle = "#ff8ee4";
    if (j < 6) g.fillRect(px - 4 + j, py + j, Math.max(1, 9 - 2 * j), 1);
  }
}

export function renderWheel(body, ctx) {
  const wrap = el("div", "arc arc-wheel");
  const stage = el("div", "wh-stage");
  const cv = pixCanvas(100, 104, "wh-cv");
  stage.appendChild(cv);
  const out = el("div", "wh-out");
  stage.appendChild(out);
  wrap.appendChild(stage);
  const side = el("div", "wh-side");
  const go = candleBtn(ctx, "Spin", null);
  side.appendChild(go);
  const odds = el("details", "cap-odds wh-odds");
  odds.innerHTML = `<summary>Odds</summary>`;
  const tot = WHEEL.reduce((t, s) => t + s.w, 0);
  for (const s of WHEEL) {
    const r = el("div", "odd");
    r.innerHTML = `<span class="dot" style="--c:${s.col === "#2b2152" ? "#4a3d80" : s.col}"></span><span class="t"></span><span class="p">${pct(s.w / tot)}</span>`;
    const t = r.querySelector(".t");
    if (s.candles) t.append(ctx.candle(1), ` ${s.candles}`);
    else t.append(iconOf(s.item, 1), ` ${label(s.item)}`);
    odds.appendChild(r);
  }
  side.appendChild(odds);
  wrap.appendChild(side);
  body.appendChild(wrap);

  let ang = -Math.PI / 2 - Math.PI / WHEEL.length, hi = -1, raf = 0, spinning = false;
  const g = cv.getContext("2d");
  drawWheel(g, ang, hi);

  const update = () => {
    const W = ctx.W;
    go.classList.toggle("short", W.day.wheel);
    go.querySelector(".l").textContent = W.day.wheel ? `Next in ${left(W.ends)}` : "Spin free";
    go.setAttribute("aria-disabled", W.day.wheel ? "true" : "false");
    go.classList.toggle("is-off", !!W.day.wheel);
  };
  update();
  body._update = update;
  const timer = setInterval(() => !spinning && update(), 30000);

  go.addEventListener("click", async () => {
    if (spinning) return;
    if (ctx.W.day.wheel) return ctx.snd.no(), ctx.say(`One spin a day. Next in ${left(ctx.W.ends)}`, "bad");
    spinning = true;
    go.disabled = true;
    out.className = "wh-out";
    hi = -1;
    try {
      // start turning right away, land when the answer is in
      let vel = 0.32, t0 = performance.now(), res = null, landing = null;
      const p = ctx.post("spin").then((r) => (res = r)).catch((e) => (res = { err: e }));
      const seg = (Math.PI * 2) / WHEEL.length;
      let lastSeg = Math.floor(ang / seg);
      await new Promise((done) => {
        const step = (t) => {
          if (!landing && res && t - t0 > 500) {
            if (res.err) return done();
            // final angle: the middle of segment i under the pointer (top), a few more turns
            const target = -Math.PI / 2 - (res.i + 0.5) * seg + (Math.random() - 0.5) * seg * 0.6;
            let end = target;
            while (end < ang + Math.PI * 6) end += Math.PI * 2;
            landing = { from: ang, to: end, t: t, ms: calm.matches ? 10 : 3200 };
          }
          if (landing) {
            const k = Math.min(1, (t - landing.t) / landing.ms);
            ang = landing.from + (landing.to - landing.from) * (1 - (1 - k) ** 4);
            if (k >= 1) return drawWheel(g, ang, hi), done();
          } else ang += vel;
          const sNow = Math.floor(ang / seg);
          if (sNow !== lastSeg) (lastSeg = sNow), ctx.snd.tick();
          drawWheel(g, ang, hi);
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
      await p;
      if (res.err) throw res.err;
      hi = res.i;
      let blink = 0;
      const bl = setInterval(() => {
        drawWheel(g, ang, blink++ % 2 ? -1 : hi);
        if (blink > 6) clearInterval(bl), drawWheel(g, ang, hi);
      }, 120);
      out.className = "wh-out show";
      out.innerHTML = res.candles ? `+${res.candles} <small>Candles</small>` : `${esc(label(res.item))}!`;
      if (res.candles >= 30 || !res.candles) ctx.snd.big();
      else ctx.snd.win();
      const r = cv.getBoundingClientRect();
      ctx.confetti(r.left + r.width / 2, r.top + r.height / 2, res.candles >= 100 ? 120 : 40);
    } catch (e) {
      ctx.snd.no();
      ctx.say(e.message, "bad");
    } finally {
      spinning = false;
      go.disabled = false;
      update();
    }
  });
  return () => (cancelAnimationFrame(raf), clearInterval(timer));
}
