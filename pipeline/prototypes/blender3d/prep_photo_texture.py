"""把 UFC bio_full_body 去背照（腰部以上，約 460×700）整理成可投影到 3D 身體的貼圖（原型）。

用法：uv run --with pillow --with numpy --with scipy python -I prep_photo_texture.py <全身照.png> <輸出tex.png> [--args]

處理：
1. 去背邊緣內縮，避免白邊；透明處用最近的不透明顏色填滿（投影時手臂超出照片輪廓也不會露洞）。
2. 照片下方（y>照片高）補腿：短褲色（取自照片下緣中央）→ 褲管下緣 → 膚色（取自肚子）。
座標與縮放需和 render_clips.py --proj 一致：y=0 為髮頂，--chin 為下巴，--s-z 為每像素對應的模型高度。
"""
import argparse

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("photo")
ap.add_argument("out")
ap.add_argument("--top-z", type=float, default=5.588)
ap.add_argument("--s-z", type=float, default=(5.588 - 4.65) / 200)
ap.add_argument("--knee-z", type=float, default=1.423)
ap.add_argument("--foot-z", type=float, default=-0.006)
ap.add_argument("--hem", type=float, default=0.55, help="褲管下緣位置：照片下緣到膝蓋之間的比例")
a = ap.parse_args()

im = Image.open(a.photo).convert("RGBA")
W, H = im.size
rgb = np.array(im.convert("RGB")).astype(np.float32)
alpha = np.array(im.getchannel("A"))

# 1) 內縮去背邊緣，再用最近鄰顏色填滿
solid = np.array(im.getchannel("A").filter(ImageFilter.MinFilter(5))) >= 250
idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
filled = rgb[idx[0], idx[1]]

# 2) 補腿
y_knee = int((a.top_z - a.knee_z) / a.s_z)
y_foot = int((a.top_z - a.foot_z) / a.s_z) + 40
y_hem = int(H + (y_knee - H) * a.hem)
tex = np.zeros((y_foot, W, 3), np.float32)
tex[:H] = filled

core = solid[640:H - 4, 130:330]
patch = rgb[640:H - 4, 130:330][core]
lum = patch.mean(axis=1)
shorts = np.median(patch[lum > np.percentile(lum, 50)], axis=0)  # 取偏亮的一半＝短褲布面，避開黑色 UFC 標
belly = rgb[430:520, 150:300][solid[430:520, 150:300]]
skin = np.median(belly, axis=0)
print("shorts", shorts.astype(int), "skin", skin.astype(int), "y_knee", y_knee, "y_hem", y_hem, "tex", W, "x", y_foot)

bottom = filled[H - 1]  # 手臂欄位往下延伸最後一列（手套黑色）
for y in range(H, y_foot):
    tex[y] = bottom
    leg = shorts if y < y_hem else skin
    # 腿部欄位（中央）用短褲/膚色，兩側手臂欄位維持延伸
    cx0, cx1 = int(W * 0.18), int(W * 0.82)
    tex[y, cx0:cx1] = leg
    # 簡單的左右羽化，避免硬邊
    for x in range(cx0 - 6, cx0):
        t = (x - (cx0 - 6)) / 6
        tex[y, x] = bottom[x] * (1 - t) + leg * t
    for x in range(cx1, cx1 + 6):
        t = (x - cx1) / 6
        tex[y, x] = leg * (1 - t) + bottom[x] * t

Image.fromarray(np.clip(tex, 0, 255).astype(np.uint8), "RGB").save(a.out)
print("saved", a.out)
