"""Gemini paints the low-poly fighter (trial, 2026-11-15).

Clay views on green -> two Gemini calls (full body 4 views side by side; head 2x2) -> each texel of the UV atlas takes
the colour of the views that face it (weighted by facing, skipping blocked texels and green) -> small texture, nearest
sampling. Without --call no Gemini request is made (only the grids are written).

  uv run --no-project --with google-genai --with google-auth --with pillow --with numpy python -I \
      pipeline/lowpoly/paint_lowpoly.py [--call] [--reuse]
"""
import argparse
import json
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "model3d"))
import paint_skin as ps  # noqa: E402  (token and photo helpers only)

BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
PRIV = HERE.parent.parent / "prototype/web/assets/private"
LP = PRIV / "_lowpoly"
WORK = LP / "paint"
HEAD_Z = 1.545

STYLE = ("a late-1990s PC action game character skin: low-resolution hand-painted texture made over photo reference, "
         "clean readable shapes, flat colours with soft painted-in shading (light from above), slightly desaturated, "
         "crisp edges, no photographic noise, no pores")
BODY_PROMPT = """The first image shows one low-polygon 3D character model from four angles on a pure green background,
side by side from left to right: 1 front; 2 seen from his left side (he faces the left of the picture); 3 back;
4 seen from his right side (he faces the right of the picture).
Paint every view as the MMA fighter {name}, as {style}. The next image is a photo of him: copy his skin tone, short faded
haircut and full dark beard, his chest, neck and arm tattoos as simplified dark grey shapes, red fight shorts with a gold
pattern, black fingerless fight gloves, bare feet.
VERY IMPORTANT: this is texture painting. Keep every figure exactly where it is, the same size, outline, pose and angle as
the model; do not move, resize or redraw the outline, do not add anything outside it. Face, gloves, shorts, knees and feet
must sit exactly on the model's own. All four must be the same man. Keep the background pure flat green #00FF00.
No text, no logos, no letters anywhere."""
HEAD_PROMPT = """The first image shows one low-polygon 3D head from four angles on a pure green background, in a 2 by 2 grid:
top left: front; top right: seen from his left side (profile facing left of the picture); bottom left: back;
bottom right: seen from his right side (profile facing right of the picture).
Paint every view as the MMA fighter {name}, as {style}. The next image is a photo of him for likeness: copy his skin
tone, eyes, eyebrows, nose, lips, ears, short haircut with faded sides, hairline and full dark beard.
VERY IMPORTANT: this is texture painting. Keep every head exactly where it is, the same size, outline and angle as the
model; eyes, nose, mouth, ears, hairline and beard must sit exactly on the model's own. Do not move, resize or redraw the
outline. All four must be the same man. Keep the background pure flat green #00FF00. No text, no logos."""


def blender(blend, *args):
    r = subprocess.run([BLENDER, "-b", str(blend), "-P", str(HERE / "paint_blender.py"), "--", *map(str, args)],
                       capture_output=True, text=True)
    if r.returncode or "Error" in r.stderr[-500:]:
        sys.exit(r.stdout[-2000:] + r.stderr[-2000:])


def gemini(grid, photo, prompt, aspect, size):
    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    token = ps.get_gcloud_token(ps.DEFAULT_ACCOUNT)
    client = genai.Client(vertexai=True, project=ps.DEFAULT_PROJECT, location="global", credentials=Credentials(token=token))
    resp = client.models.generate_content(
        model="gemini-3-pro-image", contents=[grid, ps.prepare_reference_photo(photo), prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"],
                                           image_config=types.ImageConfig(aspect_ratio=aspect, image_size=size)))
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                return Image.open(BytesIO(part.inline_data.data)).convert("RGB")
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Ilia Topuria")
    ap.add_argument("--body-photo", default="_source/ilia-topuria_fullbody_ufc.png")
    ap.add_argument("--head-photo", default="_source/topuria_ufc.png")
    ap.add_argument("--call", action="store_true", help="make the Gemini calls (2 calls, about NT$10)")
    ap.add_argument("--only", choices=["body", "head"], default=None, help="call Gemini for one group only")
    ap.add_argument("--tex", type=int, default=1024, help="bake size")
    ap.add_argument("--out-tex", type=int, default=1024, help="final texture size")
    ap.add_argument("--power", type=float, default=3.0)
    ap.add_argument("--tag", default="")
    ap.add_argument("--green-margin", type=int, default=3, help="skip painted pixels this close to the green screen")
    a = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    clay = LP / "lowpoly_topuria_clay.blend"
    atlas = WORK / "atlas.blend"
    if not atlas.exists():
        blender(clay, "atlas", WORK)
    if not (WORK / "view.json").exists():
        blender(atlas, "render", WORK)
    meta = json.loads((WORK / "view.json").read_text())

    grids = {}
    for g, (cols, rows) in (("body", (4, 1)), ("head", (2, 2))):
        m = meta[g]
        W, H = m["W"], m["H"]
        grid = Image.new("RGB", (cols * W, rows * H))
        for k, v in enumerate(m["views"]):
            grid.paste(Image.open(WORK / v["file"]).convert("RGB"), ((k % cols) * W, (k // cols) * H))
        grid.save(WORK / f"grid_{g}.png")
        grids[g] = grid

    for g, prompt, photo, aspect, size in (("body", BODY_PROMPT, a.body_photo, "16:9", "2K"),
                                           ("head", HEAD_PROMPT, a.head_photo, "1:1", "1K")):
        out = WORK / f"painted_{g}.png"
        if a.call and (a.only in (None, g)):
            img = gemini(grids[g], PRIV / photo, prompt.format(name=a.name, style=STYLE), aspect, size)
            img.resize(grids[g].size, Image.LANCZOS).save(out)
            print("painted", out)
    if not all((WORK / f"painted_{g}.png").exists() for g in ("body", "head")):
        sys.exit(f"No painted grids yet (grids in {WORK}). Run with --call to ask Gemini.")

    if not (WORK / "pos.npy").exists():
        blender(atlas, "bake", WORK, "--tex", a.tex)
    if not (WORK / "vis.npy").exists():
        blender(atlas, "vis", WORK)
    pos = np.load(WORK / "pos.npy").reshape(-1, 3)
    nrm = np.load(WORK / "nrm.npy").reshape(-1, 3)
    seen = np.load(WORK / "vis.npy")
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-6)
    in_head = pos[:, 2] > HEAD_Z
    nose = (np.abs(pos[:, 0]) < 0.03) & (pos[:, 1] < -0.097) & (pos[:, 2] > 1.635) & (pos[:, 2] < 1.71)

    acc = np.zeros((len(pos), 3), np.float32)
    wsum = np.zeros(len(pos), np.float32)
    for g, cols in (("body", 4), ("head", 2)):
        m = meta[g]
        W, H, scale, c = m["W"], m["H"], m["scale"], np.array(m["center"])
        pimg = np.asarray(Image.open(WORK / f"painted_{g}.png").convert("RGB")).astype(np.float32)
        green = (pimg[..., 1] > pimg[..., 0] + 30) & (pimg[..., 1] > pimg[..., 2] + 30)  # incl. anti-aliased edges
        green = np.asarray(Image.fromarray(green.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * a.green_margin + 1))) > 0
        ppm = max(W, H) / scale  # pixels per metre
        part = in_head if g == "head" else ~in_head
        for k, v in enumerate(m["views"]):
            r = np.radians(v["yaw"])
            to_cam = np.array([np.sin(r), -np.cos(r), 0.0])
            right = np.array([np.cos(r), np.sin(r), 0.0])
            d = pos - c
            px = W / 2 + (d @ right) * ppm
            py = H / 2 - d[:, 2] * ppm
            inside = (px >= 0) & (px < W) & (py >= 0) & (py < H)
            x = np.clip(px.astype(int), 0, W - 1) + (k % cols) * W
            y = np.clip(py.astype(int), 0, H - 1) + (k // cols) * H
            col = pimg[y, x]
            w = np.clip(nrm @ to_cam, 0, 1) ** a.power * (covered & inside & seen[:, k] & ~green[y, x] & part)
            if g == "head" and v["yaw"] != 0:  # the profiles redraw the nose elsewhere; the nose takes the front view only
                w[nose] = 0
            acc += col * w[:, None]
            wsum += w

    T = a.tex
    known = (wsum > 1e-4).reshape(T, T)
    col = (acc / np.maximum(wsum, 1e-6)[:, None]).reshape(T, T, 3) * known[..., None]
    cov = covered.reshape(T, T)
    print("painted share of covered texels", round(float(known[cov].mean()), 3))
    # unseen texels (between the legs, under the arms) take the colour around them
    cnt = known.astype(np.float32)
    for _ in range(T):
        if (cnt[cov] > 0).all():
            break
        s_ = sum(np.roll(col * (cnt > 0)[..., None], sh, ax) for sh in (1, -1) for ax in (0, 1))
        n_ = sum(np.roll((cnt > 0).astype(np.float32), sh, ax) for sh in (1, -1) for ax in (0, 1))
        grow = (cnt == 0) & (n_ > 0)
        col[grow] = s_[grow] / n_[grow, None]
        cnt[grow] = 1
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).resize((a.out_tex, a.out_tex), Image.BOX)
    img.save(WORK / f"texture{a.tag}.png")
    blender(atlas, "final", WORK, "--texture", f"texture{a.tag}.png", "--tag", a.tag)
    print("done", WORK)


if __name__ == "__main__":
    main()
