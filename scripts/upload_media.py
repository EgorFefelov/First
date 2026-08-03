#!/usr/bin/env python3
"""Публикация картинок ученика: projects/media/** -> https://teens.make-it.kz/<ник>/media/…

Запуск (обычно через скилл publish-media):
    CAMP_UPLOAD_KEY=<ключ> python scripts/upload_media.py

Ник берётся из state.json (site.published.nick), ключ — из окружения.
Контракт API — make-kid/task_tracker/todo/student-deploy-flow/PLAN.md К2.
Повторный запуск — норма: файлы перезаписываются по имени.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Windows-консоль может быть не-UTF8 — вывод не должен ронять скрипт
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://teens.make-it.kz/api/upload"
MAX_BYTES = 5 * 1024 * 1024
EXTS = {".webp", ".png", ".jpg", ".jpeg"}
CONTENT_TYPES = {".webp": "image/webp", ".png": "image/png",
                 ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "projects" / "media"


def main() -> int:
    try:
        # utf-8-sig: виндовые редакторы иногда сохраняют state.json с BOM (реальный кейс — kirill)
        state = json.loads((ROOT / "state.json").read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        print("Не нашёл state.json — запусти из репозитория курса.")
        return 2
    nick = (state.get("site", {}).get("published", {}).get("nick") or "").strip()
    if not nick:
        print("Ник не настроен (state.json → site.published.nick) — скажи наставнику.")
        return 2

    key = os.environ.get("CAMP_UPLOAD_KEY", "")
    if not key:
        print("Ключ не настроен (CAMP_UPLOAD_KEY) — позови взрослого.")
        return 2

    if not MEDIA.is_dir():
        print("Папка projects/media/ пуста — публиковать пока нечего.")
        return 0

    files = sorted(p for p in MEDIA.rglob("*")
                   if p.is_file() and p.suffix.lower() in EXTS)
    if not files:
        print("В projects/media/ нет картинок — публиковать пока нечего.")
        return 0

    sent = skipped = failed = 0
    for f in files:
        rel = f.relative_to(MEDIA).as_posix()  # <продукт>/<файл>
        size = f.stat().st_size
        if size > MAX_BYTES:
            print(f"⚠️  {rel}: слишком тяжёлая ({size // 1024} KB) — попроси наставника пережать. Пропускаю.")
            skipped += 1
            continue

        req = urllib.request.Request(
            f"{BASE_URL}/{nick}/media/{rel}",
            data=f.read_bytes(),
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": CONTENT_TYPES[f.suffix.lower()],
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                json.loads(resp.read())
            print(f"✅ {rel} ({size // 1024} KB)")
            sent += 1
        except urllib.error.HTTPError as exc:
            try:
                err = json.loads(exc.read()).get("error", "")
            except (json.JSONDecodeError, OSError):
                err = ""
            if exc.code == 409 and err == "code-not-deployed":
                print("Сайт ещё не выложен — сначала шаг 4.3 (деплой кода). Потом запусти меня снова.")
                return 1
            print(f"❌ {rel}: ошибка {exc.code} {err} — покажи наставнику.")
            failed += 1
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"❌ {rel}: нет связи с сервером ({exc}) — проверь интернет, покажи наставнику.")
            failed += 1

    print(f"\nИтог: залито {sent}, пропущено {skipped}, ошибок {failed}")
    if sent and not failed:
        print(f"Смотри: https://teens.make-it.kz/{nick}/")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
