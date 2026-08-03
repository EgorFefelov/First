#!/usr/bin/env python3
"""Конвертация картинок в WebP для публикации (projects/media/).

Использование:
    python scripts/webp_convert.py <вход.png|jpg> <выход.webp>
    python scripts/webp_convert.py <вход-папка> <выход-папка>

Пример (наставнику): перенести кадр комикса в media/ перед публикацией:
    python scripts/webp_convert.py generated/experiments/frame_1.png projects/media/comics/frame_1.webp

Качество 85, прозрачность (альфа) сохраняется. Выходную папку создаёт сам.
"""

import sys
from pathlib import Path

# Windows-консоль может быть не-UTF8 — кириллица в выводе не должна ронять скрипт
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

QUALITY = 85
INPUT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def convert_one(src: Path, dst: Path) -> None:
    from PIL import Image

    dst.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(src)
    # Безусловный RGBA для любого входа: покрывает палитровые PNG, RGB и RGBA;
    # альфа сохраняется там, где была.
    img = img.convert("RGBA")
    img.save(dst, "WEBP", quality=QUALITY)
    kb_in = src.stat().st_size // 1024
    kb_out = dst.stat().st_size // 1024
    print(f"{src}: {kb_in} KB -> {kb_out} KB")


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if "--help" in sys.argv or "-h" in sys.argv else 2

    src, dst = Path(sys.argv[1]), Path(sys.argv[2])

    if src.is_dir():
        files = sorted(p for p in src.iterdir()
                       if p.is_file() and p.suffix.lower() in INPUT_EXTS)
        if not files:
            print(f"В папке {src} нет картинок ({', '.join(sorted(INPUT_EXTS))})")
            return 1
        for f in files:
            convert_one(f, dst / (f.stem + ".webp"))
        return 0

    if not src.is_file():
        print(f"Файл не найден: {src}")
        return 1
    convert_one(src, dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
