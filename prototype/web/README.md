# 戰鬥原型

瀏覽器就能玩的戰鬥驗證版。規則規格見 [docs/GAME_DESIGN.md](../../docs/GAME_DESIGN.md)。

## 怎麼玩
```bash
node prototype/web/serve.js
```
打開 http://localhost:5173。手機連同一個 Wi-Fi，開終端機印出的網址，轉成橫向（Windows 防火牆可能會詢問，要允許）。

## 檔案
| 檔案 | 內容 |
|---|---|
| `rules/*.json` | 所有牌、選手與數值。**調平衡只改這裡**。`depth.json` 是疊在 `cards.json`／`fighters.json` 上的跨手佈局、選手能力、戰術口味（新選手要有專屬能力，到這裡加一筆） |
| `engine.js` | 純規則，不碰畫面。瀏覽器與 Node 共用 |
| `game.js` | 畫面、HUD、每手的演出 |
| `stage.js` | Canvas：八角籠、選手、特效 |
| `sim.js` | 用真實引擎自動對戰，輸出各打法勝率 |
| `test/engine.test.js` | 引擎不變量測試 |
| `assets/private/` | 選手圖，**不進 repo**。沒有圖也能玩，會用占位 |

## 驗證
```bash
node prototype/web/test/engine.test.js
```
```bash
node prototype/web/sim.js 2000
```

## 產生選手圖
姿勢表規格見 [docs/ART_SPEC.md](../../docs/ART_SPEC.md)。
```bash
uv run --no-project --with pillow --with numpy python -I pipeline/sprite_sheet.py --sheet <姿勢表.jpg> --fighter khabib --out prototype/web/assets/private
```

> 上面講的是最早的 `index.html` 玩法（`engine.js`、`game.js`），已停止更新；留在原地是因為 `stage.js` 掛在它上面。

## 戰場式玩法（目前在驗證的方向）
- 開 `http://localhost:5173/bg.html`（`.claude/launch.json` 的 `prototype`）。地面可切：預設 21 點、`?ground=ea`、`?ground=poker`、`?ground=rps`；`?debug=1` 可在主控台用 `__bg` 改牌。規則在 `docs/GAME_DESIGN.md` 最上面一節。
- 檔案：`bg/engine.js`（規則）、`bg/ai.js`、`bg/ui.js`、`bg/bg.css`、`rules/bg/{config,skills,fighters}.json`。
- 驗證：`npm run test:bg`（58 項）、`npm run sim:bg`（約 4 分鐘）。

## 停止更新的原型（`_old/`）
- 卡牌版 `deck`、回合版 `bout`、即時版 `rt`、V2 解題式交鋒與教練模式 `v2`／`auto`，以及地面草圖 `ground-*-demo.html`、`mock.html`。2026-11-13 搬進來，規則檔在 `_old/rules/`。
- 還能玩：`http://localhost:5173/_old/deck.html`（其餘同理）。測試：`npm run test:deck`、`test:bout`、`test:rt`、`test:v2`。
