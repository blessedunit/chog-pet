// The trailer near the bottom, as a little Chogtown cinema: a marquee, a still with a play button and a few Chogs
// watching from the sides. The YouTube player loads only on a tap (no cookies until then).
const sec = document.getElementById("trailer");
const box = document.getElementById("trVideo");

// the audience: #953 (token 1462) plus 5 picked from a hand-checked pool (token ids; some hats carry words we don't want here)
const POOL = [309, 1942, 149, 1040, 1292, 127, 99, 177, 870, 144, 186, 1864, 122, 1682];
function seat() {
  const all = [1462, ...POOL.sort(() => Math.random() - 0.5).slice(0, 9)].sort(() => Math.random() - 0.5);
  const twinkles = '<i class="tr-tw t0">✦</i><i class="tr-tw t1">✦</i><i class="tr-tw t2">✦</i>';
  [["trCrowdL", all.slice(0, 5)], ["trCrowdR", all.slice(5)]].forEach(([el, row]) => {
    document.getElementById(el).innerHTML = row
      .map((id, i) => `<a class="tr-fan f${i}" href="/?token=${id}" style="--d:${(Math.random() * 2).toFixed(2)}s" aria-label="Visit this Chog"><img src="/chogs/${id}.webp" alt="" loading="lazy" decoding="async" width="96" height="96" /></a>`)
      .join("") + twinkles;
  });
}

if (sec && box) {
  // fill the seats only when the section comes near, the art is lazy anyway
  new IntersectionObserver((es, o) => es[0].isIntersecting && (seat(), o.disconnect()), { rootMargin: "400px" }).observe(sec);
  document.getElementById("trPlay")?.addEventListener("click", () => {
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    sec.classList.add("playing");
  });
}
