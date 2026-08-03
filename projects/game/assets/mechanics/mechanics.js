/*
  mechanics.js — реестр механик игры.

  Механики регистрируются по имени. Движок (core.js) создаёт нужную через
  Mechanics.create(name), не зная про конкретные реализации.
  Контракт механики — см. README.md в этой папке.
*/

const Mechanics = {
  _factories: {},

  // зарегистрировать механику: имя + фабрика, возвращающая объект-механику
  register(name, factory) {
    this._factories[name] = factory;
  },

  // создать экземпляр механики по имени (новый объект на каждый кадр)
  create(name) {
    const factory = this._factories[name];
    if (!factory) {
      console.warn(`Mechanics: механика "${name}" не зарегистрирована`);
      return null;
    }
    return factory();
  },

  // есть ли такая механика
  has(name) {
    return !!this._factories[name];
  },

  // имена всех механик (для случайного выбора и т.п.)
  names() {
    return Object.keys(this._factories);
  },
};

// общий хелпер: нарисовать звезду-заглушку (кусочки в collect, fallback).
function drawStar(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ffd86b";
  ctx.strokeStyle = "#b88a1a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = Math.cos(ang) * rad;
    const y = Math.sin(ang) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
window.drawStar = drawStar;

/*
  createReward — общий объект награды для механик с одной целью
  (seek / fog / chase). Держит спрайт, рисует с мерцанием, проверяет
  дистанцию для подбора на E, проигрывает анимацию подбора (вспышка).

  cfg — CONFIG, sprite — путь к картинке награды (scene.reward).
*/
function createReward(cfg, sprite) {
  const img = new Image();
  let loaded = false;
  let aspect = 1;   // ширина / высота спрайта, для рисовки с пропорциями
  img.onload = () => {
    loaded = true;
    aspect = img.naturalWidth / img.naturalHeight;
  };
  if (sprite) img.src = sprite;

  // размеры на экране с сохранением пропорций: высота = cfg.rewardSize,
  // ширина — пропорционально (узкая башня узкая, широкий драккар широкий).
  function size() {
    const h = cfg.rewardSize;
    return { w: h * aspect, h };
  }

  return {
    x: 0, y: 0,
    visible: false,      // показывать ли награду (механика включает)
    picked: false,       // подобран
    _pulse: 0,
    _anim: 0,            // прогресс анимации подбора 0..1

    // герой достаточно близко для подбора на E?
    inReach(bubble) {
      if (!this.visible || this.picked) return false;
      return Math.hypot(bubble.x - this.x, bubble.y - this.y) < cfg.pickupRange;
    },

    // подобрать (вызывает механика по нажатию E)
    pick() {
      if (this.picked) return;
      this.picked = true;
      this._anim = 0.0001;   // запустить анимацию
    },

    // анимация подбора доиграла?
    animDone() {
      return this.picked && this._anim >= 1;
    },

    update(dtMs) {
      this._pulse += 0.08;
      if (this._anim > 0 && this._anim < 1) {
        this._anim = Math.min(1, this._anim + dtMs / cfg.pickupAnimMs);
      }
    },

    draw(ctx) {
      if (!this.visible) return;
      const { w, h } = size();
      const flashR = Math.max(w, h) * 0.5;   // радиус кольца-вспышки

      if (this.picked) {
        // анимация подбора: награда всплывает, растёт, тает + вспышка
        const t = this._anim;
        const scale = 1 + t * 0.6;
        const lift = t * h * 0.7;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.translate(this.x, this.y - lift);
        // вспышка-кольцо
        ctx.strokeStyle = "#ffd86b";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, flashR * (0.6 + t * 1.4), 0, Math.PI * 2);
        ctx.stroke();
        // сама награда с пропорциями
        const dw = w * scale, dh = h * scale;
        if (loaded) ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        return;
      }

      // обычная отрисовка: лёгкое мерцание
      const k = 1 + Math.sin(this._pulse) * 0.06;
      const dw = w * k, dh = h * k;
      if (loaded) {
        ctx.drawImage(img, this.x - dw / 2, this.y - dh / 2, dw, dh);
      } else {
        drawStar(ctx, this.x, this.y, h * 0.4);   // fallback пока грузится
      }
    },

    reset() {
      this.picked = false;
      this.visible = false;
      this._pulse = 0;
      this._anim = 0;
    },
  };
}
window.createReward = createReward;

// слово награды для текстов UI: заданное наставником или нейтральный дефолт
function rewardWord() { return (CONFIG.rewardWord || "").trim() || "награда"; }
window.rewardWord = rewardWord;

window.Mechanics = Mechanics;
