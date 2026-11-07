"""Turn one green-screen pose sheet into game-ready pose PNGs.

Usage:
  uv run --no-project --with pillow --with numpy python -I pipeline/sprite_sheet.py \
      --sheet <sheet.jpg> --fighter mcgregor --poses idle,punch,kick,hit,shoot,down \
      --out prototype/web/assets/private [--pixel 4]

Steps: key the background by flood fill from the edges (so green shorts survive), find each pose as a
connected shape, read the poses left to right and top to bottom, remove green fringe, scale every pose
by the same factor to real pixels, and record where each figure stands. Output stays out of the repo.
"""

import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def background_mask(rgb: np.ndarray, reference: np.ndarray, tolerance: float) -> np.ndarray:
    """Pixels connected to the image edge that are close to the sheet's background colour."""
    distance = np.sqrt(((rgb.astype(float) - reference) ** 2).sum(axis=2))
    # Key on "green dominance" as well so JPEG noise around the figure still counts as background.
    greenness = rgb[:, :, 1].astype(float) - np.maximum(rgb[:, :, 0], rgb[:, :, 2]).astype(float)
    candidate = (distance < tolerance) | (greenness > 110)
    height, width = candidate.shape
    seen = np.zeros_like(candidate, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        for y in (0, height - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    # Gaps enclosed by the figure (between an arm and the body) never touch the edge. Only near-pure key
    # green counts there, which leaves darker green shorts alone.
    enclosed = (rgb[:, :, 1] > 190) & (greenness > 130)
    return seen | enclosed


def find_shapes(solid: np.ndarray, min_area: int) -> list[dict]:
    """Connected components of the figure mask, with bounding boxes."""
    height, width = solid.shape
    labels = np.zeros_like(solid, dtype=np.int32)
    shapes: list[dict] = []
    for start_y, start_x in zip(*np.nonzero(solid)):
        if labels[start_y, start_x]:
            continue
        label = len(shapes) + 1
        labels[start_y, start_x] = label
        queue = deque([(int(start_y), int(start_x))])
        y0, y1, x0, x1 = height, 0, width, 0
        area = 0
        while queue:
            y, x = queue.popleft()
            area += 1
            y0, y1, x0, x1 = min(y0, y), max(y1, y), min(x0, x), max(x1, x)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and solid[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = label
                    queue.append((ny, nx))
        shapes.append({"label": label, "area": area, "box": (x0, y0, x1 + 1, y1 + 1)})
    big = [s for s in shapes if s["area"] >= min_area]
    return big, labels


def order_reading(shapes: list[dict]) -> list[dict]:
    """Left to right, top to bottom: a new row starts when a shape's centre drops below the current row."""
    by_y = sorted(shapes, key=lambda s: s["box"][3])
    rows: list[list[dict]] = []
    for shape in by_y:
        center = (shape["box"][1] + shape["box"][3]) / 2
        for row in rows:
            if row[0]["box"][1] <= center <= row[0]["box"][3]:
                row.append(shape)
                break
        else:
            rows.append([shape])
    rows.sort(key=lambda row: min(s["box"][1] for s in row))
    ordered: list[dict] = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda s: s["box"][0]))
    return ordered


def despill(rgba: np.ndarray) -> np.ndarray:
    """Pull green fringe off the figure's edge pixels, leaving interior colours such as green shorts alone."""
    out = rgba.copy()
    alpha = out[:, :, 3] > 0
    padded = np.pad(alpha, 2, constant_values=False)
    interior = np.ones_like(alpha)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            interior &= padded[2 + dy : 2 + dy + alpha.shape[0], 2 + dx : 2 + dx + alpha.shape[1]]
    edge = alpha & ~interior
    red, green, blue = out[:, :, 0].astype(int), out[:, :, 1].astype(int), out[:, :, 2].astype(int)
    spill = edge & (green > np.maximum(red, blue) + 30)
    out[:, :, 1][spill] = np.maximum(red, blue)[spill]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sheet", required=True, type=Path)
    parser.add_argument("--fighter", required=True)
    parser.add_argument("--poses", default="idle,punch,kick,hit,shoot,down")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--pixel", type=int, default=4, help="sheet pixels per game pixel")
    parser.add_argument("--tolerance", type=float, default=90.0)
    parser.add_argument("--flip-down", action="store_true", help="mirror the down pose when the sheet has the head on the left")
    args = parser.parse_args()

    poses = [p.strip() for p in args.poses.split(",") if p.strip()]
    image = Image.open(args.sheet).convert("RGB")
    rgb = np.asarray(image)
    corners = np.concatenate([rgb[:12, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3)])
    reference = np.median(corners, axis=0)
    print(f"sheet {image.size}, background {reference}")

    background = background_mask(rgb, reference, args.tolerance)
    shapes, labels = find_shapes(~background, min_area=rgb.shape[0] * rgb.shape[1] // 400)
    print(f"found {len(shapes)} figures, expected {len(poses)}")
    if len(shapes) != len(poses):
        raise SystemExit("figure count does not match --poses; check the sheet or --tolerance")

    out_dir = args.out / args.fighter
    out_dir.mkdir(parents=True, exist_ok=True)
    meta: dict[str, dict] = {}
    for pose, shape in zip(poses, order_reading(shapes)):
        x0, y0, x1, y1 = shape["box"]
        mask = labels[y0:y1, x0:x1] == shape["label"]
        crop = np.dstack([rgb[y0:y1, x0:x1], (mask * 255).astype(np.uint8)])
        crop = despill(crop)
        # The stage expects the down pose with the head on the right.
        if pose == "down" and args.flip_down:
            crop = crop[:, ::-1]
        width, height = x1 - x0, y1 - y0
        small = Image.fromarray(crop, "RGBA").resize(
            (max(1, width // args.pixel), max(1, height // args.pixel)), Image.Resampling.BOX
        )
        pixels = np.asarray(small).copy()
        pixels[:, :, 3] = (pixels[:, :, 3] >= 128) * 255
        small = Image.fromarray(pixels, "RGBA")
        small.save(out_dir / f"{pose}.png")
        # Stand point: where the lowest fifth of the figure sits, so a punch reaches forward from the feet.
        low = pixels[int(pixels.shape[0] * 0.8) :, :, 3] > 0
        xs = np.nonzero(low.any(axis=0))[0]
        anchor = float(xs.mean()) if len(xs) else pixels.shape[1] / 2
        meta[pose] = {"w": small.width, "h": small.height, "anchorX": round(anchor, 1)}
        print(f"  {pose}: {small.width}x{small.height} anchor {anchor:.0f}")

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    # A second sheet (the ground poses) adds to the fighter's poses instead of replacing them.
    manifest.setdefault("fighters", {})[args.fighter] = {**manifest.get("fighters", {}).get(args.fighter, {}), **meta}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {out_dir} and {manifest_path}")


if __name__ == "__main__":
    main()
