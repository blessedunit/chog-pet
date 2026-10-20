// The trailer near the bottom: a still with a play button, the YouTube player loads only on a tap (no cookies until then).
const box = document.getElementById("trVideo");
document.getElementById("trPlay")?.addEventListener("click", () => {
  box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Chog Pet trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
});
