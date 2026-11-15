"""Blender half of paint_lowpoly.py. Works on the clay .blend from build_fighter.py --clay.

  atlas:  one UV atlas for the whole mesh (smart project) -> <work>/atlas.blend
  render: clay views on green, orthographic: 4 full-body views (cells W x H) and 4 head views (square) + view.json
  bake:   world position / normal per texel of the atlas -> pos.npy, nrm.npy
  vis:    per view, is each texel unblocked towards the camera -> vis.npy
  final:  put texture.png on the atlas (nearest sampling) and render the three preview shots

  blender -b <clay.blend> -P pipeline/lowpoly/paint_blender.py -- MODE <work> [--tex 1024] [--out dir]
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
ap.add_argument("mode", choices=["atlas", "render", "bake", "vis", "final"])
ap.add_argument("work")
ap.add_argument("--tex", type=int, default=1024)
ap.add_argument("--texture", default="texture.png")
ap.add_argument("--tag", default="")
a = ap.parse_args(argv)
os.makedirs(a.work, exist_ok=True)
scene = bpy.context.scene
ob = bpy.data.objects["fighter"]
mesh = ob.data
HEAD_Z = 1.545  # texels above this belong to the head views
HEAD_UV = 3.0

BODY_CELL = (384, 864)
HEAD_CELL = 512

if a.mode == "atlas":
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    uv = mesh.uv_layers.new(name="atlas")
    mesh.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.01, area_weight=0.0)
    # the face is what people look at: give head islands HEAD_UV times the texture area per metre, then repack
    import bmesh
    bm = bmesh.from_edit_mesh(mesh)
    uvl = bm.loops.layers.uv["atlas"]
    for f in bm.faces:
        if f.calc_center_median().z > HEAD_Z:
            for l in f.loops:
                l[uvl].uv *= HEAD_UV
    bmesh.update_edit_mesh(mesh)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for i, l in enumerate(list(mesh.uv_layers)):
        l.active_render = l.name == "atlas"
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.work, "atlas.blend"))
    print("atlas ok")

elif a.mode == "render":
    for o in list(bpy.data.objects):
        if o.name != "fighter" and o.type == "MESH":
            bpy.data.objects.remove(o)
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light, sh.color_type, sh.single_color = "STUDIO", "SINGLE", (0.75, 0.72, 0.7)
    sh.background_type, sh.background_color = "VIEWPORT", (0, 1, 0)
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = False
    vs = np.array([ob.matrix_world @ v.co for v in mesh.vertices])
    cam = scene.camera
    cam.data.type = "ORTHO"
    meta = {}
    hv = vs[(vs[:, 2] > HEAD_Z - 0.01) & (np.abs(vs[:, 0]) < 0.13)]
    for group, pts, (W, H), pad in (("body", vs, BODY_CELL, 1.04), ("head", hv, (HEAD_CELL, HEAD_CELL), 1.12)):
        lo, hi = pts.min(0), pts.max(0)
        c = (lo + hi) / 2
        horiz = max(hi[0] - lo[0], hi[1] - lo[1])
        # ortho_scale covers the larger image side; make sure both the height and the widest turn fit
        scale = max((hi[2] - lo[2]) * pad * max(W, H) / H, horiz * pad * max(W, H) / W)
        cam.data.ortho_scale = scale
        scene.render.resolution_x, scene.render.resolution_y = W, H
        views = []
        for k, yaw in enumerate((0, 90, 180, 270)):
            r = math.radians(yaw)
            cam.location = Vector(c) + Vector((5 * math.sin(r), -5 * math.cos(r), 0))
            cam.rotation_euler = (math.radians(90), 0, r)
            f = f"{group}{k}.png"
            scene.render.filepath = os.path.join(a.work, f)
            bpy.ops.render.render(write_still=True)
            views.append({"yaw": yaw, "file": f})
        meta[group] = {"center": c.tolist(), "scale": float(scale), "W": W, "H": H, "views": views}
    json.dump(meta, open(os.path.join(a.work, "view.json"), "w"), indent=1)
    print("rendered")

elif a.mode == "bake":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    keep = list(mesh.materials)
    for name, src in (("pos", "Position"), ("nrm", "Normal")):
        img = bpy.data.images.new(name, a.tex, a.tex, float_buffer=True)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
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
        for p in mesh.polygons:
            p.material_index = 0
        for o in bpy.data.objects:
            o.select_set(o == ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type="EMIT", margin=6, uv_layer="atlas")
        px = np.array(img.pixels[:], dtype=np.float32).reshape(a.tex, a.tex, 4)[::-1, :, :3]
        np.save(os.path.join(a.work, f"{name}.npy"), px)
        print("baked", name)

elif a.mode == "vis":
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    meta = json.load(open(os.path.join(a.work, "view.json")))
    pos = np.load(os.path.join(a.work, "pos.npy")).reshape(-1, 3)
    nrm = np.load(os.path.join(a.work, "nrm.npy")).reshape(-1, 3)
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    vis = np.zeros((len(pos), 4), bool)
    for k, v in enumerate(meta["body"]["views"]):
        r = math.radians(v["yaw"])
        to_cam = np.array([math.sin(r), -math.cos(r), 0.0])
        cand = np.nonzero(covered & (nrm @ to_cam > 0))[0]
        d = Vector(to_cam)
        hit = [bvh.ray_cast(Vector(pos[i] + 0.002 * to_cam), d, 10.0)[0] is not None for i in cand]
        vis[cand, k] = ~np.array(hit, bool)
        print("view", k, "seen", int(vis[:, k].sum()))
    np.save(os.path.join(a.work, "vis.npy"), vis)

else:  # final
    img = bpy.data.images.load(os.path.join(a.work, a.texture))
    mat = bpy.data.materials.new("skin")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "atlas"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.clear()
    mesh.materials.append(mat)
    for p in mesh.polygons:
        p.material_index = 0
    cam = scene.camera
    cam.data.type = "PERSP"

    def shoot(name, loc, target, lens, res=(720, 1000)):
        cam.location = loc
        cam.data.lens = lens
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = os.path.join(a.work, f"{name}{a.tag}.png")
        bpy.ops.render.render(write_still=True)

    shoot("g_34", (1.6, -3.2, 1.4), (0, 0, 0.95), 50)
    shoot("g_side", (4.0, -0.1, 1.3), (0, 0, 0.95), 50)
    shoot("g_back", (-1.6, 3.2, 1.4), (0, 0, 0.95), 50)
    shoot("g_head", (0.35, -0.75, 1.72), (0, -0.02, 1.67), 60, res=(600, 600))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.work, f"painted{a.tag}.blend"))
    print("final ok")
