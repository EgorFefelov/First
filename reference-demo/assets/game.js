/*
  game.js — эталонная демо-игра «Бабл путешествует по комиксу».
  Шаг 2: каркас — Бабл летает по одной сцене (стрелки), с инерцией и наклоном.

  Стек: vanilla JS + canvas, ноль зависимостей.
  CONFIG — единственный источник всех чисел. Шаги 3-6 опираются на эти имена.
*/

const CONFIG = {
  // --- размер игрового поля (кадры комикса 900x900, квадрат) ---
  canvasW: 900,
  canvasH: 900,

  // --- Бабл ---
  // пути относительны HTML-странице (game_test.html / demo.html в reference-demo/)
  spriteFile: "bubble.png",      // спрайт лежит в reference-demo/bubble.png
  babbleScale: 0.28,             // размер спрайта = доля высоты кадра (не зависит от растяжки)
  babbleAlpha: 0.78,             // полупрозрачность пузыря
  // в спрайте видимый пузырь занимает ~78% квадрата, вокруг прозрачные поля.
  // edgePad — насколько центр Бабла подпускается к краю кадра (доля размера спрайта).
  edgePad: 0.30,                 // меньше -> Бабл ближе к краю

  // --- движение с инерцией ---
  accel: 0.55,                   // разгон при нажатой стрелке, px/кадр^2
  friction: 0.92,                // трение: скорость * friction каждый кадр (0..1)
  maxSpeed: 7,                   // ограничение скорости, px/кадр

  // --- наклон «летит» ---
  tiltMax: 0.30,                 // макс. крен в радианах (~17°)
  tiltEase: 0.12,                // плавность доводки крена к цели (0..1)

  // --- переход между сценами ---
  exitZone: 0.16,                // зона выхода у правого края (доля ширины кадра)
  transitionCode: "KeyE",        // физ. клавиша перехода (e.code — не зависит от раскладки)

  // --- механика «Проявитель» (fog) ---
  fogColor: "rgba(40,44,60,0.92)", // цвет/плотность слоя тумана
  fogThreshold: 0.82,            // доля рассеянного тумана для прохождения (0..1)
  fogSampleStep: 12,             // шаг сетки при подсчёте заполнения (px; меньше — точнее)

  // --- механика «Догонялки» (chase) ---
  chaseFleeRange: 220,           // радиус, в котором магнитик начинает убегать (px)
  chaseFleeAccel: 0.7,           // сила убегания
  chaseFriction: 0.94,           // трение магнитика
  chaseMaxSpeed: 6,              // макс. скорость магнитика (px/кадр; < maxSpeed Бабла)

  // --- магнитик ---
  magnetSize: 110,               // высота магнитика-спрайта на экране (px); ширина — по пропорции спрайта
  pickupRange: 130,              // дистанция подбора магнитика клавишей E, px
  pickupCode: "KeyE",            // клавиша подбора (та же, что переход — по контексту)
  pickupAnimMs: 420,             // длительность анимации подбора, мс

  // --- инвентарь (полоса поверх низа кадра — НЕ за пределами canvas) ---
  invHeight: 82,                  // высота полосы, px
  invMargin: 12,                  // отступ от нижнего края canvas, px
  invSlotSize: 56,                // размер слота, px
  invSlotGap: 14,                 // отступ между слотами, px
  invBg: "rgba(28,30,42,0.55)",   // фон панели (полупрозрачный — фон сцены просвечивает)
  invSlotEmpty: "rgba(255,255,255,0.10)", // пустой слот
  invSlotEdge: "rgba(255,216,107,0.55)",  // рамка пустого слота

  // --- сцены: все 6 кадров комикса по порядку истории ---
  // Бабл идёт линейно scene_1 -> ... -> scene_6 -> финал.
  // mechanic — имя механики на кадре (см. assets/mechanics/). Без mechanic —
  // кадр без «трения», переход открыт сразу (старт / финал).
  // magnet — спрайт магнитика-награды кадра.
  SCENES: [
    { image: "comic/scene_1.png" },                          // квартира — старт
    {
      // Италия — мини-башня стоит на столе перед пастой
      image: "comic/scene_2.png", mechanic: "seek",
      magnet: "magnets/magnet_italy.png",
      seek: { x: 0.26, y: 0.74 },
    },
    {
      // Америка — Статуя стоит рядом с тележкой хот-догов
      image: "comic/scene_3.png", mechanic: "fog",
      magnet: "magnets/magnet_usa.png",
      fog: { x: 0.54, y: 0.78 },
    },
    {
      // Япония — драккар бегает (старт-позиция любая)
      image: "comic/scene_4.png", mechanic: "chase",
      magnet: "magnets/magnet_japan.png",
      chase: { x: 0.55, y: 0.40 },
    },
    {
      // Норвегия — кусочки разбросаны по воде слева от существующего кораблика;
      // собранный драккар появляется чуть выше, тоже на воде.
      image: "comic/scene_5.png", mechanic: "collect",
      magnet: "magnets/magnet_norway.png",
      collect: [
        { x: 0.18, y: 0.32 },   // верх слева, у горы
        { x: 0.78, y: 0.22 },   // верх справа, в небе/сиянии
        { x: 0.62, y: 0.58 },   // середина-правее, у домиков
      ],
      collectFinal: { x: 0.30, y: 0.65 },   // драккар на воде, выше прежнего
    },
    {
      // Холодильник — финальная сцена. Механика fridge: расставить магниты на дверь.
      image: "comic/scene_6.png", mechanic: "fridge",
      fridge: { x: 0.23, y: 0.04, w: 0.46, h: 0.83 },   // прямоугольник дверцы(ей) в долях кадра
    },
  ],
};

// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = CONFIG.canvasW;
canvas.height = CONFIG.canvasH;
// инвентарь рисуется ВНУТРИ canvas, полупрозрачной полосой поверх низа кадра —
// картинка остаётся 900x900, не сжимается.

// размер спрайта Бабла в пикселях кадра (доля высоты кадра)
const babbleSize = CONFIG.canvasH * CONFIG.babbleScale;

// загрузка картинки -> Promise
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(src);
    img.src = src;
  });
}

// --- состояние Бабла ---
const bubble = {
  x: CONFIG.canvasW / 2,
  y: CONFIG.canvasH / 2,
  vx: 0,
  vy: 0,
  tilt: 0,        // текущий крен, радианы
};

let sceneIndex = 0;
let backgrounds = [];
let bubbleImg = null;

// --- инвентарь магнитиков ---
// слоты в порядке появления магнитиков по сценам.
const MAGNET_SLOTS = CONFIG.SCENES
  .map((s, i) => s.magnet ? { sceneIndex: i, sprite: s.magnet, img: null } : null)
  .filter(Boolean);
const collected = new Set();    // индексы сцен с собранными магнитиками
let finished = false;        // true -> пройдена последняя сцена (финальный экран)
let currentMechanic = null;  // механика текущего кадра (или null, если кадр без механики)

// --- ввод ---
// keys: храним и e.key (для стрелок), и e.code (для букв/цифр — не зависит от раскладки)
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  keys[e.code] = true;
  if (e.key.startsWith("Arrow")) e.preventDefault();
  // E (по e.code — работает в любой раскладке): сначала пробуем подобрать
  // магнитик в механике; если подбирать нечего — это команда перехода.
  if (e.code === CONFIG.transitionCode) {
    const eaten = currentMechanic && currentMechanic.onAction
      ? currentMechanic.onAction(bubble)
      : false;
    if (!eaten) tryAdvance();
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
  keys[e.code] = false;
});

// Бабл в зоне выхода у правого края текущей сцены?
function inExitZone() {
  return bubble.x > CONFIG.canvasW * (1 - CONFIG.exitZone);
}

// кадр пройден? кадр без механики проходится сразу; с механикой — по isComplete()
function sceneComplete() {
  return !currentMechanic || currentMechanic.isComplete();
}

// переход на следующую сцену по клавише.
// На последнем кадре (холодильник) переход = финал: показываем оверлей через хук.
function tryAdvance() {
  if (finished) return;
  if (!inExitZone()) return;
  if (!sceneComplete()) return;   // механика не пройдена — переход закрыт
  if (sceneIndex < CONFIG.SCENES.length - 1) {
    sceneIndex++;
    resetScene();
  } else {
    finished = true;
    if (typeof window.onGameFinish === "function") window.onGameFinish();
  }
}

// рестарт игры — вызывается из HTML по кнопке «Повторить» (window.GameAPI.restart)
function restart() {
  finished = false;
  sceneIndex = 0;
  collected.clear();
  resetScene();
  canvas.focus();
}
window.GameAPI = { restart };

// подключить механику текущего кадра (или null, если кадр без механики).
// fridge получает специальный параметр — массив магнитов инвентаря.
function initScene() {
  const scene = CONFIG.SCENES[sceneIndex];
  currentMechanic = scene.mechanic ? Mechanics.create(scene.mechanic) : null;
  if (!currentMechanic) return;
  // готовим сценарий: для fridge добавим текущий набор магнитов из инвентаря
  const sceneParams = (scene.mechanic === "fridge")
    ? { ...scene, magnetsInInventory: MAGNET_SLOTS.map((m, i) => ({
        key: i, sprite: m.sprite, img: m.img,
      })) }
    : scene;
  currentMechanic.init(ctx, CONFIG, sceneParams);
}

// сброс состояния при входе в новую сцену
function resetScene() {
  // Бабл появляется у левого края новой сцены
  bubble.x = babbleSize * CONFIG.edgePad + 4;
  bubble.y = CONFIG.canvasH / 2;
  bubble.vx = 0;
  bubble.vy = 0;
  initScene();
}

// --- обновление физики ---
function update(dtMs) {
  if (finished) return;   // на финальном экране Бабл не двигается

  // разгон по нажатым стрелкам
  if (keys["ArrowLeft"])  bubble.vx -= CONFIG.accel;
  if (keys["ArrowRight"]) bubble.vx += CONFIG.accel;
  if (keys["ArrowUp"])    bubble.vy -= CONFIG.accel;
  if (keys["ArrowDown"])  bubble.vy += CONFIG.accel;

  // трение — Бабл плавно тормозит, «парит»
  bubble.vx *= CONFIG.friction;
  bubble.vy *= CONFIG.friction;

  // ограничение скорости
  bubble.vx = Math.max(-CONFIG.maxSpeed, Math.min(CONFIG.maxSpeed, bubble.vx));
  bubble.vy = Math.max(-CONFIG.maxSpeed, Math.min(CONFIG.maxSpeed, bubble.vy));

  // позиция
  bubble.x += bubble.vx;
  bubble.y += bubble.vy;

  // упор в края кадра. отступ — доля размера спрайта (edgePad), а не половина:
  // видимый пузырь меньше квадрата спрайта, так Бабл подходит к краю вплотную.
  const pad = babbleSize * CONFIG.edgePad;
  if (bubble.x < pad) { bubble.x = pad; bubble.vx = 0; }
  if (bubble.x > CONFIG.canvasW - pad) { bubble.x = CONFIG.canvasW - pad; bubble.vx = 0; }
  if (bubble.y < pad) { bubble.y = pad; bubble.vy = 0; }
  if (bubble.y > CONFIG.canvasH - pad) { bubble.y = CONFIG.canvasH - pad; bubble.vy = 0; }

  // наклон в сторону движения — крен пропорционален горизонтальной скорости
  const targetTilt = (bubble.vx / CONFIG.maxSpeed) * CONFIG.tiltMax;
  bubble.tilt += (targetTilt - bubble.tilt) * CONFIG.tiltEase;

  // обновление механики кадра
  if (currentMechanic) currentMechanic.update(bubble, keys, dtMs);

  // механика пройдена — для стран добавить магнитик в инвентарь.
  // Финал триггерится в tryAdvance() (E у правого края), не авто.
  if (currentMechanic && currentMechanic.isComplete && currentMechanic.isComplete()) {
    const scene = CONFIG.SCENES[sceneIndex];
    if (scene.magnet && !collected.has(sceneIndex)) {
      collected.add(sceneIndex);
    }
  }
}

// --- отрисовка ---
function draw() {
  // фон текущей сцены
  ctx.drawImage(backgrounds[sceneIndex], 0, 0, CONFIG.canvasW, CONFIG.canvasH);

  // механика кадра рисуется поверх фона, под Баблом
  if (currentMechanic) currentMechanic.draw(ctx);

  // Бабл — полупрозрачный, с наклоном «летит»
  ctx.save();
  ctx.translate(bubble.x, bubble.y);
  ctx.rotate(bubble.tilt);
  ctx.globalAlpha = CONFIG.babbleAlpha;
  ctx.drawImage(bubbleImg, -babbleSize / 2, -babbleSize / 2, babbleSize, babbleSize);
  ctx.restore();

  // на финале — оверлей сверху уже даёт затемнение и текст. Игровые подсказки и
  // инвентарь не нужны (оверлей бьёт по интерактивности). Показанным остаются
  // фон, повешенные магнитики и Бабл.
  if (finished) return;

  // подсказка «E — взять», когда Бабл рядом с магнитиком
  const canPick = currentMechanic && currentMechanic.canPickup
    && currentMechanic.canPickup(bubble);
  if (canPick) drawPickupHint();

  // подсказка движения дальше — двухступенчатая:
  //   сцена пройдена и Бабл НЕ у края -> просто пульсирующее «Дальше →» (зови к выходу)
  //   сцена пройдена и Бабл у края    -> «[E] Дальше →» (нажми, чтобы перейти)
  //   сцена не пройдена и Бабл у края -> намёк «сначала добудь магнитик»
  if (!canPick) drawExitHint();

  // инвентарь — поверх всего внутри игровой области не идёт, рисуется ниже
  drawInventory();
}

// панель инвентаря — полупрозрачная полоса поверх низа кадра (внутри canvas)
function drawInventory() {
  const N = MAGNET_SLOTS.length;
  const slot = CONFIG.invSlotSize;
  const gap = CONFIG.invSlotGap;
  const totalW = N * slot + (N - 1) * gap;
  // плашка по ширине слотов + воздух, скруглённые углы, по центру внизу
  const padX = 24;
  const barW = totalW + padX * 2;
  const barH = CONFIG.invHeight;
  const barX = (CONFIG.canvasW - barW) / 2;
  const barY = CONFIG.canvasH - barH - CONFIG.invMargin;

  ctx.fillStyle = CONFIG.invBg;
  roundRect(barX, barY, barW, barH, 16);
  ctx.fill();

  const startX = barX + padX;
  const cy = barY + barH / 2;

  // активный слот для механики fridge (подсветить, нумеровать)
  const isFridge = CONFIG.SCENES[sceneIndex].mechanic === "fridge";
  const activeIdx = (isFridge && currentMechanic && currentMechanic.activeIndex)
    ? currentMechanic.activeIndex() : -1;

  for (let i = 0; i < N; i++) {
    const slotInfo = MAGNET_SLOTS[i];
    const x = startX + i * (slot + gap);
    const y = cy - slot / 2;
    const got = collected.has(slotInfo.sceneIndex);
    // на сцене fridge: магнитик считается «в руке» если он не повешен на холодильник
    // (для подсветки в инвентаре — отображаем все собранные, повешенные затемняются)
    const placed = isFridge && currentMechanic && currentMechanic.slotPlaced
      ? currentMechanic.slotPlaced(i) : false;
    const isActive = (i === activeIdx) && !placed;

    // фон слота + рамка
    ctx.fillStyle = isActive ? "rgba(255,216,107,0.22)" : CONFIG.invSlotEmpty;
    roundRect(x, y, slot, slot, 10);
    ctx.fill();
    ctx.strokeStyle = isActive ? "#ffd86b" : (got ? "#ffd86b" : CONFIG.invSlotEdge);
    ctx.lineWidth = isActive ? 3 : 2;
    roundRect(x, y, slot, slot, 10);
    ctx.stroke();

    if (got && slotInfo.img) {
      // рисуем магнитик с сохранением пропорций, вписанным в слот с отступом.
      // повешенные на холодильник — затемнённые, чтобы был виден «израсходованный».
      const pad = 6;
      const cellW = slot - pad * 2;
      const cellH = slot - pad * 2;
      const aspect = slotInfo.img.naturalWidth / slotInfo.img.naturalHeight;
      let dw, dh;
      if (aspect >= 1) { dw = cellW; dh = cellW / aspect; }
      else            { dh = cellH; dw = cellH * aspect; }
      ctx.save();
      ctx.globalAlpha = placed ? 0.3 : 1;
      ctx.drawImage(
        slotInfo.img,
        x + (slot - dw) / 2,
        y + (slot - dh) / 2,
        dw, dh
      );
      ctx.restore();
    }

    // на сцене fridge — нумерация слотов (1..N) для подсказки клавиш
    if (isFridge) {
      ctx.save();
      ctx.fillStyle = isActive ? "#ffd86b" : "rgba(255,255,255,0.55)";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(String(i + 1), x + 6, y + 4);
      ctx.restore();
    }
  }
}

// хелпер — путь скруглённого прямоугольника
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// подсказка подбора магнитика — у Бабла
function drawPickupHint() {
  const txt = "E — взять магнитик";
  ctx.save();
  ctx.font = "600 28px system-ui, sans-serif";
  const w = ctx.measureText(txt).width;
  const x = bubble.x - w / 2;
  const y = bubble.y - babbleSize * 0.55;
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(x - 14, y - 22, w + 28, 40);
  ctx.fillStyle = "#ffd86b";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x, y);
  ctx.restore();
}

// подсказка перехода у правого края.
// кадр пройден -> «E — дальше» (или «E — домой» на последнем кадре);
// не пройден -> намёк «сначала добудь магнитик».
// Подсказка движения дальше — справа, у правого края.
//   1) сцена пройдена + Бабл НЕ у края -> «Дальше →» (пульсация, зовёт идти)
//   2) сцена пройдена + Бабл у края    -> [E] «Дальше →» (нажми)
//   3) сцена не пройдена + Бабл у края -> красный намёк «сначала найди магнитик»
function drawExitHint() {
  const done = sceneComplete();
  const atEdge = inExitZone();
  const isLast = sceneIndex === CONFIG.SCENES.length - 1;

  // 3) не пройдено — показываем только когда подлетел к краю (раньше — лишний шум)
  if (!done) {
    if (!atEdge) return;
    drawHintPill("сначала найди магнитик", false, "rgba(120,30,30,.7)", "#fff");
    return;
  }

  // 1)/2) сцена пройдена
  const text = isLast ? "Домой →" : "Дальше →";
  const showKey = atEdge;
  drawHintPill(text, showKey, "rgba(28,30,42,.78)", "#fff");
}

// Рисует «таблетку» с подсказкой у правого края. Если showKey — слева пристёгнута
// квадратная плашка с буквой E. Без showKey — текст слегка пульсирует, чтобы звать.
function drawHintPill(text, showKey, bgColor, fgColor) {
  const pulse = 0.92 + Math.sin(performance.now() / 280) * 0.08;

  ctx.save();
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  const textW = ctx.measureText(text).width;
  const padX = 18;
  const padY = 12;
  const h = 48;
  const keyW = showKey ? 40 : 0;        // ширина клавиши E
  const keyGap = showKey ? 10 : 0;
  const w = keyW + keyGap + textW + padX * 2;

  // позиция: правый край, по вертикали — чуть выше центра (над инвентарём)
  const x = CONFIG.canvasW - w - 36;
  const y = CONFIG.canvasH * 0.50 - h / 2;

  // pulse: чуть растёт-сжимается всем блоком, через scale от центра
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-(x + w / 2), -(y + h / 2));

  // тень-обводка, чтобы плашка читалась на любом фоне
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = bgColor;
  roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.shadowBlur = 0;

  // клавиша E
  if (showKey) {
    const kx = x + padX;
    const ky = y + (h - 32) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(kx, ky, keyW, 32, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    roundRect(kx, ky, keyW, 32, 6);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 16px ui-monospace, 'SF Mono', Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("E", kx + keyW / 2, y + h / 2);
  }

  // основной текст
  ctx.fillStyle = fgColor;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, x + padX + keyW + keyGap, y + h / 2);

  ctx.restore();
}


let lastTime = 0;
function loop(now) {
  const dtMs = lastTime ? Math.min(now - lastTime, 50) : 16;
  lastTime = now;
  update(dtMs);
  draw();
  requestAnimationFrame(loop);
}

// --- старт ---
const sceneCount = CONFIG.SCENES.length;
Promise.all([
  loadImage(CONFIG.spriteFile),
  ...CONFIG.SCENES.map((sc) => loadImage(sc.image)),
  ...MAGNET_SLOTS.map((m) => loadImage(m.sprite)),
])
  .then((imgs) => {
    bubbleImg = imgs[0];
    backgrounds = imgs.slice(1, 1 + sceneCount);
    const magnetImgs = imgs.slice(1 + sceneCount);
    MAGNET_SLOTS.forEach((m, i) => { m.img = magnetImgs[i]; });
    initScene();   // инициализировать механику стартового кадра
    canvas.focus(); // фокус на игру — клавиши работают сразу, без клика мышью
    loop();
  })
  .catch((src) => {
    ctx.fillStyle = "#300";
    ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    ctx.fillStyle = "#f88";
    ctx.font = "20px system-ui";
    ctx.fillText("Не загрузилась картинка: " + src, 30, 50);
  });
