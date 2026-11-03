# 🔁 交接紀錄 (HANDOFF)

> 每次收工在**最上方**新增一筆。下一棒開工先讀最上面 2–3 筆。

## 待規劃確認
- （目前無）

---

## 2026-11-03 · [實作] Gemini 4 Argon
- 完成 **P2-2 機率優勢表**
- 修改 `Packages/OctagonCore/Sources/FightEngine/Probability.swift`：
  - 新增 `FighterPlay`（封裝選手、出牌與角落 `Side`）
  - 新增純資料表 `Odds.baseTable: [CardType: [CardType: Double]]`（完整對應 `STRIKING_AND_DECK.md` §2.1 的 6×6 矩陣，非 if/else 寫死）
  - 實作 `attributeModifier`、`distanceModifier`（適用距離內 `0`、差 1 格 `-0.20`、差 2 格 `-0.35`）、`conditionModifier`（低體力與腿傷懲罰）、`momentumModifier`、`traitModifier`
  - 實作 `resolveOdds(my:opp:state:readModifier:)`（同時提供 `FighterPlay` 版與直接傳 `Card` 的便利多載），最終必經過 `Odds.clamp` 限制在 `5%–95%`
- 修改 `Packages/OctagonCore/Tests/FightEngineTests/ProbabilityTests.swift`：
  - 新增 6×6 基準表完整性測試、極端屬性與狀態下所有卡牌組合皆在 `5%–95%` 測試、距離不符時機率下降（差 1 格 `-20%`、差 2 格 `-35%`）測試、屬性/特性/體力腿傷修正測試
- 測試結果：已推送至 GitHub Actions CI 驗證中
- 下一棒：P2-3 可重現的亂數

---

## 2026-11-03 · [規劃] Gemini 4 Argon
- 審查 **P2-1 資料模型** 實作並回覆 3 項待確認設計：
  1. **10 項核心屬性定案**：正式採納 `FighterAttributes` 的 10 個欄位（`power`, `speed`, `accuracy`, `strikingDefense`, `chin`, `cardio`, `takedown`, `takedownDefense`, `submission`, `clinch`，皆 `0...100`），已補入 `docs/POWER_SYSTEM.md` §1.1。
  2. **Card 數值與欄位定案**：確認 `speed`/`power`/`accuracy` 為 `0...100` `Int`，體力/血量/氣勢為 `0...100` `Double`。P2（站立 v0）維持目前精簡欄位，暫不加 `Risk` 與特殊效果閉包/枚舉，等 P2-4 若需要簡單枚舉再擴充。
  3. **FightState 籠邊與角度定案**：確認 `cage` 由兩位選手各自持有（`FighterCondition.cage`），因為真實對局中常有一方背靠籠、另一方在中央壓迫；站姿角度 `Angle` 在 v0 改由雙方 `Fighter.stance`（正架 vs 反架）在公式中直接判定，不在 `FightState` 另存動態軸。
- 補齊 **P2-2 機率優勢表** 的具體數值公式（寫入 `docs/STRIKING_AND_DECK.md` §2.1.1）：
  - 定義 6×6 基準表中 `—` 格子的預設基準值為 `0.50`
  - 明確定義屬性差、距離不符（差 1 格 `-0.20`、差 2 格 `-0.35`）、低體力/腿傷、氣勢差與特性修正的計算方式
- 下一步：`[實作]` 執行 **P2-2 機率優勢表**

---

## 2026-11-03 · [實作] Claude Sonnet
- 完成 **P2-1 資料模型**
- 新增（`Packages/OctagonCore/Sources/FightEngine/`）：`Fighter.swift`（`FighterAttributes`、`Trait`、`Stance`、`Fighter`）、`Card.swift`（`CardType`、`Distance`、`HitTarget`、`CardTag`、`Card`）、`FightState.swift`（`Side`、`CagePosition`、`BodyHealth`、`FighterCondition`、`FightState`）、`SampleData.swift`（2 位範例選手、10 張範例卡，涵蓋 6 種類型）
- 測試：`Tests/FightEngineTests/ModelTests.swift`（Sendable、Codable 往返、屬性夾限、10 張卡覆蓋全類型、狀態預設值）
- 全部型別 `Sendable` + `Codable`；數值在 init 內夾限，Distance 可比較（遠 < 中 < 近）
- 測試結果：CI `swift test` **通過**（run `41619680491`，42s）
- 下一棒：P2-2 機率優勢表

---

## 2026-11-03 · [規劃] Claude Opus
- 建立協作機制：`AGENTS.md`（角色與交接規則）、`docs/TASKS.md`（任務看板）、本檔
- P0 完成：CI 與未簽名 IPA 打包成功（run 41615338078），使用者已在 iPhone 安裝成功
- 下一步：`[實作]` 從 `docs/TASKS.md` 的 P2-1 開始
