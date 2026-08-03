(function () {
  let lastFramesKey = "";
  let pageEl;

  function ensurePage() {
    const root = document.getElementById("tab-comic");
    if (!root) return null;
    if (!pageEl) {
      root.insertAdjacentHTML("beforeend", `<div class="comic-page"><div class="comic-grid"></div></div>`);
      pageEl = root.querySelector(".comic-grid");
    }
    return pageEl;
  }

  function renderComic(state) {
    const page = ensurePage();
    if (!page) return;

    const frames = (state && state.comic && Array.isArray(state.comic.frames)) ? state.comic.frames : [];
    const key = JSON.stringify(frames.map(f => f.image));

    if (key === lastFramesKey) return;
    lastFramesKey = key;

    if (frames.length === 0) {
      page.innerHTML = "";
      return;
    }

    page.innerHTML = frames.map((frame, i) => {
      const variant = pickVariant(i, frames.length);
      const src = `${frame.image}?t=${Date.now()}`;
      return `
        <figure class="comic-frame" data-variant="${variant}">
          <img class="comic-frame-img" src="${src}" alt="">
        </figure>
      `;
    }).join("");
  }

  // Ритм страницы: full → half-half → full → half-half ...
  // Если кадров не хватает на пару — последний кадр идёт full.
  function pickVariant(index, total) {
    const cyclePos = index % 3; // 0 = full, 1 = half, 2 = half
    if (cyclePos === 0) return "full";
    // Если это последний кадр и он должен быть half (без пары) — делаем full
    if (cyclePos === 1 && index === total - 1) return "full";
    return "half";
  }

  window.StateManager && StateManager.onChange(renderComic);
})();
