// Octagon Cards — card bout engine (standing, prototype 0.3 of the card direction, 2026-11-09).
// Pure rules: no DOM, no clock. The browser and the simulation use this same file.
// All numbers and card properties come from rules/bout/*.json; the engine never compares card names.
// Spec: docs/GAME_DESIGN.md.
//
// One beat, chosen secretly by both sides at once:
//   main action  = a card (with a STEP: back / stay / in) or a basic move (advance, retreat, sidestep, guard)
//   side actions = HOLD one other card to next beat (charged, public) and/or SET one trap card face-down
// Reveal → old traps check → movement (steps + moves) → feints → strikes. Most strikes land (graze or clean);
// only ~10-15% miss outright. Then the unplayed cards are thrown away except the held one, and four fresh cards are drawn.

export const other = (s) => (s === "a" ? "b" : "a");
export const SIDES = ["a", "b"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function rand(st) {
  const a = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Put ids and defaults onto the card table. Call once after loading the JSON. */
export function prepare(data) {
  for (const [id, c] of Object.entries(data.cards)) {
    if (id.startsWith("_")) continue;
    c.id = id;
    c.kind = c.kind || "strike";
    c.tags = c.tags || [];
    c.range = c.range || [0, 1, 2, 3];
  }
  return data;
}
export const cardIds = (data) => Object.keys(data.cards).filter((k) => !k.startsWith("_"));

function newFighter(data, id) {
  const f = data.fighters[id];
  const c = data.config;
  return {
    id,
    name: f.name,
    short: f.short,
    stamina: c.stamina.max,
    staminaMax: c.stamina.max,
    head: 0,
    body: 0,
    leg: 0,
    knockdowns: 0,
    open: 0, // 破綻：這一手別人打你更容易打實
    hand: [], // [{ id, charged }]；charged＝上一手蓄力留下來的（對手看得到）
    trap: null, // { id, left }：埋著的預判牌（對手只知道有，不知道是什麼）
    landedLast: false, // 上一手有打實 → 連段牌變強
    hist: { advance: 0, retreat: 0, sidestep: 0, guard: 0, card: 0, feint: 0, stepIn: 0, stepOut: 0 },
    tagHist: {},
    dealt: 0,
    kdTaken: 0,
    landed: 0,
    thrown: 0,
  };
}

export function createBout(data, idA, idB, seed = 1) {
  const st = {
    data,
    rng: seed >>> 0,
    round: 0,
    beat: 0,
    dist: data.config.dist.start,
    a: newFighter(data, idA),
    b: newFighter(data, idB),
    over: null,
    pending: null,
    rounds: [],
    events: [],
    nextOpen: { a: 0, b: 0 },
    lastActs: null,
  };
  for (const s of SIDES) refill(st, s);
  return st;
}

export const headRatio = (st, s) => st[s].head / st.data.fighters[st[s].id].chin;
export const danger = (st, s) => headRatio(st, s) >= st.data.config.head.dangerRatio;
export const limping = (st, s) => st[s].leg >= st.data.config.leg.limp;
export const heldCard = (st, s) => st[s].hand.find((h) => h.charged)?.id || null;
/** Bonus to clean hits a fighter gets at distance d (their favourite range). */
export const rangeBonus = (st, s, d) => st.data.fighters[st[s].id].rangeBonus?.[d] || 0;

function drawId(st, s) {
  const f = st.data.fighters[st[s].id];
  const dng = danger(st, s);
  const copies = (id) => st[s].hand.filter((h) => h.id === id).length;
  let total = 0;
  const ws = [];
  for (const [id, w] of Object.entries(f.weights)) {
    const card = st.data.cards[id];
    if (copies(id) >= st.data.config.handCopies) continue;
    const near = card.range.some((d) => Math.abs(d - st.dist) <= 1);
    const fits = near ? st.data.config.drawRangeBias : 1;
    const k = w * fits * (card.rarity === "sig" && dng ? st.data.config.head.sigDangerBoost : 1);
    ws.push([id, k]);
    total += k;
  }
  let r = rand(st) * total;
  for (const [id, k] of ws) if ((r -= k) < 0) return id;
  return ws[ws.length - 1][0];
}
function refill(st, s) {
  const c = st.data.config;
  for (let i = 0; i < c.handDraw && st[s].hand.length < c.handMax; i++) st[s].hand.push({ id: drawId(st, s), charged: false });
}

export function moveCost(st, s, id) {
  const mv = st.data.config.moves[id];
  const extra = limping(st, s) && mv.dist !== 0 ? st.data.config.leg.moveCost : 0;
  return mv.cost + extra;
}
export const stepCost = (st, s, step) => (step ? st.data.config.step.cost + (limping(st, s) ? st.data.config.leg.moveCost : 0) : 0);
export const stepOk = (st, s, step) => st.dist + step >= 0 && st.dist + step <= 3 && stepCost(st, s, step) <= st[s].stamina;

/**
 * What a fighter may choose this beat, given the step they plan (-1 back, 0, +1 in).
 * Trap cards are never the main action: ok means "can be set this beat" (side action).
 */
export function actions(st, s, step = 0) {
  const me = st[s];
  const out = [];
  const d = clamp(st.dist + step, 0, 3);
  me.hand.forEach((h, idx) => {
    const card = st.data.cards[h.id];
    if (card.kind === "trap") {
      const ok = !me.trap && card.cost <= me.stamina;
      out.push({ kind: "card", idx, id: h.id, charged: h.charged, cost: card.cost, side: true, ok, why: me.trap ? "trap" : ok ? null : "stamina" });
      return;
    }
    const inRange = card.range.includes(d);
    const afford = card.cost + stepCost(st, s, step) <= me.stamina;
    out.push({ kind: "card", idx, id: h.id, charged: h.charged, cost: card.cost, ok: inRange && afford, why: !inRange ? "range" : !afford ? "stamina" : null });
  });
  for (const [id, mv] of Object.entries(st.data.config.moves)) {
    const cost = moveCost(st, s, id);
    const pointless = (mv.dist > 0 && st.dist >= 3) || (mv.dist < 0 && st.dist <= 0);
    out.push({ kind: "move", id, cost, ok: cost <= me.stamina && !pointless, why: pointless ? "edge" : cost > me.stamina ? "stamina" : null });
  }
  return out;
}

export const comboLive = (st, s, card) => !!card.combo && st[s].landedLast;

/**
 * Odds of a strike thrown by s at distance d.
 * land  = chance it touches at all (most do); clean = chance a landed strike is clean (full damage) instead of a graze.
 * exp   = expected share of the card's damage (used by the AI).
 * opp   = the opponent's revealed action, if known: { move } or { step }.
 */
export function odds(st, s, card, { boost = false, opp = null, d = st.dist } = {}) {
  const c = st.data.config;
  const h = c.hit;
  const me = st[s];
  const op = st[other(s)];
  const f = st.data.fighters[me.id];
  const tired = me.stamina / me.staminaMax < c.stamina.low;
  let miss = h.baseMiss + (tired ? h.tiredMiss : 0) + (boost ? h.boostMiss : 0);
  let clean = card.hit + (f.skill?.[card.id] || 0);
  const why = [];
  const rb = rangeBonus(st, s, d);
  if (rb) { clean += rb; why.push("range"); }
  if (op.open > 0) { clean += h.openBonus; why.push("open"); }
  if (comboLive(st, s, card)) { clean += c.combo.hitBonus; why.push("combo"); }
  if (tired) { clean -= c.stamina.lowPenalty; why.push("tired"); }
  if (boost) clean += c.boost.hitBonus;
  if (opp) {
    const advancing = opp.move === "advance" || opp.step > 0;
    if (card.counter === "advance" && advancing) { clean += h.counterBonus; why.push("counter"); }
    const mv = opp.move ? c.moves[opp.move] : null;
    if (mv?.guard) clean -= mv.guard.hit[card.region] || 0;
    if (mv?.evade) miss += mv.evade;
  }
  miss = clamp(miss, h.minMiss, h.maxMiss);
  clean = clamp(clean, h.cleanMin, h.cleanMax);
  const land = 1 - miss;
  return { land, clean, exp: land * (clean + (1 - clean) * h.grazeMul), why };
}

export function dmgMul(st, s, card, charged, boost) {
  const c = st.data.config;
  return (charged ? c.charge.dmgMul : 1) * (comboLive(st, s, card) ? c.combo.dmgMul : 1) * (boost ? c.boost.dmgMul : 1);
}

function validate(st, s, ch) {
  const me = st[s];
  const step = ch.step || 0;
  if (ch.hold != null && (ch.hold === ch.card || ch.hold === ch.trap || !me.hand[ch.hold])) throw new Error("bad hold");
  let cost = 0;
  if (ch.trap != null) {
    const t = me.hand[ch.trap];
    if (!t || st.data.cards[t.id].kind !== "trap" || ch.trap === ch.card) throw new Error("bad trap");
    if (me.trap) throw new Error("trap already set");
    cost += st.data.cards[t.id].cost;
  }
  if (ch.move) {
    if (!st.data.config.moves[ch.move]) throw new Error(`unknown move ${ch.move}`);
    if (step) throw new Error("a basic move has no extra step");
    cost += moveCost(st, s, ch.move);
  } else {
    const h = me.hand[ch.card];
    if (!h) throw new Error("no such card");
    const card = st.data.cards[h.id];
    if (card.kind === "trap") throw new Error("traps are set, not played");
    if (![-1, 0, 1].includes(step) || !stepOk(st, s, step)) throw new Error("bad step");
    if (!card.range.includes(st.dist + step)) throw new Error("out of range");
    cost += card.cost + (ch.boost ? st.data.config.boost.cost : 0) + stepCost(st, s, step);
  }
  if (cost > me.stamina + 1e-9) throw new Error("not enough stamina");
}

const describe = (a) => (a.kind === "move" ? { kind: "move", id: a.id, trapSet: a.trapSet } : { kind: a.card.kind, id: a.card.id, boost: a.boost, charged: a.charged, step: a.step, trapSet: a.trapSet });

/** Does a trap fire against this action of its owner's opponent? */
function trapFires(trap, act) {
  const on = trap.on;
  if (on.move === "advance") return (act.kind === "move" && act.id === "advance") || act.step > 0;
  if (on.move) return act.kind === "move" && act.id === on.move;
  if (on.tag) return act.kind === "strike" && act.card.tags.includes(on.tag);
  return false;
}

function applyDamage(st, s, card, dmg, e, canKO) {
  const c = st.data.config;
  const me = st[s];
  const t = other(s);
  const tg = st[t];
  me.landed++;
  me.dealt += dmg * c.damageWeight[card.region];
  e.dmg = Math.round(dmg * 10) / 10;
  if (card.region === "head") {
    tg.head += dmg;
    if (!canKO) return false;
    const ratio = headRatio(st, t);
    const heavy = card.heavy ? 1 : c.head.koLight;
    const pk = clamp((card.ko || 0) * (1 + ratio) + Math.max(0, ratio - c.head.koDanger) * c.head.koScale * heavy, 0, c.head.koCap);
    e.koP = Math.round(pk * 1000) / 1000;
    return rand(st) < pk;
  }
  if (card.region === "body") {
    tg.body += dmg;
    tg.stamina = Math.max(0, tg.stamina - dmg * c.body.drain);
  } else tg.leg += dmg;
  return false;
}

/**
 * Resolve one beat. Choice: { card, step?, boost?, hold?, trap? } or { move, hold?, trap? }.
 * Returns the event list. If a knockdown happened, st.pending is set and the caller must call settleKnockdown().
 */
export function playBeat(st, ca, cb) {
  if (st.over) throw new Error("bout is over");
  if (st.pending) throw new Error("knockdown pending");
  const c = st.data.config;
  const ev = (st.events = []);
  const ch = { a: ca, b: cb };
  for (const s of SIDES) validate(st, s, ch[s]);

  const acts = {};
  for (const s of SIDES) {
    const me = st[s];
    const x = ch[s];
    const holdId = x.hold != null ? me.hand[x.hold].id : null;
    const trapCard = x.trap != null ? st.data.cards[me.hand[x.trap].id] : null;
    if (trapCard) me.stamina -= trapCard.cost;
    if (x.move) {
      me.stamina -= moveCost(st, s, x.move);
      acts[s] = { kind: "move", id: x.move, step: 0, holdId, trapCard };
      me.hist[x.move]++;
    } else {
      const h = me.hand[x.card];
      const card = st.data.cards[h.id];
      const step = x.step || 0;
      me.stamina -= card.cost + (x.boost ? c.boost.cost : 0) + stepCost(st, s, step);
      acts[s] = { kind: card.kind, card, step, boost: !!x.boost, charged: h.charged, holdId, trapCard };
      me.hist[card.kind === "strike" ? "card" : card.kind]++;
      if (step > 0) me.hist.stepIn++;
      if (step < 0) me.hist.stepOut++;
      for (const tg of card.tags) me.tagHist[tg] = (me.tagHist[tg] || 0) + 1;
      if (card.kind === "strike") me.thrown++;
    }
    acts[s].trapSet = !!trapCard;
  }
  st.lastActs = acts;
  ev.push({ t: "reveal", a: describe(acts.a), b: describe(acts.b) });

  const nextOpen = { a: 0, b: 0 };
  const cancelled = { a: false, b: false };
  const kd = {};
  // traps set on earlier beats fire first: always a clean hit, may cancel the strike, leaves the victim open
  for (const s of SIDES) {
    const me = st[s];
    if (!me.trap) continue;
    const trap = st.data.cards[me.trap.id];
    const vs = acts[other(s)];
    if (!trapFires(trap.trap, vs)) continue;
    me.trap = null;
    const e = { t: "trap", by: s, id: trap.id, region: trap.region, cancel: !!trap.trap.cancel && vs.kind === "strike" };
    if (e.cancel) cancelled[other(s)] = true;
    nextOpen[other(s)] = Math.max(nextOpen[other(s)], trap.trap.open || 0);
    if (applyDamage(st, s, trap, trap.trap.dmg * st.data.fighters[me.id].power, e, true)) kd[s] = other(s);
    ev.push(e);
  }
  // traps set this beat go down face-down (they work from the next beat)
  for (const s of SIDES) {
    const t = acts[s].trapCard;
    if (t) {
      st[s].trap = { id: t.id, left: t.trap.beats };
      ev.push({ t: "trapSet", by: s });
    }
  }

  // movement: basic moves and the steps that came with cards
  const before = st.dist;
  let d = before;
  for (const s of SIDES) d += acts[s].kind === "move" ? c.moves[acts[s].id].dist : acts[s].step;
  st.dist = clamp(d, 0, 3);
  if (st.dist !== before) ev.push({ t: "move", from: before, to: st.dist });

  // feints: if the opponent defended (or stepped away, for feints that list "retreat"), they are open next beat
  for (const s of SIDES) {
    const a = acts[s];
    if (a.kind !== "feint") continue;
    const vs = acts[other(s)];
    const against = a.card.feint.against;
    const ok = (vs.kind === "move" && against.includes(vs.id)) || (against.includes("retreat") && vs.step < 0);
    if (ok) nextOpen[other(s)] = Math.max(nextOpen[other(s)], a.card.feint.open);
    ev.push({ t: "feint", by: s, id: a.card.id, ok });
  }

  // strikes, rolled against the state before any damage (simultaneous)
  const res = {};
  for (const s of SIDES) {
    const a = acts[s];
    if (a.kind !== "strike") continue;
    if (cancelled[s]) {
      ev.push({ t: "attack", by: s, id: a.card.id, region: a.card.region, hit: false, whiff: "trapped", land: 0, clean: 0, why: [] });
      res[s] = { trapped: true };
      continue;
    }
    const vs = acts[other(s)];
    // each fighter steps into his own strike: the opponent's card-step does not carry him out of range,
    // only a full basic move (retreat / advance) does
    const at = clamp(before + a.step + (vs.kind === "move" ? c.moves[vs.id].dist : 0), 0, 3);
    const o = odds(st, s, a.card, { boost: a.boost, opp: vs.kind === "move" ? { move: vs.id } : { step: vs.step }, d: at });
    const inRange = a.card.range.includes(at);
    const landed = inRange && rand(st) < o.land;
    const clean = landed && rand(st) < o.clean;
    res[s] = { card: a.card, boost: a.boost, charged: a.charged, o, inRange, hit: landed, clean, guardMv: vs.kind === "move" ? c.moves[vs.id] : null, mul: dmgMul(st, s, a.card, a.charged, a.boost) };
  }
  let push = 0;
  for (const s of SIDES) {
    const r = res[s];
    if (!r || r.trapped) continue;
    const e = { t: "attack", by: s, id: r.card.id, boost: r.boost, charged: r.charged, land: r.o.land, clean: r.o.clean, region: r.card.region, hit: r.hit, quality: r.hit ? (r.clean ? "clean" : "graze") : null, whiff: r.hit ? null : r.inRange ? "miss" : "range", why: r.o.why };
    if (r.hit) {
      const gm = r.guardMv?.dmgMul ? r.guardMv.dmgMul[r.card.region] : 1;
      const dmg = r.card.dmg * st.data.fighters[st[s].id].power * r.mul * gm * (r.clean ? 1 : c.hit.grazeMul);
      if (applyDamage(st, s, r.card, dmg, e, r.clean)) kd[s] = other(s);
      if (r.clean && r.card.push) push += r.card.push;
    } else if (r.card.heavy) {
      nextOpen[s] = 1;
      e.openSelf = true;
    }
    ev.push(e);
  }
  if (push) {
    const from = st.dist;
    st.dist = clamp(st.dist - push, 0, 3);
    if (st.dist !== from) ev.push({ t: "move", from, to: st.dist, push: true });
  }
  for (const s of SIDES) {
    st[s].landedLast = !!res[s]?.clean;
    st[s].staminaMax = Math.max(c.stamina.min, c.stamina.max - st[s].body * c.body.maxLoss);
    st[s].stamina = Math.min(st[s].stamina, st[s].staminaMax);
  }

  if (kd.a && kd.b) {
    ev.push({ t: "clash" });
    nextOpen.a = nextOpen.b = 1;
  } else if (kd.a || kd.b) {
    const by = kd.a ? "a" : "b";
    st.pending = { by, down: kd[by] };
    ev.push({ t: "knockdown", by, down: kd[by] });
  }
  st.nextOpen = nextOpen;
  if (!st.pending) endBeat(st);
  return ev;
}

/** After a knockdown: the attacker chases (true) or holds (false). */
export function settleKnockdown(st, chase) {
  const p = st.pending;
  if (!p) throw new Error("no knockdown pending");
  const c = st.data.config;
  const ev = (st.events = []);
  const atk = st[p.by];
  const dn = st[p.down];
  st.pending = null;
  dn.knockdowns++;
  dn.kdTaken++;
  dn.stamina = Math.max(0, dn.stamina - c.knockdown.staminaLoss);
  atk.dealt += c.scoring.knockdownBonus;
  if (dn.knockdowns >= c.knockdown.maxCount) {
    finish(st, p.by, "TKO（三次倒地）");
    return ev;
  }
  if (chase) {
    atk.stamina -= Math.min(atk.stamina, c.chase.cost);
    const tired = dn.stamina / dn.staminaMax < c.stamina.low ? c.chase.tiredBonus : 0;
    const pf = chaseOdds(st, p.down) + tired;
    const win = rand(st) < pf;
    ev.push({ t: "chase", by: p.by, down: p.down, p: pf, finished: win });
    if (win) {
      finish(st, p.by, "KO／TKO");
      return ev;
    }
    st.nextOpen[p.by] = 1;
  } else {
    dn.head *= c.hold.headRelief;
    dn.stamina = Math.min(dn.staminaMax, dn.stamina + c.hold.recoverStamina);
    ev.push({ t: "hold", by: p.by, down: p.down });
  }
  endBeat(st);
  return ev;
}
export const chaseOdds = (st, down) => {
  const c = st.data.config.chase;
  return clamp(c.finishBase + c.finishPerHead * Math.min(1.5, headRatio(st, down)), 0, c.finishMax);
};

function endBeat(st) {
  const c = st.data.config;
  const acts = st.lastActs;
  for (const s of SIDES) {
    const me = st[s];
    const f = st.data.fighters[me.id];
    const a = acts?.[s];
    const mvRegen = a?.kind === "move" ? c.moves[a.id].regen || 0 : 0;
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.regen * f.cardio + mvRegen);
    me.open = st.nextOpen[s];
    if (me.trap && !a?.trapSet && --me.trap.left <= 0) me.trap = null;
    const kept = [];
    if (a?.holdId) {
      const h = me.hand.find((x) => x.id === a.holdId);
      if (h) kept.push({ id: h.id, charged: true });
    }
    me.hand = kept;
    refill(st, s);
  }
  st.nextOpen = { a: 0, b: 0 };
  st.beat++;
  if (st.beat >= c.beatsPerRound) endRound(st);
}

function endRound(st) {
  const c = st.data.config;
  const entry = {
    round: st.round + 1,
    dealt: { a: st.a.dealt, b: st.b.dealt },
    kd: { a: st.a.kdTaken, b: st.b.kdTaken },
    landed: { a: st.a.landed, b: st.b.landed },
  };
  st.rounds.push(entry);
  st.events.push({ t: "roundEnd", ...entry });
  for (const s of SIDES) {
    const me = st[s];
    me.dealt = 0;
    me.kdTaken = 0;
    me.landed = 0;
    me.thrown = 0;
    me.open = 0;
    me.trap = null;
    me.landedLast = false;
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.roundRecover);
  }
  st.round++;
  st.beat = 0;
  if (st.round >= c.rounds) decide(st);
}

function judge(st) {
  const c = st.data.config.scoring;
  const cards = [];
  for (let j = 0; j < c.judges; j++) {
    let a = 0, b = 0;
    for (const r of st.rounds) {
      const tot = Math.max(1, r.dealt.a + r.dealt.b);
      const diff = (r.dealt.a - r.dealt.b) / tot + (rand(st) - 0.5) * 2 * c.judgeNoise;
      const win = diff === 0 ? (r.landed.a >= r.landed.b ? "a" : "b") : diff > 0 ? "a" : "b";
      const loseKd = win === "a" ? r.kd.b : r.kd.a;
      const loser = 10 - 1 - Math.min(2, loseKd);
      if (win === "a") { a += 10; b += loser; } else { b += 10; a += loser; }
    }
    cards.push([a, b]);
  }
  return cards;
}

function decide(st) {
  const cards = judge(st);
  let wa = 0, wb = 0;
  for (const [a, b] of cards) { if (a > b) wa++; else if (b > a) wb++; }
  const winner = wa > wb ? "a" : wb > wa ? "b" : null;
  const method = winner ? (wa === 3 || wb === 3 ? "一致判定" : "分歧判定") : "平手";
  finish(st, winner, method, cards);
}

function finish(st, winner, method, cards = null) {
  st.over = { winner, method, round: st.round + 1, beat: st.beat, cards };
  st.events.push({ t: "end", ...st.over });
}

export const clock = (st) => (st.data.config.beatsPerRound - st.beat) * st.data.config.secondsPerBeat;

export function checkInvariants(st) {
  const c = st.data.config;
  for (const s of SIDES) {
    const f = st[s];
    if (!(f.stamina >= -1e-9 && f.stamina <= f.staminaMax + 1e-9)) throw new Error(`stamina out of range: ${f.stamina}`);
    if (f.hand.length > c.handMax) throw new Error("hand too big");
    if (f.hand.filter((h) => h.charged).length > 1) throw new Error("more than one held card");
    if (f.head < 0 || f.body < 0 || f.leg < 0) throw new Error("negative damage");
  }
  if (st.dist < 0 || st.dist > 3) throw new Error("distance out of range");
}
