"""Try art styles on one head without new pictures: render front, 3/4 and side portraits.

  blender -b -P pipeline/img2_3d/style_head.py -- head.glb out.png --style real|retro|painted [--faces 1200] [--tex 128]

real:    the head as it is, soft lighting (the baseline).
retro:   late-90s low poly: decimate to --faces triangles, texture shrunk to --tex px with nearest-pixel sampling,
         plain diffuse with one key light (Half-Life 1 era look).
painted: stylised: texture run through a Kuwahara filter (flat painted strokes), light cut into three tones
         (shadow / mid / lit) times the texture, a cool rim light, and an ink outline (inverted hull).
"""
import argparse
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("mesh")
ap.add_argument("out")
ap.add_argument("--style", choices=["real", "retro", "painted"], default="real")
ap.add_argument("--faces", type=int, default=1200)
ap.add_argument("--tex", type=int, default=128)
ap.add_argument("--kuwahara", type=int, default=7, help="painted: filter radius in texture px (of 2048)")
ap.add_argument("--outline", type=float, default=0.004, help="painted: outline width, x head height")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.mesh, merge_vertices=True)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1:
    bpy.ops.object.join()
head = bpy.context.view_layer.objects.active
head.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = head.data
P = np.array([v.co[:] for v in me.vertices])
z0, z1 = P[:, 2].min(), P[:, 2].max()
Hh = z1 - z0
nose = P[np.argmin(np.where((P[:, 2] > z0 + 0.3 * Hh) & (P[:, 2] < z1 - 0.3 * Hh), P[:, 1], 9))]

mat = me.materials[0]
nt = mat.node_tree
img = next(n.image for n in nt.nodes if n.type == "TEX_IMAGE" and n.image)
sc = bpy.context.scene


def kuwahara(px, r):
    """Classic 4-quadrant Kuwahara on an (H, W, 3) array: each pixel takes the mean of its calmest quadrant."""
    Hn, Wn, _ = px.shape
    pad = np.pad(px, ((r, r), (r, r), (0, 0)), mode="edge")
    lum = pad @ np.array([0.299, 0.587, 0.114])
    def integ(x):
        s = np.cumsum(np.cumsum(x, 0), 1)
        return np.pad(s, ((1, 0), (1, 0)) + ((0, 0),) * (x.ndim - 2))
    S, S2, SC = integ(lum), integ(lum * lum), integ(pad)
    def box(I, y0, x0):  # sum over (r+1)x(r+1) window starting at offset (y0, x0) from each output pixel
        ys, xs = np.arange(Hn)[:, None] + y0, np.arange(Wn)[None, :] + x0
        return I[ys + r + 1, xs + r + 1] - I[ys, xs + r + 1] - I[ys + r + 1, xs] + I[ys, xs]
    n = (r + 1) ** 2
    best_v = np.full((Hn, Wn), np.inf)
    out = np.zeros((Hn, Wn, 3))
    for y0, x0 in ((0, 0), (0, r), (r, 0), (r, r)):
        m = box(S, y0, x0) / n
        v = box(S2, y0, x0) / n - m * m
        c = box(SC, y0, x0) / n
        sel = v < best_v
        best_v[sel] = v[sel]
        out[sel] = c[sel]
    return out


nodes, links = nt.nodes, nt.links
if a.style == "retro":
    head.modifiers.new("dec", "DECIMATE").ratio = min(1.0, a.faces / len(me.polygons))
    bpy.ops.object.modifier_apply(modifier="dec")
    # Shrink the texture by block-averaging (Image.scale() loses the packed glTF image).
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    k = W // a.tex
    small = px[:a.tex * k, :a.tex * k].reshape(a.tex, k, a.tex, k, 4).mean((1, 3))
    img = bpy.data.images.new("small", a.tex, a.tex)
    img.pixels[:] = small.reshape(-1)
    nodes.clear()
    t = nodes.new("ShaderNodeTexImage")
    t.image, t.interpolation = img, "Closest"
    d = nodes.new("ShaderNodeBsdfDiffuse")
    o = nodes.new("ShaderNodeOutputMaterial")
    links.new(t.outputs["Color"], d.inputs["Color"])
    links.new(d.outputs["BSDF"], o.inputs["Surface"])
elif a.style == "painted":
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    if a.kuwahara > 0:
        px[:, :, :3] = kuwahara(px[:, :, :3].astype(np.float64), a.kuwahara)
    # Push the colours a bit towards flat, saturated paint.
    hsv_l = px[:, :, :3].mean(2, keepdims=True)
    px[:, :, :3] = np.clip(hsv_l + 1.25 * (px[:, :, :3] - hsv_l), 0, 1)
    img.pixels[:] = px.reshape(-1)
    nodes.clear()
    t = nodes.new("ShaderNodeTexImage")
    t.image = img
    d = nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nodes.new("ShaderNodeShaderToRGB")
    ramp = nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    cr.elements[0].position, cr.elements[0].color = 0.0, (0.32, 0.30, 0.42, 1)  # cool shadow
    cr.elements[1].position, cr.elements[1].color = 0.22, (0.72, 0.68, 0.70, 1)
    e = cr.elements.new(0.55)
    e.color = (1.0, 0.97, 0.92, 1)
    mul = nodes.new("ShaderNodeMix")
    mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    em = nodes.new("ShaderNodeEmission")
    o = nodes.new("ShaderNodeOutputMaterial")
    links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    links.new(t.outputs["Color"], mul.inputs[6])
    links.new(ramp.outputs["Color"], mul.inputs[7])
    links.new(mul.outputs[2], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    links.new(em.outputs["Emission"], o.inputs["Surface"])
    # Ink outline: a slightly fattened copy with flipped normals, black, back faces only visible.
    ink = bpy.data.materials.new("ink")
    ink.use_backface_culling = True
    ink.use_nodes = True
    ink.node_tree.nodes.clear()
    ie = ink.node_tree.nodes.new("ShaderNodeEmission")
    ie.inputs["Color"].default_value = (0.03, 0.02, 0.03, 1)
    io = ink.node_tree.nodes.new("ShaderNodeOutputMaterial")
    ink.node_tree.links.new(ie.outputs["Emission"], io.inputs["Surface"])
    me.materials.append(ink)
    so = head.modifiers.new("ink", "SOLIDIFY")
    so.thickness, so.use_flip_normals, so.material_offset, so.offset = a.outline * Hh, True, 1, 1
    mat.use_backface_culling = False

# Lights and camera.
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.16, 0.17, 0.2, 1) if a.style != "retro" else (0.25, 0.25, 0.25, 1)
bg.inputs["Strength"].default_value = 0.6 if a.style == "real" else 0.35


def light(kind, loc, energy, color=(1, 1, 1)):
    L = bpy.data.objects.new(kind, bpy.data.lights.new(kind, "SUN"))
    L.data.energy, L.data.color = energy, color
    L.rotation_euler = (Vector(loc).to_track_quat("Z", "Y")).to_euler()
    sc.collection.objects.link(L)


light("key", (-0.6, -1.0, 0.7), 3.0, (1.0, 0.95, 0.88))
if a.style == "real":
    light("fill", (1.0, -0.6, 0.2), 1.0, (0.85, 0.9, 1.0))
if a.style == "painted":
    light("rim", (0.9, 0.9, 0.3), 2.0, (0.6, 0.75, 1.0))

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.lens = 85
sc.collection.objects.link(cam)
sc.camera = cam
tgt = Vector((nose[0], 0, nose[2] + 0.03 * Hh))
sc.render.resolution_x, sc.render.resolution_y = 600, 600
dist = 2.3 * Hh
shots = []
import os
for k, yaw in enumerate((0, 35, 80)):
    r = math.radians(yaw)
    cam.location = tgt + Vector((dist * math.sin(r), -dist * math.cos(r), 0.02 * Hh))
    cam.rotation_euler = ((tgt - cam.location).to_track_quat("-Z", "Y")).to_euler()
    f = a.out.replace(".png", f"_{k}.png")
    sc.render.filepath = f
    bpy.ops.render.render(write_still=True)
    shots.append(f)
# Join into one strip.
strip = None
for f in shots:
    im = bpy.data.images.load(f)
    p = np.array(im.pixels[:]).reshape(600, 600, 4)
    strip = p if strip is None else np.concatenate([strip, p], 1)
out = bpy.data.images.new("strip", strip.shape[1], 600)
out.pixels[:] = strip.reshape(-1)
out.filepath_raw, out.file_format = a.out, "PNG"
out.save()
for f in shots:
    os.remove(f)
print("saved", a.out)
