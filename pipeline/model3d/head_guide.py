"""Render the bald mannequin head from six angles (3x2 grid on green) for Gemini to paint the fighter's head.

  blender -b <dir>/skinned.blend -P pipeline/model3d/head_guide.py -- --dir <dir>

Writes <dir>/head_guide.png and <dir>/head_views.json. Every cell is a square ortho view of the same size,
centred on the same point of the head, so a painted cell can be placed back on the head bone 1:1.
Camera yaw is measured like base_body.py: 0 = in front of the face, -90 = profile facing screen-right.
Positive yaws are not rendered: they are the horizontal mirror of the negative ones (the head is symmetric).
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--cell", type=int, default=512)
args = ap.parse_args(argv)
D = os.path.abspath(args.dir)

# Read order of the grid: top row left to right, then bottom row.
YAWS = [-90.0, -60.0, -30.0, 0.0, -135.0, 180.0]
NAMES = ["profile", "three_quarter", "slight", "front", "back_three_quarter", "back"]

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
head = rig.pose.bones["mixamorig:Head"]
# Centre: a little above the head bone's root, so skull and neck both fit.
hm = rig.matrix_world @ head.matrix
center = hm @ Vector((0, head.bone.length * 0.3, 0))
size = head.bone.length * 2.1  # metres covered by one cell

# Only the head and neck go into the sprite; the 3D body keeps the shoulders. Drop every other vertex
# from this render (the .blend on disk is not saved, so the body stays whole).
import bmesh  # noqa: E402

body = bpy.data.objects["Body"]
bpy.context.view_layer.objects.active = body
for o in bpy.context.view_layer.objects:
    o.select_set(o == body)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
for m in [m for m in body.modifiers if m.type == "MASK"]:
    bpy.ops.object.modifier_apply(modifier=m.name)
# Clean horizontal cut at the base of the neck (in the guide pose the arms are well below it).
neck = rig.pose.bones["mixamorig:Neck"]
cut_z = (rig.matrix_world @ neck.head).z - 0.01
bm = bmesh.new()
bm.from_mesh(body.data)
drop = [v for v in bm.verts if (body.matrix_world @ v.co).z < cut_z]
bmesh.ops.delete(bm, geom=drop, context="VERTS")
bm.to_mesh(body.data)
bm.free()

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
scene.render.resolution_x = scene.render.resolution_y = args.cell
scene.render.film_transparent = False

cd = bpy.data.cameras.new("HeadCam")
cd.type = "ORTHO"
cd.ortho_scale = size
cam = bpy.data.objects.new("HeadCam", cd)
scene.collection.objects.link(cam)
scene.camera = cam

cells = []
for yaw in YAWS:
    a = math.radians(yaw)
    cam.location = center + Vector((math.sin(a) * 3, -math.cos(a) * 3, 0))
    cam.rotation_euler = Euler((math.radians(90), 0, a))
    p = os.path.join(D, f"_head_{int(yaw)}.png")
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(p)
    cells.append(list(img.pixels))
    bpy.data.images.remove(img)
    os.remove(p)

c = args.cell
gap = c // 4
W, H = 3 * c + 4 * gap, 2 * c + 3 * gap
pix = [0.0, 1.0, 0.0, 1.0] * (W * H)
origins = []
for i, src in enumerate(cells):
    col, row = i % 3, i // 3
    x0 = gap + col * (c + gap)
    y_top = gap + row * (c + gap)
    origins.append([x0, y_top])
    y0 = H - y_top - c  # Blender pixel rows start at the bottom
    for y in range(c):
        start = ((y0 + y) * W + x0) * 4
        pix[start:start + c * 4] = src[y * c * 4:(y + 1) * c * 4]
sheet = bpy.data.images.new("head_guide", W, H, alpha=False)
sheet.pixels = pix
sheet.filepath_raw = os.path.join(D, "head_guide.png")
sheet.file_format = "PNG"
sheet.save()

# Centre relative to the head bone, so the game can rebuild it in any pose.
local_center = hm.inverted() @ center
json.dump({
    "cell_px": c, "sheet_px": [W, H], "size_m": size, "center_in_head_bone": list(local_center),
    "views": [{"name": n, "yaw_deg": y, "origin_px": o} for n, y, o in zip(NAMES, YAWS, origins)],
}, open(os.path.join(D, "head_views.json"), "w"), indent=2)
print("DONE", os.path.join(D, "head_guide.png"))
