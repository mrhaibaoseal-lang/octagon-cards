"""Preview: shared 3D body with the Gemini-painted 2D head sprites on the head bone (A pose, flat shading).

  blender -b <dir>/skinned.blend -P pipeline/model3d/head_test.py -- --dir <dir> [--yaws -90,-30,30,140]

The 3D head is hidden; a camera-facing card on the head bone shows the sprite whose angle is nearest the camera's
(positive yaws use the mirrored sprite). Writes head_test.png.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--yaws", default="-90,-30,30,140")
args = ap.parse_args(argv)
D = os.path.abspath(args.dir)
meta = json.load(open(os.path.join(D, "head_views.json")))

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for pb in rig.pose.bones:  # back to the A pose
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
bpy.context.view_layer.update()
for o in list(bpy.data.objects):
    if o.name.startswith(("Eye_", "Iris_")):
        bpy.data.objects.remove(o, do_unlink=True)

# Hide the 3D head: drop the body above the neck base.
body = bpy.data.objects["Body"]
neck = rig.pose.bones["mixamorig:Neck"]
cut_z = (rig.matrix_world @ neck.head).z + 0.02
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if (body.matrix_world @ v.co).z > cut_z], context="VERTS")
bm.to_mesh(body.data)
bm.free()

# Flat (unlit) skin so the body matches the painted head.
mat = body.data.materials[0]
nt = mat.node_tree
tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
em = nt.nodes.new("ShaderNodeEmission")
nt.links.new(tex.outputs["Color"], em.inputs["Color"])
out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
nt.links.new(em.outputs[0], out.inputs["Surface"])

# Head card.
size = meta["size_m"]
bpy.ops.mesh.primitive_plane_add(size=size)
card = bpy.context.active_object
cm = bpy.data.materials.new("HeadCard")
cm.use_nodes = True
n = cm.node_tree
n.nodes.clear()
uvn = n.nodes.new("ShaderNodeTexCoord")
mapn = n.nodes.new("ShaderNodeMapping")
img = n.nodes.new("ShaderNodeTexImage")
img.extension = "CLIP"
emn = n.nodes.new("ShaderNodeEmission")
tr = n.nodes.new("ShaderNodeBsdfTransparent")
mix = n.nodes.new("ShaderNodeMixShader")
o2 = n.nodes.new("ShaderNodeOutputMaterial")
n.links.new(uvn.outputs["UV"], mapn.inputs["Vector"])
n.links.new(mapn.outputs["Vector"], img.inputs["Vector"])
n.links.new(img.outputs["Color"], emn.inputs["Color"])
n.links.new(img.outputs["Alpha"], mix.inputs["Fac"])
n.links.new(tr.outputs[0], mix.inputs[1])
n.links.new(emn.outputs[0], mix.inputs[2])
n.links.new(mix.outputs[0], o2.inputs["Surface"])
card.data.materials.append(cm)
images = {v["name"]: bpy.data.images.load(os.path.join(D, f"head_{v['name']}.png")) for v in meta["views"]}

head = rig.pose.bones["mixamorig:Head"]
hm = rig.matrix_world @ head.matrix
center = hm @ Vector(meta["center_in_head_bone"])

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.film_transparent = False
scene.world = scene.world or bpy.data.worlds.new("W")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.07, 1)
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x, scene.render.resolution_y = 500, 800
cd = bpy.data.cameras.new("C")
cd.type = "ORTHO"
cd.ortho_scale = 2.0
cam = bpy.data.objects.new("C", cd)
scene.collection.objects.link(cam)
scene.camera = cam

paths = []
for yaw in [float(y) for y in args.yaws.split(",")]:
    a = math.radians(yaw)
    cam.location = Vector((math.sin(a) * 5, -math.cos(a) * 5, 0.9))
    cam.rotation_euler = Euler((math.radians(90), 0, a))
    # Nearest painted angle; positive yaws use the mirror of the negative one.
    want = -abs(yaw) if abs(yaw) < 180 else 180.0
    v = min(meta["views"], key=lambda v: abs(v["yaw_deg"] - want))
    img.image = images[v["name"]]
    mapn.inputs["Scale"].default_value = (-1 if yaw > 0 else 1, 1, 1)
    mapn.inputs["Location"].default_value = (1 if yaw > 0 else 0, 0, 0)
    # Face the camera, slightly in front of the neck so shoulders never cover it.
    fwd = -(cam.rotation_euler.to_matrix().col[2])
    card.rotation_euler = cam.rotation_euler
    card.location = center - fwd * 0.12
    p = os.path.join(D, f"_ht_{int(yaw)}.png")
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    paths.append(p)

w = 500
sheet = bpy.data.images.new("ht", w * len(paths), 800)
pix = [0.0] * (w * len(paths) * 800 * 4)
for i, p in enumerate(paths):
    im = bpy.data.images.load(p)
    src = list(im.pixels)
    for y in range(800):
        s = (y * w * len(paths) + i * w) * 4
        pix[s:s + w * 4] = src[y * w * 4:(y + 1) * w * 4]
    os.remove(p)
sheet.pixels = pix
sheet.filepath_raw = os.path.join(D, "head_test.png")
sheet.file_format = "PNG"
sheet.save()
print("DONE")
