"""Blender half of paint_lowpoly.py. Works on the clay .blend from build_fighter.py --clay.

  atlas:  one UV atlas for the whole mesh (smart project) -> <work>/atlas.blend
  render: clay views on green, orthographic: 5 full-body views (front, left, back, right, top; cells W x H) and 4 head
          views (square) + view.json (per view: file, to_cam, right, up, center, scale)
  bake:   world position / normal / head mask per texel of the atlas -> pos.npy, nrm.npy, part.npy
  The head is the vertex group mixamorig:Head (MPFB model, build_mpfb.py); without it, everything above --head-z.
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
ap.add_argument("--pose-blend", default="", help="final: take vertex positions from this blend's fighter (same mesh, other pose)")
ap.add_argument("--head-z", type=float, default=1.545, help="head split for meshes without a mixamorig:Head group")
a = ap.parse_args(argv)
os.makedirs(a.work, exist_ok=True)
scene = bpy.context.scene
ob = bpy.data.objects["fighter"]
mesh = ob.data
HEAD_UV = 3.0
BODY_CELL = (404, 864)  # 5 cells -> 2020 x 864, about 21:9
_hg = ob.vertex_groups.get("mixamorig:Head")
if _hg is not None:
    IS_HEAD = [any(e.group == _hg.index and e.weight > 0.5 for e in v.groups) for v in mesh.vertices]
    # painted from the head views: also the jaw and beard, which MPFB weights partly to the neck (framing keeps IS_HEAD)
    PAINT_HEAD = [any(e.group == _hg.index and e.weight > 0.15 for e in v.groups) for v in mesh.vertices]
else:
    IS_HEAD = [(ob.matrix_world @ v.co).z > a.head_z for v in mesh.vertices]
    PAINT_HEAD = IS_HEAD
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
        if all(IS_HEAD[v.index] for v in f.verts):
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
    hv = vs[np.array(IS_HEAD)]
    side_dirs = []
    for yaw in (0, 90, 180, 270):
        r = math.radians(yaw)
        side_dirs.append({"yaw": yaw, "to_cam": [math.sin(r), -math.cos(r), 0.0], "right": [math.cos(r), math.sin(r), 0.0],
                          "up": [0.0, 0.0, 1.0], "rot": (math.radians(90), 0, r)})
    top = {"yaw": None, "to_cam": [0.0, 0.0, 1.0], "right": [1.0, 0.0, 0.0], "up": [0.0, 1.0, 0.0], "rot": (0, 0, 0)}
    for group, pts, (W, H), pad, dirs in (("body", vs, BODY_CELL, 1.04, side_dirs + [top]),
                                          ("head", hv, (HEAD_CELL, HEAD_CELL), 1.12, side_dirs)):
        c = (pts.min(0) + pts.max(0)) / 2
        views = []
        for k, d in enumerate(dirs):
            R, U = np.array(d["right"]), np.array(d["up"])
            pr, pu = (pts - c) @ R, (pts - c) @ U
            # ortho_scale covers the larger image side; both extents must fit
            scale = max((pu.max() - pu.min()) * pad * max(W, H) / H, (pr.max() - pr.min()) * pad * max(W, H) / W,
                        2 * max(abs(pu).max(), 1e-3) * pad * max(W, H) / H, 2 * max(abs(pr).max(), 1e-3) * pad * max(W, H) / W)
            cam.data.ortho_scale = scale
            scene.render.resolution_x, scene.render.resolution_y = W, H
            cam.location = Vector(c) + 5 * Vector(d["to_cam"])
            cam.rotation_euler = d["rot"]
            f = f"{group}{k}.png"
            scene.render.filepath = os.path.join(a.work, f)
            bpy.ops.render.render(write_still=True)
            views.append({"yaw": d["yaw"], "file": f, "to_cam": d["to_cam"], "right": d["right"], "up": d["up"],
                          "center": c.tolist(), "scale": float(scale)})
        meta[group] = {"W": W, "H": H, "views": views}
    json.dump(meta, open(os.path.join(a.work, "view.json"), "w"), indent=1)
    print("rendered")

elif a.mode == "bake":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    attr = mesh.color_attributes.new("headmask", "FLOAT_COLOR", "POINT")
    for i, h in enumerate(PAINT_HEAD):
        attr.data[i].color = (1.0, 1.0, 1.0, 1.0) if h else (0.0, 0.0, 0.0, 1.0)
    for name, src in (("pos", "Position"), ("nrm", "Normal"), ("part", "headmask")):
        img = bpy.data.images.new(name, a.tex, a.tex, float_buffer=True)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        if name == "part":
            at = nt.nodes.new("ShaderNodeAttribute")
            at.attribute_name = src
            nt.links.new(at.outputs["Color"], em.inputs["Color"])
        else:
            geo = nt.nodes.new("ShaderNodeNewGeometry")
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
        np.save(os.path.join(a.work, f"{name}.npy"), px[..., :1] > 0.5 if name == "part" else px)
        print("baked", name)

elif a.mode == "vis":
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    meta = json.load(open(os.path.join(a.work, "view.json")))
    pos = np.load(os.path.join(a.work, "pos.npy")).reshape(-1, 3)
    nrm = np.load(os.path.join(a.work, "nrm.npy")).reshape(-1, 3)
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    vis = np.zeros((len(pos), len(meta["body"]["views"])), bool)
    for k, v in enumerate(meta["body"]["views"]):
        to_cam = np.array(v["to_cam"])
        cand = np.nonzero(covered & (nrm @ to_cam > 0))[0]
        d = Vector(to_cam)
        hit = [bvh.ray_cast(Vector(pos[i] + 0.002 * to_cam), d, 10.0)[0] is not None for i in cand]
        vis[cand, k] = ~np.array(hit, bool)
        print("view", k, "seen", int(vis[:, k].sum()))
    np.save(os.path.join(a.work, "vis.npy"), vis)
    # outside: seen from any of 26 directions (cube corners, edges, faces); the rest is inside (eyeball backs, glove cuffs)
    dirs = [np.array(d, float) / np.linalg.norm(d) for d in
            [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)]]
    out = np.zeros(len(pos), bool)
    for dv in dirs:
        cand = np.nonzero(covered & ~out & (nrm @ dv > 0.05))[0]
        d = Vector(dv)
        hit = np.array([bvh.ray_cast(Vector(pos[i] + 0.002 * dv), d, 10.0)[0] is not None for i in cand], bool)
        out[cand[~hit]] = True
    np.save(os.path.join(a.work, "outside.npy"), out)
    print("outside share", float(out[covered].mean()))

else:  # final
    if a.pose_blend:
        with bpy.data.libraries.load(a.pose_blend) as (src, dst):
            dst.meshes = ["fighter"]
        other = dst.meshes[0]
        if len(other.vertices) != len(mesh.vertices) or len(other.polygons) != len(mesh.polygons):
            sys.exit(f"pose blend mesh differs: {len(other.vertices)} vs {len(mesh.vertices)} verts")
        co = np.empty(len(mesh.vertices) * 3, np.float32)
        other.vertices.foreach_get("co", co)
        mesh.vertices.foreach_set("co", co)
        mesh.update()
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
    if scene.render.engine == "BLENDER_WORKBENCH":  # MPFB clay files: show the texture, studio light
        scene.display.shading.color_type = "TEXTURE"
        scene.display.shading.light = "STUDIO"
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
