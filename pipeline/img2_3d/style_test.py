"""Style test (2026-11-15): one Gemini image per candidate look for the same fighter, so the user can compare.
Each call is ~NT$5 on the user's GCP credits.

  uv run --no-project --with google-genai --with google-auth --with pillow python -I pipeline/img2_3d/style_test.py --fighter topuria --style portrait
  ... --style poster

portrait (A): painted half-body card portrait, the same hand-painted animation look as the 3D Arcane-style head.
poster   (B): the in-ring look target: full body in a fighting stance, limited-palette flat poster shapes.
Output: <private>/_style_test/<fighter>_<style>.png. Prompts describe the look, never a title; no promotion logos.
"""
import argparse
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "model3d"))
import paint_skin as ps  # noqa: E402
from PIL import Image  # noqa: E402

OUT = ps.PRIVATE / "_style_test"

LIKENESS = ("Keep his exact face shape, nose, eyes, eyebrows, ears, hairline, hair, beard and tattoos from the reference "
            "photos so he is instantly recognisable. No text, no logos, no brand names, no watermark.")

PROMPTS = {
    "portrait": (
        "Using the reference photos of this man, paint ONE half-body character portrait for a trading card, in a "
        "hand-painted 2D animation style for adults: visible painterly brush strokes, slightly exaggerated strong facial "
        "structure (heavier brow ridge, defined jaw and cheekbones) while staying true to his features, warm skin with "
        "cool blue-violet shadows, a thin cool rim light on one side, soft painted background in dark teal and orange "
        "haze. Shirtless MMA fighter, fists raised loosely in front of the chest, confident look straight at the viewer, "
        "framed from the waist up, head in the upper third. " + LIKENESS
    ),
    "poster": (
        "Using the reference photos of this man, draw ONE full-body figure of him in an orthodox MMA fighting stance, "
        "three-quarter view, whole body visible from head to feet, standing on a plain ground. Style: bold fight-poster "
        "illustration made only of large flat colour shapes, no outlines, no gradients, no texture: exactly three tones "
        "for skin (light, mid, deep shadow), shadows are cool and dark, one accent colour (deep red) used only on his "
        "shorts and gloves, everything else in warm off-white, charcoal and black. Simple graphic shapes for the "
        "muscles, hair and beard as a few solid masses. Plain flat off-white background. " + LIKENESS
    ),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fighter", required=True)
    ap.add_argument("--style", required=True, choices=sorted(PROMPTS))
    ap.add_argument("--model", default="gemini-3-pro-image")
    args = ap.parse_args()
    if not ps.DEFAULT_PROJECT:
        sys.exit("No GCP project: write pipeline/model3d/local.json or set GCP_PROJECT")
    src = ps.PRIVATE / "_source"
    photos = [p for p in [src / f"{args.fighter}_ufc.png", *sorted(src.glob(f"*{args.fighter}*fullbody*.png"))] if p.exists()]
    if not photos:
        sys.exit(f"No photo for {args.fighter} in _source/")

    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    token = ps.get_gcloud_token(ps.DEFAULT_ACCOUNT)
    if not token:
        sys.exit("No gcloud access token. Run: gcloud auth login")
    client = genai.Client(vertexai=True, project=ps.DEFAULT_PROJECT, location="global", credentials=Credentials(token=token))
    aspect = "3:4" if args.style == "portrait" else "2:3"
    resp = client.models.generate_content(
        model=args.model,
        contents=[*(ps.prepare_reference_photo(p) for p in photos), PROMPTS[args.style]],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=types.ImageConfig(aspect_ratio=aspect, image_size="1K"),
        ),
    )
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                OUT.mkdir(parents=True, exist_ok=True)
                out = OUT / f"{args.fighter}_{args.style}.png"
                Image.open(BytesIO(part.inline_data.data)).convert("RGB").save(out)
                print(f"saved {out}")
                return
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


if __name__ == "__main__":
    main()
