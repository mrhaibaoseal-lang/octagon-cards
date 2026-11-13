// Octagon Cards — deck-builder combat engine (card-game rebuild, 2026-11-09).
// Pure rules: no DOM, no timers, runs in browsers and Node. All numbers live in rules/deck/*.json.
// Spec: docs/GAME_DESIGN.md. Vocabulary: "round" = a 5-minute round, "hand" = one exchange (first seat plays, then second seat's committed plan runs).

export const other = (s) => (s === "a" ? "b" : "a");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Mulberry32 stepping on state.rng so a match is reproducible from its seed and clonable for AI look-ahead. */
export function rand(state) {
  const a = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const expand = (spec) => Object.entries(spec).flatMap(([id, n]) => Array(n).fill(id));

function ev(state, e) {
  if (!state.quiet) state.log.push(e);
}

/** Copy for AI search: everything but the (shared, read-only) data and the log. */
export function clone(state) {
  const { data, log, lastLog, ...rest } = state;
  const c = JSON.parse(JSON.stringify(rest));
  c.data = data;
  c.log = [];
  c.lastLog = [];
  c.quiet = true;
  return c;
}

const newFighter = (data, id) => ({
  id,
  hp: data.fighters[id].hp ?? data.config.match.hp,
  energy: 0,
  block: 0,
  slip: false,
  sprawl: false,
  counter: null,
  dizzy: 0,
  stunned: false,
  winded: 0,
  windedLoss: 0,
  legs: 0,
  steps: 0,
  piles: { stand: { draw: [], discard: [] }, ground: { draw: [], discard: [] } },
  hand: { stand: [], ground: [] },
  used: 0,
});

/** data = { config, cards, fighters } (the three files in rules/deck). `first` is the seat that plays first (and sees the plan) on the opening hand; it alternates every hand. */
export function createMatch(data, idA, idB, seed = 1, { first = "a" } = {}) {
  const state = {
    data,
    rng: seed >>> 0,
    round: 0,
    hand: 0,
    over: null,
    opener: first,
    first,
    phase: "idle",
    pos: "stand",
    top: null,
    control: 0,
    dist: data.config.match.startDistance,
    lock: { a: 0, b: 0 },
    stall: 0,
    progress: false,
    plan: null,
    log: [],
    lastLog: [],
    quiet: false,
    stats: { a: { dealt: 0, played: 0, fallback: 0, takedowns: 0, locks: 0 }, b: { dealt: 0, played: 0, fallback: 0, takedowns: 0, locks: 0 }, groundHands: 0, hands: 0 },
    a: newFighter(data, idA),
    b: newFighter(data, idB),
  };
  startRound(state);
  return state;
}

export const zoneOf = (state) => (state.pos === "stand" ? "stand" : "ground");
export const roleOf = (state, side) => (state.pos === "stand" ? null : state.top === side ? "top" : "bottom");
export const handOf = (state, side) => state[side].hand[zoneOf(state)];
const cardOf = (state, id) => state.data.cards[id];

/** A card is usable in the current zone (and, on the mat, in the current role). */
export function fitsPosition(state, side, id) {
  const c = cardOf(state, id);
  if (c.zone !== zoneOf(state)) return false;
  return c.zone === "stand" || c.role === roleOf(state, side);
}

const inRange = (state, c) => !c.range || (state.dist >= c.range[0] && state.dist <= c.range[1]);

/** Draw up to n matching cards (ground draws only the role you are in), never past the hand limit. */
export function draw(state, side, n) {
  const S = state[side];
  const zone = zoneOf(state);
  const pile = S.piles[zone].draw;
  const hand = S.hand[zone];
  let got = 0;
  while (got < n && hand.length < state.data.config.match.handLimit) {
    const i = pile.findIndex((id) => fitsPosition(state, side, id));
    if (i < 0) break;
    hand.push(pile.splice(i, 1)[0]);
    got++;
  }
  if (got) ev(state, { t: "draw", side, n: got });
  return got;
}

/** On the mat, top the playable part of the hand up to `want` cards (used when someone goes down or the roles swap). */
function topUp(state, side, want) {
  const S = state[side];
  const zone = zoneOf(state);
  const playable = () => S.hand[zone].filter((id) => fitsPosition(state, side, id)).length;
  let guard = 12;
  while (playable() < want && guard-- > 0) if (!draw(state, side, 1)) break;
}

export function startRound(state) {
  const cfg = state.data.config.match;
  state.round++;
  state.hand = 0;
  state.pos = "stand";
  state.top = null;
  state.control = 0;
  state.dist = cfg.startDistance;
  state.lock = { a: 0, b: 0 };
  state.stall = 0;
  state.plan = null;
  for (const side of ["a", "b"]) {
    const S = state[side];
    const deck = state.data.fighters[S.id].deck;
    if (state.round > 1) S.hp = Math.min(state.data.fighters[S.id].hp ?? cfg.hp, S.hp + cfg.healBetweenRounds);
    Object.assign(S, { block: 0, slip: false, sprawl: false, counter: null, dizzy: 0, stunned: false, winded: 0, windedLoss: 0, legs: 0 });
    S.piles = { stand: { draw: shuffle(state, expand(deck.stand)), discard: [] }, ground: { draw: shuffle(state, expand(deck.ground)), discard: [] } };
    S.hand = { stand: [], ground: [] };
    draw(state, side, cfg.openingDraw);
  }
  ev(state, { t: "round", n: state.round });
}

export function startHand(state) {
  const cfg = state.data.config;
  state.hand++;
  state.stats.hands++;
  if (state.pos === "ground") state.stats.groundHands++;
  state.lastLog = state.log;
  state.log = [];
  state.progress = false;
  // Slay-the-Spire style (2026-11-09): the opener always plays live and sees the other seat's public plan, so the information edge never flips. `alternateFirst: true` brings back the old swap.
  state.first = cfg.match.alternateFirst && state.stats.hands % 2 === 0 ? other(state.opener) : state.opener;
  for (const side of ["a", "b"]) {
    const S = state[side];
    S.energy = cfg.match.energy + (side === state.first ? 0 : cfg.match.secondEnergyBonus || 0) - (S.stunned ? cfg.status.dizzy.energyLoss : 0);
    S.stunned = false;
    S.steps = 0;
    const n = state.hand === 1 ? 0 : Math.max(0, cfg.match.drawPerHand - S.windedLoss);
    S.windedLoss = 0;
    if (n) draw(state, side, n);
  }
  state.phase = state.first;
  state.plan = null;
  beginPhase(state, state.first);
  ev(state, { t: "hand", n: state.hand });
}

/** A seat's block and stances last from the moment it plays until its own next phase begins. */
export function beginPhase(state, side) {
  const S = state[side];
  S.block = 0;
  S.slip = false;
  S.sprawl = false;
  S.counter = null;
}

export const planSignature = (state) => `${state.pos}|${state.top}`;

export function commitPlan(state, seat, actions) {
  state.plan = { seat, actions, sig: planSignature(state) };
}

/** When nobody in the pile+hand can act in this position, the weak "gassed" moves open up. */
export function fallbackIds(state, side) {
  const S = state[side];
  const zone = zoneOf(state);
  if (S.hand[zone].some((id) => fitsPosition(state, side, id))) return [];
  if (S.piles[zone].draw.some((id) => fitsPosition(state, side, id))) return [];
  const role = roleOf(state, side);
  return state.data.config.fallback[zone === "stand" ? "stand" : role];
}

export const stepCost = (state, side) => state.data.config.step.cost + (state[side].legs >= state.data.config.status.legs.limit ? state.data.config.status.legs.stepExtra : 0);

/** Everything the seat could try right now, with why not when it cannot (for the UI). */
export function options(state, side) {
  const S = state[side];
  const out = [];
  const seen = new Set();
  const zone = zoneOf(state);
  const fb = fallbackIds(state, side);
  const list = [...S.hand[zone].map((id) => ({ id, fb: false })), ...fb.map((id) => ({ id, fb: true }))];
  list.forEach(({ id, fb: isFb }, i) => {
    const c = cardOf(state, id);
    let why = null;
    if (!fitsPosition(state, side, id)) why = "role";
    else if (S.energy < c.cost) why = "energy";
    else if (!inRange(state, c)) why = "range";
    out.push({ k: "card", id, handIndex: i, fb: isFb, cost: c.cost, ok: !why, why, dup: seen.has(id) });
    seen.add(id);
  });
  if (zone === "stand") {
    const cost = stepCost(state, side);
    for (const d of [1, -1]) {
      let why = null;
      if (S.steps >= state.data.config.step.perHand) why = "limit";
      else if (S.energy < cost) why = "energy";
      else if (state.dist + d < 0 || state.dist + d > state.data.config.distance.max) why = "edge";
      out.push({ k: "step", d, cost, ok: !why, why });
    }
  }
  return out;
}

/** Plays one action. `committed` is the second seat running its plan: a card that no longer fits (position/energy) stays unplayed, one that is out of range whiffs and is spent. */
export function perform(state, side, action, { committed = false } = {}) {
  if (state.over) return { status: "over" };
  const S = state[side];
  const cfg = state.data.config;
  if (action.k === "step") {
    const cost = stepCost(state, side);
    if (zoneOf(state) !== "stand") return { status: "canceled", why: "zone" };
    if (S.steps >= cfg.step.perHand) return { status: "canceled", why: "limit" };
    if (S.energy < cost) return { status: "canceled", why: "energy" };
    const nd = clamp(state.dist + action.d, 0, cfg.distance.max);
    if (nd === state.dist) return { status: "canceled", why: "edge" };
    S.energy -= cost;
    S.steps++;
    state.dist = nd;
    ev(state, { t: "step", side, d: action.d, dist: nd });
    return { status: "ok" };
  }
  const c = cardOf(state, action.id);
  if (!c) return { status: "canceled", why: "unknown" };
  const zone = zoneOf(state);
  const hand = S.hand[zone];
  const fb = !hand.includes(action.id) && fallbackIds(state, side).includes(action.id);
  if (!fb && !hand.includes(action.id)) return { status: "canceled", why: "nohand" };
  if (!fitsPosition(state, side, action.id)) return { status: "canceled", why: "role" };
  if (S.energy < c.cost) return { status: "canceled", why: "energy" };
  const inR = inRange(state, c);
  if (!inR && !committed) return { status: "canceled", why: "range" };
  // An out-of-range committed card either whiffs (card and energy spent) or, when rules say so, is simply not thrown and stays in hand.
  if (!inR && !cfg.match.whiffSpends) return { status: "whiff", spent: false };
  S.energy -= c.cost;
  if (!fb) {
    hand.splice(hand.indexOf(action.id), 1);
    S.piles[zone].discard.push(action.id);
  } else state.stats[side].fallback++;
  S.used++;
  state.stats[side].played++;
  if (!inR) {
    ev(state, { t: "whiff", side, id: action.id });
    return { status: "whiff" };
  }
  ev(state, { t: "play", side, id: action.id, fb });
  for (const e of c.effects) {
    applyEffect(state, side, e);
    if (state.over) break;
  }
  return { status: "ok" };
}

function damage(state, from, to, amount, at) {
  const cfg = state.data.config.status;
  const D = state[to];
  let dmg = amount;
  if (D.stunned) dmg = Math.round(dmg * (1 + cfg.dizzy.stunnedTakesMore));
  const absorbed = Math.min(D.block, dmg);
  D.block -= absorbed;
  const through = dmg - absorbed;
  D.hp -= through;
  state.stats[from].dealt += through;
  ev(state, { t: "dmg", from, to, amt: through, abs: absorbed, at });
  if (through > 0) {
    state.progress = true;
    if (at === "head") {
      D.dizzy += through >= cfg.dizzy.bigHit ? 2 : through >= cfg.dizzy.smallHit ? 1 : 0;
      if (D.dizzy >= cfg.dizzy.limit) {
        D.dizzy = 0;
        D.stunned = true;
        ev(state, { t: "stun", side: to });
      }
    } else if (at === "body") {
      D.winded++;
      if (D.winded >= cfg.winded.limit) {
        D.winded = 0;
        D.windedLoss = cfg.winded.drawLoss;
        ev(state, { t: "winded", side: to });
      }
    } else if (at === "legs") D.legs++;
  }
  checkEnd(state);
}

function checkEnd(state) {
  if (state.over) return;
  const a = state.a.hp;
  const b = state.b.hp;
  if (a <= 0 || b <= 0) state.over = { winner: a === b ? null : a > b ? "a" : "b", how: "KO" };
}

function enterGround(state, top, control) {
  state.pos = "ground";
  state.top = top;
  state.control = control;
  state.lock = { a: 0, b: 0 };
  state.stall = 0;
  state.progress = true;
  const entry = state.data.config.match.groundEntryDraw;
  topUp(state, "a", entry);
  topUp(state, "b", entry);
  ev(state, { t: "ground", top });
}

function leaveGround(state, why) {
  state.pos = "stand";
  state.top = null;
  state.control = 0;
  state.lock = { a: 0, b: 0 };
  state.stall = 0;
  state.dist = state.data.config.ground.standUpDistance;
  state.progress = true;
  ev(state, { t: "standup", why });
}

function applyEffect(state, side, e) {
  const S = state[side];
  const o = other(side);
  const O = state[o];
  const g = state.data.config.ground;
  switch (e.t) {
    case "hit": {
      for (let i = 0; i < (e.times || 1); i++) {
        const dmg = e.dmg + (e.perControl && state.pos === "ground" && state.top === side ? Math.round(e.perControl * state.control) : 0);
        if (O.slip) {
          O.slip = false;
          ev(state, { t: "slipped", side: o });
          return;
        }
        if (O.counter) {
          const cn = O.counter;
          O.counter = null;
          ev(state, { t: "countered", side: o });
          damage(state, o, side, cn.dmg, cn.at || "head");
          return;
        }
        damage(state, side, o, dmg, e.at);
        if (state.over) return;
      }
      return;
    }
    case "block":
      S.block += e.n;
      return;
    case "dist":
      state.dist = clamp(state.dist + e.n, 0, state.data.config.distance.max);
      return;
    case "stance":
      if (e.k === "counter") S.counter = { dmg: e.dmg, at: e.at };
      else S[e.k] = true;
      return;
    case "takedown":
      if (state.pos !== "stand") return;
      if (O.sprawl) {
        O.sprawl = false;
        ev(state, { t: "sprawled", side: o });
        return;
      }
      state.stats[side].takedowns++;
      enterGround(state, side, e.control);
      return;
    case "pull":
      if (state.pos !== "stand") return;
      state.stats[side].takedowns++;
      enterGround(state, o, e.control);
      return;
    case "control":
      if (state.pos === "ground" && state.top === side) {
        state.control = Math.min(g.controlMax, state.control + e.n);
        state.progress = true;
        ev(state, { t: "control", side, n: state.control });
      }
      return;
    case "lock": {
      if (state.pos !== "ground") return;
      const bonus = Math.floor(state.control / g.lockControlDiv);
      const gain = Math.max(2, e.n + (state.top === side ? bonus : -bonus));
      state.lock[side] += gain;
      state.progress = true;
      state.stats[side].locks++;
      ev(state, { t: "lock", side, n: state.lock[side], gain });
      if (state.lock[side] >= g.lockThreshold) state.over = { winner: side, how: "tap" };
      return;
    }
    case "breakLock":
      if (state.pos === "ground" && state.lock[o] > 0) {
        state.lock[o] = Math.max(0, state.lock[o] - e.n);
        ev(state, { t: "broke", side, n: state.lock[o] });
      }
      return;
    case "escape":
      if (state.pos === "ground" && state.top !== side) {
        state.control = Math.max(0, state.control - e.n);
        ev(state, { t: "escape", side, n: state.control });
        if (state.control <= 0) leaveGround(state, "escape");
      }
      return;
    case "sweep":
      if (state.pos === "ground" && state.top !== side && state.control <= e.maxControl) {
        state.top = side;
        state.control = 1;
        state.lock = { a: 0, b: 0 };
        state.progress = true;
        ev(state, { t: "sweep", side });
        topUp(state, "a", state.data.config.match.groundEntryDraw);
        topUp(state, "b", state.data.config.match.groundEntryDraw);
      } else ev(state, { t: "sweepFail", side });
      return;
    case "draw":
      draw(state, side, e.n);
      return;
  }
}

/** Opens the second seat's phase. A plan made before the position changed (a takedown, an escape) is stale and dropped: that seat must act again with the new hand. */
export function beginSecondPhase(state) {
  const second = other(state.first);
  state.phase = second;
  beginPhase(state, second);
  const stale = !!state.plan && state.plan.sig !== planSignature(state);
  if (stale) {
    state.plan = null;
    ev(state, { t: "replan", side: second });
  }
  return { second, stale };
}

/** Runs the committed plan of the second seat. */
export function runPlan(state) {
  const seat = other(state.first);
  for (const action of state.plan?.actions || []) {
    const r = perform(state, seat, action, { committed: true });
    if (r.status === "canceled") ev(state, { t: "canceled", side: seat, id: action.id, why: r.why });
    else if (r.status === "whiff" && r.spent === false) ev(state, { t: "whiff", side: seat, id: action.id, kept: true });
    if (state.over) break;
  }
}

/** The whole second phase in one go. `planner(state, seat)` re-plans when the first seat changed the position under the plan. */
export function endFirstPhase(state, planner) {
  if (state.over) return;
  const { second, stale } = beginSecondPhase(state);
  if (stale && planner) commitPlan(state, second, planner(state, second));
  runPlan(state);
  closeHand(state);
}

export function closeHand(state) {
  endHand(state);
}

function endHand(state) {
  if (state.over) return;
  const g = state.data.config.ground;
  if (state.pos === "ground") {
    state.stall = state.progress ? 0 : state.stall + 1;
    if (state.stall >= g.stallLimit) leaveGround(state, "referee");
  }
  state.phase = "between";
  if (state.hand >= state.data.config.match.handsPerRound) endRound(state);
}

function endRound(state) {
  const cfg = state.data.config.match;
  if (state.round >= cfg.rounds) {
    const a = state.a.hp;
    const b = state.b.hp;
    state.over = { winner: a === b ? null : a > b ? "a" : "b", how: "decision" };
    return;
  }
  ev(state, { t: "roundEnd", n: state.round });
  startRound(state);
}

/** What the committed plan would do if nothing changed from here (for the intent display). Returns per-action results and the damage it would deal to `target`. */
export function previewPlan(state) {
  if (!state.plan) return { steps: [], damage: 0 };
  const c = clone(state);
  const seat = state.plan.seat;
  const target = other(seat);
  beginPhase(c, seat);
  const before = c[target].hp;
  const steps = state.plan.actions.map((action) => ({ action, ...perform(c, seat, action, { committed: true }) }));
  return { steps, damage: Math.max(0, before - c[target].hp), tap: c.over?.how === "tap" && c.over.winner === seat, ko: c.over?.how === "KO" && c.over.winner === seat, lockAfter: c.lock[seat] };
}

// ---- text for the UI and the spec -------------------------------------------------------------------------------

const AT = { head: "頭", body: "身", legs: "腿" };

export function rangeText(data, range) {
  if (!range) return "任何距離";
  const n = data.config.distance.names.map((s) => s.slice(0, 1));
  return range[0] === range[1] ? n[range[0]] : `${n[range[0]]}–${n[range[1]]}`;
}

export function effectText(e) {
  switch (e.t) {
    case "hit": return `打${AT[e.at]} ${e.dmg}${e.times > 1 ? `×${e.times}` : ""}${e.perControl ? `（控制越高越痛）` : ""}`;
    case "block": return `擋 ${e.n}`;
    case "dist": return e.n > 0 ? `拉近 ${e.n} 格` : `推開 ${-e.n} 格`;
    case "stance": return e.k === "slip" ? "閃開下一擊" : e.k === "sprawl" ? "防住抱摔" : `接招反擊 ${e.dmg}`;
    case "takedown": return `抱摔（控制 ${e.control}）`;
    case "pull": return "拉進防守";
    case "control": return `控制 +${e.n}`;
    case "lock": return `鎖技 +${e.n}`;
    case "breakLock": return `拆鎖 −${e.n}`;
    case "escape": return `脫逃 −${e.n}`;
    case "sweep": return `反轉（控制≤${e.maxControl}）`;
    case "draw": return `抽 ${e.n} 張`;
  }
  return e.t;
}

export const cardText = (c) => c.effects.map(effectText).join("，");

const WHY = { range: "距離不對", energy: "能量不夠", role: "位置不對", zone: "位置不對", nohand: "手上沒有", edge: "到邊了", limit: "每手只能走一步" };
export const whyText = (w) => WHY[w] || w;

export function eventText(state, e) {
  const nm = (s) => state.data.fighters[state[s].id].short;
  const cn = (id) => state.data.cards[id]?.name || id;
  const dn = state.data.config.distance.names;
  switch (e.t) {
    case "play": return `${nm(e.side)} 出 ${cn(e.id)}${e.fb ? "（基本招）" : ""}`;
    case "whiff": return `${nm(e.side)} 的 ${cn(e.id)} 距離不對，沒有出手${e.kept ? "（牌留在手上）" : ""}`;
    case "canceled": return `${nm(e.side)} 的 ${cn(e.id)} 沒出成（${whyText(e.why)}）`;
    case "replan": return `${nm(e.side)} 臨場改了打法`;
    case "step": return `${nm(e.side)} ${e.d > 0 ? "上步" : "後退"}，現在${dn[e.dist]}`;
    case "dmg": return e.amt || e.abs ? `${nm(e.to)} 被打${AT[e.at]}：${e.amt} 傷害${e.abs ? `（擋掉 ${e.abs}）` : ""}` : `${nm(e.to)} 沒受傷`;
    case "slipped": return `${nm(e.side)} 閃開了`;
    case "countered": return `${nm(e.side)} 接招反擊`;
    case "sprawled": return `${nm(e.side)} 防住了抱摔`;
    case "stun": return `${nm(e.side)} 被打暈（下一手少 1 能量，受傷 +25%）`;
    case "winded": return `${nm(e.side)} 喘不過氣（下一手少抽牌）`;
    case "ground": return `${nm(e.top)} 把對手壓在地上`;
    case "standup": return e.why === "referee" ? "裁判叫起，雙方回到站立" : "脫逃成功，回到站立";
    case "control": return `${nm(e.side)} 控制升到 ${e.n}`;
    case "lock": return `${nm(e.side)} 鎖技 +${e.gain}（${e.n}/${state.data.config.ground.lockThreshold}）`;
    case "broke": return `${nm(e.side)} 拆開了鎖（剩 ${e.n}）`;
    case "escape": return `${nm(e.side)} 脫逃，控制剩 ${e.n}`;
    case "sweep": return `${nm(e.side)} 反轉成功，換成上位`;
    case "sweepFail": return `${nm(e.side)} 反轉失敗（控制太高）`;
    case "draw": return `${nm(e.side)} 抽了 ${e.n} 張`;
    case "round": return e.n > 1 ? `第 ${e.n} 回合開始，牌組全部洗回來` : `第 ${e.n} 回合開始`;
    case "roundEnd": return `第 ${e.n} 回合結束`;
    default: return null;
  }
}

/** Basic invariants, used by tests and the sim. */
export function checkInvariants(state) {
  const errs = [];
  for (const side of ["a", "b"]) {
    const S = state[side];
    const deck = state.data.fighters[S.id].deck;
    for (const zone of ["stand", "ground"]) {
      const total = Object.values(deck[zone]).reduce((x, y) => x + y, 0);
      const have = S.piles[zone].draw.length + S.piles[zone].discard.length + S.hand[zone].length;
      if (have !== total) errs.push(`${side} ${zone}: ${have} cards, deck has ${total}`);
      if (S.hand[zone].length > state.data.config.match.handLimit) errs.push(`${side} ${zone} hand over limit`);
    }
    if (S.energy < 0) errs.push(`${side} negative energy`);
    if (S.block < 0) errs.push(`${side} negative block`);
  }
  if (state.pos === "stand" && state.top) errs.push("top set while standing");
  if (state.pos === "ground" && !state.top) errs.push("ground without top");
  if (state.dist < 0 || state.dist > state.data.config.distance.max) errs.push("distance out of range");
  return errs;
}
