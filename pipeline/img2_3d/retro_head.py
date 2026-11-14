"""Late-90s low-poly head: rebuild the scanned head as a clean quad mesh (voxel remesh at the size that gives --faces quads), give it a fresh
UV layout, bake the original texture onto a small image, save a glb. Automatic decimation shatters into shards; this
keeps even, quad-shaped faces like a hand-built model.

  blender -b -P pipeline/img2_3d/retro_head.py -- in.glb out.glb [--faces 600] [--tex 256]
"""
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("out")
ap.add_argument("--faces", type=int, default=600)
ap.add_argument("--tex", type=int, default=256)
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

lo = hi.copy()
lo.data = hi.data.copy()
bpy.context.scene.collection.objects.link(lo)
bpy.ops.object.select_all(action="DESELECT")
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
# Voxel remesh gives even quads; pick the voxel size that lands near --faces (QuadriFlow does not run with -b).
src = lo.data.copy()
size = 0.05 * H
for _ in range(4):
    lo.data = src.copy()
    lo.data.remesh_voxel_size = size
    bpy.ops.object.voxel_remesh()
    n = len(lo.data.polygons)
    if abs(n - a.faces) < 0.1 * a.faces:
        break
    size *= (n / a.faces) ** 0.5
print("low faces", len(lo.data.polygons))
bpy.ops.object.shade_smooth()

# UVs + bake the high mesh's colour onto a small image.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")
img = bpy.data.images.new("retro", a.tex, a.tex)
mat = bpy.data.materials.new("retro")
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image, tex.interpolation = img, "Closest"
nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
lo.data.materials.clear()
lo.data.materials.append(mat)
nt.nodes.active = tex
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 1
sc.render.bake.use_pass_direct = sc.render.bake.use_pass_indirect = False
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 0.02 * H
sc.render.bake.margin = 2
bpy.ops.object.select_all(action="DESELECT")
hi.select_set(True)
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bpy.ops.object.bake(type="DIFFUSE")
img.pack()
bpy.data.objects.remove(hi)
bpy.ops.object.select_all(action="DESELECT")
lo.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLB", use_selection=True)
print("saved", a.out)
