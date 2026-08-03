// Финальный герой (картинка). Реализация — step_4.
function renderHero(state) {
  console.log("[hero] state updated", state && state.hero && state.hero.avatar);
}
window.StateManager && StateManager.onChange(renderHero);
