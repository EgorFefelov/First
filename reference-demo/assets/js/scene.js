// Применение state.scene.background к #stage. Реализация — step_4.
function applyScene(state) {
  console.log("[scene] state updated", state && state.scene);
}
window.StateManager && StateManager.onChange(applyScene);
