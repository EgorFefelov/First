#!/usr/bin/env bash
# Сброс форка к чистому состоянию для нового прохождения курса.
# Перед очисткой делает полный backup в .backups/<timestamp>/:
# state.json, gallery.json, generated/ (tar.gz), projects/ (tar.gz).
#
# Использование:
#   bash scripts/reset.sh           — backup + сброс
#   bash scripts/reset.sh --no-backup — только сброс (без backup)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_BACKUP=1
if [ "${1:-}" = "--no-backup" ]; then
  DO_BACKUP=0
fi

TS="$(date +%Y-%m-%d_%H-%M-%S)"

if [ "$DO_BACKUP" = "1" ]; then
  BK=".backups/${TS}"
  mkdir -p "$BK"
  if [ -f state.json ];   then cp state.json   "$BK/state.json";   echo "  backup: $BK/state.json"; fi
  if [ -f gallery.json ]; then cp gallery.json "$BK/gallery.json"; echo "  backup: $BK/gallery.json"; fi
  if [ -d generated ] && [ -n "$(ls -A generated 2>/dev/null)" ]; then
    tar -czf "$BK/generated.tar.gz" generated
    echo "  backup: $BK/generated.tar.gz"
  fi
  if [ -d projects ] && [ -n "$(ls -A projects 2>/dev/null)" ]; then
    tar -czf "$BK/projects.tar.gz" projects
    echo "  backup: $BK/projects.tar.gz"
  fi
fi

# state.json — чистый стартовый (из _templates/)
cp _templates/state.json state.json
echo "  reset: state.json"

# gallery.json — пустая галерея (из _templates/)
cp _templates/gallery.json gallery.json
echo "  reset: gallery.json"

# Очистить experiments/ (но не сам каталог)
if [ -d generated/experiments ]; then
  find generated/experiments -mindepth 1 -delete
  echo "  reset: generated/experiments/ (cleared)"
fi

# projects/media/ — gitignored, git checkout/clean её не трогают: чистим явно
# (backup выше уже забрал её внутри projects.tar.gz)
if [ -d projects/media ]; then
  rm -rf projects/media/ 2>/dev/null || true
  echo "  reset: projects/media/ (removed)"
fi

# projects/ — вернуть заводское (game плейсхолдеры + пустые comics/, site/ из git).
# Сюда же откатывается projects/comics/: заготовка страницы + пустой data/state.json.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git checkout -- projects/ 2>/dev/null || true
  git clean -fdq projects/ 2>/dev/null || true
  echo "  reset: projects/ (factory state restored)"
fi

echo
echo "Готово. Форк готов к новому прохождению."
