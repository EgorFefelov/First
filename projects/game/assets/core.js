/*
  core.js — ЯДРО движка (минимум). Часть рефакторинга «ядро + плагины».

  Ядро БЕЗ поведения: игровой цикл, состояние bubble, загрузка/отрисовка фона и
  спрайта героя, реестр активных модулей и делегирование им хуков, полный GameAPI.
  Полёт / переходы / инвентарь / оверлеи живут в модулях (assets/modules/*.js) и
  подключаются через CONFIG.MODULES. Ядро без модулей: герой стоит, фон нарисован.

  Контракты (модуля, GameAPI, порядок хуков) — единственный источник:
  task_tracker плана level-2-modular, PLAN.md → «Контракты». Здесь не дублируем.
*/

// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = CONFIG.canvasW;
canvas.height = CONFIG.canvasH;

// размер спрайта героя в пикселях кадра (доля высоты кадра). Модули, которым он
// нужен (control — упор в края), вычисляют так же из CONFIG.
const heroSize = CONFIG.canvasH * CONFIG.heroScale;

// загрузка картинки -> Promise
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(src);
    img.src = src;
  });
}

// --- общее состояние героя (модули читают/пишут bubble) ---
const bubble = {
  x: CONFIG.canvasW / 2,
  y: CONFIG.canvasH / 2,
  vx: 0,
  vy: 0,
  tilt: 0,        // текущий крен, радианы (пишет модуль control)
};

let sceneIndex = 0;
let backgrounds = [];
let heroImgDefault = null;
let currentMechanic = null;  // испытание текущего кадра (или null)
// кадро-зависимые спрайты героя: scene.hero -> Image (общий heroImgDefault как дефолт)
const heroImgs = {};

// --- ввод ---
// keys: храним и e.key (стрелки), и e.code (буквы — не зависит от раскладки)
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  keys[e.code] = true;
  if (e.key.startsWith("Arrow")) e.preventDefault();
  // E: механика кадра РАНЬШЕ модулей (подбор награды раньше перехода). Первый,
  // чей onAction вернул true, «съедает» событие.
  if (e.code === CONFIG.transitionCode) {
    let eaten = currentMechanic && currentMechanic.onAction
      ? currentMechanic.onAction(bubble)
      : false;
    if (!eaten) {
      for (const m of Modules.active) {
        if (m.onAction && m.onAction(bubble)) { eaten = true; break; }
      }
    }
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
  keys[e.code] = false;
});

// --- активные модули ---
// Список инстансов строится ОДИН РАЗ при старте из CONFIG.MODULES. Имя в MODULES,
// но <script> не подключён → Modules.has === false → молча пропускаем (наращивание).
Modules.active = [];
// строит активные модули и ДОЖИДАЕТСЯ их setup (setup может быть async —
// inventory грузит картинки наград). initScene вызывается только после, чтобы
// arrange-мост (getRewards) получил уже загруженные img, не null.
async function buildModules() {
  const names = Array.isArray(CONFIG.MODULES) ? CONFIG.MODULES : [];
  Modules.active = names
    .filter((name) => Modules.has(name))
    .map((name) => Modules.create(name))
    .filter(Boolean);
  // setup() — один раз при создании инстанса (грузит ресурсы модуля)
  await Promise.all(Modules.active.map((m) => (m.setup ? m.setup(ctx, CONFIG) : null)));
}

// --- сцена ---
// подключить механику текущего кадра (или null). arrange получает награды из
// инвентаря через GameAPI.getRewards() (делегирует активному inventory).
function initScene() {
  const scene = CONFIG.SCENES[sceneIndex];
  currentMechanic = scene.mechanic ? Mechanics.create(scene.mechanic) : null;

  // resetScene + init у каждого активного модуля при входе на кадр
  for (const m of Modules.active) {
    if (m.resetScene) m.resetScene();
    if (m.init) m.init(ctx, CONFIG, scene);
  }

  if (!currentMechanic) return;
  // мост arrange: ядро отдаёт механике набор наград инвентаря
  const sceneParams = (scene.mechanic === "arrange")
    ? { ...scene, rewardsInInventory: GameAPI.getRewards() }
    : scene;
  currentMechanic.init(ctx, CONFIG, sceneParams);
}

// сброс состояния при входе в новую сцену (позиция героя — забота ядра)
function resetScene() {
  bubble.x = heroSize * CONFIG.edgePad + 4;
  bubble.y = CONFIG.canvasH / 2;
  bubble.vx = 0;
  bubble.vy = 0;
  initScene();
}

// --- обновление ---
function update(dtMs) {
  // модули по порядку CONFIG.MODULES (control двигает bubble), затем механика кадра
  for (const m of Modules.active) {
    if (m.update) m.update(bubble, keys, dtMs);
  }
  if (currentMechanic) currentMechanic.update(bubble, keys, dtMs);
}

// --- отрисовка ---
function draw() {
  // фон текущей сцены
  ctx.drawImage(backgrounds[sceneIndex], 0, 0, CONFIG.canvasW, CONFIG.canvasH);

  // механика кадра — поверх фона, под героем
  if (currentMechanic) currentMechanic.draw(ctx);

  // герой — с наклоном и alpha из CONFIG. Спрайт и размер могут быть кадро-
  // зависимыми (scene.hero / scene.heroScale) — напр. летящий Тока в леталке.
  const scene = CONFIG.SCENES[sceneIndex];
  const heroImg = (scene.hero && heroImgs[scene.hero]) || heroImgDefault;
  const heroSize = CONFIG.canvasH * (scene.heroScale || CONFIG.heroScale);
  // рисуем с сохранением пропорций спрайта (летящий — широкий, не квадрат)
  const aspect = heroImg.naturalWidth / heroImg.naturalHeight;
  const dw = aspect >= 1 ? heroSize : heroSize * aspect;
  const dh = aspect >= 1 ? heroSize / aspect : heroSize;
  ctx.save();
  ctx.translate(bubble.x, bubble.y);
  ctx.rotate(bubble.tilt);
  ctx.globalAlpha = CONFIG.heroAlpha;
  ctx.drawImage(heroImg, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // модули рисуют поверх (порядок — по CONFIG.MODULES / подключению в index.html)
  for (const m of Modules.active) {
    if (m.draw) m.draw(ctx, bubble);
  }
}

// --- GameAPI: ядро экспортит, модули читают (полный контракт — PLAN.md) ---
const GameAPI = {
  // полный рестарт игры (зовёт resetGame у модулей — чистка кросс-кадрового)
  restart() {
    sceneIndex = 0;
    for (const m of Modules.active) {
      if (m.resetGame) m.resetGame();
    }
    resetScene();
    canvas.focus();
  },

  // перейти на следующий кадр; на последнем — финал через хук
  gotoNext() {
    if (sceneIndex < CONFIG.SCENES.length - 1) {
      sceneIndex++;
      resetScene();
    } else if (typeof window.onGameFinish === "function") {
      window.onGameFinish();
    }
  },

  // состояние текущего кадра (модули читают вместо доступа во внутренности ядра)
  sceneState() {
    const count = CONFIG.SCENES.length;
    const scene = CONFIG.SCENES[sceneIndex];
    const mechanicComplete = !!(currentMechanic && currentMechanic.isComplete
      && currentMechanic.isComplete());
    return {
      index: sceneIndex,
      count,
      atLast: sceneIndex === count - 1,
      // кадр пройден: нет механики ИЛИ механика выполнена
      complete: !currentMechanic || mechanicComplete,
      mechanicComplete,
      sceneReward: scene.reward || null,
      mechanic: currentMechanic || null,
    };
  },

  // награды инвентаря — делегируем активному модулю inventory; [] если его нет
  getRewards() {
    const inv = Modules.active.find((m) => typeof m.getRewards === "function");
    return inv ? inv.getRewards() : [];
  },
};
window.GameAPI = GameAPI;

// --- цикл ---
let lastTime = 0;
function loop(now) {
  const dtMs = lastTime ? Math.min(now - lastTime, 50) : 16;
  lastTime = now;
  update(dtMs);
  draw();
  requestAnimationFrame(loop);
}

// --- старт ---
// Ядро грузит ТОЛЬКО спрайт героя + фоны сцен. Ресурсы модулей (награды
// инвентаря) грузит сам модуль в своём setup().
const sceneCount = CONFIG.SCENES.length;
// уникальные кадро-зависимые спрайты героя (scene.hero) — грузим отдельно
const heroSrcs = [...new Set(CONFIG.SCENES.map((s) => s.hero).filter(Boolean))];
Promise.all([
  loadImage(CONFIG.spriteFile),
  ...CONFIG.SCENES.map((sc) => loadImage(sc.image)),
  ...heroSrcs.map((src) => loadImage(src)),
])
  .then(async (imgs) => {
    heroImgDefault = imgs[0];
    backgrounds = imgs.slice(1, 1 + sceneCount);
    heroSrcs.forEach((src, i) => { heroImgs[src] = imgs[1 + sceneCount + i]; });
    await buildModules();   // создать активные модули + дождаться setup (ресурсы)
    initScene();      // механика + resetScene/init модулей стартового кадра
    canvas.focus();   // клавиши работают сразу, без клика мышью
    loop();
  })
  .catch((src) => {
    ctx.fillStyle = "#300";
    ctx.fillRect(0, 0, CONFIG.canvasW, CONFIG.canvasH);
    ctx.fillStyle = "#f88";
    ctx.font = "20px system-ui";
    ctx.fillText("Не загрузилась картинка: " + src, 30, 50);
  });
