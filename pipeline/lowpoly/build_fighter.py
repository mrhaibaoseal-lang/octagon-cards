"""Late-1990s PC game style low-poly fighter (trial, 2026-11-15, v2).

One generic hand-built clay mesh (~2,000-2,500 tris) in a fighting stance. Each arm is one continuous tube from inside the
shoulder to the mitten glove, each leg one tube from inside the hips to the ankle, so there are no joint creases; the torso
has shaped rings (traps, pecs, lats, spine groove). Colour comes later from paint_lowpoly.py (Gemini paints clay views,
projected back onto a UV atlas); this script only builds the shape and renders clay previews.

  blender -b -P pipeline/lowpoly/build_fighter.py -- <private dir> <out dir> [--clay]
  (--clay is accepted for old command lines; the output is always lowpoly_topuria_clay.blend)
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
ap.add_argument("--clay", action="store_true", help="kept for old command lines (always clay now)")
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

mesh = bpy.data.meshes.new("fighter")
bm = bmesh.new()
parts_tris = {}


def V(x, y, z):
    return Vector((x, y, z))


def ring_pts(c, L, F, w, d, n=2.0, sides=12, off=V(0, 0, 0), shape=None):
    """Superellipse ring (n=2 ellipse, larger = boxier). t=0 points along F; shape(t) adds (dL, dF) per vertex."""
    pts = []
    e = 2.0 / n
    for i in range(sides):
        t = 2 * math.pi * i / sides
        s, k = math.sin(t), math.cos(t)
        x = math.copysign(abs(s) ** e, s) * w
        y = math.copysign(abs(k) ** e, k) * d
        if shape:
            dx, dy = shape(t)
            x, y = x + dx, y + dy
        pts.append(c + off + L * x + F * y)
    return pts


def tube(name, rings, sides, hint, cap=(True, True), smooth=True):
    """rings: list of dicts {p, w, d, n?, off?, shape?} along a path. Ring planes follow the path tangent; the side axis
    L is parallel-transported from `hint` so the tube never twists. Returns ring vertex lists."""
    P = [r["p"] for r in rings]
    verts, L = [], None
    for i, r in enumerate(rings):
        if i == 0:
            t = (P[1] - P[0]).normalized()
        elif i == len(P) - 1:
            t = (P[-1] - P[-2]).normalized()
        else:
            t = ((P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()).normalized()
        base = hint if L is None else L
        L = (base - t * base.dot(t)).normalized()
        F = L.cross(t).normalized()
        pts = ring_pts(r["p"], L, F, r["w"], r["d"], r.get("n", 2.0), sides, r.get("off", V(0, 0, 0)), r.get("shape"))
        verts.append([bm.verts.new(p) for p in pts])
    faces = []
    for k in range(len(verts) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append(bm.faces.new((verts[k][i], verts[k][j], verts[k + 1][j], verts[k + 1][i])))
    if cap[0]:
        faces.append(bm.faces.new(list(reversed(verts[0]))))
    if cap[1]:
        faces.append(bm.faces.new(verts[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.smooth = smooth
    parts_tris[name] = sum(len(f.verts) - 2 for f in faces)
    return verts


def R(p, w, d, **kw):
    return dict(p=p, w=w, d=d, **kw)


def mid(p, q, t):
    return p.lerp(q, t)


# ---------- skeleton: orthodox fighting stance, facing -Y; model's right side is -X ----------
J = dict(
    r_hip=V(-0.10, 0.06, 0.92), r_knee=V(-0.16, 0.12, 0.50), r_ankle=V(-0.19, 0.24, 0.08),
    l_hip=V(0.10, -0.02, 0.92), l_knee=V(0.15, -0.14, 0.50), l_ankle=V(0.16, -0.20, 0.08),
    r_sh=V(-0.19, 0.03, 1.42), r_el=V(-0.25, -0.02, 1.17), r_wr=V(-0.14, -0.17, 1.37),
    l_sh=V(0.19, 0.00, 1.42), l_el=V(0.26, -0.12, 1.20), l_wr=V(0.16, -0.31, 1.39),
)
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)


# ---------- torso: crotch -> neck base, 16 sides ----------
def chest(pec, groove=0.006):
    """pec: forward bulge of the two pecs (peaks either side of the sternum); groove: spine dip at the back."""
    def f(t):
        s, k = math.sin(t), math.cos(t)
        dy = 0.0
        if k > 0:
            dy += pec * k * math.exp(-((abs(s) - 0.42) / 0.28) ** 2)
        else:
            dy -= groove * (-k) * math.exp(-(s / 0.2) ** 2)  # F points forward here: back dips toward the front
        return 0.0, dy
    return f


torso = [
    R(V(0, 0.02, 0.85), 0.085, 0.07),
    R(V(0, 0.02, 0.90), 0.172, 0.108, n=2.3),
    R(V(0, 0.02, 0.95), 0.184, 0.112, n=2.4),  # hips / shorts (wide enough to swallow the thigh tops)
    R(V(0, 0.018, 1.00), 0.168, 0.106, n=2.3),  # waistband
    R(V(0, 0.012, 1.06), 0.143, 0.096, n=2.2),  # waist
    R(V(0, 0.008, 1.13), 0.148, 0.100, n=2.2, shape=chest(0.0)),  # abs
    R(V(0, 0.005, 1.20), 0.163, 0.106, n=2.3, shape=chest(0.0, 0.008)),  # lats start
    R(V(0, 0.003, 1.26), 0.183, 0.112, n=2.4, shape=chest(0.006, 0.01)),  # pec underline
    R(V(0, 0.003, 1.32), 0.198, 0.114, n=2.4, shape=chest(0.020, 0.01)),  # pecs
    R(V(0, 0.006, 1.375), 0.205, 0.108, n=2.4, shape=chest(0.014, 0.008)),  # upper chest
    R(V(0, 0.012, 1.425), 0.192, 0.096, n=2.3, shape=chest(0.004, 0.004)),  # shoulder line
    R(V(0, 0.018, 1.462), 0.160, 0.084, n=2.2),  # trapezius slope
    R(V(0, 0.022, 1.492), 0.112, 0.070),
    R(V(0, 0.022, 1.512), 0.066, 0.060),  # neck base
]
tube("torso", torso, 16, X)

# ---------- neck + head (head sizes unchanged so the paint step's nose mask still fits) ----------
tube("neck", [R(V(0, 0.022, 1.48), 0.066, 0.062), R(V(0, 0.012, 1.53), 0.058, 0.058), R(V(0, 0.004, 1.585), 0.054, 0.055)],
     12, X, cap=(False, False))
head = [
    (1.552, -0.005, 0.026, 0.035, -0.045),  # chin tip
    (1.562, -0.004, 0.040, 0.052, -0.034),  # chin
    (1.574, -0.002, 0.054, 0.070, -0.022),  # jaw
    (1.600, 0.000, 0.066, 0.086, -0.012),  # mouth
    (1.635, 0.000, 0.074, 0.095, -0.006),  # nose base / cheeks
    (1.668, 0.000, 0.078, 0.099, -0.004),  # cheekbones
    (1.698, 0.000, 0.079, 0.101, -0.006),  # eyes / brow
    (1.735, 0.004, 0.077, 0.098, 0.0),  # forehead
    (1.765, 0.008, 0.068, 0.088, 0.0),  # upper skull
    (1.785, 0.011, 0.050, 0.065, 0.0),  # crown
    (1.795, 0.013, 0.024, 0.032, 0.0),
]
tube("head", [R(V(0, y, z), w, d, off=V(0, fo, 0)) for z, y, w, d, fo in head], 16, X)


def wedge(name, pts, faces_idx, centre):
    vs = [bm.verts.new(p) for p in pts]
    fs = []
    for idx in faces_idx:
        f = bm.faces.new([vs[i] for i in idx])
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - centre) < 0:  # must face away from the head's centre
            f.normal_flip()
        f.smooth = False
        fs.append(f)
    parts_tris[name] = sum(len(f.verts) - 2 for f in fs)


HC = V(0, 0.005, 1.67)
# nose: bridge, tip, wings, under the tip
wedge("nose", [V(0, -0.101, 1.702), V(0, -0.127, 1.655), V(-0.019, -0.098, 1.648), V(0.019, -0.098, 1.648),
               V(0, -0.106, 1.643), V(-0.008, -0.103, 1.700), V(0.008, -0.103, 1.700)],
      [(1, 2, 5, 0), (6, 3, 1, 0), (1, 4, 2), (3, 4, 1)], HC)
for sx in (-1, 1):
    pts = [V(sx * 0.075, 0.000, 1.702), V(sx * 0.073, 0.004, 1.640),
           V(sx * 0.091, 0.024, 1.698), V(sx * 0.085, 0.022, 1.645),
           V(sx * 0.069, 0.034, 1.700), V(sx * 0.067, 0.030, 1.648)]
    wedge(f"ear{sx}", pts, [(0, 2, 3, 1), (4, 5, 3, 2), (0, 4, 2), (1, 3, 5)], HC)


# ---------- arms: one tube from inside the trapezius to the end of the mitten glove ----------
def arm(s):
    sx = -1 if s == "r" else 1
    sh, el, wr = J[s + "_sh"], J[s + "_el"], J[s + "_wr"]
    up, fo = el - sh, wr - el
    d = fo.normalized()
    rings = [
        # the tube starts as a dome above the shoulder and runs straight down, so the deltoid is round, not a box corner
        R(sh + V(-sx * 0.012, 0.004, 0.058), 0.022, 0.026),  # top of the dome (inner half is inside the traps)
        R(sh + V(-sx * 0.004, 0.002, 0.040), 0.050, 0.055),
        R(sh + V(0, 0, 0.012), 0.062, 0.066),  # deltoid cap
        R(sh + up * 0.14, 0.064, 0.067),  # deltoid
        R(sh + up * 0.34, 0.056, 0.061, off=V(0, -0.004, 0)),  # deltoid insertion
        R(sh + up * 0.56, 0.052, 0.058, off=V(0, -0.008, 0)),  # biceps
        R(sh + up * 0.80, 0.043, 0.047),
        R(el + d * 0.004, 0.040, 0.044),  # elbow
        R(el + fo * 0.18, 0.047, 0.046),  # forearm muscle
        R(el + fo * 0.45, 0.043, 0.039),
        R(el + fo * 0.75, 0.035, 0.031),
        R(wr, 0.031, 0.028),  # wrist
        R(wr + d * 0.018, 0.043, 0.040),  # glove cuff
        R(wr + d * 0.050, 0.050, 0.047, n=2.3),  # back of the hand
        R(wr + d * 0.082, 0.054, 0.050, n=2.6),  # knuckles
        R(wr + d * 0.108, 0.047, 0.043, n=2.4),
        R(wr + d * 0.124, 0.028, 0.026),  # fist front
    ]
    tube(f"{s}_arm", rings, 12, X)
    # thumb: a short stub on the inner-upper side of the mitten
    inner = (-sx * X) - d * (-sx * X).dot(d)
    top = Z - d * Z.dot(d)
    side = (inner.normalized() * 0.75 + top.normalized() * 0.65).normalized()
    t0, t1, t2 = wr + d * 0.03 + side * 0.03, wr + d * 0.065 + side * 0.043, wr + d * 0.092 + side * 0.040
    tube(f"{s}_thumb", [R(t0, 0.016, 0.016), R(t1, 0.018, 0.017), R(t2, 0.012, 0.012)], 6, Z)


arm("r")
arm("l")


# ---------- legs: one tube from inside the hips to the ankle ----------
def leg(s):
    sx = -1 if s == "r" else 1
    hp, kn, an = J[s + "_hip"], J[s + "_knee"], J[s + "_ankle"]
    th, sh = kn - hp, an - kn
    rings = [
        R(hp + V(-sx * 0.025, 0, 0.09), 0.070, 0.075),  # buried in the hips
        R(hp + V(-sx * 0.005, 0, 0.02), 0.086, 0.092),  # top of the thigh
        R(hp + th * 0.25, 0.088, 0.092, off=V(0, -0.006, 0)),  # quads
        R(hp + th * 0.55, 0.074, 0.078, off=V(0, -0.004, 0)),
        R(hp + th * 0.82, 0.060, 0.060),
        R(kn, 0.052, 0.054, off=V(0, -0.004, 0)),  # knee
        R(kn + sh * 0.12, 0.053, 0.058, off=V(0, 0.006, 0)),
        R(kn + sh * 0.28, 0.057, 0.064, off=V(0, 0.014, 0)),  # calf
        R(kn + sh * 0.52, 0.047, 0.052, off=V(0, 0.008, 0)),
        R(kn + sh * 0.78, 0.037, 0.040),
        R(an, 0.034, 0.036),  # ankle
    ]
    tube(f"{s}_leg", rings, 10, X)


leg("r")
leg("l")

for s, fwd in (("r", V(0.25, -1, 0)), ("l", V(0.35, -1, 0))):
    an = J[s + "_ankle"]
    fwd.normalize()
    rings = [R(an + V(0, 0, -0.035) - fwd * 0.055, 0.038, 0.034),  # heel (w = vertical, d = across)
             R(an + V(0, 0, -0.03) + fwd * 0.01, 0.045, 0.043),
             R(an + V(0, 0, -0.045) + fwd * 0.09, 0.033, 0.046),
             R(an + V(0, 0, -0.053) + fwd * 0.15, 0.024, 0.043, n=2.4),  # ball of the foot
             R(an + V(0, 0, -0.058) + fwd * 0.19, 0.016, 0.032)]  # toes
    tube(f"{s}_foot", rings, 8, Z)

bm.to_mesh(mesh)
bm.free()
clay = bpy.data.materials.new("clay")
clay.use_nodes = True
bsdf = clay.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1)
bsdf.inputs["Roughness"].default_value = 0.9
mesh.materials.append(clay)
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


def shoot(path, loc, target, lens, res=(720, 1000)):
    cam.location = loc
    cam.data.lens = lens
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


shoot(os.path.join(a.out, "lp_34_clay.png"), (1.6, -3.2, 1.4), (0, 0, 0.95), 50)
shoot(os.path.join(a.out, "lp_side_clay.png"), (4.0, -0.1, 1.3), (0, 0, 0.95), 50)
shoot(os.path.join(a.out, "lp_back_clay.png"), (-1.6, 3.2, 1.4), (0, 0, 0.95), 50)
shoot(os.path.join(a.out, "lp_head_clay.png"), (0.35, -0.75, 1.72), (0, -0.02, 1.67), 60, res=(600, 600))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, "lowpoly_topuria_clay.blend"))
