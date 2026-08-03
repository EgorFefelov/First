/*
  collect.js — механика «Собиратель».

  Награда разбита на кусочки, разбросанные по кадру. Герой облетает и собирает
  их касанием (на лету — в этом динамика механики). Собрал все -> в центре
  кадра складывается целая награда, подбирается на E.
*/

Mechanics.register("collect", () => {
  let cfg;
  let pieces;        // [{ x, y, r, taken }]
  let pulse = 0;
  let reward;        // целая награда — появляется после сбора всех кусочков

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
      // позиция собранной награды — настраиваемая, дефолт центр-верх
      const finalPos = (scene && scene.collectFinal) || { x: 0.5, y: 0.45 };
      reward = createReward(cfg, scene.reward);
      reward.x = cfg.canvasW * finalPos.x;
      reward.y = cfg.canvasH * finalPos.y;
      reward.visible = false;   // появится, когда все кусочки собраны
    },

    update(bubble, keys, dtMs) {
      pulse += 0.08;
      reward.update(dtMs);

      // сбор кусочков касанием
      const reachBase = cfg.canvasH * cfg.heroScale * 0.32;
      for (const p of pieces) {
        if (p.taken) continue;
        const d = Math.hypot(bubble.x - p.x, bubble.y - p.y);
        if (d < p.r + reachBase) p.taken = true;
      }
      // все кусочки собраны -> показать целую награду
      if (!reward.visible && pieces.every((p) => p.taken)) {
        reward.visible = true;
      }
    },

    onAction(bubble) {
      if (reward.inReach(bubble)) {
        reward.pick();
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
      // целая награда после сбора
      reward.draw(ctx);
    },

    canPickup(bubble) {
      return reward.inReach(bubble);
    },

    isComplete() {
      return reward.animDone();
    },

    reset() {
      pulse = 0;
      for (const p of pieces) p.taken = false;
      reward.reset();
      reward.visible = false;
    },
  };
});
