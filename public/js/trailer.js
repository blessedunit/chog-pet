// The trailer near the bottom, as a little Chogtown cinema: a marquee, a still with a play button and two hearts
// made of Chog faces beside it, exactly as tall as the video. They beat softly; once the trailer plays they fill
// with pink row by row. The YouTube player loads only on a tap (no cookies until then).
const sec = document.getElementById("trailer");
const box = document.getElementById("trVideo");

// #953 (token 1462) plus a hand-checked pool (token ids; some hats carry words we don't want here)
const POOL = [309, 1942, 149, 1040, 1292, 127, 99, 177, 870, 144, 186, 1864, 122, 1682, 338, 1413, 577, 982, 1655, 1050,
  376, 1035, 484, 1911, 142, 1888, 1960, 1107, 1019, 1950, 755, 1513, 1921];
const HEART = [" ##   ## ", "#### ####", "#########", "#########", " ####### ", "  #####  ", "   ###   ", "    #    "];
const CELLS = HEART.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === "#" ? [{ r, c }] : [])));
const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);

let hearts = null;

function build() {
  // 92 seats from 34 Chogs: each one shows up two or three times, spread out by the shuffles
  const ids = [1462, ...shuffle(POOL), ...shuffle(POOL), ...shuffle(POOL)].slice(0, CELLS.length * 2);
  ids.sort(() => Math.random() - 0.5);
  hearts = ["trHeartL", "trHeartR"].map((id, side) => {
    const el = document.getElementById(id);
    el.innerHTML = CELLS.map((_, i) => {
      const t = ids[side * CELLS.length + i];
      return `<a class="tr-face" href="/?token=${t}" tabindex="-1" data-t="${t - 1}"></a>`;
    }).join("");
    return el;
  });
  layout();
}

// fit each heart into the space between the page edge and the video: its faces span exactly the video's height
// (or less, centred on it, when the side is too narrow)
function layout() {
  if (!hearts) return;
  const s = sec.getBoundingClientRect(), v = box.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const R = HEART.length, C = HEART[0].length, k = 0.72; // face = 72% of a cell, the rest is air
  [[-s.left, v.left], [v.right - s.left, vw - v.right]].forEach(([x0, W], i) => {
    const el = hearts[i];
    const pad = Math.max(16, W * 0.03);
    const cell = Math.min(v.height / (R - 1 + k), (W - pad * 2) / (C - 1 + k));
    const size = Math.floor(cell * k);
    el.hidden = W < 180 || size < 14;
    if (el.hidden) return;
    const w = (C - 1) * cell + size, h = (R - 1) * cell + size;
    const left = x0 + (W - w) / 2, top = v.top - s.top + (v.height - h) / 2;
    Object.assign(el.style, { left: left + "px", top: top + "px", width: w + "px", height: h + "px", transformOrigin: "50% 50%" });
    [...el.children].forEach((f, j) => {
      const { r, c } = CELLS[j], t = +f.dataset.t;
      Object.assign(f.style, {
        width: size + "px", height: size + "px", transform: `translate(${c * cell}px, ${r * cell}px)`,
        backgroundSize: `${size * 45}px auto`, backgroundPosition: `${-(t % 45) * size}px ${-Math.floor(t / 45) * size}px`,
      });
    });
  });
}

// on play: the hearts fill with pink from the bottom row up
function fill() {
  for (let r = HEART.length - 1, n = 0; r >= 0; r--, n++)
    setTimeout(() => hearts?.forEach((h) => [...h.children].forEach((f, j) => CELLS[j].r === r && f.classList.add("hot"))), n * 260);
}

if (sec && box) {
  new IntersectionObserver((es, o) => es[0].isIntersecting && (build(), o.disconnect()), { rootMargin: "400px" }).observe(sec);
  new ResizeObserver(() => layout()).observe(box);
  addEventListener("resize", layout);
  document.getElementById("trPlay")?.addEventListener("click", () => {
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    sec.classList.add("playing");
    fill();
  });
}
