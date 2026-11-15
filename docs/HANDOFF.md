# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Fable 5.2（40 位的做法：先看灰模、臉不磨）
- 使用者問 40 位要不要換方法：Topuria 最符合想像，O'Malley 難在頭髮。決定畫風不變，先改兩個流程預設。
- 做了：`gemini_paint.py` 沒有 `--shape-ok` 就不呼叫 Gemini，只出灰模 `clay_<mesh>.png`；`smooth_head.py` 臉中段不磨，頭髮遮罩蓋到臉中段超過 10% 就停（`--force` 可強制）；`exaggerate_head.py --jaw` 預設改 1.0。
- 驗證：Topuria 遮罩 1.5%、照常輸出（遮罩只差 7 點）；O'Malley 實心頭 19% 被擋下、沒存檔；`gemini_paint` 不加 `--shape-ok` 停在灰模，`painted.png` 沒動、沒用額度。只有兩位選手的數字。
- 還沒做：頭髮改成獨立髮型零件（等下一位難髮型選手再試）、身體共用體型範本。
- 下一步：使用者選一位短髮或光頭選手，照流程不改程式跑一次並計時（Gemini 剩 1 次，用前先問）。

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
