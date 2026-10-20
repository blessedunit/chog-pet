// The trailer near the bottom: a still with a play button, the YouTube player loads only on a tap (no cookies until then).
const box = document.getElementById("trVideo");
const play = (t = 0) => {
  const id = box.dataset.id;
  box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&start=${t}" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
};
if (box) {
  document.getElementById("trPlay")?.addEventListener("click", () => play());
  document.getElementById("trCh")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-t]");
    if (!b) return;
    play(+b.dataset.t);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
