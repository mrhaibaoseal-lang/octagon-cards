"""Play Mixamo animations on the shared body (with the Gemini 2D head card) and render sample frames.

  blender -b <dir>/skinned.blend -P pipeline/model3d/anim_render.py -- --dir <dir> --anims <anim dir> \
      --clips cross,kick_high,... [--frames 6] [--yaw -70]

Retargeting: Mixamo's Y Bot rests in a T pose, our MPFB body in an A pose, with the same "mixamorig:" bone names.
Each bone's world rotation change from its own rest is transferred:  R_tgt(t) = R_src(t) * R_src_rest^-1 * R_tgt_rest,
positions follow the target's own bone chain, and the hips' travel is scaled by the hip-height ratio.
The 3D head is removed; a camera-facing card on the head bone shows the painted head sprite nearest the head's
current angle to the camera (mirrored for the other side) and rolls with the head's tilt.
Writes anim_<clip>.png per clip (frames side by side) and anim_sheet.png (all clips stacked).
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--anims", required=True)
ap.add_argument("--clips", required=True)
ap.add_argument("--frames", type=int, default=6)
ap.add_argument("--yaw", type=float, default=-70.0, help="camera yaw; -90 = pure side view, fighter facing right")
ap.add_argument("--px", type=int, default=360)
ap.add_argument("--flat", dest="toon", action="store_false", help="no lighting, painted shading only (default is toon: one light, 3 hard light/shadow levels, chosen 2026-11-08)")
ap.add_argument("--keys-dir", default="_keys")
ap.add_argument("--keys", action="store_true", help="render key poses (start, wind-up, impact, recovery) plus trail frames on transparent background into _keys/")
ap.add_argument("--gif", action="store_true", help="also write anim_<clip>.gif with every other frame at 15 fps")
args = ap.parse_args(argv)
D = os.path.abspath(args.dir)
hmeta = json.load(open(os.path.join(D, "head_views.json")))
scene = bpy.context.scene
tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = bpy.data.objects["Body"]

# ---- Body: drop eyeballs and the 3D head (the card replaces it); flat skin ----
for o in list(bpy.data.objects):
    if o.name.startswith(("Eye_", "Iris_")):
        bpy.data.objects.remove(o, do_unlink=True)
hg = body.vertex_groups["mixamorig:Head"].index
bm = bmesh.new()
bm.from_mesh(body.data)
dl = bm.verts.layers.deform.verify()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[dl].get(hg, 0.0) > 0.5], context="VERTS")
bm.to_mesh(body.data)
bm.free()
mat = body.data.materials[0]
nt = mat.node_tree
tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
em = nt.nodes.new("ShaderNodeEmission")
nt.links.new(tex.outputs["Color"], em.inputs["Color"])
nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])
if args.toon:
    # Diffuse light -> 3 hard bands (shadow / mid / lit) -> multiplied onto the painted skin, shown unlit.
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.50, 0.47, 0.55, 1)   # shadow, slightly cool
    els[1].position, els[1].color = 0.62, (1.06, 1.04, 1.0, 1)   # lit, slightly warm
    mid = els.new(0.22)
    mid.color = (0.78, 0.76, 0.78, 1)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(tex.outputs["Color"], mul.inputs["A"])
    nt.links.new(ramp.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], em.inputs["Color"])

# ---- Head card ----
bpy.ops.mesh.primitive_plane_add(size=hmeta["size_m"])
card = bpy.context.active_object
cm = bpy.data.materials.new("HeadCard")
cm.use_nodes = True
n = cm.node_tree
n.nodes.clear()
tc = n.nodes.new("ShaderNodeTexCoord")
mp = n.nodes.new("ShaderNodeMapping")
im = n.nodes.new("ShaderNodeTexImage")
im.extension = "CLIP"
e2 = n.nodes.new("ShaderNodeEmission")
tr = n.nodes.new("ShaderNodeBsdfTransparent")
mx = n.nodes.new("ShaderNodeMixShader")
oo = n.nodes.new("ShaderNodeOutputMaterial")
n.links.new(tc.outputs["UV"], mp.inputs["Vector"])
n.links.new(mp.outputs["Vector"], im.inputs["Vector"])
n.links.new(im.outputs["Color"], e2.inputs["Color"])
n.links.new(im.outputs["Alpha"], mx.inputs["Fac"])
n.links.new(tr.outputs[0], mx.inputs[1])
n.links.new(e2.outputs[0], mx.inputs[2])
n.links.new(mx.outputs[0], oo.inputs["Surface"])
card.data.materials.append(cm)
sprites = {v["name"]: bpy.data.images.load(os.path.join(D, f"head_{v['name']}.png")) for v in hmeta["views"]}

# Face and up directions in the head bone's rest frame (MakeHuman faces -Y, up is +Z).
head_rest = (tgt.matrix_world @ tgt.data.bones["mixamorig:Head"].matrix_local).to_quaternion()
FACE = head_rest.inverted() @ Vector((0, -1, 0))
UP = head_rest.inverted() @ Vector((0, 0, 1))
# The card centre was measured with the head in its rest orientation, relative to the head bone matrix.
CENTER = Vector(hmeta["center_in_head_bone"])


def place_card(cam):
    hm = tgt.matrix_world @ tgt.pose.bones["mixamorig:Head"].matrix
    q = hm.to_quaternion()
    face, up = q @ FACE, q @ UP
    cr = cam.matrix_world.to_3x3()
    right, cup, back = cr.col[0], cr.col[1], cr.col[2]  # camera looks along -back
    yaw = -math.degrees(math.atan2(face.dot(right), face.dot(back)))  # 0 = facing camera, -90 = facing screen-right
    want = -abs(yaw)
    v = min(hmeta["views"], key=lambda v: min(abs(v["yaw_deg"] - want), 360 - abs(v["yaw_deg"] - want)))
    im.image = sprites[v["name"]]
    flip = yaw > 0
    mp.inputs["Scale"].default_value = (-1 if flip else 1, 1, 1)
    mp.inputs["Location"].default_value = (1 if flip else 0, 0, 0)
    roll = math.atan2(-up.dot(right), up.dot(cup))
    card.matrix_world = Matrix.Translation(hm @ CENTER + back * 0.12) @ (cr @ Matrix.Rotation(roll, 3, "Z")).to_4x4()


# ---- Retargeting ----
def rest_world(arm, name):
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def retarget(fbx_path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=fbx_path, automatic_bone_orientation=False)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "ARMATURE")
    act = src.animation_data.action
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    names = [b.name for b in tgt.data.bones if b.name in src.data.bones]
    order = [b.name for b in tgt.data.bones if b.name in names]  # parents come before children
    s_rest = {nm: rest_world(src, nm).to_quaternion() for nm in names}
    t_rest = {nm: rest_world(tgt, nm) for nm in names}
    # The rest poses differ (Mixamo T pose, ours A pose): first turn each target bone so it points the way the
    # source bone points at rest, otherwise every motion keeps the 45-degree arm offset.
    align = {}
    for nm in names:
        sb, tb = src.data.bones[nm], tgt.data.bones[nm]
        ds = (src.matrix_world.to_3x3() @ (sb.tail_local - sb.head_local)).normalized()
        dt = (tgt.matrix_world.to_3x3() @ (tb.tail_local - tb.head_local)).normalized()
        align[nm] = dt.rotation_difference(ds)
    hip_scale = t_rest["mixamorig:Hips"].translation.z / rest_world(src, "mixamorig:Hips").translation.z
    s_hip0 = rest_world(src, "mixamorig:Hips").translation
    tact = bpy.data.actions.new(os.path.basename(fbx_path))
    tgt.animation_data_create()
    tgt.animation_data.action = tact
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        posed = {}
        for nm in order:
            sm = src.matrix_world @ src.pose.bones[nm].matrix
            rot = sm.to_quaternion() @ s_rest[nm].inverted() @ align[nm] @ t_rest[nm].to_quaternion()
            bone = tgt.data.bones[nm]
            if bone.parent and bone.parent.name in posed:
                rel = bone.parent.matrix_local.inverted() @ bone.matrix_local
                pos = (posed[bone.parent.name] @ rel).translation
            else:
                pos = t_rest[nm].translation + (sm.translation - s_hip0) * hip_scale
            posed[nm] = Matrix.Translation(pos) @ rot.to_matrix().to_4x4()
            arm_space = tgt.matrix_world.inverted() @ posed[nm]
            if bone.parent and bone.parent.name in posed:
                parent_arm = tgt.matrix_world.inverted() @ posed[bone.parent.name]
                basis = (bone.parent.matrix_local.inverted() @ bone.matrix_local).inverted() @ parent_arm.inverted() @ arm_space
            else:
                basis = bone.matrix_local.inverted() @ arm_space
            pb = tgt.pose.bones[nm]
            pb.rotation_quaternion = basis.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if not bone.parent:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=f)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    return f0, f1


# ---- Camera and render ----
scene.render.engine = "BLENDER_EEVEE"
scene.world = scene.world or bpy.data.worlds.new("W")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.07, 1)
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x = args.px
scene.render.resolution_y = int(args.px * 1.25)
cd = bpy.data.cameras.new("GameCam")
cd.type = "ORTHO"
cd.ortho_scale = 2.6
cam = bpy.data.objects.new("GameCam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
if args.toon:
    sun_d = bpy.data.lights.new("Key", "SUN")
    sun_d.energy = 3.2
    sun = bpy.data.objects.new("Key", sun_d)
    scene.collection.objects.link(sun)
    ya = math.radians(args.yaw)
    to_cam = Vector((math.sin(ya), -math.cos(ya), 0))
    screen_left = Vector((-math.cos(ya), -math.sin(ya), 0))
    src_dir = (to_cam * 0.8 + Vector((0, 0, 1.1)) + screen_left * 0.7).normalized()  # light from upper front-left
    sun.rotation_euler = (-src_dir).to_track_quat("-Z", "Y").to_euler()


def load(p):
    i = bpy.data.images.load(p)
    a = np.empty(i.size[0] * i.size[1] * 4, np.float32)
    i.pixels.foreach_get(a)
    a = a.reshape(i.size[1], i.size[0], 4)
    bpy.data.images.remove(i)
    return a


def save(a, p):
    i = bpy.data.images.new("o", a.shape[1], a.shape[0], alpha=True)
    i.pixels.foreach_set(np.ascontiguousarray(a).ravel())
    i.filepath_raw = p
    i.file_format = "PNG"
    i.save()
    bpy.data.images.remove(i)


EFFECTORS = ["mixamorig:LeftHand", "mixamorig:RightHand", "mixamorig:LeftFoot", "mixamorig:RightFoot", "mixamorig:Head"]


def key_frames(f0, f1):
    """Impact = frame where the limb that moves furthest from its start is furthest away; wind-up = the frame
    before it where that limb is closest to the hips (the chamber); recovery = halfway from impact to the end."""
    pos = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        hips = tgt.matrix_world @ tgt.pose.bones["mixamorig:Hips"].head
        pos[f] = {e: (tgt.matrix_world @ tgt.pose.bones[e].head) - hips for e in EFFECTORS}
    travel = {e: max((pos[f][e] - pos[f0][e]).length for f in pos) for e in EFFECTORS}
    eff = max(travel, key=travel.get)
    impact = max(pos, key=lambda f: (pos[f][eff] - pos[f0][eff]).length)
    if eff == "mixamorig:Head":
        windup = f0 + (impact - f0) // 2
    else:
        before = [f for f in pos if f0 < f < impact - 1] or [f0]
        windup = min(before, key=lambda f: pos[f][eff].length)
    recovery = impact + (f1 - impact) // 2
    trail = sorted({max(windup, impact - 2), max(windup, impact - 4), max(windup, impact - 6)} - {impact})
    return eff, {"start": f0, "windup": windup, "impact": impact, "recovery": recovery}, trail


rows = []
for clip in args.clips.split(","):
    f0, f1 = retarget(os.path.join(args.anims, f"{clip}.fbx"))
    scene.frame_set(f0)
    hip = tgt.matrix_world @ tgt.pose.bones["mixamorig:Hips"].head
    a = math.radians(args.yaw)
    target = Vector((hip.x, hip.y, 0.95))
    cam.location = target + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.25))
    cam.rotation_euler = Euler((math.radians(87.6), 0, a))
    if args.keys:
        eff, keys, trail = key_frames(f0, f1)
        kd = os.path.join(D, args.keys_dir)
        os.makedirs(kd, exist_ok=True)
        scene.render.film_transparent = True
        scene.frame_set(f0)
        h0 = tgt.matrix_world @ tgt.pose.bones["mixamorig:Hips"].head
        cam.location = Vector((h0.x, h0.y, 0.95)) + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.25))  # fixed camera
        todo = list(keys.items()) + [(f"trail{i}", f) for i, f in enumerate(trail)]
        for label, f in todo:
            scene.frame_set(f)
            place_card(cam)
            scene.render.filepath = os.path.join(kd, f"{clip}__{label}.png")
            bpy.ops.render.render(write_still=True)
        json.dump({"effector": eff, "keys": keys, "trail": trail}, open(os.path.join(kd, f"{clip}.json"), "w"))
        scene.render.film_transparent = False
        print("keys", clip, eff, keys, trail)
        continue
    frames = []

    def follow():
        # Keep the fighter framed: track the hips sideways, keep the camera height and angle.
        h = tgt.matrix_world @ tgt.pose.bones["mixamorig:Hips"].head
        cam.location = Vector((h.x, h.y, 0.95)) + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.25))

    for k in range(args.frames):
        f = round(f0 + (f1 - f0) * k / max(1, args.frames - 1))
        scene.frame_set(f)
        follow()
        place_card(cam)
        p = os.path.join(D, f"_f_{clip}_{k}.png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        frames.append(load(p))
        os.remove(p)
    if args.gif:
        gif_dir = os.path.join(D, f"_gif_{clip}")
        os.makedirs(gif_dir, exist_ok=True)
        for f in range(f0, f1 + 1, 2):
            scene.frame_set(f)
            follow()
            place_card(cam)
            scene.render.filepath = os.path.join(gif_dir, f"{f:04d}.png")
            bpy.ops.render.render(write_still=True)
    row = np.concatenate(frames, axis=1)
    save(row, os.path.join(D, f"anim_{clip}.png"))
    rows.append(row)
    print("clip", clip, f0, f1)
if rows:
    save(np.concatenate(rows[::-1], axis=0), os.path.join(D, "anim_sheet.png"))
print("DONE")
