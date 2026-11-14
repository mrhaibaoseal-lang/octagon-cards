"""Shift a painted body texture's skin colour onto the head's: per-channel gain from the body's skin median to the head's.
Skin = mid-bright warm pixels (r > g > b), which leaves out hair, tattoo ink and black shorts. Keeps skin_raw.png.

  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/match_body_skin.py head.glb <private>/_model3d/<fighter>_painted
  (or: uv run --no-project --with numpy --with pillow --with trimesh python -I ...)
"""
import shutil
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image


def skin_median(px):
    f = px.reshape(-1, px.shape[-1])[:, :3].astype(float) / 255
    lum = f @ [0.299, 0.587, 0.114]
    m = (lum > 0.35) & (lum < 0.92) & (f[:, 0] > f[:, 1]) & (f[:, 1] > f[:, 2])
    return np.median(f[m], 0), int(m.sum())


def main():
    head, d = Path(sys.argv[1]), Path(sys.argv[2])
    scene = trimesh.load(head)
    tex = next(iter(scene.geometry.values())).visual.material.baseColorTexture
    target, n_h = skin_median(np.asarray(tex.convert("RGB")))
    raw = d / "skin_raw.png"
    if not raw.exists():
        shutil.copy(d / "skin.png", raw)
    body = np.asarray(Image.open(raw).convert("RGBA")).astype(float)
    src, n_b = skin_median(body.astype(np.uint8))
    gain = target / src
    body[:, :, :3] = np.clip(body[:, :, :3] * gain, 0, 255)
    Image.fromarray(body.astype(np.uint8)).save(d / "skin.png")
    print("head skin", target.round(3), n_h, "body skin", src.round(3), n_b, "gain", gain.round(3))


if __name__ == "__main__":
    main()
