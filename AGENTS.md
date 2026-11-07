# AGENTS.md — Octagon Cards 協作守則（所有模型每次都會讀到）

> 完整鐵則與原因見 [RULES.md](RULES.md)，遊戲規格見 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)。下面的重點已足夠開工，不必每次讀全文。

## 0. 鐵則重點
- 個人自用的 UFC 卡牌格鬥遊戲，最終是 iPhone 橫向。四層模式（對戰 → 衝冠短跑 → 生涯 → 真實 UFC 同步）共用一個戰鬥核心，依序做，不同時開工。
- **先好玩，再加東西。** 每階段使用者親自玩過、同意才往下。測試和模擬只是輔助。
- 戰鬥先在 `prototype/web/` 驗證，通過後移植成完全原生的 Swift，不用網頁殼。
- 規則與數值放 `prototype/web/rules/*.json`；引擎不比對牌名、不寫死數值。模擬必須跑和遊戲相同的引擎、手牌與 AI。
- 新系統要答得出「讓玩家多了什麼決定」，答不出就不加。對手傾向顯示的是真實數字。
- 美術：約 300 人、逐人 AI 精靈圖（Gemini 姿勢表為主）。不再嘗試：程式畫身體、手寫像素、Q 版、照片切割綁骨架、3D 投影貼圖。提示詞不放 UFC 商標。
- repo 是公開的：選手圖、官方照及衍生圖只放 gitignore 的 `prototype/web/assets/private/`；沒有私人素材時要能用占位圖運作。
- 只用免費服務；未經同意不觸發可能計費的流程。`.p12`、`.mobileprovision` 永不上傳。

## 1. 開工與收工
- **開工**：只跑 `node docs/brief.js`（印出 `docs/TASKS.md` 的「目前」和 `docs/HANDOFF.md` 最新一筆，約 2KB）。若 session 開頭已經自動顯示過開工摘要，就不用再跑。
- **其他文件按需讀**：
  - `docs/GAME_DESIGN.md` 很長，只讀相關章節：先 `grep -n "^##" docs/GAME_DESIGN.md` 看目錄，再讀那一段。
  - `docs/TASKS.md` 的其他節（進度、M1.4 規格、之後再說）做到相關工作才讀。
  - `RULES.md` 只有在重點不夠判斷時才讀。`docs/archive/` 是舊紀錄，需要查才讀，內容不再有效。
- **收工**：
  - 更新 `docs/TASKS.md`：「目前」一節保持 3～5 行，寫現況和等使用者什麼；勾選「進度」；做完的細項移到 `docs/archive/TASKS_ARCHIVE.md`。
  - 在 `docs/HANDOFF.md` 最上方加一筆，**約 5 行、每行一句**：日期與模型、做了什麼、驗證結果、要使用者確認的事、下一步。實作細節留給程式碼和 commit 訊息。只保留最新 3 筆，舊的直接刪（git 有紀錄）。
  - 規則改了就同步改 `docs/GAME_DESIGN.md`。
  - commit 並 push，訊息開頭用 `plan:` / `feat:` / `fix:` / `art:`。

## 2. 目前的工作方式
- 現階段在 `prototype/web/` 驗證玩法（見 `prototype/web/README.md`）。除非 `docs/TASKS.md` 排到移植，否則**不要改 `App/` 和 `Packages/`**。
- 改規則或數值：改 `prototype/web/rules/*.json`，然後跑：
  - `node prototype/web/test/engine.test.js`（引擎不變量）
  - `node prototype/web/sim.js`（各種打法的勝率，對照 `docs/GAME_DESIGN.md` 的「模擬的通過條件」）
- 改畫面：用 `.claude/launch.json` 的 `prototype` 開起來，在瀏覽器看過 844×390 橫向才算完成。
- 不要加沒有被要求的系統。新想法寫進 `docs/TASKS.md` 的「之後再說」。

## 3. 打包與 CI（已授權，免費）
- 只有移植階段才需要。`gh workflow run build-unsigned-ipa.yml --repo mrhaibaoseal-lang/octagon-cards`，或推 `v*` tag；完成後 `gh run download <id> --repo mrhaibaoseal-lang/octagon-cards --dir dist`。
- 此環境的 `gh` 找不到 git，**所有 gh 指令都要加 `--repo mrhaibaoseal-lang/octagon-cards`**。
- 失敗時只抓最後約 40 行 log。不使用付費 runner。

## 4. 資料
- `data/*.json` 很大，不要整份讀，用小腳本取需要的欄位（`.claude/settings.json` 已禁止直接 Read）。
- 舊 Swift 引擎的數值與規則已不是規格，不要當成參考依據。
