/*
  fog.js — механика «Проявитель» (туман).

  Кадр затянут полупрозрачным слоем тумана. Герой рассеивает его движением.
  Рассеял ~порог -> появляется награда; подлетел и подобрал на E -> пройдено.

  Туман — offscreen-слой, герой «протирает» дырки через destination-out.
*/

Mechanics.register("fog", () => {
  let cfg;
  let fog, fctx;     // offscreen-canvas тумана
  let cleared = 0;   // доля рассеянного 0..1
  let revealed = false;
  let reward;

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      cleared = 0;
      revealed = false;

      fog = document.createElement("canvas");
      fog.width = cfg.canvasW;
      fog.height = cfg.canvasH;
      fctx = fog.getContext("2d");
      fillFog();

      reward = createReward(cfg, scene.reward);
      const pos = (scene && scene.fog) || { x: 0.5, y: 0.45 };
      reward.x = cfg.canvasW * pos.x;
      reward.y = cfg.canvasH * pos.y;
      reward.visible = false;   // награда скрыта, пока туман не рассеян
    },

    update(bubble, keys, dtMs) {
      reward.update(dtMs);

      if (!revealed) {
        // герой протирает дырку в тумане под собой
        const r = cfg.canvasH * cfg.heroScale * 0.42;
        fctx.save();
        fctx.globalCompositeOperation = "destination-out";
        const g = fctx.createRadialGradient(bubble.x, bubble.y, 0, bubble.x, bubble.y, r);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        fctx.fillStyle = g;
        fctx.beginPath();
        fctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2);
        fctx.fill();
        fctx.restore();

        cleared = measureCleared();
        if (cleared >= cfg.fogThreshold) {
          revealed = true;
          reward.visible = true;
        }
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
      // слой тумана поверх фона
      if (!revealed) ctx.drawImage(fog, 0, 0);
      // награда (появляется после рассеивания)
      reward.draw(ctx);
    },

    canPickup(bubble) {
      return reward.inReach(bubble);
    },

    isComplete() {
      return reward.animDone();
    },

    reset() {
      cleared = 0;
      revealed = false;
      reward.reset();
      reward.visible = false;
      if (fctx) fillFog();
    },
  };

  // --- внутреннее ---

  function fillFog() {
    fctx.globalCompositeOperation = "source-over";
    fctx.clearRect(0, 0, fog.width, fog.height);
    fctx.fillStyle = cfg.fogColor;
    fctx.fillRect(0, 0, fog.width, fog.height);
  }

  function measureCleared() {
    const step = cfg.fogSampleStep;
    const data = fctx.getImageData(0, 0, fog.width, fog.height).data;
    let total = 0, clear = 0;
    for (let y = 0; y < fog.height; y += step) {
      for (let x = 0; x < fog.width; x += step) {
        const alpha = data[(y * fog.width + x) * 4 + 3];
        total++;
        if (alpha < 40) clear++;
      }
    }
    return total ? clear / total : 0;
  }
});
