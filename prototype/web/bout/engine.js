// Octagon Cards — card bout engine (standing, prototype 0.1 of the card direction, 2026-11-09).
// Pure rules: no DOM, no clock. The browser and the simulation use this same file.
// All numbers and card properties come from rules/bout/*.json; the engine never compares card names.
// Spec: docs/GAME_DESIGN.md.

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

/** Put ids onto the card table. Call once after loading the JSON. */
export function prepare(data) {
  for (const [id, c] of Object.entries(data.cards)) if (!id.startsWith("_")) c.id = id;
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
    hand: [],
    fresh: null, // 這一手新抽的牌（對手看得到）
    known: [], // 已經讓對手看過、還沒打出的牌（沒有丟牌，所以這就是對手確定知道的）
    hist: { advance: 0, retreat: 0, sidestep: 0, guard: 0, card: 0 },
    dealt: 0, // 這回合造成的傷害（判定用）
    kdTaken: 0, // 這回合被擊倒次數
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
  for (const s of SIDES) for (let i = 0; i < data.config.startHand; i++) st[s].hand.push(drawId(st, s));
  return st;
}

export const danger = (st, s) => st[s].head / st.data.fighters[st[s].id].chin >= st.data.config.head.dangerRatio;
export const headRatio = (st, s) => st[s].head / st.data.fighters[st[s].id].chin;
export const limping = (st, s) => st[s].leg >= st.data.config.leg.limp;

function drawId(st, s) {
  const f = st.data.fighters[st[s].id];
  const dng = danger(st, s);
  let total = 0;
  const ws = [];
  const copies = (id) => st[s].hand.filter((x) => x === id).length;
  for (const [id, w] of Object.entries(f.weights)) {
    const card = st.data.cards[id];
    if (copies(id) >= st.data.config.handCopies) continue; // no more than N of the same card in hand
    const k = w * (card.rarity === "sig" && dng ? st.data.config.head.sigDangerBoost : 1);
    ws.push([id, k]);
    total += k;
  }
  let r = rand(st) * total;
  for (const [id, k] of ws) if ((r -= k) < 0) return id;
  return ws[ws.length - 1][0];
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
  me.hand.forEach((id, idx) => {
    const card = st.data.cards[id];
    const inRange = card.range.includes(st.dist);
    const afford = card.cost <= me.stamina;
    out.push({ kind: "card", idx, id, cost: card.cost, ok: inRange && afford, why: !inRange ? "range" : !afford ? "stamina" : null });
  });
  for (const [id, mv] of Object.entries(st.data.config.moves)) {
    const cost = moveCost(st, s, id);
    const pointless = (mv.dist > 0 && st.dist >= 3) || (mv.dist < 0 && st.dist <= 0);
    out.push({ kind: "move", id, cost, ok: cost <= me.stamina && !pointless, why: pointless ? "edge" : cost > me.stamina ? "stamina" : null });
  }
  return out;
}

/** Hit chance of `card` thrown by s. oppMove = the opponent's basic move this beat (unknown while choosing → null). */
export function hitChance(st, s, card, boost = false, oppMove = null) {
  const c = st.data.config;
  const me = st[s];
  const opp = st[other(s)];
  const f = st.data.fighters[me.id];
  let p = card.hit + (f.skill?.[card.id] || 0);
  const why = [];
  if (opp.open > 0) { p += c.hit.openBonus; why.push("open"); }
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

function validate(st, s, ch) {
  const me = st[s];
  if (ch.move) {
    const mv = st.data.config.moves[ch.move];
    if (!mv) throw new Error(`unknown move ${ch.move}`);
    if (moveCost(st, s, ch.move) > me.stamina) throw new Error("not enough stamina");
    return;
  }
  const id = me.hand[ch.card];
  if (id == null) throw new Error("no such card");
  const card = st.data.cards[id];
  if (!card.range.includes(st.dist)) throw new Error("out of range");
  if (card.cost + (ch.boost ? st.data.config.boost.cost : 0) > me.stamina) throw new Error("not enough stamina");
}

const describe = (a) => (a.kind === "card" ? { kind: "card", id: a.card.id, boost: a.boost } : { kind: "move", id: a.id });

/**
 * Resolve one beat. ca/cb = { card: handIndex, boost?: true } or { move: "advance"|... }.
 * Returns the event list. If a knockdown happened, st.pending is set and the caller must call settleKnockdown().
 */
export function playBeat(st, ca, cb) {
  if (st.over) throw new Error("bout is over");
  if (st.pending) throw new Error("knockdown pending");
  const c = st.data.config;
  const ev = (st.events = []);
  const ch = { a: ca, b: cb };
  for (const s of SIDES) validate(st, s, ch[s]);

  // pay and take cards out of hand
  const acts = {};
  for (const s of SIDES) {
    const me = st[s];
    const x = ch[s];
    if (x.move) {
      me.stamina -= moveCost(st, s, x.move);
      acts[s] = { kind: "move", id: x.move };
      me.hist[x.move]++;
    } else {
      const id = me.hand[x.card];
      const card = st.data.cards[id];
      me.stamina -= card.cost + (x.boost ? c.boost.cost : 0);
      me.hand.splice(x.card, 1);
      const k = me.known.indexOf(id);
      if (k >= 0) me.known.splice(k, 1);
      acts[s] = { kind: "card", card, boost: !!x.boost };
      me.hist.card++;
      me.thrown++;
    }
  }
  st.lastActs = acts;
  ev.push({ t: "reveal", a: describe(acts.a), b: describe(acts.b) });

  // movement first
  const before = st.dist;
  let d = before;
  for (const s of SIDES) if (acts[s].kind === "move") d += c.moves[acts[s].id].dist;
  st.dist = clamp(d, 0, 3);
  if (st.dist !== before) ev.push({ t: "move", from: before, to: st.dist });

  // attacks, rolled against the state before any damage (simultaneous)
  const res = {};
  for (const s of SIDES) {
    if (acts[s].kind !== "card") continue;
    const { card, boost } = acts[s];
    const oppMove = acts[other(s)].kind === "move" ? acts[other(s)].id : null;
    const hc = hitChance(st, s, card, boost, oppMove);
    const roll = rand(st);
    const inRange = card.range.includes(st.dist);
    res[s] = { card, boost, p: hc.p, why: hc.why, inRange, hit: inRange && roll < hc.p, oppMove };
  }

  const kd = {};
  const nextOpen = { a: 0, b: 0 };
  for (const s of SIDES) {
    const r = res[s];
    if (!r) continue;
    const me = st[s];
    const t = other(s);
    const tg = st[t];
    const e = { t: "attack", by: s, id: r.card.id, boost: r.boost, p: r.p, region: r.card.region, hit: r.hit, whiff: r.hit ? null : r.inRange ? "miss" : "range", why: r.why };
    if (r.hit) {
      const guardMv = r.oppMove ? c.moves[r.oppMove] : null;
      const gm = guardMv?.dmgMul ? guardMv.dmgMul[r.card.region] : 1;
      const dmg = r.card.dmg * st.data.fighters[me.id].power * (r.boost ? c.boost.dmgMul : 1) * gm;
      e.dmg = Math.round(dmg * 10) / 10;
      me.landed++;
      me.dealt += dmg * c.damageWeight[r.card.region];
      if (r.card.region === "head") {
        tg.head += dmg;
        const ratio = headRatio(st, t);
        const heavy = r.card.heavy ? 1 : c.head.koLight;
        const pk = clamp((r.card.ko || 0) * (1 + ratio) + Math.max(0, ratio - c.head.koDanger) * c.head.koScale * heavy, 0, c.head.koCap);
        e.koP = Math.round(pk * 1000) / 1000;
        if (rand(st) < pk) kd[s] = t;
      } else if (r.card.region === "body") {
        tg.body += dmg;
        tg.stamina = Math.max(0, tg.stamina - dmg * c.body.drain);
      } else {
        tg.leg += dmg;
      }
    } else if (r.card.heavy) {
      nextOpen[s] = 1;
      e.openSelf = true;
    }
    ev.push(e);
  }
  for (const s of SIDES) st[s].staminaMax = Math.max(c.stamina.min, c.stamina.max - st[s].body * c.body.maxLoss);
  for (const s of SIDES) st[s].stamina = Math.min(st[s].stamina, st[s].staminaMax);

  if (kd.a && kd.b) {
    // both dropped each other: nobody goes down, both are shaken
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
    const pf = clamp(c.chase.finishBase + c.chase.finishPerHead * Math.min(1.5, headRatio(st, p.down)) + tired, 0, c.chase.finishMax);
    const win = rand(st) < pf;
    ev.push({ t: "chase", by: p.by, down: p.down, p: pf, finished: win });
    if (win) {
      finish(st, p.by, "KO／TKO");
      return ev;
    }
    st.nextOpen[p.by] = 1; // the chase failed: the attacker is exposed
  } else {
    dn.head *= c.hold.headRelief;
    dn.stamina = Math.min(dn.staminaMax, dn.stamina + c.hold.recoverStamina);
    ev.push({ t: "hold", by: p.by, down: p.down });
  }
  endBeat(st);
  return ev;
}

function endBeat(st) {
  const c = st.data.config;
  const acts = st.lastActs;
  for (const s of SIDES) {
    const me = st[s];
    const f = st.data.fighters[me.id];
    const mvRegen = acts?.[s]?.kind === "move" ? c.moves[acts[s].id].regen || 0 : 0;
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.regen * f.cardio + mvRegen);
    me.open = st.nextOpen[s];
    me.fresh = null;
    if (me.hand.length < c.handMax) {
      const id = drawId(st, s);
      me.hand.push(id);
      me.fresh = id;
      me.known.push(id);
    }
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
    me.stamina = Math.min(me.staminaMax, me.stamina + c.stamina.roundRecover);
  }
  st.round++;
  st.beat = 0;
  if (st.round >= c.rounds) decide(st);
}

/** Three judges, each a little different. Returns the cards as [a, b] points per judge. */
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
  let winner = wa > wb ? "a" : wb > wa ? "b" : null;
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
    if (f.known.length > f.hand.length) throw new Error("known cards not in hand");
    if (f.head < 0 || f.body < 0 || f.leg < 0) throw new Error("negative damage");
  }
  if (st.dist < 0 || st.dist > 3) throw new Error("distance out of range");
}
