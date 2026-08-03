# .codex/ — конфиг для Codex (OpenAI)

Этот форк работает с **двумя** AI-наставниками:

| Клиент | Инструкции наставника | Объявление MCP |
|--------|------------------------|----------------|
| **Codex** (OpenAI) | `AGENTS.md` в корне (мост на `.claude/CLAUDE.md`) | `.codex/config.toml` (этот каталог) |
| **Claude Code** (Anthropic) | `.claude/CLAUDE.md` (канон) | `.mcp.json` в корне |

Канон наставника — один файл (`.claude/CLAUDE.md`). `AGENTS.md` его подтягивает. Не дублируем.

---

## MCP nano-banana: сейчас тест (токен в конфиге), потом прокси

**Сейчас** (для теста) оба клиента запускают nano-banana как локальный **stdio**-сервер
(`npx nano-banana-mcp`). Токен Gemini вписывается **прямо в конфиг** (заглушка `PASTE_GEMINI_KEY_HERE`).

**Потом** (прод) — через наш прокси (`teens.make-it.kz`), токен на сервере, ребёнок его не видит.
Прод-конфиги сохранены рядом: `.mcp.proxy.json.example` (Claude) и закомментированный блок в `config.toml` (Codex).

---

## Завтра на Маке — вставил ключ и запустил

1. Открой `.mcp.json` (Claude) и/или `.codex/config.toml` (Codex), замени `PASTE_GEMINI_KEY_HERE`
   на реальный ключ Gemini. Ключ — существующий или новый на https://aistudio.google.com/apikey
2. Запусти клиента:
   - **Claude Code:** `claude` в корне форка → подтвердить project-MCP `nano-banana` → `/mcp` проверить.
   - **Codex:** пометить проект trusted → запустить → проверить что видит `nano-banana`.

> ⚠️ После теста НЕ коммить конфиг с реальным ключом — верни заглушку `PASTE_GEMINI_KEY_HERE`.
> Перед коммитом глянь `git diff .mcp.json .codex/config.toml` — там не должно быть ключа.
