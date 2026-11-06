"""Prototype: small chibi, shared generated body + photo head + palette + zone tattoos. Not product code."""
import math, sys, pathlib, zlib
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

PHOTOS = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2])

# Per-fighter data a human/agent would fill in once: zone ink density 0-3, ink tint, shorts.
FIGHTERS = {
 'ilia-topuria':   dict(ink=dict(chest=3,belly=0,uF=3,fF=3,uB=1,fB=1), tint=None),
 'israel-adesanya':dict(ink=dict(chest=2,belly=1,uF=1,fF=1,uB=3,fB=3), tint=None),
 'sean-omalley':   dict(ink=dict(chest=3,belly=1,uF=2,fF=3,uB=1,fB=1), tint=(150,50,60)),
 'alex-pereira':   dict(ink=dict(chest=1,belly=2,uF=1,fF=2,uB=3,fB=1), tint=(120,50,45)),
 'max-holloway':   dict(ink=dict(chest=3,belly=1,uF=2,fF=2,uB=3,fB=3), tint=None),
 'jon-jones':      dict(ink=dict(chest=1,belly=0,uF=0,fF=0,uB=0,fB=0), tint=None),
}
BUILD = {'ilia-topuria':1.0,'israel-adesanya':0.92,'sean-omalley':0.92,'alex-pereira':1.0,'max-holloway':0.95,'jon-jones':1.08}

POSES = {
 # angles from straight down, + = toward facing direction. F = front/lead limb, B = back/rear limb.
 'idle':   dict(lean=4,  uF=22, fF=165, uB=20, fB=168, tF=24, sF=-4,  tB=-16, sB=-34, headDx=0, headDy=0),
 'idle2':  dict(lean=5,  uF=26, fF=146, uB=6,  fB=146, tF=27, sF=-6,  tB=-18, sB=-38, headDx=0, headDy=1),
 'jab':    dict(lean=12, uF=84, fF=90,  uB=10, fB=150, tF=30, sF=-2,  tB=-22, sB=-36, headDx=1, headDy=1),
 'cross':  dict(lean=20, uF=20, fF=140, uB=78, fB=88,  tF=34, sF=-4,  tB=-28, sB=-40, headDx=2, headDy=1),
 'kick':   dict(lean=-20,uF=30, fF=150, uB=-14,fB=120,tF=2,  sF=-2,  tB=84,  sB=80,  headDx=-1,headDy=0),
 'hurt':   dict(lean=-16,uF=-8, fF=70,  uB=-22,fB=55,  tF=20, sF=-6,  tB=-14, sB=-30, headDx=-2,headDy=1),
 'down':   dict(lean=-44,uF=-50,fF=-8,  uB=-62,fB=-14, tF=44, sF=-14, tB=14,  sB=-56, headDx=-5,headDy=3),
}

OUTLINE=(18,20,31)
def rgb(c): return np.array(c,dtype=np.uint8)
def shade(c,k): return tuple(int(min(255,v*k)) for v in c)
def mix(a,b,t): return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))

def h(x,y,seed):
    return (zlib.crc32(f'{x},{y},{seed}'.encode())&0xffff)/65535

def vnoise(x,y,seed):
    xi,yi=math.floor(x),math.floor(y); fx,fy=x-xi,y-yi
    fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy)
    a,b,c_,d=h(xi,yi,seed),h(xi+1,yi,seed),h(xi,yi+1,seed),h(xi+1,yi+1,seed)
    return (a*(1-fx)+b*fx)*(1-fy)+(c_*(1-fx)+d*fx)*fy

def ink_mask(lx,ly,density,seed,cell):
    """Stable blobs in part-local coordinates, so the ink follows the limb and doesn't shimmer between frames."""
    thr={0:-1,1:0.30,2:0.42,3:0.54}[density]
    return vnoise(lx/cell,ly/cell,seed)<thr

class Canvas:
    def __init__(s,w,h):
        s.w,s.h=w,h; s.a=np.zeros((h,w,4),dtype=np.uint8)
        s.yy,s.xx=np.mgrid[0:h,0:w]; s.xx=s.xx+.5; s.yy=s.yy+.5
    def ring(s,m):
        d=m.copy()
        d[1:,:]|=m[:-1,:]; d[:-1,:]|=m[1:,:]; d[:,1:]|=m[:,:-1]; d[:,:-1]|=m[:,1:]
        s.a[d&~m]=(*OUTLINE,255)
    def limb(s,A,B,r0,r1,col,zone=None,ink=None,tint=None,seed=0,lightSign=1,ring=True):
        ax,ay=A;bx,by=B; dx,dy=bx-ax,by-ay; L=max(math.hypot(dx,dy),.01); ux,uy=dx/L,dy/L
        t=np.clip(((s.xx-ax)*ux+(s.yy-ay)*uy)/L,0,1)
        px,py=ax+t*dx,ay+t*dy
        r=r0+(r1-r0)*t
        dist=np.hypot(s.xx-px,s.yy-py); m=dist<=r
        if ring: s.ring(m)
        perp=(s.xx-px)*(-uy)+(s.yy-py)*ux
        nd=perp/np.maximum(r,.01)*lightSign
        sh=shade(col,.72); hi=shade(col,1.12)
        s.a[m]=(*col,255)
        s.a[m&(nd>.40)]=(*sh,255)
        s.a[m&(nd<-.60)]=(*hi,255)
        if zone and ink and ink.get(zone,0)>0:
            c1=ink_color(col,tint); cell=max(2.2,s.cell)
            lt=t*L
            for y,x in zip(*np.nonzero(m)):
                if abs(nd[y,x])<.85 and ink_mask(lt[y,x],perp[y,x],ink[zone],f'{seed}{zone}',cell):
                    s.a[y,x]=(*c1,255)
        return m
    def capsule_mask(s,A,B,r0,r1):
        ax,ay=A;bx,by=B; dx,dy=bx-ax,by-ay; L=max(math.hypot(dx,dy),.01)
        t=np.clip(((s.xx-ax)*dx+(s.yy-ay)*dy)/(L*L),0,1)
        return np.hypot(s.xx-(ax+t*dx),s.yy-(ay+t*dy))<=r0+(r1-r0)*t
    def poly(s,pts,col):
        m=np.ones((s.h,s.w),bool)
        n=len(pts)
        for i in range(n):
            x0,y0=pts[i];x1,y1=pts[(i+1)%n]
            m&=((x1-x0)*(s.yy-y0)-(y1-y0)*(s.xx-x0))>=0
        s.ring(m); s.a[m]=(*col,255); return m

def ink_color(skin,tint):
    lum=sum(skin)/3
    base=(38,44,58) if lum>110 else (20,20,28)
    return mix(base,tint,.55) if tint else base

def rot(a):  # angle from straight-down toward +x (image coords y-down)
    r=math.radians(a); return math.sin(r),math.cos(r)

def add(p,v,l): return (p[0]+v[0]*l,p[1]+v[1]*l)

def render_body(H,pose,skin,shorts,trim,ink,tint,seed,build=1.0):
    """H = body height below the head anchor; returns canvas plus head anchor (neck top)."""
    P=POSES[pose]
    W=int(H*3.0); cH=int(H*2.2)
    c=Canvas(W,cH); c.cell=H*.085
    u=H/1.0
    torso=.40*u; thigh=.33*u; shin=.33*u; ua=.27*u; fa=.25*u
    sw=.62*u*build    # shoulder width (3/4 view keeps it narrower than front)
    hw=.34*u*build
    rArm=max(1.5,.085*u*build); rLeg=max(1.8,.095*u*build)
    # FK: start with the hip at origin, find the floor from the feet, then shift.
    hip=(0.0,0.0)
    hipF=(hip[0]+hw*.30,hip[1]); hipB=(hip[0]-hw*.30,hip[1])
    kF=add(hipF,rot(P['tF']),thigh); aF=add(kF,rot(P['sF']),shin)
    kB=add(hipB,rot(P['tB']),thigh); aB=add(kB,rot(P['sB']),shin)
    floor=max(aF[1],aB[1])
    ox=W*.48; oy=cH-3-floor-rLeg*.6
    def T(p): return (p[0]+ox,p[1]+oy)
    lean=rot(P['lean'])
    chest=(hip[0]+lean[0]*torso, hip[1]-lean[1]*torso)
    across=(lean[1],lean[0])
    shF=add(chest,across,sw*.40); shB=add(chest,across,-sw*.60)
    ang_off=P['lean']
    eF=add(shF,rot(P['uF']),ua); wF=add(eF,rot(P['fF']),fa)
    eB=add(shB,rot(P['uB']),ua); wB=add(eB,rot(P['fB']),fa)
    # back arm
    def arm(sh,e,w,zu,zf,lightSign):
        v=(w[0]-e[0],w[1]-e[1]); L=max(math.hypot(*v),.01); v=(v[0]/L,v[1]/L)
        g=add(w,v,rArm*.9)
        c.ring(c.capsule_mask(T(sh),T(e),rArm*1.1,rArm*.9)|c.capsule_mask(T(e),T(w),rArm*.9,rArm*.72))
        c.limb(T(sh),T(e),rArm*1.1,rArm*.9,skin,zu,ink,tint,seed,lightSign,ring=False)
        c.limb(T(e),T(w),rArm*.9,rArm*.72,skin,zf,ink,tint,seed,lightSign,ring=False)
        c.limb(T(add(w,v,-rArm*.5)),T(add(w,v,rArm*.2)),rArm*.78,rArm*.78,(232,232,236),ring=False)
        c.limb(T(g),T(add(g,v,.1)),rArm*1.3,rArm*1.3,(34,36,44))
    def leg(hp,k,a,skinTone,sign):
        foot=(a[0]+rLeg*1.3,a[1]+rLeg*.35)
        c.ring(c.capsule_mask(T(hp),T(k),rLeg*1.15,rLeg*.9)|c.capsule_mask(T(k),T(a),rLeg*.9,rLeg*.6)|c.capsule_mask(T(a),T(foot),rLeg*.55,rLeg*.42))
        c.limb(T(a),T(foot),rLeg*.55,rLeg*.42,skinTone,lightSign=sign,ring=False)
        c.limb(T(k),T(a),rLeg*.9,rLeg*.6,skinTone,lightSign=sign,ring=False)
        c.limb(T(hp),T(k),rLeg*1.15,rLeg*.9,skinTone,lightSign=sign,ring=False)
        mid=(hp[0]+(k[0]-hp[0])*.68,hp[1]+(k[1]-hp[1])*.68)
        c.limb(T(hp),T(mid),rLeg*1.3,rLeg*1.2,shorts,lightSign=sign)

    arm(shB,eB,wB,'uB','fB',1)
    leg(hipB,kB,aB,shade(skin,.9),1)
    leg(hipF,kF,aF,skin,1)
    # pelvis
    c.limb(T(hipB),T(hipF),rLeg*1.3,rLeg*1.3,shorts)
    # torso
    tp=[T(add(shB,across,-rArm*.3)),T(add(shF,across,rArm*.3)),T(add(hip,across,hw*.72)),T(add(hip,across,-hw*.72))]
    tm=c.poly(tp,skin)
    # torso local coords for shading + details
    a0=T(chest); ex,ey=across; dnx,dny=-lean[0],lean[1]
    su=((c.xx-a0[0])*ex+(c.yy-a0[1])*ey)/(sw*.75)
    sv=((c.xx-a0[0])*dnx*-1+(c.yy-a0[1])*dny*1)
    sv=((c.xx-a0[0])*(lean[0])+(c.yy-a0[1])*(lean[1]))/torso
    c.a[tm&(su<-.55)]=(*shade(skin,.72),255)
    c.a[tm&(su>.62)]=(*shade(skin,1.12),255)
    if H>=30:
        # pec line + centre line + abs dots (only where the size can hold them)
        sh=shade(skin,.72)
        c.a[tm&(abs(sv-.42)<.5/torso*1.0)&(abs(su)<.62)]=(*sh,255)
        if H>=44:
            c.a[tm&(abs(su-.02)<.45/(sw*.75))&(sv>.42)&(sv<.95)]=(*sh,255)
            for vv in (.62,.80):
                c.a[tm&(abs(sv-vv)<.42/torso)&(abs(su)<.32)&(sv>.5)]=(*sh,255)
    # torso ink, in stable local cells
    if ink:
        c1=ink_color(skin,tint)
        for y,x in zip(*np.nonzero(tm)):
            zone='chest' if sv[y,x]<.55 else 'belly'
            d=ink.get(zone,0)
            if d and abs(su[y,x])<.86 and sv[y,x]>-.05 and ink_mask(su[y,x]*sw*.75,sv[y,x]*torso,d,f'{seed}{zone}',max(2.2,c.cell)):
                c.a[y,x]=(*c1,255)
    # waistband
    wb=tm&(sv>.98)
    c.a[wb]=(*trim,255)
    c.a[tm&(sv>1.0-0.0)&(sv>1.05)]=(*shorts,255)
    arm_front=lambda:arm(shF,eF,wF,'uF','fF',1)
    # neck
    neckTop=add(chest,(lean[0],-lean[1]),.10*u)
    c.limb(T(add(chest,across,-sw*.1)),T(add(neckTop,across,-sw*.1)),rArm*1.35,rArm*1.25,shade(skin,.8))
    anchor=T(add(neckTop,across,-sw*.1))
    return c,anchor,arm_front,P

def extract_head(path):
    """Top-of-head to neck from the full-body photo, using only the alpha silhouette (no pose joints)."""
    im=Image.open(path).convert('RGBA'); a=np.array(im)[:,:,3]>128
    w=a.sum(1); rows=np.nonzero(w)[0]; top=rows[0]
    prof=np.convolve(w,np.ones(5)/5,'same')
    # shoulders = first row where width exceeds 1.7x the median of what's above it
    sh=None
    for y in range(top+25,len(prof)):
        if prof[y]>1.7*np.median(prof[top+5:y]): sh=y;break
    sh=sh or top+200
    neck=top+np.argmin(prof[top+int((sh-top)*.5):sh])+int((sh-top)*.5)
    cols=np.nonzero(a[top:neck].sum(0))[0]; x0,x1=cols[0],cols[-1]
    crop=im.crop((x0,top,x1+1,neck))
    return crop

def head_sprite(path,hpx):
    crop=extract_head(path)
    iw,ih=crop.size
    # jaw-rounding ellipse mask on the lower 45%
    arr=np.array(crop); yy,xx=np.mgrid[0:ih,0:iw]
    cx=iw/2; cy=ih*.52; ax=iw*.54; ay=ih*.50
    low=yy>cy
    keep=~low|(((xx-cx)/ax)**2+((yy-cy)/ay)**2<=1)
    arr[:,:,3]=np.where(keep,arr[:,:,3],0)
    crop=Image.fromarray(arr)
    tw=max(4,round(iw*hpx/ih))
    rgb_=crop.convert('RGB'); alpha=crop.getchannel('A')
    rgb_=ImageEnhance.Contrast(rgb_).enhance(1.06)
    rgb_=ImageEnhance.Color(rgb_).enhance(1.1)
    small=rgb_.resize((tw,hpx),Image.BOX).filter(ImageFilter.UnsharpMask(1,70,0))
    al=alpha.resize((tw,hpx),Image.BILINEAR).point(lambda v:255 if v>128 else 0)
    q=small.quantize(colors=18,dither=Image.Dither.NONE).convert('RGB')
    res=np.dstack([np.array(q),np.array(al)])
    # outline
    pad=np.zeros((hpx+2,tw+2,4),dtype=np.uint8); pad[1:-1,1:-1]=res
    m=pad[:,:,3]>0; d=m.copy()
    d[1:,:]|=m[:-1,:]; d[:-1,:]|=m[1:,:]; d[:,1:]|=m[:,:-1]; d[:,:-1]|=m[:,1:]
    pad[d&~m]=(*OUTLINE,255)
    return Image.fromarray(pad)

def sample_skin(path):
    """Median of the middle of the face, from the same silhouette crop."""
    crop=extract_head(path); iw,ih=crop.size
    box=(int(iw*.36),int(ih*.55),int(iw*.64),int(ih*.72))
    px=np.array(crop.crop(box).convert('RGB')).reshape(-1,3)
    return tuple(int(v) for v in np.median(px,axis=0))

def sample_shorts(path):
    """Bottom rows of the full-body photo (no joints needed): most saturated cluster, else near-black."""
    im=np.array(Image.open(path).convert('RGBA')); h_=im.shape[0]
    rows=np.nonzero((im[:,:,3]>128).sum(1))[0]; b=rows[-1]
    band=im[max(0,b-30):b,:,:]; band=band[band[:,:,3]>128][:,:3].astype(int)
    sat=band.max(1)-band.min(1); colored=band[sat>70]
    # skin is saturated too: keep only colours far from the skin hue is over-engineering for a prototype.
    col=np.median(colored,axis=0) if len(colored)>len(band)*.4 else np.median(band[band.sum(1)<200],axis=0) if (band.sum(1)<200).any() else np.array([30,30,36])
    return tuple(int(v) for v in col)

SHORTS_OVERRIDE={'ilia-topuria':(170,36,36),'israel-adesanya':(40,40,48),'sean-omalley':(32,52,110),'alex-pereira':(226,190,40),'max-holloway':(44,44,50),'jon-jones':(60,64,72)}

def fighter_frame(fid,H,hpx,pose):
    data=FIGHTERS[fid]; full=PHOTOS/f'{fid}_full.png'
    skin=sample_skin(full); shorts=SHORTS_OVERRIDE[fid]; trim=shade(shorts,1.5) if sum(shorts)<200 else shade(shorts,.6)
    c,anchor,front,P=render_body(H,pose,skin,shorts,trim,data['ink'],data['tint'],fid,BUILD[fid])
    img=Image.fromarray(c.a)
    hs=head_sprite(full,hpx)
    x=int(anchor[0]-hs.width/2)+P['headDx']; y=int(anchor[1]-hs.height+max(2,hpx*.08))+P['headDy']
    # head between neck and front arm so the guard glove can overlap the jaw edge
    img.alpha_composite(hs,(max(0,x),max(0,y)))
    c.a=np.array(img); front()
    return Image.fromarray(c.a)

def trim_(im):
    return im.crop(im.getbbox())

BG=(26,29,40); FLOOR=(58,62,74)
def sheet_sizes(ids):
    # rows are size options; every figure is shown at about the same on-screen height via an integer scale.
    opts=[('small',24,18,4),('medium',34,25,3),('large',46,34,2)]
    cell=190; lab=0
    W=Image.new('RGB',(cell*len(ids),sum(0 for _ in opts)+len(opts)*200),BG)
    yy=0
    for name,H,hpx,sc in opts:
        for i,fid in enumerate(ids):
            f=trim_(fighter_frame(fid,H,hpx,'idle'))
            print(name,fid,f.size,'head%',round(hpx/f.height*100))
            f=f.resize((f.width*sc,f.height*sc),Image.NEAREST)
            W.paste(f,(i*cell+(cell-f.width)//2,yy+196-f.height),f)
        yy+=200
    W.save(OUT/'sizes.png')

def sheet_poses(ids,H,hpx,sc,name):
    poses=['idle','jab','cross','kick','hurt','down']
    cell=int(H*2.7*sc)
    W=Image.new('RGB',(cell*len(poses),(int((H+hpx)*1.2*sc))*len(ids)),BG)
    rowh=int((H+hpx)*1.2*sc)
    for r,fid in enumerate(ids):
        for i,p in enumerate(poses):
            f=trim_(fighter_frame(fid,H,hpx,p))
            f=f.resize((f.width*sc,f.height*sc),Image.NEAREST)
            W.paste(f,(i*cell+(cell-f.width)//2,r*rowh+rowh-4-f.height),f)
    W.save(OUT/name)

ids=list(FIGHTERS)
sheet_sizes(ids)
sheet_poses(['ilia-topuria','israel-adesanya','sean-omalley'],34,25,3,'poses.png')
