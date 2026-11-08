"""Measure a full-body cut-out photo (alpha PNG) the same way measure_body.py measures the mannequin.

  python pipeline/model3d/measure_photo.py <photo.png> [more.png ...]

Prints, as fractions of the figure's height (top of hair to the soles), from the alpha silhouette:
  shoulder   widest row between 17 % and 23 % of the height from the top (deltoids, arms hanging beside the torso)
  neck       narrowest row between 9 % and 17 % from the top (the neck; hair and beard excluded by the minimum)
  waist      width at 40 % from the top, arms excluded when they hang away from the torso (otherwise it is too wide)
  calf       widest single leg (one connected run) between 70 % and 78 % from the top
Notes: official photos are shot with the body turned about 25 degrees and from close up, so heads look 10-15 % larger
and shoulders about 5-8 % narrower than in a straight front view; use the numbers as a relative guide only.
"""
import sys

import numpy as np
from PIL import Image


def runs(row):
    out, start = [], None
    for i, v in enumerate(row):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(row)))
    return out


def measure(path):
    a = np.array(Image.open(path).convert("RGBA"))[..., 3] > 128
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    H = bot - top
    res = {"file": path.split("\\")[-1].split("/")[-1], "H_px": int(H)}

    def width_at(f):
        r = a[int(top + f * H)]
        x = np.where(r)[0]
        return (x.max() - x.min()) / H if len(x) else 0

    res["shoulder"] = round(max(width_at(f / 1000) for f in range(170, 231, 5)), 3)
    res["neck"] = round(min(width_at(f / 1000) for f in range(90, 171, 5)), 3)
    r = a[int(top + 0.40 * H)]
    rs = runs(r)
    res["waist_runs"] = [round((e - s) / H, 3) for s, e in rs]
    calves = []
    for f in range(700, 781, 10):
        for s, e in runs(a[int(top + f / 1000 * H)]):
            calves.append((e - s) / H)
    res["calf"] = round(max(calves), 3) if calves else None
    return res


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(measure(p))
