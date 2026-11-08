"""Bake a Gemini-painted guide sheet back onto the shared body's texture.

Run inside Blender:
  blender -b <dir>/base_body.blend -P pipeline/model3d/bake_skin.py -- --dir <dir> [--sheet painted_sheet.png] [--size 2048]

Reads <dir>/guide_sheet.png, <dir>/guide_views.json and the painted sheet. Writes:
  view_<name>.png     each painted figure, re-aligned onto its mannequin view (alpha = painted area)
  align_check.png     painted views with the mannequin silhouette edge drawn in red, to spot drift
  skin.png            the baked body texture (MakeHuman UV)
  skinned.blend       the body with skin.png applied
  preview.png         the textured body rendered from every guide camera
"""
import argparse
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--sheet", default="painted_sheet.png")
ap.add_argument("--size", type=int, default=2048)
args = ap.parse_args(argv)
D = os.path.abspath(args.dir)
meta = json.load(open(os.path.join(D, "guide_views.json"), encoding="utf-8"))
views = meta["views"]


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[::-1].copy()  # top row first
    bpy.data.images.remove(img)
    return a


def save_rgba(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def foreground(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ~((g > 0.55) & (g > r * 1.35) & (g > b * 1.35))


def figure_boxes(mask, n):
    """Bounding boxes of the n widest foreground column runs, left to right."""
    cols = mask.sum(axis=0) > 2
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    # Outstretched hands of neighbouring figures can touch and merge two figures into one run: split the
    # widest run where it is thinnest, close to where its figures should meet.
    colsum = mask.sum(axis=0)
    while 0 < len(runs) < n:
        i = max(range(len(runs)), key=lambda k: runs[k][1] - runs[k][0])
        x0, x1 = runs[i]
        k = round((x1 - x0) / (sum(r[1] - r[0] for r in runs) / (len(runs) + 1)))  # how many figures this run holds
        k = max(2, min(k, n - len(runs) + 1))
        cuts = []
        for j in range(1, k):
            c = x0 + (x1 - x0) * j // k
            lo, hi = c - (x1 - x0) // (k * 5), c + (x1 - x0) // (k * 5)
            cuts.append(lo + int(np.argmin(colsum[lo:hi])))
        edges = [x0] + cuts + [x1]
        runs[i:i + 1] = [(edges[j], edges[j + 1]) for j in range(k)]
    runs = sorted(sorted(runs, key=lambda r: mask[:, r[0]:r[1]].sum(), reverse=True)[:n])
    if len(runs) != n:
        sys.exit(f"Found {len(runs)} figures, expected {n}. Are the figures touching, or the background not pure green?")
    boxes = []
    for x0, x1 in runs:
        rows = np.where(mask[:, x0:x1].any(axis=1))[0]
        boxes.append((x0, x1, rows[0], rows[-1] + 1))
    return boxes


# ---- 1. Align each painted figure onto its mannequin view ----
guide = load_rgba(os.path.join(D, "guide_sheet.png"))
painted = load_rgba(os.path.join(D, args.sheet))
gmask, pmask = foreground(guide), foreground(painted)
sheet_views = [v for v in views if not v.get("mirror_of")]
gboxes, pboxes = figure_boxes(gmask, len(sheet_views)), figure_boxes(pmask, len(sheet_views))
vw, vh = views[0]["px"]
check = []
for v, gb, pb in zip(sheet_views, gboxes, pboxes):
    # Start from the bounding boxes, then search scale and offset for the best silhouette overlap.
    # Bounding boxes alone drift when Gemini draws a hand slightly differently.
    s0 = (pb[3] - pb[2]) / (gb[3] - gb[2])
    cell = gmask[:, v["sheet_x"]:v["sheet_x"] + vw]
    q = 4
    gsmall = cell[::q, ::q]
    ys_s, xs_s = np.mgrid[0:gsmall.shape[0], 0:gsmall.shape[1]] * q
    gcx = (gb[0] + gb[1]) / 2 - v["sheet_x"]
    pcx = (pb[0] + pb[1]) / 2
    best = (-1, s0, 0.0, 0.0)
    for sc in s0 * np.linspace(0.92, 1.08, 17):
        for dx in np.arange(-48, 49, 4) * s0:
            for dy in np.arange(-24, 25, 4) * s0:
                mx = np.clip(((xs_s - gcx) * sc + pcx + dx).round().astype(int), 0, painted.shape[1] - 1)
                my = np.clip(((ys_s - gb[2]) * sc + pb[2] + dy).round().astype(int), 0, painted.shape[0] - 1)
                pm = pmask[my, mx]
                iou = (pm & gsmall).sum() / max(1, (pm | gsmall).sum())
                if iou > best[0]:
                    best = (iou, sc, dx, dy)
    iou, sc, dx, dy = best
    ys, xs = np.mgrid[0:vh, 0:vw]
    px = np.clip(((xs - gcx) * sc + pcx + dx).round().astype(int), 0, painted.shape[1] - 1)
    py = np.clip(((ys - gb[2]) * sc + pb[2] + dy).round().astype(int), 0, painted.shape[0] - 1)
    sx = sy = sc
    out = painted[py, px].copy()
    m = pmask[py, px]
    for _ in range(3):  # trim edge pixels so no green-screen fringe ends up on the skin
        m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    out[..., 3] = m.astype(np.float32)
    out[..., 1] = np.minimum(out[..., 1], np.maximum(out[..., 0], out[..., 2]))  # remove green spill
    # Push edge colours outward over the transparent area so filtering never mixes in green.
    filled = m.copy()
    for _ in range(24):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src_ok = np.roll(filled, (dy, dx), (0, 1)) & ~filled
            out[src_ok, :3] = np.roll(out, (dy, dx), (0, 1))[src_ok, :3]
            filled |= src_ok
    save_rgba(out, os.path.join(D, f"view_{v['name']}.png"))
    print(f"view {v['name']}: scale {sc:.3f}, offset {dx:+.0f},{dy:+.0f}px, silhouette overlap {iou:.3f}")
    # Alignment check: mannequin silhouette edge in red over the painted view.
    gm = gmask[:, v["sheet_x"]:v["sheet_x"] + vw]
    edge = gm ^ np.roll(gm, 1, 0) | gm ^ np.roll(gm, 1, 1)
    c = out.copy()
    c[..., 3] = 1
    c[~out[..., 3].astype(bool)] = (0.1, 0.1, 0.1, 1)
    c[edge] = (1, 0, 0, 1)
    check.append(c)
# Mirrored views: the body and guide pose are symmetric, so flip the painted source view.
for v in views:
    if v.get("mirror_of"):
        src = load_rgba(os.path.join(D, f"view_{v['mirror_of']}.png"))
        save_rgba(src[:, ::-1].copy(), os.path.join(D, f"view_{v['name']}.png"))
        print(f"view {v['name']}: mirrored from {v['mirror_of']}")
save_rgba(np.concatenate(check, axis=1), os.path.join(D, "align_check.png"))

# ---- 2. Projected UVs and per-view weights ----
body = bpy.data.objects["Body"]
bpy.context.view_layer.objects.active = body
for o in bpy.context.view_layer.objects:
    o.select_set(o == body)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)  # freeze MPFB's body shape
for m in list(body.modifiers):
    if m.type == "MASK":
        bpy.ops.object.modifier_apply(modifier=m.name)
me = body.data
mw = body.matrix_world
depsgraph = bpy.context.evaluated_depsgraph_get()
# Project from the posed (guide pose) surface, the same shape the guide cameras saw.
posed = body.evaluated_get(depsgraph).to_mesh()
assert len(posed.vertices) == len(me.vertices)
co = np.array([mw @ v.co for v in posed.vertices])
nrm = np.array([(mw.to_3x3() @ v.normal).normalized() for v in posed.vertices])
body.evaluated_get(depsgraph).to_mesh_clear()
bvh = BVHTree.FromObject(body, depsgraph)
loop_vi = np.empty(len(me.loops), dtype=np.int32)
me.loops.foreach_get("vertex_index", loop_vi)

assert len(views) <= 4, "the weight attribute holds at most four views (RGBA)"
weights = np.zeros((len(me.vertices), 4), dtype=np.float32)
vert_uv = []
for i, v in enumerate(views):
    loc = Vector(v["location"])
    rot = __import__("mathutils").Euler(v["rotation_euler"]).to_matrix()
    right, up, fwd = rot.col[0], rot.col[1], -rot.col[2]
    ortho_h = v["ortho_scale"]  # ortho scale spans the larger side, which is the height
    ortho_w = ortho_h * vw / vh
    rel = co - np.array(loc)
    u = rel @ np.array(right) / ortho_w + 0.5
    t = rel @ np.array(up) / ortho_h + 0.5
    vert_uv.append((u, t))
    uv = me.uv_layers.new(name=f"proj_{i}")
    uv.data.foreach_set("uv", np.stack([u[loop_vi], t[loop_vi]], 1).ravel())
    to_cam = -np.array(fwd)
    facing = np.clip(nrm @ to_cam, 0, 1)
    vis = np.zeros(len(co), dtype=np.float32)
    for k in np.where(facing > 0.02)[0]:
        p = Vector(co[k]) + Vector(to_cam) * 0.003
        hit = bvh.ray_cast(p, Vector(to_cam), 10.0)
        vis[k] = 0.0 if hit[0] is not None else 1.0
    # No grazing projection: a surface turned more than ~70 degrees from the camera would smear edge pixels
    # across it. Those areas take the neighbour-filled colour instead.
    weights[:, i] = vis * np.where(facing > 0.35, facing, 0.0) ** 3
    print(f"view {v['name']}: {int(vis.sum())} visible vertices")

# ---- Fill colour for skin no view saw (inner back leg, heels, soles) ----
# Each vertex gets the weighted painted colour where it was seen; unseen vertices take the average of their
# neighbours, spreading inward over the mesh, so gaps continue the surrounding skin instead of a flat colour.
nv = len(me.vertices)
acc = np.zeros((nv, 3), np.float32)
wsum = np.zeros(nv, np.float32)
for i, v in enumerate(views):
    img = load_rgba(os.path.join(D, f"view_{v['name']}.png"))
    u, t = vert_uv[i]
    px = np.clip((u * vw).astype(int), 0, vw - 1)
    py = np.clip(((1 - t) * vh).astype(int), 0, vh - 1)
    a = img[py, px, 3] * weights[:, i]
    acc += img[py, px, :3] * a[:, None]
    wsum += a
known = wsum > 0.02
fill = np.zeros((nv, 3), np.float32)
fill[known] = acc[known] / wsum[known, None]
ev = np.empty(len(me.edges) * 2, dtype=np.int32)
me.edges.foreach_get("vertices", ev)
ev = ev.reshape(-1, 2)
for _ in range(400):
    if known.all():
        break
    s_col = np.zeros((nv, 3), np.float32)
    s_cnt = np.zeros(nv, np.float32)
    for a_, b_ in ((0, 1), (1, 0)):
        src, dst = ev[:, a_], ev[:, b_]
        ok = known[src]
        np.add.at(s_col, dst[ok], fill[src[ok]])
        np.add.at(s_cnt, dst[ok], 1)
    new = ~known & (s_cnt > 0)
    fill[new] = s_col[new] / s_cnt[new, None]
    known |= new
print(f"fill: {int((wsum <= 0.02).sum())} unseen vertices filled from neighbours")
# PNG pixels are sRGB, but float colour attributes are linear: convert, or the fill comes out washed out.
fill = np.where(fill <= 0.04045, fill / 12.92, ((np.clip(fill, 0, 1) + 0.055) / 1.055) ** 2.4).astype(np.float32)
fa = me.color_attributes.new("fill", "FLOAT_COLOR", "POINT")
fa.data.foreach_set("color", np.concatenate([fill, np.ones((nv, 1), np.float32)], 1).ravel())

attr = me.color_attributes.new("vw", "FLOAT_COLOR", "POINT")
attr.data.foreach_set("color", weights.ravel())
me.uv_layers.active = me.uv_layers["UVMap"]
me.uv_layers["UVMap"].active_render = True

# ---- 3. Bake material: weighted blend of the projected views ----
mat = bpy.data.materials.new("BakeSkin")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
N = nt.nodes.new
L = nt.links.new
ca = N("ShaderNodeVertexColor"); ca.layer_name = "vw"
sep = N("ShaderNodeSeparateColor"); L(ca.outputs["Color"], sep.inputs["Color"])
weight_out = [sep.outputs[0], sep.outputs[1], sep.outputs[2], ca.outputs["Alpha"]]
num, den = None, None
for i, v in enumerate(views):
    uvn = N("ShaderNodeUVMap"); uvn.uv_map = f"proj_{i}"
    tex = N("ShaderNodeTexImage"); tex.extension = "CLIP"; tex.interpolation = "Linear"
    tex.image = bpy.data.images.load(os.path.join(D, f"view_{v['name']}.png"))
    L(uvn.outputs["UV"], tex.inputs["Vector"])
    # Only painted pixels count; anything else falls back to the neighbour-filled vertex colour.
    a = N("ShaderNodeMath"); a.operation = "MULTIPLY"
    L(tex.outputs["Alpha"], a.inputs[0]); L(weight_out[i], a.inputs[1])
    c = N("ShaderNodeVectorMath"); c.operation = "SCALE"
    L(tex.outputs["Color"], c.inputs[0]); L(a.outputs[0], c.inputs["Scale"])
    if num is None:
        num, den = c, a
    else:
        n2 = N("ShaderNodeVectorMath"); n2.operation = "ADD"; L(num.outputs[0], n2.inputs[0]); L(c.outputs[0], n2.inputs[1]); num = n2
        d2 = N("ShaderNodeMath"); d2.operation = "ADD"; L(den.outputs[0], d2.inputs[0]); L(a.outputs[0], d2.inputs[1]); den = d2
safe = N("ShaderNodeMath"); safe.operation = "MAXIMUM"; safe.inputs[1].default_value = 1e-4; L(den.outputs[0], safe.inputs[0])
inv = N("ShaderNodeMath"); inv.operation = "DIVIDE"; inv.inputs[0].default_value = 1.0; L(safe.outputs[0], inv.inputs[1])
avg = N("ShaderNodeVectorMath"); avg.operation = "SCALE"; L(num.outputs[0], avg.inputs[0]); L(inv.outputs[0], avg.inputs["Scale"])
fac = N("ShaderNodeMath"); fac.operation = "MULTIPLY"; fac.use_clamp = True; fac.inputs[1].default_value = 50.0; L(den.outputs[0], fac.inputs[0])
mix = N("ShaderNodeMix"); mix.data_type = "RGBA"
fill_node = N("ShaderNodeVertexColor"); fill_node.layer_name = "fill"
L(fill_node.outputs["Color"], mix.inputs["A"])
L(fac.outputs[0], mix.inputs["Factor"]); L(avg.outputs[0], mix.inputs["B"])
em = N("ShaderNodeEmission"); L(mix.outputs["Result"], em.inputs["Color"])
out = N("ShaderNodeOutputMaterial"); L(em.outputs[0], out.inputs["Surface"])
target = N("ShaderNodeTexImage")
skin = bpy.data.images.new("skin", args.size, args.size, alpha=False)
skin.colorspace_settings.name = "sRGB"
target.image = skin
nt.nodes.active = target
me.materials.clear()
me.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
scene.render.bake.margin = 16
for o in bpy.context.view_layer.objects:
    o.select_set(o == body)
bpy.ops.object.bake(type="EMIT")
skin.filepath_raw = os.path.join(D, "skin.png")
skin.file_format = "PNG"
skin.save()
print("baked", skin.filepath_raw)

# ---- 4. Final material + preview ----
fin = bpy.data.materials.new("Skin")
fin.use_nodes = True
bs = fin.node_tree.nodes["Principled BSDF"]
st = fin.node_tree.nodes.new("ShaderNodeTexImage"); st.image = skin
fin.node_tree.links.new(st.outputs["Color"], bs.inputs["Base Color"])
bs.inputs["Roughness"].default_value = 0.7
me.materials.clear()
me.materials.append(fin)
for i in range(len(views)):
    me.uv_layers.remove(me.uv_layers[f"proj_{i}"])
me.color_attributes.remove(me.color_attributes["vw"])
me.color_attributes.remove(me.color_attributes["fill"])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, "skinned.blend"))

scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "FLAT"
sh.color_type = "TEXTURE"
sh.background_type = "VIEWPORT"
sh.background_color = (0.15, 0.15, 0.18)
scene.view_settings.view_transform = "Standard"
cam = scene.camera
if cam is None:
    cd = bpy.data.cameras.new("Cam"); cd.type = "ORTHO"; cd.ortho_scale = views[0]["ortho_scale"]
    cam = bpy.data.objects.new("Cam", cd); scene.collection.objects.link(cam); scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = vw, vh
frames = []
for v in views:
    cam.location = v["location"]
    cam.rotation_euler = v["rotation_euler"]
    p = os.path.join(D, f"_preview_{v['name']}.png")
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    frames.append(load_rgba(p))
    os.remove(p)
save_rgba(np.concatenate(frames, axis=1), os.path.join(D, "preview.png"))
print("DONE")
