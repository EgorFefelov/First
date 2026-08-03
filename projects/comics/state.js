// Загрузчик данных комикса. Самодостаточен: этот проект не зависит от панели курса.
//
// База путей: страница задаёт window.STATE_BASE ДО подключения этого скрипта.
// В проекте comics это "data/" — там лежит state.json комикса (кадры + история).
// По умолчанию — рядом со страницей.
const STATE_BASE = (typeof window !== "undefined" && window.STATE_BASE) || "";

const StateManager = {
  current: null,
  listeners: [],
  failCount: 0,
  errorShown: false,

  async load() {
    try {
      const res = await fetch(`${STATE_BASE}state.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      this.failCount = 0;
      if (this.errorShown) this.hideError();
      const changed = JSON.stringify(next) !== JSON.stringify(this.current);
      this.current = next;
      if (changed) this.emitChange();
    } catch (e) {
      this.failCount++;
      console.warn(`comics/data/state.json load fail #${this.failCount}: ${e.message}`);
      if (this.failCount >= 3 && !this.errorShown) {
        this.showError(e);
        this.errorShown = true;
      }
    }
  },

  showError(e) {
    const root = document.getElementById("tab-comic");
    if (!root) return;
    root.innerHTML = `
      <div class="comic-empty">
        <p>Не удалось загрузить данные комикса.</p>
        <p class="comic-empty-hint">${e.message} — покажи это наставнику.</p>
      </div>
    `;
  },

  hideError() {
    this.errorShown = false;
  },

  onChange(fn) { this.listeners.push(fn); },
  emitChange() { this.listeners.forEach(fn => fn(this.current)); },

  start() {
    // Живой режим: наставник дописывает кадры по ходу занятия, страница
    // подхватывает их сама. Тот же интервал, что у панели курса.
    this.load();
    setInterval(() => this.load(), 1500);
  }
};

window.StateManager = StateManager;
document.addEventListener("DOMContentLoaded", () => StateManager.start());
