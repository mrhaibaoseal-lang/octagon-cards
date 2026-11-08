# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-09 · Claude Sonnet 5.5（戰鬥改成卡牌構築玩法）
- **做了什麼**：使用者說現在速度太重要、慢招沒用、地面太複雜，要改成殺戮尖塔式；討論定案後重寫規格並做最小原型：站立／地面兩個獨立牌組、能量與距離限制、回合中不重洗（B 做法）、輪流先手且後手計畫公開、三位選手；舊程式留在 tag `m14-archive`，舊規格在 `docs/archive/GAME_DESIGN_M14.md`。
- **驗證**：`node prototype/web/deck/test.js` 20 項、舊 `test/engine.test.js` 63 項全過；`deck/sim.js 200`：McGregor／Khabib 60/39、Khabib／Oliveira 52/48、McGregor／Oliveira 90/11（不平衡）；844×390 在瀏覽器打過排計畫、當場出牌、抱摔進地面、整場亂點到結束，無錯誤。
- **要使用者確認**：開 `prototype/web/deck.html` 打幾場，看「輪流先手、後手計畫公開」好不好玩、距離與地面獨立牌組直不直覺。
- **下一步**：依試玩調手感與牌；好玩再擴到其餘 12 位與第 2 層衝冠短跑。注意：這次也順手提交了 Gemini 未提交的 `docs/TASKS.md`、`docs/HANDOFF.md` 修改。

## 2026-11-08 · Gemini 3.8 Flash（全 15 位角色精靈圖正式接進 stage.js 實機運作）
- **做了什麼**：依指令將 15 位角色 3D 渲染像素素材（idle/punch/kick/hit）導出並更新 manifest.json，正式整合入 prototype/web/stage.js。
- **驗證**：在 http://localhost:5173/ 實際啟動遊戲，完成 844×390 實機截圖（Pereira vs Adesanya、O'Malley vs Sandhagen、Topuria vs McGregor 之選角對峙與開打對決）。
- **要使用者確認**：檢視 ingame_showcase_review.md 的遊戲實機畫面，或直接開啟 http://localhost:5173/ 親自試玩。
- **下一步**：依使用者試玩回饋進行動作幀或地面步驟演出微調；戰鬥面等使用者回饋 M1.4b 地面規則。

## 2026-11-08 · Gemini 3.8 Flash（中止 Scheme C 全員改動、全面還原原本比例）
- **做了什麼**：使用者檢視 Sandhagen 實機像素立繪對比後指出新版偏怪、決定保留原本比例；立即取消批次工作，git checkout 還原 base_body.py 與 body_presets.json。
- **驗證**：終止 task-544，以原始參數復原 Sandhagen 驗證通過，現正執行 
estore_all.py（Task 600）將其餘被改動角色 100% 還原為原始骨架。
- **要使用者確認**：確認放棄 Scheme C 全員縮窄方案、維持原本各量級經典打擊體態。
- **下一步**：復原完成後，重新產出原本全角色對照圖供留存；戰鬥進度交還使用者試玩 M1.4a 與 M1.4b。
