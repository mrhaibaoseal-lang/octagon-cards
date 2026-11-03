# AGENTS.md — Octagon Cards 協作守則（所有模型每次都會讀到）

> 這個檔案放在 repo 根目錄，Antigravity 會自動把它當成規則載入。不管目前是哪個模型（Opus / Sonnet / Gemini），都要遵守。
> 專案鐵則見 [RULES.md](RULES.md)，設計文件見 [docs/](docs/)。

## 1. 角色分工

使用者會在訊息開頭標註角色；沒標註時，依請求內容判斷。

| 標籤 | 建議模型 | 負責 | 不做 |
|---|---|---|---|
| `[規劃]` | Claude Opus | 寫/改 `docs/` 設計文件、拆任務寫進 `docs/TASKS.md`、審查實作是否符合設計 | 不寫產品程式碼（小型驗證腳本可以） |
| `[實作]` | Claude Sonnet | 依 `docs/TASKS.md` 的任務寫程式、測試、打包 | 不擅自改設計；發現設計有問題 → 記到 `docs/HANDOFF.md` 的「待規劃確認」 |
| `[美術]` | 任一模型 + 生圖工具 | 依 `docs/ART_BRIEFS.md` 生成共用素材、放到 `art/`、更新清單 | 不為個別選手逐一生圖（見 RULES.md §2） |

## 2. 交接協議（共享記憶 = repo 裡的檔案，不是聊天紀錄）

1. **開工前**：讀 `docs/TASKS.md`（做什麼）、`docs/HANDOFF.md` 最上面幾筆（上一棒做到哪）、相關設計文件。
2. **做事時**：只做被指派的任務；任務卡上的「完成條件」就是驗收標準。
3. **收工時**：
   - 在 `docs/TASKS.md` 更新任務狀態（`[ ]` → `[x]`，或標 `BLOCKED` 並寫原因）
   - 在 `docs/HANDOFF.md` **最上方**新增一筆：日期、角色/模型、做了什麼、改了哪些檔、測試結果、待確認問題
   - commit 並 push（commit 訊息開頭用 `plan:` / `feat:` / `fix:` / `art:`）

## 3. 打包與 CI（已授權，免費）

- repo 為公開、使用標準 `macos-latest` runner → 免費。使用者已授權 agent **自行打包**：
  - `gh workflow run build-unsigned-ipa.yml --repo mrhaibaoseal-lang/octagon-cards`，或推 `v*` tag
  - 完成後 `gh run download <id> --repo mrhaibaoseal-lang/octagon-cards --dir dist`，回報 IPA 路徑
- 此環境的 `gh` 找不到 git，**所有 gh 指令都要加 `--repo mrhaibaoseal-lang/octagon-cards`**
- 失敗時只抓最後約 40 行錯誤 log，不要整份貼出
- 不使用付費 runner、不觸發任何可能計費的服務

## 4. 程式慣例

- 核心邏輯放 `Packages/OctagonCore`（純 Swift，不得 import UIKit / SwiftUI / SpriteKit），一定要有 Swift Testing 測試
- App 層放 `App/Sources`，專案檔由 `project.yml`（XcodeGen）產生，不要提交 `.xcodeproj`
- 所有機率結果必須經過 `Odds.resolve` / `Odds.clamp`（5%–95%，見 docs/STRIKING_AND_DECK.md §2.1）
- 本機（Windows）沒有 Swift 工具鏈：編譯與測試以 CI 結果為準
