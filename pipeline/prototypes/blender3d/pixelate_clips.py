"""把 render_clips.py 的序列圖像素化並排成對照表（比 pixelate_sprites.py 少了「裁邊」以外的照片處理）。

用法：uv run --with pillow python pixelate_clips.py <序列圖資料夾> <輸出png> [高度px=96] [色數=32]
同一個動作的所有幀共用同一個裁切框與縮放比例，這樣動畫不會抖。
"""
import glob
import os
import sys

from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
H = int(sys.argv[3]) if len(sys.argv) > 3 else 96
COLORS = int(sys.argv[4]) if len(sys.argv) > 4 else 32

files = sorted(glob.glob(os.path.join(src, "*.png")))
imgs = {f: Image.open(f).convert("RGBA") for f in files}

# 全部幀共用的裁切框 → 所有動作比例一致，腳底對齊
boxes = [im.getchannel("A").getbbox() for im in imgs.values()]
x0 = min(b[0] for b in boxes)
y0 = min(b[1] for b in boxes)
x1 = max(b[2] for b in boxes)
y1 = max(b[3] for b in boxes)
scale = H / (y1 - y0)
W = max(1, round((x1 - x0) * scale))


def pixelate(im):
    im = im.crop((x0, y0, x1, y1))
    rgb = Image.new("RGB", im.size, (0, 0, 0))
    rgb.paste(im, mask=im.getchannel("A"))
    alpha = im.getchannel("A")
    rgb = rgb.resize((W, H), Image.BOX)
    alpha = alpha.resize((W, H), Image.BOX).point(lambda v: 255 if v >= 128 else 0)
    q = rgb.quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    px = q.load()
    ap = alpha.load()
    res = Image.new("RGBA", (W + 2, H + 2), (0, 0, 0, 0))
    rp = res.load()
    for y in range(H):
        for x in range(W):
            if ap[x, y]:
                rp[x + 1, y + 1] = px[x, y] + (255,)
    # 1px 深色描邊
    base = res.copy().load()
    for y in range(H + 2):
        for x in range(W + 2):
            if base[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W + 2 and 0 <= ny < H + 2 and base[nx, ny][3]:
                        rp[x, y] = (24, 18, 28, 255)
                        break
    return res


sprites = [(os.path.basename(f), pixelate(imgs[f])) for f in files]

# 對照表：每個動作一列，4 倍放大（最近鄰）
rows = {}
for name, sp in sprites:
    rows.setdefault(name.rsplit("_", 1)[0], []).append(sp)
Z = 4
cw, ch = W + 2, H + 2
sheet = Image.new(
    "RGBA",
    (max(len(v) for v in rows.values()) * cw * Z, len(rows) * ch * Z),
    (46, 52, 66, 255),
)
for r, (_, frames) in enumerate(rows.items()):
    for c, sp in enumerate(frames):
        sheet.alpha_composite(sp.resize((cw * Z, ch * Z), Image.NEAREST), (c * cw * Z, r * ch * Z))
sheet.convert("RGB").save(out)
print("saved", out, "sprite", cw, "x", ch)
