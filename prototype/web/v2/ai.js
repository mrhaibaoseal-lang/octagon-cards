// Octagon Cards V2 — the leader's intent AI (side b) and the answering bots used by the simulation.
// The intent AI reads only the fighter's `ai` block in rules/v2/fighters.json; the category shares it
// reports are the real weights it then samples from, so what the player is shown is never a lie.

import { defOf, rand, cost, usable, onCage, lowGas, legStacks, scene, readLevel, preview, legal, visibleIntent, setIntent, act, runIntent, endExchange, corner, isOpen, createBout } from "./engine.js";

const CONDS = {
  aHurtBody: (st) => st.a.bodyLoss >= 1,
  aHurtLegs: (st) => legStacks(st, "a") >= 1,
  aTired: (st) => lowGas(st, "a"),
  aCage: (st) => onCage(st, "a"),
  aBacked: (st) => st.a.backedLast,
  behind: (st) => st.b.score < st.a.score,
  lateRound: (st) => st.ex * 2 > st.cfg.exchanges + 1,
};

function pick(st, w) {
  const es = Object.entries(w).filter(([, v]) => v > 0);
  let x = rand(st) * es.reduce((n, [, v]) => n + v, 0);
  for (const [k, v] of es) { x -= v; if (x <= 0) return k; }
  return es.length ? es[es.length - 1][0] : null;
}

function builder(st, energy) {
  const bd = { steps: [], e: energy, r: st.range, used: new Set(), moves: 0 };
  bd.add = (d, i, pre) => {
    const c = cost(st, "b", d, bd.moves);
    if (c > bd.e) return false;
    bd.e -= c;
    if (d.kind === "move" && d.basic) bd.moves++;
    bd.steps.push(pre ? { id: d.id, pre: true } : { id: d.id });
    if (i != null) bd.used.add(i);
    if (d.kind === "move") {
      if (d.move === "advance" && bd.r === 0) bd.r = 1;
      if (d.move === "clinch") bd.r = 2;
      if (d.move === "retreat") bd.r = Math.max(0, bd.r - 1);
    }
    return true;
  };
  bd.cards = (f) => st.b.hand.map((id, i) => ({ d: defOf(st, id), i })).filter((x) => !bd.used.has(x.i) && f(x.d));
  bd.inRange = (d) => !d.range || d.range.includes(bd.r);
  return bd;
}

const isAtk = (d, sc) => d.scene === sc && (d.kind === "strike" || d.kind === "feint");
const rank = (d, focus) => (d.kind === "feint" ? 0 : d.setup ? 1 : d.finisher ? 3 : 2) - (d.region === focus ? 0.5 : 0) - (d.dmg || 0) / 100;

function addStrikes(st, bd, focus, max = 9, noFinisher = false, stay = false) {
  const B = st.cfg.basics;
  if (bd.r === 0 && !stay) {
    const all = bd.cards((d) => isAtk(d, "stand"));
    const far = all.filter((x) => x.d.range && x.d.range.includes(0)).length;
    const near = all.filter((x) => x.d.range && x.d.range.includes(1)).length;
    if (near > far) bd.add(B.advance);
  }
  const list = bd.cards((d) => isAtk(d, "stand") && bd.inRange(d) && !(noFinisher && d.finisher)).sort((x, y) => rank(x.d, focus) - rank(y.d, focus));
  let n = 0;
  for (const x of list) { if (n >= max) break; if (bd.add(x.d, x.i)) n++; }
}

/** Which defence card in hand to set: the one that answers what a has thrown most (adapt), else any. null = none / plain guard. */
function pickDefence(st, bd, ai, orGuard) {
  const have = {};
  for (const x of bd.cards((d) => d.kind === "defence" && d.scene === "stand")) have[x.d.def] = x;
  const h = st.a.hist;
  let want;
  if (h.n > 0 && rand(st) < ai.adapt) {
    const top = Object.entries({ head: h.head, legs: h.legs, td: h.td }).sort((x, y) => y[1] - x[1])[0][0];
    want = top === "head" ? "slip" : top === "legs" ? "check" : "sprawl";
  } else { const ks = [...Object.keys(have), ...(orGuard ? ["guard"] : [])]; want = ks[Math.floor(rand(st) * ks.length)]; }
  return have[want] || null;
}

/** Decide b's intent for the exchange that has just begun. */
export function planIntent(st) {
  const cfg = st.cfg, B = st.b, ai = B.f.ai, sc = scene(st, "b"), Bs = cfg.basics;
  const hand = B.hand.map((id) => defOf(st, id));
  const habits = [];
  let w, forced = false;

  if (B.rocked) { forced = true; w = { survive: 1 }; }
  else if (st.a.rocked && sc !== "bottom") { forced = true; w = { chase: 1 }; }
  else if (sc === "stand") {
    const hasStrike = hand.some((d) => isAtk(d, "stand") && d.kind === "strike");
    const hasLong = hand.some((d) => d.kind === "strike" && d.scene === "stand" && d.range && d.range.includes(0));
    w = {
      strike: hasStrike ? ai.aggression : 0,
      pressure: hasStrike ? ai.pressure || 0 : 0,
      takedown: hand.some((d) => d.kind === "takedown") ? ai.grapple : 0,
      counter: ai.caution,
      outfight: hasLong ? (ai.outfight || 0) * (onCage(st, "b") ? 4 : 1) : 0,
    };
  } else if (sc === "top") w = { gnp: ai.gnp, control: 1 };
  else w = { getup: 1, cover: ai.caution };

  if (!forced) for (const h of ai.habits || []) if (CONDS[h.when]?.(st) && w[h.cat] > 0) { w[h.cat] *= h.mul; habits.push(h.text); }
  const total = Object.values(w).reduce((n, v) => n + v, 0);
  if (!(total > 0)) w = { counter: 1 };
  const sum = Object.values(w).reduce((n, v) => n + v, 0);
  const cats = {};
  for (const [k, v] of Object.entries(w)) if (v > 0) cats[k] = v / sum;
  const cat = pick(st, w);

  let throttle = 0;
  const pushy = cat === "strike" || cat === "pressure" || cat === "chase" || cat === "takedown" || cat === "gnp";
  if (pushy && B.gas - cfg.throttle.gas > B.f.gas * cfg.lowGasFrac && (cat === "chase" || rand(st) < ai.throttle)) throttle = 1;
  const bd = builder(st, B.energy + throttle * cfg.throttle.energy);

  let focus = null;
  if (cat === "strike" || cat === "chase" || cat === "pressure" || cat === "outfight") {
    const rw = { head: 0, body: 0, legs: 0 };
    for (const d of hand) if (d.kind === "strike" && d.scene === sc) rw[d.region] = d.region === "head" ? 1 : ai[d.region];
    focus = cat === "chase" ? "head" : pick(st, rw);
    if (sc === "top") focus = "head";
  }

  if (sc === "stand") {
    if (cat === "strike" || cat === "chase") addStrikes(st, bd, focus);
    else if (cat === "pressure") {
      // walk him down first: a step back does not get away, and in close it shoves him toward the cage
      if (bd.r === 0 || !onCage(st, "a")) bd.add(Bs.advance);
      addStrikes(st, bd, focus);
    } else if (cat === "takedown") {
      if (bd.r === 0 || !onCage(st, "a")) bd.add(Bs.advance); // a shot covers distance: stepping back does not escape it
      const td = bd.cards((d) => d.kind === "takedown")[0];
      if (td) {
        const setup = bd.cards((d) => (d.kind === "feint" || d.setup) && d.scene === "stand" && bd.inRange(d) && cost(st, "b", d) <= bd.e - cost(st, "b", td.d))[0];
        if (setup) bd.add(setup.d, setup.i);
        bd.add(td.d, td.i);
      }
      addStrikes(st, bd, null, 1, true);
    } else if (cat === "counter" || cat === "survive") {
      const x = cat === "survive" ? null : pickDefence(st, bd, ai, true);
      if (x) bd.add(x.d, x.i); else bd.add(Bs.guard);
      if (cat === "survive") { if (bd.r > 0 && !onCage(st, "b")) bd.add(Bs.retreat); }
      else addStrikes(st, bd, null, 2, true);
    } else {
      // out-fighting: get out of the pocket before a can answer, then pick at him from range
      if (onCage(st, "b")) bd.add(Bs.circle);
      else if (bd.r >= 1) bd.add(Bs.retreat, null, true);
      addStrikes(st, bd, focus, 3, true, true);
      if (!bd.steps.some((x) => defOf(st, x.id).kind === "strike")) bd.add(Bs.guard);
    }
    // an attacking plan can still keep one answer ready, if he holds the card and has the energy left
    if ((cat === "strike" || cat === "pressure" || cat === "takedown" || cat === "outfight") && rand(st) < (ai.hedge || 0)) {
      const x = pickDefence(st, bd, ai, false);
      if (x) bd.add(x.d, x.i);
    }
  } else if (sc === "top") {
    if (cat === "control" || cat === "survive") {
      bd.add(Bs.control);
      const p = bd.cards((d) => d.kind === "pass")[0];
      if (p) bd.add(p.d, p.i);
      if (cat === "control") bd.add(Bs.pound);
    } else {
      for (const x of bd.cards((d) => d.kind === "strike" && d.scene === "top").sort((x, y) => y.d.dmg - x.d.dmg)) bd.add(x.d, x.i);
      for (let i = 0; i < 3; i++) bd.add(Bs.pound);
    }
  } else {
    const esc = bd.cards((d) => d.kind === "escape" && d.scene === "bottom")[0];
    const tryUp = () => (esc && bd.add(esc.d, esc.i)) || bd.add(Bs.getup);
    if (cat === "getup") { tryUp(); bd.add(Bs.cover); }
    else { bd.add(Bs.cover); if (cat !== "survive") tryUp(); }
  }
  return { cat, steps: bd.steps, cats, focus, throttle, habits, forced };
}

/** Make sure the current exchange has an intent (call after createBout / endExchange / corner). */
export function lead(st) {
  if (st.phase === "play" && !st.over && !st.intent) setIntent(st, planIntent(st));
  return st;
}

export function cornerPick(st, s) {
  const F = st[s];
  if (F.stun > F.chin * 0.4) return "ice";
  if (F.gas < F.gasMax * 0.6) return "rest";
  return "coach";
}

// ---------- answering bots (side a), used by the simulation and the tests ----------

function threat(st) {
  const v = visibleIntent(st);
  const t = { head: 0, body: 0, legs: 0, td: 0, def: 0, defs: [], punch: null, exact: false, advance: true, cat: null, cats: null, out: 0 };
  if (!v || v.cancelled || st.stage === "post") return t; // after he has gone there is nothing left to answer
  if (v.steps) {
    const ds = v.steps.map((id) => defOf(st, id));
    const hit = (r) => (ds.some((d) => d.kind === "strike" && d.region === r) ? 1 : 0);
    t.head = hit("head"); t.body = hit("body"); t.legs = hit("legs");
    t.punch = ds.some((d) => d.kind === "strike" && d.region === "head" && d.punch);
    t.td = ds.some((d) => d.kind === "takedown") ? 1 : 0;
    t.defs = ds.filter((d) => d.kind === "defence").map((d) => d.def);
    t.def = t.defs.length ? 1 : 0;
    t.exact = true;
    t.advance = ds.some((d) => d.kind === "move" && d.move === "advance");
    t.ds = ds;
  } else if (v.cat) {
    const c = v.cat;
    t.cat = c;
    if (c === "strike" || c === "pressure" || c === "chase" || c === "gnp") t[v.focus || "head"] = 1;
    if (c === "outfight") t[v.focus || "head"] = 0.6;
    if (c === "takedown") t.td = 1;
    if (c === "counter" || c === "survive" || c === "cover") t.def = 1;
    if (v.hasDef) t.def = Math.max(t.def, 0.6);
    t.advance = v.advance;
  } else {
    const c = v.cats;
    t.cats = c;
    t.head = ((c.strike || 0) + (c.pressure || 0)) * 0.6 + (c.gnp || 0) * 0.8 + (c.chase || 0);
    t.td = c.takedown || 0;
    t.def = c.counter || 0;
  }
  return t;
}

/** How much a step back is worth as the last thing a does: what of his plan would fall short? */
function wantOut(st, t) {
  const d = st.cfg.basics.retreat;
  if (st.stage === "post" || !usable(st, "a", d).ok || cost(st, "a", d) > st.a.energy) return 0;
  const v = visibleIntent(st);
  if (!v || v.cancelled) return 0;
  if (t.exact) {
    let r = st.range - 1, n = 0;
    for (const step of st.intent.steps) {
      if (step.pre) continue;
      const k = defOf(st, step.id);
      if (k.kind === "move") { if (k.move === "advance" && r === 0) r = 1; if (k.move === "retreat") r = Math.max(0, r - 1); if (k.move === "clinch") r = 2; }
      else if ((k.kind === "strike" || k.kind === "takedown") && k.range && !k.range.includes(r)) n++;
    }
    return n ? 4 + 3 * n : 0;
  }
  if (t.cat) return !t.advance && (t.cat === "strike" || t.cat === "counter" || t.cat === "takedown") ? 5 : 0;
  const c = t.cats || {};
  return (c.strike || 0) + (c.counter || 0) + (c.takedown || 0) >= 0.65 ? 3 : 0;
}

function value(st, x, t, all) {
  const A = st.a, cfg = st.cfg, lvl = readLevel(st, "a");
  if (x.type === "throttle") {
    const hot = isOpen(st, "b") || st.b.rocked;
    const want = A.hand.some((id) => { const d = defOf(st, id); return d.kind === "strike" && usable(st, "a", d).ok && cost(st, "a", d) > A.energy; });
    return hot && want && A.gas - cfg.throttle.gas > A.f.gas * cfg.lowGasFrac ? 6 : 0;
  }
  if (x.type === "struggle") return all.some((y) => y.d && y.d.kind === "escape") || A.energy >= cfg.basics.getup.cost ? 3 : 0;
  const d = x.d, c = cost(st, "a", d), per = (v) => v / (c + 0.6);
  switch (d.kind) {
    case "strike": {
      const pv = preview(st, "a", d, lvl >= 2);
      if (pv.blocked === "slip" || pv.blocked === "check") return -1;
      let v = pv.dmg * pv.hits * (pv.clean + (1 - pv.clean) * cfg.hit.graze) + pv.ko * pv.clean * 40;
      if (d.finisher && !pv.up) v -= 4 * (1 - pv.clean);
      if (d.setup) v += 2;
      if (lvl < 2 && t.def > 0.5 && d.region === "head" && d.punch) v *= 0.6;
      return per(v);
    }
    case "feint": {
      const follow = all.some((y) => y.d && y.d !== d && (y.d.kind === "strike" || y.d.kind === "takedown"));
      if (!follow) return 0;
      return per((c === 0 ? 2.5 : 0.8) + ((d.baits || []).some((k) => t.defs.includes(k)) ? 12 : t.exact ? 0 : t.def * 5));
    }
    case "defence": {
      const k = t.out > 0 ? 0.3 : 1; // if a is going to step out of reach anyway, a defence is mostly wasted
      if (d.def === "guard") return per(t.head * 8 + t.body * 2) * k;
      if (d.def === "slip") return per(t.exact ? (t.punch ? 14 : 0) : t.head * 7) * k;
      if (d.def === "check") return per(t.legs * 9) * k;
      if (d.def === "sprawl") return per(t.td * 14) * k;
      return 0;
    }
    case "move":
      if (d.move === "retreat") return -1; // handled in smartPick(): it is only ever the closing move
      if (d.move === "advance") {
        if (A.backed && st.stage !== "post") return 0;
        if (st.range > 0) return onCage(st, "b") || t.out > 0 ? 0 : per(1.2);
        const n = A.hand.filter((id) => { const k = defOf(st, id); return k.range && k.range.includes(1) && !k.range.includes(0) && k.scene === "stand"; }).length;
        return per(1.5 + 2 * n);
      }
      if (d.move === "circle") return per(3);
      if (d.move === "clinch") return per(A.hand.some((id) => { const k = defOf(st, id); return k.range && k.range.length === 1 && k.range[0] === 2; }) ? 4 : 0);
      return 0;
    case "takedown": return per(preview(st, "a", d, lvl >= 2).p * 10);
    case "control": return per(4);
    case "pass": return per(2);
    case "escape": return per(preview(st, "a", d).p * 12);
    default: return -1;
  }
}

/** The reading bot. o.noDef: never defends. o.noMove: footwork only to close the distance. */
function smartPick(st, o = {}) {
  let all = legal(st);
  if (o.noDef) all = all.filter((x) => !(x.d && x.d.kind === "defence"));
  if (o.noMove) all = all.filter((x) => !(x.d && x.d.kind === "move" && x.d.basic && !(x.d.move === "advance" && st.range === 0)));
  if (!all.length) return null;
  const t = threat(st), pre = st.stage === "pre";
  if (pre && st.a.backed) return null; // stepped out: wait for him to fall short, then counter
  t.out = o.noMove ? 0 : wantOut(st, t);
  const tired = st.a.gas < st.a.f.gas * 0.45, bar = tired ? 3.2 : 1.2;
  const score = all.map((x) => [x, x.d && x.d.move === "retreat" ? -1 : value(st, x, t, all)]);
  // counter-fighting: if an answer is worth setting (or a step back is), keep the rest of the energy for after he has gone
  const answer = (x) => x.d && x.d.kind === "defence" && x.d.def !== "guard";
  const hold = pre && !st.b.rocked && (t.out > 0 || Object.keys(st.a.def).some((k) => k !== "guard" && k !== "control") || score.some(([x, v]) => answer(x) && v >= 5));
  let best = null, bv = -Infinity, out = null;
  for (const [x, v] of score) {
    if (x.d && x.d.move === "retreat") { out = x; continue; }
    if (hold && !(x.d && x.d.kind === "defence")) continue;
    if (v > bv) { bv = v; best = x; }
  }
  if (best && bv >= bar) return best;
  if (out && t.out > 0 && (cost(st, "a", out.d) === 0 || t.out >= 7)) return out;
  return null;
}

export const bots = {
  smart: (st) => smartPick(st),
  nodef: (st) => smartPick(st, { noDef: true }),
  nomove: (st) => smartPick(st, { noMove: true }),
  allout(st) {
    const all = legal(st);
    const hits = all.filter((x) => x.d && x.d.kind === "strike").sort((x, y) => y.d.dmg * (y.d.hits || 1) - x.d.dmg * (x.d.hits || 1));
    if (hits.length) return hits[0];
    const adv = all.find((x) => x.d && x.d.move === "advance" && st.range === 0);
    if (adv) return adv;
    const up = all.find((x) => x.d && x.d.kind === "escape");
    if (up) return up;
    return null;
  },
  turtle(st) {
    const all = legal(st);
    return all.find((x) => x.d && x.d.kind === "defence") || all.find((x) => x.d && x.d.kind === "strike" && x.d.cost === 0) || all.find((x) => x.d && x.d.kind === "escape") || null;
  },
  random(st) {
    const all = legal(st).filter((x) => x.type === "card" || x.type === "basic");
    if (!all.length || rand(st) < 0.15) return null;
    return all[Math.floor(rand(st) * all.length)];
  },
};

/** Play one whole bout with a bot answering for side a. */
export function runBout(data, aId, bId, seed, bot = bots.smart) {
  const st = createBout(data, aId, bId, seed);
  let acts = 0, exs = 0, guard = 0;
  while (!st.over && guard++ < 500) {
    if (st.phase === "corner") { corner(st, cornerPick(st, "a"), cornerPick(st, "b")); continue; }
    lead(st);
    exs++;
    for (let i = 0; i < 30 && !st.over; i++) { const x = bot(st); if (!x || !act(st, x)) break; acts++; }
    runIntent(st);
    for (let i = 0; i < 30 && !st.over; i++) { const x = bot(st); if (!x || !act(st, x)) break; acts++; }
    endExchange(st);
  }
  st.meta = { acts, exs };
  return st;
}
