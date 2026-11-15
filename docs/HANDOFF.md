# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Sonnet 5.5（Volkanovski 頭身比）
- 量測：Volkanovski 的頭頂下 6 cm 寬×前後 19.2×23.7 cm（真人約 15.5×20），整顆頭胖約兩成五，不是縮放或脖子殘塊的問題。
- `attach_head.py` 加 `--fit`／`--max-head`（預設開）壓扁偏胖的頭，並每次接頭印頭身比表、超出 10% 警告；捲髮（O'Malley）判定為頭髮跳過。
- 驗證：Topuria、O'Malley 數字不變；Volkanovski 變 23.6／15.8／20.6／7.0 頭身；三組畫面 `_mockup/m1～m3.png` 重渲染，對照 `volk_before_after.jpg`。
- 要使用者確認：Volkanovski 側面看仍比 Topuria 大一點（肩窄、鬍子帶仍寬），夠不夠？不夠再縮頭或加寬肩。沒呼叫 Gemini。
- 下一步：這張量測表就是每顆新頭的檢查；O'Malley 的警告是頭髮造成的已知情況。

## 2026-11-15 · Claude Opus 5.5（正式版引擎改 Unity）
- 使用者決定：不管卡牌版或 V3，最後都用 Unity（畫面要儘可能精美），取代 SwiftUI＋RealityKit；不用 Unreal 5。
- 使用者沒有 Mac：Windows 上開發，匯出 Xcode 專案由 CI 出 IPA；CI 上的 Unity 授權到移植時再查。
- 現在不換引擎、不開 Unity 專案，玩法照舊在網頁上測。正式版目前仍是卡牌版，V3 是測試；地面用哪版使用者還在想。
- 改了 RULES §2／§3／§6、AGENTS §0、TASKS（目前、美術待辦、M3、M4）。
- 下一步：照舊等使用者玩卡牌版與 V3。

## 2026-11-15 · Claude Opus 5.5（V3 體力與節奏草圖）
- 使用者：血量體力要比照 UFC 6；現在第一回合就互毆，真實比賽會先試探、打一波就退。
- 做了草圖 `prototype/web/sketch-v3-stamina.html`（打鬥畫面／三種打法曲線／回合休息／數值）：無血條、頭身腳隱藏傷害與倒地機率、體力上限會掉、交火區回 4 外面回 18、AI 試探與打一波就退。
- 驗證：844×390 開過、主控台無錯；粗估模型（非引擎）三回合：一直打 傷害 626、上限剩 42；打一波就退 843、75；先試探 680、83。
- 要使用者確認：方向和數值；UFC 6 細節沒查證，依 EA UFC 4／5 的做法。
- 下一步：使用者同意後交 Sonnet 實作進 `v3/engine.js`、`ai.js`、`rules/v3/config.json`。
