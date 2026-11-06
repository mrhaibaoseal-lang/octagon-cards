"""Blender 無介面渲染：把 Quaternius CC0「Animated Human」的動作渲成側面序列圖。

用法（Blender 5.x）：
  blender -b "Animated Human.blend" --python render_clips.py -- <輸出資料夾> [皮膚貼圖.png]

輸出：<out>/<clip>_<NN>.png（透明底、正交側面、無抗鋸齒）。之後用 pixelate_clips.py 像素化。
"""
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
SKIN = argv[1] if len(argv) > 1 and not argv[1].startswith("--") else None

# (輸出名稱, action 名稱, 起訖格, 取幾張)
CLIPS = [
    ("idle", "Idle", (0, 120), 4),
    ("punch", "Punch", (0, 24), 7),
    ("hit", "Death", (0, 20), 4),
]
SIZE = 512

scene = bpy.context.scene
arm = bpy.data.objects["Human Armature"]
mesh = bpy.data.objects["Human_Mesh"]

if SKIN:
    for mat in bpy.data.materials:
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = bpy.data.images.load(SKIN)

PROJ = argv[argv.index("--proj") + 1] if "--proj" in argv else None
if PROJ:
    # 全身照投影貼圖：把手臂從 T 字姿勢放下成站姿，依「正面」位置算每個頂點對應照片的 UV。
    # 照片座標：y=0 髮頂、y=200 下巴；水平方向把照片的身體寬度對應到模型寬度。
    import math
    from mathutils import Matrix

    PHOTO_CHIN_Y, PHOTO_X0, PHOTO_X1 = 200.0, 8.0, 452.0
    img = bpy.data.images.load(PROJ)
    TW, TH = img.size
    if "--proj-size" in argv:  # 貼圖被縮小過時，座標仍用原圖像素
        TW, TH = (float(v) for v in argv[argv.index("--proj-size") + 1].split(","))
    # 存檔時骨架可能停在某個動作上：先清掉動作、回到休息姿勢再量測
    if arm.animation_data and arm.animation_data.action:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    W = arm.matrix_world
    top_z = (W @ arm.pose.bones["HeadTop_End"].tail).z
    chin_z = (W @ arm.pose.bones["Head"].head).z
    s_z = (top_z - chin_z) / PHOTO_CHIN_Y
    toe = (W @ arm.pose.bones["LeftToe_End"].head).x
    foot = (W @ arm.pose.bones["LeftFoot"].head).x
    fwd = 1.0 if toe > foot else -1.0  # 人物正面朝 ±X
    print("PROJ top_z", top_z, "chin_z", chin_z, "s_z", s_z, "facing", fwd)

    # 未裁切全身原圖：--proj-lm "髮頂,下巴,髖關節,膝,踝,腳底"（照片 y 像素，由上到下），
    # 對應模型的 HeadTop／Head／LeftUpLeg／LeftLeg／LeftFoot／地面，分段線性對位。
    if "--proj-lm" in argv:
        LM = [float(v) for v in argv[argv.index("--proj-lm") + 1].split(",")]
        ZS = [
            top_z,
            chin_z,
            (W @ arm.pose.bones["LeftUpLeg"].head).z,
            (W @ arm.pose.bones["LeftLeg"].head).z,
            (W @ arm.pose.bones["LeftFoot"].head).z,
            0.0,
        ]
        PHOTO_X0, PHOTO_X1 = 0.0, float(TW)

        def y_of_z(z):
            i = 0
            while i < len(ZS) - 2 and z < ZS[i + 1]:
                i += 1
            return LM[i] + (ZS[i] - z) / (ZS[i] - ZS[i + 1]) * (LM[i + 1] - LM[i])
    else:

        def y_of_z(z):
            return (top_z - z) / s_z

    def lower(name, ang):
        pb = arm.pose.bones[name]
        T = Matrix.Translation(pb.head)
        pb.matrix = T @ Matrix.Rotation(ang, 4, "X") @ T.inverted() @ pb.matrix
        bpy.context.view_layer.update()

    lower("LeftArm", math.radians(-80))
    lower("RightArm", math.radians(80))
    dg0 = bpy.context.evaluated_depsgraph_get()
    ev0 = mesh.evaluated_get(dg0)
    pts = [ev0.matrix_world @ v.co for v in ev0.data.vertices]
    ys = [fwd * p.y for p in pts]
    yc = (min(ys) + max(ys)) / 2
    s_x = (max(ys) - min(ys)) / (PHOTO_X1 - PHOTO_X0)
    xc = (PHOTO_X0 + PHOTO_X1) / 2
    uvl = mesh.data.uv_layers.new(name="proj")
    for lp in mesh.data.loops:
        p = pts[lp.vertex_index]
        xp = xc + (fwd * p.y - yc) / s_x
        yp = y_of_z(p.z)
        uvl.data[lp.index].uv = (xp / TW, 1.0 - yp / TH)
    mesh.data.uv_layers.active = uvl
    uvl.active_render = True
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for mat in bpy.data.materials:
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = img
                node.extension = "EXTEND"

if "--nohead" in argv:
    # 刪掉權重屬於 Head 骨頭的頂點，只留身體；頭由照片合成
    import bmesh

    gi = mesh.vertex_groups["Head"].index
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    dl = bm.verts.layers.deform.verify()
    kill = [v for v in bm.verts if v[dl].get(gi, 0) > 0.3]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(mesh.data)
    bm.free()

scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
sh = scene.display.shading
sh.light = "FLAT" if PROJ else "STUDIO"  # 照片自帶明暗，投影模式用平光不再疊一層
sh.color_type = "TEXTURE"
sh.show_shadows = False
sh.show_cavity = False
scene.display.render_aa = "OFF"

# 正交側面鏡頭：沿 +Y 看，人物面向 +X 或 -X 由 FLIP 決定
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

if arm.animation_data is None:
    arm.animation_data_create()


def set_action(name):
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    try:
        arm.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    return act


def frame_camera():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


set_action("Idle")
scene.frame_set(0)
lo, hi = frame_camera()
height = hi.z - lo.z
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
print("MODEL_HEIGHT", height, "center", center)
cam_data.ortho_scale = height * 1.5
# 人物原本面向 -Y。鏡頭放在 -X 看向 +X → 人物在畫面上面向右側（玩家在左、面向右）
cam.location = Vector((center.x - 10, center.y, center.z))
cam.rotation_euler = (1.5707963, 0, -1.5707963)

import json
from bpy_extras.object_utils import world_to_camera_view

ANCHORS = {}


def bone_px(name, tail=False):
    pb = arm.pose.bones[name]
    p = arm.matrix_world @ (pb.tail if tail else pb.head)
    c = world_to_camera_view(scene, cam, p)
    return [c.x * SIZE, (1 - c.y) * SIZE]  # 像素座標，y 向下


for out_name, act_name, (f0, f1), count in CLIPS:
    set_action(act_name)
    for i in range(count):
        f = f0 + round((f1 - f0) * i / max(count - 1, 1)) if count > 1 else f0
        scene.frame_set(int(f))
        scene.render.filepath = f"{OUT}/{out_name}_{i:02d}.png"
        bpy.ops.render.render(write_still=True)
        # 頭部錨點：Head 骨頭根（頸上）→ HeadTop_End（頭頂），供頭部合成定位／縮放／旋轉
        ANCHORS[f"{out_name}_{i:02d}"] = {
            "neck": bone_px("Head"),
            "top": bone_px("HeadTop_End", tail=True),
            "neck_base": bone_px("Neck"),
            "spine": bone_px("Spine2"),
        }
        print("RENDERED", out_name, i, "frame", f)

with open(f"{OUT}/anchors.json", "w") as fh:
    json.dump({"size": SIZE, "anchors": ANCHORS}, fh, indent=1)
