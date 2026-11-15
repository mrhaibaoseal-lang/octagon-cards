"""Smooth the lumpy hair, beard and eyebrows of a painted TRELLIS.2 head and fill the groove under the brow ridge,
leaving the eyeballs where they are. The painted texture says what is hair (dark) and where the eyes are (whites).

  blender -b -P pipeline/img2_3d/smooth_head.py -- in.glb out.glb [--hair-iter 30] [--brow-iter 40] [--debug mask.png]

Hair, beard and brows: heavy Laplacian, then the (low-frequency) shrink is added back, so lumps go, volume stays.
Brow groove: plain Laplacian on a band from the eye up to the top of the brow; a concave groove fills when its
vertices move towards their neighbours' average. Eyeballs: weight 0 inside --eye-r, ramping up to 1 at 1.6 x that.
"""
import argparse
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("out")
ap.add_argument("--hair-iter", type=int, default=30)
ap.add_argument("--brow-iter", type=int, default=40)
ap.add_argument("--dark", type=float, default=0.5, help="hair = luminance below this x the face skin's median")
ap.add_argument("--beard", type=float, default=0.55, help="stubble = neighbourhood-averaged luminance below this x skin")
ap.add_argument("--hue", type=float, default=1.2, help="hair = neighbourhood chromaticity this far from the cheek skin (x10); catches dyed hair, 0 = off")
ap.add_argument("--eye-r", type=float, default=0.03, help="eyeball protection radius, as a fraction of head height")
ap.add_argument("--brow-up", type=float, default=0.09, help="brow band reaches this far above the eye (x head height)")
ap.add_argument("--face-max", type=float, default=0.1, help="stop when the hair mask covers more than this share of the bare mid-face")
ap.add_argument("--force", action="store_true", help="export even when the mask covers the face")
ap.add_argument("--debug-lum",choices=["raw", "blur"], default=None, help="with --debug: show luminance instead")
ap.add_argument("--debug", default=None, help="render a front + 3/4 picture of the masks here")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.mesh, merge_vertices=True)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1:
    bpy.ops.object.join()
head = bpy.context.view_layer.objects.active
me = head.data
mw = head.matrix_world.copy()
V = np.array([v.co[:] for v in me.vertices])
P = np.array([(mw @ v.co)[:] for v in me.vertices])  # world: Z up, face towards -Y
n = len(V)

# Per-vertex colour from the base-colour texture (average over the vertex's loops).
img = None
for node in me.materials[0].node_tree.nodes:
    if node.type == "TEX_IMAGE" and node.image:
        img = node.image
        break
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]
uv = np.zeros((len(me.loops), 2))
me.uv_layers.active.data.foreach_get("uv", uv.reshape(-1))
lv = np.zeros(len(me.loops), int)
me.loops.foreach_get("vertex_index", lv)
ix = np.clip((uv[:, 0] % 1) * W, 0, W - 1).astype(int)
iy = np.clip((uv[:, 1] % 1) * H, 0, H - 1).astype(int)
col = np.zeros((n, 3))
cnt = np.zeros(n)
np.add.at(col, lv, px[iy, ix])
np.add.at(cnt, lv, 1)
col /= np.maximum(cnt, 1)[:, None]
lum = col @ [0.299, 0.587, 0.114]
sat = col.max(1) - col.min(1)

# Edges -> neighbour lists (sparse averaging with numpy).
E = np.zeros(len(me.edges) * 2, int)
me.edges.foreach_get("vertices", E)
E = E.reshape(-1, 2)
src = np.concatenate([E[:, 0], E[:, 1]])
dst = np.concatenate([E[:, 1], E[:, 0]])
deg = np.bincount(src, minlength=n).astype(float)


def avg(X):
    out = np.zeros_like(X)
    np.add.at(out, src, X[dst])
    return out / np.maximum(deg, 1)[:, None] if X.ndim == 2 else out / np.maximum(deg, 1)


def blur(m, k):
    for _ in range(k):
        m = 0.5 * m + 0.5 * avg(m)
    return m


# Head frame: ignore the chest block TRELLIS sometimes adds.
z0, z1 = P[:, 2].min(), P[:, 2].max()
Hh = z1 - z0
cx = np.median(P[P[:, 2] > z0 + 0.5 * Hh, 0])

# Eyes: start from the nose tip (eyes sit ~0.10 head heights above it, ~0.085 to each side), then take the whites
# (brightest, least saturated texels) in a small window there. The whole-face brightest spots are the forehead.
nose = P[np.argmin(np.where((P[:, 2] > z0 + 0.3 * Hh) & (P[:, 2] < z1 - 0.3 * Hh), P[:, 1], 9))]
eyes = []
for side in (-1, 1):
    g = nose + np.array([side * 0.085 * Hh, 0, 0.10 * Hh])
    win = (np.abs(P[:, 0] - g[0]) < 0.05 * Hh) & (np.abs(P[:, 2] - g[2]) < 0.04 * Hh) & (P[:, 1] < nose[1] + 0.15 * Hh)
    m = win & (lum > np.percentile(lum[win], 85)) & (sat < np.percentile(sat[win], 50))
    e = np.median(P[m], 0) if m.sum() >= 5 else g
    if np.hypot(*(e - g)[[0, 2]]) > 0.02 * Hh:  # dark specks or tattoos pulled it off: trust the proportions
        print("eye", side, "found", e.round(4).tolist(), "too far from the guess; using the guess")
        e = g.copy()
    # The eyeball's surface: the frontmost point within a small radius of that (x, z).
    near = win & (np.hypot(P[:, 0] - e[0], P[:, 2] - e[2]) < 0.015 * Hh)
    e[1] = P[near, 1].min() if near.any() else e[1]
    eyes.append(e)
eyes = np.array(eyes)
# Skin reference: the middle of the face from just under the eyes down to the nose tip. The forehead can be under a
# fringe (O'Malley) and the lower face under a beard (Topuria); this box is bare skin on both and big enough
# (a few hundred vertices) not to land on one highlight.
ec = eyes.mean(0)
ck = (np.abs(P[:, 0] - ec[0]) < 0.06 * Hh) & (P[:, 2] < ec[2] - 0.02 * Hh) & (P[:, 2] > nose[2] - 0.0 * Hh)     & (P[:, 1] < ec[1]) & (np.min(np.linalg.norm(P[:, None, :] - eyes[None], axis=2), 1) > 0.03 * Hh)
skin_col = np.median(col[ck], 0)
skin = float(skin_col @ [0.299, 0.587, 0.114])
# Chromaticity distance from the skin (each colour divided by its own sum, so baked-in shading does not count): dyed
# hair (pink, blue) is not darker than skin but a different hue.
chroma = col / np.maximum(col.sum(1, keepdims=True), 1e-3)
# Blur steps are mesh rings; a coarse face (O'Malley's curls take most of TRELLIS's vertices) spreads 8 rings much
# further. Scale the step counts so the spread in metres matches Topuria's face (median edge 0.011 x head height).
elen = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
face_e = np.median(np.concatenate([elen[ck[E[:, 0]]], elen[ck[E[:, 1]]]])) / Hh
ring = lambda k: max(1, round(k * (0.011 / face_e) ** 2))  # noqa: E731
print("face edge", round(float(face_e), 5), "x head; blur 8 ->", ring(8))
cdist = np.linalg.norm(chroma - skin_col / max(skin_col.sum(), 1e-3), axis=1) * 10
print("head height", round(Hh, 4), "skin rgb", skin_col.round(3).tolist(), "nose", nose.round(4).tolist(),
      "eyes", eyes.round(4).tolist(), "cheek verts", int(ck.sum()))

d_eye = np.min(np.linalg.norm(P[:, None, :] - eyes[None], axis=2), 1)
r = a.eye_r * Hh
keep_eye = np.clip((d_eye - r) / (0.6 * r), 0, 1)  # 0 at the eyeball, 1 a bit outside

# Hair: dark texels; stubble is skin and hair mixed, so judge on the colour averaged over a neighbourhood too.
lum_b = blur(lum, ring(8))
# Stubble has skin-coloured specks; a narrow mask leaves them as pits, so close the holes (blur, then boost).
cd_b = blur(cdist, ring(8))
_face = ck
_top = P[:, 2] > ec[2] + 0.2 * Hh
print("colour distance (blurred) p10/50/90: face", np.percentile(cd_b[_face], [10, 50, 90]).round(2).tolist(),
      "top", np.percentile(cd_b[_top], [10, 50, 90]).round(2).tolist())
print("face verts flagged: dark", int((ck & (lum < a.dark * skin)).sum()), "stubble", int((ck & (lum_b < a.beard * skin)).sum()),
      "hue", int((ck & (cd_b > a.hue)).sum()), "of", int(ck.sum()))
hair = blur(((lum < a.dark * skin) | (lum_b < a.beard * skin) | ((cd_b > a.hue) & (a.hue > 0))).astype(float), ring(8))
hair = np.clip(hair * 2.5, 0, 1) * keep_eye
# The bare middle of the face (under the eyes down to the nose tip, cheek to cheek) is never hair on anyone. A mask
# that reaches it means the hair test failed (O'Malley: dyed curls -> mask over the whole face; eyes, nose and
# cheekbones were smoothed away and it took three rounds to get the face back). Stop instead of exporting, and never
# smooth this zone whatever the mask says.
# Measured 2026-11-15 with this zone: Topuria 1.5%, O'Malley 19% (solid shell) and 22% (raw mesh).
mid = ((np.abs(P[:, 0] - ec[0]) < 0.2 * Hh) & (P[:, 2] < ec[2] - 0.02 * Hh) & (P[:, 2] > nose[2])
       & (P[:, 1] < ec[1] + 0.12 * Hh) & (d_eye > 0.03 * Hh))
face_hit = float((hair[mid] > 0.5).mean()) if mid.any() else 0.0
print("mid-face verts", int(mid.sum()), "masked as hair:", round(face_hit, 3), "(limit", a.face_max, ")")
hair *= 1 - np.clip(blur(mid.astype(float), ring(3)) * 2, 0, 1)

# Brow band: above each eye up to --brow-up, a little wider than the eye socket, front-facing.
ez = eyes[:, 2].mean()
brow = np.zeros(n)
for e in eyes:
    dx = np.abs(P[:, 0] - e[0]) / (0.11 * Hh)
    dz = (P[:, 2] - e[2]) / (a.brow_up * Hh)
    band = (dx < 1) & (dz > -0.15) & (dz < 1) & (P[:, 1] < e[1] + 0.06 * Hh)
    brow = np.maximum(brow, band.astype(float))
brow = blur(brow, ring(4)) * keep_eye

w_hair = np.maximum(hair, brow)
print("vertices", n, "hair/beard/brow", int((hair > 0.5).sum()), "brow band", int((brow > 0.5).sum()),
      "eye locked", int((keep_eye == 0).sum()))

# Hair, beard, brows: take out the lumps but not the volume. S = heavily smoothed (shrinks); the shrink itself is
# low-frequency, so blur V - S a lot more and add it back. What is left removed is the lumps' frequency band.
S = V.copy()
for _ in range(a.hair_iter):
    S += 0.5 * (avg(S) - S)
D = V - S
for _ in range(a.hair_iter * 4):
    D += 0.5 * (avg(D) - D)
X = V + w_hair[:, None] * (S + D - V)
for _ in range(a.brow_iter):  # plain Laplacian: fills the groove
    X += 0.5 * brow[:, None] * (avg(X) - X)
move = np.linalg.norm(X - V, axis=1)
print("moved: max", round(float(move.max() / Hh), 4), "x head; eye area max",
      round(float(move[d_eye < r].max() / Hh), 5) if (d_eye < r).any() else 0)
me.vertices.foreach_set("co", X.reshape(-1))
me.update()

if a.debug:
    c = np.stack([hair, brow, 1 - keep_eye], 1) * 0.9 + 0.1
    if a.debug_lum:  # the texture brightness the masks are judged on, as grey
        c = np.repeat(lum_b[:, None] if a.debug_lum == "blur" else lum[:, None], 3, 1)
    attr = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.concatenate([c, np.ones((n, 1))], 1).reshape(-1))
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light, sh.color_type = "STUDIO", "VERTEX"
    sc.render.resolution_x, sc.render.resolution_y = 1024, 512
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type, cam.data.ortho_scale = "ORTHO", 0.75 * Hh
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = Vector((cx, 0, ez + 0.02 * Hh))
    shots = []
    for k, yaw in enumerate((0, 35)):
        rr = math.radians(yaw)
        cam.location = tgt + Vector((5 * math.sin(rr), -5 * math.cos(rr), 0))
        cam.rotation_euler = (math.radians(90), 0, rr)
        sc.render.resolution_x = sc.render.resolution_y = 512
        f = a.debug.replace(".png", f"_{k}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        shots.append(f)
    print("debug", shots)

if face_hit > a.face_max and not a.force:
    print(f"ERROR: the hair mask covers {face_hit:.0%} of the middle of the face; nothing saved. Look at the mask "
          "(--debug mask.png, red = hair). Curly or dyed hair: use the solid_head -> keep_face route (README); "
          "--force exports anyway.")
    sys.exit(1)
for att in list(me.color_attributes):
    me.color_attributes.remove(att)
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB")
print("saved", a.out)
