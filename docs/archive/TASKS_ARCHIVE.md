# 🗄️ 任務封存 (TASKS_ARCHIVE)

> 從 `docs/TASKS.md` 原文搬出的已完成任務，內容未修改。程式註解裡的 `docs/TASKS.md Pn-n`，只要不在看板上就在這裡。文中的「HANDOFF」紀錄多半已移到 [HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)。看板見 [TASKS.md](TASKS.md)。

---

## ✅ P0 基礎建設（完成）
- [x] P0-1 repo 結構、`OctagonCore` 套件、空殼 App、L0 衝撞動畫原型
- [x] P0-2 免費 CI（swift test）＋未簽名 IPA 打包 workflow
- [x] P0-3 使用者以 FlareStore 簽名安裝成功

---

## ✅ P2 戰鬥引擎 v0（完成）
> 先讓「站立一回合」能在測試中跑完；畫面之後再接。設計來源：docs/STRIKING_AND_DECK.md

- [x] **P2-1 資料模型**（CI 通過：run 41619680491）
  - 內容：`Fighter`（10 項屬性、特性清單）、`Card`（類型、距離、目標、速度、威力、精準、體力、標籤）、`FightState`（距離、籠邊、三部位血量、體力、氣勢、Rocked）
  - 完成條件：型別皆 `Sendable`/`Codable`；有建立範例選手與 10 張範例卡的測試
- [x] **P2-2 機率優勢表**（CI 通過：run 41620796923）
  - 內容：把 STRIKING_AND_DECK §2.1 的基準機率表做成資料（非寫死在 if/else）；`resolveOdds(my:opp:state:)` 套用修正並經過 `Odds.clamp`
  - 完成條件：測試涵蓋「任何組合結果都在 5%–95%」「距離不符時機率下降」
- [x] **P2-3 可重現的亂數**（CI 通過：run 41621269686）
  - 內容：注入式 RNG（帶 seed），同 seed 同結果
  - 完成條件：同 seed 跑兩次完全一致的測試
- [x] **P2-4 單次交手結算**（CI 通過：run 41622958026 / 41623455711）
  - 內容：雙方出牌 → 判定 → 傷害/體力/氣勢/距離更新 → Rocked 與 KO/TKO 判定；回傳透明算式戰報 `ExchangeLog`（含機率拆解 `OddsBreakdown` 與擲骰值）與 `FightState.validateInvariants()` 自檢
  - 完成條件：每種卡牌類型至少一個結算測試；不變量自檢通過
- [x] **P2-5 一回合 & 一場比賽**（CI 通過：run 41623897541）
  - 內容：8 次交手 = 1 回合、3 回合、回合間體力恢復、KO/TKO/判定（裁判計分先用簡化版），並輸出含 `seed` 的可重現紀錄
  - 完成條件：能用兩個隨機/傾向 AI 跑完整場並回傳結果；同 seed 重跑整場結果完全一致
- [x] **P2-6 平衡模擬器（命令列）＋ 20 萬次不變量壓力測試**（CI 通過：run 41626624573，438,356 次交手 0 違規）
  - 內容：`swift run Simulate --games 10000`，每手執行 `validateInvariants()` 驗證無破圖/越界數值，輸出各卡類型使用率/勝率、KO 率、判定率
  - 完成條件：CI 可跑；10,000 場零不變量錯誤；輸出寫進 HANDOFF 供 `[規劃]` 調表
- [x] **P2-7 iPhone 站立實機沙盒與 Debug 戰報抽屜（含打包 IPA）**（打包通過：run 41627668313）
  - 內容：在 `App/Sources` 接上 `FightEngine`，讓玩家能在手機上選牌打完 3 回合站立賽，內建 `[Debug]` 即時算式明細抽屜與「📋 一鍵複製 Seed 重現碼」按鈕，並觸發雲端打包未簽名 IPA
  - 完成條件：CI 編譯打包成功、下載 `.ipa` 至 `dist/` 供 FlareStore 安裝實測

---

## ✅ P3 抱摔、纏抱與地面戰引擎（完成，設計來源：docs/GROUND_GAME_DESIGN.md）
> 把真實 MMA 的「抱摔進地面 → 5 大位置階層推進 → 上下位 4×4 讀心 → 掃技翻轉 → 2 階段鎖技終結」寫入 `OctagonCore`

- [x] **P3-1 地面位置階層與站立抱摔橋樑（Takedown & Positional Hierarchy）**（CI 通過：run 41630246303）
  - 內容：定義 5 大地面位置（`FullGuard` 全防守、`HalfGuard` 半防守、`SideControl` 側控、`FullMount` 騎乘、`BackControl` 背後控制）與上下位角色（`topSide` / `bottomSide`）；實作站立抱摔卡 vs 防摔（`Sprawl`）/ 迎擊膝 / 拉斷頭台檢定（依 `takedown` vs `takedownDefense`、距離與腿傷修正），成功依摔法進入對應起始地面位置
  - 完成條件：抱摔成功/失敗、各位置轉移（過腿推進與蝦行退位）與扶籠起身回到站立的單元測試全過
- [x] **P3-2 上下位 4×4 讀心矩陣與掃技翻轉（Ground Exchange & Sweep）**（CI 通過：run 41632824319）
  - 內容：實作 `GROUND_GAME_DESIGN.md` §3 的上下位四大行動讀心表（上位：`Advance` 過腿 / `GnP` 砸拳 / `Submission` 降伏 / `Smother` 重壓 vs 下位：`Frame` 防過腿 / `Escape` 逃脫起身 / `SweepOrSub` 掃技或下位鎖 / `Shell` 抱頭防砸拳）；實作下位抓上位砸拳瞬間「掃技翻轉（上下位互換）」與連續 3 次消極由裁判強制分開回到站立（`Referee Stand Up`）
  - 完成條件：4×4 組合結算測試、Khabib 式重壓抓起身完封測試、Oliveira 式下位抓砸拳翻轉測試全過
- [x] **P3-3 2 階段降伏鎖技對決（Submission Chain Minigame）**（CI 通過：run 41632824319）
  - 內容：實作 `GROUND_GAME_DESIGN.md` §4 的兩階段鎖技系統（階段 1 `Setup` 抓把位 → 階段 2 `LockedIn` 深鎖 → `TapOut` 拍墊投降），支援真實 UFC 前 6 大鎖技（背後裸絞 RNC、斷頭台 Guillotine、肩固/達斯絞、木村鎖 Kimura、下位三角絞 Triangle、十字固 Armbar），並納入回合流汗滑脫與低體力絞技加成
  - 完成條件：上位與下位發動鎖技、掙脫回地面、2 階段鎖死投降（`.submission`）測試全過
- [x] **P3-4 綜合 MMA 模擬器（站立＋摔＋地面）與三角相剋驗證**（CI 通過：run 41632824319，559,305 次交手 0 違規）
  - 內容：將抱摔與地面戰接入 `FightMatchEngine` 與 `Simulate`，驗證「打擊手 vs 摔角手 vs 柔術家」跨風格對決，確保摔角手能靠抱摔逆轉純打擊手、柔術家能在下位威脅摔角手，且全場終結分布接近真實 UFC（約 30–35% KO/TKO、15–20% 降伏、50% 判定）
  - 完成條件：10,000 場綜合模擬 0 違規，數據寫入 `HANDOFF.md`

---

## ✅ P4 完整卡牌庫（58 張）與手牌抽牌系統（完成，設計來源：docs/STRIKING_AND_DECK.md §3.1, §11）
- [x] **P4-1 站立核心卡牌庫擴充（28 張）**（CI 與 10,000 場模擬器通過：run 41629406277）
  - 內容：補齊遠/中/近三距離的拳、腿、肘、膝、閃避、格擋、反擊、佯攻、前後移動卡（解決近距離缺牌問題）
  - 完成條件：遠/中/近各距離皆有完整攻防移動卡，模擬器驗證無單一毒瘤卡
- [x] **P4-2 抱摔與地面卡牌庫（30 張）**（CI 通過：run 41632824319）
  - 內容：8 張抱摔/防摔反制卡、10 張上位推進/重壓/砸拳卡、6 張核心降伏鎖技卡、6 張下位防禦/掃技/扶籠起身卡
  - 完成條件：所有地面位置皆有對應合法出牌池
- [x] **P4-3 20 張牌組、5 張手牌抽補與進地面自動翻面切換 + iPhone 實機沙盒更新**（CI 通過：run 41634265166；IPA 打包通過：run 41634266609）
  - 內容：實作每回合抽滿 5 張手牌、出完補牌、進入地面時手牌自動切換為上/下位地面牌組；更新 iPhone 實機沙盒支援完整「站立＋抱摔＋地面＋鎖技」對戰並打包 IPA
  - 完成條件：CI 測試與未簽名 IPA 打包通過

---

## ✅ P1 資料管線（完成，設計來源：docs/POWER_SYSTEM.md §1–2, RULES.md §2）
- [x] **P1-1 ufcstats / UFC.com 爬蟲 → `data/fighters.json`**
  - 內容：建立 `pipeline/scrape_ufcstats.py`（Python + `uv` + `httpx` + `BeautifulSoup4` + `Pydantic v2`），自動抓取 32 位跨量級真實 UFC 頂尖選手生涯數據、官方去背半身與大頭照 PNG 網址（`athlete_bio_full_body` / `event_results_athlete_headshot`），以及分頁歷史對戰紀錄（對手 ID、勝負、KO/Sub/Dec 終結方式、回合時間），輸出 `data/raw_ufcstats.json`
- [x] **P1-2 能力值換算（百分位＋貝氏收縮＋真實賽事對手強度 Elo 與單場勝負表現動態加砍系統）**
  - 內容：實作 `pipeline/rating_calculator.py` 與純 Swift `RatingEngine.swift` / `RealUFCRoster.swift`（見 `POWER_SYSTEM.md` §1.2）：三階段計算（1. 貝氏收縮防新秀小樣本暴衝 → 2. 依時間序重播歷史賽事計算 MMA Elo 與單場勝負方式動態加砍對應屬性 `power`/`chin`/`submission`/`takedownDefense`/`cardio` → 3. 自動貼 2–4 個 L2 `Trait` 特性標籤並產出最新一場比賽 `lastFightPatchNote` 異動報告），輸出 `data/fighters.json`
- [x] **P1-3 App 端：下載官方去背照 → 本機像素化 → 快取（依 RULES.md §2）**
  - 內容：實作 `App/Sources/FighterPixelSpriteService.swift` 與 `pipeline/pixelate_sprites.py`（零 AI 額度消耗、不將照片放進公開 repo）：在 iPhone 本機自動下載官方去背 PNG → Alpha 邊界自動裁邊 → 刺青與五官強對比銳化 → BOX 縮圖（`116px` 全身 / `64x64px` 頭像）→ 32 色無抖色量化 → `1px` 深色描邊（`#12141F`）→ 本機磁碟與記憶體快取（離線或無照新秀自動生成量級像素剪影），並接入 `SpriteKit` 八角籠與 `SwiftUI` 選角對戰介面（`v0.5.0`）

---

## ✅ P5 已完成的卡
> 來源：v0.5.1 實機回饋「介面陽春、無法判斷局勢、感受不到節奏」；診斷見 `docs/HANDOFF.md` 2026-11-06。規格依據：`docs/ANIMATION_ART.md` §5、`docs/MASTER_PLAN.md` §2。
> 共同限制：一張卡一個 session；不改戰鬥數值與機率；演出層不得消耗 `SeededRNG`，同 seed 結果必須不變；不新增 AI 生圖。
> 已定預設（使用者可再改）：標準速度每次交手約 4–5.5 秒，並可跳過；回合中只顯示局勢條，不顯示精確分數；精確預估分在回合結算才出現。

- [x] **P5-0 精簡交接文件**
  - 內容：把 `docs/HANDOFF.md` 中 2026-11-04 之前的紀錄原文搬到新檔 `docs/HANDOFF_ARCHIVE.md`；`HANDOFF.md` 保留「待規劃確認」與最近紀錄，並加一行封存連結
  - 完成條件：沒有遺失任何紀錄；只改文件
- [x] **P5-1 拆分 `ContentView.swift` 並整理版面（`App/Sources`）**
  - 內容：拆成 `PreFightView`（選角）、`BattleView`（對戰）、`DebugDrawerView`、對局狀態物件 `BattleSession`（`@Observable`，承接 `playTurn` 等邏輯）；選角移到賽前頁，對戰頁固定不捲動，八角籠加高，Debug 預設收起，地面資訊改放固定區域，手牌不再因橫幅被推動
  - 完成條件：CI 通過、對戰規則與 Debug 功能不變、`ContentView.swift` 只留導覽；打包 IPA
- [x] **P5-2 交手演出時間軸（`OctagonCore` 純 Swift）**
  - 內容：新增 `ExchangePresentation.build(log:)`，只讀 `ExchangeLog`（`firstSide`、`stateBefore`、`stateAfter`、雙方 `ExchangeSideLog`），輸出有序 beat：揭牌、先手動作、傷害或結果、後手動作（被打斷就略過）、位置或狀態變化、終結；每個 beat 附繁中旁白與顯示用血量快照
  - 完成條件：Swift Testing 涵蓋雙方命中、單方命中、被打斷、閃避或格擋、抱摔、掃技、鎖技、裁判分開、KO；同一 log 輸出完全一致；最後一個 beat 的血量等於 `stateAfter`
  - 完成：`ExchangePresentation.build(log:nameA:nameB:)`（`ExchangePresentation.swift`）＋ 測試 `ExchangePresentationTests.swift`；CI run `42206706049` ✅（91 tests）
- [x] **P5-3 App 播放時間軸（本階段的實機檢查點）** — 程式完成，**待使用者實機確認節奏後才做 P5-4**
  - 內容：`BattleSession` 分開引擎狀態與顯示狀態，血條依 beat 更新；播放中鎖定手牌，點畫面可跳過；傷害飄字、重擊頓幀 0.08 秒、KO 慢動作；雙方都命中時兩邊都要播；格擋、閃避、佯攻有簡單動作；設定快／標準／慢；修正回合第 8 次交手動畫被 `resetPositions` 取消的疑似問題
  - 完成條件：CI 與 IPA 通過；**使用者實機確認節奏後才做 P5-4**
  - 完成：v0.5.3 (8)；CI run `42208454571` ✅、IPA run `42208467693` ✅；IPA 已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。實作見 HANDOFF 2026-11-06 P5-3；**節奏（快／標準／慢）待使用者實機確認**
- [x] **P5-3b 翻牌對決（P5-3 實機回饋：旁白太快、看字就看不到動畫）** — 程式完成，**待使用者實機確認後才做 P5-4**
  - 內容：播放時收起手牌與資訊區、八角籠放大；雙方的牌大張翻開、輪流彈出，結果章直接蓋在牌上；每手標準時間 4–5.5 秒；完整句子改到打完後的「上一手」與戰報 sheet（`BattleRecapView`）；移除逐句旁白面板。不改戰鬥數值與 `SeededRNG`
  - 完成條件：CI 與 IPA 通過（App 層無警告）；`OctagonCore` 未改動（91 tests）；使用者實機確認
  - 完成：v0.5.4 (9)；CI run `42211740501` ✅、IPA run `42211753660` ✅；IPA 在 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。見 HANDOFF 2026-11-06 P5-3b
- [x] **P5-4 局勢顯示**
  - 內容：`OctagonCore` 新增 `RoundTrend.estimate(exchanges:state:)`，重用 `FightMatchEngine.scoreRound` 的 `damageByA/B`、`rockedByA/B`、`judgeCards` 算出 0–1 局勢值與「勢均力敵／小幅領先／明顯領先」；App 顯示回合進度格、局勢條、三部位血條變化強調；Rocked、深鎖、流血用全畫面可見的警示
  - 完成條件：單元測試涵蓋空回合、單方壓制與數值範圍；不改變 `scoreRound` 計分結果；CI 與 IPA 通過
  - 完成：v0.5.5 (10)；CI run `42213207910` ✅（103 tests / 13 suites）、IPA run `42213230336` ✅；IPA 在 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。見 HANDOFF 2026-11-06 P5-4；**待使用者實機確認**
