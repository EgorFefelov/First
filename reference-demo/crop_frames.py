"""
crop_frames.py — обрезает рамку-кайму у кадров Nano Banana и приводит
всю серию к единому квадратному размеру.

Nano Banana рисует картинку внутри квадрата 1024x1024, добавляя по краям
тонкую почти-белую кайму («стикер-рамка»). Этот скрипт срезает кайму и
ресайзит каждый кадр к одному размеру — чтобы игра работала с единой
пропоцией сцен.

Запуск:  python reference-demo/crop_frames.py
Требует: Pillow  (pip install Pillow)
"""
from PIL import Image
import os

SRC = "reference-demo/process"
DST = "reference-demo/comic"
SIZE = 900  # единый размер кадра на выходе, квадрат SIZE x SIZE

# Кадры в порядке истории. Имя в process -> имя в comic.
FRAMES = [
    ("scene_1_apartment_canon", "scene_1.png"),  # квартира разработчика
    ("italy_v2",                "scene_2.png"),  # Италия
    ("usa_v1",                  "scene_3.png"),  # Америка
    ("japan_v1",                "scene_4.png"),  # Япония
    ("norway_v1",               "scene_5.png"),  # Норвегия
    ("kitchen_fridge_v2",       "scene_6.png"),  # кухня с холодильником (крупный план)
]

# Общий безопасный кроп-прямоугольник (по замеру bbox всех кадров).
# Берём с небольшим запасом внутрь, чтобы гарантированно срезать кайму.
CROP = (48, 48, 976, 976)


def main():
    os.makedirs(DST, exist_ok=True)
    for src_name, dst_name in FRAMES:
        src_path = os.path.join(SRC, src_name + ".png")
        dst_path = os.path.join(DST, dst_name)
        im = Image.open(src_path).convert("RGB")
        cropped = im.crop(CROP)
        resized = cropped.resize((SIZE, SIZE), Image.LANCZOS)
        resized.save(dst_path)
        print(f"{src_name} -> {dst_name}  {resized.size}")
    print(f"Done. {len(FRAMES)} frames -> {DST}/ ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
