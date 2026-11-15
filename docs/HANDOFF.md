# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（O'Malley 臉貼回原始網格）
- 做了：`keep_face.py` 重寫分類（輸入圖投影、色相判斷紅粉藍頭髮、從鼻尖長出臉、刺青小島算臉、破洞補平）；`solid_head.py` 加 `--no-uv`。
- 驗證：灰模 `_img2_3d/clay_keep_new_cmp.png`，第 3、4 列的臉和原始網格（第 1 列）一樣；只看灰模，沒上色。
- 使用者選第 3 列（捲髮塊）；`solid_head --shape --faces 60000` 減面、展 UV、烘底色完成（`omalley_keep06_uv.glb`），臉型不變。
- **要使用者確認**：用最後 1 次 Gemini 額度上色。
- 下一步：`gemini_paint.py --mesh omalley_keep06_uv` 上色（Gemini 剩 1 次，用前先問）；坑與指令在 `pipeline/img2_3d/README.md` 最後一節。

## 2026-11-15 · Claude Opus 5.5（O'Malley 頭型重做：找出臉被磨掉的原因）
- 做了：`gen_head.py` 加 `--look`／`--name`，生了貼頭短髮頭像（Gemini 第 6 次，NT$5）；`render_turntable.py` 加 `--clay` 灰模；新 `keep_face.py`（把處理過的頭的臉貼回 TRELLIS 原始表面）；直接用真人照片跑 TRELLIS（免費）。
- 驗證：灰模 `_img2_3d/clay_face_cmp.png`：原始網格是長窄臉像本人，`solid_head`＋`smooth_head` 把五官磨掉（`om_mask.png` 頭髮遮罩蓋滿臉）；短髮頭像被 Gemini 改成方臉，使用者說和本人沒關係。
- **要使用者確認**：已選原始網格（第 1 列；第 5 列真人照片版也可以）。`keep_face.py` 的頭髮分類還不準，臉只回來一部分（`clay_keep_cmp.png`）。
- 下一步：照 README 最後一節「臉被磨掉」修分類（改用幾何＋正面圖判斷），臉型對了再上色；O'Malley 不要用 `--jaw 1.06`。

## 2026-11-15 · Claude Opus 5.5（《奧術》畫風正式採用＋換 O'Malley 驗證流程）
- 做了：RULES §4、`docs/ART_SPEC.md`、AGENTS §0 改成《奧術》式手繪畫風（3D 模型唯一來源，寫實與像素路線列為歷史／不再嘗試）；用 O'Malley 從頭跑一次流程，把只對 Topuria 有效的地方改成通用（`fix_texture`、`smooth_head`、`gemini_paint --fighter`、`paint_body` 提示詞），新增捲髮用的 `solid_head.py`。
- 驗證：並排圖 `_img2_3d/cmp_topuria_omalley_full.png`、`..._close.png`（三列：Topuria／沿用版／重畫版）；Topuria 的磨平遮罩改完幾乎不變；Gemini 5 次（約 NT$25，第 5 次使用者同意重畫頭）。
- 結果：畫風、膚色、脖子接縫、身體刺青和 Topuria 一樣好；捲髮是光滑的一整團、額頭幾塊補色、臉頰刺青被拉長，比較差。
- **要使用者確認**：O'Malley 沿用版和重畫版哪個好、這個程度可不可以；臉頰與額頭的斑是網格造成的，要修就從形狀下手。`pipeline/model3d/` 有 Gemini 未 commit 的修改（含 O'Malley 描述改成大爆炸頭），沒動。
- 下一步：使用者看圖決定；之後可再試第三位（光頭或長髮）。
