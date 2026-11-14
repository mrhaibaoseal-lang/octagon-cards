"""Repaint a fighter's body in the hand-painted animation style, into a copy of its _model3d folder so the original
skin stays. Reuses pipeline/model3d/paint_skin.py (imported, not changed) for the guide, prompt, token and keying.

  uv run --no-project --with google-genai --with google-auth --with pillow python -I pipeline/img2_3d/paint_body.py topuria
  blender -b <private>/_model3d/topuria_painted/base_body.blend -P pipeline/model3d/bake_skin.py -- --dir <private>/_model3d/topuria_painted

About NT$5 per call. Output: <private>/_model3d/<fighter>_painted/painted_sheet.png
"""
import shutil
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "model3d"))
import paint_skin as ps  # noqa: E402

STYLE_OLD = "Style: detailed fighting game illustration, clean shapes, soft even lighting, very light shading,"
STYLE_NEW = ("Style: hand-painted stylised animation look, like painterly concept art for a high-end animated series: flat shapes "
             "of colour with visible brush strokes, simplified muscle planes painted as a few clear shapes, tattoos painted "
             "as bold graphic ink shapes with clean edges (not blurry photos), warm skin with subtle cool tones, soft even "
             "light, very light shading (shading is added later),")


# The head is replaced by the TRELLIS.2 head later, so the body sheet only needs a head-sized head. A big hairdo
# (O'Malley's afro) made Gemini shrink and re-pose the whole figure (arms down, legs cropped), and the bake landed the
# shorts on the knees. Appended to every fighter's prompt.
HEAD_AND_POSE = ("\nThe head will be replaced later: paint his hair short and close to the scalp, staying inside the mannequin's "
                 "head outline, whatever his real hairstyle is. Again: the arms stay held straight out to the sides exactly "
                 "like the mannequin, and every figure keeps the mannequin's exact size, from the top of the head to the bare "
                 "feet with green margin below the feet.")


def main():
    fighter = sys.argv[1]
    src = ps.PRIVATE / "_model3d" / fighter
    d = ps.PRIVATE / "_model3d" / f"{fighter}_painted"
    if (d / "painted_sheet.png").exists():  # keep earlier tries as painted_sheet_<n>.png
        n = 1
        while (d / f"painted_sheet_{n}.png").exists():
            n += 1
        (d / "painted_sheet.png").rename(d / f"painted_sheet_{n}.png")
    if not d.exists():
        shutil.copytree(src, d, ignore=shutil.ignore_patterns("*.blend1", "_keys"))
    name, look, shorts = ps.FIGHTERS[fighter]
    assert STYLE_OLD in ps.PROMPT, "paint_skin.PROMPT changed: update STYLE_OLD"
    prompt = ps.PROMPT.replace(STYLE_OLD, STYLE_NEW).format(name=name, look=look, shorts=shorts) + HEAD_AND_POSE
    guide = Image.open(d / "guide_sheet.png").convert("RGB")
    aw, ah = 21, 9
    padded = Image.new("RGB", (guide.width, max(round(guide.width * ah / aw), guide.height)), (0, 255, 0))
    padded.paste(guide, (0, (padded.height - guide.height) // 2))
    photo = next(iter(sorted((ps.PRIVATE / "_source").glob(f"*{fighter}*fullbody*.png"))), None) \
        or next(iter(sorted((ps.PRIVATE / "_source").glob(f"*{fighter}*_ufc.png"))))

    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials
    token = ps.get_gcloud_token(ps.DEFAULT_ACCOUNT)
    client = genai.Client(vertexai=True, project=ps.DEFAULT_PROJECT, location="global", credentials=Credentials(token=token))
    resp = client.models.generate_content(
        model="gemini-3-pro-image", contents=[padded, ps.prepare_reference_photo(photo), prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"],
                                           image_config=types.ImageConfig(aspect_ratio=f"{aw}:{ah}", image_size="2K")))
    for cand in resp.candidates or []:
        for part in cand.content.parts or []:
            if part.inline_data and part.inline_data.data:
                img = ps.key_to_green(Image.open(BytesIO(part.inline_data.data)).convert("RGB"))
                out = d / "painted_sheet.png"
                img.save(out)
                print("saved", out, img.size)
                return
    sys.exit(f"No image returned: {getattr(resp, 'text', None)}")


if __name__ == "__main__":
    main()
