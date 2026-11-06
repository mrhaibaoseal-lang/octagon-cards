import sys,pathlib
from PIL import Image,ImageDraw
sp=pathlib.Path(sys.argv[1])
ids=sys.argv[2].split(',')
out=Image.new('RGB',(620*len(ids),1560),(110,110,120))
for i,fid in enumerate(ids):
    im=Image.open(sp/'orig'/f'{fid}.png').convert('RGBA');im=im.crop(im.getbbox());k=460/im.width
    im=im.resize((460,int(im.height*k)),Image.LANCZOS);print(fid,im.size)
    bg=Image.new('RGBA',(im.width,im.height),(150,150,160,255));bg.alpha_composite(im);d=ImageDraw.Draw(bg)
    for x in range(0,460,50): d.line((x,0,x,im.height),fill=(0,255,255,255) if x%100==0 else (0,120,120,255));d.text((x+2,2),str(x),fill=(255,255,0,255))
    for y in range(0,im.height,50):
        d.line((0,y,460,y),fill=(0,255,255,255) if y%100==0 else (0,120,120,255));d.text((2,y+1),str(y),fill=(255,255,0,255))
    out.paste(bg.convert('RGB'),(i*620+80,0))
out.save(sp/'out/grid.png')
