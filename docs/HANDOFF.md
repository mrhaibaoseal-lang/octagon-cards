# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（M1.2 站立深化，進行中）
- **做了什麼**：① 比賽長度：一般賽 3×10（生命 190）、主賽 5×8（生命 250），選角頁可選；單手傷害不變、生命加厚，體力、氣勢、判分一起調慢，回合間割傷收口 1 級。
- **驗證**：引擎測試 22 項通過；模擬（1000 場）看意圖並控制投入 81%（一般）／86%（主賽）、亂出 34%、單一打法最高 14%；AI 互打約 25 手、判定率約 40–60%、醫生叫停 2–9%。844×390 看過選角、對局、角落畫面。
- **要使用者確認**：一場實際要多久（目前估每手 35 秒左右 → 一般賽約 15 分鐘）。

## 2026-11-08 · Claude Sonnet 5.5（角色生成區：Gemini 姿勢表放進遊戲）
- **做了什麼**：McGregor 換上抱摔修好、裝備無字的版本（AI 畫 UFC 字樣會鏡像或亂碼，已寫進 `ART_SPEC.md`）。Khabib 換掉占位圖；新增 Jones、Adesanya、Makhachev、Holloway（姿勢表轉換、頭像、屬性、牌組、招牌牌，**數值是我手訂，未調平衡**）。選角頭像改用官網去背照像素化（`pipeline/portrait.py`），五位都換了。`private/jones/` 原本的 PixelLab 版已被 Gemini 版覆蓋。
- **驗證**：引擎測試 22 項通過、模擬門檻通過；844×390 看過選角（四位新選手都在）、Jones 對 Makhachev 開局與出拳，主控台無錯誤。其他姿勢只看過轉換後的六姿勢預覽頁。Holloway 原牌組沒有摔抱牌，測試擋下，已補一張單腿抓摔。
- **要使用者確認**：新五位像不像；平衡（AI 互打 Makhachev 對打擊型只約 25–30%，Adesanya 偏強）留給 M1.3。**下一步**：Oliveira、Pereira 還沒有姿勢表。

## 2026-11-08 · Claude Sonnet 5.5（PixelLab 第一批：256 文字版＋嚴格比對照片）
- **最終決定（用戶，2026-11-08）：退回 Gemini 姿勢表做法**（PixelLab 文字版約 80% 不像本人；Sprite Fusion、Pixler 等也只看過文件，沒實測）。PixelLab 只留作姿勢動畫備案。以下是中途紀錄：
- **決定**：用戶要求像本人、不要 Q 版 → 全走 256 文字版（照片 pro 128 會大頭 Q 版、畫風不一致，已否決）。提示詞由 `pipeline/pl_fighters.py` 依官方全身照填的特徵產生（30 位資料都在裡面）；轉檔 `pipeline/pl_convert.py`。圖在 `private/<id>/`。
- **已做 8 位**：Ngannou、Merab（用戶看過 OK）；Aspinall、Chimaev、Jones、Topuria、Volkanovski、Pereira（我自查，**用戶尚未判斷**）。O'Malley 重生 4 次（髮型與臉仍是動漫風）**不及格，卡關**。累計本任務 263 次，剩 1579。
- **要點**：提示詞須有「about 8 heads tall, small head, NOT chibi」；受擊不能併進八格動畫（碎成雜點），另跑 3 格 hit3b 且不能寫 punched；Jones 出拳有白色閃光、Aspinall 出拳拳頭模糊、手套偶有小標記。
- **已清理（用戶要求）**：PixelLab 帳號的 29 個角色全刪（圖庫 3 張工具刪不掉，需用戶自己刪）；本機 `private/` 的 PixelLab 圖、對照圖與 manifest 對應項也全刪，只留 Gemini 版與官方照。
- **下一步**：依 `docs/ART_SPEC.md` 的 Gemini 姿勢表做法，由用戶生圖、我轉檔；`pipeline/pl_fighters.py` 的外觀特徵表可改寫成 Gemini 提示詞用。外觀特徵表可直接沿用。
