// Browser UI for the deck-builder prototype (deck.html). All rules come from engine.js; the AI is ai.js.
import { createMatch, startHand, commitPlan, beginSecondPhase, runPlan, closeHand, perform, options, previewPlan, clone, other, eventText, cardText, rangeText, whyText, zoneOf, roleOf } from "./engine.js";
import { plan, playLive, endsPlan } from "./ai.js";
import { planSignature } from "./engine.js";

const load = async (n) => (await fetch(`rules/deck/${n}.json`)).json();
const data = { config: await load("config"), cards: await load("cards"), fighters: await load("fighters") };
const FIGHTERS = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
const rng = Math.random;
const $app = document.getElementById("app");

let S = null;
const ui = { mode: "select", me: "khabib", foe: "mcgregor", queue: [], showPiles: false };

const nm = (side) => data.fighters[S[side].id].short;
const cardName = (id) => data.cards[id].name;
const dist = data.config.distance.names;

function cardClass(c) {
  const t = c.effects.map((e) => e.t);
  if (t.includes("lock") || t.includes("breakLock")) return "lock";
  if (t.some((x) => ["takedown", "pull", "control", "escape", "sweep"].includes(x))) return "grab";
  if (t.includes("hit")) return "head";
  return "guard";
}
const stepLabel = (a) => (a.k === "step" ? (a.d > 0 ? "上步" : "後退") : cardName(a.id));
const stepText = (a) => (a.k === "step" ? (a.d > 0 ? "拉近一格" : "拉開一格") : cardText(data.cards[a.id]));

// ---------- flow ----------

function startMatch() {
  S = createMatch(data, ui.me, ui.foe, (Math.random() * 1e9) >>> 0);
  nextHand();
}

function nextHand() {
  if (S.over) return endMatch();
  startHand(S);
  ui.queue = [];
  if (S.first === "a") {
    commitPlan(S, "b", plan(S, "b", { look: false, rng }));
    ui.mode = "play";
  } else ui.mode = "plan";
  render();
}

function endMatch() {
  ui.mode = "over";
  render();
}

function finishSecond() {
  if (S.over) return afterHand();
  const info = beginSecondPhase(S);
  if (info.stale && info.second === "a") {
    ui.mode = "play2";
    return render();
  }
  if (info.stale) commitPlan(S, info.second, plan(S, info.second, { look: false, rng }));
  runPlan(S);
  closeHand(S);
  afterHand();
}

function afterHand() {
  ui.mode = S.over ? "over" : "recap";
  render();
}

function onAct(action) {
  const r = perform(S, "a", action);
  if (S.over) return afterHand();
  render();
  return r;
}

function onMain() {
  if (ui.mode === "play") {
    finishSecond();
  } else if (ui.mode === "plan") {
    commitPlan(S, "a", ui.queue);
    playLive(S, "b", { look: true, rng });
    finishSecond();
  } else if (ui.mode === "play2") {
    closeHand(S);
    afterHand();
  } else if (ui.mode === "recap") nextHand();
}

// ---------- planning (when the other seat moves first and sees your plan) ----------

/** Replays the queue on a copy so the next pick is checked against what would be left. */
function simQueue() {
  const c = clone(S);
  let ended = false;
  const results = [];
  for (const a of ui.queue) {
    const sig = planSignature(c);
    const r = perform(c, "a", a, { committed: true });
    results.push(r);
    ended = r.status === "ok" && endsPlan(c, sig, a);
  }
  return { c, results, ended };
}

// ---------- rendering ----------

function fighterPanel(side) {
  const F = S[side];
  const maxHp = data.fighters[F.id].hp ?? data.config.match.hp;
  const st = data.config.status;
  const chips = [];
  if (F.block) chips.push(`<span class="chip block">🛡 擋 ${F.block}</span>`);
  if (F.slip) chips.push(`<span class="chip block">閃身</span>`);
  if (F.sprawl) chips.push(`<span class="chip block">防摔</span>`);
  if (F.counter) chips.push(`<span class="chip block">接招反擊 ${F.counter.dmg}</span>`);
  if (F.stunned) chips.push(`<span class="chip bad">被打暈</span>`);
  else if (F.dizzy) chips.push(`<span class="chip warn">暈眩 ${F.dizzy}/${st.dizzy.limit}</span>`);
  if (F.windedLoss) chips.push(`<span class="chip bad">喘不過氣：下手少抽牌</span>`);
  else if (F.winded) chips.push(`<span class="chip warn">喘 ${F.winded}/${st.winded.limit}</span>`);
  if (F.legs) chips.push(`<span class="chip ${F.legs >= st.legs.limit ? "bad" : "warn"}">腿傷 ${F.legs}${F.legs >= st.legs.limit ? "（步法變貴）" : ""}</span>`);
  const zone = zoneOf(S);
  const draw = F.piles[zone].draw.length;
  const pips = Array.from({ length: Math.max(data.config.match.energy, F.energy) }, (_, i) => `<i class="pip ${i < F.energy ? "on" : ""}"></i>`).join("");
  return `<div class="fighter ${side === "a" ? "me" : "foe"}">
    <div class="nm"><span>${data.fighters[F.id].short}${side === "a" ? "（你）" : ""}</span><span class="pips" style="margin:0">${data.fighters[F.id].style}</span></div>
    <div class="hpbar"><i style="width:${Math.max(0, (F.hp / maxHp) * 100)}%"></i><span>${Math.max(0, F.hp)} / ${maxHp}</span></div>
    <div class="chips">${chips.join("")}</div>
    <div class="pips">能量 ${pips} <span>｜手牌 ${F.hand[zone].length}・抽牌堆 ${draw}</span></div>
  </div>`;
}

function midPanel() {
  const rounds = data.config.match.rounds;
  const hands = data.config.match.handsPerRound;
  const info = S.first === "a" ? "這手：你先出牌，看得到對手的計畫" : "這手：你先排計畫，對手看了才出牌";
  let ground = "";
  if (S.pos === "ground") {
    const cm = data.config.ground;
    const bar = (v, max, col) => `<span class="bar"><i style="width:${(v / max) * 100}%;background:${col}"></i></span>`;
    ground = `<div class="ground-badge">地面｜上位：${nm(S.top)}<br>控制 ${bar(S.control, cm.controlMax, "#ffb547")} ${S.control}/${cm.controlMax}<br>鎖技 你 ${bar(S.lock.a, cm.lockThreshold, "#4aa3ff")}${S.lock.a} ‖ 他 ${bar(S.lock.b, cm.lockThreshold, "#ff6b5e")}${S.lock.b}<br><span style="color:var(--dim);font-weight:400">鎖滿 ${cm.lockThreshold} 就降伏・${S.stall ? "沒進展，快被叫起" : "有進展"}</span></div>`;
  } else {
    ground = `<div class="track">${dist.map((d, i) => `<div class="${i === S.dist ? "cur" : ""}">${d}</div>`).join("")}</div>`;
  }
  return `<div id="mid"><div class="rh">第 ${S.round}/${rounds} 回合・第 ${S.hand}/${hands} 手 <button data-act="menu" style="padding:0 .3rem;font-size:.65rem">選單</button></div>${ground}<div class="rh">${info}</div></div>`;
}

function intentPanel() {
  if (ui.mode === "plan") {
    const sim = simQueue();
    const chips = ui.queue.map((a, i) => {
      const r = sim.results[i];
      const warn = r.status === "whiff" ? " whiff" : "";
      return `<span class="step mine${warn}" data-act="unqueue" data-i="${i}"><b>${i + 1}. ${stepLabel(a)}</b>${r.status === "whiff" ? "現在距離不對" : stepText(a)}</span>`;
    });
    return `<h4><span>你的計畫（點一張可從那裡開始移除）</span><span>剩 ${sim.c.a.energy} 能量</span></h4><div class="row">${chips.join('<span class="arrow">▶</span>') || '<span style="color:var(--dim)">從手牌挑牌排進來；對手先動，你的牌在它之後才打。排到抱摔、脫逃、抽牌就必須停（之後要看新手牌）。</span>'}</div>`;
  }
  if (ui.mode === "recap" || ui.mode === "over") return `<h4><span>這手已結算（看右邊的紀錄）</span></h4>`;
  if (S.plan && S.plan.sig !== planSignature(S)) return `<h4><span>位置變了：${nm("b")} 原本的計畫作廢，他會臨場重新出牌</span></h4>`;
  if (!S.plan || !S.plan.actions.length) {
    const who = nm(other(S.first));
    return `<h4><span>${ui.mode === "play2" ? "位置變了：換你當場出牌" : `${S.first === "a" ? who : ""}${S.first === "a" ? " 這手不動" : ""}`}</span></h4>`;
  }
  const pre = previewPlan(S);
  const chips = pre.steps.map((s) => {
    const a = s.action;
    const bad = s.status === "whiff" || s.status === "canceled";
    const detail = s.status === "whiff" ? "現在的距離打不到" : s.status === "canceled" ? "現在沒辦法出" : stepText(a);
    return `<span class="step${bad ? " whiff" : ""}"><b>${stepLabel(a)}</b>${detail}</span>`;
  });
  const dmg = pre.tap ? `<span class="dmgnote">⚠ 會鎖到降伏！</span>` : pre.ko ? `<span class="dmgnote">⚠ 會被 KO！</span>` : pre.damage ? `<span class="dmgnote">預計你受到 ${pre.damage} 傷害</span>` : `<span class="dmgnote safe">預計你不會受傷</span>`;
  return `<h4><span>${nm("b")} 這手的計畫（現在這個局面下）</span></h4><div class="row">${chips.join('<span class="arrow">▶</span>')}${dmg}</div>`;
}

function logPanel() {
  const lines = S.log
    .map((e) => ({ e, t: eventText(S, e) }))
    .filter((x) => x.t && x.e.t !== "draw" && x.e.t !== "hand");
  const cls = (e) => (e.side === "a" || e.from === "a" || e.to === "b" ? "me" : e.side === "b" || e.from === "b" || e.to === "a" ? "foe" : "sys");
  return `<div id="log"><h4><span>發生了什麼</span></h4>${lines.map((x) => `<div class="${cls(x.e)}">${x.t}</div>`).join("")}</div>`;
}

function handPanel() {
  const mode = ui.mode;
  const live = mode === "play" || mode === "play2";
  const zone = zoneOf(S);
  let items = [];
  let ended = false;
  if (live) items = options(S, "a").filter((o) => o.k === "card");
  else if (mode === "plan") {
    const sim = simQueue();
    ended = sim.ended;
    const left = options(sim.c, "a").filter((o) => o.k === "card");
    const queued = {};
    for (const a of ui.queue) if (a.k === "card") queued[a.id] = (queued[a.id] || 0) + 1;
    const taken = {};
    const all = [...S.a.hand[zone].map((id) => ({ id, fb: false })), ...left.filter((o) => o.fb).map((o) => ({ id: o.id, fb: true }))];
    items = all.map(({ id, fb }) => {
      const c = data.cards[id];
      taken[id] = (taken[id] || 0) + 1;
      if (!fb && taken[id] <= (queued[id] || 0)) return { id, fb, cost: c.cost, queued: true, ok: false };
      const o = left.find((x) => x.id === id && !x.used);
      if (o) o.used = true;
      const ok = !!o && !ended && (o.ok || o.why === "range");
      return { id, fb, cost: c.cost, ok, why: ended ? "ended" : o ? (o.why === "range" ? null : o.why) : "energy", warnRange: o?.why === "range" };
    });
  }
  const cards = items
    .map((o, i) => {
      const c = data.cards[o.id];
      const role = c.zone === "ground" ? (c.role === "top" ? "上位" : "下位") : "站立";
      const why = o.queued ? "已排入計畫" : o.why === "ended" ? "計畫到此為止" : o.why ? whyText(o.why) : o.warnRange ? "現在距離不對" : "";
      return `<div class="card ${cardClass(c)} ${o.ok ? "" : "off"} ${o.fb ? "fb" : ""} ${o.queued ? "queued" : ""}" data-act="card" data-id="${o.id}" data-fb="${o.fb ? 1 : 0}">
        <i class="cost">${c.cost}</i><div class="name">${c.name}</div><div class="zone">${role}${o.fb ? "・基本招" : ""}</div>
        <div class="rng">距離：${rangeText(data, c.range)}</div><div class="txt">${cardText(c)}</div><div class="why">${why}</div></div>`;
    })
    .join("");
  const F = S.a;
  const left = mode === "plan" ? simQueue().c.a.energy : F.energy;
  const pips = Array.from({ length: data.config.match.energy }, (_, i) => `<i class="pip ${i < left ? "on" : ""}"></i>`).join("");
  const canStep = (d) => (live ? options(S, "a").find((o) => o.k === "step" && o.d === d)?.ok : mode === "plan" && zone === "stand" && !ended && !ui.queue.some((a) => a.k === "step"));
  const mainLabel = { play: "結束這手", plan: "確認計畫", play2: "結束這手", recap: "下一手 ▶" }[mode] || "…";
  const hasCards = items.length > 0;
  return `<div id="handwrap"><div id="hand">${cards || `<div class="hint" style="align-self:center;padding:1rem">${mode === "recap" ? "這手結束，看左邊的紀錄，然後按「下一手」" : "手上沒有這個位置能用的牌"}</div>`}</div>
    <div id="side">
      <div class="energy">能量 ${pips}</div>
      ${zone === "stand" && (live || mode === "plan") ? `<div style="display:flex;gap:.3rem"><button data-act="step" data-d="-1" ${canStep(-1) ? "" : "disabled"} style="flex:1">◀ 後退</button><button data-act="step" data-d="1" ${canStep(1) ? "" : "disabled"} style="flex:1">上步 ▶</button></div><div class="hint">步法 1 能量，每手一步</div>` : ""}
      <button class="primary" data-act="main" ${mode === "wait" ? "disabled" : ""}>${mainLabel}</button>
      <div class="pile" data-act="piles">牌庫・棄牌（點開）</div>
    </div></div>`;
}

function pilesModal() {
  const side = (s) => {
    const F = S[s];
    const fmt = (arr) => {
      const m = {};
      for (const id of arr) m[id] = (m[id] || 0) + 1;
      return Object.entries(m).map(([id, n]) => `<span>${cardName(id)}${n > 1 ? "×" + n : ""}</span>`).join("") || "<span>（空）</span>";
    };
    const z = zoneOf(S);
    return `<div><h3>${nm(s)}（${z === "stand" ? "站立" : "地面"}牌組）</h3>抽牌堆 ${F.piles[z].draw.length} 張（只顯示有什麼，不顯示順序）：<br>${fmt(F.piles[z].draw)}<br>已打出 ${F.piles[z].discard.length} 張：<br>${fmt(F.piles[z].discard)}</div>`;
  };
  return `<div class="overlay" data-act="closepiles"><div class="box"><h2>牌庫</h2><div class="cols">${side("a")}${side("b")}</div><div class="row2"><button data-act="closepiles">關閉</button></div></div></div>`;
}

function selectScreen() {
  const opt = (id, cur, which) => {
    const f = data.fighters[id];
    return `<div class="opt ${cur === id ? "sel" : ""}" data-act="pick" data-which="${which}" data-id="${id}"><b>${f.short}</b>・${f.style}<small>${f.summary}</small></div>`;
  };
  const deck = (id) => {
    const f = data.fighters[id];
    const fmt = (spec) => Object.entries(spec).map(([c, n]) => `<span>${cardName(c)}${n > 1 ? "×" + n : ""}</span>`).join("");
    const cnt = (spec) => Object.values(spec).reduce((x, y) => x + y, 0);
    return `<div><h3>${f.short}</h3>站立牌組 ${cnt(f.deck.stand)} 張：<br>${fmt(f.deck.stand)}<br>地面牌組 ${cnt(f.deck.ground)} 張：<br>${fmt(f.deck.ground)}</div>`;
  };
  return `<div class="overlay"><div class="box"><h2>Octagon Cards・卡牌版</h2>
    <div>你選：</div><div class="pick">${FIGHTERS.map((id) => opt(id, ui.me, "me")).join("")}</div>
    <div>對手：</div><div class="pick foe">${FIGHTERS.map((id) => opt(id, ui.foe, "foe")).join("")}</div>
    <div class="cols">${deck(ui.me)}${deck(ui.foe)}</div>
    <div class="row2"><button class="primary" data-act="start">開打</button></div></div></div>`;
}

function overScreen() {
  const o = S.over;
  const how = { KO: "KO", tap: "降伏", decision: "判定" }[o.how];
  const who = o.winner ? `${nm(o.winner)}${o.winner === "a" ? "（你）" : ""} 贏了` : "平手";
  return `<div class="overlay"><div class="box" style="max-width:26rem;text-align:center"><div class="big">${who}</div><div>${how}・第 ${S.round} 回合第 ${S.hand} 手</div><div class="hint" style="margin-top:.4rem">${nm("a")} ${Math.max(0, S.a.hp)} HP ／ ${nm("b")} ${Math.max(0, S.b.hp)} HP</div><div class="row2" style="justify-content:center"><button data-act="menu">換選手</button><button class="primary" data-act="start">再打一場</button></div></div></div>`;
}

function render() {
  if (ui.mode === "select") {
    $app.innerHTML = selectScreen();
    return;
  }
  const logEl = document.getElementById("log");
  const keep = logEl ? logEl.scrollTop : 0;
  $app.className = ui.mode === "recap" || ui.mode === "over" ? "recap" : "";
  $app.innerHTML = `<div id="top">${fighterPanel("a")}${midPanel()}${fighterPanel("b")}</div>
    <div id="mids"><div id="intent">${intentPanel()}</div>${logPanel()}</div>
    ${handPanel()}${ui.showPiles ? pilesModal() : ""}${ui.mode === "over" ? overScreen() : ""}`;
  const l = document.getElementById("log");
  if (l) l.scrollTop = l.scrollHeight || keep;
}

// ---------- input ----------

$app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "pick") {
    ui[el.dataset.which] = el.dataset.id;
    render();
  } else if (act === "start") startMatch();
  else if (act === "menu") {
    ui.mode = "select";
    ui.showPiles = false;
    render();
  } else if (act === "piles") {
    ui.showPiles = true;
    render();
  } else if (act === "closepiles") {
    if (ev.target.classList.contains("overlay") || el.tagName === "BUTTON") {
      ui.showPiles = false;
      render();
    }
  } else if (act === "main") onMain();
  else if (act === "step") {
    const action = { k: "step", d: Number(el.dataset.d) };
    if (ui.mode === "plan") {
      ui.queue.push(action);
      render();
    } else if (ui.mode === "play" || ui.mode === "play2") onAct(action);
  } else if (act === "card") {
    if (el.classList.contains("off")) return;
    const action = { k: "card", id: el.dataset.id };
    if (ui.mode === "plan") {
      ui.queue.push(action);
      render();
    } else if (ui.mode === "play" || ui.mode === "play2") onAct(action);
  } else if (act === "unqueue") {
    ui.queue.length = Number(el.dataset.i);
    render();
  }
});

render();
window.__deck = { get S() { return S; }, ui, render };
