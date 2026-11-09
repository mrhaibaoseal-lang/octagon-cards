// Browser page for the card bout (bout.html): drawing and input. Rules are engine.js, the opponent is ai.js.
// Layout and look follow mock.html (844x390). Fighters are placeholder shapes until sprites are wired in.
import { createBout, playBeat, settleKnockdown, actions, hitChance, danger, headRatio, limping, clock, prepare } from "./engine.js";
import { createAI } from "./ai.js";

const load = async (n) => (await fetch(`rules/bout/${n}.json`)).json();
const data = prepare({ config: await load("config"), cards: await load("cards"), fighters: await load("fighters") });
const cfg = data.config;
const params = new URLSearchParams(location.search);
const IDS = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
const ME = IDS.includes(params.get("me")) ? params.get("me") : "holloway";
const FOE = IDS.find((k) => k !== ME);
const REGION = { head: "頭", body: "身", leg: "腿" };
const $ = (s) => document.querySelector(s);
const YOURS = `你的回合 · 點兩次出牌 · 按住牌＝加注（多花 ${data.config.boost.cost} 體力）`;
const sleep = (ms) => new Promise((r) => setTimeout(r, window.__fast ? 4 : ms)); // __fast is for automated play-tests only

const frame = $("#frame");
const fig = '<i class="ar a"></i><i class="lg a"></i><i class="lg b"></i><i class="tr"></i><i class="sh"></i><i class="hd"></i><i class="ar b"></i>';
const sideTop = (k) => `
  <div class="side ${k === "o" ? "r" : ""}">
    <div class="doll" id="doll${k}"><i class="h"></i><i class="b"></i><i class="l"></i></div>
    <div><div class="nm" id="nm${k}"></div><div class="stbadges" id="bd${k}"></div></div>
    <div class="stam" id="stam${k}"><b></b><i></i></div>
  </div>`;
frame.innerHTML = `
  <div id="top">${sideTop("p")}<div class="clock" id="clock"></div>${sideTop("o")}</div>
  <div id="stage"><div id="floor"></div><div class="oppcards" id="oppcards"></div><div class="fighter p" id="fp">${fig}</div><div class="fighter o" id="fo">${fig}</div></div>
  <div id="cap" class="dim"></div>
  <div id="bot"><div class="hand" id="hand"></div><div class="acts" id="acts"></div><div class="reveal" id="reveal" hidden></div></div>
  <div class="ov" id="ov" hidden></div>`;

function fit() {
  const s = Math.min(innerWidth / 844, innerHeight / 390);
  frame.style.transform = `scale(${s})`;
}
addEventListener("resize", fit);
fit();

// ---------- game state ----------
let st, ai, busy = false, sel = null, holdFired = false;
function newBout() {
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  st = createBout(data, ME, FOE, seed);
  let a = (seed * 31 + 7) >>> 0;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  ai = createAI(data, "b", rng);
  busy = false; sel = null;
  $("#ov").hidden = true;
  setCap(YOURS, true);
  render();
}

// ---------- drawing ----------
const POS = { 0: [170, 620], 1: [230, 560], 2: [290, 500], 3: [330, 460] };
function placeFighters() {
  const [l, r] = POS[st.dist];
  $("#fp").style.left = l + "px";
  $("#fo").style.left = r + "px";
}
const lvl = (r) => (r < 0.35 ? "w0" : r < 0.65 ? "w1" : "w2");
function renderSide(s, k) {
  const f = st[s];
  $("#nm" + k).innerHTML = `${f.short}<small>${s === "a" ? "你" : "電腦"} · ${data.fighters[f.id].style}</small>`;
  const [h, b, l] = $("#doll" + k).children;
  h.className = "h " + lvl(headRatio(st, s));
  b.className = "b " + lvl(f.body / 25);
  l.className = "l " + lvl(f.leg / cfg.leg.limp);
  $("#stam" + k).children[0].style.width = (f.stamina / cfg.stamina.max) * 100 + "%";
  $("#stam" + k).children[1].style.width = (1 - f.staminaMax / cfg.stamina.max) * 100 + "%";
  const bd = [];
  if (danger(st, s)) bd.push("暈");
  if (f.stamina / f.staminaMax < cfg.stamina.low) bd.push("喘");
  if (limping(st, s)) bd.push("跛");
  if (f.open > 0) bd.push("破綻");
  $("#bd" + k).innerHTML = bd.map((t) => `<span class="badge">${t}</span>`).join("");
  const el = $(k === "p" ? "#fp" : "#fo");
  el.classList.toggle("open", f.open > 0);
  el.classList.toggle("hurtleg", limping(st, s));
  el.classList.toggle("dizzy", danger(st, s));
}
function renderOpp() {
  const o = st.b;
  const unknown = Math.max(0, o.hand.length - o.known.length);
  $("#oppcards").innerHTML =
    '<div class="bk"></div>'.repeat(unknown) +
    o.known.map((id) => `<div class="kc ${id === o.fresh ? "new" : ""}">${data.cards[id].name}</div>`).join("");
}
function renderHud() {
  renderSide("a", "p");
  renderSide("b", "o");
  const sec = clock(st);
  $("#clock").innerHTML = st.over ? "結束" : `R${st.round + 1} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}<small>第 ${st.beat + 1} 手 / ${cfg.beatsPerRound}</small>`;
  placeFighters();
  renderOpp();
}
function renderHand() {
  const acts = actions(st, "a");
  const me = st.a;
  const f = data.fighters[me.id];
  const oppDanger = danger(st, "b");
  $("#hand").innerHTML = acts
    .filter((a) => a.kind === "card")
    .map((a) => {
      const c = data.cards[a.id];
      const hc = hitChance(st, "a", c, false, null);
      const whys = [];
      if (hc.why.includes("open")) whys.push('<span class="why">↑ 破綻</span>');
      else if (hc.why.includes("tired")) whys.push('<span class="why dn">↓ 體力</span>');
      else if ((f.skill?.[a.id] || 0) >= 0.04) whys.push('<span class="why">↑ 擅長</span>');
      else whys.push("<span></span>");
      const ko = c.ko >= 0.1 || (c.heavy && c.region === "head" && oppDanger);
      const note = a.ok ? "" : `<div class="note">${a.why === "range" ? `需要「${c.range.map((d) => cfg.dist.names[d]).join("／")}」距離` : "體力不足"}</div>`;
      const isNew = a.idx === me.hand.length - 1 && me.fresh;
      return `<div class="card ${c.region} ${c.rarity === "sig" ? "sig" : ""} ${a.ok ? "" : "off"} ${sel === a.idx ? "sel" : ""}" data-idx="${a.idx}" data-ok="${a.ok ? 1 : 0}">
        ${ko ? '<span class="ko">KO</span>' : c.counter ? '<span class="tag">迎擊</span>' : ""}${isNew ? '<span class="new">新抽</span>' : ""}
        <div class="n">${c.name}${c.rarity === "sig" ? "★" : ""}</div><div class="pct">${Math.round(hc.p * 100)}<small>%</small></div>${note}
        <div class="ft">${whys.join("")}<span class="cost">⚡${c.cost}</span></div></div>`;
    })
    .join("");
  const sub = { advance: "靠近一格", retreat: "拉開一格", sidestep: "閃開攻擊", guard: "擋住，回一點體力" };
  $("#acts").innerHTML = acts
    .filter((a) => a.kind === "move")
    .map((a) => `<div class="act ${a.ok ? "" : "off"}" data-move="${a.id}" data-ok="${a.ok ? 1 : 0}">${cfg.moves[a.id].label}<small>${a.cost ? `⚡${a.cost} ` : ""}${sub[a.id] || ""}</small></div>`)
    .join("");
}
function render() {
  renderHud();
  renderHand();
}
function setCap(html, dim = false) {
  const c = $("#cap");
  c.innerHTML = html;
  c.className = dim ? "dim" : "";
}
function showReveal(on, html = "") {
  $("#hand").hidden = on;
  $("#acts").hidden = on;
  $("#reveal").hidden = !on;
  if (on) $("#reveal").innerHTML = html;
}

// ---------- input ----------
const hand = $("#hand");
hand.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".card");
  holdFired = false;
  if (!el || busy || el.dataset.ok !== "1") return;
  const idx = Number(el.dataset.idx);
  clearTimeout(hand._t);
  hand._t = setTimeout(() => {
    holdFired = true;
    const c = data.cards[st.a.hand[idx]];
    const canBoost = c.cost + cfg.boost.cost <= st.a.stamina;
    el.classList.add("boosted");
    play({ card: idx, boost: canBoost });
  }, 480);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hand.addEventListener(ev, () => clearTimeout(hand._t));
hand.addEventListener("click", (e) => {
  const el = e.target.closest(".card");
  if (!el || busy || holdFired || el.dataset.ok !== "1") return;
  const idx = Number(el.dataset.idx);
  if (sel !== idx) { sel = idx; renderHand(); return; }
  play({ card: idx });
});
$("#acts").addEventListener("click", (e) => {
  const el = e.target.closest(".act");
  if (!el || busy || el.dataset.ok !== "1") return;
  play({ move: el.dataset.move });
});

// ---------- one beat ----------
const nameOf = (s) => st[s].short;
const cardName = (id) => data.cards[id].name;
function descLabel(d) {
  return d.kind === "card" ? cardName(d.id) + (d.boost ? "＋" : "") : cfg.moves[d.id].label;
}
function revealHtml(ev) {
  const r = ev.find((e) => e.t === "reveal");
  const atk = (s) => ev.find((e) => e.t === "attack" && e.by === s);
  const one = (s, who) => {
    const d = r[s];
    const a = atk(s);
    const color = d.kind === "card" ? `var(--${data.cards[d.id].region === "leg" ? "leg" : data.cards[d.id].region === "body" ? "body" : "head"})` : "#556";
    const pct = a ? `${Math.round(a.p * 100)}%` : "—";
    const res = a ? (a.hit ? `<div class="res hit">命中</div>` : `<div class="res miss">${a.whiff === "range" ? "距離不夠" : "落空"}</div>`) : `<div class="res miss"> </div>`;
    return `<div class="rc" style="--c:${color}"><small>${who}</small><b>${descLabel(d)}</b><div class="pct" ${a ? "" : 'style="font-size:18px;margin-top:8px"'}>${pct}</div>${res}</div>`;
  };
  return one("a", "你") + '<div class="vs">VS</div>' + one("b", nameOf("b"));
}

function floatText(s, text) {
  const el = document.createElement("div");
  el.className = "float";
  el.textContent = text;
  el.style.left = (parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 10) + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function spark(s) {
  const el = document.createElement("div");
  el.className = "spark";
  el.textContent = "✦";
  el.style.left = (parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 8) + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 600);
}
async function lunge(s) {
  const el = $(s === "a" ? "#fp" : "#fo");
  const x = parseFloat(el.style.left);
  el.style.left = x + (s === "a" ? 26 : -26) + "px";
  await sleep(140);
  el.style.left = x + "px";
}
async function shake(s) {
  const el = $(s === "a" ? "#fp" : "#fo");
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 400);
}

async function animate(ev) {
  const rv = ev.find((e) => e.t === "reveal");
  showReveal(true, revealHtml(ev));
  setCap(`${descLabel(rv.a)}　VS　${descLabel(rv.b)}`);
  await sleep(850);
  const mv = ev.find((e) => e.t === "move");
  if (mv) {
    placeFighters();
    setCap(`距離：${cfg.dist.names[mv.from]} → ${cfg.dist.names[mv.to]}`);
    await sleep(450);
  }
  for (const e of ev) {
    if (e.t !== "attack") continue;
    const who = nameOf(e.by);
    const name = cardName(e.id) + (e.boost ? "（加注）" : "");
    await lunge(e.by);
    const t = e.by === "a" ? "b" : "a";
    if (e.hit) {
      spark(t);
      shake(t);
      floatText(t, `-${e.dmg}`);
      setCap(`${who} <em>${name}</em> 命中${e.by === "a" ? "對手" : "你"}的${REGION[e.region]}${e.why?.includes("counter") ? " · 迎擊！" : ""}`);
    } else {
      setCap(`${who} <em>${name}</em> ${e.whiff === "range" ? "距離不夠，落空" : "被躲開"}${e.openSelf ? " · 露出破綻" : ""}`);
    }
    await sleep(750);
  }
  if (ev.some((e) => e.t === "clash")) { setCap("兩人同時中拳，都晃了一下！"); await sleep(800); }
}

async function play(choice) {
  if (busy || st.over) return;
  busy = true;
  sel = null;
  let ev;
  try {
    ev = playBeat(st, choice, ai.think(st));
  } catch (err) {
    console.error(err);
    busy = false;
    return;
  }
  await animate(ev);
  await afterBeat(ev);
}

async function afterBeat(ev) {
  let events = ev;
  if (st.pending) {
    const p = st.pending;
    const downName = p.down === "a" ? "你" : nameOf("b");
    $("#f" + (p.down === "a" ? "p" : "o")).classList.add("down");
    renderHud();
    setCap(`<em>${downName}倒地了！</em>`);
    let chase;
    if (p.by === "a") {
      chase = await chooseChase();
    } else {
      await sleep(900);
      chase = ai.chase(st);
    }
    const ev2 = settleKnockdown(st, chase);
    events = events.concat(ev2);
    const ch = ev2.find((e) => e.t === "chase");
    if (ch) {
      setCap(ch.finished ? `<em>${nameOf(ch.by)}追擊成功！</em>` : `${nameOf(ch.by)}追擊沒有得手，露出了破綻`);
    } else {
      setCap(`${nameOf(p.by)}選擇穩住，${downName}站了起來`);
    }
    await sleep(1100);
    $("#fp").classList.remove("down");
    $("#fo").classList.remove("down");
  }
  showReveal(false);
  render();
  if (st.over) return showEnd();
  const re = events.find((e) => e.t === "roundEnd");
  if (re) return showRoundEnd(re);
  setCap(YOURS, true);
  busy = false;
}

function chooseChase() {
  return new Promise((res) => {
    const ov = $("#ov");
    const o = st[st.pending.down];
    const pf = Math.min(0.99, cfg.chase.finishBase + cfg.chase.finishPerHead * Math.min(1.5, headRatio(st, st.pending.down)));
    ov.className = "ov";
    ov.innerHTML = `<h1>${o.short} 倒地！</h1><p>他搖搖欲墜。現在撲上去，還是穩住？</p>
      <div class="choices">
        <div class="bigc go" data-c="1"><b>追擊</b><span>撲上去重擊，約 ${Math.round(pf * 100)}% 直接結束比賽<br>花 ${cfg.chase.cost} 體力 · 失敗會露出破綻</span></div>
        <div class="bigc" data-c="0"><b>穩住</b><span>讓他站起來<br>保留體力 · 他可以喘口氣</span></div>
      </div>`;
    ov.hidden = false;
    ov.onclick = (e) => {
      const b = e.target.closest(".bigc");
      if (!b) return;
      ov.hidden = true;
      ov.onclick = null;
      res(b.dataset.c === "1");
    };
  });
}

function showRoundEnd(re) {
  const ov = $("#ov");
  const row = (s) => `<div><b>${s === "a" ? "你" : nameOf("b")}</b>${re.landed[s]} 次命中 · 傷害 ${Math.round(re.dealt[s])}${re.kd[s] ? ` · 被擊倒 ${re.kd[s]}` : ""}</div>`;
  ov.className = "ov dark";
  ov.innerHTML = `<h1 style="font-size:26px">第 ${re.round} 回合結束</h1>
    <div class="sum">${row("a")}${row("b")}</div>
    <p>一分鐘休息：體力回復 ${cfg.stamina.roundRecover}。比賽中看不到分數，只有教練的感覺（之後才做）。</p>
    <button class="btn gold" id="next">開始第 ${re.round + 1} 回合</button>`;
  ov.hidden = false;
  $("#next").onclick = () => {
    ov.hidden = true;
    setCap(YOURS, true);
    busy = false;
    render();
  };
}

function showEnd() {
  const o = st.over;
  const ov = $("#ov");
  const win = o.winner === "a" ? "你贏了！" : o.winner === "b" ? "你輸了" : "平手";
  const cards = o.cards ? o.cards.map(([a, b]) => `${a}-${b}`).join("　") : "";
  ov.className = "ov dark";
  ov.innerHTML = `<h1>${win}</h1><p style="font-size:16px;color:var(--text)">${o.method}${o.cards ? "" : ` · 第 ${o.round} 回合`}</p>
    ${cards ? `<div class="cardsread">裁判計分　${cards}</div>` : ""}
    <button class="btn gold" id="again">再來一場</button>`;
  ov.hidden = false;
  $("#again").onclick = newBout;
}

window.__bout = { get st() { return st; }, play, newBout, data };
newBout();
