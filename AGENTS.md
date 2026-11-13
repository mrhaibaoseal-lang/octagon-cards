# AGENTS.md — Octagon Cards 協作守則（所有模型每次都會讀到）

> 完整鐵則與原因見 [RULES.md](RULES.md)，遊戲規格見 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)。下面的重點已足夠開工，不必每次讀全文。

## 0. 鐵則重點
- 個人自用的 UFC 卡牌格鬥遊戲，最終是 iPhone 橫向。四層模式（對戰 → 衝冠短跑 → 生涯 → 真實 UFC 同步）共用一個戰鬥核心，依序做，不同時開工。
- **先好玩，再加東西。** 每階段使用者親自玩過、同意才往下。測試和模擬只是輔助。
- 戰鬥先在 `prototype/web/` 驗證，通過後移植成完全原生的 Swift，不用網頁殼。
- 規則與數值放 `prototype/web/rules/*.json`；引擎不比對牌名、不寫死數值。模擬必須跑和遊戲相同的引擎、手牌與 AI。
- 新系統要答得出「讓玩家多了什麼決定」，答不出就不加。對手傾向顯示的是真實數字。
- 美術：1.0 先做 40～50 人，之後逐步增加（2026-11-13 使用者決定，原定約 300 人）；2026-11-08 起改為「共用 3D 骨架＋Gemini 畫的皮膚與 2D 頭 → 渲染成像素精靈圖（A＋卡通光影，量級白模）」，見 `pipeline/model3d/README.md`。不再嘗試：程式畫身體、手寫像素、Q 版、照片切割綁骨架、照片投影到 3D、臉畫在 3D 頭上。提示詞不放 UFC 商標。
- repo 是公開的：選手圖、官方照及衍生圖只放 gitignore 的 `prototype/web/assets/private/`；沒有私人素材時要能用占位圖運作。
- 只用免費服務；未經同意不觸發可能計費的流程。`.p12`、`.mobileprovision` 永不上傳。

## 1. 開工與收工
- **開工**：只跑 `node docs/brief.js`（印出 `docs/TASKS.md` 的「目前」和 `docs/HANDOFF.md` 最新一筆，約 2KB）。若 session 開頭已經自動顯示過開工摘要，就不用再跑。
- **其他文件按需讀**：
  - `docs/GAME_DESIGN.md` 很長，只讀相關章節：先 `grep -n "^##" docs/GAME_DESIGN.md` 看目錄，再讀那一段。
  - `docs/TASKS.md` 的其他節（進度、美術待辦、接下來、之後再說）做到相關工作才讀。
  - `RULES.md` 只有在重點不夠判斷時才讀。`docs/archive/` 是舊紀錄，需要查才讀，內容不再有效。
- **收工**：
  - 更新 `docs/TASKS.md`：「目前」一節保持 3～5 行，寫現況和等使用者什麼；勾選「進度」；做完的細項移到 `docs/archive/TASKS_ARCHIVE.md`。
  - 在 `docs/HANDOFF.md` 最上方加一筆，**約 5 行、每行一句**：日期與模型、做了什麼、驗證結果、要使用者確認的事、下一步。實作細節留給程式碼和 commit 訊息。只保留最新 3 筆，舊的直接刪（git 有紀錄）。
  - 規則改了就同步改 `docs/GAME_DESIGN.md`。
  - commit 並 push，訊息開頭用 `plan:` / `feat:` / `fix:` / `art:`。

## 2. 目前的工作方式
- 現階段在 `prototype/web/` 驗證玩法（見 `prototype/web/README.md`）。除非 `docs/TASKS.md` 排到移植，否則**不要改 `App/` 和 `Packages/`**。
- 改規則或數值：改 `prototype/web/rules/*.json`，然後跑：
  - 目前在驗證的是戰場式玩法（`prototype/web/bg/`，數值在 `rules/bg/*.json`）：`node --test prototype/web/bg/test.js`（引擎不變量）、`node prototype/web/bg/sim.js`（各種打法的勝率，約 4 分鐘）。
  - 其他原型已停止更新：`deck`／`bout`／`rt`／`v2` 與舊草圖在 `prototype/web/_old/`（2026-11-13 搬過去，測試照過）；`index`（`engine.js`、`game.js`）留在原地，因為 `stage.js` 掛在它上面。它們和 `App/`、`Packages/`、`docs/archive/`（`TASKS_ARCHIVE.md` 除外）在 `.claude/settings.json` 設了禁讀（2026-11-13 使用者同意，為了省用量）；真的要回頭看或改，先問使用者、把那條規則拿掉。
- 大檔（`bg/engine.js`、`bg/ui.js`、`bg/test.js`）先搜尋再讀指定行數，不整份讀；驗畫面先讀頁面文字與主控台，最後只截一張圖。
- 改畫面：用 `.claude/launch.json` 的 `prototype` 開起來，在瀏覽器看過 844×390 橫向才算完成。
- 不要加沒有被要求的系統。新想法寫進 `docs/TASKS.md` 的「之後再說」。

## 3. 打包與 CI（已授權，免費）
- 只有移植階段才需要。`gh workflow run build-unsigned-ipa.yml --repo mrhaibaoseal-lang/octagon-cards`，或推 `v*` tag；完成後 `gh run download <id> --repo mrhaibaoseal-lang/octagon-cards --dir dist`。
- 此環境的 `gh` 找不到 git，**所有 gh 指令都要加 `--repo mrhaibaoseal-lang/octagon-cards`**。
- 失敗時只抓最後約 40 行 log。不使用付費 runner。

## 4. 資料
- `data/*.json` 很大，不要整份讀，用小腳本取需要的欄位（`.claude/settings.json` 已禁止直接 Read）。
- 舊 Swift 引擎的數值與規則已不是規格，不要當成參考依據。

## 5. 分工（2026-11-08 使用者決定）
- **Gemini 3.8 Flash 負責所有 3D／像素角色美術**：`pipeline/model3d/` 的流程、Gemini 生圖、白模與頭身比、精靈圖渲染、特效與地面雙人姿勢。待辦在 `docs/TASKS.md`「美術待辦」，做法與踩過的坑在 `pipeline/model3d/README.md`。
- **Claude 只做遊戲面的策劃與實作**：戰鬥規則、數值、AI、模擬、`prototype/web/` 的玩法與介面、`docs/GAME_DESIGN.md`。不改 `pipeline/model3d/`，也不替美術重畫或調白模。
- **兩邊交界**：精靈圖接進 `stage.js` 由 Gemini 做（使用者 2026-11-08 指定）；Claude 不改 `stage.js`，遊戲面需要畫面配合時寫進「美術待辦」。`game.js`、`stage.js` 若有別人未 commit 的修改，不要動、不要提交。
- 美術要改規格（`docs/ART_SPEC.md`、RULES 的美術段）先讓使用者確認；遊戲規則要改美術需求（例如新增招式需要新姿勢）寫進「美術待辦」，不要直接動手。

## 6. 模型分工（只適用 Claude；Gemini 略過）
- **主對話留給要判斷的事**：規則與數值設計、讀 sim 結果下結論、畫草圖、和使用者討論。這些不外派。
- **Haiku 子代理**：跨很多檔的搜尋、從 `data/*.json` 取欄位、把很長的 sim 或測試輸出整理成幾行數字、查 CI log。
- **Sonnet 子代理**：規格已經定案的實作（照 `docs/GAME_DESIGN.md` 某一節寫）、補測試、改完 `rules/*.json` 後跑測試與 sim 並回報。
- **不外派**：幾個工具呼叫就能做完的事、需要這次對話前文才做得對的事、`stage.js` 與 `pipeline/model3d/`。
- **交代要完整**：子代理和新 session 看不到對話，要寫明檔案、做完的樣子、不能碰什麼；子代理不 commit、不 push。
- **回來要驗**：子代理或其他 session 的回報不算證據，數字和改動由主對話看過 diff 或重跑一次才告訴使用者。
- **整件工作適合別的模型時開新 session**（使用者 2026-11-13 同意）：能獨立完成、不需要一路討論的整件工作，放一張新 session 的卡片（使用者點了才開始；他在訊息裡明說要開就直接開）。
- **模型和強度是兩個設定，都要設**：新 session 開的時候只能和主對話同級或更低。使用者要更高的強度（例如「Sonnet 5.5 高」）時，先用一句「等指示、先不要動」開起來，再用 `set_session_effort` 調高，**調完才把真正的工作交代送過去**——調高只從下一輪生效，第一輪還是原本的強度（2026-11-13 實測）。調不上去就照實說，請使用者自己在選單選。
- **一定回報實際生效的值**：開完或調完用 `get_session` 查，在回覆裡寫出模型與強度；和使用者要的不一樣就當場說，不要假設成功。
- **主對話自己不能換**：Claude 改不了目前這個 session 的模型或強度。要換只能請使用者在選單換（模型和強度兩個都選）。
- **實作預設走 Sonnet 5.5 高**（使用者 2026-11-13：主要是想省用量；真的需要強模型他沒意見）。主對話不是 Sonnet 時，每次收到實作要求，**第一句固定表態一行**，二選一：「這件事交給 Sonnet 5.5 高，要開新 session 嗎？」或「這件事留在這裡做，因為＿＿」。不可以什麼都不說就直接做。主對話已經是 Sonnet 就直接做。
- **留在強模型的理由只有這幾種**：要設計或改規則與數值、要判讀 sim 結果下結論、一次改動牽涉引擎多個系統、Sonnet 已經試過沒修好。規格已定、照著寫的工作一律算 Sonnet 的。
