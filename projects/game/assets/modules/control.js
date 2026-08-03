/*
  control.js — модуль УПРАВЛЕНИЯ: полёт героя стрелками.

  Вынесен из прежнего ядра (физика update). Управляет только состоянием
  bubble (vx/vy/x/y/tilt), ничего не рисует. Контракт модуля — PLAN.md.

  Подключается: <script> в index.html (после registry, до core) + "control" в
  CONFIG.MODULES. Наставник делает это на шаге курса 2.1.3.
*/

Modules.register("control", () => {
  let heroSize = 0;   // размер спрайта в px (для упора в края), берём из cfg

  return {
    // ресурсов нет — setup не нужен; size считаем в init (cfg под рукой)
    init(ctx, cfg) {
      heroSize = cfg.canvasH * cfg.heroScale;
    },

    update(bubble, keys, dtMs) {
      const cfg = CONFIG;

      // разгон по нажатым стрелкам
      if (keys["ArrowLeft"])  bubble.vx -= cfg.accel;
      if (keys["ArrowRight"]) bubble.vx += cfg.accel;
      if (keys["ArrowUp"])    bubble.vy -= cfg.accel;
      if (keys["ArrowDown"])  bubble.vy += cfg.accel;

      // трение — герой плавно тормозит, «парит»
      bubble.vx *= cfg.friction;
      bubble.vy *= cfg.friction;

      // ограничение скорости
      bubble.vx = Math.max(-cfg.maxSpeed, Math.min(cfg.maxSpeed, bubble.vx));
      bubble.vy = Math.max(-cfg.maxSpeed, Math.min(cfg.maxSpeed, bubble.vy));

      // позиция
      bubble.x += bubble.vx;
      bubble.y += bubble.vy;

      // упор в края кадра. отступ — доля размера спрайта (edgePad).
      const pad = heroSize * cfg.edgePad;
      if (bubble.x < pad) { bubble.x = pad; bubble.vx = 0; }
      if (bubble.x > cfg.canvasW - pad) { bubble.x = cfg.canvasW - pad; bubble.vx = 0; }
      if (bubble.y < pad) { bubble.y = pad; bubble.vy = 0; }
      if (bubble.y > cfg.canvasH - pad) { bubble.y = cfg.canvasH - pad; bubble.vy = 0; }

      // наклон в сторону движения — крен пропорционален горизонтальной скорости
      const targetTilt = (bubble.vx / cfg.maxSpeed) * cfg.tiltMax;
      bubble.tilt += (targetTilt - bubble.tilt) * cfg.tiltEase;
    },

    // resetScene/resetGame не нужны: ядро на входе на кадр само обнуляет
    // bubble.vx/vy и позицию. У control нет кросс-кадрового состояния.
  };
});
