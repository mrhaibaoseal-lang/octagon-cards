import sys, pathlib
import numpy as np
from PIL import Image, ImageEnhance

root, sp, fid = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
sys.path[:0] = [root + '/pipeline', str(pathlib.Path(__file__).parent)]
import pixel_convert as pc
import rig as R

BG = (30, 33, 46)
KEYS = ['lean', 'uA', 'fA', 'uB', 'fB', 'tL', 'sL', 'tR', 'sR', 'dx']


def lerp(a, b, t):
    out = {k: a[k] * (1 - t) + b[k] * t for k in KEYS}
    out['head'] = tuple(a['head'][i] * (1 - t) + b['head'][i] * t for i in (0, 1))
    if t >= .5 and 'top' in b:
        out['top'] = b['top']
    elif t < .5 and 'top' in a:
        out['top'] = a['top']
    ra, rb = a.get('rot', 0), b.get('rot', 0)
    if ra or rb:
        out['rot'] = ra * (1 - t) + rb * t
    return out


def ease(t):
    return t * t * (3 - 2 * t)


# (target pose, frames to get there, frames to hold)
TIMELINE = [('idle', 1, 2), ('idle2', 4, 1), ('idle', 4, 1), ('jab', 2, 2), ('idle', 3, 1), ('cross', 3, 2), ('idle', 3, 1),
            ('kick', 3, 2), ('idle', 4, 1), ('hurt', 2, 2), ('down', 4, 5)]

rg = R.Rig(fid, sp)
pal = None
frames = []
durations = []
cur = R.POSES['idle']
for name, n, hold in TIMELINE:
    tgt = R.POSES[name]
    for i in range(n):
        P = lerp(cur, tgt, ease((i + 1) / n))
        C = rg.pose(P)
        rgb = ImageEnhance.Color(ImageEnhance.Contrast(C.convert('RGB')).enhance(1.15)).enhance(1.25)
        rgb.putalpha(C.getchannel('A'))
        a = np.array(rgb)
        px = pc.block_sample(a, int(a.shape[1] * .10), int(a.shape[0] * .10))
        if pal is None:
            pal = pc.adaptive_palette(px[px[:, :, 3] > 0][:, :3], 32)
        f = Image.fromarray(pc.add_outline(pc.remove_strays(pc.apply_palette(px, pal))))
        bg = Image.new('RGB', f.size, BG)
        bg.paste(f, (0, 0), f)
        k = 3
        x0, x1 = int(f.width * .2), int(f.width * .85)
        frames.append(bg.crop((x0, 0, x1, f.height)).resize(((x1 - x0) * k, f.height * k), Image.NEAREST))
        durations.append(80 if i < n - 1 else 80 + 120 * hold)
    cur = tgt
frames[0].save(sp / 'out' / 'rig_anim.gif', save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(len(frames), frames[0].size)
