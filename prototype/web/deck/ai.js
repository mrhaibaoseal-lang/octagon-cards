// Card-play AI. It runs the same engine, hands and rules as the player: it enumerates the plays it can legally make, scores the result, and picks the best.
// `look: true` is the seat that moves first and can see the other seat's committed plan, so it scores the whole exchange; `look: false` plans blind.

import { other, clone, perform, options, beginPhase, planSignature, commitPlan } from "./engine.js";

const TAKEDOWN_EFFECTS = new Set(["takedown", "pull"]);

function profile(state, side) {
  const cfg = state.data.config.ai;
  const f = state.data.fighters[state[side].id];
  const oppDeck = state.data.fighters[state[other(side)].id].deck.stand;
  const oppTakedowns = Object.entries(oppDeck).reduce((n, [id, k]) => n + (state.data.cards[id].effects.some((e) => TAKEDOWN_EFFECTS.has(e.t)) ? k : 0), 0);
  return { safe: cfg.safe, card: cfg.card, expect: cfg.expect, top: 0, bottom: 0, dist: 1, distW: 1.5, ...f.ai, sprawlVal: Math.min(6, 1 + 1.2 * oppTakedowns) };
}

function leafScore(st, me, base, prof, blind, handCrowded) {
  const o = other(me);
  const M = st[me];
  const O = st[o];
  if (st.over) return st.over.winner === me ? 1000 : st.over.winner === o ? -1000 : 0;
  let v = base.hp[o] - O.hp;
  v -= (base.hp[me] - M.hp) * prof.safe;
  v += 2 * O.dizzy + (O.stunned ? 6 : 0) + 2 * O.winded + (O.windedLoss ? 4 : 0) + 1.5 * O.legs;
  v -= 2 * M.dizzy + (M.stunned ? 6 : 0) + 2 * M.winded + (M.windedLoss ? 4 : 0) + 1.5 * M.legs;
  if (st.pos === "ground") {
    const top = st.top === me;
    v += top ? prof.top : prof.bottom;
    v += (top ? 1 : -1) * 2.5 * st.control;
    v += 2.5 * st.lock[me] * (1 + st.lock[me] / 8) - 3 * st.lock[o] * (1 + st.lock[o] / 8);
  } else v -= prof.distW * Math.abs(st.dist - prof.dist);
  v -= prof.card * (handCrowded ? 0.4 : 1) * (M.used - base.used);
  if (blind) {
    v += 0.55 * Math.min(M.block, prof.expect);
    if (M.slip) v += 0.5 * prof.expect;
    if (M.counter) v += 0.6 * prof.expect + 0.4 * M.counter.dmg;
    if (M.sprawl) v += prof.sprawlVal;
  }
  return v;
}

/** The best list of actions for `side` this phase. */
export function plan(state, side, { look = false, rng = Math.random, maxLeaves } = {}) {
  const cfg = state.data.config;
  const limit = maxLeaves ?? cfg.ai.maxLeaves;
  const prof = profile(state, side);
  const base = { hp: { a: state.a.hp, b: state.b.hp }, used: state[side].used };
  const zone = state.pos === "stand" ? "stand" : "ground";
  const crowded = state[side].hand[zone].length >= cfg.match.handLimit - 1;
  const second = other(state.first);
  let best = { score: -Infinity, seq: [] };
  const top = [];
  let leaves = 0;

  const evalLeaf = (st) => {
    let end = st;
    if (look && state.plan && !st.over) {
      end = clone(st);
      beginPhase(end, second);
      // If this line changes the position under the committed plan, the second seat re-plans with cards nobody can know yet: leave that reply out.
      const actions = state.plan.sig === planSignature(end) ? state.plan.actions : [];
      for (const a of actions) {
        if (perform(end, second, a, { committed: true }).status === "over") break;
        if (end.over) break;
      }
    }
    return leafScore(end, side, base, prof, !look, crowded) + rng() * 0.8;
  };

  const rec = (st, seq, terminal) => {
    if (leaves >= limit) return;
    leaves++;
    const score = evalLeaf(st);
    if (score > best.score) best = { score, seq };
    if (!look && seq.length) {
      top.push({ score, seq });
      if (top.length > 40) {
        top.sort((x, y) => y.score - x.score);
        top.length = 12;
      }
    }
    if (st.over || terminal) return;
    const opts = options(st, side).filter((o) => o.ok && !o.dup);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    for (const o of opts) {
      const c = clone(st);
      const action = o.k === "card" ? { k: "card", id: o.id } : { k: "step", d: o.d };
      const sig = planSignature(c);
      if (perform(c, side, action).status !== "ok") continue;
      rec(c, [...seq, action], endsPlan(c, sig, action));
    }
  };
  rec(clone(state), [], false);
  if (!look && top.length) {
    // Planning blind, the other seat may move before the plan runs: re-score the best lines with the distance one step either way, so range-limited lines are not over-valued.
    top.sort((x, y) => y.score - x.score);
    best = { score: leafScore(clone(state), side, base, prof, true, crowded), seq: [] };
    for (const cand of top.slice(0, 12)) {
      let sum = 0;
      for (const [delta, w] of [[0, 0.5], [-1, 0.25], [1, 0.25]]) {
        const c = clone(state);
        c.dist = Math.max(0, Math.min(cfg.distance.max, c.dist + delta));
        for (const a of cand.seq) if (perform(c, side, a, { committed: true }).status === "over") break;
        sum += w * leafScore(c, side, base, prof, true, crowded);
      }
      const score = sum + rng() * 0.8;
      if (score > best.score) best = { score, seq: cand.seq };
    }
  }
  return best.seq;
}

/** A play after which nobody can plan further: the position changed or cards were drawn, so what comes next is not known yet. */
export function endsPlan(st, sigBefore, action) {
  if (planSignature(st) !== sigBefore) return true;
  return action.k === "card" && st.data.cards[action.id].effects.some((e) => e.t === "draw");
}

/** The seat that moves first plays live: plan, play until something changes the picture, then plan again with what is left. */
export function playLive(state, side, { look = true, rng = Math.random } = {}) {
  for (let guard = 8; guard > 0 && !state.over; guard--) {
    const acts = plan(state, side, { look, rng });
    if (!acts.length) return;
    for (const a of acts) {
      const sig = planSignature(state);
      if (perform(state, side, a).status !== "ok") return;
      if (state.over || endsPlan(state, sig, a)) break;
    }
  }
}
