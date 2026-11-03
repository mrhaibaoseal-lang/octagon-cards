# 🔁 交接紀錄 (HANDOFF)

> 每次收工在**最上方**新增一筆。下一棒開工先讀最上面 2–3 筆。

## 待規劃確認
- 「10 項核心屬性」文件未列清單。P2-1 暫定：power、speed、accuracy、strikingDefense、chin、cardio、takedown、takedownDefense、submission、clinch（皆 0–100）。請 `[規劃]` 確認或調整。
- `Card` 的 speed/power/accuracy 暫用 0–100 整數；體力/血量/氣勢用 Double（0–100）。`Card` 尚未含「風險 Risk」「特殊效果」欄位（P2-4 需要時再加）。
- `FightState` 的籠邊位置做成「每位選手各自一個」（`FighterCondition.cage`），而非全場單一值；站姿角度 Angle 暫未納入。

---

## 2026-11-03 · [實作] Claude Sonnet
- 完成 **P2-1 資料模型**
- 新增（`Packages/OctagonCore/Sources/FightEngine/`）：`Fighter.swift`（`FighterAttributes`、`Trait`、`Stance`、`Fighter`）、`Card.swift`（`CardType`、`Distance`、`HitTarget`、`CardTag`、`Card`）、`FightState.swift`（`Side`、`CagePosition`、`BodyHealth`、`FighterCondition`、`FightState`）、`SampleData.swift`（2 位範例選手、10 張範例卡，涵蓋 6 種類型）
- 測試：`Tests/FightEngineTests/ModelTests.swift`（Sendable、Codable 往返、屬性夾限、10 張卡覆蓋全類型、狀態預設值）
- 全部型別 `Sendable` + `Codable`；數值在 init 內夾限，Distance 可比較（遠 < 中 < 近）
- 測試結果：本機無 Swift 工具鏈，**尚未編譯**，以 CI 結果為準（見下方 push 後的狀態）
- 下一棒：P2-2 機率優勢表

---

## 2026-11-03 · [規劃] Claude Opus
- 建立協作機制：`AGENTS.md`（角色與交接規則）、`docs/TASKS.md`（任務看板）、本檔
- P0 完成：CI 與未簽名 IPA 打包成功（run 41615338078），使用者已在 iPhone 安裝成功
- 下一步：`[實作]` 從 `docs/TASKS.md` 的 P2-1 開始
