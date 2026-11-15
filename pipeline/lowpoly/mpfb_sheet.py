"""Clay comparison sheet for build_mpfb.py output: one row per triangle count, columns 3/4, side, back, head.

  uv run --no-project --with pillow python -I pipeline/lowpoly/mpfb_sheet.py <out dir> [--preset feather_muscle] [--tris 3000,5000]
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--preset", default="feather_muscle")
ap.add_argument("--tris", default="3000,5000")
ap.add_argument("--name", default="")
a = ap.parse_args()
out = Path(a.out)
rows = [int(x) for x in a.tris.split(",")]
H = 500
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 28)
except OSError:
    font = ImageFont.load_default()
tiles = []
for n in rows:
    ims = []
    for v in ("34", "side", "back", "head"):
        im = Image.open(out / f"mpfb_{a.preset}_{n}_{v}.png").convert("RGB")
        ims.append(im.resize((round(im.width * H / im.height), H), Image.LANCZOS))
    tiles.append(ims)
W = max(sum(i.width for i in r) for r in tiles)
sheet = Image.new("RGB", (W, H * len(rows)), (30, 30, 32))
d = ImageDraw.Draw(sheet)
for k, (n, r) in enumerate(zip(rows, tiles)):
    x = 0
    for im in r:
        sheet.paste(im, (x, k * H))
        x += im.width
    d.text((12, k * H + 10), f"{n:,} 三角形", fill=(255, 230, 120), font=font)
name = a.name or f"mpfb_{a.preset}_cmp.png"
sheet.save(out / name)
print(out / name, sheet.size)
