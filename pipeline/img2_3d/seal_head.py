"""Seal the pores of a hollow two-wall TRELLIS head before painting (Volkanovski's beard). Voxelise the outer wall,
put a solid slab over the open bottom, dilate --r cells so the pores close, flood the outside from the grid border,
solid = the rest, erode back, marching cubes, then snap each vertex within --snap cells back onto the outer wall.
Above --ymax only --r1 cells are closed (cells deep in the strongly closed solid block the flood from the hollow).
Check that "strong solid frac" is about 0.2+; about 0.02 means the flood got into the hollow (raise --r).

  uv run --no-project --python 3.12 --with numpy --with trimesh --with scipy --with scikit-image --with matplotlib       python -I pipeline/img2_3d/seal_head.py outer.glb outer.glb sealed.glb --pitch 0.002 --r 5 --ymax -0.04 --snap 1.5

Whole recipe (README, Volkanovski): outer_walls.py -> seal_head.py -> keep the faces below the nose tip, decimate
-> merge_heads.py with the original head (eyes untouched) -> solid_head.py --shape -> gemini_paint --reuse.
"""
import sys, argparse, time, functools
print = functools.partial(print, flush=True); T0 = time.time()
import numpy as np, trimesh
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from scipy.spatial import ConvexHull
from skimage.measure import marching_cubes
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("outer"); ap.add_argument("dst")
ap.add_argument("--pitch", type=float, default=0.002)
ap.add_argument("--r", type=int, default=3)
ap.add_argument("--snap", type=float, default=1.2)
ap.add_argument("--smooth", type=int, default=0)
ap.add_argument("--ymax", type=float, default=None)
ap.add_argument("--r1", type=int, default=1)
a = ap.parse_args()
g = next(iter(trimesh.load(a.src, process=False).geometry.values()))
V, F = np.asarray(g.vertices), np.asarray(g.faces)
lo, hi = V.min(0), V.max(0)
# lid over the open bottom (as dark_inside.py)
low = V[V[:, 1] < lo[1] + 0.02 * (hi[1] - lo[1])][:, [0, 2]]
ring = low[ConvexHull(low).vertices]; ly = lo[1] + 0.004 * (hi[1] - lo[1])
lidv = np.vstack([[[ring[:, 0].mean(), ly, ring[:, 1].mean()]], np.c_[ring[:, 0], np.full(len(ring), ly), ring[:, 1]]])
k = len(ring); lidf = np.array([[0, 1 + i, 1 + (i + 1) % k] for i in range(k)]) + len(V)
m = trimesh.Trimesh(np.vstack([V, lidv]), np.vstack([F, lidf]), process=False)
p = a.pitch; pad = a.r + 3
n = int(m.area / (p / 3) ** 2)
pts, _ = trimesh.sample.sample_surface(m, n)
org = lo - pad * p
shape = np.ceil((hi - lo) / p).astype(int) + 2 * pad + 1
occ = np.zeros(shape, bool)
ij = np.floor((pts - org) / p).astype(int)
occ[ij[:, 0], ij[:, 1], ij[:, 2]] = True
occ[tuple(np.floor((V - org) / p).astype(int).T)] = True
# solid slab over the bottom 3 % inside the hull of the lowest 6 % (a thin lid left a gap under the flared neck)
from matplotlib.path import Path as MP
low2 = V[V[:, 1] < lo[1] + 0.06 * (hi[1] - lo[1])][:, [0, 2]]
hull = MP(low2[ConvexHull(low2).vertices])
gx_, gz_ = np.meshgrid(org[0] + (np.arange(shape[0]) + .5) * p, org[2] + (np.arange(shape[2]) + .5) * p, indexing="ij")
inside2 = hull.contains_points(np.c_[gx_.ravel(), gz_.ravel()]).reshape(shape[0], shape[2])
ytop = int((lo[1] + 0.03 * (hi[1] - lo[1]) - org[1]) / p)
occ[:, :ytop, :] |= inside2[:, None, :]
print(round(time.time()-T0), "grid", shape, "samples", n)
st = ndi.generate_binary_structure(3, 1)
def flood(block):  # outside = free cells connected to the grid border
    lab, _ = ndi.label(~block)
    ids = np.unique(np.concatenate([lab[0].ravel(), lab[-1].ravel(), lab[:, 0].ravel(), lab[:, -1].ravel(), lab[:, :, 0].ravel(), lab[:, :, -1].ravel()]))
    return np.isin(lab, ids[ids > 0])


def biggest(m):
    lab2, nl = ndi.label(m); sz = np.bincount(lab2.ravel()); sz[0] = 0
    return lab2 == sz.argmax()


dil = ndi.binary_dilation(occ, st, iterations=a.r)
outside = flood(dil)
solid_r = biggest(ndi.binary_erosion(~outside, st, iterations=a.r, border_value=0))
print("strong solid frac", solid_r.mean())
if a.ymax is not None:
    # above ymax (eyes): close only r1 cells; cells deep inside the strong solid block the flood from the hollow
    deep = ndi.binary_erosion(solid_r, st, iterations=a.r + 2, border_value=0)
    out1 = flood(ndi.binary_dilation(occ, st, iterations=a.r1) | deep)
    solid_1 = ndi.binary_erosion(~out1, st, iterations=a.r1, border_value=0)
    yc = org[1] + (np.arange(shape[1]) + 0.5) * p
    up = (yc > a.ymax)[None, :, None]
    solid = biggest(np.where(up, solid_1, solid_r))
else:
    solid = solid_r
print(round(time.time()-T0), "solid frac", solid.mean())
vol = ndi.gaussian_filter(solid.astype(np.float32), 0.7)
mv, mf, _, _ = marching_cubes(vol, 0.5)
mv = (mv + 0.5) * p + org
mf = mf[:, ::-1]
print(round(time.time()-T0), "mc verts", len(mv), "faces", len(mf))
# snap onto the outer wall
og = next(iter(trimesh.load(a.outer, process=False).geometry.values()))
on = int(og.area / (p / 4) ** 2)
sp, fi = trimesh.sample.sample_surface(og, on)
d, nn = cKDTree(sp).query(mv, workers=-1)
# exact closest point on the sampled triangle's plane
proj = trimesh.triangles.closest_point(og.triangles[fi[nn]], mv)
d = np.linalg.norm(proj - mv, axis=1)
snap = d < a.snap * p
w = np.clip((1.5 * a.snap * p - d) / (0.5 * a.snap * p), 0, 1)[:, None]  # full snap inside snap, fades out by 1.5x
mv = mv * (1 - w) + proj * w
print(round(time.time()-T0), "snapped", int(snap.sum()), "of", len(mv))
res = trimesh.Trimesh(mv, mf, process=True)
if a.smooth:
    free = ~snap
    for _ in range(a.smooth):
        nb = res.vertex_neighbors
        avg = np.array([res.vertices[x].mean(0) for x in nb])
        vv = res.vertices.copy(); vv[free] = avg[free]; res.vertices = vv
res.export(a.dst); print(round(time.time()-T0), "saved", a.dst, len(res.faces))
