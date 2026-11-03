# 🔁 交接紀錄 (HANDOFF)

> 每次收工在**最上方**新增一筆。下一棒開工先讀最上面 2–3 筆。

## 待規劃確認
- （目前無）

---

## 2026-11-03 · [規劃] Gemini 4 Argon (補齊 P3 地面戰引擎與 P4 完整 56 張卡牌庫任務看板)
- 原本 `docs/TASKS.md` 僅先拆了第一階段「P2 站立引擎 v0」，而地面戰的完整企劃放在 `docs/GROUND_GAME_DESIGN.md` 尚未拆成任務卡。
- 現已將 **P3 抱摔、纏抱與地面戰引擎（P3-1 ～ P3-4）** 與 **P4 完整 56 張卡牌庫與手牌抽牌系統（P4-1 ～ P4-3）** 完整拆解寫入 `docs/TASKS.md`。
- 下一步：可由使用者選擇先做 **P3-1（地面位置階層與抱摔橋樑）** 或 **P4-1（擴充站立卡牌庫）**。

---

## 2026-11-03 · [實作] Gemini 4 Argon (P2-7 iPhone 站立實機沙盒與 Debug 抽屜)
- 完成 **P2-7 iPhone 站立實機沙盒與 Debug 戰報抽屜（含打包 IPA）**
- 修改 `Packages/OctagonCore/Sources/FightEngine/FightMatch.swift`：新增 `FightReplayExchange` 與 `FightReplayBundle`（供手機端一鍵複製 JSON 重現碼）
- 修改 `App/Sources/LungeDemoScene.swift`：依 `Distance`（遠/中/近）動態調整雙方站位間距、Rocked 狀態變色警示、KO 擊倒旋轉動畫，並移除閉包確保 Swift 6 嚴格並行相容
- 修改 `App/Sources/ContentView.swift`：
  - 完整 3 回合 × 8 次交手站立對戰沙盒（玩家 `Sample Striker` vs `StyleAI` `Sample Wrestler`）
  - 雙人三部位血量（頭/身/腿）、體力、氣勢即時進度條與各回合 `10-9` / `10-8` 計分板
  - 10 張卡牌選牌面板（標示適用距離、消耗體力，並在 `isRocked` 時自動鎖定進攻卡）
  - 內建 `🔍 即時算式戰報` 抽屜（顯示先手、雙方 `OddsBreakdown` 完整加減成算式、RNG 擲骰值、傷害與 `validateInvariants()` 自檢結果）與 `📋 重現碼` 一鍵複製按鈕
- 提升 `project.yml` 版本號至 `0.2.0 (2)`，觸發 `build-unsigned-ipa.yml` 雲端打包成功（run `41627668313`，1m28s），已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`
- **P2 戰鬥引擎 v0（P2-1 ～ P2-7）全數完成！** 下一步可進入 **P1 資料管線（ufcstats 爬蟲＋真實賽事動態升降系統＋本機像素化）** 或 **地面戰引擎 / 美術素材**。

---

## 2026-11-03 · [實作] Gemini 4 Argon (擬真參數校準 — 經 20,000 場模擬器 A/B 驗證)
- 在不改變任何核心規則與單元測試的前提下，透過 `Simulate --games 10000` 進行兩輪參數校準（CI run `41626624573`，438,356 次交手 `Invariant Violations: 0`）：
  - **基礎傷害係數**：`0.28 -> 0.265`
  - **抗打檢定（Chin Check）基準值**：`0.35 -> 0.22`（中度打擊門檻 `head < 55`），場均 `Rocked` 從 `2.47` 降至更擬真的 `1.56–1.83` 次/場
  - **新增身體肝擊痙攣（Liver Shot Fold）與支撐腿踢垮（Leg Kick Buckle）檢定**：讓身體/腿部 TKO 提升至合計 `1.7%–3.0%`，同時總終結率維持在擬真的 `36.2%–40.7%`（頭部 KO `34.6%–37.7%`、判定 `59.3%–63.8%`）
  - **收緊 10-8 壓倒性回合門檻**：需單回合 `分差 >= 68` 或 `>= 2 次 Rocked 且分差 >= 46`

---

## 2026-11-03 · [規劃] Gemini 4 Argon (真實賽事對手強度動態升降系統)
- 依使用者構想，設計並寫入 **「真實賽事動態升降系統（Opponent-Quality Elo & Live Buff/Nerf）」**（`docs/POWER_SYSTEM.md` §1.2，並更新 `docs/TASKS.md` P1-1 / P1-2）：
  1. **對手強度加權（MMA Elo）**：打贏高積分強敵大幅加強，虐菜只微幅加分；輸給強敵微扣，被弱敵爆冷大幅砍弱。
  2. **依勝負方式精準加砍對應屬性（Targeted Attribute Delta，近 3 場權重最高）**：
     - 現實 KO 強敵 → 贏家 `power`/`accuracy` ↑↑，被 KO 方 `chin`/`strikingDefense` 直接砍弱（甚至拔除 `.ironChin` 或貼上 `.glassChin`）
     - 現實降伏獲勝 → 贏家 `submission` ↑↑，被鎖方 `submission` 砍弱
     - 現實抱摔壓制 → 贏家 `takedown`/`clinch` ↑，被摔方 `takedownDefense` 砍弱
  3. **每週日自動同步產出 Live Patch Notes**：每週六真實 UFC 打完，週日爬蟲自動更新角色強弱。
- 檢視 P2-6 模擬數據並與真實 UFC 數據比對：終結/判定比（44%/56%）與打擊命中率（44%–48%）已高度吻合真實 UFC；後續可在進入 P2-7 前或同時微調 3 項擬真參數（收緊 `10-8` 將平手率從 ~5% 壓至 <1%、加入低體力肝擊 TKO、將 Chin Check 基準從 `0.35` 微調至 `0.24` 讓場均 Rocked 落在 1.2–1.5 次）。

---

## 2026-11-03 · [實作] Gemini 4 Argon (P2-6)
- 完成 **P2-6 平衡模擬器（命令列）＋ 40 萬次交手不變量壓力測試**
- 修改 `Packages/OctagonCore/Package.swift` 與 `.github/workflows/ci.yml`：新增 `Simulate` 可執行目標，並在 CI 自動執行 `swift run Simulate --games 10000`
- 新增 `Packages/OctagonCore/Sources/FightEngine/Simulation.swift`、`Sources/Simulate/main.swift`、`Tests/FightEngineTests/SimulationTests.swift`
- **CI 實測輸出（run `41624691714`，共 20,000 場、432,401 次交手，`Invariant Violations: 0`）**：

```text
=== OctagonCore Balance Simulator — RandomAI vs RandomAI (10000 games) ===
Games: 10000 | Total Exchanges: 217192 (avg 21.7/game) | Invariant Violations: 0
Fighter Win Rate: Side A (Sample Striker)  69.1% (6912) | Side B (Sample Wrestler)  25.4% (2540) | Draw   5.5% (548)
Outcomes: Total Finish  40.1% [Head KO  39.8% (3984), Body TKO   0.2% (20), Legs TKO   0.0% (3)] | Decision  59.9% (5993)
Drama: Total Rocked 22270 (avg 2.23/game)

| CardType | Played | Usage % | Effect Success % | Match Win % (when played) | Avg Dmg/Play |
|---|---:|---:|---:|---:|---:|
| strike  | 211283 |  48.6% |  44.1% |  48.9% |   7.24 |
| block   |  47172 |  10.9% |  41.9% |  42.7% |   0.00 |
| evade   |  49002 |  11.3% |  51.9% |  45.1% |   0.00 |
| counter |  39112 |   9.0% |  26.5% |  51.1% |   7.50 |
| feint   |  41204 |   9.5% |  39.2% |  46.2% |   0.00 |
| move    |  46611 |  10.7% |  48.2% |  41.7% |   0.00 |

=== OctagonCore Balance Simulator — StyleAI vs StyleAI (10000 games) ===
Games: 10000 | Total Exchanges: 215209 (avg 21.5/game) | Invariant Violations: 0
Fighter Win Rate: Side A (Sample Striker)  69.5% (6955) | Side B (Sample Wrestler)  25.8% (2578) | Draw   4.7% (467)
Outcomes: Total Finish  44.0% [Head KO  43.5% (4355), Body TKO   0.0% (0), Legs TKO   0.4% (45)] | Decision  56.0% (5600)
Drama: Total Rocked 24731 (avg 2.47/game)

| CardType | Played | Usage % | Effect Success % | Match Win % (when played) | Avg Dmg/Play |
|---|---:|---:|---:|---:|---:|
| strike  | 203078 |  47.2% |  48.4% |  49.5% |   7.81 |
| block   |  22094 |   5.1% |  47.2% |  43.2% |   0.00 |
| evade   |  62008 |  14.4% |  48.8% |  43.7% |   0.00 |
| counter |  27561 |   6.4% |  34.5% |  58.4% |   9.83 |
| feint   |  51666 |  12.0% |  37.4% |  45.9% |   0.00 |
| move    |  64011 |  14.9% |  49.3% |  42.3% |   0.00 |
```
- 下一棒：P2-7 iPhone 站立實機沙盒與 Debug 戰報抽屜（含打包 IPA）

---

## 2026-11-03 · [實作] Gemini 4 Argon (P2-5)
- 完成 **P2-5 一回合 & 一場比賽**
- 新增 `Packages/OctagonCore/Sources/FightEngine/FightMatch.swift`：
  - 定義 `RoundScore`、`RoundLog`、`MatchOutcome`（`.finish` / `.decision` / `.draw`）、`FightMatchConfig` 與 `MatchResult`（全結構 `Sendable` + `Codable`，整場對戰可直接序列化為 JSON 重播包）
  - 實作 `FighterAI` 協定與兩種內建 AI：`RandomAI`（均勻隨機）與 `StyleAI`（依距離適性、體力狀況、選手特性加權），皆遵守 `isRocked` 狀態下僅能選防守/閃避/移動卡的限制
  - 實作 `FightMatchEngine`：單回合 8 次交手迴圈（`runRound`）、3 回合完整比賽迴圈（`runMatch`）、回合間角落體力恢復（受 `cardio`、`.gasTank` 與身體血量 `health.body` 影響）、讀心加成累計（`computeReadModifier`）與簡化版 10-Point Must 裁判計分（`scoreRound`，支援 10-9、10-8、10-10）
- 新增 `Packages/OctagonCore/Tests/FightEngineTests/FightMatchTests.swift`：
  - 測試同 `seed` 跑兩場 `MatchResult` 100% 一致與 JSON `Codable` 往返
  - 測試單回合 8 次交手與角落恢復
  - 測試 150 場隨機/風格 AI 對戰同時涵蓋 KO/TKO 終結與三回合判定，且每手 `stateAfter.isValid` 不變量全過
  - 測試 `isRocked` 選牌限制與 `computeReadModifier` 連續重複出牌加成
- 測試結果：CI `swift test` **通過**（run `41623897541`，48s）
- 下一棒：P2-6 平衡模擬器（命令列）＋ 20 萬次不變量壓力測試

---

## 2026-11-03 · [實作] Gemini 4 Argon (P2-4)
- 完成 **P2-4 單次交手結算**
- 修改 `Packages/OctagonCore/Sources/FightEngine/FightState.swift`：
  - 新增 `validateInvariants() -> [String]` 與 `isValid: Bool`，強制檢查雙方三部位血量、體力、氣勢皆在 `0...100` 且無 `NaN`/`Infinite`
- 修改 `Packages/OctagonCore/Sources/FightEngine/Probability.swift`：
  - 新增 `OddsBreakdown` 與 `Odds.breakdown(my:opp:state:readModifier:)`，保留基準機率與 6 項修正明細
- 新增 `Packages/OctagonCore/Sources/FightEngine/Exchange.swift`：
  - 實作 `FinishReason`（`.ko`, `.tkoBody`, `.tkoLegs`）、`ExchangeFinish`、`ExchangeSideLog`、`ExchangeLog`、`ExchangeResult`
  - 實作 `ExchangeEngine.resolve` 與頂層 `resolveExchange`：包含先後手有效速度判定、基礎傷害公式、6 大卡牌類型完整互動、先手 KO/Rocked 中斷後手機制、抗打檢定（Chin Check）觸發 `isRocked` 與下一手存活恢復機制
- 新增 `Packages/OctagonCore/Tests/FightEngineTests/ExchangeTests.swift`：
  - 涵蓋全部 6 種卡牌類型結算測試、Rocked 觸發與恢復測試、頭/身/腿三部位 KO/TKO 與中斷測試、連續 500 次隨機交手不變量自檢測試
- 測試結果：CI `swift test` **通過**（run `41622958026`，32 tests in 4 suites 全過）
- 下一棒：P2-5 一回合 & 一場比賽

---

## 2026-11-03 · [規劃] Gemini 4 Argon (P2-4 規格與四道防錯驗收機制)
- 針對「如何確保實際遊戲沒出錯、無隱藏 Bug」制定 **4 道防線**，並寫入 `docs/STRIKING_AND_DECK.md` §12 與 `docs/TASKS.md`：
  1. **透明算式戰報 `ExchangeLog`（P2-4）**：每次交手回傳完整的 `OddsBreakdown`（基準與各項加減成拆解）、RNG 原始骰值、傷害與狀態變化。
  2. **不變量自檢 `FightState.validateInvariants()`（P2-4 / P2-6）**：強制驗證血量/體力/氣勢在 `0...100` 且無 `NaN`，在 P2-6 跑 10,000 場（約 20 萬次交手）時全程檢查。
  3. **可重現重播包（P2-5 / P2-7）**：保存 `seed` 與出牌序列，遇到問題可一鍵複製 JSON 100% 還原現場。
  4. **新增任務 P2-7 iPhone 站立實機沙盒與 Debug 抽屜**：P2 邏輯完成後立即接上 iOS 畫面並打包未簽名 IPA，內建 `[Debug]` 算式抽屜與一鍵複製重現碼。
- 完成 **P2-4 單次交手結算** 詳細數值規格（`docs/STRIKING_AND_DECK.md` §12.1–12.3）：定義先後手順序、基礎傷害公式、6 大卡牌類型互動效果、Rocked 抗打檢定公式與 KO/TKO 終結條件。
- 下一步：`[實作]` 執行 **P2-4 單次交手結算**

---

## 2026-11-03 · [實作] Gemini 4 Argon (P2-3)
- 完成 **P2-3 可重現的亂數**
- 新增 `Packages/OctagonCore/Sources/FightEngine/SeededRNG.swift`：
  - 實作 `SeededRNG`（採用 SplitMix64 演算法，符合 `RandomNumberGenerator`、`Sendable`、`Codable`、`Hashable`）
  - 提供 `nextUnit() -> Double`（`0.0 ..< 1.0`）與 `roll(probability: Double) -> Bool`（自動經 `Odds.clamp` 夾限至 `5%...95%`）
- 新增 `Packages/OctagonCore/Tests/FightEngineTests/RandomTests.swift`：
  - 驗證同 seed 連續 1,000 次 `next()` / `nextUnit()` 與 500 次 `roll(probability:)` 完全一致
  - 驗證不同 seed 序列不同、`0.0..<1.0` 範圍、`0%`/`100%` 輸入受 `Odds.clamp` 保護不會必中或必敗、中途 `Codable` 序列化後還原狀態一致
- 測試結果：CI `swift test` **通過**（run `41621269686`，49s）
- 下一棒：P2-4 單次交手結算

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
- 測試結果：CI `swift test` **通過**（run `41620796923`，22s）
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
