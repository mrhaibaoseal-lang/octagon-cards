# 選手美術規格

> 目標：1.0 先做 40～50 位選手，之後逐步增加（2026-11-13 使用者決定）。**圖不進 repo**，全放 gitignore 的 `prototype/web/assets/private/`。

## 正式畫風：《奧術》式手繪動畫風（2026-11-15 使用者確定採用）
使用者看了 Topuria 全身說「整體看起來棒透了」。取代寫實照片轉 3D、像素精靈圖兩條路線。
- **3D 模型是唯一來源**。正式版要即時 3D 還是預先渲染成 2.5D 精靈圖，跟著 V3 決定；不論哪種都從同一個模型出，不再另畫 2D 頭或姿勢表。
- **頭**（`pipeline/img2_3d/`）：`gen_head.py` Gemini 生寫實正面頭像 → `run_trellis2.py` TRELLIS.2 轉 3D → `fix_texture.py` 修色 → `smooth_head.py` 磨平頭髮鬍子眉毛 → `exaggerate_head.py` 臉型輕度誇張（使用者要的幅度：眉骨 0.007、下巴下段寬 ×1.06、下巴前 0.005）→ `gemini_paint.py --style painted` Gemini 手繪重畫四個角度、投影回貼圖 → `degreen.py` 補掉綠幕殘色。
- **身體**：MPFB 人體＋Mixamo 骨架（量級白模，`pipeline/model3d/`）→ `paint_body.py` 用同一個手繪風重畫三視圖皮膚（複製到 `_model3d/<選手>_painted/`，原本的 skin 不動）→ `bake_skin.py` 烘回 UV → `match_body_skin.py` 把身體膚色校成頭的。
- **接頭與光**：`attach_head.py --toon`：三階卡通光、冷色陰影、藍色輪廓光，**不描邊**。
- **費用**：每位選手 Gemini 約 4 次（頭像、頭四角度、身體三視圖，必要時重抽），每次約 NT$5。
- 指令、參數與踩過的坑：`pipeline/img2_3d/README.md` 最後幾節。提示詞描述畫風，不寫作品名，不放 UFC 商標。
- 刺青：Gemini 會自己編圖案，目前使用者可接受；之後要對照照片確認重點刺青。

## 畫風試驗（2026-11-15，使用者想找比《奧術》好做的畫風）
- **A 卡面立繪**：`pipeline/img2_3d/style_test.py --style portrait`，Gemini 一次畫半身手繪立繪，一眼認得出本人；會自己編刺青（胸口多了一個「T」）。要不要正式用在卡面／特寫，**等使用者決定**（採用的話「3D 是唯一來源」要改成「立繪 2D、籠內 3D」）。
- **兩階光**：`attach_head.py --poster`（一個冷色陰影、一個暖色亮部、不加輪廓光）。使用者覺得比色階化好看；要不要取代三階光還沒定。
- **共用 MPFB 頭**：遠看可以，但手機上臉約 100 像素高會露餡；Gemini 重畫並修好後仍不如重建頭，放棄（見 RULES「不再嘗試」）。
- 修 Gemini 畫歪的工具留著：`warp_paint.py` 依五官列把某一格上下拉回灰模（鬼影眼睛就是 Gemini 把五官畫高了 45 px），之後重建頭遇到同樣問題可用。

## 歷史（不再是規格）
以下是 2026-11-07～11-14 的像素路線，已被上面的畫風取代；網頁原型在新模型接進遊戲前照常使用這些舊圖。

### 共用 3D 骨架 → 像素精靈圖（2026-11-08～11-14）
- 每人 Gemini 畫身體皮膚與 6 角度 2D 頭部表，渲染成 A＋卡通光影的像素精靈圖。Topuria 試做過。骨架、白模、Mixamo 動作仍沿用，2D 頭與像素化不再用。

### 舊目標說明
> 目標：1.0 先做 40～50 位選手，之後逐步增加（2026-11-13 使用者決定；原定約 300 位）。每人要控制在十幾次生成以內才做得完；PixelLab 256 純文字＋骨架姿勢一人約 12–16 次，但約 80% 不像本人，**2026-11-08 用戶決定退回 Gemini 姿勢表做法**（本檔下方的範本）；測試結果見 `docs/HANDOFF.md`。**圖不進 repo。**
> 已有 McGregor、Dan Hooker（冷門選手，使用者確認像本人）、Cory Sandhagen（冷門選手，使用者確認像本人，也和 Hooker 分得開）。原圖在 `../ufc-hd-pixel-ios/Assets/Sprites/`。McGregor 的抱摔已修好（多的那隻手拿掉，兩手手套一致）。

### （舊）選手生成雙軌策略（2026-11-08）
經過 2D 切片骨架、方塊體、照片硬貼等反覆實測，確認「寫實街機 16-bit 像素風格」需採用雙軌策略：
- **軌道 A（快速直出流）**：針對無刺青、短髮乾淨的選手（如 Khabib、Sandhagen），直接以全身照 + 現有姿勢表參考圖 1 次生成 6 姿表，省時省額度。
- **軌道 B（像素材質卡 ＋ 姿勢白模流，情況一）**：針對刺青多、髮型特殊或重要明星選手（如 Topuria、Oliveira、O'Malley），先由 AI 產生 16-bit 像素材質卡（像素頭像、像素胸口刺青、像素包手刺青、短褲），再搭配白模骨架（`_source/base_mannequin_3x2.jpg`、`_source/mannequin_low_calf_kick_sprite_final_*.jpg` 等）引導生成動作。此法能徹底鎖死刺青與五官，大幅降低肢體錯誤重抽率，未來擴充新動作也有一致依據。
- **白模資產保留**：白模存放在 `prototype/web/assets/private/_source/`，包含站立 6 姿標準白模與低踢（卡夫踢）標準白模，供未來擴充新動作或對齊骨架姿態使用。
- **確定不再嘗試（已驗證失敗）**：
  1. 2D 骨架零件切片（Spine 式旋轉）：球關節露餡、布料撕裂、無 3D 縱深透視。
  2. Minecraft / Voxel 方塊體：風格不符，使用者已否決。
  3. 網路官方照片直接硬貼：解析度割裂、像劣質貼紙。

### 第一批要測的 5 位
| 選手 | 為什麼選他 |
|---|---|
| Khabib Nurmagomedov | 原型正在用；重點看鬍子與臉 |
| Charles Oliveira | 原型正在用；刺青多 |
| Dan Hooker | **冷門，最大風險**：AI 認不認得 |
| Cory Sandhagen | **冷門** |
| Alex Pereira | 參考風格已有，用來確認同一批圖風格一致 |

**通過條件**：把圖和名字遮起來，你看得出是誰，或至少覺得像；同一張表裡臉、短褲和體型都一致；各姿勢比例相同。冷門選手做不出來就縮小名單，或換一位。

### 一張表的格式
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

### 提示詞範本
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

### 轉成遊戲素材
把圖存好，執行（`--fighter` 用 `khabib`、`oliveira`，新選手要先加進 `rules/fighters.json`）：

```bash
uv run --no-project --with pillow --with numpy python -I pipeline/sprite_sheet.py --sheet <姿勢表.jpg> --fighter khabib --out prototype/web/assets/private
```

工具會印出找到幾個人物。不是 6 個就會停下來，通常是人物互相碰到，或背景不夠純。
- **體型大小全自動校正**：
  1. **轉檔時自動補齊身高體重**：若 `rules/fighters.json` 裡的新選手還沒填 `height`（cm）與 `weight`（lb），`sprite_sheet.py` 會自動從 `data/fighters.json` 查出該選手的真實身高與量級體重寫入（也可加 `--height 170 --weight 145` 手動指定），並在終端機印出校正後的畫面尺寸。
  2. **載入時自動掃描像素（`stage.js`）**：遊戲載入 `idle.png` 時，`analyzePose` 會自動抓出肩膀位置、推算頭骨頂到腳底的真實像素高度（自動排除像 O'Malley 爆炸頭的蓬鬆髮型虛高）並量測腰寬比例，再由 `fighterScale` 依 `height` 與 `weight` 算出水平／垂直縮放倍率。因此**生圖時不必擔心 Gemini 把人物畫太大或太小，放進遊戲就會自動縮放到真實比例**。

### 裝備上不要有字（2026-11-07 試過）
手套與腰帶上的 UFC 字樣，AI 會隨手臂轉向而鏡像、顛倒或變成亂碼（六格只有出拳那格正常），遊戲尺寸下也看不清。**決定：全表無字、無商標**，手套純黑，不要在裝備上畫字。生圖後仍要逐格看有沒有偷偷長出字。

### 頭像（選角畫面）
改用官網去背大頭照像素化，不再從姿勢表裁。來源：`https://ufc.com/images/<年-月>/<姓>_<名>_<月-日>.png`（選手頁的 og:image，去背、正面），存到 `prototype/web/assets/private/_source/`（被 gitignore，不進 repo、不上傳）。轉換：

```bash
uv run --no-project --with pillow --with numpy python -I pipeline/portrait.py --photo prototype/web/assets/private/_source/<選手>_ufc.png --fighter <選手> --out prototype/web/assets/private --colors 24 --side 0.65 --contrast 1.1 --saturation 1.05
```

對比、飽和度調高會變橘色刺眼，維持 1.1 左右。原本從姿勢表裁的頭像舊檔留在 `_source/`。照片網址從選手頁 `https://www.ufc.com/athlete/<名-姓>` 的 og:image 取。已換：McGregor、Khabib、Oliveira、Hooker、Sandhagen。官網照片是現在的樣子（例如 Hooker、Oliveira 是漂金髮），和姿勢表裡的髮色可能不同。

### 地面姿勢表（草案，2026-11-08，等使用者確認；規則見 `docs/TASKS.md` 的 M1.3）
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

### 還沒解決
- **地面姿勢**：見上方草案。
- **補間影格**：目前兩個姿勢之間直接切換，加上位移和閃白。如果覺得太硬，再試生成中間動作。
- **風格漂移**：不同天生成的圖可能不一致，需要時用同一個對話或固定參考圖。
