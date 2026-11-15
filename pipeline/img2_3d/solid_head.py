"""Close curly / open hair into one solid shell before smooth_head.py. TRELLIS.2 builds big curls (O'Malley) as a net of
hollow tubes; Laplacian smoothing only shrinks the net and pulls the temples in. A voxel remesh fills the gaps between
curls, then the original colour is baked onto a fresh UV layout at the size gemini_paint.py expects (2048).

  blender -b -P pipeline/img2_3d/solid_head.py -- in.glb out.glb [--voxel 0.012] [--tex 2048]

--voxel is a fraction of the mesh height: gaps narrower than about one voxel close. Short, tight hair (Topuria) does not
need this step.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import bpy

VENV_PY = "D:/img2_3d/venv/Scripts/python.exe"
XATLAS = """
import sys, numpy as np, xatlas
d = sys.argv[1]
m = np.load(d + '/m.npz')
vmap, idx, uv = xatlas.parametrize(m['v'], m['f'])
np.save(d + '/uv.npy', uv[idx])
print('xatlas charts done', len(uv), 'uv verts')
"""

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("out")
ap.add_argument("--voxel", type=float, default=0.012)
ap.add_argument("--tex", type=int, default=2048)
ap.add_argument("--close", type=float, default=1.5, help="fill pits and gaps narrower than 2x this many voxels (0 = off); "
                "TRELLIS's small face holes became square pits after the remesh")
ap.add_argument("--shape", default=None, help="skip the remesh: take this mesh (e.g. keep_face.py output) as the shell, "
                "then UV it and bake mesh's colour onto it")
ap.add_argument("--faces", type=int, default=0, help="decimate the shell to about this many faces first (xatlas on 194k "
                "verts ran 45+ min)")
ap.add_argument("--no-uv", action="store_true", help="shape only (no UVs, no bake): quick look, or keep_face.py input")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.mesh, merge_vertices=True)
hi = [o for o in bpy.data.objects if o.type == "MESH"][0]
hi.parent = None
bpy.ops.object.select_all(action="DESELECT")
hi.select_set(True)
bpy.context.view_layer.objects.active = hi
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
H = hi.dimensions.z

# Bake the base colour alone: route it to an emission shader (a DIFFUSE bake darkens wherever TRELLIS's PBR texture
# has metallic, which turned the pink curls black) and bake EMIT.
for slot in hi.material_slots:
    nt_ = slot.material.node_tree
    bsdf = next(n for n in nt_.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt_.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt_.nodes.new("ShaderNodeEmission")
    if bsdf.inputs["Base Color"].links:
        nt_.links.new(bsdf.inputs["Base Color"].links[0].from_socket, em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = bsdf.inputs["Base Color"].default_value
    nt_.links.new(em.outputs["Emission"], out.inputs["Surface"])

if a.shape:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=a.shape, merge_vertices=True)
    lo = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
    lo.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo.data.materials.clear()
    parts = [lo]
else:
    lo = hi.copy()
    lo.data = hi.data.copy()
    bpy.context.scene.collection.objects.link(lo)
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    lo.data.remesh_voxel_size = a.voxel * H
    bpy.ops.object.voxel_remesh()
    if a.close > 0:  # morphological closing: push out, remesh (pits and gaps narrower than 2x close merge), pull back
        for k, sgn in enumerate((1, -1)):
            mod = lo.modifiers.new("close", "DISPLACE")
            mod.direction, mod.mid_level, mod.strength = "NORMAL", 0.0, sgn * a.close * a.voxel * H
            bpy.ops.object.modifier_apply(modifier=mod.name)
            if k == 0:
                bpy.ops.object.voxel_remesh()
    # The remesh leaves closed cavities inside the hair (inner shells nobody sees, most of the surface area): keep the
    # outer shell, i.e. the loose part with the most faces.
    bpy.ops.mesh.separate(type="LOOSE")
    parts = [o for o in bpy.context.selected_objects]
    lo = max(parts, key=lambda o: len(o.data.polygons))
    for o in parts:
        if o is not lo:
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    print("loose parts", len(parts))
    print("solid verts", len(lo.data.vertices), "faces", len(lo.data.polygons), "from", len(hi.data.vertices))
if a.faces and len(lo.data.polygons) > a.faces:
    m = lo.modifiers.new("dec", "DECIMATE")
    m.ratio = a.faces / len(lo.data.polygons)
    bpy.ops.object.modifier_apply(modifier=m.name)
    print("decimated to", len(lo.data.polygons), "faces")
bpy.ops.object.shade_smooth()

if a.no_uv:
    bpy.data.objects.remove(hi)
    bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB", use_selection=True)
    print("saved", a.out, "(no UVs)")
    sys.exit(0)

# UVs with xatlas (what TRELLIS.2 itself uses), run in the TRELLIS venv: Blender's smart project on this lumpy shell
# made thousands of tiny islands and used only ~5-23% of the image, so the smallest faces baked black.
import bmesh  # noqa: E402
import numpy as np  # noqa: E402

bm = bmesh.new()
bm.from_mesh(lo.data)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(lo.data)
bm.free()
me = lo.data
V = np.zeros(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get("co", V)
F = np.zeros(len(me.polygons) * 3, np.int64)
me.polygons.foreach_get("vertices", F)
tmp = tempfile.mkdtemp()
np.savez(os.path.join(tmp, "m.npz"), v=V.reshape(-1, 3), f=F.reshape(-1, 3))
subprocess.run([VENV_PY, "-c", XATLAS, tmp], check=True)
uvs = np.load(os.path.join(tmp, "uv.npy"))  # (faces, 3, 2), same face and corner order as F
if not me.uv_layers:
    me.uv_layers.new(name="UVMap")
me.uv_layers.active.data.foreach_set("uv", uvs.reshape(-1).astype(np.float32))
me.update()


def uv_used():
    import numpy as np
    me = lo.data
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    tot = 0.0
    for p in me.polygons:
        q = uv[p.loop_start:p.loop_start + p.loop_total]
        x, y = q[:, 0], q[:, 1]
        tot += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    return tot


print("uv area used", round(uv_used(), 3))
img = bpy.data.images.new("solid", a.tex, a.tex)
mat = bpy.data.materials.new("solid")
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
nt.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.0
lo.data.materials.clear()
lo.data.materials.append(mat)
nt.nodes.active = tex
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 1
sc.render.bake.use_pass_direct = sc.render.bake.use_pass_indirect = False
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 2 * a.voxel * H
sc.render.bake.max_ray_distance = 0.0  # unlimited: the filled hair can sit well outside the curls it covers
sc.render.bake.margin = 2
bpy.ops.object.select_all(action="DESELECT")
hi.select_set(True)
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bpy.ops.object.bake(type="EMIT")
img.pack()
bpy.data.objects.remove(hi)
bpy.ops.object.select_all(action="DESELECT")
lo.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB", use_selection=True)
print("saved", a.out)
