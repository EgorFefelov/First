// tabs.js (демо) — копия курсового tabs.js с поддержкой третьего таба «Игра»
// и без disabled-логики (на демке все три таба открыты сразу).
(function () {
  let activeTab = "gallery";
  let els = {};
  let btns;

  function setup() {
    els.gallery = document.getElementById("tab-gallery");
    els.comic   = document.getElementById("tab-comic");
    els.game    = document.getElementById("tab-game");
    btns = Array.from(document.querySelectorAll(".tab-btn"));

    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const tab = btn.dataset.tab;
        if (tab === activeTab) return;
        activeTab = tab;
        applyView();
        // при переходе в «Игру» — фокус на canvas
        if (tab === "game") {
          const c = document.getElementById("game");
          if (c) c.focus();
        }
      });
    });

    applyView();
  }

  function applyView() {
    btns.forEach(btn => {
      btn.classList.toggle("tab-active", btn.dataset.tab === activeTab);
    });
    Object.entries(els).forEach(([key, el]) => {
      if (el) el.hidden = (key !== activeTab);
    });
  }

  document.addEventListener("DOMContentLoaded", setup);
})();
