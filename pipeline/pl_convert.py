"""PixelLab 骨架動畫 -> 遊戲六姿勢素材（只含程式，不含任何圖）。

用法：
  uv run --no-project --with pillow --with numpy python -I pipeline/pl_convert.py \
      --src <解壓後的角色資料夾> --fighter <id> --out prototype/web/assets/private \
      [--pick pose=動畫名:格號[:flip]]...

--src 是 PixelLab 下載 zip 解壓後的資料夾（內含 Idle/animations/<動畫>/east/frame_NNN.png）。
預設對應（骨架八格 poses8 + 受擊三格 hit3b，格號從 0 起）：
  idle=poses8:0  punch=poses8:1  kick=poses8:2  hit=hit3b:2  shoot=poses8:5  down=poses8:7:flip
注意：受擊不能併進八格動畫（會碎成雜點），一定要另跑 3 格 hit3b；hit3b 的動作描述不能寫 punched（會畫出對手的手臂）。
down 要水平鏡像（頭在右）。每格裁邊、alpha 二值化、anchorX = 最低 20% 的平均 x。
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

DEFAULT = {
    "idle": ("poses8", 0, False),
    "punch": ("poses8", 1, False),
    "kick": ("poses8", 2, False),
    "hit": ("hit3b", 2, False),
    "shoot": ("poses8", 5, False),
    "down": ("poses8", 7, True),
}


def parse_pick(s):
    pose, rest = s.split("=", 1)
    parts = rest.split(":")
    return pose, (parts[0], int(parts[1]), len(parts) > 2 and parts[2] == "flip")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--fighter", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pick", action="append", default=[])
    ap.add_argument("--state", default="Idle", help="zip 內的狀態資料夾名（預設 Idle）")
    args = ap.parse_args()

    picks = dict(DEFAULT)
    picks.update(dict(parse_pick(p) for p in args.pick))
    src = Path(args.src) / args.state / "animations"
    out_root = Path(args.out)
    out = out_root / args.fighter
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for pose, (anim, idx, mirror) in picks.items():
        im = Image.open(src / anim / "east" / f"frame_{idx:03d}.png").convert("RGBA")
        a = np.asarray(im).copy()
        a[:, :, 3] = (a[:, :, 3] >= 128) * 255
        ys, xs = np.nonzero(a[:, :, 3])
        a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        if mirror:
            a = a[:, ::-1]
        img = Image.fromarray(a, "RGBA")
        img.save(out / f"{pose}.png")
        low = a[int(a.shape[0] * 0.8):, :, 3] > 0
        cols = np.nonzero(low.any(axis=0))[0]
        meta[pose] = {"w": img.width, "h": img.height,
                      "anchorX": round(float(cols.mean()) if len(cols) else img.width / 2, 1)}
        print(pose, meta[pose])
    mp = out_root / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {"fighters": {}}
    m["fighters"][args.fighter] = meta
    mp.write_text(json.dumps(m, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
