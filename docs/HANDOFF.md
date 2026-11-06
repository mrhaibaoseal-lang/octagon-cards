# 🔁 交接紀錄 (HANDOFF)

> 每次收工在**最上方**新增一筆。下一棒開工先讀最上面 2–3 筆。

## 待規劃確認
- （目前無）

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-2 交手演出時間軸)
- **新增 `Packages/OctagonCore/Sources/FightEngine/ExchangePresentation.swift`**（純 Swift，無 UI import）：`ExchangePresentation.build(log: ExchangeLog, nameA: String = "A 方", nameB: String = "B 方") -> [ExchangeBeat]`。只讀 log，不碰 `SeededRNG`、不改任何引擎檔。
  - `ExchangeBeat`（`Sendable, Equatable, Hashable`）：`kind`、`actor`、`target`、`cardName`、`amount`（傷害）、`hitTarget`、`isHeavy`（傷害 ≥ 12 或 Rocked，給 P5-3 頓幀／大字用）、`narration`（繁中）、`display`（`ExchangeDisplayState`：雙方三部位血量、`isRocked`、`cutSeverity`）。
  - `ExchangeBeatKind`：`reveal / action / hit / blocked / dodged / missed / feint / move / takedown / positionAdvance / sweep / standUp / submissionStart / submissionLock / submissionEscape / rocked / cut / interrupted / refereeStandUp / clinch / cagePressure / recover / finish`。
  - 順序：`reveal` →（先手：`action`、結果、`rocked`／`cut`、位置變化）→（後手同上，或 `interrupted`）→ 純狀態變化（裁判叫起、Rocked 恢復、進入纏鬥、被逼到鐵網）→ `finish`。有終結時最後一個一定是 `finish`，且不再補狀態變化。
  - 血量快照：從 `stateBefore` 起算，每個 `hit`／`blocked` 扣血；**最後一個 beat 的 `display` 一律直接取自 `stateAfter`**（也修正「軀幹／腿部 TKO 直接歸零」這類引擎不照傷害扣的情況）。
- **設計決定（請規劃確認）**：(1) 被打斷的一方會有一個短的 `interrupted` beat（旁白寫原因），不是完全沒有；若該次交手已終結則不補，避免與 `finish` 重複。(2) 地面掃技時 log 的 `firstSide` 只是速度比較，故被打斷者在前時，時間軸改成「打斷者先講」（先 sweep，再 interrupted）。(3) 抱摔／掃技／推進／起身／移動屬於「該方出牌的結果」，緊跟在該方 `action` 後，不留到最後；最後的狀態變化只放 log 沒有逐項記錄的（裁判、Rocked 恢復、纏鬥、鐵網）。(4) 降伏鏈進行中不插入 `missed`，由 start／lock／escape beat 交代。(5) 新增 `nameA/nameB` 參數（預設「A 方／B 方」），P5-3 可傳選手名；log 本身沒有選手名。(6) 不輸出秒數，時序由 App 決定。
- **測試**：新增 `Tests/FightEngineTests/ExchangePresentationTests.swift`（27 個測試）：手工 log 涵蓋雙方命中、單方命中、反擊、被打斷（Rocked）、割傷、閃避、格擋、假動作＋移動、抱摔、防摔失敗、掃技、位置推進／回復、起身、降伏開始／加深／脫困／撐住／認輸、裁判叫起、Rocked 恢復／纏鬥／鐵網、KO、TKO 歸零校正、後手終結、醫生叫停、選手名、同 log 輸出一致；另用真實引擎跑全部站立牌組合、抱摔牌 × 站立牌、地面 5 位置 × 3 種降伏狀態 × 全部上下位牌，檢查不變量（第一個是 reveal、最後血量 = `stateAfter`、血量不回升、被打斷者無 action、有終結則最後是 finish）；並驗證「建立 beat 前後同 seed 的 log 序列相同」。
- **CI**：run `42206706049` ✅（push `0865363`，91 tests / 12 suites 全過）。沒動 App 層，未打包 IPA。
- 修改檔案：`ExchangePresentation.swift`（新）、`ExchangePresentationTests.swift`（新）、`docs/TASKS.md`、`docs/HANDOFF.md`。
- **下一棒**：`[實作]` 開新 session 做 P5-3（App 播放時間軸；完成後要等使用者實機確認節奏才做 P5-4）。

---
## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-1 拆分 ContentView 並整理版面 v0.5.2)
- **拆分（行為不變，只搬移與版面整理）**：`ContentView.swift` 1040 行 → 約 60 行，只留導覽（賽前頁 ⇄ 對戰頁）與首次下載選手圖的覆蓋層。
  - 新增 `BattleSession.swift`（`@MainActor @Observable`）：選手、引擎狀態、手牌、回合記錄、`SeededRNG`、`LungeDemoScene`；承接 `startNewMatch` / `playTurn` / `refreshPixelSprites` / `copyReplayBundle`，邏輯逐行照搬。
  - 新增 `PreFightView.swift`（選角：5 組熱門對戰＋兩個自選選手選單＋選手預覽卡＋「開始對戰」）、`BattleView.swift`（對戰＋`FighterStatusCard`）、`DebugDrawerView.swift`、`BattleText.swift`（格式化文字）、`SandboxMatchup.swift`、`RosterPrefetchModel.swift`（首次下載進度，仍用同一個 UserDefaults key `rosterPrefetchCompletedOnce`）。
  - `LungeDemoScene.swift`：`didMove(to:)` 加 `isSetUp` 保護——離開再進對戰頁會重新呈現同一個 scene，否則節點會重複 `addChild` 而崩潰。
  - `project.yml`：`sources` 為整個 `App/Sources` 目錄，新檔自動收進；版本 `0.5.2 (7)`。
- **版面**：對戰頁不捲動（直式：頂列→八角籠（吃剩餘高度，最小 150pt）→雙方狀態卡→固定高 96pt 的地面／站立資訊區→固定高 206pt 手牌區）；地面橫幅出現時手牌位置不動；Rocked／流血標籤列保留固定高度；橫式改為左右兩欄。Debug 預設收起，按「🔍 算式」以 sheet 開啟（`.medium` 時背景仍可點牌）；「📋 重現碼」仍在頂列，Debug sheet 內也有一顆。
- **有意的小改動（請確認）**：(1) 對戰 HUD 不再顯示 `lastFightPatchNote`，改放賽前預覽卡；(2) 狀態卡的特質列在沒有 Rocked／流血時才顯示；(3) 點「← 選角」會放棄目前對局並換新 Seed，下次一定從新局開始；(4) 賽前頁換選手仍會即時換新 Seed（同舊行為）。
- **測試結果**：CI run `42204613192` ✅（push `efda3dc`，OctagonCore 未改動）；IPA run `42204614229` ✅，App 層無編譯警告；已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`（v0.5.2）。本機無 Swift 工具鏈，未做畫面實測。
- **待使用者／實機確認**：八角籠實際高度（iPhone 15 直式估計約 200–225pt，小螢幕機型會接近 150pt 下限）、橫式版面是否擠、Debug sheet 與複製重現碼是否正常。
- **下一棒**：`[實作]` 開新 session 做 P5-2（`OctagonCore` 交手演出時間軸）。

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-0 精簡交接文件)
- 把 2026-11-03 及更早的 17 筆紀錄原文搬到新檔 `docs/HANDOFF_ARCHIVE.md`（行 80 起逐字搬移，未改一字）；`HANDOFF.md` 保留「待規劃確認」與 2026-11-04 起的 5 筆，檔尾加封存連結。
- 驗證：搬移前 22 筆 `## 2026…`，搬移後 5 + 17 = 22；用 `diff` 確認封存內容與原檔對應行完全相同、保留部分加封存內容可還原原檔。
- 修改檔案：`docs/HANDOFF.md`、`docs/HANDOFF_ARCHIVE.md`（新）、`docs/TASKS.md`（P5-0 打勾）。只改文件，未動程式與 CI。
- **下一棒**：`[實作]` 開新 session 做 P5-1（拆分 `ContentView.swift`）。

---

## 2026-11-06 · [規劃] Claude Opus 5.5 (拆 P5 對戰體驗任務卡)
- 在 `docs/TASKS.md` 新增 P5-0 ～ P5-6；只改文件，未改產品程式碼。
- **下一棒**：`[實作]` Sonnet 5.5 開新 session，從 P5-0 開始，一次做一張卡。P5-3 完成後要先等使用者實機確認節奏。
- **待使用者確認**：預設值（每次交手 3–4 秒、回合中只顯示局勢條）。P5-6 角落指示的規則待規劃。

---

## 2026-11-06 · [規劃] Claude Opus 5.5 (v0.5.1 實機回報與介面落差診斷)
- **使用者實機結果**：目前測試都正常，沒有 bug。
- **使用者回饋（最高優先）**：介面非常陽春，無法良好判斷比賽局勢，完全感受不到遊戲節奏。
- **讀碼診斷（`ContentView.swift`、`LungeDemoScene.swift`；未改程式）**：
  - 節奏：站立攻擊動畫約 0.44 秒，`ANIMATION_ART.md` §5 的設計是每次交手 2–4 秒；出牌後狀態立即更新，沒有分段揭示。
  - 局勢：回合進行中看不到點數；AI 出牌與命中結果主要只在 Debug 抽屜；傷害沒有飄字，血條變化沒有強調。
  - 演出：雙方都造成傷害時只播一方攻擊；格擋、閃避、佯攻沒有專屬動畫；沒有賽前、回合結算、角落時間、賽後畫面。
  - 版面：對戰畫面只有 165pt 高，選角與 Debug 都放在同一頁（Debug 預設開啟）；進地面時橫幅插入，手牌會被往下推。
  - **疑似問題（僅讀碼，未實機確認）**：回合第 8 次交手後，`playExchange` 緊接著呼叫 `resetPositions`（`removeAllActions`），該次動畫可能被取消。
- **修改檔案**：只有本檔。尚未拆任務卡，等使用者確認介面方向後再寫入 `docs/TASKS.md`。

---

## 2026-11-04 · [實作] Claude Opus 5.5 (首次啟動一次下載全名單像素圖 v0.5.1)
- **需求（使用者）**：第一次進遊戲就把所有選手圖一次抓好，之後每場不用重載。
- **修改 `App/Sources/FighterPixelSpriteService.swift`**：
  - 新增 `prefetchAll(_:maxConcurrent:onProgress:)`：最多同時 4 個下載，已存在的圖直接略過；回傳 `PrefetchProgress`（完成數/總數/失敗數）。
  - 新增 `missingSpriteCount(in:)` / `hasCachedSprite(for:kind:)`；沒有官方照網址的選手不算「缺圖」（避免每次都重試）。
  - 快取改存 `Application Support/PixelSprites_v1/`（原本 `Caches` 會被 iOS 在空間不足時清掉→要重新下載），排除 iCloud 備份；啟動時自動把 v0.5.0 舊的 Caches 資料夾搬過去。
  - 同一張圖同時被要求時共用同一個下載（`inFlight` 去重）；下載＋像素化改在 `Task.detached` 跑，不卡住 actor。
  - 剪影 fallback 改存獨立的 `fallbackCache`，之後連上網仍會換成真圖。
- **修改 `App/Sources/ContentView.swift`**：
  - `.task` 啟動時檢查缺圖 → **只在第一次**跳出全螢幕進度（`@AppStorage("rosterPrefetchCompletedOnce")`），可按「背景下載，先開始玩」；之後若有新選手/先前失敗的圖，只在頂部顯示小膠囊進度。
  - 完成後自動 `refreshPixelSprites()` 把畫面上的剪影換成真圖；有失敗時提供「重試失敗的 N 張」。
- `project.yml` → `0.5.1 (6)`。
- **測試結果**：CI run `41687877472` ✅；IPA run `41687877543` ✅，App 層無編譯警告；已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。
  - （run `41687167297` 顯示 failure：macOS runner 排隊容量不足，job 沒有實際執行；同一修正已包含在 `41687877472` 並通過。）
- **待使用者實測**：首次啟動進度畫面、背景下載膠囊、斷網時的重試按鈕、第二次啟動是否完全不再下載。

---

## 2026-11-04 · [實作] Claude Sonnet 5.5 (穩定化檢查：驗證 v0.5.0 CI／IPA／資料管線)
- **驗證結果（皆為實測）**：
  - CI run `41681778781`（commit `9b33c70`）✅ 通過：**64 tests / 11 suites** 全過，`Simulate --games 10000` 通過。
  - IPA 打包 run `41681781720`（同為 `9b33c70`）✅ 成功；`dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa` 為此版本（v0.5.0）。
  - `pipeline/`：`ruff check --select UP,E,F,I` 與 `ruff format --check` 全過、`pytest` 4 passed。
  - repo 衛生：無 `.ipa`/照片/`.xcodeproj` 被追蹤；`data/fighters.json` 32 人，與 `RealUFCRoster.swift` 一致。
- **修正**：`RealismFeaturesTests.swift:8` 的 `var cond` 改 `let`（CI 唯一的編譯警告）。
- **已知但不處理**：`pipeline/.venv` 內舊的 `octagon_pipeline.pth` 指向不存在的 `src`（只在本機 .venv，已 gitignore，無影響）。
- **待使用者**：用 FlareStore 安裝 v0.5.0 實機試玩（尤其是首次選角時的官方照下載＋像素化、離線 fallback），把問題回報到這裡。

---

## 2026-11-04 · [實作] Gemini 4 Argon (P1-1 ~ P1-3 真實 UFC 選手資料管線、Elo 動態能力值換算與 iPhone 本機官方照自動像素化 v0.5.0)
- **完成 P1-1 真實 UFC 爬蟲管線（`pipeline/models.py`、`pipeline/scrape_ufcstats.py` → `data/raw_ufcstats.json`）**：
  - 使用現代 Python 工具鏈（`uv` + `httpx` + `beautifulsoup4` + `Pydantic v2` + `ruff`），從 `ufc.com/rankings` 與 `ufc.com/athlete/<slug>`（含分頁歷史戰績 `?page=0..2`）自動抓取 **32 位跨量級真實 UFC 頂尖選手**：
    - 生涯統計：`SLpM`、`Str.Acc%`、`SApM`、`Str.Def%`、`TD Avg`、`TD Acc%`、`TD Def%`、`Sub Avg`、`KD Avg`、平均比賽時間、站立/纏抱/地面佔比、KO/SUB/DEC 勝率。
    - 官方透明去背 PNG 網址：`fullBodyImageUrl`（`athlete_bio_full_body`）與 `headshotImageUrl`（`event_results_athlete_headshot`），遵守 `RULES.md` §2 絕不將照片進公開 repo。
    - 歷史對戰紀錄（`bouts`）：對手 slug ID、對手姓名、日期、勝負（自動辨識紅/藍角）、終結方式（`KO/TKO`、`SUB`、`U-DEC`、`S-DEC`、`M-DEC`）與回合時間。
- **完成 P1-2 三階段能力值與動態升降引擎（`pipeline/rating_calculator.py` + Swift `RatingEngine.swift` / `RealUFCRoster.swift` → `data/fighters.json`）**：
  - **階段 1（經驗貝氏收縮 Empirical Bayes Shrinkage）**：以 `w = n / (n + 8)` 將小樣本新秀數據往 UFC 母體均值收縮，換算 10 項 L1 基礎屬性（`0...100`）。
  - **階段 2（歷史賽事時間序 MMA Elo 與單場勝負方式動態加砍 `POWER_SYSTEM.md` §1.2）**：
    - 依時間順序重播每場比賽，計算期望勝率 `E = 1 / (1 + 10^((R_opp - R_my)/400))` 與含金量加權（近 3 場佔最高動態權重）：
    - 以 `KO/TKO` 獲勝自動加 `power`、`accuracy`（擊倒鐵下巴強敵額外加成）；被 `KO/TKO` 則直接砍 `chin` 與 `strikingDefense`（近 3 場內多次被 KO 自動拔除 `.ironChin` 並貼上 `.glassChin`）。
    - 以 `SUB` 獲勝自動加 `submission`、`clinch`；被降伏則砍 `submission`、`takedownDefense`。
    - 自動產出每位選手最新一場真實 UFC 比賽的異動戰報 `lastFightPatchNote`（例如：`Islam Makhachev: W vs Machado Garry (U-DEC R5): Elo 1743→1754 (+11) · takedown +2, clinch +2, cardio +3`）。
  - **階段 3（自動貼標 2–4 個 L2 `Trait` 特性）**，並同步匯出 `data/fighters.json` 與純 Swift `RealUFCRoster.swift`（新增 `RatingEngineTests.swift` 單元測試套件）。
- **完成 P1-3 iPhone 本機官方去背照 5 步像素化與快取（`App/Sources/FighterPixelSpriteService.swift` + `pipeline/pixelate_sprites.py`）**：
  - 手機端首次選中選手時，自動下載官方透明去背 PNG → 1. Alpha 邊界自動裁邊 → 2. `1.18x` 對比強化保留刺青與五官 → 3. BOX 面積平均縮圖（全身 `116px` 高、頭像 `64x64px`）→ 4. 32 色自適應調色盤無抖色量化 → 5. `1px` 深色描邊（`#12141F`）→ 寫入 `Caches/PixelSprites_v1/` 磁碟與記憶體快取（離線或無照新秀自動生成量級像素剪影）。
  - 更新 `App/Sources/LungeDemoScene.swift` 與 `App/Sources/ContentView.swift`（`v0.5.0 (5)`）：支援 5 組 UFC 夢幻對決快速切換、32 人全名單雙向自由選角下拉選單、64px 像素頭像、116px 八角籠像素小人、OVR/Elo 積分與最新真實賽事動態加砍戰報顯示。

---

> 📦 2026-11-03 及更早的紀錄已封存至 [HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)。
