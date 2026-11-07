// Screens, HUD and exchange playback. All rules come from engine.js; this file only shows them.
import { loadData, createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, chooseChase, resolvePending, setTactic, isFinal, getIntent, budget, previewPlay, describeCard, playError, lockStatus, lockResistChance, lockGuessWrong, groundOutcome, roleOf, cardCost } from "./engine.js";
import { Stage, loadAssets, REACH } from "./stage.js";

const $ = (id) => document.getElementById(id);
const TYPES = ["S", "G", "C"];
const ATTR_LABELS = [["power", "力量"], ["accuracy", "精準"], ["wrestling", "摔角"], ["grappleDef", "防摔"], ["submission", "柔術"], ["chin", "下巴"], ["cardio", "體能"]];
const TARGET_NAMES = { head: "頭", body: "身", legs: "腿" };
/** Reasons a second card cannot join the play, in which case clicking it starts a new play instead. */
const REPLACES = ["mixed types", "fence cards go alone", "one card on the ground"];

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
  $("step-in").addEventListener("click", () => onStep("step_in", $("step-in")));
  $("step-back").addEventListener("click", () => onStep("step_back", $("step-back")));
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
  if (c.moveOnly) fx = c.move > 0 ? `進 ${c.move} 格` : `退 ${-c.move} 格`;
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
  return { name: c.name.replace(/^招牌：/, ""), type: c.type, cost: c.cost ?? 1, fx };
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
          <div class="a-phys">${f.height}cm · ${f.weight}lb (${weightName(f.weight)}) · 擅長${preferRangeText(f)}</div>
        </div>
      </div>
      <div class="a-sum">${f.summary}</div>
      <div class="a-perks">
        ${f.ability ? `<div class="a-perk"><b>⚡ ${f.ability.name}</b>：${f.ability.desc}</div>` : ""}
        <div class="a-perk sig"><b>★ 招牌・${sig.name}</b> (<span class="t-${sig.type}">${data.rules.typeNames[sig.type]} ${sig.cost}⚡</span>)：${sig.fx}</div>
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
        <span class="sel-rule"><i class="t-S">打擊</i>克<i class="t-G">摔抱</i> · <i class="t-G">摔抱</i>克<i class="t-C">防反</i> · <i class="t-C">防反</i>克<i class="t-S">打擊</i></span>
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
    shown[s] = { hp: me.hp, stamina: me.stamina, momentum: me.momentum, rocked: me.rocked, cut: me.cut, pips: { ...me.pips }, marks: Object.keys(me.marks), pinned: state.cage?.side === s, tactic: me.tactic };
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
  const legHurt = v.pips.legs >= data.rules.debuff.threshold ? `<span class="tag leg">腿傷·步+${data.rules.debuff.legMoveCost}⚡</span>` : "";
  const plan = v.tactic ? `<span class="tag tc" title="${data.rules.tactics[v.tactic].desc}">${data.rules.tactics[v.tactic].short}</span>` : "";
  const pinned = v.pinned ? '<span class="tag cage">背靠籠邊</span>' : "";
  const markChips = v.marks.map((t) => `<span class="tag mk">${data.rules.tags[t]?.short || t}</span>`).join("");
  const el = $(`panel-${side}`);
  const pctOf = (hp) => (hp / state.maxHp) * 100;
  const prevGhost = el.dataset.hp ? Number(el.dataset.hp) : v.hp;
  el.dataset.hp = v.hp;
  el.innerHTML = `
    ${portraitHtml(f === undefined ? "" : state[side].id)}
    <div class="stats">
      <div class="nameline">${side === "a" ? "你 · " : ""}${f.short}${v.rocked ? '<span class="tag">被打暈</span>' : ""}${v.cut ? `<span class="tag bleed">流血 Lv${v.cut}</span>` : ""}${plan}${pinned}${legHurt}${markChips}<span class="pips">${pips}</span></div>
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

function renderIntent() {
  const intent = getIntent(state, "b");
  // One slim bar under his panel: the shares side by side. With blood in your eyes only the likeliest shows; the others read "?".
  const opts = intent.ground ? intent.options : TYPES.map((t) => ({ id: t, label: data.rules.typeNames[t], type: t }));
  const n = opts.filter((o) => intent.probs[o.id] > 0).length;
  const segs = opts.filter((o) => intent.probs[o.id] > 0 || !intent.ground).map((o) => {
    const hidden = intent.blind && o.id !== intent.top;
    const p = Math.round(intent.probs[o.id] * 100);
    const width = hidden ? 8 : intent.blind ? 100 - 8 * (n - 1) : p;
    return `<span class="seg bg-${o.type} ${hidden ? "hide" : ""}" style="flex:${Math.max(width, 1)}">${o.label} ${hidden ? "?" : `${p}%`}</span>`;
  }).join("");
  const sig = intent.signatureReady ? '<b class="sig">⚡招牌</b>' : "";
  const note = intent.blind ? "血流進眼睛，只看得清最可能的出招" : intent.tags.length ? intent.tags.join("・") : intent.tell;
  $("intent").title = intent.tell;
  $("intent").innerHTML = `<div class="bar3">${segs}${sig}</div><div class="note1">${note}</div>`;
  $("intent").classList.remove("hidden");
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
    el.innerHTML = `你被打暈了！<br>這手只有 1 能量，撐過去`;
  } else if (state.b.rocked) {
    el.className = "swarm";
    el.innerHTML = `他被打暈了！追擊！<br>多 1 能量，傷害 +25%`;
  }
  // Situations that are not emergencies are listed under whatever is already shown.
  const notes = [];
  if (state.cage && !state.ground) {
    notes.push(state.cage.side === "a" ? "你被逼到籠邊！不能後退、易被摔<br>用推籠或轉身脫離" : "他被逼到籠邊！他不能後退，摔他更容易");
  }
  if (state.ground && !lock) {
    notes.push(state.ground.top === "a"
      ? "你在上位：選動作，他來猜<br>穩壓免費、專抓逃脫"
      : "你在下位：猜他的動作<br>撐架剋過位・反制剋砸拳・逃脫剋鎖技");
  }
  if (isFinal(state)) notes.push("回合最後一手！雙方 +1 能量，裁判更重視");
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

function renderHand() {
  const b = budget(state, "a");
  const cards = selectedCards();
  const spent = cards.reduce((sum, c) => sum + cardCost(state, "a", c), 0);
  // Dimmed means clicking it would not add to the current play: wrong distance, or not enough energy left.
  const look = (i) => {
    const c = state.a.hand[i];
    const isSel = selected.includes(i);
    // Clicking a card that does not go with the current play starts a new play with it, so only the alone check matters then.
    const together = playError(state, "a", [...cards, c]);
    const ok = together === null || (REPLACES.includes(together) && playError(state, "a", [c]) === null);
    const d = describeCard(state, "a", c);
    // A card out of range now may still be thrown after the step that comes with it.
    if (d.unusable && cards.length && !isSel && together === null) d.unusable = false;
    return { card: data.cards[c], d, isSel, affordable: isSel || ok };
  };
  const drawn = state.a.hand.map((c, i) => i).filter((i) => !data.cards[state.a.hand[i]].basic);
  const fence = state.a.hand.map((c, i) => i).filter((i) => data.cards[state.a.hand[i]].cageOnly);
  $("cagebtns").innerHTML = fence.map((i) => {
    const { card, d, isSel, affordable } = look(i);
    return `<button class="cg bg-${card.type} ${isSel ? "sel" : ""} ${affordable ? "" : "dim"}" data-i="${i}">${card.name}<small>${"⚡".repeat(d.cost)} ${d.effect}</small></button>`;
  }).join("");
  $("cagebtns").querySelectorAll(".cg").forEach((el) => el.addEventListener("click", () => onCard(Number(el.dataset.i), el)));
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
  const mat = Boolean(state.ground);
  const fixed = mat ? [] : [["step_in", $("step-in"), "前進"], ["step_back", $("step-back"), "後退"]];
  for (const el of [$("step-in"), $("step-back")]) el.classList.toggle("hidden", mat);
  for (const [id, el, label] of fixed) {
    const i = state.a.hand.indexOf(id);
    const { isSel, affordable } = look(i);
    const dc = describeCard(state, "a", id);
    el.innerHTML = `${label}<small>${dc.blocked || "⚡".repeat(dc.cost)}</small>`;
    el.className = `${isSel ? "sel" : ""} ${affordable ? "" : "dim"}`;
  }
  // The free play: bracing on his feet, the hold on top, covering up underneath. Not an option in a lock fight.
  const free = mat ? (roleOf(state, "a") === "top" ? ["穩壓", "抓逃脫"] : ["抱頭", "砸拳減半"]) : ["硬撐", "⚡0"];
  $("brace").innerHTML = `${free[0]}<small>${mat ? `⚡0 ${free[1]}` : free[1]}</small>`;
  $("brace").className = bracing ? "sel" : "";
  $("brace").classList.toggle("hidden", Boolean(state.ground?.lock));
  $("fight").disabled = !(cards.length || (bracing && !state.ground?.lock));
  renderChoice();
}

function renderChoice() {
  const el = $("choice");
  const cards = selectedCards();
  if (!cards.length && !bracing) {
    const mine = fighterOf("a").ability;
    if (state.ground?.lock) el.innerHTML = state.ground.lock.attacker === "a" ? "選一招進攻：被對應的防守擋住就退一階，其餘讓鎖更深" : "選一招防守：猜中他的進攻就退一階，退完就逃脫";
    else if (state.ground) el.innerHTML = `地面一手只出一張牌，或用右邊免費的${roleOf(state, "a") === "top" ? "穩壓" : "抱頭"}${mine ? ` · 能力「${mine.name}」` : ""}`;
    else el.innerHTML = `選牌：同一類可多張；前進／後退可搭配出手（先移動再出牌）${mine ? ` · 能力「${mine.name}」` : ""}`;
    return;
  }
  if (state.ground) {
    renderGroundChoice(cards);
    return;
  }
  const preview = previewPlay(state, "a", cards);
  const t = preview.type;
  const tri = data.rules.triangle;
  const beats = tri[t];
  const losesTo = TYPES.find((x) => tri[x] === t);
  const intent = getIntent(state, "b");
  const probs = intent.probs;
  const pct = (x) => (intent.blind && x !== intent.top ? "?" : `${Math.round(probs[x] * 100)}%`);
  const n = data.rules.typeNames;
  const extra = Math.max(0, preview.cost - 1);
  const rate = t === "G" ? data.rules.damage.shootOvercommit : data.rules.damage.overcommitPerEnergy;
  const risk = extra ? ` · 猜錯多吃 ${Math.round(extra * rate * 100)}%` : "";
  const hurts = cards.some((c) => data.cards[c].power);
  const dmg = !hurts ? "" : ` · 贏了造成約 <b>${preview.damage}</b> · 爆擊 ${preview.critPct}%`;
  const moves = preview.endDist !== null && preview.endDist !== state.dist ? ` · 出手後 <b>${data.rules.dist.names[preview.endDist]}</b>` : "";
  const seq = preview.order.length > 1 && preview.order.some((c) => data.cards[c].moveOnly) ? `<b>${preview.order.map((c) => data.cards[c].name).join(" → ")}</b> · ` : "";
  el.innerHTML = `${seq}<b class="t-${t}">${n[t]}</b>：贏 ${n[beats]} <b>${pct(beats)}</b> · 平 ${n[t]} <b>${pct(t)}</b> · 輸 ${n[losesTo]} <b>${pct(losesTo)}</b>${dmg}${moves}${risk}`;
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
  const card = data.cards[state.a.hand[i]];
  bracing = false;
  if (selected.includes(i)) {
    selected = selected.filter((x) => x !== i);
    renderHand();
    return;
  }
  let next = [...selected, i].map((x) => state.a.hand[x]);
  const together = playError(state, "a", next);
  if (REPLACES.includes(together)) {
    selected = [];
    next = [state.a.hand[i]];
  }
  if (playError(state, "a", next)) {
    if (playError(state, "a", [state.a.hand[i]])) {
      el.classList.remove("deny");
      void el.offsetWidth;
      el.classList.add("deny");
      return;
    }
    selected = [i];
  } else {
    selected = [...selected, i];
  }
  renderHand();
}

function onStep(id, el) {
  const i = state.a.hand.indexOf(id);
  if (i >= 0) onCard(i, el);
}

function onBrace() {
  selected = [];
  bracing = !bracing;
  renderHand();
}

function beginTurn() {
  selected = [];
  bracing = false;
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
  const cards = selectedCards();
  const ai = chooseAI(state, "b").cards;
  const distBefore = state.dist;
  const cageBefore = state.cage?.side ?? null;
  const groundBefore = state.ground ? { ...state.ground } : null;
  // A human whose lock is about to sink gets to hold on with a timing bar; the AI is rolled by the engine.
  const opts = {};
  if (state.ground?.lock?.attacker === "b" && lockGuessWrong(state, cards, ai)) {
    $("tray").classList.add("away");
    $("intent").classList.add("hidden");
    opts.resist = await askResist(lockResistChance(state));
  }
  const events = resolveExchange(state, cards, ai, opts);
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  $("alert").className = "hidden";
  $("last").innerHTML = "";
  $("skip").classList.remove("hidden");
  skipping = false;
  // Keep showing the situation as it was until the playback moves it.
  viewDist = distBefore;
  viewCage = cageBefore;
  viewGround = groundBefore ? { top: groundBefore.top, pos: groundBefore.pos } : null;
  viewLock = groundBefore?.lock?.attacker ?? null;
  stage.setLayout({ dist: distBefore, ground: viewGround && { ...viewGround, lock: viewLock }, cage: cageBefore });
  await playEvents(events);
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
