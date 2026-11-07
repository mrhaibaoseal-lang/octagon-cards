# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（PixelLab 第一批：256 文字版＋嚴格比對照片）
- **決定**：用戶要求像本人、不要 Q 版 → 全走 256 文字版（照片 pro 128 會大頭 Q 版、畫風不一致，已否決）。提示詞由 `pipeline/pl_fighters.py` 依官方全身照填的特徵產生（30 位資料都在裡面）；轉檔 `pipeline/pl_convert.py`。圖在 `private/<id>/`。
- **已做 8 位**：Ngannou、Merab（用戶看過 OK）；Aspinall、Chimaev、Jones、Topuria、Volkanovski、Pereira（我自查，**用戶尚未判斷**）。O'Malley 重生 4 次（髮型與臉仍是動漫風）**不及格，卡關**。累計本任務 263 次，剩 1579。
- **要點**：提示詞須有「about 8 heads tall, small head, NOT chibi」；受擊不能併進八格動畫（碎成雜點），另跑 3 格 hit3b 且不能寫 punched；Jones 出拳有白色閃光、Aspinall 出拳拳頭模糊、手套偶有小標記。
- **下一步**：用戶判斷這 6 位像不像 → 通過才批量其餘 22 位（約 14 次／人）；O'Malley 要換做法或先排後；遊戲內每人縮放倍數要先問用戶。

## 2026-11-07 · Claude Sonnet 5.5 → Opus 5.5（PixelLab 測試：Hooker）
- **做了什麼**：試了五種做法，圖都在 `prototype/web/assets/private/hooker_pl*/`（gitignore，Gemini 版 `hooker/` 沒動），對照頁 `assets/private/compare_hooker.html`，累計 123/2000。姿勢一律用 skeleton-v3 自寫 8 格（3 次，一格一個姿勢，含過渡格才不糊；倒地要水平鏡像）。
- **最穩：全身官方照＋pro 128＋提示詞開頭寫「realistic adult proportions, about 8 heads tall, small head, NOT chibi」**（`hooker_pl128r/`，28 次）：比例寫實、刺青位置對、無字，六格乾淨。提示詞開頭寫「Pixel art fighting game character」會變 Q 版（`hooker_pl128/`）。全身照：`_source/hooker_fullbody_ufc.png`，選手頁 og 圖網址去掉 `styles/athlete_bio_full_body/s3/`。
- **最好看：純文字 v3 256**（`hooker_pl256/`，15 次）：細節最好但刺青是泛用圖騰、手套有字樣；約 230px 高，遊戲要加每人縮放。照片轉像素 168（`hooker_pl168/`，7 次）比例對但糊。純文字 v3 128 詳細描述（3 次，沒做姿勢）：大頭卡通、長亂髮、藍護腕，不像本人；文字版要 256 才寫實。全身照 pro 112（`hooker_pl112/`，18 次）：頭稍大、受擊那格臉碎掉，不如 128。256 文字＋照全身照寫刺青（`hooker_pl256t/`，12 次）：骷髏、肚字、小腿出現，手臂只半袖、手套仍有小標記；受擊改頭後仰 15°～18°、3 格（2 次）重做後乾淨，已換上。所有版本**高踢只到腰**（骨架限制）。
- **估算**：名單改為 **300 人**（使用者決定，已改 `RULES.md`、`ART_SPEC.md`、`TASKS.md`）。256 文字一人約 12–16 次 → 300 人一輪約 3600–4800、含重生 2 輪約 1.1 萬（每月 2000，約 2–6 個月）；128 照片一人約 28 次 → 一輪約 8400、三輪約 2.5 萬（約 4–13 個月）。**要使用者判斷**像不像、選哪條；地面姿勢沒做。官方照商用條款未確認，只內部測試。

## 2026-11-07 · Claude Sonnet 5.5（角色生成區：McGregor 抱摔修好）
- **做了什麼**：換上使用者重生、抱摔已修好（兩隻手、兩手手套一致）的 McGregor 表，重裁頭像。試過在手套、腰帶加 UFC 字樣，AI 畫字會鏡像或亂碼，決定裝備上全無字（寫進 `docs/ART_SPEC.md`）。選角頭像改用官網去背照像素化（`pipeline/portrait.py`），五位都換了，Oliveira 也有頭像了。
- **驗證**：轉換切出 6 個人、無殘綠；引擎測試 22 項通過；844×390 看過 McGregor 選角頭像、待機與出拳中段。受擊、高踢、抱摔、倒地沒在遊戲裡逐一看，只看過轉換後的六姿勢拼圖。
- **要使用者確認**：新版 McGregor 像不像、下一位選手（Khabib、Oliveira、Pereira 還沒做）。倒地圖頭已在右邊，轉換不加 `--flip-down`。
