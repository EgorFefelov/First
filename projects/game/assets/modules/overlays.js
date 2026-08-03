/*
  overlays.js — модуль ОВЕРЛЕЕВ: стартовый и финальный экраны.

  Вынесен из inline-script index.html. Модуль САМ создаёт DOM оверлеев (на старте
  index.html без их разметки — «оверлеев нет» = модуль не подключён). Стили — в
  assets/overlays.css (<link> в index.html). Контракт модуля — PLAN.md.

  DOM создаётся в setup(), НЕ на верхнем уровне файла: на верхнем уровне GameAPI
  ещё не существует (core.js грузится последним). setup ядро зовёт после создания
  GameAPI.

  Подключается: <script> + <link overlays.css> + "overlays" в CONFIG.MODULES.
  Наставник делает это на шаге курса 2.5.
*/

Modules.register("overlays", () => {

  // controls-блок (стрелки + E) — общий для старта и финала
  function controlsHTML() {
    return `
      <div class="controls">
        <span class="group">
          <span class="k">←</span><span class="k">↑</span><span class="k">↓</span><span class="k">→</span>
          <span class="label">— перемещение</span>
        </span>
        <span class="group">
          <span class="k">E</span>
          <span class="label">— действие</span>
        </span>
      </div>`;
  }

  return {
    setup() {
      const wrap = document.getElementById("game-wrap");
      const canvas = document.getElementById("game");
      if (!wrap || !canvas) return;

      const title = (CONFIG.title && CONFIG.title.trim()) || "Моя игра";

      // --- стартовый оверлей ---
      const start = document.createElement("div");
      start.id = "start";
      start.className = "overlay";
      start.innerHTML = `
        <div class="head">
          <h1 class="title">${title}</h1>
          <p class="subtitle">Пройди все кадры истории и собери награды</p>
        </div>
        <button class="play" type="button" id="start-btn">▶ Играть</button>
        ${controlsHTML()}`;
      wrap.appendChild(start);

      // --- финальный оверлей (скрыт) ---
      const finish = document.createElement("div");
      finish.id = "finish";
      finish.className = "overlay";
      finish.hidden = true;
      finish.innerHTML = `
        <div class="head">
          <h1 class="title">Победа!</h1>
          <p class="subtitle">История пройдена до конца.</p>
        </div>
        <button class="play" type="button" id="restart-btn">↻ Повторить</button>
        ${controlsHTML()}`;
      wrap.appendChild(finish);

      // --- обработчики ---
      start.querySelector("#start-btn").addEventListener("click", () => {
        start.hidden = true;
        canvas.focus();
      });
      finish.querySelector("#restart-btn").addEventListener("click", () => {
        finish.hidden = true;
        GameAPI.restart();   // ядро уже существует (setup зовётся после GameAPI)
        canvas.focus();
      });

      // финал-хук: transitions/ядро зовут window.onGameFinish() при переходе с
      // последнего кадра. До этого модуля он был no-op (typeof-guard) — корректное
      // промежуточное состояние шагов 3–4.
      window.onGameFinish = () => { finish.hidden = false; };
    },
  };
});
