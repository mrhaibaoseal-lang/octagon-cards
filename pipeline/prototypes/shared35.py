"""About 35% head ratio on the shared rig: extracted ink versus photo textures on the same limbs."""
import importlib.util
import os
import sys
from statistics import median

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT, REPO = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("sb", os.path.join(ROOT, "tools", "shared_body.py"))
sb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sb)
v3, px, load, nearest, font = sb.v3, sb.px, sb.load, sb.nearest, sb.font
BOXES, POSES, place = sb.BOXES, sb.POSES, sb.place

SIZES = dict(torso=(44, 38), ul=(14, 20), ur=(14, 20), fl=(12, 19), fr=(12, 19))
THIGH, CALF = (16, 20), (13, 19)


def ink_mask(crop):
    rgb = crop.convert("RGB")
    alpha = np.asarray(crop.getchannel("A"), dtype=float) / 255
    a = np.asarray(rgb.convert("YCbCr"), dtype=float)
    b = np.asarray(rgb.filter(ImageFilter.GaussianBlur(16)).convert("YCbCr"), dtype=float)
    y = rgb.convert("L")
    fine = np.abs(np.asarray(y, dtype=float) - np.asarray(y.filter(ImageFilter.GaussianBlur(3)), dtype=float))
    energy = np.asarray(Image.fromarray(np.uint8(np.clip(fine * 8, 0, 255))).filter(ImageFilter.GaussianBlur(5)), dtype=float) / 8
    dark = (b[..., 0] - a[..., 0]) > np.maximum(9, 0.14 * b[..., 0])
    hue = np.hypot(a[..., 1] - b[..., 1], a[..., 2] - b[..., 2]) > 11
    # muscle shadows are dark but smooth; ink has fine detail
    return ((dark & (energy > 3.2)) | hue) & (alpha > 0.9)


def ink_layer(crop, size):
    mask = ink_mask(crop)
    rgb = np.asarray(crop.convert("RGB"), dtype=float)
    w, h = size
    out = np.zeros((h, w, 4), dtype=np.uint8)
    H, W = mask.shape
    for y in range(h):
        for x in range(w):
            y0, y1 = y * H // h, max(y * H // h + 1, (y + 1) * H // h)
            x0, x1 = x * W // w, max(x * W // w + 1, (x + 1) * W // w)
            m = mask[y0:y1, x0:x1]
            if m.mean() >= 0.33:
                out[y, x, :3] = rgb[y0:y1, x0:x1][m].mean(axis=0)
                out[y, x, 3] = 255
    return Image.fromarray(out, "RGBA")


def body_tones(sp, photo):
    """Skin from the body photo rather than the face, ignoring ink."""
    crop = photo.crop(BOXES[sp.key]["torso"])
    mask = ink_mask(crop)
    opaque = np.asarray(crop.getchannel("A")) > 230
    rgb = np.asarray(crop.convert("RGB"), dtype=float)[~mask & opaque]
    base = tuple(int(v) for v in np.median(rgb, axis=0))
    return base, tuple(int(c * 0.72) for c in base), tuple(min(255, int(c * 1.12)) for c in base)


def photo_texture(crop, size, base):
    """Fill transparent edges with skin, enhance, then area-average to texture size."""
    fill = Image.new("RGBA", crop.size, (*base, 255))
    fill.alpha_composite(crop)
    fill = px.enhance_tattoos_and_details(fill, contrast=1.2, sharpness=1.5)
    return fill.resize(size, Image.Resampling.BOX).convert("RGB").convert("RGBA")


def capsule(tex):
    w, h = tex.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=min(w, h) // 3, fill=255)
    tex = tex.copy()
    tex.putalpha(mask)
    return tex


def shaded_skin(size, tones):
    base, shade, light = tones
    w, h = size
    img = Image.new("RGBA", size, (*base, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([w - max(2, w // 3), 0, w - 1, h - 1], fill=(*shade, 255))
    d.line([(1, 0), (1, h - 1)], fill=(*light, 255))
    return img


def torso_shape(tex):
    w, h = tex.size
    mask = Image.new("L", tex.size, 0)
    ImageDraw.Draw(mask).polygon([(4, 0), (w - 5, 0), (w - 1, 3), (w - 1, 9), (w - 6, h - 1), (5, h - 1), (0, 9), (0, 3)], fill=255)
    out = tex.copy()
    out.putalpha(mask)
    return out


def make_textures(sp, photo, tones, mode):
    tex = {}
    for k, size in SIZES.items():
        crop = photo.crop(BOXES[sp.key][k])
        if mode == "photo":
            tex[k] = photo_texture(crop, size, tones[0])
        else:
            t = shaded_skin(size, tones)
            if k == "torso":
                d = ImageDraw.Draw(t)
                t = Image.new("RGBA", size, (*tones[0], 255))
                d = ImageDraw.Draw(t)
                d.line([(size[0] // 2, 11), (size[0] // 2, size[1] - 3)], fill=(*tones[1], 255))
                d.line([(7, 18), (size[0] // 2 - 2, 19)], fill=(*tones[1], 255))
                d.line([(size[0] // 2 + 2, 19), (size[0] - 8, 18)], fill=(*tones[1], 255))
            t.alpha_composite(ink_layer(crop, size))
            tex[k] = t
    return tex


def quantize_all(tex):
    """One shared 28-colour body palette so all limbs match."""
    keys = list(tex)
    total_w = sum(tex[k].width for k in keys)
    strip = Image.new("RGB", (total_w, max(tex[k].height for k in keys)))
    x = 0
    for k in keys:
        strip.paste(tex[k].convert("RGB"), (x, 0))
        x += tex[k].width
    pal = strip.quantize(colors=28, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return {k: tex[k].convert("RGB").quantize(palette=pal, dither=Image.Dither.NONE).convert("RGBA") for k in keys}


def make_fighter(sp, pose="guard", mode="photo"):
    photo = load(sp.key, "body")
    tones = body_tones(sp, photo)
    tex = quantize_all(make_textures(sp, photo, tones, mode))
    head = v3.make_head(sp)
    main, trim = sb.shorts_colors(sp, photo)
    p = POSES[pose]

    W, H = 240, 170
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx = W // 2 + p["dx"]
    tw, th = SIZES["torso"]
    hip_y = H - (THIGH[1] + CALF[1] + 3) - 8
    top = hip_y - th - 3
    sl, sr = (cx - tw // 2 + 3, top + 6), (cx + tw // 2 - 3, top + 6)
    hl, hr = (W // 2 - 10, hip_y), (W // 2 + 10, hip_y)

    for side, t_a, c_a, hip in ((-1, p["tl"], p["cl"], hl), (1, p["tr"], p["cr"], hr)):
        knee = place(canvas, capsule(shaded_skin(THIGH, tones)), hip, t_a)
        ankle = place(canvas, capsule(shaded_skin(CALF, tones)), knee, c_a)
        foot = sb.foot_tex(tones, side)
        if side < 0:
            foot = foot.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        canvas.alpha_composite(foot, (ankle[0] - 7, ankle[1] - 1))

    # shorts: real waistband and pattern rows from the photo, then a template below
    sy0, sy1 = hip_y - 4, hip_y + 12
    d = ImageDraw.Draw(canvas)
    d.rectangle([cx - 20, sy0, cx + 20, sy1], fill=(*main, 255))
    d.rectangle([cx - 20, sy0, cx - 17, sy1], fill=(*trim, 255))
    d.rectangle([cx + 17, sy0, cx + 20, sy1], fill=(*trim, 255))
    strip = photo.crop((sp.shorts[0], 672, sp.shorts[1], 700))
    flat = Image.new("RGBA", strip.size, (*main, 255))
    flat.alpha_composite(strip)
    band = quantize_band = flat.resize((41, 7), Image.Resampling.BOX).convert("RGB").quantize(colors=8, dither=Image.Dither.NONE).convert("RGBA")
    canvas.alpha_composite(band, (cx - 20, sy0))
    d.rectangle([cx - 1, sy1 - 5, cx, sy1], fill=(0, 0, 0, 0))

    def arm(shoulder, ua, fa, up, fo):
        elbow = place(canvas, capsule(tex[up]), shoulder, ua)
        return place(canvas, capsule(tex[fo]), elbow, fa), fa

    wl = arm(sl, p["ul"], p["fl"], "ul", "fl")
    canvas.alpha_composite(torso_shape(tex["torso"]), (cx - tw // 2, top))

    # short neck so the chin no longer covers the upper chest
    d.rectangle([cx - 7, top - 3, cx + 7, top + 1], fill=(*tones[1], 255))
    hx = cx - head.width // 2 + (2 if pose == "punch" else 0)
    canvas.alpha_composite(head, (hx, top - head.height + 1))

    wr = arm(sr, p["ur"], p["fr"], "ur", "fr")
    big = nearest(sb.glove_tex(), 1)
    place(canvas, big, wl[0], wl[1])
    place(canvas, big, wr[0], wr[1])
    return px.apply_1px_dark_outline(canvas.crop(canvas.getchannel("A").getbbox()))


def comparison():
    k = 3
    rows = []
    for sp in v3.SPECS:
        row = [make_fighter(sp, "guard", "ink"), make_fighter(sp, "guard", "photo"),
               make_fighter(sp, "punch", "photo"), make_fighter(sp, "kick", "photo")]
        rows.append((sp, *row))
        print(sp.key, "fighter", row[1].size, "ratio", round(v3.make_head(sp).height / row[1].height, 2))
    label_w, gap = 170, 26
    cols = [max(r[i].width for r in rows) * k + gap for i in range(1, 5)]
    row_h = max(max(r[i].height for i in range(1, 5)) for r in rows) * k + 24
    sheet = Image.new("RGB", (label_w + sum(cols), row_h * 3 + 70), (26, 29, 42))
    d = ImageDraw.Draw(sheet)
    x = label_w
    for title, w in zip(("A 自動抽刺青", "B 照片貼圖：防守", "B 出拳", "B 踢腿"), cols):
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
    sheet.save(os.path.join(ROOT, "out", "shared35_comparison.png"))


def stage():
    W, H = 844 * 2, 390 * 2
    img = Image.new("RGB", (W, H), (18, 20, 31))
    d = ImageDraw.Draw(img)
    d.polygon([(W * 0.26, 0), (W * 0.74, 0), (W * 0.9, H * 0.72), (W * 0.1, H * 0.72)], fill=(38, 42, 62))
    d.rectangle([0, H * 0.72, W, H], fill=(52, 56, 74))
    for x in range(0, W, 26):
        d.line([(x, 0), (x, H * 0.72)], fill=(30, 33, 48), width=2)
    k = 4
    a = nearest(make_fighter(v3.SPECS[2], "kick", "photo"), k)
    b = nearest(make_fighter(v3.SPECS[0], "guard", "photo").transpose(Image.Transpose.FLIP_LEFT_RIGHT), k)
    floor = int(H * 0.82)
    img.paste(a, (int(W * 0.12), floor - a.height), a)
    img.paste(b, (int(W * 0.66), floor - b.height), b)
    print("stage height pt", b.height / 2, "top pt", (floor - b.height) / 2)
    d.rectangle([0, 0, W, 76], fill=(30, 34, 51))
    d.rectangle([24, 20, 640, 40], fill=(226, 75, 74))
    d.rectangle([W - 640, 20, W - 24, 40], fill=(226, 75, 74))
    d.rectangle([W // 2 - 90, 12, W // 2 + 90, 56], fill=(250, 199, 117))
    card_w, n = 176, 5
    start = W // 2 - (card_w * n - 28 * (n - 1)) // 2
    for i in range(n):
        x = start + i * (card_w - 28)
        d.rectangle([x, H - 150, x + card_w, H + 100], fill=(241, 239, 232), outline=(18, 20, 31), width=4)
    img.save(os.path.join(ROOT, "out", "shared35_stage.png"))


comparison()
stage()
