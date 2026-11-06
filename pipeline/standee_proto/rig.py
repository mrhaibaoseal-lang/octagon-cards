import sys, pathlib, math
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

RIGS = {
    'ilia-topuria': dict(
        head=dict(top=0, chin=255, x0=150, x1=330, neck=(240, 250)),
        shA=(50, 330), elA=(35, 545), wrA=(75, 745),
        shB=(385, 330), elB=(405, 545), wrB=(410, 740),
        hipL=(135, 760), knL=(110, 1085), anL=(100, 1400),
        hipR=(295, 760), knR=(285, 1060), anR=(240, 1330),
        armA=[(0, 260), (105, 285), (118, 430), (98, 560), (95, 650), (105, 745), (130, 790), (160, 880), (140, 915), (60, 905), (42, 850), (45, 745), (0, 620)],
        armB=[(335, 290), (460, 260), (460, 895), (372, 885), (366, 800), (372, 720), (350, 640), (342, 520), (352, 460), (338, 420)],
        pelvisY=790, crotchX=215),
    'israel-adesanya': dict(
        head=dict(top=0, chin=240, x0=115, x1=295, neck=(205, 235)),
        shA=(45, 345), elA=(25, 560), wrA=(75, 790),
        shB=(375, 345), elB=(400, 570), wrB=(420, 780),
        hipL=(120, 770), knL=(115, 1130), anL=(70, 1480),
        hipR=(300, 770), knR=(305, 1130), anR=(295, 1430),
        armA=[(0, 280), (90, 300), (100, 450), (95, 570), (105, 660), (130, 790), (175, 890), (170, 950), (90, 965), (55, 880), (50, 790), (0, 640)],
        armB=[(320, 310), (460, 270), (460, 950), (352, 950), (352, 840), (372, 790), (380, 700), (358, 620), (352, 470), (330, 430)],
        pelvisY=800, crotchX=240),
}

# Angles from straight down, + toward the right of the screen (the fighter faces right).
GUARD_B = dict(uB=22, fB=158)
GUARD_A = dict(uA=-10, fA=-205)
STANCE = dict(tL=-20, sL=-14, tR=18, sR=4)
POSES = {
    'idle': dict(lean=3, **GUARD_B, **GUARD_A, **STANCE, head=(0, 0), dx=0),
    'idle2': dict(lean=5, uB=26, fB=148, uA=-6, fA=-212, tL=-22, sL=-14, tR=20, sR=2, head=(0, 4), dx=0),
    'jab': dict(lean=10, uB=86, fB=92, **GUARD_A, tL=-26, sL=-16, tR=24, sR=4, head=(5, 4), dx=4),
    'cross': dict(lean=16, **GUARD_B, uA=68, fA=86, tL=-28, sL=-20, tR=26, sR=6, head=(9, 5), dx=10, top='A'),
    'kick': dict(lean=-16, uB=30, fB=150, uA=-24, fA=-215, tL=-6, sL=-4, tR=82, sR=78, head=(-4, 0), dx=-4),
    'hurt': dict(lean=-14, uB=34, fB=110, uA=-40, fA=-70, tL=-14, sL=-8, tR=24, sR=12, head=(-10, 6), dx=-8),
    'down': dict(lean=0, uB=60, fB=30, uA=-55, fA=-30, tL=-14, sL=4, tR=26, sR=-10, head=(0, 0), dx=0, rot=86),
}
EX = dict(head=1.9, tx=1.15, ty=.88, arm=.92, armW=1.05, leg=.62, legW=1.15)


def poly(sz, pts):
    m = Image.new('L', sz, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return np.array(m) > 0


def unit(angle):
    r = math.radians(angle)
    return np.array([math.sin(r), math.cos(r)])


def ang(a, b):
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1]))


def rot(v, deg):
    d = math.radians(deg)
    return np.array([v[0] * math.cos(d) + v[1] * math.sin(d), -v[0] * math.sin(d) + v[1] * math.cos(d)])


class Rig:
    def __init__(s, fid, sp):
        s.R = RIGS[fid]
        r = s.R
        im = Image.open(sp / 'orig' / f'{fid}.png').convert('RGBA')
        im = im.crop(im.getbbox())
        s.im = im.resize((460, int(im.height * 460 / im.width)), Image.LANCZOS)
        W, H = s.im.size
        s.sz = (W, H)
        a = np.array(s.im).astype(np.uint8)
        yy, xx = np.mgrid[0:H, 0:W]
        armA = poly(s.sz, r['armA'])
        armB = poly(s.sz, r['armB'])

        def seg(j0, j1, lo=-20., hi=9e9):
            d = np.array(j1, float) - j0
            L = np.hypot(*d)
            u = d / L
            t = (xx - j0[0]) * u[0] + (yy - j0[1]) * u[1]
            return (t > lo) & (t < L + hi)

        def part(source, mask):
            o = source.copy()
            o[~mask] = 0
            return Image.fromarray(o)

        s.p = {}
        s.p['uA'] = part(a, armA & seg(r['shA'], r['elA'], -70, 18))
        s.p['fA'] = part(a, armA & seg(r['elA'], r['wrA'], -18))
        s.p['uB'] = part(a, armB & seg(r['shB'], r['elB'], -70, 18))
        s.p['fB'] = part(a, armB & seg(r['elB'], r['wrB'], -18))
        # A hand resting on the thigh leaves a hole: fill it from the pixels beside it.
        filled = a.copy()
        filled[armA | armB] = 0
        for m, step in ((armA, 1), (armB, -1)):
            for y in range(max(0, r['pelvisY'] - 140), H):
                xs = np.nonzero(m[y])[0]
                if len(xs) == 0:
                    continue
                src = xs.max() + 3 if step == 1 else xs.min() - 3
                if 0 <= src < W and a[y, src, 3] > 128:
                    for x in xs:
                        if a[y, x, 3] > 128:
                            filled[y, x] = a[y, src]
        cx = r['crotchX']
        legL = (xx < cx) & (yy > r['pelvisY'] - 60)
        legR = (xx >= cx) & (yy > r['pelvisY'] - 60)
        s.p['tL'] = part(filled, legL & seg(r['hipL'], r['knL'], -60, 20))
        s.p['sL'] = part(filled, legL & seg(r['knL'], r['anL'], -20))
        s.p['tR'] = part(filled, legR & seg(r['hipR'], r['knR'], -60, 20))
        s.p['sR'] = part(filled, legR & seg(r['knR'], r['anR'], -20))
        # Torso: no arms, thighs or head; discs stay at the shoulders so raising an arm leaves no notch.
        torso = (yy < r['pelvisY']) & (yy > r['head']['chin'] - 25) & ~armA & ~armB
        for k in ('shA', 'shB'):
            j = r[k]
            torso |= ((xx - j[0]) ** 2 + (yy - j[1]) ** 2 < 46 ** 2)
        s.p['torso'] = part(filled, torso)
        h = r['head']
        c = s.im.crop((h['x0'], h['top'], h['x1'], h['chin']))
        arr = np.array(c)
        iw, ih = c.size
        y_, x_ = np.mgrid[0:ih, 0:iw]
        cy = ih * .58
        keep = (y_ <= cy) | (((x_ - iw / 2) / (iw * .5)) ** 2 + ((y_ - cy) / (ih * .42)) ** 2 <= 1)
        arr[:, :, 3] = np.where(keep, arr[:, :, 3], 0)
        s.head = Image.fromarray(arr)

    def paste(s, C, part, src_j, dst_j, delta, sL, sW, rest):
        d = math.radians(delta)
        c, sn = math.cos(d), math.sin(d)
        M = np.array([[c, sn], [-sn, c]])
        u = np.array(rest, float)
        u = u / np.hypot(*u)
        S = sL * np.outer(u, u) + sW * (np.eye(2) - np.outer(u, u))
        Ai = np.linalg.inv(M @ S)
        b = np.array(src_j, float) - Ai @ np.array(dst_j, float)
        C.alpha_composite(part.transform(C.size, Image.AFFINE, (Ai[0, 0], Ai[0, 1], b[0], Ai[1, 0], Ai[1, 1], b[1]), resample=Image.BICUBIC))

    def pose(s, P):
        r = s.R
        CW, CH = 2000, 1500
        C = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
        lean = P['lean']
        pv = np.array([(r['hipL'][0] + r['hipR'][0]) / 2, r['pelvisY'] - 30], float)
        floor = CH - 40
        tscale = np.array([EX['tx'], EX['ty']])

        def legchain(hip, kn, an, tk, sk):
            L1 = np.hypot(kn[0] - hip[0], kn[1] - hip[1]) * EX['leg']
            L2 = np.hypot(an[0] - kn[0], an[1] - kn[1]) * EX['leg']
            j1 = unit(P[tk]) * L1
            return j1, j1 + unit(P[sk]) * L2

        def hipoff(h):
            return (np.array(h, float) - pv) * tscale

        LL = legchain(r['hipL'], r['knL'], r['anL'], 'tL', 'sL')
        RR = legchain(r['hipR'], r['knR'], r['anR'], 'tR', 'sR')
        lowest = max((hipoff(r['hipL']) + LL[1])[1], (hipoff(r['hipR']) + RR[1])[1]) + 70 * EX['leg']
        P0 = np.array([CW * .5 + P['dx'] * 5, floor - lowest])

        def draw_leg(hip, kn, an, tk, sk, chain):
            h = P0 + hipoff(hip)
            s.paste(C, s.p[sk], kn, h + chain[0], P[sk] - ang(kn, an), EX['leg'], EX['legW'], (an[0] - kn[0], an[1] - kn[1]))
            s.paste(C, s.p[tk], hip, h, P[tk] - ang(hip, kn), EX['leg'], EX['legW'], (kn[0] - hip[0], kn[1] - hip[1]))

        def arm(sh, el, wr, uk, fk):
            o = rot((np.array(sh, float) - pv) * tscale, lean) + P0
            e = o + unit(P[uk]) * np.hypot(el[0] - sh[0], el[1] - sh[1]) * EX['arm']
            s.paste(C, s.p[fk], el, e, P[fk] - ang(el, wr), EX['arm'], EX['armW'], (wr[0] - el[0], wr[1] - el[1]))
            s.paste(C, s.p[uk], sh, o, P[uk] - ang(sh, el), EX['arm'], EX['armW'], (el[0] - sh[0], el[1] - sh[1]))

        draw_leg(r['hipL'], r['knL'], r['anL'], 'tL', 'sL', LL)
        draw_leg(r['hipR'], r['knR'], r['anR'], 'tR', 'sR', RR)
        d = math.radians(lean)
        c, sn = math.cos(d), math.sin(d)
        Mi = np.linalg.inv(np.array([[c, sn], [-sn, c]]) @ np.diag([EX['tx'], EX['ty']]))
        b = pv - Mi @ P0
        C.alpha_composite(s.p['torso'].transform(C.size, Image.AFFINE, (Mi[0, 0], Mi[0, 1], b[0], Mi[1, 0], Mi[1, 1], b[1]), resample=Image.BICUBIC))
        nw = rot((np.array(r['head']['neck'], float) - pv) * tscale, lean) + P0
        hd = s.head.resize((int(s.head.width * EX['head']), int(s.head.height * EX['head'])), Image.LANCZOS)
        if lean:
            hd = hd.rotate(-lean * .6, expand=True, resample=Image.BICUBIC)
        hx = int(nw[0] - hd.width / 2 + P['head'][0])
        hy = int(nw[1] - hd.height * .9 + P['head'][1])
        C.alpha_composite(hd, (max(0, hx), max(0, hy)))
        if P.get('top') == 'A':
            arm(r['shB'], r['elB'], r['wrB'], 'uB', 'fB')
            arm(r['shA'], r['elA'], r['wrA'], 'uA', 'fA')
        else:
            arm(r['shA'], r['elA'], r['wrA'], 'uA', 'fA')
            arm(r['shB'], r['elB'], r['wrB'], 'uB', 'fB')
        if P.get('rot'):
            T = C.rotate(P['rot'], expand=False, center=(CW * .5, floor - 300), resample=Image.BICUBIC)
            box = T.getbbox()
            C = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
            C.alpha_composite(T.crop(box), (int(CW * .5 - (box[2] - box[0]) / 2), floor - (box[3] - box[1])))
        return C


if __name__ == '__main__':
    root, sp = sys.argv[1], pathlib.Path(sys.argv[2])
    ids = sys.argv[3].split(',')
    sys.path[:0] = [root + '/pipeline']
    import pixel_convert as pc
    BG = (42, 44, 56)
    rows = []
    for fid in ids:
        rg = Rig(fid, sp)
        fr = []
        pal = None
        for name, P in POSES.items():
            C = rg.pose(P)
            rgb = C.convert('RGB')
            rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.15)).enhance(1.25)
            rgb.putalpha(C.getchannel('A'))
            a = np.array(rgb)
            sc = .10
            th, tw = int(a.shape[0] * sc), int(a.shape[1] * sc)
            px = pc.block_sample(a, tw, th)
            if pal is None:
                pal = pc.adaptive_palette(px[px[:, :, 3] > 0][:, :3], 32)
            px = pc.add_outline(pc.remove_strays(pc.apply_palette(px, pal)))
            f = Image.fromarray(px)
            f.save(sp / 'out' / f'rig_{fid}_{name}.png')
            fr.append(f)
        rows.append(fr)
    k = 2
    x0, x1 = int(rows[0][0].width * .22), int(rows[0][0].width * .82)
    cw = (x1 - x0) * k
    ch = rows[0][0].height * k
    S = Image.new('RGB', (cw * 4, ch * 2 * len(rows)), BG)
    for r_, fr in enumerate(rows):
        for i, f in enumerate(fr):
            b = f.crop((x0, 0, x1, f.height)).resize((cw, ch), Image.NEAREST)
            S.paste(b, ((i % 4) * cw, (r_ * 2 + i // 4) * ch), b)
    S.save(sp / 'out' / 'rig_poses.png')
    print(S.size)
