"""Darken everything on a painted TRELLIS head that can only be seen through a pore. The mesh is a hollow shell
with an outer and an inner wall, joined through small pores (no open edges, so counting boundary edges finds
nothing; the bottom of the bust is open too). Through a pore the render shows the inner wall on the far side of
the head, which no painted view saw and which keeps the old skin-coloured texture: round light dots in a dark
beard that no edit of the beard's own texels can touch (Volkanovski).

  uv run --no-project --with numpy --with pillow --with trimesh --with scipy --with embreex python -I \
      pipeline/img2_3d/dark_inside.py head_paint_ng.glb paint/<mesh> head_paint_ng_in.glb

The head is looked at from --views directions. A face counts as outside when it is the first thing a ray hits in
at least one view, unless that hit lies in a small spot much deeper than its surroundings (a look through a pore).
A lid over the open bottom keeps the views from below out of the hollow. Texels of all other faces that no painted
view saw (vis.npy of the gemini_paint work folder) are recoloured, so painted texels - eyes, brows, skin - cannot
change. The colour is the lower quartile of the colours right around the pores (--color r,g,b), so in a beard the
pores take the beard's colour.
"""
import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("work", help="gemini_paint work folder of the same mesh (nrm.npy, vis.npy)")
ap.add_argument("dst")
ap.add_argument("--views", type=int, default=300)
ap.add_argument("--size", type=int, default=640, help="rays per view = size * size")
ap.add_argument("--pore", type=float, default=0.04, help="widest spot that still counts as a pore (model units)")
ap.add_argument("--jump", type=float, default=0.08, help="a pore sighting is this much deeper than its surroundings")
ap.add_argument("--min-views", type=int, default=3, help="a face is outside when this many views see it directly")
ap.add_argument("--ymax", type=float, default=None, help="only recolour faces below this height (glTF y, model units), e.g. the nose tip, to keep away from the eyes")
ap.add_argument("--color", default=None, help="r,g,b for the inside wall (default: from the painted texels)")
ap.add_argument("--debug", action="store_true", help="recolour in magenta to see what changes")
a = ap.parse_args()

scene = trimesh.load(a.src, process=False)
g = next(iter(scene.geometry.values()))
V, F, UV = np.asarray(g.vertices), np.asarray(g.faces), np.asarray(g.visual.uv)  # glTF: y is up
mat = g.visual.material
px = np.asarray(mat.baseColorTexture.convert("RGBA")).copy()
H, W = px.shape[:2]
seen = np.load(Path(a.work) / "vis.npy").any(1).reshape(H, W)
covered = (np.linalg.norm(np.load(Path(a.work) / "nrm.npy").reshape(-1, 3), axis=1) > 0.5).reshape(H, W)

# lid: the outline of the lowest slice, a little above the bottom edge
lo, hi = V.min(0), V.max(0)
low = V[V[:, 1] < lo[1] + 0.02 * (hi[1] - lo[1])][:, [0, 2]]
ring = low[ConvexHull(low).vertices]
ly = lo[1] + 0.004 * (hi[1] - lo[1])
lidv = np.vstack([[[ring[:, 0].mean(), ly, ring[:, 1].mean()]], np.c_[ring[:, 0], np.full(len(ring), ly), ring[:, 1]]])
k = len(ring)
lidf = np.array([[0, 1 + i, 1 + (i + 1) % k] for i in range(k)]) + len(V)
mesh = trimesh.Trimesh(np.vstack([V, lidv]), np.vstack([F, lidf]), process=False)

centre = (lo + hi) / 2
span = float(np.linalg.norm(hi - lo))
S = a.size
win = max(3, int(round(a.pore / span * S)) | 1)
gy, gx = np.mgrid[0:S, 0:S]
u = ((gx + 0.5) / S - 0.5).ravel() * span
v = (0.5 - (gy + 0.5) / S).ravel() * span
outside = np.zeros(len(F) + k, int)
through = np.zeros(len(F) + k, bool)
rim = np.zeros(len(F) + k, bool)
i = np.arange(a.views) + 0.5
ph, th = np.arccos(1 - 2 * i / a.views), np.pi * (1 + 5 ** 0.5) * i
for d in np.stack([np.cos(th) * np.sin(ph), np.cos(ph), np.sin(th) * np.sin(ph)], 1):  # d: from the camera into the scene
    right = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.95 else [1, 0, 0])
    right /= np.linalg.norm(right)
    up = np.cross(right, d)
    org = centre - d * span + u[:, None] * right + v[:, None] * up
    loc, ray, tri = mesh.ray.intersects_location(org, np.tile(d, (len(org), 1)), multiple_hits=False)
    depth = np.full(S * S, 10 * span)
    depth[ray] = (loc - org[ray]) @ d
    face = np.full(S * S, -1)
    face[ray] = tri
    dm = depth.reshape(S, S)
    near = ndi.maximum_filter(ndi.minimum_filter(dm, win), win)  # the depth map without its small deep spots
    pit = (dm - near > a.jump).ravel()
    outside[np.unique(face[(face >= 0) & ~pit])] += 1
    through[face[(face >= 0) & pit]] = True
    hole = (pit & (face >= 0)).reshape(S, S)
    rim[face[(ndi.binary_dilation(hole, iterations=3) & ~hole).ravel() & (face >= 0) & ~pit]] = True
outside, through, rim = outside[:len(F)] >= a.min_views, through[:len(F)], rim[:len(F)]
print("faces", len(F), "seen from outside", int(outside.sum()), "seen only through pores", int((through & ~outside).sum()))


def texels(faces, n=12):  # texels under the faces' UV triangles (barycentric samples)
    m = np.zeros((H, W), bool)
    uv = UV[F[faces]]
    for p in range(n + 1):
        for q in range(n + 1 - p):
            t = (uv[:, 0] * p + uv[:, 1] * q + uv[:, 2] * (n - p - q)) / n
            m[np.clip(((1 - t[:, 1]) * H).astype(int), 0, H - 1), np.clip((t[:, 0] * W).astype(int), 0, W - 1)] = True
    return m


inner = ~outside if a.ymax is None else ~outside & (V[F][:, :, 1].mean(1) < a.ymax)
tin, tout = texels(np.nonzero(inner)[0]), texels(np.nonzero(~inner)[0])
# two texels of margin so bilinear filtering at the island edges does not bring the old colour back
mask = ndi.binary_dilation(tin, iterations=2) & ~tout & ~seen
rgb = px[..., :3].astype(np.float32)
if a.debug:
    col = np.array([255, 0, 255])
elif a.color:
    col = np.array([float(c) for c in a.color.split(",")])
else:
    c = UV[F[rim & outside]].mean(1)
    # lower quartile, not the median: pores at the beard's edge have skin on one side of the rim
    col = np.percentile(rgb[np.clip(((1 - c[:, 1]) * H).astype(int), 0, H - 1), np.clip((c[:, 0] * W).astype(int), 0, W - 1)], 25, axis=0)
px[mask, :3] = np.clip(col, 0, 255).astype(np.uint8)
print("texels recoloured", int(mask.sum()), "colour", np.round(col))
mat.baseColorTexture = Image.fromarray(px)
scene.export(a.dst)
print("saved", a.dst)
