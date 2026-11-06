"""未裁切全身原圖（頭到腳，例如 1163×3324）→ 投影貼圖：去白邊、透明處用最近顏色填滿。

用法：uv run --with pillow --with numpy --with scipy python -I prep_orig_texture.py <原圖.png> <輸出tex.png>
取得原圖：fullBodyImageUrl 拿掉 `styles/<樣式>/s3/` 與 `?itok=…`（非官方介面，可能失效；約 4MB）。
"""
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
rgb = np.array(im.convert("RGB"))
solid = np.array(im.getchannel("A").filter(ImageFilter.MinFilter(5))) >= 250
idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
tex = Image.fromarray(rgb[idx[0], idx[1]], "RGB")
# 渲染精度遠低於原圖，Blender 的貼圖取樣沒有 mipmap，直接用大圖會雜訊化：先 BOX 縮小
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
tex = tex.resize((round(tex.width * SCALE), round(tex.height * SCALE)), Image.BOX)
tex.save(out)
print("saved", out, tex.size)
