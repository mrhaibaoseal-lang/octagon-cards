# AGENTS.md — Octagon Cards 協作守則（所有模型每次都會讀到）

> 這個檔案放在 repo 根目錄，Antigravity 會自動把它當成規則載入。不管目前是哪個模型（Opus / Sonnet / Gemini），都要遵守。
> 專案鐵則見 [RULES.md](RULES.md)，設計文件見 [docs/](docs/)。

## 1. 角色分工

使用者會在訊息開頭標註角色；沒標註時，依請求內容判斷。

| 標籤 | 建議模型 | 負責 | 不做 |
|---|---|---|---|
| `[規劃]` | Claude Opus / Gemini 4 Argon | 寫/改 `docs/` 設計文件、拆任務寫進 `docs/TASKS.md`、審查實作是否符合設計 | 不寫產品程式碼（小型驗證腳本可以） |
| `[實作]` | Claude Sonnet / Gemini 4 Argon | 依 `docs/TASKS.md` 的任務寫程式、測試、打包 | 不擅自改設計；發現設計有問題 → 記到 `docs/HANDOFF.md` 的「待規劃確認」 |
| `[美術]` | 任一模型 + 生圖工具 | 依 `docs/ART_BRIEFS.md` 生成共用素材、放到 `art/`、更新清單 | 不為個別選手逐一生圖（見 RULES.md §2） |

## 2. 交接協議（共享記憶 = repo 裡的檔案，不是聊天紀錄）

1. **開工前**：讀 `docs/TASKS.md`（做什麼）、`docs/HANDOFF.md` 的兩個「待確認」區和最新 1–2 筆（上一棒做到哪）、這張卡相關的設計文件章節。`TASKS_ARCHIVE.md`、`HANDOFF_ARCHIVE.md` 只在需要時查，不要整份讀。
2. **做事時**：只做被指派的任務；任務卡上的「完成條件」就是驗收標準。
3. **收工時**：
   - 在 `docs/TASKS.md` 更新任務狀態（`[ ]` → `[x]`，或標 `BLOCKED` 並寫原因）；完成的卡原文移到 `docs/TASKS_ARCHIVE.md`，並更新看板開頭的「已完成」那行
   - 在 `docs/HANDOFF.md` **最上方**新增一筆：日期、角色/模型、做了什麼、改了哪些檔、測試結果、下一棒。**每筆約 10 行、1,500 字內**，只寫下一棒需要知道的事；實作細節留在程式碼和 commit 訊息
   - 待決定的事寫進「待規劃確認」，要使用者實機檢查的項目寫進「待使用者實機確認」；確認後就刪掉該項
   - `HANDOFF.md` 超過 3 筆時，把最舊的原文移到 `docs/HANDOFF_ARCHIVE.md` 最上方，移動前確認它未解決的項目已列在「待確認」區
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
- `data/*.json` 很大，不要整份讀；要查內容就用小腳本取需要的欄位（Claude Code 已在 `.claude/settings.json` 禁止直接 Read）
