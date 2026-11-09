// Browser page for the card bout (bout.html): drawing and input. Rules are engine.js, the opponent is ai.js.
// Layout follows mock.html (844x390). Fighters are placeholder shapes until sprites are wired in.
import { createBout, playBeat, settleKnockdown, actions, hitChance, comboLive, heldCard, danger, headRatio, limping, clock, prepare, chaseOdds } from "./engine.js";
import { createAI } from "./ai.js";

const load = async (n) => (await fetch(`rules/bout/${n}.json`)).json();
const data = prepare({ config: await load("config"), cards: await load("cards"), fighters: await load("fighters") });
const cfg = data.config;
const params = new URLSearchParams(location.search);
const IDS = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
const ME = IDS.includes(params.get("me")) ? params.get("me") : "holloway";
const FOE = IDS.find((k) => k !== ME);
const REGION = { head: "頭", body: "身", leg: "腿" };
const DN = cfg.dist.names;
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, window.__fast ? 4 : ms)); // __fast is for automated play-tests only
const YOURS = "你的回合 · 點兩次出牌 · 按住牌＝加注 · 點「留」把一張牌蓄力到下一手";

// ---------- skeleton ----------
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
  <div id="stage"><div id="floor"></div><div class="board p" id="boardp"></div><div class="board o" id="boardo"></div>
    <div class="reach" id="reach" hidden><div class="bar"></div><div class="tip"></div><div class="lb"></div></div>
    <div class="fighter p" id="fp">${fig}</div><div class="fighter o" id="fo">${fig}</div><div id="help">？ 牌型說明</div></div>
  <div id="cap" class="dim"></div>
  <div id="bot"><div class="hand" id="hand"></div><div class="acts" id="acts"></div><div class="reveal" id="reveal" hidden></div></div>
  <div class="ov" id="ov" hidden></div>`;

function fit() {
  frame.style.transform = `scale(${Math.min(innerWidth / 844, innerHeight / 390)})`;
}
addEventListener("resize", fit);
fit();

// ---------- state ----------
let st, ai, busy = false, sel = null, holdIdx = null, holdFired = false;
function newBout() {
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  st = createBout(data, ME, FOE, seed);
  let a = (seed * 31 + 7) >>> 0;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  ai = createAI(data, "b", rng);
  busy = false; sel = null; holdIdx = null;
  $("#ov").hidden = true;
  render();
  let seen = false;
  try { seen = localStorage.getItem("bout.help") === "1"; } catch {}
  if (!seen) showHelp();
}

// ---------- geometry: the gap between the two bodies matches what can reach ----------
const W = 56; // fighter box width
const GAP = [210, 112, 44, -6]; // px between bodies at 遠 中 近 纏抱
const CENTER = 422;
const leftX = (d) => CENTER - GAP[d] / 2 - W;
const rightX = (d) => CENTER + GAP[d] / 2;
function placeFighters() {
  $("#fp").style.left = leftX(st.dist) + "px";
  $("#fo").style.left = rightX(st.dist) + "px";
}

// ---------- text for cards ----------
const cardOf = (id) => data.cards[id];
const rangeText = (c) => (c.range.length === 4 ? "任何距離" : c.range.map((d) => DN[d]).join("／"));
function keyword(c, live) {
  if (c.kind === "trap") return '<span class="kw trap">👁 預判</span>';
  if (c.kind === "feint") return '<span class="kw feint">🎭 假動作</span>';
  if (c.ko >= 0.1 || (c.heavy && c.region === "head" && danger(st, "b"))) return '<span class="kw ko">KO</span>';
  if (c.combo) return `<span class="kw combo ${live ? "live" : ""}">⛓ 連段${live ? "!" : ""}</span>`;
  if (c.counter) return '<span class="kw counter">迎擊</span>';
  if (c.push) return '<span class="kw push">推開</span>';
  return "";
}
function describeCard(c, charged) {
  if (c.kind === "trap") return `<em>${c.name}</em> · 👁 預判：蓋起來 ${c.trap.beats} 手，${c.text}${c.trap.cancel ? "（擋掉他那一招）" : ""}`;
  if (c.kind === "feint") return `<em>${c.name}</em> · 🎭 假動作：${c.text}。他若出手，你會白挨一下`;
  const bits = [`<em>${c.name}</em>`, `打${REGION[c.region]}`, `可打到：${rangeText(c)}`];
  if (c.combo) bits.push(comboLive(st, "a", c) ? "⛓ 連段發動：更準更重" : "⛓ 連段：上一手打中時更準更重");
  if (c.counter) bits.push("他前進時 +30%");
  if (c.push) bits.push("打中把他推開一格");
  if (c.heavy) bits.push("打空會露破綻");
  if (charged) bits.push("🔥 蓄力：更重");
  return bits.join(" · ");
}

// ---------- drawing ----------
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
  $("#bd" + k).innerHTML = bd.map((t) => `<span class="badge">${t}</span>`).join("");
  const el = $(k === "p" ? "#fp" : "#fo");
  el.classList.toggle("open", f.open > 0);
  el.classList.toggle("hurtleg", limping(st, s));
  el.classList.toggle("dizzy", danger(st, s));
}
function renderBoards() {
  const mk = (cls, t) => `<div class="mk ${cls}">${t}</div>`;
  const me = st.a, op = st.b;
  let p = "", o = "";
  if (me.trap) p += mk("trap", `👁 你埋了：${cardOf(me.trap.id).name}（剩 ${me.trap.left} 手）`);
  const mh = heldCard(st, "a");
  if (mh) p += mk("fire", `🔥 你在蓄力：${cardOf(mh).name}`);
  if (me.landedLast) p += mk("combo", "⛓ 連段準備好");
  if (me.open) p += mk("open", "你露出破綻");
  if (op.trap) o += mk("trap", "👁 他埋了一張預判（看不到）");
  const oh = heldCard(st, "b");
  if (oh) o += mk("fire", `🔥 他在蓄力：${cardOf(oh).name}`);
  if (op.landedLast) o += mk("combo", "⛓ 他可以接連段");
  if (op.open) o += mk("open", "他露出破綻！");
  $("#boardp").innerHTML = p;
  $("#boardo").innerHTML = o;
}
function renderHud() {
  renderSide("a", "p");
  renderSide("b", "o");
  const sec = clock(st);
  $("#clock").innerHTML = st.over ? "結束" : `R${st.round + 1} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}<small>第 ${st.beat + 1} 手 / ${cfg.beatsPerRound}</small>`;
  placeFighters();
  renderBoards();
}
function renderHand() {
  const acts = actions(st, "a");
  const me = st.a;
  const f = data.fighters[me.id];
  $("#hand").innerHTML = acts
    .filter((a) => a.kind === "card")
    .map((a) => {
      const c = cardOf(a.id);
      const live = comboLive(st, "a", c);
      let mid, why = "<span></span>";
      if (c.kind === "strike") {
        const hc = hitChance(st, "a", c, false, null);
        mid = `<div class="pct">${Math.round(hc.p * 100)}<small>%</small></div>`;
        if (hc.why.includes("open")) why = '<span class="why">↑ 破綻</span>';
        else if (hc.why.includes("combo")) why = '<span class="why" style="color:var(--combo)">↑ 連段</span>';
        else if (hc.why.includes("tired")) why = '<span class="why dn">↓ 體力</span>';
        else if ((f.skill?.[a.id] || 0) >= 0.04) why = '<span class="why">↑ 擅長</span>';
      } else mid = `<div class="big">${c.kind === "trap" ? "👁" : "🎭"}</div>`;
      const note = a.ok ? "" : `<div class="note">${a.why === "range" ? `需要「${rangeText(c)}」` : a.why === "trap" ? "已經埋了一張" : "體力不足"}</div>`;
      const cls = [c.kind === "strike" ? c.region : c.kind, c.rarity === "sig" ? "sig" : "", a.ok ? "" : "off", sel === a.idx ? "sel" : "", live ? "combolive" : "", a.charged ? "charged" : "", holdIdx === a.idx ? "held" : ""].join(" ");
      return `<div class="card ${cls}" data-idx="${a.idx}" data-ok="${a.ok ? 1 : 0}">
        ${a.charged ? '<span class="chg">🔥 蓄力</span>' : ""}${keyword(c, live)}
        <div class="n">${c.name}${c.rarity === "sig" ? "★" : ""}</div>${mid}${a.ok ? `<div class="tx">${c.text || ""}</div>` : note}
        <div class="ft"><span class="holdbtn ${holdIdx === a.idx ? "on" : ""}" data-hold="${a.idx}">${holdIdx === a.idx ? "已留" : "留"}</span>${why}<span class="cost">⚡${c.cost}</span></div></div>`;
    })
    .join("");
  const sub = { advance: "靠近一格", retreat: "拉開一格", sidestep: "閃開攻擊", guard: "擋住，回一點體力" };
  $("#acts").innerHTML = acts
    .filter((a) => a.kind === "move")
    .map((a) => `<div class="act ${a.ok ? "" : "off"}" data-move="${a.id}" data-ok="${a.ok ? 1 : 0}">${cfg.moves[a.id].label}<small>${a.cost ? `⚡${a.cost} ` : ""}${sub[a.id] || ""}</small></div>`)
    .join("");
  renderReach();
}
function render() {
  renderHud();
  renderHand();
  setCap(tip(), true);
}
function setCap(html, dim = false) {
  const c = $("#cap");
  c.innerHTML = html;
  c.className = dim ? "dim" : "";
}
/** The single most useful thing to know right now. */
function tip() {
  const me = st.a, op = st.b;
  const any = actions(st, "a").some((a) => a.kind === "card" && a.ok);
  const oh = heldCard(st, "b");
  if (op.open) return '<span class="tipicon">🎯</span>他露出破綻：這一手你的命中 +20%，重拳的好時機';
  if (me.landedLast && me.hand.some((h) => cardOf(h.id).combo)) return '<span class="tipicon">⛓</span>上一手打中了：發亮的連段牌現在更準更重';
  if (oh && cardOf(oh).kind === "strike") return `<span class="tipicon">🔥</span>他在蓄力【${cardOf(oh).name}】：可以架擋、後退拉開，或埋預判等他`;
  if (op.trap) return '<span class="tipicon">👁</span>他埋了一張預判牌：小心前進、出直拳或踢腿，可以先用假動作或架擋試探';
  if (!any) return '<span class="tipicon">↔</span>手上沒有打得到的牌：前進／後退調整距離，或架擋回體力';
  return YOURS;
}
function renderReach() {
  const r = $("#reach");
  if (sel == null || busy) { r.hidden = true; return; }
  const h = st.a.hand[sel];
  if (!h) { r.hidden = true; return; }
  const c = cardOf(h.id);
  if (c.kind !== "strike") { r.hidden = true; return; }
  const far = Math.min(...c.range);
  const ok = c.range.includes(st.dist);
  const len = Math.max(30, GAP[far] + 14);
  r.hidden = false;
  r.className = `reach ${ok ? "ok" : "no"}`;
  r.style.left = leftX(st.dist) + W - 4 + "px";
  r.style.width = len + "px";
  r.querySelector(".lb").textContent = ok ? `${c.name} 打得到（${rangeText(c)}）` : `距離不夠：需要「${rangeText(c)}」`;
}
function showReveal(on, html = "") {
  $("#hand").hidden = on;
  $("#acts").hidden = on;
  $("#reveal").hidden = !on;
  if (on) $("#reveal").innerHTML = html;
}
function banner(text, color) {
  const el = document.createElement("div");
  el.className = "banner";
  el.style.color = color;
  el.textContent = text;
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

// ---------- input ----------
const hand = $("#hand");
hand.addEventListener("pointerdown", (e) => {
  holdFired = false;
  if (e.target.closest(".holdbtn")) return;
  const el = e.target.closest(".card");
  if (!el || busy || el.dataset.ok !== "1") return;
  const idx = Number(el.dataset.idx);
  const c = cardOf(st.a.hand[idx].id);
  if (c.kind !== "strike") return;
  clearTimeout(hand._t);
  hand._t = setTimeout(() => {
    holdFired = true;
    const canBoost = c.cost + cfg.boost.cost <= st.a.stamina;
    play({ card: idx, boost: canBoost });
  }, 480);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hand.addEventListener(ev, () => clearTimeout(hand._t));
hand.addEventListener("click", (e) => {
  if (busy || holdFired) return;
  const hb = e.target.closest(".holdbtn");
  if (hb) {
    const i = Number(hb.dataset.hold);
    holdIdx = holdIdx === i ? null : i;
    if (sel === holdIdx) sel = null;
    renderHand();
    return;
  }
  const el = e.target.closest(".card");
  if (!el) return;
  const idx = Number(el.dataset.idx);
  const c = cardOf(st.a.hand[idx].id);
  if (sel !== idx) {
    sel = idx;
    renderHand();
    setCap(describeCard(c, st.a.hand[idx].charged) + (el.dataset.ok === "1" ? " · <b>再點一次出牌</b>" : ""));
    return;
  }
  if (el.dataset.ok !== "1") return;
  play({ card: idx });
});
$("#acts").addEventListener("click", (e) => {
  const el = e.target.closest(".act");
  if (!el || busy || el.dataset.ok !== "1") return;
  play({ move: el.dataset.move });
});
$("#help").addEventListener("click", () => !busy && showHelp());

// ---------- one beat ----------
const nameOf = (s) => (s === "a" ? "你" : st[s].short);
function descLabel(d, hidden) {
  if (d.kind === "move") return cfg.moves[d.id].label;
  if (hidden) return "蓋了一張牌";
  return cardOf(d.id).name + (d.boost ? "＋" : "");
}
function revealHtml(ev) {
  const r = ev.find((e) => e.t === "reveal");
  const atk = (s) => ev.find((e) => e.t === "attack" && e.by === s);
  const fe = (s) => ev.find((e) => e.t === "feint" && e.by === s);
  const one = (s, who) => {
    const d = r[s];
    const hidden = s === "b" && d.kind === "trap"; // the opponent's trap stays face-down
    const a = atk(s);
    const c = d.kind !== "move" ? cardOf(d.id) : null;
    const color = !c ? "#556" : c.kind === "trap" ? "var(--trap)" : c.kind === "feint" ? "var(--feint)" : `var(--${c.region})`;
    let pct = "—", res = '<div class="res miss"> </div>';
    if (a) {
      pct = a.whiff === "trapped" ? "—" : `${Math.round(a.p * 100)}%`;
      res = a.hit ? '<div class="res hit">命中</div>' : `<div class="res miss">${a.whiff === "range" ? "距離不夠" : a.whiff === "trapped" ? "被預判" : "落空"}</div>`;
    } else if (fe(s)) res = `<div class="res ${fe(s).ok ? "hit" : "miss"}">${fe(s).ok ? "騙到了" : "沒騙到"}</div>`;
    else if (d.kind === "trap") res = '<div class="res miss">埋伏中</div>';
    return `<div class="rc" style="--c:${hidden ? "var(--trap)" : color}"><small>${who}</small><b>${descLabel(d, hidden)}</b><div class="pct" ${a && a.whiff !== "trapped" ? "" : 'style="font-size:18px;margin-top:8px"'}>${hidden ? "?" : pct}</div>${res}</div>`;
  };
  return one("a", "你") + '<div class="vs">VS</div>' + one("b", st.b.short);
}
function floatText(s, text) {
  const el = document.createElement("div");
  el.className = "float";
  el.textContent = text;
  el.style.left = parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 10 + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function spark(s) {
  const el = document.createElement("div");
  el.className = "spark";
  el.textContent = "✦";
  el.style.left = parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 8 + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 600);
}
async function lunge(s) {
  const el = $(s === "a" ? "#fp" : "#fo");
  const x = parseFloat(el.style.left);
  const step = Math.max(14, Math.min(120, GAP[st.dist] - 6)); // close the gap so the blow visibly lands
  el.style.left = x + (s === "a" ? step : -step) + "px";
  await sleep(170);
  el.style.left = x + "px";
}
function shake(s) {
  const el = $(s === "a" ? "#fp" : "#fo");
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 400);
}

async function animate(ev) {
  const rv = ev.find((e) => e.t === "reveal");
  $("#reach").hidden = true;
  showReveal(true, revealHtml(ev));
  setCap(`${descLabel(rv.a)}　VS　${descLabel(rv.b, rv.b.kind === "trap")}`);
  await sleep(900);
  for (const e of ev) {
    if (e.t === "trap") {
      const t = e.by === "a" ? "b" : "a";
      banner("👁 預判成功！", "var(--trap)");
      spark(t); shake(t); floatText(t, `-${e.dmg}`);
      setCap(`${nameOf(e.by)}的<em>${cardOf(e.id).name}</em>觸發了${e.cancel ? "，擋掉那一招並反擊" : "，迎面一擊"}`);
      await sleep(1100);
    } else if (e.t === "trapSet") {
      setCap(e.by === "a" ? `你蓋了一張預判牌：<em>${cardOf(rv.a.id).name}</em>，從下一手開始生效` : `${st.b.short} 蓋了一張預判牌（你看不到是什麼）`);
      await sleep(700);
    } else if (e.t === "move") {
      placeFighters();
      setCap(e.push ? `推開了！距離：${DN[e.from]} → ${DN[e.to]}` : `距離：${DN[e.from]} → ${DN[e.to]}`);
      await sleep(450);
    } else if (e.t === "feint") {
      if (e.ok) banner("🎭 騙到了！", "var(--feint)");
      setCap(e.ok ? `${nameOf(e.by)}的<em>${cardOf(e.id).name}</em>騙到了：${e.by === "a" ? st.b.short : "你"}下一手露出破綻` : `${nameOf(e.by)}的<em>${cardOf(e.id).name}</em>沒騙到`);
      await sleep(e.ok ? 1000 : 650);
    } else if (e.t === "attack") {
      if (e.whiff === "trapped") continue;
      const name = cardOf(e.id).name + (e.boost ? "（加注）" : "");
      const t = e.by === "a" ? "b" : "a";
      await lunge(e.by);
      if (e.hit) {
        spark(t); shake(t); floatText(t, `-${e.dmg}`);
        if (e.why?.includes("combo")) banner("⛓ 連段！", "var(--combo)");
        else if (e.charged) banner("🔥 蓄力一擊", "var(--fire)");
        else if (e.why?.includes("counter")) banner("迎擊！", "#9fc0ff");
        setCap(`${nameOf(e.by)} <em>${name}</em> 命中${e.by === "a" ? "他" : "你"}的${REGION[e.region]}`);
      } else {
        setCap(`${nameOf(e.by)} <em>${name}</em> ${e.whiff === "range" ? "距離不夠，落空" : "被躲開"}${e.openSelf ? " · 露出破綻" : ""}`);
      }
      await sleep(800);
    } else if (e.t === "clash") {
      banner("互中！", "#fff");
      setCap("兩人同時中拳，都晃了一下！");
      await sleep(900);
    }
  }
}

async function play(choice) {
  if (busy || st.over) return;
  busy = true;
  if (holdIdx != null && holdIdx !== choice.card) choice.hold = holdIdx;
  sel = null; holdIdx = null;
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
    const downName = p.down === "a" ? "你" : st.b.short;
    $("#f" + (p.down === "a" ? "p" : "o")).classList.add("down");
    renderHud();
    banner("倒地！", "var(--red)");
    setCap(`<em>${downName}倒地了！</em>`);
    let chase;
    if (p.by === "a") chase = await chooseChase();
    else { await sleep(900); chase = ai.chase(st); }
    const ev2 = settleKnockdown(st, chase);
    events = events.concat(ev2);
    const ch = ev2.find((e) => e.t === "chase");
    if (ch) setCap(ch.finished ? `<em>${nameOf(ch.by)}追擊成功！</em>` : `${nameOf(ch.by)}追擊沒有得手，露出了破綻`);
    else setCap(`${nameOf(p.by)}選擇穩住，${downName}站了起來`);
    await sleep(1100);
    $("#fp").classList.remove("down");
    $("#fo").classList.remove("down");
  }
  showReveal(false);
  busy = false;
  render();
  if (st.over) { busy = true; return showEnd(); }
  const re = events.find((e) => e.t === "roundEnd");
  if (re) { busy = true; return showRoundEnd(re); }
}

function chooseChase() {
  return new Promise((res) => {
    const ov = $("#ov");
    const o = st[st.pending.down];
    const pf = chaseOdds(st, st.pending.down);
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
  const row = (s) => `<div><b>${s === "a" ? "你" : st.b.short}</b>${re.landed[s]} 次命中 · 傷害 ${Math.round(re.dealt[s])}${re.kd[s] ? ` · 被擊倒 ${re.kd[s]}` : ""}</div>`;
  ov.className = "ov dark";
  ov.innerHTML = `<h1 style="font-size:26px">第 ${re.round} 回合結束</h1>
    <div class="sum">${row("a")}${row("b")}</div>
    <p>一分鐘休息：體力回復 ${cfg.stamina.roundRecover}。預判牌、連段在回合結束時清掉。比賽中看不到分數。</p>
    <button class="btn gold" id="next">開始第 ${re.round + 1} 回合</button>`;
  ov.hidden = false;
  $("#next").onclick = () => {
    ov.hidden = true;
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

function showHelp() {
  const ov = $("#ov");
  ov.className = "ov dark";
  ov.innerHTML = `<h1 style="font-size:24px">牌型說明</h1>
    <div class="legend">
      <div><b style="background:#26324b;color:#fff">出拳腳</b>大數字是命中率。灰色＝距離不夠或沒體力。按住牌＝加注：多花體力，更重更準。</div>
      <div><b style="background:var(--combo);color:#fff">⛓ 連段</b>上一手打中，這張就發亮：更準、更重。先用刺拳打中，再接直拳、鉤拳。</div>
      <div><b style="background:#0f3f3a;color:#8ff3e6">👁 預判</b>蓋起來等 2 手。他做出牌上寫的動作就觸發，有些還能擋掉他那一招。他只知道你埋了東西。</div>
      <div><b style="background:#1d2e4f;color:#b9d2ff">🎭 假動作</b>不打人。他若架擋或閃，下一手他露出破綻（你命中 +20%）。他若出手，你白挨一下。</div>
      <div><b style="background:var(--fire);color:#1a0d00">🔥 留／蓄力</b>沒出的牌每手都會換新。點「留」保住一張到下一手，它會變重，但對手看得到你在蓄什麼。</div>
      <div><b style="background:#3a1717;color:#ff9d9a">破綻</b>重拳打空、被假動作騙到都會露破綻：下一手被打更準。選手身上發紅光就是破綻。</div>
      <div><b style="background:#161c28;color:#fff">距離</b>點一張牌，選手前面會出現箭頭：綠色打得到，紅色打不到。先移動，再出拳。</div>
      <div><b style="background:#161c28;color:#fff">倒地</b>頭部傷到發紅後，重拳可能打倒對手，你選追擊或穩住。三次倒地就輸。</div>
    </div>
    <button class="btn gold" id="gotit">開始打</button>`;
  ov.hidden = false;
  $("#gotit").onclick = () => {
    ov.hidden = true;
    try { localStorage.setItem("bout.help", "1"); } catch {}
  };
}

window.__bout = { get st() { return st; }, play, newBout, data };
newBout();
