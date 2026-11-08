"""Ask Gemini (Vertex AI, billed to the user's GCP credits) to paint a fighter over the mannequin guide sheet.

  uv run --no-project --with google-genai --with google-auth --with pillow python -I pipeline/model3d/paint_skin.py --fighter topuria

Reads  prototype/web/assets/private/_model3d/<fighter>/guide_sheet.png and the fighter's full-body photo in _source/.
Writes prototype/web/assets/private/_model3d/<fighter>/painted_sheet.png (an existing one is kept as painted_sheet_<n>.png).
Each call is one paid image generation (about US$0.15-0.25); there are no automatic retries.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "prototype/web/assets/private"
# The GCP project and gcloud account are personal: they live in the gitignored pipeline/model3d/local.json
# ({"project": "...", "account": "..."}) or in GCP_PROJECT / GCLOUD_ACCOUNT, never in this public repo.
LOCAL = Path(__file__).with_name("local.json")
_cfg = json.loads(LOCAL.read_text()) if LOCAL.exists() else {}
DEFAULT_PROJECT = os.environ.get("GCP_PROJECT") or _cfg.get("project")
DEFAULT_ACCOUNT = os.environ.get("GCLOUD_ACCOUNT") or _cfg.get("account")


def get_gcloud_token(account=None):
    """OAuth token from the local gcloud CLI, so Vertex AI bills the GCP project's credits."""
    gbin = Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    cmd = [str(gbin) if gbin.exists() else "gcloud", "auth", "print-access-token"] + ([f"--account={account}"] if account else [])
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None


def prepare_reference_photo(path, max_height=1024):
    """Transparent UFC cut-out onto a neutral dark card, resized for upload."""
    img = Image.open(path).convert("RGBA")
    bg = Image.new("RGB", img.size, (32, 36, 48))
    bg.paste(img, mask=img.getchannel("A"))
    if bg.height > max_height:
        k = max_height / bg.height
        bg = bg.resize((max(1, int(bg.width * k)), max_height), Image.Resampling.LANCZOS)
    return bg

# name, look, shorts. Keep descriptions plain; no brand names.
FIGHTERS = {
    "topuria": ("Ilia Topuria",
                "Georgian-Spanish featherweight, olive skin, short dark hair with a skin fade, full dark well-groomed beard, "
                "many black tattoos covering the chest, both arms and the back",
                "black with red trim"),
}

PROMPT = """The first image is a 3D mannequin shown in three views on a pure green background, left to right: front view, three-quarter view facing right (seen slightly from above), and back view. The arms are held out to the sides and the legs are apart on purpose.
Repaint this exact mannequin as the MMA fighter {name}, using the second image only as a likeness reference. {look}.
VERY IMPORTANT: keep every figure exactly where it is, at exactly the same size, in exactly the same pose, with exactly the same outline.
Do not move, resize, rotate or re-pose anything: do NOT lower the arms, do NOT close the legs. Do not add or remove limbs. Only paint on top of the mannequin's body, staying inside its outline.
Paint: his face and hairstyle, beard, skin tone, all of his tattoos in the right places on chest, arms, back and legs,
and {shorts} fight shorts painted tight on the body. Bare hands, no gloves. Barefoot.
The three views must show the same man with the same tattoos, consistent from every angle.
Style: detailed fighting game illustration, clean shapes, soft even lighting, very light shading,
no black outline around the body, no cast shadows. Keep the background pure flat green #00FF00.
No text, no logos, no brand marks."""


HEAD_PROMPT = """The first image shows a bald 3D mannequin head and neck from six angles on a pure green background, in a 3 by 2 grid:
top row: profile facing right, three-quarter facing right, slightly turned right; bottom row: front, back three-quarter, back.
Repaint every head as the MMA fighter {name}. The next images are photos of him for likeness: copy his real face, eyes, nose,
eyebrows, hairline, haircut and beard shape exactly. {look}.
VERY IMPORTANT: keep each head exactly where it is, the same size and turned to exactly the same angle as the mannequin.
The face, jaw, ears and neck must sit on the mannequin's face, jaw, ears and neck. Hair and beard may add natural volume
just outside the bald outline. End the neck with a clean horizontal edge where the mannequin's neck ends.
All six must be the same man, consistent from every angle.
Match the art style, skin tone and soft even lighting of the last image (his already painted body): detailed fighting game
illustration, clean shapes, very light shading, no black outline, no cast shadows.
Keep the background pure flat green #00FF00. No text, no logos, no brand marks."""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fighter", required=True)
    ap.add_argument("--model", default="gemini-3-pro-image")
    ap.add_argument("--project", default=DEFAULT_PROJECT)
    ap.add_argument("--account", default=DEFAULT_ACCOUNT)
    ap.add_argument("--part", choices=["body", "head"], default="body")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.project and not args.dry_run:
        sys.exit("No GCP project: write pipeline/model3d/local.json or set GCP_PROJECT")

    name, look, shorts = FIGHTERS[args.fighter]
    d = PRIVATE / "_model3d" / args.fighter
    head = args.part == "head"
    guide = Image.open(d / ("head_guide.png" if head else "guide_sheet.png")).convert("RGB")
    # Pad to the closest aspect the model can return, so it has no reason to rearrange the figures.
    aw, ah = (3, 2) if head else (21, 9)
    tw, th = guide.width, round(guide.width * ah / aw)
    padded = Image.new("RGB", (tw, max(th, guide.height)), (0, 255, 0))
    padded.paste(guide, (0, (padded.height - guide.height) // 2))
    photo_path = next(iter(sorted((PRIVATE / "_source").glob(f"*{args.fighter}*fullbody*.png"))), None)
    if photo_path is None:
        sys.exit(f"No full-body photo for {args.fighter} in _source/")
    prompt = (HEAD_PROMPT if head else PROMPT).format(name=name, look=look, shorts=shorts)
    contents = [padded, prepare_reference_photo(photo_path)]
    if head:
        headshot = PRIVATE / "_source" / f"{args.fighter}_ufc.png"
        if headshot.exists():
            contents.append(prepare_reference_photo(headshot))
        contents.append(Image.open(d / "painted_sheet.png").convert("RGB"))
    contents.append(prompt)
    print(f"guide {guide.size} -> padded {padded.size}; photo {photo_path.name}; model {args.model}")
    if args.dry_run:
        print(prompt)
        return

    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    token = get_gcloud_token(args.account)
    if not token:
        sys.exit("No gcloud access token. Run: gcloud auth login")
    client = genai.Client(vertexai=True, project=args.project, location="global", credentials=Credentials(token=token))
    resp = client.models.generate_content(
        model=args.model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=types.ImageConfig(aspect_ratio=f"{aw}:{ah}", image_size="2K"),
        ),
    )
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                stem = "painted_head" if head else "painted_sheet"
                out = d / f"{stem}.png"
                if out.exists():
                    n = 1
                    while (d / f"{stem}_{n}.png").exists():
                        n += 1
                    out.rename(d / f"{stem}_{n}.png")
                img = Image.open(BytesIO(part.inline_data.data)).convert("RGB")
                img.save(out)
                print(f"saved {out} {img.size}")
                return
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


if __name__ == "__main__":
    main()
