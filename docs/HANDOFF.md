# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Fable 5.2（40 位的做法：先看灰模、臉不磨）
- 使用者問 40 位要不要換方法：Topuria 最符合想像，O'Malley 難在頭髮。決定畫風不變，先改兩個流程預設。
- 做了：`gemini_paint.py` 沒有 `--shape-ok` 就不呼叫 Gemini，只出灰模 `clay_<mesh>.png`；`smooth_head.py` 臉中段不磨，頭髮遮罩蓋到臉中段超過 10% 就停（`--force` 可強制）；`exaggerate_head.py --jaw` 預設改 1.0。
- 驗證：Topuria 遮罩 1.5%、照常輸出（遮罩只差 7 點）；O'Malley 實心頭 19% 被擋下、沒存檔；`gemini_paint` 不加 `--shape-ok` 停在灰模，`painted.png` 沒動、沒用額度。只有兩位選手的數字。
- 還沒做：頭髮改成獨立髮型零件（等下一位難髮型選手再試）、身體共用體型範本。
- 第三位：使用者選 Volkanovski。沒有 `_ufc.png` 也不在 `paint_skin.FIGHTERS`，只有全身照；裁頭（`inputs/volkanovski_photo.png`，(440,0,1120,455)，避開肩上的腰帶）直接跑 TRELLIS（免費，270 秒，要設 `HF_HOME=D:/img2_3d/hf`）→ 灰模 `_img2_3d/clay_volkanovski_photo_fix.png`：光頭、鬍子、鼻子、耳朵像本人。
- 使用者看第一版灰模：形狀完全不對（側面臉凸又長像馬、下巴凹洞）。原因是裁太緊沒脖子肩膀；第二版留脖子肩膀、擦掉腰帶重跑 → `clay_volkanovski_photo2_fix.png`，側面正常很多、下巴沒洞，**等使用者看**。
- 使用者說第二版可以、要加自動轉正：試了兩種算法都不行（細節在 `pipeline/img2_3d/README.md` 最後一節），腳本沒留。問題不是頭轉了角度，是微側臉照片生出的頭本身扭曲；`smooth_head` 的比例也只認 Gemini 頭像的取景。
- 結論：照片路線不能當預設，Volkanovski 要走 `gen_head.py`（Gemini 正面頭像，同 Topuria）。先要在 `paint_skin.FIGHTERS` 加他（那個檔有 Gemini 未 commit 的修改，動之前先問）並準備 `_source/volkanovski_ufc.png`。
- 使用者同意後用掉最後 1 次 Gemini 畫正面頭像：照原流程不改程式約 5 分鐘到灰模 `_img2_3d/clay_volkanovski_smooth.png`，正面對稱、守門通過（2.2%）；髮根和鬍子表面還是一粒粒。
- 使用者看灰模：「應該可以試試看」。已做 `exaggerate_head --brow 0.007 --chin 0.005` → `volkanovski_arcane.glb`；`gemini_paint.py` 加 `--name`（不用改 `paint_skin.FIGHTERS`）和 Volkanovski 的 `HAIR`；四視角綠底圖已出（`paint/volkanovski_arcane/grid.png`），沒呼叫 Gemini。
- 下一步：Gemini 額度用完，**使用者同意再用 1 次才上色**：`gemini_paint.py --mesh volkanovski_arcane --fighter volkanovski --name "Alexander Volkanovski" --style painted --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _ar --shape-ok` → `degreen.py`；身體（MPFB、`paint_body`）還沒開始。

## 2026-11-15 · Claude Opus 5.5（O'Malley 臉貼回原始網格）
- 做了：`keep_face.py` 重寫分類（輸入圖投影、色相判斷紅粉藍頭髮、從鼻尖長出臉、刺青小島算臉、破洞補平）；`solid_head.py` 加 `--no-uv`。
- 驗證：灰模 `_img2_3d/clay_keep_new_cmp.png`，第 3、4 列的臉和原始網格（第 1 列）一樣；只看灰模，沒上色。
- 使用者選第 3 列（捲髮塊）；`solid_head --shape --faces 60000` 減面、展 UV、烘底色完成（`omalley_keep06_uv.glb`），臉型不變。
- 上色（Gemini 第 7 次，額度用完）並接回身體：`om_keep_vs_old_close.png`，臉變長窄、捲髮有蓬度。
- 使用者：像，可以了。後頸偏白、瀏海下膚色縫先不修。
- 下一步：使用者說可以就換下一位選手照同流程（Gemini 剩 1 次，用前先問）；坑與指令在 `pipeline/img2_3d/README.md` 最後一節。

## 2026-11-15 · Claude Opus 5.5（O'Malley 頭型重做：找出臉被磨掉的原因）
- 做了：`gen_head.py` 加 `--look`／`--name`，生了貼頭短髮頭像（Gemini 第 6 次，NT$5）；`render_turntable.py` 加 `--clay` 灰模；新 `keep_face.py`（把處理過的頭的臉貼回 TRELLIS 原始表面）；直接用真人照片跑 TRELLIS（免費）。
- 驗證：灰模 `_img2_3d/clay_face_cmp.png`：原始網格是長窄臉像本人，`solid_head`＋`smooth_head` 把五官磨掉（`om_mask.png` 頭髮遮罩蓋滿臉）；短髮頭像被 Gemini 改成方臉，使用者說和本人沒關係。
- **要使用者確認**：已選原始網格（第 1 列；第 5 列真人照片版也可以）。`keep_face.py` 的頭髮分類還不準，臉只回來一部分（`clay_keep_cmp.png`）。
- 下一步：照 README 最後一節「臉被磨掉」修分類（改用幾何＋正面圖判斷），臉型對了再上色；O'Malley 不要用 `--jaw 1.06`。
