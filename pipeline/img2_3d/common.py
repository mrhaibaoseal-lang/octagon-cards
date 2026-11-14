"""Shared bits for the image-to-3D experiment: paths, input preparation and a VRAM / time recorder.
Everything it writes goes to the gitignored prototype/web/assets/private/_img2_3d/."""
import json
import subprocess
import threading
import time
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "prototype/web/assets/private"
OUT = PRIVATE / "_img2_3d"
INPUTS = {
    "photo": PRIVATE / "_source/topuria_ufc.png",  # UFC headshot cut-out (has alpha)
    "gemini_cartoon": PRIVATE / "_model3d/topuria/head_front.png",  # existing Gemini head (has alpha)
    "gemini_real": OUT / "inputs/topuria_gemini_real.png",  # new Gemini head on white
}


def cutout(path):
    """RGBA cut-out: keep the file's alpha, or flood-fill a plain light background away from the borders."""
    img = Image.open(path).convert("RGBA")
    if img.getchannel("A").getextrema()[0] < 250:
        return img
    rgb = img.convert("RGB")
    w, h = rgb.size
    key = (255, 0, 255)
    for pt in [(1, 1), (w - 2, 1), (w // 2, 1), (1, h // 3), (w - 2, h // 3)]:
        ImageDraw.floodfill(rgb, pt, key, thresh=28)
    a = Image.eval(Image.merge("RGB", [c.point(lambda v, t=t: 255 if v == t else 0) for c, t in zip(rgb.split(), key)]).convert("L"),
                   lambda v: 0 if v == 255 else 255)
    img.putalpha(a)
    return img


def neck_cut(img):
    """Row just above the shoulders: below the narrowest row of the lower head, where the width passes 1.4x the neck."""
    import numpy as np
    a = np.asarray(img.getchannel("A")) > 128
    rows = np.nonzero(a.any(1))[0]
    top, bot = rows[0], rows[-1]
    w = a.sum(1)
    lo = top + (bot - top) * 45 // 100
    neck = lo + int(np.argmin(w[lo:bot - (bot - top) // 10]))
    y = neck
    while y < bot and w[y] < w[neck] * 1.4:
        y += 1
    return int(y)


def prepared(name, size=1024, fill=0.85):
    """Square, centred RGBA cut-out with the subject filling `fill` of the frame (what TripoSR / TRELLIS expect)."""
    dst = OUT / "inputs" / f"{name}_rgba.png"
    if dst.exists():
        return dst
    if name.endswith("_head"):  # head and neck only: TRELLIS.2 turns a big chest into a solid block
        img = Image.open(prepared(name[:-5])).convert("RGBA")
        img = img.crop((0, 0, img.width, neck_cut(img)))
    else:
        img = cutout(INPUTS[name])
    img = img.crop(img.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox())
    s = max(img.size) / fill
    canvas = Image.new("RGBA", (round(s), round(s)), (0, 0, 0, 0))
    canvas.paste(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((size, size), Image.LANCZOS).save(dst)
    return dst


class Recorder:
    """Wall time plus peak GPU memory, sampled from nvidia-smi (whole card, so the baseline is subtracted)."""

    def __init__(self, tool, inp):
        self.tool, self.inp, self.peak, self._stop = tool, inp, 0, False

    def _used(self):
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True)
        return int(r.stdout.strip().splitlines()[0])

    def _poll(self):
        while not self._stop:
            self.peak = max(self.peak, self._used())
            time.sleep(0.25)

    def __enter__(self):
        self.base = self._used()
        self.t0 = time.time()
        self.th = threading.Thread(target=self._poll, daemon=True)
        self.th.start()
        return self

    def done(self, ok, note="", **extra):
        self._stop = True
        self.th.join()
        rec = {"tool": self.tool, "input": self.inp, "ok": ok, "seconds": round(time.time() - self.t0, 1),
               "vram_peak_mb": self.peak, "vram_baseline_mb": self.base, "note": note, **extra}
        log = OUT / "results.jsonl"
        with log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(rec)
        return rec

    def __exit__(self, *exc):
        self._stop = True
