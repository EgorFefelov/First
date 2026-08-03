(function () {
  let currentIndex = 0;
  let lastSeenLength = 0;
  let stage, placeholder, img, controls, prev, next, counter;

  function buildSkeleton(area) {
    area.insertAdjacentHTML("beforeend", `
      <div class="gallery-stage">
        <div class="gallery-placeholder">здесь появятся твои картинки</div>
        <img class="gallery-image" alt="" hidden>
      </div>
      <div class="gallery-controls" hidden>
        <button class="gallery-btn gallery-prev" type="button">◀</button>
        <span class="gallery-counter">0 / 0</span>
        <button class="gallery-btn gallery-next" type="button">▶</button>
      </div>
    `);

    stage = area.querySelector(".gallery-stage");
    placeholder = area.querySelector(".gallery-placeholder");
    img = area.querySelector(".gallery-image");
    controls = area.querySelector(".gallery-controls");
    prev = area.querySelector(".gallery-prev");
    next = area.querySelector(".gallery-next");
    counter = area.querySelector(".gallery-counter");

    prev.addEventListener("click", () => {
      if (currentIndex > 0) { currentIndex--; applyView(); }
    });
    next.addEventListener("click", () => {
      if (currentIndex < lastSeenLength - 1) { currentIndex++; applyView(); }
    });

    area.dataset.galleryReady = "1";
  }

  function applyView() {
    if (lastSeenLength === 0) {
      placeholder.hidden = false;
      img.hidden = true;
      controls.hidden = true;
      return;
    }
    const item = StateManager.gallery.images[currentIndex];
    placeholder.hidden = true;
    img.hidden = false;
    img.src = `${item.path}?t=${Date.now()}`;
    controls.hidden = false;
    counter.textContent = `${currentIndex + 1} / ${lastSeenLength}`;
    prev.disabled = (currentIndex === 0);
    next.disabled = (currentIndex === lastSeenLength - 1);
  }

  function renderGallery(state, gallery) {
    const area = document.getElementById("gallery-area");
    if (!area) return;
    if (!area.dataset.galleryReady) buildSkeleton(area);

    const images = (gallery && Array.isArray(gallery.images)) ? gallery.images : [];

    if (images.length === 0) {
      lastSeenLength = 0;
      currentIndex = 0;
      applyView();
      return;
    }

    if (images.length > lastSeenLength) {
      currentIndex = images.length - 1;
    }
    currentIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
    lastSeenLength = images.length;
    applyView();
  }

  window.StateManager && StateManager.onChange(renderGallery);
})();
