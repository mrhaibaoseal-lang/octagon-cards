// Octagon Cards — card bout engine (standing, prototype 0.2 of the card direction, 2026-11-09).
// Pure rules: no DOM, no clock. The browser and the simulation use this same file.
// All numbers and card properties come from rules/bout/*.json; the engine never compares card names.
// Spec: docs/GAME_DESIGN.md.
//
// One beat: both sides secretly pick one card (or a basic move) and may mark one other card to HOLD.
// Reveal → traps check → movement → feints → strikes. Then every unplayed card is thrown away except the held one,
// which stays (charged, and visible to the opponent), and four fresh cards are drawn.

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
    open: 0, // 破綻：這一手別人打你命中 +openBonus
    hand: [], // [{ id, charged }]；charged＝上一手蓄力留下來的（對手看得到）
    trap: null, // { id, left }：蓋著的預判牌（對手只知道有，不知道是什麼）
    landedLast: false, // 上一手有打中 → 連段牌變強
    hist: { advance: 0, retreat: 0, sidestep: 0, guard: 0, card: 0, feint: 0, trap: 0 },
    tagHist: {}, // 出過的牌的標籤次數（電腦用來學你的習慣）
    dealt: 0, // 這回合造成的傷害（判定用）
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
    pending: null, // 擊倒後等待「追擊／穩住」
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
/** The card the fighter is holding (charged) — public information. */
export const heldCard = (st, s) => st[s].hand.find((h) => h.charged)?.id || null;

function drawId(st, s) {
  const f = st.data.fighters[st[s].id];
  const dng = danger(st, s);
  const copies = (id) => st[s].hand.filter((h) => h.id === id).length;
  let total = 0;
  const ws = [];
  for (const [id, w] of Object.entries(f.weights)) {
    const card = st.data.cards[id];
    if (copies(id) >= st.data.config.handCopies) continue;
    const fits = card.range.includes(st.dist) ? st.data.config.drawRangeBias : 1; // cards that work at this distance come up more
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

/** Everything a fighter may choose this beat. ok=false rows are shown greyed out (why says why). */
export function actions(st, s) {
  const me = st[s];
  const out = [];
  me.hand.forEach((h, idx) => {
    const card = st.data.cards[h.id];
    const inRange = card.range.includes(st.dist);
    const afford = card.cost <= me.stamina;
    const trapBusy = card.kind === "trap" && !!me.trap;
    out.push({ kind: "card", idx, id: h.id, charged: h.charged, cost: card.cost, ok: inRange && afford && !trapBusy, why: !inRange ? "range" : !afford ? "stamina" : trapBusy ? "trap" : null });
  });
  for (const [id, mv] of Object.entries(st.data.config.moves)) {
    const cost = moveCost(st, s, id);
    const pointless = (mv.dist > 0 && st.dist >= 3) || (mv.dist < 0 && st.dist <= 0);
    out.push({ kind: "move", id, cost, ok: cost <= me.stamina && !pointless, why: pointless ? "edge" : cost > me.stamina ? "stamina" : null });
  }
  return out;
}

/** Is the combo bonus live for s (they landed last beat)? */
export const comboLive = (st, s, card) => !!card.combo && st[s].landedLast;

/** Hit chance of a strike thrown by s. oppMove = the opponent's basic move this beat (unknown while choosing → null). */
export function hitChance(st, s, card, boost = false, oppMove = null) {
  const c = st.data.config;
  const me = st[s];
  const opp = st[other(s)];
  const f = st.data.fighters[me.id];
  let p = card.hit + (f.skill?.[card.id] || 0);
  const why = [];
  if (opp.open > 0) { p += c.hit.openBonus; why.push("open"); }
  if (comboLive(st, s, card)) { p += c.combo.hitBonus; why.push("combo"); }
  if (me.stamina / me.staminaMax < c.stamina.low) { p -= c.stamina.lowPenalty; why.push("tired"); }
  if (boost) p += c.boost.hitBonus;
  if (oppMove) {
    if (card.counter && card.counter === oppMove) { p += c.hit.counterBonus; why.push("counter"); }
    const mv = c.moves[oppMove];
    if (mv?.guard) p -= mv.guard.hit[card.region] || 0;
    if (mv?.evade) p -= mv.evade;
  }
  return { p: clamp(p, c.hit.min, c.hit.max), why };
}

/** Damage multiplier a strike would get before guard (charged / combo / boost). */
export function dmgMul(st, s, card, charged, boost) {
  const c = st.data.config;
  return (charged ? c.charge.dmgMul : 1) * (comboLive(st, s, card) ? c.combo.dmgMul : 1) * (boost ? c.boost.dmgMul : 1);
}

function validate(st, s, ch) {
  const me = st[s];
  if (ch.hold != null && (ch.hold === ch.card || !me.hand[ch.hold])) throw new Error("bad hold");
  if (ch.move) {
    if (!st.data.config.moves[ch.move]) throw new Error(`unknown move ${ch.move}`);
    if (moveCost(st, s, ch.move) > me.stamina) throw new Error("not enough stamina");
    return;
  }
  const h = me.hand[ch.card];
  if (!h) throw new Error("no such card");
  const card = st.data.cards[h.id];
  if (!card.range.includes(st.dist)) throw new Error("out of range");
  if (card.kind === "trap" && me.trap) throw new Error("trap already set");
  if (card.cost + (ch.boost ? st.data.config.boost.cost : 0) > me.stamina) throw new Error("not enough stamina");
}

const describe = (a) => (a.kind === "move" ? { kind: "move", id: a.id } : { kind: a.card.kind, id: a.card.id, boost: a.boost, charged: a.charged });

/** Does a trap card fire against this action of its owner's opponent? */
function trapFires(trap, act) {
  const on = trap.on;
  if (on.move) return act.kind === "move" && act.id === on.move;
  if (on.tag) return act.kind !== "move" && act.card.kind === "strike" && act.card.tags.includes(on.tag);
  return false;
}

function applyHit(st, s, card, dmg, ev, e) {
  const c = st.data.config;
  const me = st[s];
  const t = other(s);
  const tg = st[t];
  me.landed++;
  me.dealt += dmg * c.damageWeight[card.region];
  e.dmg = Math.round(dmg * 10) / 10;
  if (card.region === "head") {
    tg.head += dmg;
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
 * Resolve one beat. ca/cb = { card: handIndex, boost?: true, hold?: handIndex } or { move: "advance"|..., hold?: handIndex }.
 * Returns the event list. If a knockdown happened, st.pending is set and the caller must call settleKnockdown().
 */
export function playBeat(st, ca, cb) {
  if (st.over) throw new Error("bout is over");
  if (st.pending) throw new Error("knockdown pending");
  const c = st.data.config;
  const ev = (st.events = []);
  const ch = { a: ca, b: cb };
  for (const s of SIDES) validate(st, s, ch[s]);

  // pay, take the played card out, remember what is held
  const acts = {};
  for (const s of SIDES) {
    const me = st[s];
    const x = ch[s];
    const holdId = x.hold != null ? me.hand[x.hold].id : null;
    if (x.move) {
      me.stamina -= moveCost(st, s, x.move);
      acts[s] = { kind: "move", id: x.move, holdId };
      me.hist[x.move]++;
    } else {
      const h = me.hand[x.card];
      const card = st.data.cards[h.id];
      me.stamina -= card.cost + (x.boost ? c.boost.cost : 0);
      acts[s] = { kind: card.kind, card, boost: !!x.boost, charged: h.charged, holdId };
      me.hist[card.kind === "strike" ? "card" : card.kind]++;
      for (const tg of card.tags) me.tagHist[tg] = (me.tagHist[tg] || 0) + 1;
      if (card.kind === "strike") me.thrown++;
    }
  }
  st.lastActs = acts;
  ev.push({ t: "reveal", a: describe(acts.a), b: describe(acts.b) });

  // traps set on earlier beats fire first; a fired trap can cancel the action that tripped it
  const cancelled = { a: false, b: false };
  const kd = {};
  for (const s of SIDES) {
    const me = st[s];
    if (!me.trap) continue;
    const trap = st.data.cards[me.trap.id];
    const vs = acts[other(s)];
    if (trapFires(trap.trap, vs)) {
      me.trap = null;
      const e = { t: "trap", by: s, id: trap.id, region: trap.region, cancel: !!trap.trap.cancel && vs.kind !== "move" };
      if (e.cancel) cancelled[other(s)] = true;
      const dmg = trap.trap.dmg * st.data.fighters[me.id].power;
      if (applyHit(st, s, trap, dmg, ev, e)) kd[s] = other(s);
      ev.push(e);
    }
  }
  // a newly played trap goes down face-down (it works from the next beat)
  for (const s of SIDES) {
    const a = acts[s];
    if (a.kind === "trap") {
      st[s].trap = { id: a.card.id, left: a.card.trap.beats };
      ev.push({ t: "trapSet", by: s });
    }
  }

  // movement
  const before = st.dist;
  let d = before;
  for (const s of SIDES) if (acts[s].kind === "move") d += c.moves[acts[s].id].dist;
  st.dist = clamp(d, 0, 3);
  if (st.dist !== before) ev.push({ t: "move", from: before, to: st.dist });

  const nextOpen = { a: 0, b: 0 };
  // feints: if the opponent defended, they are open next beat
  for (const s of SIDES) {
    const a = acts[s];
    if (a.kind !== "feint") continue;
    const vs = acts[other(s)];
    const ok = vs.kind === "move" && a.card.feint.against.includes(vs.id);
    if (ok) nextOpen[other(s)] = Math.max(nextOpen[other(s)], a.card.feint.open);
    ev.push({ t: "feint", by: s, id: a.card.id, ok });
  }

  // strikes, rolled against the state before any damage (simultaneous)
  const res = {};
  for (const s of SIDES) {
    const a = acts[s];
    if (a.kind !== "strike") continue;
    if (cancelled[s]) {
      ev.push({ t: "attack", by: s, id: a.card.id, region: a.card.region, hit: false, whiff: "trapped", p: 0, why: [] });
      res[s] = { hit: false, trapped: true };
      continue;
    }
    const oppMove = acts[other(s)].kind === "move" ? acts[other(s)].id : null;
    const hc = hitChance(st, s, a.card, a.boost, oppMove);
    const roll = rand(st);
    const inRange = a.card.range.includes(st.dist);
    res[s] = { card: a.card, boost: a.boost, charged: a.charged, p: hc.p, why: hc.why, inRange, hit: inRange && roll < hc.p, oppMove, mul: dmgMul(st, s, a.card, a.charged, a.boost) };
  }
  let push = 0;
  for (const s of SIDES) {
    const r = res[s];
    if (!r || r.trapped) continue;
    const e = { t: "attack", by: s, id: r.card.id, boost: r.boost, charged: r.charged, p: r.p, region: r.card.region, hit: r.hit, whiff: r.hit ? null : r.inRange ? "miss" : "range", why: r.why };
    if (r.hit) {
      const guardMv = r.oppMove ? c.moves[r.oppMove] : null;
      const gm = guardMv?.dmgMul ? guardMv.dmgMul[r.card.region] : 1;
      const dmg = r.card.dmg * st.data.fighters[st[s].id].power * r.mul * gm;
      if (applyHit(st, s, r.card, dmg, ev, e)) kd[s] = other(s);
      if (r.card.push) push += r.card.push;
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
    st[s].landedLast = !!res[s]?.hit;
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
    const pay = Math.min(atk.stamina, c.chase.cost);
    atk.stamina -= pay;
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
    if (me.trap && --me.trap.left <= 0) me.trap = null;
    // throw away everything except the held card; the held card is charged
    const kept = [];
    if (a?.holdId) {
      const h = me.hand.find((x) => x.id === a.holdId);
      if (h) kept.push({ id: h.id, charged: true });
    }
    // the played card is gone even if it had the same id as the held one
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

/** Seconds left on the round clock (display only). */
export const clock = (st) => (st.data.config.beatsPerRound - st.beat) * st.data.config.secondsPerBeat;

/** Cheap self-check used by tests and the simulation. */
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
