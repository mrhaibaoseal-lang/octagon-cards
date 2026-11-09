// Opponent for the card bout. It sees what the player sees: the table, its own hand, the player's held card,
// and whether the player has a trap set (not which). It learns the player's habits over the fight.
import { actions, odds, dmgMul, other, danger, headRatio, limping, heldCard, chaseOdds, stepOk, stepCost, rangeBonus } from "./engine.js";

const MOVES = ["advance", "retreat", "sidestep", "guard"];
const KINDS = ["card", "feint", ...MOVES];

/** How likely is the opponent to do each thing this beat (and how often they step in / out with a card). */
function oppModel(st, s, adapt) {
  const o = st[other(s)];
  const prior = { card: 0.6, feint: 0.06, advance: 0.1, retreat: 0.07, guard: 0.1, sidestep: 0.07 };
  const n = KINDS.reduce((x, k) => x + (o.hist[k] || 0), 0);
  const out = {};
  const w = Math.min(adapt, n / (n + 6));
  for (const k of KINDS) out[k] = prior[k] * (1 - w) + (n > 0 ? (o.hist[k] || 0) / n : prior[k]) * w;
  const cards = Math.max(1, o.hist.card + o.hist.feint);
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

export function createAI(data, side, rng) {
  const think = (st) => {
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
      ...MOVES.map((m) => [m, model[m], cfg.moves[m].dist]),
    ];
    const strikeEV = (card, charged, step) => {
      let ev = 0;
      for (const [m, pm, dd] of scen) {
        const nd = Math.max(0, Math.min(3, st.dist + step + (MOVES.includes(m) ? dd : 0)));
        if (!card.range.includes(nd)) continue;
        const opp2 = MOVES.includes(m) ? { move: m } : { step: dd };
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
  return { think, chase };
}

/** A bot that picks any legal action at random — the baseline a real player should beat. */
export function createMasher(data, side, rng) {
  return {
    think: (st) => {
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
  };
}
