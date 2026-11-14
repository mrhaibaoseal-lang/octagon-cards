"""TRELLIS.2 bakes its base colour about half as bright as the input picture (median 66 vs 151 on the Gemini head).
Match each channel's histogram of the used texture pixels to the input's opaque pixels and save <name>_fix.glb.

  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/fix_texture.py [--rgb] photo_head gemini_real_head

Default: match only the luminance distribution and scale RGB by it (hue kept). --rgb matches each channel on its own
(what Topuria's head used); it breaks when the input is mostly one strong colour: O'Malley's pink hair turned his face
yellow-green.
"""
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, prepared  # noqa: E402


def match(src, ref):
    """Map each channel of src (N,3) so its distribution follows ref (M,3)."""
    out = np.empty_like(src)
    q = np.linspace(0, 100, 257)
    for c in range(3):
        out[:, c] = np.interp(src[:, c], np.percentile(src[:, c], q), np.percentile(ref[:, c], q))
    return out


def match_lum(src, ref):
    """Scale each colour so its luminance follows ref's luminance distribution; the hue stays."""
    w = np.array([0.299, 0.587, 0.114])
    ls, lr = src @ w, ref @ w
    q = np.linspace(0, 100, 257)
    target = np.interp(ls, np.percentile(ls, q), np.percentile(lr, q))
    return src * (target / np.maximum(ls, 1e-3))[:, None]


def main():
    args = sys.argv[1:]
    rgb = "--rgb" in args
    for name in [a for a in args if a != "--rgb"]:
        scene = trimesh.load(OUT / "trellis2" / f"{name}.glb")
        ref = np.asarray(Image.open(prepared(name))).reshape(-1, 4)
        ref = ref[ref[:, 3] > 200][:, :3].astype(float)
        for geom in scene.geometry.values():
            mat = geom.visual.material
            tex = np.asarray(mat.baseColorTexture.convert("RGBA")).astype(float)
            flat = tex.reshape(-1, 4)
            used = flat[:, :3].sum(1) > 15
            before = np.median(flat[used, :3], 0)
            flat[used, :3] = (match if rgb else match_lum)(flat[used, :3], ref)
            mat.baseColorTexture = Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8).reshape(tex.shape))
            print(name, "median before", before, "after", np.median(flat[used, :3], 0))
        scene.export(OUT / "trellis2" / f"{name}_fix.glb")


if __name__ == "__main__":
    main()
