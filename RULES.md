# Octagon Cards — 專案規則與重要事項 (Project Rules & Guardrails)

> 本文件定義 **Octagon Cards** 的核心約束、開發規範、自動化邊界與美術/技術原則。所有後續開發階段皆須嚴格遵守。

---

## 1. 專案定位與核心原則
- **性質**：個人自用（Self-use only）的 iOS 原生 UFC 回合制卡牌格鬥 ＋ 經紀養成遊戲。
- **平台**：iOS 原生（`SwiftUI` + `SpriteKit` + `SwiftData`），在 Windows 開發、透過 GitHub Actions（公開 Repo，`macos-latest`）雲端編譯未簽名 `.ipa`，下載後使用 **FlareStore 付費憑證**簽名安裝至 iPhone。
- **對局時長**：標準 3 回合對戰約 **10 分鐘**（每回合 8 次交手 Exchange），5 回合冠軍戰約 15–16 分鐘；另設快速模式（每回合 5 次交手）。

---

## 2. 美術與 AI 額度保護規則（Zero-Quota-Waste）
1. **選手美術全面採用「零 AI 官方去背照自動像素化」**：
   - 來源：UFC.com 選手頁面之官方透明 PNG（`athlete_bio_full_body` 半身照 + `event_results_athlete_headshot` 大頭照）。
   - 處理：Python (`uv` + `Pillow`) 自動裁切透明邊 → 銳化與對比強化（保留刺青細節）→ BOX 縮圖（小人高 `112px–128px`、頭像 `64px`）→ 32 色量化（無抖色）→ `1px` 深色描邊。
   - **禁止對一般選手逐一呼叫 AI 生圖**，確保 700+ 名現役選手與每週新秀更新為 **0 AI 成本、100% 真實長相與真實刺青**。
   - **官方照不進 repo（公開 repo 的處理方式）**：repo 只放程式、規則文件與**不含照片的 JSON 資料**（選手數據、圖片網址）。App 首次需要某位選手時，**在手機上下載官方去背照 → 本機像素化 → 快取**。好處：repo 與 IPA 內沒有任何照片、每週新人不需要重新打包、不佔用雲端建置時間。`pipeline/pixelate_sprites.py` 保留為「效果原型與參數校準工具」，Swift 端實作同一套流程（裁邊 → 銳化 → 縮圖 → 32 色量化 → 描邊）。
   - **用途（2026-11-06 更新，見 `docs/VISUAL_DIRECTION.md`）**：選角頁使用上述像素圖；戰鬥人物改用「小型 Q 版：共用身體模板＋官方照的頭」，同樣在手機上自動產生，一般選手仍是 0 次 AI 生圖。
2. **AI 生圖僅限「一次性共用素材」**：
   - 八角籠背景、觀眾席、打擊特效（拳風、火花、血滴）、40 張通用卡牌插圖、戰鬥骨架的共用四肢與手套，以及**地面戰專用雙人姿勢模板（見 `docs/GROUND_GAME_DESIGN.md`）**。
   - 總 AI 生成張數控制在 100 張以內。

---

## 3. 技術與架構規則（Windows 寫 Swift + 雲端打包）
1. **核心邏輯與 UI 嚴格分離**：
   - `FightEngine`（站立/纏抱/地面戰鬥規則、AI 決策、裁判計分）與 `RatingEngine`（ufcstats 數據轉能力值）必須寫成**純 Swift Package（不 import UIKit / SpriteKit / SwiftUI）**。
   - 這樣可以在 Windows 本機直接執行 `swift test` 驗證所有戰鬥與地面規則，不消耗雲端建置時間。
2. **XcodeGen 管理專案**：
   - 禁止手動編輯 `.xcodeproj`，統一由 `project.yml` 在 GitHub Actions macOS runner 上動態生成 Xcode 專案。
3. **只走免費雲端打包**：
   - repo 維持**公開**，使用 GitHub 標準 `macos` runner（公開 repo 免費）；不使用付費的大型 runner。
   - 平常 push 只在 Linux 跑純 Swift Package 測試；**只在打 tag 時**才建 IPA，避免無謂消耗。
   - 未經你同意，不觸發任何付費或可能計費的雲端流程。
4. **憑證安全**：
   - FlareStore 的 `.p12` 與 `.mobileprovision` **永不上傳 GitHub**。GitHub Actions 只產出 Unsigned IPA，在手機端用 FlareStore 本地簽名。

---

## 4. 自動更新與資料規則
1. **每週日自動同步**：
   - 爬取 `ufcstats.com`（生涯與單場逐回合統計）與 `UFC.com`（排名、賽事卡、去背照）。
2. **新人第一時間上線機制**：
   - 只要進入 UFC 名單或即將出賽（含 Contender Series 新簽約），爬蟲立即建檔並以貝氏收縮（Bayesian Shrinkage）計算初始能力值。
   - 若官方已有去背照 → 立即轉成像素圖；若尚未拍官方照 → 自動套用「量級體型剪影＋國旗＋真實姓名」暫代卡，待官方補照後自動替換。
