/*
  dodge_collect.js — пример «своей механики» по контракту реестра (см. README.md).

  Идея-образец (леталка): по полю плывут ДВА вида объектов —
  - «цели» (targets): касание героем даёт +1 к счётчику и цель исчезает;
  - «помехи» (hazards): касание отнимает одну набранную цель (счётчик −1,
    не ниже нуля) и помеха исчезает — это «не увернулся».
  Набрал счётчик до CONFIG.dodgeGoal — isComplete() → переход открыт.

  Это не базовая механика набора, а образец: как ученик пишет СВОЮ механику
  под тему своей игры (методичка 2.4). Спрайт цели берётся из scene.reward
  (как у остальных механик); помеха рисуется примитивом — отдельный ассет не
  обязателен, но можно задать scene.hazardSprite.
*/

Mechanics.register("dodge_collect", () => {
  let cfg;
  let targetImg = null;
  let targetAspect = 1;
  let hazardImg = null;
  let hazardAspect = 2;   // спрайт помехи по умолчанию широкий (тело + хвост)
  let targets = [];       // активные цели: { x, y, vx, r }
  let hazards = [];       // активные помехи: { x, y, vx, vy, r, seed }
  let collected = 0;
  let spawnTargetT = 0;
  let spawnHazardT = 0;
  let pulse = 0;

  function goal() { return cfg.dodgeGoal || 10; }

  function spawnTarget() {
    const r = (cfg.dodgeTargetSize || 70) / 2;
    targets.push({
      x: cfg.canvasW + r,
      y: r + Math.random() * (cfg.canvasH - r * 2),
      vx: -(cfg.dodgeTargetSpeed || 2.4),
      r,
    });
  }

  function spawnHazard() {
    const r = (cfg.dodgeHazardSize || 64) / 2;
    const speed = (cfg.dodgeHazardSpeed || 3.2) * (0.85 + Math.random() * 0.4);
    hazards.push({
      x: cfg.canvasW + r,
      y: r + Math.random() * (cfg.canvasH - r * 2),
      vx: -speed,
      vy: 0,                          // летят ровно навстречу
      r,
      seed: Math.random() * 10,
    });
  }

  function hit(a, bubble, pad) {
    const bw = cfg.canvasH * cfg.heroScale * 0.5 * (pad || 0.6);
    return Math.hypot(a.x - bubble.x, a.y - bubble.y) < a.r + bw;
  }

  function drawHazard(ctx, hz) {
    if (!hazardImg || !hazardImg.complete) {
      // fallback: если спрайт помехи не задан (scene.hazardSprite) — рисуем примитив
      ctx.save();
      ctx.fillStyle = "#5a4636";
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    // высота спрайта = диаметр помехи; ширина — по пропорции (тело + хвост).
    // На картинке тело справа, хвост слева. Помеха летит ВЛЕВО, значит тело
    // должно быть спереди (слева) — отзеркаливаем по горизонтали. После зеркала
    // голова у левого края, совмещаем её с центром столкновения (hz.x, hz.y).
    const dh = hz.r * 2;
    const dw = dh * hazardAspect;
    ctx.save();
    ctx.translate(hz.x, hz.y);
    ctx.scale(-1, 1);
    ctx.drawImage(hazardImg, -dw + hz.r, -dh / 2, dw, dh);
    ctx.restore();
  }

  function drawCounter(ctx) {
    const text = `Собрано: ${collected} / ${goal()}`;
    ctx.save();
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const w = ctx.measureText(text).width + 36;
    const x = 28, y = 24, h = 52;
    ctx.fillStyle = "rgba(28,30,42,0.62)";
    ctx.beginPath();
    const r = 14;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + 18, y + 11);
    ctx.restore();
  }

  return {
    init(_ctx, _cfg, scene) {
      cfg = _cfg;
      collected = 0;
      targets = [];
      hazards = [];
      spawnTargetT = 0;
      spawnHazardT = 0;
      pulse = 0;
      if (scene && scene.reward) {
        targetImg = new Image();
        targetImg.onload = () => { targetAspect = targetImg.naturalWidth / targetImg.naturalHeight; };
        targetImg.src = scene.reward;
      }
      const hazardSrc = scene && scene.hazardSprite;
      if (hazardSrc) {
        hazardImg = new Image();
        hazardImg.onload = () => { hazardAspect = hazardImg.naturalWidth / hazardImg.naturalHeight; };
        hazardImg.src = hazardSrc;
      }
    },

    update(bubble, keys, dtMs) {
      if (collected >= goal()) return;   // победа — поле замирает
      pulse += 0.08;

      // спавн по таймерам (в мс)
      spawnTargetT -= dtMs;
      spawnHazardT -= dtMs;
      if (spawnTargetT <= 0) { spawnTarget(); spawnTargetT = cfg.dodgeTargetEvery || 900; }
      if (spawnHazardT <= 0) { spawnHazard(); spawnHazardT = cfg.dodgeHazardEvery || 1100; }

      // движение + столкновения целей
      for (const t of targets) t.x += t.vx;
      for (const t of targets) {
        if (hit(t, bubble, 0.8)) { t.dead = true; collected++; }
      }
      targets = targets.filter((t) => !t.dead && t.x > -t.r * 2);

      // движение + столкновения помех
      for (const hz of hazards) { hz.x += hz.vx; hz.y += hz.vy; }
      for (const hz of hazards) {
        if (hit(hz, bubble, 0.55)) {
          hz.dead = true;
          if (collected > 0) collected--;   // не увернулся — теряешь цель
        }
      }
      hazards = hazards.filter((hz) =>
        !hz.dead && hz.x > -hz.r * 2 && hz.y < cfg.canvasH + hz.r * 2);
    },

    draw(ctx) {
      // помехи под целями
      for (const hz of hazards) drawHazard(ctx, hz);

      // цели со спрайтом (мерцание)
      for (const t of targets) {
        const h = (cfg.dodgeTargetSize || 70) * (1 + Math.sin(pulse + t.y) * 0.05);
        const w = h * targetAspect;
        if (targetImg && targetImg.complete) {
          ctx.drawImage(targetImg, t.x - w / 2, t.y - h / 2, w, h);
        } else if (window.drawStar) {
          window.drawStar(ctx, t.x, t.y, h * 0.4);
        }
      }

      drawCounter(ctx);

      if (collected >= goal()) {
        ctx.save();
        ctx.font = "800 48px system-ui, sans-serif";
        ctx.fillStyle = "#ffd86b";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 6;
        ctx.textAlign = "center";
        ctx.strokeText("Готово! →", cfg.canvasW / 2, cfg.canvasH * 0.16);
        ctx.fillText("Готово! →", cfg.canvasW / 2, cfg.canvasH * 0.16);
        ctx.restore();
      }
    },

    isComplete() {
      return collected >= goal();
    },

    reset() {
      collected = 0;
      targets = [];
      hazards = [];
      spawnTargetT = 0;
      spawnHazardT = 0;
    },
  };
});
