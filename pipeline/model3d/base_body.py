"""Build the shared fighter body (MPFB human + Mixamo skeleton) and render the mannequin guide sheet.

Run inside Blender (MPFB extension must be installed and enabled):
  blender -b -P pipeline/model3d/base_body.py -- --out <dir> [--height 170] [--weight 145]

Writes into <dir>:
  base_body.blend   the body, rigged, in MakeHuman's A pose
  guide_sheet.png   four views side by side on pure green, for Gemini to paint the fighter over
  guide_views.json  each view's camera, so the painted sheet can be projected back onto the body
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preset", help="weight-class mannequin from body_presets.json (e.g. lightweight, heavyweight_belly)")
ap.add_argument("--height", type=float, help="cm (default: preset's, else 175)")
ap.add_argument("--weight", type=float, help="lb fight weight (default: preset's, else 170)")
ap.add_argument("--arm-back", type=float, default=25.0, help="degrees the arms swing back, so three-quarter views do not see them across the torso")
ap.add_argument("--arm-raise", type=float, default=28.0, help="degrees the arms are lifted from the A pose")
ap.add_argument("--leg-spread", type=float, default=6.0, help="degrees each leg is opened")
ap.add_argument("--bulk", type=float, help="0-1 (default: preset's, else 0): extra muscle targets (chest, lats, abs, shoulders, arms, legs, neck) on top of the macros")
ap.add_argument("--targets", default="", help="extra MPFB targets, e.g. stomach/stomach-pregnant-incr=0.3,torso/torso-vshape-decr=0.2")
ap.add_argument("--view-px", type=int, default=640, help="pixel width of one view; height is 1.35x")
args = ap.parse_args(argv)
preset = {}
if args.preset:
    presets = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "body_presets.json"), encoding="utf-8"))
    preset = presets[args.preset]
args.height = args.height if args.height is not None else preset.get("height", 175.0)
args.weight = args.weight if args.weight is not None else preset.get("weight", 170.0)
args.bulk = args.bulk if args.bulk is not None else preset.get("bulk", 0.0)
args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
ARM_RAISE, ARM_BACK, LEG_SPREAD = args.arm_raise, args.arm_back, args.leg_spread

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402

# Start from an empty scene.
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

# A lean, muscular adult male. Weight macro follows BMI so heavier classes look thicker.
bmi = (args.weight * 0.4536) / ((args.height / 100) ** 2)
weight_macro = preset.get("weight_macro", max(0.35, min(0.85, 0.6 + (bmi - 23.0) * 0.04)))
macro = {
    "gender": 1.0, "age": 0.45, "muscle": preset.get("muscle", 1.0), "weight": weight_macro,
    "proportions": 0.8, "height": 0.5, "cupsize": 0.5, "firmness": 0.6,
    "race": {"asian": 0.2, "caucasian": 0.6, "african": 0.2},
}
body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
body.name = "Body"

# Extra muscle on top of MakeHuman's macros (muscle is already at its maximum there). Weights are at bulk=1.
BULK_TARGETS = {
    "torso/torso-muscle-pectoral-incr": 0.7, "torso/torso-muscle-dorsi-incr": 0.6,
    "torso/measure-shoulder-dist-incr": 0.3, "torso/torso-scale-depth-incr": 0.15,
    "stomach/stomach-tone-incr": 1.0,
    "arms/l-upperarm-muscle-incr": 0.7, "arms/r-upperarm-muscle-incr": 0.7,
    "arms/l-upperarm-shoulder-muscle-incr": 0.7, "arms/r-upperarm-shoulder-muscle-incr": 0.7,
    "arms/l-lowerarm-muscle-incr": 0.5, "arms/r-lowerarm-muscle-incr": 0.5,
    "legs/l-upperleg-muscle-incr": 0.6, "legs/r-upperleg-muscle-incr": 0.6,
    "legs/l-lowerleg-muscle-incr": 0.5, "legs/r-lowerleg-muscle-incr": 0.5,
    "neck/measure-neck-circ-incr": 0.5,
}
# The base mesh's belly sits well behind the chest, so a muscular body looks hollow under the ribs (user, 2026-11-08):
# fill the stomach and waist so the side profile runs straight from chest to belt. No V-shape widening for the same reason.
TORSO_FILL = {"stomach/stomach-pregnant-incr": 0.3, "torso/measure-waist-circ-incr": 0.35}
extra = {t: w * args.bulk for t, w in BULK_TARGETS.items()} if args.bulk > 0 else {}
if args.bulk > 0:
    extra.update(TORSO_FILL)
for t, w in list(preset.get("targets", {}).items()) + [(kv.split("=")[0], float(kv.split("=")[1])) for kv in args.targets.split(",") if kv]:
    extra[t] = extra.get(t, 0.0) + w
if extra:
    from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402
    tdir = os.path.join(os.path.dirname(sys.modules[HumanService.__module__].__file__), "..", "data", "targets")
    for t, w in extra.items():
        TargetService.load_target(body, os.path.abspath(os.path.join(tdir, t + ".target.gz")), weight=min(1.0, w))

# Scale to the real height in metres.
zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
cur_h = max(zs) - min(zs)
k = (args.height / 100.0) / cur_h
body.scale = (k, k, k)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(scale=True)

HumanService.add_builtin_rig(body, "mixamo", import_weights=True)
rig = body.parent if body.parent and body.parent.type == "ARMATURE" else next(o for o in bpy.data.objects if o.type == "ARMATURE")

# ---- Eyeballs: the base mesh only has sockets. Place spheres at MakeHuman's eye helper points. ----
mask_mods = [m for m in body.modifiers if m.type == "MASK"]
for m in mask_mods:
    m.show_viewport = False
bpy.context.view_layer.update()
ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
ev_co = [body.matrix_world @ v.co for v in ev.data.vertices]
for m in mask_mods:
    m.show_viewport = True


def group_points(name):
    gi = body.vertex_groups[name].index
    return [ev_co[v.index] for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]


def eye_material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


white = eye_material("EyeWhite", (0.85, 0.83, 0.80), 0.3)
iris = eye_material("EyeIris", (0.10, 0.06, 0.035), 0.2)
for side, bone in (("l", "mixamorig:LeftEye"), ("r", "mixamorig:RightEye")):
    pts = group_points(f"helper-{side}-eye")
    c = sum(pts, Vector()) / len(pts)
    r = max((p - c).length for p in pts) * 0.95
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=r, location=c)
    ball = bpy.context.active_object
    ball.name = f"Eye_{side}"
    ball.data.materials.append(white)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=r * 0.48, location=c + Vector((0, -r * 0.86, 0)))
    dot = bpy.context.active_object
    dot.name = f"Iris_{side}"
    dot.scale = (1, 0.35, 1)
    dot.data.materials.append(iris)
    for o in (ball, dot):
        o.parent = rig
        o.parent_type = "BONE"
        o.parent_bone = bone if bone in rig.data.bones else "mixamorig:Head"
        o.matrix_parent_inverse = (rig.matrix_world @ rig.pose.bones[o.parent_bone].matrix @ __import__("mathutils").Matrix.Translation((0, rig.data.bones[o.parent_bone].length, 0))).inverted()
bpy.ops.object.select_all(action="DESELECT")

# ---- Guide pose: arms raised clear of the torso, legs apart, so every body area is seen by some view. ----
# Symmetric on purpose: the left three-quarter view is then an exact mirror of the right one.
from mathutils import Matrix, Quaternion  # noqa: E402


def rotate_world(bone_name, axis, deg):
    pb = rig.pose.bones[bone_name]
    rest = (rig.matrix_world.to_3x3() @ pb.bone.matrix_local.to_3x3())
    q = (rest.inverted() @ Quaternion(axis, math.radians(deg)).to_matrix() @ rest).to_quaternion()
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = q @ pb.rotation_quaternion


# MakeHuman faces -Y, so the character's left side is +X. Negative angles about +Y lift the left limbs outward.
rotate_world("mixamorig:LeftArm", (0, 1, 0), -ARM_RAISE)
rotate_world("mixamorig:RightArm", (0, 1, 0), ARM_RAISE)
rotate_world("mixamorig:LeftArm", (0, 0, 1), ARM_BACK)  # +Z turns the left arm toward +Y (behind)
rotate_world("mixamorig:RightArm", (0, 0, 1), -ARM_BACK)
rotate_world("mixamorig:LeftUpLeg", (0, 1, 0), -LEG_SPREAD)
rotate_world("mixamorig:RightUpLeg", (0, 1, 0), LEG_SPREAD)
bpy.context.view_layer.update()

# Plain clay material, like the existing mannequin sheet.
mat = bpy.data.materials.new("Clay")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.62, 0.62, 0.64, 1)
bsdf.inputs["Roughness"].default_value = 0.6
body.data.materials.clear()
body.data.materials.append(mat)

# ---- Guide renders ----
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "SINGLE"
sh.single_color = (0.62, 0.62, 0.64)
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_object_outline = True
sh.object_outline_color = (0.05, 0.05, 0.05)
sh.background_type = "VIEWPORT"
sh.background_color = (0.0, 1.0, 0.0)
scene.view_settings.view_transform = "Standard"
w = args.view_px
h = int(w * 1.35)
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100

# MakeHuman faces -Y. Game fighters face screen-right, so the main view looks at the body's left side,
# turned 35 degrees toward the front (three-quarter view). Angles are camera yaw around the body.
# (name, yaw, elevation, mirror_of). Mirrored views are not sent to Gemini: the body and pose are symmetric,
# so the bake flips the painted source view instead. Raised three-quarter cameras also see the crown of the head.
VIEWS = [
    ("front", 0.0, 0.0, None),
    ("three_quarter_right", -55.0, 15.0, None),  # body faces right, chest turned toward camera
    ("back", 180.0, 0.0, None),
    ("three_quarter_left", 55.0, 15.0, "three_quarter_right"),  # covers the body's right flank
]
height_m = args.height / 100.0
center = Vector((0, 0, height_m * 0.5))
cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = height_m * 1.12
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# Fit one ortho scale to every view so no limb leaves the frame (all views share the same scale).
_ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
_pts = [body.matrix_world @ v.co for v in _ev.vertices]
body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
need = 0.0
for _n, yaw, elev, _m in VIEWS:
    a, e = math.radians(yaw), math.radians(elev)
    rot = __import__("mathutils").Euler((math.radians(90) - e, 0, a)).to_matrix()
    rx, uy = rot.col[0], rot.col[1]
    xs = [(p - center).dot(rx) for p in _pts]
    ys = [(p - center).dot(uy) for p in _pts]
    need = max(need, 2 * max(abs(min(ys)), abs(max(ys))) * 1.06, 2 * max(abs(min(xs)), abs(max(xs))) * 1.06 * h / w)
cam_data.ortho_scale = need
views_meta = []
paths = []
for name, yaw, elev, mirror_of in VIEWS:
    a, e = math.radians(yaw), math.radians(elev)
    # Camera sits on a sphere around the body (front = -Y), turned by yaw and raised by elevation.
    pos = center + Vector((math.sin(a) * math.cos(e) * 5.0, -math.cos(a) * math.cos(e) * 5.0, math.sin(e) * 5.0))
    cam.location = pos
    cam.rotation_euler = (math.radians(90) - e, 0, a)
    bpy.context.view_layer.update()
    p = os.path.join(args.out, f"guide_{name}.png")
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    paths.append(p)
    views_meta.append({
        "name": name, "yaw_deg": yaw, "elevation_deg": elev, "mirror_of": mirror_of, "location": list(cam.location), "rotation_euler": list(cam.rotation_euler),
        "ortho_scale": cam_data.ortho_scale, "px": [w, h],
    })

# Stitch the non-mirrored views into one sheet with a gap so Gemini keeps them separate.
gap = w // 4
sheet_views = [i for i, v in enumerate(views_meta) if not v["mirror_of"]]
sheet_w = w * len(sheet_views) + gap * (len(sheet_views) + 1)
sheet = bpy.data.images.new("sheet", sheet_w, h, alpha=False)
pix = [0.0, 1.0, 0.0, 1.0] * (sheet_w * h)
for slot, i in enumerate(sheet_views):
    img = bpy.data.images.load(paths[i])
    src = list(img.pixels)
    x0 = gap + slot * (w + gap)
    views_meta[i]["sheet_x"] = x0
    for y in range(h):
        row = src[y * w * 4:(y + 1) * w * 4]
        start = (y * sheet_w + x0) * 4
        pix[start:start + w * 4] = row
sheet.pixels = pix
sheet.filepath_raw = os.path.join(args.out, "guide_sheet.png")
sheet.file_format = "PNG"
sheet.save()

with open(os.path.join(args.out, "guide_views.json"), "w", encoding="utf-8") as f:
    json.dump({"preset": args.preset, "bulk": args.bulk, "height_cm": args.height, "weight_lb": args.weight, "sheet_px": [sheet_w, h], "gap": gap, "views": views_meta}, f, indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "base_body.blend"))
print("DONE", os.path.join(args.out, "guide_sheet.png"))
