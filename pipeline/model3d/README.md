# 3D 共用骨架 → 像素精靈圖（2026-11-08 使用者選定方向）

> 全員共用一副身體與骨架（MPFB 人體＋Mixamo 骨架）。每位選手只請 Gemini 畫兩張圖（身體皮膚、頭部多角度表），之後所有動作都由同一副骨架擺出，再渲染成像素圖。加新招式＝擺一次姿勢，對所有人批次渲染，不用再生圖。
> 畫風定案：**B＋卡通光影**（每公尺 56 像素、20 色、對比 1.2、一盞燈三個硬色階）。招式只取關鍵姿勢（起手、蓄力、命中、收招），中間用殘影、閃光、頓幀。
> 試做選手：Topuria。產出全部放在 gitignore 的 `prototype/web/assets/private/`（`_model3d/<選手>/`、`_anims/`）。

## 需要
- Blender 5.2＋MPFB 外掛：`blender --online-mode -c extension install -s --enable mpfb`
- Vertex AI（扣使用者的 GCP 抵用額度，每張約 NT$5）：本機 gcloud 已登入，並在 `pipeline/model3d/local.json`（gitignore）寫 `{"project": "...", "account": "..."}`。**不要把專案 ID 或帳號寫進 repo。**
- Mixamo 動作：使用者登入 Mixamo 後下載，放 `prototype/web/assets/private/_anims/mixamo/`（授權不允許公開散佈，不進 repo）。目前 50 個站立格鬥動作。

以下 `B` 代表 `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"`，`D` 代表 `prototype/web/assets/private/_model3d/<選手>`。

## 每位選手的步驟
1. **身體與白模**（身高 cm、體重 lb 取自 `rules/fighters.json`）：
   `B -b -P pipeline/model3d/base_body.py -- --out D --height 170 --weight 145`
   → `base_body.blend`（引導姿勢：手臂抬開、雙腿分開、眼球）、`guide_sheet.png`（正面、3/4 右、背面）、`guide_views.json`
2. **Gemini 畫身體皮膚**（1 張）：`uv run --no-project --with google-genai --with google-auth --with pillow python -I pipeline/model3d/paint_skin.py --fighter topuria`
   → `painted_sheet.png`。新選手要先加進 `paint_skin.py` 的 `FIGHTERS`（外觀、短褲）。
3. **貼回模型**：`B -b D/base_body.blend -P pipeline/model3d/bake_skin.py -- --dir D`
   → `skin.png`、`skinned.blend`；看 `align_check.png`（紅線＝白模輪廓）與 `preview.png`。3/4 左側由 3/4 右側鏡像；沒被任何角度看到的地方從周圍皮膚延伸補色。
4. **頭部白模**：`B -b D/base_body.blend -P pipeline/model3d/head_guide.py -- --dir D` → `head_guide.png`（6 個角度）
5. **Gemini 畫頭**（1 張）：`paint_skin.py --fighter topuria --part head` → `painted_head.png`
6. **切出頭部精靈**：`uv run --no-project --with pillow --with numpy python -I pipeline/model3d/head_sprites.py --dir D` → `head_<角度>.png`，看 `head_check.png`
7. **關鍵姿勢渲染**：`B -b D/skinned.blend -P pipeline/model3d/anim_render.py -- --dir D --anims <_anims/mixamo> --clips cross,kick_high --yaw=-80 --px 600 --keys`
   → `_keys/<招式>__{start,windup,impact,recovery,trailN}.png`。不加 `--keys` 則輸出逐格總表，加 `--gif` 另存動畫。
8. **像素化＋特效**：`uv run --no-project --with pillow --with numpy python -I pipeline/model3d/pixel_keys.py --dir D/_keys --clips cross,kick_high`
   → `pixel_<招式>.gif`、`pixel_storyboard.png`；`--variants` 輸出像素化強度比較。

## 為什麼這樣做（踩過的坑）
- **臉不能畫在 3D 頭上**：Gemini 畫的五官和通用臉型對不齊，怎麼看都怪（使用者否決）。頭改成 Gemini 畫的 2D 多角度精靈，放在頭部骨頭上，依頭的朝向換圖、跟著傾斜。
- **Gemini 不照版面畫**：會放大人物、加肩膀和格線。所以對位一律用「輪廓重疊最多」的搜尋，不信任它的位置；`image_size="2K"` 會被忽略（輸出約 1584×672）。
- **姿勢要對稱、手臂要離開身體**：否則會投影出手掌印、大腿內側破洞；鏡頭抬高 15° 才看得到頭頂。
- **不從斜角投影**：表面轉離鏡頭超過約 70° 就改用補色，否則邊緣的綠幕混色會被拉成淺色條紋。補色存成頂點色前要把 sRGB 轉成線性，不然會發白。
- **重定向要先對齊待機姿勢**：Mixamo 是 T 字、我們是 A 字。只轉換「相對待機的旋轉」會讓手臂整個往後甩；每根骨頭要先把方向對齊來源的待機方向。
- **像素化只平均人物本身的像素**：直接縮小會把透明背景混進邊緣，減色後變成紅黑雜點。
- 每公尺低於約 48 像素，刺青和臉就認不出來；B（56）是像素味和辨識度的平衡點。

## 還沒做
- 地面技：手擺兩人疊在一起的關鍵姿勢（同一個場景一起渲染，遮擋自然正確），擺一次全員通用。
- 放進 844×390 的對戰畫面，取代現在的 Gemini 姿勢表精靈圖；第二位選手（McGregor）驗證流程。
- 特效目前是程式畫的簡單火花，之後做一套共用特效。
