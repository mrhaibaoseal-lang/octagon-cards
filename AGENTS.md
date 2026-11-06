# AGENTS.md — Octagon Cards 協作守則（所有模型每次都會讀到）

> 鐵則見 [RULES.md](RULES.md)，遊戲規格見 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)。

## 1. 開工與收工
- **開工**：讀 `docs/TASKS.md` 目前的階段和 `docs/HANDOFF.md` 最新一筆。`docs/archive/` 是舊方向的紀錄，需要查才讀，內容不再有效。
- **收工**：
  - 更新 `docs/TASKS.md` 的狀態。
  - 在 `docs/HANDOFF.md` 最上方加一筆，**約 5 行**：日期與模型、做了什麼、驗證結果、要使用者確認的事、下一步。實作細節留給程式碼和 commit 訊息。只保留最新 3 筆，舊的直接刪（git 有紀錄）。
  - 規則改了就同步改 `docs/GAME_DESIGN.md`。
  - commit 並 push，訊息開頭用 `plan:` / `feat:` / `fix:` / `art:`。

## 2. 目前的工作方式
- 現階段在 `prototype/web/` 驗證玩法（見 `prototype/web/README.md`）。除非 `docs/TASKS.md` 排到移植，否則**不要改 `App/` 和 `Packages/`**。
- 改規則或數值：改 `prototype/web/rules/*.json`，然後跑：
  - `node prototype/web/test/engine.test.js`（引擎不變量）
  - `node prototype/web/sim.js`（各種打法的勝率，對照 `docs/TASKS.md` 的通過條件）
- 改畫面：用 `.claude/launch.json` 的 `prototype` 開起來，在瀏覽器看過 844×390 橫向才算完成。
- 不要加沒有被要求的系統。新想法寫進 `docs/TASKS.md` 的「之後再說」。

## 3. 打包與 CI（已授權，免費）
- 只有移植階段才需要。`gh workflow run build-unsigned-ipa.yml --repo mrhaibaoseal-lang/octagon-cards`，或推 `v*` tag；完成後 `gh run download <id> --repo mrhaibaoseal-lang/octagon-cards --dir dist`。
- 此環境的 `gh` 找不到 git，**所有 gh 指令都要加 `--repo mrhaibaoseal-lang/octagon-cards`**。
- 失敗時只抓最後約 40 行 log。不使用付費 runner。

## 4. 資料
- `data/*.json` 很大，不要整份讀，用小腳本取需要的欄位（`.claude/settings.json` 已禁止直接 Read）。
- 舊 Swift 引擎的數值與規則已不是規格，不要當成參考依據。
