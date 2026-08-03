/*
  chase.js — механика «Догонялки».

  Магнитик дрейфует по кадру и убегает от Бабла, когда тот близко. Нужно
  догнать, подлететь вплотную и подобрать на E.
*/

Mechanics.register("chase", () => {
  let cfg;
  let magnet;
  let vx = 0, vy = 0;   // скорость дрейфа магнитика

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      vx = 0;
      vy = 0;
      magnet = createMagnet(cfg, scene.magnet);
      const pos = (scene && scene.chase) || { x: 0.55, y: 0.40 };
      magnet.x = cfg.canvasW * pos.x;
      magnet.y = cfg.canvasH * pos.y;
      magnet.visible = true;
    },

    update(bubble, keys, dtMs) {
      magnet.update(dtMs);
      if (magnet.picked) return;   // пойман — не двигается

      const dx = magnet.x - bubble.x;
      const dy = magnet.y - bubble.y;
      const dist = Math.hypot(dx, dy) || 1;

      // убегание от Бабла при близости
      if (dist < cfg.chaseFleeRange) {
        vx += (dx / dist) * cfg.chaseFleeAccel;
        vy += (dy / dist) * cfg.chaseFleeAccel;
      }
      // лёгкий дрейф к центру — не залипает в углу
      vx += (cfg.canvasW / 2 - magnet.x) * 0.0008;
      vy += (cfg.canvasH / 2 - magnet.y) * 0.0008;

      // трение + лимит скорости
      vx *= cfg.chaseFriction;
      vy *= cfg.chaseFriction;
      const sp = Math.hypot(vx, vy);
      if (sp > cfg.chaseMaxSpeed) {
        vx = (vx / sp) * cfg.chaseMaxSpeed;
        vy = (vy / sp) * cfg.chaseMaxSpeed;
      }

      magnet.x += vx;
      magnet.y += vy;

      // отскок от краёв
      const m = cfg.magnetSize / 2;
      if (magnet.x < m) { magnet.x = m; vx *= -0.6; }
      if (magnet.x > cfg.canvasW - m) { magnet.x = cfg.canvasW - m; vx *= -0.6; }
      if (magnet.y < m) { magnet.y = m; vy *= -0.6; }
      if (magnet.y > cfg.canvasH - m) { magnet.y = cfg.canvasH - m; vy *= -0.6; }
    },

    onAction(bubble) {
      if (magnet.inReach(bubble)) {
        magnet.pick();
        return true;
      }
      return false;
    },

    draw(ctx) {
      magnet.draw(ctx);
    },

    canPickup(bubble) {
      return magnet.inReach(bubble);
    },

    isComplete() {
      return magnet.animDone();
    },

    reset() {
      vx = 0;
      vy = 0;
      magnet.reset();
      magnet.visible = true;
    },
  };
});
