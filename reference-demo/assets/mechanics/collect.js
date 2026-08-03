/*
  collect.js — механика «Собиратель».

  Магнитик разбит на кусочки, разбросанные по кадру. Бабл облетает и собирает
  их касанием (на лету — в этом динамика механики). Собрал все -> в центре
  кадра складывается целый магнитик, подбирается на E.
*/

Mechanics.register("collect", () => {
  let cfg;
  let pieces;        // [{ x, y, r, taken }]
  let pulse = 0;
  let magnet;        // целый магнитик — появляется после сбора всех кусочков

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      pulse = 0;
      const layout = (scene && scene.collect) || [
        { x: 0.22, y: 0.35 },
        { x: 0.50, y: 0.62 },
        { x: 0.78, y: 0.32 },
      ];
      pieces = layout.map((p) => ({
        x: cfg.canvasW * p.x,
        y: cfg.canvasH * p.y,
        r: cfg.canvasH * 0.032,
        taken: false,
      }));
      // позиция собранного магнитика — настраиваемая, дефолт центр-верх
      const finalPos = (scene && scene.collectFinal) || { x: 0.5, y: 0.45 };
      magnet = createMagnet(cfg, scene.magnet);
      magnet.x = cfg.canvasW * finalPos.x;
      magnet.y = cfg.canvasH * finalPos.y;
      magnet.visible = false;   // появится, когда все кусочки собраны
    },

    update(bubble, keys, dtMs) {
      pulse += 0.08;
      magnet.update(dtMs);

      // сбор кусочков касанием
      const reachBase = cfg.canvasH * cfg.babbleScale * 0.32;
      for (const p of pieces) {
        if (p.taken) continue;
        const d = Math.hypot(bubble.x - p.x, bubble.y - p.y);
        if (d < p.r + reachBase) p.taken = true;
      }
      // все кусочки собраны -> показать целый магнитик
      if (!magnet.visible && pieces.every((p) => p.taken)) {
        magnet.visible = true;
      }
    },

    onAction(bubble) {
      if (magnet.inReach(bubble)) {
        magnet.pick();
        return true;
      }
      return false;
    },

    draw(ctx) {
      // несобранные кусочки — мерцающие звёздочки
      for (const p of pieces) {
        if (p.taken) continue;
        const r = p.r * (1 + Math.sin(pulse) * 0.14);
        drawStar(ctx, p.x, p.y, r);
      }
      // целый магнитик после сбора
      magnet.draw(ctx);
    },

    canPickup(bubble) {
      return magnet.inReach(bubble);
    },

    isComplete() {
      return magnet.animDone();
    },

    reset() {
      pulse = 0;
      for (const p of pieces) p.taken = false;
      magnet.reset();
      magnet.visible = false;
    },
  };
});
