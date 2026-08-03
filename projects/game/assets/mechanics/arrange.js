/*
  arrange.js — финальная механика: расставить собранные награды по местам.

  На последнем кадре ребёнок расставляет собранные награды в заданной области
  кадра (полка / витрина / постамент / гнездо — по истории ученика).
    - 1/2/3/4 — выбрать активную награду из инвентаря (порядок инвентаря)
    - E       — поставить активную в текущей позиции героя (если внутри области
                расстановки) или снять поставленную, если герой рядом с ней
    - вне области расстановки E -> подсказка-предупреждение
  Когда все награды расставлены — isComplete() возвращает true (финал авто).

  Контракт:
    scene.arrange = { x, y, w, h }  // прямоугольник области, доли 0..1
    scene.rewardsInInventory        // массив { sprite, key } порядка 1..N
                                    // (передаёт ядро через init).
*/

Mechanics.register("arrange", () => {
  let ctx, cfg;
  let area;                  // абс. пиксели прямоугольника области расстановки
  let slots = [];            // [{ key, sprite, img, placed: bool, x, y }] — состояние наград
  let activeIndex = 0;       // какая награда «в руке»
  let warnUntil = 0;         // до какого момента (ms) показывать красную подсказку
  let now = 0;

  const SNAP_RADIUS_REL = 0.10;  // если герой ближе к уже поставленной — снять, не ставить

  function rect() { return area; }

  function inArrange(x, y) {
    const r = rect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ближайшая поставленная награда в радиусе (для снятия). Возвращает индекс или -1.
  function pickedHangingNear(bubble) {
    const rad = cfg.canvasH * SNAP_RADIUS_REL;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.placed) continue;
      const d = Math.hypot(bubble.x - s.x, bubble.y - s.y);
      if (d < rad && d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  return {
    init(_ctx, _cfg, scene) {
      ctx = _ctx;
      cfg = _cfg;
      activeIndex = 0;
      warnUntil = 0;
      now = 0;

      const f = (scene && scene.arrange) || { x: 0.27, y: 0.08, w: 0.34, h: 0.71 };
      area = {
        x: cfg.canvasW * f.x,
        y: cfg.canvasH * f.y,
        w: cfg.canvasW * f.w,
        h: cfg.canvasH * f.h,
      };

      // награды инвентаря — копия из ядра
      const inv = (scene && scene.rewardsInInventory) || [];
      slots = inv.map((m) => ({
        key: m.key,
        sprite: m.sprite,
        img: m.img,
        placed: false,
        x: 0, y: 0,
      }));
    },

    update(bubble, keys, dtMs) {
      now += dtMs;

      // выбор активной награды клавишами 1..N (key 'Digit1'.. — независимо от раскладки)
      for (let i = 0; i < slots.length; i++) {
        const code = "Digit" + (i + 1);
        if (keys[code]) {
          activeIndex = i;
        }
      }
    },

    // E на этой механике: снять поставленную / поставить активную.
    // Возвращает false если событие НЕ обработано — тогда ядро обрабатывает
    // E как «переход» (для финала после расстановки всех у правого края).
    onAction(bubble) {
      // Снятие поставленной — ВСЕГДА в приоритете (даже когда все уже расставлены),
      // чтобы можно было передумать и переставить награду перед уходом домой.
      const near = pickedHangingNear(bubble);
      if (near >= 0) {
        slots[near].placed = false;
        activeIndex = near;
        return true;
      }
      // Если все расставлены и снимать нечего — отпускаем E дальше -> переход на финал.
      if (slots.every((s) => s.placed)) return false;

      // иначе пытаемся поставить активную
      const a = slots[activeIndex];
      if (!a || a.placed) {
        const free = slots.findIndex((s) => !s.placed);
        if (free < 0) return true;
        activeIndex = free;
      }
      const act = slots[activeIndex];
      if (!inArrange(bubble.x, bubble.y)) {
        warnUntil = now + 1400;
        return true;
      }
      act.placed = true;
      act.x = bubble.x;
      act.y = bubble.y;
      const nextFree = slots.findIndex((s) => !s.placed);
      if (nextFree >= 0) activeIndex = nextFree;
      return true;
    },

    draw(ctx) {
      // подсветка области расстановки тонкой жёлтой рамкой
      const r = rect();
      ctx.save();
      ctx.strokeStyle = "rgba(255,216,107,0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      ctx.restore();

      // поставленные награды
      for (const s of slots) {
        if (!s.placed || !s.img) continue;
        drawRewardAt(ctx, s.img, s.x, s.y, cfg.rewardSize);
      }

      // предупреждение «место для награды — на полке»
      if (now < warnUntil) {
        const txt = "место для награды — на полке";
        ctx.save();
        ctx.font = "600 24px system-ui, sans-serif";
        const w = ctx.measureText(txt).width;
        const x = (cfg.canvasW - w) / 2;
        const y = cfg.canvasH * 0.18;
        ctx.fillStyle = "rgba(120,30,30,.7)";
        ctx.fillRect(x - 16, y - 22, w + 32, 44);
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, x, y);
        ctx.restore();
      }
    },

    // активная награда — для подсветки в инвентаре (читает inventory через ядро)
    activeIndex() { return activeIndex; },

    // поставлен ли слот i в области (inventory затемняет в инвентаре)
    slotPlaced(i) { return slots[i] ? slots[i].placed : false; },

    // arrange не использует canPickup (нечего подбирать на сцене)
    canPickup() { return false; },

    // финал = все слоты заполнены
    isComplete() {
      return slots.length > 0 && slots.every((s) => s.placed);
    },

    reset() {
      activeIndex = 0;
      warnUntil = 0;
      for (const s of slots) { s.placed = false; s.x = 0; s.y = 0; }
    },
  };
});

// рисует награду с сохранением пропорций, высота = size (как в createReward)
function drawRewardAt(ctx, img, cx, cy, size) {
  if (!img) return;
  const aspect = img.naturalWidth / img.naturalHeight;
  const h = size, w = size * aspect;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}
