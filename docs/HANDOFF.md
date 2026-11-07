# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（M1.2 站立深化，進行中）
- **做了什麼**：① 比賽長度：一般賽 3×10（生命 190）、主賽 5×8（生命 250），選角頁可選；單手傷害不變、生命加厚，體力、氣勢、判分一起調慢，回合間割傷收口 1 級。② 跨手佈局：刺拳→開路、打身體→吃重、纏抱→貼身、假動作→對手被騙（傾向更集中）、腿傷→步法多耗 1 能；牌面標「鋪路／可接」。**新資料放 `rules/depth.json`**（疊在 cards／fighters 上，引擎 `loadData` 合併），因為 `cards.json`、`fighters.json` 有角色生成區未 commit 的新選手，我沒碰；之後新增選手若要有專屬機制、換假動作，到 depth.json 加一筆。
- **驗證**：引擎測試 27 項通過；模擬 1000 場看意圖並控制投入 79%（一般）、亂出 32%、單一打法最高 17%；AI 互打約 26 手、判定 45–60%。844×390 看過選角（含賽制切換）、對局、可接標記、腿傷標籤、命中後標籤出現。
- **要使用者確認**：一場實際要多久；標記觸發頻率（約每人每場 3 次，可能偏少）。

## 2026-11-08 · Claude Sonnet 5.5（角色生成區：Gemini 姿勢表放進遊戲）
- **做了什麼**：Gemini 姿勢表共 15 位放進遊戲：McGregor（抱摔已修、裝備無字；AI 畫 UFC 字樣會鏡像或亂碼，見 `ART_SPEC.md`）、Khabib、Oliveira（換掉占位圖）、Jones、Adesanya、Makhachev（新版）、Holloway、Poirier、Pereira、Topuria、O'Malley、Chimaev、Gaethje（**高踢朝左，我把那格鏡像並改錨點**）。後九位新增屬性、牌組、招牌牌，**數值是我手訂，未調平衡**。選角頭像改官網去背照像素化（`pipeline/portrait.py`）。
- **驗證**：引擎測試 22 項通過、模擬門檻通過；844×390 看過選角（15 位都在、無占位圖標記）、Gaethje 對 Khabib 開局，15 位各 7 張圖都載入，主控台只有隱藏的測試選手 `neutral` 的 404。六姿勢預覽頁看過全部。Holloway 牌組曾缺摔抱牌，已補單腿抓摔。另一個 session 的「PixelLab 清理」刪了 `private/jones/` 並清掉 manifest 的 Khabib、Jones、Adesanya、Holloway 條目，我已從原表重轉補回。
- **要使用者確認**：新選手像不像（Pereira 官網照片有頭髮，姿勢表是光頭）；平衡（AI 互打 Makhachev、Chimaev、Gaethje 對多數人 25–35%，Topuria、Pereira、Adesanya 偏強）留給 M1.3。若 M1.2 要給新選手專屬機制，加在 `rules/depth.json`。

## 2026-11-08 · Claude Sonnet 5.5（PixelLab 第一批：256 文字版＋嚴格比對照片）
- **最終決定（用戶，2026-11-08）：退回 Gemini 姿勢表做法**（PixelLab 文字版約 80% 不像本人；Sprite Fusion、Pixler 等也只看過文件，沒實測）。PixelLab 只留作姿勢動畫備案。以下是中途紀錄：
- **決定**：用戶要求像本人、不要 Q 版 → 全走 256 文字版（照片 pro 128 會大頭 Q 版、畫風不一致，已否決）。提示詞由 `pipeline/pl_fighters.py` 依官方全身照填的特徵產生（30 位資料都在裡面）；轉檔 `pipeline/pl_convert.py`。圖在 `private/<id>/`。
- **已做 8 位**：Ngannou、Merab（用戶看過 OK）；Aspinall、Chimaev、Jones、Topuria、Volkanovski、Pereira（我自查，**用戶尚未判斷**）。O'Malley 重生 4 次（髮型與臉仍是動漫風）**不及格，卡關**。累計本任務 263 次，剩 1579。
- **要點**：提示詞須有「about 8 heads tall, small head, NOT chibi」；受擊不能併進八格動畫（碎成雜點），另跑 3 格 hit3b 且不能寫 punched；Jones 出拳有白色閃光、Aspinall 出拳拳頭模糊、手套偶有小標記。
- **已清理（用戶要求）**：PixelLab 帳號的 29 個角色全刪（圖庫 3 張工具刪不掉，需用戶自己刪）；本機 `private/` 的 PixelLab 圖、對照圖與 manifest 對應項也全刪，只留 Gemini 版與官方照。
- **下一步**：依 `docs/ART_SPEC.md` 的 Gemini 姿勢表做法，由用戶生圖、我轉檔；`pipeline/pl_fighters.py` 的外觀特徵表可改寫成 Gemini 提示詞用。外觀特徵表可直接沿用。
