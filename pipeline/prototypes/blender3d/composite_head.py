"""把官方去背照的頭（含脖子）貼到 render_clips.py --nohead 渲出的無頭身體上（原型）。

兩種模式：
  舊（大頭照 256×160）：--crop x0,y0,x1,y1 裁頭、橢圓遮罩，下巴＝裁切底邊。
  新（未裁切全身原圖）：--chin-y 下巴y --top-y 髮頂y --crop ... --neck-w 脖子半寬 --fade 淡出像素
                         頭連脖子一起貼，脖子底部淡出，和身體投影貼圖（同一張照片）銜接。
用法：uv run --with pillow python -I composite_head.py <無頭序列資料夾(含 anchors.json)> <照片.png> <輸出資料夾>
        [--scale 1.7] [--tilt 0.5] [--shift 0.12] [--crop x0,y0,x1,y1] [--chin-y N --top-y N ...]
官方照不進 repo；本腳本只讀你指定的本機檔。
"""
import argparse
import json
import math
import os

from PIL import Image, ImageChops, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("body_dir")
ap.add_argument("photo")
ap.add_argument("out_dir")
ap.add_argument("--scale", type=float, default=1.7, help="頭高 ÷ Head 骨頭長度")
ap.add_argument("--tilt", type=float, default=0.5, help="跟隨骨頭傾斜的比例 0~1")
ap.add_argument("--max-tilt", type=float, default=30.0, help="頭的最大旋轉角（度）")
ap.add_argument("--shift", type=float, default=0.12, help="臉往前（右）偏移，單位為頭寬")
ap.add_argument("--crop", default="60,8,206,122", help="照片裁切框 x0,y0,x1,y1（照片像素）")
ap.add_argument("--chin-y", type=float, default=None, help="新模式：下巴 y（照片像素）")
ap.add_argument("--top-y", type=float, default=0.0, help="新模式：髮頂 y（照片像素）")
ap.add_argument("--neck-w", type=float, default=130, help="新模式：脖子遮罩半寬（照片像素）")
ap.add_argument("--fade", type=float, default=110, help="新模式：底部淡出高度（照片像素）")
ap.add_argument("--pivot", type=float, default=0.0, help="新模式：旋轉中心在下巴下方多少（頭高比例）")
ap.add_argument("--bridge", action="store_true", help="逐幀把照片的脖子變形，接在下巴與身體脖子根部之間")
ap.add_argument("--neck-src", default="460,660,461,610", help="脖子來源 x0,x1,y0,y1（照片像素）")
ap.add_argument("--neck-bottom", type=float, default=0.75, help="脖子下端寬度 ÷ 上端寬度")
ap.add_argument("--neck-sink", type=float, default=0.3, help="脖子下端沿 Neck→Spine2 往軀幹內延伸的比例")
ap.add_argument("--chin-pull", type=float, default=0.0, help="下巴往脖子根部拉近的比例，縮短脖子")
a = ap.parse_args()


def perspective_coeffs(dst, src):
    """PIL PERSPECTIVE 需要「輸出座標 → 來源座標」的 8 個係數。"""
    import numpy as np

    rows, vals = [], []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        vals.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        vals.append(v)
    return np.linalg.solve(np.array(rows, float), np.array(vals, float)).tolist()

os.makedirs(a.out_dir, exist_ok=True)
meta = json.load(open(os.path.join(a.body_dir, "anchors.json")))
anchors = meta["anchors"]

photo = Image.open(a.photo).convert("RGBA")
x0, y0, x1, y1 = (int(v) for v in a.crop.split(","))
head = photo.crop((x0, y0, x1, y1))

if a.chin_y is None:
    # 舊模式：裁到實心範圍＋橢圓遮罩
    bb = head.getchannel("A").point(lambda v: 255 if v >= 16 else 0).getbbox()
    head = head.crop(bb)
    hw, hh = head.size
    mask = Image.new("L", head.size, 0)
    ImageDraw.Draw(mask).ellipse((-hw * 0.06, -hh * 0.08, hw * 1.06, hh * 1.0), fill=255)
    head.putalpha(ImageChops.multiply(head.getchannel("A"), mask))
    chin_c = hh  # 下巴＝底邊
    head_h = hh
    cxc = hw / 2
else:
    hw, hh = head.size
    chin_c = a.chin_y - y0
    head_h = a.chin_y - a.top_y
    cxc = (hw) / 2
    # 遮罩：下巴上方保留整寬；下巴以下收窄成脖子，底部淡出
    mask = Image.new("L", head.size, 0)
    d = ImageDraw.Draw(mask)
    top_w = hw
    d.polygon(
        [
            (0, 0), (top_w, 0), (top_w, chin_c - 0.12 * head_h),
            (cxc + a.neck_w * 1.25, chin_c + 0.05 * head_h),
            (cxc + a.neck_w, hh), (cxc - a.neck_w, hh),
            (cxc - a.neck_w * 1.25, chin_c + 0.05 * head_h), (0, chin_c - 0.12 * head_h),
        ],
        fill=255,
    )
    fade = Image.new("L", head.size, 255)
    fp = fade.load()
    for yy in range(hh):
        t = 1.0 if yy < hh - a.fade else max(0.0, (hh - yy) / a.fade)
        v = int(255 * t)
        for xx in range(hw):
            fp[xx, yy] = v
    alpha = ImageChops.multiply(ImageChops.multiply(head.getchannel("A"), mask), fade)
    head.putalpha(alpha)

print("head layer", head.size, "chin_c", chin_c, "head_h", head_h)

NECK = None
if a.bridge:
    # 來源脖子：下緣淡出，融入身體；上緣由頭蓋住
    _x0, _x1, _y0, _y1 = (int(float(v)) for v in a.neck_src.split(","))
    NECK = photo.copy()
    _f = Image.new("L", photo.size, 255)
    _fp = _f.load()
    _fade_start = _y1 - (_y1 - _y0) * 0.35
    for yy in range(_y0, photo.height):
        v = 0 if yy >= _y1 else int(255 * min(1.0, (_y1 - yy) / (_y1 - _fade_start)))
        for xx in range(_x0, _x1):
            _fp[xx, yy] = v
    NECK.putalpha(ImageChops.multiply(NECK.getchannel("A"), _f))

for name, anc in anchors.items():
    _raw = Image.open(os.path.join(a.body_dir, name + ".png")).convert("RGBA")
    # 大頭會超出渲染畫布上緣：往上加邊，所有錨點跟著平移
    PAD = 120
    body = Image.new("RGBA", (_raw.width, _raw.height + PAD), (0, 0, 0, 0))
    body.paste(_raw, (0, PAD))
    anc = {k: [v[0], v[1] + PAD] for k, v in anc.items()}
    nx, ny = anc["neck"]
    tx, ty = anc["top"]
    bone_len = math.hypot(tx - nx, ty - ny)
    tilt_deg = math.degrees(math.atan2(tx - nx, -(ty - ny)))
    s = a.scale * bone_len / head_h
    h2 = head.resize((max(1, round(head.width * s)), max(1, round(head.height * s))), Image.BICUBIC)
    cx = nx + h2.width * a.shift
    cy = ny + 0.10 * bone_len
    if a.bridge:
        bx, by = anc["neck_base"]
        sx, sy = anc["spine"]
        bx, by = bx + (sx - bx) * a.neck_sink, by + (sy - by) * a.neck_sink
        cx += (bx - cx) * a.chin_pull
        cy += (by - cy) * a.chin_pull
        r = math.radians(max(-a.max_tilt, min(a.max_tilt, tilt_deg * a.tilt)))
        nx0, nx1, ny0, ny1 = (float(v) for v in a.neck_src.split(","))
        ht = (nx1 - nx0) / 2 * s
        over = (a.chin_y - ny0) * s  # 脖子上端伸進下巴後面，由頭蓋住接縫
        ux, uy = math.sin(r), -math.cos(r)  # 頭的「上」方向
        px, py = math.cos(r), math.sin(r)  # 頭的「右」方向
        dx, dy = bx - cx, by - cy
        dl = math.hypot(dx, dy) or 1.0
        qx, qy = dy / dl, -dx / dl  # 身體脖子軸的「右」方向
        hb = ht * a.neck_bottom
        tx0, ty0 = cx + ux * over, cy + uy * over
        dst = [
            (tx0 - px * ht, ty0 - py * ht),
            (tx0 + px * ht, ty0 + py * ht),
            (bx + qx * hb, by + qy * hb),
            (bx - qx * hb, by - qy * hb),
        ]
        src = [(nx0, ny0), (nx1, ny0), (nx1, ny1), (nx0, ny1)]
        neck = NECK.transform(body.size, Image.PERSPECTIVE, perspective_coeffs(dst, src), Image.BICUBIC)
        # 只留四邊形內，避免來源外的像素被帶進來
        qm = Image.new("L", body.size, 0)
        ImageDraw.Draw(qm).polygon(dst, fill=255)
        neck.putalpha(ImageChops.multiply(neck.getchannel("A"), qm))
        body.alpha_composite(neck)
    layer = Image.new("RGBA", body.size, (0, 0, 0, 0))
    layer.paste(h2, (round(cx - cxc * s), round(cy - chin_c * s)), h2)
    pivot_y = cy + a.pivot * head_h * s
    rot = max(-a.max_tilt, min(a.max_tilt, tilt_deg * a.tilt))  # 限制角度，避免被打時頭脫離脖子
    layer = layer.rotate(-rot, center=(cx, pivot_y), resample=Image.BICUBIC)
    body.alpha_composite(layer)
    body.save(os.path.join(a.out_dir, name + ".png"))

print("composited", len(anchors), "frames →", a.out_dir)
