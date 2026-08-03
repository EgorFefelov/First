"""
remove_bg — вырезает фон у картинки и обрезает по содержимому (PNG с альфой).
Вход: PNG/JPG с фоном (шахматка Nano Banana или сплошной цвет). Выход: PNG с прозрачностью.

  python tools/remove_bg.py in.png out.png                  # шахматный/белый фон
  python tools/remove_bg.py in.png out.png --color #00ff00  # одноцветный фон
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

USAGE = __doc__ + """
Опции:
  --color #rrggbb   фон — сплошной цвет (без флага — режим checker: светлый ненасыщенный)
  --tol N           допуск сравнения цвета (по умолчанию 24)
  --help, -h        эта справка
"""


def parse_hex_color(s):
    s = s.lstrip("#")
    if len(s) != 6:
        raise ValueError(f"bad hex color: {s!r}")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def make_is_bg(mode, target=None, tol=24):
    """Вернуть функцию-предикат is_bg(px) под выбранный режим."""
    if mode == "checker":
        def is_bg(px):
            r, g, b = px[0], px[1], px[2]
            light = r > 200 and g > 200 and b > 200
            neutral = (max(r, g, b) - min(r, g, b)) < 22
            return light and neutral
        return is_bg

    if mode == "color":
        tr, tg, tb = target
        tol_sq = tol * tol * 3   # сравнение в квадрате нормы
        def is_bg(px):
            dr = px[0] - tr
            dg = px[1] - tg
            db = px[2] - tb
            return (dr * dr + dg * dg + db * db) <= tol_sq
        return is_bg

    raise ValueError(f"unknown mode: {mode}")


def remove_bg(in_path, out_path, mode="checker", target=None, tol=24):
    im = Image.open(in_path).convert("RGB")
    w, h = im.size
    px = im.load()

    is_bg = make_is_bg(mode, target=target, tol=tol)

    # маска фона: flood fill от границ
    bg = bytearray(w * h)        # 1 = background
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not seen[i]:
            seen[i] = 1
            if is_bg(px[x, y]):
                bg[i] = 1
                q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)

    # альфа: 0 на фоне, 255 на объекте
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    cut = 0
    for y in range(h):
        for x in range(w):
            if bg[y * w + x]:
                ap[x, y] = 0
                cut += 1

    # feather: лёгкий блюр маски смягчает резкий край
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

    out = im.convert("RGBA")
    out.putalpha(alpha)

    # tight crop по непрозрачной части
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)

    out.save(out_path)
    print(f"{in_path}")
    print(f"  mode={mode}  bg removed: {100*cut/(w*h):.1f}%  -> {out.size}")


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if "--help" in argv or "-h" in argv or len(argv) < 3:
        print(USAGE)
        sys.exit(0)
    in_path, out_path = argv[1], argv[2]
    mode = "checker"
    target = None
    tol = 24
    i = 3
    while i < len(argv):
        a = argv[i]
        if a == "--color":
            mode = "color"
            target = parse_hex_color(argv[i + 1])
            i += 2
        elif a == "--tol":
            tol = int(argv[i + 1])
            i += 2
        else:
            print(f"unknown arg: {a}")
            sys.exit(2)
    remove_bg(in_path, out_path, mode=mode, target=target, tol=tol)


if __name__ == "__main__":
    main(sys.argv)
