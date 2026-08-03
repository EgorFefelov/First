/*
  transitions.js — модуль ПЕРЕХОДОВ между кадрами + подсказки выхода.

  Вынесен из прежнего ядра (inExitZone / tryAdvance / drawExitHint /
  drawHintPill). Модуль НЕ меняет sceneIndex сам — зовёт GameAPI.gotoNext().
  «Кадр пройден» берёт из GameAPI.sceneState().complete. Контракт — PLAN.md.

  Инвариант подсказок (PLAN.md): exit-hint рисуем ТОЛЬКО когда кадр пройден
  (complete). На непройденном кадре у правого края — намёк «сначала найди
  награду». pickup-hint (модуль inventory) и exit-hint не накладываются.

  Подключается: <script> в index.html (после control, до core) + "transitions"
  в CONFIG.MODULES. Наставник делает это на шаге курса 2.1.4.
*/

Modules.register("transitions", () => {

  // герой в зоне выхода у правого края?
  function inExitZone(bubble) {
    return bubble.x > CONFIG.canvasW * (1 - CONFIG.exitZone);
  }

  // приватный хелпер: путь скруглённого прямоугольника (в прежнем ядре был общий;
  // дублируется приватно по решению PLAN.md ради изоляции модуля)
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // плашка-подсказка у правого края. showKey — пристегнуть клавишу E слева.
  function drawHintPill(ctx, text, showKey, bgColor, fgColor) {
    const pulse = 0.92 + Math.sin(performance.now() / 280) * 0.08;

    ctx.save();
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const textW = ctx.measureText(text).width;
    const padX = 18;
    const h = 48;
    const keyW = showKey ? 40 : 0;
    const keyGap = showKey ? 10 : 0;
    const w = keyW + keyGap + textW + padX * 2;

    const x = CONFIG.canvasW - w - 36;
    const y = CONFIG.canvasH * 0.50 - h / 2;

    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-(x + w / 2), -(y + h / 2));

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = bgColor;
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (showKey) {
      const kx = x + padX;
      const ky = y + (h - 32) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      roundRect(ctx, kx, ky, keyW, 32, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, kx, ky, keyW, 32, 6);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "700 16px ui-monospace, 'SF Mono', Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("E", kx + keyW / 2, y + h / 2);
    }

    ctx.fillStyle = fgColor;
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(text, x + padX + keyW + keyGap, y + h / 2);

    ctx.restore();
  }

  return {
    // E у правого края + кадр пройден → переход. Возвращает true, если «съел» E.
    onAction(bubble) {
      const st = GameAPI.sceneState();
      if (inExitZone(bubble) && st.complete) {
        GameAPI.gotoNext();
        return true;
      }
      return false;
    },

    draw(ctx, bubble) {
      const st = GameAPI.sceneState();
      const atEdge = inExitZone(bubble);

      // кадр НЕ пройден: у края — красный намёк (вне края молчим, чтобы не шуметь).
      // Это «место» pickup-hint инвентаря — он рисует свою подсказку отдельно.
      if (!st.complete) {
        if (atEdge) {
          drawHintPill(ctx, `сначала найди ${rewardWord()}`, false, "rgba(120,30,30,.7)", "#fff");
        }
        return;
      }

      // кадр пройден: зовём к выходу. У края — с клавишей E. «Домой» — только когда
      // есть КУДА возвращаться: многокадровая игра на последнем кадре (count>1 && atLast).
      // На единственном кадре (count===1) база — «Дальше →», даже если он же последний.
      const text = (st.count > 1 && st.atLast) ? "Домой →" : "Дальше →";
      drawHintPill(ctx, text, atEdge, "rgba(28,30,42,.78)", "#fff");
    },
  };
});
