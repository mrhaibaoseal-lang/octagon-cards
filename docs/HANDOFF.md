# 🔁 交接紀錄 (HANDOFF)

> 每次收工在**最上方**新增一筆。下一棒開工先讀最上面 2–3 筆。

## 待規劃確認
- （P5-3）回合結算仍瞬間切換，是否接受？（旁白面板取代手牌區一項已由 P5-3b 取代。）
- （P6）是否走 Roguelike、以及它和 `CAREER_AND_GYM.md` 的關係，使用者尚未決定。
- （P6）地面戰如何搭配新骨架，尚未設計（`VISUAL_DIRECTION.md` §3.5）。

---

## 2026-11-06 · [規劃] Claude Opus 5.5 (橫版與戰鬥人物定案)
- **使用者決定**：只做橫版；風格為像素賽事轉播風，盡量貼近 UFC；戰鬥人物用「共用骨架＋官方照貼圖」，頭身比約 35%；選角頁維持官方照像素圖；實作開新 session。
- **實測發現**：官方「全身照」只拍到腰部或大腿，腿和腳必須共用素材；照片手臂直接彎曲會斷開；自動抽刺青在深色皮膚上不可靠，所以改用照片當貼圖。詳見 `docs/VISUAL_DIRECTION.md`。
- **修改檔案**：`docs/VISUAL_DIRECTION.md`（新）、`RULES.md` §2、`docs/ANIMATION_ART.md`（加註）、`docs/TASKS.md`（新增 P6，ART-1 擴充）、`pipeline/prototypes/`（新，原型腳本，不含照片）。沒有改產品程式，未跑 CI 或打包。
- **未驗證**：原型只測 3 位選手，切割框為手動量測，Vision 自動切割還沒跑過，這是 P6-2 要回答的問題。
- **下一棒**：`[實作]` 開新 session 做 P6-1；P6-2 可並行，兩者都不要動 `OctagonCore`。

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-4 局勢顯示 v0.5.5)
- **`OctagonCore`（新 `RoundTrend.swift`，純 Swift）**：`RoundTrend.estimate(exchanges:state:)` 直接呼叫 `FightMatchEngine.scoreRound`（**沒有改動、也沒抽出內部函式**，計分結果不可能變），取 `damageByA/B`、`rockedByA/B`、`judgeCards`：`edge = 0.6 × 傷害差 + 0.5 × 裁判差`，再乘信心係數 `min(交手數, 4)/4`（避免第一拳就顯示壓制）。傷害差 = `(壓力A − 壓力B)/(壓力A + 壓力B + 24)`，壓力 = 傷害 + 12×Rocked；裁判差 = 三張卡 `(A−B)` 平均 ÷ 2。輸出 `value`（0–1，0.5 勢均力敵，越大越偏玩家 A）、`leader: Side?`、`level`（`even / slight / clear` → 勢均力敵／小幅領先／明顯領先，門檻 |edge| 0.12、0.40）、`exchangeCount`。空回合 = `RoundTrend.even`。另有 `RoundTrend.exchangeWinner(_:)`（單次交手誰佔上風，用於進度格；權重同 `scoreRound`）。不碰 `SeededRNG`、不輸出精確分數。
- **測試 `RoundTrendTests.swift`（12 個）**：空回合、完全對稱互換仍 0.5、第一拳不算壓制、A／B 單方壓制（>0.85／<0.15 且 clear）、鏡像相加為 1、純摔技控制、領先隨優勢單調上升、40 個 seed 實戰每個回合前綴都在 0–1 且 leader／level 一致、重複呼叫相同且 `scoreRound` 前後相同、單次交手勝者、中文等級名稱。
- **App 層**：新增 `BattleTrendViews.swift`。(1) `RoundStatusStrip`：頂列下方一條，左 8 格回合進度（綠＝玩家佔上風、紅＝AI、灰＝平，黃框＝目前這手）＋右 `TrendBar`（綠紅拔河條，中線＝均勢，下方文字「🟢 玩家 小幅領先」之類，**不顯示分數**）。(2) `HealthBarRow` 取代 `FighterStatusCard` 的 `statRow`：頭／身／腿損血時留下白色殘影再縮短、顯示紅色 `-N`、短暫白框，血量 ≤25 轉紅；體力與勢能沿用一般條。(3) `BattleAlertOverlay`：蓋在整個對戰區（手牌收起時也看得到，不攔截點擊），Rocked（橘）與深鎖（紅）有脈動邊框＋橫幅，流血只有橫幅（Lv 不為 0 時一直在）；文字依 `displayState`，所以與動畫同步。`BattleSession` 新增 `shownTrend`、`shownExchangeWinners`，只在 `syncDisplayToEngine`（播完／跳過／開新局）更新，所以播放中不會提早洩漏本手結果；`startPlayback` 與 `rng` 順序未動。版本 `0.5.5 (10)`。
- **測試結果**：CI run `42213207910` ✅（push `51be1b1`，103 tests / 13 suites，先前 91）；IPA run `42213230336` ✅，App 層無新編譯警告；IPA 已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。本機無 Swift 工具鏈，**尚未實機看過畫面**。
- **設計取捨（請規劃確認）**：(1) 局勢條只在每手播完後更新，不隨 beat 動（避免洩漏）；回合最後一手播完後局勢直接歸零（新回合），回合結果留給 P5-5 結算。(2) 流血是持續狀態，所以橫幅會一直在到 `cutSeverity` 歸零；若太吵可改成只顯示 Lv≥2。(3) 局勢門檻與權重集中在 `RoundTrend` 的 static 常數，實機覺得「太容易明顯領先／太難」直接調。
- **請使用者實機檢查**：① 局勢條與進度格在每手結束後是否看得懂、方向（綠左＝玩家）是否直覺；② 頭／身／腿損血的殘影與 `-N` 在狀態卡上是否清楚、數字有沒有被擠到；③ Rocked／深鎖的脈動邊框與橫幅是否夠明顯又不遮擋八角籠與牌（直式、橫式、矮螢幕）；④ 流血橫幅常駐是否太吵；⑤ 「勢均力敵／小幅領先／明顯領先」的出現頻率是否合理（打 1–2 手不應該就明顯領先）；⑥ 開新局、換回合、KO／降伏結束後進度格與警示是否正確清除。
- **下一棒**：`[實作]` 開新 session 做 P5-5（回合結算與賽後畫面）。

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-3b 翻牌對決 v0.5.4)
- **回饋與決定**：P5-3 實機節奏不錯，但旁白太快、看字就看不到上方動畫。使用者選了方案 C「翻牌對決」：播放時不再讀句子，改看牌。
- **`LungeDemoScene.swift`**：新增 `ExchangeCardNode`（牌背＋淺色牌面＋結果章）。`reveal` beat 才建牌（八角籠已放大）並翻開（`scaleX` ＋ `hide/unhide`，不用 `SKAction.run`）；`action` 彈出該方的牌（x 0.33w／0.67w、1.25 倍、z 13）、另一張縮回並 alpha 0.6；`hit/blocked/dodged/missed/feint/interrupted` 蓋章（`dodged` 蓋在揮空方；結果 beat 若該牌非焦點會先 focus；`interrupted` 牌面 alpha 0.4）。子節點 z 明確設定（框 0、字 0.2、章框 0.6、章字 0.8；根 12／13；飄字 20，字 0.1 高於陰影）因為 SpriteView 用 `.ignoresSiblingOrder`。`stageScale = clamp(h/260, 1…1.6)` 套用在站位高度（地板線 0.16h 起算）、地面位置、`resetPositions/settle/snapToRest/layoutFighters`、`pulse`、飄字偏移與貼圖 `size` 設定（先 `setScale(1)`）。牌尺寸：`cardHeight = min(0.3h, 130)`、`cardWidth = min(0.8 * cardHeight, 0.34w)`，數值集中在 `cardHeight/cardWidth/cardPosition`。`clearEffects` 併清牌。
- **`BattlePlayback.swift`**：`reveal` 0.90、`action` 0.65；`standardRange` 4.0…5.5；新增 `stageTransition` 0.3、`endHold` 0.35。
- **`BattleSession.swift`**：`startPlayback` 首 beat 前等 `stageTransition`、末 beat 後等 `endHold`；新增 `ExchangeRecap`／`battleLog`（`playTurn` 取得 beats 時、回合與手數遞增前寫入，跳過也看得到；`startNewMatch` 清空）與 `visibleRecaps`（播放中不含最新一筆，防洩漏）；移除 `narrationLines`。`rng` 消耗順序與 `OctagonCore` 未動。
- **`BattleView.swift`／新增 `BattleRecapView.swift`**：直式播放時收起資訊區與手牌區（0.28 秒動畫），八角籠吃滿；橫式右欄只顯示「交手進行中・點畫面跳過」；站立資訊區改顯示「上一手」（可捲動）並有 📜 按鈕，地面橫幅標題列也有 📜；戰報 sheet 由新到舊列出，不開背景互動。
- **測試結果**：CI run `42211740501` ✅（push `01002c3`，91 tests / 12 suites）；IPA run `42211753660` ✅，App 層無編譯警告；IPA 已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`（v0.5.4）。本機無 Swift 工具鏈，**尚未實機看過**。
- **請使用者實機檢查**：① 不看下方，只看八角籠就知道雙方出什麼、結果如何；② 每手長度與快／標準／慢是否合適；③ 八角籠放大／收回過渡會不會暈或突兀（SpriteView 可能直接跳尺寸）；④ 牌的大小與位置（矮畫面、橫式）；⑤ 打完後「上一手」與戰報 sheet 是否好讀；⑥ 地面戰、鎖技、KO 慢動作、跳過、第 8 手換回合、橫式都正常，牌不殘留。
- **退路**：若放大縮小太躁，改成八角籠固定大尺寸，手牌從底部滑出蓋在籠子上（只動 `BattleView`）。
- **下一棒**：等使用者實機確認後，`[實作]` 開新 session 做 P5-4。

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P5-3 App 播放時間軸 v0.5.3)
- **疑似問題確認（讀碼，已修）**：舊流程是 `playTurn` 先呼叫 `scene.playExchange(log:)`、同一個 tick 內又呼叫 `scene.resetPositions`（內含 `removeAllActions` 與 `layoutFighters(animated: false)`）→ 回合第 8 次交手（R1、R2）的動畫確實會被立刻取消，連 Rocked 顏色與橫幅都被重設。新流程：`playTurn` 只設 `pendingSceneReset`，**播完（或跳過）後**才 `resetPositions`。
- **新增 `App/Sources/BattlePlayback.swift`**：`PlaybackSpeed`（快 ×0.55／標準 ×1.0／慢 ×1.5）、每種 beat 的基準秒數、`timeline(for:log:speed:)`、`ExchangeBeatKind.changesPosition`。標準速度下非終結 beat 的總長被夾在 3.0–4.2 秒；重擊 +0.08 秒頓幀；致命一擊以 0.4 倍慢動作播放（秒數 ÷0.4），終結 beat 固定 1.6 秒。
- **`BattleSession.swift`**：引擎 `state` 與顯示 `displayState` 分開。`playTurn` 照舊立刻結算（`rng` 消耗順序完全沒動，只在結算後多呼叫純函式 `ExchangePresentation.build`）；再由 `startPlayback` 的 Task 逐 beat 更新 `displayState`（血量／Rocked／割傷隨每個 beat，距離／地面在第一個「位置變化」beat 才切到交手後狀態，體力與勢能播完才更新）。新增 `isPlaying`、`narrationLines`、`shownRound/shownExchange/shownCompletedRounds`（讓回合數與計分格不提前洩漏）、`skipPlayback()`、`setPlaybackSpeed`（速度存 UserDefaults `playbackSpeed`）。播放中 `playTurn` 直接 return（鎖手牌）；`startNewMatch` 會取消播放（用 generation 值避免舊 Task 影響新局）。
- **`LungeDemoScene.swift`（重寫動畫部分）**：舊 `playExchange/attack` 移除，改成 `beginExchange / play(beat:log:duration:) / settle(to:finish:)`。每個 beat 的動畫長度都是 beat 秒數的比例，且每個 beat 開頭先 `snapToRest`，所以不會殘留上一拍的位移。**雙方都命中時各自的 `hit` beat 各播一次**（先手、後手）。有的動作：命中（衝拳＋受擊閃白＋退後＋傷害飄字，重擊再加全畫面閃光與 0.08 秒頓幀）、格擋（青色閃＋「格擋 -N」）、閃避（淡出側閃＋「閃避!」，攻方揮空）、落空、佯攻（雙假動作＋「佯攻!」）、Rocked 晃動、割傷、被打斷、抱摔／翻身／起身／鎖技脈動／裁判分開／纏鬥／貼籠的飄字與重排；地面命中沿用 GnP 抬身下砸；KO/TKO 在致命一擊起進入慢動作，輸家倒地並在 `settle` 後仍倒著，降伏顯示 TAP!。**沒有使用 `SKAction.run` 閉包**（避免 Swift 6 並行檢查在無法本機編譯時出錯）。
- **`BattleView.swift`**：HUD／地面橫幅改讀 `displayState`；血條寬度加 0.3 秒動畫；播放中手牌區換成「交手進行中」解說面板（最近 4 行旁白，新行較亮；同高度 206pt，版面不動）；播放中點戰鬥區任何位置＝跳過（頂列按鈕仍可用）；計分格旁加 `⏱ 標準` 選單切換快／標準／慢。
- **測試結果**：本機無 Swift 工具鏈。IPA run `42208467693` ✅（App 層編譯無警告）；CI run `42208454571` ✅（OctagonCore 未改動，91 tests）。IPA 已下載至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`（v0.5.3）。**尚未實機看過動畫。**
- **設計取捨（請規劃確認）**：(1) 播放中不顯示手牌（改顯示旁白），避免「地面牌／Rocked 限制」提前洩漏交手結果；若想保留可見的暗色手牌再改。(2) 回合最後一個交手播完後，回合結算（體力恢復、站回遠距離）仍是瞬間切換，P5-5 的結算卡再處理。(3) `ExchangePresentation` 沒缺欄位，無「待規劃確認」新項目。
- **請使用者實機檢查**：① 標準速度每次交手 3–4 秒是否合適（快／慢是否好用）；② 雙方都命中時兩邊動作與飄字是否看得清；③ 頓幀與 KO 慢動作的感覺；④ 回合第 8 次交手（R1、R2 結尾）動畫現在是否完整播出；⑤ 點畫面跳過、播放中換「🔄 重開」「← 選角」是否正常；⑥ 手牌區換成旁白面板是否可接受；⑦ 地面（抱摔、GnP、鎖技）與 Rocked 的呈現。
- **下一棒**：等使用者確認節奏（可能調 `BattlePlayback.baseDuration` 與 `standardRange`）後，`[實作]` 開新 session 做 P5-4（局勢顯示）。

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
