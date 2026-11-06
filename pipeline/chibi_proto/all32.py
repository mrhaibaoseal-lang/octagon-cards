import json,sys,urllib.request,pathlib,runpy,colorsys
import numpy as np
from PIL import Image,ImageDraw
root,ph,out=sys.argv[1],pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3])
fs=json.load(open(root+'/data/fighters.json',encoding='utf8'))
for f in fs:
    t=ph/f"{f['id']}_full.png"
    if not t.exists():
        r=urllib.request.Request(f['fullBodyImageUrl'],headers={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'})
        t.write_bytes(urllib.request.urlopen(r,timeout=30).read())
sys.argv=['proto',str(ph),str(out)]
src=open(pathlib.Path(__file__).parent/'proto.py',encoding='utf8').read()
src=src[:src.index('ids=list(FIGHTERS)')]
g={'__name__':'proto'};exec(src,g)
def auto_shorts(path,skin):
    im=np.array(Image.open(path).convert('RGBA'))
    rows=np.nonzero((im[:,:,3]>128).sum(1))[0];b=rows[-1]
    band=im[max(0,b-26):b-2];px=band[band[:,:,3]>128][:,:3].astype(int)
    far=px[np.abs(px-np.array(skin)).sum(1)>110]
    far=far[np.abs(far*1.0-np.array(g['shade'](skin,.7))).sum(1)>80]
    return tuple(int(v) for v in np.median(far,axis=0)) if len(far)>len(px)*.22 else None
cell=(112,212);cols=8
W=Image.new('RGB',(cell[0]*cols,cell[1]*4),(26,29,40));D=ImageDraw.Draw(W)
bad=[]
for n,f in enumerate(fs):
    fid=f['id'];full=ph/f'{fid}_full.png'
    try:
        skin=g['sample_skin'](full);sh=auto_shorts(full,skin)
        fb=sh is None
        sh=sh or (44,46,54)
        g['FIGHTERS'][fid]=dict(ink={},tint=None);g['BUILD'][fid]=1.0;g['SHORTS_OVERRIDE'][fid]=sh
        im=g['trim_'](g['fighter_frame'](fid,34,25,'idle'))
        print(fid,'skin',skin,'shorts',sh,'FALLBACK' if fb else '',g['extract_head'](full).size)
        im=im.resize((im.width*2,im.height*2),Image.NEAREST)
        x=(n%cols)*cell[0];y=(n//cols)*cell[1]
        W.paste(im,(x+(cell[0]-im.width)//2,y+cell[1]-14-im.height),im)
        D.text((x+3,y+cell[1]-12),f['name'].split()[-1][:16],fill=(220,220,220))
    except Exception as e:
        print('FAIL',fid,e);bad.append(fid)
W.save(out/'all32.png');print('bad',bad)
# battle mock at 844x390
sc=3
M=Image.new('RGB',(844,390),(24,27,36));d=ImageDraw.Draw(M)
d.polygon([(80,330),(764,330),(844,390),(0,390)],fill=(60,64,76));d.rectangle((0,0,844,38),fill=(10,11,16))
for fid,x,pose,flip in (('ilia-topuria',270,'idle',False),('israel-adesanya',570,'jab',True)):
    if fid not in g['SHORTS_OVERRIDE']: continue
    g['FIGHTERS'][fid]={'ilia-topuria':dict(ink=dict(chest=3,belly=0,uF=3,fF=3,uB=1,fB=1),tint=None),'israel-adesanya':dict(ink=dict(chest=2,belly=1,uF=1,fF=1,uB=3,fB=3),tint=None)}[fid]
    im=g['trim_'](g['fighter_frame'](fid,34,25,pose));im=im.resize((im.width*sc,im.height*sc),Image.NEAREST)
    if flip: im=im.transpose(Image.FLIP_LEFT_RIGHT)
    M.paste(im,(x-im.width//2,345-im.height),im)
M.save(out/'battle_mock.png')
