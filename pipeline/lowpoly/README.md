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

## v3：MPFB 共用全身（2026-11-15，灰模，等使用者選面數）

程式拉管子做不出像樣的人體，改成 MPFB 生一個共用全身，模型只修一次，新選手只換貼圖。

```
blender -b -P pipeline/lowpoly/build_mpfb.py -- <private 絕對路徑>/_lowpoly/mpfb [--preset feather_muscle] [--tris 3000,5000] [--keep 3]
uv run --no-project --with pillow python -I pipeline/lowpoly/mpfb_sheet.py prototype/web/assets/private/_lowpoly/mpfb [--tris 3000,5000]
```

- 流程：MPFB 人體（巨集＋`BULK_TARGETS` 加肌肉）→ 加 mixamo 骨架（這一步需要 MPFB 的關節小方塊，輔助幾何要在它之後才刪）→ 只留皮膚和兩顆眼球、刪掉手 → 在對稱站姿減面（`use_symmetry`，`keep` 群組讓臉、手腕、肩膀多留面）→ 擺架式（`STANCE` 是方向不是座標，換身高照用）→ 套用骨架、加方塊手套（超橢球＋護腕）→ 腳貼地、平面著色、物件名 `fighter`。
- 體型範本只是 `PRESETS` 的參數（身高、體重、muscle、bulk、proportions、額外 target、手套大小）；`feather_muscle` 是 Topuria 型，其他三個還沒看過。
- 輸出：`mpfb_<preset>_<面數>.blend`（含相機，`paint_blender.py render` 會用）、四張灰模、`mpfb_<preset>_meta.json`（`head_z` 約 1.44、鼻子位置、頭中心）。`--tris` 給比網格大的數字就是不減面。
- 坑：在擺好的姿勢上減面會左右不對稱、身體被削成細竹竿，要先減再擺；EEVEE 灰模有大塊黑影像破洞，改用 Workbench 看形狀；用骨架彎手指握拳很難調，減面後也只剩一團，直接換手套。嘴巴凸成鳥嘴（2026-11-15 使用者指出）：臉的面被耳朵摺和眼皮吃掉，而保護嘴巴的中心點原本放在嘴巴關節（嘴唇後 7 公分），嘴唇幾乎沒保護到；改成以嘴唇、鼻尖、眼睛、下巴為中心加權，耳朵只給 0.3、眼球 0。只刪口腔內壁沒有用。
- 使用者選 5,000 面（2026-11-15）。`build_mpfb.py` 每個面數另出一份**上色姿勢**（`_guide.blend`：雙手往下外張約 25°、腿分開、頭擺正），網格和架式版是同一份減面結果、頂點順序一樣。
- 上色（`paint_lowpoly.py`，預設就是 MPFB 5,000 面）：在上色姿勢拍灰模、投影、烘焙，最後 `paint_blender final --pose-blend` 把頂點位置換成架式版再出圖；頭的範圍改用 `mixamorig:Head` 頂點群組（不再用高度切，手套靠近臉也不會算成頭）；鼻子遮罩讀 `_guide_meta.json`；全身改 5 格（加由上往下）、Gemini 比例 21:9。
- `--coverage` 不呼叫 Gemini，只算外面看得到的表面（26 個方向射線，排除眼球背面、護腕裡面）有多少被視角拍到：上色姿勢 96.3%（加俯視 96.6%），直接在架式上拍是 95.3%（96.2%）。俯視只多不到 1%；v2 的 24% 多半是把眼球背面這類看不到的面也算進去。
- 第一次上色（2026-11-15，Gemini 2 次）：Gemini 的輪廓和灰模幾乎完全重疊（97～100%），結果在 `_lowpoly/paint_mpfb/g_cmp.png`、臉近照 `g_face.png`。修了三件事：綠幕邊緣預設從 3 像素改 1（小腿只有約 25 像素寬，切 3 像素就少四分之一；切 0 會留綠邊），外面看得到的表面上色比例 85.6% → 90.5%；俯視圖也拿來畫頭頂；頭的上色範圍放寬到 `mixamorig:Head` 權重 > 0.15（下顎權重偏脖子，原本鬍子不見），取景照舊用 > 0.5，否則和已畫好的圖對不上。
- 還看得到的問題：頭頂有一塊偏白的三角形（俯視圖裡的頭很小）、脖子和下巴交界有鋸齒狀的接縫、短褲側面和臀部有幾塊淡色三角形（上色姿勢的手臂擋住腰側）；沒上色的多半在腳（24%）和大腿到腰（53%）。
