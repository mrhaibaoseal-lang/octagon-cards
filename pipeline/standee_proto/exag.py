import sys,pathlib,json
import numpy as np
from PIL import Image,ImageEnhance
root,sp=sys.argv[1],pathlib.Path(sys.argv[2])
sys.path[:0]=[root+'/pipeline']
import pixel_convert as pc

class pr:
    @staticmethod
    def silhouette_rows(im):
        a=np.array(im)[:,:,3]>128;w=a.sum(1);top=int(np.nonzero(w)[0][0]);prof=np.convolve(w,np.ones(5)/5,'same');sh=None
        for y in range(top+25,len(prof)):
            if prof[y]>1.7*np.median(prof[top+5:y]): sh=y;break
        sh=sh or top+200;k=int((sh-top)*.5);return a,top,top+int(np.argmin(prof[top+k:sh]))+k,sh
    @staticmethod
    def find_chin(im,top,jaw,sh,adj=0):
        # The narrowest row is the jaw, so the chin is below it; beards: follow the dark centre column down.
        arr=np.array(im.convert('RGB')).astype(float);a=np.array(im)[:,:,3]>128;cols=np.nonzero(a[top:jaw].sum(0))[0];x0,x1=int(cols[0]),int(cols[-1])
        cx0,cx1=x0+int((x1-x0)*.38),x0+int((x1-x0)*.62);ih=jaw-top
        cheek=np.median(arr[top+int(ih*.55):top+int(ih*.68),x0+int((x1-x0)*.25):x0+int((x1-x0)*.35)].mean(1))
        chin=jaw+int(ih*.20)
        for y in range(jaw,min(jaw+int(ih*.50),sh+int(ih*.10),im.height-1)):
            if arr[y,cx0:cx1].mean(1).mean()<cheek*.62: chin=max(chin,y+4)
        return x0,x1,min(chin+adj,im.height-1)
def load(fid):
    im=Image.open(sp/'orig'/f'{fid}.png').convert('RGBA');im=im.crop(im.getbbox())
    k=460/im.width
    return im.resize((460,int(im.height*k)),Image.LANCZOS)
def boost(im):
    a=im.getchannel('A');rgb=ImageEnhance.Contrast(im.convert('RGB')).enhance(1.15);rgb=ImageEnhance.Color(rgb).enhance(1.25);rgb.putalpha(a);return rgb
def exaggerate(im,head=1.7,torso=.9,legs=.68,wide=1.12):
    a,top,jaw,sh=pr.silhouette_rows(im)
    x0,x1,chin=pr.find_chin(im,top,jaw,sh)
    H=im.height
    hip=top+int((H-top)*.50)   # waistband is close to half of the figure in these photos
    # body: remap rows chin..hip and hip..feet
    bodyTop=im.crop((0,chin-4,im.width,hip));bodyLow=im.crop((0,hip,im.width,H))
    bt=bodyTop.resize((int(im.width*wide),int(bodyTop.height*torso)),Image.LANCZOS)
    bl=bodyLow.resize((int(im.width*wide),int(bodyLow.height*legs)),Image.LANCZOS)
    # head with rounded jaw
    crop=im.crop((x0,top,x1+1,chin));arr=np.array(crop);iw,ih=crop.size
    y_,x_=np.mgrid[0:ih,0:iw];cy=ih*.58;keep=(y_<=cy)|(((x_-iw/2)/(iw*.50))**2+((y_-cy)/(ih*.42))**2<=1)
    arr[:,:,3]=np.where(keep,arr[:,:,3],0);crop=Image.fromarray(arr)
    hd=crop.resize((int(iw*head),int(ih*head)),Image.LANCZOS)
    W=max(bt.width,hd.width)+40;HH=hd.height+bt.height+bl.height
    C=Image.new('RGBA',(W,HH),(0,0,0,0))
    cxBody=(x0+x1)/2*wide
    ox=int(W/2-cxBody)
    overlap=int(hd.height*.10)
    y=hd.height-overlap
    C.alpha_composite(bt,(max(0,ox),y));C.alpha_composite(bl,(max(0,ox),y+bt.height-2))
    C.alpha_composite(hd,(int(W/2-hd.width/2),0))
    return C.crop(C.getbbox())
def pixel(im,h,colors=32):
    a=np.array(boost(im))
    a=pc.trim(a);th=h;tw=max(1,round(a.shape[1]*h/a.shape[0]))
    px=pc.block_sample(a,tw,th)
    pal=pc.adaptive_palette(px[px[:,:,3]>0][:,:3],colors)
    px=pc.remove_strays(pc.apply_palette(px,pal))
    return Image.fromarray(pc.add_outline(px))
ids=sys.argv[3].split(',')
BG=(42,44,56)
rows=[]
for label,fn,h in (('natural',lambda i:i,120),('head1.5',lambda i:exaggerate(i,1.5,.92,.75,1.08),110),('head1.9',lambda i:exaggerate(i,1.9,.88,.6,1.15),100)):
    r=[]
    for fid in ids:
        s=pixel(fn(load(fid)),h);s.save(sp/'out'/f'ex_{label}_{fid}.png');r.append(s)
    rows.append(r)
sc=2;cw=max(x.width for r in rows for x in r)*sc+14;Hh=sum(max(x.height for x in r)*sc+12 for r in rows)
S=Image.new('RGB',(cw*len(ids),Hh),BG);y=0
for r in rows:
    mh=max(x.height for x in r)*sc
    for i,x in enumerate(r):
        b=x.resize((x.width*sc,x.height*sc),Image.NEAREST);S.paste(b,(i*cw+(cw-b.width)//2,y+mh-b.height),b)
    y+=mh+12
S.save(sp/'out/exag_sheet.png');print(S.size)
