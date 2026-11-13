// Octagon Cards V2 — browser front end for the "solve the exchange" prototype.
// All rules live in engine.js / ai.js; this file only draws state and forwards clicks.
// The screen answers three questions: what is he about to do (the sentence in the middle),
// what can I do (the answer buttons, then the hand), what just happened (text on the fighters).
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

const REGION = { head: "頭", body: "身體", legs: "腿" };
const DOES = { control: "壓住你", pass: "過腿", escape: "想站起來", standup: "放你起來" };
const DEFTAG = { guard: "擋", slip: "閃", check: "擋踢", sprawl: "防摔" };

let data, st, busy = false, acting = false, choice = { a: null, b: null };
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
    return `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(f.name)}</b><small>${esc(f.style)}</small></button>`;
  };
  frame.innerHTML = `<div class="over"><div class="box">
    <h2>Octagon Cards</h2>
    <p>畫面中間會寫<b>他接下來要做什麼</b>。你先<b>應對</b>，他出手，然後你<b>反擊</b>。${data.config.rounds} 回合，每回合 ${data.config.exchanges} 段。</p>
    <h3>你用誰</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">開打</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; startScreen(); }));
  $("#go").onclick = () => start();
}

function start() {
  const seed = Number(params.get("seed")) || (Date.now() % 2147483647);
  st = E.createBout(data, choice.a, choice.b, seed);
  busy = acting = false;
  frame.innerHTML = `
    <div id="top"><div class="side l" id="sa"></div><div id="mid"></div><div class="side r" id="sb"></div></div>
    <div id="stage">
      <div id="say"></div>
      <div class="man a"><em></em><i class="hd"></i><i class="tr"></i><i class="lg"></i></div>
      <div class="man b"><em></em><i class="hd"></i><i class="tr"></i><i class="lg"></i></div>
      <div class="floor"></div>
      <button id="helpbtn">？怎麼玩</button><button id="restart">重來</button>
    </div>
    <div id="flow"></div>
    <div id="verbs"></div>
    <div id="hand"></div>
    <div id="side"><div id="energy"></div><button id="end"></button></div>`;
  $("#helpbtn").onclick = help;
  $("#restart").onclick = () => { if (!busy) startScreen(); };
  $("#end").onclick = endTurn;
  lead(st);
  render();
}

function help() {
  const c = data.config;
  const d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="box"><h2>怎麼玩</h2>
  <p><b>1. 看中間那句話。</b>那是他這一段要做的事，他一定照做。</p>
  <p><b>2. 先應對。</b>你有 ${c.energy} 點氣。<b>藍框</b>的按鈕對這一段有用：擋（少吃一半）、閃（躲拳並反擊）、擋踢、防摔、退（讓近身的招揮空）。也可以不管他，直接出牌搶先打。</p>
  <p><b>3. 按「換他出手」</b>，他打完，你再用<b>剩下的氣</b>出牌反擊。閃、擋踢、防摔成功，或他揮空，他會<b>露破綻</b>（發紅光）：這一段你更容易打實。</p>
  <p><b>他頭上的小標籤</b>是他準備好的防守：有「閃」時你的頭部拳會被躲掉，有「擋踢」時別踢腿。<b>假動作</b>牌可以把它騙掉。</p>
  <p><b>輸贏</b>：紅條（頭）滿了會被打晃，被打晃時再吃 ${c.rock.hp} 點傷害就輸。沒人倒下就看 ${c.rounds} 回合的分數。</p>
  <p><b>體力</b>（黃條）：氣全用完會扣 ${c.gasFullCost}，沒用完的每點回 1。身體被打會讓上限變少；體力太低時每段只剩 ${c.lowGasEnergy} 點氣。</p>
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
    const chips = [];
    if (g.rocked) chips.push(`<span class="chip hot">被打晃</span>`);
    if (g.gas <= base * st.cfg.lowGasFrac) chips.push(`<span class="chip warn">沒體力</span>`);
    if (Math.floor(g.legs / st.cfg.legs.perStack) >= st.cfg.legs.powerStacks) chips.push(`<span class="chip warn">腿傷：出手變弱</span>`);
    $("#s" + s).innerHTML = `
      <div class="row"><span class="nm">${s === "a" ? "你" : "對手"}<small>${esc(F.f.short)}</small></span>${chips.join("")}</div>
      <div class="row"><span class="k">頭</span><div class="bar stun"><b style="width:${Math.min(100, (g.stun / g.chin) * 100)}%"></b></div><span class="v">${Math.round(g.stun)}/${g.chin}</span>
      <span class="k">體力</span><div class="bar gas"><b style="width:${(g.gas / base) * 100}%"></b><i class="lost" style="width:${((base - g.gasMax) / base) * 100}%"></i></div><span class="v">${g.gas}</span></div>`;
  }
  const pts = (x) => Math.round(x);
  $("#mid").innerHTML = `<div class="clock">第 ${st.round} 回合　${Math.min(st.ex, st.cfg.exchanges)}/${st.cfg.exchanges}</div>
    <div class="pts">分數　你 <b class="a">${pts(sn.a.score)}</b> : <b class="b">${pts(sn.b.score)}</b> 他${st.rounds.length ? `<small>已判 ${st.rounds.map((r) => `${r.a}-${r.b}`).join(" ")}</small>` : ""}</div>`;
  // the two fighters
  const gap = [34, 13, 6][sn.range];
  const ma = $(".man.a"), mb = $(".man.b");
  ma.style.left = (sn.ground ? 48 : 50 - gap / 2) + "%";
  mb.style.left = (sn.ground ? 52 : 50 + gap / 2) + "%";
  for (const [m, s] of [[ma, "a"], [mb, "b"]]) {
    m.classList.toggle("rocked", sn[s].rocked);
    m.classList.toggle("open", E.isOpen(st, s));
    m.classList.toggle("down", !!sn.ground && sn.ground !== s);
    m.classList.toggle("ontop", sn.ground === s);
    const tags = Object.keys(st[s].def).filter((k) => DEFTAG[k]).map((k) => DEFTAG[k] + (k === "guard" && st[s].block < 90 ? "×" + st[s].block : ""));
    m.querySelector("em").textContent = sn.ground ? "" : tags.join(" ");
  }
  $(".floor").innerHTML = sn.ground ? `地面：<b>${who(sn.ground)}</b>在上面` : `<b>${["遠距離", "近距離", "抱在一起"][sn.range]}</b>`;
}

/** The sentence in the middle: what he is about to do, in plain words. */
function drawSay(now) {
  const box = $("#say"), it = st.intent, B = esc(st.b.f.short);
  if (now) { box.innerHTML = `<small>${B} 出手</small><b class="${now.cls || ""}">${esc(now.text)}</b>`; return; }
  if (!it) { box.innerHTML = ""; return; }
  if (it.cancelled) { box.innerHTML = `<small>${B}</small><b class="good">被你打斷了</b><span>這一段他什麼都做不了，放心打</span>`; return; }
  if (st.stage === "post") {
    const hot = E.isOpen(st, "b") && !st.ground;
    box.innerHTML = `<small>他打完了</small><b class="good">換你反擊</b><span>${hot ? "<u>他露破綻：這一段你更容易打實</u>" : "用剩下的氣出牌，或直接結束"}</span>`;
    return;
  }
  const fc = E.forecast(st), hit = { head: 0, body: 0, legs: 0 }, parts = [];
  let td = false, shortN = 0, fake = false;
  for (const { d, reach } of fc) {
    if (reach && d.kind === "feint" && !parts.length && !td && !hit.head && !hit.body && !hit.legs) fake = true;
    if (!reach) { if (d.kind === "strike" || d.kind === "takedown") shortN++; continue; }
    if (d.kind === "strike") hit[d.region] += d.hits || 1;
    else if (d.kind === "takedown") td = true;
    else if (DOES[d.kind]) parts.push(DOES[d.kind]);
  }
  const n = (k) => (hit[k] > 1 ? ` ×${hit[k]}` : "");
  if (hit.legs) parts.unshift(`踢你的腿${n("legs")}`);
  if (hit.body) parts.unshift(`打你的身體${n("body")}`);
  if (hit.head) parts.unshift(`打你的頭${n("head")}`);
  if (td) parts.unshift("抱摔你");
  const big = parts.length ? (fake ? "先騙你，再" : "") + parts.join("＋") : shortN ? "夠不到你" : Object.keys(st.b.def).length ? "守著等你出手" : "沒有動作";
  const chips = it.steps.filter((x) => !x.pre).map((x) => {
    const d = E.defOf(st, x.id);
    if (d.kind === "move") return d.move === "advance" ? `<i class="mv">追上來</i>` : `<i class="mv">${esc(d.name)}</i>`;
    const f = fc.find((y) => y.d === d);
    return `<i class="${d.region || ""} ${f && !f.reach ? "x" : ""}">${esc(d.name)}</i>`;
  }).join("");
  const ans = E.answers(st), chase = it.steps.some((x) => E.defOf(st, x.id).move === "advance");
  const tip = st.ground ? "" : fake && parts.length ? "他先假動作：閃和擋踢會被騙掉" : ans.retreat ? "<u>他不會追：退一步就揮空</u>" : chase && st.range >= 1 && parts.length ? "他會追上來：退沒用" : "";
  const label = it.forced && st.b.rocked ? `${B} 被打晃了，他只能` : it.forced ? `你被打晃了！${B} 要` : `${B} 接下來要`;
  box.innerHTML = `<small>${label}</small><b>${big}</b><span>${chips}${tip ? `<s>${tip}</s>` : ""}</span>`;
}

function drawFlow() {
  const step = acting ? 2 : st.stage === "post" ? 3 : 1;
  const t = ["你先應對", "他出手", "你反擊"];
  $("#flow").innerHTML = t.map((x, i) => `<span class="${step === i + 1 ? "on" : ""}"><i>${i + 1}</i>${x}</span>`).join("<em>→</em>");
}

function cardHtml(id, i, legalMap) {
  const d = E.defOf(st, id), pv = E.preview(st, "a", d, true);
  const lg = legalMap.get("c" + i);
  const cls = d.region || (d.kind === "takedown" || d.kind === "pass" || d.kind === "escape" ? "grap" : "");
  let nums = "", warn = "";
  if (d.kind === "strike") {
    nums = `傷 <b>${Math.round(pv.dmg)}${pv.hits > 1 ? "×" + pv.hits : ""}</b>　打實 <b class="${pv.clean === 0 ? "zero" : pv.up ? "up" : ""}">${pct(pv.clean)}</b>`;
    if (pv.blocked === "slip") warn = "會被他閃掉";
    else if (pv.blocked === "check") warn = "會被他擋踢";
    else if (pv.blocked === "guard") warn = "他擋著";
  } else if (d.kind === "takedown") { nums = `成功 <b class="${pv.p === 0 ? "zero" : ""}">${pct(pv.p)}</b>`; if (pv.p === 0) warn = "他防著"; }
  else if (d.kind === "escape") nums = `成功 <b>${pct(pv.p)}</b>`;
  const strug = lg && lg.type === "struggle";
  if (strug) warn = `丟掉：起身 +${pct(st.cfg.ground.struggle)}`;
  else if (!pv.ok) warn = pv.why === "range" ? (st.range === 0 ? "太遠，先靠近" : d.range && d.range[0] === 2 ? "要先抱住他" : "太近了") : pv.why === "scene" ? (st.ground ? "地面不能用" : "站著不能用") : "不能用";
  else if (pv.cost > st.a.energy) warn = "氣不夠";
  const sub = warn ? `<em>${warn}</em>` : d.kind !== "strike" || d.text ? `<small>${esc(d.text || "")}</small>` : "";
  return `<button class="card ${cls} ${lg ? "" : "off"} ${strug ? "strug" : ""}" data-i="${i}"><span class="cost">${pv.cost}</span><span class="cn">${esc(d.name)}${d.region ? `<i>${REGION[d.region]}</i>` : ""}</span><div class="nums">${nums}</div>${sub}</button>`;
}

function render() {
  gauges(live());
  drawSay();
  drawFlow();
  const lm = new Map();
  for (const x of E.legal(st)) lm.set(x.type === "basic" ? "b" + x.id : x.type === "card" || x.type === "struggle" ? "c" + x.i : x.type, x);
  $("#hand").innerHTML = st.a.hand.map((id, i) => cardHtml(id, i, lm)).join("") || `<div class="empty">手牌用完了</div>`;
  $("#hand").querySelectorAll(".card").forEach((el) => (el.onclick = () => { const x = lm.get("c" + el.dataset.i); if (x) doAct({ type: x.type, i: x.i }); }));
  const sc = E.scene(st, "a"), pre = st.stage === "pre", ans = pre ? E.answers(st) : {};
  const list = Object.values(st.cfg.basics).filter((d) => d.scene === sc && !(d.kind === "move" && (d.move === "advance") !== (st.range === 0)));
  $("#verbs").innerHTML = list.map((d) => {
    const pv = E.preview(st, "a", d, true), on = lm.has("b" + d.id);
    const set = d.kind === "defence" && !!st.a.def[d.def];
    const hint = on && (d.kind === "defence" ? ans[d.def] : d.move === "retreat" ? ans.retreat : false);
    const extra = d.kind === "escape" ? `成功 ${pct(pv.p)}` : d.kind === "strike" ? `傷 ${Math.round(pv.dmg)}・打實 ${pct(pv.clean)}` : esc(d.text);
    return `<button class="verb ${on ? "" : "off"} ${hint ? "hint" : ""} ${set ? "set" : ""}" data-id="${d.id}"><span class="cost">${pv.cost}</span><b>${esc(d.name)}</b><small>${set ? "準備好了" : extra}</small></button>`;
  }).join("");
  $("#verbs").querySelectorAll(".verb").forEach((el) => (el.onclick = () => { if (lm.has("b" + el.dataset.id)) doAct({ type: "basic", id: el.dataset.id }); }));
  const A = st.a;
  $("#energy").innerHTML = `<span>氣</span><div class="orbs">${"<i></i>".repeat(A.energy)}${"<i class='used'></i>".repeat(Math.max(0, st.cfg.energy - A.energy))}</div>`;
  const done = !pre || st.intent?.cancelled;
  $("#end").innerHTML = done ? `結束這一段<small>${A.energy > 0 ? `剩的氣回 ${A.energy} 體力` : "　"}</small>` : `換他出手<small>他打完你再反擊</small>`;
  $("#end").classList.toggle("off", busy);
}

function float(s, text, cls) {
  const m = $(".man." + s), f = document.createElement("div");
  f.className = "float " + cls;
  f.textContent = text;
  f.style.left = m.style.left;
  $("#stage").appendChild(f);
  setTimeout(() => f.remove(), 1000);
}
function shake(s) { const m = $(".man." + s); m.classList.remove("hit"); void m.offsetWidth; m.classList.add("hit"); }

/** Turn one engine event into text on the fighters. Returns the line to show while he acts (null = silent). */
function show(e) {
  const o = e.s ? E.other(e.s) : null, n = e.id ? nameOf(e.id) : "";
  switch (e.t) {
    case "hit": float(o, `${e.clean ? "打實" : e.guard ? "擋住" : "擦到"}${Math.round(e.dmg) ? " −" + Math.round(e.dmg) : ""}`, e.clean ? "clean" : "graze"); shake(o); return { text: `${n}：${e.clean ? "打實" : e.guard ? "被擋住" : "擦到"}`, cls: e.s === "b" && e.clean ? "bad" : "" };
    case "miss": float(o, "沒打中", "graze"); return { text: `${n}：沒打中` };
    case "whiff": float(e.s, "揮空", "info"); return { text: `${n}：夠不到，揮空`, cls: "good" };
    case "slip": float(e.s, "閃開！", "info"); return { text: `${n} 被${who(e.s)}閃掉`, cls: e.s === "a" ? "good" : "bad" };
    case "check": float(e.s, "擋踢！", "info"); return { text: `${n} 被${who(e.s)}擋下`, cls: e.s === "a" ? "good" : "bad" };
    case "sprawl": float(e.s, "防摔！", "info"); return { text: `抱摔被${who(e.s)}防住`, cls: e.s === "a" ? "good" : "bad" };
    case "feint": if (e.bit.length) float(o, "被騙", "bad"); return { text: e.bit.length ? `${n}：騙掉了${e.bit.map((k) => DEFTAG[k]).join("、")}` : n, cls: e.bit.length ? (e.s === "a" ? "good" : "bad") : "" };
    case "defence": if (e.s === "a") float("a", "準備好了", "info"); return null;
    case "move": return e.s === "b" ? { text: e.id === "advance" ? "追上來" : n } : null;
    case "takedown": float(e.s, e.ok ? "抱摔成功" : "抱摔失敗", e.ok ? "info" : "graze"); return { text: `${n}：${e.ok ? "成功" : "失敗"}`, cls: e.ok ? (e.s === "a" ? "good" : "bad") : "" };
    case "control": float(e.s, "壓制", "info"); return { text: "壓制" };
    case "pass": return { text: "過腿" };
    case "escape": float(e.s, e.ok ? "站起來了" : "沒起來", e.ok ? "info" : "graze"); return { text: `${n}：${e.ok ? "站起來了" : "沒起來"}` };
    case "standup": return { text: "回到站立" };
    case "refstand": return { text: "裁判叫起" };
    case "rocked": float(e.s, "被打晃！", "clean"); return { text: `${who(e.s)}被打晃了！`, cls: e.s === "a" ? "bad" : "good" };
    case "open": float(e.s, "露破綻", "bad"); return null;
    case "struggle": float("a", "掙扎", "info"); return null;
    case "trait": return { text: st[e.s].f.trait.text, cls: e.s === "a" ? "good" : "bad" };
    case "cancelled": return { text: "他被打斷，什麼都沒做", cls: "good" };
    default: return null;
  }
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
  const from = st.log.length, pre = st.stage === "pre" && !st.intent?.cancelled;
  if (pre) {
    E.runIntent(st);
    // nothing left to counter with: the exchange is over
    if (!st.over && !E.legal(st).length) E.endExchange(st);
  } else E.endExchange(st);
  acting = pre;
  frame.classList.toggle("acting", pre);
  if (pre) drawFlow();
  for (const e of st.log.slice(from)) {
    if (e.t === "over" || e.t === "roundend" || e.t === "window" || e.t === "recover") continue;
    gauges(e.snap);
    const line = show(e);
    if (line && pre) { drawSay(line); await sleep(520); }
  }
  busy = acting = false;
  frame.classList.remove("acting");
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
  d.innerHTML = `<div class="box"><h2>第 ${st.round} 回合：${last.a > last.b ? "你拿下" : last.b > last.a ? "他拿下" : "平手"}（${last.a}-${last.b}）</h2>
    <p>這回合分數 你 <b>${Math.round(last.pts.a)}</b> : <b>${Math.round(last.pts.b)}</b> 他</p>
    <h3>休息時間，選一項</h3>
    <div class="pick">${Object.entries(c.options).map(([k, o]) => `<button data-k="${k}"><b>${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join("")}</div></div>`;
  d.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    E.corner(st, b.dataset.k, cornerPick(st, "b"));
    d.remove();
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
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `${o.how}・第 ${o.round} 回合`;
  d.innerHTML = `<div class="box"><h2>${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>第 ${i + 1} 回合 <b>${r.a}-${r.b}</b></span>`).join("")}</div>` : ""}
    <p>你打出 <b>${Math.round(st.a.stats.dmg)}</b> 傷害，他打出 <b>${Math.round(st.b.stats.dmg)}</b>。</p>
    <button class="go">再來一場</button></div>`;
  d.querySelector(".go").onclick = startScreen;
  setTimeout(() => frame.appendChild(d), fast ? 0 : 700);
}

boot();
