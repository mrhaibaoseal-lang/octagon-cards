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
