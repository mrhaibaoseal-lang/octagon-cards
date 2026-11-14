"""Ask Gemini (Vertex AI, the user's GCP credits, ~NT$5) for one clean, realistic, neutral front head of a fighter,
as an input for the image-to-3D experiment. Reuses the token / photo helpers of pipeline/model3d/paint_skin.py
without changing that file.

  uv run --no-project --with google-genai --with google-auth --with pillow python -I pipeline/img2_3d/gen_head.py --fighter topuria
"""
import argparse
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "model3d"))
import paint_skin as ps  # noqa: E402
from PIL import Image  # noqa: E402

OUT = ps.PRIVATE / "_img2_3d" / "inputs"

PROMPT = (
    "Using the reference photos of this person, produce ONE photorealistic studio portrait of the same man's head and "
    "neck, facing the camera straight on, eyes level, neutral relaxed expression, mouth closed. Keep his exact face shape, "
    "nose, eyes, eyebrows, ears, hairline, hair and beard. Even soft frontal lighting with no strong shadows, no "
    "highlights, no glasses or accessories, no text or logos. Head centred and filling about 70% of the height, cut just "
    "below the neck, bare shoulders barely visible. Plain pure white background."
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fighter", required=True)
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
    resp = client.models.generate_content(
        model=args.model,
        contents=[*(ps.prepare_reference_photo(p) for p in photos), PROMPT],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K"),
        ),
    )
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                OUT.mkdir(parents=True, exist_ok=True)
                out = OUT / f"{args.fighter}_gemini_real.png"
                Image.open(BytesIO(part.inline_data.data)).convert("RGB").save(out)
                print(f"saved {out}")
                return
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


if __name__ == "__main__":
    main()
