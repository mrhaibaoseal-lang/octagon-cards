// V3 greybox AI. Produces the same input object a player would. Reaction delay, no peeking at the future.
import { canUse, dist, inRange, isTired, zoneRadius, ceilOf } from "./engine.js";

const between = (r, [a, b]) => a + (b - a) * r();
function weighted(r, w) {
  const keys = Object.keys(w);
  let s = keys.reduce((n, k) => n + w[k], 0) * r();
  for (const k of keys) if ((s -= w[k]) <= 0) return k;
  return keys[keys.length - 1];
}

export function createAI(cfg, rand, styleId) {
  const ids = Object.keys(cfg.ai.styles);
  const id = styleId && cfg.ai.styles[styleId] ? styleId : ids[Math.floor(rand() * ids.length)];
  const s = cfg.ai.styles[id];
  return {
    id, name: s.name, rand,
    aggro: s.aggro ?? cfg.ai.aggro, respond: s.respond || cfg.ai.respond,
    rangeBias: s.rangeBias || 0, prefer: s.prefer || [],
    think: 0, plan: null, circleDir: rand() < 0.5 ? 1 : -1, circleT: 0,
    seenAct: null, react: null, guardT: 0, out: {},
    retreatMult: s.retreatMult ?? 1, waitForEntry: !!s.waitForEntry,
    mode: "attack", modeT: 0, burst: 0, burstMax: 0,
  };
}

const probing = (st) => st.round === 1 && st.cfg.round.seconds * 1000 - st.clock < st.cfg.ai.probe.seconds * 1000;

// wrapper: waves of 2-3 strikes, then back off to recover; the first 25 s of round 1 only feel things out
export function aiInput(ai, st, me, dt) {
  const cfg = st.cfg, r = ai.rand, w = cfg.ai.wave, f = st.f[me], o = st.f[1 - me], ms = dt * 1000;
  const probe = probing(st);
  ai.probe = probe;
  if (!ai.burstMax) ai.burstMax = Math.round(between(r, w.burst));
  ai.modeT += ms;
  const wait = () => { ai.mode = "wait"; ai.modeT = 0; ai.waitFor = between(r, w.retreat) * ai.retreatMult; ai.burst = 0; ai.burstMax = 0; };
  if (ai.mode === "attack") {
    if ((ai.burst >= ai.burstMax && !f.act) || f.gotCounter || ai.modeT > w.attackMax) wait();
  } else {
    const rested = f.sta >= ceilOf(st, f) * w.resume;
    const entered = dist(f, o) <= zoneRadius(st, f);
    const timeUp = ai.modeT >= ai.waitFor && (!ai.waitForEntry || entered);
    if (rested && (timeUp || ai.modeT >= w.waitMax)) { ai.mode = "attack"; ai.modeT = 0; ai.burst = 0; ai.burstMax = Math.round(between(r, w.burst)); }
  }
  f.gotCounter = false;
  const inp = decide(ai, st, me, dt);
  if (inp.atk) {
    if (probe && !cfg.ai.probe.moves.includes(inp.atk)) inp.atk = null;
    else ai.burst++;
  }
  return inp;
}

function decide(ai, st, me, dt) {
  const cfg = st.cfg, r = ai.rand, ms = dt * 1000;
  const f = st.f[me], o = st.f[1 - me];
  const d = dist(f, o);
  const inp = { fwd: 0, side: 0, guard: false, dodge: false, atk: null };
  const allowed = (k) => !ai.probe || cfg.ai.probe.moves.includes(k);
  ai.guardT -= ms; ai.think -= ms; ai.circleT -= ms;

  // 1. react to the opponent's attack after a human-like delay
  ai.now = (ai.now || 0) + ms;
  if (o.act && o.act !== ai.seenAct) {
    ai.seenAct = o.act;
    ai.react = { at: between(r, cfg.ai.react), act: o.act };
    (ai.recent ||= []).push({ t: ai.now, w: cfg.moves[o.act.move].weight });
  }
  ai.recent = (ai.recent || []).filter((x) => ai.now - x.t < cfg.ai.spam.window);
  if (ai.react) {
    ai.react.at -= ms;
    if (ai.react.at <= 0 && f.stun <= 0 && !f.act) {
      const act = ai.react.act;
      ai.react = null;
      const m = cfg.moves[act.move];
      // still answers while the strike is out or being pulled back (a jab is faster than any reaction)
      if (o.act === act && d <= m.max + (m.lunge || 0) + 0.3) {
        let w = { ...ai.respond };
        // reads a repeated pattern: lots of strikes lately -> more likely to fire back through them
        if (ai.recent.length >= cfg.ai.spam.count) w = { ...w, counter: w.counter * cfg.ai.spam.counter, none: w.none * 0.3 };
        if (act.phase !== "windup") w = { ...w, dodge: 0, guard: w.guard * 0.5 };
        const c = weighted(r, w);
        if (c === "guard") ai.guardT = cfg.ai.guardHold;
        else if (c === "dodge") { inp.dodge = true; inp.fwd = -0.6; inp.side = ai.circleDir; }
        else if (c === "counter") {
          const ok = f.kit.filter((k) => allowed(k) && canUse(st, f, k) && inRange(st, f, k) && d <= cfg.moves[k].max);
          // prefer something heavier that walks through his strike; else the quickest thing that lands first
          const heavy = ok.filter((k) => cfg.moves[k].weight > m.weight).sort((a, b) => cfg.moves[b].dmg - cfg.moves[a].dmg)[0];
          const fast = ok.filter((k) => act.phase !== "windup" || cfg.moves[k].windup < act.wu - act.t)
            .sort((a, b) => cfg.moves[a].windup - cfg.moves[b].windup)[0];
          const pick = heavy || fast;
          if (pick) inp.atk = pick; else ai.guardT = cfg.ai.guardHold;
        }
      }
    }
  }
  if (inp.dodge || inp.atk) return inp;
  if (ai.guardT > 0) {
    inp.guard = true;
    inp.fwd = -0.3;
    return inp;
  }

  // 2. pick a plan (the move it wants to land next) and spacing
  if (!ai.plan || !f.kit.includes(ai.plan) || ai.think <= 0) {
    const ready = f.kit.filter((k) => allowed(k) && !(f.cds[k] > 0));
    const pool = ready.length ? ready : f.kit.filter(allowed);
    const w = {};
    for (const k of pool) w[k] = cfg.moves[k].dmg * (ai.prefer.includes(k) ? 2.5 : 1) + 4;
    ai.plan = weighted(r, w);
    ai.think = between(r, cfg.ai.think);
    // 3. throw something if a move reaches
    const tired = isTired(st, f);
    if (ai.mode === "attack" && !tired && r() < ai.aggro * (ai.probe ? cfg.ai.probe.aggro : 1)) {
      const now = f.kit.filter((k) => allowed(k) && canUse(st, f, k) && inRange(st, f, k) && d <= cfg.moves[k].max && d >= cfg.moves[k].min * 0.8);
      if (now.length) {
        inp.atk = now.includes(ai.plan) ? ai.plan : now[Math.floor(r() * now.length)];
        return inp;
      }
    }
  }
  const m = cfg.moves[ai.plan];
  const lo = m.min, hi = m.max;
  let want = lo + (hi - lo) * (0.55 + ai.rangeBias);
  if (isTired(st, f)) want = 2.4;
  // backing off: stand just outside the opponent's fire zone, where stamina comes back fast
  if (ai.mode === "wait") want = zoneRadius(st, f) + 0.15;
  if (d > want + 0.15) inp.fwd = 1;
  else if (d < want - 0.15) inp.fwd = -1;
  if (ai.circleT <= 0) { ai.circleT = between(r, [700, 1800]); if (r() < 0.4) ai.circleDir *= -1; }
  inp.side = ai.circleDir * cfg.ai.circle;
  // stay off the fence: if close to it, circle harder and step toward centre
  const rr = Math.hypot(f.x, f.z), lim = cfg.arena.radius * 0.8;
  if (rr > lim) { inp.side = ai.circleDir; if (inp.fwd < 0) inp.fwd = 0; }
  return inp;
}
