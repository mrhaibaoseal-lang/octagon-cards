"""Pull a Gemini painting grid back onto the sculpt when Gemini drew a view's features too high / low (ghost eyes:
painted eyes land on the brow and the sculpt's own eye sockets show through the toon light).

Per cell: piecewise-linear vertical warp from painted landmark rows to sculpt landmark rows, plus an optional x shift.
Rows are in cell pixels (0 = top). Measure them on overlay.png (grid and painting blended).

  python warp_paint.py <work dir> --cell 0 "40:72,268:312,350:382,395:457,500:510" --cell 1 "..." --dx 1 -18
Writes <work>/painted_fix.png; project it with gemini_paint.py --reuse --painted painted_fix.png.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("work")
ap.add_argument("--cell", nargs=2, action="append", default=[], metavar=("K", "PAIRS"), help="cell index 0..3 and painted:sculpt row pairs")
ap.add_argument("--dx", nargs=2, action="append", default=[], metavar=("K", "PX"), help="shift cell K right by PX (sculpt = painted + PX)")
a = ap.parse_args()
work = Path(a.work)
grid = Image.open(work / "grid.png")
img = np.asarray(Image.open(work / "painted.png").convert("RGB").resize(grid.size, Image.LANCZOS))
S = grid.size[0] // 2
out = img.copy()
dx = {int(k): float(v) for k, v in a.dx}
for k, pairs in a.cell:
    k = int(k)
    pts = sorted(tuple(map(float, p.split(":"))) for p in pairs.split(","))
    src = np.array([0.0] + [p for p, _ in pts] + [S - 1.0])
    dst = np.array([0.0] + [s for _, s in pts] + [S - 1.0])
    ys = np.interp(np.arange(S), dst, src)  # for each sculpt row, the painted row it comes from
    xs = np.arange(S) - dx.get(k, 0.0)
    ox, oy = (k % 2) * S, (k // 2) * S
    yi = np.clip(np.rint(ys), 0, S - 1).astype(int)
    xi = np.clip(np.rint(xs), 0, S - 1).astype(int)
    cell = img[oy:oy + S, ox:ox + S]
    out[oy:oy + S, ox:ox + S] = cell[yi[:, None], xi[None, :]]
Image.fromarray(out).save(work / "painted_fix.png")
ov = Image.blend(grid.convert("RGB"), Image.fromarray(out), 0.5)
ov.save(work / "overlay_fix.png")
print("saved", work / "painted_fix.png")
