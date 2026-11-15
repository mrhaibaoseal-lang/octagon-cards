"""Gemini paints the low-poly fighter (trial, 2026-11-15).

Clay views on green -> two Gemini calls (full body 5 views side by side incl. one from above; head 2x2) -> each texel of the UV atlas takes
the colour of the views that face it (weighted by facing, skipping blocked texels and green) -> small texture, nearest
sampling. Without --call no Gemini request is made (only the grids are written).

  uv run --no-project --with google-genai --with google-auth --with pillow --with numpy python -I \
      pipeline/lowpoly/paint_lowpoly.py [--call] [--only body|head] [--coverage]
  Default model: the MPFB body (build_mpfb.py, 5,000 tris), painted in its arms-out paint pose and shown in the stance
  -> _lowpoly/paint_mpfb/. --coverage reports which share of the
  surface the clay views can reach, without Gemini. The v2 tube model: --clay _lowpoly/lowpoly_topuria_clay.blend
  --meta none --pose none --work _lowpoly/paint (its old 4-view grids no longer match the 5-view layout).
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

STYLE = ("a late-1990s PC first-person-shooter character skin: a low-resolution texture assembled from real photographs "
         "(photo-collage look, not a cartoon, not a clean illustration), photorealistic skin and fabric, with the shading "
         "baked into the texture: dark creases and folds in the fabric, muscle definition and shadows under the pecs, "
         "between the abs, in the elbows and knees, light from above; slightly dirty and worn, a little grime and sweat, "
         "strong contrast, colours a bit desaturated toward grey")
BODY_PROMPT = """The first image shows one low-polygon 3D character model from four angles on a pure green background,
side by side from left to right: 1 front; 2 seen from his left side (he faces the left of the picture); 3 back;
4 seen from his right side (he faces the right of the picture); 5 seen from directly above (top of his head in the
middle, his back toward the top of the picture, his gloves and toes toward the bottom).
Paint every view as the MMA fighter {name}, as {style}. The next image is a photo of him: copy his skin tone, short faded
haircut and full dark beard, his chest, neck and arm tattoos as faded dark grey ink, red fight shorts with a gold
pattern and fabric folds, black fingerless fight gloves with worn leather creases, bare feet.
The shorts must have NO logo, NO brand mark, NO emblem and NO lettering at all: only the red fabric and the gold pattern.
VERY IMPORTANT: this is texture painting. Keep every figure exactly where it is, the same size, outline, pose and angle as
the model; do not move, resize or redraw the outline, do not add anything outside it. Face, gloves, shorts, knees and feet
must sit exactly on the model's own. All five must be the same man. Keep the background pure flat green #00FF00.
No text, no logos, no letters anywhere."""
HEAD_PROMPT = """The first image shows one low-polygon 3D head from four angles on a pure green background, in a 2 by 2 grid:
top left: front; top right: seen from his left side (profile facing left of the picture); bottom left: back;
bottom right: seen from his right side (profile facing right of the picture).
Paint every view as the MMA fighter {name}, as {style}. The next image is a photo of him for likeness: copy his skin
tone, eyes, eyebrows, nose, lips, ears, short haircut with faded sides, hairline and full dark beard. Shading is painted
into the skin: shadows in the eye sockets, under the nose, cheekbones and jaw, real skin texture, strong contrast.
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
    ap.add_argument("--green-margin", type=int, default=1, help="skip painted pixels this close to the green screen")
    ap.add_argument("--clay", default="_lowpoly/mpfb/mpfb_feather_muscle_5000_guide.blend", help="painted in this pose (private/)")
    ap.add_argument("--meta", default="_lowpoly/mpfb/mpfb_feather_muscle_guide_meta.json", help="build_mpfb meta, or none")
    ap.add_argument("--pose", default="_lowpoly/mpfb/mpfb_feather_muscle_5000.blend", help="shown in this pose (private/), or none")
    ap.add_argument("--work", default="_lowpoly/paint_mpfb", help="relative to private/")
    ap.add_argument("--coverage", action="store_true", help="only report how much of the surface the views reach")
    a = ap.parse_args()
    WORK = PRIV / a.work
    WORK.mkdir(parents=True, exist_ok=True)
    if a.meta != "none":
        bm_ = json.loads((PRIV / a.meta).read_text())
        head_z = bm_["head_z"]
        nose_c, nose_h = np.array(bm_["nose"]["center"]), bm_["nose"]["half"]
    else:  # v2 tube model
        head_z, nose_c, nose_h = 1.545, np.array([0.0, -0.097, 1.6725]), [0.03, 0.0375]
    clay = PRIV / a.clay
    atlas = WORK / "atlas.blend"
    if not atlas.exists():
        blender(clay, "atlas", WORK, "--head-z", head_z)
    if not (WORK / "view.json").exists():
        blender(atlas, "render", WORK, "--head-z", head_z)
    meta = json.loads((WORK / "view.json").read_text())
    if a.coverage:
        if not (WORK / "pos.npy").exists():
            blender(atlas, "bake", WORK, "--tex", a.tex, "--head-z", head_z)
        if not (WORK / "vis.npy").exists():
            blender(atlas, "vis", WORK)
        nrm = np.load(WORK / "nrm.npy").reshape(-1, 3)
        seen = np.load(WORK / "vis.npy")
        cov = np.linalg.norm(nrm, axis=1) > 0.5
        n_ = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-6)
        for k, v in enumerate(meta["body"]["views"]):
            seen[:, k] &= (n_ @ np.array(v["to_cam"])) > 0.05
        cov &= np.load(WORK / "outside.npy")  # only surface that can be seen at all
        part = np.load(WORK / "part.npy").reshape(-1)
        print("of the outside surface: 4 side views reach", round(float(seen[cov, :4].any(1).mean()), 3),
              "| with the top view", round(float(seen[cov].any(1).mean()), 3),
              "| head", round(float(seen[cov & part].any(1).mean()), 3), "body", round(float(seen[cov & ~part].any(1).mean()), 3))
        return

    grids = {}
    for g, (cols, rows) in (("body", (len(meta["body"]["views"]), 1)), ("head", (2, 2))):
        m = meta[g]
        W, H = m["W"], m["H"]
        grid = Image.new("RGB", (cols * W, rows * H))
        for k, v in enumerate(m["views"]):
            grid.paste(Image.open(WORK / v["file"]).convert("RGB"), ((k % cols) * W, (k // cols) * H))
        grid.save(WORK / f"grid_{g}.png")
        grids[g] = grid

    for g, prompt, photo, aspect, size in (("body", BODY_PROMPT, a.body_photo, "21:9", "2K"),
                                           ("head", HEAD_PROMPT, a.head_photo, "1:1", "1K")):
        out = WORK / f"painted_{g}.png"
        if a.call and (a.only in (None, g)):
            img = gemini(grids[g], PRIV / photo, prompt.format(name=a.name, style=STYLE), aspect, size)
            img.resize(grids[g].size, Image.LANCZOS).save(out)
            print("painted", out)
    if not all((WORK / f"painted_{g}.png").exists() for g in ("body", "head")):
        sys.exit(f"No painted grids yet (grids in {WORK}). Run with --call to ask Gemini.")

    if not (WORK / "pos.npy").exists():
        blender(atlas, "bake", WORK, "--tex", a.tex, "--head-z", head_z)
    if not (WORK / "vis.npy").exists():
        blender(atlas, "vis", WORK)
    pos = np.load(WORK / "pos.npy").reshape(-1, 3)
    nrm = np.load(WORK / "nrm.npy").reshape(-1, 3)
    seen = np.load(WORK / "vis.npy")
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-6)
    in_head = np.load(WORK / "part.npy").reshape(-1) if (WORK / "part.npy").exists() else pos[:, 2] > head_z
    nose = (np.abs(pos[:, 0] - nose_c[0]) < nose_h[0]) & (pos[:, 1] < nose_c[1] + 0.02) & (np.abs(pos[:, 2] - nose_c[2]) < nose_h[1])

    acc = np.zeros((len(pos), 3), np.float32)
    wsum = np.zeros(len(pos), np.float32)
    for g, cols in (("body", len(meta["body"]["views"])), ("head", 2)):
        m = meta[g]
        W, H = m["W"], m["H"]
        pimg = np.asarray(Image.open(WORK / f"painted_{g}.png").convert("RGB")).astype(np.float32)
        green = (pimg[..., 1] > pimg[..., 0] + 30) & (pimg[..., 1] > pimg[..., 2] + 30)  # incl. anti-aliased edges
        green = np.asarray(Image.fromarray(green.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * a.green_margin + 1))) > 0
        part = in_head if g == "head" else ~in_head
        for k, v in enumerate(m["views"]):
            ppm = max(W, H) / v["scale"]  # pixels per metre
            to_cam, right, up = np.array(v["to_cam"]), np.array(v["right"]), np.array(v["up"])
            d = pos - np.array(v["center"])
            px = W / 2 + (d @ right) * ppm
            py = H / 2 - (d @ up) * ppm
            inside = (px >= 0) & (px < W) & (py >= 0) & (py < H)
            x = np.clip(px.astype(int), 0, W - 1) + (k % cols) * W
            y = np.clip(py.astype(int), 0, H - 1) + (k // cols) * H
            col = pimg[y, x]
            vpart = part if v["yaw"] is not None else np.ones_like(part)  # the top view also paints the crown of the head
            w = np.clip(nrm @ to_cam, 0, 1) ** a.power * (covered & inside & seen[:, k] & ~green[y, x] & vpart)
            if g == "head" and v["yaw"] != 0:  # the profiles redraw the nose elsewhere; the nose takes the front view only
                w[nose] = 0
            acc += col * w[:, None]
            wsum += w

    T = a.tex
    known = (wsum > 1e-4).reshape(T, T)
    col = (acc / np.maximum(wsum, 1e-6)[:, None]).reshape(T, T, 3) * known[..., None]
    cov = covered.reshape(T, T)
    print("painted share of covered texels", round(float(known[cov].mean()), 3))
    if (WORK / "outside.npy").exists():
        out_ = np.load(WORK / "outside.npy").reshape(T, T) & cov
        print("painted share of the outside surface", round(float(known[out_].mean()), 3))
        miss = out_ & ~known
        zz = pos[:, 2].reshape(T, T)
        print("unpainted outside by height (m):", {f"{lo:.1f}": round(float((miss & (zz >= lo) & (zz < lo + 0.3)).sum() / max(miss.sum(), 1)), 2)
                                                 for lo in np.arange(0, 1.8, 0.3)})
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
    blender(atlas, "final", WORK, "--texture", f"texture{a.tag}.png", "--tag", a.tag,
            *(["--pose-blend", PRIV / a.pose] if a.pose != "none" else []))
    print("done", WORK)


if __name__ == "__main__":
    main()
