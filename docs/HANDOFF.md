# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Sonnet 5.5（V3 體力與隱藏傷害）
- 做了：拿掉血量，改頭／身體／腳隱藏傷害與兩層體力；AI 第 1 回合前 25 秒試探、打 2～3 招就退回氣區；休息畫面加「你的傷」「他的傷」。數值全在 `rules/v3/config.json`。
- 驗證：`node --test prototype/web/v3/test.js` 16 項全過（新增 6 項）；844×390 開過 `v3.html`，主控台無錯，體力條與休息畫面截圖正常。
- 要使用者確認：AI 對 AI 20 場 17 場 KO（平均 125 秒）可能偏多；試探與打一波就退的節奏；沒有打身體的招。
- 下一步：使用者玩過再調數值；要不要加身體招寫在「之後再說」。

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
