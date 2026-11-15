"""Fill skin-coloured specks inside a painted beard (or any dark painted area): texels much lighter than the dark
surface around them take the colour of their dark neighbours. The specks are texels in the crevices between the
beard's lumps that no painted view saw squarely; smoothing the beard's shape only brings them to the surface.

  uv run --no-project --with numpy --with pillow --with trimesh --with scipy python -I pipeline/img2_3d/fill_pits.py \
      head_paint_ng.glb paint/<mesh>     -> head_paint_ng_fp.glb

Neighbours are taken on the surface (texel positions pos.npy / nrm.npy that gemini_paint.py baked into the work
folder), not in the texture: TRELLIS's UV islands are tiny, so texture neighbours are not surface neighbours.
"""
import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree

ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("work", help="gemini_paint work folder of the same mesh (pos.npy, nrm.npy)")
ap.add_argument("--dark", type=float, default=95, help="the surroundings count as beard below this median luminance (0-255)")
ap.add_argument("--gap", type=float, default=35, help="a speck is this much lighter than its surroundings")
ap.add_argument("--k", type=int, default=48, help="neighbours (of a 150k-texel sample of the surface)")
a = ap.parse_args()

src = Path(a.mesh)
scene = trimesh.load(src)
geom = next(iter(scene.geometry.values()))
mat = geom.visual.material
px = np.asarray(mat.baseColorTexture.convert("RGBA")).copy()
pos = np.load(Path(a.work) / "pos.npy").reshape(-1, 3)
nrm = np.load(Path(a.work) / "nrm.npy").reshape(-1, 3)
assert len(pos) == px.shape[0] * px.shape[1], "texture size differs from the bake"
flat = px.reshape(-1, 4)
cov = np.nonzero(np.linalg.norm(nrm, axis=1) > 0.5)[0]
rgb = flat[cov, :3].astype(np.float32)
lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
sub = np.random.default_rng(0).choice(len(cov), min(len(cov), 150000), replace=False)
_, nb = cKDTree(pos[cov[sub]]).query(pos[cov], k=a.k, workers=-1)
nl = lum[sub][nb]  # neighbours' luminance
med = np.median(nl, 1)
pit = (med < a.dark) & (lum > med + a.gap)
darkn = nl <= med[:, None] + 10  # refill from the neighbours that are beard themselves
w = darkn[pit].astype(np.float32)
fill = (rgb[sub][nb[pit]] * w[:, :, None]).sum(1) / np.maximum(w.sum(1), 1)[:, None]
flat[cov[pit], :3] = np.clip(fill, 0, 255).astype(np.uint8)
print("covered texels", len(cov), "specks filled", int(pit.sum()))
mat.baseColorTexture = Image.fromarray(flat.reshape(px.shape))
dst = src.with_name(src.stem + "_fp.glb")
scene.export(dst)
print("saved", dst)
