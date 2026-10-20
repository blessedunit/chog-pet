// The trailer near the bottom, as a little Chogtown cinema: a marquee, a still with a play button and Chogs
// watching from both sides. The YouTube player loads only on a tap (no cookies until then).
const sec = document.getElementById("trailer");
const box = document.getElementById("trVideo");

// the audience: #953 (token 1462) plus Chogs from a hand-checked pool (token ids; some hats carry words we don't want here)
const POOL = [309, 1942, 149, 1040, 1292, 127, 99, 177, 870, 144, 186, 1864, 122, 1682, 338, 1413, 577, 982, 1655, 1050,
  376, 1035, 484, 1911, 142, 1888, 1960, 1107, 1019, 1950, 755, 1513, 1921];
// seats as [x from the outer edge in %, bottom in px, size in px]; the right side mirrors the left
const SEATS = [[0, 8, 66], [36, 22, 72], [74, 4, 58], [14, 122, 56], [54, 132, 52], [2, 228, 48], [38, 246, 54], [76, 214, 46], [18, 340, 44], [58, 352, 42], [34, 440, 36]];
const STARS = [[80, 446, 14], [6, 446, 11], [92, 124, 10], [76, 306, 12], [2, 160, 9]];
const shuffle = (a) => a.sort(() => Math.random() - 0.5);

function seat() {
  const ids = shuffle([1462, ...shuffle(POOL).slice(0, SEATS.length * 2 - 1)]);
  ["trCrowdL", "trCrowdR"].forEach((el, side) => {
    const fans = SEATS.map(([x, b, w], i) => {
      const id = ids[side * SEATS.length + i];
      return `<a class="tr-fan" href="/?token=${id}" style="--x:${x}%;--b:${b}px;--w:${w}px;--d:${(Math.random() * 2.4).toFixed(2)}s;z-index:${10 - i}" aria-label="Visit this Chog"><img src="/chogs/${id}.webp" alt="" loading="lazy" decoding="async" width="96" height="96" /></a>`;
    });
    const stars = STARS.map(([x, b, s], i) => `<i class="tr-tw" style="--x:${x}%;--b:${b}px;font-size:${s}px;animation-delay:${(i * 0.8 + side * 0.4).toFixed(1)}s">✦</i>`);
    document.getElementById(el).innerHTML = fans.join("") + stars.join("");
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
