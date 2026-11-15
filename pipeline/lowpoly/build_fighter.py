"""Half-Life-era low-poly fighter (trial, 2026-11-15).

One generic hand-built mesh (lofted rings: limbs 6 sides, torso 8, head 10) posed in a fighting stance.
Each body part is textured by projecting a crop of the fighter's photos onto it, downscaled and
sampled without smoothing so it reads like a 1998 PC game. Per fighter only the crops change.

  blender -b -P pipeline/lowpoly/build_fighter.py -- <private dir> <out dir> [--tex-scale 0.25]
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("private")
ap.add_argument("out")
ap.add_argument("--tex-scale", type=float, default=0.25, help="body photo downscale (face photo gets 2x this)")
ap.add_argument("--clay", action="store_true", help="grey material only, to judge the shape")
ap.add_argument("--smooth-tex", action="store_true", help="linear texture filtering instead of nearest")
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)

SRC = os.path.join(a.private, "_source")
BODY = os.path.join(SRC, "ilia-topuria_fullbody_ufc.png")  # 998 x 3324
FACE = os.path.join(SRC, "topuria_ufc.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


# ---------- textures ----------
def load_small(path, scale):
    """Downscale, then grow the opaque colours into the transparent background (which is stored as black),
    so faces that sample past the silhouette edge get skin, not black stripes."""
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    sw, sh = max(8, int(w * scale)), max(8, int(h * scale))
    img.scale(sw, sh)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(sh, sw, 4)
    known = px[..., 3] > 0.5
    rgb = px[..., :3] * known[..., None]
    for _ in range(max(sw, sh)):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(rgb, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    px[..., :3] = rgb
    px[..., 3] = 1.0
    img.pixels[:] = px.ravel()
    img.pack()
    return img, (w, h)


body_img, BODY_WH = load_small(BODY, a.tex_scale)
face_img, FACE_WH = load_small(FACE, min(1.0, a.tex_scale * 2))

mats = {}


def material(name, img):
    if name in mats:
        return mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    if a.clay:
        bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1)
        mats[name] = m
        return m
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear" if a.smooth_tex else "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mats[name] = m
    return m


# ---------- mesh building ----------
mesh = bpy.data.meshes.new("fighter")
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UV")
slots = []  # material per slot
parts_tris = {}


def frame(axis, side_hint):
    axis = axis.normalized()
    L = side_hint - axis * side_hint.dot(axis)
    if L.length < 1e-4:
        L = Vector((0, 1, 0)) - axis * axis.y
    L.normalize()
    F = L.cross(axis).normalized()  # points forward (-Y) when axis is +Z and L is +X
    return L, F


def loft(name, rings, sides, img_key, crop, back_crop=None, side_hint=Vector((1, 0, 0)), cap=(True, True), ref=None, wrap=True):
    """rings: list of (center Vector, half_width, half_depth, forward_offset).
    crop: (x0, y0, x1, y1) pixels in the source photo; the part's lateral extent maps to x, first->last ring to y.
    back_crop: faces pointing backwards sample this crop instead (plain skin / hair)."""
    img, (W, H) = (body_img, BODY_WH) if img_key == "body" else (face_img, FACE_WH)
    mat = material(name, img)
    slots.append(mat)
    mi = len(slots) - 1
    axis = rings[-1][0] - rings[0][0]
    L, F = frame(axis, side_hint)
    verts = []
    for c, w, d, fo in rings:
        row = []
        for i in range(sides):
            t = 2 * math.pi * i / sides
            p = c + L * (w * math.sin(t)) + F * (d * math.cos(t)) + Vector((0, fo, 0))  # fo: world-Y shift, negative = forward
            row.append(bm.verts.new(p))
        verts.append(row)
    faces = []
    for r in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append(bm.faces.new((verts[r][i], verts[r][j], verts[r + 1][j], verts[r + 1][i])))
    if cap[0]:
        faces.append(bm.faces.new(list(reversed(verts[0]))))
    if cap[-1]:
        faces.append(bm.faces.new(verts[-1]))

    # projection: lateral -> u, along axis -> v
    origin = rings[0][0]
    alen = axis.length
    an = axis.normalized()
    lat = [(v.co - origin).dot(L) for row in verts for v in row]
    lo, hi = min(lat), max(lat)
    if ref is not None:  # project with another part's frame (nose uses the head's)
        origin, alen, an, L, lo, hi, F = ref
    loft.last_ref = (origin, alen, an, L, lo, hi, F)
    bm.normal_update()
    for f in faces:
        f.material_index = mi
        f.smooth = True
        use = crop
        if back_crop is not None and f.normal.dot(F) < -0.35:
            use = back_crop
        x0, y0, x1, y1 = use
        for loop in f.loops:
            p = loop.vert.co - origin
            s = (p.dot(L) - lo) / (hi - lo)
            if wrap:  # by angle around the axis (half planar, half angular) so side faces get real pixels, not a 1-px smear;
                # the back half mirrors the front unless the face already took back_crop
                q = p - an * p.dot(an)
                th = math.atan2(q.dot(L), q.dot(F))
                if abs(th) > math.pi / 2:
                    th = math.copysign(math.pi - abs(th), th)
                s = 0.5 + 0.5 * (0.5 * math.sin(th) + 0.5 * th / (math.pi / 2))
            t = p.dot(an) / alen
            px = x0 + s * (x1 - x0)
            py = y1 - t * (y1 - y0)  # first ring = bottom of crop... callers order rings bottom->top or proximal->distal
            loop[uv_layer].uv = (px / W, 1 - py / H)
    parts_tris[name] = sum(len(f.verts) - 2 for f in faces)
    return verts


def V(x, y, z):
    return Vector((x, y, z))


def limb(name, pts, radii, img_key, crop, sides=6, side_hint=V(1, 0, 0)):
    """pts proximal->distal. crop given top=proximal, so flip v: build rings distal->proximal."""
    rings = [(p, r[0], r[1], 0.0) for p, r in zip(pts, radii)]
    rings.reverse()
    return loft(name, rings, sides, img_key, crop, side_hint=side_hint)


# ---------- skeleton: orthodox fighting stance, facing -Y ----------
# model's right side is -X (camera left)
J = dict(
    pelvis=V(0, 0.02, 0.93),
    r_hip=V(-0.10, 0.06, 0.92), r_knee=V(-0.16, 0.12, 0.50), r_ankle=V(-0.19, 0.24, 0.08),
    l_hip=V(0.10, -0.02, 0.92), l_knee=V(0.15, -0.14, 0.50), l_ankle=V(0.16, -0.20, 0.08),
    r_sh=V(-0.20, 0.03, 1.42), r_el=V(-0.25, -0.03, 1.16), r_wr=V(-0.14, -0.17, 1.36),
    l_sh=V(0.20, 0.00, 1.42), l_el=V(0.26, -0.13, 1.20), l_wr=V(0.17, -0.31, 1.38),
)

# torso, bottom (crotch) -> top (neck base). crop y top = neck base, bottom = crotch
torso = [
    (V(0, 0.02, 0.86), 0.11, 0.08, 0.0),
    (V(0, 0.02, 0.92), 0.165, 0.105, 0.0),  # hips / shorts
    (V(0, 0.015, 0.99), 0.17, 0.11, 0.0),  # shorts waistband
    (V(0, 0.01, 1.06), 0.148, 0.098, 0.0),  # waist
    (V(0, 0.005, 1.14), 0.152, 0.103, -0.005),  # abs
    (V(0, 0.00, 1.22), 0.165, 0.11, -0.01),  # lower ribs / lats
    (V(0, 0.00, 1.30), 0.185, 0.118, -0.018),  # chest
    (V(0, 0.00, 1.37), 0.20, 0.112, -0.01),  # upper chest
    (V(0, 0.01, 1.43), 0.205, 0.095, 0.0),  # shoulders
    (V(0, 0.01, 1.475), 0.12, 0.07, 0.0),  # trapezius
    (V(0, 0.01, 1.50), 0.065, 0.06, 0.0),  # neck base
]
loft("torso", torso, 12, "body", (195, 600, 790, 1880), back_crop=(330, 1180, 420, 1260))

# neck + head, bottom -> top, from the frontal face photo
loft("neck", [(V(0, 0.01, 1.47), 0.058, 0.058, 0.0), (V(0, 0.005, 1.53), 0.054, 0.054, 0.0), (V(0, 0.0, 1.60), 0.05, 0.05, 0.0)], 8,
     "face", (225, 225, 305, 290), cap=(False, False))
head = [
    (V(0, -0.005, 1.552), 0.026, 0.035, -0.045),  # chin tip
    (V(0, -0.002, 1.570), 0.050, 0.068, -0.022),  # jaw
    (V(0, 0.000, 1.600), 0.064, 0.085, -0.012),  # mouth
    (V(0, 0.000, 1.635), 0.073, 0.095, -0.006),  # nose base / cheeks
    (V(0, 0.000, 1.668), 0.077, 0.099, -0.004),  # cheekbones
    (V(0, 0.000, 1.698), 0.078, 0.101, -0.006),  # eyes / brow
    (V(0, 0.004, 1.735), 0.076, 0.098, 0.0),  # forehead
    (V(0, 0.008, 1.768), 0.066, 0.086, 0.0),  # upper skull
    (V(0, 0.012, 1.790), 0.042, 0.056, 0.0),  # crown
]
loft("head", head, 12, "face", (183, 18, 347, 245), back_crop=(235, 14, 290, 40))
head_ref = loft.last_ref
# nose and ears: small closed wedges sunk into the head, textured with the head's projection


def wedge(name, pts, faces_idx):
    img, (W, H) = face_img, FACE_WH
    mat = material(name, img)
    slots.append(mat)
    vs = [bm.verts.new(p) for p in pts]
    origin, alen, an, L, lo, hi, F = head_ref
    x0, y0, x1, y1 = (183, 18, 347, 245)
    fs = []
    for idx in faces_idx:
        f = bm.faces.new([vs[i] for i in idx])
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - V(0, 0.005, 1.67)) < 0:  # must face away from the head's centre
            f.normal_flip()
        f.material_index = len(slots) - 1
        f.smooth = False
        for loop in f.loops:
            q = loop.vert.co - origin
            qq = q - an * q.dot(an)
            th = math.atan2(qq.dot(L), qq.dot(F))
            if abs(th) > math.pi / 2:
                th = math.copysign(math.pi - abs(th), th)
            u = 0.5 + 0.5 * (0.5 * math.sin(th) + 0.5 * th / (math.pi / 2))
            t = q.dot(an) / alen
            loop[uv_layer].uv = ((x0 + u * (x1 - x0)) / W, 1 - (y1 - t * (y1 - y0)) / H)
        fs.append(f)
    parts_tris[name] = sum(len(f.verts) - 2 for f in fs)


# bridge, tip, left/right wing, under the tip
wedge("nose", [V(0, -0.101, 1.702), V(0, -0.127, 1.655), V(-0.019, -0.098, 1.648), V(0.019, -0.098, 1.648),
               V(0, -0.106, 1.643), V(-0.008, -0.103, 1.700), V(0.008, -0.103, 1.700)],
      [(1, 2, 5, 0), (6, 3, 1, 0), (1, 4, 2), (3, 4, 1)])
for sx in (-1, 1):
    # front attach line, outer rim, back attach line (top, bottom each)
    pts = [V(sx * 0.074, 0.000, 1.702), V(sx * 0.072, 0.004, 1.640),
           V(sx * 0.090, 0.024, 1.698), V(sx * 0.084, 0.022, 1.645),
           V(sx * 0.068, 0.034, 1.700), V(sx * 0.066, 0.030, 1.648)]
    faces_idx = [(0, 2, 3, 1), (4, 5, 3, 2), (0, 4, 2), (1, 3, 5)]
    if sx < 0:
        faces_idx = [tuple(reversed(f)) for f in faces_idx]
    wedge(f"ear{sx}", pts, faces_idx)


def mid(p, q, t):
    return p.lerp(q, t)


# arms: upper / forearm from the hanging arms in the full-body photo, gloves as boxes
for s, crop_u, crop_f in (("r", (5, 660, 200, 1180), (20, 1180, 200, 1590)), ("l", (720, 660, 900, 1190), (780, 1190, 930, 1570))):
    sh, el, wr = J[s + "_sh"], J[s + "_el"], J[s + "_wr"]
    limb(f"{s}_upper", [sh - (el - sh) * 0.12, mid(sh, el, 0.15), mid(sh, el, 0.5), el],
         [(0.05, 0.05), (0.058, 0.056), (0.052, 0.054), (0.042, 0.042)], "body", crop_u, sides=8)
    limb(f"{s}_fore", [el, mid(el, wr, 0.3), wr], [(0.044, 0.044), (0.048, 0.044), (0.033, 0.03)], "body", crop_f, sides=8)
    d = (wr - el).normalized()
    crop = (95, 1620, 345, 1970) if s == "r" else (825, 1565, 985, 1890)
    limb(f"{s}_glove", [wr - d * 0.01, wr + d * 0.03, wr + d * 0.07, wr + d * 0.11],
         [(0.042, 0.038), (0.052, 0.046), (0.056, 0.05), (0.046, 0.04)], "body", crop, sides=6)

# legs
for s, ct, cs in (("r", (800, 1660, 465, 2380), (100, 2380, 330, 3060)), ("l", (465, 1660, 800, 2380), (470, 2380, 715, 3010))):
    hp, kn, an_ = J[s + "_hip"], J[s + "_knee"], J[s + "_ankle"]
    limb(f"{s}_thigh", [hp + V(0, 0, 0.04), mid(hp, kn, 0.3), mid(hp, kn, 0.7), kn],
         [(0.088, 0.09), (0.085, 0.088), (0.068, 0.07), (0.055, 0.055)], "body", ct, sides=8)
    limb(f"{s}_shin", [kn, mid(kn, an_, 0.25), mid(kn, an_, 0.6), an_],
         [(0.054, 0.056), (0.058, 0.066), (0.045, 0.048), (0.035, 0.037)], "body", cs, sides=8)
for s, ank, fwd in (("r", J["r_ankle"], V(0.25, -1, 0)), ("l", J["l_ankle"], V(0.35, -1, 0))):
    fwd.normalize()
    crop = (130, 3030, 335, 3320) if s == "r" else (455, 2990, 860, 3160)
    rings = [(ank + V(0, 0, -0.04) - fwd * 0.06, 0.04, 0.045, 0.0), (ank + V(0, 0, -0.05) + fwd * 0.08, 0.05, 0.045, 0.0),
             (ank + V(0, 0, -0.06) + fwd * 0.19, 0.035, 0.02, 0.0)]
    loft(f"{s}_foot", rings, 6, "body", crop, side_hint=V(0, 0, 1))

bm.to_mesh(mesh)
bm.free()
for m in slots:
    mesh.materials.append(m)
ob = bpy.data.objects.new("fighter", mesh)
sc.collection.objects.link(ob)

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
print(f"TRIS {tris}  VERTS {len(mesh.vertices)}")
for k, v in parts_tris.items():
    print(f"  {k}: {v}")

# ---------- floor, lights, camera ----------
bpy.ops.mesh.primitive_plane_add(size=6)
floor = bpy.context.object
fm = bpy.data.materials.new("floor")
fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.40, 0.36, 1)
floor.data.materials.append(fm)

world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.32, 0.33, 0.36, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
sc.collection.objects.link(sun)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.engine = "BLENDER_EEVEE"
sc.render.film_transparent = False
sc.view_settings.view_transform = "Standard"


TAG = "_clay" if a.clay else ""


def shoot(path, loc, target, lens, res=(720, 1000)):
    cam.location = loc
    cam.data.lens = lens
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


shoot(os.path.join(a.out, "lp_34" + TAG + ".png"), (1.6, -3.2, 1.4), (0, 0, 0.95), 50)
shoot(os.path.join(a.out, "lp_side" + TAG + ".png"), (4.0, -0.1, 1.3), (0, 0, 0.95), 50)
shoot(os.path.join(a.out, "lp_head" + TAG + ".png"), (0.35, -0.75, 1.72), (0, -0.02, 1.67), 60, res=(600, 600))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, "lowpoly_topuria" + TAG + ".blend"))
