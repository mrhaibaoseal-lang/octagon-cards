"""Put the face of a processed head back onto the raw TRELLIS.2 surface; only the hair keeps its processed shape.
smooth_head's hair mask swept over O'Malley's face and the heavy smoothing erased eyes, nose and cheekbones.

  blender -b -P pipeline/img2_3d/keep_face.py -- processed.glb raw_fix.glb out.glb --image inputs/<name>_rgba.png
      [--debug mask.png]

O'Malley (2026-11-15): processed = solid_head.py --voxel 0.006 --close 3.5 --no-uv (194k verts; the 0.015 shell has
too few points and the face came back blurry).
Face mask: points facing the camera take their label from the TRELLIS input image (hair = saturated, outside the skin
hues; his hair is red, pink and blue), the rest from the raw colour seen along the inward normal plus a smooth-surface
test; the face grows from the nose tip and the neck base, hair islands inside it (blue tattoos) become face, small holes
close. Face vertices snap to the nearest raw point; ones over a TRELLIS hole are refilled from their neighbours.

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
ap.add_argument("--sat", type=float, default=0.4, help="hair: saturation above this ...")
ap.add_argument("--hue", type=float, nargs=2, default=(5, 60), help="... and hue (deg) outside this skin range")
ap.add_argument("--image", default=None, help="the TRELLIS input (RGBA); front-facing points take their label from it")
ap.add_argument("--blend", type=int, default=12, help="neighbour-averaging rounds on the face weight (hairline blend)")
ap.add_argument("--k", type=int, default=12, help="raw neighbours whose colour is averaged before the hair test")
ap.add_argument("--tol", type=float, default=0.04, help="face only where the shell is this close to the raw surface (head heights)")
ap.add_argument("--radius", type=float, default=0.03, help="neighbourhood (head heights) for the roughness test")
ap.add_argument("--rough", type=float, default=0.6, help="face only where the raw surface is smoother than this")
ap.add_argument("--facing", type=float, default=0.3, help="normal toward the camera above this uses the image label")
ap.add_argument("--refill", type=int, default=30, help="smoothing rounds over vertices that landed on a TRELLIS hole")
ap.add_argument("--subdiv", type=int, default=0, help="simple subdivision levels before snapping (coarse input)")
ap.add_argument("--hair-mesh", default=None, help="smoothed head (smooth_head output) whose surface the hair snaps to")
ap.add_argument("--hair-smooth", type=int, default=0, help="Taubin rounds over the hair (curl bumps -> painted volume)")
ap.add_argument("--face-smooth", type=int, default=2, help="Taubin rounds over the face (hides flat triangles)")
ap.add_argument("--fill", type=int, default=10, help="dilate/erode rounds that close small holes in the face mask")
ap.add_argument("--show-rough", action="store_true", help="debug PNG shows roughness instead of the mask")
ap.add_argument("--debug", default=None, help="PNG: front and side views of the mask (red = hair)")
a = ap.parse_args(argv)


def hairy(c):
    """Dyed hair: saturated and outside the skin hues (orange-brown, about 5-60 deg). O'Malley's hair is red, pink and
    blue, so a pink-only test called two thirds of it skin. Beard and brows are brown: skin hue, kept as face."""
    c = np.atleast_2d(c)
    mx, mn = c.max(1), c.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return (sat > a.sat) & ((hue < a.hue[0]) | (hue > a.hue[1]))


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
if a.subdiv:
    # More vertices for the face to land on (smooth_head output is ~29k); simple subdivision keeps shape and UVs.
    bpy.context.view_layer.objects.active = obj
    m = obj.modifiers.new("sub", "SUBSURF")
    m.subdivision_type, m.levels = "SIMPLE", a.subdiv
    bpy.ops.object.modifier_apply(modifier=m.name)
    print("subdivided to", len(obj.data.vertices), "verts")

rv = np.array([raw.matrix_world @ v.co for v in raw.data.vertices])
col = vertex_colours(raw)
r, g, b = col[:, 0], col[:, 1], col[:, 2]
hair_raw = hairy(col)
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
nrm = [(mv.to_3x3() @ v.normal).normalized() for v in obj.data.vertices]
H = rv[:, 2].max() - rv[:, 2].min()
ev = np.zeros((len(obj.data.edges), 2), np.int64)
obj.data.edges.foreach_get("vertices", ev.ravel())
tri = [tuple(f.vertices) for f in raw.data.polygons]


def colour_under(p, n):
    """Raw colour seen looking inward along -normal (what a camera facing this spot sees), --k neighbours averaged:
    the nearest raw point under the hair shell is often scalp or a dark gap between curls, the first hit is the curl."""
    hit = bvh.ray_cast(p + n * (0.02 * H), -n, 0.06 * H)
    q = hit[0] if hit[0] is not None else kd.find(p)[0]
    return col[[i for _, i, _ in kd.find_n(q, a.k)]].mean(0)


c = np.array([colour_under(p, n) for p, n in zip(pts, nrm)])
pink = hairy(c)
dist = np.array([kd.find(p)[2] for p in pts]) / H


def rough(p):
    """Plane-fit residual of the raw surface around p: skin is one smooth sheet, curls are a tangle of tubes."""
    idx = [i for _, i, _ in kd.find_range(p, a.radius * H)]
    if len(idx) < 4:  # TRELLIS decimates flat skin to a few big triangles: sparse means smooth
        return 0.0
    n = rn[idx]
    return float(1 - np.linalg.norm(n.mean(0)))  # 0 = all normals agree, 1 = they point every way


rn = np.array([tuple(raw.matrix_world.to_3x3() @ v.normal) for v in raw.data.vertices])
rn /= np.maximum(np.linalg.norm(rn, axis=1, keepdims=True), 1e-9)
rgh = np.array([rough(p) for p in pts])
print("rough pct", np.percentile(rgh, [10, 25, 50, 75, 90]).round(3))
cand = ~pink & (dist < a.tol) & (rgh < a.rough)
P = np.array([tuple(p) for p in pts])
N = np.array([tuple(n) for n in nrm])
front_img = np.zeros(len(P), bool)
if a.image:
    # Orthographic front view (face looks at -Y): fit the raw mesh's x/z box onto the image's alpha box.
    im = bpy.data.images.load(a.image)
    iw, ih = im.size
    px = np.array(im.pixels[:], np.float32).reshape(ih, iw, 4)  # row 0 = bottom
    ys, xs = np.where(px[:, :, 3] > 0.5)
    (x0, x1), (y0, y1) = (xs.min(), xs.max()), (ys.min(), ys.max())
    rx0, rx1, rz0, rz1 = rv[:, 0].min(), rv[:, 0].max(), rv[:, 2].min(), rv[:, 2].max()
    u = np.clip(((P[:, 0] - rx0) / (rx1 - rx0) * (x1 - x0) + x0).round().astype(int), 0, iw - 1)
    v = np.clip(((P[:, 2] - rz0) / (rz1 - rz0) * (y1 - y0) + y0).round().astype(int), 0, ih - 1)
    # Majority of a small window: single curls over the forehead should not punch holes in the face.
    win = [hairy(px[np.clip(v + dy, 0, ih - 1), np.clip(u + dx, 0, iw - 1), :3])
           for dx in (-6, 0, 6) for dy in (-6, 0, 6)]
    img_hair = np.mean(win, 0) > 0.5
    facing = -N[:, 1] > a.facing
    front_img = facing & ~img_hair & (px[v, u, 3] > 0.5)
    pink = np.where(facing, img_hair, pink)
    cand = np.where(facing, front_img, cand)
    print("image", iw, ih, "alpha box", x0, x1, y0, y1, "front-facing", facing.mean().round(3),
          "front skin", front_img.mean().round(3))
pz = (P[:, 2] - P[:, 2].min()) / np.ptp(P[:, 2])
# Seeds: the nose tip (front-most point, face looks at -Y, between 40% and 75% of the height) and the neck base.
mid = np.where((pz > 0.4) & (pz < 0.75))[0]
nose = mid[np.argmin(P[mid, 1])]
face = np.zeros(len(P), bool)
face[nose] = True
face |= (pz < 0.04) & cand
# Grow over candidate vertices along mesh edges: patches of scalp seen through the curls on top of the head are not
# connected to the face, so they stay hair.
for it in range(2000):
    grow = face.copy()
    np.logical_or.at(grow, ev[:, 0], face[ev[:, 1]])  # .at: plain fancy |= keeps only the last write per vertex
    np.logical_or.at(grow, ev[:, 1], face[ev[:, 0]])
    grow &= cand | face
    if grow.sum() == face.sum():
        break
    face = grow
# Close small holes (pupils, nostrils, dark brow hairs read as pink-ish): dilate then erode --fill rounds.
def step(m, dil):
    o = m.copy()
    if dil:
        np.logical_or.at(o, ev[:, 0], m[ev[:, 1]])
        np.logical_or.at(o, ev[:, 1], m[ev[:, 0]])
    else:
        np.logical_and.at(o, ev[:, 0], m[ev[:, 1]])
        np.logical_and.at(o, ev[:, 1], m[ev[:, 0]])
    return o
for _ in range(a.fill):
    face = step(face, True)
for _ in range(a.fill):
    face = step(face, False)
# Hair islands inside the face (blue tattoos read as dyed hair: O'Malley's "love", star, temple, neck) become face:
# only the hair region connected to the biggest hair mass stays hair.
hair = ~face
lab = np.where(hair, np.arange(len(P)), len(P))
both = hair[ev[:, 0]] & hair[ev[:, 1]]
e0, e1 = ev[both, 0], ev[both, 1]
while True:
    m = np.minimum(lab[e0], lab[e1])
    new = lab.copy()
    np.minimum.at(new, e0, m)
    np.minimum.at(new, e1, m)
    if (new == lab).all():
        break
    lab = new
ids, cnt = np.unique(lab[hair], return_counts=True)
main = ids[np.argmax(cnt)]
print("hair islands", len(ids), "filled", int(hair.sum() - cnt.max()), "verts")
face = ~(hair & (lab == main))
print("nose colour", c[nose].round(2), "dist", dist[nose].round(4), "dist pct", np.percentile(dist, [10, 50, 90]).round(4),
      "front mid colour", np.median(c[mid[P[mid, 1] < np.percentile(P[mid, 1], 10)]], 0).round(2))
print("nose at z", round(pz[nose], 2), "cand", cand.mean().round(3), "pink", pink.mean().round(3), "grow iters", it)
for lo_, hi_ in ((0.85, 1.01), (0.7, 0.85), (0.55, 0.7), (0.4, 0.55), (0.2, 0.4), (0, 0.2)):
    m = (pz >= lo_) & (pz < hi_)
    fr = m & (P[:, 1] < np.median(P[m, 1]))
    print(f"z {lo_}-{hi_}: verts {m.sum()} face {face[m].mean():.2f} front-half face {face[fr].mean():.2f}")
face = face.astype(float)

# Blend the hairline: average the weight over mesh neighbours.
deg = np.bincount(ev.ravel(), minlength=len(pts)).astype(float) + 1
for _ in range(a.blend):
    s = face.copy()
    np.add.at(s, ev[:, 0], face[ev[:, 1]])
    np.add.at(s, ev[:, 1], face[ev[:, 0]])
    face = s / deg
print("verts", len(pts), "face weight > 0.5:", (face > 0.5).mean().round(3))

# TRELLIS leaves small holes in the face; a shell vertex over a hole snaps to the rim and the spot sinks into a pit.
# Those vertices (nearest raw face touches a hole edge, or nothing close) are refilled from their neighbours below.
from collections import Counter  # noqa: E402
ec = Counter(tuple(sorted(k)) for f in raw.data.polygons for k in f.edge_keys)
rim = np.zeros(len(rv), bool)
for (i, j), n in ec.items():
    if n == 1:
        rim[i] = rim[j] = True
print("raw hole-edge verts", rim.sum())
moved = []
pit = np.zeros(len(pts), bool)
new_co = [p.copy() for p in pts]
for i, p in enumerate(pts):
    if face[i] <= 0:
        continue
    hit = bvh.find_nearest(p)
    if hit[0] is None:
        continue
    if face[i] > 0.5 and (any(rim[list(tri[hit[2]])]) or hit[3] > a.tol * H):
        pit[i] = True
    q = p.lerp(hit[0], face[i])
    moved.append((p - q).length)
    new_co[i] = q
# grow the pit set by a ring so the refill blends, then Laplacian-fill only those vertices
for _ in range(2):
    g = pit.copy()
    np.logical_or.at(g, ev[:, 0], pit[ev[:, 1]])
    np.logical_or.at(g, ev[:, 1], pit[ev[:, 0]])
    pit = g & (face > 0.5)
X = np.array([tuple(q) for q in new_co])
for _ in range(a.refill):
    acc = np.zeros_like(X)
    np.add.at(acc, ev[:, 0], X[ev[:, 1]])
    np.add.at(acc, ev[:, 1], X[ev[:, 0]])
    nb = np.bincount(ev.ravel(), minlength=len(X))[:, None]
    X[pit] = acc[pit] / np.maximum(nb[pit], 1)
# Taubin smoothing (shrink, then grow back): hair by weight (1 - face) for --hair-smooth rounds, the face lightly for
# --face-smooth rounds so TRELLIS's flat decimated triangles do not show as facets.
nb = np.bincount(ev.ravel(), minlength=len(X))[:, None].astype(float)


def taubin(X, w, rounds):
    for _ in range(rounds):
        for lam in (0.5, -0.53):
            acc = np.zeros_like(X)
            np.add.at(acc, ev[:, 0], X[ev[:, 1]])
            np.add.at(acc, ev[:, 1], X[ev[:, 0]])
            X = X + lam * w[:, None] * (acc / np.maximum(nb, 1) - X)
    return X


if a.hair_mesh:
    # Hair takes the shape of an already smoothed head (smooth_head output): a fine shell keeps every curl bump and
    # Taubin rounds barely touch bumps that span dozens of vertices.
    hm = load(a.hair_mesh)
    hm.parent = None
    bpy.context.view_layer.update()
    hv = [hm.matrix_world @ v.co for v in hm.data.vertices]
    hb = BVHTree.FromPolygons([tuple(p) for p in hv], [tuple(f.vertices) for f in hm.data.polygons])
    for i in range(len(X)):
        w = 1 - face[i]
        if w <= 0:
            continue
        q = hb.find_nearest(type(pts[0])(X[i]))[0]
        if q is not None:
            X[i] = X[i] + w * (np.array(tuple(q)) - X[i])
    bpy.data.objects.remove(hm)
X = taubin(X, 1 - face, a.hair_smooth)
X = taubin(X, face, a.face_smooth)
for i in range(len(X)):
    obj.data.vertices[i].co = mi @ type(pts[0])(X[i])
print("moved", len(moved), "median", np.median(moved).round(4), "max", np.max(moved).round(4), "pit-refilled", pit.sum())

if a.debug:
    # Front (looking at +Y) and right side (looking at -X) point views of the mask, nearest points drawn last.
    S = 400
    img = np.full((S, 2 * S, 3), 0.35, np.float32)
    rgb = np.stack([1 - face, face * 0.7 + 0.2, 0.25 + 0 * face], 1)
    if a.show_rough:
        t = np.clip(rgh / (2 * a.rough), 0, 1)
        rgb = np.stack([t, 1 - t, 0.3 + 0 * t], 1)
    lo3, span = P.min(0), np.ptp(P, 0).max()
    for k, (u, d) in enumerate(((0, 1), (1, 0))):  # front: x right, depth y; side: y right, depth -x... drawn mirrored ok
        order = np.argsort(-P[:, d]) if k == 0 else np.argsort(P[:, d])
        x = ((P[order, u] - lo3[u]) / span * (S - 20) + 10).astype(int) + k * S
        y = ((P[order, 2] - lo3[2]) / span * (S - 20) + 10).astype(int)
        for dx in (0, 1):
            for dy in (0, 1):
                img[np.clip(y + dy, 0, S - 1), np.clip(x + dx, 0, 2 * S - 1)] = rgb[order]
    im = bpy.data.images.new("dbg", 2 * S, S)
    im.pixels[:] = np.concatenate([img, np.ones((S, 2 * S, 1), np.float32)], 2).ravel()
    im.filepath_raw = a.debug
    im.file_format = "PNG"
    im.save()

bpy.data.objects.remove(raw)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB", use_selection=True)
print("saved", a.out)
