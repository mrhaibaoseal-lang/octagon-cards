# 🗄️ 交接紀錄封存 (HANDOFF_ARCHIVE)

> 從 `docs/HANDOFF.md` 原文搬出的舊紀錄，內容未修改，由新到舊排列。最新紀錄見 [HANDOFF.md](HANDOFF.md)。

---


## 2026-11-06 · [實作] Claude Sonnet 5.5 (P6-2 實機結果：未達門檻)
- **結果**：使用者標記 31 位：**可用 20、不可用 11**、1 位未標（Chandler，自動判定 OK）。即使 Chandler 算可用也只有 21，**低於門檻 28，不進 P6-3**，回 `[規劃]`。
- **失敗名單**（人工不可用）：Tsarukyan、Topuria、O'Malley、Oliveira、Holloway、Pantoja、Whittaker、Poirier、Adesanya、Della Maddalena、Hooker。11 位全部勾「手肘位置錯」（Whittaker 另有肩膀偵測不到）。
- **失敗模式**：① 手肘：9 位至少一側 Vision 沒給出可信手肘（信心 <0.3），其中 6 位兩側都沒有。② 肩膀：Whittaker、Yan、Pereira 兩肩偵測不到。③ 兩位自動 OK 但人工判不可用（Topuria、Holloway），代表「有偵測到」不等於「位置對」，不能只靠信心值過濾。
- **偵測率**：32 位中只有 Jon Jones 偵測得到胯（腰部以下被裁，如預期）；大多數人至少一側手腕偵測不到，前臂靠延伸估算（可見比例 32%–100%）。**腿的關節完全不能靠 Vision**，但這本來就是共用素材。
- **自動與人工的落差**：自動 OK 19 位中 16 位人工可用、2 位不可用、1 未標；自動 FAIL 13 位中有 4 位人工可用（Aspinall、Yan、Lopes、Pereira）。後者的原因未記錄（Yan／Pereira 沒有肩膀點卻標可用，可能是看照片判斷「能手動切」，而不是疊圖框好用），**自動判定規則與人工標準不一致，數據解讀要保守**。原型選手 O'Malley、Adesanya 自動切割都失敗。
- **給 `[規劃]` 的選項（我未實作，也未驗證）**：A. Vision 只取肩與臉，肘／腕改用肩寬比例推算（照片多為雙臂下垂的標準正面，可能救回多數肘失敗者，但要看 Topuria／Holloway 這類是否仍歪）；B. 為失敗者手量切割框存成資料表（名單約 32 人，可重用原型做法）；C. 不可用者走 §3.6 退路（約三分之一選手無肢體動作）；D. 調低門檻。可混用，如 A 加 B。
- **資料**：完整逐人結果存於使用者 Downloads 的 `P6-2 Vision 切割結果…txt`（含每人警告）。工具 `RigCutDebugView` 保留，之後調演算法可直接重跑（版本在分支 `claude/charming-elion-751be2`，尚未合併）。
- **下一棒**：`[規劃]` 定案後再開 P6-3；若選 A，可先在除錯畫面試新算法重標一輪。

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P6-2 Vision 切割驗證工具)
- **做了什麼**：新增僅供開發的除錯畫面 `RigCutDebugView.swift`，入口是預備頁左下角半透明的「🔬 Rig」小鈕（加在 `ContentView` 的 overlay，沒碰 `PreFightView`／`BattleView`）。對 `RealUFCRoster.all` 的 32 位，下載官方全身照（原圖快取在 `Caches/RigCutPhotos_v1/`，不進 repo），用 `VNDetectHumanBodyPoseRequest` ＋ `VNDetectFaceRectanglesRequest` 找頸／肩／肘／腕／胯，算出軀幹、上臂、前臂的區域框並疊在照片上。
- **區域算法**（常數都在 `RigCutAnalyzer`，要調直接改）：軀幹＝肩線上緣外推 0.10 肩寬、兩側各外推 0.08，下緣到胯線；胯偵測不到就用肩寬×1.1 估算，並在照片底邊截斷。手臂寬＝0.34 肩寬（前臂 ×0.85）。手腕偵測不到時，前臂沿上臂方向延伸到照片邊緣（虛線＝估算）。
- **畫面**：左邊 32 人名單（🟢🔴＝自動判定，✅❌＝人工標記），中間照片＋疊圖，右邊逐人控制（上一位／下一位、✅可用／❌不可用＋失敗原因標籤、關節信心值、警告）。「全部下載並分析」一次跑完 32 人；「複製結果」把逐人結果貼成文字（給你貼回來）。人工標記存在 `UserDefaults`（`rigCutMarks_v1`）。自動判定只是輔助，**最後以人工標記為準**。
- **改了哪些檔**：`App/Sources/RigCutDebugView.swift`（新）、`App/Sources/ContentView.swift`（+17 行）。`OctagonCore`、`project.yml`、戰鬥數值皆未動；**版本號沒升**，合併 P6-1 時再處理。
- **測試結果**：IPA run `42224539282` ✅（分支 `claude/charming-elion-751be2`，commit `8451df1`），建置 log 中 App 層無編譯警告。`ci.yml` 只在 push main 時跑，本分支沒跑；`OctagonCore` 未改。IPA：`dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。**Vision 在真機上的實際結果尚未看過**。
- **下一棒**：使用者實機逐人標記後，把「複製結果」貼回來，由 `[實作]` 將可用／不可用人數與失敗模式寫進這裡。≥28 位可用 → 解鎖 P6-3；否則回 `[規劃]`。
- **請使用者實機檢查**：① 預備頁左下角點「🔬 Rig」；② 按「全部下載並分析」（需連網，約 32 張小圖）；③ 逐人看：青框是否蓋住軀幹、黃框是否蓋住上臂、橙框是否蓋住前臂、綠點是否落在關節上；④ 能用就按「✅ 可用」（會自動跳下一位），不行就按「❌ 不可用」並勾失敗原因；⑤ 全部標完按「複製結果」貼回聊天。判斷標準：框能不能直接當貼圖切下來用，邊緣包到背景或切到身體都算不可用；手被裁掉但前臂框合理仍算可用（走延伸估算）。

---

---

## 2026-11-06 · [實作] Claude Opus 5.5 (P6-1 實機回饋修正 v0.6.1)
- **使用者回饋**：字體模糊、卡牌擋住距離顯示。截圖另外看出：牌名被下一張蓋住、牌下半部資訊沉到畫面外。
- **手牌**：v0.6.0 的左右保留區太寬，5 張牌只分到約 320pt（間距約 52）。左下卡改 150 寬、右下改直排，844pt 機型扣掉安全區後約 418pt。牌面文字避開被下一張蓋住的右緣（`coveredWidth`）；距離／目標／地面說明移到牌名正下方，靜止時也看得到；扇形角度由每張 5° 降為 2.5°。
- **距離**：場景裡的 `statusLabel` 平常不再顯示位置，只留裁判與終結訊息（播放中手牌已滑走）。站立時轉播列下方新增「遠／中／近」條，地面時沿用地面橫幅，手牌與面板都不會擋到。
- **字體**：戰鬥頁改用系統字型加 `monospacedDigit`，移除等寬字型（中文會 fallback、字距不齊），最小字級由 8–9pt 提高到 10–11pt，面板底色加深，並拿掉大部分裝飾 emoji。`SKLabelNode` 改用 `PingFangTC-Semibold`；翻牌內容以放大後的尺寸建立再縮小，飄字改為直接畫到最終大小，不再把文字放大 1.25 倍。
- **其他**：Rocked／深鎖／流血橫幅移進版面排在位置條下方，不再和地面橫幅重疊（新 `BattleAlertBanners`／`BattleAlertFrame`）；地面時翻牌往外移，避開較寬的橫幅；左下移除重複的地面與位置文字，「上一手」改顯示最後兩句（結果）。`BattleSession`、`OctagonCore` 未動。
- **測試結果**：IPA run `42221913281` ✅、CI run `42221912920` ✅（push `e7b10f2`），App 層無編譯警告。IPA：`dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`（v0.6.1）。**尚未實機看過**。模糊只從壓縮過的截圖判斷，沒有找到單一確定原因，若實機仍模糊需再查（把原始截圖傳來比對）。
- **請使用者實機檢查**：① 字是否清楚，尤其牌面（仍有小角度旋轉）；② 5 張牌的牌名與距離是否都讀得到，小機型是否仍太擠；③ 遠／中／近條是否好懂；④ 上拖出牌手感；⑤ 深鎖時橫幅疊在地面橫幅下方會不會遮到人物；⑥ 地面時翻牌位置。
- **未處理，屬後續卡**：地面雙人是整張圖旋轉 90°、尺寸偏大（P6-4）；八角籠背景仍是素色（ART-1）；牌面還沒有依牌型上色。

---

---

## 2026-11-06 · [規劃] Claude Opus 5.5 (交接文件瘦身，省 token)
- **做了什麼**：P0–P4 與 P5-0～P5-4 的卡原文移到新檔 `docs/TASKS_ARCHIVE.md`；11 筆舊紀錄原文移到 `HANDOFF_ARCHIVE.md`；未解決的確認事項摘要到上方兩個「待確認」區。`AGENTS.md` §2 改為開工少讀、每筆約 10 行、超過 3 筆就封存。
- **新增**：`.claude/settings.json`（禁止直接 Read `data/*.json` 兩檔與 `dist/**`）、`.claude/skills/ship/`（打包與查 CI，輸出精簡）。
- **驗證**：逐行比對封存前後，只有 3 行標頭說明改寫，30 筆紀錄都在；deny 規則實測生效；skill 的查詢指令用 run `42218782951` 試過，但**尚未跑過完整打包流程**。只改文件與設定，未動產品程式。
- **下一棒**：不變，等使用者實機確認 P6-1 後做 P5-5；P6-2 可並行。

---

---

## 2026-11-06 · [實作] Claude Sonnet 5.5 (P6-1 橫版重排對戰頁 v0.6.0)
- **`project.yml`**：只留 LandscapeLeft／Right，版本 `0.6.0 (11)`。`OctagonCore` 未改動。
- **`BattleView.swift`（重寫，直式分支移除）**：`ZStack` 最底是滿版 `SpriteView`（`ignoresSafeArea`，尺寸不再因播放改變；播放中收起資訊區的動畫已移除）。疊在上面：上方 `BroadcastBar`；地面時在轉播列下方一條緊湊的地面橫幅（位置、上下位、消極、鎖技階段）；左下資訊卡（手牌提示／抽棄牌數／上一手三行，點開戰報、目前位置）；右下已完成回合比分＋速度選單＋「☰ 選單」（算式、重現碼、戰報、切換全牌庫/5張、重開、回選角、Seed）。播放中點畫面跳過保留。KO／判定結果橫幅取代手牌、置於底部中央。
- **5 張扇形手牌（`HandFanView`／`HandCard`）**：靜止時沉入底緣只露上半部；點選＝升起放大 1.2 倍並顯示「↑ 上拖出牌」，再點取消；往上拖超過 60pt（且以垂直為主）且該牌合法＝出牌；不合法牌變淡不能出。播放中（或比賽已結束）整層滑出畫面並停用點擊。全牌庫除錯模式超過 6 張時改成橫向捲動列，手勢相同。
- **`BattleTrendViews.swift`**：`RoundStatusStrip`／`HealthBarRow`／`FighterStatusCard` 換成 `BroadcastBar`＋`BroadcastFighterPanel`（左右鏡像：頭像、名稱、Rocked／流血徽章、頭身腿體勢五條細條，血條損失殘影與 `-N` 保留，≤25 轉紅）＋`BroadcastCenter`（回合／交手數、8 格進度、局勢條，不顯示精確分數）。`BattleAlertOverlay` 加 `topOffset`，橫幅位於轉播列下方，脈動邊框與 Rocked／深鎖／流血警示邏輯不變。
- **`LungeDemoScene.swift`**：`stageScale = clamp(h/250, 1…1.6)`（390pt 高約 1.56）；新增 `floorY = 0.26h`（地板線抬高，腳避開露出的手牌）、`topBarClearance = 66`；翻牌改為 `min(0.26h,104)` 高、置於轉播列正下方；飄字上限避開轉播列；加一條淡色地板區塊。動畫、`SeededRNG`、`BattleSession`、`BattlePlayback` 未動。
- **`PreFightView.swift`**：改雙欄（左：標題、熱門對戰、自選；右：兩張選手卡可捲動＋固定的「開始對戰」）。
- **測試結果**：CI run `42218768481` ✅（push `59c037e`，OctagonCore 無變動）；IPA run `42218782951` ✅，App 層無新編譯警告。IPA：`dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`（約 0.8 MB，v0.6.0）。本機無 Swift 工具鏈，**尚未實機看過畫面**。
- **設計取捨（請規劃確認）**：(1) 手牌「點選放大」後須再上拖才出牌，沒有第二次點擊出牌的捷徑；若實機覺得難出牌再加。(2) 狀態列／Home 指示器已隱藏（`statusBarHidden`、`persistentSystemOverlays`）。(3) 紅藍角：仍沿用既有玩家綠／AI 紅，未改成紅藍（局勢條與進度格也是綠紅），待 `[規劃]` 決定。(4) `BattleSession` 的 scene 初始尺寸仍是 390×260（`resizeFill` 會立刻覆蓋，不影響），不在本卡範圍。
- **請使用者實機檢查**：① 844×390 與較小機型（SE／mini）轉播列是否擠、中央 190pt 區塊與左右血條是否被截斷，瀏海側邊是否被蓋住；② 手牌靜止時露出的高度、點選放大、上拖出牌的手感，與左下資訊卡、右下選單是否互相遮擋（機型較窄時）；③ 播放時手牌滑出、八角籠尺寸是否真的完全不變；人物腳是否避開手牌、頭是否蓋到轉播列、翻牌是否與人物頭部重疊太多；④ 地面戰橫幅位置是否蓋到趴著的人物；⑤ Rocked／深鎖脈動邊框與橫幅是否在轉播列下方、不擋牌；⑥ 選單內算式、重現碼、戰報、切換全牌庫、重開、回選角都可用；⑦ 賽前頁橫向兩欄是否好操作；⑧ KO／判定結果橫幅與「再打一場」；⑨ 轉向鎖定：App 不應再能轉成直式。
- **下一棒**：等使用者實機確認後，`[實作]` 開新 session 做 P5-5（橫版）或依 P6-2 結果推進；P6-2 可並行。

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

## 2026-11-03 · [實作] Gemini 4 Argon (P4 後全面機制審查修正 + 三大 UFC 擬真系統擴充 v0.4.0)
- **第一階段：嚴格代碼與遊戲機制審查（抓出並修復 4 個隱藏機制錯位，commit `1be3e0b`）**：
  1. **修復「下位發動三角絞/十字固時，上位防守方意圖判定錯位」**：原本 `GroundOdds.submissionChainBreakdown` 一律用 `effectiveBottomIntent` 判斷防守方，導致上位選手出 `.block`（如 `dagestaniHandcuff` 重壓）被誤判為抱頭龜縮 `.shell` 反而更容易被絞。已改為依 `defenderRole`（`.top` vs `.bottom`）分開判定強防禦（上位疊壓過腿 `.advance` / 下位防禦撐架 `.frame` 與蝦行逃脫 `.escape`）與破綻意圖（上位撐高砸拳 `.gnp` / 下位抱頭龜縮 `.shell`）。
  2. **補齊「出拳/抱摔者自身腿部重傷 (`health.legs < 50`) 時抱摔推進 `-10%` 懲罰」**：讓低掃/卡夫踢砍腿戰術真正能削弱摔角手的抱摔推進力。
  3. **修正「接踢反摔 (`catchKickTakedown`) 對非踢擊卡基礎機率過高」**：對手出 `.kick` 時基礎成功率 `68%`、出拳 `50%`、不出招僅 `18%`。
  4. **實裝「靈巧搶背 (`backTake`) 跳階直接搶入 `backControl`」與「蹬踏踢開起身 (`upkickStandup`) 脫身附帶下位蹬擊傷害」**。
- **第二階段：實裝三大進階 UFC 擬真系統（commit `4e9b597` + 醫務暫停門檻校準）**：
  1. **🩸 肘擊割傷與流血系統 (`cutSeverity 0...3` + Cutman 止血 + 醫務暫停 `.tkoDoctor`)**：
     - 站立貼身橫肘（`closeElbow`）、迎擊短肘與地面剃刀砸肘（`groundElbows`）命中頭部具備 `25%` 高割傷率（一般重擊 `>= 16` 傷具備 `6%` 割傷率）。
     - 每級 `cutSeverity` 因鮮血遮蔽視線對站立 `.strike` / `.counter` / `.evade` 造成 `-3%` 命中/閃避懲罰；回合間角落 Cutman 自動止血降 `1` 級；當割傷擴大至 `Lv.2` / `Lv.3` 或 `Lv.3` 再遭頭部重擊時，有機率觸發場邊醫務官叫停（`FinishReason.tkoDoctor`）。
  2. **⚡ 籠邊纏抱與泰拳箍頸獨立子狀態 (`FightState.isClinch`)**：
     - 近距離（`.close`）下由箍頸膝撞、貼身肘擊、內圍髒拳或高纏抱/壓籠特質推進進入 `isClinch = true`（若帶 `.cagePinner` 特質同步將對手往籠邊推退一格）。
     - 纏抱狀態下：膝撞（`.knee`）、肘擊（`.elbow`）、內圍髒拳、籠邊推開（`pushOff`）享 `+8% + 纏抱屬性差` 加成；近身絆摔/抱摔享 `+6% + 纏抱差` 加成；長距離踢擊（`.kick`）受空間狹窄 `-8%` 懲罰。
     - 脫離途徑完整且嚴格守恆：`pushOff`、`stepBack`、成功閃避（`.evade`）、進入地面、防摔 Sprawl 成功、被打暈 `isRocked` 或回合結束皆自動解除 `isClinch = false`（`validateInvariants()` 全程嚴格檢查）。
  3. **⚖️ 三位偏好不同的裁判與分歧/多數判定 (`JudgeBias` / `DecisionType` / `JudgeScorecard`)**：
     - 每場比賽由三位偏好不同的場邊裁判獨立以 `10-Point Must` 評分：`Judge 1 (.striking)` 偏重有效打擊傷害/擊暈/割傷（`1.30x` 打擊、`0.60x` 摔柔）、`Judge 2 (.grappling)` 偏重抱摔/過腿/降伏威脅與上位控制（`0.75x` 打擊、`1.45x` 摔柔）、`Judge 3 (.balanced)` 均衡評分（`1.00x`）。
     - 打滿三回合自動結算三張計分卡，真實呈現 **一致判定 (`Unanimous Decision 3-0`)**、**分歧判定 (`Split Decision 2-1`)** 與 **多數判定 (`Majority Decision 2-0-1`)**！
  4. 新增專屬測試套件 `RealismFeaturesTests.swift`（總測試數達 **59 項測試 / 10 大測試套件**），並更新 iPhone 沙盒 UI（`v0.4.0 (4)`）顯示 `🩸 流血 Lv.X`、`🤼 籠邊纏抱 Clinch` 與三裁判計分卡。

---

## 2026-11-03 · [實作] Gemini 4 Argon (P4-3 20 張牌組、5 張手牌自動翻面與 v0.3.0 完整 MMA 實機沙盒打包)
- 完成 **P4-3 20 張牌組、5 張手牌抽補與進地面自動翻面切換 + iPhone 實機沙盒更新**：
  - 新增 `Packages/OctagonCore/Sources/FightEngine/DeckHand.swift` 與 `DeckHandTests.swift`（共 55 項測試 / 9 大測試套件全過，run `41634265166`）：
    - `DeckBuilder`：依選手流派（打擊手 / 摔角手 / 柔術家）自動生成 20 張出廠預設站立＋抱摔牌組，並驗證同名卡上限 `<= 3`、進攻卡 `>= 6`、格擋閃避卡 `>= 4`、移動卡 `>= 3` 與牌組點數預算。
    - `HandManager`：站立時維持 5 張手牌（出完自動從抽牌堆補滿，抽牌堆用盡自動洗回棄牌堆；處於 `isRocked` 時保底含防守/移動卡）；一旦進入地面或發生位置轉移/掃技翻轉，**自動翻面為 5 張上位或下位地面專屬手牌**（保證涵蓋上/下位全部 4 種戰術意圖），起身後自動翻回站立手牌！
  - 更新 `App/Sources/ContentView.swift` 與 `App/Sources/LungeDemoScene.swift`（版本提升至 `0.3.0 (3)`）：
    - 頂部新增三種跨流派對戰秒切鈕（`🥊打擊 vs 🤼摔角`、`🥋柔術 vs 🤼摔角`、`🤼摔角 vs 🥊打擊`）。
    - 新增 **地面 5 階位置進度條（1.全防守 ～ 5.背控）**、上下位身分標籤、消極計數（`X/3`）與 **2 階段鎖技對決緊迫進度條（Setup → Locked In!）**。
    - 支援「`🃏 5張手牌抽補模式`」與「`📚 全部合法卡牌沙盒模式`」一鍵切換。
    - SpriteKit 畫面支援進地面上下位纏鬥躺姿、地面砸拳（Posture Up & Slam）、掃技翻轉與鎖技脈動演出。
  - 觸發 `build-unsigned-ipa.yml` 雲端打包成功（run `41634266609`），已下載最新未簽名 IPA 至 `dist/OctagonCards-unsigned-ipa/OctagonCards-unsigned.ipa`。
- **P0、P2、P3、P4 全數完成！** 下一棒可進入 **P1 資料管線（ufcstats 爬蟲 + 真實賽事表現動態升降 + 本機像素化）** 或 **ART-1 美術規範與第一批特效生圖**。

---

## 2026-11-03 · [實作] Gemini 4 Argon (P3-1 ~ P3-4 完整地面戰引擎與 P4-2 30 張抱摔/地面卡牌庫)
- 完成 **P3-1 地面位置階層與站立抱摔橋樑**（`GroundPosition.swift`、`GroundPositionTests.swift`）：
  - 定義 5 大地面位置階層（`fullGuard` 全防守 → `halfGuard` 半防守 → `sideControl` 側控 → `fullMount` 騎乘 → `backControl` 背控）、上下位角色（`GroundRole`）與 `TakedownEngine.breakdown`（支援 `takedown` vs `takedownDefense`、近距離/籠邊/對手腿傷加成、下壓防摔 `Sprawl`、迎擊飛膝 `interceptKnee` 與順勢拉斷頭台 `jumpGuillotine`）。
- 完成 **P3-2 上下位 4×4 讀心矩陣與掃技翻轉** & **P3-3 2 階段降伏鎖技對決**（`GroundExchange.swift`、`GroundExchangeTests.swift`）：
  - 資料驅動 4×4 上下位機率表（`GroundOdds.topBaseTable` / `bottomBaseTable`）：上位 `Advance` / `GnP` / `Submission` / `Smother` vs 下位 `Frame` / `Escape` / `SweepOrSub` / `Shell`，所有機率嚴格經過 `Odds.resolve`（`5%–95%`）。
  - 實作 **Khabib 式重壓完封起身**（`.smother` vs `.escape` 抽乾下位 11 點體力並回體）、**Oliveira 式抓砸拳大逆轉**（下位 `.sweepOrSub` 抓上位 `.gnp` 撐高瞬間，觸發蝴蝶掃翻轉上下位或直接鎖入下位三角絞/十字固），以及 **連續 3 次消極裁判強制分開（Referee Stand Up）**。
  - 實作 **2 階段降伏鎖技系統**（`SubmissionHold`：`Setup` 抓把位 → `LockedIn` 深鎖 → `.submission` 拍墊投降），納入第 1 回合乾澀加成、第 3 回合流汗滑脫（關節技 `-6%`）與低體力絞技加成（對手體力 `<35` 時絞技 `+10%`）。
- 完成 **P4-2 抱摔與地面卡牌庫（30 張，`SampleData.grapplingAndGroundCards`）**：
  - 8 張站立抱摔/防摔反制卡 + 10 張上位推進/重壓/砸拳卡 + 6 張核心降伏卡（RNC、斷頭台、肩固/達斯絞、木村鎖、三角絞、十字固）+ 6 張下位防禦/蝦行/扶籠起身/蝴蝶掃卡；全庫合計 **58 張 MMA 卡牌（`SampleData.allCards`）**。
- 完成 **P3-4 綜合 MMA 模擬器（26,666 場 / 559,305 次交手 `0 違規`）**（CI run `41632824319`，53 tests in 8 suites 全過）：
  - **打擊手 vs 摔角手（10,000 場 StyleAI）**：勝率從純站立時的 `84% vs 16%` 逆轉為 **46.3% 打擊手 vs 46.2% 摔角手（五五開！）**，場均抱摔 `1.49` 次、地面佔比 `26.4%`、KO/TKO `31.5%`、降伏 `7.4%`、判定 `61.1%`。
  - **摔角手 vs 柔術家（3,333 場 StyleAI）**：**柔術家 52.2% vs 摔角手 40.7%**（地面佔比 `30.3%`、降伏率 `19.8%`、掃技翻轉 `946` 次），完美呈現柔術家在下位反制摔角手。
  - **柔術家 vs 打擊手（3,333 場 StyleAI）**：**打擊手 51.5% vs 柔術家 44.0%**（地面佔比降至 `16.3%`、KO/TKO 率 `36.5%`），打擊手靠防摔將比賽留在站立擊敗柔術家，形成完整 **「摔角手 ⇄ 打擊手 ⇄ 柔術家」三角相剋**！
- 下一棒：P4-3（20 張牌組、5 張手牌抽補與進地面自動翻面切換 + iPhone 實機沙盒更新與打包 IPA）

---

## 2026-11-03 · [實作] Gemini 4 Argon (P4-1 站立核心卡牌庫擴充 28 張)
- 完成 **P4-1 站立核心卡牌庫擴充（共 28 張，`SampleData.standingCards`）**：
  - 進攻 `strike`（16 張）：刺拳、前踢、小腿卡夫踢、低掃、側踹、超人拳、高踢、直拳、左鉤拳、上鉤拳、過肩重拳、肝臟鉤拳、中段掃踢、貼身橫肘、箍頸膝撞、內圍髒拳
  - 格擋 `block`（2 張）：抱頭格擋（中/近）、提脛擋踢（遠/中）
  - 閃避 `evade`（2 張）：側閃（遠/中）、搖閃潛避（中/近）
  - 反擊 `counter`（3 張）：接踢反擊直拳（遠/中）、反擊鉤拳（中）、迎擊短肘（近）
  - 佯攻 `feint`（2 張）：假動作（遠/中）、虛晃換位（中/近）
  - 移動 `move`（3 張）：前進逼近（`preferredDistance: .close`）、滑步後撤（`preferredDistance: .long`）、推開脫離（`preferredDistance: .mid`）
- 修改 `Card.swift` 與 `Exchange.swift`：新增 `preferredDistance` 讓前進卡與後撤卡能精準往目標距離推進/拉開
- 修改 `Simulation.swift` 與 `App/Sources/ContentView.swift`：預設使用完整 28 張站立牌庫，並在 iPhone UI 加入「只看適用距離 / 顯示全部 (28)」快速篩選鈕
- 測試結果：CI 單元測試（34 tests）與 28 張卡 20,000 場模擬器 **全數通過**（run `41629406277`，430,810 次交手 `0 違規`）：
  - `StyleAI vs StyleAI`：總終結率 `46.8%`（**頭部 KO `42.3%`、身體肝擊/膝撞 TKO `2.8%`、低掃/卡夫踢腿部 TKO `1.7%`**）、判定率 `53.2%`、場均 Rocked `1.89` 次、打擊命中率 `46.7%`！擴充前踢/中段踢/箍頸膝撞與卡夫踢後，身體與腿部 TKO 自然落入真實 UFC 的 ~2%–3% 黃金區間！
- 下一棒：P3-1 地面位置階層與站立抱摔橋樑（或 P4-2 抱摔與地面卡牌庫）

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
