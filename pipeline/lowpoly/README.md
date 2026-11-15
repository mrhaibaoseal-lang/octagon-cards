# 低面數半條命風試驗（2026-11-15）

一個程式蓋的通用人體（四邊形環狀拉伸：手腳 8 邊、軀幹 12 邊、頭 12 邊，約 1,100 三角形），每位選手只換貼圖。

```
blender -b -P pipeline/lowpoly/build_fighter.py -- <private 絕對路徑> <private>/_lowpoly --clay
uv run --no-project --with google-genai --with google-auth --with pillow --with numpy python -I pipeline/lowpoly/paint_lowpoly.py [--call]
```

- `build_fighter.py`：骨架點（`J`）和每段的環（半寬、半深）決定形狀與姿勢；不加 `--clay` 會直接把照片切塊貼上（只能看正面，側面全是拉長條紋，不要用）。
- `paint_lowpoly.py`：灰模拍全身四視角（16:9）和頭四視角（2×2），`--call` 才呼叫 Gemini（2 次，約 NT$10），把畫好的圖依面朝向、遮擋投影回 UV（頭在貼圖裡放大 3 倍），輸出 `_lowpoly/paint/texture.png` 和 `g_*.png`。
- 坑：照片透明背景是黑色，要先往外補色；鼻子耳朵的面方向要朝外，不然正面照不到、會借到旁邊的紅色；頭的側面圖 Gemini 會把鼻子畫在別處，鼻子只取正面；綠幕邊緣要多切 3 像素。
- 換選手：改 `--name`、`--body-photo`、`--head-photo` 和提示詞裡的外觀描述；改了網格要刪 `paint/` 裡的 atlas.blend、pos/nrm/vis.npy 重來。
