// Octagon Cards — one-on-one board battler, browser front end. Rules live in engine.js / ai.js; this file draws and forwards clicks.
import * as E from "./engine.js";
import { shop as aiShop, fight as aiFight, cornerPick, groundWeights, groundPick, groundRead, g21Threshold, g21Pick, g21Smart } from "./ai.js";

const params = new URLSearchParams(location.search);
const load = async (n) => (await fetch(`rules/bg/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SCHOOL = { punch: "拳", kick: "踢", grap: "摔", def: "防" };
const KW = { guard: "架擋", slip: "閃躲", flurry: "連打", sweep: "掃", sub: "降伏", takedown: "抱摔", sprawl: "防摔", getup: "起身", ground: "地面技", combo: "連段", reach: "長距離" };
const KW_TEXT = {
  guard: () => "對手必須先打這張", slip: () => "躲掉打向它的第一下", flurry: () => "一次出手打兩下", sweep: () => "同時打到目標左右兩張",
  sub: (c) => c.ground.mode === "21" ? `地面：你在上位時，總和 ${c.ground21.subAt} 就算降伏（本來要剛好 ${c.ground21.bust}），傷害 ${c.ground21.submit}` : `地面猜拳：降伏傷害依位置 ${c.ground.moves.sub.hit.byLayer.join(" / ")}（${c.ground.layerNames.join(" / ")}）；你有這張時算深一層`,
  takedown: (c) => c.ground.mode === "21" ? "打中就把這一段帶到地面，你在上位，開始比點數（一段一次）" : `打中就把這一段帶到地面，你在上位，開始最多 ${c.ground.beats} 拍的猜拳（一段一次）。你在下位時轉身逃脫贏了，會翻到上位`,
  sprawl: () => "只要這張還在場上，對手的抱摔都不成功",
  getup: (c) => c.ground.mode === "21" ? `地面：你在下位時，爆牌線從 ${c.ground21.bust} 變成 ${c.ground21.upBust}` : `地面猜拳：你在下位時，爆發起身贏了多脫 ${c.ground.extra} 層`,
  ground: (c) => c.ground.mode === "21" ? `地面：你在上位時，每有一張起手總和 +1（最多 +${c.ground21.startCap}）` : `地面猜拳：你每有一張，砸擊多 ${c.ground.moves.strike.hit.perCard} 傷害`,
  combo: (c) => `前一張出手的也是連段牌：這一下 +${c.combo.atk} 攻擊，可累積到 +${c.combo.atk * c.combo.max}`,
  reach: () => "這張出手時不會被反擊",
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
  if (params.has("ground")) data.config.ground.mode = params.get("ground") === "21" ? "21" : "rps"; // ?ground=21 / ?ground=rps picks the ground game
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  pickScreen();
}

// ---------- fighters on the stage ----------
// Sprites come from assets/private (gitignored). Without them a plain coloured dummy stands in.
const POSES = ["idle", "punch", "kick", "shoot", "hit", "down"], POSE_OF = { punch: "punch", kick: "kick", grap: "shoot", def: "punch" }, K = 0.62;
const art = {}, poseT = {};
let manifest = null;
const loadImage = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
async function loadArt(ids) {
  if (!manifest) { try { const r = await fetch("assets/private/manifest.json"); manifest = r.ok ? await r.json() : {}; } catch { manifest = {}; } }
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
  const set = art[st[s].id] || {}, p = set[name] || set.idle;
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
function fighterPos(s) { return { x: s === "a" ? 366 : 478, y: 116 + 70 }; }

// ---------- cards ----------
/** One card. c = a board card / clash unit / { id } for a shop offer. o: small, cls, attr, note */
function card(c, o = {}) {
  const d = data.skills[c.id], m = c.gold ? data.config.golden : 1;
  const atk = c.pow ?? c.atk ?? d.atk, hp = c.hp ?? d.hp, kw = c.kw ? Object.keys(c.kw) : d.kw, off = c.pow === 0 && c.atk > 0;
  const up = (v, base) => (v > base * m ? "up" : v < base * m ? "down" : "");
  const when = [...new Set(d.fx.map((f) => WHEN[f.when]).filter(Boolean))].map((w) => `<em class="fx">${w}</em>`).join("");
  const stun = (c.stun ? "<em class='bad'>被壓制</em>" : "") + (off ? "<em class='bad'>地面出不了手</em>" : "") + (c.worn ? `<em class="bad">腿傷 −${c.worn}</em>` : "");
  return `<div class="sk ${d.school} ${c.gold ? "gold" : ""} ${o.small ? "s" : ""} ${c.dead ? "dead" : ""} ${off ? "off" : ""} ${o.cls || ""}" data-id="${c.id}" data-kw="${kw.join(",")}" data-atk="${atk}" data-hp="${Math.max(0, hp)}" ${c.gold ? "data-gold" : ""} ${c.worn ? `data-worn="${c.worn}"` : ""} ${o.note ? `data-note="${esc(o.note)}"` : ""} ${o.attr || ""}>
    <i class="g">${SCHOOL[d.school]}</i><b class="nm">${esc(d.name)}</b><span class="tier">${"●".repeat(d.tier)}</span>
    ${kw.length || when || stun ? `<div class="kws">${kw.map((k) => `<em>${KW[k]}</em>`).join("")}${when}${stun}</div>` : ""}
    ${o.small || !o.note ? "" : `<small>${esc(o.note)}</small>`}
    <span class="atk ${up(atk + (c.worn || 0), d.atk)} ${c.worn || (c.pow != null && c.pow < c.atk) ? "down" : ""}">${atk}</span><span class="hp ${up(hp, d.hp)}">${Math.max(0, hp)}</span></div>`;
}

// ---------- card details: mouse over a card, or press and hold on touch ----------
let tipEl = null, tipAt = null, mouse = null, holdT = 0, held = false, downAt = null;
const cardAt = (t) => (t instanceof Element ? t.closest(".sk[data-id]") : null);
function showTip(node) {
  const d = data.skills[node.dataset.id], kws = node.dataset.kw ? node.dataset.kw.split(",") : [], gold = "gold" in node.dataset;
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "tip"; }
  tipEl.className = d.school;
  tipEl.innerHTML = `<b>${esc(d.name)}</b><span>${SCHOOL[d.school]}・第 ${d.tier} 級${gold ? "・金卡" : ""}</span>
    <div class="st"><i class="atk">${node.dataset.atk}</i>攻擊<i class="hp">${node.dataset.hp}</i>耐力</div>
    ${d.fx.length ? `<p>${esc(d.text)}</p>` : ""}${kws.map((k) => `<p><em>${KW[k]}</em>${KW_TEXT[k](data.config)}</p>`).join("")}
    ${node.dataset.worn ? `<p class="dim">腿傷：攻擊 −${node.dataset.worn}，這回合結束才恢復。</p>` : ""}
    ${!d.fx.length && !kws.length ? `<p class="dim">沒有特殊效果，就是數值高。</p>` : ""}
    ${gold ? `<p class="dim">金卡：數值與效果的數字都加倍。</p>` : ""}${node.dataset.note ? `<p class="note">${esc(node.dataset.note)}</p>` : ""}`;
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
const under = (e) => { const n = document.elementFromPoint(e.clientX, e.clientY); return n instanceof Element && frame.contains(n) ? n : null; };
function endDrag() {
  if (!drag) return;
  drag.ghost?.remove(); drag.n.classList.remove("lift"); drag.hot?.classList.remove("hot");
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
    const g = (drag.ghost = drag.n.cloneNode(true));
    for (const a of ["data-uid", "data-drag", "data-slot", "data-offer"]) g.removeAttribute(a);
    g.classList.add("ghost"); g.classList.remove("sel", "can");
    g.style.width = drag.n.offsetWidth + "px"; g.style.height = drag.n.offsetHeight + "px";
    frame.appendChild(g);
    drag.n.classList.add("lift"); frame.classList.add("dragging", "drag-" + drag.n.dataset.drag);
    clearTimeout(holdT); hideTip();
  }
  const f = frame.getBoundingClientRect(), k = scale();
  drag.ghost.style.left = (e.clientX - f.left) / k + "px"; drag.ghost.style.top = (e.clientY - f.top) / k + "px";
  const u = under(e), hot = (u && dnd?.hot(drag.n, u)) || null;
  if (hot !== drag.hot) { drag.hot?.classList.remove("hot"); hot?.classList.add("hot"); drag.hot = hot; }
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

const empty = (o = {}, text = "空位") => `<div class="sk empty ${o.small ? "s" : ""}" ${o.attr || ""}><span>${text}</span></div>`;

// ---------- screens ----------
function pickScreen() {
  runId++; dnd = null;
  const ids = Object.keys(data.fighters);
  const btn = (s, id) => { const f = data.fighters[id]; return `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(f.name)}</b><small>${esc(f.style)}｜${esc(f.power.text)}</small></button>`; };
  frame.innerHTML = `<div class="bgart"></div><div class="over solid"><div class="box">
    <h2>Octagon Cards</h2>
    <p>每一段開打前逛<b>商店</b>買招式。開打後雙方<b>輪流出手</b>：輪到你時，把你的一張牌<b>拖到</b>要打的那張牌上（他有架擋就得先打架擋）；把對方的牌打光，剩下的牌就打在<b>他本人</b>身上。<b>抱摔</b>打中會把這一段帶到地面，改成最多三拍的<b>猜拳</b>：每拍雙方暗選一招同時翻開，上位贏了壓進一層或打人，下位贏了脫出一層。耐久歸零＝KO，否則打完 ${data.config.rounds} 回合看計分。</p>
    <h3>你的選手</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">進商店</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; pickScreen(); }));
  $("#go").onclick = async () => { await loadArt([choice.a, choice.b]); st = E.createGame(data, choice.a, choice.b, Number(params.get("seed")) || (Date.now() % 2147483647)); sel = null; shopScreen(); };
}

function hud(hp = { a: st.a.hp, b: st.b.hp }) {
  const side = (s) => `<div class="hud ${s}" id="hud${s}"><div class="hpn">${hp[s]}</div><div class="hb"><div class="who"><b>${s === "a" ? "你" : "對手"}</b><small>${esc(st[s].f.short)}・${esc(st[s].f.power.text)}</small></div>
    <div class="bar"><b style="width:${(hp[s] / st.cfg.hp) * 100}%"></b></div></div></div>`;
  const cards = st.rounds.map((r) => `${r.a}-${r.b}`).join(" ");
  return `<div id="top">${side("a")}<div id="mid"><b>第 ${st.round} 回合・第 ${st.clash} 段</b><small>這回合 你 <i class="a">${st.wins.a}</i> : <i class="b">${st.wins.b}</i> 他${cards ? "　計分 " + cards : ""}</small></div>${side("b")}</div>`;
}
function setHp(hp) {
  for (const s of ["a", "b"]) { const h = $("#hud" + s); if (!h) continue; h.querySelector(".hpn").textContent = hp[s]; h.querySelector(".bar b").style.width = (hp[s] / st.cfg.hp) * 100 + "%"; }
}

// ---------- shop ----------
function shopScreen(msg = "") {
  if (st.over) return finish();
  if (st.phase === "corner") return cornerScreen();
  const F = st.a, sh = F.shop, cfg = st.cfg.shop;
  const offers = sh.offers.map((id, i) => {
    if (!id) return empty({}, "已買");
    const p = E.place(st, "a", id), can = sh.gold >= cfg.cost && p;
    return card({ id }, { cls: (can ? "buy" : "no") + (p && p.triple ? " triple" : ""), attr: `data-offer="${i}"${can ? ' data-drag="offer"' : ""}`, note: p && p.triple ? "第三張：合成金卡！" : !p ? "技能列滿了，先賣一張" : null });
  }).join("");
  frame.innerHTML = `<div class="bgart shopbg"></div>${hud()}
    <div id="store" data-sell="放這裡賣掉　+${cfg.sell} 金"><h4>商店<small>第 ${sh.tier} 級・牌 ${cfg.cost} 金，拖到下面你的牌那一排就買</small><span class="coins"><i></i>${sh.gold}</span></h4>
      <div class="row">${offers}</div>
      <div class="acts"><button id="reroll" class="${sh.gold >= cfg.reroll ? "" : "no"}">重抽<small>${cfg.reroll} 金</small></button>
      <button id="freeze" class="${sh.frozen ? "on" : ""}">${sh.frozen ? "已凍結" : "凍結"}<small>留到下一段</small></button>
      <button id="tier" class="${E.canTier(st, "a") && sh.gold >= sh.upCost ? "" : "no"}">${E.canTier(st, "a") ? `升級商店<small>${sh.upCost} 金</small>` : "商店已最高級"}</button></div></div>
    <div id="mine"><h4>你的牌<small>${sel == null ? "拖到別格換位置，拖回商店賣掉" : "再點一格換位置，或賣掉"}</small>${sel != null ? `<button id="sell">賣掉 +${cfg.sell} 金</button>` : ""}</h4>
      <div class="row">${F.board.map((c, i) => (c ? card(c, { cls: sel === i ? "sel" : "", attr: `data-slot="${i}" data-drag="slot"` }) : empty({ attr: `data-slot="${i}"` }))).join("")}</div></div>
    <div id="foot"><span class="msg">${esc(msg) || "對手的牌要開打才看得到，自己記住。左下攻擊、右下耐力；滑鼠指著牌（手機按住）看效果。"}</span><button id="fight">開打</button></div>`;
  const buyAt = (i, slot = null) => {
    const id = sh.offers[i], p = id && E.place(st, "a", id);
    if (!E.buy(st, "a", i)) return shopScreen(sh.gold < cfg.cost ? "金幣不夠" : "技能列滿了，先賣掉一張");
    if (p.slot != null && slot != null && slot !== p.slot && !F.board[slot]) E.swap(st, "a", p.slot, slot);
    sel = null; shopScreen(`買了${data.skills[id].name}`);
  };
  const slotOf = (n) => { const x = n.closest("#mine [data-slot]"); return x ? Number(x.dataset.slot) : null; };
  dnd = {
    hot: (from, u) => (from.dataset.drag === "offer" ? (u.closest("#mine") ? u.closest("#mine .sk.empty") || $("#mine .row") : null) : u.closest("#store") || (u.closest("#mine [data-slot]") !== from ? u.closest("#mine [data-slot]") : null)),
    drop: (from, u) => {
      if (from.dataset.drag === "offer") { if (u.closest("#mine")) buyAt(Number(from.dataset.offer), slotOf(u)); return; }
      const i = Number(from.dataset.slot), j = slotOf(u);
      if (u.closest("#store")) { const nm = data.skills[F.board[i].id].name; E.sell(st, "a", i); sel = null; shopScreen(`賣掉${nm}`); }
      else if (j != null && j !== i) { E.swap(st, "a", i, j); sel = null; shopScreen(); }
    },
  };
  frame.querySelectorAll("[data-offer]").forEach((el) => (el.onclick = () => buyAt(Number(el.dataset.offer))));
  frame.querySelectorAll("#mine .sk").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.slot);
    if (sel == null) { if (F.board[i]) sel = i; } else { if (i !== sel) E.swap(st, "a", sel, i); sel = null; }
    shopScreen();
  }));
  if ($("#sell")) $("#sell").onclick = () => { E.sell(st, "a", sel); sel = null; shopScreen(); };
  $("#reroll").onclick = () => shopScreen(E.reroll(st, "a") ? "" : "金幣不夠");
  $("#freeze").onclick = () => { E.freeze(st, "a"); shopScreen(st.a.shop.frozen ? "商店會留到下一段" : ""); };
  $("#tier").onclick = () => shopScreen(E.tierUp(st, "a") ? "商店升級了：之後會出現更強的牌" : E.canTier(st, "a") ? "金幣不夠" : "");
  $("#fight").onclick = () => { if (!F.board.some(Boolean)) return shopScreen("至少要有一張牌"); sel = null; dnd = null; clash(++runId); };
  if (F.discover) discoverScreen();
}

function discoverScreen() {
  const F = st.a, d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="box"><h2>選一張，免費</h2><div class="row big">${F.discover.map((id, i) => card({ id }, { cls: "buy", attr: `data-pick="${i}"`, note: E.place(st, "a", id) ? null : "技能列滿了：選了也放不下" })).join("")}</div></div>`;
  frame.appendChild(d);
  d.querySelectorAll("[data-pick]").forEach((el) => (el.onclick = () => { const id = F.discover[el.dataset.pick]; E.pick(st, "a", Number(el.dataset.pick)); shopScreen(`拿到${data.skills[id].name}`); }));
}

function cornerScreen() {
  const last = st.rounds[st.rounds.length - 1];
  frame.innerHTML = `<div class="bgart shopbg"></div>${hud()}<div class="over solid"><div class="box">
    <h2>第 ${st.round} 回合結束：${last.a > last.b ? "你拿下" : last.b > last.a ? "他拿下" : "平手"}（${last.a}-${last.b}）</h2>
    <p>這回合三段你贏 <b>${last.wins.a}</b> 段、他贏 <b>${last.wins.b}</b> 段。計分卡 ${st.rounds.map((r) => `${r.a}-${r.b}`).join("、")}。</p>
    <h3>角落時間，選一項</h3>
    <div class="pick">${Object.entries(st.cfg.corner).map(([k, o]) => `<button data-k="${k}"><b>${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join("")}</div></div></div>`;
  frame.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { E.corner(st, "b", cornerPick(st, "b")); E.corner(st, "a", b.dataset.k); shopScreen(); }));
}

// ---------- clash ----------
function rows(v) {
  const row = (s) => v[s].map((u) => (u && !u.dead ? card(u, { attr: `data-uid="${u.uid}"` }) : empty({}, u ? "被破解" : ""))).join("");
  $("#rowB").innerHTML = row("b");
  $("#rowA").innerHTML = row("a");
  setGround(v.ground);
}
function setGround(g) {
  const was = ground, b = $("#gnd"), G = st.cfg.ground;
  ground = g || null;
  const m21 = G.mode === "21";
  frame.classList.toggle("gmode", !!ground && !m21);
  frame.classList.toggle("g21mode", !!ground && m21);
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
function say(text, cls = "", small = "") { const b = $("#say"), c = $("#cap"); if (b) b.innerHTML = `<b class="${cls}">${esc(text)}</b>`; if (c) c.textContent = small; }
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
    case "stuffed": float(el(e.uid) && pos(el(e.uid)), "防摔！", "buff"); say(e.s === "a" ? "你擋下了抱摔" : "他擋下了抱摔", e.s === "a" ? "good" : "bad", "防摔牌還在場上，抱摔就不會成功"); return 700;
    case "standup": rows(e.view); if (e.uid) float(el(e.uid) && pos(el(e.uid)), "起身", "buff"); say(e.uid ? (e.s === "a" ? "你站回來了" : "他站回來了") : "站起來了", "", e.uid ? "" : "回到站立"); return 800;
    case "stun": rows(e.view); float(el(e.uid) && pos(el(e.uid)), "被壓制", "dmg"); return 240;
    case "stunned": float(el(e.uid) && pos(el(e.uid)), "出不了手", "dmg"); rows(e.view); return 300;
    case "break": { const n = el(e.uid), p = n && pos(n); float(p, "破解", "break"); rows(e.view); return 280; }
    case "react": say(e.grade === "miss" ? "慢了" : e.grade === "perfect" ? "完美！" : "好！", e.grade === "miss" ? "bad" : "good"); return 250;
    case "clashend": {
      setGround(null);
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
    dnd = {
      hot: (from, u) => (tg.has(uidOf(u)) ? u.closest("[data-uid]") : null),
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
    const left = open ? "" : g.stood[s] ? "已收手" : g.phase === role ? `還能要 ${X.hits - g.hits[s]} 張` : role === "bottom" ? "之後才動" : "";
    const tag = over ? `<em class="ovr">超過 ${bust}</em>` : res && !hide && res.win && res.gap ? `<em class="${res.win === s ? "won" : ""}">${res.win === s ? "贏" : "輸"} ${res.gap}</em>` : `<em class="${bust > X.bust ? "v22" : ""}">爆牌線 ${bust}</em>`;
    // the opponent's real number: what you show him changes it when he is underneath
    let tell = "", th = 0;
    if (!me && !open) {
      th = g21Threshold(st, "b", role, total("a") - g.hands.a[1]);
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
  const lad = ["站起來", ...G.layerNames].map((name, i) => `<div class="${i ? "" : "out"} ${i === g.layer ? "on" : ""}"><span>${name}${i ? `<u>×${X.layerMul[i - 1]}</u>` : ""}</span>${i === g.layer ? `<span class="tag">第 ${g.beat}／${X.hands} 手</span>` : ""}</div>`).join("");
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
      say(e.top === "a" ? "你在上位，你先決定" : "你被壓在下位，他先決定", e.top === "a" ? "good" : "bad");
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
      G21.res = { win, gap: e.res === "top" || e.res === "sub" ? (e.why === "bust" ? 0 : e.gap) : e.why === "bust" ? 0 : Math.abs(t.a - t.b) };
      if (e.res === "tie") { G21.stamp = ["平手", "gold"]; G21.cap = `${score}，裁判叫停，<b>站起來</b>`; }
      else if (e.res === "sub") { G21.stamp = ["降伏！", mine ? "gold" : ""]; G21.cap = `${who(e.top)}鎖死了，<b>${who(bot)}耐久 −${e.dmg}</b>`; }
      else if (e.res === "top") {
        G21.stamp = [e.why === "bust" ? "力氣放盡" : "壓住了", mine ? "gold" : ""];
        G21.cap = (e.why === "bust" ? `${who(bot)}爆牌，差距算 ${e.gap}` : `${score}，差距 ${e.gap}`) + ` ÷${X.div} 進位 × ${names[e.layer - 1]} ${X.layerMul[e.layer - 1]} ＝ <b>${e.cash}</b>`;
      } else {
        G21.stamp = [e.why === "bust" ? "壓過頭" : "脫出！", bot === "a" ? "good" : ""];
        G21.cap = `${e.why === "bust" ? `${who(e.top)}爆牌` : score}，${who(bot)}脫出一層：${e.to >= 1 ? `${names[e.layer - 1]} → <b>${names[e.to - 1]}</b>，地面繼續` : "<b>站起來</b>"}`;
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
      G21.stamp = null; G21.capCls = e.s === "b" ? "red" : ""; G21.cap = `${who(e.s)}砸下去，<b>${who(E.other(e.s))}耐久 −${e.dmg}</b>`; draw21(g);
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
      cash: ["cash", `砸下去　打他 ${v.cash}`, "兌現・結束這段地面"], deeper: ["deep", `過腿　→ ${G.layerNames[v.layer] || ""} ×${X.layerMul[v.layer] || ""}`, `再賭一手・輸了這 ${v.cash} 點就沒了`] };
    box.innerHTML = o.actions.map((a) => `<button class="b ${btn[a][0]}" data-a="${a}"><b>${btn[a][1]}</b><small>${btn[a][2]}</small></button>`).join("");
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { box.replaceChildren(); res(b.dataset.a); }));
    if (o.phase === "decide") say("壓住了：砸下去，還是過腿？", "good");
    else say(`輪到你：${V.hit}或${V.stand}`, v.role === "top" ? "good" : "bad");
  });
}

async function clash(id) {
  aiShop(st, "b");
  frame.innerHTML = `<div class="bgart"></div>${hud()}
    <div class="row" id="rowB"></div><div id="stage"><div id="say"></div><div id="gnd"></div><div class="fz" id="fa"><div class="in"></div></div><div class="fz" id="fb"><div class="in"></div></div></div><div class="row" id="rowA"></div>
    <div id="foot"><button id="speed"></button><div id="cue"><small id="cap"></small><div id="qte"></div></div><button id="quit">重來</button></div>`;
  ground = null; frame.classList.remove("gmode", "g21mode");
  pose("a", "idle"); pose("b", "idle");
  $("#quit").onclick = pickScreen;
  const sp = $("#speed"), label = () => (sp.textContent = speed === 0 ? "速度：跳過" : `速度：${SPEED_NAME[speedIx]}`);
  sp.onclick = () => { speedIx = speed === 0 ? 0 : (speedIx + 1) % SPEEDS.length; speed = SPEEDS[speedIx]; try { localStorage.setItem("bg.speed", speedIx); } catch {} label(); };
  label();
  let from = st.log.length, prev = null;
  E.startClash(st);
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
  const o = st.over, d = document.createElement("div");
  d.className = "over";
  const title = o.winner === "a" ? "你贏了" : o.winner === "b" ? "你輸了" : "平手";
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `KO・第 ${o.round} 回合`;
  frame.innerHTML = `<div class="bgart"></div>${hud()}`;
  d.innerHTML = `<div class="box wide"><h2 class="${o.winner === "a" ? "win" : "lose"}">${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>第 ${i + 1} 回合 <b>${r.a}-${r.b}</b></span>`).join("")}</div>` : ""}
    <p>你贏了 <b>${st.a.stats.won}</b> 段、打掉他 <b>${st.a.stats.dmg}</b> 耐久；他贏了 <b>${st.b.stats.won}</b> 段、打掉你 <b>${st.b.stats.dmg}</b>。</p>
    <h3>你最後的牌</h3><div class="row s">${st.a.board.map((c) => (c ? card(c, { small: true }) : "")).join("")}</div>
    <h3>他最後的牌</h3><div class="row s">${st.b.board.map((c) => (c ? card(c, { small: true }) : "")).join("")}</div>
    <button class="go" id="again">再來一場</button></div>`;
  frame.appendChild(d);
  $("#again").onclick = pickScreen;
}

if (params.has("debug")) window.__bg = { E, get st() { return st; } }; // ?debug: poke the game from the console (set boards, jump ahead)
boot();
