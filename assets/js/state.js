const StateManager = {
  current: null,
  gallery: { images: [] },
  failCount: 0,
  errorShown: false,
  listeners: [],

  async loadGallery() {
    try {
      const res = await fetch(`gallery.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.images)) return { images: [] };
      return data;
    } catch (e) {
      console.warn(`gallery.json load fail (silent fallback): ${e.message}`);
      return { images: [] };
    }
  },

  async load() {
    try {
      const [stateRes, nextGallery] = await Promise.all([
        fetch(`state.json?t=${Date.now()}`),
        this.loadGallery(),
      ]);
      if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
      const nextState = await stateRes.json();
      this.failCount = 0;
      if (this.errorShown) this.hideError();
      const stateChanged = JSON.stringify(nextState) !== JSON.stringify(this.current);
      const galleryChanged = JSON.stringify(nextGallery) !== JSON.stringify(this.gallery);
      this.current = nextState;
      this.gallery = nextGallery;
      if (stateChanged || galleryChanged) this.emitChange();
    } catch (e) {
      this.failCount++;
      console.warn(`state.json load fail #${this.failCount}: ${e.message}`);
      if (this.failCount >= 3 && !this.errorShown) {
        this.showError(e);
        this.errorShown = true;
      }
    }
  },

  showError(e) {
    const stage = document.getElementById("stage");
    if (!stage) return;
    stage.innerHTML = `
      <div style="padding:40px;color:#a33;font-family:sans-serif;background:#fff;height:100%;">
        <h2>Не удалось загрузить state.json</h2>
        <p>${e.message}</p>
        <p>Проверь что файл state.json существует и валидный JSON.</p>
      </div>
    `;
  },

  hideError() {
    this.errorShown = false;
  },

  onChange(fn) { this.listeners.push(fn); },
  emitChange() { this.listeners.forEach(fn => fn(this.current, this.gallery)); },

  start() {
    this.load();
    setInterval(() => this.load(), 1500);
  }
};

window.StateManager = StateManager;
document.addEventListener("DOMContentLoaded", () => StateManager.start());
