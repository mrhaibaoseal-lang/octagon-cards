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


def key_to_green(img, thresh=38):
    """Gemini sometimes ignores the green background and paints a flat grey one: flood-fill it back to #00FF00 from the borders."""
    from PIL import ImageDraw
    if img.getpixel((2, 2))[1] > 200 and img.getpixel((2, 2))[0] < 80:
        return img
    img = img.copy()
    w, h = img.size
    for pt in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1), (w // 2, h - 2), (w // 3, 1), (2 * w // 3, 1)]:
        if img.getpixel(pt) != (0, 255, 0):
            ImageDraw.floodfill(img, pt, (0, 255, 0), thresh=thresh)
    return img


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
    "mcgregor": ("Conor McGregor",
                 "Irish featherweight and lightweight, fair skin with a light tan, short brown-ginger swept-back hair, "
                 "full ginger-brown beard, a large tattoo of a gorilla on the chest, tattoos across both shoulders and "
                 "collarbones and up the neck, a few smaller tattoos on the arms and belly",
                 "dark green"),
    "makhachev": ("Islam Makhachev",
                  "Dagestani lightweight, medium olive skin, very short dark buzzed hair, dark full beard shaped into a "
                  "short pointed chin beard, no tattoos at all, lean muscular build. Ignore the championship belt, the "
                  "gloves and every logo in the photo: they must NOT appear",
                  "white and grey patterned with black and gold trim"),
    "khabib": ("Khabib Nurmagomedov",
               "Dagestani lightweight wrestler, medium olive skin, very short dark buzzed hair, thick full dark beard "
               "(short on the cheeks, longer on the chin), heavy brow, stocky thick-necked powerfully muscular wrestler build, "
               "no tattoos at all, some dark chest hair. Ignore the championship belt, gloves and every logo: they must NOT appear",
               "plain black"),
    "oliveira": ("Charles Oliveira",
                 "Brazilian lightweight, light brown skin, short bleached platinum-blond hair, light dark stubble on the jaw, "
                 "lean wiry muscular build with long arms, black script-lettering tattoos on both sides of the neck, "
                 "a large black tattoo over the left shoulder and chest and more tattoos on the upper arms. "
                 "The arms must be held straight out away from the body exactly like the mannequin, NOT hanging down at the sides. "
                 "Ignore the championship belt, gloves and every logo in the photo: they must NOT appear",
                 "plain blue"),
    "hooker": ("Dan Hooker",
               "New Zealand lightweight, fair skin, short bleached platinum-blond hair, ginger-brown full beard, "
               "lean muscular build, heavily tattooed in black ink: a large skull with crossed swords and axes on the chest, "
               "a sword tattoo up the base of the throat, full dense sleeves on both arms (a skull and robed figure on the "
               "left arm, tribal Norse and Polynesian patterns), black script lettering across the stomach, "
               "and dense tribal pattern tattoos on both lower legs and knees",
               "black with a dark grey leaf pattern"),
    "sandhagen": ("Cory Sandhagen",
                  "American bantamweight, fair freckled skin, short neat ginger-brown hair, short ginger beard, "
                  "lean wiry muscular build with long limbs. His skin is completely clean and bare: absolutely NO tattoos, no ink and no markings anywhere on his body, arms, chest, back or legs. Each figure must fill the same large size as the mannequin. Ignore the gloves and every logo: they must NOT appear",
                  "plain dark grey"),
    "jones": ("Jon Jones",
              "American light heavyweight and heavyweight, dark brown skin, short black hair with a neat line-up, short "
              "full black beard, very big tall powerful build with broad shoulders, thick arms and a solid slightly soft belly, "
              "very long arms, one tattoo only: cursive script lettering across the upper left chest below the collarbone, "
              "otherwise no tattoos. Ignore the gloves and every logo: they must NOT appear",
              "dark grey with black panels"),
    "adesanya": ("Israel Adesanya",
                 "Nigerian-New Zealand middleweight, dark brown skin, very short black hair, tiny patch of chin hair, "
                 "very tall, lean and long-limbed with defined abs, large black tattoos: block letters across the collarbones "
                 "and upper chest, a large map-of-Africa shaped tattoo on the right chest and stomach, tattoos covering the "
                 "whole left upper arm and shoulder, smaller tattoos on the neck. In the middle view he must be turned three-quarters to the right exactly like the mannequin, NOT facing the camera. Ignore the gloves and every logo: they must NOT appear",
                 "navy blue with gold accents"),
    "holloway": ("Max Holloway",
                 "Hawaiian featherweight, light brown tan skin, short black hair with a neat fade, light stubble, lean "
                 "athletic build with defined abs, heavily tattooed in black ink: a large Polynesian tribal pattern covering "
                 "the whole chest and both shoulders, a full sleeve down the right arm, a small cherub with a halo on the "
                 "left ribs, script lettering across the stomach above the waist, hairy legs. Ignore the gloves and every logo: "
                 "they must NOT appear",
                 "white with red and blue flower pattern"),
    "poirier": ("Dustin Poirier",
                "American lightweight from Louisiana, light tanned skin, very short buzzed light-brown hair, short light stubble, "
                "compact muscular build with defined abs, lots of tattoos: full sleeve on the right arm with a red rose on the "
                "shoulder, a samurai mask and clouds, cursive script lettering across the upper chest, a tiger-stripe pattern "
                "on the left chest and shoulder, a full tattooed left forearm and upper arm. Ignore the gloves and every logo: "
                "they must NOT appear",
                "black with colourful tropical leaf pattern"),
    "pereira": ("Alex Pereira",
                "Brazilian light heavyweight, tan light-brown skin, very short buzzed dark hair, short dark stubble beard, "
                "powerfully muscular build with hairy chest, many tattoos: a red dragon on the right upper arm, a dragon face "
                "on the left chest and shoulder, an orange dragon across the stomach, a long curved dragon over the right "
                "collarbone, script lettering across the lower stomach, a feather on the right forearm, a wolf on the left "
                "forearm, an indigenous chief portrait on the right thigh. Ignore the gloves and every logo: they must NOT appear",
                "bright yellow"),
    "omalley": ("Sean O'Malley",
                "American bantamweight, fair skin, curly pink and magenta hair with blue on one side (compact curls staying close to the head, not a big afro; in a head grid put exactly one head in each grid cell, never two heads in one cell), thin dark goatee "
                "and light stubble, lean wiry build with slim arms, small face tattoos, many colourful tattoos: a large "
                "colourful owl with spread red and green wings across the whole chest, script lettering on the left stomach, "
                "colourful full sleeve on the left arm with roses, an eagle on the left ribs, more tattoos on the right arm "
                "and neck. Keep the limbs exactly as thick as the mannequin's limbs and the whole body at the same large size as the mannequin. Ignore the gloves and every logo: they must NOT appear",
                "white with light blue stripes"),
    "chimaev": ("Khamzat Chimaev",
                "Chechen-Swedish middleweight, light olive tan skin, short dark hair, very thick long full black beard, "
                "powerfully muscular build with broad shoulders and thick arms, no tattoos at all, some chest hair. "
                "Ignore the gloves and every logo: they must NOT appear",
                "white with grey pattern"),
    "gaethje": ("Justin Gaethje",
                "American lightweight, fair pale skin with a slight tan, short light-brown hair, short ginger-brown beard, "
                "rugged muscular build with thick legs and hairy forearms, a few tattoos: a vertical black tattoo down the "
                "right ribs, otherwise mostly clean skin. Ignore the championship belt, gloves and every logo: they must NOT appear",
                "white with blue and red stripes"),
}

PROMPT = """The first image is a 3D mannequin shown in three views on a pure green background, left to right: front view, three-quarter view facing right (seen slightly from above), and back view. The arms are held out to the sides and the legs are apart on purpose.
Repaint this exact mannequin as the MMA fighter {name}, using the second image only as a likeness reference. {look}.
VERY IMPORTANT: keep every figure exactly where it is, at exactly the same size, in exactly the same pose, with exactly the same outline.
Do not move, resize, rotate or re-pose anything: do NOT lower the arms, do NOT close the legs. Do not add or remove limbs.
The whole body from the top of the head down to the bare feet must be fully visible in every view, with green margin above the head and below the feet: do not zoom in and do not crop the legs or feet.
Keep the legs spread wide apart exactly like the mannequin, and the arms held out away from the body exactly like the mannequin. Only paint on top of the mannequin's body, staying inside its outline.
Paint: his face and hairstyle, beard, skin tone, all of his tattoos in the right places on chest, arms, back and legs,
and plain {shorts} fight shorts painted tight on the body, ending above the knee, with no lettering. Bare hands, no gloves. Barefoot.
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
    ap.add_argument("--photo", help="reference photo to use instead of the full-body / headshot in _source/")
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
    src = PRIVATE / "_source"
    photo_path = Path(args.photo) if args.photo else next(iter(sorted(src.glob(f"*{args.fighter}*fullbody*.png"))), None)
    if photo_path is None:  # no full-body photo (e.g. McGregor): fall back to the UFC headshot
        photo_path = next(iter(sorted(src.glob(f"*{args.fighter}*_ufc.png"))), None)
    if photo_path is None:
        sys.exit(f"No photo for {args.fighter} in _source/ (use --photo)")
    prompt = (HEAD_PROMPT if head else PROMPT).format(name=name, look=look, shorts=shorts)
    contents = [padded, prepare_reference_photo(photo_path)]
    if head:
        headshot = PRIVATE / "_source" / f"{args.fighter}_ufc.png"
        if headshot.exists() and headshot.resolve() != photo_path.resolve():
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
                img = key_to_green(Image.open(BytesIO(part.inline_data.data)).convert("RGB"))
                img.save(out)
                print(f"saved {out} {img.size}")
                return
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


if __name__ == "__main__":
    main()
