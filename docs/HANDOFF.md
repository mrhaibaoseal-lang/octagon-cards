# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Opus 5.5（開工文件瘦身）
- **做了什麼**：鐵則重點併進自動載入的 `AGENTS.md`；新增 `node docs/brief.js` 只印 TASKS「目前」＋ HANDOFF 最新一筆；TASKS 已完成細項與 M1.1～M1.3 規格搬到 `docs/archive/TASKS_ARCHIVE.md`；GAME_DESIGN 改成按章節讀。
- **驗證**：開工要讀的量從約 45KB 降到約 2KB（brief 1.6KB）；未改程式碼與規則。
- **要使用者確認**：無。
- **下一步**：同上一筆，等使用者試玩選角頁或點頭開工 M1.4。

## 2026-11-08 · Gemini 4 Argon (High)（重製選角介面：八角籠實景對峙＋底部 15 人街機頭像盤）
- **做了什麼**：依使用者選定的「範例 A」重製 `prototype/web/` 選角頁：中央透出八角籠舞台讓雙方選手以真實身高體重比例近距對峙（換人時即時出招預覽、標示同量級／跨量級體格差）；左右面板呈現選手定位、專屬能力、招牌技效果與 7 項屬性高亮比較；底部改為 15 人單排免捲動街機頭像盤（左鍵換當前目標、右鍵直接換對手），頂部整合量級篩選（全部／135／145／155／185+）、雙方互換與隨機對手。
- **驗證**：`node prototype/web/test/engine.test.js` 52 項全過；844×390 瀏覽器實際截圖檢查同量級（McGregor vs Khabib）與跨量級長文字（Holloway vs Makhachev）排版無裁切溢位。
- **要使用者確認**：新版選角介面操作手感與視覺是否順手；M1.4 戰鬥重構是否開工。
- **下一步**：等使用者試玩選角頁或點頭開工 M1.4。

## 2026-11-08 · Gemini 4 Argon (High)（依真實身高與體重調整全部角色大小）
- **做了什麼**：在 `rules/fighters.json` 為 15 位選手補上真實身高（170～193cm）與量級體重（135～215lb），並在選角頁顯示；`stage.js` 載入精靈圖時自動量測頭骨頂至腳底高度（排除 O'Malley 爆炸頭虛高）與腰寬比例，消除 Gemini 各表鏡頭遠近差異並依真實身高與 BMI 縮放角色與陰影（如 170cm/145lb 的 Topuria 從 116×198px 縮為 91×168px，193cm/205lb 的 Pereira 為 124×209px）。
- **驗證**：`node prototype/web/test/engine.test.js` 52 項全過；844×390 瀏覽器實際截圖確認選角頁、Topuria vs Pereira、Topuria vs Holloway、O'Malley vs Jones 比例自然且不擋 HUD。
- **要使用者確認**：各量級選手在場上的身高差與寬厚感是否順眼；M1.4 戰鬥重構是否開工。
- **下一步**：等使用者確認體型比例或點頭開工 M1.4。

