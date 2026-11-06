import sys,pathlib,json,re,math
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
root,sp=sys.argv[1],pathlib.Path(sys.argv[2])
sys.argv=['x',root,str(sp),'ilia-topuria']
src=open(pathlib.Path(__file__).parent/'exag.py',encoding='utf8').read();src=src[:src.index("ids=sys.argv[3]")]
g={'__name__':'x'};exec(src,g)
pixel,exaggerate,load=g['pixel'],g['exaggerate'],g['load']
fs=json.load(open(root+'/data/fighters.json',encoding='utf8'))
BG=(42,44,56)
def make(fid): return pixel(exaggerate(load(fid),1.9,.88,.6,1.15),100)
# all 32
sp32=[make(f['id']) for f in fs]
cols=8;cw=max(s.width for s in sp32)+6;ch=112
A=Image.new('RGB',(cw*cols,ch*4),BG)
for n,s in enumerate(sp32): A.paste(s,((n%cols)*cw+(cw-s.width)//2,(n//cols)*ch+ch-4-s.height),s)
A=A.resize((A.width*2,A.height*2),Image.NEAREST);A.save(sp/'out/exag_all32.png');print(A.size)
# battle mock
S=3
def shear(im,dx):
    a=np.array(im);h,w=a.shape[:2];pad=abs(dx)+1;o=np.zeros((h,w+2*pad,4),np.uint8)
    for y in range(h):
        off=int(round(dx*(h-1-y)/(h-1)))
        o[y,pad+off:pad+off+w]=a[y]
    return Image.fromarray(o)
def big(im,k=S): return im.resize((im.width*k,im.height*k),Image.NEAREST)
def font(sz):
    return ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',sz)
def stage(dark=1.):
    im=Image.new('RGB',(844,390),(14,16,24));d=ImageDraw.Draw(im)
    for r,c in ((430,(30,33,46)),(330,(38,42,58)),(230,(46,50,70))):
        d.polygon([(422+r*1.15*math.cos(math.radians(22.5+45*i)),260+r*.42*math.sin(math.radians(22.5+45*i))) for i in range(8)],fill=c)
    for x in range(-120,960,32):
        d.line((x,0,x+90,200),fill=(26,28,38));d.line((x+90,0,x,200),fill=(26,28,38))
    if dark<1: im=Image.eval(im,lambda v:int(v*dark))
    return im
def hud(M,l,r,lv=1.,rv=1.):
    d=ImageDraw.Draw(M);d.rectangle((0,0,844,30),fill=(8,9,14));f=font(13)
    d.text((10,7),l,fill=(235,235,235),font=f);tw=d.textlength(r,font=f);d.text((834-tw,7),r,fill=(235,235,235),font=f);t='ROUND 1';d.text((422-d.textlength(t,font=f)/2,7),t,fill=(240,200,70),font=f)
    for x0,x1,v,al in ((130,370,lv,0),(474,714,rv,1)):
        d.rectangle((x0,10,x1,20),fill=(50,52,60));n=int((x1-x0)*v);d.rectangle((x1-n,10,x1,20) if al==0 else (x0,10,x0+n,20),fill=(216,58,48))
def burst(M,cx,cy,R,t):
    d=ImageDraw.Draw(M)
    def star(r,c):
        d.polygon([(cx+r*(1 if i%2==0 else .5)*math.cos(math.pi*i/10),cy+r*(1 if i%2==0 else .5)*math.sin(math.pi*i/10)) for i in range(20)],fill=c)
    star(R*1.12,(20,20,28));star(R,(250,190,40));star(R*.6,(255,246,210));f=font(22);d.text((cx-d.textlength(t,font=f)/2,cy-13),t,fill=(190,30,30),font=f)
def card(M):
    d=ImageDraw.Draw(M)
    for i in range(5):
        x=422+(i-2)*72;d.rounded_rectangle((x-33,352,x+33,420),radius=6,fill=(24,28,42),outline=(90,150,190))
A0=sp32[[f['id'] for f in fs].index('ilia-topuria')];B0=sp32[[f['id'] for f in fs].index('islam-makhachev')].transpose(Image.FLIP_LEFT_RIGHT)
G=366 # ground y
f1=stage();a=big(A0);b=big(B0);f1.paste(a,(170,G-a.height),a);f1.paste(b,(844-170-b.width,G-b.height),b);card(f1);hud(f1,'Ilia Topuria','Islam Makhachev')
f2=stage();a=big(shear(A0,9));b=np.array(B0).astype(float);b[:,:,:3]=b[:,:,:3]*.7+np.array([220,40,30])*.3
b=big(shear(Image.fromarray(b.astype(np.uint8)),10));f2.paste(b,(844-120-b.width,G-b.height),b);f2.paste(a,(290,G-a.height),a);burst(f2,560,130,46,'-18');hud(f2,'Ilia Topuria','Islam Makhachev',1,.62)
f3=stage(.6);a=big(A0);f3.paste(a,(140,G-a.height),a)
c=np.array(B0);gray=c[:,:,:3].mean(2,keepdims=True).repeat(3,2);c[:,:,:3]=gray.astype(np.uint8);c=big(Image.fromarray(c).rotate(-90,expand=True));f3.paste(c,(400,G-c.height+6),c)
d=ImageDraw.Draw(f3);fk=font(84);t='KO';tw=d.textlength(t,font=fk);d.text((426-tw/2+4,52),t,fill=(0,0,0),font=fk);d.text((426-tw/2,48),t,fill=(232,48,40),font=fk);hud(f3,'Ilia Topuria','Islam Makhachev',.8,0)
O=Image.new('RGB',(844,1190),(0,0,0))
for i,f in enumerate((f1,f2,f3)): O.paste(f,(0,i*400))
O.save(sp/'out/exag_mock.png');print(O.size,A0.size)
