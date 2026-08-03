/*
  seek.js — механика «Искатель».

  На кадре спрятан магнитик. Бабл летает, находит его и подбирает на E,
  когда подлетел близко. Подобрал -> кадр пройден, переход открыт.
*/

Mechanics.register("seek", () => {
  let cfg;
  let magnet;        // общий объект магнитика (createMagnet)

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      magnet = createMagnet(cfg, scene.magnet);
      const pos = (scene && scene.seek) || { x: 0.72, y: 0.40 };
      magnet.x = cfg.canvasW * pos.x;
      magnet.y = cfg.canvasH * pos.y;
      magnet.visible = true;   // в «Искателе» магнитик на кадре сразу
    },

    update(bubble, keys, dtMs) {
      magnet.update(dtMs);
    },

    // нажатие E внутри кадра: подобрать магнитик, если Бабл рядом.
    // вернуть true -> событие «съедено» (game.js не делает переход).
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

    // магнитик в зоне подбора — game.js покажет подсказку «E — взять»
    canPickup(bubble) {
      return magnet.inReach(bubble);
    },

    isComplete() {
      return magnet.animDone();
    },

    reset() {
      magnet.reset();
      magnet.visible = true;
    },
  };
});
