# Схема state.json под блок 2 — секции `public` и `deploy`

> Статус: **ИСТОРИЧЕСКИЙ ДОКУМЕНТ.** Секции 2–5 — проект на бумаге (шаг 6 плана
> refactor-course-block2-tech), который **не был реализован в этом виде**: вместо
> `public` и `deploy` в state появилось одно поле `site.published`. Читать как
> запись хода мысли, не как описание системы.
> Актуальное описание контракта — `.claude/CLAUDE.md`, блок «Запись в state.json».
> Источники: `deploy_architecture.md`, `prototype.md`, CODE_REVIEW п.3.

---

## 1. Структура state.json — АКТУАЛЬНО (контракт v2, 2026-08-01)

**Принцип: данные продукта живут внутри продукта. В корневом `state.json` —
только ребёнок и его маршрут по курсу.**

Корневой `state.json`:

```
current_step   str    — где ученик в методичке
profile        dict   — имя/возраст/интересы ученика
progress       dict   — пункты чеклистов: done | skipped | pending + note
checkpoints    dict   — "<шаг>.done" и "L<N>.done"
hero           dict   — Бабл/герой (stage, name, description, avatar, mood, say)
site.published dict   — nick, url, deployed, prod_checked, shared
```

Файлы продуктов (то, что раньше лежало в state):

```
projects/comics/data/state.json   — story[] + comic.frames[]  ← рендерит comics/comic.js
projects/game/config.js           — SCENES, MODULES, настройки ← читает движок core.js
projects/game/playtest.json       — tester, notes, fixes (юзертест 2.7)
projects/site/index.html          — имя, фраза, факты, карточки, ссылки (в разметке)
gallery.json                      — картинки для галереи: path, step, ts
```

**Убрано из корневого state** (контракт v2): `comic`, `story`, `game`, `scene`,
`last_image`, `prompts`, `scenes`, все `site.*` кроме `published`. Причина —
дублировали диск и потому расходились с ним: `state.game` был пуст при собранных
играх, `comic.frames` вёл на пути, которых уже нет.

Навыки (`skills`) — отдельная задача `task_tracker/backlog/skills_from_state.md`, ЗДЕСЬ не дублируем.

---

## 2. Предлагаемые новые секции

### 2.1 `public` — что собрано в паблик ученика

Описывает проекты ученика и их статус. Привязка к нашей раскладке самодостаточных проектов
(см. `STRUCTURE.md`): каждый проект = папка в `public/`, `id` = имя папки.

```jsonc
"public": {
  "entry": "site",        // папка-точка входа (визитка, «собирает» остальные)
  "projects": [
    {
      "id": "comics",               // = имя папки проекта в public/
      "type": "comic",              // comic | game | app | agent — задаёт иконку/обложку на визитке (сквозные, см. prototype.md «граница свободы»)
      "title": "Лис и пропавшая звезда",
      "status": "deployed",         // deployed | building | ghost
      "card": "live"                // live = кликабельная карточка-ссылка; ghost = заглушка .ghost
    },
    {
      "id": "game",
      "type": "game",
      "title": "Космо-прыжки",
      "status": "deployed",
      "card": "live"
    },
    {
      "id": "app",
      "type": "app",
      "title": "Приложение",
      "status": "ghost",            // ещё не сделан → карточка-призрак
      "card": "ghost"
    }
  ]
}
```

### 2.2 `deploy` — куда и когда задеплоено

Один на ученика (а не на проект): все проекты ученика уезжают вместе в его папку `students/<ник>/`
(см. `deploy_architecture.md`, развилка 2 — один форк, одна папка деплоя).

```jsonc
"deploy": {
  "nick": "renatmannanov",          // ник = имя папки на VPS, латиница, против стоп-листа (deploy_architecture.md)
  "url": "https://teens.make-it.kz/renatmannanov",
  "status": "live",                 // none | building | live | error
  "last_deployed_at": "2026-06-18T12:00:00Z",
  "phase": 1                        // 1 = ручной деплой (Ренат), 2 = самообслуживание через скил (позже)
}
```

---

## 3. Связка с визиткой (правило кликабельности)

Из `prototype.md` (2.2) и границы свободы: **href и кликабельность карточки проставляет Бабл/деплой, не ребёнок.**

Правило рендера карточки на визитке:
- `project.card == "live"` И `project.status == "deployed"` → карточка = `<a href="../<id>/">` (кликабельная).
- иначе → заглушка `.ghost` (как сейчас для ИИ-агента и приложения).

То есть карточка становится ссылкой **только если проект реально задеплоен**. Это убирает «битые» ссылки
на ещё не существующие проекты и делает рост витрины честным (см. prototype.md: проекты появляются по мере курса).

Связь с раскладкой: `href` карточки = `../<project.id>/` — ровно сёстры-папки из `STRUCTURE.md`
(`../comics/`, `../game/`). `id` в state == имя папки проекта. Один источник правды для имени.

---

## 4. Что НЕ здесь

- **Навыки (`skills`)** — отдельная задача `task_tracker/backlog/skills_from_state.md`. Там структурный список
  навыков с id (сейчас размазаны текстом в `progress[].note`). Не дублировать тут.
- **Правка боевого `state.json`** — вне этого документа. Это только проект схемы.
- **Микросервис деплоя фазы 2, nginx, стоп-лист ников** — инфраструктура, `deploy_architecture.md`.

---

## 5. Пример: полная связка (демо renatmannanov)

```jsonc
{
  // ... существующие ключи state.json без изменений ...
  "public": {
    "entry": "site",
    "projects": [
      { "id": "comics", "type": "comic", "title": "Лис и пропавшая звезда", "status": "deployed", "card": "live" },
      { "id": "game",   "type": "game",  "title": "Космо-прыжки",           "status": "deployed", "card": "live" },
      { "id": "app",    "type": "app",   "title": "Приложение",             "status": "ghost",    "card": "ghost" },
      { "id": "agent",  "type": "agent", "title": "ИИ-агент",               "status": "ghost",    "card": "ghost" }
    ]
  },
  "deploy": {
    "nick": "renatmannanov",
    "url": "https://teens.make-it.kz/renatmannanov",
    "status": "live",
    "last_deployed_at": "2026-06-18T12:00:00Z",
    "phase": 1
  }
}
```
