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


## 卡牌版（2026-11-09，取代 M1.4 玩法）
- 開 `http://localhost:5173/deck.html`（`.claude/launch.json` 的 `prototype`）。規格見 `docs/GAME_DESIGN.md`。
- 規則與數值：`rules/deck/*.json`；引擎 `deck/engine.js`、出牌 AI `deck/ai.js`、模擬 `deck/sim.js`、逐手印出一場 `deck/trace.js`。
- 檢查：`npm run test:deck`、`npm run sim:deck`（可加場數）。舊玩法的 `index.html` 與 `engine.js` 暫時保留，不再更新。

## V2 解題式交鋒（2026-11-10，試玩中）
- 開 `http://localhost:5173/v2.html`（可加 `?a=holloway&b=makhachev&seed=3`）。規則摘要在 `docs/GAME_DESIGN.md` 最上面的 V2 一節，提案全文在 `docs/REDESIGN_V2.md`。
- 檔案：`v2/engine.js`（規則）、`v2/ai.js`（對手計畫 AI 與模擬用的回應機器人）、`v2/ui.js`、`v2/v2.css`、`rules/v2/{config,cards,fighters}.json`。
- 驗證：`node --test prototype/web/v2/test.js`、`node prototype/web/v2/sim.js [每格場數]`。

