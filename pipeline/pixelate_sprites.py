"""Zero-AI Official Cutout Pixelation Pipeline & Calibration Tool (RULES.md §2.1).

Processes transparent UFC athlete PNGs (full-body or headshot) into crisp 32-color
retro pixel sprites with a 1px dark outline (#12141F) and zero dithering.
Note: Per RULES.md §2.1, official athlete photos are NEVER committed to the repository;
the iOS app executes this identical 5-step pipeline on-device and caches locally.
"""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image, ImageEnhance, ImageFilter

OUTLINE_RGBA: tuple[int, int, int, int] = (18, 20, 31, 255)


def trim_transparent_borders(img: Image.Image, alpha_threshold: int = 16) -> Image.Image:
    """Step 1: Crop transparent borders using the alpha channel bounding box."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    mask = alpha.point(lambda a: 255 if a >= alpha_threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgba
    return rgba.crop(bbox)


def enhance_tattoos_and_details(
    img: Image.Image, contrast: float = 1.18, sharpness: float = 1.45
) -> Image.Image:
    """Step 2: Sharpen and boost contrast to preserve tattoos, shorts, and facial structure."""
    rgba = img.convert("RGBA")
    r, g, b, a = rgba.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = ImageEnhance.Sharpness(rgb).enhance(sharpness)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2))
    r2, g2, b2 = rgb.split()
    return Image.merge("RGBA", (r2, g2, b2, a))


def box_downsample(
    img: Image.Image, target_height: int = 116, is_square_headshot: bool = False
) -> Image.Image:
    """Step 3: Downsample using BOX filter (area averaging) to target pixel dimensions."""
    w, h = img.size
    if h <= 0 or w <= 0:
        return img
    if is_square_headshot:
        scale = min((target_height - 2) / float(w), (target_height - 2) / float(h))
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        resized = img.resize((new_w, new_h), resample=Image.Resampling.BOX)
        canvas = Image.new("RGBA", (target_height, target_height), (0, 0, 0, 0))
        offset_x = (target_height - new_w) // 2
        offset_y = target_height - new_h - 1
        canvas.paste(resized, (offset_x, max(1, offset_y)))
        return canvas

    inner_h = max(8, target_height - 2)
    aspect = w / float(h)
    inner_w = max(8, int(round(inner_h * aspect)))
    resized = img.resize((inner_w, inner_h), resample=Image.Resampling.BOX)
    canvas = Image.new("RGBA", (inner_w + 2, target_height), (0, 0, 0, 0))
    canvas.paste(resized, (1, 1))
    return canvas


def quantize_32_colors_no_dither(img: Image.Image, colors: int = 32, alpha_cutoff: int = 96) -> Image.Image:
    """Step 4: Quantize opaque pixels to 32 colors with zero dithering."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    r, g, b, a = rgba.split()
    rgb = Image.merge("RGB", (r, g, b))
    quantized_rgb = rgb.quantize(
        colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
    ).convert("RGB")

    q_pixels = quantized_rgb.load()
    a_pixels = a.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out_pixels = out.load()

    if q_pixels is None or a_pixels is None or out_pixels is None:
        return rgba

    for y in range(h):
        for x in range(w):
            alpha_val = a_pixels[x, y]
            if isinstance(alpha_val, int) and alpha_val >= alpha_cutoff:
                qr, qg, qb = q_pixels[x, y]
                out_pixels[x, y] = (qr, qg, qb, 255)
            else:
                out_pixels[x, y] = (0, 0, 0, 0)
    return out


def apply_1px_dark_outline(img: Image.Image) -> Image.Image:
    """Step 5: Draw a 1px dark outline (#12141F) around non-transparent pixel neighbours."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    src = rgba.load()
    out = rgba.copy()
    dst = out.load()
    if src is None or dst is None:
        return rgba

    for y in range(h):
        for x in range(w):
            if src[x, y][3] > 0:
                continue
            has_opaque_neighbour = False
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 0:
                    has_opaque_neighbour = True
                    break
            if has_opaque_neighbour:
                dst[x, y] = OUTLINE_RGBA
    return out


def pixelate_cutout(
    img: Image.Image,
    target_height: int = 116,
    colors: int = 32,
    is_square_headshot: bool = False,
) -> Image.Image:
    """Execute the full 5-step Zero-AI pixelation pipeline."""
    step1 = trim_transparent_borders(img)
    step2 = enhance_tattoos_and_details(step1)
    step3 = box_downsample(step2, target_height=target_height, is_square_headshot=is_square_headshot)
    step4 = quantize_32_colors_no_dither(step3, colors=colors)
    step5 = apply_1px_dark_outline(step4)
    return step5


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate 5-step UFC cutout pixelation pipeline.")
    parser.add_argument("--url", type=str, required=True, help="Official transparent PNG URL.")
    parser.add_argument(
        "--height",
        type=int,
        default=116,
        help="Output pixel height (112-128 body, 64 headshot).",
    )
    parser.add_argument("--headshot", action="store_true", help="Format as 64x64 square headshot.")
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Temporary output PNG path (do not commit to git).",
    )
    args = parser.parse_args()

    resp = httpx.get(
        args.url,
        headers={"User-Agent": "Mozilla/5.0"},
        follow_redirects=True,
        timeout=20.0,
    )
    resp.raise_for_status()
    raw_img = Image.open(BytesIO(resp.content))
    h_target = 64 if args.headshot else args.height
    result = pixelate_cutout(raw_img, target_height=h_target, is_square_headshot=args.headshot)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.out, format="PNG")
    print(f"[Pixelator] Saved {result.size[0]}x{result.size[1]} 32-color sprite to {args.out}")


if __name__ == "__main__":
    main()
