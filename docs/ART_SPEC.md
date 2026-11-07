# 選手姿勢表規格（M2）

> 目標：約 300 位選手（2026-11-07 從 32 人改）。每人要控制在十幾次生成以內才做得完；PixelLab 256 純文字＋骨架姿勢一人約 12–16 次，但約 80% 不像本人，**2026-11-08 用戶決定退回 Gemini 姿勢表做法**（本檔下方的範本）；測試結果見 `docs/HANDOFF.md`。**圖不進 repo。**
> 已有 McGregor、Dan Hooker（冷門選手，使用者確認像本人）、Cory Sandhagen（冷門選手，使用者確認像本人，也和 Hooker 分得開）。原圖在 `../ufc-hd-pixel-ios/Assets/Sprites/`。McGregor 的抱摔已修好（多的那隻手拿掉，兩手手套一致）。

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
  6. 倒地（仰躺，**頭在右邊、腳在左邊**；畫反了就在轉換時加 `--flip-down`）
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
bottom row: 4) staggered from a hit with the head thrown back, 5) double-leg takedown shot: torso bent far forward and low, head at chest height, both arms stretched forward and low with both hands open, 6) knocked out lying flat on his back with his head on the right and his feet on the left.
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

## 裝備上不要有字（2026-11-07 試過）
手套與腰帶上的 UFC 字樣，AI 會隨手臂轉向而鏡像、顛倒或變成亂碼（六格只有出拳那格正常），遊戲尺寸下也看不清。**決定：全表無字、無商標**，手套純黑，不要在裝備上畫字。生圖後仍要逐格看有沒有偷偷長出字。

## 頭像（選角畫面）
改用官網去背大頭照像素化，不再從姿勢表裁。來源：`https://ufc.com/images/<年-月>/<姓>_<名>_<月-日>.png`（選手頁的 og:image，去背、正面），存到 `prototype/web/assets/private/_source/`（被 gitignore，不進 repo、不上傳）。轉換：

```bash
uv run --no-project --with pillow --with numpy python -I pipeline/portrait.py --photo prototype/web/assets/private/_source/<選手>_ufc.png --fighter <選手> --out prototype/web/assets/private --colors 24 --side 0.65 --contrast 1.1 --saturation 1.05
```

對比、飽和度調高會變橘色刺眼，維持 1.1 左右。原本從姿勢表裁的頭像舊檔留在 `_source/`。照片網址從選手頁 `https://www.ufc.com/athlete/<名-姓>` 的 og:image 取。已換：McGregor、Khabib、Oliveira、Hooker、Sandhagen。官網照片是現在的樣子（例如 Hooker、Oliveira 是漂金髮），和姿勢表裡的髮色可能不同。

## 地面姿勢表（草案，2026-11-08，等使用者確認；規則見 `docs/TASKS.md` 的 M1.3）
地面戲是兩個人疊在一起，但**每人仍只畫自己的單人姿勢**，由舞台把上位疊在下位上（上位在前、下位在後、位置靠偏移和翻轉），所以每位選手只要**再多一張 6 姿勢表**，格式和第一張完全一樣（3:2、兩列三欄、綠底、全部面向右、人物不互相碰到、不要字）。閱讀順序固定：

| # | 檔名 | 姿勢 | 用在哪裡 |
|---|---|---|---|
| 1 | `gkneel` | **跪壓**：跪在對手身上，上身挺直，雙手撐在前面 | 上位待機：全防守、騎乘 |
| 2 | `gpunch` | **抬手砸拳**：同樣跪姿，一隻手高高舉起、另一手壓住 | 砸拳（打擊）、騎乘進攻 |
| 3 | `gpass` | **低身過位**：身體前傾壓低、頭貼向一側、手臂勾住對手 | 過位、半防守、側控、背後控制、鎖技發力 |
| 4 | `gguard` | **仰躺抬膝**：仰躺，雙腿抬起夾向前方（防守姿勢） | 下位待機：全防守、半防守、三角絞 |
| 5 | `gcover` | **抱頭**：仰躺或側躺，雙手護住頭 | 下位被壓：側控、騎乘、免費「抱頭」 |
| 6 | `gup` | **撐手起身**：一手一肘撐地、單膝提起，想起身或翻身 | 逃脫、翻身、站起來 |

- 倒地（KO）仍用第一張表的 `down`，被摔下去的瞬間用 `shoot`→`down`；拍墊用 `gcover` 加抖動與一隻手拍地的特效（先不新增姿勢）。
- 提示詞沿用第一張的範本，只換第一段與六個姿勢的描述（要照上表描述，並保留「exactly two arms and two legs, no extra limbs」）。**逐格數手腳**，跪壓和低身過位最容易多出手。
- 轉換：`--poses gkneel,gpunch,gpass,gguard,gcover,gup`，同一位選手會把新姿勢**加進**原本的檔案（`pipeline/sprite_sheet.py` 已改成合併，不會蓋掉第一張）。`gguard`、`gcover` 如果畫成頭在左邊，要像 `down` 一樣能翻（轉換工具要補 `--flip` 參數，等第一張出來再加）。
- 舞台怎麼疊（`stage.js` 已實作）：上位待機 `gkneel`（全防守、騎乘）或 `gpass`（半防守、側控、背後、鎖技發力），砸拳時換 `gpunch`；下位待機 `gguard`（全防守、半防守）或 `gcover`（側控以上），猜中時換 `gup`；位置越高上位壓得越近。沒有地面姿勢的選手退回現在的 `shoot` 疊 `down`（`gkneel`／`gpunch`／`gpass`／`gup` → `shoot`，`gguard`／`gcover` → `down`），所以舊選手可以慢慢補，不會壞。
- **先試做兩位**：McGregor、Khabib，確認「上位和下位疊在一起自然」再決定其餘選手要不要補。

## 還沒解決
- **地面姿勢**：見上方草案。
- **補間影格**：目前兩個姿勢之間直接切換，加上位移和閃白。如果覺得太硬，再試生成中間動作。
- **風格漂移**：不同天生成的圖可能不一致，需要時用同一個對話或固定參考圖。
