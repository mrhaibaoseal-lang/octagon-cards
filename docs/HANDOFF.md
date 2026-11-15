# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（找比《奧術》好做的畫風）
- 試了 A 卡面手繪立繪（Gemini 一張就成，很好）、兩階光（`attach_head --poster`）、材質色階化（斑塊，不行）、共用 MPFB 頭（重畫、修鬼影與接縫後仍不如重建頭）。Gemini 共 4 次，累計約 NT$225。
- 使用者決定：共用頭放棄（已寫進 RULES「不再嘗試」），籠內維持《奧術》重建頭。
- 等使用者決定：卡面／特寫要不要改用 A 立繪；兩階光要不要取代三階光。見 `docs/ART_SPEC.md`「畫風試驗」。
- 下一步：回到 TASKS「選手畫風」，選一位短髮或光頭選手不改程式跑一次並計時。

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
