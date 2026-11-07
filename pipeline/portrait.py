"""Pixelate a cut-out headshot (transparent PNG) into the 72x72 select-screen portrait.

Usage:
  uv run --no-project --with pillow --with numpy python -I pipeline/portrait.py \
      --photo prototype/web/assets/private/_source/mcgregor_ufc.png --fighter mcgregor \
      --out prototype/web/assets/private [--grid 36] [--colors 28] [--side 0.75]

The photo needs a transparent background. The head is found from the top of the figure, the crop is a
square starting just above the hair, the photo is reduced to a coarse grid, palette-limited, and drawn
at 2x onto the same dark background the other portraits use. Photos and output stay out of the repo.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

BACKGROUND = (27, 32, 48)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photo", required=True, type=Path)
    parser.add_argument("--fighter", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--grid", type=int, default=36, help="portrait size in game pixels (output is 2x)")
    parser.add_argument("--colors", type=int, default=28)
    parser.add_argument("--side", type=float, default=0.75, help="crop side as a fraction of the figure width")
    parser.add_argument("--contrast", type=float, default=1.35)
    parser.add_argument("--saturation", type=float, default=1.35)
    args = parser.parse_args()

    photo = Image.open(args.photo).convert("RGBA")
    alpha = np.asarray(photo)[:, :, 3]
    ys, xs = np.nonzero(alpha > 10)
    if len(ys) == 0:
        raise SystemExit("photo has no opaque pixels; it must be a cut-out with a transparent background")
    top, left, right = int(ys.min()), int(xs.min()), int(xs.max())
    side = int((right - left) * args.side)
    # Centre on the head: the opaque pixels in the top fifth of the crop.
    head_rows = alpha[top : top + side // 5]
    head_xs = np.nonzero((head_rows > 10).any(axis=0))[0]
    centre = int(head_xs.mean()) if len(head_xs) else (left + right) // 2
    x0 = centre - side // 2
    y0 = top - side // 25
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(photo, (-x0, -y0)) if x0 >= 0 and y0 >= 0 else canvas.paste(
        photo.crop((x0, y0, x0 + side, y0 + side)), (0, 0)
    )

    # Photos go muddy at this size: sharpen first, then push contrast and colour so features survive the reduction.
    rgb, mask = canvas.convert("RGB"), canvas.getchannel("A")
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=side / 60, percent=180, threshold=2))
    rgb = ImageEnhance.Contrast(rgb).enhance(args.contrast)
    rgb = ImageEnhance.Color(rgb).enhance(args.saturation)
    canvas = Image.merge("RGBA", (*rgb.split(), mask))
    small = canvas.resize((args.grid, args.grid), Image.Resampling.BOX)
    pixels = np.asarray(small).copy()
    solid = pixels[:, :, 3] >= 128
    flat = Image.new("RGB", small.size, BACKGROUND)
    flat.paste(Image.fromarray(pixels[:, :, :3]), mask=Image.fromarray((solid * 255).astype(np.uint8)))
    flat = flat.quantize(colors=args.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    # Keep the background exactly flat after quantizing.
    out_pixels = np.asarray(flat).copy()
    out_pixels[~solid] = BACKGROUND
    result = Image.fromarray(out_pixels).resize((args.grid * 2, args.grid * 2), Image.Resampling.NEAREST)

    target = args.out / args.fighter
    target.mkdir(parents=True, exist_ok=True)
    result.save(target / "portrait.png")
    print(f"wrote {target / 'portrait.png'} ({result.width}x{result.height})")


if __name__ == "__main__":
    main()
