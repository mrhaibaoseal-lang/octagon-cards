"""Remove green-screen spill from a head's texture: texels where green clearly beats red and blue are refilled from
their non-green neighbours (grown inwards a pixel at a time). Writes <name>_ng.glb.

  uv run --no-project --with numpy --with pillow --with trimesh --with scipy python -I pipeline/img2_3d/degreen.py head.glb
"""
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage


def main():
    src = Path(sys.argv[1])
    scene = trimesh.load(src)
    geom = next(iter(scene.geometry.values()))
    mat = geom.visual.material
    px = np.asarray(mat.baseColorTexture.convert("RGBA")).astype(float)
    r, g, b = px[:, :, 0], px[:, :, 1], px[:, :, 2]
    green = (g - np.maximum(r, b) > 12) & (g > 40)
    green = ndimage.binary_dilation(green, iterations=2)  # the fringe around the spill is tinted too
    print("green texels", int(green.sum()))
    out = px.copy()
    todo = green.copy()
    k = np.ones((3, 3))
    while todo.any():
        ok = ~todo
        s = np.stack([ndimage.convolve(out[:, :, c] * ok, k, mode="nearest") for c in range(3)], 2)
        n = ndimage.convolve(ok.astype(float), k, mode="nearest")
        edge = todo & (n > 0)
        if not edge.any():
            break
        out[edge, :3] = s[edge] / n[edge, None]
        todo &= ~edge
    mat.baseColorTexture = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    dst = src.with_name(src.stem + "_ng.glb")
    scene.export(dst)
    print("saved", dst)


if __name__ == "__main__":
    main()
