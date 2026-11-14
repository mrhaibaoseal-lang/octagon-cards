"""Put the face of a processed head (solid_head / smooth_head) back onto the raw TRELLIS.2 surface; only the hair keeps
its processed shape. smooth_head's hair mask can sweep over a face whose colours drifted (O'Malley: the solid shell's
bake tinted the cheeks pink, the heavy hair smoothing then erased eyes, nose and cheekbones).

  blender -b -P pipeline/img2_3d/keep_face.py -- processed.glb raw_fix.glb out.glb [--blend 6] [--debug mask.png]

Hair = the raw mesh's colour is pink/dyed: (r - g) / r above --pink and blue above green. Everything else (skin, beard,
brows, neck) snaps to the nearest raw surface point; the hairline blends over --blend rounds of neighbour averaging.
"""
import argparse
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("raw")
ap.add_argument("out")
ap.add_argument("--pink", type=float, default=0.5, help="hair when (r - g) / r is above this and b > g")
ap.add_argument("--blend", type=int, default=6, help="neighbour-averaging rounds on the face weight (hairline blend)")
ap.add_argument("--k", type=int, default=12, help="raw neighbours whose colour is averaged before the hair test")
ap.add_argument("--debug", default=None)
a = ap.parse_args(argv)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    return meshes[0]


def vertex_colours(obj):
    """Base-colour texture sampled at each vertex's UV (first loop)."""
    me = obj.data
    img = None
    for n in me.materials[0].node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            for l in n.outputs["Color"].links:
                if l.to_socket.name == "Base Color":
                    img = n.image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    uv = np.zeros((len(me.loops), 2), np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())
    vi = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    vuv = np.zeros((len(me.vertices), 2), np.float32)
    vuv[vi] = uv
    x = np.clip((vuv[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    y = np.clip((vuv[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
    return px[y, x]


bpy.ops.wm.read_factory_settings(use_empty=True)
obj = load(a.mesh)
raw = load(a.raw)
for o in (obj, raw):
    o.parent = None
bpy.context.view_layer.update()

rv = np.array([raw.matrix_world @ v.co for v in raw.data.vertices])
col = vertex_colours(raw)
r, g, b = col[:, 0], col[:, 1], col[:, 2]
hair_raw = ((r - g) / np.maximum(r, 1e-3) > a.pink) & (b > g)
print("raw verts", len(rv), "hair", hair_raw.mean().round(3))
z = rv[:, 2]
top = z > z.min() + 0.8 * (z.max() - z.min())
print("raw top-20% hair", hair_raw[top].mean().round(3), "colour median top", np.median(col[top], 0).round(3),
      "colour median all", np.median(col, 0).round(3))

kd = KDTree(len(rv))
for i, p in enumerate(rv):
    kd.insert(p, i)
kd.balance()
mw = raw.matrix_world
bvh = BVHTree.FromPolygons([tuple(p) for p in rv], [tuple(f.vertices) for f in raw.data.polygons])

mv = obj.matrix_world
mi = mv.inverted()
pts = [mv @ v.co for v in obj.data.vertices]
# Average the colour of the --k nearest raw vertices first: the dark gaps between curls are not pink on their own.
def is_hair(p):
    c = col[[i for _, i, _ in kd.find_n(p, a.k)]].mean(0)
    return (c[0] - c[1]) / max(c[0], 1e-3) > a.pink and c[2] > c[1]


face = np.array([0.0 if is_hair(p) else 1.0 for p in pts])
pz = np.array([p.z for p in pts])
for lo_, hi_ in ((0.8, 1.01), (0.6, 0.8), (0.4, 0.6), (0, 0.4)):
    m = (pz >= pz.min() + lo_ * np.ptp(pz)) & (pz < pz.min() + hi_ * np.ptp(pz))
    print(f"z {lo_}-{hi_}: verts {m.sum()} face {face[m].mean():.2f} dist {np.median([kd.find(pts[i])[2] for i in np.where(m)[0][:500]]):.4f}")

# Blend the hairline: average the weight over mesh neighbours.
ev = np.zeros((len(obj.data.edges), 2), np.int64)
obj.data.edges.foreach_get("vertices", ev.ravel())
deg = np.bincount(ev.ravel(), minlength=len(pts)).astype(float) + 1
for _ in range(a.blend):
    s = face.copy()
    np.add.at(s, ev[:, 0], face[ev[:, 1]])
    np.add.at(s, ev[:, 1], face[ev[:, 0]])
    face = s / deg
print("verts", len(pts), "face weight > 0.5:", (face > 0.5).mean().round(3))

moved = []
for i, p in enumerate(pts):
    if face[i] <= 0:
        continue
    hit = bvh.find_nearest(p)
    if hit[0] is None:
        continue
    q = p.lerp(hit[0], face[i])
    moved.append((p - q).length)
    obj.data.vertices[i].co = mi @ q
print("moved", len(moved), "median", np.median(moved).round(4), "max", np.max(moved).round(4))

if a.debug:
    # Paint the weight as vertex colour on a copy for a quick look (red = hair keeps processed shape).
    attr = obj.data.color_attributes.new("w", "FLOAT_COLOR", "POINT")
    for i, wv in enumerate(face):
        attr.data[i].color = (1 - wv, wv * 0.6, 0.2, 1)

bpy.data.objects.remove(raw)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB", use_selection=True)
print("saved", a.out)
