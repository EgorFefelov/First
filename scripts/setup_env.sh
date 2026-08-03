#!/usr/bin/env bash
# setup_env.sh — проверка и установка окружения курса «make it, teens» (macOS / Linux).
#
# Запуск (в терминале VS Code):
#   bash scripts/setup_env.sh
#
# Что делает: печатает OK/-- по каждому слою окружения и доставляет недостающее.
# git здесь НЕ ставится: он нужен раньше, чтобы склонировать этот репозиторий.
#
# Безопасно перезапускать: уже установленное пропускается.

set -uo pipefail

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRAY=$'\033[0;90m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'

missing=()

ok()   { printf '  %sOK   %s — %s%s\n' "$GREEN" "$1" "$2" "$NC"; }
fail() { printf '  %s--   %s — не установлен%s\n' "$RED" "$1" "$NC"
         printf '       %s%s%s\n' "$GRAY" "$2" "$NC"
         missing+=("$1"); }
work() { printf '  %s..   %s — ставлю...%s\n' "$YEL" "$1" "$NC"; }

printf '\n%s=== Окружение курса «make it, teens» ===%s\n\n' "$CYAN" "$NC"

# --- Homebrew: нужен для установки остального на маке ---
HAS_BREW=0
command -v brew >/dev/null 2>&1 && HAS_BREW=1

# --- git (только проверка) ---
if command -v git >/dev/null 2>&1; then
  ok "git" "$(git --version)"
else
  fail "git" "Установи Xcode Command Line Tools: xcode-select --install"
fi

# --- Python ---
PY=""
command -v python3 >/dev/null 2>&1 && PY=python3
if [ -n "$PY" ]; then
  ok "python" "$($PY --version 2>&1)"
else
  work "python"
  if [ "$HAS_BREW" -eq 1 ]; then
    brew install python >/dev/null 2>&1
    if command -v python3 >/dev/null 2>&1; then PY=python3; ok "python" "$(python3 --version 2>&1)"
    else fail "python" "Не поднялся. Открой НОВЫЙ терминал и запусти скрипт снова."; fi
  else
    fail "python" "Поставь Homebrew (brew.sh), либо скачай с python.org."
  fi
fi

# --- Node.js ---
if command -v node >/dev/null 2>&1; then
  ok "node" "$(node --version)"
else
  work "node"
  if [ "$HAS_BREW" -eq 1 ]; then
    brew install node >/dev/null 2>&1
    if command -v node >/dev/null 2>&1; then ok "node" "$(node --version)"
    else fail "node" "Не поднялся. Открой НОВЫЙ терминал и запусти скрипт снова."; fi
  else
    fail "node" "nodejs.org -> кнопка LTS, либо поставь Homebrew (brew.sh)."
  fi
fi

# --- nano-banana-mcp (генератор картинок) ---
if command -v npm >/dev/null 2>&1; then
  if npm ls -g nano-banana-mcp --depth=0 2>/dev/null | grep -q 'nano-banana-mcp@'; then
    ver="$(npm ls -g nano-banana-mcp --depth=0 2>/dev/null | grep -o 'nano-banana-mcp@[0-9.]*' | head -1)"
    ok "nano-banana-mcp" "${ver#nano-banana-mcp@}"
  else
    work "nano-banana-mcp"
    npm install -g nano-banana-mcp >/dev/null 2>&1
    if npm ls -g nano-banana-mcp --depth=0 2>/dev/null | grep -q 'nano-banana-mcp@'; then
      ok "nano-banana-mcp" "установлен"
    else
      fail "nano-banana-mcp" "npm install -g nano-banana-mcp — запусти вручную и покажи ошибку учителю."
    fi
  fi
else
  fail "nano-banana-mcp" "Сначала нужен Node (npm идёт вместе с ним)."
fi

# --- Python-зависимости курса ---
if [ -n "$PY" ] && [ -f requirements.txt ]; then
  if $PY -m pip install -q -r requirements.txt >/dev/null 2>&1; then
    ok "Pillow (requirements.txt)" "установлен"
  else
    printf '  %s..   requirements.txt — не поставились, но курс это не блокирует%s\n' "$YEL" "$NC"
  fi
fi

# --- Итог ---
echo
if [ ${#missing[@]} -eq 0 ]; then
  printf '%sВсё готово. Можно работать.%s\n\n' "$GREEN" "$NC"
else
  printf '%sНе хватает: %s%s\n' "$RED" "$(IFS=', '; echo "${missing[*]}")" "$NC"
  printf '%sПодними руку — разберёмся вместе.%s\n\n' "$YEL" "$NC"
fi
