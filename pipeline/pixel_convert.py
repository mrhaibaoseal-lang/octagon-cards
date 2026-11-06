"""Turn a high-res character image into a clean pixel sprite.

AI "pixel art" is usually fake: blocks of uneven size, soft edges and hundreds of colours. This script finds the
block size, takes one colour per block with a median (no blur between blocks), reduces the colours, removes stray
single pixels and adds a 1px outline.

    python -I pixel_convert.py in.png out.png --height 96 --colors 32
    python -I pixel_convert.py in.png out.png --grid auto --colors 24 --palette palette.txt --preview 4

--height N   target height for ordinary images (illustrations, photos)
--grid auto  try to detect the block size instead of using --height. Only reliable on clean, uncompressed images;
             it misread a compressed Gemini image (found 17, real blocks about 4.25), so prefer --height.
--palette    optional text file with one #RRGGBB per line, to share one palette across fighters
Needs Pillow and numpy. Images stay out of the repo (RULES.md §2).
"""
import argparse
import numpy as np
from PIL import Image

OUTLINE = (18, 20, 31)


def remove_flat_background(rgba, tol=38):
    """When there is no alpha, flood-fill from the border over colours close to the corner colour."""
    if (rgba[:, :, 3] < 250).mean() > .01:
        return rgba
    h, w = rgba.shape[:2]
    rgb = rgba[:, :, :3].astype(int)
    corner = np.median(np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]), axis=0)
    close = np.abs(rgb - corner).sum(2) < tol
    seen = np.zeros((h, w), bool)
    seen[0, :] = close[0, :]
    seen[-1, :] = close[-1, :]
    seen[:, 0] = close[:, 0]
    seen[:, -1] = close[:, -1]
    while True:
        grown = seen.copy()
        grown[1:, :] |= seen[:-1, :]
        grown[:-1, :] |= seen[1:, :]
        grown[:, 1:] |= seen[:, :-1]
        grown[:, :-1] |= seen[:, 1:]
        grown &= close
        if (grown == seen).all():
            break
        seen = grown
    out = rgba.copy()
    out[seen, 3] = 0
    return out


def trim(rgba):
    ys, xs = np.nonzero(rgba[:, :, 3] > 128)
    if len(ys) == 0:
        raise SystemExit('image is empty after removing the background')
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def detect_block(rgba, lo=2, hi=40):
    """Block size = the spacing that lines up best with colour edges, in both directions."""
    g = rgba[:, :, :3].astype(float).sum(2)
    ex = np.abs(np.diff(g, axis=1)).sum(0)
    ey = np.abs(np.diff(g, axis=0)).sum(1)
    scores = {}
    for b in range(lo, hi + 1):
        s = 0.
        for e in (ex, ey):
            phases = [e[p::b].mean() for p in range(b)]
            s += max(phases) / max(e.mean(), 1e-6)
        scores[b] = s / 2
    # Multiples of the true size line up just as well, so take the smallest size close to the top score.
    top = max(scores.values())
    return min(b for b, s in scores.items() if s >= top * .75)


def block_sample(rgba, tw, th):
    """One colour per block: the median of the opaque pixels, so neighbouring blocks never blend."""
    h, w = rgba.shape[:2]
    out = np.zeros((th, tw, 4), dtype=np.uint8)
    ys = np.linspace(0, h, th + 1).astype(int)
    xs = np.linspace(0, w, tw + 1).astype(int)
    for y in range(th):
        for x in range(tw):
            cell = rgba[ys[y]:max(ys[y] + 1, ys[y + 1]), xs[x]:max(xs[x] + 1, xs[x + 1])].reshape(-1, 4)
            solid = cell[cell[:, 3] > 128]
            if len(solid) * 2 >= len(cell):
                out[y, x, :3] = np.median(solid[:, :3], axis=0)
                out[y, x, 3] = 255
    return out


def peel_background_fringe(px, bg, tol=110, rounds=2):
    """Edge blocks that mix figure and background come out as pale halos; drop those close to the background."""
    out = px.copy()
    for _ in range(rounds):
        m = out[:, :, 3] > 0
        near = np.zeros_like(m)
        near[1:, :] |= ~m[:-1, :]
        near[:-1, :] |= ~m[1:, :]
        near[:, 1:] |= ~m[:, :-1]
        near[:, :-1] |= ~m[:, 1:]
        pale = np.abs(out[:, :, :3].astype(int) - bg).sum(2) < tol
        out[m & near & pale] = 0
    return out


def load_palette(path):
    cols = []
    for line in open(path, encoding='utf8'):
        s = line.strip().lstrip('#')
        if len(s) == 6:
            cols.append([int(s[i:i + 2], 16) for i in (0, 2, 4)])
    if not cols:
        raise SystemExit(f'no colours found in {path}')
    return np.array(cols, dtype=float)


def adaptive_palette(pixels, n):
    """Median cut over the opaque pixels."""
    boxes = [pixels.astype(float)]
    while len(boxes) < n:
        i = max(range(len(boxes)), key=lambda k: np.ptp(boxes[k], axis=0).max() * len(boxes[k]) if len(boxes[k]) > 1 else -1)
        box = boxes[i]
        if len(box) < 2 or np.ptp(box, axis=0).max() == 0:
            break
        ch = np.ptp(box, axis=0).argmax()
        box = box[box[:, ch].argsort()]
        mid = len(box) // 2
        boxes[i:i + 1] = [box[:mid], box[mid:]]
    return np.array([b.mean(0) for b in boxes])


def apply_palette(px, palette):
    m = px[:, :, 3] > 0
    src = px[m][:, :3].astype(float)
    # Weighted distance: green differences are most visible.
    d = (((src[:, None, :] - palette[None, :, :]) * np.array([.9, 1.2, .7])) ** 2).sum(2)
    out = px.copy()
    out[m, :3] = palette[d.argmin(1)].round().astype(np.uint8)
    return out


def remove_strays(px):
    """A pixel whose 4 neighbours all share one other colour is noise; give it that colour."""
    out = px.copy()
    h, w = px.shape[:2]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if px[y, x, 3] == 0:
                continue
            ns = [px[y - 1, x], px[y + 1, x], px[y, x - 1], px[y, x + 1]]
            if all(n[3] > 0 and (n[:3] == ns[0][:3]).all() for n in ns) and not (ns[0][:3] == px[y, x, :3]).all():
                out[y, x, :3] = ns[0][:3]
    return out


def add_outline(px):
    pad = np.zeros((px.shape[0] + 2, px.shape[1] + 2, 4), dtype=np.uint8)
    pad[1:-1, 1:-1] = px
    m = pad[:, :, 3] > 0
    d = m.copy()
    d[1:, :] |= m[:-1, :]
    d[:-1, :] |= m[1:, :]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    pad[d & ~m] = (*OUTLINE, 255)
    return pad


def convert(path, height=96, colors=32, grid=None, palette=None, outline=True):
    raw = np.array(Image.open(path).convert('RGBA'))
    bg = np.median(raw[[0, 0, -1, -1], [0, -1, 0, -1], :3], axis=0) if raw[:, :, 3].min() > 250 else None
    rgba = trim(remove_flat_background(raw))
    h, w = rgba.shape[:2]
    if grid:
        b = detect_block(rgba) if grid == 'auto' else int(grid)
        th, tw = max(1, round(h / b)), max(1, round(w / b))
    else:
        b = None
        th, tw = height, max(1, round(w * height / h))
    px = block_sample(rgba, tw, th)
    if bg is not None:
        px = peel_background_fringe(px, bg)
    pal = load_palette(palette) if palette else adaptive_palette(px[px[:, :, 3] > 0][:, :3], colors)
    px = remove_strays(apply_palette(px, pal))
    return (add_outline(px) if outline else px), b


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--height', type=int, default=96)
    ap.add_argument('--colors', type=int, default=32)
    ap.add_argument('--grid', help='"auto" or a block size in source pixels')
    ap.add_argument('--palette')
    ap.add_argument('--preview', type=int, default=0, help='also save <output>.preview.png at this scale')
    ap.add_argument('--no-outline', action='store_true')
    a = ap.parse_args()
    px, block = convert(a.input, a.height, a.colors, a.grid, a.palette, not a.no_outline)
    img = Image.fromarray(px)
    img.save(a.output)
    if a.preview:
        img.resize((img.width * a.preview, img.height * a.preview), Image.NEAREST).save(a.output + '.preview.png')
    print(f'{img.width}x{img.height}' + (f', block {block}px' if block else ''))


if __name__ == '__main__':
    main()
