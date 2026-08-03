// Рендер комикса. Читает data/state.json (кадры + история), рисует ленту кадров.
// Пока кадров нет — показывает заглушку, а не пустоту.
(function () {
  let lastKey = "";
  let pageEl;

  function ensurePage(root) {
    if (!pageEl || !root.contains(pageEl)) {
      root.innerHTML = `<div class="comic-page"><div class="comic-grid"></div></div>`;
      pageEl = root.querySelector(".comic-grid");
    }
    return pageEl;
  }

  function renderComic(state) {
    const root = document.getElementById("tab-comic");
    if (!root) return;

    const frames = (state && state.comic && Array.isArray(state.comic.frames)) ? state.comic.frames : [];
    const story = (state && Array.isArray(state.story)) ? state.story : [];
    const key = JSON.stringify([frames, story]);
    if (key === lastKey) return;
    lastKey = key;

    if (frames.length === 0) {
      pageEl = null;
      root.innerHTML = `
        <div class="comic-empty">
          <p>Здесь появится твой комикс.</p>
          <p class="comic-empty-hint">Сначала придумаешь историю, потом нарисуешь кадры.</p>
        </div>
      `;
      return;
    }

    const page = ensurePage(root);
    page.innerHTML = frames.map((frame, i) => {
      const variant = pickVariant(i, frames.length);
      const src = `${frame.image}?t=${Date.now()}`;
      // Подпись — текст сцены из истории. Кадр и сцена совпадают по порядку;
      // если у кадра указан story_index — берём по нему.
      const idx = Number.isInteger(frame.story_index) ? frame.story_index : i;
      const caption = story[idx] && story[idx].text ? story[idx].text : "";
      return `
        <figure class="comic-frame" data-variant="${variant}">
          <img class="comic-frame-img" src="${src}" alt="">
          ${caption ? `<figcaption class="comic-caption">${escapeHtml(caption)}</figcaption>` : ""}
        </figure>
      `;
    }).join("");
  }

  // Ритм страницы: full → half-half → full → half-half ...
  // Если кадров не хватает на пару — последний кадр идёт full.
  function pickVariant(index, total) {
    const cyclePos = index % 3; // 0 = full, 1 = half, 2 = half
    if (cyclePos === 0) return "full";
    if (cyclePos === 1 && index === total - 1) return "full";
    return "half";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  window.StateManager && StateManager.onChange(renderComic);
})();
