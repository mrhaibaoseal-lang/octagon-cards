// V3 greybox AI. Produces the same input object a player would. Reaction delay, no peeking at the future.
import { canUse, dist, inRange } from "./engine.js";

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
  };
}

export function aiInput(ai, st, me, dt) {
  const cfg = st.cfg, r = ai.rand, ms = dt * 1000;
  const f = st.f[me], o = st.f[1 - me];
  const d = dist(f, o);
  const inp = { fwd: 0, side: 0, guard: false, dodge: false, atk: null };
  ai.guardT -= ms; ai.think -= ms; ai.circleT -= ms;

  // 1. react to the opponent's attack after a human-like delay
  if (o.act && o.act !== ai.seenAct) {
    ai.seenAct = o.act;
    ai.react = { at: between(r, cfg.ai.react), act: o.act };
  }
  if (ai.react) {
    ai.react.at -= ms;
    if (ai.react.at <= 0) {
      const act = ai.react.act;
      ai.react = null;
      const m = cfg.moves[act.move];
      if (o.act === act && act.phase === "windup" && d <= m.max + (m.lunge || 0) + 0.3) {
        const c = weighted(r, ai.respond);
        if (c === "guard") ai.guardT = cfg.ai.guardHold;
        else if (c === "dodge") { inp.dodge = true; inp.fwd = -0.6; inp.side = ai.circleDir; }
        else if (c === "counter") {
          const fast = f.kit.filter((k) => canUse(st, f, k) && inRange(st, f, k) && cfg.moves[k].windup < m.windup - act.t)
            .sort((a, b) => cfg.moves[a].windup - cfg.moves[b].windup)[0];
          if (fast) inp.atk = fast; else ai.guardT = cfg.ai.guardHold;
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
    const ready = f.kit.filter((k) => !(f.cds[k] > 0));
    const pool = ready.length ? ready : f.kit;
    const w = {};
    for (const k of pool) w[k] = cfg.moves[k].dmg * (ai.prefer.includes(k) ? 2.5 : 1) + 4;
    ai.plan = weighted(r, w);
    ai.think = between(r, cfg.ai.think);
    // 3. throw something if a move reaches
    const tired = f.sta < cfg.fighter.tiredBelow;
    if (!tired && r() < ai.aggro) {
      const now = f.kit.filter((k) => canUse(st, f, k) && inRange(st, f, k) && d <= cfg.moves[k].max && d >= cfg.moves[k].min * 0.8);
      if (now.length) {
        inp.atk = now.includes(ai.plan) ? ai.plan : now[Math.floor(r() * now.length)];
        return inp;
      }
    }
  }
  const m = cfg.moves[ai.plan];
  const lo = m.min, hi = m.max;
  let want = lo + (hi - lo) * (0.55 + ai.rangeBias);
  if (f.sta < cfg.fighter.tiredBelow) want = 2.4;
  if (d > want + 0.15) inp.fwd = 1;
  else if (d < want - 0.15) inp.fwd = -1;
  if (ai.circleT <= 0) { ai.circleT = between(r, [700, 1800]); if (r() < 0.4) ai.circleDir *= -1; }
  inp.side = ai.circleDir * cfg.ai.circle;
  // stay off the fence: if close to it, circle harder and step toward centre
  const rr = Math.hypot(f.x, f.z), lim = cfg.arena.radius * 0.8;
  if (rr > lim) { inp.side = ai.circleDir; if (inp.fwd < 0) inp.fwd = 0; }
  return inp;
}
