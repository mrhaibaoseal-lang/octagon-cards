"""Push a head's shapes towards a stylised animated-film look: heavier brow ridge, wider and squarer jaw, stronger chin.
Smooth falloffs, eyes untouched.

  blender -b -P pipeline/img2_3d/exaggerate_head.py -- in.glb out.glb [--brow 0.014] [--jaw 1.12] [--chin 0.01]
(amounts are fractions of the mesh height; --jaw is a sideways scale)
"""
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("out")
ap.add_argument("--brow", type=float, default=0.014)
ap.add_argument("--jaw", type=float, default=1.12)
ap.add_argument("--chin", type=float, default=0.01)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.mesh, merge_vertices=True)
head = [o for o in bpy.data.objects if o.type == "MESH"][0]
me = head.data
mw = head.matrix_world.copy()
mi = mw.inverted()
from mathutils import Vector
P = np.array([(mw @ v.co)[:] for v in me.vertices])
z0, z1 = P[:, 2].min(), P[:, 2].max()
H = z1 - z0
nose = P[np.argmin(np.where((P[:, 2] > z0 + 0.3 * H) & (P[:, 2] < z1 - 0.3 * H), P[:, 1], 9))]
cx = nose[0]
ez = nose[2] + 0.10 * H  # eye line (see smooth_head.py)
x, y, z = P[:, 0] - cx, P[:, 1], P[:, 2]


def bump(t, lo, hi):  # 0 outside [lo, hi], smooth 1 in the middle
    u = np.clip((t - lo) / (hi - lo), 0, 1)
    return np.sin(np.pi * u) ** 2


front = np.clip((nose[1] + 0.2 * H - y) / (0.1 * H), 0, 1)  # 1 on the face, 0 towards the back
Q = P.copy()
# Brow ridge: forward, strongest just above the eyes, across the forehead width.
wb = bump(z, ez + 0.005 * H, ez + 0.085 * H) * np.clip(1 - np.abs(x) / (0.14 * H), 0, 1) ** 0.5 * front
Q[:, 1] -= a.brow * H * wb
# Jaw: wider below the mouth down to the chin, fading out above the cheekbones and below the jawline.
wj = bump(z, nose[2] - 0.24 * H, nose[2] - 0.02 * H) * np.clip((y - (nose[1] + 0.45 * H)) / (-0.2 * H), 0, 1)
Q[:, 0] = cx + x * (1 + (a.jaw - 1) * wj)
# Chin: forward and a touch down.
wc = bump(z, nose[2] - 0.24 * H, nose[2] - 0.10 * H) * np.clip(1 - np.abs(x) / (0.08 * H), 0, 1) * front
Q[:, 1] -= a.chin * H * wc
Q[:, 2] -= 0.5 * a.chin * H * wc
print("moved max", round(float(np.linalg.norm(Q - P, axis=1).max() / H), 4), "x height")
for v, q in zip(me.vertices, Q):
    v.co = mi @ Vector(q)
me.update()
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB")
print("saved", a.out)
