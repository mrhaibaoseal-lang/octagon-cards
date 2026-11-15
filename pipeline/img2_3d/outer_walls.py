"""(seal_head.py step 1) Keep only the faces of a TRELLIS head seen from outside (same test as dark_inside.py), drop the inner wall.

  uv run --no-project --with numpy --with trimesh --with scipy --with embreex python -I outer_walls.py head.glb outer.glb
"""
import sys
import numpy as np, trimesh
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull
src, dst = sys.argv[1], sys.argv[2]
VIEWS, S, PORE, JUMP, MINV = 300, 640, 0.04, 0.08, 3
scene = trimesh.load(src, process=False)
g = next(iter(scene.geometry.values()))
V, F = np.asarray(g.vertices), np.asarray(g.faces)
lo, hi = V.min(0), V.max(0)
low = V[V[:, 1] < lo[1] + 0.02 * (hi[1] - lo[1])][:, [0, 2]]
ring = low[ConvexHull(low).vertices]
ly = lo[1] + 0.004 * (hi[1] - lo[1])
lidv = np.vstack([[[ring[:, 0].mean(), ly, ring[:, 1].mean()]], np.c_[ring[:, 0], np.full(len(ring), ly), ring[:, 1]]])
k = len(ring)
lidf = np.array([[0, 1 + i, 1 + (i + 1) % k] for i in range(k)]) + len(V)
mesh = trimesh.Trimesh(np.vstack([V, lidv]), np.vstack([F, lidf]), process=False)
centre = (lo + hi) / 2; span = float(np.linalg.norm(hi - lo))
win = max(3, int(round(PORE / span * S)) | 1)
gy, gx = np.mgrid[0:S, 0:S]
u = ((gx + 0.5) / S - 0.5).ravel() * span; v = (0.5 - (gy + 0.5) / S).ravel() * span
outside = np.zeros(len(F) + k, int)
i = np.arange(VIEWS) + 0.5
ph, th = np.arccos(1 - 2 * i / VIEWS), np.pi * (1 + 5 ** 0.5) * i
for d in np.stack([np.cos(th) * np.sin(ph), np.cos(ph), np.sin(th) * np.sin(ph)], 1):
    right = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.95 else [1, 0, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, d)
    org = centre - d * span + u[:, None] * right + v[:, None] * up
    loc, ray, tri = mesh.ray.intersects_location(org, np.tile(d, (len(org), 1)), multiple_hits=False)
    depth = np.full(S * S, 10 * span); depth[ray] = (loc - org[ray]) @ d
    face = np.full(S * S, -1); face[ray] = tri
    dm = depth.reshape(S, S)
    near = ndi.maximum_filter(ndi.minimum_filter(dm, win), win)
    pit = (dm - near > JUMP).ravel()
    outside[np.unique(face[(face >= 0) & ~pit])] += 1
keep = outside[:len(F)] >= MINV
print("faces", len(F), "kept", int(keep.sum()))
out = trimesh.Trimesh(V, F[keep], process=False); out.remove_unreferenced_vertices()
out.export(dst); print("saved", dst)
