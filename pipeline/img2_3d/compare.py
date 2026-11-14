"""Render every result mesh at 8 angles with Blender and stack them into _img2_3d/comparison.png
(one row per tool x input, the input picture on the left, time and VRAM from results.jsonl as the label).

  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/compare.py
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, prepared  # noqa: E402

BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
HERE = Path(__file__).parent
# Per-tool turn so every mesh stands Z-up with the face toward the camera at angle 0.
TOOLS = {"triposr": ("TripoSR", ["--rot-x", "-90", "--rot-z", "-90", "--head", "0.75"]),
         "trellis2": ("TRELLIS.2", ["--head", "0.65"])}
INPUTS = ["photo", "gemini_real", "gemini_cartoon"]  # TRELLIS.2 skipped the cartoon (TripoSR showed it fails)
S = 240


def main():
    recs = {}
    log = OUT / "results.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            recs[(r["tool"], r["input"])] = r
    font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 20)
    rows = []
    for key, (label, rot) in TOOLS.items():
        for name in INPUTS:
            mesh = OUT / key / f"{name}.glb"
            r = recs.get((label, name))
            strip = None
            if mesh.exists():
                png = OUT / "renders" / f"{key}_{name}.png"
                subprocess.run([BLENDER, "-b", "-P", str(HERE / "render_turntable.py"), "--", str(mesh), str(png),
                                *rot, "--size", str(S)], capture_output=True, check=True)
                strip = Image.open(png).convert("RGB")
            elif r is None:
                continue
            row = Image.new("RGB", (S * 9 + 260, S), (46, 48, 56))
            src = Image.open(prepared(name)).convert("RGBA").resize((S, S))
            bg = Image.new("RGBA", (S, S), (46, 48, 56, 255))
            row.paste(Image.alpha_composite(bg, src).convert("RGB"), (0, 0))
            if strip:
                row.paste(strip, (S, 0))
            d = ImageDraw.Draw(row)
            x = S * 9 + 12
            d.text((x, 20), label, font=font, fill=(255, 255, 255))
            d.text((x, 50), name, font=font, fill=(200, 200, 200))
            if r:
                d.text((x, 90), "成功" if r["ok"] else "失敗", font=font, fill=(120, 230, 120) if r["ok"] else (240, 110, 110))
                d.text((x, 120), f"{r['seconds']} 秒", font=font, fill=(220, 220, 220))
                d.text((x, 150), f"顯存峰值 {r['vram_peak_mb'] - r['vram_baseline_mb']} MB", font=font, fill=(220, 220, 220))
            rows.append(row)
    sheet = Image.new("RGB", (rows[0].width, S * len(rows) + 40), (30, 31, 36))
    d = ImageDraw.Draw(sheet)
    for i, ang in enumerate(["輸入"] + [f"{45 * k}°" for k in range(8)]):
        d.text((i * S + S // 2 - 20, 8), ang, font=font, fill=(230, 230, 230))
    for i, row in enumerate(rows):
        sheet.paste(row, (0, 40 + i * S))
    sheet.save(OUT / "comparison.png")
    print("saved", OUT / "comparison.png", len(rows), "rows")


if __name__ == "__main__":
    main()
