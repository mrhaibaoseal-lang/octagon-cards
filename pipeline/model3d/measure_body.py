"""Measure a mannequin's proportions (Blender script), to compare with real people and with other mannequins.

  blender -b <dir>/base_body.blend -P pipeline/model3d/measure_body.py -- [--json out.json]

The pose is reset to MakeHuman's A pose (arms hang slightly out). Prints metres and ratios of the height:
  head_h       top of the skull to the underside of the chin   (real men: about 0.23 m, 12.4-13.4 % of height)
  head_w       widest point of the head (ears excluded by taking the temple band)
  shoulder_w   bi-deltoid width at the shoulder joint height   (fit men about 0.26-0.28 H, bodybuilders up to 0.31 H)
  acromion_w   distance between the two shoulder joints (bones)
  chest_w/_d   ribcage width / depth at nipple height, arm vertices excluded
  waist_w, hip_w, thigh_w (one leg, 10 cm below the crotch), calf_w (one leg, at 28 % of the height)
  neck_w       neck width just under the chin
"""
import json
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_json = argv[argv.index("--json") + 1] if "--json" in argv else None

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = bpy.data.objects["Body"]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
# Let the upper arms hang straight down (like a standing photo), so the shoulder width is the real bi-deltoid width.
from mathutils import Quaternion  # noqa: E402

for bn in ("mixamorig:LeftArm", "mixamorig:RightArm"):
    pb = rig.pose.bones[bn]
    d = (rig.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()
    q_world = d.rotation_difference(Vector((0, 0, -1)))
    rest = rig.matrix_world.to_3x3() @ pb.bone.matrix_local.to_3x3()
    pb.rotation_quaternion = (rest.inverted() @ q_world.to_matrix() @ rest).to_quaternion()
bpy.context.view_layer.update()
mask_mods = [m for m in body.modifiers if m.type == "MASK"]
for m in mask_mods:  # keep every vertex so indices match the vertex groups
    m.show_viewport = False
bpy.context.view_layer.update()
ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
mesh = ev.to_mesh()
mw = body.matrix_world
gnames = {g.index: g.name for g in body.vertex_groups}
P, dom = [], []
for v in body.data.vertices:  # only vertices weighted to the skeleton: helper geometry (teeth, genitals, joint cubes...) is skipped
    ws = [(g.weight, gnames[g.group]) for g in v.groups if gnames[g.group].startswith("mixamorig:")]
    if ws:
        P.append(mw @ mesh.vertices[v.index].co)
        dom.append(max(ws)[1])

zmin = min(p.z for p in P)
zmax = max(p.z for p in P)
H = zmax - zmin


def bone_z(name):
    return (rig.matrix_world @ rig.data.bones[name].head_local).z


def bone_x(name):
    return (rig.matrix_world @ rig.data.bones[name].head_local).x


def band(z0, z1, pred=lambda i, p: True):
    return [p for i, p in enumerate(P) if z0 <= p.z <= z1 and pred(i, p)]


res = {"height_m": round(H, 3)}
# Head: nose tip = front-most point in the upper 15 % of the body; chin = lowest point close to the face plane.
head_pts = band(zmax - 0.16 * H, zmax)
ynose = min(p.y for p in head_pts)
face = [p for p in band(zmax - 0.20 * H, zmax - 0.06 * H) if abs(p.x) < 0.02 and p.y < ynose + 0.035]
chin_z = min(p.z for p in face)
res["head_h"] = round(zmax - chin_z, 3)
res["head_h_ratio"] = round((zmax - chin_z) / H, 4)
res["heads_tall"] = round(H / (zmax - chin_z), 2)
temple = band(zmax - 0.07 * H, zmax - 0.045 * H)
res["head_w"] = round(max(p.x for p in temple) - min(p.x for p in temple), 3)
nw = []
for k in range(0, 7):  # narrowest slice between the chin and 6 cm below it = the neck itself (trapezius widens it below)
    sl = band(chin_z - 0.01 * k - 0.004, chin_z - 0.01 * k + 0.004)
    if sl:
        nw.append(max(p.x for p in sl) - min(p.x for p in sl))
res["neck_w"] = round(min(nw), 3)

sz = bone_z("mixamorig:LeftArm")
sh = band(sz - 0.10, sz - 0.02)
res["shoulder_w"] = round(max(p.x for p in sh) - min(p.x for p in sh), 3)
res["acromion_w"] = round(2 * abs(bone_x("mixamorig:LeftArm")), 3)
res["shoulder_ratio"] = round(res["shoulder_w"] / H, 4)


def is_arm(i):
    n = dom[i]
    return any(k in n for k in ("Arm", "Hand", "Shoulder"))


chest_z = sz - 0.20 * (H / 1.78)
ch = band(chest_z - 0.02, chest_z + 0.02, lambda i, p: not is_arm(i))
res["chest_w"] = round(max(p.x for p in ch) - min(p.x for p in ch), 3)
res["chest_d"] = round(max(p.y for p in ch) - min(p.y for p in ch), 3)
hips_z = bone_z("mixamorig:Hips")
wz = (sz + hips_z) / 2 - 0.02
wa = band(wz - 0.02, wz + 0.02, lambda i, p: not is_arm(i))
res["waist_w"] = round(max(p.x for p in wa) - min(p.x for p in wa), 3)
hi = band(hips_z - 0.02, hips_z + 0.06, lambda i, p: not is_arm(i))
res["hip_w"] = round(max(p.x for p in hi) - min(p.x for p in hi), 3)


def one_leg(zc, half=0.02):
    pts = [p for p in band(zc - half, zc + half) if p.x > 0.0]
    return round(max(p.x for p in pts) - min(p.x for p in pts), 3)


crotch_z = bone_z("mixamorig:LeftUpLeg") - 0.10 * (H / 1.78)
res["thigh_w"] = one_leg(crotch_z - 0.10)
res["calf_w"] = one_leg(zmin + 0.28 * H)
for k in ("chest_w", "chest_d", "waist_w", "hip_w", "thigh_w", "calf_w", "head_w", "neck_w"):
    res[k + "_ratio"] = round(res[k] / H, 4)
ev.to_mesh_clear()
print("MEASURE " + json.dumps(res))
if out_json:
    json.dump(res, open(out_json, "w"), indent=1)
