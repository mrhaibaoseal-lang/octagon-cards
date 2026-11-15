# 低面數半條命風試驗（2026-11-15）

一個程式蓋的通用人體，每位選手只換貼圖。v2（2026-11-15）：約 2,300 三角形；手臂從斜方肌裡的圓頂一路到連指手套是一條管子、腿從髖裡到腳踝一條管子（環的方向沿路徑平行移動，不會扭），軀幹 16 邊、有胸肌、脊椎溝、斜方肌斜坡，頭 16 邊，手套加拇指。

```
blender -b -P pipeline/lowpoly/build_fighter.py -- <private 絕對路徑> <private>/_lowpoly --clay
uv run --no-project --with google-genai --with google-auth --with pillow --with numpy python -I pipeline/lowpoly/paint_lowpoly.py [--call]
```

- `build_fighter.py`：骨架點（`J`）和每條管子的環（半寬、半深、方度 n、世界座標偏移）決定形狀與姿勢；只出灰模（`--clay` 留著相容舊指令），拍 `lp_34／side／back／head_clay.png`。v1 的「照片切塊直接貼」已拿掉。
- 坑：手臂的管子若從軀幹橫著伸出來再往下轉，肩膀會有方角；要從肩膀上方往下走。大腿頂端要被髖部的環包住，不然短褲邊會露一圈稜。
- `paint_lowpoly.py`（v2 提示詞改成照片拼貼、陰影皺褶畫進貼圖、輕微髒污、對比強偏灰、短褲禁止任何標誌）：灰模拍全身四視角（16:9）和頭四視角（2×2），`--call` 才呼叫 Gemini（2 次，約 NT$10），把畫好的圖依面朝向、遮擋投影回 UV（頭在貼圖裡放大 3 倍），輸出 `_lowpoly/paint/texture.png` 和 `g_*.png`。
- 坑：照片透明背景是黑色，要先往外補色；鼻子耳朵的面方向要朝外，不然正面照不到、會借到旁邊的紅色；頭的側面圖 Gemini 會把鼻子畫在別處，鼻子只取正面；綠幕邊緣要多切 3 像素。
- 換選手：改 `--name`、`--body-photo`、`--head-photo` 和提示詞裡的外觀描述；改了網格要刪 `paint/` 裡的 atlas.blend、pos/nrm/vis.npy 重來。
