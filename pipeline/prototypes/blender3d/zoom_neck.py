"""開發用：把幾幀的頭頸區域放大並排，檢查連接。
用法：python zoom_neck.py <合成序列資料夾> <anchors.json> <輸出png>
"""
import json
import os
import sys

from PIL import Image

d, anc_path, out = sys.argv[1:4]
anchors = json.load(open(anc_path))["anchors"]
names = ["idle_00", "punch_02", "punch_03", "hit_01", "hit_03"]
sheet = Image.new("RGB", (360 * len(names), 400))
for i, n in enumerate(names):
    im = Image.open(os.path.join(d, n + ".png")).convert("RGBA")
    bg = Image.new("RGBA", im.size, (46, 52, 66, 255))
    bg.alpha_composite(im)
    x, y = anchors[n]["neck"]
    y += im.height - 512
    tile = bg.crop((int(x - 90), int(y - 110), int(x + 90), int(y + 90))).resize((360, 400), Image.NEAREST)
    sheet.paste(tile.convert("RGB"), (360 * i, 0))
sheet.save(out)
print("saved", out)
