"""Third pass: about 30% head ratio, photo proportions for the torso, photo forearms in guard, shaped shared legs."""
import importlib.util
import os
import sys
from dataclasses import dataclass
from statistics import median

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = sys.argv[1]
REPO = sys.argv[2]
spec = importlib.util.spec_from_file_location("px", os.path.join(REPO, "pipeline", "pixelate_sprites.py"))
px = importlib.util.module_from_spec(spec)
spec.loader.exec_module(px)

BODY_SCALE = 0.16
HEAD_SCALE = 0.40
ELBOW_Y = 490


@dataclass
class Spec:
    key: str
    label: str
    cx: int
    chin: int
    jaw_top: int
    jaw_half: int
    neck_half: int
    neck_y: int
    neck_x: int
    shorts: tuple[int, int]
    shorts_top: int
    arm_l: list[tuple[int, int]]
    arm_r: list[tuple[int, int]]
    shoulder_l: tuple[int, int]
    elbow_l: int
    elbow_r: int
    wrist_lx: int
    wrist_rx: int


SPECS = [
    Spec("omalley", "Sean O'Malley", 128, 118, 72, 31, 36, 250, 205, (100, 320), 655,
         [(90, 320), (150, 360), (135, 480), (115, 560), (95, 700), (0, 700), (0, 500), (30, 330)],
         [(300, 320), (345, 330), (390, 400), (420, 700), (318, 700), (312, 560), (300, 480)],
         (90, 345), 65, 345, 58, 365),
    Spec("adesanya", "Israel Adesanya", 127, 116, 72, 30, 36, 235, 200, (105, 355), 650,
         [(30, 290), (100, 310), (105, 400), (95, 550), (85, 700), (0, 700), (0, 400)],
         [(350, 300), (410, 300), (450, 420), (460, 700), (355, 700), (360, 550), (345, 400)],
         (60, 330), 50, 395, 42, 395),
    Spec("pereira", "Alex Pereira", 130, 113, 70, 31, 36, 215, 250, (105, 360), 570,
         [(60, 270), (130, 300), (135, 400), (100, 510), (105, 600), (110, 700), (30, 700), (0, 540), (0, 400)],
         [(330, 260), (400, 290), (420, 400), (440, 520), (460, 680), (460, 700), (360, 700), (355, 560), (355, 430)],
         (85, 320), 50, 385, 78, 400),
]


def load(key, kind):
    return Image.open(os.path.join(ROOT, "photos", f"{key}_{kind}.png")).convert("RGBA")


def quantize_opaque(img, colors):
    pixels = [p[:3] for p in img.getdata() if p[3] >= 96]
    strip = Image.new("RGB", (len(pixels), 1))
    strip.putdata(pixels)
    palette = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    mapped = img.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    src, dst, alpha = mapped.load(), out.load(), img.getchannel("A").load()
    for y in range(img.height):
        for x in range(img.width):
            if alpha[x, y] >= 96:
                dst[x, y] = (*src[x, y], 255)
    return out


def skin_tones(sp):
    head = load(sp.key, "head")
    samples = []
    for dx in (-19, 19):
        box = head.crop((sp.cx + dx - 5, 74, sp.cx + dx + 5, 84))
        samples += [p[:3] for p in box.getdata() if p[3] > 200]
    base = tuple(int(median(c)) for c in zip(*samples))
    return base, tuple(int(c * 0.70) for c in base), tuple(min(255, int(c * 1.14)) for c in base)


def make_head(sp):
    img = load(sp.key, "head")
    mask = img.getchannel("A").copy()
    m = mask.load()
    for y in range(img.height):
        for x in range(img.width):
            d = abs(x - sp.cx)
            if y > sp.chin:
                m[x, y] = 0
            elif y >= sp.jaw_top:
                t = (y - sp.jaw_top) / max(1, sp.chin - sp.jaw_top)
                limit = sp.jaw_half * (1 - t * t) ** 0.5 + 3
                if limit < d < sp.neck_half + 3:
                    m[x, y] = 0
    img.putalpha(mask)
    img = img.crop(img.getchannel("A").getbbox())
    img = px.enhance_tattoos_and_details(img, contrast=1.25, sharpness=1.7)
    small = img.resize((round(img.width * HEAD_SCALE), round(img.height * HEAD_SCALE)), Image.Resampling.BOX)
    return quantize_opaque(small, 24)


def sc(v):
    return round(v * BODY_SCALE)


def largest_component(img):
    a = img.getchannel("A").load()
    seen, best = set(), []
    for y in range(img.height):
        for x in range(img.width):
            if a[x, y] == 0 or (x, y) in seen:
                continue
            stack, comp = [(x, y)], []
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < img.width and 0 <= ny < img.height and a[nx, ny] > 0 and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    src, dst = img.load(), out.load()
    for p in best:
        dst[p] = src[p]
    return out


def glove(target, cx, cy):
    g = ImageDraw.Draw(target)
    g.rounded_rectangle([cx - 7, cy, cx + 7, cy + 12], radius=4, fill=(28, 28, 34, 255))
    g.rectangle([cx - 4, cy + 3, cx, cy + 4], fill=(84, 84, 96, 255))
    g.rectangle([cx - 7, cy - 2, cx + 7, cy - 1], fill=(190, 190, 196, 255))


LEG_PROFILE = [16, 16, 16, 15, 15, 14, 12, 12, 12, 13, 13, 13, 12, 11, 10, 9, 8, 8]


def draw_leg(d, top_x, top_y, side, tones):
    base, shade, light = tones
    rows = len(LEG_PROFILE) * 2 - 8
    for i in range(rows):
        half = LEG_PROFILE[min(i * len(LEG_PROFILE) // rows, len(LEG_PROFILE) - 1)]
        drift = side * i // 6
        cx = top_x + drift
        left, right = cx - half // 2, cx + half // 2
        y = top_y + i
        d.line([(left, y), (right, y)], fill=(*base, 255))
        d.line([(right - max(2, half // 3), y), (right, y)], fill=(*shade, 255))
        d.point((left + 1, y), fill=(*light, 255))
        if rows * 0.44 < i < rows * 0.50:
            d.line([(left + 2, y), (right - 3, y)], fill=(*shade, 255))
    fy = top_y + rows
    cx = top_x + side * rows // 6
    half = LEG_PROFILE[-1] // 2
    fl, fr = (cx - half - 5, cx + half) if side < 0 else (cx - half, cx + half + 5)
    d.rounded_rectangle([fl, fy, fr, fy + 3], radius=1, fill=(*base, 255))
    d.line([(fl, fy + 3), (fr, fy + 3)], fill=(*shade, 255))


def make_fighter(sp, pose="idle"):
    photo = load(sp.key, "body")
    src = photo.crop((0, sp.neck_y, photo.width, 700))
    src = px.enhance_tattoos_and_details(src, contrast=1.22, sharpness=1.6)
    w, h = sc(src.width), sc(src.height)
    body = quantize_opaque(src.resize((w, h), Image.Resampling.BOX), 32)

    def part_mask(poly, rows=None, grow=False):
        mask = Image.new("L", photo.size, 0)
        ImageDraw.Draw(mask).polygon(poly, fill=255)
        if rows:
            ImageDraw.Draw(mask).rectangle([0, rows[0], photo.width, rows[1]], fill=0)
        mask = mask.crop((0, sp.neck_y, photo.width, 700))
        small = mask.resize((w, h), Image.Resampling.BOX).point(lambda a: 255 if a >= 128 else 0)
        return small.filter(ImageFilter.MaxFilter(3)) if grow else small

    empty = Image.new("RGBA", body.size, (0, 0, 0, 0))
    both = Image.new("L", body.size, 0)
    both.paste(255, (0, 0), part_mask(sp.arm_l, grow=True))
    both.paste(255, (0, 0), part_mask(sp.arm_r, grow=True))
    torso = largest_component(Image.composite(empty, body, both))

    upper_l, fore_l = part_mask(sp.arm_l, (ELBOW_Y, 700), True), part_mask(sp.arm_l, (0, ELBOW_Y - 1), True)
    upper_r, fore_r = part_mask(sp.arm_r, (ELBOW_Y, 700), True), part_mask(sp.arm_r, (0, ELBOW_Y - 1), True)
    full_l = part_mask(sp.arm_l, grow=True)

    tones = skin_tones(sp)
    head = make_head(sp)

    pad_l, pad_r, pad_t, pad_b = 90, 90, head.height + 4, 60
    cw, ch = w + pad_l + pad_r, h + pad_t + pad_b
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    x0, y0 = pad_l, pad_t
    bottom = y0 + h
    sx0, sx1 = sc(sp.shorts[0]), sc(sp.shorts[1])
    lean = 4 if pose == "punch" else 0

    # shared legs
    ext = 15
    d = ImageDraw.Draw(canvas)
    mid = (sx0 + sx1) // 2
    quarter = (sx1 - sx0) // 4
    hip_y = bottom + ext - 3
    draw_leg(d, x0 + mid - quarter, hip_y, -1, tones)
    draw_leg(d, x0 + mid + quarter, hip_y, 1, tones)

    # shorts: mirror-tile the photo's shorts rows, with a split at the hem
    avail = 4  # only the last rows: higher rows can include waist skin
    strip = body.crop((sx0, h - avail, sx1, h))
    fill = strip.getpixel((strip.width // 2, strip.height - 1))
    flat = Image.new("RGBA", strip.size, fill)
    flat.alpha_composite(strip)
    shorts = Image.new("RGBA", (flat.width + 4, ext), (0, 0, 0, 0))
    y, flip = 0, True
    while y < ext:
        tile = flat.transpose(Image.Transpose.FLIP_TOP_BOTTOM) if flip else flat
        shorts.paste(tile.resize((shorts.width, tile.height), Image.Resampling.NEAREST), (0, y))
        y += tile.height
        flip = not flip
    notch = ImageDraw.Draw(shorts)
    notch.rectangle([shorts.width // 2 - 1, ext - 5, shorts.width // 2, ext - 1], fill=(0, 0, 0, 0))
    canvas.alpha_composite(shorts, (x0 + sx0 - 2, bottom - 1))

    canvas.alpha_composite(torso, (x0 - lean, y0))

    def layer_of(mask):
        layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        layer.alpha_composite(Image.composite(body, empty, mask), (x0, y0))
        return layer

    def guard_arm(fore_mask, elbow_x, wrist_x, angle):
        layer = layer_of(fore_mask)
        glove(layer, x0 + sc(wrist_x), bottom)
        pivot = (x0 + sc(elbow_x), y0 + sc(ELBOW_Y - sp.neck_y))
        return largest_component(layer.rotate(angle, resample=Image.Resampling.NEAREST, center=pivot))

    def hanging_arm(mask, wrist_x):
        layer = layer_of(mask)
        glove(layer, x0 + sc(wrist_x), bottom - 2)
        return largest_component(layer)

    canvas.alpha_composite(hanging_arm(part_mask(sp.arm_r, grow=True), sp.wrist_rx), (-lean, 0))

    hx = x0 + sc(sp.neck_x) - head.width // 2 - lean
    hy = y0 - head.height + 3
    canvas.alpha_composite(head, (hx, max(0, hy)))

    if pose == "idle":
        canvas.alpha_composite(hanging_arm(full_l, sp.wrist_lx), (0, 0))
    else:
        layer = layer_of(full_l)
        glove(layer, x0 + sc(sp.wrist_lx), bottom)
        pivot = (x0 + sc(sp.shoulder_l[0]), y0 + sc(sp.shoulder_l[1] - sp.neck_y))
        canvas.alpha_composite(
            largest_component(layer.rotate(-82, resample=Image.Resampling.NEAREST, center=pivot)), (-lean, 0))

    return px.apply_1px_dark_outline(canvas.crop(canvas.getchannel("A").getbbox()))


def font(size, bold=False):
    return ImageFont.truetype("C:/Windows/Fonts/msjhbd.ttc" if bold else "C:/Windows/Fonts/msjh.ttc", size)


def nearest(img, k):
    return img.resize((img.width * k, img.height * k), Image.Resampling.NEAREST)


def comparison():
    k = 3
    rows = []
    for sp in SPECS:
        old = px.pixelate_cutout(load(sp.key, "body"), target_height=116)
        g = make_fighter(sp)
        p = make_fighter(sp, "punch").transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        head = make_head(sp)
        rows.append((sp, old, g, p))
        print(sp.key, "fighter", g.size, "head", head.size, "ratio", round(head.height / g.height, 2))
    label_w, gap = 170, 30
    col_a = max(r[1].width for r in rows) * k + gap
    col_b = max(r[2].width for r in rows) * k + gap
    col_c = max(r[3].width for r in rows) * k + gap
    row_h = max(max(r[1].height, r[2].height, r[3].height) for r in rows) * k + 24
    sheet = Image.new("RGB", (label_w + col_a + col_b + col_c, row_h * 3 + 70), (26, 29, 42))
    d = ImageDraw.Draw(sheet)
    d.text((label_w, 18), "目前做法", font=font(26, True), fill=(250, 199, 117))
    d.text((label_w + col_a, 18), "約 30%：待機", font=font(26, True), fill=(250, 199, 117))
    d.text((label_w + col_a + col_b, 18), "出拳", font=font(26, True), fill=(250, 199, 117))
    for i, (sp, old, g, p) in enumerate(rows):
        y = 70 + i * row_h
        base = y + row_h - 12
        d.text((14, y + 10), sp.label.replace(" ", "\n"), font=font(24, True), fill=(240, 240, 240))
        for img, x in ((old, label_w), (g, label_w + col_a), (p, label_w + col_a + col_b)):
            big = nearest(img, k)
            sheet.paste(big, (x, base - big.height), big)
    sheet.save(os.path.join(ROOT, "out", "fighter_comparison_v3.png"))


def stage():
    """iPhone landscape 844x390pt drawn at 2x; each sprite pixel is 1.5pt."""
    W, H = 844 * 2, 390 * 2
    img = Image.new("RGB", (W, H), (18, 20, 31))
    d = ImageDraw.Draw(img)
    d.polygon([(W * 0.26, 0), (W * 0.74, 0), (W * 0.9, H * 0.72), (W * 0.1, H * 0.72)], fill=(38, 42, 62))
    d.rectangle([0, H * 0.72, W, H], fill=(52, 56, 74))
    for x in range(0, W, 26):
        d.line([(x, 0), (x, H * 0.72)], fill=(30, 33, 48), width=2)
    k = 3
    a = nearest(make_fighter(SPECS[2], "punch").transpose(Image.Transpose.FLIP_LEFT_RIGHT), k)
    b = nearest(make_fighter(SPECS[0]).transpose(Image.Transpose.FLIP_LEFT_RIGHT), k)
    floor = int(H * 0.84)
    img.paste(a, (int(W * 0.10), floor - a.height), a)
    img.paste(b, (int(W * 0.68), floor - b.height), b)
    print("stage fighter height pt", a.height / 2, "top y pt", (floor - a.height) / 2)

    # HUD and hand placeholders at the sizes used in the layout wireframe
    d.rectangle([0, 0, W, 76], fill=(30, 34, 51))
    d.rectangle([24, 20, 640, 40], fill=(226, 75, 74))
    d.rectangle([W - 640, 20, W - 24, 40], fill=(226, 75, 74))
    d.rectangle([W // 2 - 90, 12, W // 2 + 90, 56], fill=(250, 199, 117))
    card_w, card_h, n = 176, 250, 5
    start = W // 2 - (card_w * n - 28 * (n - 1)) // 2
    for i in range(n):
        x = start + i * (card_w - 28)
        d.rectangle([x, H - 150, x + card_w, H - 150 + card_h], fill=(241, 239, 232), outline=(18, 20, 31), width=4)
    img.save(os.path.join(ROOT, "out", "fighter_stage_v3.png"))


comparison()
stage()
