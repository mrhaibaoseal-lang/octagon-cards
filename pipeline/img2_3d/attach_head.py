"""Blender: rough test of putting a generated head on the MPFB body. Opens the fighter's skinned.blend (never saves it),
cuts the body's head off above the neck, scales and places the generated head so its crown and neck line up with the
body's, parents it to the Head bone, and renders front + three-quarter views side by side.

  blender -b <private>/_model3d/topuria/skinned.blend -P pipeline/img2_3d/attach_head.py -- head.glb out.png --rot-x -90 --rot-z -90   (TripoSR)
  ... -- gemini_real_fix_paint.glb out.png --blend -0.03 0.02 --close                                  (TRELLIS.2, best)
"""
import argparse
import math
import os
import sys
import tempfile

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("head")
ap.add_argument("out")
ap.add_argument("--rot-x", type=float, default=0.0)
ap.add_argument("--rot-z", type=float, default=0.0)
ap.add_argument("--body-cut", type=float, default=0.0, help="cut the body this far above the mid-neck line (m)")
ap.add_argument("--neck-keep", type=float, default=0.02, help="keep this much generated neck below the mid-neck line (m)")
ap.add_argument("--neck-radius", type=float, default=0.12, help="below the mid-neck line keep only this far to each side of the neck axis (m)")
ap.add_argument("--stitch", type=float, default=0.04, help="pull the new neck onto the body within this distance (m); 0 = off")
ap.add_argument("--debug-red", action="store_true", help="paint the new head flat red to see where it ends")
ap.add_argument("--blend", type=float, nargs=2, metavar=("LO", "HI"), default=None,
                help="radial neck blend: below mid-neck+LO the new neck takes the body's neck shape (body cut there), fading out by mid-neck+HI; overrides --body-cut/--neck-keep/--stitch")
ap.add_argument("--blend-color", type=float, default=0.05, help="with --blend: fade the body's skin texture onto the new neck over this height above the cut (m)")
ap.add_argument("--lift", type=float, default=0.0, help="raise the aligned head this much (m): a longer neck")
ap.add_argument("--fit", type=float, nargs=2, metavar=("W", "D"), default=(0.158, 0.205),
                help="squash the head sideways / front-to-back (about its own axis, fading out to nothing at the neck) when its width / depth "
                     "6 cm below the crown is over W / D (m). A real head is ~15.5 x 20 cm there; TRELLIS heads sometimes come out 25 percent too fat "
                     "(Volkanovski: 19.2 x 23.6) and read as a balloon. Heads already inside the limit are not touched")
ap.add_argument("--max-head", type=float, default=0.235,
                help="when the head (crown to chin, beard included) is taller than this (m) after the neck-to-crown scaling, shrink the whole "
                     "head to this height about the neck line; the crown then sits that much below the body's old crown (a longer neck). A real head is 22-23 cm")
ap.add_argument("--no-fit", action="store_true", help="skip the --fit squash")
ap.add_argument("--close", action="store_true", help="also render <out>_close.png: head and neck from front, 3/4, side, back")
ap.add_argument("--face", action="store_true", help="also render <out>_face.png: eyes-height close-up from front, 3/4, side")
ap.add_argument("--ink", type=float, default=0.0, help="with --toon: body outline width (m), 0 = none (default: an outline draws a line where the shoulder overlaps the trapezius)")
ap.add_argument("--toon", action="store_true", help="3-tone toon light, cool shadows, rim light and ink outline on everything")
ap.add_argument("--poster", action="store_true", help="2-tone flat light (one cool shadow, one warm light), no rim light (implies --toon); snapping the texture to few colours was tried and looked blotchy")
ap.add_argument("--match-skin", action="store_true", help="scale the head's vertex colours to the body's neck skin")
a = ap.parse_args(argv)

body = bpy.data.objects["Body"]
rig = bpy.data.objects["Body.rig"]
for n in ("Eye_l", "Eye_r", "Iris_l", "Iris_r"):
    if n in bpy.data.objects:
        bpy.data.objects[n].hide_render = True
neck = rig.data.bones["mixamorig:Neck"]
head_bone = rig.data.bones["mixamorig:Head"]
# Mid-neck: just above the Neck bone's root. Its tail sits at chin height, so cutting there left the body's jaw
# inside the new head, and matching the new head's neck to it shrank the head.
neck_z = (rig.matrix_world @ neck.head_local).z + 0.01

# Bake the pose into the body first: below ~1.44 m the armature moves the rest mesh by up to 3 cm (shoulders lowered),
# so cutting and measuring the rest mesh put the cut and the blend target where the rendered body is not. Test renders
# only (the .blend is never saved); a real pipeline would cut in rest space and keep the skin weights.
bpy.context.view_layer.objects.active = body
for m in list(body.modifiers):
    if m.type == "ARMATURE":
        bpy.ops.object.modifier_apply(modifier=m.name)

# Body head: crown height and the centre of the skull, then cut it off.
bw = [body.matrix_world @ v.co for v in body.data.vertices]
body_top = max(p.z for p in bw)
cut_z = neck_z + (a.blend[0] if a.blend else a.body_cut)
from mathutils.bvhtree import BVHTree
ubm = bmesh.new()  # the uncut body: its neck (and jaw) shape is the blend target, its UVs the colour source
ubm.from_mesh(body.data)
ubm.transform(body.matrix_world)
ubm.faces.ensure_lookup_table()
utree = BVHTree.FromBMesh(ubm)
neck_a = rig.matrix_world @ neck.head_local
neck_b = rig.matrix_world @ neck.tail_local


def axis_at(z):  # point on the Neck bone's line at height z (the neck leans forward)
    return neck_a.lerp(neck_b, (z - neck_a.z) / (neck_b.z - neck_a.z))
ring = [p for p in bw if abs(p.z - neck_z) < 0.005]
neck_c = sum(ring, Vector()) / len(ring)
bm = bmesh.new()
bm.from_mesh(body.data)
# Bisect, not delete: deleting vertices drops every face that crosses the line and leaves a saw-tooth rim on the traps.
bm.transform(body.matrix_world)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut_z), plane_no=(0, 0, 1),
                       clear_outer=True)
bm.transform(body.matrix_world.inverted())
bm.to_mesh(body.data)
bm.free()

# Generated head: import, turn upright and facing -Y.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=a.head)
new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in new:
    o.select_set(True)
bpy.context.view_layer.objects.active = new[0]
if len(new) > 1:
    bpy.ops.object.join()
head = bpy.context.view_layer.objects.active
head.parent = None
head.rotation_mode = "XYZ"
head.rotation_euler = (math.radians(a.rot_x), 0, math.radians(a.rot_z))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Find its neck: the narrowest horizontal slice in the lower half of the head region.
vs = [v.co.copy() for v in head.data.vertices]
top = max(v.z for v in vs)
bot = min(v.z for v in vs)
H = top - bot
best = None
for i in range(30, 75):
    z = top - H * i / 100
    sl = [v for v in vs if abs(v.z - z) < H * 0.01]
    if len(sl) < 8:
        continue
    w = max(v.x for v in sl) - min(v.x for v in sl)
    if best is None or w < best[1]:
        best = (z, w)
gen_neck = best[0]
scale = (body_top - neck_z) / (top - gen_neck)
head.scale = (scale,) * 3
bpy.ops.object.transform_apply(scale=True)
head.location = (0, 0, body_top - top * scale)
bpy.ops.object.transform_apply(location=True)


def layer_size(ps, z, tol=0.006):  # width (x) and depth (y) of the slice of points ps at height z
    l = [p for p in ps if abs(p.z - z) < tol]
    if len(l) < 4:
        return 0.0, 0.0
    return max(p.x for p in l) - min(p.x for p in l), max(p.y for p in l) - min(p.y for p in l)


def head_height_now():  # crown to chin: the lowest point of the front quarter on the centre line (the beard counts)
    ps = [v.co for v in head.data.vertices]
    zt_ = max(q.z for q in ps)
    up_ = [p for p in ps if p.z > (neck_z + zt_) / 2]
    cx_ = (min(p.x for p in up_) + max(p.x for p in up_)) / 2
    yf_ = min(p.y for p in ps if p.z > neck_z)
    fr_ = [p for p in ps if p.y < yf_ + 0.06 and abs(p.x - cx_) < 0.03 and p.z > neck_z]
    return max(p.z for p in ps) - min(p.z for p in fr_), cx_, (min(p.y for p in up_) + max(p.y for p in up_)) / 2


crown_drop = 0.0
fit_xy = (1.0, 1.0)
hh0, cx_, cy_ = head_height_now()
hh0 += a.lift  # --lift stretches the head below the crown by about this much (chin hangs lower than the crown rises)
w6, d6 = layer_size([v.co for v in head.data.vertices], body_top - 0.06)
print(f"FIT probe: crown-chin {hh0*100:.1f} cm, {w6*100:.1f} x {d6*100:.1f} cm at 6 cm below the crown")
fx = a.fit[0] / w6 if w6 > a.fit[0] * 1.03 else 1.0
fy = a.fit[1] / d6 if d6 > a.fit[1] * 1.03 else 1.0
if a.no_fit:
    pass
elif min(fx, fy) < 0.75:
    # More than a quarter off is not a fat skull, it is hair (O'Malley's curls are 27 cm wide): shrinking or squashing would ruin the face.
    print(f"FIT skipped: {w6*100:.1f} x {d6*100:.1f} cm at 6 cm below the crown needs x {fx:.2f} / y {fy:.2f}; probably hair, head not touched")
else:
    if hh0 > a.max_head and (fx < 1.0 or fy < 1.0):  # only oversized heads: a head that is already the right width keeps its size
        k = a.max_head / hh0
        for v in head.data.vertices:
            v.co.x = cx_ + (v.co.x - cx_) * k
            v.co.y = cy_ + (v.co.y - cy_) * k
            v.co.z = neck_z + (v.co.z - neck_z) * k
        crown_drop = (1 - k) * (body_top - neck_z)
        print(f"SHRINK head {hh0*100:.1f} cm crown-chin -> {a.max_head*100:.1f} cm (x{k:.3f}); crown {crown_drop*100:.1f} cm lower")
        w6, d6 = layer_size([v.co for v in head.data.vertices], body_top - crown_drop - 0.06)
        fx = a.fit[0] / w6 if w6 > a.fit[0] * 1.03 else 1.0
        fy = a.fit[1] / d6 if d6 > a.fit[1] * 1.03 else 1.0
    if fx < 1.0 or fy < 1.0:
        fit_xy = (fx, fy)
        up = [v.co for v in head.data.vertices if v.co.z > (neck_z + (body_top - crown_drop)) / 2]
        cx = (min(p.x for p in up) + max(p.x for p in up)) / 2
        cy = (min(p.y for p in up) + max(p.y for p in up)) / 2
        z_full = neck_z + 0.35 * (body_top - crown_drop - neck_z)  # full squash from here up; nothing at the neck line (the narrowest slice)
        for v in head.data.vertices:
            t = min(1.0, max(0.0, (v.co.z - neck_z) / (z_full - neck_z)))
            t = t * t * (3 - 2 * t)
            v.co.x = cx + (v.co.x - cx) * (1 + (fx - 1) * t)
            v.co.y = cy + (v.co.y - cy) * (1 + (fy - 1) * t)
        print(f"FIT head {w6*100:.1f} x {d6*100:.1f} cm at 6 cm below the crown -> squashed x {fx:.3f}, y {fy:.3f}")


def landmarks(ps, z_neck, z_top):
    """Skull = bounding-box centre above halfway (not the vertex mean: the noisy hair is dense and drags it back);
    nape = the back of the neck (+Y) on the centre line at z_neck. The beard makes the front of the neck useless."""
    sk = [p for p in ps if p.z > (z_neck + z_top) / 2]
    s_ = Vector(((min(p.x for p in sk) + max(p.x for p in sk)) / 2, (min(p.y for p in sk) + max(p.y for p in sk)) / 2,
                 (min(p.z for p in sk) + max(p.z for p in sk)) / 2))
    nk = [p for p in ps if abs(p.z - z_neck) < 0.006 and abs(p.x - s_.x) < 0.025]
    return s_, Vector((s_.x, max(p.y for p in nk), z_neck))


# Line the new head up with the body's own head: tilt it (about X) until skull-centre-over-nape matches, then move the
# skull centre onto the body's. The old way matched the crown's vertex mean to the body skull's and left the head ~5 cm
# forward of the neck.
bS, bN = landmarks(bw, neck_z, body_top)
hv = [v.co for v in head.data.vertices]
hS, hN = landmarks(hv, neck_z, body_top)
ang_b = math.atan2(bS.y - bN.y, bS.z - bN.z)
ang_h = math.atan2(hS.y - hN.y, hS.z - hN.z)
from mathutils import Matrix
pitch = ang_h - ang_b
head.data.transform(Matrix.Translation(hS) @ Matrix.Rotation(pitch, 4, "X") @ Matrix.Translation(-hS))
hv = [v.co for v in head.data.vertices]
hS2, _ = landmarks(hv, neck_z, body_top)
head.data.transform(Matrix.Translation((bS.x - hS2.x, bS.y - hS2.y, body_top - crown_drop - max(p.z for p in hv))))
if a.lift:
    # Stretch the neck rather than lift the head whole: a rigid lift carried the flaring bottom of the new neck up into
    # the blend band, where it was dropped as trapezius and holed the nape. Nothing moves below the cut; the full lift is
    # reached at the chin in front (it hangs almost to the cut) and 6 cm up at the back and sides.
    zb = neck_z + (a.blend[0] if a.blend else 0.0) - 0.01
    for v in head.data.vertices:
        c = axis_at(v.co.z)
        d = Vector((v.co.x - c.x, v.co.y - c.y, 0))
        fk = min(1.0, max(0.0, (-d.normalized().y - 0.42) / 0.4)) if d.length > 1e-5 else 0.0
        top = zb + 0.07 + (0.02 - 0.07) * fk
        t = min(1.0, max(0.0, (v.co.z - zb) / (top - zb)))
        v.co.z += a.lift * t * t * (3 - 2 * t)


def chin_z(ps, x0, y_front):  # lowest point of the front quarter (chin / beard), near the centre line
    fr = [p for p in ps if abs(p.x - x0) < 0.03 and p.y < y_front and p.z > neck_z - 0.04]
    return min(p.z for p in fr) if fr else 0


print("chin z body/head", round(chin_z([p for p in bw if p.z > neck_z - 0.01], bS.x, bS.y - 0.06), 3),
      round(chin_z([v.co for v in head.data.vertices], bS.x, bS.y - 0.06), 3), "lift", a.lift)
print("align pitch", round(math.degrees(pitch), 1), "skull shift", (bS - hS).to_tuple(3), "nape body/head", round(bN.y, 3), round(hN.y, 3))
# Drop shoulders and chest of the generated bust. Not with one flat cut: the beard hangs below the narrowest neck
# line, so a flat cut takes the chin off. Below the mid-neck line keep a column round the neck axis instead.
bm = bmesh.new()
bm.from_mesh(head.data)
bmesh.ops.delete(bm, geom=[] if a.blend else [v for v in bm.verts if v.co.z < neck_z - a.neck_keep or (
    v.co.z < neck_z and abs(v.co.x - neck_c.x) > a.neck_radius)], context="VERTS")  # shoulders are to the sides; the chin sticks out in front
bm.to_mesh(head.data)
bm.free()

if a.blend:
    import numpy as np
    z0, z1 = neck_z + a.blend[0], neck_z + a.blend[1]
    if os.environ.get("NECK_PROFILE"):  # radius of the new head (outermost) vs the uncut body, by height and angle
        for z in np.arange(neck_z - 0.06, neck_z + 0.061, 0.015):
            c = axis_at(z)
            row = []
            for ang in range(0, 181, 30):
                r_ = math.radians(ang)
                d = Vector((math.sin(r_), -math.cos(r_), 0))
                _, _, _, rb = utree.ray_cast(Vector((c.x, c.y, z)), d)
                rh = [ (v.co - c).to_2d().length for v in head.data.vertices if abs(v.co.z - z) < 0.004 and
                      math.degrees(math.acos(max(-1, min(1, (v.co - c).to_2d().normalized().dot(d.to_2d()))))) < 8]
                row.append(f"{ang}:{rb or 0:.3f}/{max(rh) if rh else 0:.3f}")
            print("PROF", round(z, 3), " ".join(row))
    bm = bmesh.new()
    bm.from_mesh(head.data)
    # Below the cut the new neck only has to reach inside the body; shoulders and chest go.
    # Only a 1 cm lip under the cut (4 mm left gaps): lower down the body is already shoulder, nearly flat, and a pressed-on sheet shows.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < z0 - 0.01], context="VERTS")
    bm.normal_update()

    def front_keep(d):  # 1 straight ahead (chin, beard) .. 0 from 65 degrees round: the front keeps the new head's shape
        return min(1.0, max(0.0, (-d.y - 0.42) / 0.4))

    moved, traps = 0, []
    for v in bm.verts:
        if v.co.z >= z1:
            continue
        c = axis_at(v.co.z)
        d = Vector((v.co.x - c.x, v.co.y - c.y, 0))
        r = d.length
        if r < 1e-5:
            continue
        d /= r
        hit, _, _, rb = utree.ray_cast(Vector((c.x, c.y, v.co.z)), d)
        if hit is None:
            continue
        # The bottom 1-3 cm of the throat blends like the rest of the neck so the body's rim does not show in front.
        fz = min(1.0, max(0.0, (v.co.z - z0 - 0.01) / 0.02))
        fk = front_keep(d)
        if fk < 0.5 and r > rb + 0.015:  # never in front: the beard hangs down to the cut there (deleting it holed the chin)
            traps.append(v)  # the new head's own trapezius, sticking out past the body's neck
            continue
        t = min(1.0, (z1 - v.co.z) / (z1 - z0))
        w = t * t * (3 - 2 * t) * (1 - fk * fz * fz * (3 - 2 * fz))
        if v.co.z > z0 and v.normal.z < -0.3:
            w *= max(0.0, 1 + (v.normal.z + 0.3) / 0.4)  # chin and beard undersides keep their shape
        if w <= 0:
            continue
        rb -= 0.002 * (1.0 if v.co.z < z0 else t)  # 2 mm under the body skin below the cut so the body's rim covers the edge
        nr = r + (rb - r) * w
        v.co.x, v.co.y = c.x + d.x * nr, c.y + d.y * nr
        moved += 1
    bmesh.ops.delete(bm, geom=traps, context="VERTS")
    print("trap verts dropped", len(traps))
    bm.to_mesh(head.data)
    bm.free()
    print("blended", moved)
    # Colour: a second UV map pointing at the body's skin texture, mixed in by a per-vertex weight that is 1 at the cut.
    me = head.data
    zs = np.array([v.co.z for v in me.vertices])
    cw = np.clip((z0 + a.blend_color - zs) / a.blend_color, 0, 1)
    cw = cw * cw * (3 - 2 * cw)
    buv = me.uv_layers.new(name="bodyuv")
    ul = ubm.loops.layers.uv.active
    from mathutils.interpolate import poly_3d_calc
    vuv = {}
    for i in np.nonzero(cw > 0)[0]:
        co = me.vertices[int(i)].co
        hit, _, fi, _ = utree.find_nearest(co)
        f = ubm.faces[fi]
        ws = poly_3d_calc([l.vert.co for l in f.loops], hit)
        vuv[int(i)] = sum((l[ul].uv * w for l, w in zip(f.loops, ws)), Vector((0, 0)))
    for l in me.loops:
        if l.vertex_index in vuv:
            buv.data[l.index].uv = vuv[l.vertex_index]
    # A face whose corners land on both sides of a body UV seam (back of the neck) would smear the whole texture between
    # them into a dark streak; such faces take one corner's UV (a 1-2 mm face of flat colour does not show).
    straddle = 0
    for p in me.polygons:
        ids = [li for li in p.loop_indices if me.loops[li].vertex_index in vuv]
        if len(ids) < 2:
            continue
        uvs = [buv.data[li].uv.copy() for li in ids]
        if max((u - w).length for u in uvs for w in uvs) > 0.03:
            for li in ids:
                buv.data[li].uv = uvs[0]
            straddle += 1
    print("seam faces", straddle)
    att = me.attributes.new("seam", "FLOAT", "POINT")
    att.data.foreach_set("value", cw.astype(np.float32))
    skin = next(n.image for m in body.data.materials if m for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
    for m in me.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        src = bsdf.inputs["Base Color"].links[0].from_socket if bsdf.inputs["Base Color"].links else None
        if src is None:
            continue
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "bodyuv"
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = skin
        nt.links.new(uvn.outputs["UV"], tx.inputs["Vector"])
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "seam"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        nt.links.new(at.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(tx.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
elif a.stitch:
    # Stitch: the lower neck of the new head slides onto the body's neck surface (2 mm inside at the very bottom so the
    # body's skin covers the edge). Weight grows downward and fades with distance, so the chin in front stays put.
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    moved = 0
    for v in head.data.vertices:
        t = (neck_z + 0.02 - v.co.z) / 0.04
        if t <= 0:
            continue
        hit, nrm, _, d = tree.find_nearest(v.co)
        if hit is None or d > a.stitch:
            continue
        w = min(t, 1.0) * (1 - d / a.stitch) ** 0.5
        target = hit - nrm * 0.002 * min(t, 1.0)
        v.co = v.co.lerp(target, w)
        moved += 1
    print("stitched", moved)

if a.match_skin and head.data.color_attributes:
    # Skin tone of the body's neck (from its texture) vs the generated neck: scale the head's colours to match.
    import numpy as np
    tex = next((n.image for m in body.data.materials if m for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
    if tex is not None:
        tw, th = tex.size
        tp = np.array(tex.pixels[:]).reshape(th, tw, -1)[..., :3]
        uv = body.data.uv_layers.active.data
        samples = []
        for poly in body.data.polygons:
            if neck_z - 0.08 < (body.matrix_world @ poly.center).z < cut_z:
                for li in poly.loop_indices:
                    u, v = uv[li].uv
                    samples.append(tp[min(th - 1, int(v * th)), min(tw - 1, int(u * tw))])
        ca = head.data.color_attributes[0]
        cols = np.array([c.color[:] for c in ca.data])[:, :3]
        if ca.domain == "POINT":
            zs = np.array([v.co.z for v in head.data.vertices])
        else:
            zs = np.array([head.data.vertices[l.vertex_index].co.z for l in head.data.loops])
        band = (zs > neck_z - a.neck_keep) & (zs < neck_z + 0.03)
        if samples and band.any():
            target = np.median(np.array(samples), axis=0)
            gain = target / np.maximum(np.median(cols[band], axis=0), 1e-4)
            cols = np.clip(cols * gain, 0, 1)
            for c, rgb in zip(ca.data, cols):
                c.color = (*rgb, 1.0)
            print("skin gain", gain.round(3))
head.parent = rig
head.parent_type = "BONE"
head.parent_bone = "mixamorig:Head"
head.matrix_parent_inverse = (rig.matrix_world @ rig.pose.bones["mixamorig:Head"].matrix
                              @ __import__("mathutils").Matrix.Translation((0, head_bone.length, 0))).inverted()

# Colour: vertex colours (TripoSR) or keep the imported texture material (TRELLIS.2).
if head.data.color_attributes and not any(n.type == "TEX_IMAGE" for m in head.data.materials if m for n in m.node_tree.nodes):
    mat = bpy.data.materials.new("gen_head")
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = head.data.color_attributes[0].name
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    head.data.materials.clear()
    head.data.materials.append(mat)

if a.debug_red:
    red = bpy.data.materials.new("red")
    red.diffuse_color = (1, 0, 0, 1)
    red.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1, 0, 0, 1)
    head.data.materials.clear()
    head.data.materials.append(red)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 600, 1000
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.35, 0.36, 0.4)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
if a.poster:
    a.toon = True
if a.toon:
    # Same look as style_head.py --style painted: whatever feeds Base Color x a 3-step light ramp, as emission.
    for ob in [o for o in scene.objects if o.type == "MESH" and o.visible_get()]:
        for m in ob.data.materials:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if not bsdf or not out:
                continue
            bc = bsdf.inputs["Base Color"]
            src = bc.links[0].from_socket if bc.links else None
            d = nt.nodes.new("ShaderNodeBsdfDiffuse")
            s2r = nt.nodes.new("ShaderNodeShaderToRGB")
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            cr = ramp.color_ramp
            cr.interpolation = "CONSTANT"
            cr.elements[0].position, cr.elements[0].color = 0.0, (0.32, 0.30, 0.42, 1)
            cr.elements[1].position, cr.elements[1].color = 0.22, (0.72, 0.68, 0.70, 1)
            cr.elements.new(0.55).color = (1.0, 0.97, 0.92, 1)
            if a.poster:  # two tones: one cool shadow, one warm light
                cr.elements.remove(cr.elements[2])
                cr.elements[0].color = (0.40, 0.38, 0.52, 1)
                cr.elements[1].position, cr.elements[1].color = 0.30, (1.0, 0.97, 0.92, 1)
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            if src:
                nt.links.new(src, mul.inputs[6])
            else:
                mul.inputs[6].default_value = bc.default_value
            em = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
            nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], mul.inputs[7])
            nt.links.new(mul.outputs[2], em.inputs["Color"])
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        if ob == head or a.ink <= 0:  # the scanned head is too uneven: an inverted hull pokes through it as wavy lines
            continue
        ink = bpy.data.materials.get("ink") or bpy.data.materials.new("ink")
        ink.use_backface_culling = True
        ink.use_nodes = True
        ink.node_tree.nodes.clear()
        ie = ink.node_tree.nodes.new("ShaderNodeEmission")
        ie.inputs["Color"].default_value = (0.03, 0.02, 0.03, 1)
        ink.node_tree.links.new(ie.outputs["Emission"], ink.node_tree.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
        k = len(ob.data.materials)
        ob.data.materials.append(ink)
        so = ob.modifiers.new("ink", "SOLIDIFY")
        so.thickness, so.use_flip_normals, so.material_offset, so.offset = a.ink, True, k, 1
        so.use_rim = False  # the body is cut open at the neck: a rim there draws an ink ring round the neck
    if a.poster:
        scene.world.color = (0.86, 0.84, 0.78)
    else:
        rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "SUN"))
        rim.data.energy, rim.data.color = 2.0, (0.6, 0.75, 1.0)
        rim.rotation_euler = (math.radians(70), 0, math.radians(150))
        scene.collection.objects.link(rim)
        scene.world.color = (0.16, 0.17, 0.2)

# Proportion report after every attach: real adults are ~22-23 cm crown to chin, ~15.5 x 20 cm wide x deep 6 cm below the crown,
# about 7.5 heads tall. Warn when more than ~10 percent outside.
def proportion_report():
    hw = [head.matrix_world @ v.co for v in head.data.vertices]
    bw2 = [body.matrix_world @ v.co for v in body.data.vertices]
    top_ = max(p.z for p in hw)
    feet = min(p.z for p in bw2)
    yf = min(p.y for p in hw)
    front = [p for p in hw if p.y < yf + 0.06 and abs(p.x) < 0.03 and p.z > neck_z]
    hh = top_ - min(p.z for p in front)
    w6, d6 = layer_size(hw, top_ - 0.06)
    tall = (top_ - feet) / hh
    rows = [("head height (crown-chin)", hh * 100, 22.5, "cm"), ("width 6 cm below crown", w6 * 100, 15.5, "cm"),
            ("depth 6 cm below crown", d6 * 100, 20.0, "cm"), ("body height in heads", tall, 7.5, "heads")]
    print("HEAD-BODY PROPORTIONS   (real adult)  value   verdict")
    bad = False
    for name, val, ref, unit in rows:
        off = val / ref - 1
        flag = "OK" if abs(off) <= 0.10 else f"WARNING {off*100:+.0f}%"
        bad = bad or abs(off) > 0.10
        print(f"  {name:26s} {ref:6.1f} {unit:5s} {val:7.1f}   {flag}")
    print(f"  fit squash x {fit_xy[0]:.3f} y {fit_xy[1]:.3f}; total height {(top_-feet)*100:.1f} cm; head scale {scale:.3f}")
    if bad:
        print("WARNING: head is outside the real range by more than 10 percent - check it before painting or releasing")


proportion_report()
cam = bpy.data.objects.new("expcam", bpy.data.cameras.new("expcam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = body_top * 1.08
scene.collection.objects.link(cam)
scene.camera = cam
scene.view_settings.view_transform = "Standard"

def render_strip(views, w, h, path):
    tmp = tempfile.mkdtemp()
    scene.render.resolution_x, scene.render.resolution_y = w, h
    shots = []
    for i, (yaw, cz) in enumerate(views):
        r = math.radians(yaw)
        cam.location = (10 * math.sin(r), -10 * math.cos(r), cz)
        cam.rotation_euler = (math.radians(90), 0, r)
        scene.render.filepath = os.path.join(tmp, f"{i}.png")
        bpy.ops.render.render(write_still=True)
        shots.append(bpy.data.images.load(scene.render.filepath))
    n = len(shots)
    out = bpy.data.images.new("out", w * n, h, alpha=True)
    import numpy as np
    px = np.zeros((h, w * n, 4), np.float32)
    for i, img in enumerate(shots):
        px[:, i * w:(i + 1) * w] = np.array(img.pixels[:], np.float32).reshape(h, w, 4)
    out.pixels = px.ravel()
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()


render_strip([(0, body_top / 2), (35, body_top / 2)], 600, 1000, a.out)
if a.close:
    cam.data.ortho_scale = 0.42
    cz = neck_z + 0.07
    render_strip([(0, cz), (35, cz), (90, cz), (180, cz)], 500, 500, os.path.splitext(a.out)[0] + "_close.png")
if a.face:
    cam.data.ortho_scale = 0.22
    ez = max((head.matrix_world @ v.co).z for v in head.data.vertices) - 0.125
    render_strip([(0, ez), (35, ez), (90, ez)], 600, 600, os.path.splitext(a.out)[0] + "_face.png")
print("saved", a.out, "scale", round(scale, 3), "neck_z", round(neck_z, 3), "head width", round(max(v.co.x for v in head.data.vertices) - min(v.co.x for v in head.data.vertices), 3))
