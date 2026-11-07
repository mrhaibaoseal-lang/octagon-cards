// Screens, HUD and exchange playback. All rules come from engine.js; this file only shows them.
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, budget, previewPlay, describeCard, playError, lockTapChance, phaseOf } from "./engine.js";
import { Stage, loadAssets, REACH } from "./stage.js";

const $ = (id) => document.getElementById(id);
const TYPES = ["S", "G", "C"];
const ATTR_LABELS = [["power", "力量"], ["accuracy", "精準"], ["wrestling", "摔角"], ["grappleDef", "防摔"], ["submission", "柔術"], ["chin", "下巴"], ["cardio", "體能"]];
const TARGET_NAMES = { head: "頭", body: "身", legs: "腿" };

let data;
let assets;
let stage;
let state = null;
let selected = []; // indices into the hand
let bracing = false;
let shown = null; // HUD values during playback, which trail the engine state
let picks = { a: "mcgregor", b: "khabib" };
let skipping = false;
let skipWake = null;
let lastLine = "";
let viewDist = 1; // the distance as the screen currently shows it, which trails the engine during playback

// ---------- Boot ----------

async function boot() {
  const [rules, cards, fighters] = await Promise.all(["rules", "cards", "fighters"].map((n) => fetch(`rules/${n}.json`).then((r) => r.json())));
  data = { rules, cards, fighters };
  const ids = Object.keys(fighters).filter((id) => !fighters[id].hidden);
  assets = await loadAssets(ids);
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

function renderSelect() {
  const box = $("select");
  box.classList.remove("hidden");
  $("battle").classList.add("hidden");
  $("overlay").classList.add("hidden");
  const ids = Object.keys(data.fighters).filter((id) => !data.fighters[id].hidden);
  const column = (side, title, cls) => `
    <div class="col">
      <h3 class="${cls}">${title}</h3>
      ${ids.map((id) => {
        const f = data.fighters[id];
        const placeholder = assets.fighters[id]?.placeholder ? '<span class="ph">占位圖</span>' : "";
        return `<button class="pick ${picks[side] === id ? "on" : ""}" data-side="${side}" data-id="${id}">
          ${portraitHtml(id)}
          <span class="tx"><span class="n">${f.short}${placeholder}</span><br><span class="k">${f.nick}</span><br><span class="sm">${f.summary}</span></span>
        </button>`;
      }).join("")}
    </div>`;
  const a = data.fighters[picks.a].attrs;
  const b = data.fighters[picks.b].attrs;
  const rows = ATTR_LABELS.map(([key, label]) => `
    <div class="cmp"><span class="num">${a[key]}</span><span class="tr l"><i style="width:${a[key]}%"></i></span><span class="lb">${label}</span><span class="tr r"><i style="width:${b[key]}%"></i></span><span class="num" style="text-align:right">${b[key]}</span></div>`).join("");
  box.innerHTML = `
    ${column("a", "你的選手", "you")}
    <div class="versus">
      <h1>OCTAGON CARDS</h1>
      ${rows}
      <div class="howto">
        <b class="t-S">打擊</b> 克 <b class="t-G">摔抱</b> 克 <b class="t-C">防反</b> 克 <b class="t-S">打擊</b>。<br>
        看對手傾向決定出什麼，<b>投入越多，贏得越多，猜錯也越痛</b>。體力會耗光，氣勢滿了有招牌技。
      </div>
    </div>
    ${column("b", "對手", "foe")}
    <button id="start">開打</button>`;
  box.querySelectorAll(".pick").forEach((el) => el.addEventListener("click", () => {
    picks[el.dataset.side] = el.dataset.id;
    renderSelect();
  }));
  $("start").addEventListener("click", startMatch);
}

function startMatch() {
  const seed = Number(new URLSearchParams(location.search).get("seed")) || Math.floor(Math.random() * 1e9);
  state = createMatch(data, picks.a, picks.b, seed);
  lastLine = "";
  $("select").classList.add("hidden");
  $("overlay").classList.add("hidden");
  $("battle").classList.remove("hidden");
  stage.setFighters(picks.a, picks.b);
  stage.timeScale = 1;
  stage.setLayout(state, true);
  syncShown();
  beginTurn();
}

function syncShown() {
  shown = {};
  for (const s of ["a", "b"]) {
    const me = state[s];
    shown[s] = { hp: me.hp, stamina: me.stamina, momentum: me.momentum, rocked: me.rocked, cut: me.cut, pips: { ...me.pips } };
  }
  viewDist = state.dist;
  stage.setCuts(shown.a.cut, shown.b.cut);
}

// ---------- HUD ----------

function renderPanel(side) {
  const m = data.rules.match;
  const v = shown[side];
  const f = fighterOf(side);
  const pips = ["head", "body", "legs"].map((t) => {
    const n = v.pips[t];
    const cls = n >= data.rules.debuff.threshold ? "full" : n > 0 ? "on" : "";
    return `<span>${TARGET_NAMES[t]}<span class="pip ${cls}">${"●".repeat(n)}${"○".repeat(data.rules.debuff.maxPips - n)}</span></span>`;
  }).join("");
  const el = $(`panel-${side}`);
  const prevGhost = el.dataset.hp ? Number(el.dataset.hp) : v.hp;
  el.dataset.hp = v.hp;
  el.innerHTML = `
    ${portraitHtml(f === undefined ? "" : state[side].id)}
    <div class="stats">
      <div class="nameline">${side === "a" ? "你 · " : ""}${f.short}${v.rocked ? '<span class="tag">被打暈</span>' : ""}${v.cut ? `<span class="tag bleed">流血 Lv${v.cut}</span>` : ""}<span class="pips">${pips}</span></div>
      <div class="barwrap"><div class="fill ghost" style="width:${prevGhost}%"></div><div class="fill hp ${v.hp <= 30 ? "low" : ""}" style="width:${(v.hp / m.maxHp) * 100}%"></div></div>
      <div class="thinrow">
        <div class="barwrap thin"><div class="fill stam ${v.stamina < data.rules.energy.tiredAt ? "low" : ""}" style="width:${v.stamina}%"></div></div>
        <div class="barwrap thin"><div class="fill mom ${v.momentum >= data.rules.momentum.signatureCost ? "ready" : ""}" style="width:${v.momentum}%"></div></div>
      </div>
    </div>`;
  requestAnimationFrame(() => {
    const ghost = el.querySelector(".ghost");
    if (ghost) ghost.style.width = `${v.hp}%`;
  });
}

function placeText(view) {
  if (view.ground) {
    const you = view.ground.top === "a" ? "你在上位" : "你在下位";
    return `地面 · ${data.rules.positions[view.ground.pos]}<br>${you}`;
  }
  const { names, short } = data.rules.dist;
  const track = short.map((s, i) => `<i class="${i === view.dist ? "on" : ""}">${s}</i>`).join("");
  return `站立 · ${names[view.dist]}<div class="track4">${track}</div>`;
}

function renderCenter() {
  const total = data.rules.match.exchangesPerRound;
  let dots = "";
  for (let i = 1; i <= total; i++) dots += `<span class="dot ${i < state.exchange ? "done" : i === state.exchange ? "now" : ""}"></span>`;
  $("center-bar").innerHTML = `<div class="round">第 ${state.round} 回合</div><div class="dots">${dots}</div><div class="place">${placeText(state)}</div>`;
}

function renderHud() {
  renderPanel("a");
  renderPanel("b");
  renderCenter();
}

function renderIntent() {
  const intent = getIntent(state, "b");
  // With blood in your eyes only the most likely type shows. The other two read "?".
  const rows = TYPES.map((t) => {
    const hidden = intent.blind && t !== intent.top;
    const p = Math.round(intent.probs[t] * 100);
    return `<div class="intent-row ${hidden ? "hide" : ""}"><span class="lbl t-${t}">${data.rules.typeNames[t]}</span><span class="track"><div class="val bg-${t}" style="width:${hidden ? 0 : p}%"></div></span><span class="pct t-${t}">${hidden ? "?" : `${p}%`}</span></div>`;
  }).join("");
  const extra = intent.tags.length ? `<i>${intent.tags.join("・")}</i>` : "";
  const sig = intent.signatureReady ? " <b>⚡招牌就緒</b>" : "";
  const blind = intent.blind ? '<div class="blind">血流進眼睛，只看得清最可能的出招</div>' : "";
  // Fighters stand near the centre when close or grounded, so the panel moves out of their way.
  $("intent").classList.toggle("side", Boolean(state.ground) || state.dist >= 2);
  $("intent").innerHTML = `
    <div class="title"><span>${fighterOf("b").short} 下一手傾向</span>${sig}</div>
    ${rows}${blind}
    <div class="tell">${intent.tell}${extra}</div>`;
  $("intent").classList.remove("hidden");
}

function renderAlert() {
  const el = $("alert");
  el.className = "hidden";
  const lock = state.ground?.lock;
  if (lock) {
    const pct = Math.round(lockTapChance(state) * 100);
    el.className = "";
    el.innerHTML = lock.attacker === "a"
      ? `你鎖住了：${lock.name}<br>再贏一手，${pct}% 逼他拍墊`
      : `被鎖住了：${lock.name}<br>這手贏才能逃，輸了 ${pct}% 拍墊`;
  } else if (state.a.rocked) {
    el.className = "";
    el.innerHTML = `你被打暈了！<br>這手只有 1 能量，撐過去`;
  } else if (state.b.rocked) {
    el.className = "swarm";
    el.innerHTML = `他被打暈了！追擊！<br>多 1 能量，傷害 +25%`;
  }
  $("last").style.display = el.className === "hidden" ? "" : "none";
  $("last").innerHTML = lastLine;
}

// ---------- Hand ----------

function selectedCards() {
  return selected.map((i) => state.a.hand[i]);
}

function renderHand() {
  const b = budget(state, "a");
  const cards = selectedCards();
  const type = cards.length ? data.cards[cards[0]].type : null;
  const spent = cards.reduce((sum, c) => sum + data.cards[c].cost, 0);
  // Dimmed means clicking it would not add to the current play: wrong distance, or not enough energy left.
  const look = (i) => {
    const c = state.a.hand[i];
    const isSel = selected.includes(i);
    const sameType = type === null || type === data.cards[c].type;
    const ok = playError(state, "a", sameType ? [...cards, c] : [c]) === null;
    return { card: data.cards[c], d: describeCard(state, "a", c), isSel, affordable: isSel || ok };
  };
  const drawn = state.a.hand.map((c, i) => i).filter((i) => !data.cards[state.a.hand[i]].basic);
  $("hand").innerHTML = drawn.map((i) => {
    const { card, d, isSel, affordable } = look(i);
    const label = d.action || data.rules.typeNames[card.type];
    const where = state.ground ? "" : d.rangeText;
    const rangeHtml = d.unusable ? `<span class="bad">要在${where}</span>` : where ? `<span>${where}</span>` : "<span></span>";
    const target = card.target && card.power ? `<span>打${TARGET_NAMES[card.target]}</span>` : "";
    return `<button class="card ${isSel ? "sel" : ""} ${affordable ? "" : "dim"} ${d.unusable ? "far" : ""} ${card.signature ? "signature" : ""}" data-i="${i}">
      <div class="head bg-${card.type}"><span>${label}</span><span class="cost">${"⚡".repeat(card.cost)}</span></div>
      <div class="nm">${card.name}</div>
      <div class="fx">${d.effect}</div>
      <div class="rng">${rangeHtml}${target}</div>
    </button>`;
  }).join("");
  $("hand").querySelectorAll(".card").forEach((el) => el.addEventListener("click", () => onCard(Number(el.dataset.i), el)));
  let energy = "";
  for (let i = 0; i < b; i++) energy += i < spent ? "⚡" : '<span class="off">⚡</span>';
  $("energy").innerHTML = energy;
  for (const [id, el, label] of [["step_in", $("step-in"), "前進"], ["step_back", $("step-back"), "後退"]]) {
    const i = state.a.hand.indexOf(id);
    const { isSel, affordable } = look(i);
    el.innerHTML = `${label}<small>⚡1</small>`;
    el.className = `${isSel ? "sel" : ""} ${affordable ? "" : "dim"}`;
  }
  $("brace").innerHTML = "硬撐<small>⚡0</small>";
  $("brace").className = bracing ? "sel" : "";
  $("fight").disabled = !(cards.length || bracing);
  renderChoice();
}

function renderChoice() {
  const el = $("choice");
  const cards = selectedCards();
  if (!cards.length && !bracing) {
    el.innerHTML = "選牌：同一類可以多張，能量用完為止";
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
  el.innerHTML = `<b class="t-${t}">${n[t]}</b>：贏 ${n[beats]} <b>${pct(beats)}</b> · 平 ${n[t]} <b>${pct(t)}</b> · 輸 ${n[losesTo]} <b>${pct(losesTo)}</b>${dmg}${moves}${risk}`;
}

function onCard(i, el) {
  const card = data.cards[state.a.hand[i]];
  bracing = false;
  if (selected.includes(i)) {
    selected = selected.filter((x) => x !== i);
    renderHand();
    return;
  }
  const current = selectedCards();
  if (current.length && data.cards[current[0]].type !== card.type) selected = [];
  const next = [...selected, i].map((x) => state.a.hand[x]);
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

function playLabel(side, cards, types, ground) {
  const type = types[side];
  if (ground) {
    const role = ground.top === side ? "top" : "bottom";
    return data.rules.groundLabels[role][type];
  }
  return data.rules.typeNames[type];
}

function renderReveal(e) {
  const flip = (side) => {
    const names = e[side].map((c) => data.cards[c].name).join(" + ");
    const res = e.winner === side ? "win" : e.winner ? "lose" : "";
    return `<div class="flip ${res}"><div class="head bg-${e.types[side]}">${playLabel(side, e[side], e.types, e.ground)}</div><div class="body">${names}</div><div class="who">${side === "a" ? "你" : fighterOf("b").short} ${"⚡".repeat(e[side].reduce((s, c) => s + data.cards[c].cost, 0))}</div></div>`;
  };
  $("reveal").innerHTML = flip("a") + flip("b");
  $("reveal").classList.remove("hidden");
}

function actionPoseFor(cardId) {
  const card = data.cards[cardId];
  return card?.kick ? "kick" : "punch";
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
        stage.flash(0.3);
        showVerdict(e.name, `${nameOf(e.side)} 用出招牌技`, "#f5c542");
        await wait(650);
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
        const dur = crit ? 460 : 340;
        const f = stage.fighters[e.attacker];
        const reach = REACH[viewDist];
        if (f.downed || stage.fighters[def].downed) {
          stage.strike(e.attacker, f.restPose === "shoot" ? "shoot" : "kick", 12, dur);
        } else {
          stage.strike(e.attacker, actionPoseFor(e.card), reach, dur);
        }
        await wait(dur * 0.42);
        stage.recoil(def, crit ? 34 : 18, dur);
        stage.floater(def, `-${e.damage}${crit ? "!" : ""}`, crit ? "#ffd166" : "#ffffff", crit ? 34 : 24);
        if (crit) {
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
        showVerdict(e.reason === "referee" ? "裁判叫起" : "站起來了", "", "#fff");
        await wait(620);
        $("verdict").classList.add("hidden");
        break;
      case "ride":
        showVerdict(e.held ? "被壓住了" : "穩穩壓住", "體力在流失", "#7cb7ff");
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
        showVerdict("互相試探", "雙方回體力", "#9fe2bf");
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
        showVerdict(`${e.name}！`, `${nameOf(e.attacker)} 鎖住了`, "#ff7b7f");
        await wait(800);
        $("verdict").classList.add("hidden");
        break;
      case "lockDeepen":
        stage.shake(10);
        showVerdict("越鎖越深", `${e.name} 還沒拍墊`, "#ff7b7f");
        await wait(760);
        $("verdict").classList.add("hidden");
        break;
      case "lockHold":
        showVerdict("僵持", `${e.name} 雙方都在耗力`, "#fff");
        await wait(560);
        $("verdict").classList.add("hidden");
        break;
      case "lockEscape":
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
  const full = { dist: viewDist, ground: view.ground || null };
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
  const groundBefore = state.ground ? { ...state.ground } : null;
  const events = resolveExchange(state, cards, ai);
  $("tray").classList.add("away");
  $("intent").classList.add("hidden");
  $("alert").className = "hidden";
  $("last").innerHTML = "";
  $("skip").classList.remove("hidden");
  skipping = false;
  // Keep showing the situation as it was until the playback moves it.
  viewDist = distBefore;
  stage.setLayout({ dist: distBefore, ground: groundBefore });
  await playEvents(events);
  stage.timeScale = 1;
  $("skip").classList.add("hidden");
  $("reveal").classList.add("hidden");
  $("verdict").classList.add("hidden");
  syncShown();
  if (state.phase === "corner") showCorner();
  else if (state.phase === "over") showResult();
  else beginTurn();
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
  const box = $("overlay");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="sheet">
    <h2>第 ${card.round} 回合結束：${head}</h2>
    <div class="judges">${judges}</div>
    <div class="note">角落時間：選一件事，再上場</div>
    <div class="opts">${opts}</div>
  </div>`;
  box.querySelectorAll(".opt").forEach((el) => el.addEventListener("click", () => {
    applyCorner(state, { a: el.dataset.id, b: chooseCorner(state, "b") });
    box.classList.add("hidden");
    beginTurn();
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
  const detail = o.method === "DEC" ? "打滿三回合" : `第 ${o.round} 回合第 ${o.exchange} 手`;
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
