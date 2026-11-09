// Browser page for the card bout (bout.html): drawing and input. Rules are engine.js, the opponent is ai.js.
// Layout follows mock.html (844x390). Fighters are placeholder shapes until sprites are wired in.
import { createBout, playBeat, settleKnockdown, actions, odds, groundOdds, comboLive, heldCard, danger, headRatio, limping, clock, prepare, chaseOdds, stepOk, setPlan, doCorner, cornerOptions, injuries, PLANS, TARGETS, tdOdds, sprawlOdds, groundCardOdds, groundRole, subInfo, subRound, autoQuality } from "./engine.js";
import { createAI } from "./ai.js";

const load = async (n) => (await fetch(`rules/bout/${n}.json`)).json();
const data = prepare({ config: await load("config"), cards: await load("cards"), fighters: await load("fighters") });
const cfg = data.config;
const params = new URLSearchParams(location.search);
const IDS = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
const ME = IDS.includes(params.get("me")) ? params.get("me") : "holloway";
const pickFoe = (want) => (IDS.includes(want) && want !== ME ? want : IDS.includes("makhachev") && ME !== "makhachev" ? "makhachev" : IDS.find((k) => k !== ME));
let FOE = pickFoe(params.get("foe"));
const GACT = { pound: "重擊", strikeup: "下位打擊", advance: "升位", sub: "🔒 鎖技", sweep: "反轉", escape: "脫逃" };
// what each ground act is called when you are reading the other side's hand
const GREAD = { pound: "砸拳", strikeup: "下位打擊", advance: "過腿", sub: "鎖技", sweep: "掃翻", escape: "脫逃", getup: "起身", ride: "壓住", release: "放人", defend: "護住" };
const POS = cfg.ground.posNames;
const gName = (id) => data.cards[id]?.name || cfg.ground.moves[id]?.label || id;
const REGION = { head: "頭", body: "身", leg: "腿" };
const DN = cfg.dist.names;
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, params.has("fast") ? 4 : ms)); // ?fast=1 in the address is for automated play-tests only; a leftover global must never skip the animations again
const YOURS = "你的回合 · 選步法（可不選）→ 點兩次出牌 · 按住牌＝加注 ·「留」蓄力 ·「埋」預判";

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
    <div class="fighter p" id="fp">${fig}</div><div class="fighter o" id="fo">${fig}</div>
    <div class="steps" id="steps"></div><div id="help">？ 說明</div></div>
  <div id="cap" class="dim"></div>
  <div id="bot"><div class="hand" id="hand"></div><div class="acts" id="acts"></div><div class="reveal" id="reveal" hidden></div></div>
  <div class="ov" id="ov" hidden></div>`;

function fit() {
  frame.style.transform = `scale(${Math.min(innerWidth / 844, innerHeight / 390)})`;
}
addEventListener("resize", fit);
fit();

// ---------- state ----------
let st, ai, busy = false, sel = null, holdIdx = null, trapIdx = null, step = 0, holdFired = false;
function resetChoice() { sel = null; holdIdx = null; trapIdx = null; step = 0; }
function newBout(foe) {
  if (typeof foe === "string") FOE = pickFoe(foe);
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  st = createBout(data, ME, FOE, seed);
  let a = (seed * 31 + 7) >>> 0;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  ai = createAI(data, "b", rng);
  busy = false;
  resetChoice();
  $("#ov").hidden = true;
  render();
  let seen = false;
  try { seen = localStorage.getItem("bout.help6") === "1"; } catch {}
  if (!seen) showHelp(() => beginRound(null));
  else beginRound(null);
}

// ---------- geometry: the gap between the two bodies matches what can reach ----------
const W = 56;
const GAP = [210, 112, 44, -6]; // px between bodies at 遠 中 近 纏抱
const CENTER = 422;
const leftX = (d) => CENTER - GAP[d] / 2 - W;
const rightX = (d) => CENTER + GAP[d] / 2;
/** Where the player would stand after the planned step (the opponent stays put). */
const previewLeft = () => leftX(st.dist) + (GAP[st.dist] - GAP[Math.max(0, Math.min(3, st.dist + step))]);
function placeGround() {
  const top = st.ground.top;
  const base = CENTER - 76;
  const shift = [18, 40, -12][st.ground.pos];
  for (const [el, s] of [[$("#fp"), "a"], [$("#fo"), "b"]]) {
    el.classList.add("lie");
    el.classList.remove("ghosting");
    el.style.left = (s === top ? base + shift : base) + "px";
    el.style.bottom = s === top ? "42px" : "";
  }
}
function placeFighters(preview = false) {
  const gl = st.mode === "ground";
  $("#stage").classList.toggle("ground", gl);
  if (gl) return placeGround();
  for (const id of ["#fp", "#fo"]) {
    $(id).classList.remove("lie");
    $(id).style.bottom = "";
  }
  $("#fp").style.left = (preview ? previewLeft() : leftX(st.dist)) + "px";
  $("#fo").style.left = rightX(st.dist) + "px";
  $("#fp").classList.toggle("ghosting", preview && step !== 0);
}

// ---------- text for cards ----------
const cardOf = (id) => data.cards[id];
const rangeText = (c) => (c.range.length === 4 ? "任何距離" : c.range.map((d) => DN[d]).join("／"));
const pct = (x) => Math.round(x * 100);
function keyword(c, live) {
  if (c.kind === "takedown") return '<span class="kw td">🤼 抓摔</span>';
  if (c.kind === "sprawl") return '<span class="kw td">🛡 反摔</span>';
  if (c.kind === "ground") return `<span class="kw ${c.act === "sub" ? "sub" : "td"}">${GACT[c.act]}</span>`;
  if (c.kind === "trap") return '<span class="kw trap">👁 預判</span>';
  if (c.kind === "feint") return '<span class="kw feint">🎭 假動作</span>';
  if (c.ko >= 0.1 || (c.heavy && c.region === "head" && danger(st, "b"))) return '<span class="kw ko">KO</span>';
  if (c.combo) return `<span class="kw combo ${live ? "live" : ""}">⛓ 連段${live ? "!" : ""}</span>`;
  if (c.counter) return '<span class="kw counter">迎擊</span>';
  if (c.breaks) return '<span class="kw push">破摔</span>';
  if (c.push) return '<span class="kw push">推開</span>';
  return "";
}
function describeCard(c, charged) {
  if (c.kind === "takedown") return `<em>${c.name}</em> · 🤼 抓摔 · 可用：${rangeText(c)} · 成功 ${pct(tdOdds(st, "a", c).p)}% · 成功進地面、你在上位；失敗露破綻`;
  if (c.kind === "sprawl") return `<em>${c.name}</em> · 🛡 反摔 · 他抱腿時擋下 ${pct(sprawlOdds(st, "a", c))}%、你壓到上面；他沒抱腿就白花一手`;
  if (c.kind === "ground") {
    const o = groundCardOdds(st, "a", c.id);
    const what = { pound: "打頭", advance: c.to === 1 ? "升到壓制" : "升到背後", sweep: "翻到他上面", escape: "往下脫出一階", sub: "鎖上就進入降伏小遊戲" }[c.act];
    return `<em>${c.name}</em> · ${what || "從下面打他的頭"} · 成功 ${pct(o.p)}%（${readLine(c.act, c.hit)}）${c.act === "pound" ? " · 他護住時只有一半傷害、被擋掉你露破綻" : ""}${charged ? " · 🔥 蓄力" : ""}`;
  }
  if (c.kind === "trap") return `<em>${c.name}</em> · 👁 預判：點「埋」蓋起來（不佔這一手），等 ${c.trap.beats} 手：${c.text}，一定打實${c.trap.cancel ? "、擋掉他那一招" : ""}，他還會露破綻`;
  if (c.kind === "feint") return `<em>${c.name}</em> · 🎭 假動作：${c.text}。他若出手，你會白挨一下`;
  const d = Math.max(0, Math.min(3, st.dist + step));
  const o = odds(st, "a", c, { d });
  const ob = odds(st, "a", c, { d, boost: true });
  const bits = [`<em>${c.name}</em>`, `打${REGION[c.region]}`, `可打到：${rangeText(c)}`, `碰到 ${pct(o.land)}% · 打實 ${pct(o.clean)}%`, `按住加注 ⚡+${cfg.boost.cost}：打實 ${pct(ob.clean)}%、更容易打晃，沒打實就露破綻`];
  if (st.a.stunned) bits.push("💫 你被打晃：出手變差");
  if (c.combo) bits.push(comboLive(st, "a", c) ? "⛓ 連段發動" : "⛓ 連段：上一手打實時更強");
  if (c.counter) bits.push("他往前時打實 +30%");
  if (c.breaks) bits.push("他抱腿時打實 +30%、摔不進來");
  if (c.push) bits.push("打實把他推開");
  if (c.heavy) bits.push("打空露破綻");
  if (charged) bits.push("🔥 蓄力");
  return bits.join(" · ");
}

/** What the other side can do this beat on the ground (their hand is public by kind of move). */
function foeGroundActs() {
  const out = {};
  for (const a of actions(st, "b")) {
    if (!a.ok) continue;
    const act = a.kind === "card" ? cardOf(a.id).act : cfg.ground.moves[a.id].act;
    out[act] = (out[act] || 0) + 1;
  }
  return out;
}
/** For a ground act of mine: the odds against each thing he can do now, best first. */
function readOdds(act, base) {
  return Object.keys(foeGroundActs())
    .filter((k) => k !== "release")
    .map((k) => ({ k, p: groundOdds(st, "a", act, base, k).p }))
    .sort((x, y) => y.p - x.p);
}
function readLine(act, base) {
  return readOdds(act, base).map((r) => `他${GREAD[r.k]} ${pct(r.p)}%`).join("、");
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
  if (f.stunned) bd.push("💫晃");
  if (danger(st, s)) bd.push("暈");
  if (f.stamina / f.staminaMax < cfg.stamina.low) bd.push("喘");
  if (limping(st, s)) bd.push("跛");
  $("#bd" + k).innerHTML = bd.map((t) => `<span class="badge">${t}</span>`).join("");
  const el = $(k === "p" ? "#fp" : "#fo");
  el.classList.toggle("open", f.open > 0);
  el.classList.toggle("hurtleg", limping(st, s));
  el.classList.toggle("dizzy", danger(st, s) || f.stunned);
}
function renderBoards() {
  const mk = (cls, t) => `<div class="mk ${cls}">${t}</div>`;
  const me = st.a, op = st.b;
  let p = "", o = "";
  if (st.plan.a.plan !== "steady" || st.plan.a.target) p += mk("plan", `📋 ${cfg.plans[st.plan.a.plan].label}${st.plan.a.target ? "·主攻" + cfg.target[st.plan.a.target].label : ""}`);
  if (st.mode === "ground") {
    p += mk("grd", st.ground.top === "a" ? "⬆ 你在上位" : "⬇ 你在下位");
    o += mk("grd", st.ground.top === "b" ? "⬆ 他在上位" : "⬇ 他在下位");
    if (st.ground.stall >= 2) p += mk("open", `⏱ ${st.ground.stall} 手沒進展，裁判快叫起`);
    const fa = foeGroundActs();
    o += mk("plan", "他能做：" + Object.entries(fa).filter(([k]) => k !== "release").map(([k, n]) => GREAD[k] + (n > 1 ? `×${n}` : "")).join("、"));
  }
  if (me.trap) p += mk("trap", `👁 你埋了：${cardOf(me.trap.id).name}（剩 ${me.trap.left} 手）`);
  const mh = heldCard(st, "a");
  if (mh) p += mk("fire", `🔥 你在蓄力：${cardOf(mh).name}`);
  if (me.landedLast) p += mk("combo", "⛓ 連段準備好");
  if (me.stunned) p += mk("open", "💫 你被打晃了！");
  if (me.open) p += mk("open", "你露出破綻");
  if (op.trap) o += mk("trap", "👁 他埋了一張預判（看不到）");
  const oh = heldCard(st, "b");
  if (oh) o += mk("fire", `🔥 他在蓄力：${cardOf(oh).name}`);
  if (op.landedLast) o += mk("combo", "⛓ 他可以接連段");
  if (op.stunned) o += mk("open", "💫 他被打晃了！");
  if (op.open) o += mk("open", "他露出破綻！");
  $("#boardp").innerHTML = p;
  $("#boardo").innerHTML = o;
}
function renderSteps() {
  const opts = [[-1, "◀ 退一步"], [0, "原地"], [1, "進一步 ▶"]];
  $("#steps").innerHTML = '<span class="sl">步法</span>' + opts.map(([v, t]) => `<span class="sb ${step === v ? "on" : ""} ${stepOk(st, "a", v) ? "" : "off"}" data-step="${v}">${t}</span>`).join("");
  $("#steps").hidden = busy || st.mode === "ground";
}
function renderHud() {
  renderSide("a", "p");
  renderSide("b", "o");
  const sec = clock(st);
  $("#clock").innerHTML = st.over ? "結束" : `R${st.round + 1} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}<small>第 ${st.beat + 1} 手 / ${cfg.beatsPerRound} · ${st.mode === "ground" ? `地面 · ${st.ground.top === "a" ? "你在上位" : "你在下位"} · ${POS[st.ground.pos]}` : `距離「${DN[st.dist]}」`}</small>`;
  placeFighters(!busy);
  renderBoards();
}
function renderHand() {
  const acts = actions(st, "a", step);
  const me = st.a;
  const f = data.fighters[me.id];
  const d = Math.max(0, Math.min(3, st.dist + step));
  $("#hand").innerHTML = acts
    .filter((a) => a.kind === "card")
    .map((a) => {
      const c = cardOf(a.id);
      const live = comboLive(st, "a", c);
      let mid, why = "";
      if (c.kind === "strike") {
        const o = odds(st, "a", c, { d });
        const ob = odds(st, "a", c, { d, boost: true });
        mid = `<div class="pct">${pct(o.land)}<small>%</small></div><div class="cl">打實 ${pct(o.clean)}% · 加注 ${pct(ob.clean)}%</div>`;
        if (o.why.includes("stunned")) why = '<span class="why dn">↓被打晃</span>';
        else if (o.why.includes("open")) why = '<span class="why">↑破綻</span>';
        else if (o.why.includes("combo")) why = '<span class="why" style="color:var(--combo)">↑連段</span>';
        else if (o.why.includes("target")) why = '<span class="why">↑主攻</span>';
        else if (o.why.includes("range")) why = '<span class="why">↑你的距離</span>';
        else if (o.why.includes("tired")) why = '<span class="why dn">↓體力</span>';
        else if ((f.skill?.[a.id] || 0) >= 0.04) why = '<span class="why">↑擅長</span>';
      } else if (c.kind === "takedown") {
        const o = tdOdds(st, "a", c);
        mid = `<div class="pct">${pct(o.p)}<small>%</small></div><div class="cl">摔倒成功</div>`;
        if (o.why.includes("tired")) why = '<span class="why dn">↓體力</span>';
      } else if (c.kind === "sprawl") {
        mid = `<div class="pct">${pct(sprawlOdds(st, "a", c))}<small>%</small></div><div class="cl">他抱腿時擋下</div>`;
      } else if (c.kind === "ground") {
        const o = groundCardOdds(st, "a", a.id);
        const rs = readOdds(c.act, c.hit);
        const best = rs[0], worst = rs[rs.length - 1];
        const spread = best && best.p - worst.p >= 0.08;
        mid = spread
          ? `<div class="pct">${pct(best.p)}<small>%</small></div><div class="cl">他${GREAD[best.k]}時｜最差 ${pct(worst.p)}%</div>`
          : `<div class="pct">${pct(o.p)}<small>%</small></div><div class="cl">${c.text}</div>`;
        if (o.why.includes("open")) why = '<span class="why">↑破綻</span>';
        else if (o.why.includes("tired")) why = '<span class="why dn">↓體力</span>';
      } else mid = `<div class="big">${c.kind === "trap" ? "👁" : "🎭"}</div><div class="tx">${c.text}</div>`;
      const note = a.ok ? "" : `<div class="note">${a.why === "pos" ? "位置不對" : a.why === "range" ? `需要「${rangeText(c)}」` : a.why === "trap" ? "已經埋了一張" : "體力不足"}</div>`;
      const cls = [c.kind === "strike" ? c.region : c.kind === "takedown" || c.kind === "sprawl" ? "grap" : c.kind === "ground" ? (c.act === "sub" ? "gsub" : c.act === "pound" ? "head" : "grap") : c.kind, c.rarity === "sig" ? "sig" : "", a.ok ? "" : "off", sel === a.idx ? "sel" : "", live ? "combolive" : "", a.charged ? "charged" : "", holdIdx === a.idx ? "held" : "", trapIdx === a.idx ? "trapping" : ""].join(" ");
      const trapBtn = c.kind === "trap" ? `<span class="trapbtn ${trapIdx === a.idx ? "on" : ""} ${a.ok ? "" : "off"}" data-trap="${a.idx}">${trapIdx === a.idx ? "已埋" : "埋"}</span>` : "";
      return `<div class="card ${cls}" data-idx="${a.idx}" data-ok="${a.ok ? 1 : 0}" data-side="${a.side ? 1 : 0}">
        ${a.charged ? '<span class="chg">🔥 蓄力</span>' : ""}${keyword(c, live)}
        <div class="n">${c.name}${c.rarity === "sig" ? "★" : ""}</div>${mid}${note}
        <div class="ft"><span class="holdbtn ${holdIdx === a.idx ? "on" : ""}" data-hold="${a.idx}">${holdIdx === a.idx ? "已留" : "留"}</span>${trapBtn}${why}<span class="cost">⚡${c.cost}</span></div></div>`;
    })
    .join("");
  const sub = { advance: "整手往前", retreat: "整手後退（躲開）", sidestep: "閃開攻擊", guard: "擋住，回一點體力" };
  const gl = st.mode === "ground";
  $("#acts").innerHTML = actions(st, "a", 0)
    .filter((a) => a.kind === "move")
    .map((a) => {
      if (gl) {
        const mv = cfg.ground.moves[a.id];
        const o = mv.hit != null ? groundCardOdds(st, "a", a.id) : null;
        const rs = o ? readOdds(mv.act, mv.hit) : [];
        const txt = rs.length ? `他${GREAD[rs[0].k]}時｜最差 ${pct(rs[rs.length - 1].p)}%` : mv.text;
        return `<div class="act ${a.ok ? "" : "off"}" data-move="${a.id}" data-ok="${a.ok ? 1 : 0}">${mv.label}${rs.length ? ` ${pct(rs[0].p)}%` : ""}<small>${a.cost ? `⚡${a.cost} ` : ""}${txt}</small></div>`;
      }
      return `<div class="act ${a.ok ? "" : "off"}" data-move="${a.id}" data-ok="${a.ok ? 1 : 0}">${cfg.moves[a.id].label}<small>${a.cost ? `⚡${a.cost} ` : ""}${sub[a.id] || ""}</small></div>`;
    })
    .join("");
  $("#acts").classList.toggle("two", gl);
  renderReach();
  renderSteps();
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
function groundTip() {
  const top = st.ground.top === "a";
  const p = st.ground.pos;
  const open = st.b.open ? "他露出破綻，這手更容易成功。" : "";
  const stall = st.ground.stall >= 2 ? "⏱ 幾手沒進展，裁判快叫起。" : "";
  if (top) return `<span class="tipicon">⬆</span>${open}${stall}讀他（右上寫著他能做什麼）：他護住 → 過腿、鎖技容易；他想脫逃／起身 → 砸拳打得到；他想掃翻或鎖你 → 別砸拳，「壓住」最穩`;
  return `<span class="tipicon">⬇</span>${open}${stall}讀他（右上寫著他能做什麼）：他砸拳 → 鎖技、掃翻、下位肘擊容易；他過腿 → 脫逃、起身容易；他壓住 → 什麼都難，護住回氣${p === 0 ? "" : "；被壓制時先脫逃回護腿"}`;
}
function tip() {
  if (st.mode === "ground") return groundTip();
  const me = st.a, op = st.b;
  const playable = (s) => actions(st, "a", s).some((a) => a.kind === "card" && a.ok && !a.side);
  const oh = heldCard(st, "b");
  if (me.stunned) return '<span class="tipicon">💫</span>你被打晃了：出手變差、再被打實頭部很容易倒。後退或架擋保命，或賭一記迎擊（他衝上來時迎擊打實大增）';
  if (op.stunned) return '<span class="tipicon">💫</span>他被打晃了！他露破綻、這手 KO 機會大增：按住重拳加注追擊。但他可能後退或迎擊你';
  if (op.open) return '<span class="tipicon">🎯</span>他露出破綻：這一手你打實的機會 +20%，重拳的好時機';
  if (me.landedLast && me.hand.some((h) => cardOf(h.id).combo)) return '<span class="tipicon">⛓</span>上一手打實了：發亮的連段牌現在更準更重';
  if (oh && cardOf(oh).kind === "strike") return `<span class="tipicon">🔥</span>他在蓄力【${cardOf(oh).name}】：可以架擋、後退躲開，或「埋」一張預判等他`;
  if (op.trap) return '<span class="tipicon">👁</span>他埋了一張預判：小心往前、出拳或踢腿，可以先用假動作或架擋試探';
  if (!playable(0) && (stepOk(st, "a", 1) && playable(1) || stepOk(st, "a", -1) && playable(-1))) return '<span class="tipicon">↔</span>原地打不到：在選手腳下選「進一步」或「退一步」，灰色的牌就會亮起來';
  if (!playable(0)) return '<span class="tipicon">↔</span>手上沒有打得到的牌：用前進／後退換距離，或架擋回體力';
  return YOURS;
}
function renderReach() {
  const r = $("#reach");
  if (sel == null || busy || st.mode === "ground") { r.hidden = true; return; }
  const h = st.a.hand[sel];
  if (!h) { r.hidden = true; return; }
  const c = cardOf(h.id);
  if (c.kind !== "strike") { r.hidden = true; return; }
  const d = Math.max(0, Math.min(3, st.dist + step));
  const far = Math.min(...c.range);
  const ok = c.range.includes(d);
  r.hidden = false;
  r.className = `reach ${ok ? "ok" : "no"}`;
  r.style.left = previewLeft() + W - 4 + "px";
  r.style.width = Math.max(30, GAP[far] + 14) + "px";
  r.querySelector(".lb").textContent = ok ? `${c.name} 打得到（${rangeText(c)}）` : `距離不夠：需要「${rangeText(c)}」${c.range.some((x) => Math.abs(x - st.dist) === 1) ? "，試試步法" : ""}`;
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
  if (e.target.closest(".holdbtn,.trapbtn")) return;
  const el = e.target.closest(".card");
  if (!el || busy || el.dataset.ok !== "1" || el.dataset.side === "1") return;
  const idx = Number(el.dataset.idx);
  const c = cardOf(st.a.hand[idx].id);
  if (c.kind !== "strike") return;
  clearTimeout(hand._t);
  hand._t = setTimeout(() => {
    holdFired = true;
    play({ card: idx, step, boost: true });
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
    if (trapIdx === holdIdx) trapIdx = null;
    renderHand();
    return;
  }
  const tb = e.target.closest(".trapbtn");
  if (tb) {
    if (tb.classList.contains("off")) return;
    const i = Number(tb.dataset.trap);
    trapIdx = trapIdx === i ? null : i;
    if (holdIdx === trapIdx) holdIdx = null;
    if (sel === trapIdx) sel = null;
    renderHand();
    setCap(trapIdx != null ? `👁 這手會埋下<em>${cardOf(st.a.hand[i].id).name}</em>，再選一個出手或動作` : tip(), trapIdx == null);
    return;
  }
  const el = e.target.closest(".card");
  if (!el) return;
  const idx = Number(el.dataset.idx);
  const c = cardOf(st.a.hand[idx].id);
  if (sel !== idx) {
    sel = idx;
    renderHand();
    setCap(describeCard(c, st.a.hand[idx].charged) + (el.dataset.ok === "1" && el.dataset.side !== "1" ? " · <b>再點一次出牌</b>" : ""));
    return;
  }
  if (el.dataset.ok !== "1" || el.dataset.side === "1") return;
  play({ card: idx, step });
});
$("#acts").addEventListener("click", (e) => {
  const el = e.target.closest(".act");
  if (!el || busy || el.dataset.ok !== "1") return;
  play({ move: el.dataset.move });
});
$("#steps").addEventListener("click", (e) => {
  const b = e.target.closest(".sb");
  if (!b || busy || b.classList.contains("off")) return;
  step = Number(b.dataset.step);
  placeFighters(true);
  renderHand();
  if (sel != null && st.a.hand[sel]) setCap(describeCard(cardOf(st.a.hand[sel].id), st.a.hand[sel].charged));
  else setCap(tip(), true);
});
$("#help").addEventListener("click", () => !busy && showHelp());

// ---------- one beat ----------
const nameOf = (s) => (s === "a" ? "你" : st[s].short);
const stepWord = (d) => (d.step > 0 ? "進一步＋" : d.step < 0 ? "退一步＋" : "");
function descLabel(d, hidden) {
  if (d.kind === "move") return (cfg.moves[d.id] || cfg.ground.moves[d.id]).label;
  if (hidden) return "蓋了一張牌";
  return stepWord(d) + cardOf(d.id).name + (d.boost ? "（加注）" : "");
}
function revealGroundHtml(ev, r) {
  const one = (s, who) => {
    const d = r[s];
    const c = d.kind === "ground" ? cardOf(d.id) : null;
    const color = !c ? "#556" : c.act === "sub" ? "var(--gsub)" : c.act === "pound" ? "var(--head)" : "var(--grap)";
    const atk = ev.find((e) => e.t === "gattack" && e.by === s);
    const tr = ev.find((e) => e.t === "gtry" && e.by === s);
    let big = "—", res = '<div class="res miss"> </div>';
    if (atk) { big = `${pct(atk.p)}%`; res = `<div class="res ${atk.hit ? "hit" : "miss"}">${atk.hit ? "打中" : "沒打到"}</div>`; }
    else if (tr && tr.p != null) { big = `${pct(tr.p)}%`; res = `<div class="res ${tr.ok ? "hit" : "miss"}">${tr.ok ? "成功" : "失敗"}</div>`; }
    return `<div class="rc" style="--c:${color}"><small>${who} · ${d.role === "top" ? "上位" : "下位"}</small><b>${gName(d.id)}</b><div class="pct" ${big === "—" ? 'style="font-size:18px;margin-top:8px"' : ""}>${big}</div>${res}</div>`;
  };
  return one("a", "你") + '<div class="vs">VS</div>' + one("b", st.b.short);
}
function revealHtml(ev) {
  const r = ev.find((e) => e.t === "reveal");
  if (r.ground) return revealGroundHtml(ev, r);
  const atk = (s) => ev.find((e) => e.t === "attack" && e.by === s);
  const fe = (s) => ev.find((e) => e.t === "feint" && e.by === s);
  const one = (s, who) => {
    const d = r[s];
    const a = atk(s);
    const c = d.kind !== "move" ? cardOf(d.id) : null;
    const color = !c ? "#556" : c.kind === "feint" ? "var(--feint)" : c.region ? `var(--${c.region})` : "var(--grap)";
    let big = "—", res = '<div class="res miss"> </div>';
    const td = ev.find((e) => e.t === "takedown" && e.by === s);
    const spr = c?.kind === "sprawl" ? ev.find((e) => e.t === "takedown" && e.by !== s) : null;
    if (td) {
      big = `${pct(td.p)}%`;
      res = `<div class="res ${td.ok ? "hit" : "miss"}">${td.ok ? "摔倒了！" : td.whiff === "sprawled" ? "被壓趴" : td.whiff === "range" ? "距離不夠" : "被擋住"}</div>`;
    } else if (spr) {
      big = `${pct(spr.sprawlP)}%`;
      res = `<div class="res ${spr.whiff === "sprawled" ? "hit" : "miss"}">${spr.whiff === "sprawled" ? "擋下了！" : "沒擋下"}</div>`;
    } else if (c?.kind === "sprawl") res = '<div class="res miss">他沒抱腿</div>';
    else if (a) {
      big = a.whiff === "trapped" ? "—" : `${pct(a.land)}%`;
      res = a.hit ? `<div class="res hit">${a.quality === "clean" ? "打實！" : "擦到"}</div>` : `<div class="res miss">${a.whiff === "range" ? "距離不夠" : a.whiff === "trapped" ? "被預判" : "落空"}</div>`;
    } else if (fe(s)) res = `<div class="res ${fe(s).ok ? "hit" : "miss"}">${fe(s).ok ? "騙到了" : "沒騙到"}</div>`;
    const extra = d.trapSet ? `<div class="res" style="color:var(--trap)">${s === "a" ? `＋埋 ${cardOf(st.a.trap?.id || "")?.name || "預判"}` : "＋蓋了一張牌"}</div>` : "";
    return `<div class="rc" style="--c:${color}"><small>${who}</small><b>${descLabel(d)}</b><div class="pct" ${a && a.whiff !== "trapped" ? "" : 'style="font-size:18px;margin-top:8px"'}>${big}</div>${res}${extra}</div>`;
  };
  return one("a", "你") + '<div class="vs">VS</div>' + one("b", st.b.short);
}
function floatText(s, text, small) {
  const el = document.createElement("div");
  el.className = "float" + (small ? " small" : "");
  el.textContent = text;
  el.style.left = parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 10 + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function spark(s, small) {
  const el = document.createElement("div");
  el.className = "spark" + (small ? " small" : "");
  el.textContent = small ? "·" : "✦";
  el.style.left = parseFloat($(s === "a" ? "#fp" : "#fo").style.left) + 8 + "px";
  $("#stage").appendChild(el);
  setTimeout(() => el.remove(), 600);
}
async function lunge(s) {
  const el = $(s === "a" ? "#fp" : "#fo");
  const x = parseFloat(el.style.left);
  const step2 = Math.max(14, Math.min(120, GAP[st.dist] - 6));
  el.style.left = x + (s === "a" ? step2 : -step2) + "px";
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
  $("#steps").hidden = true;
  showReveal(true, revealHtml(ev));
  setCap(`${descLabel(rv.a)}　VS　${descLabel(rv.b)}`);
  await sleep(900);
  for (const e of ev) {
    if (e.t === "trap") {
      const t = e.by === "a" ? "b" : "a";
      banner("👁 預判成功！", "var(--trap)");
      spark(t); shake(t); floatText(t, `-${e.dmg}`);
      if (e.stun) $(t === "a" ? "#fp" : "#fo").classList.add("dizzy");
      setCap(`${nameOf(e.by)}的<em>${cardOf(e.id).name}</em>觸發了${e.cancel ? "：擋掉那一招並反擊" : "：迎面一擊"}，${e.by === "a" ? "他" : "你"}${e.stun ? "被打晃了！" : "露出破綻"}`);
      await sleep(1200);
    } else if (e.t === "trapSet") {
      setCap(e.by === "a" ? `你埋下了<em>${cardOf(st.a.trap?.id || rv.a.id)?.name || "預判"}</em>，從下一手開始生效` : `${st.b.short} 埋了一張預判牌（你看不到是什麼）`);
      await sleep(650);
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
        const clean = e.quality === "clean";
        spark(t, !clean); if (clean) shake(t); floatText(t, `-${e.dmg}`, !clean);
        if (clean && e.why?.includes("combo")) banner("⛓ 連段！", "var(--combo)");
        else if (clean && e.charged) banner("🔥 蓄力一擊", "var(--fire)");
        else if (clean && e.why?.includes("counter")) banner("迎擊！", "#9fc0ff");
        if (e.stun) { banner("💫 打晃了！", "var(--gold)"); $(t === "a" ? "#fp" : "#fo").classList.add("dizzy"); }
        setCap(`${nameOf(e.by)} <em>${name}</em> ${clean ? "打實" : "擦到"}${e.by === "a" ? "他" : "你"}的${REGION[e.region]}${e.stun ? `，<b>${e.by === "a" ? "他被打晃了！" : "你被打晃了！"}</b>` : ""}${e.openSelf ? " · 加注沒打實，出手過猛露出破綻" : ""}`);
      } else {
        setCap(`${nameOf(e.by)} <em>${name}</em> ${e.whiff === "range" ? "距離不夠，落空" : "被躲開"}${e.openSelf ? " · 出手過猛，露出破綻" : ""}`);
      }
      await sleep(780);
    } else if (e.t === "takedown") {
      const t = e.by === "a" ? "b" : "a";
      const name = cardOf(e.id).name;
      await lunge(e.by);
      if (e.ok) {
        banner("🤼 摔倒了！", "var(--grap)");
        shake(t);
        setCap(`${nameOf(e.by)}的<em>${name}</em>成功，${e.by === "a" ? st.b.short : "你"}被摔倒在地`);
      } else {
        setCap(e.whiff === "sprawled" ? `${nameOf(t)}壓趴擋下了<em>${name}</em>` : e.whiff === "range" ? `${nameOf(e.by)}的<em>${name}</em>距離不夠` : e.whiff === "ko" ? "倒地了，抱腿取消" : `${nameOf(e.by)}的<em>${name}</em>被擋住了，露出破綻`);
      }
      await sleep(900);
    } else if (e.t === "sprawl") {
      setCap(`${nameOf(e.by)}壓趴，但對手沒有抱腿——白花一手`);
      await sleep(600);
    } else if (e.t === "tdClash") {
      banner("互相纏鬥", "#fff");
      setCap("兩個人同時抱腿，纏在一起沒摔成");
      renderHud();
      await sleep(900);
    } else if (e.t === "ground") {
      renderHud();
      banner(e.how === "sprawl" ? "🛡 壓趴！" : "進入地面", "var(--grap)");
      setCap(`${nameOf(e.top)}壓在上位（${POS[e.pos]}）${e.how === "sprawl" ? "：抱腿被壓趴反制" : ""}`);
      await sleep(900);
    } else if (e.t === "gattack") {
      const t = e.by === "a" ? "b" : "a";
      const name = cardOf(e.id).name;
      if (e.hit) {
        spark(t); shake(t); floatText(t, `-${e.dmg}`);
        setCap(`${nameOf(e.by)} <em>${name}</em> 打中${e.by === "a" ? "他" : "你"}的頭`);
      } else setCap(`${nameOf(e.by)} <em>${name}</em> ${e.blocked ? `被護住擋掉，${e.by === "a" ? "你" : "他"}露出破綻` : "沒打到"}`);
      await sleep(750);
    } else if (e.t === "gtry") {
      if (e.act === "release") setCap(`${nameOf(e.by)}放對手起來`);
      else setCap(`${nameOf(e.by)} <em>${gName(e.id)}</em> ${e.ok ? "成功" : "失敗"}`);
      await sleep(e.ok ? 500 : 600);
    } else if (e.t === "gpos") {
      renderHud();
      banner(e.how === "advance" ? `⬆ ${POS[e.to]}` : `⬇ 脫出到${POS[e.to]}`, "var(--grap)");
      setCap(`位置：${POS[e.from]} → ${POS[e.to]}`);
      await sleep(900);
    } else if (e.t === "swap") {
      renderHud();
      banner("🔄 掃翻！", "var(--grap)");
      setCap(`${nameOf(e.top)}翻到了上位，對手露出破綻`);
      await sleep(1000);
    } else if (e.t === "scramble") {
      banner("僵持", "#fff");
      setCap("兩邊同時得手，互相抵消");
      await sleep(800);
    } else if (e.t === "subLock") {
      banner("🔒 鎖上了！", "var(--gsub)");
      setCap(`${nameOf(e.by)}鎖上了<em>${cardOf(e.id).name}</em>${e.by === "a" ? "" : "！掙脫它"}`);
      await sleep(900);
    } else if (e.t === "standup") {
      renderHud();
      banner(e.how === "ref" ? "裁判叫起" : e.how === "getup" ? "站起來了！" : "放人起來", "#fff");
      setCap(e.how === "ref" ? "幾手沒進展，裁判把兩人叫起來重新開始" : e.how === "getup" ? `${nameOf(e.by)}成功站起來` : `${nameOf(e.by)}放對手起來`);
      await sleep(900);
    } else if (e.t === "clash") {
      banner("互中！", "#fff");
      setCap("兩人同時打實，都晃了一下！");
      await sleep(900);
    }
  }
}

async function play(choice) {
  if (busy || st.over) return;
  if (holdIdx != null && holdIdx !== choice.card) choice.hold = holdIdx;
  if (trapIdx != null && trapIdx !== choice.card) choice.trap = trapIdx;
  if (choice.move) delete choice.step;
  if (choice.boost) {
    const c = cardOf(st.a.hand[choice.card].id);
    const need = c.cost + cfg.boost.cost + (choice.trap != null ? cardOf(st.a.hand[choice.trap].id).cost : 0);
    if (need > st.a.stamina) delete choice.boost;
  }
  busy = true;
  resetChoice();
  let ev;
  try {
    ev = playBeat(st, choice, ai.think(st));
  } catch (err) {
    console.error(err);
    setCap(`這樣出不了：${err.message === "not enough stamina" ? "體力不夠（預判也要花體力）" : err.message}`);
    busy = false;
    renderHand();
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
  if (st.subPending) events = events.concat(await runSub());
  showReveal(false);
  busy = false;
  render();
  if (st.over) { busy = true; return showEnd(); }
  const re = events.find((e) => e.t === "roundEnd");
  if (re) { busy = true; return beginRound(re); }
}

// ---------- the squeeze: a timing minigame per round ----------
const AUTO_SUB = params.has("autosub"); // automated play-tests only
async function runSub() {
  const all = [];
  const ov = $("#ov");
  const humanAtk = st.subPending.by === "a";
  const gstat = data.fighters[st.a.id].ground[humanAtk ? "sub" : "escape"];
  let auto = AUTO_SUB;
  const fillOf = (m) => Math.max(0, Math.min(1, (m + 0.9) / 2)) * 100;
  const frame = (info, msg = "") => {
    ov.className = "ov dark";
    ov.innerHTML = `<h1 style="font-size:24px">🔒 ${info.name}　${humanAtk ? "你鎖上了！" : "你被鎖住了！"}</h1>
      <div class="tug2"><span class="lb">${humanAtk ? "他脫出" : "你脫出"}</span><div class="trk"><div class="fill ${humanAtk ? "mine" : "his"}" id="fill" style="width:${fillOf(info.meter)}%"></div></div><span class="lb">${humanAtk ? "他拍地板" : "你拍地板"}</span></div>
      <div class="tbar" id="tbar"><div class="zone" id="zone"></div><div class="mark" id="mark"></div></div>
      <p id="sinfo">${msg || `第 ${info.round + 1} / ${info.rounds} 輪 · 標記進到亮區時按${humanAtk ? "「扣緊」" : "「掙脫」"}（亮區大小看你的${humanAtk ? "鎖技" : "脫逃"}能力）`}</p>
      <div style="display:flex;gap:10px"><button class="btn gold" id="tap">${humanAtk ? "扣緊！" : "掙脫！"}</button><button class="btn" id="auto">自動</button></div>`;
    ov.hidden = false;
  };
  const timing = () =>
    new Promise((res) => {
      if (auto) return res(autoQuality(st));
      const c = 0.3 + Math.random() * 0.4;
      const w = 0.12 + gstat * 0.6;
      const zone = $("#zone"), mark = $("#mark");
      zone.style.left = (c - w) * 100 + "%";
      zone.style.width = w * 2 * 100 + "%";
      const t0 = performance.now();
      let m = 0, raf = 0, done = false;
      const finish = (q) => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        removeEventListener("keydown", onKey);
        res(q);
      };
      const loop = (now) => {
        const t = (now - t0) / 1000;
        m = Math.abs(((t / 0.9) % 2) - 1);
        mark.style.left = m * 100 + "%";
        if (t > 3) return finish(0.1);
        raf = requestAnimationFrame(loop);
      };
      const tap = () => finish(Math.max(0, Math.min(1, 1 - Math.abs(m - c) / (1.4 * w))));
      const onKey = (e) => { if (e.code === "Space") { e.preventDefault(); tap(); } };
      addEventListener("keydown", onKey);
      $("#tap").onclick = tap;
      $("#auto").onclick = () => { auto = true; finish(autoQuality(st)); };
      raf = requestAnimationFrame(loop);
    });
  while (st.subPending) {
    const info = subInfo(st);
    frame(info);
    const q = await timing();
    const qa = humanAtk ? q : autoQuality(st);
    const qd = humanAtk ? autoQuality(st) : q;
    const ev = subRound(st, qa, qd);
    all.push(...ev);
    const e = ev.find((x) => x.t === "subRound");
    const fl = $("#fill");
    if (fl) fl.style.width = fillOf(e.meter) + "%";
    const you = humanAtk ? qa : qd, him = humanAtk ? qd : qa;
    if ($("#sinfo")) $("#sinfo").innerHTML = `你的時機 ${pct(you)}% · 他 ${pct(him)}%${e.done === "tap" ? ` · <b>${humanAtk ? "他拍地板了！" : "你拍地板了…"}</b>` : e.done === "escape" ? ` · <b>${humanAtk ? "他脫出了" : "你掙脫了！"}</b>` : ""}`;
    await sleep(e.done ? 1400 : 900);
  }
  ov.hidden = true;
  return all;
}

function chooseChase() {
  return new Promise((res) => {
    const ov = $("#ov");
    const o = st[st.pending.down];
    const pf = chaseOdds(st, st.pending.down);
    ov.className = "ov";
    ov.innerHTML = `<h1>${o.short} 倒地！</h1><p>他搖搖欲墜。現在撲上去，還是穩住？</p>
      <div class="choices">
        <div class="bigc go" data-c="1"><b>追擊</b><span>撲上去重擊，約 ${pct(pf)}% 直接結束比賽<br>花 ${cfg.chase.cost} 體力 · 失敗會露出破綻</span></div>
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

// ---------- between rounds: summary → (corner) → coach report + plan ----------
const HABIT = { advance: "前進", retreat: "後退", sidestep: "側移", guard: "架擋", feint: "假動作" };
const PART = { head: "頭", body: "身", leg: "腿" };
const FEEL = { ours: "「這回合應該是我們的。」", theirs: "「這回合恐怕被他拿下了。」", close: "「很接近，我看不出來。」" };
const planName = (p, aim) => cfg.plans[p].label + (aim ? "·主攻" + cfg.target[aim].label : "");

function showSummary(re) {
  const ov = $("#ov");
  const row = (s) => `<div><b>${s === "a" ? "你" : st.b.short}</b>${re.landed[s]} 次打到 · 傷害 ${Math.round(re.dealt[s])}${re.kd[s] ? ` · 被擊倒 ${re.kd[s]}` : ""}<br><small style="color:var(--dim)">計畫：${planName(re.plan[s], re.aim[s])}</small></div>`;
  ov.className = "ov dark";
  ov.innerHTML = `<h1 style="font-size:26px">第 ${re.round} 回合結束</h1>
    <div class="sum">${row("a")}${row("b")}</div>
    <p>比賽中看不到分數。體力回復 ${cfg.stamina.roundRecover}；預判、連段在回合結束時清掉。</p>
    <button class="btn gold" id="next">進角落</button>`;
  ov.hidden = false;
  return new Promise((res) => { $("#next").onclick = res; });
}

/** Three choices, two picks. Without an injury the doctor is not there and it is coach + rest automatically. */
async function chooseCorner() {
  const opt = cornerOptions(st, "a");
  if (!opt.doctor) return ["coach", "rest"];
  const hurt = injuries(st, "a").map((i) => PART[i.part]).join("、");
  const picked = new Set(["doctor", "coach"]);
  const ov = $("#ov");
  const tile = (k, name, text) => `<div class="ptile ${picked.has(k) ? "on" : ""}" data-k="${k}"><b>${name}</b><span>${text}</span></div>`;
  const draw = () => {
    ov.className = "ov dark";
    ov.innerHTML = `<div class="rbk"><h2>角落 · 一分鐘，只夠做兩件事</h2>
      <div class="tiles">${tile("coach", "聽教練", "告訴你他這回合做了什麼、這回合的感覺")}
      ${tile("doctor", "找醫生", `你的${hurt}有傷：處理最嚴重的一處，傷勢 -${Math.round(cfg.corner.doctorRelief * 100)}%`)}
      ${tile("rest", "休息", `體力再 +${cfg.corner.restRecover}`)}</div>
      <button class="btn gold" id="ok" ${picked.size === 2 ? "" : "disabled"}>${picked.size === 2 ? "決定" : "選兩件"}</button></div>`;
  };
  draw();
  ov.hidden = false;
  return new Promise((res) => {
    ov.onclick = (e) => {
      const t = e.target.closest(".ptile");
      if (t) {
        const k = t.dataset.k;
        if (picked.has(k)) picked.delete(k);
        else {
          if (picked.size >= 2) picked.delete([...picked][0]);
          picked.add(k);
        }
        draw();
        return;
      }
      if (e.target.closest("#ok") && picked.size === 2) {
        ov.onclick = null;
        res([...picked]);
      }
    };
  });
}

function coachHtml(info) {
  if (!info) return "";
  const lines = [];
  if (info.healed) lines.push(`🩺 醫生處理了你的${PART[info.healed]}`);
  if (info.rested) lines.push(`💤 休息：體力 +${cfg.corner.restRecover}`);
  if (info.intel) {
    lines.push(`🗣 教練：<i>${FEEL[info.intel.feel]}</i>`);
    for (const f of info.intel.facts) {
      if (f.k === "aim") lines.push(`他這回合出了 ${f.n} 次拳腳：頭 ${pct(f.head)}% · 身 ${pct(f.body)}% · 腿 ${pct(f.leg)}%`);
      else if (f.k === "td") lines.push(`他這回合抱摔試了 ${f.tried} 次、成功 ${f.ok} 次，有 ${f.gbeats} 手在地面`);
      else if (f.k === "habit") lines.push(`他 ${f.of} 手裡有 ${f.n} 手選了「${HABIT[f.what]}」`);
      else if (f.k === "weak") lines.push(`🔍 試探看出來了：他的${f.what === "chin" ? `下巴比一般人脆（只有平均的 ${pct(f.ratio)}%）` : `體力比一般人差（只有平均的 ${pct(f.ratio)}%）`}`);
      else if (f.k === "range") lines.push(`🔍 試探看出來了：他最舒服的距離是「${DN[f.dist]}」`);
    }
  }
  return lines.length ? `<div class="coach">${lines.join("<br>")}${info.intel ? "<small>數字都是真的；「感覺」只是教練的判斷，會看錯。</small>" : ""}</div>` : "";
}

async function choosePlan(info) {
  const ov = $("#ov");
  let plan = "steady", target = null;
  const names = PLANS(data);
  const draw = () => {
    ov.className = "ov dark";
    ov.innerHTML = `<div class="rbk"><h2>第 ${st.round + 1} 回合 · 選計畫（對手同時選，開打才翻開）</h2>
      ${coachHtml(info)}
      <div class="tiles">${names.map((k) => `<div class="ptile ${plan === k ? "on" : ""}" data-plan="${k}"><b>${cfg.plans[k].label}</b><span>${cfg.plans[k].text}</span></div>`).join("")}</div>
      <div class="tgt">主攻部位 ${[null, ...TARGETS(data)].map((t) => `<span class="pill ${target === t ? "on" : ""}" data-t="${t ?? ""}">${t ? cfg.target[t].label : "不指定"}</span>`).join("")}</div>
      <div class="hint">主攻的部位牌抽得多；對手那裡傷得越重，加成越大（對方腳弱就打腳）。</div>
      <button class="btn gold" id="go">開始第 ${st.round + 1} 回合</button></div>`;
    ov.hidden = false;
  };
  draw();
  return new Promise((res) => {
    ov.onclick = (e) => {
      const p = e.target.closest("[data-plan]");
      if (p) { plan = p.dataset.plan; draw(); return; }
      const t = e.target.closest("[data-t]");
      if (t) { target = t.dataset.t || null; draw(); return; }
      if (e.target.closest("#go")) {
        ov.onclick = null;
        res({ plan, target });
      }
    };
  });
}

/** Both sides get their corner (from round 2), then both choose a plan in secret; the computer's is shown only after the round. */
async function beginRound(re) {
  busy = true;
  let info = null;
  if (re) {
    await showSummary(re);
    const picks = await chooseCorner();
    info = doCorner(st, "a", picks);
  }
  const bInfo = re ? doCorner(st, "b", ai.corner(st)) : null;
  const pb = ai.plan(st, bInfo);
  const pa = await choosePlan(info);
  setPlan(st, "a", pa.plan, pa.target);
  setPlan(st, "b", pb.plan, pb.target);
  $("#ov").hidden = true;
  busy = false;
  resetChoice();
  render();
}

function showEnd() {
  const o = st.over;
  const ov = $("#ov");
  const win = o.winner === "a" ? "你贏了！" : o.winner === "b" ? "你輸了" : "平手";
  const cards = o.cards ? o.cards.map(([a, b]) => `${a}-${b}`).join("　") : "";
  ov.className = "ov dark";
  ov.innerHTML = `<h1>${win}</h1><p style="font-size:16px;color:var(--text)">${o.method}${o.cards ? "" : ` · 第 ${o.round} 回合`}</p>
    ${cards ? `<div class="cardsread">裁判計分　${cards}</div>` : ""}
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${IDS.filter((k) => k !== ME).map((k) => `<button class="btn gold" data-foe="${k}">再打一場 vs ${data.fighters[k].short}<small style="display:block;font-weight:400;color:var(--dim)">${data.fighters[k].style}</small></button>`).join("")}</div>`;
  ov.hidden = false;
  ov.onclick = (e) => {
    const b = e.target.closest("[data-foe]");
    if (b) { ov.onclick = null; newBout(b.dataset.foe); }
  };
}

function showHelp(done) {
  const ov = $("#ov");
  ov.className = "ov dark";
  ov.innerHTML = `<h1 style="font-size:22px">怎麼打</h1>
    <div class="legend">
      <div><b style="background:#26324b;color:#fff">出拳腳</b>大數字＝會碰到的機率。下面「打實」＝碰到後打結實的機率，沒打實就只是擦到。兩人同時出手（互換）時都更容易打實；他架擋時大多只擦到。</div>
      <div><b style="background:#4a3a0a;color:var(--gold)">加注</b>按住牌出：多 1 體力，打實機會大增、更重、更容易把人打晃。沒打實就是出手過猛，下一手你露破綻。</div>
      <div><b style="background:#4a2a0a;color:#ffd27a">💫 打晃</b>頭被打實可能被打晃：下一手出手變差、露破綻，再被打實頭部很容易倒。被打晃就選：後退、架擋保命，或賭一記迎擊。</div>
      <div><b style="background:#2a3a55;color:#fff">步法</b>選手腳下選「進一步／退一步」，再出牌：這一步和出手一起做，灰色的牌會亮起來。只有「後退」整手躲開，才能讓對方打空。</div>
      <div><b style="background:var(--combo);color:#fff">⛓ 連段</b>上一手打實，這張就發亮：更準、更重。刺拳打實後接直拳、鉤拳。</div>
      <div><b style="background:#0f3f3a;color:#8ff3e6">👁 預判</b>點「埋」蓋下去，不佔這一手（你照樣出手）。他做出牌上的動作就觸發：一定打實、有些能擋掉他那招，他還會露破綻。</div>
      <div><b style="background:#1d2e4f;color:#b9d2ff">🎭 假動作</b>不打人。他若架擋或閃，下一手他露破綻。他若出手，你白挨一下。</div>
      <div><b style="background:var(--fire);color:#1a0d00">🔥 留／蓄力</b>沒出的牌每手換新。點「留」保住一張到下一手，它會變重，但對手看得到。</div>
      <div><b style="background:#3a1717;color:#ff9d9a">破綻</b>重拳打空、被騙、被預判都會露破綻：下一手被打實的機會大增。發紅光就是破綻。</div>
      <div><b style="background:#3a2d0a;color:var(--gold)">📋 計畫</b>每回合開打前選一個計畫和主攻部位，對手也同時選。回合之間在角落聽教練、休息；受傷時還能找醫生（三選二）。</div>
      <div><b style="background:#1f4a3a;color:#9ff0c8">🤼 地面</b>抱腿、抱摔成功就進地面（也可能被壓趴反制）。雙方手上能做什麼是公開的，靠「讀他」：他砸拳時你鎖技、掃翻容易；他過腿時你脫逃、起身容易；他壓住時什麼都難。牌上寫著對上他各種動作的成功率。鎖技成功就進「降伏小遊戲」。幾手沒進展，裁判叫起。</div>
      <div><b style="background:#161c28;color:#fff">距離</b>點牌會出現箭頭：綠色打得到，紅色打不到。每個選手有自己最舒服的距離（↑你的距離）。</div>
    </div>
    <button class="btn gold" id="gotit">開始打</button>`;
  ov.hidden = false;
  $("#gotit").onclick = () => {
    ov.hidden = true;
    try { localStorage.setItem("bout.help6", "1"); } catch {}
    if (done) done();
  };
}

window.__bout = { get st() { return st; }, play, newBout, data, beginRound, get foe() { return FOE; } };
newBout();
