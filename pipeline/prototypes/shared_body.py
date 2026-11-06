"""Shared chibi rig + photo head + tattoos extracted from the photo and mapped onto limb textures."""
import importlib.util
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT, REPO = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("v3", os.path.join(ROOT, "tools", "chibi3.py"))
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)
px, load, nearest, font = v3.px, v3.load, v3.nearest, v3.font

# hand-measured photo boxes (x0, y0, x1, y1); Vision would supply these in the app
BOXES = {
    "omalley": dict(torso=(130, 300, 320, 655), ul=(40, 340, 130, 490), fl=(20, 490, 110, 700),
                    ur=(300, 340, 370, 490), fr=(318, 490, 400, 700)),
    "adesanya": dict(torso=(100, 280, 350, 650), ul=(5, 320, 100, 490), fl=(0, 490, 85, 700),
                     ur=(350, 320, 430, 490), fr=(355, 490, 440, 700)),
    "pereira": dict(torso=(130, 260, 360, 570), ul=(20, 290, 130, 490), fl=(10, 490, 105, 700),
                    ur=(335, 280, 410, 490), fr=(360, 490, 450, 700)),
}
SIZES = dict(torso=(32, 28), ul=(11, 16), ur=(11, 16), fl=(10, 15), fr=(10, 15))


def tattoo_layer(photo, box, size):
    """High-pass the photo so muscle shading drops out, keep dark or off-hue ink, then area-average."""
    crop = photo.crop(box)
    alpha = np.asarray(crop.getchannel("A"), dtype=float) / 255
    rgb_img = crop.convert("RGB")
    ycc = rgb_img.convert("YCbCr")
    blur = rgb_img.filter(ImageFilter.GaussianBlur(16)).convert("YCbCr")
    a, b = np.asarray(ycc, dtype=float), np.asarray(blur, dtype=float)
    dark = (b[..., 0] - a[..., 0]) > np.maximum(9, 0.14 * b[..., 0])
    hue = np.hypot(a[..., 1] - b[..., 1], a[..., 2] - b[..., 2]) > 11
    mask = (dark | hue) & (alpha > 0.9)
    rgb = np.asarray(crop.convert("RGB"), dtype=float)
    w, h = size
    out = np.zeros((h, w, 4), dtype=np.uint8)
    H, W = mask.shape
    for y in range(h):
        for x in range(w):
            y0, y1 = y * H // h, max(y * H // h + 1, (y + 1) * H // h)
            x0, x1 = x * W // w, max(x * W // w + 1, (x + 1) * W // w)
            m = mask[y0:y1, x0:x1]
            if m.mean() >= 0.30:
                out[y, x, :3] = rgb[y0:y1, x0:x1][m].mean(axis=0)
                out[y, x, 3] = 255
    return Image.fromarray(out, "RGBA")


def shorts_colors(sp, photo):
    crop = photo.crop((sp.shorts[0] + 15, 672, sp.shorts[1] - 15, 700)).convert("RGB")
    pal = crop.quantize(colors=2, method=Image.Quantize.MEDIANCUT).convert("RGB")
    counts = sorted(pal.getcolors(), reverse=True)
    main = counts[0][1]
    trim = counts[1][1] if len(counts) > 1 else tuple(int(c * 0.6) for c in main)
    return main, trim


def limb(w, h, tones, ink=None):
    """A shaded capsule. Ink is laid over the skin and clipped by the capsule."""
    base, shade, light = tones
    img = Image.new("RGBA", (w, h), (*base, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([w - max(2, w // 3), 0, w - 1, h - 1], fill=(*shade, 255))
    d.line([(1, 0), (1, h - 1)], fill=(*light, 255))
    if ink is not None:
        img.alpha_composite(ink.resize((w, h), Image.Resampling.NEAREST))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=min(w, h) // 3, fill=255)
    img.putalpha(mask)
    return img


def make_torso(tones, ink):
    base, shade, light = tones
    w, h = SIZES["torso"]
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(0, 2), (w - 1, 2), (w - 4, h - 1), (3, h - 1)], fill=(*base, 255))
    d.rectangle([3, 0, w - 4, 2], fill=(*base, 255))
    d.line([(w // 2, 8), (w // 2, h - 3)], fill=(*shade, 255))
    d.line([(5, 12), (w // 2 - 2, 13)], fill=(*shade, 255))
    d.line([(w // 2 + 2, 13), (w - 6, 12)], fill=(*shade, 255))
    d.line([(1, 3), (4, h - 2)], fill=(*light, 255))
    d.line([(w - 1, 3), (w - 4, h - 1)], fill=(*shade, 255))
    silhouette = img.getchannel("A")
    img.alpha_composite(ink)
    img.putalpha(silhouette)
    return img


def place(canvas, tex, joint, angle):
    """Hang tex from its top centre at joint, rotated (0 = down, positive swings toward +x)."""
    size = 2 * (tex.width + tex.height) + 8
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c = size // 2
    layer.alpha_composite(tex, (c - tex.width // 2, c))
    rot = layer.rotate(angle, resample=Image.Resampling.NEAREST, center=(c, c))
    canvas.alpha_composite(rot, (joint[0] - c, joint[1] - c))
    rad = math.radians(angle)
    return (round(joint[0] + math.sin(rad) * (tex.height - 2)), round(joint[1] + math.cos(rad) * (tex.height - 2)))


def glove_tex():
    img = Image.new("RGBA", (11, 11), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 2, 10, 10], radius=3, fill=(28, 28, 34, 255))
    d.rectangle([2, 4, 5, 5], fill=(84, 84, 96, 255))
    d.rectangle([1, 0, 9, 1], fill=(190, 190, 196, 255))
    return img


def foot_tex(tones, forward=1):
    base, shade, _ = tones
    img = Image.new("RGBA", (15, 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 0, 14 if forward > 0 else 12, 3], radius=1, fill=(*base, 255))
    d.line([(2, 3), (14 if forward > 0 else 12, 3)], fill=(*shade, 255))
    return img


POSES = {
    "guard": dict(ul=-38, fl=176, ur=38, fr=-176, tl=-12, cl=-4, tr=14, cr=4, dx=0, dy=0),
    "punch": dict(ul=-38, fl=176, ur=82, fr=88, tl=-16, cl=-6, tr=18, cr=6, dx=3, dy=0),
    "kick": dict(ul=-42, fl=172, ur=42, fr=-172, tl=-4, cl=-2, tr=82, cr=70, dx=-3, dy=0),
}


def make_fighter(sp, pose="guard"):
    photo = load(sp.key, "body")
    tones = v3.skin_tones(sp)
    ink = {k: tattoo_layer(photo, BOXES[sp.key][k], SIZES[k]) for k in SIZES}
    head = v3.make_head(sp)
    main, trim = shorts_colors(sp, photo)
    p = POSES[pose]

    W, H = 190, 150
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx = W // 2 + p["dx"]
    tw, th = SIZES["torso"]
    leg_total = 15 + 15 + 3
    hip_y = H - leg_total - 6
    top = hip_y - th - 3
    sl, sr = (cx - tw // 2 + 2, top + 4), (cx + tw // 2 - 2, top + 4)
    hl, hr = (W // 2 - 7, hip_y), (W // 2 + 7, hip_y)

    # far side first: legs, arm that stays back
    for side, (t_a, c_a), hip in ((-1, (p["tl"], p["cl"]), hl), (1, (p["tr"], p["cr"]), hr)):
        knee = place(canvas, limb(12, 16, tones), hip, t_a)
        ankle = place(canvas, limb(10, 15, tones), knee, c_a)
        foot = foot_tex(tones, side if pose != "kick" or side < 0 else 1)
        if side < 0:
            foot = foot.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        canvas.alpha_composite(foot, (ankle[0] - 7, ankle[1] - 1))

    # shorts: colour only, because the photo shows just the waistband
    d = ImageDraw.Draw(canvas)
    sy0, sy1 = hip_y - 4, hip_y + 8
    d.rectangle([cx - 15, sy0, cx + 15, sy1], fill=(*main, 255))
    d.rectangle([cx - 15, sy0, cx + 15, sy0 + 2], fill=(*trim, 255))
    d.rectangle([cx - 15, sy0, cx - 12, sy1], fill=(*trim, 255))
    d.rectangle([cx + 12, sy0, cx + 15, sy1], fill=(*trim, 255))
    d.rectangle([cx - 1, sy1 - 4, cx, sy1], fill=(0, 0, 0, 0))

    def arm(shoulder, ua, fa, up_key, fo_key):
        elbow = place(canvas, limb(*SIZES[up_key], tones, ink[up_key]), shoulder, ua)
        wrist = place(canvas, limb(*SIZES[fo_key], tones, ink[fo_key]), elbow, fa)
        return wrist, fa

    wl = arm(sl, p["ul"], p["fl"], "ul", "fl")
    canvas.alpha_composite(make_torso(tones, ink["torso"]), (cx - tw // 2, top))

    hx = cx - head.width // 2 + (2 if pose == "punch" else 0)
    canvas.alpha_composite(head, (hx, top - head.height + 3))

    wr = arm(sr, p["ur"], p["fr"], "ur", "fr")
    place(canvas, glove_tex(), wl[0], wl[1])
    place(canvas, glove_tex(), wr[0], wr[1])

    return px.apply_1px_dark_outline(canvas.crop(canvas.getchannel("A").getbbox()))


def ink_preview(sp):
    photo = load(sp.key, "body")
    tones = v3.skin_tones(sp)
    t = make_torso(tones, tattoo_layer(photo, BOXES[sp.key]["torso"], SIZES["torso"]))
    return t


def comparison():
    k = 3
    rows = []
    for sp in v3.SPECS:
        a = v3.make_fighter(sp)
        g, p, kick = make_fighter(sp), make_fighter(sp, "punch"), make_fighter(sp, "kick")
        head = v3.make_head(sp)
        rows.append((sp, a, g, p, kick))
        print(sp.key, "shared", g.size, "head", head.size, "ratio", round(head.height / g.height, 2))
    label_w, gap = 170, 26
    cols = [max(r[i].width for r in rows) * k + gap for i in range(1, 5)]
    row_h = max(max(r[i].height for i in range(1, 5)) for r in rows) * k + 24
    sheet = Image.new("RGB", (label_w + sum(cols), row_h * 3 + 70), (26, 29, 42))
    d = ImageDraw.Draw(sheet)
    x = label_w
    for title, w in zip(("照片身體（上一版）", "共用身體：防守", "出拳", "踢腿"), cols):
        d.text((x, 18), title, font=font(24, True), fill=(250, 199, 117))
        x += w
    for i, r in enumerate(rows):
        y = 70 + i * row_h
        base = y + row_h - 12
        d.text((14, y + 10), r[0].label.replace(" ", "\n"), font=font(24, True), fill=(240, 240, 240))
        x = label_w
        for img, w in zip(r[1:], cols):
            big = nearest(img, k)
            sheet.paste(big, (x, base - big.height), big)
            x += w
    sheet.save(os.path.join(ROOT, "out", "shared_body_comparison.png"))


def ink_sheet():
    """Photo torso beside the extracted torso texture, to judge tattoo fidelity."""
    k = 6
    tiles = []
    for sp in v3.SPECS:
        photo = load(sp.key, "body")
        box = BOXES[sp.key]["torso"]
        crop = photo.crop(box)
        tex = nearest(ink_preview(sp), k)
        ref = crop.resize((tex.width, tex.height), Image.Resampling.LANCZOS)
        tiles.append((ref, tex))
    W = sum(a.width + b.width + 34 for a, b in tiles) + 20
    H = max(a.height for a, _ in tiles) + 40
    sheet = Image.new("RGB", (W, H), (26, 29, 42))
    x = 20
    for ref, tex in tiles:
        sheet.paste(ref, (x, 20), ref)
        x += ref.width + 10
        sheet.paste(tex, (x, 20), tex)
        x += tex.width + 24
    sheet.save(os.path.join(ROOT, "out", "shared_body_ink.png"))


comparison()
ink_sheet()
