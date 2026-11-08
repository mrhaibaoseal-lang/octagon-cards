# 交接紀錄

> 格式見 `AGENTS.md` §1：最新在最上方，每筆約 5 行，只留 3 筆。舊方向的紀錄在 `docs/archive/HANDOFF_LEGACY.md` 與 `HANDOFF_ARCHIVE.md`。

## 2026-11-08 · Claude Sonnet 5.5（頭身比量測、Oliveira／O'Malley 重畫）
- **做了什麼**：新增 `measure_body.py`／`measure_photo.py`；`base_body.py` 加 `--muscle`、`--head-scale`；Oliveira 用去腰帶的臉部裁切重畫（對位 0.95）；O'Malley 依全身照削瘦白模重畫（0.81）；用 Pereira 做四版頭身比對照（`_model3d/_proportion_test/`）。
- **驗證**：全部白模頭高占身高 13.5%（7.44 頭身）正常，肩寬 0.30～0.33 比真人偏寬 15～25%，脖子偏粗 30%；縮窄版肩 0.276、脖子 0.090。生圖再用 2 張，累計約 32 張。
- **要使用者確認**：看 Pereira 四版對照（A 現況、B 頭×1.12、C 縮身體、D 兩者），選一版；選定後全員重畫身體約 NT$5×15。「黑龍」指哪位選手待確認。
- **下一步**：選定後把縮窄參數寫進 `body_presets.json`，全員重畫；接 `stage.js`。

## 2026-11-08 · Claude Sonnet 5.5（M1.4a 站立戰鬥重構）
- **做了什麼**：站立改成「走位（壓上／守中線／繞圈／後撤）→ 帶頭排 1～4 張連段 ／ 應對方事先押 → 反應力決定看不看得到慢招」；基本招常駐、牌組只放特殊技；基本規則在 `engine.js` 的新站立段，數值在 `rules/rules.json`（footwork、engage）、`rules/cards.json`、`rules/depth.json`；畫面（走位、連段、應對、看得到的慢招會停下來問）與 `GAME_DESIGN.md` 同步改寫。地面沿用 M1.3。
- **驗證**：`node prototype/web/test/engine.test.js` 50 項全過；`node prototype/web/sim.js 1000 --gate`：單一走位使用率最高 34%（AI）／27%（看意圖），所有單一打法 ≤ 50%，亂出 19%，看意圖 64%（AI 鏡像 47%）；844×390 用瀏覽器打完整場（含地面、鎖技、慢招應對）沒有錯誤。
- **要使用者確認**：玩幾場，看「走位預告」「連段面板」「應對八選一」「慢招停下來問」好不好懂、好不好玩；看意圖門檻我暫改為 60%（舊 75% 是三角相剋的）。
- **下一步**：依使用者回饋調整；通過後做 M1.4b（地面與鎖技）。選手強弱（Adesanya 偏強、Gaethje／Hooker 偏弱）留給 M1.5。

## 2026-11-08 · Claude Sonnet 5.5（其餘 12 位選手走完 3D 像素流程）
- **做了什麼**：khabib、oliveira、hooker、sandhagen、jones、adesanya、holloway、poirier、pereira、omalley、chimaev、gaethje 各自白模（量級預設＋`--bulk`）、Gemini 身體與頭、貼回、4 動作像素 GIF 與 storyboard；`paint_skin.py` 加 12 人外觀。
- **驗證**：生圖共 30 張約 NT$150（重畫：oliveira 身體、sandhagen 身體、adesanya 身體與頭、omalley 身體與頭）；可用 10 位，對位 0.83～0.95；Oliveira 身體兩次都手臂垂下（0.54）不可用；O'Malley 身體 0.68～0.73 有小腿補色殘影；Chimaev 3/4 手部有暗色殘影。
- **要使用者確認**：Oliveira 是否再畫身體一次；O'Malley 能否接受或削瘦白模重畫；Khabib 斜方肌像領子要不要降 bulk。
- **下一步**：精靈圖接上 `stage.js`；Topuria 換新白模重做；地面雙人姿勢。

