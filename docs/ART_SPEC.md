# 選手姿勢表規格（M2）

> 目標：用約 40 張圖做完約 32 位選手。生圖由使用者在 Gemini 執行。**圖不進 repo。**
> 已有 McGregor、Dan Hooker（冷門選手，品質良好，是否像本人待使用者判斷）。原圖在 `../ufc-hd-pixel-ios/Assets/Sprites/`。McGregor 的抱摔還要修掉多的那隻手。

## 第一批要測的 5 位
| 選手 | 為什麼選他 |
|---|---|
| Khabib Nurmagomedov | 原型正在用；重點看鬍子與臉 |
| Charles Oliveira | 原型正在用；刺青多 |
| Dan Hooker | **冷門，最大風險**：AI 認不認得 |
| Cory Sandhagen | **冷門** |
| Alex Pereira | 參考風格已有，用來確認同一批圖風格一致 |

**通過條件**：把圖和名字遮起來，你看得出是誰，或至少覺得像；同一張表裡臉、短褲和體型都一致；各姿勢比例相同。冷門選手做不出來就縮小名單，或換一位。

## 一張表的格式
- 比例 3:2、六個姿勢、兩列三欄，**閱讀順序固定**：
  1. 待機（格鬥架式）
  2. 出拳（手臂全伸）
  3. 高踢（腿伸直）
  4. 受擊（頭後仰，身體失衡）
  5. 抱摔（低身前衝，雙手前伸）
  6. 倒地（仰躺）
- 背景純綠 `#00FF00`，不要漸層和陰影。
- 六個人物**不可互相碰到**，也不要碰到邊。轉換工具靠這點分開姿勢。
- 全部面向右邊。
- **短褲不要純綠**，否則會被去背吃掉。
- **逐姿勢數手腳**。AI 容易多畫肢體：第一版 McGregor 的抱摔就多了一隻背後的手，兩手的手套也不一樣。只有單一姿勢錯時，先請 Gemini 修那一處，比整張重生省額度。

## 提示詞範本
把 `{選手}`、`{外觀}`、`{短褲}` 換掉：

```text
A single pixel art sprite sheet of one MMA fighter, {選手}. {外觀}. Same character, same scale,
same colors in every pose. Six separate full-body poses arranged in a grid of 3 columns and 2 rows,
all facing right, with wide empty space between poses so that no pose touches another:
top row: 1) orthodox fighting stance, 2) straight punch with the arm fully extended, 3) high kick with the leg straight;
bottom row: 4) staggered from a hit with the head thrown back, 5) double-leg takedown shot: torso bent far forward and low, head at chest height, both arms stretched forward and low with both hands open, 6) knocked out lying flat on his back.
Correct anatomy in every pose: exactly two arms and two legs, no extra limbs, nothing behind his back in pose 5.
Wearing {短褲} fight shorts, the same black open-finger MMA gloves on both hands, shirtless. Detailed 16-bit fighting game style, crisp pixels, realistic proportions,
strong dark outline. Solid pure green background #00FF00, flat, no shadow, no gradient, no floor, no text, no logos, no brand marks.
```

| 選手 | {外觀} 建議 | {短褲} 建議 |
|---|---|---|
| Khabib | stocky Dagestani wrestler, dark short hair, full black beard, no tattoos | black |
| Oliveira | lean Brazilian, shaved sides and short dark hair, thin beard, many tattoos on chest and arms | yellow and blue |
| Dan Hooker | tall lean New Zealander, short brown hair, light stubble, some arm tattoos | black and red |
| Cory Sandhagen | lean American, short dark hair, clean shaven, no tattoos | white and orange |
| Pereira | tall lean Brazilian, shaved head, red war paint on the face, chest and neck tattoos | black and gold |

外觀是我憑印象寫的，請你對照本人再改。**臉不像時，把使用者上傳的照片當參考圖通常比加文字有效。**

## 轉成遊戲素材
把圖存好，執行（`--fighter` 用 `khabib`、`oliveira`，新選手要先加進 `rules/fighters.json`）：

```bash
uv run --no-project --with pillow --with numpy python -I pipeline/sprite_sheet.py --sheet <姿勢表.jpg> --fighter khabib --out prototype/web/assets/private
```

工具會印出找到幾個人物。不是 6 個就會停下來，通常是人物互相碰到，或背景不夠純。

## 還沒解決
- **地面姿勢**：現在用「抱摔」疊在「倒地」上。上位與下位的專屬姿勢，要等 6 姿勢通過後再加一張表。
- **補間影格**：目前兩個姿勢之間直接切換，加上位移和閃白。如果覺得太硬，再試生成中間動作。
- **風格漂移**：不同天生成的圖可能不一致，需要時用同一個對話或固定參考圖。
