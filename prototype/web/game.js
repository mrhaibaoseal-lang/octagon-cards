// Screens, HUD and exchange playback. All rules come from engine.js; this file only shows them.
import { loadData, createMatch, resolveExchange, resolveFootwork, engageStart, engageStep, engageWaiting, stepOf, applyCorner, chooseAI, chooseFootwork, chooseCombo, choosePlan, chooseReaction, chooseCorner, chooseChase, resolvePending, setTactic, isFinal, getIntent, budget, previewPlay, previewCombo, previewFootwork, footworkChoices, comboError, comboMax, counterCards, reactionOf, describeCard, playError, lockStatus, lockResistChance, lockGuessWrong, groundOutcome, roleOf, cardCost } from "./engine.js";
import { Stage, loadAssets, REACH } from "./stage.js";

const $ = (id) => document.getElementById(id);
const TYPES = ["S", "G", "C"];
const ATTR_LABELS = [["power", "力量"], ["accuracy", "精準"], ["wrestling", "摔角"], ["grappleDef", "防摔"], ["submission", "柔術"], ["chin", "下巴"], ["cardio", "體能"]];
const TARGET_NAMES = { head: "頭", body: "身", legs: "腿" };
/** Reasons a second card cannot join the play, in which case clicking it starts a new play instead. */
const REPLACES = [];

let data;
let assets;
let stage;
let state = null;
let selected = []; // indices into the hand
let bracing = false;
let shown = null; // HUD values during playback, which trail the engine state
let picks = { a: "mcgregor", b: "khabib", mode: "standard" };
let selectUI = { target: "a", weight: "all" };
let skipping = false;
let skipWake = null;
let lastLine = "";
let viewCage = null; // who the screen shows against the fence
let viewDist = 1; // the distance as the screen currently shows it, which trails the engine during playback
let viewGround = null; // the mat as the screen shows it: { top, pos } or null
let viewLock = null; // who holds a lock on screen, if any
let cinematic = false; // a signature close-up is running
const groundTop = () => viewGround?.top ?? null;

// ---------- Boot ----------

async function boot() {
  const [rules, cards, fighters, depth, ground] = await Promise.all(["rules", "cards", "fighters", "depth", "ground"].map((n) => fetch(`rules/${n}.json`).then((r) => r.json())));
  data = loadData({ rules, cards, fighters, depth, ground });
  const ids = Object.keys(fighters).filter((id) => !fighters[id].hidden);
  assets = await loadAssets(ids, fighters);
  stage = new Stage($("cage"), assets);
  stage.setFighters(picks.a, picks.b);
  stage.setLayout({ dist: 1 }, true);
  fit();
  window.addEventListener("resize", fit);
  $("fight").addEventListener("click", onFight);
  $("brace").addEventListener("click", onBrace);
  $("pass").addEventListener("click", onPass);
  $("skip").addEventListener("click", () => {
    skipping = true;
    if (skipWake) skipWake();
  });
  renderSelect();
  const params = new URLSearchParams(location.search);
  if (fighters[params.get("a")]) picks.a = params.get("a");
  if (fighters[params.get("b")]) picks.b = params.get("b");
  if (params.get("a") || params.get("b")) renderSelect();
  if (params.get("autostart")) {
    startMatch();
    const go = document.querySelector("#overlay .opt.primary");
    if (go) go.click();
    $("banner").classList.remove("show");
  }
  window.__game = { get state() { return state; }, data, refresh: () => { syncShown(); beginTurn(); } }; // refresh is for checking screens by hand
}

function fit() {
  const game = $("game");
  const scale = Math.min(window.innerWidth / 844, window.innerHeight / 390);
  game.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.resize(Math.min(3, Math.max(1, Math.ceil(scale * (window.devicePixelRatio || 1)))));
}

const fighterOf = (side) => data.fighters[state[side].id];
const nameOf = (side) => (side === "a" ? "你" : fighterOf("b").short);

function portraitHtml(id, cls = "portrait") {
  const src = assets.portraits[id];
  if (src) return `<img class="${cls}" src="${src}" alt="">`;
  const initial = data.fighters[id].short[0];
  return `<div class="${cls}">${initial}</div>`;
}

// ---------- Fighter select ----------

const WEIGHT_CLASSES = [
  ["all", "全部 15"],
  ["135", "135 雛量"],
  ["145", "145 羽量"],
  ["155", "155 輕量"],
  ["185+", "185+ 中重"],
];

function weightName(lb) {
  if (lb <= 135) return "雛量級";
  if (lb <= 145) return "羽量級";
  if (lb <= 155) return "輕量級";
  if (lb <= 185) return "中量級";
  if (lb <= 205) return "輕重量級";
  return "重量級";
}

function matchWeightFilter(f, filter) {
  if (filter === "all") return true;
  if (filter === "185+") return (f.weight || 155) >= 185;
  return String(f.weight || 155) === filter;
}

function fighterArchetype(f) {
  if (f.attrs.wrestling >= 85 || f.attrs.submission >= 85) return { id: "grappler", label: "🤼 摔壓地面", short: "摔壓", cls: "G" };
  if ((f.style?.out?.C || 0) >= 0.38 || (f.prefer?.[0] === 0 && f.attrs.accuracy >= 84 && f.attrs.power < 85)) {
    return { id: "counter", label: "⚡ 步法狙擊", short: "狙擊", cls: "C" };
  }
  return { id: "striker", label: "💥 重砲打擊", short: "重擊", cls: "S" };
}

function preferRangeText(f) {
  const names = data.rules.dist.short;
  const [lo, hi] = f.prefer || [1, 2];
  return lo === hi ? `${names[lo]}距` : `${names[lo]}·${names[hi]}距`;
}

function describeStaticCard(cardId) {
  const c = data.cards[cardId];
  if (!c) return { name: cardId, type: "S", cost: 1, fx: "" };
  let fx = "";
  if (c.clinchEntry) fx = `貼進纏抱 · 扣敵${c.drain || 0}體力`;
  else if (c.type === "S") {
    fx = `傷害 ${c.power}${c.hits > 1 ? `×${c.hits}` : ""}`;
    if (c.crit >= 0.1) fx += ` · 爆擊+${Math.round(c.crit * 100)}%`;
    if (c.cut) fx += " · 割裂";
    if (c.move > 0) fx += ` · 進${c.move}`;
  } else if (c.type === "G") {
    if (c.pullGuard) fx = "拉入下位";
    else fx = `摔入${data.rules.positions[c.landing || 0]}${c.drain ? ` · 扣敵${c.drain}體力` : ""}${c.slam ? ` · 重摔${c.slam}` : ""}`;
  } else {
    if (c.catchShot) fx = "抓摔進斷頭台";
    else if (c.lockBottom || c.lockAnywhere) fx = `傷 ${c.power || 0} · 直接上鎖`;
    else fx = `反擊 ${c.power || 0}${c.crit >= 0.1 ? ` · 爆擊+${Math.round(c.crit * 100)}%` : ""}`;
  }
  const height = { high: "上段", mid: "中段", low: "下段", grab: "抱摔" }[c.height] || "";
  return { name: c.name.replace(/^招牌：/, ""), type: c.type, cost: c.cost ?? 1, fx: `${fx}${c.speed ? ` · 速度 ${c.speed}` : ""}`, height };
}

function renderSelect() {
  const box = $("select");
  box.classList.remove("hidden");
  $("battle").classList.add("hidden");
  $("overlay").classList.add("hidden");
  const ids = Object.keys(data.fighters).filter((id) => !data.fighters[id].hidden);

  // Position both fighters in a close octagon face-off on the live canvas
  stage.setFighters(picks.a, picks.b);
  stage.setLayout({ dist: 3 }, true);

  const fa = data.fighters[picks.a];
  const fb = data.fighters[picks.b];
  const sideCard = (side, f, opp, roleTitle) => {
    const sig = describeStaticCard(f.signature);
    const arch = fighterArchetype(f);
    const active = selectUI.target === side;
    const placeholder = assets.fighters[picks[side]]?.placeholder ? '<span class="ph">占位圖</span>' : "";
    const miniStats = ATTR_LABELS.map(([k, lb]) => {
      const v = f.attrs[k];
      const win = v > opp.attrs[k];
      return `<div class="a-st ${win ? "win" : ""}"><span>${lb}</span><b>${v}</b><i style="--w:${v}%"></i></div>`;
    }).join("");
    return `<div class="a-card ${side} ${active ? "target-on" : ""}" data-target-side="${side}">
      <div class="a-card-top">
        ${portraitHtml(picks[side], "portrait a-port")}
        <div class="a-meta">
          <div class="a-role"><span class="corner-pill ${side}">${roleTitle}</span><span class="arch-pill t-${arch.cls}">${arch.label}</span></div>
          <div class="a-name">${f.short}${placeholder} <small>${f.nick}</small></div>
          <div class="a-phys">${f.height}cm · ${f.weight}lb (${weightName(f.weight)}) · 擅長${preferRangeText(f)} · 出手 ${f.speed} · 反應 ${f.reaction}</div>
        </div>
      </div>
      <div class="a-sum">${f.summary}</div>
      <div class="a-perks">
        ${f.ability ? `<div class="a-perk"><b>⚡ ${f.ability.name}</b>：${f.ability.desc}</div>` : ""}
        <div class="a-perk sig"><b>★ 招牌・${sig.name}</b> (<span class="t-${sig.type}">${sig.height || data.rules.typeNames[sig.type]}</span>)：${sig.fx}</div>
      </div>
      <div class="a-stats">${miniStats}</div>
    </div>`;
  };

  const wDiff = Math.abs((fa.weight || 155) - (fb.weight || 155));
  const hDiff = (fa.height || 178) - (fb.height || 178);
  const tapeBadge = wDiff > 0
    ? `<span class="tape-warn">⚠️ 跨量級對決（差 ${wDiff} lb · 身高差 ${Math.abs(hDiff)} cm）</span>`
    : `<span class="tape-ok">⚖️ ${weightName(fa.weight)}對決 · 身高差 ${Math.abs(hDiff)} cm</span>`;

  const rosterTiles = ids.map((id) => {
    const f = data.fighters[id];
    const isA = picks.a === id;
    const isB = picks.b === id;
    const dim = !matchWeightFilter(f, selectUI.weight);
    return `<button class="pick a-tile ${isA ? "you on" : ""} ${isB ? "foe" : ""} ${dim ? "filtered" : ""}" data-id="${id}">
      <div class="a-tile-img">
        ${portraitHtml(id, "portrait")}
        ${isA ? '<i class="badge you">你</i>' : ""}
        ${isB ? '<i class="badge foe">敵</i>' : ""}
      </div>
      <span class="a-tile-nm">${f.short}</span>
      <span class="a-tile-wt">${f.weight}lb</span>
    </button>`;
  }).join("");

  box.innerHTML = `
    <div class="sel-topbar">
      <div class="sel-brand">
        <b>OCTAGON CARDS</b>
        <span class="sel-rule"><i class="t-S">走位</i>決定誰帶頭 · <i class="t-G">快招</i>看不到要預判 · <i class="t-C">慢招</i>看得到能應對</span>
      </div>
      <div class="sel-filters">
        ${WEIGHT_CLASSES.map(([w, lb]) => `<button class="w-pill ${selectUI.weight === w ? "on" : ""}" data-weight="${w}">${lb}</button>`).join("")}
      </div>
      <div class="sel-tools">
        <button class="tool-btn" id="btn-swap" title="雙方交換角色">⇄ 互換</button>
        <button class="tool-btn" id="btn-rand" title="隨機挑選對手">🎲 隨機對手</button>
      </div>
    </div>
    <div class="a-stage-row">
      ${sideCard("a", fa, fb, "P1 你的選手")}
      <div class="a-center-window">
        <div class="a-faceoff-head">
          <div class="fo-title">OCTAGON FACE-OFF</div>
          ${tapeBadge}
        </div>
        <div class="a-target-bar">
          <button class="t-btn you ${selectUI.target === "a" ? "on" : ""}" data-target-side="a">🟢 點選換：你 (${fa.short})</button>
          <button class="t-btn foe ${selectUI.target === "b" ? "on" : ""}" data-target-side="b">🔴 點選換：對手 (${fb.short})</button>
        </div>
      </div>
      ${sideCard("b", fb, fa, "CPU 對手")}
    </div>
    <div class="a-dock">
      <div class="a-roster">${rosterTiles}</div>
      <div class="a-go-col">
        <div class="a-modes">
          ${Object.entries(data.rules.match.modes).map(([id, m]) => `<button class="mode ${picks.mode === id ? "on" : ""}" data-mode="${id}">${m.label}<small>${m.rounds}R×${m.exchanges}手</small></button>`).join("")}
        </div>
        <button id="start" class="a-start">開打 FIGHT</button>
      </div>
    </div>`;

  box.querySelectorAll(".w-pill[data-weight]").forEach((el) => el.addEventListener("click", () => {
    selectUI.weight = el.dataset.weight;
    renderSelect();
  }));
  box.querySelectorAll("[data-target-side]").forEach((el) => el.addEventListener("click", () => {
    selectUI.target = el.dataset.targetSide;
    renderSelect();
  }));
  const pickFighter = (side, id) => {
    picks[side] = id;
    renderSelect();
    const arch = fighterArchetype(data.fighters[id]);
    stage.pose(side, arch.id === "grappler" ? "shoot" : arch.id === "counter" ? "kick" : "punch", 380);
  };
  box.querySelectorAll(".a-tile").forEach((el) => {
    el.addEventListener("click", () => pickFighter(selectUI.target, el.dataset.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectUI.target = "b";
      pickFighter("b", el.dataset.id);
    });
  });
  box.querySelectorAll(".mode").forEach((el) => el.addEventListener("click", () => {
    picks.mode = el.dataset.mode;
    renderSelect();
  }));
  $("btn-swap").addEventListener("click", () => {
    [picks.a, picks.b] = [picks.b, picks.a];
    renderSelect();
  });
  $("btn-rand").addEventListener("click", () => {
    const pool = ids.filter((id) => id !== picks.a && matchWeightFilter(data.fighters[id], selectUI.weight));
    const list = pool.length ? pool : ids.filter((id) => id !== picks.a);
    pickFighter("b", list[Math.floor(Math.random() * list.length)]);
  });
  $("start").addEventListener("click", startMatch);
}

function startMatch() {
  const seed = Number(new URLSearchParams(location.search).get("seed")) || Math.floor(Math.random() * 1e9);
  state = createMatch(data, picks.a, picks.b, seed, picks.mode);
  lastLine = "";
  $("select").classList.add("hidden");
  $("overlay").classList.add("hidden");
  $("battle").classList.remove("hidden");
  stage.setFighters(picks.a, picks.b);
  stage.timeScale = 1;
  stage.setLayout(state, true);
  syncShown();
  beginTurn();
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  shown.b.tactic = null; // his plan is revealed when the round starts
  renderPanel("b");
  askTactic("賽前準備", "選你這個回合的戰術，他的打法開賽才揭曉", null, (id) => {
    setTactic(state, "a", id);
    syncShown();
    beginTurn();
    announceRound();
  });
}

function syncShown() {
  shown = {};
  for (const s of ["a", "b"]) {
    const me = state[s];
    shown[s] = { hp: me.hp, stamina: me.stamina, momentum: me.momentum, rocked: me.rocked, cut: me.cut, pips: { ...me.pips }, marks: Object.keys(me.marks), pinned: state.cage?.side === s, tactic: me.tactic, leader: state.engage?.leader === s, edge: state.edge?.side === s };
  }
  viewDist = state.dist;
  viewCage = state.cage?.side ?? null;
  viewGround = state.ground ? { top: state.ground.top, pos: state.ground.pos } : null;
  viewLock = state.ground?.lock?.attacker ?? null;
  stage.setCuts(shown.a.cut, shown.b.cut);
}

// ---------- HUD ----------

function renderPanel(side) {
  const v = shown[side];
  const f = fighterOf(side);
  const pips = ["head", "body", "legs"].map((t) => {
    const n = v.pips[t];
    const cls = n >= data.rules.debuff.threshold ? "full" : n > 0 ? "on" : "";
    return `<span>${TARGET_NAMES[t]}<span class="pip ${cls}">${"●".repeat(n)}${"○".repeat(data.rules.debuff.maxPips - n)}</span></span>`;
  }).join("");
  const legHurt = v.pips.legs >= data.rules.debuff.threshold ? `<span class="tag leg">腿傷·走位+${data.rules.debuff.legFootCost}</span>` : "";
  const plan = v.tactic ? `<span class="tag tc" title="${data.rules.tactics[v.tactic].desc}">${data.rules.tactics[v.tactic].short}</span>` : "";
  const pinned = v.pinned ? '<span class="tag cage">背靠籠邊</span>' : "";
  const lead = v.leader ? '<span class="tag lead">帶頭</span>' : v.edge ? '<span class="tag edge">佔上風</span>' : "";
  const markChips = v.marks.map((t) => `<span class="tag mk">${data.rules.tags[t]?.short || t}</span>`).join("");
  const el = $(`panel-${side}`);
  const pctOf = (hp) => (hp / state.maxHp) * 100;
  const prevGhost = el.dataset.hp ? Number(el.dataset.hp) : v.hp;
  el.dataset.hp = v.hp;
  el.innerHTML = `
    ${portraitHtml(f === undefined ? "" : state[side].id)}
    <div class="stats">
      <div class="nameline">${side === "a" ? "你 · " : ""}${f.short}${v.rocked ? '<span class="tag">被打暈</span>' : ""}${v.cut ? `<span class="tag bleed">流血 Lv${v.cut}</span>` : ""}${plan}${lead}${pinned}${legHurt}${markChips}<span class="pips">${pips}</span></div>
      <div class="barwrap"><div class="fill ghost" style="width:${pctOf(prevGhost)}%"></div><div class="fill hp ${pctOf(v.hp) <= 18 ? "low" : ""}" style="width:${pctOf(v.hp)}%"></div></div>
      <div class="thinrow">
        <div class="barwrap thin"><div class="fill stam ${v.stamina < data.rules.energy.tiredAt ? "low" : ""}" style="width:${v.stamina}%"></div></div>
        <div class="barwrap thin"><div class="fill mom ${v.momentum >= data.rules.momentum.signatureCost ? "ready" : ""}" style="width:${v.momentum}%"></div></div>
      </div>
    </div>`;
  requestAnimationFrame(() => {
    const ghost = el.querySelector(".ghost");
    if (ghost) ghost.style.width = `${pctOf(v.hp)}%`;
  });
}

function placeText(view) {
  if (view.ground) {
    const you = view.ground.top === "a" ? "你在上位" : "你在下位";
    const track = data.rules.ground.short.map((t, i) => `<i class="${i === view.ground.pos ? "on" : ""}">${t}</i>`).join("");
    return `${data.rules.positions[view.ground.pos]} · ${you}<div class="track4 track5">${track}</div>`;
  }
  const { names, short } = data.rules.dist;
  const track = short.map((s, i) => `<i class="${i === view.dist ? "on" : ""}">${s}</i>`).join("");
  const pin = typeof view.cage === "string" ? view.cage : view.cage?.side;
  const where = pin ? `<span class="pin">${pin === "a" ? "你" : "他"}在籠邊</span>` : "站立";
  return `${where} · ${names[view.dist]}<div class="track4">${track}</div>`;
}

function renderCenter() {
  const total = state.perRound;
  let dots = "";
  for (let i = 1; i <= total; i++) dots += `<span class="dot ${i < state.exchange ? "done" : i === state.exchange ? "now" : ""} ${i === total ? "last" : ""}"></span>`;
  $("center-bar").innerHTML = `<div class="round">第 ${state.round}<small>/${state.rounds}</small> 回合</div><div class="dots">${dots}</div><div class="place">${placeText(state)}</div>`;
}

function renderHud() {
  renderPanel("a");
  renderPanel("b");
  renderCenter();
}

const HEIGHT_COLORS = { high: "bg-high", mid: "bg-mid", low: "bg-low", grab: "bg-grab", feint: "bg-feint" };
const GUARD_WORDS = { high: "高", mid: "中", low: "低" };
const BET_LABELS = { high: "架高", mid: "架中", low: "架低", cover: "抱頭", evade: "閃身", counter: "反擊", shoot: "抱摔", preempt: "搶先" };
const BET_HINTS = {
  high: "擋頭部攻擊", mid: "擋身體攻擊", low: "擋腿部，也壓低防抱腿", cover: "全部減傷", evade: "慢招容易閃開", counter: "比他快就打斷", shoot: "對慢招抱腿反擊", preempt: "花大量體力搶先打",
};
const FW_COLORS = { press: "#e5484d", hold: "#3e8ef7", circle: "#30a46c", retreat: "#8f7be0" };
const HEIGHT_SEG = { high: "#e5484d", mid: "#ff9f43", low: "#d4b106", grab: "#3e8ef7" };

let fwPick = null; // the footwork chosen for this hand
let combo = []; // card ids laid out for the combo, in order
let bet = null; // the response chosen before the cards turn over
let betNeedsCard = false; // counter / pre-empt: a card still to be picked

function renderIntent() {
  const intent = getIntent(state, "b");
  const el = $("intent");
  el.classList.remove("hidden");
  // Blood in your eyes: only the likeliest option shows, the others read "?".
  const rows = intent.options.filter((o) => intent.probs[o.id] > 0);
  const n = rows.length;
  const segs = rows.map((o) => {
    const hidden = intent.blind && o.id !== intent.top;
    const p = Math.round(intent.probs[o.id] * 100);
    const width = hidden ? 8 : intent.blind ? 100 - 8 * (n - 1) : p;
    const color = intent.kind === "footwork" ? FW_COLORS[o.id] : intent.kind === "lead" ? HEIGHT_SEG[o.id] : null;
    const cls = intent.ground ? `bg-${o.type}` : "";
    return `<span class="seg ${cls} ${hidden ? "hide" : ""}" style="flex:${Math.max(width, 1)};${color ? `background:${color}` : intent.kind === "respond" ? "background:#4a5470" : ""}">${o.label} ${hidden ? "?" : `${p}%`}</span>`;
  });
  const sig = intent.signatureReady ? '<b class="sig">⚡招牌</b>' : "";
  let head = "";
  let note;
  if (intent.kind === "footwork") head = '<span class="kind">下一步走位</span>';
  if (intent.kind === "lead" || intent.kind === "respond") {
    head = `<span class="kind">${intent.kind === "lead" ? "他的第一招打哪裡" : "他準備怎麼應對"}</span>`;
    if (!intent.detail) {
      // Only a jab that landed shows this layer. Until then the bar stays covered.
      el.innerHTML = `${head}<div class="bar3 covered"><span class="seg cover-note">用刺拳打中他之後，才看得清這一層</span></div><div class="note1">${intent.tags.length ? intent.tags.join("・") : ""}</div>`;
      return;
    }
  }
  note = intent.blind ? "血流進眼睛，只看得清最可能的選項" : intent.tags.length ? intent.tags.join("・") : intent.tell;
  el.title = intent.tell;
  el.innerHTML = `${head}<div class="bar3">${segs.join("")}${sig}</div><div class="note1">${note}</div>`;
}

function renderAlert() {
  const el = $("alert");
  el.className = "hidden";
  const lock = lockStatus(state);
  if (lock) {
    el.className = lock.attacker === "a" ? "swarm" : "";
    const stage = `第 ${lock.depth} 階（第 ${lock.tapDepth} 階拍墊）`;
    const hold = Math.round(lockResistChance(state) * 100);
    el.innerHTML = lock.attacker === "a"
      ? `你鎖住了：${lock.name}<br>${stage}<br>他猜錯時有 <b>${hold}%</b> 撐住，猜中退一階`
      : `被鎖住了：${lock.name}<br>${stage}<br>猜中退一階；猜錯要在綠區按下撐住（<b>${hold}%</b>）`;
  } else if (state.a.rocked) {
    el.className = "";
    el.innerHTML = `你被打暈了！<br>${state.ground ? "這手只有 1 能量，撐過去" : "只能出一招，也看不到慢招"}`;
  } else if (state.b.rocked) {
    el.className = "swarm";
    el.innerHTML = state.ground ? `他被打暈了！追擊！<br>多 1 能量，傷害 +25%` : `他被打暈了！追擊！<br>他看不到慢招，傷害 +25%`;
  }
  // Situations that are not emergencies are listed under whatever is already shown.
  const notes = [];
  if (state.cage && !state.ground) {
    notes.push(state.cage.side === "a" ? "你被逼到籠邊！不能後退、易被摔<br>用繞圈脫離（他壓上就逃不掉）" : "他被逼到籠邊！他不能後退，摔他更容易");
  }
  if (state.ground && !lock) {
    notes.push(state.ground.top === "a"
      ? "你在上位：選動作，他來猜<br>穩壓免費、專抓逃脫"
      : "你在下位：猜他的動作<br>撐架剋過位・反制剋砸拳・逃脫剋鎖技");
  }
  if (!state.ground && state.edge && !lock) notes.push(state.edge.side === "a" ? "你佔上風：沒被走位搶走，這手由你帶頭" : "他佔上風：這手他容易帶頭");
  if (isFinal(state)) notes.push("回合最後一手！連段多 1 張，裁判更重視");
  if (notes.length) {
    const body = notes.join("<br>");
    if (el.className === "hidden") {
      el.className = state.cage?.side === "b" ? "swarm" : "note";
      el.innerHTML = body;
    } else el.innerHTML += `<br>${body}`;
  }
  if (el.className !== "hidden") el.classList.toggle("right", state.cage?.side === "a" && !state.ground);
  $("last").style.display = el.className === "hidden" ? "" : "none";
  $("last").innerHTML = lastLine;
}

// ---------- Hand ----------

function selectedCards() {
  return selected.map((i) => state.a.hand[i]);
}

/** The setup line on a card: green when a tag it follows is on, dim when it only could follow, purple when it lays one down. */
function linkHtml(d) {
  const short = (t) => data.rules.tags[t]?.short || t;
  const live = d.follows.find((f) => f.live);
  if (live) return `<div class="lk live">可接 ${short(live.tag)} +${live.bonus}%</div>`;
  if (d.setups.length) return `<div class="lk set">鋪路 ${d.setups.map((st) => short(st.tag)).join("")}</div>`;
  if (d.follows.length) return `<div class="lk">接 ${short(d.follows[0].tag)} +${d.follows[0].bonus}%</div>`;
  return "";
}

/** Hides every tray piece, then the step shows what it needs. */
function clearTray() {
  for (const id of ["fwpanel", "combo", "bets", "counterpick", "pass"]) $(id).classList.add("hidden");
  $("hand").innerHTML = "";
  $("hand").className = "";
  $("basics").classList.add("hidden");
  $("energy").innerHTML = "";
}

function renderHand() {
  clearTray();
  const mode = liveCtx ? "respond" : state.ground ? "ground" : stepOf(state) === "footwork" ? "footwork" : state.engage.leader === "a" ? "lead" : "respond";
  $("tray").dataset.mode = mode;
  $("tray").dataset.pick = mode === "respond" && bet && betNeedsCard ? "1" : "";
  if (mode === "respond") return renderRespond();
  if (mode === "ground") return renderGroundHand();
  return mode === "footwork" ? renderFootwork() : renderLead();
}

// ---------- Footwork ----------

const distShort = (d) => data.rules.dist.names[d];

/** One line on what his step would do, from the preview table. */
function outcomeText(r) {
  const lead = r.pYouLead >= 0.995 ? "你帶頭" : r.pYouLead <= 0.005 ? "他帶頭" : `搶先手 ${Math.round(r.pYouLead * 100)}%`;
  const bits = [lead, distShort(r.dist)];
  if (r.mine.counterSpeed >= 4) bits.push("你反擊快");
  if (r.theirs.counterSpeed >= 4) bits.push("他反擊快");
  if (r.mine.evade >= 0.1) bits.push("你易閃");
  if (r.theirs.evade >= 0.1) bits.push("他易閃");
  if (r.theirs.dmgIn > 1.05) bits.push("他挨打重");
  if (r.mine.dmgIn > 1.05) bits.push("你挨打重");
  if (r.heGivesGround) bits.push("逼他後退");
  if (r.youGiveGround) bits.push("你讓地盤");
  return bits.join(" · ");
}

function renderFootwork() {
  const R = data.rules.footwork;
  const choices = footworkChoices(state, "a");
  if (fwPick && choices.find((c) => c.id === fwPick)?.disabled) fwPick = null;
  const panel = $("fwpanel");
  panel.classList.remove("hidden");
  const buttons = choices.map((c) => `<button class="fwbtn ${fwPick === c.id ? "sel" : ""} ${c.disabled ? "dim" : ""}" data-id="${c.id}" style="--c:${FW_COLORS[c.id]}">
      <b>${c.label}</b><small>${c.disabled ? c.reason : c.desc}</small><i>${c.cost > 0 ? `體力 -${c.cost}` : "回 1 體力"}</i></button>`).join("");
  let chips = '<div class="fwchips"><div class="fwhint">選一個走位，看他各種走位會變成什麼局面</div></div>';
  if (fwPick) {
    const rows = previewFootwork(state, "a", fwPick);
    const intent = getIntent(state, "b");
    chips = `<div class="fwchips">${rows.map((r) => {
      const hidden = intent.blind && r.his !== intent.top;
      return `<div class="fwchip" style="--c:${FW_COLORS[r.his]}"><b>他${R.moves[r.his].label} ${hidden ? "?" : `${Math.round(r.prob * 100)}%`}</b><span>${outcomeText(r)}</span></div>`;
    }).join("")}</div>`;
  }
  panel.innerHTML = chips + `<div class="fwbtns">${buttons}</div>`;
  panel.querySelectorAll(".fwbtn").forEach((el) => el.addEventListener("click", () => {
    if (el.classList.contains("dim")) return;
    fwPick = el.dataset.id;
    renderHand();
  }));
  $("choice").innerHTML = fwPick ? `<b>${R.moves[fwPick].label}</b>：${R.moves[fwPick].desc}` : "每一手先走位：雙方同時選，揭曉後決定誰帶頭、距離變幾格";
  $("energy").innerHTML = `體力 <b>${Math.round(state.a.stamina)}</b>`;
  $("fight").textContent = "走位";
  $("fight").disabled = !fwPick;
}

// ---------- Leading ----------

function tileHtml(i, mode) {
  const c = state.a.hand[i];
  const card = data.cards[c];
  const d = describeCard(state, "a", c);
  const name = card.name.replace(/^招牌[：:]/, "");
  const picked = mode === "lead" && combo.includes(c) && !card.basic;
  const test = mode === "lead" ? comboError(state, "a", [...combo, c]) : null;
  const dim = mode === "lead" && Boolean(test);
  const seen = mode === "lead" && d.seenByFoe ? '<span class="seen" title="他的反應力看得到這招">慢·會被看到</span>' : mode === "lead" && !card.counterOnly ? '<span class="quick">快·看不到</span>' : "";
  return `<button class="tile ${HEIGHT_COLORS[d.height] || ""} ${card.signature ? "signature" : ""} ${picked ? "sel" : ""} ${dim && !picked ? "dim" : ""} ${d.unusable ? "far" : ""}" data-i="${i}">
      <div class="th"><span class="hb">${d.heightName || (card.counterOnly ? "反" : "")}</span><span class="sp">速${d.speed}</span></div>
      <div class="tn">${name}</div>
      <div class="tf">${d.effect}</div>
      ${linkHtml(d)}
      <div class="tr">${d.unusable ? `<span class="bad">要在${d.rangeText || "別的距離"}</span>` : d.rangeText ? `<span>${d.rangeText}</span>` : "<span></span>"}<span>-${Math.round(d.cost)}</span></div>
      ${seen}
    </button>`;
}

function renderLead() {
  const hand = state.a.hand;
  const order = hand.map((c, i) => i).filter((i) => !data.cards[hand[i]].counterOnly);
  order.sort((x, y) => Number(data.cards[hand[x]].basic || 0) - Number(data.cards[hand[y]].basic || 0));
  const pv = previewCombo(state, "a", combo);
  const max = comboMax(state, "a");
  $("hand").className = "tiles";
  $("hand").innerHTML = order.map((i) => tileHtml(i, "lead")).join("");
  $("hand").querySelectorAll(".tile").forEach((el) => el.addEventListener("click", () => onLeadCard(Number(el.dataset.i), el)));
  const combobar = $("combo");
  combobar.classList.remove("hidden");
  const slots = [];
  for (let k = 0; k < max; k++) {
    const c = combo[k];
    slots.push(c ? `<button class="slot full" data-k="${k}">${k + 1} ${data.cards[c].name.replace(/^招牌[：:]/, "")}</button>` : `<span class="slot">${k + 1}</span>`);
  }
  combobar.innerHTML = `<span class="lbl">連段 ${combo.length}/${max}</span>${slots.join('<i>→</i>')}`;
  combobar.querySelectorAll(".slot.full").forEach((el) => el.addEventListener("click", () => {
    combo.splice(Number(el.dataset.k), 1);
    renderHand();
  }));
  const sees = combo.filter((c) => describeCard(state, "a", c).seenByFoe).map((c) => data.cards[c].name);
  const dmg = combo.length ? ` · 全中約 <b>${pv.damage}</b> · 體力 -${pv.cost}${pv.endDist !== state.dist ? ` · 出手後${distShort(pv.endDist)}` : ""}` : "";
  const warn = sees.length ? ` · <span class="bad">慢招他會看到：${sees.join("、")}</span>` : "";
  const reaction = Math.round(reactionOf(state, "b"));
  $("choice").innerHTML = combo.length
    ? `你帶頭：<b>${combo.map((c) => data.cards[c].name).join(" → ")}</b>${dmg}${warn}`
    : `你帶頭：點招式排連段（最多 ${max} 張）· 他的反應力 <b>${reaction}</b>：速度比這低的招他看得到、能當場應對`;
  $("energy").innerHTML = `體力 <b>${pv.stamina}</b> · 連段 ≤ ${max}`;
  $("fight").textContent = "出手";
  $("fight").disabled = !combo.length;
  $("pass").classList.remove("hidden");
  $("pass").textContent = "試探";
}

function onLeadCard(i, el) {
  const c = state.a.hand[i];
  const err = comboError(state, "a", [...combo, c]);
  if (err) {
    el.classList.remove("deny");
    void el.offsetWidth;
    el.classList.add("deny");
    return;
  }
  const card = data.cards[c];
  if (!card.basic && combo.includes(c)) {
    combo = combo.filter((x) => x !== c);
  } else combo.push(c);
  renderHand();
}

// ---------- Responding ----------

function betChoices() {
  const strikers = counterCards(state, "a");
  const rocked = state.a.rocked;
  return ["high", "mid", "low", "cover", "evade", "counter", "shoot", "preempt"].map((id) => {
    let off = "";
    if (rocked && !["high", "mid", "low", "cover"].includes(id)) off = "被打暈";
    else if ((id === "counter" || id === "preempt") && !strikers.length) off = "沒有招能出";
    else if (id === "preempt" && state.a.stamina < data.rules.engage.preempt.cost) off = "體力不夠";
    return { id, label: BET_LABELS[id], hint: BET_HINTS[id], off };
  });
}

function betPlan() {
  if (!bet || bet.kind === "keep") return null;
  if (["high", "mid", "low"].includes(bet.kind)) return { kind: "guard", height: bet.kind };
  if (bet.kind === "counter" || bet.kind === "preempt") return { kind: bet.kind, card: bet.card };
  return { kind: bet.kind };
}

function renderRespond() {
  const live = liveCtx;
  const choices = betChoices();
  if (live) {
    choices.splice(choices.findIndex((c) => c.id === "preempt"), 1, { id: "keep", label: "照原計畫", hint: "不改，照事先押的", off: "" });
  }
  const bar = $("bets");
  bar.classList.remove("hidden");
  bar.innerHTML = choices.map((c) => `<button class="bet ${bet?.kind === c.id ? "sel" : ""} ${c.off ? "dim" : ""}" data-id="${c.id}"><b>${c.label}</b><small>${c.off || c.hint}</small></button>`).join("");
  bar.querySelectorAll(".bet").forEach((el) => el.addEventListener("click", () => {
    if (el.classList.contains("dim")) return;
    const id = el.dataset.id;
    bet = { kind: id };
    betNeedsCard = id === "counter" || id === "preempt";
    if (betNeedsCard) {
      const list = counterCards(state, "a");
      // A counter wants the quickest card that reaches; the pre-emptive strike wants the heaviest. Tap another to change.
      bet.card = id === "counter" ? list.reduce((b, c) => (data.cards[c].speed > data.cards[b].speed ? c : b)) : list.reduce((b, c) => (data.cards[c].power > data.cards[b].power ? c : b));
    }
    renderHand();
  }));
  const pick = $("counterpick");
  if (bet && betNeedsCard) {
    pick.classList.remove("hidden");
    const list = counterCards(state, "a");
    pick.innerHTML = `<span class="lbl">${bet.kind === "counter" ? "用哪一招反擊（越快越能搶先）" : "用哪一招搶先打"}</span>` + list.map((c) => {
      const card = data.cards[c];
      return `<button class="chip ${bet.card === c ? "sel" : ""}" data-c="${c}">${card.name.replace(/^招牌[：:]/, "")}<small>速${Math.round(cardSpeedOf(c))}</small></button>`;
    }).join("");
    pick.querySelectorAll(".chip").forEach((el) => el.addEventListener("click", () => {
      bet.card = el.dataset.c;
      renderHand();
    }));
  }
  const foe = fighterOf("b");
  const intent = getIntent(state, "b");
  const speedNote = `你的反應力 <b>${Math.round(reactionOf(state, "a"))}</b>：他出的招速度比這低你才看得到`;
  const sel = bet ? `<b>${BET_LABELS[bet.kind] || "照原計畫"}</b>${bet.card ? `：${data.cards[bet.card].name}` : ""} — ${BET_HINTS[bet.kind] || "不改，照事先押的"}` : "選你的應對：事先押一個，快招你看不到，只能靠這個";
  $("choice").innerHTML = live ? `他出【${data.cards[live.card].name}】<b>慢招，你看到了！</b>速度 ${live.speed} &lt; 你的反應力 ${live.reaction}：現在選怎麼應對` : `${foe.short}帶頭 · ${sel} · ${speedNote}`;
  $("energy").innerHTML = `體力 <b>${Math.round(state.a.stamina)}</b>`;
  $("fight").textContent = live ? "應對" : "準備";
  $("fight").disabled = !(bet && (!betNeedsCard || bet.card));
}

function cardSpeedOf(c) {
  return describeCard(state, "a", c).speed;
}

// ---------- Mat ----------

function renderGroundHand() {
  const b = budget(state, "a");
  const cards = selectedCards();
  const spent = cards.reduce((sum, c) => sum + cardCost(state, "a", c), 0);
  // Dimmed means clicking it would not add to the current play: wrong position, or not enough energy left.
  const look = (i) => {
    const c = state.a.hand[i];
    const isSel = selected.includes(i);
    const together = playError(state, "a", [...cards, c]);
    const ok = together === null || (REPLACES.includes(together) && playError(state, "a", [c]) === null);
    const d = describeCard(state, "a", c);
    return { card: data.cards[c], d, isSel, affordable: isSel || ok };
  };
  const drawn = state.a.hand.map((c, i) => i);
  $("hand").className = "";
  $("hand").innerHTML = drawn.map((i) => {
    const { card, d, isSel, affordable } = look(i);
    const label = d.action || data.rules.typeNames[card.type];
    const where = d.rangeText;
    const rangeHtml = d.unusable ? `<span class="bad">${d.blocked || `要在${where}`}</span>` : where ? `<span>${where}</span>` : "<span></span>";
    const target = card.target && card.power ? `<span>打${TARGET_NAMES[card.target]}</span>` : "";
    return `<button class="card ${isSel ? "sel" : ""} ${affordable ? "" : "dim"} ${d.unusable ? "far" : ""} ${card.signature ? "signature" : ""}" data-i="${i}">
      <div class="head bg-${card.type}"><span>${label}</span><span class="cost">${"⚡".repeat(d.cost)}</span></div>
      <div class="nm">${card.name}</div>
      <div class="fx">${d.effect}</div>
      ${linkHtml(d)}
      <div class="rng">${rangeHtml}${target}</div>
    </button>`;
  }).join("");
  $("hand").querySelectorAll(".card").forEach((el) => el.addEventListener("click", () => onCard(Number(el.dataset.i), el)));
  let energy = "";
  for (let i = 0; i < b; i++) energy += i < spent ? "⚡" : '<span class="off">⚡</span>';
  $("energy").innerHTML = energy;
  // The free play: the hold on top, covering up underneath. Not an option in a lock fight.
  const free = roleOf(state, "a") === "top" ? ["穩壓", "抓逃脫"] : ["抱頭", "砸拳減半"];
  $("basics").classList.toggle("hidden", Boolean(state.ground?.lock));
  $("brace").innerHTML = `${free[0]}<small>⚡0 ${free[1]}</small>`;
  $("brace").className = bracing ? "sel" : "";
  $("fight").textContent = "出手";
  $("fight").disabled = !(cards.length || (bracing && !state.ground?.lock));
  renderChoice();
}

function renderChoice() {
  const el = $("choice");
  const cards = selectedCards();
  if (!cards.length && !bracing) {
    const mine = fighterOf("a").ability;
    if (state.ground?.lock) el.innerHTML = state.ground.lock.attacker === "a" ? "選一招進攻：被對應的防守擋住就退一階，其餘讓鎖更深" : "選一招防守：猜中他的進攻就退一階，退完就逃脫";
    else el.innerHTML = `地面一手只出一張牌，或用右邊免費的${roleOf(state, "a") === "top" ? "穩壓" : "抱頭"}${mine ? ` · 能力「${mine.name}」` : ""}`;
    return;
  }
  renderGroundChoice(cards);
}

/** What the pick risks on the mat, from the shown tendencies: which of his options beat it, how likely, and what a win does. */
function renderGroundChoice(cards) {
  const el = $("choice");
  const intent = getIntent(state, "b");
  const pct = (id) => (intent.blind && id !== intent.top ? "?" : `${Math.round((intent.probs[id] || 0) * 100)}%`);
  const lock = state.ground.lock;
  if (lock) {
    const l = data.rules.lock;
    const card = data.cards[cards[0]];
    if (card.lockSide === "attack") {
      const answer = l.beats[card.lockMove];
      el.innerHTML = `<b>${card.name}</b>：他若選 <b>${l.defend[answer]} ${pct(answer)}</b> 就被擋下（鎖退一階），其餘讓鎖更深`;
    } else {
      const attack = Object.keys(l.beats).find((k) => l.beats[k] === card.lockMove);
      el.innerHTML = `<b>${card.name}</b>：他若選 <b>${l.attack[attack]} ${pct(attack)}</b> 就猜中，鎖退一階；其餘更深`;
    }
    return;
  }
  const role = roleOf(state, "a");
  const cat = cards.length ? data.cards[cards[0]].cat : role === "top" ? "hold" : "cover";
  const def = data.rules.ground.cats[cat];
  const outcomeFor = (o) => (role === "top" ? groundOutcome(state, cat, o.id) : groundOutcome(state, o.id, cat));
  const live = intent.options.filter((o) => intent.probs[o.id] > 0);
  const losing = live.filter((o) => outcomeFor(o) === (role === "top" ? "bottom" : "top"));
  const winning = live.filter((o) => outcomeFor(o) === role);
  const sum = (list) => list.reduce((a, o) => a + (intent.probs[o.id] || 0), 0);
  const show = (list) => (list.length ? list.map((o) => `${o.label} <b>${pct(o.id)}</b>`).join("、") : "沒有");
  let text = `<b class="t-${def.type}">${def.label}</b>：贏 <b>${intent.blind ? "?" : `${Math.round(sum(winning) * 100)}%`}</b> · 輸給 ${show(losing)}`;
  if (cards.length) {
    const preview = previewPlay(state, "a", cards);
    if (data.cards[cards[0]].power) text += ` · 贏了造成約 <b>${preview.damage}</b> · 爆擊 ${preview.critPct}%`;
    const extra = Math.max(0, preview.cost - 1);
    if (extra) text += ` · 猜錯多吃 ${Math.round(extra * data.rules.damage.overcommitPerEnergy * 100)}%`;
  } else {
    text += role === "top" ? " · 他若逃脫會被抓住、耗體力" : " · 他若砸拳，傷害減半";
  }
  el.innerHTML = text;
}

function onCard(i, el) {
  bracing = false;
  if (selected.includes(i)) {
    selected = selected.filter((x) => x !== i);
    renderHand();
    return;
  }
  const next = [state.a.hand[i]];
  if (playError(state, "a", next)) {
    el.classList.remove("deny");
    void el.offsetWidth;
    el.classList.add("deny");
    return;
  }
  selected = [i];
  renderHand();
}

function onBrace() {
  selected = [];
  bracing = !bracing;
  renderHand();
}

async function onPass() {
  if (state.ground || stepOf(state) !== "lead" || state.engage.leader !== "a" || liveCtx) return;
  combo = [];
  await onEngage();
}

function beginTurn() {
  selected = [];
  bracing = false;
  fwPick = null;
  combo = [];
  bet = null;
  betNeedsCard = false;
  stage.setLayout(state);
  syncShown();
  renderHud();
  renderIntent();
  renderAlert();
  renderHand();
  $("tray").classList.remove("away");
  $("intent").classList.remove("hidden");
  $("reveal").classList.add("hidden");
  $("verdict").classList.add("hidden");
  $("skip").classList.add("hidden");
}


// ---------- Exchange playback ----------

function wait(ms) {
  if (skipping) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      skipWake = null;
      resolve();
    }, ms);
    skipWake = () => {
      clearTimeout(t);
      skipWake = null;
      resolve();
    };
  });
}

function showVerdict(text, sub = "", color = "#fff", big = false) {
  const el = $("verdict");
  el.classList.remove("hidden");
  el.className = big ? "big" : "";
  el.style.color = big ? "" : color;
  el.innerHTML = `${text}${sub ? `<span class="sub">${sub}</span>` : ""}`;
}

function renderReveal(e) {
  const flip = (side) => {
    const names = e[side].map((c) => data.cards[c].name).join(" + ") || "免費";
    const res = e.winner === side ? "win" : e.winner ? "lose" : "";
    const head = e.labels ? e.labels[side] : data.rules.typeNames[e.types[side]];
    return `<div class="flip ${res}"><div class="head bg-${e.types[side]}">${head}</div><div class="body">${names}</div><div class="who">${side === "a" ? "你" : fighterOf("b").short} ${"⚡".repeat(e.cost[side])}</div></div>`;
  };
  $("reveal").innerHTML = flip("a") + flip("b");
  $("reveal").classList.remove("hidden");
}

/** A footwork as a card turned over: its name and what it does. */
function footworkFlip(side, id) {
  const m = data.rules.footwork.moves[id];
  return `<div class="flip"><div class="head" style="background:${FW_COLORS[id]}">${m.label}</div><div class="body">${m.desc}</div><div class="who">${side === "a" ? "你" : fighterOf("b").short}</div></div>`;
}

/** One card of the combo turning over, with how the other man meets it. */
function cardFlip(e) {
  const card = data.cards[e.card];
  const L = e.side;
  const R = L === "a" ? "b" : "a";
  const reply = e.reply;
  const label = { guard: `架${GUARD_WORDS[reply.height] || ""}`, cover: "抱頭", evade: "閃身", counter: `反擊：${data.cards[reply.card]?.name || ""}`, shoot: "抱腿反擊", preempt: "搶先" }[reply.kind] || "";
  const how = e.visible ? "看到了，當場應對" : "事先押的";
  const name = card.name.replace(/^招牌[：:]/, "");
  const mine = `<div class="flip"><div class="head ${HEIGHT_COLORS[card.height] || ""}">${heightWord(card.height)} · 速${e.speed}</div><div class="body">${name}<br><small>第 ${e.index + 1}/${e.of} 張</small></div><div class="who">${nameOf(L)}</div></div>`;
  const answer = `<div class="flip reply"><div class="head" style="background:#4a5470">${label}</div><div class="body"><small>${how}</small></div><div class="who">${nameOf(R)}</div></div>`;
  // Left is always you and right is always him, whoever is throwing the card.
  return L === "a" ? mine + answer : answer + mine;
}
const heightWord = (h) => ({ high: "上段", mid: "中段", low: "下段", grab: "抱摔", feint: "假動作" }[h] || "");

function actionPoseFor(cardId) {
  const card = data.cards[cardId];
  return card?.kick ? "kick" : "punch";
}

/** The close-up: bars slide in, the cage goes dark, the camera pushes in on the fighter and the move's name crashes onto the screen. */
async function signatureIntro(e) {
  const big = e.name.replace(/^招牌[：:]/, "");
  $("verdict").classList.add("hidden");
  $("reveal").classList.add("hidden");
  const el = $("cinema");
  el.querySelector(".signame").innerHTML = `<small>SIGNATURE · ${fighterOf(e.side).short}</small><b>${big}</b>`;
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
  stage.cinema(e.side, 1.45);
  stage.flash(0.35);
  stage.timeScale = 0.45;
  cinematic = true;
  await wait(1050);
  stage.flash(0.2);
}

function endCinema() {
  if (!cinematic) return;
  cinematic = false;
  stage.cinema(null);
  stage.timeScale = 1;
  $("cinema").classList.remove("on");
}

async function playEvents(events) {
  const damageLines = [];
  let verdictLine = "";
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    const next = events[idx + 1];
    switch (e.kind) {
      case "reveal":
        renderReveal(e);
        await wait(720);
        break;
      case "signature":
        await signatureIntro(e);
        break;
      case "glance":
        showVerdict("被擋下一半", `${e.name} 仍然擦中`, "#ffd166");
        await wait(520);
        $("verdict").classList.add("hidden");
        break;
      case "lockResist":
        stage.shake(6);
        showVerdict("撐住了！", `${nameOf(e.side)} 沒被鎖更深（${Math.round(e.chance * 100)}%）`, "#5be49b");
        await wait(680);
        $("verdict").classList.add("hidden");
        break;
      case "verdict": {
        const who = e.winner ? `${nameOf(e.winner)}贏這手` : "互不相讓";
        const color = e.winner === "a" ? "#5be49b" : e.winner === "b" ? "#ff7b7f" : "#fff";
        showVerdict(e.text, who, color);
        verdictLine = `${e.text}（${who}）`;
        await wait(620);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      }
      case "trade":
        break;
      case "hit": {
        const def = e.attacker === "a" ? "b" : "a";
        shown[def].hp = Math.max(0, shown[def].hp - e.damage);
        if (e.chip) {
          stage.recoil(def, 8, 180, "idle");
          if (e.damage > 0) stage.floater(def, `-${e.damage}`, "#9aa4bd", 16);
          renderPanel(def);
          await wait(220);
          break;
        }
        shown[def].pips[e.target] = Math.min(data.rules.debuff.maxPips, shown[def].pips[e.target] + 1);
        const crit = e.tier === "crit";
        const isSig = Boolean(data.cards[e.card]?.signature);
        const dur = isSig ? 620 : crit ? 460 : 340;
        const f = stage.fighters[e.attacker];
        const reach = REACH[viewDist];
        if (f.downed || stage.fighters[def].downed) {
          // On the mat the man on top punches down from his kneeling pose; the man underneath kicks up.
          stage.strike(e.attacker, groundTop() === e.attacker ? "gpunch" : "kick", 12, dur);
        } else {
          stage.strike(e.attacker, actionPoseFor(e.card), reach, dur);
        }
        await wait(dur * 0.42);
        stage.recoil(def, isSig ? 70 : crit ? 34 : 18, dur);
        stage.floater(def, `-${e.damage}${crit || isSig ? "!" : ""}`, crit || isSig ? "#ffd166" : "#ffffff", isSig ? 46 : crit ? 34 : 24);
        if (isSig) {
          stage.hitStop(240);
          stage.shake(30);
          stage.flash(0.75);
        } else if (crit) {
          stage.hitStop(90);
          stage.shake(16);
          stage.flash(0.32);
        } else {
          stage.shake(5);
        }
        renderPanel(def);
        damageLines.push(`${nameOf(e.attacker)} ${e.name} -${e.damage}${crit ? " 爆擊" : ""}`);
        await wait(dur * 0.62);
        break;
      }
      case "rocked":
        shown[e.side].rocked = true;
        renderPanel(e.side);
        stage.stagger(e.side, 700);
        stage.flash(0.2);
        showVerdict("打暈了！", `${nameOf(e.side)} 站不穩`, "#ff9f43");
        await wait(750);
        $("verdict").classList.add("hidden");
        break;
      case "interrupted":
        break;
      case "takedown": {
        stage.strike(e.side, "shoot", 110, 360);
        await wait(300);
        stage.shake(10);
        syncLayout({ ground: { top: e.side, pos: e.pos } });
        showVerdict(`摔倒！${e.name}`, `${nameOf(e.side)}在上位`, "#7cb7ff");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      }
      case "pullGuard":
        syncLayout({ ground: { top: e.side === "a" ? "b" : "a", pos: 0 } });
        showVerdict("拉進防守！", `${nameOf(e.side)}主動到下位`, "#7cb7ff");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      case "clinch":
        stage.strike(e.side, "shoot", 50, 340);
        syncLayout({ dist: data.rules.dist.clinch });
        showVerdict(e.stuffed ? "沒摔倒，貼住了" : "貼身纏住", "進入纏抱", "#7cb7ff");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "ability":
        stage.floater(e.side, `✦ ${e.name}`, "#f5c542", 20);
        await wait(300);
        break;
      case "cage":
        viewCage = e.side;
        shown[e.side].pinned = true;
        renderPanel(e.side);
        syncLayout({});
        stage.shake(6);
        showVerdict(e.how === "push" ? "推籠反轉！" : "被逼到籠邊！", e.how === "push" ? `${nameOf(e.side)} 背靠籠子了` : `${nameOf(e.side)} 不能再後退`, "#ff9f43");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      case "cageEnd":
        viewCage = null;
        shown[e.side].pinned = false;
        renderPanel(e.side);
        syncLayout({});
        if (e.how === "turn") {
          showVerdict("轉身脫離！", `${nameOf(e.side)} 離開籠邊`, "#5be49b");
          await wait(640);
          $("verdict").classList.add("hidden");
        }
        break;
      case "chase":
        showVerdict(e.follow ? "追進地面" : "讓他站起來", e.follow ? `${nameOf(e.side)} 繼續壓制` : `${nameOf(e.side)} 佔上風`, e.follow ? "#7cb7ff" : "#9fe2bf");
        await wait(560);
        $("verdict").classList.add("hidden");
        break;
      case "mark": {
        shown[e.side].marks = [...new Set([...shown[e.side].marks, e.tag])];
        renderPanel(e.side);
        stage.floater(e.side, data.rules.tags[e.tag]?.label || e.tag, "#9be7ff", 20);
        await wait(280);
        break;
      }
      case "range": {
        syncLayout({ dist: e.dist });
        // Clinches, scrambles and stand-ups announce themselves, so this only speaks for a plain step.
        if (!["clinch", "scramble", "standup"].includes(next?.kind)) {
          showVerdict(data.rules.dist.names[e.dist], e.dist > e.from ? "靠近了" : "拉開了", "#7cb7ff");
          await wait(480);
          $("verdict").classList.add("hidden");
        } else {
          await wait(160);
        }
        break;
      }
      case "whiff":
        stage.floater(e.side, "揮空！", "#ffd166", 28);
        showVerdict("揮空！", `${nameOf(e.side)} 的${e.name}打不到`, "#ffd166");
        await wait(640);
        $("verdict").classList.add("hidden");
        break;
      case "cut":
        shown[e.side].cut = e.level;
        stage.setCuts(shown.a.cut, shown.b.cut);
        renderPanel(e.side);
        stage.shake(8);
        showVerdict("割傷！", `${nameOf(e.side)} 流血 Lv${e.level}`, "#ff4d4f");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      case "doctor":
        showVerdict("醫生檢查傷口…", `${nameOf(e.side)} 的傷勢太重`, "#ff4d4f");
        await wait(800);
        $("verdict").classList.add("hidden");
        break;
      case "caught":
        syncLayout({ ground: { top: e.side === "a" ? "b" : "a", pos: 0 } });
        stage.shake(10);
        break;
      case "position":
        syncLayout({ ground: { top: e.top, pos: e.pos } });
        showVerdict(`位置變成：${e.name}`, "", "#7cb7ff");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "sweep":
        syncLayout({ ground: { top: e.side, pos: 0 } });
        stage.shake(10);
        showVerdict("翻過來了！", `${nameOf(e.side)}變成上位`, "#7cb7ff");
        await wait(800);
        $("verdict").classList.add("hidden");
        break;
      case "standup":
        syncLayout({ dist: e.dist });
        showVerdict(e.reason === "referee" ? "裁判叫起" : e.reason === "release" ? "放他起來" : "站起來了", "", "#fff");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "ride":
        showVerdict(e.caught ? "抓住他逃脫！" : e.held ? "被壓住了" : "穩穩壓住", "體力在流失", "#7cb7ff");
        renderPanelsFromState();
        await wait(520);
        $("verdict").classList.add("hidden");
        break;
      case "scramble":
        syncLayout({ dist: data.rules.dist.clinch });
        showVerdict("扭成一團", `${nameOf(e.winner)}稍佔上風`, "#7cb7ff");
        await wait(560);
        $("verdict").classList.add("hidden");
        break;
      case "standoff":
        showVerdict(e.ground ? "互相僵持" : "互相試探", "雙方回體力", "#9fe2bf");
        await wait(480);
        $("verdict").classList.add("hidden");
        break;
      case "referee":
        showVerdict("裁判：動起來！", "雙方氣勢下降", "#fff");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "lockStart":
        stage.shake(8);
        viewLock = e.attacker;
        syncLayout({ ground: viewGround || (state.ground && { top: state.ground.top, pos: state.ground.pos }) });
        showVerdict(`${e.name}！`, `${nameOf(e.attacker)} 鎖住了 · 第 ${e.depth} 階`, "#ff7b7f");
        await wait(800);
        $("verdict").classList.add("hidden");
        break;
      case "lockDeepen":
        stage.shake(10);
        showVerdict("越鎖越深", `${e.name} · 第 ${e.depth} 階${e.depth >= data.rules.lock.tapDepth - 1 ? "，再錯就拍墊" : ""}`, "#ff7b7f");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      case "lockEase":
        showVerdict("鬆了一階", `${e.name} · 回到第 ${e.depth} 階`, "#9fe2bf");
        await wait(700);
        $("verdict").classList.add("hidden");
        break;
      case "stopped":
        stage.pose(e.side, "gup", 420);
        showVerdict(data.rules.ground.wins[e.by] || "擋下了", `${nameOf(e.side)} 猜中了`, "#5be49b");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "lockEscape":
        viewLock = null;
        syncLayout({ ground: viewGround });
        stage.flash(0.15);
        showVerdict("掙脫了！", `${nameOf(e.side)} 逃出 ${e.name}`, "#5be49b");
        await wait(720);
        $("verdict").classList.add("hidden");
        break;
      case "tap":
        stage.flash(0.3);
        break;
      case "footwork":
        $("reveal").innerHTML = footworkFlip("a", e.a) + footworkFlip("b", e.b);
        $("reveal").classList.remove("hidden");
        showVerdict(e.text.length > 20 ? "走位揭曉" : e.text, e.text.length > 20 ? e.text : "", "#9be7ff");
        await wait(1100);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "lead": {
        const sub = e.chance === null ? "走位決定了誰先出手" : `搶先手：你 ${Math.round((e.side === "a" ? e.chance : 1 - e.chance) * 100)}%`;
        showVerdict(`${nameOf(e.side)}帶頭`, e.edge ? `${sub} · 上一手的優勢` : sub, e.side === "a" ? "#5be49b" : "#ff7b7f");
        shown.a.leader = e.side === "a";
        shown.b.leader = e.side === "b";
        renderPanel("a");
        renderPanel("b");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      }
      case "engage":
        if (e.n === 0) {
          showVerdict(`${nameOf(e.leader)}沒有出手`, "試探一下", "#9fe2bf");
          await wait(420);
          $("verdict").classList.add("hidden");
        }
        break;
      case "card":
        $("reveal").innerHTML = cardFlip(e);
        $("reveal").classList.remove("hidden");
        await wait(e.visible ? 760 : 620);
        break;
      case "block":
        stage.recoil(e.side, 10, 220, "idle");
        stage.floater(e.side, "擋住!", "#5be49b", 24);
        showVerdict("擋住了！", `${nameOf(e.side)}架${GUARD_WORDS[e.height]}，連段中斷`, "#5be49b");
        await wait(640);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "evade":
        stage.recoil(e.side, 30, 300, "idle");
        stage.floater(e.side, "閃開!", "#5be49b", 26);
        showVerdict("閃開了！", `${nameOf(e.side)}閃過去（機會 ${Math.round(e.chance * 100)}%），對方露出破綻`, "#5be49b");
        await wait(700);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "evadeFail":
        stage.floater(e.side, "沒閃掉", "#ffd166", 20);
        await wait(240);
        break;
      case "counter":
        showVerdict(e.catch ? "勒住他的脖子" : e.first ? "反擊搶先！" : "反擊太慢", e.catch ? "他抱腿，斷頭台等著" : `${e.name}（${e.speed} 對 ${e.vs}）`, e.first ? "#5be49b" : "#ffd166");
        stage.strike(e.side, data.cards[e.card]?.kick ? "kick" : "punch", REACH[viewDist] || 40, 300);
        await wait(e.first ? 620 : 520);
        $("verdict").classList.add("hidden");
        break;
      case "counterWrong":
        stage.floater(e.side, "反錯了", "#ffd166", 20);
        await wait(320);
        break;
      case "interrupted":
        stage.stagger(e.side, 360);
        showVerdict("被打斷！", `${nameOf(e.side)}的連段中斷，主動權易手`, "#ff9f43");
        await wait(640);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "preempt":
        showVerdict("搶先出手！", `${nameOf(e.side)}用${e.name}搶在前面`, "#f5c542");
        stage.strike(e.side, data.cards[e.card]?.kick ? "kick" : "punch", REACH[viewDist] || 40, 320);
        await wait(640);
        $("verdict").classList.add("hidden");
        break;
      case "shoot":
        stage.strike(e.side, "shoot", 90, 340);
        showVerdict(e.caught ? "抱腿反擊！" : "抱腿失敗", e.caught ? `${nameOf(e.side)}鑽進慢招的空檔` : `${nameOf(e.side)}撞上快招`, e.caught ? "#7cb7ff" : "#ffd166");
        await wait(640);
        $("verdict").classList.add("hidden");
        break;
      case "sprawl":
        stage.floater(e.side, "壓低重心", "#7cb7ff", 18);
        await wait(300);
        break;
      case "feintWin":
        stage.floater(e.side === "a" ? "b" : "a", "上當了!", "#ffd166", 24);
        showVerdict("假動作成功！", `${nameOf(e.side === "a" ? "b" : "a")}吃了假動作，下一招更容易中`, "#f5c542");
        await wait(700);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "feintWasted":
        stage.floater(e.side, "假動作沒用", "#9aa4bd", 16);
        await wait(300);
        break;
      case "comboDone":
        showVerdict("連段打完！", `${e.n} 張全部出手 · ${nameOf(e.side)}掌握主動，對手體力在掉`, "#f5c542");
        await wait(640);
        $("reveal").classList.add("hidden");
        $("verdict").classList.add("hidden");
        break;
      case "finish":
        await playFinish(e);
        break;
      case "roundEnd":
        break;
      default:
        break;
    }
  }
  if (verdictLine) {
    const detail = damageLines.length ? `<br>${damageLines.slice(-2).join("<br>")}` : "";
    lastLine = `<b>上一手：${verdictLine}</b>${detail}`;
  }
}

function renderPanelsFromState() {
  for (const s of ["a", "b"]) shown[s].stamina = state[s].stamina;
  renderPanel("a");
  renderPanel("b");
}

function syncLayout(view) {
  if (!view.ground) viewDist = view.dist ?? viewDist;
  viewGround = view.ground ? { top: view.ground.top, pos: view.ground.pos } : null;
  if (!viewGround) viewLock = null;
  const full = { dist: viewDist, ground: viewGround && { ...viewGround, lock: viewLock }, cage: viewCage };
  stage.setLayout(full);
  const el = $("center-bar").querySelector(".place");
  if (el) el.innerHTML = placeText(full);
}

async function playFinish(e) {
  if (e.method === "DEC") return;
  const loser = e.winner === "a" ? "b" : "a";
  stage.timeScale = 0.35;
  stage.flash(0.5);
  stage.shake(20);
  stage.hitStop(160);
  await wait(260);
  stage.fall(loser);
  stage.victory(e.winner);
  showVerdict(e.method === "SUB" ? "TAP!" : e.method, e.reason === "doctor" ? "醫生叫停比賽" : "", "", true);
  await wait(1200);
  stage.timeScale = 1;
  $("verdict").classList.add("hidden");
}

async function onFight() {
  if ($("fight").disabled) return;
  if (liveCtx) return answerLive();
  if (state.ground) return onGroundFight();
  return stepOf(state) === "footwork" ? onFootwork() : onEngage();
}

/** Hides the tray and starts a playback. */
function beginPlayback() {
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  $("alert").className = "hidden";
  $("last").innerHTML = "";
  $("skip").classList.remove("hidden");
  skipping = false;
}

/** Everything a hand leaves behind once it has played: a choice to follow him down, the corner, the result, or the next hand. */
async function afterHand() {
  endCinema();
  if (state.pending) await settleChase();
  stage.timeScale = 1;
  $("skip").classList.add("hidden");
  $("reveal").classList.add("hidden");
  $("verdict").classList.add("hidden");
  syncShown();
  if (state.phase === "corner") showCorner();
  else if (state.phase === "over") showResult();
  else beginTurn();
}

/** Step one of a stand-up hand: both pick a footwork, it plays out, and then the lead is settled. */
async function onFootwork() {
  const mine = fwPick;
  const his = chooseFootwork(state, "b");
  const distBefore = state.dist;
  const cageBefore = state.cage?.side ?? null;
  const events = resolveFootwork(state, mine, his);
  beginPlayback();
  viewDist = distBefore;
  viewCage = cageBefore;
  viewGround = null;
  viewLock = null;
  stage.setLayout({ dist: distBefore, cage: cageBefore });
  await playEvents(events);
  stage.timeScale = 1;
  $("skip").classList.add("hidden");
  $("reveal").classList.add("hidden");
  $("verdict").classList.add("hidden");
  syncShown();
  beginTurn();
}

/** Step two: the leader's combo against the other man's bet, a card at a time. A card he can see coming asks the human responder for an answer. */
async function onEngage() {
  const E = state.engage;
  const iLead = E.leader === "a";
  const comboCards = iLead ? combo.slice() : chooseCombo(state, "b");
  const plan = iLead ? choosePlan(state, "b") : betPlan();
  beginPlayback();
  viewDist = state.dist;
  viewCage = state.cage?.side ?? null;
  viewGround = null;
  viewLock = null;
  stage.setLayout({ dist: state.dist, cage: viewCage });
  let events = engageStart(state, comboCards, plan);
  await playEvents(events);
  while (state.engage) {
    const w = engageWaiting(state);
    let reaction = null;
    if (w?.visible) reaction = iLead ? chooseReaction(state, "b", w) : await askReaction(w);
    events = engageStep(state, reaction);
    await playEvents(events);
  }
  await afterHand();
}

let liveCtx = null; // a card the human can see coming: the answer is being asked for
let liveResolve = null;

/** A slow card turns over and he can see it: the tray comes back for one answer. */
function askReaction(w) {
  return new Promise((resolve) => {
    $("skip").classList.add("hidden");
    liveCtx = w;
    liveResolve = resolve;
    bet = null;
    betNeedsCard = false;
    syncShown();
    renderHud();
    renderHand();
    $("tray").classList.remove("away");
  });
}

function answerLive() {
  const plan = bet?.kind === "keep" ? null : betPlan();
  const resolve = liveResolve;
  liveCtx = null;
  liveResolve = null;
  bet = null;
  betNeedsCard = false;
  $("tray").classList.add("away");
  $("skip").classList.remove("hidden");
  resolve(plan);
}

/** One exchange on the mat: pick a card, or the free option. A human whose lock is about to sink holds on with a timing bar. */
async function onGroundFight() {
  const cards = selectedCards();
  const ai = chooseAI(state, "b").cards;
  const groundBefore = { ...state.ground };
  const opts = {};
  if (state.ground.lock?.attacker === "b" && lockGuessWrong(state, cards, ai)) {
    $("tray").classList.add("away");
    $("intent").classList.add("hidden");
    opts.resist = await askResist(lockResistChance(state));
  }
  const events = resolveExchange(state, cards, ai, opts);
  beginPlayback();
  // Keep showing the situation as it was until the playback moves it.
  viewDist = state.dist;
  viewCage = null;
  viewGround = { top: groundBefore.top, pos: groundBefore.pos };
  viewLock = groundBefore.lock?.attacker ?? null;
  stage.setLayout({ dist: state.dist, ground: { ...viewGround, lock: viewLock }, cage: null });
  await playEvents(events);
  await afterHand();
}


/** The reaction game: a needle sweeps the bar and the green zone is the chance to hold on. Stop it inside the zone. */
function askResist(chance) {
  return new Promise((resolve) => {
    const box = $("resist");
    const width = Math.round(chance * 100);
    const left = Math.round(Math.random() * (100 - width));
    box.classList.remove("hidden");
    box.innerHTML = `<div class="box">
      <h2>鎖要更深了！撐住！</h2>
      <div class="note">指針經過綠區時按下（綠區 ${width}% 就是你撐住的機率）</div>
      <div class="track"><div class="zone" style="left:${left}%;width:${width}%"></div><div class="needle"></div></div>
      <div class="res"></div>
      <button class="hit">撐！</button>
    </div>`;
    const needle = box.querySelector(".needle");
    const start = performance.now();
    const sweep = 1000; // one way across, in ms
    let pos = 0;
    let done = false;
    const frame = (now) => {
      if (done) return;
      const t = ((now - start) % (2 * sweep)) / sweep;
      pos = t < 1 ? t : 2 - t;
      needle.style.left = `${pos * 100}%`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const stop = async () => {
      if (done) return;
      done = true;
      const ok = pos * 100 >= left && pos * 100 <= left + width;
      const res = box.querySelector(".res");
      res.textContent = ok ? "撐住了！" : "沒撐住…";
      res.style.color = ok ? "#5be49b" : "#ff7b7f";
      box.querySelector(".hit").disabled = true;
      await new Promise((r) => setTimeout(r, 650));
      box.classList.add("hidden");
      resolve(ok);
    };
    box.querySelector(".hit").addEventListener("click", stop);
  });
}

function tacticButtons(selected) {
  return Object.entries(data.rules.tactics).map(([id, t]) => `<button class="tac ${id === selected ? "on" : ""}" data-id="${id}">${t.label}<small>${t.desc}</small></button>`).join("");
}

/** Before round one: choose a plan, then `done(id)` starts the fight. */
function askTactic(title, note, selected, done) {
  const box = $("overlay");
  box.classList.remove("hidden");
  let plan = selected || state.a.tactic;
  box.innerHTML = `<div class="sheet">
    <h2>${title}</h2>
    <div class="note">${note}</div>
    <div class="tactics">${tacticButtons(plan)}</div>
    <div class="opts"><button class="opt primary" id="go">上場</button></div>
  </div>`;
  box.querySelectorAll(".tac").forEach((el) => el.addEventListener("click", () => {
    plan = el.dataset.id;
    box.querySelectorAll(".tac").forEach((t) => t.classList.toggle("on", t === el));
  }));
  $("go").addEventListener("click", () => {
    box.classList.add("hidden");
    done(plan);
  });
}

/** The banner at the start of a round: his plan, whether he changed it, and yours. */
function announceRound() {
  const him = data.rules.tactics[state.b.tactic];
  const you = data.rules.tactics[state.a.tactic];
  const line = state.round === 1 ? `他的打法：${him.label}` : state.b.tacticChanged ? `他換打法了：${him.label}` : `他維持打法：${him.label}`;
  const el = $("banner");
  el.className = state.b.tacticChanged ? "changed" : "";
  el.innerHTML = `<b>第 ${state.round} 回合</b><span>${line}</span><small>你的戰術：${you.label}</small>`;
  void el.offsetWidth;
  el.classList.add("show");
}

/** After a takedown: you choose whether to follow him down; the AI chooses for itself. Then the rest plays out. */
async function settleChase() {
  const side = state.pending.side;
  syncShown();
  renderPanelsFromState();
  const choice = side === "a" ? await askChase() : chooseChase(state, "b");
  await playEvents(resolvePending(state, choice));
}

function askChase() {
  return new Promise((resolve) => {
    const box = $("overlay");
    box.classList.remove("hidden");
    box.classList.add("lite");
    box.innerHTML = `<div class="sheet small">
      <h2>摔倒他了！</h2>
      <div class="note">追進地面，還是讓他站起來？</div>
      <div class="opts">
        <button class="opt primary" data-c="follow">追進地面<small>繼續壓制、找機會上鎖</small></button>
        <button class="opt" data-c="release">讓他站起來<small>回到近距離，你的下兩手爆擊率 +${Math.round((data.rules.tags[data.rules.chase.tag].crit || 0) * 100)}%</small></button>
      </div>
    </div>`;
    box.querySelectorAll(".opt").forEach((el) => el.addEventListener("click", () => {
      box.classList.add("hidden");
      box.classList.remove("lite");
      resolve(el.dataset.c);
    }));
  });
}

// ---------- Between rounds and the end ----------

function judgeTotals() {
  const judges = data.rules.score.judges;
  return judges.map((j, i) => ({
    name: j.name,
    a: state.roundCards.reduce((sum, r) => sum + r.judges[i].a, 0),
    b: state.roundCards.reduce((sum, r) => sum + r.judges[i].b, 0),
  }));
}

function showCorner() {
  stage.setLayout(state);
  syncShown();
  renderHud();
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  $("alert").className = "hidden";
  const card = state.roundCards[state.roundCards.length - 1];
  const names = data.rules.score.judges.map((j) => j.name);
  const judges = card.judges.map((j, i) => `<div class="judge">${names[i]}<b>${j.a} - ${j.b}</b></div>`).join("");
  const wins = card.judges.filter((j) => j.a > j.b).length;
  const head = wins >= 2 ? "這回合你領先" : card.judges.filter((j) => j.b > j.a).length >= 2 ? "這回合你落後" : "這回合很接近";
  const opts = data.rules.corner.options.map((o) => `<button class="opt" data-id="${o.id}">${o.label}<small>${o.desc}</small></button>`).join("");
  let plan = state.a.tactic;
  const box = $("overlay");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="sheet">
    <h2>第 ${card.round} / ${state.rounds} 回合結束：${head}</h2>
    <div class="judges">${judges}</div>
    <div class="note">下一回合的戰術（他會依比分和體力換打法）</div>
    <div class="tactics">${tacticButtons(plan)}</div>
    <div class="note">角落時間：選一件事，再上場</div>
    <div class="opts">${opts}</div>
  </div>`;
  box.querySelectorAll(".tac").forEach((el) => el.addEventListener("click", () => {
    plan = el.dataset.id;
    box.querySelectorAll(".tac").forEach((t) => t.classList.toggle("on", t === el));
  }));
  box.querySelectorAll(".opt").forEach((el) => el.addEventListener("click", () => {
    applyCorner(state, { a: el.dataset.id, b: chooseCorner(state, "b") }, { a: plan });
    box.classList.add("hidden");
    beginTurn();
    announceRound();
  }));
}

function showResult() {
  const o = state.over;
  renderHud();
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  $("alert").className = "hidden";
  const youWon = o.winner === "a";
  const title = o.winner === null ? "平手" : youWon ? "你贏了" : `${fighterOf("b").short} 贏了`;
  const method = o.method === "DEC" ? o.decision : o.method === "SUB" ? "降伏" : o.reason === "doctor" ? "TKO · 醫生叫停" : o.method;
  const detail = o.method === "DEC" ? `打滿 ${state.rounds} 回合` : `第 ${o.round} 回合第 ${o.exchange} 手`;
  const totals = o.totals || (state.roundCards.length ? judgeTotals() : null);
  const judges = o.method === "DEC" && totals ? `<div class="judges">${totals.map((t) => `<div class="judge">${t.name}<b>${t.a} - ${t.b}</b></div>`).join("")}</div>` : "";
  const box = $("overlay");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="sheet">
    <h2>${title}</h2>
    <div class="big">${method}</div>
    <div class="note">${detail} · 種子 ${state.seed}</div>
    ${judges}
    <div class="opts">
      <button class="opt primary" id="again">再打一場</button>
      <button class="opt" id="change">換選手</button>
    </div>
  </div>`;
  $("again").addEventListener("click", () => {
    box.classList.add("hidden");
    startMatch();
  });
  $("change").addEventListener("click", () => {
    box.classList.add("hidden");
    renderSelect();
  });
}

boot();
