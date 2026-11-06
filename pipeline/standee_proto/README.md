# 大頭像素立牌與動畫原型（非產品程式）

官方全身原圖在電腦上做的驗證。圖片一律放 repo 以外的工作目錄（`RULES.md` §2），現況與待修見 `docs/HANDOFF.md` 最新一筆。

```bash
python -m venv <工作目錄>/venv
<工作目錄>/venv/Scripts/python -m pip install pillow numpy
```

工作目錄要先建 `orig/`、`out/`。以下 `<repo>` 是 repo 根目錄，都用 `python -I`：

| 指令 | 用途 |
|---|---|
| `origall.py <repo> <工作目錄>/orig <工作目錄>` | 下載 32 位未裁切原圖，輸出總覽 `out/orig_all.png` |
| `exag.py <repo> <工作目錄> id,id,...` | 3 種比例的大頭像素比較 `out/exag_sheet.png` |
| `exag2.py <repo> <工作目錄>` | 32 位大頭總覽與對戰示意 `out/exag_all32.png`、`out/exag_mock.png` |
| `gridov.py <工作目錄> id,id` | 畫座標格，用來標關節 `out/grid.png` |
| `rig.py <repo> <工作目錄> id,id` | 切部位、擺 7 個姿勢、逐格像素化 `out/rig_poses.png`（目前只有 Topuria、Adesanya 有關節表） |
| `riggif.py <repo> <工作目錄> id` | 內插動畫 `out/rig_anim.gif`（不加 `-I`，它要 import 同目錄的 `rig.py`） |

**標關節的陷阱**：`gridov.py` 拼圖時每位有左邊距（第 1 位 80px、第 2 位 700px），座標要看格線上的數字，不是拼圖上的像素，這個錯誤已發生過一次。
