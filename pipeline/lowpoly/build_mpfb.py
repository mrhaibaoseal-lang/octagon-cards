"""Low-poly fighter from MPFB (MakeHuman) instead of hand-built tubes (trial, 2026-11-15, v3).

One shared body per body-type preset: MPFB human with MPFB's own generic head (eyeballs kept, other helpers dropped),
hands replaced by boxy MMA gloves, decimated in the symmetric rest pose (face, hands and shoulders keep more faces),
then posed in build_fighter.py's orthodox stance (left foot forward, hands guarding the face, facing -Y) and frozen
into one mesh called `fighter`. One clay .blend per triangle count, clay previews; mpfb_sheet.py makes the comparison.

  blender -b -P pipeline/lowpoly/build_mpfb.py -- <out dir> [--preset feather_muscle] [--tris 3000,5000] [--keep 3]

Out: <out>/mpfb_<preset>_<tris>.blend (object `fighter`, camera kept for paint_blender's render mode),
     <out>/mpfb_<preset>_<tris>_{34,side,back,head}.png, <out>/mpfb_<preset>_meta.json (head_z, nose, height).
Body types are only data: add an entry to PRESETS. A --tris larger than the mesh skips decimation (full detail).
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--preset", default="feather_muscle")
ap.add_argument("--tris", default="3000,5000")
ap.add_argument("--keep", type=float, default=3.0, help="how strongly face, gloves and shoulders resist decimation (0 = even)")
a = ap.parse_args(argv)
a.out = os.path.abspath(a.out)
os.makedirs(a.out, exist_ok=True)

# height cm, weight lb, muscle macro, bulk = extra muscle targets (list as in pipeline/model3d/base_body.py),
# weight_add on top of the BMI-based weight macro, proportions (MakeHuman: higher = longer legs), extra targets, glove half sizes
PRESETS = {
    "feather_muscle": {"height": 170, "weight": 145, "muscle": 1.0, "bulk": 1.0, "weight_add": 0.12, "proportions": 0.45,
                       "targets": {"neck/measure-neck-circ-incr": 0.5, "torso/measure-shoulder-dist-incr": 0.3}},  # Topuria-like
    "light_lean": {"height": 178, "weight": 155, "muscle": 0.9, "bulk": 0.5},
    "middle": {"height": 185, "weight": 185, "muscle": 1.0, "bulk": 0.8, "weight_add": 0.05},
    "heavy": {"height": 193, "weight": 250, "muscle": 0.8, "bulk": 0.6, "targets": {"stomach/stomach-pregnant-incr": 0.4}},
}
P = {"glove": (0.06, 0.052, 0.046), "weight_add": 0.0, "proportions": 0.8, "targets": {}, **PRESETS[a.preset]}

BULK_TARGETS = {
    "torso/torso-muscle-pectoral-incr": 0.7, "torso/torso-muscle-dorsi-incr": 0.6,
    "torso/measure-shoulder-dist-incr": 0.3, "torso/torso-scale-depth-incr": 0.15,
    "stomach/stomach-tone-incr": 1.0,
    "arms/l-upperarm-muscle-incr": 0.7, "arms/r-upperarm-muscle-incr": 0.7,
    "arms/l-upperarm-shoulder-muscle-incr": 0.5, "arms/r-upperarm-shoulder-muscle-incr": 0.5,
    "arms/l-lowerarm-muscle-incr": 0.85, "arms/r-lowerarm-muscle-incr": 0.85,
    "arms/l-lowerarm-scale-horiz-incr": 0.5, "arms/r-lowerarm-scale-horiz-incr": 0.5,
    "arms/l-lowerarm-scale-depth-incr": 0.45, "arms/r-lowerarm-scale-depth-incr": 0.45,
    "hands/measure-wrist-circ-incr": 0.5,
    "legs/l-upperleg-muscle-incr": 0.6, "legs/r-upperleg-muscle-incr": 0.6,
    "legs/l-lowerleg-muscle-incr": 0.5, "legs/r-lowerleg-muscle-incr": 0.5,
    "neck/measure-neck-circ-incr": 0.5,
    "stomach/stomach-pregnant-incr": 0.3, "torso/measure-waist-circ-incr": 0.35,  # no hollow under the ribs
}

# Stance as directions (from build_fighter.py's joints; facing -Y, character's left = +X), so it fits any height.
STANCE = {
    "hips_turn": -22.0, "chest_turn": -8.0, "head_turn": 26.0, "head_tilt": 6.0, "lean": 6.0,
    "LeftArm": (0.07, -0.12, -0.22), "LeftForeArm": (-0.10, -0.19, 0.19),
    "RightArm": (-0.06, -0.05, -0.25), "RightForeArm": (0.11, -0.15, 0.20),
    "LeftUpLeg": (0.07, -0.20, -0.40), "LeftLeg": (0.02, 0.03, -0.42),
    "RightUpLeg": (-0.09, 0.10, -0.40), "RightLeg": (-0.04, 0.20, -0.40),
    "LeftFoot": (0.03, -1.0, 0.0), "RightFoot": (-0.45, -0.8, 0.0),
}


def sgnpow(x, e):
    return math.copysign(abs(x) ** e, x)


def build(n_tris):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    from bl_ext.blender_org.mpfb.services.humanservice import HumanService
    from bl_ext.blender_org.mpfb.services.targetservice import TargetService

    bmi = (P["weight"] * 0.4536) / ((P["height"] / 100) ** 2)
    macro = {
        "gender": 1.0, "age": 0.45, "muscle": P["muscle"],
        "weight": max(0.35, min(0.95, 0.6 + (bmi - 23.0) * 0.04 + P["weight_add"])),
        "proportions": P["proportions"], "height": 0.5, "cupsize": 0.5, "firmness": 0.6,
        "race": {"asian": 0.2, "caucasian": 0.6, "african": 0.2},
    }
    body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    tdir = os.path.join(os.path.dirname(sys.modules[HumanService.__module__].__file__), "..", "data", "targets")
    extra = {t: w * P["bulk"] for t, w in BULK_TARGETS.items()}
    for t, w in P["targets"].items():
        extra[t] = extra.get(t, 0.0) + w
    for t, w in extra.items():
        TargetService.load_target(body, os.path.abspath(os.path.join(tdir, t + ".target.gz")), weight=min(1.0, w))
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    if body.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    vg = body.vertex_groups
    bg = vg["body"].index
    zs = [v.co.z for v in body.data.vertices if any(e.group == bg and e.weight > 0.5 for e in v.groups)]
    k = (P["height"] / 100.0) / (max(zs) - min(zs))
    body.scale = (k, k, k)
    bpy.ops.object.transform_apply(scale=True)

    HumanService.add_builtin_rig(body, "mixamo", import_weights=True)  # needs the joint-cube helpers still in the mesh
    rig = body.parent if body.parent and body.parent.type == "ARMATURE" else next(o for o in bpy.data.objects if o.type == "ARMATURE")
    RW = rig.matrix_world.to_3x3()
    bpy.context.view_layer.objects.active = body

    def pb(n):
        return rig.pose.bones["mixamorig:" + n]

    def center(group):
        g = vg[group].index
        pts = [v.co.copy() for v in body.data.vertices if any(e.group == g and e.weight > 0.5 for e in v.groups)]
        return sum(pts, Vector()) / len(pts)

    # rest-pose joint places for the keep weights (joint cubes are helpers, read them before they go)
    JC = {n: center("joint-" + n) for n in ("head", "head-2", "mouth", "l-hand", "r-hand", "l-shoulder", "r-shoulder", "l-eye", "r-eye")}

    # Keep skin and the two eyeballs (they fill the eye holes); drop other helpers and both hands.
    keep_g = {vg["body"].index, vg["helper-l-eye"].index, vg["helper-r-eye"].index}
    hand_g = {g.index for g in vg if g.name.startswith(("mixamorig:LeftHand", "mixamorig:RightHand"))}
    bm = bmesh.new()
    bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.verify()
    drop = [v for v in bm.verts if not any(g in keep_g and w > 0.5 for g, w in v[dl].items())
            or sum(w for g, w in v[dl].items() if g in hand_g) > 0.5]
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    # Close the mouth: drop the mouth cavity behind the lips (teeth and tongue are already gone) and fill the slit flat,
    # so nothing inside the head needs texture. (Not what fixed the beak-like mouth; that was the keep weights below.)
    lg = vg["lips"].index
    bm.verts.ensure_lookup_table()
    lip = [v.co for v in bm.verts if lg in v[dl]]
    lx = max(abs(c.x) for c in lip)
    lz0, lz1 = min(c.z for c in lip), max(c.z for c in lip)
    lback = max(c.y for c in lip)
    cav = [v for v in bm.verts if lg not in v[dl] and abs(v.co.x) < lx and lz0 < v.co.z < lz1
           and lback < v.co.y < JC["mouth"].y + 0.04]
    bmesh.ops.delete(bm, geom=cav, context="VERTS")
    rim = [e for e in bm.edges if e.is_boundary and all(abs(v.co.x) <= lx + 1e-4 and lz0 - 0.01 < v.co.z < lz1 + 0.01
                                                         and v.co.y < JC["mouth"].y + 0.04 for v in e.verts)]
    bmesh.ops.holes_fill(bm, edges=rim, sides=0)
    print("mouth: removed", len(cav), "cavity verts, filled rim of", len(rim), "edges")
    bm.to_mesh(body.data)
    bm.free()
    for m in list(body.modifiers):
        if m.type == "MASK":
            body.modifiers.remove(m)

    # keep weights (0-1): what reads as a face gets most: lips, nose, eye rims; the rest of the face front less; ears little and
    # eyeballs nothing (their folds would eat the budget and the mouth collapses into a beak); wrists and shoulders a little.
    head_r = (JC["head"] + JC["head-2"]) / 2
    gidx = {n: vg[n].index for n in ("lips", "ears", "helper-l-eye", "helper-r-eye")}
    lip_c = sum((v.co for v in body.data.vertices if any(e.group == gidx["lips"] for e in v.groups)), Vector())
    lip_c /= sum(1 for v in body.data.vertices if any(e.group == gidx["lips"] for e in v.groups))
    face = [v.co for v in body.data.vertices if abs(v.co.x) < 0.01 and lip_c.z < v.co.z < (JC["l-eye"].z + lip_c.z) / 2 + 0.03]
    nose_c = min(face, key=lambda c: c.y)
    spots = [  # centre, radius, weight
        (lip_c, 0.045, 1.0), (nose_c, 0.035, 1.0), (JC["l-eye"], 0.04, 0.8), (JC["r-eye"], 0.04, 0.8),
        (lip_c + Vector((0, 0, -0.04)), 0.04, 0.7),  # chin
        (head_r, 0.13, 0.35), (JC["l-hand"], 0.07, 0.4), (JC["r-hand"], 0.07, 0.4),
        (JC["l-shoulder"], 0.10, 0.4), (JC["r-shoulder"], 0.10, 0.4)]
    fixed = {gidx["ears"]: 0.3, gidx["helper-l-eye"]: 0.0, gidx["helper-r-eye"]: 0.0}  # ears keep a flap, not their folds
    keep = vg.new(name="keep")
    for v in body.data.vertices:
        f = [fixed[e.group] for e in v.groups if e.group in fixed and e.weight > 0.5]
        if f:
            if f[0] > 0:
                keep.add([v.index], f[0], "REPLACE")
            continue
        w = max(wt * min(1.0, 2.0 * max(0.0, 1.0 - (v.co - c).length / r)) for c, r, wt in spots)
        if w > 0:
            keep.add([v.index], w, "REPLACE")

    # Decimate in the symmetric rest pose (the gloves are added later and are low-poly already).
    glove_tris = 2 * (10 * 5 * 2 + 20 + 16)
    full = sum(len(p.vertices) - 2 for p in body.data.polygons)
    if n_tris - glove_tris < full:
        body.modifiers.new("tri", "TRIANGULATE")
        bpy.ops.object.modifier_move_to_index(modifier="tri", index=0)
        bpy.ops.object.modifier_apply(modifier="tri")
        d = body.modifiers.new("dec", "DECIMATE")
        d.decimate_type = "COLLAPSE"
        d.ratio = (n_tris - glove_tris) / len(body.data.polygons)
        d.use_symmetry, d.symmetry_axis = True, "X"
        d.use_collapse_triangulate = True
        if a.keep > 0:
            d.vertex_group, d.invert_vertex_group, d.vertex_group_factor = "keep", True, a.keep
        bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
        bpy.ops.object.modifier_apply(modifier="dec")

    # ---------- pose ----------
    def rot_world(name, R):
        b = pb(name)
        Ra = RW.inverted() @ R @ RW
        M = b.matrix.copy()
        t = M.translation.copy()
        b.matrix = Matrix.Translation(t) @ Ra.to_4x4() @ Matrix.Translation(-t) @ M
        bpy.context.view_layer.update()

    def aim(name, d):
        b = pb(name)
        cur = (RW @ (b.tail - b.head)).normalized()
        rot_world(name, cur.rotation_difference(Vector(d).normalized()).to_matrix())

    def turn(name, deg, axis=(0, 0, 1)):
        rot_world(name, Matrix.Rotation(math.radians(deg), 3, Vector(axis)))

    turn("Hips", STANCE["hips_turn"])
    turn("Spine1", STANCE["chest_turn"])
    turn("Spine", STANCE["lean"], (1, 0, 0))
    for nm in ("LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm"):
        aim(nm, STANCE[nm])
    for nm in ("LeftFoot", "RightFoot"):  # flat foot pointing along the given direction
        b = pb(nm)
        cur = RW @ (b.tail - b.head)
        flat = Vector((cur.x, cur.y, 0)).normalized()
        rot_world(nm, flat.rotation_difference(Vector(STANCE[nm]).normalized()).to_matrix())
        cur = (RW @ (b.tail - b.head)).normalized()
        rot_world(nm, cur.rotation_difference(Vector((cur.x, cur.y, -0.35)).normalized()).to_matrix())
    turn("Neck", STANCE["head_turn"] * 0.4)
    turn("Head", STANCE["head_turn"] * 0.6)
    turn("Head", STANCE["head_tilt"], (1, 0, 0))
    for s_ in ("Left", "Right"):  # wrist straight along the forearm
        fa = (RW @ (pb(s_ + "ForeArm").tail - pb(s_ + "ForeArm").head)).normalized()
        cur = (RW @ (pb(s_ + "Hand").tail - pb(s_ + "Hand").head)).normalized()
        rot_world(s_ + "Hand", cur.rotation_difference(fa).to_matrix())
    GLOVE = []
    for s_ in ("Left", "Right"):
        h = pb(s_ + "Hand")
        fwd = (RW @ (pb(s_ + "HandMiddle1").head - h.head)).normalized()
        side = RW @ (pb(s_ + "HandIndex1").head - pb(s_ + "HandPinky1").head)
        GLOVE.append((rig.matrix_world @ h.head, fwd, (side - fwd * side.dot(fwd)).normalized()))
    hb = pb("Head")
    head_c = rig.matrix_world @ ((hb.head + hb.tail) / 2)
    neck_z = (rig.matrix_world @ pb("Neck").head).z

    bpy.context.view_layer.update()
    for m in list(body.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
    mw = body.matrix_world.copy()
    body.parent = None
    body.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.data.objects.remove(rig, do_unlink=True)

    # ---------- gloves: boxy superellipsoid fist + short wrist cuff, part of the same mesh ----------
    bm = bmesh.new()
    bm.from_mesh(body.data)
    new_faces = []
    for wrist, fwd, side in GLOVE:
        up = fwd.cross(side).normalized()
        ax, sx, ux = P["glove"]
        c = wrist + fwd * (ax + 0.01)
        nu, nv = 10, 7
        rows = []
        for i in range(1, nv):
            v = -math.pi / 2 + math.pi * i / nv
            rows.append([bm.verts.new(c + fwd * (ax * sgnpow(math.sin(v), 0.6))
                                      + side * (sx * sgnpow(math.cos(v), 0.6) * sgnpow(math.cos(2 * math.pi * j / nu), 0.6))
                                      + up * (ux * sgnpow(math.cos(v), 0.6) * sgnpow(math.sin(2 * math.pi * j / nu), 0.6)))
                         for j in range(nu)])
        for r0, r1 in zip(rows, rows[1:]):
            for j in range(nu):
                new_faces.append(bm.faces.new((r0[j], r0[(j + 1) % nu], r1[(j + 1) % nu], r1[j])))
        back, front = bm.verts.new(c - fwd * ax), bm.verts.new(c + fwd * ax)
        for j in range(nu):
            new_faces.append(bm.faces.new((back, rows[0][(j + 1) % nu], rows[0][j])))
            new_faces.append(bm.faces.new((front, rows[-1][j], rows[-1][(j + 1) % nu])))
        ring = [[bm.verts.new(wrist + fwd * t + side * (r * math.cos(2 * math.pi * j / 8)) + up * (r * 0.85 * math.sin(2 * math.pi * j / 8)))
                 for j in range(8)] for t, r in ((-0.05, 0.042), (0.02, 0.046))]
        for j in range(8):
            new_faces.append(bm.faces.new((ring[0][j], ring[0][(j + 1) % 8], ring[1][(j + 1) % 8], ring[1][j])))
    bmesh.ops.recalc_face_normals(bm, faces=new_faces)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(body.data)
    bm.free()

    z0 = min(v.co.z for v in body.data.vertices)
    for v in body.data.vertices:
        v.co.z -= z0
    head_c.z -= z0
    neck_z -= z0
    for p in body.data.polygons:
        p.use_smooth = False
    body.name = body.data.name = "fighter"
    tris = len(body.data.polygons)

    vs = [v.co for v in body.data.vertices]
    face_vs = [c for c in vs if (c - head_c).length < 0.14 and abs(c.x - head_c.x) < 0.04 and c.z > neck_z + 0.05]
    nose = min(face_vs, key=lambda c: c.y)
    meta = {"preset": a.preset, "height": max(c.z for c in vs), "head_z": neck_z + 0.02,
            "nose": {"center": list(nose), "half": [0.03, 0.035]}, "head_center": list(head_c)}

    # ---------- clay previews (workbench studio light, like paint_blender's views) ----------
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light, sh.color_type, sh.single_color = "STUDIO", "SINGLE", (0.72, 0.70, 0.68)
    sh.background_type, sh.background_color = "VIEWPORT", (0.2, 0.2, 0.22)
    sc.view_settings.view_transform = "Standard"
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    mid_z = meta["height"] * 0.52
    tag = os.path.join(a.out, f"mpfb_{a.preset}_{n_tris}")

    def shoot(path, loc, target, lens, res=(720, 1000)):
        cam.location = loc
        cam_d.lens = lens
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    hc = head_c
    shoot(tag + "_34.png", (1.5, -3.0, 1.3), (0, 0, mid_z), 50)
    shoot(tag + "_side.png", (3.8, -0.1, 1.2), (0, 0, mid_z), 50)
    shoot(tag + "_back.png", (-1.5, 3.0, 1.3), (0, 0, mid_z), 50)
    shoot(tag + "_head.png", (hc.x + 0.32, hc.y - 0.62, hc.z + 0.04), (hc.x, hc.y - 0.03, hc.z - 0.01), 60, res=(600, 600))
    bpy.ops.wm.save_as_mainfile(filepath=tag + ".blend")
    face = sum(1 for p in body.data.polygons if (p.center - head_c).length < 0.12 and p.center.y < head_c.y)
    print(f"TRIS {n_tris}: {tris}, face front {face}")
    return meta


for n in [int(x) for x in a.tris.split(",")]:
    meta = build(n)
json.dump(meta, open(os.path.join(a.out, f"mpfb_{a.preset}_meta.json"), "w"), indent=1)
print("meta", meta)
