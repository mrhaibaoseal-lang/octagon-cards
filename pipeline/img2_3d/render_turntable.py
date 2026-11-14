"""Blender: render one mesh at 8 yaw angles (0, 45 ... 315 deg) into a single strip PNG, framed on the head.

  blender -b -P pipeline/img2_3d/render_turntable.py -- in.glb out.png [--rot-x 0] [--head 0.45] [--size 320]

Workbench engine with studio light; colour comes from the texture if the mesh has one, else from vertex colours.
--head keeps only the top fraction of the model's height in frame (generated busts include chest and shoulders).
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--rot-x", type=float, default=0.0, help="extra X rotation (deg) when a tool's up axis differs")
ap.add_argument("--rot-z", type=float, default=0.0, help="extra Z rotation (deg) so the face looks at -Y")
ap.add_argument("--head", type=float, default=0.45)
ap.add_argument("--size", type=int, default=320)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
if a.src.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=a.src)
else:
    bpy.ops.import_scene.gltf(filepath=a.src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.parent = None
obj.rotation_mode = "XYZ"  # glTF imports use quaternions, which would ignore rotation_euler
obj.rotation_euler = (math.radians(a.rot_x), 0, math.radians(a.rot_z))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
h = hi.z - lo.z
top, bottom = hi.z, hi.z - h * a.head
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (top + bottom) / 2))

pivot = bpy.data.objects.new("pivot", None)
bpy.context.scene.collection.objects.link(pivot)
pivot.location = (centre.x, centre.y, 0)
obj.parent = pivot
obj.matrix_parent_inverse = pivot.matrix_world.inverted()

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(h * a.head, hi.x - lo.x if a.head >= 0.99 else 0) * 1.1
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = (centre.x, centre.y - 10, centre.z)
cam.rotation_euler = (math.radians(90), 0, 0)
cam_data.clip_end = 100
scene = bpy.context.scene
scene.camera = cam

has_tex = any(n.type == "TEX_IMAGE" for m in obj.data.materials if m and m.use_nodes for n in m.node_tree.nodes)
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "TEXTURE" if has_tex else ("VERTEX" if obj.data.color_attributes else "MATERIAL")
shading.show_cavity = False
scene.render.resolution_x = scene.render.resolution_y = a.size
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.18, 0.19, 0.22)
scene.display_settings.display_device = "sRGB"
scene.view_settings.view_transform = "Standard"

import os
import tempfile

frames = []
tmp = tempfile.mkdtemp()
for i in range(8):
    pivot.rotation_euler = (0, 0, math.radians(45 * i))
    scene.render.filepath = os.path.join(tmp, f"{i}.png")
    bpy.ops.render.render(write_still=True)
    frames.append(bpy.data.images.load(scene.render.filepath))

S = a.size
strip = bpy.data.images.new("strip", S * 8, S, alpha=True)
px = [0.0] * (S * 8 * S * 4)
for i, img in enumerate(frames):
    src = list(img.pixels)
    for y in range(S):
        row = (y * S) * 4
        dst = (y * S * 8 + i * S) * 4
        px[dst:dst + S * 4] = src[row:row + S * 4]
strip.pixels = px
strip.filepath_raw = a.out
strip.file_format = "PNG"
strip.save()
print("saved", a.out, "texture" if has_tex else shading.color_type)
