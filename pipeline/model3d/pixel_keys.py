"""Turn rendered key poses into pixel-art sprites with a motion trail and a hit flash (demo of key pose + effects).

  uv run --no-project --with pillow --with numpy python -I pipeline/model3d/pixel_keys.py --dir <dir>/_keys \
      --clips cross,hook_lead,kick_high,hit_head_big [--px-per-m 56] [--colors 20] [--contrast 1.2] [--zoom 3]

Reads <clip>__{start,windup,impact,recovery,trailN}.png and <clip>.json written by anim_render.py --keys.
Writes pixel_<clip>.gif (timed: start, wind-up, impact with hit-stop, recovery) and pixel_storyboard.png.
All frames of a clip share one crop and scale so the sprite does not jitter; feet stay on one line.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--clips", required=True)
ap.add_argument("--render-px-per-m", type=float, default=600 / 2.6)
ap.add_argument("--px-per-m", type=float, default=64)  # style A, chosen 2026-11-08 (B was 56 px/m, 20 colours, contrast 1.2)
ap.add_argument("--colors", type=int, default=32)
ap.add_argument("--zoom", type=int, default=3)
ap.add_argument("--contrast", type=float, default=1.0)
ap.add_argument("--only", default="", help="with --variants: comma-separated variant letters to include, e.g. A,B")
ap.add_argument("--variants", action="store_true", help="write pixel_variants.png comparing pixelation styles instead of the GIFs")
args = ap.parse_args()
K = Path(args.dir)
BG = (24, 24, 30)
OUTLINE = (20, 14, 12)


def pixelate(im, box, size, colors=None, clean=False, selout=False, contrast=1.0):
    """Downscale to real pixels, limit the palette, optionally clean stray pixels and tint the outline.

    clean:  a 3x3 mode filter so colours form solid clusters instead of noisy single pixels
    selout: "selective outline": each outline pixel is a darkened copy of the colour it borders, not flat black
    """
    colors = colors or args.colors
    im = im.crop(box)
    rgb = Image.new("RGB", im.size, (0, 0, 0))
    rgb.paste(im, mask=im.getchannel("A"))
    a = im.getchannel("A").resize(size, Image.BOX).point(lambda v: 255 if v >= 110 else 0)
    # Average only the body's own pixels: plain box-downscaling mixes the transparent black background into
    # edge pixels, which the palette then snaps to random dark or red colours.
    src = np.asarray(im).astype(np.float32)
    w = src[..., 3:4] / 255
    pre = Image.fromarray(np.clip(src[..., :3] * w, 0, 255).astype(np.uint8)).resize(size, Image.BOX)
    wa = np.asarray(im.getchannel("A").resize(size, Image.BOX)).astype(np.float32)[..., None] / 255
    small = Image.fromarray(np.clip(np.asarray(pre).astype(np.float32) / np.maximum(wa, 1e-3), 0, 255).astype(np.uint8))
    if contrast != 1.0:
        small = ImageEnhance.Contrast(small).enhance(contrast)
        small = ImageEnhance.Color(small).enhance(1.0 + (contrast - 1.0) * 0.8)
    q = small.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    if clean:
        q = q.filter(ImageFilter.ModeFilter(3))
    arr = np.dstack([np.asarray(q), np.asarray(a)]).astype(np.uint8)
    m = arr[..., 3] > 0
    if clean:  # drop lone silhouette pixels
        nb = sum(np.roll(np.roll(m, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)) - m
        m &= nb >= 2
        arr[~m, 3] = 0
    grow = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    edge = grow & ~m
    if selout:
        src = np.zeros_like(arr[..., :3], dtype=np.float32)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            mm = np.roll(m, (dy, dx), (0, 1))
            src += np.roll(arr[..., :3], (dy, dx), (0, 1)) * mm[..., None]
            cnt += mm
        col = src / np.maximum(cnt, 1)[..., None] * 0.35
        arr[edge, :3] = col[edge].astype(np.uint8)
        arr[edge, 3] = 255
    else:
        arr[edge] = (*OUTLINE, 255)
    return arr


def over(dst, src, alpha=1.0, tint=None):
    a = src[..., 3:4].astype(np.float32) / 255 * alpha
    c = src[..., :3].astype(np.float32)
    if tint is not None:
        c = c * 0.35 + np.array(tint, np.float32) * 0.65
    dst[..., :3] = dst[..., :3] * (1 - a) + c * a
    return dst


def burst(canvas, x, y, r, color=(255, 240, 170)):
    """Chunky pixel hit spark: a plus-shaped star with diagonal sparks."""
    h, w = canvas.shape[:2]
    for d in range(-r, r + 1):
        for (xx, yy) in ((x + d, y), (x, y + d)):
            if 0 <= xx < w and 0 <= yy < h:
                canvas[yy, xx, :3] = color if abs(d) < r - 1 else (255, 150, 60)
    for d in range(1, r // 2 + 1):
        for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            xx, yy = x + sx * d, y + sy * d
            if 0 <= xx < w and 0 <= yy < h:
                canvas[yy, xx, :3] = (255, 255, 255)


VARIANTS = [  # (label, px per metre, colours, clean, selective outline, contrast)
    ("A  64px/m, 32 colours (edges fixed)", 64, 32, False, False, 1.0),
    ("B  56px/m, 20 colours, more contrast", 56, 20, False, False, 1.2),
    ("C  48px/m, 20 colours, more contrast, cleaned", 48, 20, True, False, 1.2),
    ("D  48px/m, 16 colours, more contrast, coloured outline", 48, 16, False, True, 1.25),
]
if args.variants:
    show_h = 300  # every variant is enlarged to roughly the same height on screen
    cells = []
    keep = set(args.only.split(",")) if args.only else None
    for label, ppm, cols, cl, so, ct in VARIANTS:
        if keep and label.split()[0] not in keep:
            continue
        row = []
        for clip in args.clips.split(","):
            for lb in ("start", "impact"):
                im = Image.open(K / f"{clip}__{lb}.png").convert("RGBA")
                bb = im.getchannel("A").getbbox()
                box = (bb[0] - 10, bb[1] - 10, bb[2] + 10, bb[3] + 2)
                sc = ppm / args.render_px_per_m
                size = (max(1, round((box[2] - box[0]) * sc)), max(1, round((box[3] - box[1]) * sc)))
                arr = pixelate(im, box, size, cols, cl, so, ct)
                z = max(1, round(show_h / size[1]))
                bg = Image.new("RGB", size, BG)
                bg.paste(Image.fromarray(arr), mask=Image.fromarray(arr[..., 3]))
                row.append(bg.resize((size[0] * z, size[1] * z), Image.NEAREST))
        w = sum(r.width for r in row) + 20 * len(row)
        h = max(r.height for r in row) + 34
        cell = Image.new("RGB", (w, h), BG)
        d = ImageDraw.Draw(cell)
        d.text((10, 8), label, fill=(230, 230, 230))
        x = 10
        for r in row:
            cell.paste(r, (x, h - r.height))
            x += r.width + 20
        cells.append(cell)
    W = max(c.width for c in cells)
    out = Image.new("RGB", (W, sum(c.height for c in cells)), BG)
    y = 0
    for c in cells:
        out.paste(c, (0, y))
        y += c.height
    out.save(K / "pixel_variants.png")
    raise SystemExit(0)

boards = []
for clip in args.clips.split(","):
    meta = json.loads((K / f"{clip}.json").read_text())
    labels = ["start", "windup", "impact", "recovery"] + [f"trail{i}" for i in range(len(meta["trail"]))]
    ims = {lb: Image.open(K / f"{clip}__{lb}.png").convert("RGBA") for lb in labels if (K / f"{clip}__{lb}.png").exists()}
    boxes = [im.getchannel("A").getbbox() for im in ims.values()]
    pad = 40
    box = (min(b[0] for b in boxes) - pad, min(b[1] for b in boxes) - pad, max(b[2] for b in boxes) + pad, max(b[3] for b in boxes) + 4)
    s = args.px_per_m / args.render_px_per_m
    size = (max(1, round((box[2] - box[0]) * s)), max(1, round((box[3] - box[1]) * s)))
    px = {lb: pixelate(im, box, size, contrast=args.contrast) for lb, im in ims.items()}  # uses --px-per-m / --colors
    H, W = size[1], size[0]

    def frame(*layers):
        c = np.zeros((H, W, 4), np.float32)
        c[..., :3] = BG
        c[..., 3] = 255
        for lay in layers:
            over(c, *lay)
        return c

    # Impact point: for strikes the furthest pixel toward the opponent (screen-right); for hit reactions the head.
    imp = px["impact"]
    ys, xs = np.where(imp[..., 3] > 0)
    if meta["effector"].endswith("Head") or clip.startswith("hit"):
        k = np.argmin(ys)
    else:
        if meta["effector"].endswith("Hand"):  # punches: ignore the legs, the front foot often reaches further
            upper = ys < H * 0.5
            ys, xs = ys[upper], xs[upper]
        k = np.argmax(xs)
    hx, hy = int(xs[k]), int(ys[k])
    trails = [px[f"trail{i}"] for i in range(len(meta["trail"]))]
    impact = frame(*[(t, 0.18 + 0.12 * i, (255, 255, 255)) for i, t in enumerate(trails)], (imp,))
    impact_flash = impact.copy()
    burst(impact_flash, hx, hy, max(4, H // 14))
    seq = [
        (frame((px["start"],)), 260),
        (frame((px["windup"],)), 200),
        (impact_flash, 90),   # hit flash
        (impact, 220),        # hit-stop: hold the impact pose
        (frame((px["recovery"],)), 260),
        (frame((px["start"],)), 400),
    ]
    z = args.zoom
    gif = [Image.fromarray(f[..., :3].astype(np.uint8)).resize((W * z, H * z), Image.NEAREST) for f, _ in seq]
    gif[0].save(K / f"pixel_{clip}.gif", save_all=True, append_images=gif[1:], duration=[d for _, d in seq], loop=0)
    board = np.concatenate([seq[0][0], seq[1][0], seq[2][0], seq[4][0]], axis=1)
    boards.append(Image.fromarray(board[..., :3].astype(np.uint8)).resize((board.shape[1] * z, H * z), Image.NEAREST))
    print(clip, "sprite", W, "x", H, "impact at", hx, hy)

bw = max(b.width for b in boards)
sheet = Image.new("RGB", (bw, sum(b.height for b in boards)), BG)
y = 0
for b in boards:
    sheet.paste(b, (0, y))
    y += b.height
sheet.save(K / "pixel_storyboard.png")
