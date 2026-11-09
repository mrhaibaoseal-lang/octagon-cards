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

const newRhist = () => ({ card: 0, feint: 0, advance: 0, retreat: 0, sidestep: 0, guard: 0, stepIn: 0, stepOut: 0, head: 0, body: 0, leg: 0, td: 0, tdOk: 0, gbeats: 0 });

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
    hist: { advance: 0, retreat: 0, sidestep: 0, guard: 0, card: 0, feint: 0, takedown: 0, sprawl: 0, stepIn: 0, stepOut: 0 },
    ghist: { pound: 0, advance: 0, sub: 0, sweep: 0, escape: 0, getup: 0, ride: 0, release: 0, defend: 0 }, // 地面習慣（AI 看得到）
    rhist: newRhist(), // 這一回合的習慣（回合結束時存進 rounds，教練從這裡看）
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
    mode: "stand", // "stand" | "ground"
    ground: null, // { top: "a"|"b", pos: 0 護腿 | 1 壓制 | 2 背後, stall }
    subPending: null, // 降伏小遊戲進行中：{ by, cardId, meter, round }
    switched: false, // 這一手換了場景或換了上下位：留牌失效
    a: newFighter(data, idA),
    b: newFighter(data, idB),
    over: null,
    pending: null,
    rounds: [],
    events: [],
    nextOpen: { a: 0, b: 0 },
    lastActs: null,
    plan: { a: { plan: "steady", target: null }, b: { plan: "steady", target: null } }, // 這回合的暗選計畫
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

/** Does a card satisfy a plan's `when` clause? Only properties, never names. */
function matches(card, when) {
  if (when.kind && card.kind !== when.kind) return false;
  if (when.tag && !card.tags.includes(when.tag)) return false;
  if (when.region && card.region !== when.region) return false;
  if (when.heavy && !card.heavy) return false;
  if (when.counter && !card.counter) return false;
  if (when.near && !(card.kind === "strike" && Math.min(...card.range) >= 2)) return false;
  return true;
}
/** How much this side's plan and target change how often a card is drawn. */
function planDraw(st, s, card) {
  const c = st.data.config;
  const pl = st.plan[s];
  let m = 1;
  for (const r of c.plans[pl.plan].draw || []) if (matches(card, r.when)) m *= r.mul;
  if (pl.target && card.kind === "strike" && card.region === pl.target) m *= c.target[pl.target].drawMul;
  return m;
}
/** How hurt is part `part` of fighter s, as a share of "this part is in real trouble" (1 = limping / dangerous / drained). */
export function partRatio(st, s, part) {
  const c = st.data.config;
  if (part === "head") return headRatio(st, s);
  if (part === "leg") return st[s].leg / c.leg.limp;
  return st[s].body / ((c.stamina.max - c.stamina.min) / c.body.maxLoss);
}
/** How much of the target bonus is live: small against a fresh part, full against one that is already hurt. */
export function targetScale(st, s, part) {
  const k = st.data.config.target._scale;
  return Math.min(k.cap, k.base + k.perRatio * partRatio(st, other(s), part));
}
/** Damage multiplier from the plan and the target part (own strikes only). */
export function planDmg(st, s, card) {
  const c = st.data.config;
  const pl = st.plan[s];
  let m = c.plans[pl.plan].dmgMul ?? 1;
  if (pl.target && card.region === pl.target) m *= 1 + (c.target[pl.target].dmgMul - 1) * targetScale(st, s, pl.target);
  return m;
}
const foeRetreat = (st, s) => st.data.config.plans[st.plan[other(s)].plan].foeRetreatCost || 0;

export const groundRole = (st, s) => (st.ground.top === s ? "top" : "bottom");
const groundFit = (card, role, pos) => card.role === role && card.pos.includes(pos);

/** On the ground the hand comes from the role's ground pool (top / bottom); only cards that fit the current position are dealt. */
function drawGround(st, s) {
  const f = st.data.fighters[st[s].id];
  const role = groundRole(st, s);
  const copies = (id) => st[s].hand.filter((h) => h.id === id).length;
  const ws = [];
  let total = 0;
  for (const [id, w] of Object.entries(f.groundWeights?.[role] || {})) {
    const card = st.data.cards[id];
    if (!groundFit(card, role, st.ground.pos) || copies(id) >= st.data.config.handCopies) continue;
    ws.push([id, w]);
    total += w;
  }
  if (!ws.length) return null;
  let r = rand(st) * total;
  for (const [id, k] of ws) if ((r -= k) < 0) return id;
  return ws[ws.length - 1][0];
}

function drawId(st, s) {
  if (st.mode === "ground") return drawGround(st, s);
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
    const k = w * fits * planDraw(st, s, card) * (card.rarity === "sig" && dng ? st.data.config.head.sigDangerBoost : 1);
    ws.push([id, k]);
    total += k;
  }
  let r = rand(st) * total;
  for (const [id, k] of ws) if ((r -= k) < 0) return id;
  return ws[ws.length - 1][0];
}
function refill(st, s) {
  const c = st.data.config;
  for (let i = 0; i < c.handDraw && st[s].hand.length < c.handMax; i++) {
    const id = drawId(st, s);
    if (id) st[s].hand.push({ id, charged: false });
  }
}

export function moveCost(st, s, id) {
  const mv = st.data.config.moves[id];
  const extra = limping(st, s) && mv.dist !== 0 ? st.data.config.leg.moveCost : 0;
  return mv.cost + extra + (mv.dist < 0 ? foeRetreat(st, s) : 0);
}
export const stepCost = (st, s, step) => (step ? st.data.config.step.cost + (limping(st, s) ? st.data.config.leg.moveCost : 0) + (step < 0 ? foeRetreat(st, s) : 0) : 0);
export const stepOk = (st, s, step) => st.dist + step >= 0 && st.dist + step <= 3 && stepCost(st, s, step) <= st[s].stamina;

/**
 * What a fighter may choose this beat, given the step they plan (-1 back, 0, +1 in).
 * Trap cards are never the main action: ok means "can be set this beat" (side action).
 */
export function actions(st, s, step = 0) {
  if (st.mode === "ground") return groundActions(st, s);
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
  const aim = st.plan[s].target;
  if (aim && card.region === aim) { clean += c.target[aim].clean * targetScale(st, s, aim); why.push("target"); }
  if (op.open > 0) { clean += h.openBonus; why.push("open"); }
  if (comboLive(st, s, card)) { clean += c.combo.hitBonus; why.push("combo"); }
  if (tired) { clean -= c.stamina.lowPenalty; why.push("tired"); }
  if (boost) clean += c.boost.hitBonus;
  if (opp) {
    const advancing = opp.move === "advance" || opp.step > 0;
    if (card.counter === "advance" && advancing) { clean += h.counterBonus; why.push("counter"); }
    if (card.breaks && opp.shoot) { clean += h.counterBonus; why.push("counter"); }
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
  return (charged ? c.charge.dmgMul : 1) * (comboLive(st, s, card) ? c.combo.dmgMul : 1) * (boost ? c.boost.dmgMul : 1) * planDmg(st, s, card);
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
    cost += card.cost + (ch.boost && card.kind === "strike" ? st.data.config.boost.cost : 0) + stepCost(st, s, step);
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

function applyDamage(st, s, card, dmg, e, canKO, koMul = 1) {
  const c = st.data.config;
  const me = st[s];
  const t = other(s);
  const tg = st[t];
  dmg *= c.plans[st.plan[t].plan].takenMul ?? 1;
  me.landed++;
  me.dealt += dmg * c.damageWeight[card.region];
  e.dmg = Math.round(dmg * 10) / 10;
  if (card.region === "head") {
    tg.head += dmg;
    if (!canKO) return false;
    const ratio = headRatio(st, t);
    const heavy = card.heavy ? 1 : c.head.koLight;
    const pk = clamp(((card.ko || 0) * (1 + ratio) + Math.max(0, ratio - c.head.koDanger) * c.head.koScale * heavy) * koMul, 0, c.head.koCap);
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
  if (st.subPending) throw new Error("submission pending");
  if (st.mode === "ground") return playGround(st, ca, cb);
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
      me.rhist[x.move]++;
    } else {
      const h = me.hand[x.card];
      const card = st.data.cards[h.id];
      const step = x.step || 0;
      const boost = !!x.boost && card.kind === "strike";
      me.stamina -= card.cost + (boost ? c.boost.cost : 0) + stepCost(st, s, step);
      acts[s] = { kind: card.kind, card, step, boost, charged: h.charged, holdId, trapCard };
      me.hist[card.kind === "strike" ? "card" : card.kind]++;
      const rk = card.kind === "strike" ? "card" : card.kind === "takedown" ? "td" : card.kind === "feint" ? "feint" : null;
      if (rk) me.rhist[rk]++;
      if (step > 0) { me.hist.stepIn++; me.rhist.stepIn++; }
      if (step < 0) { me.hist.stepOut++; me.rhist.stepOut++; }
      for (const tg of card.tags) me.tagHist[tg] = (me.tagHist[tg] || 0) + 1;
      if (card.kind === "strike") { me.thrown++; me.rhist[card.region]++; }
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
    const o = odds(st, s, a.card, { boost: a.boost, opp: vs.kind === "move" ? { move: vs.id } : { step: vs.step, shoot: vs.kind === "takedown" }, d: at });
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

  // takedown shots and sprawls: rolled in the same beat as the strikes; a knockdown cancels them
  const shooters = SIDES.filter((s) => acts[s].kind === "takedown");
  for (const s of SIDES) {
    if (acts[s].kind !== "sprawl") continue;
    if (acts[other(s)].kind !== "takedown") ev.push({ t: "sprawl", by: s, wasted: true });
  }
  if (shooters.length) {
    const t = c.takedown;
    const knocked = !!(kd.a || kd.b);
    const won = [];
    let stuffedBy = null;
    for (const s of shooters) {
      const a = acts[s];
      const vs = acts[other(s)];
      const at = clamp(before + a.step + (vs.kind === "move" ? c.moves[vs.id].dist : 0), 0, 3);
      const inRange = a.card.range.includes(at);
      const strike = vs.kind === "strike" ? vs.card : null;
      const o = tdOdds(st, s, a.card, { opp: { move: vs.kind === "move" ? vs.id : null, strikeHead: !!strike && strike.region === "head" && !strike.breaks, breakIt: !!strike && !!strike.breaks } });
      const sprawlP = vs.kind === "sprawl" ? sprawlOdds(st, other(s), vs.card) : 0;
      const sprawled = !knocked && inRange && vs.kind === "sprawl" && rand(st) < sprawlP;
      const ok = !knocked && inRange && !sprawled && rand(st) < o.p;
      const e = { t: "takedown", by: s, id: a.card.id, p: o.p, why: o.why, ok, whiff: knocked ? "ko" : !inRange ? "range" : sprawled ? "sprawled" : ok ? null : "stuffed", sprawlP };
      ev.push(e);
      if (ok) { won.push(s); st[s].rhist.tdOk++; }
      else {
        nextOpen[s] = Math.max(nextOpen[s], t.failOpen);
        if (sprawled) stuffedBy = other(s);
      }
    }
    if (won.length === 2) {
      ev.push({ t: "tdClash" });
      st.dist = 3;
    } else if (won.length === 1) {
      const s = won[0];
      st[s].dealt += t.score;
      startGround(st, s, acts[s].card.lands ?? 0, ev, "takedown");
    } else if (stuffedBy) {
      st[stuffedBy].dealt += t.score * t.stuffShare;
      startGround(st, stuffedBy, c.ground.sprawlPos, ev, "sprawl");
    }
    if (st.mode === "ground") nextOpen.a = nextOpen.b = 0;
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
    const pl = c.plans[st.plan[s].plan];
    const mvDef = a?.kind === "move" ? c.moves[a.id] || c.ground.moves[a.id] : null;
    const mvRegen = mvDef ? (mvDef.regen || 0) + (mvDef.guard ? pl.guardRegen || 0 : 0) : 0;
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.regen * f.cardio * (pl.regenMul ?? 1) + mvRegen);
    me.open = st.nextOpen[s];
    if (me.trap && !a?.trapSet && --me.trap.left <= 0) me.trap = null;
    const kept = [];
    if (a?.holdId && !st.switched) {
      const h = me.hand.find((x) => x.id === a.holdId);
      // on the ground a held card only stays if it still fits the position
      if (h && (st.mode !== "ground" || groundFit(st.data.cards[h.id], groundRole(st, s), st.ground.pos))) kept.push({ id: h.id, charged: true });
    }
    me.hand = kept;
    refill(st, s);
  }
  st.switched = false;
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
    mix: { a: { ...st.a.rhist }, b: { ...st.b.rhist } },
    plan: { a: st.plan.a.plan, b: st.plan.b.plan },
    aim: { a: st.plan.a.target, b: st.plan.b.target },
  };
  st.rounds.push(entry);
  st.events.push({ t: "roundEnd", ...entry });
  for (const s of SIDES) {
    const me = st[s];
    me.dealt = 0;
    me.kdTaken = 0;
    me.landed = 0;
    me.thrown = 0;
    me.rhist = newRhist();
    me.open = 0;
    me.trap = null;
    me.landedLast = false;
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.roundRecover);
  }
  st.round++;
  st.beat = 0;
  if (st.mode === "ground") {
    // the bell: both fighters are stood up for the next round
    st.mode = "stand";
    st.ground = null;
    st.dist = c.ground.standDist;
    for (const s of SIDES) {
      st[s].hand = [];
      refill(st, s);
    }
  }
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

// ---------- takedowns, the ground and submissions ----------
// Standing → ground: a takedown card (or a successful sprawl) starts it. On the ground the same one-beat shape holds:
// each side picks a ground card of its role (top / bottom) or a basic ground move, both reveal, then it resolves.
// Position is three steps: 0 護腿 (top inside the guard) → 1 壓制 → 2 背後. A lock that gets in starts the squeeze minigame
// (st.subPending): rounds of tug-of-war where each side's timing quality (0..1) moves a meter. Simulation uses autoQuality().

/** Chance a takedown card works for s. opp: { move, strikeHead, breakIt } describes what the other side does this beat. */
export function tdOdds(st, s, card, { opp = null } = {}) {
  const c = st.data.config;
  const t = c.takedown;
  const me = st.data.fighters[st[s].id].ground;
  const fo = st.data.fighters[st[other(s)].id].ground;
  let p = card.hit + me.wrestle - fo.tdDef + (c.plans[st.plan[s].plan].tdBonus || 0);
  const why = [];
  if (st[s].stamina / st[s].staminaMax < c.stamina.low) { p -= t.tired; why.push("tired"); }
  if (opp) {
    if (opp.strikeHead) { p += t.vsHeadStrike; why.push("low"); }
    if (opp.breakIt) { p -= t.breakPenalty; why.push("break"); }
    if (opp.move && t.vsMove[opp.move]) p += t.vsMove[opp.move];
  }
  return { p: clamp(p, t.min, t.max), why };
}
/** Chance a sprawl stuffs a shot (only matters if the other side shoots). */
export function sprawlOdds(st, s, card) {
  const t = st.data.config.takedown;
  const me = st.data.fighters[st[s].id].ground;
  const fo = st.data.fighters[st[other(s)].id].ground;
  return clamp(card.hit + me.tdDef - fo.wrestle, t.min, t.max);
}

function startGround(st, top, pos, ev, how) {
  st.mode = "ground";
  st.ground = { top, pos, stall: 0 };
  st.switched = true;
  for (const s of SIDES) {
    st[s].trap = null;
    st[s].landedLast = false;
    st[s].open = 0;
  }
  ev.push({ t: "ground", top, pos, how });
}
function standUp(st, how, ev, by = null) {
  st.mode = "stand";
  st.ground = null;
  st.dist = st.data.config.ground.standDist;
  st.switched = true;
  for (const s of SIDES) st[s].landedLast = false;
  ev.push({ t: "standup", how, by });
}

export function groundActions(st, s) {
  const me = st[s];
  const role = groundRole(st, s);
  const out = [];
  me.hand.forEach((h, idx) => {
    const card = st.data.cards[h.id];
    const fits = groundFit(card, role, st.ground.pos);
    const afford = card.cost <= me.stamina;
    out.push({ kind: "card", idx, id: h.id, charged: h.charged, cost: card.cost, ok: fits && afford, why: !fits ? "pos" : !afford ? "stamina" : null });
  });
  for (const [id, mv] of Object.entries(st.data.config.ground.moves)) {
    if (mv.role !== role) continue;
    const afford = mv.cost <= me.stamina;
    out.push({ kind: "move", id, cost: mv.cost, ok: afford, why: afford ? null : "stamina" });
  }
  return out;
}

const ATTEMPT = ["pound", "advance", "sub", "sweep", "escape", "getup"];
/** Chance that ground action `act` (base = the card's or move's own number) works for s. oppAct = what the other side does, if known. */
export function groundOdds(st, s, act, base, oppAct = null) {
  const g = st.data.config.ground;
  const me = st.data.fighters[st[s].id].ground;
  const fo = st.data.fighters[st[other(s)].id].ground;
  const sk = g.skill[act];
  let p = base + me[sk.me] - fo[sk.foe];
  const why = [];
  if (act === "sub") p += g.subPos[st.ground.pos];
  if (act === "getup") p += g.getupPos[st.ground.pos];
  if (st[s].stamina / st[s].staminaMax < st.data.config.stamina.low) { p -= g.tired; why.push("tired"); }
  if (st[other(s)].open > 0) { p += g.openBonus; why.push("open"); }
  if (oppAct) p += g.vs[groundRole(st, s)][act]?.[oppAct] || 0;
  return { p: clamp(p, g.min, g.max), why };
}
/** What a ground card or move would do, for the card face. */
export function groundCardOdds(st, s, idOrMove) {
  const g = st.data.config.ground;
  const mv = g.moves[idOrMove];
  if (mv) return mv.hit != null ? groundOdds(st, s, mv.act, mv.hit) : null;
  const card = st.data.cards[idOrMove];
  return groundOdds(st, s, card.act, card.hit);
}

function groundAct(st, s, ch) {
  const g = st.data.config.ground;
  const role = groundRole(st, s);
  if (ch.move) {
    const mv = g.moves[ch.move];
    if (!mv || mv.role !== role) throw new Error("bad ground move");
    return { kind: "move", id: ch.move, act: mv.act, base: mv.hit ?? 0, cost: mv.cost };
  }
  const h = st[s].hand[ch.card];
  if (!h) throw new Error("no such card");
  const card = st.data.cards[h.id];
  if (!groundFit(card, role, st.ground.pos)) throw new Error("wrong position");
  return { kind: "ground", id: card.id, act: card.act, base: card.hit, cost: card.cost, card, charged: h.charged };
}

function playGround(st, ca, cb) {
  const c = st.data.config;
  const g = c.ground;
  const ev = (st.events = []);
  const ch = { a: ca, b: cb };
  const acts = {};
  for (const s of SIDES) {
    const x = ch[s];
    const me = st[s];
    if (x.trap != null) throw new Error("no traps on the ground");
    if (x.hold != null && (x.hold === x.card || !me.hand[x.hold])) throw new Error("bad hold");
    const a = groundAct(st, s, x);
    if (a.cost > me.stamina + 1e-9) throw new Error("not enough stamina");
    a.s = s;
    a.role = groundRole(st, s);
    a.holdId = x.hold != null ? me.hand[x.hold].id : null;
    acts[s] = a;
  }
  for (const s of SIDES) {
    const a = acts[s];
    st[s].stamina -= a.cost;
    st[s].ghist[a.act]++;
    st[s].rhist.gbeats++;
  }
  st.lastActs = acts;
  const top0 = st.ground.top;
  const pos = st.ground.pos;
  ev.push({ t: "reveal", ground: true, top: top0, pos, a: { kind: acts.a.kind, id: acts.a.id, act: acts.a.act, role: acts.a.role, charged: acts.a.charged }, b: { kind: acts.b.kind, id: acts.b.id, act: acts.b.act, role: acts.b.role, charged: acts.b.charged } });

  const nextOpen = { a: 0, b: 0 };
  let progress = false;
  const bot0 = other(top0);

  if (acts[top0].act === "release") {
    ev.push({ t: "gtry", by: top0, act: "release", id: acts[top0].id, ok: true });
    standUp(st, "release", ev, top0);
    st.nextOpen = nextOpen;
    endBeat(st);
    return ev;
  }

  // every attempt is rolled once, against what the other side chose
  const p = {}, hit = {};
  for (const s of SIDES) {
    const a = acts[s];
    if (!ATTEMPT.includes(a.act)) continue;
    p[s] = groundOdds(st, s, a.act, a.base, acts[other(s)].act).p;
    hit[s] = rand(st) < p[s];
  }

  // ground strikes land one by one; a stoppage ends it
  for (const s of SIDES) {
    const a = acts[s];
    if (a.act !== "pound") continue;
    const e = { t: "gattack", by: s, id: a.id, p: p[s], hit: hit[s], region: a.card.region, pos };
    if (hit[s]) {
      const f = st.data.fighters[st[s].id];
      const guarded = acts[other(s)].act === "defend" ? g.moves.defend.dmgMul : 1;
      const dmg = a.card.dmg * f.power * f.ground.gnp * g.posDmg[pos] * (a.charged ? c.charge.dmgMul : 1) * planDmg(st, s, a.card) * guarded;
      const stop = applyDamage(st, s, a.card, dmg, e, true, g.koMul);
      ev.push(e);
      progress = true;
      if (stop) {
        finish(st, s, "TKO（地面重擊）");
        return ev;
      }
    } else ev.push(e);
  }

  // locks that got in, and position changes
  const subWin = SIDES.filter((s) => acts[s].act === "sub" && hit[s]);
  const moveWin = SIDES.filter((s) => ["advance", "sweep", "escape", "getup"].includes(acts[s].act) && hit[s]);
  const tries = {};
  for (const s of SIDES) {
    const a = acts[s];
    if (a.act === "pound" || !ATTEMPT.includes(a.act)) continue;
    tries[s] = { t: "gtry", by: s, act: a.act, id: a.id, p: p[s], ok: !!hit[s] };
    ev.push(tries[s]);
  }
  if (subWin.length === 2) {
    ev.push({ t: "scramble", why: "sub" });
    for (const s of subWin) tries[s].ok = false;
  } else if (subWin.length === 1) {
    for (const s of moveWin) if (s !== subWin[0]) tries[s].ok = false;
    progress = true;
    startSub(st, subWin[0], acts[subWin[0]], ev);
  } else if (moveWin.length >= 2) {
    ev.push({ t: "scramble", why: "move" });
    for (const s of moveWin) tries[s].ok = false;
  } else if (moveWin.length === 1) {
    const s = moveWin[0];
    const a = acts[s];
    progress = true;
    if (a.act === "advance") {
      const to = a.card.to;
      ev.push({ t: "gpos", from: pos, to, how: a.act, by: s });
      st.ground.pos = to;
    } else if (a.act === "escape") {
      const to = Math.max(0, pos - 1);
      ev.push({ t: "gpos", from: pos, to, how: a.act, by: s });
      st.ground.pos = to;
    } else if (a.act === "sweep") {
      st.ground.top = s;
      st.ground.pos = g.sweepPos;
      st.switched = true;
      nextOpen[top0] = g.sweepOpen;
      ev.push({ t: "swap", top: s, pos: g.sweepPos });
    } else if (a.act === "getup") {
      standUp(st, "getup", ev, s);
    }
  }

  if (st.mode === "ground") {
    if (acts[top0].act === "ride") st[bot0].stamina = Math.max(0, st[bot0].stamina - g.moves.ride.drain);
    st[top0].dealt += g.control[pos];
    if (progress) st.ground.stall = 0;
    else if (++st.ground.stall >= g.stallMax) standUp(st, "ref", ev);
  }
  st.nextOpen = nextOpen;
  if (st.subPending) return ev;
  endBeat(st);
  return ev;
}

function startSub(st, by, a, ev) {
  const g = st.data.config.ground.sub;
  const fa = st.data.fighters[st[by].id].ground;
  const fd = st.data.fighters[st[other(by)].id].ground;
  const meter = g.start + g.edgeWeight * (fa.sub - fd.escape) + (a.card.power || 0);
  st.subPending = { by, cardId: a.id, meter, round: 0 };
  ev.push({ t: "subLock", by, id: a.id, meter });
}
export const subInfo = (st) => {
  const sp = st.subPending;
  const g = st.data.config.ground.sub;
  return sp ? { ...sp, rounds: g.rounds, tap: g.tap, escape: g.escape, name: st.data.cards[sp.cardId].name } : null;
};
/** A computer-played (or auto) squeeze: average timing with some luck. */
export function autoQuality(st) {
  const g = st.data.config.ground.sub;
  return clamp(g.aiQ + (rand(st) - 0.5) * g.aiNoise, 0.05, 0.98);
}
/** One squeeze round. qAtk / qDef are timing qualities in 0..1 of the lock holder and the defender. */
export function subRound(st, qAtk, qDef) {
  const sp = st.subPending;
  if (!sp) throw new Error("no submission pending");
  const g = st.data.config.ground.sub;
  const ev = (st.events = []);
  const delta = g.qteWeight * (qAtk - qDef) + g.drift;
  sp.meter += delta;
  sp.round++;
  const done = sp.meter >= g.tap ? "tap" : sp.meter <= g.escape || sp.round >= g.rounds ? "escape" : null;
  ev.push({ t: "subRound", by: sp.by, meter: sp.meter, delta, round: sp.round, qa: qAtk, qd: qDef, done });
  if (done === "tap") {
    st.subPending = null;
    finish(st, sp.by, `降伏（${st.data.cards[sp.cardId].name}）`);
  } else if (done === "escape") {
    const loser = other(sp.by);
    st[sp.by].stamina = Math.max(0, st[sp.by].stamina - g.failCostAtk);
    st[loser].stamina = Math.max(0, st[loser].stamina - g.failCostDef);
    st.subPending = null;
    st.ground.stall = 0;
    endBeat(st);
  }
  return ev;
}
/** Play the whole squeeze automatically (computer vs computer, or the player's "auto" option). */
export function settleSub(st) {
  const all = [];
  while (st.subPending) all.push(...subRound(st, autoQuality(st), autoQuality(st)));
  return all;
}

// ---------- between rounds: plan and corner ----------
export const PLANS = (data) => Object.keys(data.config.plans).filter((k) => !k.startsWith("_"));
export const TARGETS = (data) => Object.keys(data.config.target).filter((k) => !k.startsWith("_"));

/** Choose this round's plan (and the part to attack). The hand is dealt again with the new draw weights. */
export function setPlan(st, s, plan, target = null) {
  if (!PLANS(st.data).includes(plan)) throw new Error(`unknown plan ${plan}`);
  if (target != null && !TARGETS(st.data).includes(target)) throw new Error(`unknown target ${target}`);
  if (st.beat !== 0) throw new Error("plans are chosen before the round starts");
  st.plan[s] = { plan, target };
  st[s].hand = [];
  refill(st, s);
}

/** Parts the cornerman can work on, worst first: [{ part, ratio }]. */
export function injuries(st, s) {
  const c = st.data.config;
  const k = c.corner;
  const parts = [
    { part: "head", ratio: partRatio(st, s, "head"), at: k.doctorHead },
    { part: "leg", ratio: partRatio(st, s, "leg"), at: k.doctorLeg },
    { part: "body", ratio: partRatio(st, s, "body"), at: k.doctorBody },
  ];
  return parts.filter((p) => p.ratio >= p.at).sort((x, y) => y.ratio - x.ratio);
}

/** What the corner can offer right now. */
export const cornerOptions = (st, s) => ({ coach: true, rest: true, doctor: injuries(st, s).length > 0 });

/** True facts about the opponent's profile, found by probing (cardio / chin below the field, else his favourite range). */
function scoutFact(st, s) {
  const o = st[other(s)];
  const f = st.data.fighters[o.id];
  const all = Object.values(st.data.fighters).filter((x) => x && typeof x === "object" && x.chin);
  const avg = (key) => all.reduce((a, x) => a + x[key], 0) / all.length;
  const weak = [["chin", f.chin / avg("chin")], ["cardio", f.cardio / avg("cardio")]].sort((x, y) => x[1] - y[1])[0];
  if (weak[1] < 0.97) return { k: "weak", what: weak[0], ratio: weak[1] };
  const rb = f.rangeBonus || {};
  const fav = Object.keys(rb).sort((x, y) => rb[y] - rb[x])[0];
  return { k: "range", dist: fav == null ? null : Number(fav) };
}

/**
 * The coach's report after a round. Everything is true except the "feel" of the round,
 * which is a noisy read (real corners judge a round wrongly too) and says nothing about numbers.
 */
function coachIntel(st, s) {
  const c = st.data.config;
  const last = st.rounds[st.rounds.length - 1];
  if (!last) return null;
  const o = other(s);
  const mix = last.mix[o];
  const facts = [];
  const strikes = mix.head + mix.body + mix.leg;
  if (strikes >= 3) facts.push({ k: "aim", head: mix.head / strikes, body: mix.body / strikes, leg: mix.leg / strikes, n: strikes });
  const habits = ["advance", "retreat", "sidestep", "guard", "feint"].map((x) => [x, mix[x]]).sort((x, y) => y[1] - x[1]);
  if (habits[0][1] >= 3) facts.push({ k: "habit", what: habits[0][0], n: habits[0][1], of: c.beatsPerRound });
  if (mix.td >= 1 || mix.gbeats >= 1) facts.push({ k: "td", tried: mix.td, ok: mix.tdOk, gbeats: mix.gbeats });
  if (last.plan[s] === "probe") facts.push(scoutFact(st, s));
  const mine = last.dealt[s], his = last.dealt[o];
  const diff = (mine - his) / Math.max(1, mine + his) + (rand(st) - 0.5) * 2 * c.corner.feelNoise;
  const feel = diff > c.corner.feelEdge ? "ours" : diff < -c.corner.feelEdge ? "theirs" : "close";
  return { feel, facts };
}

/**
 * Between rounds: pick at most two of coach / doctor / rest (doctor only if something is hurt).
 * Returns what happened: { picks, rested, healed: part|null, intel: {feel, facts}|null }.
 */
export function doCorner(st, s, picks) {
  const c = st.data.config;
  const k = c.corner;
  const me = st[s];
  const opt = cornerOptions(st, s);
  const p = [...new Set(picks)];
  if (p.length > 2) throw new Error("two at most");
  for (const x of p) if (!opt[x]) throw new Error(`corner: ${x} is not available`);
  const out = { picks: p, rested: false, healed: null, intel: null };
  if (p.includes("rest")) {
    me.stamina = Math.min(me.staminaMax, me.stamina + k.restRecover);
    out.rested = true;
  }
  if (p.includes("doctor")) {
    const worst = injuries(st, s)[0].part;
    me[worst] *= 1 - k.doctorRelief;
    out.healed = worst;
    me.staminaMax = Math.max(c.stamina.min, c.stamina.max - me.body * c.body.maxLoss);
  }
  if (p.includes("coach")) out.intel = coachIntel(st, s);
  return out;
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
  if ((st.mode === "ground") !== !!st.ground) throw new Error("ground state out of sync");
  if (st.ground && !(st.ground.pos >= 0 && st.ground.pos <= 2 && SIDES.includes(st.ground.top))) throw new Error("bad ground position");
  if (st.ground) for (const s of SIDES) for (const h of st[s].hand) if (!st.data.cards[h.id].role && !st.subPending && !st.over) throw new Error("standing card in a ground hand");
}
