# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-15 · Claude Opus 5.5（低面數 v2：連續四肢＋照片拼貼質感）
- 照使用者給的 1998 年射擊遊戲保全／白袍角色參考，`build_fighter.py` 重寫成只出灰模：手臂、腿各一條管子（環沿路徑平行移動、不扭），肩膀從上方圓頂長下來，胸肌斜方肌加厚，連指手套加拇指，2,314 三角形。
- `paint_lowpoly.py` 提示詞改成照片拼貼、陰影皺褶畫進貼圖、輕微髒污、對比強偏灰、短褲禁止任何標誌；Gemini 2 次（約 NT$10）。
- 結果 `_lowpoly/paint/g_cmp.png`：明顯比 v1 寫實、像那個年代；看得到的問題：腳和肩頂有一塊沒上到色（淡粉膚色、腳趾黑點），胸口刺青近看是馬賽克，臉偏髒像有瘀青，身材仍偏瘦。
- 使用者看灰模說形狀和 v1 差不多；**等使用者看上色結果**決定走不走這條路。
- 下一步若要：補上未上色的腳與肩頂（多拍上方／下方視角），身體再壯一點。

## 2026-11-15 · Claude Opus 5.5（試低面數半條命風：通用人體＋Gemini 上色）
- 使用者覺得《奧術》路線問題太多修不好，要試「低面數通用模型、1998 年 PC 遊戲（半條命）風」；這和 RULES「不再嘗試：復古低面數」衝突，是使用者明確要試，採用前要改 RULES／ART_SPEC。
- 做了 `pipeline/lowpoly/`：`build_fighter.py` 用程式蓋乾淨的通用人體（1,122 三角形、格鬥架式）；`paint_lowpoly.py` 拍灰模四視角，Gemini 兩次（全身 16:9、頭 2×2，已用掉，約 NT$10）照照片畫成低解析遊戲貼圖，投影回 1024 貼圖、最近點取樣。
- 結果 `_lowpoly/paint/g_cmp.png`：臉、鬍子、刺青、短褲都上了，像本人；直接貼照片的版本（`_lowpoly/lp_cmp.png`）側面全是拉長條紋，不要用。
- 還看得到：手腳是一節節直筒、關節有折線，肩膀方塊；短褲上 Gemini 還是畫了小標誌；後腦一條接縫；胸口刺青近看很糊（遠看可以）。
- **等使用者看**：要不要走這條路。下一步若要：身體形狀做得更像人（肩、肘、膝的過渡），再換一位選手照跑看要多久。

## 2026-11-15 · Claude Fable 5.2（40 位的做法：先看灰模、臉不磨）
- 使用者問 40 位要不要換方法：Topuria 最符合想像，O'Malley 難在頭髮。決定畫風不變，先改兩個流程預設。
- 做了：`gemini_paint.py` 沒有 `--shape-ok` 就不呼叫 Gemini，只出灰模 `clay_<mesh>.png`；`smooth_head.py` 臉中段不磨，頭髮遮罩蓋到臉中段超過 10% 就停（`--force` 可強制）；`exaggerate_head.py --jaw` 預設改 1.0。
- 驗證：Topuria 遮罩 1.5%、照常輸出（遮罩只差 7 點）；O'Malley 實心頭 19% 被擋下、沒存檔；`gemini_paint` 不加 `--shape-ok` 停在灰模，`painted.png` 沒動、沒用額度。只有兩位選手的數字。
- 還沒做：頭髮改成獨立髮型零件（等下一位難髮型選手再試）、身體共用體型範本。
- 第三位：使用者選 Volkanovski。沒有 `_ufc.png` 也不在 `paint_skin.FIGHTERS`，只有全身照；裁頭（`inputs/volkanovski_photo.png`，(440,0,1120,455)，避開肩上的腰帶）直接跑 TRELLIS（免費，270 秒，要設 `HF_HOME=D:/img2_3d/hf`）→ 灰模 `_img2_3d/clay_volkanovski_photo_fix.png`：光頭、鬍子、鼻子、耳朵像本人。
- 使用者看第一版灰模：形狀完全不對（側面臉凸又長像馬、下巴凹洞）。原因是裁太緊沒脖子肩膀；第二版留脖子肩膀、擦掉腰帶重跑 → `clay_volkanovski_photo2_fix.png`，側面正常很多、下巴沒洞，**等使用者看**。
- 使用者說第二版可以、要加自動轉正：試了兩種算法都不行（細節在 `pipeline/img2_3d/README.md` 最後一節），腳本沒留。問題不是頭轉了角度，是微側臉照片生出的頭本身扭曲；`smooth_head` 的比例也只認 Gemini 頭像的取景。
- 結論：照片路線不能當預設，Volkanovski 要走 `gen_head.py`（Gemini 正面頭像，同 Topuria）。先要在 `paint_skin.FIGHTERS` 加他（那個檔有 Gemini 未 commit 的修改，動之前先問）並準備 `_source/volkanovski_ufc.png`。
- 使用者同意後用掉最後 1 次 Gemini 畫正面頭像：照原流程不改程式約 5 分鐘到灰模 `_img2_3d/clay_volkanovski_smooth.png`，正面對稱、守門通過（2.2%）；髮根和鬍子表面還是一粒粒。
- 使用者看灰模：「應該可以試試看」。已做 `exaggerate_head --brow 0.007 --chin 0.005` → `volkanovski_arcane.glb`；`gemini_paint.py` 加 `--name`（不用改 `paint_skin.FIGHTERS`）和 Volkanovski 的 `HAIR`；四視角綠底圖已出（`paint/volkanovski_arcane/grid.png`），沒呼叫 Gemini。
- 使用者同意超出額度再用 1 次：頭已上色、去綠邊 → `trellis2/volkanovski_arcane_paint_ar_ng.glb`，轉圈圖 `_img2_3d/volk_paint_turn.png`（一般光，不是三階卡通光）：五官、鬍子、髮根陰影都畫上了；頭皮表面一粒粒的凹凸還在，額頭髮際和太陽穴有幾塊淺色。**等使用者看**。
- 使用者：效果比想的好，可以修。`smooth_head.py` 加 `--scalp`（光頭用，依位置圈頭皮磨掉髮根顆粒）→ `trellis2/volkanovski_final.glb`、`_img2_3d/volk_final_turn.png`：頭頂和後腦平了，鬍子沒動；耳朵後上方還有少量顆粒，髮際和太陽穴的淺色塊（貼圖）沒修。Topuria 不加 `--scalp` 輸出不變。
- 使用者看了說：鬍子側面有膚色坑洞、鼻子被切掉。鼻子是轉圈圖格子太窄裁到鼻尖，放大圖 `_img2_3d/volk_final_profiles.png` 鼻子完整。鬍子的坑是真的：新 `fill_pits.py`（依表面鄰居把深色區裡偏亮的貼圖點補成鬍子色，補了 72,776 點）→ 重做 `volkanovski_final.glb`。**只改善一部分**：側面少了，3/4 角度下緣還看得到幾顆淺色點，鬍子表面仍一粒粒。
- 使用者：完全沒效果，鬍子坑洞還是很嚴重。又試三次都沒解決：(1) `fill_pits` 放寬（`--dark 120 --gap 22`）＋上色後磨鬍子 → 太陽穴、耳旁多出深色斑；(2) 先磨平形狀（`smooth_head --scalp --hair-iter 60`）再把同一張 `painted.png` 用 `gemini_paint --reuse` 重投影 → `trellis2/volkanovski_s2_paint_ar_ng.glb`、`_img2_3d/volk_s2_views.png`：正面乾淨，3/4 與側面鬍子的淺色點原封不動；(3) 在它上面再跑 `fill_pits --dark 130 --gap 40 --k 96` → 淺點還是沒變，反而把眼睛塗暗、脖子多一塊深斑（`_fp` 版不要用）。
- **目前最好的是 `volkanovski_s2_paint_ar_ng.glb`**。淺點改貼圖完全沒反應，推測不是貼圖而是鬍子網格上的小破洞、看到裡面的面（**還沒驗證**）。
- 下一步（新 session）：先驗證破洞（數邊界邊、或開背面剔除渲染看淺點會不會變黑）；是的話在上色前把鬍子區補洞或體素重建（`solid_head` 的做法）再重投影。之後才是身體（要 Gemini，先問）。
