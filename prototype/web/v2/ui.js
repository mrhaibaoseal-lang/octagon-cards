// Octagon Cards V2 — browser front end for the "solve the exchange" prototype.
// All rules live in engine.js / ai.js; this file only draws state and forwards clicks.
import * as E from "./engine.js";
import { lead, cornerPick } from "./ai.js";

const params = new URLSearchParams(location.search);
const fast = params.has("fast");
const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
const load = async (n) => (await fetch(`rules/v2/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CAT = { strike: "打擊", takedown: "抱摔", counter: "防守反擊", move: "走位", gnp: "地面打擊", control: "壓制", getup: "起身", cover: "護住", survive: "求生", chase: "追擊" };
const REGION = { head: "頭", body: "身體", legs: "腿" };
const RANGE = ["遠距", "近距", "抱纏"];
const RSHORT = ["遠", "近", "纏"];
const WHY = { scene: "這個場景不能用", range: "距離不對", cage: "沒有空間", done: "已經準備了" };

let data, st, busy = false, choice = { a: null, b: null };
const frame = $("#frame");

function fit() {
  const s = Math.min(innerWidth / 844, innerHeight / 390);
  frame.style.transform = `scale(${s})`;
}
addEventListener("resize", fit);

async function boot() {
  const [config, cards, fighters] = await Promise.all([load("config"), load("cards"), load("fighters")]);
  data = E.prepare({ config, cards: strip(cards), fighters: strip(fighters) });
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  startScreen();
}

// ---------- screens ----------
function startScreen() {
  const ids = Object.keys(data.fighters);
  const btn = (s, id) => {
    const f = data.fighters[id];
    return `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(f.name)}</b><small>${esc(f.style)}｜體力 ${f.gas}・下巴 ${f.chin}<br>${esc(f.trait.text)}</small></button>`;
  };
  frame.innerHTML = `<div class="over"><div class="box">
    <h2>Octagon Cards V2 · 解題式交鋒</h2>
    <p>對手每一段會先<b>決定計畫</b>；你看得到多少取決於<b>看穿度</b>。你用 <b>${data.config.energy} 點氣</b>出多張牌回應，然後他的計畫才執行。${data.config.rounds} 回合 × ${data.config.exchanges} 段。</p>
    <h3>你用誰</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">開打</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; startScreen(); }));
  $("#go").onclick = () => start();
}

function start() {
  const seed = Number(params.get("seed")) || (Date.now() % 2147483647);
  st = E.createBout(data, choice.a, choice.b, seed);
  lead(st);
  busy = false;
  frame.innerHTML = `
    <div id="top"><div class="side l" id="sa"></div><div id="mid"></div><div class="side r" id="sb"></div></div>
    <div id="intent"></div>
    <div id="arena"><div class="cage l"></div><div class="cage r"></div><div class="man a"><i class="hd"></i><i class="tr"></i><i class="lg"></i></div><div class="man b"><i class="hd"></i><i class="tr"></i><i class="lg"></i></div><div class="floor"></div></div>
    <button id="helpbtn">？規則</button><button id="restart">重來</button>
    <div id="log"></div>
    <div id="hand"></div><div id="basics"></div>
    <div id="side"><div id="energy"></div><div id="seq"></div><button id="throttle"></button><button id="end"></button></div>`;
  $("#helpbtn").onclick = help;
  $("#restart").onclick = () => { if (!busy) startScreen(); };
  $("#throttle").onclick = () => doAct({ type: "throttle" });
  $("#end").onclick = endTurn;
  logLine(`第 1 回合開始。${st.b.f.short} 的習慣你還不熟，先看傾向。`, "sep");
  render();
}

function help() {
  const c = data.config;
  const d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="box"><h2>規則速覽</h2>
  <p><b>一段交鋒</b>：對手先定好計畫（左上角）。你出牌，每張立刻結算；按「結束這一段」後他的計畫才執行。他計畫裡的防守（閃躲／擋踢／壓趴／架擋）在你出牌時就已經就位。</p>
  <p><b>看穿度</b>：Lv0 只看到他各種計畫的真實機率；Lv1 知道這一段是哪一類、主攻哪裡；Lv2 看到每一張牌。每撐過一段 +${c.read.perExchange}，起手牌碰到 +${c.read.setup}，防守成功 +${c.read.defence}。</p>
  <p><b>氣與體力</b>：每段 ${c.energy} 點氣（對手先亮牌所以多 ${c.leadEnergy} 點）。沒用完的氣每點回 1 體力，全用完扣 ${c.gasFullCost}。催油門：體力 −${c.throttle.gas} 換 +${c.throttle.energy} 氣，一段最多 ${c.throttle.max} 次。體力低於 ${pct(c.lowGasFrac)} 時只剩 ${c.lowGasEnergy} 點氣、打實率 ${pct(c.hit.tired)}。</p>
  <p><b>連段</b>：起手牌（刺拳、假動作）之後下一張打實 +${pct(c.hit.setup)}；換攻擊部位 +${pct(c.hit.levelChange)}。終結技沒鋪墊又沒打實會<b>露破綻</b>（他對你打實 +${pct(c.hit.open)}）。</p>
  <p><b>防守</b>：架擋擋 2 記（頭不會被打實）；閃躲躲掉一記頭部拳並反擊；擋踢讓他的腿反吃傷害；壓趴讓抱摔必敗；後撤讓近距離的招打空。</p>
  <p><b>傷害</b>：頭→暈眩，滿了就<b>被打晃</b>（對手下一段 +${c.rock.chase} 氣，再吃 ${c.rock.hp} 傷害就 TKO）；身體→每 ${c.body.perGas} 傷害扣 1 體力上限；腿→每 ${c.legs.perStack} 傷害一層（${c.legs.moveStacks} 層移動變貴，${c.legs.powerStacks} 層出手變弱）。</p>
  <p><b>判分</b>：每回合看上方分數條，高的拿 10-9（差 ${c.score.big} 以上 10-8），最後一段分數 ×${c.score.lastMul}。</p>
  <button class="go">知道了</button></div>`;
  d.querySelector(".go").onclick = () => d.remove();
  frame.appendChild(d);
}

// ---------- drawing ----------
const who = (s) => (s === "a" ? "你" : st.b.f.short);
const nameOf = (id) => E.defOf(st, id)?.name || id;
const live = () => ({ a: one("a"), b: one("b"), range: st.range, pos: st.pos, ground: st.ground ? st.ground.top : null });
const one = (s) => { const F = st[s]; return { stun: F.stun, chin: F.chin, gas: F.gas, gasMax: F.gasMax, body: F.bodyDmg, legs: F.legDmg, rocked: !!F.rocked, score: F.score, energy: F.energy }; };

function gauges(sn) {
  for (const s of ["a", "b"]) {
    const F = st[s], g = sn[s], base = F.f.gas;
    const stacks = Math.floor(g.legs / st.cfg.legs.perStack), low = g.gas <= base * st.cfg.lowGasFrac;
    const chips = [];
    if (g.rocked) chips.push(`<span class="chip hot">被打晃</span>`);
    if (E.isOpen(st, s)) chips.push(`<span class="chip warn">露破綻</span>`);
    if (low) chips.push(`<span class="chip warn">沒體力</span>`);
    if (g.body >= 1) chips.push(`<span class="chip">身體 ${Math.round(g.body)}</span>`);
    if (stacks) chips.push(`<span class="chip ${stacks >= st.cfg.legs.moveStacks ? "warn" : ""}">腿 ${stacks} 層</span>`);
    if (s === "a") for (const k of Object.keys(F.def)) if (F.def[k] && F.def[k].name) chips.push(`<span class="chip hot">${esc(F.def[k].name)}${k === "guard" ? "×" + F.block : ""}</span>`);
    $("#s" + s).innerHTML = `
      <div class="row"><span class="nm">${s === "a" ? "你" : "對手"}<small>${esc(F.f.short)}</small></span>${chips.join("")}</div>
      <div class="row"><div class="bar stun"><b style="width:${Math.min(100, (g.stun / g.chin) * 100)}%"></b></div><span class="lbl">暈眩 ${Math.round(g.stun)}/${g.chin}</span>
      <div class="bar gas"><b style="width:${(g.gas / base) * 100}%"></b><i class="lost" style="width:${((base - g.gasMax) / base) * 100}%"></i></div><span class="lbl">體力 ${g.gas}/${g.gasMax}</span></div>`;
  }
  const sa = sn.a.score, sb = sn.b.score, share = sa + sb > 0 ? sa / (sa + sb) : 0.5;
  $("#mid").innerHTML = `<div class="clock">第 ${st.round} 回合<small>第 ${Math.min(st.ex, st.cfg.exchanges)}/${st.cfg.exchanges} 段${st.ex === st.cfg.exchanges ? "（分數 ×" + st.cfg.score.lastMul + "）" : ""}</small></div>
    <div id="scorebar"><b style="width:${share * 100}%"></b><i></i></div>
    <div class="pts">本回合 <b>${sa.toFixed(1)}</b> : <b>${sb.toFixed(1)}</b>${st.rounds.length ? "　已判 " + st.rounds.map((r) => `${r.a}-${r.b}`).join(" ") : ""}</div>`;
  // arena
  const gap = [26, 13, 6][sn.range], c = 50 + sn.pos * 15;
  const xa = Math.max(9, Math.min(91 - gap, c - gap / 2)), xb = xa + gap;
  const ma = $(".man.a"), mb = $(".man.b");
  ma.style.left = (sn.ground ? c - 3 : xa) + "%";
  mb.style.left = (sn.ground ? c + 3 : xb) + "%";
  for (const [m, s] of [[ma, "a"], [mb, "b"]]) {
    m.classList.toggle("rocked", sn[s].rocked);
    m.classList.toggle("open", E.isOpen(st, s));
    m.classList.toggle("down", !!sn.ground && sn.ground !== s);
    m.classList.toggle("ontop", sn.ground === s);
  }
  $(".cage.l").classList.toggle("on", sn.pos <= -2);
  $(".cage.r").classList.toggle("on", sn.pos >= 2);
  $(".floor").innerHTML = sn.ground ? `地面：<b>${who(sn.ground)}</b> 在上位` : `<b>${RANGE[sn.range]}</b>${sn.pos <= -2 ? "・你背貼籠邊" : sn.pos >= 2 ? "・他背貼籠邊" : sn.pos < 0 ? "・你被壓向籠邊" : sn.pos > 0 ? "・你把他壓向籠邊" : "・場中央"}`;
}

function drawIntent() {
  const v = E.visibleIntent(st), box = $("#intent");
  if (!v) { box.innerHTML = ""; return; }
  const lv = st.cfg.read.levels, pts = st.a.readPts, next = lv[v.level + 1];
  const prog = next ? (pts - lv[v.level]) / (next - lv[v.level]) : 1;
  let h = `<h4>${esc(st.b.f.short)} 的計畫<span>看穿 Lv${v.level}<i class="readbar"><b style="width:${prog * 100}%"></b></i></span></h4>`;
  if (v.cancelled) h += `<div class="plan">計畫被你打斷了<small>這一段他什麼都做不了</small></div>`;
  else if (v.steps) {
    h += `<div class="plan">${CAT[v.cat] || v.cat}${v.focus ? `<small>主攻${REGION[v.focus]}</small>` : ""}${v.throttle ? `<small>催了油門</small>` : ""}</div><div class="steps">`;
    st.intent.steps.forEach((x) => {
      const d = E.defOf(st, x.id);
      const pre = x.pre || x.held, gone = x.pre && !st.b.def[d.def];
      const whiff = !pre && !E.usable(st, "b", d).ok;
      h += `<span class="step ${d.region || ""} ${pre ? "pre" : ""} ${whiff || gone ? "whiff" : ""}">${esc(d.name)}${pre ? (gone ? "（已破）" : "（已就位）") : whiff ? "（夠不到）" : ""}</span>`;
    });
    h += `</div>`;
    if (v.habits.length) h += `<div class="note">習慣：<b>${v.habits.map(esc).join("；")}</b></div>`;
  } else if (v.cat) {
    h += `<div class="plan">${CAT[v.cat] || v.cat}${v.focus ? `<small>主攻${REGION[v.focus]}</small>` : ""}</div>`;
    const bits = [];
    if (v.forced) bits.push(v.cat === "survive" ? "他被打晃，只能求生" : "你被打晃，他全力追擊");
    if (v.advance) bits.push("會前壓");
    if (v.hasDef) bits.push("<b>有準備防守</b>（哪一種還看不出來）");
    h += `<div class="note">${bits.join("・") || "看不出更多細節"}</div><div class="note">看穿 Lv2 才看得到每一張牌。</div>`;
  } else {
    for (const [k, p] of Object.entries(v.cats).sort((x, y) => y[1] - x[1])) h += `<div class="catrow"><span>${CAT[k] || k}</span><i><b style="width:${p * 100}%"></b></i><em>${pct(p)}</em></div>`;
    h += `<div class="note">還沒看穿：只知道他這一段各種計畫的真實機率。</div>`;
  }
  box.innerHTML = h;
}

function cardHtml(id, i, legalMap) {
  const d = E.defOf(st, id), lvl = E.readLevel(st, "a"), pv = E.preview(st, "a", d, lvl >= 2);
  const lg = legalMap.get("c" + i);
  const cls = d.region || (d.kind === "takedown" || d.kind === "pass" || d.kind === "escape" ? "grap" : "");
  const tag = [d.region ? REGION[d.region] : { feint: "假動作", defence: "防守", move: "移動", takedown: "摔", pass: "地面", escape: "起身" }[d.kind] || "", d.scene === "stand" ? (d.range ? d.range.map((r) => RSHORT[r]).join("／") : "") : d.scene === "top" ? "上位" : "下位"].filter(Boolean).join("・");
  let nums = "", warn = "";
  if (d.kind === "strike") {
    nums = `<span>傷 ${pv.dmg}${pv.hits > 1 ? "×" + pv.hits : ""}</span><span class="${pv.clean === 0 ? "zero" : pv.up ? "up" : ""}">打實 ${pct(pv.clean)}${pv.up && pv.clean ? "↑" : ""}</span>${pv.ko > 0 ? `<span class="ko">KO ${pct(pv.ko)}</span>` : ""}`;
    if (pv.blocked === "slip") warn = "會被閃躲反擊";
    else if (pv.blocked === "check") warn = "會被擋踢";
    else if (pv.blocked === "guard") warn = `他架擋中（還擋 ${pv.block} 記）`;
    else if (d.finisher && !pv.up) warn = "沒鋪墊：沒打實會露破綻";
  }
  if (d.kind === "takedown") { nums = `<span class="${pv.p === 0 ? "zero" : ""}">成功 ${pct(pv.p)}</span>`; if (pv.p === 0) warn = "他準備了壓趴"; }
  if (d.kind === "escape") nums = `<span>成功 ${pct(pv.p)}</span>`;
  let off = !lg, strug = lg && lg.type === "struggle";
  if (!pv.ok && !strug) warn = WHY[pv.why] || "不能用";
  else if (strug) warn = `丟掉掙扎：起身 +${pct(st.cfg.ground.struggle)}`;
  else if (pv.ok && pv.cost > st.a.energy) warn = "氣不夠";
  return `<button class="card ${cls} ${off ? "off" : ""} ${strug ? "strug" : ""}" data-i="${i}"><span class="cost">${pv.cost}</span><span class="cn">${esc(d.name)}</span><span class="tag">${tag}</span><div class="nums">${nums}</div>${warn ? `<em class="warn">${warn}</em>` : ""}<small>${esc(d.text || "")}</small></button>`;
}

function render() {
  gauges(live());
  drawIntent();
  const lm = new Map();
  for (const x of E.legal(st)) lm.set(x.type === "throttle" ? "t" : x.type === "basic" ? "b" + x.id : "c" + x.i, x);
  $("#hand").innerHTML = st.a.hand.map((id, i) => cardHtml(id, i, lm)).join("");
  $("#hand").querySelectorAll(".card").forEach((el) => (el.onclick = () => { const x = lm.get("c" + el.dataset.i); if (x) doAct({ type: x.type, i: x.i }); }));
  const sc = E.scene(st, "a");
  $("#basics").innerHTML = Object.values(st.cfg.basics).filter((d) => d.scene === sc).map((d) => {
    const pv = E.preview(st, "a", d, E.readLevel(st, "a") >= 2), on = lm.has("b" + d.id);
    const extra = d.kind === "escape" ? ` <span class="p">${pct(pv.p)}</span>` : d.kind === "strike" ? ` <span class="p">傷 ${pv.dmg}・${pct(pv.clean)}</span>` : "";
    return `<button class="basic ${on ? "" : "off"}" data-id="${d.id}"><span class="cost">${pv.cost}</span><b>${esc(d.name)}${extra}</b><small>${!pv.ok ? WHY[pv.why] : esc(d.text)}</small></button>`;
  }).join("");
  $("#basics").querySelectorAll(".basic").forEach((el) => (el.onclick = () => { if (lm.has("b" + el.dataset.id)) doAct({ type: "basic", id: el.dataset.id }); }));
  const A = st.a, t = st.cfg.throttle;
  const end = A.energy > 0 ? `+${A.energy} 體力` : A.f.trait?.type === "bigTank" ? "體力不變" : `−${st.cfg.gasFullCost} 體力`;
  $("#energy").innerHTML = `<div class="orbs">${"<i></i>".repeat(A.energy) || "<span style='font-size:11px;color:var(--dim)'>氣用完了</span>"}</div><small>氣 ${A.energy}｜這段結束 <b>${end}</b></small>`;
  const seq = [];
  if (A.seq.setup) seq.push(`起手 +${pct(st.cfg.hit.setup)}`);
  if (A.seq.last) seq.push(`剛打${REGION[A.seq.last]}，換部位 +${pct(st.cfg.hit.levelChange)}`);
  $("#seq").textContent = seq.join("｜");
  const th = $("#throttle");
  th.classList.toggle("off", !lm.has("t"));
  th.innerHTML = `催油門 +${t.energy} 氣<small>體力 −${t.gas}（${A.throttled}/${t.max}）</small>`;
  $("#end").innerHTML = `結束這一段<small>換 ${esc(st.b.f.short)} 出手</small>`;
  $("#end").classList.toggle("off", busy);
}

function logLine(text, cls = "") {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = text;
  const box = $("#log");
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function float(s, text, cls) {
  const m = $(".man." + s), f = document.createElement("div");
  f.className = "float " + cls;
  f.textContent = text;
  f.style.left = m.style.left;
  $("#arena").appendChild(f);
  setTimeout(() => f.remove(), 900);
}
function shake(s) { const m = $(".man." + s); m.classList.remove("hit"); void m.offsetWidth; m.classList.add("hit"); }

/** Turn one engine event into a log line and a little arena feedback. Returns false for silent events. */
function show(e) {
  const o = e.s ? E.other(e.s) : null, n = e.id ? nameOf(e.id) : "";
  switch (e.t) {
    case "hit": logLine(`${who(e.s)} ${n}：${e.clean ? "打實" : "擦到"}${e.guard ? "（被架擋）" : ""}，${REGION[e.region]} −${e.dmg}`, e.s); float(o, `${e.clean ? "打實 " : ""}−${e.dmg}`, e.clean ? "clean" : "graze"); shake(o); break;
    case "miss": logLine(`${who(e.s)} ${n}：打空`, e.s); float(o, "打空", "graze"); break;
    case "whiff": logLine(`${who(e.s)} ${n}：夠不到，揮空了`, "big"); float(e.s, "揮空", "info"); break;
    case "slip": logLine(`${who(e.s)} 閃掉 ${n} 並反擊！`, "big"); float(e.s, "閃躲反擊", "info"); break;
    case "check": logLine(`${who(e.s)} 擋下 ${n}，踢的人腿反而受傷`, "big"); float(e.s, "擋踢", "info"); break;
    case "feint": logLine(`${who(e.s)} ${n}${e.bit.length ? "：騙掉了" + e.bit.map((k) => ({ slip: "閃躲", check: "擋踢", sprawl: "壓趴" })[k]).join("、") + "！" : ""}`, e.bit.length ? "big" : e.s); if (e.bit.length) float(o, "被騙", "bad"); break;
    case "defence": logLine(`${who(e.s)} 準備${n}`, e.s); break;
    case "move": logLine(`${who(e.s)} ${n}`, e.s); break;
    case "takedown": logLine(`${who(e.s)} ${n}（${pct(e.p)}）：${e.ok ? "成功，進地面上位" : "被擋下"}`, e.ok ? "big" : e.s); float(e.s, e.ok ? "抱摔成功" : "抱摔失敗", e.ok ? "info" : "graze"); break;
    case "sprawl": logLine(`${who(e.s)} 壓趴了抱摔！`, "big"); float(e.s, "壓趴", "info"); break;
    case "control": logLine(`${who(e.s)} 壓制`, e.s); break;
    case "pass": logLine(`${who(e.s)} 過腿，位置更好`, e.s); break;
    case "escape": logLine(`${who(e.s)} ${n}（${pct(e.p)}）：${e.ok ? "站起來了" : "沒起來"}`, e.ok ? "big" : e.s); break;
    case "standup": logLine(`${who(e.s)} 放對手起來`, e.s); break;
    case "refstand": logLine("地面沒有進展，裁判叫起", "big"); break;
    case "rocked": logLine(`${who(e.s)} 被打晃了！`, "big"); float(e.s, "打晃！", "clean"); break;
    case "recover": logLine(`${who(e.s)} 撐過來了（下巴變弱）`, e.s); break;
    case "open": logLine(`${who(e.s)} 露出破綻`, "big"); float(e.s, "破綻", "bad"); break;
    case "throttle": logLine(`${who(e.s)} 催油門`, e.s); break;
    case "struggle": logLine(`${who(e.s)} 掙扎（丟掉 ${n}）`, e.s); break;
    case "trait": logLine(`${who(e.s)} 的風格發動：${st[e.s].f.trait.text}`, "big"); break;
    case "cancelled": logLine(`${who(e.s)} 的計畫被打斷`, "big"); break;
    case "roundend": logLine(`第 ${e.round} 回合結束：${e.card.a}-${e.card.b}（${e.card.pts.a} : ${e.card.pts.b}）`, "sep"); break;
    default: return false;
  }
  return true;
}

function doAct(action) {
  if (busy || !st || st.over) return;
  const from = st.log.length;
  if (!E.act(st, action)) return;
  for (const e of st.log.slice(from)) show(e);
  render();
  if (st.over) finish();
}

async function endTurn() {
  if (busy || !st || st.over || st.phase !== "play") return;
  busy = true;
  $("#end").classList.add("off");
  const from = st.log.length;
  E.endExchange(st);
  for (const e of st.log.slice(from)) {
    if (e.t === "over") continue;
    gauges(e.snap);
    if (show(e)) await sleep(520);
  }
  busy = false;
  if (st.over) return finish();
  if (st.phase === "corner") return cornerScreen();
  lead(st);
  render();
}

function cornerScreen() {
  gauges(live());
  const c = st.cfg.corner, last = st.rounds[st.rounds.length - 1];
  const d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="box"><h2>第 ${st.round} 回合結束：${last.a}-${last.b}</h2>
    <p>本回合分數 <b>${last.pts.a}</b> : <b>${last.pts.b}</b>。目前比數 ${st.rounds.map((r) => `${r.a}-${r.b}`).join("、")}。</p>
    <p>你：暈眩 ${Math.round(st.a.stun)}/${st.a.chin}・體力 ${st.a.gas}/${st.a.gasMax}　｜　${esc(st.b.f.short)}：暈眩 ${Math.round(st.b.stun)}/${st.b.chin}・體力 ${st.b.gas}/${st.b.gasMax}</p>
    <h3>角落 60 秒：選一項（另外一定會回 體力 +${c.base.gas}、暈眩 −${c.base.stun}）</h3>
    <div class="pick">${Object.entries(c.options).map(([k, o]) => `<button data-k="${k}"><b>${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join("")}</div></div>`;
  d.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const mine = b.dataset.k, his = cornerPick(st, "b");
    E.corner(st, mine, his);
    d.remove();
    logLine(`第 ${st.round} 回合開始。你選了${c.options[mine].name}，${st.b.f.short} 選了${c.options[his].name}。`, "sep");
    lead(st);
    render();
  }));
  frame.appendChild(d);
}

function finish() {
  render();
  const o = st.over, d = document.createElement("div");
  d.className = "over";
  const title = o.winner === "a" ? "你贏了" : o.winner === "b" ? "你輸了" : "平手";
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `${o.how}・第 ${o.round} 回合第 ${o.ex} 段`;
  d.innerHTML = `<div class="box"><h2>${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>R${i + 1} <b>${r.a}-${r.b}</b>（${r.pts.a} : ${r.pts.b}）</span>`).join("")}</div>` : ""}
    <p>你：造成傷害 ${Math.round(st.a.stats.dmg)}・打實 ${st.a.stats.clean}/${st.a.stats.landed}・打晃對手 ${st.a.stats.rocked} 次・抱摔 ${st.a.stats.td}/${st.a.stats.tdTry}</p>
    <p>${esc(st.b.f.short)}：造成傷害 ${Math.round(st.b.stats.dmg)}・打實 ${st.b.stats.clean}/${st.b.stats.landed}・打晃你 ${st.b.stats.rocked} 次・抱摔 ${st.b.stats.td}/${st.b.stats.tdTry}</p>
    <button class="go">再來一場</button></div>`;
  d.querySelector(".go").onclick = startScreen;
  setTimeout(() => frame.appendChild(d), fast ? 0 : 700);
}

boot();
