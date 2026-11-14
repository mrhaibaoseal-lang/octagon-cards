"""Keep TRELLIS.2's head shape, let Gemini paint the colour: render clay views of the mesh in a 2x2 grid on green, have
Gemini repaint them as the fighter (one call, about NT$5), then project each view back onto the UV texture weighted by how
squarely the surface faces it. Texels no view covers keep the colour-fixed TRELLIS texture.

  D:/img2_3d/venv/Scripts/python.exe pipeline/img2_3d/gemini_paint.py --mesh gemini_real_fix [--reuse]
  -> _img2_3d/trellis2/<mesh>_paint.glb, work files in _img2_3d/paint/<mesh>/
"""
import argparse
import json
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageFilter

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "model3d"))
from common import OUT  # noqa: E402
import paint_skin as ps  # noqa: E402  (token and photo helpers only; the file is not changed)

BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
PROMPT = """The first image shows one 3D head sculpt from four angles on a pure green background, in a 2 by 2 grid:
top left: front; top right: seen from his left side (profile facing left of the picture); bottom left: back;
bottom right: seen from his right side (profile facing right of the picture).
Paint every view as the MMA fighter Ilia Topuria, photo-realistic. The next image is a photo of him for likeness: copy his real
skin tone, eyes, eyebrows, nose, lips, short haircut with faded sides, hairline and beard exactly.
VERY IMPORTANT: this is texture painting. Keep every head exactly where it is, the same size, outline and angle as the
sculpt; eyes, nose, mouth, ears, hairline and beard must sit exactly on the sculpt's own eyes, nose, mouth, ears, hair and beard.
Do not move, resize or redraw the outline. Even soft studio light from the front, no strong shadows, no highlights,
natural light skin tone like the photo. All four must be the same man. Keep the background pure flat green #00FF00.
No text, no logos."""
# Stylised: hand-painted look of a high-end 2D/3D hybrid animated series (painterly textures, visible brush strokes).
PROMPT_PAINTED = """The first image shows one 3D head sculpt from four angles on a pure green background, in a 2 by 2 grid:
top left: front; top right: seen from his left side (profile facing left of the picture); bottom left: back;
bottom right: seen from his right side (profile facing right of the picture).
Paint every view as the MMA fighter Ilia Topuria in a hand-painted stylised animation look: like painterly concept art
for a high-end animated series, flat shapes of colour with visible brush strokes, simplified planes on the face,
graphic dark eyebrows and lash lines, crisp painted eyes with a clear iris and a small catch light, beard and hair painted as
a few solid shapes with a handful of strands, warm skin with subtle cool tones, no photographic pores or noise.
The next image is a photo of him for likeness: keep his skin tone, eye shape, brows, nose, lips, short haircut with faded
sides, hairline and beard shape.
VERY IMPORTANT: this is texture painting. Keep every head exactly where it is, the same size, outline and angle as the
sculpt; eyes, nose, mouth, ears, hairline and beard must sit exactly on the sculpt's own eyes, nose, mouth, ears, hair and beard.
Do not move, resize or redraw the outline. Even soft light from the front, no strong cast shadows (shading is added later).
All four must be the same man. Keep the background pure flat green #00FF00. No text, no logos."""


def blender(*args):
    r = subprocess.run([BLENDER, "-b", "-P", str(HERE / "paint_head_blender.py"), "--", *map(str, args)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stdout[-2000:] + r.stderr[-2000:])


def gemini(grid, photo, model, prompt=PROMPT):
    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    token = ps.get_gcloud_token(ps.DEFAULT_ACCOUNT)
    client = genai.Client(vertexai=True, project=ps.DEFAULT_PROJECT, location="global", credentials=Credentials(token=token))
    resp = client.models.generate_content(
        model=model, contents=[grid, ps.prepare_reference_photo(photo), prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"],
                                           image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K")))
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                return Image.open(BytesIO(part.inline_data.data)).convert("RGB")
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", default="gemini_real_fix")
    ap.add_argument("--model", default="gemini-3-pro-image")
    ap.add_argument("--style", choices=["real", "painted"], default="real", help="painted = hand-painted animation look")
    ap.add_argument("--reuse", action="store_true", help="reuse painted.png (no new Gemini call)")
    ap.add_argument("--power", type=float, default=4.0, help="facing weight exponent")
    ap.add_argument("--painted", default="painted.png", help="painted grid to project (in the work folder)")
    ap.add_argument("--tag", default="", help="suffix for the output glb: <mesh>_paint<tag>.glb")
    ap.add_argument("--thr", type=float, default=0.15, help="total facing weight at which the new paint fully replaces the old texture")
    ap.add_argument("--occlusion", action="store_true", help="skip texels hidden behind other surfaces in a view (ray cast in Blender, cached as vis.npy)")
    ap.add_argument("--green-margin", type=int, default=0, help="also skip painted pixels this close to the green screen (px)")
    ap.add_argument("--fill", type=int, default=0, help="grow seen colour this many texels into texels no view sees, before falling back to the old texture")
    ap.add_argument("--debug-cover", action="store_true", help="texels the bake missed -> magenta, texels no view sees -> cyan")
    args = ap.parse_args()
    glb = OUT / "trellis2" / f"{args.mesh}.glb"
    work = OUT / "paint" / args.mesh
    work.mkdir(parents=True, exist_ok=True)
    if not (work / "view.json").exists():
        blender("render", glb, work)
    meta = json.loads((work / "view.json").read_text())
    S = meta["size"]
    grid = Image.new("RGB", (2 * S, 2 * S))
    for k, v in enumerate(meta["views"]):
        grid.paste(Image.open(work / v["file"]).convert("RGB"), ((k % 2) * S, (k // 2) * S))
    grid.save(work / "grid.png")
    painted = work / args.painted
    if not (args.reuse and painted.exists()):
        gemini(grid, ps.PRIVATE / "_source/topuria_ufc.png", args.model, PROMPT_PAINTED if args.style == "painted" else PROMPT).resize((2 * S, 2 * S), Image.LANCZOS).save(painted)
        print("painted", painted)
    if not (work / "pos.npy").exists():
        blender("bake", glb, work)

    if args.occlusion and not (work / "vis.npy").exists():
        blender("vis", glb, work)
    seen = np.load(work / "vis.npy") if args.occlusion else None  # texel -> view: no other surface in between
    pos = np.load(work / "pos.npy").reshape(-1, 3)
    nrm = np.load(work / "nrm.npy").reshape(-1, 3)
    covered = np.linalg.norm(nrm, axis=1) > 0.5
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-6)
    pimg = np.asarray(Image.open(painted).convert("RGB")).astype(np.float32)
    gimg = (pimg[..., 1] > 150) & (pimg[..., 0] < 120) & (pimg[..., 2] < 120)
    if args.green_margin:  # anti-aliased silhouette edges carry green into the skin colour
        gimg = np.asarray(Image.fromarray(gimg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * args.green_margin + 1))) > 0
    c, scale = np.array(meta["center"]), meta["scale"]
    acc = np.zeros((len(pos), 3), np.float32)
    wsum = np.zeros(len(pos), np.float32)
    for k, v in enumerate(meta["views"]):
        r = np.radians(v["yaw"])
        to_cam = np.array([np.sin(r), -np.cos(r), 0.0])
        right = np.array([np.cos(r), np.sin(r), 0.0])
        d = pos - c
        u = 0.5 + d @ right / scale
        vv = 0.5 - d[:, 2] / scale  # image row fraction from the top
        x = np.clip((u * S).astype(int), 0, S - 1) + (k % 2) * S
        y = np.clip((vv * S).astype(int), 0, S - 1) + (k // 2) * S
        col = pimg[y, x]
        green = gimg[y, x]
        inside = (u > 0) & (u < 1) & (vv > 0) & (vv < 1)
        vis = covered & inside
        if args.occlusion:
            vis &= seen[:, k]
        w = np.clip(nrm @ to_cam, 0, 1) ** args.power * (vis & ~green)
        acc += col * w[:, None]
        wsum += w

    scene = trimesh.load(glb)
    geom = next(iter(scene.geometry.values()))
    tex = np.asarray(geom.visual.material.baseColorTexture.convert("RGBA")).astype(np.float32)
    h, wd = tex.shape[:2]
    assert h * wd == len(pos), "texture size differs from the bake size"
    flat = tex.reshape(-1, 4)
    blend = np.clip(wsum / args.thr, 0, 1)[:, None]  # fade to the old texture where no view sees the surface squarely
    new = acc / np.maximum(wsum, 1e-6)[:, None]
    if args.fill:  # thin unseen strips (under the brow ridge, inside the nostrils) take the colour around them
        known = (blend[:, 0] > 0.5).reshape(h, wd)
        col = (new * known.reshape(-1, 1)).reshape(h, wd, 3)
        cnt = known.astype(np.float32)
        for _ in range(args.fill):
            sc_ = sum(np.roll(col, sh, ax) for sh in (1, -1) for ax in (0, 1)) + col
            sn = sum(np.roll(cnt, sh, ax) for sh in (1, -1) for ax in (0, 1)) + cnt
            grow = (cnt == 0) & (sn > 0) & covered.reshape(h, wd)
            col[grow] = sc_[grow] / sn[grow, None]
            cnt[grow] = 1
        grown = (cnt > 0).reshape(-1) & ~(blend[:, 0] > 0.5)
        new[grown] = col.reshape(-1, 3)[grown]
        blend[grown] = 1
    flat[:, :3] = flat[:, :3] * (1 - blend) + new * blend
    if args.debug_cover:
        flat[~covered, :3] = (255, 0, 255)
        flat[covered & (blend[:, 0] < 0.5), :3] = (0, 255, 255)
    geom.visual.material.baseColorTexture = Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8).reshape(tex.shape))
    out = OUT / "trellis2" / f"{args.mesh}_paint{args.tag}.glb"
    scene.export(out)
    print("saved", out, "painted share", round(float((blend[:, 0] > 0.5)[covered].mean()), 2))


if __name__ == "__main__":
    main()
