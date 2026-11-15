# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（V3 灰盒戰鬥）
- 做了可玩的 V3 灰盒 `prototype/web/v3.html`：three.js 八角籠、膠囊選手、側面轉播鏡頭（你永遠在左）、4 招＋防禦＋閃躲，鍵盤與觸控都能玩；數值在 `rules/v3/config.json`，引擎 `v3/engine.js`、AI `v3/ai.js`（三種打法）。
- 驗證：`node --test prototype/web/v3/test.js` 6 項過；AI 對 AI 20 場全 KO、平均 46 秒；瀏覽器 844×390 看過，無錯誤。
- 要使用者確認：好不好玩；亂按是否太強（我測亂按 20 秒打出 103 比 66）；AI 強弱。
- 下一步：照使用者試玩感受調數值；好玩再接商店。

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
