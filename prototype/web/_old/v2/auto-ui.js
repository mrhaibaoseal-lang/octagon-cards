// Octagon Cards — plan B front end: the bout plays itself; the player picks a tactic before the fight and
// between rounds, and one order at each key moment. Rules live in engine.js / ai.js / auto.js.
import * as E from "./engine.js";
import * as A from "./auto.js";

const params = new URLSearchParams(location.search);
const load = async (n) => (await fetch(`rules/v2/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const REGION = { head: "頭", body: "身體", legs: "腿" };
const PLAN = { aggression: "站著打", pressure: "壓上來打", grapple: "抱摔", caution: "防守反擊", outfight: "拉開距離打" };

let data, au, st, speed = params.has("fast") ? 0 : 1, choice = { a: null, b: null }, runId = 0;
const frame = $("#frame");
const sleep = (ms) => new Promise((r) => setTimeout(r, speed === 0 ? 0 : ms / speed));

function fit() { frame.style.transform = `scale(${Math.min(innerWidth / 844, innerHeight / 390)})`; }
addEventListener("resize", fit);

async function boot() {
  const [config, cards, fighters, tactics] = await Promise.all([load("config"), load("cards"), load("fighters"), load("tactics")]);
  data = E.prepare({ config, cards: strip(cards), fighters: strip(fighters), tactics });
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  pickScreen();
}

const styleOf = (id) => data.tactics.styles[id];
const boostText = (s) => (s.boost ? `<i>多 ${s.boost.energy} 招・體力 −${s.boost.gas}</i>` : "");
function optionBtn(id, cur) {
  if (id === "keep") { const s = styleOf(au.tactic); return `<button class="opt" data-id="keep"><b>照原本的打</b><small>${esc(s.name)}</small></button>`; }
  const s = styleOf(id);
  return `<button class="opt ${cur === id ? "on" : ""}" data-id="${id}"><b>${esc(s.name)}</b><small>${esc(s.text)}</small>${boostText(s)}</button>`;
}

// ---------- screens ----------
function pickScreen() {
  runId++;
  const ids = Object.keys(data.fighters);
  const btn = (s, id) => `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(data.fighters[id].name)}</b><small>${esc(data.fighters[id].style)}</small></button>`;
  frame.innerHTML = `<div class="over"><div class="box">
    <h2>Octagon Cards・教練模式</h2>
    <p>比賽會<b>自己打</b>。你是教練：賽前定戰術，回合之間可以換，關鍵時刻下一個指令。</p>
    <h3>你的選手</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">下一步：定戰術</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; pickScreen(); }));
  $("#go").onclick = planScreen;
}

/** What the opponent really does, from the same weights his AI samples from. */
function scout(id) {
  const f = data.fighters[id], w = Object.entries(PLAN).map(([k, n]) => [n, f.ai[k] || 0]).filter((x) => x[1] > 0);
  const sum = w.reduce((n, x) => n + x[1], 0);
  return w.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => `${n} ${pct(v / sum)}`).join("、");
}

function planScreen() {
  const f = data.fighters[choice.b], me = data.fighters[choice.a];
  frame.innerHTML = `<div class="over"><div class="box wide">
    <h2>賽前：定戰術</h2>
    <p>對手 <b>${esc(f.name)}</b>（${esc(f.style)}）　體力 ${f.gas}・下巴 ${f.chin}<br>他常做：<b>${scout(choice.b)}</b><br>${esc(f.trait.text)}</p>
    <p>你 <b>${esc(me.name)}</b>　體力 ${me.gas}・下巴 ${me.chin}</p>
    <div class="opts">${A.tacticsFor(data, choice.a).map((id) => optionBtn(id)).join("")}</div></div></div>`;
  frame.querySelectorAll(".opt").forEach((b) => (b.onclick = () => start(b.dataset.id)));
}

function start(tactic) {
  const seed = Number(params.get("seed")) || (Date.now() % 2147483647);
  au = A.createAuto(data, choice.a, choice.b, seed, tactic);
  st = au.st;
  frame.innerHTML = `
    <div id="top"><div class="side l" id="sa"></div><div id="mid"></div><div class="side r" id="sb"></div></div>
    <div id="stage">
      <div id="say"></div>
      <div class="man a"><em></em><i class="hd"></i><i class="tr"></i><i class="lg"></i></div>
      <div class="man b"><em></em><i class="hd"></i><i class="tr"></i><i class="lg"></i></div>
      <div class="floor"></div>
      <button id="restart">重來</button>
    </div>
    <div id="coach"></div><div id="feed"></div><div id="ask" hidden></div>`;
  $("#restart").onclick = pickScreen;
  gauges(live());
  coach();
  loop(++runId);
}

function coach() {
  const s = styleOf(au.order ? au.order.id : au.tactic);
  $("#coach").innerHTML = `<small>${au.order ? "現在的指令" : "現在的戰術"}</small><b>${esc(s.name)}</b><span>${esc(s.text)}</span>
    <button id="speed">${speed >= 3 ? "速度 ×3" : speed === 2 ? "速度 ×2" : "速度 ×1"}</button>`;
  $("#speed").onclick = () => { speed = speed >= 3 ? 1 : speed + 1; coach(); };
}

// ---------- drawing ----------
const who = (s) => (s === "a" ? "你" : st.b.f.short);
const nameOf = (id) => E.defOf(st, id)?.name || id;
const one = (s) => { const F = st[s]; return { stun: F.stun, chin: F.chin, gas: F.gas, gasMax: F.gasMax, legs: F.legDmg, rocked: !!F.rocked, score: F.score }; };
const live = () => ({ a: one("a"), b: one("b"), range: st.range, ground: st.ground ? st.ground.top : null });

function gauges(sn) {
  for (const s of ["a", "b"]) {
    const F = st[s], g = sn[s], base = F.f.gas, chips = [];
    if (g.rocked) chips.push(`<span class="chip hot">被打晃</span>`);
    if (g.gas <= base * st.cfg.lowGasFrac) chips.push(`<span class="chip">沒體力</span>`);
    $("#s" + s).innerHTML = `
      <div class="row"><span class="nm">${s === "a" ? "你" : "對手"}<small>${esc(F.f.short)}</small></span>${chips.join("")}</div>
      <div class="row"><span class="k">頭</span><div class="bar stun"><b style="width:${Math.min(100, (g.stun / g.chin) * 100)}%"></b></div><span class="v">${Math.round(g.stun)}/${g.chin}</span>
      <span class="k">體力</span><div class="bar gas"><b style="width:${(g.gas / base) * 100}%"></b><i class="lost" style="width:${((base - g.gasMax) / base) * 100}%"></i></div><span class="v">${g.gas}</span></div>`;
  }
  $("#mid").innerHTML = `<div class="clock">第 ${st.round} 回合　${Math.min(st.ex, st.cfg.exchanges)}/${st.cfg.exchanges}</div>
    <div class="pts">分數　你 <b class="a">${Math.round(sn.a.score)}</b> : <b class="b">${Math.round(sn.b.score)}</b> 他${st.rounds.length ? `<small>已判 ${st.rounds.map((r) => `${r.a}-${r.b}`).join(" ")}</small>` : ""}</div>`;
  const gap = [34, 13, 6][sn.range], ma = $(".man.a"), mb = $(".man.b");
  ma.style.left = (sn.ground ? 48 : 50 - gap / 2) + "%";
  mb.style.left = (sn.ground ? 52 : 50 + gap / 2) + "%";
  for (const [m, s] of [[ma, "a"], [mb, "b"]]) {
    m.classList.toggle("rocked", sn[s].rocked);
    m.classList.toggle("down", !!sn.ground && sn.ground !== s);
    m.classList.toggle("ontop", sn.ground === s);
  }
  $(".floor").innerHTML = sn.ground ? `地面：<b>${who(sn.ground)}</b>在上面` : `<b>${["遠距離", "近距離", "抱在一起"][sn.range]}</b>`;
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
function say(text, cls = "", small = "") { $("#say").innerHTML = `<small>${esc(small)}</small><b class="${cls}">${esc(text)}</b>`; }
function feed(text, cls = "") {
  const box = $("#feed"), p = document.createElement("p");
  p.className = cls; p.textContent = text;
  box.appendChild(p);
  while (box.children.length > 6) box.firstChild.remove();
}

/** One engine event as a line of commentary. big = worth pausing on. null = not shown. */
function line(e) {
  const o = e.s ? E.other(e.s) : null, n = e.id ? nameOf(e.id) : "", mine = e.s === "a", W = e.s ? who(e.s) : "";
  const good = mine ? "good" : "bad";
  switch (e.t) {
    case "defence": return null;
    case "hit": {
      const d = Math.round(e.dmg);
      float(o, `${e.clean ? "打實" : e.guard ? "擋住" : "擦到"}${d ? " −" + d : ""}`, e.clean ? "clean" : "graze"); shake(o);
      return { text: `${W}的${n}${e.clean ? "打實" : e.guard ? "被擋住" : "擦到"}（${REGION[e.region]}${d ? " −" + d : ""}）`, cls: e.clean ? good : "", big: e.clean && d >= 6 };
    }
    case "miss": return { text: `${W}的${n}沒打中` };
    case "whiff": float(e.s, "揮空", "info"); return { text: `${W}的${n}揮空`, cls: mine ? "bad" : "good" };
    case "slip": float(e.s, "閃開！", "info"); return { text: `${W}閃掉${n}並反擊`, cls: good, big: true };
    case "check": float(e.s, "擋踢！", "info"); return { text: `${W}擋下${n}`, cls: good };
    case "sprawl": float(e.s, "防摔！", "info"); return { text: `${W}防住了抱摔`, cls: good, big: true };
    case "feint": return e.bit.length ? { text: `${W}的假動作騙到了`, cls: good } : null;
    case "takedown": float(e.s, e.ok ? "抱摔成功" : "抱摔失敗", e.ok ? "info" : "graze"); return { text: `${W}抱摔${e.ok ? "成功" : "失敗"}`, cls: e.ok ? good : "", big: e.ok };
    case "control": return { text: `${W}壓制` };
    case "escape": return { text: `${W}${e.ok ? "站起來了" : "想站起來，沒成功"}`, cls: e.ok ? good : "" };
    case "standup": return { text: `${W}放對手起來` };
    case "refstand": return { text: "裁判叫起" };
    case "rocked": float(e.s, "被打晃！", "clean"); return { text: `${W}被打晃了！`, cls: mine ? "bad" : "good", big: true };
    case "dig": return mine ? { text: "你加大出力（體力下降）" } : null;
    case "trait": return { text: st[e.s].f.trait.text, cls: good };
    case "cancelled": return { text: `${who("b")}被打斷，這一段沒出手`, cls: "good" };
    default: return null;
  }
}

// ---------- the bout ----------
function ask(m) {
  return new Promise((res) => {
    const box = $("#ask");
    $("#feed").hidden = true; box.hidden = false;
    say(m.title, "warn", "關鍵時刻");
    box.innerHTML = m.options.map((id) => optionBtn(id)).join("");
    box.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { box.hidden = true; $("#feed").hidden = false; res(b.dataset.id); }));
  });
}

const GRADE = { perfect: "完美！", good: "好", miss: "慢了" };
/** The timing bar: a marker sweeps back and forth; click (or space) when it is in the zone. Resolves to a grade. */
function qte(title, sub, cls = "warn") {
  const q = data.tactics.qte;
  if (speed === 0) return Promise.resolve("good"); // ?fast=1 skips the prompt
  return new Promise((res) => {
    const box = $("#ask");
    $("#feed").hidden = true; box.hidden = false;
    say(title, cls, "看準時機，按下去");
    const g0 = (1 - q.good) / 2, p0 = (1 - q.perfect) / 2;
    box.innerHTML = `<button class="qte"><span class="track"><i class="good" style="left:${g0 * 100}%;width:${q.good * 100}%"></i><i class="perfect" style="left:${p0 * 100}%;width:${q.perfect * 100}%"></i><b class="mark"></b></span><small>${esc(sub)}　按空白鍵或點這裡</small></button>`;
    const mark = box.querySelector(".mark"), t0 = performance.now();
    let done = false, x = 0, raf = 0;
    const end = (grade) => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); removeEventListener("keydown", key);
      box.querySelector(".qte").classList.add(grade);
      say(GRADE[grade], grade === "miss" ? "bad" : "good", title);
      setTimeout(() => { box.hidden = true; $("#feed").hidden = false; res(grade); }, 550);
    };
    const hit = () => { const d = Math.abs(x - 0.5); end(d <= q.perfect / 2 ? "perfect" : d <= q.good / 2 ? "good" : "miss"); };
    const key = (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); hit(); } };
    const tick = (now) => {
      const sweeps = ((now - t0) / 1000) * q.speed;
      if (sweeps >= q.sweeps) return end("miss");
      const f = sweeps % 2;
      x = f <= 1 ? f : 2 - f;
      mark.style.left = x * 100 + "%";
      raf = requestAnimationFrame(tick);
    };
    box.querySelector(".qte").onclick = hit;
    addEventListener("keydown", key);
    raf = requestAnimationFrame(tick);
  });
}

async function loop(id) {
  say("比賽開始", "", `第 ${st.round} 回合`);
  await sleep(700);
  while (id === runId && !st.over) {
    if (st.phase === "corner") { const t = await cornerScreen(); if (id !== runId) return; A.nextRound(au, t); coach(); say("開始", "", `第 ${st.round} 回合`); gauges(live()); await sleep(600); continue; }
    const m = A.nextMoment(au);
    if (m) {
      gauges(live());
      const pick = await ask(m);
      if (id !== runId) return;
      A.choose(au, m, pick);
      if (A.needsPower(au)) { const g = await qte(styleOf(au.order.id).name, "按得越準，這一段多出越多招"); if (id !== runId) return; A.power(au, g); feed(g === "miss" ? "出力沒跟上" : g === "perfect" ? "全力爆發！" : "加大出力", g === "miss" ? "bad" : "good"); }
    } else {
      const r = A.reaction(au);
      if (r) {
        gauges(live());
        const g = await qte(`他要出${r.name}！`, `按準了就${r.answer}掉`, "bad");
        if (id !== runId) return;
        const ok = A.react(au, r, g);
        feed(ok ? `你看穿了${r.name}：${r.answer}${g === "perfect" ? "，還多一招反擊" : ""}` : `沒反應過來，${r.name}要來了`, ok ? "good" : "bad");
      }
    }
    coach();
    const from = st.log.length, tag = `第 ${st.round} 回合・第 ${st.ex} 段`;
    A.playExchange(au);
    for (const e of st.log.slice(from)) {
      if (id !== runId) return;
      if (e.t === "over" || e.t === "roundend") continue;
      gauges(e.snap);
      const l = line(e);
      if (!l) continue;
      feed(l.text, l.cls);
      say(l.text, l.cls, tag);
      await sleep(l.big ? 900 : 420);
    }
    await sleep(250);
  }
  if (id === runId) finish();
}

function cornerScreen() {
  return new Promise((res) => {
    gauges(live());
    const last = st.rounds[st.rounds.length - 1];
    const d = document.createElement("div");
    d.className = "over";
    d.innerHTML = `<div class="box wide"><h2>第 ${st.round} 回合：${last.a > last.b ? "你拿下" : last.b > last.a ? "他拿下" : "平手"}（${last.a}-${last.b}）</h2>
      <p>你：頭 ${Math.round(st.a.stun)}/${st.a.chin}・體力 ${st.a.gas}/${st.a.gasMax}　｜　${esc(st.b.f.short)}：頭 ${Math.round(st.b.stun)}/${st.b.chin}・體力 ${st.b.gas}/${st.b.gasMax}</p>
      <h3>下一回合的戰術（藍框是現在的）</h3>
      <div class="opts">${A.tacticsFor(data, st.a.id).map((id) => optionBtn(id, au.tactic)).join("")}</div></div>`;
    d.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { d.remove(); res(b.dataset.id); }));
    frame.appendChild(d);
  });
}

function finish() {
  gauges(live());
  const o = st.over, d = document.createElement("div");
  d.className = "over";
  const title = o.winner === "a" ? "你贏了" : o.winner === "b" ? "你輸了" : "平手";
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `${o.how}・第 ${o.round} 回合`;
  say(title, o.winner === "a" ? "good" : "bad", how);
  d.innerHTML = `<div class="box"><h2>${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>第 ${i + 1} 回合 <b>${r.a}-${r.b}</b></span>`).join("")}</div>` : ""}
    <p>你打出 <b>${Math.round(st.a.stats.dmg)}</b> 傷害，他打出 <b>${Math.round(st.b.stats.dmg)}</b>。</p>
    <button class="go" id="again">同一組再打一場</button><button class="go ghost" id="back">換人</button></div>`;
  setTimeout(() => { frame.appendChild(d); $("#again").onclick = planScreen; $("#back").onclick = pickScreen; }, speed === 0 ? 0 : 900);
}

boot();
