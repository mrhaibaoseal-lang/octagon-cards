"""Cut the Gemini-painted head sheet into head sprites that line up with the mannequin head cells.

  uv run --no-project --with pillow --with numpy python -I pipeline/model3d/head_sprites.py --dir <dir>

Reads head_guide.png, head_views.json, painted_head.png. Gemini tends to enlarge the heads, add shoulders and draw
grid lines, so each painted cell is searched for the scale and offset where its head best covers the mannequin head
(compared only above the neck cut), then cropped at the neck. Writes head_<name>.png (RGBA, same size and framing as
a guide cell) and head_check.png (sprites with the mannequin outline in red).
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
args = ap.parse_args()
D = Path(args.dir)
meta = json.loads((D / "head_views.json").read_text())
c = meta["cell_px"]


def fg_mask(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    green = (g > 140) & (g > r * 1.35) & (g > b * 1.35)
    dark_line = (r < 40) & (g < 40) & (b < 40)
    return ~green, dark_line


guide = np.asarray(Image.open(D / "head_guide.png").convert("RGB"))
painted = np.asarray(Image.open(D / "painted_head.png").convert("RGB"))
gfg, _ = fg_mask(guide)
pfg, plines = fg_mask(painted)
PH, PW = painted.shape[:2]
GH, GW = guide.shape[:2]
checks = []
for i, v in enumerate(meta["views"]):
    x0, y0 = v["origin_px"]
    gcell = gfg[y0:y0 + c, x0:x0 + c]
    rows = np.where(gcell.any(1))[0]
    g_top, g_cut = rows[0], rows[-1]  # neck cut = lowest mannequin row
    # The matching painted cell: same grid position, proportional to sheet size, minus a border for grid lines.
    col, row = i % 3, i // 3
    px0, px1 = int(col * PW / 3) + 6, int((col + 1) * PW / 3) - 6
    py0, py1 = int(row * PH / 2) + 6, int((row + 1) * PH / 2) - 6
    pcell = pfg[py0:py1, px0:px1].copy()  # the 6px margin already skips grid lines; dark hair must stay
    pimg = painted[py0:py1, px0:px1]
    prow = np.where(pcell.any(1))[0]
    p_top = prow[0]
    # Search: guide pixel (x, y) maps to painted (cx + (x - gx) * s + dx, p_top + (y - g_top) * s + dy).
    gx = np.where(gcell.any(0))[0].mean()
    pcols = np.where(pcell[p_top:p_top + 40].any(0))[0]
    cx = pcols.mean() if len(pcols) else pcell.shape[1] / 2
    q = 4
    yy, xx = np.mgrid[0:g_cut:q, 0:c:q]
    gs = gcell[0:g_cut:q, 0:c:q]
    best = (-1, 1.0, 0, 0)
    for s in np.linspace(0.5, 2.0, 61):
        for dx in range(-60, 61, 6):
            for dy in range(-20, 61, 5):
                mx = np.round(cx + (xx - gx) * s + dx).astype(int)
                my = np.round(p_top + (yy - g_top) * s + dy).astype(int)
                ok = (mx >= 0) & (mx < pcell.shape[1]) & (my >= 0) & (my < pcell.shape[0])
                pm = np.zeros_like(gs)
                pm[ok] = pcell[my[ok], mx[ok]]
                iou = (pm & gs).sum() / max(1, (pm | gs).sum())
                if iou > best[0]:
                    best = (iou, s, dx, dy)
    iou, s, dx, dy = best
    yy, xx = np.mgrid[0:c, 0:c]
    mx = np.round(cx + (xx - gx) * s + dx).astype(int)
    my = np.round(p_top + (yy - g_top) * s + dy).astype(int)
    ok = (mx >= 0) & (mx < pcell.shape[1]) & (my >= 0) & (my < pcell.shape[0])
    out = np.zeros((c, c, 4), np.uint8)
    out[ok, :3] = pimg[my[ok], mx[ok]]
    alpha = np.zeros((c, c), np.float32)
    alpha[ok] = pcell[my[ok], mx[ok]]
    # Keep only head and neck: fade out over the last few pixels above the mannequin's neck cut.
    fade = 14
    ramp = np.clip((g_cut - yy) / fade, 0, 1)
    alpha *= ramp
    out[..., 3] = (alpha * 255).astype(np.uint8)
    # Remove green-screen spill on anti-aliased edges (hair outline).
    rgb = out[..., :3].astype(int)
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    out[..., :3] = rgb.astype(np.uint8)
    Image.fromarray(out).save(D / f"head_{v['name']}.png")
    print(f"{v['name']}: scale {s:.2f} offset {dx:+d},{dy:+d} overlap {iou:.3f}")
    chk = out.copy()
    chk[out[..., 3] == 0] = (30, 30, 34, 255)
    edge = gcell ^ np.roll(gcell, 1, 0) | gcell ^ np.roll(gcell, 1, 1)
    chk[edge] = (255, 0, 0, 255)
    checks.append(Image.fromarray(chk))
sheet = Image.new("RGBA", (c * 3, c * 2))
for i, im in enumerate(checks):
    sheet.paste(im, ((i % 3) * c, (i // 3) * c))
sheet.save(D / "head_check.png")
