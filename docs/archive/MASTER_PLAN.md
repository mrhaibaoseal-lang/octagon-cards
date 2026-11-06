# 🗺️ Octagon Cards — 總體規劃與開發藍圖 (Master Roadmap)

> 本文件彙整專案目錄結構、四大核心系統規格與分階段檢核點。
> 詳細地面戰規格請見 [docs/GROUND_GAME_DESIGN.md](file:///C:/Users/mrhai/.gemini/antigravity/scratch/octagon-cards/docs/GROUND_GAME_DESIGN.md)，專案規範請見 [RULES.md](file:///C:/Users/mrhai/.gemini/antigravity/scratch/octagon-cards/RULES.md)。

---

## 1. 預定專案目錄結構 (`octagon-cards/`)

```text
octagon-cards/
├── RULES.md                        # 專案鐵則與零成本/零額度浪費規範
├── docs/
│   ├── MASTER_PLAN.md              # 總體規劃與架構藍圖（本文件）
│   ├── GROUND_GAME_DESIGN.md       # 地面戰與纏鬥系統深度企劃
│   ├── STRIKING_AND_DECK.md        # 站立打擊、牌組構築與裁判計分規格（初版完成）
│   ├── POWER_SYSTEM.md             # 戰力分層、特性、對位、回測引擎（初版完成）
│   ├── ANIMATION_ART.md            # L0–L3 動畫路線與共用素材清單（初版完成）
│   └── CAREER_AND_GYM.md           # 教練團、道館、減重與生涯養成規格（初版完成）
├── pipeline/                       # 資料爬蟲與自動像素化管線 (Python + uv)
│   ├── scrape_ufcstats.py          # 抓取生涯與逐回合比賽數據
│   ├── scrape_ufc_media.py         # 抓取官方排名、賽程與透明去背 PNG
│   ├── rating_calculator.py        # 百分位 + 貝氏收縮能力值換算
│   └── pixelate_sprites.py         # 零 AI 自動轉 112px/64px 真實像素圖 + 取樣膚色
├── Packages/
│   └── OctagonCore/                # 純 Swift 核心套件（Windows 本機可跑 swift test）
│       ├── Sources/FightEngine/    # 站立/纏抱/地面狀態機、讀心結算、AI、裁判計分
│       └── Sources/CareerEngine/   # 訓練營、傷病、減重、排名變動
├── App/                            # SwiftUI + SpriteKit iOS 應用層
│   └── project.yml                 # XcodeGen 設定檔
└── .github/workflows/
    ├── weekly-roster-sync.yml      # 每週日自動爬蟲 + 像素化新秀 + 更新 JSON
    └── build-unsigned-ipa.yml      # 打 Tag 時在 macOS 編譯未簽名 IPA 供 FlareStore 安裝
```

---

## 2. 10 分鐘單局節奏配比（3 回合 × 8 次交手）

為了讓一局落在 **約 10 分鐘** 且高潮迭起：
- **每回合 8 次交手（Exchange）**，代表真實比賽的 5 分鐘（每次交手代表約 35–40 秒的攻防）。
- **手牌與連段（Combo）系統**：
  - 每回合開始抽滿 **5 張手牌**，每次交手後補 1 張。
  - **站立連段**：只要體力（Stamina）足夠，一次交手可以打出 1 張單發重擊，或 **2–3 張連擊卡（例如：刺拳 → 直拳 → 低掃）**。
  - **地面單卡深算**：進入地面後改為每次交手 **1 對 1 讀心出牌**（推進 / 砸拳 / 降伏 / 重壓 vs 防過腿 / 起身 / 掃技 / 抱頭），節奏更快但每一步都決定生死。
- **回合間角落時間（Corner Time，30 秒）**：
  - 總教練給出本回合裁判 10-9 預估（讓你知道目前點數領先還落後，決定下回合要保守打點還是拼 KO/降伏）。
  - 選擇 1 項角落指示（冰敷消腫、深呼吸回體力、針對對手破綻調整牌組抽牌率）。

---

## 3. 接下來規劃階段的討論清單

在開始寫任何一行程式碼之前，我們依序把以下 3 個模組的規則定案：
1. **地面戰與纏鬥系統**（已完成初版於 [GROUND_GAME_DESIGN.md](file:///C:/Users/mrhai/.gemini/antigravity/scratch/octagon-cards/docs/GROUND_GAME_DESIGN.md)，待你審閱）
2. **站立打擊、連段與選手專屬招牌卡規則**
3. **生涯養成：教練團、道館、訓練週期、減重與真實賽事同步規則**
