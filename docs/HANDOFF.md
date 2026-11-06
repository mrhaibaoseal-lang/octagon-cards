# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-07 · Claude Opus 5.5（M0 整理、M1 戰鬥原型）
- **做了什麼**：使用者核准全專案重做方向（`docs/GAME_DESIGN.md`、`docs/TASKS.md`）。舊狀態打 tag `legacy-v0.6.1`，舊文件移到 `docs/archive/`，改寫 `RULES.md`、`AGENTS.md`。新增 `prototype/web/`：三角相剋戰鬥、對手傾向、能量投入、地面、鎖技、招牌技、角落時間、三裁判；新增 `pipeline/sprite_sheet.py` 與 `docs/ART_SPEC.md`。
- **驗證**：引擎測試 12 項通過；模擬（3000 場）看意圖 76%、亂出 36%、單一打法最高 13%；瀏覽器 844×390 走過選角、出牌、演出、地面、鎖技、角落、KO、結算，主控台無錯誤。**沒有在真手機上跑過，也沒有人實際玩過。**
- **已知**：Khabib、Oliveira 是 McGregor 姿勢的單色占位圖；地面姿勢是抱摔疊倒地；AI 互打 McGregor 偏強（約 60–68%），Khabib 對 Oliveira 約 80% 判定；三裁判計分和傷害數值都還沒憑手感調過。
- **要使用者確認**：① 玩 5 場以上，有沒有想再開一局、三位選手感覺不同嗎；② 依 `docs/ART_SPEC.md` 生第一批 5 位；③ 兩條舊分支與 worktree 能否刪除（已用 `archive/*` tag 保留）。
- **下一步**：依使用者試玩回饋改規則。通過後先移植 iOS（新 M3，使用者要求最原生，順序已提前），衝冠短跑改為 M4、直接用 Swift 做。
