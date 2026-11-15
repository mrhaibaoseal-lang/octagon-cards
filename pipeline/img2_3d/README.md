# 照片轉 3D 實驗（2026-11-14，只是實驗，路線沒改）

問題：開源照片轉 3D 在本機 RTX 5050 筆電版（8GB 顯存、11.7GB 記憶體、沒有 CUDA 編譯器）能不能跑？生出的頭像不像本人？能不能接到 MPFB 身體上？

產出全在 gitignore 的 `prototype/web/assets/private/_img2_3d/`：`inputs/`、`triposr/`、`trellis2/`、`results.jsonl`（每次執行的耗時與顯存）、`comparison.png`（8 角度對照表）、`body_with_head_triposr.png`、`body_with_head_triposr_hi.png`、`body_with_head_trellis2.png`（接頭全身圖）。
環境與權重放在 `D:\img2_3d\`（C 槽只剩約 30GB）：`venv`（Python 3.11、torch 2.7.0+cu128）、`hf`（HF_HOME）、`src`（各工具程式碼）、`tf_old`（給 TripoSR 用的舊 transformers）。

## 腳本
| 檔案 | 做什麼 |
|---|---|
| `gen_head.py` | 用 Gemini（Vertex，約 NT$5）生一張寫實、中性表情的正面頭像，沿用 `pipeline/model3d/paint_skin.py` 的 token 與照片處理（只 import，不改檔） |
| `common.py` | 輸入去背、置中補成正方形；`Recorder` 記錄耗時與 nvidia-smi 顯存峰值，寫進 `results.jsonl` |
| `run_triposr.py` | TripoSR 基準 |
| `run_trellis2.py` + `fake_xformers.py` | TRELLIS.2 官方程式 ＋ visualbruno 預編 wheel，512、低顯存模式 |
| `render_turntable.py` | Blender：一個網格轉 8 個角度出成一條 |
| `compare.py` | 渲染所有結果並排成 `comparison.png` |
| `fix_texture.py` | 把 TRELLIS.2 貼圖的顏色分佈對齊輸入圖（逐色版直方圖對齊），存成 `<name>_fix.glb` |
| `gemini_paint.py` + `paint_head_blender.py` | 只留 TRELLIS.2 的形狀：灰模四個角度排成 2×2 綠底圖，Gemini 照照片重畫（一次約 NT$5），再依表面朝向投影烘回 UV 貼圖；沒被看到的地方沿用修色貼圖。目前最好的投影參數：`--reuse --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _occ`（見「眼睛」一節）。`paint_head_blender.py vis` 在 Blender 對每個貼圖點往四個鏡頭打射線，存 `vis.npy`要用 `uv run --no-project --with google-genai --with google-auth --with pillow --with numpy --with trimesh python -I` 跑（venv 沒有 google-genai） |
| `solid_head.py` | Blender：捲髮頭先體素重建成實心外殼、xatlas 展 UV、烘回顏色，再接 `smooth_head.py`（見「換選手驗證：O'Malley」） |
| `keep_face.py` | Blender：把 `solid_head`／`smooth_head` 處理過的頭的臉貼回 TRELLIS 原始表面，只有頭髮保留處理後的形狀（見「臉被磨掉」） |
| `attach_head.py` | Blender：開 `skinned.blend`（不存檔），切掉身體的頭，把生成的頭縮放、對齊後綁到 Head 骨頭，出正面與 3/4 全身圖。目前最好的參數：`--blend -0.03 0.02 --lift 0.015 --blend-color 0.07 --close`（`--close` 另出頭頸四角度近拍 `<out>_close.png`；`--face` 出眼睛高度的臉部特寫 `<out>_face.png`；`--debug-red` 把新頭塗紅） |

## 各工具
- **TripoSR**（MIT，1.68GB）：可行。三張輸入都成功，每張約 6 秒（第一次含載入 26 秒），顯存峰值約 3GB。輸出是頂點色網格，約 6 萬個頂點。
- **TRELLIS.2**（MIT，512 路線權重 9.6GB ＋ DINOv3 1.2GB ＋ ss_dec 148MB）：可行。顯存峰值約 3GB，照片 288 秒（含載入）、Gemini 寫實 144 秒；輸出 11～14 萬點，有 PBR 貼圖。Gemini 寫實版整顆頭完整、網格乾淨，接到身體上明顯比 TripoSR 好；但膚色被做成深棕色（貼圖平均 RGB 78/51/34），眉眼畫得很重，所以不太像本人。照片版的胸口佔太多，下巴以下被切成一塊實心方塊。
- **Pixal3D**：不可行。官方沒寫顯存需求，ComfyUI 包裝版實測低顯存模式（1024）峰值約 17GB。
- **Hunyuan3D-2GP**：使用者這次沒選，未測。只有形狀生成可行（約 6GB）；上色要 24.5GB 而且要自己編譯。

## 踩到的坑
- RTX 50 系列（sm_120）要 torch 2.7 以上搭 cu128；官方釘的 torch 2.5、2.6（cu124）都不能用。
- 沒有 VS 和 nvcc，要編譯的套件全都裝不起來：TripoSR 的 torchmcubes 換成 PyMCubes（`v[:, ::-1]` 對齊軸向）；TRELLIS.2 用 visualbruno 預編的 Windows wheel（Torch270、cp311）。
- transformers 5 改了 ViT 的參數名稱，TripoSR 的權重載入會缺 key。解法是在 `D:\img2_3d\tf_old` 另放 transformers 4.46.3 ＋ huggingface_hub 0.36，只給 TripoSR 用。
- TRELLIS.2 的稀疏注意力只支援 xformers 和 flash_attn，這台都沒有。`fake_xformers.py` 用 torch 的 sdpa 頂替，把等長的段落分組後批次算。
- TRELLIS.2 的 pipeline.json 會額外抓 `briaai/RMBG-2.0`（要申請、不可商用）來去背。輸入已經有透明度，所以換成空殼，不下載。另外它也會抓 `microsoft/TRELLIS-image-large` 的 ss_dec（148MB）。
- glTF 匯入 Blender 的物件旋轉模式是四元數，直接設 `rotation_euler` 不會生效，要先把 `rotation_mode` 改成 `"XYZ"`。TripoSR 的網格要轉 X -90、Z -90 才會站直、臉朝 -Y。
- TripoSR 開到解析度 512 要約 10GB 顯存，超過的部分先搬到系統記憶體、再寫進 C 槽的 pagefile，C 槽會暫時暴增；跑一張要 1～3 分鐘，畫質幾乎沒變好。不要再開。
- 接頭時按脖子顏色整體調色（`--match-skin`）沒有用：臉還是灰白，脖子留長（`--neck-keep 0.05`）反而多出一圈領子狀的破片。TripoSR 已經到頂。
- TRELLIS.2 一開始會載入 pipeline.json 列的所有模型：只下載 512 時，要把 `model_names_to_load` 裡的 `_1024` 拿掉。
- transformers 5 把 DINOv3 的 blocks 從 `model.layer` 搬到 `model.model.layer`，TRELLIS.2 會報找不到 `layer`，要補一個別名。
- DINOv3 要申請：Fine-grained token 讀不到申請制模型，要用 Read 類型的 token，或勾選讀取 public gated repos 的權限。
- TRELLIS.2 的輸入最好只有頭和脖子：胸口一多，超出 [-0.5, 0.5] 的部分會被切成實心方塊。網格的外框因此也不能拿來取景，`compare.py` 給它 `--head 0.65`。
- TRELLIS.2 烘出的底色只有輸入的一半亮（Gemini 頭中位數 66 vs 151，不是金屬度造成的，金屬度是 0）；`fix_texture.py` 對齊後膚色就接得上身體。
- 輸入名稱加 `_head`（`photo_head`、`gemini_real_head`）會在肩膀上方裁掉：照片只剩頭反而被當成仰頭，臉扭曲；Gemini 版頭形完整但眼眶全黑。裁頭沒有比較好。
- 接頭基準要用脖子中段（Neck 骨起點 +1cm，約 1.45m），不能用 Neck 骨尾端：尾端在下巴高度，切在它上面會把 MPFB 的下顎留在新頭裡面穿模，拿它對齊新頭的脖子會讓頭小約 20%。新頭的下緣也不能一刀水平切：鬍子垂到脖子最細處下面，水平切會把下巴切掉（第一次修就犯了，誤看成鬍子陰影）。身體要用 `bisect_plane` 切平，不能刪頂點：刪頂點會把跨線的三角形整片拿掉，斜方肌頂端變成鋸齒。新頭的脖子（約 22cm，比 MPFB 的 14cm 粗）整根保留往下伸進斜方肌（`--neck-keep 0.05`，左右 `--neck-radius 0.12` 以外才刪），`--stitch 0.04` 把下段吸到身體表面、最底下壓進 2mm。`--debug-red` 把新頭塗紅，看得出哪塊是誰的。剩下：脖子兩側有幾小塊新頭的斜方肌露出、交界看得出一條線。
- Gemini 卡通頭（`head_front.png`）丟進 TripoSR 會變成扁平的分層面具；照片或寫實圖才有立體的臉。

## 結論（2026-11-15）
- TripoSR：臉型會對，但畫質不能用；調高解析度、磨平都沒有用。
- TRELLIS.2：形狀和網格可以當起點，膚色與五官的上色不可靠。下一步可試：只裁頭和脖子當輸入；或只用它的形狀，貼圖改用 Gemini 畫或從照片投影；或只拿它當臉型參考去調 MPFB。

## 優化（2026-11-15）
- 最好的組合：Gemini 寫實圖（原始輸入，不裁）→ TRELLIS.2 → `fix_texture.py` 修色 → 接頭。產出 `body_with_head_trellis2_fix.png`：膚色和身體一致、臉不再發黑；頭髮略偏灰，眉眼仍重。
- 裁頭版（`body_with_head_trellis2_photo_head.png`、`..._gemini_real_head.png`）都比較差，不要用。
- **Gemini 上色（目前最好）**：`gemini_real_fix` 的形狀＋`gemini_paint.py` → `trellis2/gemini_real_fix_paint.glb`、`body_with_head_trellis2_paint.png`。Gemini 畫的四格很像本人（漸層短髮、鬍型都對），投影後比 TRELLIS 自己上色像很多，原本的黑眼圈也沒了。剩下：眼睛和網格沒完全對齊（眼皮糊、眉毛略雙層），頭髮和鬍子的網格凹凸太多、像顆粒。可再試：投影前用臉部特徵點把 Gemini 圖對齊灰模；把頭髮與鬍子的網格磨平。工作檔在 `_img2_3d/paint/gemini_real_fix/`（grid.png、painted.png）。

## 脖子交界（2026-11-15 第二輪）
- 指令：`blender -b <private>/_model3d/topuria/skinned.blend -P pipeline/img2_3d/attach_head.py -- <private>/_img2_3d/trellis2/gemini_real_fix_paint.glb out.png --blend -0.03 0.02 --lift 0.015 --blend-color 0.07 --close`。產出 `body_with_head_trellis2_neck.png`、`..._neck_close.png`、前後對照 `neck_before_after.png`、脖子長度對照 `neck_length_cmp.png`。
- 對齊改成兩點：頭骨（中線以上的外框中心）＋後頸（脖子中段高度、正中線最後面的點）。新頭往後仰轉 5.6°、往後移 3 cm 才對上。舊做法用頭頂 15% 的頂點平均去對身體頭骨的平均，頭髮網格又密又亂會把平均拉偏，頭因此往前凸、低頭（使用者從側面看出來的）。
- 融合（`--blend LO HI`）：身體在脖子中段 −3 cm 切平；新頭只留到切口下 1 cm，從 +2 cm 往下沿著脖子骨的軸，把每個點的半徑漸變成「未切身體」在同高度、同角度的半徑（切口以下縮進 2 mm 讓身體蓋住邊）；新頭自帶、比身體脖子寬 1.5 cm 以上的斜方肌刪掉。顏色：新頭多一組 UV 指到身體的 skin 貼圖，切口往上 5 cm（`--blend-color`）內從身體膚色漸變回新頭。結果正面、3/4、側面、背面都看不出接縫。
- 坑：身體有骨架變形，1.44 m 以下靜止網格和渲染姿勢差到 3 cm（肩膀放下）。在靜止網格上切和量，切口會比畫面低、留一道縫，斜方肌也量不到。現在先把 Armature 修改器套用再切（只出測試圖、不存檔；正式流程要在靜止姿勢切並保留權重）。
- 坑：切口以下若保留太多新頭（1.5 cm 以上），壓到幾乎水平的肩膀上會貼在身體表面露出來，像兩片翅膀；只留 4 mm 又會在接縫露出一排小黑縫。1 cm 剛好。
- 坑：正前方（±35°～65°）不能刪「比身體寬」的點，也不能整段拉向身體：鬍子一路垂到切口，刪了下巴底下會破洞（紅色版一看就知道）。現在正前方只在切口以上 1～3 cm 內融合，往上保持原形。
- 脖子太短（使用者看出來的）：新頭的下巴連鬍子比 MPFB 原本的下巴低 3 cm（腳本會印 `chin z body/head`）。`--lift` 把脖子拉長：切口以下不動，正前方在切口上 2 cm 內、背面和側面在 7 cm 內漸漸抬滿。3 cm（下巴對齊 MPFB）使用者覺得太長，定案 1.5 cm。整顆頭直接往上抬不行：新頭脖子底下比較寬的那段被抬進融合帶，被當成斜方肌刪掉，後頸會破。拉長後喉嚨上的鬍子下緣會被拉成條紋，`--blend-color 0.07` 讓膚色蓋上去。
- 還剩：後頸中線有一小條深色痕（新頭貼圖本身就有，在融合帶以上）。

## 眼睛與後頸（2026-11-15 第三輪）
- 現在最好的頭：`trellis2/gemini_real_fix_paint_occ.glb`（`gemini_paint.py --reuse --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _occ`，沒有重新呼叫 Gemini）。接頭指令同上一節。產出 `eyes_before_after.png`（前後對照：無光照貼圖、打光、後頸）、`body_with_head_trellis2_eyes_close.png`、`..._eyes_face.png`。
- 原本以為 Gemini 畫的眼睛比網格低約 1 cm、要用特徵點變形對齊；量過才發現網格眼縫下面那塊凸起就是眼球（側面看它最往前），瞳孔本來就落在上面。用「無光照、和灰模同一個鏡頭」渲染投影結果跟 Gemini 原圖比，才看出真正的問題在投影：不要先猜對齊，先做這個比對。
- 坑：眉骨下的上眼皮是一道幾乎朝上的深溝，正面權重只有 0.002，舊的門檻（總權重 0.15 才全用新畫）讓它大多沿用 TRELLIS 舊貼圖，又沒有遮擋判斷，結果是橫條紋＋深色＝「眉毛兩層」。修法：`--thr 0.0001`（只要有角度看得到就用新畫的）＋ `--occlusion`。
- 坑：遮擋判斷不能用貼圖點雲自己做深度圖：點雲有小洞，臉頰的點在側面圖裡被誤判看得到，拿到鼻孔的深色，變成一片小黑點；加 3×3 最小值補洞又把正面的點誤判擋住，黑點更多。改成在 Blender 用 BVH 對每個點往鏡頭打射線（約 25 秒、四個角度共 680 萬條），黑點全消。
- 坑：完全沒有角度看得到的細條（眉骨正下方朝下的面、鼻孔內）沿用舊貼圖會變成一條亮橘線；`--fill 12` 讓周圍的新顏色在貼圖上往內長 12 格。側面圖去背邊緣混了綠色，`--green-margin 2` 排除綠幕旁 2 px。
- 後頸那條深色痕不是頭的貼圖：拿掉 `--blend-color` 就消失。脖子融合的第二組 UV 是逐頂點找身體最近點，後頸正中剛好是身體貼圖的 UV 接縫，同一個三角形的角落落在接縫兩邊，中間內插出一整條貼圖。`attach_head.py` 現在把跨接縫（UV 差 0.03 以上）的三角形整片用同一個 UV（約 845 個面），痕不見了，其他地方沒有色塊。
- 還剩（打光後才看得出來）：貼圖上的上眼皮已經是對的膚色，但網格眉骨下的深溝和一顆顆凸起的眉毛在打光下還是一片暗，眼睛被眉骨陰影蓋成灰藍色——這部分是形狀，要靠磨平（下一步的頭髮／鬍子磨平可以把眉毛一起算進去）。

## 磨平頭髮、鬍子、眉毛（2026-11-15 第四輪）
- 指令：`blender -b -P pipeline/img2_3d/smooth_head.py -- <private>/_img2_3d/trellis2/gemini_real_fix_paint_occ.glb <private>/_img2_3d/trellis2/gemini_real_fix_paint_smooth.glb`（約 10 秒；`--debug mask.png` 出遮罩圖：紅＝頭髮鬍子眉毛、綠＝眉骨帶、藍＝鎖住的眼球）。接頭指令同上，產出 `smooth_before_after.png`（上：磨平前，下：磨平後）、`body_with_head_trellis2_smooth_face.png`、`..._smooth_close.png`、`smooth_mask.png`。
- 結果：頭頂、鬍子、眉毛的顆粒都磨掉；眉骨下的溝填淺後上眼皮照得到光，眼睛不再被陰影蓋成灰藍；眼球附近的點完全沒動（腳本印 `eye area max 0.0`）。眉毛現在是貼圖線條在撐。
- 做法：哪裡是毛看貼圖亮度（以額頭膚色為準：單點 < 0.5 倍，或鄰近平均 < 0.55 倍），遮罩擴散 8 次補洞；眼睛從鼻尖往上 0.10、左右 0.085 頭高找眼白，半徑 0.03 頭高內權重 0。毛的區域：重度平滑後把「縮掉的低頻體積」加回去（只拿掉顆粒那一段頻率）；眉骨帶再做 40 次一般平滑把溝填淺。
- 坑：Taubin 平滑太溫和，30～80 次顆粒幾乎沒變。用整張臉的亮度中位數當膚色會被鬍子拉低（0.35 vs 額頭 0.81），抓不到鬍子；換成額頭後門檻又太寬會把整張臉當鬍子。臉頰的淡鬍渣（約 0.6）和耳朵、太陽穴皮膚一樣亮，顏色分不開；靠下顎濃鬍子擴散出去帶到一部分。整張臉最亮的地方是額頭，不是眼白，眼睛要從鼻尖找。
- 還剩：臉頰側邊鬍渣的邊緣還有一點點顆粒；眉毛貼圖本身偏粗偏黑。

## 風格試驗（2026-11-15，使用者覺得寫實版很糟，想看卡通／復古／《奧術》）
- `style_head.py --style real|retro|painted`：同一顆頭出正面、3/4、側面三張。產出 `style_cmp.png`（上：寫實打光，中：油畫三階光＋描邊，下：復古 4000 面）。
- retro：自動減面掃描來的頭會碎成一片片三角形（1500 面完全不能看，4000 面像壞掉的 PS2），不是半條命那種乾淨的低面數；那種感覺要乾淨的手工拓樸（例如 MPFB 本來的網格）配低解析貼圖。坑：`Image.scale()` 對 glTF 打包的貼圖會失效，要自己用 numpy 縮。
- painted：貼圖過 Kuwahara 濾鏡（筆觸變平塊）、光分三階（冷色陰影）、藍色輪廓光、外描邊。看起來像畫的，但臉型還是寫實比例，離《奧術》還遠：《奧術》要的是誇張的臉型（大下巴、深眉骨、大眼）和手繪貼圖，不是濾鏡。

## 風格最佳化（2026-11-15 第二輪）
- 對照圖 `style_cmp2.png`：由上而下 原本寫實、《奧術》方向、復古 1500 面、復古 500 面。
- 《奧術》方向：`exaggerate_head.py`（眉骨往前 1.4%、下巴下段加寬 12%、下巴往前 1%，眼睛不動）→ `trellis2/arcane.glb` → `gemini_paint.py --mesh arcane --style painted --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _ar`（Gemini 一次約 NT$5；提示詞描述手繪動畫風，不寫作品名）→ `style_head.py --style painted --kuwahara 0`（三階光、冷色陰影、藍色輪廓光、描邊）。Gemini 畫的四格在 `paint/arcane/painted.png`。目前最好看的一版。
- 復古方向：`retro_head.py --faces 1500`：體素重建成平均的四邊形網格（QuadriFlow 在 `-b` 背景模式不會執行，面數不變），重新展 UV，從原頭烘到 256 px 貼圖、最近點取樣。1500 面像 2000 年前後的遊戲；500 面鼻子烘壞（烘焙距離不夠）、耳朵變糊。
- 胸口仍是舊貼圖，接到身體時會切掉，不用管。

## 臉型減半與全身卡通（2026-11-15 第三輪）
- 使用者覺得臉型誇張太多：`exaggerate_head.py arcane_paint_ar.glb arcane_half.glb --brow -0.007 --jaw 0.946 --chin -0.005` 往回推一半（貼圖跟著點走，不用重畫）。
- 全身：`attach_head.py ... arcane_half.glb ... --close --toon`，身體和頭都換成三階卡通光、輪廓光，身體加描邊。產出 `body_toon.png`、`body_toon_close.png`。身體雖然是寫實貼圖，套卡通光後和頭還算搭；刺青仍是模糊的照片感。
- 坑：描邊（反轉外殼）不能加在掃描來的頭上：網格不平，外殼從臉和脖子穿出來變成一堆波浪線。頭不加描邊。
- 還剩：身體貼圖要用同一個手繪風重畫（刺青、肌肉線條）；脖子切口有一圈細描邊線；後腦下方有一點綠幕殘色。

## 身體手繪重畫（2026-11-15 第四輪）
- `paint_body.py topuria`：把 `_model3d/topuria` 複製成 `_model3d/topuria_painted`（原本的 skin 不動），沿用 `paint_skin.py` 的三視圖提示詞、只換掉 Style 那句改成手繪動畫風，Gemini 一次（約 NT$5）；再 `bake_skin.py --dir .../topuria_painted` 烘回 UV。接頭：`attach_head.py` 用 `topuria_painted/skinned.blend`、`--toon`。產出 `body_painted.png`、`body_painted_close.png`、前後對照 `body_painted_cmp.png`（左：寫實身體，右：手繪身體）。
- 結果：頭和身體畫風統一，刺青變成清楚的黑色圖形，肌肉是幾塊平面。
- 還剩：Gemini 自己編了胸口老虎和手臂花臂，不一定是本人真正的刺青（要對照片確認）；三視圖整張只有 1584×672，烘到身體後刺青細節偏糊；3/4 那格一隻手臂沒照姿勢張開，這次烘起來看不出問題。
- 使用者覺得手繪身體太黃、接縫明顯（同日）：`match_body_skin.py <head.glb> <dir>_painted` 把身體膚色（中亮度、r>g>b 的像素）的中位數逐色版調成頭的（這次 gain 1.17/1.12/1.28），原檔留 `skin_raw.png`；`attach_head.py --toon` 的身體描邊關掉 rim（身體在脖子切開，rim 會在脖子畫一圈線）。`body_painted_cmp.png` 由左至右：寫實身體、手繪原色、手繪校色後。脖子那圈線和色差都消失。
- 再修（同日）：頭頂的綠色殘留是 Gemini 綠幕滲進頭髮貼圖，`degreen.py arcane_half.glb` 把綠色明顯高過紅藍的貼圖點（外擴 2 格，約 4100 點）用旁邊的顏色一圈圈補回 → `arcane_half_ng.glb`。側面肩膀那條線是身體描邊：肩膀擋在斜方肌前面時，反轉外殼畫出內輪廓，描邊減半也還在；頭本來就沒描邊，所以 `--ink` 預設改 0（全身都不描邊），看起來一樣好。
- **目前最好的一版**：`blender -b <private>/_model3d/topuria_painted/skinned.blend -P pipeline/img2_3d/attach_head.py -- <private>/_img2_3d/trellis2/arcane_half_ng.glb out.png --blend -0.03 0.02 --lift 0.015 --blend-color 0.07 --close --toon` → `body_painted.png`、`body_painted_close.png`。使用者：「整體看起來棒透了」，刺青目前可以接受。

## 換選手驗證：O'Malley（2026-11-15，畫風已正式採用）
- 產出：`cmp_topuria_omalley_full.png`（全身並排）、`cmp_topuria_omalley_close.png`（頭頸四角度，上 Topuria、下 O'Malley）、`om_body_ar.png`、`om_body_ar_close.png`。Gemini 共 4 次：頭像、頭四角度、身體兩次（第一次沒照姿勢）。
- **指令（新選手照這個跑，`<P>` = `<private>/_img2_3d`）**：
  1. `gen_head.py --fighter omalley` → `inputs/omalley_gemini_real.png`
  2. `run_trellis2.py --src D:/img2_3d/src/TRELLIS.2 --inputs omalley_gemini_real`（約 6 分鐘，顯存峰值 7.7GB）
  3. `fix_texture.py omalley_gemini_real`
  4. 捲髮／蓬鬆頭髮才要：`blender -b -P solid_head.py -- <P>/trellis2/omalley_gemini_real_fix.glb <P>/trellis2/omalley_solid.glb --voxel 0.015`
  5. `smooth_head.py <solid 或 fix>.glb omalley_smooth.glb` → `exaggerate_head.py ... omalley_arcane3.glb --brow 0.007 --chin 0.005`（`--jaw` 預設 1.0；Topuria 用 1.06，窄下巴的人不要加）
  6. `gemini_paint.py --mesh omalley_arcane3 --fighter omalley --style painted --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _ar` → `degreen.py`。第一次跑不加 `--shape-ok`，只會出灰模 `clay_<mesh>.png`；使用者看過說像了才加 `--shape-ok` 上色
  7. `paint_body.py omalley` → `bake_skin.py --dir <private>/_model3d/omalley_painted` → 看 `align_check.png`（紅線要貼著人）→ `match_body_skin.py` → `attach_head.py`（參數同 Topuria，加 `--toon`）
- **只對 Topuria 有效、已改成通用的地方**：
  - `common.py` 輸入表只有 Topuria：現在 `inputs/<名字>.png` 都能用。`gemini_paint.py` 的選手名、髮型、照片寫死 Topuria：加 `--fighter`（名字取 `paint_skin.FIGHTERS`、照片 `_source/<fighter>_ufc.png`）與 `--hair`（頭部外觀，預設查 `HAIR` 表）。
  - `fix_texture.py` 逐色版對齊直方圖：輸入圖大半是粉紅頭髮時，臉被拉成黃綠色。預設改成只對齊亮度、保留色相；`--rgb` 是舊做法（Topuria 那顆頭用的）。
  - `smooth_head.py`：膚色基準原本取額頭，O'Malley 的額頭被瀏海蓋住；改取眼睛下方到鼻尖的臉中央。頭毛原本只看「比膚色暗」，染色頭髮不暗；加上色度距離（`--hue 1.2`，Topuria 頭頂只到 0.7，不受影響）。遮罩擴散原本按網格圈數，臉的網格粗 3 倍時會漫過整張臉；改成依臉部邊長換算（以 Topuria 的 0.011 頭高為準）。找到的眼睛離比例預估超過 0.02 頭高（被黑點或刺青拉走）就用預估值。改完 Topuria 的遮罩 71k 點（原本 73k），眼睛位置不變。
  - `paint_body.py`：大爆炸頭讓 Gemini 把整個人縮小、手放下、腳切掉，烘上去短褲跑到膝蓋。提示詞結尾補一句「頭之後會換掉，頭髮貼頭皮、不超出白模頭的輪廓，手照白模平舉」，重抽一次就對齊。舊的嘗試存成 `painted_sheet_<n>.png`。坑：`paint_skin.py` 的 O'Malley 描述被 Gemini 改過（未 commit），拿掉了「不是大爆炸頭」那句。
- **新增 `solid_head.py`**（捲髮用）：TRELLIS.2 把捲髮做成一條條空心管子，網子狀，磨 150 次只會縮成網、還把太陽穴拉凹。改成體素重建成實心外殼（`--voxel 0.015` 頭高）＋閉合（往外推 1.5 格、重建、推回，填掉 TRELLIS 臉上小破洞變成的方坑）→ 只留最大的外殼 → xatlas 展 UV（在 TRELLIS venv 跑）→ 原本的底色接到自發光再烘（用漫射烘，金屬度會讓粉紅變黑）。坑：Blender 的 smart project 在這種凹凸外殼上只用到 5～23% 的貼圖，每個面約 1 像素，最小的面烘成黑點；xatlas 用到 50～62%。
- 坑：Blender `-b` 的輸出路徑要給絕對路徑，相對路徑不知道寫到哪去。
- **和 Topuria 比**：一樣好的是畫風統一（頭身同一套手繪感、膚色接得上、脖子看不出接縫）、身體刺青是清楚的彩色圖形、三視圖對位準、眼睛清楚、認得出是誰（粉紅捲髮、山羊鬍、臉上小刺青）。比較差的是頭髮是一整團光滑的「蘑菇頭」，捲度只靠貼圖畫，輪廓不蓬；額頭瀏海下有幾塊淡橘色（沒有任何角度看得到、用周圍補的）；右臉頰「♥ love」刺青被拉成一道粉紅；後頸髮際有幾小塊膚色斑；臉因為閉合變得稍微圓胖。白色短褲在三階光下陰影偏藍，看起來有點半透明。
- 可再試（要再呼叫 Gemini 就先問）：在最後的 `omalley_arcane3` 上重新呼叫一次 `gemini_paint.py`（這次為了省額度，沿用前一版網格畫的圖，形狀有些微差異）；頭髮輪廓要蓬可能要手動做幾個髮束。
- **重畫頭（同日，使用者同意，Gemini 第 5 次）**：在最終網格 `omalley_arcane3` 上重新呼叫 `gemini_paint.py ... --tag _new`（沿用版的工作檔移到 `paint/omalley_arcane3/_reused/`）→ `om_body_new*.png`。`cmp_topuria_omalley_close.png` 現在三列：Topuria、沿用版、重畫版；全身並排改用重畫版。結果：頭髮邊緣、後頸的膚色斑都乾淨了，捲度畫得更有層次；**臉頰那道粉紅和額頭的淡橘斑還在**，可見是網格造成的（臉頰該處的形狀摺到、瀏海下的凹處沒有任何角度看得到），不是投影錯位。要修得從形狀下手（閉合後對臉頰與額頭再做一次局部平滑），不是再抽 Gemini。重畫版的眼睛是棕色、臉偏年輕一般，像本人的程度略低於沿用版。

## O'Malley 頭型重做：臉被磨掉（2026-11-15）
- 使用者：整顆頭、整張臉的形狀都不對（頭髮、顏色不是主因）。
- 試過貼頭短髮：`gen_head.py --fighter omalley --name omalley_tight --look "<短捲髮、露耳、單一粉紅>"`（`--look` 會蓋掉照片的髮型）。形狀乾淨、比例對、不用 `solid_head`，但 Gemini 把臉改成方下巴的帥哥臉，**使用者說和本人沒關係**。輸入頭像會改臉，換髮型不能只靠提示詞。
- **灰模比對**（`render_turntable.py --clay --head 1.0`，`clay_face_cmp.png`，上到下：真人照、原始、實心化、舊最終、短髮、真人照片版）：TRELLIS 原始網格（`omalley_gemini_real_fix`）是長窄臉、像本人；`solid_head` 在臉上留下小坑；`smooth_head` 的頭髮遮罩（`om_mask.png` 紅色）蓋滿臉頰、太陽穴、鬍子，重度平滑把眼睛、鼻子、顴骨磨掉，這才是「頭型不對」。`exaggerate_head --jaw 1.06` 再加寬下巴，O'Malley 是窄下巴，不要用。
- 真人照片也能直接跑：`inputs/omalley_photo.png`（從 `_source/omalley_fullbody_ufc.png` 裁 (170,0,790,760)，有 alpha）→ 長窄臉、頭髮輪廓最像本人，但頭略斜、貼圖亂（反正會重畫）。使用者說第 1、5 列都不錯；選第 1 列（正面對稱，好投影）。
- `keep_face.py processed.glb raw_fix.glb out.glb`：原始網格顏色不是粉紅的點（皮膚、鬍子、脖子）貼回原始表面，髮際線用鄰點平均過渡。**還沒好**：處理後的網格只有 29k 點（voxel 0.015），貼回去臉還是糊（`clay_keep_cmp.png` 第三列）；頭頂只有一半被判成頭髮（印出的分高度統計），外殼離原始髮管約 0.008，最近點常是頭皮或暗縫，取 12 個鄰點平均也沒用。
- 下一步建議：(1) 分類改用幾何，例如原始網格每點往外的法線方向、離頭骨中心的距離，或把正面輸入圖投影上去看是不是粉紅；(2) `solid_head` 用更細的 voxel（0.006，`--close` 依比例加大）讓臉有足夠的點；(3) 或者不貼回，直接把原始網格的臉區域和處理後的頭髮外殼接在一起。臉型在灰模上和第 1 列一樣才上色。

## 臉貼回原始網格（2026-11-15 第二輪）
- 比對圖 `clay_keep_new_cmp.png`（上到下：原始網格、舊最終、新＋捲髮塊、新＋平滑一團）。第 3、4 列的臉和第 1 列一樣（長窄臉、鼻樑、眼窩、鬍子）。
- 指令：`solid_head.py <P>/trellis2/omalley_gemini_real_fix.glb <P>/trellis2/omalley_solid06.glb --voxel 0.006 --close 3.5 --no-uv` → `keep_face.py omalley_solid06.glb omalley_gemini_real_fix.glb omalley_keep06.glb --image <P>/inputs/omalley_gemini_real_rgba.png`（第 4 列再加 `--hair-mesh omalley_smooth.glb --hair-smooth 60`）。
- 坑：(1) 他的頭髮是紅、粉、藍三色，舊的「粉紅」判斷把紅藍當皮膚 → 改成色相（皮膚約 5～60°、飽和度 0.4 以下算皮膚）；(2) 頭頂底下看得到頭皮，「最近點顏色」不可靠 → 面向鏡頭的點用 TRELLIS 輸入圖投影判斷，其餘看沿法線往內打到的顏色；(3) numpy `a[idx] |= b` 重複索引只留最後一筆，遮罩成長、侵蝕全錯 → 用 `np.logical_or.at`；(4) 藍色刺青被當頭髮留下凹坑 → 被臉包住的頭髮小島算臉；(5) 落在 TRELLIS 破洞上的點會凹下去 → 改用鄰點補平；(6) 細網格（19 萬點）跑 xatlas 超過 45 分鐘沒完 → `solid_head --no-uv` 只做形狀，UV 等形狀定案、減面後再做。
- 試過不行：細網格上 Taubin 平滑 120 次磨不掉捲髮塊（凹凸跨太多點）；`--close` 開到 6、10 會沿法線推擠自己摺起來；把頭髮貼到 `omalley_smooth` 表面會摺出細皺（第 4 列），再體素重建變成滿是小孔；`omalley_smooth` 細分後貼臉，UV 接縫把網格切開、分類變一塊塊。
- 下一步：使用者選頭髮（第 3 或 4 列）→ 減面到約 6 萬面＋xatlas UV → `gemini_paint.py` 上色（要再呼叫 Gemini 先問，剩 1 次）。第 3、4 列臉上看得到原始網格的平面三角形，上色後應該不明顯；不要用 `exaggerate_head --jaw`。
- **使用者選第 3 列（捲髮塊）**。減面＋UV＋烘底色：`solid_head.py <P>/trellis2/omalley_gemini_real_fix.glb <P>/trellis2/omalley_keep06_uv.glb --shape <P>/trellis2/omalley_keep06.glb --faces 60000`（約 1 分鐘，UV 用到 58%）→ `om_keep06_uv_turn.png`、`clay_omalley_keep06_uv.png`：臉型不變，平滑著色後三角形看不出來，頭頂幾點黑斑。下一步：`gemini_paint.py --mesh omalley_keep06_uv --fighter omalley --style painted --occlusion --thr 0.0001 --green-margin 2 --fill 12 --tag _ar` → `degreen.py` → `attach_head.py`（Gemini 剩 1 次，先問）。
- **上色（同日，使用者同意，Gemini 第 7 次）**：`uv run --no-project --with google-genai --with google-auth --with pillow --with numpy --with trimesh python -I pipeline/img2_3d/gemini_paint.py --mesh omalley_keep06_uv ...`（TRELLIS venv 沒有 google-genai，直接用 venv 跑會在呼叫前失敗）→ `degreen.py`（171 點）→ `attach_head.py`（`omalley_painted/skinned.blend`，參數同 Topuria 加 `--toon`）→ `om_body_keep.png`、`om_body_keep_close.png`；新舊對照 `om_keep_vs_old_close.png`（上舊、下新）。結果：臉變回長窄臉，捲髮塊有蓬度，舊版臉頰那道粉紅消失。還有：後頸髮際下一塊偏白、右側瀏海下幾小塊膚色縫、脖子刺青和身體交界照舊。

## 量產前的兩個預設：先看灰模、臉不磨（2026-11-15）
- 原因：O'Malley 用了 7 次 Gemini，好幾次畫在臉型不對的頭上；臉是被 `smooth_head` 的頭髮遮罩磨掉的。Topuria（短髮）整條流程沒這個問題。
- `gemini_paint.py`：要呼叫 Gemini 時沒有 `--shape-ok` 就停，先用 `render_turntable.py --clay --head 1.0` 出 `_img2_3d/clay_<mesh>.png`。把灰模和選手照片一起給使用者看，他說頭型、臉型對了才加 `--shape-ok`。`--reuse` 不受影響。
- `smooth_head.py`：臉中段（眼睛下緣到鼻尖、左右各 0.2 頭高、正面）權重歸零，永遠不磨；頭髮遮罩蓋到這一區超過 `--face-max 0.1` 就印 ERROR、不存檔、結束碼 1。實測 Topuria 1.5%（遮罩 66664 → 66657 點，輸出幾乎不變）、O'Malley 實心頭 19%、原始網格 22%。被擋下就走捲髮流程（`solid_head --no-uv` → `keep_face --image` → `solid_head --shape --faces 60000`）；`--force` 照舊輸出。門檻只有兩位選手的數字，第三位之後再看要不要調。
- `exaggerate_head.py`：`--jaw` 預設 1.12 → 1.0（加寬下巴是個人臉型，不是畫風）；`--brow`、`--chin` 沒動。
- 還沒做的想法：頭髮不從照片重建，改成一小組髮型塊套到頭上（等下一位難髮型的選手再試）；身體改成 3～4 種體型範本共用。
