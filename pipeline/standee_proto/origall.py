import json,sys,re,urllib.request,pathlib,io
import numpy as np
from PIL import Image,ImageDraw
root,out,sp=sys.argv[1],pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3])
fs=json.load(open(root+'/data/fighters.json',encoding='utf8'))
UA={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'}
cw,ch=130,330
W=Image.new('RGB',(cw*8,ch*4),(110,110,120));D=ImageDraw.Draw(W);bad=[]
for n,f in enumerate(fs):
    t=out/f"{f['id']}.png"
    if not t.exists():
        p=re.search(r'/s3/(.+?)(\?|$)',f['fullBodyImageUrl']).group(1)
        try: t.write_bytes(urllib.request.urlopen(urllib.request.Request('https://ufc.com/images/'+p,headers=UA),timeout=60).read())
        except Exception as e: print('FAIL',f['id'],e);bad.append(f['id']);continue
    im=Image.open(t).convert('RGBA');box=im.getbbox();c=im.crop(box)
    a=np.array(c)[:,:,3]>128
    bw=a[-3:].sum(1).mean();print(f"{f['id']:24s} {im.size[0]}x{im.size[1]} bbox {c.size[0]}x{c.size[1]} ratio {c.size[1]/c.size[0]:.2f} bottomwidth {bw:.0f} kb {t.stat().st_size//1024}")
    c.thumbnail((cw-6,ch-16));x=(n%8)*cw;y=(n//8)*ch
    W.paste(c,(x+(cw-c.width)//2,y+14),c);D.text((x+2,y+1),f['id'][:20],fill=(255,255,0))
W.save(sp/'out/orig_all.png');print('bad',bad)
