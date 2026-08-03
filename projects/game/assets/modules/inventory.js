/*
  inventory.js — модуль ИНВЕНТАРЯ наград.

  Вынесен из прежнего ядра (REWARD_SLOTS / collected / drawInventory /
  drawPickupHint). Самый связанный модуль: испытания добывают награды, инвентарь
  их складывает; arrange берёт награды обратно через ядро. Контракт — PLAN.md.

  Связь с механиками — ТОЛЬКО через ядро (GameAPI), состояние не дублируется:
  - награда в collected: ПОЛЛИНГ в update по sceneState() (НЕ onAction — награда
    добывается прохождением механики, не нажатием E).
  - arrange берёт награды: ядро зовёт getRewards() этого модуля.
  - подсветка arrange: читаем текущую механику через sceneState().mechanic.

  Два reset (КРИТИЧНО): collected чистится ТОЛЬКО в resetGame (полный рестарт),
  НЕ в resetScene — иначе игрок теряет награды при каждом переходе между кадрами.

  Инвариант подсказок (PLAN.md): pickup-hint рисуем только когда механика даёт
  canPickup === true (кадр не пройден). exit-hint (transitions) — при complete.

  Подключается: <script> в index.html (после transitions, до core) + "inventory"
  в CONFIG.MODULES. Наставник делает это на шаге курса 2.4.
*/

Modules.register("inventory", () => {
  // слоты в порядке появления наград по сценам (из CONFIG.SCENES с reward)
  const REWARD_SLOTS = CONFIG.SCENES
    .map((s, i) => s.reward ? { sceneIndex: i, sprite: s.reward, img: null } : null)
    .filter(Boolean);
  const collected = new Set();   // индексы сцен с собранными наградами (кросс-кадровое)

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // приватный roundRect (дублируется по решению PLAN.md ради изоляции модуля)
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // подсказка подбора «E — взять <награду>» у героя
  function drawPickupHint(ctx, bubble) {
    const heroSize = CONFIG.canvasH * CONFIG.heroScale;
    const txt = `E — взять ${rewardWord()}`;
    ctx.save();
    ctx.font = "600 28px system-ui, sans-serif";
    const w = ctx.measureText(txt).width;
    const x = bubble.x - w / 2;
    const y = bubble.y - heroSize * 0.55;
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(x - 14, y - 22, w + 28, 40);
    ctx.fillStyle = "#ffd86b";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  // панель инвентаря — полупрозрачная полоса поверх низа кадра
  function drawInventory(ctx) {
    const N = REWARD_SLOTS.length;
    if (N === 0) return;
    const slot = CONFIG.invSlotSize;
    const gap = CONFIG.invSlotGap;
    const totalW = N * slot + (N - 1) * gap;
    const padX = 24;
    const barW = totalW + padX * 2;
    const barH = CONFIG.invHeight;
    const barX = (CONFIG.canvasW - barW) / 2;
    const barY = CONFIG.canvasH - barH - CONFIG.invMargin;

    ctx.fillStyle = CONFIG.invBg;
    roundRect(ctx, barX, barY, barW, barH, 16);
    ctx.fill();

    const startX = barX + padX;
    const cy = barY + barH / 2;

    // активный слот для механики arrange (подсветить, нумеровать) — через ядро
    const mech = GameAPI.sceneState().mechanic;
    const isArrange = CONFIG.SCENES[GameAPI.sceneState().index].mechanic === "arrange";
    const activeIdx = (isArrange && mech && mech.activeIndex) ? mech.activeIndex() : -1;

    for (let i = 0; i < N; i++) {
      const slotInfo = REWARD_SLOTS[i];
      const x = startX + i * (slot + gap);
      const y = cy - slot / 2;
      const got = collected.has(slotInfo.sceneIndex);
      const placed = isArrange && mech && mech.slotPlaced ? mech.slotPlaced(i) : false;
      const isActive = (i === activeIdx) && !placed;

      ctx.fillStyle = isActive ? "rgba(255,216,107,0.22)" : CONFIG.invSlotEmpty;
      roundRect(ctx, x, y, slot, slot, 10);
      ctx.fill();
      ctx.strokeStyle = isActive ? "#ffd86b" : (got ? "#ffd86b" : CONFIG.invSlotEdge);
      ctx.lineWidth = isActive ? 3 : 2;
      roundRect(ctx, x, y, slot, slot, 10);
      ctx.stroke();

      if (got && slotInfo.img) {
        const pad = 6;
        const cellW = slot - pad * 2;
        const cellH = slot - pad * 2;
        const aspect = slotInfo.img.naturalWidth / slotInfo.img.naturalHeight;
        let dw, dh;
        if (aspect >= 1) { dw = cellW; dh = cellW / aspect; }
        else            { dh = cellH; dw = cellH * aspect; }
        ctx.save();
        ctx.globalAlpha = placed ? 0.3 : 1;
        ctx.drawImage(slotInfo.img, x + (slot - dw) / 2, y + (slot - dh) / 2, dw, dh);
        ctx.restore();
      }

      if (isArrange) {
        ctx.save();
        ctx.fillStyle = isActive ? "#ffd86b" : "rgba(255,255,255,0.55)";
        ctx.font = "700 12px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(String(i + 1), x + 6, y + 4);
        ctx.restore();
      }
    }
  }

  return {
    // setup — один раз при старте: грузим картинки наград (НЕ в init!)
    async setup() {
      await Promise.all(REWARD_SLOTS.map(async (m) => {
        m.img = await loadImage(m.sprite);
      }));
    },

    // поллинг: механика пройдена → награда в collected (как старое ядро в update)
    update(bubble, keys, dtMs) {
      const st = GameAPI.sceneState();
      if (st.mechanicComplete && st.sceneReward && !collected.has(st.index)) {
        collected.add(st.index);
      }
    },

    draw(ctx, bubble) {
      // pickup-hint: только когда текущая механика даёт canPickup (кадр не пройден)
      const mech = GameAPI.sceneState().mechanic;
      const canPick = mech && mech.canPickup && mech.canPickup(bubble);
      if (canPick) drawPickupHint(ctx, bubble);

      drawInventory(ctx);
    },

    // resetScene НЕ трогает collected (кадро-независимо). resetGame — чистит.
    resetGame() {
      collected.clear();
    },

    // мост для arrange: ядро (GameAPI.getRewards) отдаёт этот набор механике arrange
    getRewards() {
      return REWARD_SLOTS.map((m, i) => ({ key: i, sprite: m.sprite, img: m.img }));
    },
  };
});
