"""Blender half of gemini_paint.py.

  render: clay views of the head (front, right, back, left; orthographic, green background) + view.json with the framing
  bake:   world position and normal of every texel of the mesh's UV texture -> pos.npy, nrm.npy (H, W, 3)
  vis:    for each view in view.json, cast a ray from every texel towards the camera -> vis.npy (texels, views) bool

  blender -b -P pipeline/img2_3d/paint_head_blender.py -- render|bake mesh.glb workdir [--size 512] [--tex 2048]
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["render", "bake", "vis"])
ap.add_argument("mesh")
ap.add_argument("work")
ap.add_argument("--size", type=int, default=512)
ap.add_argument("--tex", type=int, default=2048)
a = ap.parse_args(argv)
os.makedirs(a.work, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.mesh)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1:
    bpy.ops.object.join()
head = bpy.context.view_layer.objects.active
head.parent = None
head.rotation_mode = "XYZ"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
scene = bpy.context.scene

if a.mode == "render":
    vs = np.array([v.co[:] for v in head.data.vertices])
    zmin, zmax = vs[:, 2].min(), vs[:, 2].max()
    top = vs[vs[:, 2] > zmin + 0.25 * (zmax - zmin)]  # the head, not the chest block
    lo, hi = top.min(0), top.max(0)
    c = (lo + hi) / 2
    scale = float(max(hi - lo) * 1.08)
    head.data.materials.clear()
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light, sh.color_type, sh.single_color = "STUDIO", "SINGLE", (0.75, 0.72, 0.7)
    sh.background_type, sh.background_color = "VIEWPORT", (0, 1, 0)
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = scene.render.resolution_y = a.size
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type, cam.data.ortho_scale = "ORTHO", scale
    scene.collection.objects.link(cam)
    scene.camera = cam
    views = []
    for k, yaw in enumerate((0, 90, 180, 270)):  # camera swings round the head; 0 = in front (-Y)
        r = math.radians(yaw)
        cam.location = Vector(c) + Vector((5 * math.sin(r), -5 * math.cos(r), 0))
        cam.rotation_euler = (math.radians(90), 0, r)
        scene.render.filepath = os.path.join(a.work, f"view{k}.png")
        bpy.ops.render.render(write_still=True)
        views.append({"yaw": yaw, "file": f"view{k}.png"})
    json.dump({"center": c.tolist(), "scale": scale, "size": a.size, "views": views},
              open(os.path.join(a.work, "view.json"), "w"), indent=1)
    print("rendered", len(views))
elif a.mode == "vis":
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(head, dg)
    meta = json.load(open(os.path.join(a.work, "view.json")))
    pos = np.load(os.path.join(a.work, "pos.npy")).reshape(-1, 3)
    nrm = np.load(os.path.join(a.work, "nrm.npy")).reshape(-1, 3)
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    vis = np.zeros((len(pos), len(meta["views"])), bool)
    for k, v in enumerate(meta["views"]):
        r = math.radians(v["yaw"])
        to_cam = np.array([math.sin(r), -math.cos(r), 0.0])
        cand = np.nonzero(covered & (nrm @ to_cam > 0))[0]
        d = Vector(to_cam)
        ray = bvh.ray_cast
        hit = [ray(Vector(pos[i] + 0.0015 * to_cam), d, 1.0)[0] is not None for i in cand]
        vis[cand, k] = ~np.array(hit, bool)
        print("view", k, "candidates", len(cand), "seen", int(vis[:, k].sum()))
    np.save(os.path.join(a.work, "vis.npy"), vis)
else:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    mesh = head.data
    for name, src in (("pos", "Position"), ("nrm", "Normal")):
        img = bpy.data.images.new(name, a.tex, a.tex, float_buffer=True)
        mat = bpy.data.materials.new(name)
        nt = mat.node_tree
        nt.nodes.clear()
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        em = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(geo.outputs[src], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        mesh.materials.clear()
        mesh.materials.append(mat)
        bpy.ops.object.bake(type="EMIT", margin=4)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(a.tex, a.tex, 4)[::-1, :, :3]  # row 0 = top (v = 1)
        np.save(os.path.join(a.work, f"{name}.npy"), px)
        print("baked", name)
