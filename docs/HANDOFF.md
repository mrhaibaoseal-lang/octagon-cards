# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（M1.2 站立深化，五項完成）
- **做了什麼**：① 比賽長度：一般賽 3×10（生命 190）、主賽 5×8（生命 250），選角頁可選，體力、氣勢、判分一起調慢。② 跨手佈局：開路／吃重／貼身／被看穿標記、腿傷步法多耗 1 能，牌面標「鋪路／可接」。③ 籠邊（被逼兩次，不能後退、被摔 +12%、脫離牌）、回合最後一手 +1 能量分數 ×1.5、摔倒後選追或放。④ 15 位選手各一個能力。⑤ AI 每回合戰術（試探／壓迫抱摔／搶分／拼 KO），開賽前與角落時間你也選。**新資料都在 `rules/depth.json`**（`cards.json`、`fighters.json` 沒動；新增選手到 depth.json 補能力與戰術口味）。
- **驗證**：引擎測試 37 項通過；模擬 2000 場看意圖並控制投入 83%（一般）／86%（主賽）、亂出 33%、單一打法最高 22%；AI 互打約 25 手、判定 25–55%（Holloway 對 McGregor 這類打擊對打 KO 偏多）。844×390 看過選角、標記、籠邊、摔倒選擇、戰術選擇與回合提示、角落畫面、整場打完，主控台無錯誤。**沒親眼看過**：連續打滿主賽 5 回合、各選手能力的特效（只在引擎測試確認觸發）。
- **要使用者確認**：一場實際多久；標記、籠邊、能力出現得夠不夠頻繁、是否煩；AI 互打平均勝率 39–62%（Khabib、Makhachev、Chimaev 約 40%）留給 M1.4。

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
