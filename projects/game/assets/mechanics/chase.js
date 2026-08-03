/*
  chase.js — механика «Догонялки».

  Награда дрейфует по кадру и убегает от героя, когда тот близко. Нужно
  догнать, подлететь вплотную и подобрать на E.
*/

Mechanics.register("chase", () => {
  let cfg;
  let reward;
  let vx = 0, vy = 0;   // скорость дрейфа награды

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      vx = 0;
      vy = 0;
      reward = createReward(cfg, scene.reward);
      const pos = (scene && scene.chase) || { x: 0.55, y: 0.40 };
      reward.x = cfg.canvasW * pos.x;
      reward.y = cfg.canvasH * pos.y;
      reward.visible = true;
    },

    update(bubble, keys, dtMs) {
      reward.update(dtMs);
      if (reward.picked) return;   // пойман — не двигается

      const dx = reward.x - bubble.x;
      const dy = reward.y - bubble.y;
      const dist = Math.hypot(dx, dy) || 1;

      // убегание от героя при близости
      if (dist < cfg.chaseFleeRange) {
        vx += (dx / dist) * cfg.chaseFleeAccel;
        vy += (dy / dist) * cfg.chaseFleeAccel;
      }
      // лёгкий дрейф к центру — не залипает в углу
      vx += (cfg.canvasW / 2 - reward.x) * 0.0008;
      vy += (cfg.canvasH / 2 - reward.y) * 0.0008;

      // трение + лимит скорости
      vx *= cfg.chaseFriction;
      vy *= cfg.chaseFriction;
      const sp = Math.hypot(vx, vy);
      if (sp > cfg.chaseMaxSpeed) {
        vx = (vx / sp) * cfg.chaseMaxSpeed;
        vy = (vy / sp) * cfg.chaseMaxSpeed;
      }

      reward.x += vx;
      reward.y += vy;

      // отскок от краёв
      const m = cfg.rewardSize / 2;
      if (reward.x < m) { reward.x = m; vx *= -0.6; }
      if (reward.x > cfg.canvasW - m) { reward.x = cfg.canvasW - m; vx *= -0.6; }
      if (reward.y < m) { reward.y = m; vy *= -0.6; }
      if (reward.y > cfg.canvasH - m) { reward.y = cfg.canvasH - m; vy *= -0.6; }
    },

    onAction(bubble) {
      if (reward.inReach(bubble)) {
        reward.pick();
        return true;
      }
      return false;
    },

    draw(ctx) {
      reward.draw(ctx);
    },

    canPickup(bubble) {
      return reward.inReach(bubble);
    },

    isComplete() {
      return reward.animDone();
    },

    reset() {
      vx = 0;
      vy = 0;
      reward.reset();
      reward.visible = true;
    },
  };
});
