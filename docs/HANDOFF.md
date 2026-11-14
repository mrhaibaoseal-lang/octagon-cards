# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（《奧術》畫風正式採用＋換 O'Malley 驗證流程）
- 做了：RULES §4、`docs/ART_SPEC.md`、AGENTS §0 改成《奧術》式手繪畫風（3D 模型唯一來源，寫實與像素路線列為歷史／不再嘗試）；用 O'Malley 從頭跑一次流程，把只對 Topuria 有效的地方改成通用（`fix_texture`、`smooth_head`、`gemini_paint --fighter`、`paint_body` 提示詞），新增捲髮用的 `solid_head.py`。
- 驗證：並排圖 `_img2_3d/cmp_topuria_omalley_full.png`、`..._close.png`；Topuria 的磨平遮罩改完幾乎不變；Gemini 4 次（約 NT$20）。
- 結果：畫風、膚色、脖子接縫、身體刺青和 Topuria 一樣好；捲髮是光滑的一整團、額頭幾塊補色、臉頰刺青被拉長，比較差。
- **要使用者確認**：O'Malley 這個程度可不可以；要不要再花約 NT$5 在最終網格上重畫一次頭。`pipeline/model3d/` 有 Gemini 未 commit 的修改（含 O'Malley 描述改成大爆炸頭），沒動。
- 下一步：使用者看圖決定；之後可再試第三位（光頭或長髮）。

## 2026-11-15 · Claude Opus 5.5（選手畫風：寫實 → 《奧術》方向）
- 做了：頭髮鬍子眉毛磨平（`smooth_head.py`）；使用者覺得寫實很糟，改試風格：《奧術》方向（`exaggerate_head.py` 臉型誇張化＋`gemini_paint.py --style painted`＋`style_head.py` 卡通光描邊）與復古低面數（`retro_head.py`）。
- 驗證：只看渲染圖，對照在 `_img2_3d/style_cmp2.png`；Gemini 呼叫一次（約 NT$5）。
- 使用者看了說《奧術》方向「也太好看」；臉型誇張減半、身體也手繪重畫（`paint_body.py`）、校膚色、去綠、不描邊後說「整體看起來棒透了」。
- **要使用者確認**：是否正式採用（要改 RULES／ART_SPEC 的美術段）；`pipeline/model3d/` 有 Gemini 未 commit 的修改，沒動。
- 下一步：使用者確認正式採用後改 RULES／ART_SPEC；換一位長相差很多的選手跑一次整個流程。

## 2026-11-14 · Claude Opus 5.5（V3 選手：先 2.5D、之後可能 3D；人物品質）
- 決定：使用者要先用 2.5D 試，最後很可能改全 3D（看了 UFC 6），並要提升人物品質；方針是把 3D 模型當唯一來源，精靈圖只是它的一種輸出，之後換 3D 不用重做。
- 建議的品質做法（等使用者選）：①渲染改成高解析卡通描邊、少像素化；②臉：用照片的臉部特徵點自動調 MPFB 臉型再上色（舊路線失敗在臉型對不齊）；③身體：修太寬、每人自己的站姿與臂展、皮膚分底膚色／刺青／短褲三層；④動作：之後從真實比賽影片抓動作。先拿 Topuria 一位做前後對照。
- 驗證：只改文件；本機顯卡 RTX 5050 筆電版 8GB，可試小型的開源圖生 3D 模型，不保證可用。
- **要使用者確認**：先試哪一項；要不要先和 Gemini 對齊（`pipeline/model3d/` 有 Gemini 未 commit 的修改，沒動）。
- 下一步：照舊先做 V3 灰盒原型；品質實驗和它並行、互不干擾。
