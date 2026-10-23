// The trailer near the bottom, as a little Chogtown cinema: a marquee, a still with a play button and a Chog party
// on both sides of it, exactly as tall as the video. Every Chog dances to its own beat, and now and then one hops
// with a note or a heart; once the trailer plays a wave runs out from the screen and they all dance faster.
// The YouTube player loads only on a tap (no cookies until then).
const sec = document.getElementById("trailer");
const box = document.getElementById("trVideo");

// #953 (token 1462) plus a hand-checked pool (token ids; some hats carry words we don't want here)
const POOL = [309, 1942, 149, 1040, 1292, 127, 99, 177, 870, 144, 186, 1864, 122, 1682, 338, 1413, 577, 982, 1655, 1050,
  376, 1035, 484, 1911, 142, 1888, 1960, 1107, 1019, 1950, 755, 1513, 1921];
const EMO = [["♪", "#6b4cff"], ["♫", "#8b5cf6"], ["♥", "#ff4fa0"], ["✦", "#ffb020"]];
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);
const rnd = (a, b) => a + Math.random() * (b - a);

let sides = null, timer = 0, seen = false, playing = false;

// lay out both crowds: rows from the back (smaller, higher) to the front, whose feet stand on the video's bottom edge
function layout() {
  if (!sides) return;
  const s = sec.getBoundingClientRect(), v = box.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const h = v.height, S = Math.max(26, Math.min(62, h / 6)), rows = h > 380 ? 5 : 3;
  let ids = [1462, ...shuffle(POOL), ...shuffle(POOL), ...shuffle(POOL), ...shuffle(POOL)];
  [[-s.left, v.left], [v.right - s.left, vw - v.right]].forEach(([x0, W], side) => {
    const el = sides[side];
    const pad = Math.max(14, W * 0.03);
    el.hidden = W - pad * 2 < S * 2;
    if (el.hidden) return (el.innerHTML = "");
    // a disco ball over the middle of the crowd, hanging from the video's top edge
    const bs = Math.round(S * 0.95);
    let html = `<div class="tr-ball" style="left:${(x0 + W / 2).toFixed(1)}px;top:${(v.top - s.top + bs * 0.55).toFixed(1)}px;--b:${bs}px"><i></i></div>`;
    for (let r = 0; r < rows; r++) {
      const k = 0.62 + (0.38 * r) / (rows - 1); // size: back row 62%, front row 100%
      const sz = Math.round(S * k);
      const top = h * 0.2 + bs * 0.6, base = top + ((h - top) * (r + 1)) / rows; // feet lines from near the top down to the video's bottom edge
      const gap = sz * rnd(1.3, 1.5), n = Math.max(1, Math.floor((W - pad * 2 - sz) / gap) + 1);
      const span = (n - 1) * gap, off = rnd(-gap / 2, gap / 2);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.18 && r < rows - 1) continue; // gaps, so it reads as groups, not a wall
        const t = ids.shift() || 1462;
        const x = Math.min(x0 + W - pad - sz / 2, Math.max(x0 + pad + sz / 2, x0 + W / 2 - span / 2 + i * gap + off + rnd(-sz * 0.15, sz * 0.15)));
        const y = v.top - s.top + base - sz * 1.2 - rnd(0, sz * 0.12);
        // distance from the video edge (0 = next to it) drives the play wave
        const near = side ? x - x0 : x0 + W - x;
        const d = rnd(0.9, 1.5).toFixed(2), dl = (-rnd(0, 1.5)).toFixed(2), ti = t - 1;
        html += `<div class="tr-c" data-near="${Math.round(near)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;z-index:${r + 1};--s:${sz}px;--d:${d}s;--dl:${dl}s">`
          + `<i class="tr-h" style="background-size:${sz * 45}px auto;background-position:${-(ti % 45) * sz}px ${-Math.floor(ti / 45) * sz}px"></i><i class="tr-l"></i></div>`;
      }
    }
    el.style.left = "0px";
    el.innerHTML = html;
  });
}

// one Chog hops and lets out a note (or a heart, mostly hearts while the trailer plays)
function hop(c, emo = true) {
  if (!c || c.classList.contains("hop")) return;
  c.classList.add("hop");
  c.addEventListener("animationend", () => c.classList.remove("hop"), { once: true });
  if (!emo) return;
  const [ch, col] = playing && Math.random() < 0.6 ? EMO[2] : EMO[Math.floor(Math.random() * EMO.length)];
  const e = document.createElement("span");
  const sz = parseFloat(c.style.getPropertyValue("--s"));
  e.className = "tr-e";
  e.textContent = ch;
  e.style.cssText = `left:${parseFloat(c.style.left)}px;top:${parseFloat(c.style.top) - sz * 0.35}px;--ec:${col};--es:${Math.round(sz * 0.42)}px;--ex:${rnd(-10, 10).toFixed(0)}px`;
  c.parentNode.appendChild(e);
  e.addEventListener("animationend", () => e.remove(), { once: true });
}

function tick() {
  if (!sides || document.hidden || !seen) return;
  const all = sides.flatMap((el) => [...el.querySelectorAll(".tr-c")]);
  for (let i = 0; i < (playing ? 2 : 1); i++) hop(all[Math.floor(Math.random() * all.length)]);
}

// on play: a wave runs outwards from the screen on both sides
function wave() {
  sides?.forEach((el) => el.querySelectorAll(".tr-c").forEach((c) => setTimeout(() => hop(c, Math.random() < 0.35), 120 + +c.dataset.near * 2.2)));
}

if (sec && box) {
  new IntersectionObserver((es) => {
    seen = es[0].isIntersecting;
    if (seen && !sides) {
      sides = [document.getElementById("trPartyL"), document.getElementById("trPartyR")];
      layout();
      if (!RM) timer = setInterval(tick, 900);
    }
  }, { rootMargin: "200px" }).observe(sec);
  let rz = 0;
  const relayout = () => (clearTimeout(rz), (rz = setTimeout(layout, 120)));
  new ResizeObserver(relayout).observe(box);
  addEventListener("resize", relayout);
  document.getElementById("trPlay")?.addEventListener("click", () => {
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    sec.classList.add("playing");
    playing = true;
    if (!RM) wave();
  });
}
