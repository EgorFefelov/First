/*
  seek.js — механика «Искатель».

  На кадре спрятана награда. Герой летает, находит её и подбирает на E,
  когда подлетел близко. Подобрал -> кадр пройден, переход открыт.
*/

Mechanics.register("seek", () => {
  let cfg;
  let reward;        // общий объект награды (createReward)

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      reward = createReward(cfg, scene.reward);
      const pos = (scene && scene.seek) || { x: 0.72, y: 0.40 };
      reward.x = cfg.canvasW * pos.x;
      reward.y = cfg.canvasH * pos.y;
      reward.visible = true;   // в «Искателе» награда на кадре сразу
    },

    update(bubble, keys, dtMs) {
      reward.update(dtMs);
    },

    // нажатие E внутри кадра: подобрать награду, если герой рядом.
    // вернуть true -> событие «съедено» (ядро не делает переход).
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

    // награда в зоне подбора — инвентарь покажет подсказку «E — взять»
    canPickup(bubble) {
      return reward.inReach(bubble);
    },

    isComplete() {
      return reward.animDone();
    },

    reset() {
      reward.reset();
      reward.visible = true;
    },
  };
});
