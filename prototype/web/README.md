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
| `rules/*.json` | 所有牌、選手與數值。**調平衡只改這裡** |
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
