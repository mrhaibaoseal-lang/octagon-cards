// Octagon Cards V2 — the leader's intent AI (side b) and the answering bots used by the simulation.
// The intent AI reads only the fighter's `ai` block in rules/v2/fighters.json; the category shares it
// reports are the real weights it then samples from, so what the player is shown is never a lie.

import { defOf, rand, cost, usable, onCage, lowGas, legStacks, scene, readLevel, preview, legal, visibleIntent, setIntent, act, endExchange, corner, isOpen, createBout } from "./engine.js";

const CONDS = {
  aHurtBody: (st) => st.a.bodyLoss >= 1,
  aHurtLegs: (st) => legStacks(st, "a") >= 1,
  aTired: (st) => lowGas(st, "a"),
  aCage: (st) => onCage(st, "a"),
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
  const bd = { steps: [], e: energy, r: st.range, used: new Set() };
  bd.add = (d, i) => {
    const c = cost(st, "b", d);
    if (c > bd.e) return false;
    bd.e -= c;
    bd.steps.push({ id: d.id });
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

function addStrikes(st, bd, focus, max = 9, noFinisher = false) {
  const B = st.cfg.basics;
  if (bd.r === 0) {
    const all = bd.cards((d) => isAtk(d, "stand"));
    const far = all.filter((x) => x.d.range && x.d.range.includes(0)).length;
    const near = all.filter((x) => x.d.range && x.d.range.includes(1)).length;
    if (near > far) bd.add(B.advance);
  }
  const list = bd.cards((d) => isAtk(d, "stand") && bd.inRange(d) && !(noFinisher && d.finisher)).sort((x, y) => rank(x.d, focus) - rank(y.d, focus));
  let n = 0;
  for (const x of list) { if (n >= max) break; if (bd.add(x.d, x.i)) n++; }
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
    w = {
      strike: hand.some((d) => isAtk(d, "stand") && d.kind === "strike") ? ai.aggression : 0,
      takedown: hand.some((d) => d.kind === "takedown") ? ai.grapple : 0,
      counter: ai.caution,
      move: ai.move * (onCage(st, "b") ? 4 : 1),
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
  const pushy = cat === "strike" || cat === "chase" || cat === "takedown" || cat === "gnp";
  if (pushy && B.gas - cfg.throttle.gas > B.f.gas * cfg.lowGasFrac && (cat === "chase" || rand(st) < ai.throttle)) throttle = 1;
  const bd = builder(st, B.energy + throttle * cfg.throttle.energy);

  let focus = null;
  if (cat === "strike" || cat === "chase" || cat === "move") {
    const rw = { head: 0, body: 0, legs: 0 };
    for (const d of hand) if (d.kind === "strike" && d.scene === sc) rw[d.region] = d.region === "head" ? 1 : ai[d.region];
    focus = cat === "chase" ? "head" : pick(st, rw);
    if (sc === "top") focus = "head";
  }

  if (sc === "stand") {
    if (cat === "strike" || cat === "chase") addStrikes(st, bd, focus);
    else if (cat === "takedown") {
      if (bd.r === 0) bd.add(Bs.advance);
      const td = bd.cards((d) => d.kind === "takedown")[0];
      if (td) {
        const setup = bd.cards((d) => (d.kind === "feint" || d.setup) && d.scene === "stand" && bd.inRange(d) && cost(st, "b", d) <= bd.e - cost(st, "b", td.d))[0];
        if (setup) bd.add(setup.d, setup.i);
        bd.add(td.d, td.i);
      }
      addStrikes(st, bd, null, 1, true);
    } else if (cat === "counter" || cat === "survive") {
      const have = {};
      for (const x of bd.cards((d) => d.kind === "defence" && d.scene === "stand")) have[x.d.def] = x;
      const h = st.a.hist;
      let want = null;
      if (cat === "survive") want = "guard";
      else if (h.n > 0 && rand(st) < ai.adapt) {
        const top = Object.entries({ head: h.head, legs: h.legs, td: h.td }).sort((x, y) => y[1] - x[1])[0][0];
        want = top === "head" ? (have.slip ? "slip" : "guard") : top === "legs" ? "check" : "sprawl";
      } else { const ks = [...Object.keys(have), "guard"]; want = ks[Math.floor(rand(st) * ks.length)]; }
      if (want !== "guard" && have[want]) bd.add(have[want].d, have[want].i); else bd.add(Bs.guard);
      if (cat === "survive") { if (bd.r > 0 && !onCage(st, "b")) bd.add(Bs.retreat); }
      else addStrikes(st, bd, null, 2, true);
    } else {
      if (onCage(st, "b")) bd.add(Bs.circle);
      else if (bd.r === 0) bd.add(Bs.advance);
      addStrikes(st, bd, focus, 2, true);
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
  const t = { head: 0, body: 0, legs: 0, td: 0, def: 0, defs: [], punch: null, exact: false, advance: true };
  if (!v || v.cancelled) return t;
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
    if (c === "strike" || c === "chase" || c === "gnp") t[v.focus || "head"] = 1;
    if (c === "move") t[v.focus || "head"] = 0.4;
    if (c === "takedown") t.td = 1;
    if (c === "counter" || c === "survive" || c === "cover") t.def = 1;
    if (v.hasDef) t.def = Math.max(t.def, 0.6);
    t.advance = v.advance;
  } else {
    const c = v.cats;
    t.head = (c.strike || 0) * 0.6 + (c.gnp || 0) * 0.8 + (c.chase || 0);
    t.td = c.takedown || 0;
    t.def = c.counter || 0;
  }
  return t;
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
  const last = A.energy === c;
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
      return per(2.5 + ((d.baits || []).some((k) => t.defs.includes(k)) ? 7 : t.exact ? 0 : t.def * 3));
    }
    case "defence":
      if (d.def === "guard") return per(t.head * 8 + t.body * 2);
      if (d.def === "slip") return per(t.exact ? (t.punch ? 12 : 0) : t.head * 6);
      if (d.def === "check") return per(t.legs * 7);
      if (d.def === "sprawl") return per(t.td * 14);
      return 0;
    case "move":
      if (d.move === "retreat") {
        if (!last) return 0;
        if (t.td >= 0.8) return per(9);
        if (t.exact && !t.advance && t.ds.some((s) => s.kind === "strike") && t.ds.every((s) => s.kind !== "strike" || !(s.range || [0]).includes(st.range - 1))) return per(10);
        return 0;
      }
      if (d.move === "advance") {
        if (st.range > 0) return onCage(st, "b") ? 0 : per(1.2);
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

export const bots = {
  smart(st) {
    const all = legal(st);
    if (!all.length) return null;
    const t = threat(st);
    let best = null, bv = -Infinity;
    for (const x of all) { const v = value(st, x, t, all); if (v > bv) { bv = v; best = x; } }
    const tired = st.a.gas < st.a.f.gas * 0.45;
    return bv >= (tired ? 3.2 : 1.2) ? best : null;
  },
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
    endExchange(st);
  }
  st.meta = { acts, exs };
  return st;
}
