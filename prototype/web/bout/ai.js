// Opponent for the card bout. It sees what the player sees: the table, its own hand, the player's held card,
// and whether the player has a trap set (not which). It learns the player's habits over the fight.
import { actions, odds, dmgMul, other, danger, headRatio, limping, heldCard, chaseOdds, stepOk, stepCost, rangeBonus, cornerOptions, injuries, partRatio, planDmg, tdOdds, sprawlOdds, groundOdds, groundRole, PLANS, TARGETS } from "./engine.js";

const MOVES = ["advance", "retreat", "sidestep", "guard"];
const KINDS = ["card", "feint", "takedown", "sprawl", ...MOVES];

/** How likely is the opponent to do each thing this beat (and how often they step in / out with a card). */
function oppModel(st, s, adapt) {
  const o = st[other(s)];
  const fw = st.data.fighters[o.id].weights;
  let wAll = 0, wTd = 0;
  for (const [id, k] of Object.entries(fw)) {
    wAll += k;
    if (st.data.cards[id].kind === "takedown") wTd += k;
  }
  const prior = { card: 0.55, feint: 0.06, takedown: Math.min(0.3, (wTd / wAll) * 1.3), sprawl: 0.03, advance: 0.1, retreat: 0.07, guard: 0.1, sidestep: 0.07 };
  const n = KINDS.reduce((x, k) => x + (o.hist[k] || 0), 0);
  const out = {};
  const w = Math.min(adapt, n / (n + 6));
  for (const k of KINDS) out[k] = prior[k] * (1 - w) + (n > 0 ? (o.hist[k] || 0) / n : prior[k]) * w;
  const cards = Math.max(1, o.hist.card + o.hist.feint + o.hist.takedown + o.hist.sprawl);
  out.stepIn = 0.25 * (1 - w) + (o.hist.stepIn / cards) * w;
  out.stepOut = 0.15 * (1 - w) + (o.hist.stepOut / cards) * w;
  return out;
}

/** Of the opponent's strikes, how often does one carry `tag`? From their habits, falling back to their card pool. */
function tagShare(st, s, tag) {
  const o = st[other(s)];
  const seen = Object.values(o.tagHist).reduce((a, b) => a + b, 0);
  if (seen >= 4) return (o.tagHist[tag] || 0) / Math.max(1, o.hist.card);
  const w = st.data.fighters[o.id].weights;
  let all = 0, hit = 0;
  for (const [id, k] of Object.entries(w)) {
    const c = st.data.cards[id];
    if (c.kind !== "strike") continue;
    all += k;
    if (c.tags.includes(tag)) hit += k;
  }
  return all ? hit / all : 0;
}

const regionValue = (st, s, card, prof) => {
  if (card.region === "head") return 1.0 + (danger(st, other(s)) ? 0.4 : 0);
  if (card.region === "body") return 0.6 + prof.body * 0.5;
  return 0.45 + prof.body * 0.4 + (limping(st, other(s)) ? 0.15 : 0);
};

/** What being on the ground is worth to `side` (damage-equivalent): high for grapplers who are better down there. */
function groundValue(st, side, prof) {
  const f = st.data.fighters[st[side].id].ground;
  const fo = st.data.fighters[st[other(side)].id].ground;
  const edge = f.top + f.sub - (fo.escape + fo.bottom);
  const danger2 = danger(st, other(side)) ? 1 : 0;
  return -1.5 + prof.grapple * 9 + edge * 10 + danger2;
}

export function createAI(data, side, rng) {
  const thinkGround = (st) => {
    const me = st[side];
    const opp = st[other(side)];
    const f = data.fighters[me.id];
    const fo = data.fighters[opp.id];
    const prof = f.ai;
    const g = data.config.ground;
    const role = groundRole(st, side);
    const pos = st.ground.pos;
    const stam = me.stamina / me.staminaMax;
    const sv = 0.25 + (1 - stam) * 0.6;
    // what the other side is likely to do: role priors, shifted by what they have done so far
    const prior = role === "top" ? { defend: 0.35, escape: 0.22, sweep: 0.12, sub: 0.1, getup: 0.21 } : { pound: 0.38, advance: 0.18, sub: 0.12, ride: 0.27, release: 0.05 };
    const n = Object.keys(prior).reduce((x, k) => x + (opp.ghist[k] || 0), 0);
    const w = Math.min(prof.adapt, n / (n + 6));
    const pOpp = {};
    for (const k of Object.keys(prior)) pOpp[k] = prior[k] * (1 - w) + (n > 0 ? (opp.ghist[k] || 0) / n : prior[k]) * w;
    const expP = (act, base) => Object.entries(pOpp).reduce((x, [k, pk]) => x + pk * groundOdds(st, side, act, base, k).p, 0);
    let best = null;
    const consider = (v, choice) => {
      v *= 1 + (rng() - 0.5) * 2 * prof.noise;
      if (!best || v > best.v) best = { v, choice };
    };
    const mine = f.ground;
    for (const a of actions(st, side)) {
      if (!a.ok) continue;
      let v;
      if (a.kind === "card") {
        const card = data.cards[a.id];
        const p = expP(card.act, card.hit);
        if (card.act === "pound") {
          const fac = 1 - (pOpp.defend || 0) * (1 - g.moves.defend.dmgMul);
          const dmg = card.dmg * f.power * mine.gnp * g.posDmg[pos] * planDmg(st, side, card) * (a.charged ? data.config.charge.dmgMul : 1);
          v = p * dmg * fac * 1.15 + (danger(st, other(side)) ? p * ((card.ko || 0) + 0.08) * 22 : 0);
        } else if (card.act === "advance") v = p * (pos === 0 ? 3.2 : 3.8) * (0.7 + prof.grapple * 0.6);
        else if (card.act === "sub") {
          const tap = Math.max(0.05, Math.min(0.8, 0.3 + 1.2 * (mine.sub - fo.ground.escape) + (card.power || 0)));
          v = p * (tap * 16 + 1.5);
        } else if (card.act === "sweep") v = p * 5;
        else v = p * (3 + pos * 1.2); // escape
        v -= card.cost * sv;
      } else {
        const mv = g.moves[a.id];
        if (mv.act === "ride") v = 0.3 + mv.regen * sv + mv.drain * 0.3;
        else if (mv.act === "release") v = stam < 0.25 ? 1.6 : st.ground.stall >= g.stallMax - 1 ? 0.2 : -2 + (1 - prof.grapple) * 0.5;
        else if (mv.act === "defend") v = (pOpp.pound || 0) * 4.5 * (1 - mv.dmgMul) + mv.regen * sv + (danger(st, side) ? 1.2 : 0);
        else v = expP("getup", mv.hit) * (3 + (1 - prof.grapple) * 9) - mv.cost * sv; // getup
      }
      consider(v, a.kind === "card" ? { card: a.idx } : { move: a.id });
    }
    return best.choice;
  };
  const think = (st) => {
    if (st.mode === "ground") return thinkGround(st);
    const me = st[side];
    const opp = st[other(side)];
    const f = data.fighters[me.id];
    const prof = f.ai;
    const cfg = data.config;
    const model = oppModel(st, side, prof.adapt);
    const stam = me.stamina / me.staminaMax;
    const sv = 0.25 + (1 - stam) * 0.6; // what one point of stamina is worth right now (in damage)
    const oppHeld = heldCard(st, other(side));
    const oppHeldCard = oppHeld ? data.cards[oppHeld] : null;
    const threat = (oppHeldCard?.kind === "strike" ? oppHeldCard.dmg * 0.5 : 0) + 3.5;
    const pAttack = model.card + (oppHeldCard?.kind === "strike" ? 0.15 : 0);
    const trapRisk = (card) => {
      if (!opp.trap) return 0;
      let all = 0, hit = 0;
      for (const [id, k] of Object.entries(data.fighters[opp.id].weights)) {
        const c = data.cards[id];
        if (c.kind !== "trap") continue;
        all += k;
        if (c.trap.on.tag && card.tags.includes(c.trap.on.tag)) hit += k;
      }
      return all ? hit / all : 0;
    };
    // the opponent's possible actions and where the distance ends up for my step
    const scen = [
      ["card", model.card * (1 - model.stepIn - model.stepOut), 0],
      ["cardIn", model.card * model.stepIn, 1],
      ["cardOut", model.card * model.stepOut, -1],
      ["feint", model.feint, 0],
      ["takedown", model.takedown, 0],
      ["sprawl", model.sprawl, 0],
      ...MOVES.map((m) => [m, model[m], cfg.moves[m].dist]),
    ];
    const strikeEV = (card, charged, step) => {
      let ev = 0;
      for (const [m, pm, dd] of scen) {
        const nd = Math.max(0, Math.min(3, st.dist + step + (MOVES.includes(m) ? dd : 0)));
        if (!card.range.includes(nd)) continue;
        const opp2 = MOVES.includes(m) ? { move: m } : { step: dd, shoot: m === "takedown" };
        ev += pm * odds(st, side, card, { opp: opp2, d: nd }).exp;
      }
      return ev * card.dmg * f.power * dmgMul(st, side, card, charged, false) * regionValue(st, side, card, prof);
    };
    let best = null;
    const consider = (v, choice) => {
      v *= 1 + (rng() - 0.5) * 2 * prof.noise;
      if (!best || v > best.v) best = { v, choice };
    };
    for (const step of [-1, 0, 1]) {
      if (!stepOk(st, side, step)) continue;
      const nd = st.dist + step;
      for (const a of actions(st, side, step)) {
        if (a.kind !== "card" || !a.ok || a.side) continue;
        const card = data.cards[a.id];
        let v;
        if (card.kind === "strike") {
          v = strikeEV(card, a.charged, step) * (0.8 + prof.aggression * 0.5) - (card.cost + stepCost(st, side, step)) * sv;
          if (card.heavy) v -= 0.35 * prof.caution * 2;
          v -= trapRisk(card) * 4;
          if (step > 0 && opp.trap) v -= 1.2; // stepping in might walk into a counter trap
          if (card.ko && danger(st, other(side))) v += card.ko * 20;
          if (card.rarity === "sig") v += 0.5;
        } else if (card.kind === "takedown") {
          const o = tdOdds(st, side, card);
          const sp = model.sprawl > 0.05 ? sprawlOdds(st, other(side), { hit: 0.5 }) * model.sprawl : 0;
          const pOk = o.p * (1 - sp);
          v = pOk * groundValue(st, side, prof) - (1 - pOk) * 1.6 - (card.cost + stepCost(st, side, step)) * sv;
          if (step > 0 && opp.trap) v -= 1.2;
        } else if (card.kind === "sprawl") {
          if (step) continue;
          const sp = sprawlOdds(st, side, card);
          v = model.takedown * sp * (0.7 * Math.max(0, groundValue(st, other(side), data.fighters[opp.id].ai)) + 3) - card.cost * sv - 0.4;
        } else {
          if (step) continue; // feints are thrown standing
          const pDef = card.feint.against.reduce((x, m) => x + (model[m] || 0), 0) + (card.feint.against.includes("retreat") ? model.card * model.stepOut : 0);
          v = pDef * 6 - card.cost * sv - 0.3;
        }
        // being at my favourite range next beat is worth something
        v += rangeBonus(st, side, nd) * 4 - 0.15 * Math.abs(nd - prof.range);
        consider(v, { card: a.idx, step });
      }
    }
    for (const a of actions(st, side, 0)) {
      if (a.kind !== "move" || !a.ok) continue;
      let v;
      if (a.id === "guard") v = pAttack * threat * 0.34 * (0.5 + prof.caution) + cfg.moves.guard.regen * sv + (danger(st, side) ? 1.2 : 0) - 0.2;
      else if (a.id === "sidestep") v = pAttack * threat * 0.35 * (0.4 + prof.caution) - a.cost * sv - 0.1;
      else {
        const nd = Math.max(0, Math.min(3, st.dist + cfg.moves[a.id].dist));
        v = 0.6 + rangeBonus(st, side, nd) * 4 - 0.3 * Math.abs(nd - prof.range) - 0.5;
        if (a.id === "retreat" && danger(st, side)) v += 1.0;
        if (a.id === "advance" && opp.trap) v -= 0.8;
      }
      consider(v, { move: a.id });
    }
    const choice = best.choice;
    // side action: set a trap if I have one and it is likely to fire
    let used = choice.card != null ? data.cards[me.hand[choice.card].id].cost + stepCost(st, side, choice.step || 0) : actions(st, side).find((x) => x.id === choice.move)?.cost || 0;
    if (!me.trap) {
      let bt = null;
      me.hand.forEach((h, i) => {
        const c = data.cards[h.id];
        if (c.kind !== "trap" || i === choice.card || used + c.cost > me.stamina) return;
        const on = c.trap.on;
        const pOne = on.move === "advance" ? model.advance + model.card * model.stepIn : on.move ? model[on.move] || 0 : model.card * tagShare(st, side, on.tag);
        const pFire = 1 - Math.pow(1 - pOne, c.trap.beats);
        const v = pFire * (c.trap.dmg + 3) - c.cost * sv * 2;
        if (v > 1.5 && (!bt || v > bt.v)) bt = { v, i, cost: c.cost };
      });
      if (bt) { choice.trap = bt.i; used += bt.cost; }
    }
    // hold: keep the best strike for next beat
    let hold = null, hv = 1.2;
    me.hand.forEach((h, i) => {
      if (i === choice.card || i === choice.trap) return;
      const c = data.cards[h.id];
      if (c.kind !== "strike") return;
      const v = c.dmg * c.hit * (c.heavy ? 1.2 : 1) * (c.rarity === "sig" ? 1.5 : 1);
      if (v > hv) { hv = v; hold = i; }
    });
    choice.hold = hold;
    if (choice.card != null) {
      const card = data.cards[me.hand[choice.card].id];
      choice.boost = card.kind === "strike" && card.dmg >= 8 && me.stamina >= used + cfg.boost.cost + 2 && (danger(st, other(side)) || rng() < prof.aggression * 0.3);
    }
    return choice;
  };
  const chase = (st) => {
    const prof = data.fighters[st[side].id].ai;
    return st[side].stamina >= data.config.chase.cost && chaseOdds(st, other(side)) + prof.aggression * 0.2 >= 0.55;
  };
  // Between rounds the computer uses what a player could use: the table (damage dots and stamina are visible),
  // its own fighter's habits, and the coach's report (a noisy "feel" and true observations) when it asked for one.
  const corner = (st) => {
    const me = st[side];
    const opts = cornerOptions(st, side);
    const stam = me.stamina / me.staminaMax;
    const picks = [];
    if (opts.doctor && injuries(st, side)[0].ratio >= 0.6) picks.push("doctor");
    picks.push(stam < 0.55 ? "rest" : "coach");
    picks.push(stam < 0.55 ? "coach" : "rest");
    return [...new Set(picks)].slice(0, 2);
  };
  const plan = (st, info) => {
    const me = st[side];
    const oside = other(side);
    const opp = st[oside];
    const prof = data.fighters[me.id].ai;
    const cfg = data.config;
    const stamR = me.stamina / me.staminaMax;
    const oppStam = opp.stamina / opp.staminaMax;
    const myHead = headRatio(st, side);
    const oppHead = headRatio(st, oside);
    const feel = info?.intel?.feel || "close";
    const last = st.rounds[st.rounds.length - 1];
    const seen = last?.mix[oside];
    const oppFighter = data.fighters[opp.id];
    const lastRound = st.round === cfg.rounds - 1;
    // steady unless something clear says otherwise
    const behind = feel === "theirs";
    const score = {
      steady: 0.75,
      probe: 0.3 + (st.round === 0 ? 0.25 : 0) + (stamR < 0.4 ? 0.9 : 0),
      pressure: 0.3 + prof.aggression * 0.3 + (oppStam < 0.45 ? 0.6 : 0) + (seen && seen.retreat + seen.stepOut >= 4 ? 0.3 : 0) - (stamR < 0.5 ? 0.8 : 0),
      counter: 0.1 + prof.caution * 0.3 + (myHead >= 0.45 ? 0.7 : 0) + (feel === "ours" ? 0.15 : 0) + (seen && seen.card + seen.stepIn >= 14 ? 0.2 : 0),
      grapple: 0.05 + prof.grapple + (data.fighters[me.id].ground.wrestle - oppFighter.ground.tdDef) * 2.5 - (stamR < 0.4 ? 0.3 : 0),
      burst: 0.2 + (oppHead >= 0.5 ? 0.9 : 0) + (behind && lastRound ? 0.6 : 0) - (stamR < 0.6 ? 0.8 : 0) - (myHead >= 0.5 ? 0.4 : 0),
    };
    let best = "steady", bv = -1;
    for (const [k, v] of Object.entries(score)) {
      const x = v * (1 + (rng() - 0.5) * 2 * prof.noise);
      if (x > bv) { bv = x; best = k; }
    }
    // aim where the opponent is already hurt: the bonus is small against a fresh part, big against a damaged one
    const dw = cfg.damageWeight;
    const ts = cfg.target._scale;
    let target = null, tv = 0;
    for (const part of TARGETS(data)) {
      const r = partRatio(st, oside, part);
      const sc = Math.min(ts.cap, ts.base + ts.perRatio * r);
      let v = dw[part] * (1 + (cfg.target[part].dmgMul - 1) * sc) + cfg.target[part].clean * sc * 2;
      if (part === "head") v += Math.max(0, r - 0.4) * 0.8; // closer to a knockout
      if (part === "leg" && r > 0.4 && r < 1) v += 0.35 * r; // about to limp
      if (part === "body" && r > 0.3) v += 0.3 * r * oppStam;
      if (part === "body") v += prof.body * 0.15;
      v *= 1 + (rng() - 0.5) * prof.noise;
      if (v > tv) { tv = v; target = part; }
    }
    return { plan: best, target };
  };
  return { think, chase, corner, plan };
}

/** A bot that picks any legal action at random — the baseline a real player should beat. */
export function createMasher(data, side, rng) {
  return {
    think: (st) => {
      if (st.mode === "ground") {
        const ok = actions(st, side).filter((a) => a.ok);
        const a = ok[Math.floor(rng() * ok.length)];
        const choice = a.kind === "card" ? { card: a.idx } : { move: a.id };
        const others = st[side].hand.map((_, i) => i).filter((i) => i !== choice.card);
        if (rng() < 0.3 && others.length) choice.hold = others[Math.floor(rng() * others.length)];
        return choice;
      }
      const opts = [];
      for (const step of [-1, 0, 1]) {
        if (!stepOk(st, side, step)) continue;
        for (const a of actions(st, side, step)) if (a.kind === "card" && a.ok && !a.side) opts.push({ card: a.idx, step });
      }
      for (const a of actions(st, side, 0)) if (a.kind === "move" && a.ok) opts.push({ move: a.id });
      const choice = opts[Math.floor(rng() * opts.length)];
      const me = st[side];
      const others = me.hand.map((_, i) => i).filter((i) => i !== choice.card);
      if (rng() < 0.5 && others.length) choice.hold = others[Math.floor(rng() * others.length)];
      return choice;
    },
    chase: () => rng() < 0.5,
    corner: (st) => {
      const o = cornerOptions(st, side);
      const all = ["coach", "rest", ...(o.doctor ? ["doctor"] : [])];
      return all.filter(() => rng() < 0.7).slice(0, 2);
    },
    plan: () => {
      const ps = PLANS(data), ts = [null, ...TARGETS(data)];
      return { plan: ps[Math.floor(rng() * ps.length)], target: ts[Math.floor(rng() * ts.length)] };
    },
  };
}

/** A computer opponent whose plan never changes (for balance runs): same fighting AI, same corner. */
export function createFixedPlan(data, side, rng, plan, target = null) {
  const ai = createAI(data, side, rng);
  return { ...ai, plan: () => ({ plan, target }) };
}
