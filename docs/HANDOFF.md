# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（頭身比量測、Oliveira／O'Malley 重畫）
- **做了什麼**：新增 `measure_body.py`／`measure_photo.py`；`base_body.py` 加 `--muscle`、`--head-scale`；Oliveira 用去腰帶的臉部裁切重畫（對位 0.95）；O'Malley 依全身照削瘦白模重畫（0.81）；用 Pereira 做四版頭身比對照（`_model3d/_proportion_test/`）。
- **驗證**：全部白模頭高占身高 13.5%（7.44 頭身）正常，肩寬 0.30～0.33 比真人偏寬 15～25%，脖子偏粗 30%；縮窄版肩 0.276、脖子 0.090。生圖再用 2 張，累計約 32 張。
- **要使用者確認**：看 Pereira 四版對照（A 現況、B 頭×1.12、C 縮身體、D 兩者），選一版；選定後全員重畫身體約 NT$5×15。「黑龍」指哪位選手待確認。
- **下一步**：選定後把縮窄參數寫進 `body_presets.json`，全員重畫；接 `stage.js`。

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
