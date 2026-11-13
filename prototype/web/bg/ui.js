// Octagon Cards — one-on-one board battler, browser front end. Rules live in engine.js / ai.js; this file draws and forwards clicks.
import * as E from "./engine.js";
import { paintArena } from "./arena.js";
import { shop as aiShop, fight as aiFight, cornerPick, groundWeights, groundPick, groundRead, g21Threshold, g21Pick, g21Smart, pokerStyle, pokerPick, pokerRead, eaTable, eaPick, eaRead } from "./ai.js";

const params = new URLSearchParams(location.search);
const load = async (n) => (await fetch(`rules/bg/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SCHOOL = { punch: "拳", kick: "踢", grap: "摔", def: "防" };
const KW = { guard: "架擋", slip: "閃躲", flurry: "連打", sweep: "掃", sub: "降伏", takedown: "抱摔", sprawl: "防摔", getup: "起身", ground: "地面技", combo: "連段", reach: "長距離" };
const KW_TEXT = {
  guard: () => "對手必須先打這張", slip: () => "躲掉打向它的第一下", flurry: () => "一次出手打兩下", sweep: () => "同時打到目標左右兩張",
  sub: (c) => c.ground.mode === "poker" ? "地面撲克：側壓以上，攤牌贏的牌型夠大就降伏，比賽結束（要多大看這張牌自己的地面效果）" : c.ground.mode === "21" ? `地面：你在上位時，總和 ${c.ground21.subAt} 就算降伏（本來要剛好 ${c.ground21.bust}），傷害 ${c.ground21.submit}` : `地面猜拳：降伏傷害依位置 ${c.ground.moves.sub.hit.byLayer.join(" / ")}（${c.ground.layerNames.join(" / ")}）；你有這張時算深一層`,
  takedown: (c) => c.ground.mode === "poker" ? "打中就把這一段帶到地面，你在上位，開始撲克地面：體力當籌碼（一段一次）" : c.ground.mode === "21" ? "打中就把這一段帶到地面，你在上位，開始比點數（一段一次）" : `打中就把這一段帶到地面，你在上位，開始最多 ${c.ground.beats} 拍的猜拳（一段一次）。你在下位時轉身逃脫贏了，會翻到上位`,
  sprawl: () => "只要這張還在場上，對手的抱摔都不成功",
  getup: (c) => c.ground.mode === "poker" ? "地面撲克：沒有單獨的效果，看這張牌自己的地面效果" : c.ground.mode === "21" ? `地面：你在下位時，爆牌線 +${c.ground21.upAdd}` : `地面猜拳：你在下位時，爆發起身贏了多脫 ${c.ground.extra} 層`,
  ground: (c) => c.ground.mode === "poker" ? "地面撲克：沒有單獨的效果，看這張牌自己的地面效果" : c.ground.mode === "21" ? `地面：你在上位時，每有一張起手總和 +1（最多 +${c.ground21.startCap}）` : `地面猜拳：你每有一張，砸擊多 ${c.ground.moves.strike.hit.perCard} 傷害`,
  combo: (c) => `前一張出手的也是連段牌：這一下 +${c.combo.atk} 攻擊，可累積到 +${c.combo.atk * c.combo.max}`,
  reach: () => "這張出手時不會被反擊",
};
// the EA ground: the same keywords, what they do there (each card has its own small effect, shown on the tag in the ground)
const KW_EA = {
  sub: () => "地面（EA 式）：你的降伏少一關；降伏要先把他打累、壓到深處才鎖得住",
  takedown: (c) => `打中就把這一段帶到地面，你在上位，最多 ${c.groundEA.beats} 拍；每一拍雙方同時往一個方向拖（一段一次）`,
  getup: () => "地面（EA 式）：你在下位，第一次只要擋住 1 次就脫出一層",
  ground: () => "地面（EA 式）：看這張牌自己的地面效果",
};
const WHEN = { start: "開場", hit: "命中", play: "上場", buy: "成長", break: "破解時", win: "獲勝" };
// Clash playback pace. 1 is the original tempo; the default is the slow one so each exchange can be read.
const SPEEDS = [0.45, 0.9, 1.8], SPEED_NAME = ["慢", "普通", "快"];
const saved = (() => { try { return Number(localStorage.getItem("bg.speed")) || 0; } catch { return 0; } })();
let speedIx = saved in SPEEDS ? saved : 0;

let data, st, speed = params.has("fast") ? 0 : SPEEDS[speedIx], choice = { a: null, b: null }, sel = null, runId = 0;
const frame = $("#frame");
const sleep = (ms) => new Promise((r) => setTimeout(r, speed === 0 ? 0 : ms / speed));
const scale = () => Math.min(innerWidth / 844, innerHeight / 390);
function fit() { frame.style.transform = `scale(${scale()})`; }
addEventListener("resize", fit);

async function boot() {
  const [config, skills, fighters] = await Promise.all([load("config"), load("skills"), load("fighters")]);
  data = E.prepare({ config, skills: strip(skills), fighters: strip(fighters) });
  if (params.has("ground")) data.config.ground.mode = ["21", "poker", "ea"].includes(params.get("ground")) ? params.get("ground") : "rps"; // ?ground=21 / rps / poker / ea picks the ground game
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  paintArena().then((u) => { if (u) frame.style.backgroundImage = `url(${u})`; });
  await loadManifest();
  if (params.has("jump")) return jumpToGround();
  menuScreen();
}
/** A new match between the two chosen fighters: the shop opens. */
async function startGame() {
  await loadArt([choice.a, choice.b]);
  st = E.createGame(data, choice.a, choice.b, Number(params.get("seed")) || (Date.now() % 2147483647));
  sel = null;
  shopScreen();
}
/** ?jump=top / ?jump=bottom: skip the pick screen and the shop, give both sides the same three tier-1 cards and start the first clash on the mat (you on top or underneath). */
let jumpSide = null;
async function jumpToGround() {
  await loadArt([choice.a, choice.b]);
  st = E.createGame(data, choice.a, choice.b, Number(params.get("seed")) || (Date.now() % 2147483647));
  const t1 = Object.keys(data.skills).filter((id) => data.skills[id].tier === 1).slice(0, 3);
  for (const s of ["a", "b"]) t1.forEach((id, i) => (st[s].board[i] = E.make(st, id)));
  jumpSide = params.get("jump") === "bottom" ? "b" : "a";
  clash(++runId);
}

// ---------- fighters on the stage ----------
// Sprites come from assets/private (gitignored). Without them a plain coloured dummy stands in.
const POSES = ["idle", "punch", "kick", "shoot", "hit", "down"], POSE_OF = { punch: "punch", kick: "kick", grap: "shoot", def: "punch" };
const kk = () => (ground ? 0.62 : 1); // the ground games lay their panels out around small fighters
const art = {}, poseT = {};
let manifest = null;
const loadImage = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
async function loadManifest() { if (!manifest) { try { const r = await fetch("assets/private/manifest.json"); manifest = r.ok ? await r.json() : {}; } catch { manifest = {}; } } }
const hasArt = (id) => !!manifest?.fighters?.[id];
async function loadArt(ids) {
  await loadManifest();
  await Promise.all(ids.map(async (id) => {
    if (art[id]) return;
    const meta = manifest.fighters?.[id], poses = {};
    if (meta) await Promise.all(POSES.map(async (p) => { const img = await loadImage(`assets/private/${id}/${p}.png`); if (img) poses[p] = { src: img.src, w: img.naturalWidth, h: img.naturalHeight, ax: meta[p]?.anchorX ?? img.naturalWidth / 2 }; }));
    art[id] = poses;
  }));
}
/** Put side s in a pose; with ms it goes back to idle afterwards. */
let ground = null;
const basePose = (s) => (!ground ? "idle" : ground.top === s ? "shoot" : "down");
function pose(s, name, ms) {
  const n = $("#f" + s);
  if (!n) return;
  if (name === "idle") name = basePose(s);
  clearTimeout(poseT[s]);
  const set = art[st[s].id] || {}, p = set[name] || set.idle, K = kk();
  n.dataset.pose = name;
  n.firstChild.innerHTML = p ? `<img src="${p.src}" style="width:${p.w * K}px;height:${p.h * K}px;left:${-p.ax * K}px">` : `<div class="dummy"><i></i></div>`;
  if (ms) poseT[s] = setTimeout(() => pose(s, "idle"), ms / (speed || 1));
}
/** A fighter does something: attack (with the card's school), hit, slip, down. */
function act(s, kind, school) {
  const n = $("#f" + s);
  if (!n) return;
  if (kind === "down") return pose(s, "down");
  if (speed === 0) return;
  const move = (frames, ms) => n.firstChild.animate(frames, { duration: ms / speed, easing: "ease-out" });
  const under = ground && ground.top !== s; // the one underneath stays down: only a nudge and a flash
  if (kind === "attack") { if (!under) pose(s, ground ? "punch" : POSE_OF[school] || "punch", 380); move([{ transform: "translateX(-6px)" }, { transform: "translateX(30px)", offset: 0.4 }, { transform: "translateX(30px)", offset: 0.75 }, { transform: "none" }], 380); }
  else if (kind === "hit") { if (!under) pose(s, "hit", 320); move([{ transform: "none", filter: "brightness(2.2)" }, { transform: "translateX(-14px)", filter: "brightness(1)", offset: 0.35 }, { transform: "none" }], 320); }
  else if (kind === "slip") move([{ transform: "none" }, { transform: "translateX(-20px) rotate(-10deg)", offset: 0.4 }, { transform: "none" }], 340);
}
/** Where a floating number for side s appears: over the fighter's chest. */
function fighterPos(s) {
  const n = $("#f" + s);
  if (!n) return { x: s === "a" ? 344 : 500, y: 230 };
  const r = n.getBoundingClientRect(), f = frame.getBoundingClientRect(), k = scale();
  return { x: (r.left - f.left) / k, y: (r.top - f.top) / k - (ground ? 45 : 100) };
}

// ---------- cards ----------
// The four kinds of card, drawn as small icons on the dark side of the card.
const KIND = { punch: "p", kick: "k", def: "d", grap: "g" };
const ICON = {
  p: '<svg viewBox="0 0 24 24"><path d="M4 10c0-2.4 1.6-4 4-4h8.5C19 6 20.5 7.6 20.5 10v3.5c0 3-2.2 5-5.2 5H9.5C6.3 18.5 4 16.3 4 13.5z" fill="#17120a"/><path d="M8.8 6.5v5M12.3 6.5v5M15.8 6.5v5" stroke="rgba(255,235,190,.75)" stroke-width="1.3" fill="none"/><path d="M4.5 12.5h7.5c1.8 0 1.8 3 0 3H8" stroke="rgba(255,235,190,.75)" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
  k: '<svg viewBox="0 0 24 24"><path d="M5 4.5l8 5.5-3.5 7.5H19" fill="none" stroke="#0b1512" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 5.5h4.5M18.5 9.5h3" stroke="#0b1512" stroke-width="1.6" stroke-linecap="round"/></svg>',
  d: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.8-3.2 7.8-7.5 9.5-4.3-1.7-7.5-4.7-7.5-9.5V6z" fill="#0d1420"/><path d="M12 6.5v10.5M8 9.5h8" stroke="rgba(215,230,255,.7)" stroke-width="1.4" fill="none"/></svg>',
  g: '<svg viewBox="0 0 24 24"><path d="M5 17V9.5a4.5 4.5 0 0 1 9 0V12" fill="none" stroke="#1a0c22" stroke-width="3.6" stroke-linecap="round"/><path d="M19 7v7.5a4.5 4.5 0 0 1-9 0V12" fill="none" stroke="#1a0c22" stroke-width="3.6" stroke-linecap="round"/></svg>',
};
/** The one-line effect shown on a shop offer: the card's own text, or what its keyword does. */
function effectLine(d) {
  if (d.text && d.fx.some((f) => f.when !== "ground")) return d.text;
  const k = d.kw[0];
  if (k) { const t = data.config.ground.mode === "ea" && KW_EA[k] ? KW_EA[k] : KW_TEXT[k]; return `${KW[k]}：${t(data.config)}`; }
  return "沒有特殊效果，就是數值高";
}
/** One card. c = a board card / clash unit / { id } for a shop offer. o: side ("b" mirrors it), offer (taller, with the effect line), flag, cls, attr, note */
const LV_TAG = { 2: "Lv2", 3: "Lv3", 4: "Lv4 腰帶" }, LV_FRAME = { 2: "銀框", 3: "金框", 4: "冠軍腰帶" };
function card(c, o = {}) {
  const d = data.skills[c.id], lv = c.lv || 1, m = data.config.levelMul[lv - 1];
  const atk = c.pow ?? c.atk ?? d.atk, hp = c.hp ?? d.hp, kw = c.kw ? Object.keys(c.kw) : d.kw, off = c.pow === 0 && c.atk > 0;
  const up = (v, base) => (v > Math.round(base * m) ? "up" : v < Math.round(base * m) ? "down" : "");
  const when = [...new Set(d.fx.map((f) => (f.when === "ground" ? (data.config.ground.mode === "poker" ? "地面" : null) : WHEN[f.when])).filter(Boolean))];
  const bad = [c.stun ? "被壓制" : "", off ? "地面出不了手" : "", c.worn ? `腿傷 −${c.worn}` : ""].filter(Boolean);
  const tags = [...bad.map((t) => `<i>${t}</i>`), ...kw.map((k) => KW[k]), ...when].join(" · ");
  const aCls = [up(atk + (c.worn || 0), d.atk), c.worn || (c.pow != null && c.pow < c.atk) ? "down" : ""].join(" ");
  const head = `<div class="ty k-${KIND[d.school]}"><b>${ICON[KIND[d.school]]}</b><i class="lv"><u>${"★".repeat(d.tier)}</u></i></div>
      <div class="tx"><div class="nm">${esc(d.name)}</div><div class="tg">${tags}</div></div>
      <div class="st atk"><b class="lat ${aCls}">${atk}</b></div><div class="st dur"><b class="lat ${up(hp, d.hp)}">${Math.max(0, hp)}</b></div>`;
  const body = o.offer ? `<div class="card"><div class="top">${head}</div><div class="fxt ${o.note ? "note" : ""}"><span>${esc(o.note || effectLine(d))}</span></div></div>` : `<div class="card">${head}</div>`;
  return `<div class="sk ${lv > 1 ? "l" + lv : ""} ${o.side === "b" ? "r" : ""} ${o.offer ? "of" : ""} ${c.dead ? "dead" : ""} ${off ? "off" : ""} ${o.cls || ""}" data-id="${c.id}" data-kw="${kw.join(",")}" data-atk="${atk}" data-hp="${Math.max(0, hp)}" ${c.lv ? `data-lv="${lv}"` : ""} ${c.worn ? `data-worn="${c.worn}"` : ""} ${o.note ? `data-note="${esc(o.note)}"` : ""} ${o.attr || ""}>
    ${lv > 1 ? `<i class="ltag lat">${LV_TAG[lv]}</i>` : ""}${o.flag ? `<div class="flag"><span>${esc(o.flag)}</span></div>` : ""}${body}</div>`;
}

// ---------- card details: mouse over a card, or press and hold on touch ----------
let tipEl = null, tipAt = null, mouse = null, holdT = 0, held = false, downAt = null;
const cardAt = (t) => (t instanceof Element ? t.closest(".sk[data-id]") : null);
function showTip(node) {
  const d = data.skills[node.dataset.id], kws = node.dataset.kw ? node.dataset.kw.split(",") : [], lv = Number(node.dataset.lv || 1), M = data.config.levelMul, maxLv = data.config.maxLevel;
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "tip"; }
  tipEl.className = d.school;
  tipEl.innerHTML = `<b>${esc(d.name)}</b><span>${SCHOOL[d.school]}・第 ${d.tier} 級商店${node.dataset.lv ? `・Lv${lv}${lv > 1 ? "（" + LV_FRAME[lv] + "）" : ""}` : ""}</span>
    <div class="st"><i class="atk">${node.dataset.atk}</i>攻擊<i class="hp">${node.dataset.hp}</i>耐力</div>
    ${d.fx.some((f) => f.when !== "ground") ? `<p>${esc(d.text)}</p>` : ""}${data.config.ground.mode === "poker" ? d.fx.filter((f) => f.when === "ground").map((f) => `<p><em>地面</em>${esc(f.text)}</p>`).join("") : ""}${kws.map((k) => `<p><em>${KW[k]}</em>${data.config.ground.mode === "ea" && KW_EA[k] ? KW_EA[k](data.config) : KW_TEXT[k](data.config)}</p>`).join("")}
    ${node.dataset.worn ? `<p class="dim">腿傷：攻擊 −${node.dataset.worn}，這回合結束才恢復。</p>` : ""}
    ${!d.fx.length && !kws.length ? `<p class="dim">沒有特殊效果，就是數值高。</p>` : ""}
    ${node.dataset.lv ? `<p class="dim">${lv > 1 ? `Lv${lv}：數值與效果的數字 ×${M[lv - 1]}。` : ""}${lv < maxLv ? `再買 1 張一樣的，升 Lv${lv + 1}（${M[lv]} 倍${data.config.rewardAt.includes(lv + 1) ? "，還能免費三選一" : ""}）。` : "已是最高級，再買一樣的就是一張新牌。"}</p>` : ""}${node.dataset.note ? `<p class="note">${esc(node.dataset.note)}</p>` : ""}`;
  if (tipEl.parentNode !== frame) frame.appendChild(tipEl);
  const p = pos(node), h = node.offsetHeight / 2, w = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let y = p.y - h - th - 6;
  if (y < 4) y = Math.min(p.y + h + 6, 390 - th - 4);
  tipEl.style.left = Math.max(6, Math.min(844 - w - 6, p.x - w / 2)) + "px";
  tipEl.style.top = y + "px";
  tipAt = node;
}
function hideTip() { if (tipEl) tipEl.remove(); tipAt = null; }
frame.addEventListener("pointermove", (e) => {
  if (drag?.ghost) return;
  if (e.pointerType !== "mouse") { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) { clearTimeout(holdT); if (held) hideTip(); } return; }
  mouse = { x: e.clientX, y: e.clientY };
  const c = cardAt(e.target);
  if (c !== tipAt) c ? showTip(c) : hideTip();
});
frame.addEventListener("pointerleave", () => { mouse = null; hideTip(); });
frame.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  const c = cardAt(e.target);
  clearTimeout(holdT); held = false; downAt = { x: e.clientX, y: e.clientY };
  if (c) holdT = setTimeout(() => { held = true; if (c.isConnected) showTip(c); }, 350);
});
for (const t of ["pointerup", "pointercancel"]) frame.addEventListener(t, (e) => { if (e.pointerType === "mouse") return; clearTimeout(holdT); downAt = null; if (held) hideTip(); });
// A press that showed the details is not a buy / select.
frame.addEventListener("click", (e) => { if (held || dragged) { held = dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
frame.addEventListener("contextmenu", (e) => { if (cardAt(e.target)) e.preventDefault(); });
// The screen redraws under a still cursor: follow whatever card is there now.
new MutationObserver(() => {
  if (!tipAt || tipAt.isConnected) return;
  const c = mouse && cardAt(document.elementFromPoint(mouse.x, mouse.y));
  c ? showTip(c) : hideTip();
}).observe(frame, { childList: true, subtree: true });

// ---------- drag and drop (pointer events: mouse and touch alike) ----------
// A screen sets dnd = { hot(from, under) -> element to light up | null, drop(from, under) }. Cards with data-drag can be picked up.
let dnd = null, drag = null, dragged = false;
// hot() may return one element or a list: the first is the target, the rest light up as also hit (a sweep's neighbours).
function lightHot(hot) {
  const list = hot ? [].concat(hot).filter(Boolean) : [];
  if (drag && drag.hot && drag.hot.length === list.length && drag.hot.every((n, i) => n === list[i])) return;
  drag?.hot?.forEach((n) => n.classList.remove("hot", "hot2"));
  list.forEach((n, i) => n.classList.add(i ? "hot2" : "hot"));
  if (drag) drag.hot = list.length ? list : null;
}
// Attacks are aimed with an arrow from the card (the card itself stays put).
function arrowEl() {
  const g = document.createElement("div");
  g.className = "aim";
  g.innerHTML = `<svg width="844" height="390" viewBox="0 0 844 390"><defs><linearGradient id="aimg" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff5a3c" stop-opacity=".15"/><stop offset="1" stop-color="#ffd24a"/></linearGradient></defs>
    <path class="aim-b" fill="none"/><path class="aim-l" fill="none" stroke="url(#aimg)"/><g class="aim-h"><path d="M-13,-12 L15,0 L-13,12 L-6,0 Z"/></g><circle class="aim-o" r="6"/></svg>`;
  return g;
}
function aimAt(g, a, b) {
  const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - Math.max(30, Math.abs(b.x - a.x) * 0.25);
  const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  g.querySelector(".aim-b").setAttribute("d", d); g.querySelector(".aim-l").setAttribute("d", d);
  const gr = g.querySelector("#aimg"); gr.setAttribute("x1", a.x); gr.setAttribute("y1", a.y); gr.setAttribute("x2", b.x); gr.setAttribute("y2", b.y);
  const ang = (Math.atan2(b.y - my, b.x - mx) * 180) / Math.PI;
  g.querySelector(".aim-h").setAttribute("transform", `translate(${b.x},${b.y}) rotate(${ang})`);
  const o = g.querySelector(".aim-o"); o.setAttribute("cx", a.x); o.setAttribute("cy", a.y);
}
const under = (e) => { const n = document.elementFromPoint(e.clientX, e.clientY); return n instanceof Element && frame.contains(n) ? n : null; };
function endDrag() {
  if (!drag) return;
  drag.ghost?.remove(); drag.n.classList.remove("lift", "aiming"); lightHot(null);
  frame.classList.remove("dragging", "drag-" + drag.n.dataset.drag);
  drag = null;
}
frame.addEventListener("pointerdown", (e) => {
  const n = e.target instanceof Element ? e.target.closest("[data-drag]") : null;
  endDrag();
  if (n && dnd && e.button <= 0) drag = { n, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, hot: null };
});
addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    if (!drag.n.isConnected) return endDrag();
    if (dnd?.arrow) {
      drag.ghost = arrowEl(); frame.appendChild(drag.ghost);
      drag.n.classList.add("aiming"); frame.classList.add("dragging", "drag-" + drag.n.dataset.drag);
      clearTimeout(holdT); hideTip();
    } else {
    const g = (drag.ghost = drag.n.cloneNode(true));
    for (const a of ["data-uid", "data-drag", "data-slot", "data-offer"]) g.removeAttribute(a);
    g.classList.add("ghost"); g.classList.remove("sel", "can");
    g.style.width = drag.n.offsetWidth + "px"; g.style.height = drag.n.offsetHeight + "px";
    frame.appendChild(g);
    drag.n.classList.add("lift"); frame.classList.add("dragging", "drag-" + drag.n.dataset.drag);
    clearTimeout(holdT); hideTip();
    }
  }
  const f = frame.getBoundingClientRect(), k = scale(), p = { x: (e.clientX - f.left) / k, y: (e.clientY - f.top) / k };
  const u = under(e), hot = (u && dnd?.hot(drag.n, u)) || null;
  lightHot(hot);
  if (drag.ghost.classList.contains("aim")) {
    const t = drag.hot ? pos(drag.hot[0]) : p;
    aimAt(drag.ghost, pos(drag.n), t);
    drag.ghost.classList.toggle("on", !!drag.hot);
  } else { drag.ghost.style.left = p.x + "px"; drag.ghost.style.top = p.y + "px"; }
});
addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const was = drag, u = was.ghost ? under(e) : null;
  endDrag();
  if (!was.ghost) return;
  dragged = true; setTimeout(() => (dragged = false), 0);
  if (u && dnd && was.n.isConnected) dnd.drop(was.n, u);
});
addEventListener("pointercancel", endDrag);

const empty = (o = {}, text = "空位") => `<div class="sk empty ${o.cls || ""} ${o.side === "b" ? "r" : ""}" ${o.attr || ""}><div class="card">${text}</div></div>`;
const backCard = () => `<div class="sk back r"><div class="card lat">?</div></div>`;

// ---------- the broadcast frame shared by the screens ----------
const nameParts = (f) => { const [first, ...rest] = f.name.split(" "); return [first, rest.join(" ") || first]; };
const portrait = (id) => (hasArt(id) ? `<img src="assets/private/${id}/portrait.png" alt="" onerror="this.remove()">` : "");
const pokerOn = () => st.cfg.ground.mode === "poker";
/** Stamina is shown under each fighter's durability in the poker and the EA grounds. */
const staOn = () => st.cfg.ground.mode === "poker" || st.cfg.ground.mode === "ea";
const staMax = () => (st.cfg.ground.mode === "ea" ? st.cfg.groundEA : st.cfg.groundPoker).stamina;
/** A fighter's name plate: face, name, durability bar and number (stamina bar when the ground game uses it). */
function plate(s, hp = st[s].hp) {
  const F = st[s], f = F.f, pct = Math.max(0, Math.min(100, (hp / st.cfg.hp) * 100));
  const sta = staOn() ? `<div class="stam" data-s="${s}" title="體力"><i><b class="${F.stam <= 5 ? "low" : ""}" style="width:${(F.stam / staMax()) * 100}%"></b></i><span>體力 ${F.stam}</span></div>` : "";
  return `<div class="plate" id="hud${s}" title="${esc(f.name)}｜${esc(f.style)}｜${esc(f.power.text)}"><div class="face"><i>${portrait(F.id)}</i></div>
    <div class="who"><div class="nm1 lat">${esc(f.short.toUpperCase())}</div><div class="bars"><div class="hpb"><b style="${s === "a" ? "right" : "left"}:${100 - pct}%"></b></div><div class="num lat">${hp}</div></div>${sta}</div></div>`;
}
/** The two corner columns: blue (you) on the left, red (him) on the right. slots = the cards' html for each side. */
function cols(slots = { a: "", b: "" }, o = {}) {
  return `<div class="col a" id="colA">${plate("a", o.hp?.a)}<div class="slots" id="rowA">${slots.a}</div></div>
    <div class="col b" id="colB">${plate("b", o.hp?.b)}<div class="slots" id="rowB">${slots.b}</div>${o.note ? `<div class="cardnote"><span>${o.note}</span></div>` : ""}</div>`;
}
/** The round clock at the top centre: round and clash, the clash score (or a caption), and a pip per round (blue / red = who took it). */
function clock(o = {}) {
  const pips = Array.from({ length: st.cfg.rounds }, (_, i) => { const r = st.rounds[i]; return `<i class="${r ? (r.a > r.b ? "wa" : r.b > r.a ? "wb" : "wt") : i === st.round - 1 ? "on" : ""}"></i>`; }).join("");
  const score = o.mid ?? `<div class="s lat"><i class="a"></i>${st.wins.a} — ${st.wins.b}<i class="b"></i></div>`;
  const card = st.rounds.length ? "計分卡 " + st.rounds.map((r) => `${r.a}-${r.b}`).join("、") : "";
  return `<div class="clock" title="${card}"><div class="r lat">${o.top ?? `ROUND <em>${st.round}</em> · 第 ${st.clash} 段`}</div>${score}<div class="pips">${pips}</div></div>`;
}
/** Stamina under each fighter's durability (poker and EA grounds). */
function setSta(stam) {
  if (!stam || !staOn()) return;
  for (const s of ["a", "b"]) {
    const w = $(`.stam[data-s="${s}"]`), b = w && w.querySelector("b");
    if (b) { b.style.width = (stam[s] / staMax()) * 100 + "%"; b.classList.toggle("low", stam[s] <= 5); w.querySelector("span").textContent = `體力 ${stam[s]}`; }
  }
}
function setHp(hp) {
  for (const s of ["a", "b"]) {
    const h = $("#hud" + s);
    if (!h) continue;
    h.querySelector(".num").textContent = hp[s];
    h.querySelector(".hpb b").style[s === "a" ? "right" : "left"] = 100 - Math.max(0, Math.min(100, (hp[s] / st.cfg.hp) * 100)) + "%";
  }
}
/** A modal sheet on top of the screen (rules, the free pick, the corner). */
function sheet(inner, close) {
  const d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="sheet">${inner}</div>`;
  if (close) d.addEventListener("click", (e) => { if (e.target === d) close(); });
  frame.appendChild(d);
  return d;
}

// ---------- screens: menu, how to play, pick ----------
function menuScreen() {
  runId++; dnd = null; sel = null;
  const art = (id, left, flip) => (hasArt(id) ? `<img class="art in ${flip ? "flip" : ""}" style="left:${left}px;bottom:54px;height:200px" src="assets/private/${id}/idle.png" alt="" onerror="this.remove()">` : "");
  frame.innerHTML = `<i class="sha" style="left:452px"></i><i class="sha" style="left:588px"></i>${art(choice.a, 462)}${art(choice.b, 598, true)}
    <div class="haze"></div><div class="shade m-menu"></div>
    <div class="strap"><span>FIGHT NIGHT</span></div>
    <h1 class="lat">OCTAGON<br><span>CARDS</span></h1><div class="rule"></div>
    <div class="menu">
      <button class="mi on" id="m-exh"><b>對戰</b><small class="lat">EXHIBITION</small><em>選兩個人打一場 ▸</em></button>
      <div class="mi"><b>衝冠短跑</b><small class="lat">TITLE RUN</small><em>之後開放</em></div>
      <div class="mi"><b>生涯</b><small class="lat">CAREER</small><em>之後開放</em></div>
      <div class="mi"><b>真實賽事</b><small class="lat">LIVE CARD</small><em>之後開放</em></div>
    </div>
    <div class="ticker"><b class="lat">MAIN EVENT</b><span>選兩位選手，打 <i>${data.config.rounds}</i> 回合：每段開打前先逛商店</span><button id="m-how">怎麼玩</button></div>`;
  $("#m-exh").onclick = pickScreen;
  $("#m-how").onclick = howSheet;
}
function howSheet() {
  const d = sheet(`<h2>怎麼玩<small class="lat">HOW TO PLAY</small></h2><div class="body">
    <p>每一段開打前逛<b>商店</b>：拿金幣買招式，擺在左邊你的六格裡，也能賣掉、換位置。</p>
    <p>開打後雙方<b>輪流出手</b>：輪到你時，把你的一張牌<b>拖過八角籠</b>，放在要打的那張牌上（他有架擋就得先打架擋）。把對方的牌打光，剩下的牌就打在<b>他本人</b>身上。</p>
    <p><b>抱摔</b>打中會把這一段帶到地面，改打地面小遊戲：上位贏了往深處壓或打人，下位贏了脫出。</p>
    <p>耐久歸零＝KO；降伏成功＝比賽結束；否則打完 <b>${data.config.rounds}</b> 回合，看三位裁判的計分卡。</p>
    <p>滑鼠指著牌（手機按住）可以看效果。</p></div>
    <div class="foot"><button class="go" id="how-ok"><span>知道了</span></button></div>`, () => d.remove());
  $("#how-ok").onclick = () => d.remove();
}

let pickSel = null; // a portrait picked by tapping, waiting for a corner
function pickScreen() {
  runId++; dnd = null; sel = null;
  const ids = Object.keys(data.fighters), A = data.fighters[choice.a], B = data.fighters[choice.b];
  const side = (s, f) => { const [first, last] = nameParts(f); return `<div class="pn ${s}"><small><span>${s === "a" ? "藍角 · 你" : "紅角 · 對手"}</span></small><p class="lat">${esc(first.toUpperCase())}</p><b class="lat">${esc(last.toUpperCase())}</b></div>`; };
  const art = (id, s) => (hasArt(id) ? `<img class="art ${s === "b" ? "flip" : ""}" style="${s === "a" ? "left" : "right"}:52px;bottom:70px;height:236px" src="assets/private/${id}/idle.png" alt="" onerror="this.remove()">` : "");
  frame.innerHTML = `<div class="shade m-pick"></div>${art(choice.a, "a")}${art(choice.b, "b")}
    <div class="dz a ${pickSel ? "want" : ""}" data-corner="a"></div><div class="dz b ${pickSel ? "want" : ""}" data-corner="b"></div>
    ${side("a", A)}${side("b", B)}
    <div class="clock"><div class="r lat">MAIN EVENT</div><div class="s t lat">${data.config.rounds} 回合</div></div>
    <div class="vs lat">VS</div>
    <div class="tape">
      <div class="tr"><span>${esc(A.style)}</span><i>風格</i><span>${esc(B.style)}</span></div>
      <div class="tr"><span>${esc(A.power.text)}</span><i>專長</i><span>${esc(B.power.text)}</span></div>
      <div class="tr"><span>${SCHOOL[A.ai.prefer] || "—"}</span><i>愛用</i><span>${SCHOOL[B.ai.prefer] || "—"}</span></div>
    </div>
    <button class="go" id="go" style="left:322px;width:200px;top:226px"><span>進場</span><small class="lat">WALKOUT</small></button>
    <div class="roster">${ids.map((id) => `<div class="pw ${choice.a === id ? "a" : ""} ${choice.b === id ? "b" : ""} ${pickSel === id ? "sel" : ""}" data-id="${id}" data-drag="face" title="${esc(data.fighters[id].name)}"><div class="pf"><i>${portrait(id)}</i></div></div>`).join("")}</div>
    <button class="btn l" id="back">‹ 選單</button>
    <div class="cue ${pickSel ? "hot" : ""}"><span>${pickSel ? `點藍角或紅角，讓 ${esc(data.fighters[pickSel].short)} 站進去` : "把頭像拖到藍角或紅角換人（或點頭像再點角落）"}</span></div>`;
  const assign = (corner, id) => { choice[corner] = id; pickSel = null; pickScreen(); };
  frame.querySelectorAll(".pw").forEach((n) => (n.onclick = () => { pickSel = pickSel === n.dataset.id ? null : n.dataset.id; pickScreen(); }));
  frame.querySelectorAll(".dz").forEach((z) => (z.onclick = () => { if (pickSel) assign(z.dataset.corner, pickSel); }));
  dnd = {
    hot: (from, u) => u.closest(".dz"),
    drop: (from, u) => { const z = u.closest(".dz"); if (z) assign(z.dataset.corner, from.dataset.id); },
  };
  $("#back").onclick = () => { pickSel = null; menuScreen(); };
  $("#go").onclick = () => { pickSel = null; dnd = null; startGame(); };
}

// ---------- shop ----------
function shopScreen(msg = "") {
  if (st.over) return finish();
  if (st.phase === "corner") return cornerScreen();
  const F = st.a, sh = F.shop, cfg = st.cfg.shop, N = st.cfg.slots, cells = E.cellCount(st);
  const merging = new Set(); // cells whose card one of the offers would level up
  const offers = sh.offers.map((id, i) => {
    if (!id) return empty({}, "已買");
    const p = E.place(st, "a", id), can = sh.gold >= cfg.cost && p, target = p && p.merge != null ? E.cellAt(st, "a", p.merge) : null;
    if (target) merging.add(p.merge);
    return card({ id }, { offer: true, cls: (can ? "buy" : "no") + (target ? " levels" : ""), attr: `data-offer="${i}"${can ? ' data-drag="offer"' : ""}`, flag: target ? `買下 → ${data.skills[id].name}升 Lv${target.lv + 1} ${LV_FRAME[target.lv + 1]}` : null, note: !p ? "技能列和備選都滿了，先賣一張" : null });
  }).join("");
  const cell = (i) => { const c = E.cellAt(st, "a", i); return c ? card(c, { cls: (sel === i ? "sel" : "") + (merging.has(i) ? " pair" : ""), attr: `data-slot="${i}" data-drag="slot"` }) : empty({ attr: `data-slot="${i}"` }, i < N ? "空位" : "備選"); };
  const mine = Array.from({ length: N }, (_, i) => cell(i)).join(""), bench = Array.from({ length: cells - N }, (_, i) => cell(N + i)).join("");
  const bad = /不夠|至少|滿了/.test(msg);
  const hint = msg || (sel == null ? "把招式拖到左邊空位就買 · 買到一樣的牌就升級 · 把自己的牌拖回中間賣掉 +" + cfg.sell + " 金" : "再點一格換位置，或按「賣掉」");
  const stars = "★".repeat(sh.tier);
  frame.innerHTML = `<div class="shade m-shop"></div>
    ${cols({ a: mine, b: Array.from({ length: st.cfg.slots }, backCard).join("") }, { note: "他的牌開打才看得到" })}
    ${clock({ top: `ROUND <em>${st.round}</em> · 第 ${st.clash} 段前`, mid: `<div class="s t lat">角落時間</div>` })}
    <div id="shopcol">
    <div id="store" data-sell="放這裡賣掉　+${cfg.sell} 金">
      <div class="sh"><b>教練的招式單</b><small><span class="stars">${stars}</span> 第 ${sh.tier} 級 · 每張 ${cfg.cost} 金</small>${sh.fresh ? `<span class="fresh">剛升級 · 免費換成新的一批</span>` : ""}<div class="coin"><i></i><span class="lat">${sh.gold}</span><small>金</small></div></div>
      <div class="offers">${offers}</div>
      <div class="alts">
        <button class="alt ${sh.gold >= cfg.reroll ? "" : "no"}" id="reroll"><span>重抽<small>${cfg.reroll} 金</small></span></button>
        <button class="alt ${sh.frozen ? "on" : ""}" id="freeze"><span>${sh.frozen ? "已留到下一段" : "留到下一段"}</span></button>
        <button class="alt ${E.canTier(st, "a") && sh.gold >= sh.upCost ? "" : "no"}" id="tier"><span>${E.canTier(st, "a") ? `升級招式單<small>${sh.upCost} 金</small>` : "招式單已最高級"}</span></button>
        ${sel != null ? `<button class="alt" id="sell"><span>賣掉<small>+${cfg.sell} 金</small></span></button>` : ""}
      </div>
    </div>
    <div class="blab"><b>備選</b><span>不上場 · 買到一樣的牌照樣升級 · 拖上去換人</span></div>
    <div id="bench">${bench}</div>
    <button class="go" id="fight"><span>開打</span><small class="lat">FIGHT</small></button>
    </div>
    <div id="say"><b class="${bad ? "bad" : "good"}"><span>${esc(hint)}</span></b></div>`;
  const buyAt = (i, slot = null) => {
    const id = sh.offers[i], p = id && E.place(st, "a", id);
    if (!E.buy(st, "a", i)) return shopScreen(sh.gold < cfg.cost ? "金幣不夠" : "技能列和備選都滿了，先賣掉一張");
    if (p.slot != null && slot != null && slot !== p.slot && !E.cellAt(st, "a", slot)) E.swap(st, "a", p.slot, slot);
    sel = null; shopScreen(p.merge != null ? `${data.skills[id].name}升到 Lv${E.cellAt(st, "a", p.merge).lv}` : `買了${data.skills[id].name}`);
  };
  const slotOf = (n) => { const x = n.closest("#colA [data-slot], #bench [data-slot]"); return x ? Number(x.dataset.slot) : null; };
  dnd = {
    hot: (from, u) => (from.dataset.drag === "offer" ? (u.closest("#colA, #bench") ? u.closest("#colA .sk.empty, #bench .sk.empty") || u.closest("#colA, #bench") : null) : u.closest("#store") || (slotOf(u) != null && slotOf(u) !== Number(from.dataset.slot) ? u.closest("[data-slot]") : null)),
    drop: (from, u) => {
      if (from.dataset.drag === "offer") { if (u.closest("#colA, #bench")) buyAt(Number(from.dataset.offer), slotOf(u)); return; }
      const i = Number(from.dataset.slot), j = slotOf(u);
      if (j != null && j !== i) { E.swap(st, "a", i, j); sel = null; shopScreen(); }
      else if (u.closest("#store")) { const nm = data.skills[E.cellAt(st, "a", i).id].name; E.sell(st, "a", i); sel = null; shopScreen(`賣掉${nm}`); }
    },
  };
  frame.querySelectorAll("[data-offer]").forEach((el) => (el.onclick = () => buyAt(Number(el.dataset.offer))));
  frame.querySelectorAll("#colA .sk[data-slot], #bench .sk[data-slot]").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.slot);
    if (sel == null) { if (E.cellAt(st, "a", i)) sel = i; } else { if (i !== sel) E.swap(st, "a", sel, i); sel = null; }
    shopScreen();
  }));
  if ($("#sell")) $("#sell").onclick = () => { E.sell(st, "a", sel); sel = null; shopScreen(); };
  $("#reroll").onclick = () => shopScreen(E.reroll(st, "a") ? "" : "金幣不夠");
  $("#freeze").onclick = () => { E.freeze(st, "a"); shopScreen(st.a.shop.frozen ? "招式單會留到下一段" : ""); };
  $("#tier").onclick = () => shopScreen(E.tierUp(st, "a") ? "招式單升級了：免費換成新等級的一批牌" : E.canTier(st, "a") ? "金幣不夠" : "");
  $("#fight").onclick = () => { if (!F.board.some(Boolean)) return shopScreen("至少要有一張牌"); sel = null; dnd = null; clash(++runId); };
  if (F.discover) discoverScreen();
}

function discoverScreen() {
  const F = st.a;
  const d = sheet(`<h2 class="gold">選一張，免費<small class="lat">FREE PICK</small></h2>
    <div class="offers">${F.discover.map((id, i) => card({ id }, { offer: true, cls: "buy of-big", attr: `data-pick="${i}"`, note: E.place(st, "a", id) ? null : "技能列和備選都滿了：選了也放不下" })).join("")}</div>`);
  d.querySelectorAll("[data-pick]").forEach((el) => (el.onclick = () => { const id = F.discover[el.dataset.pick]; E.pick(st, "a", Number(el.dataset.pick)); shopScreen(`拿到${data.skills[id].name}`); }));
}

function cornerScreen() {
  const last = st.rounds[st.rounds.length - 1], won = last.a > last.b ? "a" : last.b > last.a ? "b" : null;
  const mine = st.a.board.map((c) => (c ? card(c) : empty())).join("");
  frame.innerHTML = `<div class="shade m-shop"></div>
    ${cols({ a: mine, b: Array.from({ length: st.cfg.slots }, backCard).join("") }, { note: "他的牌開打才看得到" })}
    ${clock({ top: `ROUND <em>${st.round}</em> 結束`, mid: `<div class="s t lat">角落時間</div>` })}`;
  const d = sheet(`<h2 class="${won === "b" ? "red" : won === "a" ? "" : "gold"}">第 ${st.round} 回合結束：${won === "a" ? "你拿下" : won === "b" ? "他拿下" : "平手"}（${last.a}-${last.b}）<small class="lat">BETWEEN ROUNDS</small></h2>
    <div class="body"><p>這回合三段你贏 <b>${last.wins.a}</b> 段、他贏 <b>${last.wins.b}</b> 段。選一項，進下一回合。</p></div>
    <div class="sc">${st.rounds.map((r, i) => `<div class="${r.b > r.a ? "b" : r.a > r.b ? "" : "t"}"><small class="lat">R${i + 1}</small><b class="lat">${r.a}–${r.b}</b></div>`).join("")}</div>
    <div class="opts">${Object.entries(st.cfg.corner).map(([k, o]) => `<button class="opt" data-k="${k}"><b>${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join("")}</div>`);
  d.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { E.corner(st, "b", cornerPick(st, "b")); E.corner(st, "a", b.dataset.k); shopScreen(); }));
}

// ---------- clash ----------
function rows(v) {
  const row = (s) => v[s].map((u) => (u && !u.dead ? card(u, { side: s, attr: `data-uid="${u.uid}"` }) : empty({ side: s }, u ? "被破解" : ""))).join("");
  $("#rowB").innerHTML = row("b");
  $("#rowA").innerHTML = row("a");
  setGround(v.ground);
}
function setGround(g) {
  const was = ground, b = $("#gnd"), G = st.cfg.ground;
  ground = g || null;
  const ea = G.mode === "ea", m21 = G.mode === "21" || G.mode === "poker" || ea;
  frame.classList.toggle("gmode", !!ground && !m21);
  frame.classList.toggle("g21mode", !!ground && m21);
  frame.classList.toggle("eamode", !!ground && ea);
  frame.classList.toggle("pkmode", !!ground && G.mode === "poker");
  if (!ground) { $("#gpanel")?.remove(); $("#gtend")?.remove(); $("#g21")?.remove(); }
  if (b && m21) b.innerHTML = "";
  else if (b) {
    b.className = ground ? (ground.top === "a" ? "good" : "bad") : "";
    b.innerHTML = ground ? `<span>${ground.top === "a" ? "你在上位" : "你被壓在下面"}</span><span class="lad">${G.layerNames.map((n, i) => `<i class="${i + 1 === ground.layer ? "on" : ""}">${n}</i>`).join("")}</span><small>第 ${Math.min(ground.beat, G.beats)}／${G.beats} 拍</small>` : "";
  }
  if ((was && was.top) !== (ground && ground.top)) for (const s of ["a", "b"]) if ($("#f" + s)?.dataset.pose !== "down" || was) pose(s, "idle");
}
const el = (uid) => $(`[data-uid="${uid}"]`);
function pos(node) { const r = node.getBoundingClientRect(), f = frame.getBoundingClientRect(), k = scale(); return { x: (r.left - f.left + r.width / 2) / k, y: (r.top - f.top + r.height / 2) / k }; }
function float(at, text, cls) {
  if (!at) return;
  const f = document.createElement("div");
  f.className = "float " + cls;
  f.textContent = text;
  const ms = Math.min(1600, 900 / (speed || 1));
  f.style.left = at.x + "px"; f.style.top = at.y + "px"; f.style.animationDuration = ms + "ms";
  frame.appendChild(f);
  setTimeout(() => f.remove(), ms);
}
/** The strip at the bottom: gold when it is your move, red when it is his, dark for plain narration; small = the line above it. */
function say(text, cls = "", small = "") { const b = $("#say"), c = $("#cap"); if (b) b.innerHTML = text ? `<b class="${cls}"><span>${esc(text)}</span></b>` : ""; if (c) c.textContent = small; }
const unitOf = (v, uid) => { for (const s of ["a", "b"]) for (const u of v[s]) if (u && u.uid === uid) return u; return null; };
const nameOf = (v, uid) => { for (const s of ["a", "b"]) for (const u of v[s]) if (u && u.uid === uid) return data.skills[u.id].name; return ""; };
const sideOf = (v, uid) => (v.a.some((u) => u && u.uid === uid) ? "a" : "b");

/** Play one engine event on screen. Returns the time to hold it (ms). */
async function showEvent(e, prev) {
  switch (e.t) {
    case "clash": rows(e.view); say("開打！", "", `第 ${st.round} 回合・第 ${st.clash} 段`); return 700;
    case "fx": {
      const from = e.from ? el(e.from) : null;
      if (from) { from.classList.add("cast"); }
      rows(e.view);
      if (e.to) { float(el(e.to) && pos(el(e.to)), e.dmg ? `−${e.dmg}` : "閃開", "dmg"); act(sideOf(e.view, e.to), e.dmg ? "hit" : "slip"); }
      for (const uid of e.buff || []) float(el(uid) && pos(el(uid)), "強化", "buff");
      return 340;
    }
    case "attack": {
      const a = el(e.from), t = el(e.to), u = unitOf(prev, e.from);
      act(e.s, "attack", u && data.skills[u.id].school);
      if (a && t && speed !== 0) {
        const pa = pos(a), pt = pos(t);
        a.style.zIndex = 5;
        await a.animate([{ transform: "none" }, { transform: `translate(${(pt.x - pa.x) * 0.12}px,${(pt.y - pa.y) * 0.14}px) scale(1.1)`, filter: "brightness(1.5)" }, { transform: "none" }], { duration: 320 / speed, easing: "ease-in-out" }).finished;
        a.style.zIndex = "";
      }
      say(`${nameOf(prev, e.from)} → ${nameOf(prev, e.to)}`, e.s === "a" ? "good" : "bad", (e.s === "a" ? "你出手" : "他出手") + (e.combo ? `・連段 +${e.combo}` : ""));
      if (e.combo && a) float(pos(a), `連段 +${e.combo}`, "buff");
      return 0;
    }
    case "dmg": { const n = el(e.uid), p = n && pos(n); rows(e.view); act(sideOf(e.view, e.uid), "hit"); float(p, `−${e.dmg}`, "dmg"); const m = el(e.uid); if (m) m.classList.add("shake"); return 280; }
    case "slip": { const n = el(e.uid), p = n && pos(n); rows(e.view); act(sideOf(e.view, e.uid), "slip"); float(p, "閃開！", "buff"); return 300; }
    case "sub": float(el(e.uid) && pos(el(e.uid)), "降伏！", "dmg"); return 280;
    case "weaken": rows(e.view); float(el(e.uid) && pos(el(e.uid)), e.lasting ? "腿傷：攻擊下降" : "攻擊下降", "dmg"); return 240;
    case "ground": float(el(e.uid) && pos(el(e.uid)), "抱摔成功", "buff"); act(e.s, "attack", "grap"); rows(e.view); say(e.s === "a" ? "帶到地面！你在上位" : "被帶到地面！你在下面", e.s === "a" ? "good" : "bad", st.cfg.ground.mode === "21" ? "" : "地面猜拳：每拍暗選一招，同時翻開"); return 1200;
    case "gbeat": return gbeat(e);
    case "g21deal": case "g21hit": case "g21stand": case "g21end": case "g21cash": case "g21deep": return g21Event(e);
    case "pdeal": case "pact": case "pboard": case "pend": case "pcash": case "pdeep": case "psub": return pokerEvent(e);
    case "eadeal": case "eabeat": case "easubstart": case "easub": case "easubmit": return eaEvent(e);
    case "stuffed": float(el(e.uid) && pos(el(e.uid)), "防摔！", "buff"); say(e.s === "a" ? "你擋下了抱摔" : "他擋下了抱摔", e.s === "a" ? "good" : "bad", "防摔牌還在場上，抱摔就不會成功"); return 700;
    case "standup": rows(e.view); if (e.uid) float(el(e.uid) && pos(el(e.uid)), "起身", "buff"); say(e.uid ? (e.s === "a" ? "你站回來了" : "他站回來了") : "站起來了", "", e.uid ? "" : "回到站立"); return 800;
    case "stun": rows(e.view); float(el(e.uid) && pos(el(e.uid)), "被壓制", "dmg"); return 240;
    case "stunned": float(el(e.uid) && pos(el(e.uid)), "出不了手", "dmg"); rows(e.view); return 300;
    case "break": { const n = el(e.uid), p = n && pos(n); float(p, "破解", "break"); rows(e.view); return 280; }
    case "react": say(e.grade === "miss" ? "慢了" : e.grade === "perfect" ? "完美！" : "好！", e.grade === "miss" ? "bad" : "good"); return 250;
    case "clashend": {
      setGround(null);
      if (!e.dmg && st.over?.how === "SUB" && e.s) { say(e.s === "a" ? "降伏！你鎖死了他" : "降伏！你被鎖死了", e.s === "a" ? "good" : "bad", "比賽結束"); return 1500; }
      setHp(e.hp);
      const o = e.s ? E.other(e.s) : null;
      if (e.s) { $("#hud" + o).classList.add("hurt"); act(e.s, "attack", "punch"); act(o, e.hp[o] <= 0 ? "down" : "hit"); float(fighterPos(o), `−${e.dmg}`, "dmg"); say(e.s === "a" ? `這一段你贏了：他耐久 −${e.dmg}` : `這一段他贏了：你耐久 −${e.dmg}`, e.s === "a" ? "good" : "bad", "剩下的牌打在選手身上"); }
      else say("這一段平手", "", "雙方的牌都打光了");
      return 1300;
    }
    case "roundend": say(e.card.a > e.card.b ? "這回合你拿下" : e.card.b > e.card.a ? "這回合他拿下" : "這回合平手", e.card.a > e.card.b ? "good" : e.card.b > e.card.a ? "bad" : "", `${e.card.a}-${e.card.b}`); return 1100;
    default: return 0;
  }
}

function qte(p) {
  const q = st.cfg.react;
  if (speed === 0) return Promise.resolve("good");
  return new Promise((res) => {
    const box = $("#qte"), g0 = (1 - q.zone.good) / 2, p0 = (1 - q.zone.perfect) / 2, mine = p.s === "a", name = data.skills[p.u.id].name;
    el(p.u.uid)?.classList.add(mine ? "ace" : "warn");
    say(mine ? `你的${name}要出手！` : `他的${name}要打過來！`, mine ? "good" : "bad", mine ? "按準了傷害加成（空白鍵或點時機條）" : "按準了少吃傷害（空白鍵或點時機條）");
    box.innerHTML = `<button class="track"><i class="good" style="left:${g0 * 100}%;width:${q.zone.good * 100}%"></i><i class="perfect" style="left:${p0 * 100}%;width:${q.zone.perfect * 100}%"></i><b class="mark"></b></button>`;
    const mark = box.querySelector(".mark"), t0 = performance.now();
    let done = false, x = 0, raf = 0;
    const end = (grade) => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); removeEventListener("keydown", key);
      box.querySelector(".track").classList.add(grade);
      setTimeout(() => { box.innerHTML = ""; res(grade); }, 300);
    };
    const hit = () => { const d = Math.abs(x - 0.5); end(d <= q.zone.perfect / 2 ? "perfect" : d <= q.zone.good / 2 ? "good" : "miss"); };
    const key = (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); hit(); } };
    const tick = (now) => {
      const n = ((now - t0) / 1000) * q.speed;
      if (n >= q.sweeps) return end("miss");
      const f = n % 2;
      x = f <= 1 ? f : 2 - f;
      mark.style.left = x * 100 + "%";
      raf = requestAnimationFrame(tick);
    };
    box.querySelector(".track").onclick = hit;
    addEventListener("keydown", key);
    raf = requestAnimationFrame(tick);
  });
}

/** The player's attack: drag one of your lit cards onto one of his (or tap yours, then his). Resolves [attacker uid, target uid]. */
function pickAttack(o) {
  if (speed === 0) return Promise.resolve(aiFight(st, o, 1));
  return new Promise((res) => {
    const un = new Set(o.units.map((u) => u.uid)), tg = new Set(o.targets.map((u) => u.uid));
    let pick = o.units.length === 1 ? o.units[0].uid : null;
    const mark = () => {
      for (const uid of un) { const n = el(uid); if (n) { n.classList.add("can"); n.dataset.drag = "unit"; n.classList.toggle("sel", uid === pick); } }
      for (const uid of tg) el(uid)?.classList.add("tgt");
    };
    const done = (u, t) => { dnd = null; $("#rowA").onclick = $("#rowB").onclick = null; frame.querySelectorAll(".can,.tgt,.sel").forEach((n) => { n.classList.remove("can", "tgt", "sel"); delete n.dataset.drag; }); res([u, t]); };
    const uidOf = (n) => { const x = n.closest("[data-uid]"); return x ? Number(x.dataset.uid) : null; };
    $("#rowA").onclick = $("#rowB").onclick = (e) => { const uid = uidOf(e.target); if (un.has(uid)) { pick = uid; mark(); } else if (tg.has(uid) && pick != null) done(pick, uid); };
    const side = E.other(o.s);
    const alsoHit = (a, t) => {
      const au = o.units.find((x) => x.uid === a), row = st.c[side], tu = row.find((x) => x && x.uid === t);
      if (!au?.kw?.sweep || !tu) return [];
      return [row[tu.slot - 1], row[tu.slot + 1]].filter((x) => x && x.hp > 0).map((x) => el(x.uid));
    };
    dnd = {
      arrow: true,
      hot: (from, u) => { const t = uidOf(u); return tg.has(t) ? [u.closest("[data-uid]"), ...alsoHit(uidOf(from), t)] : null; },
      drop: (from, u) => { const a = uidOf(from), t = uidOf(u); if (un.has(a) && tg.has(t)) done(a, t); },
    };
    mark();
    const guarded = o.targets.length < st.c[E.other(o.s)].filter((u) => u && u.hp > 0).length;
    say("輪到你出手", "good", guarded ? "他有架擋：只能先打亮紅框的那張。把你的牌拖上去" : "把你的一張牌拖到要打的牌上（或先點你的，再點他的）");
  });
}

// ---------- the ground game ----------
const GN = (id) => st.cfg.ground.moves[id].name;
/** Show one revealed beat: both moves, who won, and what it did. */
async function gbeat(e) {
  const G = st.cfg.ground, mv = e.moves, bot = E.other(e.top), w = e.res === "top" ? e.top : e.res === "bottom" ? bot : null;
  const names = G.layerNames;
  let what = "";
  if (e.res === "tie") what = "互相抵消，位置不變";
  else if (e.res === "top") what = e.dmg ? `打在${bot === "a" ? "你" : "他"}身上 −${e.dmg}` : e.layer ? `推進到${names[e.layer - 1]}` : "";
  else what = e.flip ? "翻身，換到上位" : e.layer >= 1 ? `脫出一層，回到${names[e.layer - 1]}` : "脫出了，站起來";
  rows(e.view);
  say(`你出${GN(mv.a)}　他出${GN(mv.b)}`, w === "a" ? "good" : w === "b" ? "bad" : "", `${w ? (w === "a" ? "你贏了這一拍：" : "他贏了這一拍：") : "平手："}${what}`);
  $("#gpanel")?.querySelectorAll(".gm").forEach((n) => n.classList.toggle("won", n.dataset.m === mv.a && w === "a"));
  if (e.dmg) { setHp(e.hp); $("#hud" + bot)?.classList.add("hurt"); act(e.top, "attack", "grap"); act(bot, e.hp[bot] <= 0 ? "down" : "hit"); float(fighterPos(bot), `−${e.dmg}`, "dmg"); }
  else if (w) act(w, "attack", "grap");
  return 1900;
}
/** The player's move: pick one of the lit cards, then press Fight (or tap it again). The opponent's table is shown beside the fighters. */
function pickGround(o) {
  if (speed === 0) return Promise.resolve(groundRead(st, "a"));
  const G = st.cfg.ground, top = o.top === "a", role = top ? "top" : "bottom", ids = Object.keys(G.moves).filter((m) => G.moves[m].role === role), foeIds = Object.keys(G.moves).filter((m) => G.moves[m].role !== role);
  const w = groundWeights(st, "b"), beats = (m) => G.beat[m], beaten = (m) => Object.keys(G.beat).find((k) => G.beat[k] === m);
  return new Promise((res) => {
    let sel = null, done = false;
    const last = o.last?.a ? `你上一拍出${GN(o.last.a)}，他出${GN(o.last.b)}` : "";
    const stage = $("#stage");
    $("#gtend")?.remove(); $("#gpanel")?.remove();
    stage.insertAdjacentHTML("beforeend", `<div id="gtend"><h5>他這一拍的傾向</h5>${foeIds.map((m) => `<div class="tr ${w[m] ? "" : "na"}"><span>${G.moves[m].name}</span><i><b style="width:${Math.round((w[m] || 0) * 100)}%"></b></i><em>${w[m] ? Math.round(w[m] * 100) + "%" : "—"}</em></div>`).join("")}${last ? `<small>${last}</small>` : ""}</div>`);
    const draw = () => {
      let p = $("#gpanel");
      if (!p) { p = document.createElement("div"); p.id = "gpanel"; frame.appendChild(p); }
      p.className = done ? "done" : "";
      p.innerHTML = ids.map((m) => {
        const d = G.moves[m], ok = o.moves.a.includes(m), dmg = d.hit ? E.groundDamage(st, "a", m) : 0;
        return `<button class="gm ${role} ${ok ? "" : "lock"} ${sel === m ? "sel" : ""}" data-m="${m}"><b>${d.name}</b><span>${d.text + (dmg ? `（−${dmg}）` : "")}</span><em><u>壓過${GN(beats(m))}</u><s>被${GN(beaten(m))}破</s></em></button>`;
      }).join("") + `<button class="gfight">出招</button>`;
      p.querySelectorAll(".gm").forEach((n) => (n.onclick = () => { if (done || n.classList.contains("lock")) return; if (sel === n.dataset.m) return go(); sel = n.dataset.m; say("選好了就按出招", "", `你選了${GN(sel)}，再點一次或按右邊的出招`); draw(); }));
      p.querySelector(".gfight").onclick = () => (sel ? go() : say("先選一招", "bad", "點下面的一張招式卡"));
    };
    const go = () => { if (done || !sel) return; done = true; draw(); res(sel); };
    say(`地面第 ${o.beat}／${o.max} 拍：${top ? "你在上位" : "你在下位"}`, top ? "good" : "bad", "選一招，雙方同時翻開");
    draw();
  });
}

// ---------- the ground game, blackjack style (ground.mode "21") ----------
// Drawn from the snapshot each event carries, so the screen never runs ahead of the engine. You are always on the left.
const G21 = { open: false, fresh: null, res: null, stamp: null, cap: "", capCls: "" };
const SCALE21 = 24, pc21 = (n) => (Math.max(0, Math.min(SCALE21, n)) / SCALE21 * 100).toFixed(1) + "%";
const VERB = { top: { hit: "加壓", stand: "穩住", role: "上位・壓制", sum: "壓制" }, bottom: { hit: "掙扎", stand: "撐住", role: "下位・掙脫", sum: "掙脫" } };
function draw21(g) {
  if (!g || !g.hands) return;
  let n = $("#g21");
  if (!n) { n = document.createElement("div"); n.id = "g21"; frame.appendChild(n); }
  const X = st.cfg.ground21, G = st.cfg.ground, I = g.info, top = g.top, open = G21.open;
  const total = (s) => g.hands[s].reduce((a, v) => a + v, 0) + I.bonus[s];
  const side = (s) => {
    const me = s === "a", role = top === s ? "top" : "bottom", V = VERB[role], cs = g.hands[s], hide = !me && !open, tot = total(s), known = hide ? tot - cs[1] : tot, bust = I.bust[s];
    const over = !hide && tot > bust, res = G21.res;
    const cls = !res || hide ? "" : over ? "bad" : res.win === s ? "win" : "";
    const cards = cs.map((v, i) => (hide && i === 1 ? `<div class="c down">?</div>` : `<div class="c ${me && i === 1 && !open ? "hid" : ""} ${G21.fresh === s && i === cs.length - 1 && i > 1 ? "new" : ""}">${v}</div>`)).join("") + (I.bonus[s] ? `<div class="bonus">+${I.bonus[s]}<small>${KW[X.startKw]}</small></div>` : "");
    const lim = I.hits?.[s] ?? X.hits, rest = lim - g.hits[s], five = X.fiveWin && lim >= X.hits; // pinned in side control he may take fewer, and cannot reach five
    const left = open ? "" : g.stood[s] ? "已收手" : g.phase === role ? (five ? (rest === 1 ? "再 1 張不爆就贏" : `還能要 ${rest} 張・滿 ${X.hits + 2} 張不爆就贏`) : `還能要 ${rest} 張`) : role !== E.g21First(st) ? "之後才動" : "";
    const tag = over ? `<em class="ovr">超過 ${bust}</em>` : res && !hide && res.win && res.gap ? `<em class="${res.win === s ? "won" : ""}">${res.win === s ? "贏" : "輸"} ${res.gap}</em>` : `<em class="${bust > X.bust ? "v22" : ""}">爆牌線 ${bust}</em>`;
    // the opponent's real number: what you show him changes it when he is underneath
    let tell = "", th = 0;
    if (!me && !open) {
      th = g21Threshold(st, "b", role, total("a") - g.hands.a[1], cs.length);
      tell = `<div class="tell">他低於 <b>${th}</b> 會再${V.hit}<small>${g.stood.b ? `他停了＝約 ${th} 以上` : `真實數字 ±${X.ai.jitter}`}</small></div>`;
    }
    const chips = [];
    if (role === "top") { if (I.bonus[s]) chips.push([KW[X.startKw], `起手 +${I.bonus[s]}`]); if (I.subAt < X.bust) chips.push([KW[X.subKw], `${I.subAt} 也算降伏`]); }
    else if (bust > X.bust) chips.push([KW[X.upKw], `爆牌線 ${bust}`]);
    return `<div class="side ${me ? "you" : "foe"}"><h4><i>${me ? "你" : "他"}</i>${V.role}<small>${left}</small></h4><div class="cards">${cards}</div>
      <div class="sum"><b class="${hide ? "q" : cls}">${hide ? known + "＋？" : tot}</b><span>${V.sum}</span>${tag}</div>
      <div class="gauge"><div class="red" style="left:${pc21(bust)}"></div><div class="fill" style="width:${pc21(known)}"></div>${hide ? `<div class="unk" style="left:${pc21(known + 1)};width:${pc21(Math.min(X.max - 1, SCALE21 - known - 1))}"></div>` : ""}<div class="bust" style="left:${pc21(bust)}"></div>${th ? `<div class="th" style="left:${pc21(th)}"></div>` : ""}</div>
      <div class="gl">${th ? `<i class="t" style="left:${pc21(th)}">${th}</i>` : ""}<i class="b" style="left:${pc21(bust)}">爆 ${bust}</i></div>${tell}
      <div class="chips">${chips.length ? chips.map(([k, d]) => `<span>${k}<u>${d}</u></span>`).join("") : `<span class="none">沒有地面牌</span>`}</div></div>`;
  };
  // each layer's rule for the bottom man, read from ground21.layerRules
  const rule = (i) => { const r = X.layerRules?.[i - 1] || {}; return [r.botHits != null && `下位只能要 ${r.botHits} 張`, r.botBust != null && `下位爆牌線 ${r.botBust}`].filter(Boolean).join("・") || "照常"; };
  const lad = ["站起來", ...G.layerNames].map((name, i) => `<div class="${i ? "" : "out"} ${i === g.layer ? "on" : ""}"><span>${name}${i ? `<u>×${X.layerMul[i - 1]}</u>` : ""}<small>${i ? rule(i) : "脫出半防守"}</small></span>${i === g.layer ? `<span class="tag">第 ${g.beat}／${X.hands} 手</span>` : ""}</div>`).join("");
  n.innerHTML = `<div class="lad">${lad}</div>${side("a")}${side("b")}${G21.stamp ? `<div class="stamp ${G21.stamp[1]}">${G21.stamp[0]}</div>` : ""}<div class="cap ${G21.capCls}">${G21.cap}</div><div class="act"></div>`;
}
/** Play one event of the blackjack ground game. */
function g21Event(e) {
  const g = e.view.ground, X = st.cfg.ground21, names = st.cfg.ground.layerNames, who = (s) => (s === "a" ? "你" : "他");
  const hurt = (s, dmg) => { setHp(e.hp); $("#hud" + s)?.classList.add("hurt"); act(E.other(s), "attack", "grap"); act(s, e.hp[s] <= 0 ? "down" : "hit"); float(fighterPos(s), `−${dmg}`, "dmg"); };
  switch (e.t) {
    case "g21deal":
      Object.assign(G21, { open: false, fresh: null, res: null, stamp: null, capCls: "", cap: e.top === "a" ? `${names[e.layer - 1]}：越接近 ${X.bust} 越穩，<b>超過就被他滑出去</b>` : `${names[e.layer - 1]}：你的總和<b>贏過他</b>才能脫出一層` });
      rows(e.view); draw21(g);
      { const meFirst = (e.top === "a") === (E.g21First(st) === "top"); // whoever is underneath moves first when the top man answers (topLast)
        say(`${e.top === "a" ? "你在上位" : "你被壓在下位"}，${meFirst ? "你先決定" : "他先決定，你看完再動"}`, e.top === "a" ? "good" : "bad"); }
      return 900;
    case "g21hit": {
      const role = g.top === e.s ? "top" : "bottom";
      G21.fresh = e.s; draw21(g);
      say(`${who(e.s)}${VERB[role].hit}：抽到 ${e.card}`, e.s === "a" ? "good" : "bad");
      act(e.s, "attack", "grap");
      return 900;
    }
    case "g21stand": { const role = g.top === e.s ? "top" : "bottom"; G21.fresh = null; draw21(g); say(`${who(e.s)}${VERB[role].stand}了`, e.s === "a" ? "good" : "bad"); return 700; }
    case "g21end": {
      const bot = E.other(e.top), win = e.res === "tie" ? null : e.res === "bottom" ? bot : e.top, mine = win === "a", t = e.totals, score = `${t.a} 對 ${t.b}`;
      G21.open = true; G21.fresh = null;
      G21.res = { win, gap: e.why !== "show" ? 0 : e.res === "top" || e.res === "sub" ? e.gap : Math.abs(t.a - t.b) };
      const full = `${who(e.five)}滿 ${X.hits + 2} 張沒爆，直接贏這手`;
      if (e.res === "tie") { G21.stamp = ["平手", "gold"]; G21.cap = `${score}，裁判叫停，<b>站起來</b>`; }
      else if (e.res === "sub") { G21.stamp = ["降伏！", mine ? "gold" : ""]; G21.cap = `${who(e.top)}鎖死了，<b>${who(bot)}耐久 −${e.dmg}</b>`; }
      else if (e.res === "top") {
        G21.stamp = [e.why === "five" ? "壓到底" : e.why === "bust" ? "力氣放盡" : "壓住了", mine ? "gold" : ""];
        G21.cap = (e.why === "five" ? `${full}，差距算 ${e.gap}` : e.why === "bust" ? `${who(bot)}爆牌，差距算 ${e.gap}` : `${score}，差距 ${e.gap}`) + ` ÷${X.div} 進位 × ${names[e.layer - 1]} ${X.layerMul[e.layer - 1]} ＝ <b>${e.cash}</b>`;
      } else {
        G21.stamp = [e.why === "five" ? "硬撐出來" : e.why === "bust" ? "壓過頭" : "脫出！", bot === "a" ? "good" : ""];
        G21.cap = `${e.why === "five" ? full : e.why === "bust" ? `${who(e.top)}爆牌` : score}，${who(bot)}脫出一層：${e.to >= 1 ? `${names[e.layer - 1]} → <b>${names[e.to - 1]}</b>，地面繼續` : "<b>站起來</b>"}`;
      }
      G21.capCls = win === "b" ? "red" : "";
      // show the hand as it was decided: after an escape the snapshot is already the next position
      const snap = structuredClone(g);
      if (e.res === "bottom") { snap.layer = e.layer; snap.beat = Math.max(1, snap.beat - 1); }
      draw21(snap);
      say(win ? (mine ? "這手你贏" : "這手他贏") : "平手", win ? (mine ? "good" : "bad") : "");
      if (e.dmg) hurt(bot, e.dmg);
      return 2400;
    }
    case "g21cash":
      G21.stamp = null; G21.capCls = e.s === "b" ? "red" : ""; G21.cap = `${who(e.s)}砸下去，<b>${who(E.other(e.s))}耐久 −${e.dmg}</b>${e.stay ? `，還壓在${names[e.layer - 1]}` : ""}`; draw21(g);
      hurt(E.other(e.s), e.dmg);
      say(e.s === "a" ? "砸下去！" : "他砸下來", e.s === "a" ? "good" : "bad");
      return 1500;
    case "g21deep": say(e.s === "a" ? `過腿！到${names[e.layer - 1]}` : `他過腿到${names[e.layer - 1]}`, e.s === "a" ? "good" : "bad"); act(e.s, "attack", "grap"); return 900;
  }
  return 0;
}
/** Your decision: two buttons under the cage. */
function pick21(o) {
  if (speed === 0) return Promise.resolve(g21Smart(st, "a"));
  const X = st.cfg.ground21, G = st.cfg.ground, v = E.g21View(st, "a"), V = VERB[v.role], box = $("#g21 .act");
  if (!box) return Promise.resolve(o.actions[0]);
  return new Promise((res) => {
    const btn = { hit: ["hit", V.hit, "要牌・再抽 1 張"], stand: ["stand", V.stand, `收手・停在 ${v.mine.total}`],
      cash: ["cash", `砸下去　打他 ${v.cash}`, o.last || !X.stay ? "兌現・結束這段地面" : `兌現・留在${G.layerNames[v.layer - 1]}再來一手`], deeper: ["deep", `過腿　→ ${G.layerNames[v.layer] || ""} ×${X.layerMul[v.layer] || ""}`, `不砸這 ${v.cash} 點・換更深的位置`] };
    box.innerHTML = o.actions.map((a) => `<button class="b ${btn[a][0]}" data-a="${a}"><b>${btn[a][1]}</b><small>${btn[a][2]}</small></button>`).join("");
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { box.replaceChildren(); res(b.dataset.a); }));
    if (o.phase === "decide") say("壓住了：砸下去，還是過腿？", "good");
    else say(`輪到你：${V.hit}或${V.stand}`, v.role === "top" ? "good" : "bad");
  });
}

// ---------- the ground game, Texas hold'em style (ground.mode "poker") ----------
// Drawn from the snapshot each event carries (it holds both hands; the screen only shows what you may see). You are always on the left.
const PK = { cap: "", capCls: "", stamp: null, last: { a: "", b: "" }, g: null, stam: null };
const CLS = ["高牌", "一對", "兩對", "三條", "順子", "同花", "葫蘆", "四條", "同花順"], SUIT = ["♠", "♥", "♦", "♣"];
const rk = (r) => ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[r] || String(r);
const pcard = (c, cls = "") => (c == null ? `<div class="pc down ${cls}"><b>?</b></div>` : `<div class="pc ${E.cardSuit(c) === 1 || E.cardSuit(c) === 2 ? "r" : ""} ${cls}"><b>${rk(E.cardRank(c))}</b><u>${SUIT[E.cardSuit(c)]}</u></div>`);
const handName = (h) => (h.cls === 4 ? `順子 ${rk(h.hi)} 高` : h.cls === 5 || h.cls === 8 ? `${CLS[h.cls]} ${rk(h.hi)} 高` : `${CLS[h.cls]} ${rk(h.hi)}`);
/** The ground cards of side s that matter right now, as [name, what] tags. */
function pkTags(s, g) {
  const P = st.cfg.groundPoker, role = g.top === s ? "top" : "bottom", out = [];
  for (const u of st.c[s]) {
    if (!u || u.hp <= 0) continue;
    const d = data.skills[u.id], m = st.cfg.levelMul[(u.lv || 1) - 1];
    for (const f of d.fx) {
      if (f.when !== "ground") continue;
      const n = Math.round((f.n || 0) * m);
      if (f.do === "swap" && g.left.swap[s] > 0) out.push([d.name, `換一張暗牌 剩 ${g.left.swap[s]}`]);
      else if (f.do === "peek" && g.left.peek[s] > 0) out.push([d.name, `偷看一張 剩 ${g.left.peek[s]}`]);
      else if (f.do === "ante" && g.dealt === 1) out.push([d.name, `他多押 ${n}`]);
      else if (f.do === "drain" && role === "top") out.push([d.name, `贏一手多磨他 ${n}`]);
      else if (f.do === "cashplus" && role === "top") out.push([d.name, `砸下去 +${n}`]);
      else if (f.do === "sub" && f.role === role && f.layer === g.layer) out.push([d.name, `${CLS[f.rank]}以上就${role === "top" ? "鎖死" : "反鎖"}`]);
      else if (f.do === "refill" && role === "bottom" && g.layer >= (f.layer || 1) && !g.used.refill[s]) out.push([d.name, `被磨光先回 ${n}`]);
    }
  }
  return out;
}
/** The opponent's published style, as lines of real numbers: exactly the table pokerPick plays from. */
function pkStyleRows(g) {
  const S = pokerStyle(st, "b"), P = st.cfg.groundPoker, pc = (x) => Math.round(x * 100) + "%";
  return [
    ["加壓", S.raise <= 0 ? "什麼牌都加壓" : `${CLS[S.raise]}以上`],
    ["虛張", S.raise > 0 && S.bluff > 0 ? `${pc(S.bluff)} 沒到也加壓` : S.raise <= 0 ? "不用虛張" : "不虛張"],
    ["被加壓還跟", S.call <= 0 ? "不放棄" : `${CLS[S.call]}以上`],
    ["全押", g.layer >= P.allInLayer ? `${CLS[S.allin]}以上` : "這層不能"],
  ];
}
function drawPk(g) {
  if (!g || !g.h) return;
  PK.g = g;
  let n = $("#g21");
  if (!n) { n = document.createElement("div"); n.id = "g21"; frame.appendChild(n); }
  n.className = "pk";
  const P = st.cfg.groundPoker, G = st.cfg.ground, h = g.h, top = g.top, open = h.reveal, board = h.board.slice(0, h.shown), stam = PK.stam || { a: st.a.stam, b: st.b.stam };
  const name = (hole) => handName(E.evalHand([...hole, ...board]));
  const side = (s) => {
    const me = s === "a", role = top === s ? "top" : "bottom", V = VERB[role], f = me ? "b" : "a";
    const seen = (i) => me || open || h.peeked.a.includes(i);
    const cards = h.hole[s].map((c, i) => pcard(seen(i) ? c : null, !me && seen(i) && !open ? "hl" : "")).join("");
    const show = me || open || h.peeked.a.length === 2;
    const hand = me ? `<div class="hand">你現在：<b>${name(h.hole.a)}</b></div>` : open ? `<div class="hand">他現在：<b>${name(h.hole.b)}</b></div>` : h.peeked.a.length ? `<div class="hand dim">看到一張，另一張還不知道</div>` : "";
    void show;
    const tags = me ? pkTags("a", g) : [];
    const warn = me && role === "bottom" && g.layer >= P.subLayer && stam.a <= 8 ? `<div class="warn">只剩 <b>${stam.a} 體力</b>：這層輸到 0＝<b>被降伏</b></div>` : me && stam.a <= 0 ? `<div class="warn">沒力了：這次地面只能跟或鬆手</div>` : "";
    const style = me ? "" : `<div class="style"><h5>他的打法（真實數字）</h5>${pkStyleRows(g).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
    return `<div class="side ${me ? "you" : "foe"}"><h4><i>${me ? "你" : "他"}</i>${V.role}<small>${me ? (h.phase === "decide" && g.top === s ? "輪到你" : "") : `這手已押 <b>${h.put[s]}</b> 體力`}</small></h4>
      <div class="hole">${cards}</div>${hand}
      ${me ? `<div class="stake">這手已押 <em>${h.put[s]} 體力</em></div>` : ""}${warn}
      ${me ? `<div class="chips">${tags.length ? tags.map(([k, d]) => `<span>${esc(k)}<u>${esc(d)}</u></span>`).join("") : `<span class="none">沒有地面牌</span>`}</div>` : `${PK.last.b ? `<div class="last">${PK.last.b}</div>` : ""}${style}`}</div>`;
  };
  const rule = (i) => {
    const r = P.subRank[i - 1], parts = [i >= P.allInLayer ? "可全押" : "不能全押", i >= P.subLayer ? (r != null ? `${CLS[r]}鎖死` : "磨光降伏") : "不會降伏"];
    return parts.join("・");
  };
  const lad = ["站起來", ...G.layerNames].map((nm, i) => `<div class="${i ? "" : "out"} ${i === g.layer ? "on" : ""}"><span>${nm}${i ? `<u>×${P.cashMul[i - 1]}</u>` : ""}<small>${i ? rule(i) : "脫出半防守"}</small></span>${i === g.layer ? `<span class="tag">第 ${g.dealt}／${P.hands} 手</span>` : ""}</div>`).join("");
  const slots = Array.from({ length: 5 }, (_, i) => (i < board.length ? pcard(board[i], "sm") : `<div class="pc sm slot"><b>待翻</b></div>`)).join("");
  const pot = h.put.a + h.put.b;
  n.innerHTML = `<div class="lad">${lad}</div>${side("a")}${side("b")}
    <div class="table"><div class="lab">桌面　彩池 <b>${pot} 體力</b></div><div class="board">${slots}</div></div>
    ${PK.stamp ? `<div class="stamp ${PK.stamp[1]}">${PK.stamp[0]}</div>` : ""}<div class="cap ${PK.capCls}">${PK.cap}</div><div class="act"></div>`;
}
/** Play one event of the poker ground. */
function pokerEvent(e) {
  const g = e.view.ground, names = st.cfg.ground.layerNames, P = st.cfg.groundPoker, who = (s) => (s === "a" ? "你" : "他");
  const hurt = (s, dmg) => { setHp(e.hp); $("#hud" + s)?.classList.add("hurt"); act(E.other(s), "attack", "grap"); act(s, e.hp[s] <= 0 ? "down" : "hit"); float(fighterPos(s), `−${dmg}`, "dmg"); };
  PK.stam = e.stam; setSta(e.stam);
  const hand = (h) => handName(h);
  switch (e.t) {
    case "pdeal":
      Object.assign(PK, { stamp: null, capCls: "", last: { a: "", b: "" }, cap: e.top === "a" ? `${names[e.layer - 1]}：每人先押 1 體力，各拿兩張暗牌` : `${names[e.layer - 1]}：你被壓著，每人先押 1 體力` });
      rows(e.view); drawPk(g);
      say(`${e.top === "a" ? "你在上位" : "你被壓在下位"}・第 ${e.hand}／${P.hands} 手`, e.top === "a" ? "good" : "bad", "每一輪下位先動，上位看完再決定");
      return 900;
    case "pact": {
      if (e.act === "cash" || e.act === "deeper") return 0;
      const role = g.top === e.s ? "top" : "bottom", V = VERB[role];
      if (e.act === "keep") { drawPk(g); say(`${who(e.s)}不換牌`, e.s === "a" ? "good" : "bad"); return 400; }
      if (e.act.startsWith("swap")) { drawPk(g); say(`${who(e.s)}換掉了一張暗牌`, e.s === "a" ? "good" : "bad"); return 800; }
      if (e.act === "peek") { drawPk(g); say(`${who(e.s)}偷看了${e.s === "a" ? "他的一張暗牌" : "你的一張暗牌"}`, e.s === "a" ? "good" : "bad"); return 800; }
      const text = e.act === "fold" ? `${who(e.s)}鬆手` : e.act === "allin" ? `${who(e.s)}拚了！押上 ${e.amt}` : e.act === "raise" ? `${who(e.s)}${V.hit} +${e.amt}` : e.amt ? `${who(e.s)}${role === "top" ? "跟" : "撐住"}（押 ${e.amt}）` : `${who(e.s)}${role === "top" ? "穩住" : "撐住"}（過牌）`;
      if (e.s === "b") PK.last.b = e.act === "raise" ? `他${V.hit} <small>（再押 ${e.amt}）</small>` : e.act === "allin" ? `他拚了！<small>（押上 ${e.amt}）</small>` : e.act === "fold" ? `他鬆手` : e.amt ? `他跟 <small>（押 ${e.amt}）</small>` : `他過牌`;
      PK.cap = e.act === "fold" ? "" : `第 ${e.round} 輪`;
      drawPk(g); say(text, e.s === "a" ? "good" : "bad");
      if (e.act === "raise" || e.act === "allin") act(e.s, "attack", "grap");
      return 800;
    }
    case "pboard": PK.cap = "再翻兩張牌，第二輪"; drawPk(g); say("再翻兩張牌", ""); return 800;
    case "pend": {
      const w = e.winner, gg = g || PK.g, hands = e.hands;
      PK.last.b = "";
      if (e.res === "tie") { PK.stamp = ["平手", "gold"]; PK.capCls = ""; PK.cap = `${hand(hands.a)} 對 ${hand(hands.b)}，各自拿回押的體力，<b>站起來</b>`; }
      else {
        const l = E.other(w);
        const how = e.how === "fold" ? `${who(l)}鬆手，押的體力沒了` : `${who(w)}：${hand(hands[w])}　勝　${who(l)}：${hand(hands[l])}${hand(hands[w]) === hand(hands[l]) ? "（比到後面的牌）" : ""}`;
        if (e.res === "sub") { PK.stamp = ["降伏！", w === "a" ? "gold" : ""]; PK.cap = `${how}<br>${e.sub === "lock" ? `${CLS[hands[w].cls]}鎖死` : e.sub === "counter" ? "反鎖降伏" : "體力被磨光"}，<b>比賽結束</b>`; }
        else if (e.res === "top") { PK.stamp = ["壓住了", w === "a" ? "gold" : ""]; PK.cap = `${how}<br>${e.drained ? `多磨掉他 ${e.drained} 體力，` : ""}${e.refill ? `他先回 ${e.refill} 體力，` : ""}${w === "a" ? `砸下去能打 <b>${e.cash}</b>` : `他能砸下來（${e.cash}）`}`; }
        else { PK.stamp = ["脫出！", w === "a" ? "good" : ""]; PK.cap = `${how}<br>${who(w)}脫出一層：${e.to >= 1 ? `${names[e.layer - 1]} → <b>${names[e.to - 1]}</b>` : "<b>站起來</b>"}`; }
        PK.capCls = w === "b" ? "red" : "";
      }
      drawPk(gg);
      say(e.res === "tie" ? "平手" : w === "a" ? "這手你贏" : "這手他贏", e.res === "tie" ? "" : w === "a" ? "good" : "bad");
      return 2600;
    }
    case "pcash":
      PK.stamp = null; PK.capCls = e.s === "b" ? "red" : ""; PK.cap = `${who(e.s)}砸下去，<b>${who(E.other(e.s))}耐久 −${e.dmg}</b>${e.stay ? `，還壓在${names[e.layer - 1]}` : ""}`; drawPk(g || PK.g);
      hurt(E.other(e.s), e.dmg);
      say(e.s === "a" ? "砸下去！" : "他砸下來", e.s === "a" ? "good" : "bad");
      return 1500;
    case "pdeep": say(e.s === "a" ? `過腿！到${names[e.layer - 1]}` : `他過腿到${names[e.layer - 1]}`, e.s === "a" ? "good" : "bad"); act(e.s, "attack", "grap"); return 900;
    case "psub":
      PK.stamp = ["降伏！", e.s === "a" ? "gold" : ""]; PK.capCls = e.s === "b" ? "red" : ""; drawPk(PK.g);
      act(E.other(e.s), "down"); say(e.s === "a" ? "降伏！你鎖死了他" : "降伏！你被鎖死了", e.s === "a" ? "good" : "bad", "比賽結束");
      return 1800;
  }
  return 0;
}
/** Your decision: buttons under the cage. */
function pickPoker(o) {
  if (speed === 0) return Promise.resolve(pokerRead(st, "a"));
  const v = E.pokerView(st, "a"), box = $("#g21 .act"), G = st.cfg.ground, top = v.role === "top";
  if (!box) return Promise.resolve(o.actions.includes("call") ? "call" : o.actions[0]);
  const B = {
    fold: ["fold", "鬆手", `放棄・輸掉押的 ${v.mine.put}`],
    call: ["call", o.owe > 0 ? (top ? "跟" : "撐住") : top ? "穩住" : "撐住", o.owe > 0 ? `再押 ${o.owe}` : o.round === 2 && top ? "過牌・直接攤牌" : "過牌"],
    raise: ["raise", top ? "加壓" : "掙扎", `再押 ${o.owe + o.raise}`],
    allin: ["allin", "拚了・全押", `押上 ${o.owe + o.allin}${top && v.foe.stam <= o.allin ? "・他輸就降伏" : ""}`],
    peek: ["peek", "偷看", "看他一張暗牌・不算這一手"],
    keep: ["call", "不換", "留著這兩張"],
    swap0: ["raise", "換左邊這張", "從牌堆換一張新的"],
    swap1: ["raise", "換右邊這張", "從牌堆換一張新的"],
    cash: ["cash", `砸下去　打他 ${o.cash}`, o.hand >= o.hands ? "兌現・結束這段地面" : `兌現・留在${G.layerNames[o.layer - 1]}再來一手`],
    deeper: ["deep", `過腿　→ ${G.layerNames[o.layer] || ""} ×${st.cfg.groundPoker.cashMul[o.layer] || ""}`, `不砸這 ${o.cash}・換更深的位置`],
  };
  return new Promise((res) => {
    box.innerHTML = o.actions.map((a) => `<button class="b ${B[a][0]}" data-a="${a}"><b>${B[a][1]}</b><small>${B[a][2]}</small></button>`).join("");
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { box.replaceChildren(); res(b.dataset.a); }));
    if (o.phase === "decide") say("壓住了：砸下去，還是過腿？", "good");
    else if (o.phase === "swap") say("要不要換掉一張暗牌？", "good");
    else say(`輪到你：${o.owe > 0 ? "他加壓了" : "第 " + o.round + " 輪"}`, top ? "good" : "bad");
  });
}

// ---------- the EA ground (ground.mode "ea"): drag a direction, the opponent's real table beside him, a timing bar for submissions ----------
// Everything is drawn from the snapshot each event carries (EAU.g) plus the stamina it brings, so the screen never runs ahead of the engine.
const EAU = { g: null, stam: null, sel: null, reveal: null, stamp: null, cap: "", capCls: "", last: "", hint: "", tbl: null, aim: null };
const eaGlyph = { pass: "↑", pound: "→", sub: "←", down: "↓" };
const eaPos = { pass: "up", pound: "rt", sub: "lf", down: "dn" };
/** The cards on your side that do something in this ground: [card name, what it does]. */
function eaTags(s, g) {
  const out = [], role = g.top === s ? "top" : "bot", mine = role === "top" ? ["poundplus", "drainplus", "stagecut", "passcut"] : ["quick"];
  for (const u of st.c?.[s] || []) {
    if (!u || u.hp <= 0) continue;
    const d = data.skills[u.id];
    for (const x of d.fx) if (x.when === "groundEA" && mine.includes(x.do) && (x.do !== "quick" || !g.quickUsed)) out.push([d.name, String(x.text).replace(/^EA 地面：(你[^，]*，)?/, "")]);
  }
  return out;
}
function drawEA() {
  const g = EAU.g;
  if (!g || !g.mods) return;
  let n = $("#g21");
  if (!n) { n = document.createElement("div"); n.id = "g21"; frame.appendChild(n); }
  n.className = "ea";
  const X = st.cfg.groundEA, G = st.cfg.ground, N = X.names, meTop = g.top === "a", mine = meTop ? N.top : N.bot, his = meTop ? N.bot : N.top, stam = EAU.stam || { a: st.a.stam, b: st.b.stam };
  const bot = meTop ? "b" : "a", need = g.mods.quick && !g.quickUsed ? 1 : X.need, M = g.mods;
  const cost = (m) => E.eaCost(X, M, m), subFrom = X.subFrom || 1;
  const lad = ["站起來", ...G.layerNames].map((nm, i) => `<div class="${i ? "" : "out"} ${i === g.layer ? "on" : ""}"><span>${nm}<small>${!i ? "脫出半防守" : i < subFrom ? "還不能降伏" : `降伏要撐 ${Math.max(1, X.stages[i - 1] - (meTop ? M.stageCut : 0))} 關`}</small></span>${i === g.layer ? `<span class="tag">第 ${Math.min(g.beat, X.beats)}／${X.beats} 拍</span>` : ""}</div>`).join("");
  const space = (g.space | 0), dots = Array.from({ length: need }, (_, i) => `<i class="${i < space ? "on" : ""}"></i>`).join("");
  const tags = eaTags("a", g);
  const myBody = `<div class="row">${meTop ? "他的空間" : "你的空間"} <span class="space">${dots}</span><small>${meTop ? `滿 ${need} 格他就脫出一層` : `再擋 ${Math.max(0, need - space)} 次就脫出一層`}</small></div>
    <div class="costs">${meTop ? `過腿 <b>${cost("pass")}</b>・砸擊 <b>${cost("pound")}</b>・降伏 <b>${cost("sub")}</b> 體力<br>被他擋住：再多扣 <b>${X.denied}</b><br>↓ 壓住：回 <b>${X.hold.regen}</b>、他 −${X.hold.drain}；剋他的爆發` : `猜方向擋不花體力<br>↓ 爆發：花 <b>${X.burst}</b>，什麼都擋，但被壓住就白費<br>被砸中：<b>−${X.drain}</b> 體力；體力越少越擋不住降伏`}</div>
    ${!meTop && stam.a <= 8 ? `<div class="warn">體力只剩 <b>${stam.a}</b>：被降伏打中很危險</div>` : meTop && stam.a < cost("sub") ? `<div class="warn">體力 <b>${stam.a}</b>：出不起降伏</div>` : ""}
    <div class="chips">${tags.length ? tags.map(([k, d]) => `<span>${esc(k)}<u>${esc(d)}</u></span>`).join("") : `<span class="none">沒有地面牌</span>`}</div>`;
  const T = EAU.tbl, tr = (m) => `<div class="tr m-${m}"><span><em>${eaGlyph[m]}</em>${his[m]}</span><i><b style="width:${Math.round((T.w[m] || 0) * 100)}%"></b></i><strong>${T.w[m] ? Math.round(T.w[m] * 100) + "%" : "—"}</strong></div>`;
  // without the odds (groundEA.showOdds false): the clues that moved his table this beat, his habit, and the directions he has used this ground
  const clueText = (c) => (meTop
    ? { covered: "你剛<b>砸中他</b>", memory: `你上一拍用過${N.top[c.m]}`, tired: "他快沒力，怕被鎖", fresh: "他體力還夠，不急著防", spent: "他體力不夠爆發", near: "他再 1 格就脫出" }
    : { memory: c.m === "down" ? "你上一拍<b>爆發</b>" : `你上一拍<b>擋了${N.top[c.m]}</b>`, tired: "你體力低，他想鎖你", fresh: "你體力還夠，他不急著鎖", winded: "他喘了，想壓住休息" })[c.why];
  const used = (g.hist?.[meTop ? "bot" : "top"] || []).filter((m) => m !== "rest").slice(-5).reverse();
  const cluesBody = T ? `<div class="sec">這一拍的線索（▲ 比較會${meTop ? "擋" : "用"}　▼ 比較不會）</div>
    ${T.w.rest ? `<div class="none">他沒力氣出招，要喘口氣</div>` : T.clues.length ? T.clues.map((c) => `<div class="clue m-${c.m}"><span class="d">${eaGlyph[c.m]} ${his[c.m]}<u class="${c.up ? "" : "dn"}">${c.up ? "▲" : "▼"}</u></span><span>${clueText(c)}</span></div>`).join("") : `<div class="none">還沒有線索，只有他的習慣</div>`}
    <div class="sec">他的習慣</div><div class="habit"><b>${esc(st.b.f.short)}</b>：${meTop ? "被壓著時習慣先" : "在上位最愛"}${his[T.habit]}</div>
    <div class="sec">他這次地面${meTop ? "擋過" : "用過"}的方向</div><div class="hist">${used.length ? used.map((m) => `<b class="m-${m}">${eaGlyph[m]}</b>`).join("") + "<span>← 最近一拍</span>" : "還沒出過招"}</div>` : "";
  const foeBody = !X.showOdds ? cluesBody : T ? `<div class="tbl"><h5>${EAU.reveal ? "他剛剛的表" : meTop ? "他這一拍怎麼擋（真實數字）" : "他這一拍怎麼打（真實數字）"}</h5>${E.EA_MOVES.map(tr).join("")}</div>${T.w.rest ? `<div class="why"><span>他沒力氣出招，要喘口氣</span></div>` : `<div class="why">${T.why.map((w) => `<span>${w}</span>`).join("")}</div>`}` : "";
  const pad = E.EA_MOVES.map((m) => {
    const ok = !EAU.allowed || EAU.allowed.includes(m);
    const shut = m === "sub" && g.layer < subFrom;
    return `<button class="ar m-${m} ${eaPos[m]} ${shut ? "lock" : EAU.sel === m ? "sel" : EAU.aim === m ? "aim" : EAU.sel || !ok ? "dim" : ""}" data-m="${m}"><b><span class="k">${eaGlyph[m]}</span> ${mine[m]}</b><small>${shut ? `${G.layerNames[subFrom - 1]}以上才能用` : !ok ? (m === "pass" && g.layer >= G.layers ? "已經在最深" : "體力不夠") : m === "down" ? (meTop ? `回 ${X.hold.regen} 體力` : `花 ${X.burst}・全擋`) : meTop ? `花 ${cost(m)} 體力` : "同方向＝擋住"}</small></button>`;
  }).join("");
  const rv = EAU.reveal ? `<div class="reveal"><span class="m-${EAU.reveal[0]}">你 ${eaGlyph[EAU.reveal[0]]} ${mine[EAU.reveal[0]]}</span><span class="m-${EAU.reveal[1]}">他 ${eaGlyph[EAU.reveal[1]]} ${his[EAU.reveal[1]]}</span></div>` : "";
  n.innerHTML = `<div class="lad">${lad}</div>
    <div class="side you"><h4><i>你</i>${meTop ? "上位・進攻" : "下位・防守"}<small>${EAU.allowed ? "輪到你" : ""}</small></h4>${myBody}</div>
    <div class="side foe"><h4><i>他</i>${meTop ? "下位・防守" : "上位・進攻"}<small>${EAU.allowed ? "同時決定" : ""}</small></h4>${foeBody}</div>
    <div class="zone">${EAU.reveal ? "" : `<div class="pad">${pad}</div>`}${rv}${EAU.stamp ? `<div class="stamp ${EAU.stamp[1] || ""}">${EAU.stamp[0]}</div>` : ""}<div class="dot"></div></div>
    <div class="cap ${EAU.capCls}">${EAU.cap}</div>
    <div class="act"><div class="last"><div>${EAU.last}</div></div><div class="hint"><div>${EAU.hint}</div></div></div>`;
}
/** Play one event of the EA ground. */
function eaEvent(e) {
  const g = e.view?.ground, X = st.cfg.groundEA, names = st.cfg.ground.layerNames, N = X.names, who = (s) => (s === "a" ? "你" : "他");
  const hurt = (s, dmg) => { setHp(e.hp); $("#hud" + s)?.classList.add("hurt"); act(E.other(s), "attack", "grap"); act(s, e.hp[s] <= 0 ? "down" : "hit"); float(fighterPos(s), `−${dmg}`, "dmg"); };
  setSta(e.stam); EAU.stam = e.stam;
  switch (e.t) {
    case "eadeal":
      Object.assign(EAU, { g, sel: null, reveal: null, stamp: null, capCls: "", allowed: null, tbl: null, last: "", hint: "", cap: e.top === "a" ? `${names[e.layer - 1]}：你在上面，每一拍往一個方向拖` : `${names[e.layer - 1]}：你被壓著，猜他往哪拖就往同一邊擋` });
      rows(e.view); drawEA();
      say(e.top === "a" ? "你在上位" : "你被壓在下位", e.top === "a" ? "good" : "bad", "每一拍雙方同時選方向");
      return 900;
    case "eabeat": {
      const bot = E.other(e.top), meTop = e.top === "a", mine = meTop ? e.mt : e.mb, his = meTop ? e.mb : e.mt;
      const nm = (m, top) => (top ? N.top : N.bot)[m];
      EAU.g = g; EAU.reveal = [mine, his]; EAU.allowed = null; EAU.sel = null;
      let stamp = null, cap = "", mineWin = false;
      if (e.kind === "rest") { stamp = ["喘口氣", "gold"]; cap = `${who(e.top)}沒力氣出招，<b>${who(bot)}得 1 格空間</b>`; mineWin = !meTop; }
      else if (e.kind === "hold") { stamp = ["壓住了", meTop ? "gold" : ""]; cap = `${who(e.top)}壓著不動：<b>回 ${X.hold.regen} 體力，${who(bot)}體力 −${e.drain}</b>`; mineWin = meTop; }
      else if (e.kind === "stuff") { stamp = ["爆發被壓回去", meTop ? "gold" : ""]; cap = `${who(bot)}爆發撞上壓制：<b>白花 ${X.burst} 體力，空間歸零</b>`; mineWin = meTop; }
      else if (e.kind === "burst") { stamp = ["爆發擋住", !meTop ? "good" : ""]; cap = `${who(bot)}爆發（花 ${X.burst} 體力），${who(e.top)}的招沒用，<b>${who(bot)}得 1 格空間</b>`; mineWin = !meTop; }
      else if (e.kind === "deny") { stamp = ["擋住了", !meTop ? "good" : ""]; cap = `方向一樣：<b>${who(e.top)}多扣 ${X.denied} 體力</b>，${who(bot)}得 1 格空間`; mineWin = !meTop; }
      else if (e.kind === "pass") { stamp = ["過腿成功", meTop ? "gold" : ""]; cap = `${who(e.top)}過腿，<b>往深一層（${names[e.layer - 1]}）</b>`; mineWin = meTop; }
      else if (e.kind === "pound") { stamp = ["砸中！", meTop ? "gold" : ""]; cap = `${who(e.top)}砸中：<b>${who(bot)}耐久 −${e.dmg}、體力 −${e.drain}</b>，他接著會護頭`; mineWin = meTop; }
      else if (e.kind === "sub") { stamp = ["降伏打中！", meTop ? "gold" : ""]; cap = `進入降伏攻防：要撐 <b>${e.stages}</b> 關`; mineWin = meTop; }
      if (e.esc) cap += `<br>${who(bot)}<b>脫出一層：</b>${e.up ? "站起來" : `${names[e.layer]} → ${names[e.layer - 1]}`}`;
      EAU.stamp = stamp; EAU.cap = cap; EAU.capCls = mineWin ? "" : "red";
      EAU.last = `這一拍：${who(e.top)} <b>${eaGlyph[e.mt]} ${nm(e.mt, true)}</b>，${who(bot)} <b>${eaGlyph[e.mb]} ${nm(e.mb, false)}</b>`;
      EAU.hint = e.kind === "sub" ? "降伏！" : "";
      drawEA();
      say(stamp[0], mineWin ? "good" : "bad");
      if (e.dmg) hurt(bot, e.dmg); else if (e.kind === "pass") act(e.top, "attack", "grap"); else if (e.kind === "deny") float(fighterPos(bot), "擋住", "buff");
      return 2200;
    }
    case "easubstart": {
      EAU.g = g; EAU.stamp = ["降伏打中！", e.top === "a" ? "gold" : ""]; EAU.reveal = null;
      EAU.cap = `進入降伏攻防：要撐 <b>${e.stages}</b> 關；他每一關逃脫的機會 <b>${Math.round(e.escape * 100)}%</b>（看他的體力）`; EAU.capCls = e.top === "a" ? "" : "red"; EAU.hint = "";
      drawEA(); act(e.top, "attack", "grap");
      return 1100;
    }
    case "easub": {
      const mineTop = e.top === "a";
      EAU.g = g; EAU.stamp = null;
      EAU.cap = `第 ${e.stage}／${e.stages} 關：${e.escaped ? `<b>${who(e.bot)}逃掉了</b>（機會 ${Math.round(e.p * 100)}%），他掉 ${X.escDrain} 體力，回到地面` : `<b>${who(e.bot)}沒逃掉</b>（機會 ${Math.round(e.p * 100)}%）${e.stage >= e.stages ? "" : "，下一關"}`}`;
      EAU.capCls = (mineTop ? e.escaped : !e.escaped) ? "red" : "";
      EAU.last = e.grade && e.grade !== "miss" ? `你按準了時機：他的逃脫機會 ${mineTop ? "−" : "+"}${Math.round((X.timing[e.grade] || 0) * 100)}%` : "";
      drawEA();
      return 1100;
    }
    case "easubmit":
      EAU.g = g || EAU.g; EAU.stamp = ["降伏！", e.s === "a" ? "gold" : ""]; EAU.capCls = e.s === "b" ? "red" : ""; EAU.cap = `${who(e.s)}鎖死了${who(e.loser)}，<b>比賽結束</b>`; EAU.hint = "";
      drawEA(); act(e.loser, "down");
      say(e.s === "a" ? "降伏！你鎖死了他" : "降伏！你被鎖死了", e.s === "a" ? "good" : "bad", "比賽結束");
      return 1800;
  }
  return 0;
}
/** Your direction: drag on the mat (↑ pass, → pound, ← submission), or tap an arrow. Resolves with the move. */
function pickEA(o) {
  const g = structuredClone(st.c.ground), top = o.top === "a", mine = o.moves.a, X = st.cfg.groundEA;
  Object.assign(EAU, { g, stam: { a: st.a.stam, b: st.b.stam }, sel: null, reveal: null, stamp: null, aim: null, tbl: eaTable(st, "b"), allowed: mine, capCls: "" });
  if (speed === 0) return Promise.resolve(eaRead(st, "a"));
  const tired = mine[0] === "rest", foeTired = !top && o.moves[o.top][0] === "rest";
  if (tired || foeTired) {
    EAU.allowed = null; EAU.cap = tired ? "你沒力氣出招，<b>喘口氣</b>（回體力，他得 1 格空間）" : "他沒力氣出招，在喘口氣"; EAU.hint = ""; EAU.last = "";
    drawEA(); say(tired ? "喘口氣" : "他在喘口氣", tired ? "bad" : "good");
    return sleep(900).then(() => (tired ? "rest" : "pound"));
  }
  const N = X.names, list = mine.map((m) => `${eaGlyph[m]} ${(top ? N.top : N.bot)[m]}`).join("　");
  EAU.cap = top ? `把手指往一個方向拖：<b>${list}</b>` : `猜他往哪拖，往同一邊擋：<b>${list}</b>`;
  EAU.hint = top ? "放開手指＝出招<br><small>拖到箭頭上，雙方同時翻開</small>" : "放開手指＝擋<br><small>和他同方向就擋住</small>"; EAU.last = EAU.lastBeat || "";
  drawEA(); say(top ? "輪到你出招" : "輪到你防守", top ? "good" : "bad");
  return new Promise((res) => {
    const zone = $("#g21 .zone"), dot = zone.querySelector(".dot");
    let from = null, done = false;
    const dirOf = (dx, dy) => (Math.hypot(dx, dy) < 26 ? null : dy < -Math.abs(dx) * 0.7 ? "pass" : dy > Math.abs(dx) * 0.7 ? "down" : dx > 0 ? "pound" : "sub");
    const choose = (m) => {
      if (done || !m || !mine.includes(m)) return;
      done = true; dot.style.display = "none"; EAU.sel = m; EAU.aim = null; EAU.last = ""; EAU.hint = "";
      drawEA(); sleep(350).then(() => res(m));
    };
    const aim = (m) => { if (EAU.aim !== m) { EAU.aim = m; zone.querySelectorAll(".ar").forEach((b) => b.classList.toggle("aim", b.dataset.m === m)); } };
    const xy = (ev) => { const r = zone.getBoundingClientRect(), k = scale(); return { x: (ev.clientX - r.left) / k, y: (ev.clientY - r.top) / k }; };
    zone.onpointerdown = (ev) => { if (done) return; zone.setPointerCapture(ev.pointerId); from = xy(ev); dot.style.display = "block"; dot.style.left = from.x - 17 + "px"; dot.style.top = from.y - 17 + "px"; };
    zone.onpointermove = (ev) => { if (!from || done) return; const p = xy(ev); dot.style.left = p.x - 17 + "px"; dot.style.top = p.y - 17 + "px"; aim(dirOf(p.x - from.x, p.y - from.y)); };
    zone.onpointerup = (ev) => {
      if (!from || done) return;
      const p = xy(ev), m = dirOf(p.x - from.x, p.y - from.y);
      from = null; dot.style.display = "none";
      if (m) return choose(m);
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".ar"); // a tap on an arrow
      if (t) choose(t.dataset.m);
    };
    zone.onpointercancel = () => { from = null; dot.style.display = "none"; aim(null); };
    zone.querySelectorAll(".ar").forEach((b) => (b.onclick = () => choose(b.dataset.m))); // a plain click works too (keyboard, desktop)
  });
}
/** The submission's timing bar: your side's chance moves with it (the opponent's does not). Resolves "perfect" | "good" | "miss". */
function eaBar(o) {
  const q = st.cfg.react, X = st.cfg.groundEA, meTop = o.top === "a";
  if (speed === 0) return Promise.resolve("good");
  frame.classList.add("eabar");
  return new Promise((res) => {
    const box = $("#qte"), g0 = (1 - q.zone.good) / 2, p0 = (1 - q.zone.perfect) / 2;
    EAU.hint = ""; EAU.last = ""; drawEA();
    say(meTop ? "收緊！" : "掙脫！", meTop ? "good" : "bad", meTop ? `按準了，他這一關逃脫的機會 −${Math.round(X.timing.good * 100)}%（空白鍵或點時機條）` : `按準了，你這一關逃脫的機會 +${Math.round(X.timing.good * 100)}%（空白鍵或點時機條）`);
    box.innerHTML = `<button class="track"><i class="good" style="left:${g0 * 100}%;width:${q.zone.good * 100}%"></i><i class="perfect" style="left:${p0 * 100}%;width:${q.zone.perfect * 100}%"></i><b class="mark"></b></button>`;
    const mark = box.querySelector(".mark"), t0 = performance.now();
    let done = false, x = 0, raf = 0;
    const end = (grade) => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); removeEventListener("keydown", key);
      box.querySelector(".track").classList.add(grade);
      setTimeout(() => { box.innerHTML = ""; frame.classList.remove("eabar"); res(grade); }, 300);
    };
    const hit = () => { const d = Math.abs(x - 0.5); end(d <= q.zone.perfect / 2 ? "perfect" : d <= q.zone.good / 2 ? "good" : "miss"); };
    const key = (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); hit(); } };
    const tick = (now) => {
      const n = ((now - t0) / 1000) * q.speed;
      if (n >= q.sweeps) return end("miss");
      const f = n % 2;
      x = f <= 1 ? f : 2 - f;
      mark.style.left = x * 100 + "%";
      raf = requestAnimationFrame(tick);
    };
    box.querySelector(".track").onclick = hit;
    addEventListener("keydown", key);
    raf = requestAnimationFrame(tick);
  });
}

async function clash(id) {
  aiShop(st, "b");
  frame.innerHTML = `${cols()}${clock()}
    <div id="stage"><div id="gnd"></div><div class="fz" id="fa"><div class="in"></div></div><div class="fz" id="fb"><div class="in"></div></div></div>
    <div id="say"></div><div id="cue"><small id="cap"></small><div id="qte"></div></div>
    <button class="btn" id="speed"></button><button class="btn" id="quit">重來</button>`;
  ground = null; frame.classList.remove("gmode", "g21mode", "pkmode", "eamode", "eabar");
  pose("a", "idle"); pose("b", "idle");
  $("#quit").onclick = () => { pickSel = null; pickScreen(); };
  const sp = $("#speed"), label = () => (sp.textContent = speed === 0 ? "速度：跳過" : `速度：${SPEED_NAME[speedIx]}`);
  sp.onclick = () => { speedIx = speed === 0 ? 0 : (speedIx + 1) % SPEEDS.length; speed = SPEEDS[speedIx]; try { localStorage.setItem("bg.speed", speedIx); } catch {} label(); };
  label();
  let from = st.log.length, prev = null;
  E.startClash(st);
  if (jumpSide) { E.startGround(st, jumpSide); jumpSide = null; } // ?jump: this clash starts on the mat
  const flush = async () => {
    for (const e of st.log.slice(from)) {
      if (id !== runId) return;
      const ms = await showEvent(e, prev || e.view);
      if (e.view) prev = e.view;
      if (ms) await sleep(ms);
    }
    from = st.log.length;
  };
  await flush();
  while (id === runId && st.phase === "clash") {
    const oe = E.eaOptions(st);
    if (oe) {
      if (oe.phase === "sub") {
        const grade = await eaBar(oe);
        if (id !== runId) return;
        E.step(st, grade);
        await flush();
        continue;
      }
      const m = await pickEA(oe);
      if (id !== runId) return;
      E.chooseGround(st, "a", m); E.chooseGround(st, "b", eaPick(st, "b"));
      E.step(st);
      await flush();
      continue;
    }
    const op = E.pokerOptions(st);
    if (op) {
      const m = op.turn === "a" ? await pickPoker(op) : pokerPick(st, "b");
      if (id !== runId) return;
      E.chooseGround(st, op.turn, m);
      E.step(st);
      await flush();
      continue;
    }
    const o21 = E.g21Options(st);
    if (o21) {
      const m = o21.turn === "a" ? await pick21(o21) : g21Pick(st, "b");
      if (id !== runId) return;
      E.chooseGround(st, o21.turn, m);
      E.step(st);
      await flush();
      continue;
    }
    const go = E.groundOptions(st);
    if (go) {
      const m = await pickGround(go);
      if (id !== runId) return;
      E.chooseGround(st, "a", m); E.chooseGround(st, "b", groundPick(st, "b"));
      E.step(st);
      await flush();
      continue;
    }
    const o = E.options(st);
    await flush(); // cards that sit a turn out show it before the choice
    if (id !== runId) return;
    if (o) {
      const ch = o.s === "a" ? await pickAttack(o) : aiFight(st, o);
      if (id !== runId) return;
      E.choose(st, ch[0], ch[1]);
    }
    const p = o ? E.needsReact(st) : null, g = p ? await qte(p) : null;
    if (id !== runId) return;
    E.step(st, g);
    await flush();
  }
  if (id !== runId) return;
  await sleep(200);
  shopScreen(st.a.lostLast ? `上一段輸了：金幣 +${st.cfg.gold.loser}` : "");
}

function finish() {
  const o = st.over, w = o.winner, tag = (s) => st[s].f.short.toUpperCase();
  const how = o.how === "DEC" ? ["判定 DECISION", `${o.total.a} – ${o.total.b}`] : o.how === "SUB" ? [`第 ${o.round} 回合 · 降伏`, "SUB"] : [`第 ${o.round} 回合 · 擊倒`, "KO"];
  const flag = w === "a" ? "勝者 · 藍角（你）" : w === "b" ? "勝者 · 紅角" : "判決";
  const hero = (id, left, h, top = 48) => (hasArt(id) ? `<img class="art" style="left:${left}px;top:${top}px;height:${h}px" src="assets/private/${id}/idle.png" alt="" onerror="this.remove()">` : "");
  const cards = (s) => st[s].board.map((c) => (c ? card(c, { side: s }) : empty({ side: s }))).join("");
  const rounds = st.rounds.map((r, i) => `<div class="${r.b > r.a ? "b" : r.a > r.b ? "" : "t"}"><small class="lat">R${i + 1}</small><b class="lat">${r.a}–${r.b}</b></div>`).join("");
  const total = o.how === "DEC" ? `<div class="tot"><small class="lat">TOTAL</small><b class="lat">${o.total.a}–${o.total.b}</b></div>` : "";
  frame.innerHTML = `<div class="shade m-result"></div><div class="spot"></div>
    ${w ? hero(st[w].id, 382, 160) : hero(st.a.id, 330, 140, 60) + hero(st.b.id, 424, 140, 60)}
    ${cols({ a: cards("a"), b: cards("b") })}
    <div class="clock"><div class="r lat">${o.how === "DEC" ? "OFFICIAL DECISION" : o.how === "SUB" ? "SUBMISSION" : "KNOCKOUT"}</div><div class="s t lat">${o.how === "DEC" ? "宣讀判決" : "比賽結束"}</div></div>
    <div class="stat a"><div><b class="lat">${st.a.stats.won}</b><small>贏的段數</small></div><div><b class="lat">${st.a.stats.dmg}</b><small>打掉他的耐久</small></div></div>
    <div class="stat b"><div><b class="lat">${st.b.stats.won}</b><small>贏的段數</small></div><div><b class="lat">${st.b.stats.dmg}</b><small>打掉你的耐久</small></div></div>
    <div class="verdict ${w === "b" ? "red" : w ? "" : "draw"}"><div><small>${flag}</small><b class="lat">${w ? esc(st[w].f.name.toUpperCase()) : "平手 DRAW"}</b></div><div class="how"><small>${how[0]}</small><b class="lat">${how[1]}</b></div></div>
    ${st.rounds.length ? `<div class="sc">${rounds}${total}</div>` : ""}
    <button class="go" id="again" style="left:214px;width:190px;top:322px;height:34px;font-size:17px"><span>再來一場</span><small class="lat">REMATCH</small></button>
    <button class="alt" id="swap" style="position:absolute;left:426px;width:98px;top:324px"><span>換選手</span></button>
    <button class="alt" id="home" style="position:absolute;left:536px;width:98px;top:324px"><span>主選單</span></button>
    <div id="say"><b><span>兩邊是這場最後的牌</span></b></div>`;
  $("#again").onclick = () => { choice.a = st.a.id; choice.b = st.b.id; startGame(); };
  $("#swap").onclick = () => { choice.a = st.a.id; choice.b = st.b.id; pickSel = null; pickScreen(); };
  $("#home").onclick = () => { choice.a = st.a.id; choice.b = st.b.id; menuScreen(); };
}

if (params.has("debug")) window.__bg = { E, get st() { return st; } }; // ?debug: poke the game from the console (set boards, jump ahead)
boot();
