# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（三位選手的遊戲畫面模擬）
- 把 Topuria、O'Malley、Volkanovski 擺成格鬥架式，放進八角籠用側面轉播鏡頭渲染；圖在 `_mockup/all3.jpg`。
- 依使用者意見：肚子改平（`base_body.py` 預設不加 `TORSO_FILL`、舊身體用 `flatten_belly.py`）、真的握拳＋暫代拳套、Volkanovski 自己的身體（Gemini 1 次）；`bake_skin` 去綠只做輪廓邊，綠短褲不再變灰。
- 驗證：側面、手部特寫和三組畫面都看過；拳套與架式是模擬腳本臨時做的。
- 要使用者確認：新畫面的肚子、拳套、Volkanovski 頭身比。下一步：正式的拳套模型與動作，或回到「選手畫風」量產。

## 2026-11-15 · Claude Opus 5.5（V3 灰盒第二版：互換）
- 使用者試玩：不要傷害數字（比照 EA UFC）；一直按刺拳對手無法還手，真實比賽可同時出手。
- 改了：拿掉畫面數字與文字；招式加輕重 `weight`，輕的打不斷重的（互換），同重以上打前搖才算反擊；射程最遠端擦到打折；刺拳僵直 220→140ms；AI 在刺拳收招時也能回應，讀到連按就更常用重拳換。
- 驗證：`node --test prototype/web/v3/test.js` 9 項過；連按刺拳對 AI 30 秒 × 20 場：你 735、AI 2385。
- 要使用者確認：互換手感；AI 是否變太兇（數值在 `rules/v3/config.json` 的 `ai.spam`、`ai.respond`）。

## 2026-11-15 · Claude Opus 5.5（V3 灰盒戰鬥）
- 做了可玩的 V3 灰盒 `prototype/web/v3.html`：three.js 八角籠、膠囊選手、側面轉播鏡頭（你永遠在左）、4 招＋防禦＋閃躲，鍵盤與觸控都能玩；數值在 `rules/v3/config.json`，引擎 `v3/engine.js`、AI `v3/ai.js`（三種打法）。
- 驗證：`node --test prototype/web/v3/test.js` 6 項過；AI 對 AI 20 場全 KO、平均 46 秒；瀏覽器 844×390 看過，無錯誤。
- 要使用者確認：好不好玩；亂按是否太強（我測亂按 20 秒打出 103 比 66）；AI 強弱。
- 下一步：照使用者試玩感受調數值；好玩再接商店。
