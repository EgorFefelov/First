function renderBubble(state) {
  const area = document.getElementById("hero-area");
  if (!area) return;

  const existing = area.querySelector(".bubble-wrap");

  if (!state || !state.hero || state.hero.stage !== "bubble") {
    if (existing) existing.remove();
    return;
  }

  const h = state.hero;
  const html = `
    <div class="bubble-wrap">
      <img class="bubble-img" src="bubble.png" alt="Бабл">
      <div class="bubble-say">${h.say || ""}</div>
    </div>
  `;

  if (existing) existing.outerHTML = html;
  else area.insertAdjacentHTML("beforeend", html);
}

window.StateManager && StateManager.onChange(renderBubble);
