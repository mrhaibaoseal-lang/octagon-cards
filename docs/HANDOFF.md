# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（其餘 12 位選手走完 3D 像素流程）
- **做了什麼**：khabib、oliveira、hooker、sandhagen、jones、adesanya、holloway、poirier、pereira、omalley、chimaev、gaethje 各自白模（量級預設＋`--bulk`）、Gemini 身體與頭、貼回、4 動作像素 GIF 與 storyboard；`paint_skin.py` 加 12 人外觀。
- **驗證**：生圖共 30 張約 NT$150（重畫：oliveira 身體、sandhagen 身體、adesanya 身體與頭、omalley 身體與頭）；可用 10 位，對位 0.83～0.95；Oliveira 身體兩次都手臂垂下（0.54）不可用；O'Malley 身體 0.68～0.73 有小腿補色殘影；Chimaev 3/4 手部有暗色殘影。
- **要使用者確認**：Oliveira 是否再畫身體一次；O'Malley 能否接受或削瘦白模重畫；Khabib 斜方肌像領子要不要降 bulk。
- **下一步**：精靈圖接上 `stage.js`；Topuria 換新白模重做；地面雙人姿勢。

## 2026-11-08 · Claude Sonnet 5.5 → Opus 5.5（McGregor、Makhachev、畫風 A、量級白模）
- **做了什麼**：McGregor、Makhachev 走完 `pipeline/model3d/` 流程；`paint_skin` 加頭像備援、灰背景轉綠、全身入鏡提示；`bake_skin` 切開相連人物；`base_body` 加 `--bulk` 肌肉目標與 `--preset`（`body_presets.json`，9 個量級，重量級分壯碩／有肚子）；像素預設改 A（64 px/m、32 色）。
- **驗證**：兩人身體對位 0.81～0.86、頭部 0.85～0.94，8 角度無破洞；生圖 6 張約 NT$30（兩人第一張身體皮膚不能用，各重畫一次）。
- **要使用者確認**：9 個量級白模的對照圖（尤其重量級有肚子版）；壯度 0.6 加 A 的觀感。
- **下一步**：Topuria 換新白模重做；精靈圖接上 `stage.js`；地面雙人姿勢。

## 2026-11-08 · Claude Opus 5.5（美術重構：共用 3D 骨架 → 像素精靈圖）
- **做了什麼**：`pipeline/model3d/` 新流程：MPFB 共用身體＋Mixamo 骨架、Gemini（Vertex AI）在白模上畫皮膚並貼回、2D 頭部 6 角度精靈掛在頭骨上、50 個 Mixamo 動作重定向、關鍵姿勢＋殘影閃光頓幀、像素化；RULES／AGENTS／ART_SPEC 美術方向同步改寫。
- **驗證**：Topuria 從 8 個角度與 9 個動作渲染無破洞；使用者看過後說「目前為止離成功最接近的一次」，選定 B＋卡通光影。生圖共 4 張約 NT$20。
- **要使用者確認**：新精靈圖進對戰畫面後的試玩感受；`game.js`、`stage.js` 有他人未 commit 的修改，本次未動也未提交。
- **下一步**：關鍵姿勢精靈圖接上 `stage.js`（844×390）；McGregor 走一次流程；地面雙人姿勢。
