// Octagon Cards — real-time standing fight engine (prototype 0.1, 2026-11-09).
// Pure rules: fixed ticks (config.tps per second), no DOM, no clock. The browser and the simulation step the same code.
// All numbers come from rules/rt/*.json. Spec: docs/GAME_DESIGN.md「即時版」.

export const other = (s) => (s === "a" ? "b" : "a");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function rand(state) {
  const a = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The six strikes (keys of moves.json that do not start with "_"). */
export const strikeIds = (data) => Object.keys(data.moves).filter((k) => !k.startsWith("_"));

function newFighter(data, id, x) {
  const cfg = data.config;
  return {
    id,
    x,
    hp: cfg.hp,
    stamina: cfg.stamina.max,
    bodyLoss: 0,
    legs: 0,
    daze: 0,
    knockdowns: 0,
    score: 0,
    // act: idle | strike | slip | feint | stun | down
    act: "idle",
    move: null, // strike or special id
    t: 0, // ticks into the current act
    len: 0, // total ticks of the current act (stun/down/special)
    landed: false,
    tired: false,
    guard: false,
    sinceStrike: 999,
    counterUntil: -1,
    buffer: null, // { press, at }
    stats: { thrown: 0, landed: 0, blocked: 0, slipped: 0, counters: 0, whiffs: 0, dealt: 0 },
  };
}

/** data = { config, moves, fighters }. Seat a stands on the left facing right, b on the right facing left. */
export function createFight(data, idA, idB, seed = 1) {
  const cfg = data.config;
  const mid = (cfg.cage.left + cfg.cage.right) / 2;
  return {
    data,
    rng: seed >>> 0,
    tick: 0,
    end: cfg.roundSeconds * cfg.tps,
    over: null,
    events: [],
    a: newFighter(data, idA, mid - cfg.startGap / 2),
    b: newFighter(data, idB, mid + cfg.startGap / 2),
  };
}

export const gap = (st) => st.b.x - st.a.x;
const facing = (side) => (side === "a" ? 1 : -1);
const ev = (st, e) => st.events.push({ ...e, tick: st.tick });

/** Total ticks of a strike for this fighter (tired strikes start slower). */
export function strikeLen(st, F, m) {
  return (F.tired ? st.data.config.stamina.tiredStartup : 0) + m.startup + m.active + m.recovery;
}

/** What phase a fighter is in, as an opponent would see it: "startup" | "active" | "recovery" | null. */
export function phaseOf(st, F) {
  if (F.act === "feint") return F.t < st.data.moves[st.data.moves._special.feint.looksLike].startup ? "startup" : "recovery";
  if (F.act !== "strike") return null;
  const m = st.data.moves[F.move];
  const s = m.startup + (F.tired ? st.data.config.stamina.tiredStartup : 0);
  if (F.t < s) return "startup";
  if (F.t < s + m.active) return "active";
  return "recovery";
}

/** What an opponent can see a fighter doing: a feint looks exactly like the strike it copies until it stops. */
export function looksLike(st, F) {
  if (F.act === "feint" && phaseOf(st, F) === "startup") return { act: "strike", move: st.data.moves._special.feint.looksLike, phase: "startup" };
  return { act: F.act, move: F.move, phase: phaseOf(st, F), guard: F.guard };
}

const canAct = (F) => F.act === "idle";

function staminaCap(cfg, F) {
  return Math.max(cfg.stamina.minCap, cfg.stamina.max - F.bodyLoss * cfg.stamina.bodyCapLoss);
}

function begin(st, side, press) {
  const F = st[side];
  const data = st.data;
  const cfg = data.config;
  F.guard = false;
  if (press === "slip" || press === "feint") {
    F.act = press;
    F.move = press;
    F.t = 0;
    F.len = data.moves._special[press].total;
    ev(st, { t: press, side });
    return;
  }
  const m = data.moves[press];
  if (!m) return;
  F.tired = F.stamina < m.cost;
  F.stamina = Math.max(0, F.stamina - m.cost);
  F.act = "strike";
  F.move = press;
  F.t = 0;
  F.len = strikeLen(st, F, m);
  F.landed = false;
  // A strike started inside the window after a successful slip is a counter.
  F.slipCounter = F.counterUntil >= st.tick;
  F.counterUntil = -1;
  F.sinceStrike = 0;
  F.stats.thrown++;
  ev(st, { t: "throw", side, move: press, tired: F.tired });
}

function knockdown(st, side) {
  const F = st[side];
  const cfg = st.data.config;
  F.knockdowns++;
  F.daze = 0;
  F.act = "down";
  F.move = null;
  F.t = 0;
  F.len = cfg.daze.downTicks;
  F.guard = false;
  st[other(side)].score += cfg.score.knockdown;
  ev(st, { t: "knockdown", side, n: F.knockdowns });
  if (F.knockdowns >= cfg.daze.maxKnockdowns) finish(st, other(side), "TKO");
}

function finish(st, winner, how) {
  if (st.over) return;
  st.over = { winner, how };
  ev(st, { t: "over", winner, how });
}

/** Strike from `side` connects (or is blocked / slipped) this tick. */
function resolveHit(st, side) {
  const A = st[side];
  const o = other(side);
  const D = st[o];
  const data = st.data;
  const cfg = data.config;
  const m = data.moves[A.move];
  const fa = data.fighters[A.id];
  const fd = data.fighters[D.id];
  if (Math.abs(gap(st)) > m.reach) return false;
  if (D.act === "down") return false;
  // Slip: dodges punches to the head during its dodge frames and opens a counter window.
  const sp = data.moves._special.slip;
  if (D.act === "slip" && m.kind === "punch" && m.at === "head" && D.t >= sp.dodgeFrom && D.t <= sp.dodgeTo) {
    A.landed = true;
    D.counterUntil = st.tick + cfg.counter.slipWindow;
    D.stats.slipped++;
    ev(st, { t: "slipped", side: o, move: A.move });
    return true;
  }
  A.landed = true;
  let dmg = m.dmg * fa.power * (A.tired ? cfg.stamina.tiredDmgMul : 1);
  // Guard high: head strikes only chip; body shots and low kicks go through.
  if (D.guard && D.act === "idle" && m.at === "head") {
    dmg *= cfg.guard.headChip;
    D.stamina = Math.max(0, D.stamina - cfg.stamina.blockCost);
    D.act = "stun";
    D.len = m.blockstun;
    D.t = 0;
    push(st, o, cfg.guard.pushback);
    A.stats.blocked++;
    apply(st, side, o, dmg, m, false);
    ev(st, { t: "blocked", side: o, from: side, move: A.move, dmg: Math.round(dmg * 10) / 10 });
    return true;
  }
  // Counters: landing inside a slip window, or catching the other man while he is throwing or recovering.
  let counter = null;
  if (A.slipCounter) {
    dmg *= cfg.counter.slipMul;
    counter = "slip";
  } else if (D.act === "strike" || D.act === "feint" || D.act === "slip") {
    dmg *= cfg.counter.punishMul;
    counter = "punish";
  }
  D.act = "stun";
  D.move = null;
  D.len = m.stun;
  D.t = 0;
  D.guard = false;
  A.stats.landed++;
  if (counter) A.stats.counters++;
  apply(st, side, o, dmg, m, true);
  ev(st, { t: "hit", side: o, from: side, move: A.move, at: m.at, dmg: Math.round(dmg * 10) / 10, counter });
  if (!st.over && m.at === "head" && D.daze >= cfg.daze.limit * fd.chin) knockdown(st, o);
  return true;
}

function apply(st, from, to, dmg, m, clean) {
  const cfg = st.data.config;
  const D = st[to];
  D.hp -= dmg;
  st[from].score += dmg;
  st[from].stats.dealt += dmg;
  if (clean) {
    if (m.at === "head") D.daze += dmg;
    if (m.drain) {
      D.stamina = Math.max(0, D.stamina - m.drain);
      D.bodyLoss += dmg;
    }
    if (m.legs) D.legs += dmg;
  }
  if (D.hp <= 0) {
    D.hp = 0;
    finish(st, from, "KO");
  }
}

function push(st, side, d) {
  const cfg = st.data.config;
  const F = st[side];
  F.x = clamp(F.x - facing(side) * d, cfg.cage.left, cfg.cage.right);
  keepApart(st);
}

function keepApart(st) {
  const cfg = st.data.config;
  if (gap(st) < cfg.minGap) {
    const mid = (st.a.x + st.b.x) / 2;
    st.a.x = clamp(mid - cfg.minGap / 2, cfg.cage.left, cfg.cage.right - cfg.minGap);
    st.b.x = st.a.x + cfg.minGap;
  }
}

/**
 * One tick. inputs = { a: { move: -1|0|1 (toward the opponent is +1), guard: bool, press: strikeId|"slip"|"feint"|null }, b: {...} }.
 * Presses are buffered for a few ticks so a button pressed during recovery comes out as soon as possible.
 */
export function step(st, inputs = {}) {
  if (st.over) return;
  const data = st.data;
  const cfg = data.config;
  st.events = [];
  st.tick++;
  for (const side of ["a", "b"]) {
    const F = st[side];
    const inp = inputs[side] || {};
    if (inp.press) F.buffer = { press: inp.press, at: st.tick };
    if (F.buffer && st.tick - F.buffer.at > cfg.inputBuffer) F.buffer = null;
    F.sinceStrike++;
    // Advance the current act.
    if (F.act !== "idle") {
      F.t++;
      if (F.act === "strike") {
        const m = data.moves[F.move];
        const ph = phaseOf(st, F);
        if (F.t === 1 && m.advance) {
          F.x = clamp(F.x + facing(side) * m.advance, cfg.cage.left, cfg.cage.right);
          keepApart(st);
        }
        if (ph === "recovery" && !F.landed && !F.whiffed) {
          F.whiffed = true;
          F.len += m.whiffExtra;
          F.stats.whiffs++;
          ev(st, { t: "whiff", side, move: F.move });
        }
      }
      if (F.t >= F.len) {
        if (F.act === "down") {
          // Back up; the referee separates them.
          const mid = (st.a.x + st.b.x) / 2;
          st.a.x = clamp(mid - cfg.daze.resetGap / 2, cfg.cage.left, cfg.cage.right);
          st.b.x = clamp(mid + cfg.daze.resetGap / 2, cfg.cage.left, cfg.cage.right);
          ev(st, { t: "up", side });
        }
        F.act = "idle";
        F.move = null;
        F.t = 0;
        F.len = 0;
        F.whiffed = false;
      }
    }
    // New input.
    if (canAct(F)) {
      F.guard = !!inp.guard;
      if (F.buffer) {
        const p = F.buffer.press;
        F.buffer = null;
        begin(st, side, p);
      }
    }
    if (canAct(F)) {
      const mv = inp.move || 0;
      if (mv) {
        const sp = (mv > 0 ? cfg.walk.forward : cfg.walk.back) * (F.guard ? cfg.walk.guardMul : 1) * (F.legs >= cfg.legs.hurtAt ? cfg.walk.hurtLegsMul : 1);
        F.x = clamp(F.x + facing(side) * mv * sp, cfg.cage.left, cfg.cage.right);
        keepApart(st);
      }
    } else if (F.act !== "idle") F.guard = false;
    // Stamina and daze.
    const cap = staminaCap(cfg, F);
    if (F.act !== "strike" && F.sinceStrike > cfg.stamina.regenDelay) F.stamina = Math.min(cap, F.stamina + cfg.stamina.regen * data.fighters[F.id].cardio * (F.guard ? cfg.stamina.guardRegenMul : 1));
    F.stamina = Math.min(F.stamina, cap);
    F.daze = Math.max(0, F.daze - cfg.daze.decayPerTick);
  }
  // Strikes connect during their active frames (both can land on the same tick: a trade).
  const hits = [];
  for (const side of ["a", "b"]) {
    const F = st[side];
    if (F.act === "strike" && !F.landed && phaseOf(st, F) === "active") hits.push(side);
  }
  for (const side of hits) if (!st.over && st[side].act === "strike") resolveHit(st, side);
  // A strike that started and was interrupted by a trade still counts for the side that was already active.
  if (!st.over && st.tick >= st.end) {
    const a = st.a.score;
    const b = st.b.score;
    finish(st, a === b ? null : a > b ? "a" : "b", "decision");
  }
}

export function checkInvariants(st) {
  const errs = [];
  const cfg = st.data.config;
  for (const side of ["a", "b"]) {
    const F = st[side];
    if (F.x < cfg.cage.left - 0.01 || F.x > cfg.cage.right + 0.01) errs.push(`${side} out of cage`);
    if (F.stamina < 0) errs.push(`${side} negative stamina`);
    if (F.hp < 0) errs.push(`${side} negative hp`);
    if (!["idle", "strike", "slip", "feint", "stun", "down"].includes(F.act)) errs.push(`${side} bad act ${F.act}`);
  }
  if (gap(st) < cfg.minGap - 0.01) errs.push("fighters overlap");
  return errs;
}
