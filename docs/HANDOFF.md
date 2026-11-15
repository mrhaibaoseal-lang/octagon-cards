# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（Volkanovski 鬍子封孔）
- 上色前封孔：新 `outer_walls.py` → `seal_head.py`（外壁體素化、底板、膨脹 5 格灌水、marching cubes、貼回外壁）→ 鼻尖以下的封孔面和原網格鼻尖以上的面用 `merge_heads.py` 合併 → `solid_head --shape` → `gemini_paint --reuse`（沒呼叫 Gemini）。做法與坑在 `pipeline/img2_3d/README.md` 最後兩條。
- 結果 `_img2_3d/trellis2/volkanovski_seal_paint_ar_ng.glb`、比對 `_img2_3d/volk_seal_cmp.png`（上 `_in`、下新版）：側面和 3/4 的鬍子淺點全沒了，眼睛眉毛一樣，額頭、脖子沒有新凸塊或洞。
- 還剩：3/4 鬍子幾個很淺的小凹；肩膀最下緣（接身體會切掉的部分）黑斑較多。
- **要使用者看** `volk_seal_cmp.png`，可以就用新檔取代 `_in` 版。下一步照上一筆：選一位短髮或光頭選手跑一次並計時。

## 2026-11-15 · Claude Opus 5.5（低面數路線結束）
- MPFB 共用全身 5,000 面＋Gemini 上色做完（外面看得到的表面 90.5% 上到色，鬍子刺青短褲都在）。
- 使用者看了：比《奧術》版醜太多，這條路行不通，要刪掉。
- 已刪 `pipeline/lowpoly/`（在 commit 9d13ad5 之前的紀錄裡），RULES「不再嘗試」補上這次；TASKS 拿掉這一項。
- 回到《奧術》路線：下一步照 TASKS「選手畫風」那一項，使用者選一位短髮或光頭選手不改程式跑一次並計時。

## 2026-11-15 · Claude Opus 5.5（低面數 v3：MPFB 共用全身灰模）
- 新增 `pipeline/lowpoly/build_mpfb.py`：MPFB 肌肉型男性（`feather_muscle` 範本，170 cm）＋通用頭、保留眼球、手換方塊手套，先在對稱站姿減面（臉、手腕、肩膀多留面）再擺 v2 的正統架式，合成 `fighter`；`mpfb_sheet.py` 拼比較圖。
- 結果 `_lowpoly/mpfb/mpfb_feather_muscle_cmp.png`：3,000／5,000／未減面三列，各 3/4、側、背、頭近照；沒有呼叫 Gemini。
- 使用者指出兩版嘴巴都凸成鳥嘴：多留面的權重改以嘴唇、鼻尖、眼、下巴為中心，耳朵少給、眼球不給，已修好（3,000 面也看得出嘴唇），比較圖已重出。
- 看得到的問題：3,000 面腿細有尖角、耳朵只剩小凸起；5,000 面臉讀得出眼鼻嘴耳，但腿和臀比未減面瘦一圈；身材比 Topuria 本人瘦；手套是方塊占位；後腳整個腳掌貼地；胯下是 MPFB 裸體形狀（之後畫短褲）。
- 要使用者確認：選 3,000 或 5,000（或其他面數）、形狀可不可以；之後再決定是否加粗或改架式。
- 使用者選 5,000 面。上色流程已接好：雙手張開的上色姿勢（同一網格）拍 5 視角（含俯視）→ 投影 → 套回架式；頭用 `mixamorig:Head` 群組判斷；外面看得到的表面 96.6% 拍得到（俯視只多 0.3%）。
- 使用者同意後上色（Gemini 2 次）：結果 `_lowpoly/paint_mpfb/g_cmp.png`、`g_face.png`；綠幕邊緣改 1 像素、俯視畫頭頂、頭的上色範圍含下顎（鬍子回來），外面看得到的表面 90.5% 上到色。
- 下一步：使用者看結果、決定要不要採用這個方向；小問題是頭頂白塊、脖子接縫鋸齒、短褲側面淡色三角。
