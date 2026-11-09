// Opponent for the card bout. It sees exactly what the player sees: the table, its own hand, and the player's
// face-up cards (`known`). It learns the player's habits (how often they advance, guard, ...) over the fight.
import { actions, hitChance, other, danger, headRatio, limping } from "./engine.js";

const MOVES = ["advance", "retreat", "sidestep", "guard"];

/** How likely is the opponent to do each thing this beat. Prior + what they actually did, blended by `adapt`. */
function oppModel(st, s, adapt) {
  const o = st[other(s)];
  const prior = { card: 0.55, advance: 0.16, retreat: 0.1, guard: 0.1, sidestep: 0.09 };
  const n = o.hist.card + o.hist.advance + o.hist.retreat + o.hist.guard + o.hist.sidestep;
  const out = {};
  for (const k of Object.keys(prior)) {
    const learned = n > 0 ? o.hist[k] / n : prior[k];
    const w = Math.min(adapt, n / (n + 6));
    out[k] = prior[k] * (1 - w) + learned * w;
  }
  return out;
}

const regionValue = (st, s, card, prof) => {
  const opp = st[other(s)];
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
    const acts = actions(st, side).filter((a) => a.ok);
    // what the opponent can throw: their known cards that fit at the current range
    const threats = opp.known.map((id) => data.cards[id]).filter((c) => c.range.includes(st.dist));
    const threat = threats.length ? threats.reduce((x, c) => x + c.dmg * c.hit, 0) / threats.length + 1.5 : 3.5;
    const pAttack = model.card;
    const stam = me.stamina / me.staminaMax;
    const sv = 0.25 + (1 - stam) * 0.6; // what one point of stamina is worth right now (in damage)
    // value of a card if it could be thrown at distance d (opponent assumed to stand still)
    const cardValue = (card, d) => {
      if (!card.range.includes(d)) return -1;
      const hc = hitChance(st, side, card, false, null);
      return hc.p * card.dmg * f.power * regionValue(st, side, card, prof) - card.cost * sv;
    };
    const bestAt = (d) => Math.max(0, ...me.hand.map((id) => data.cards[id]).filter((c) => c.cost <= me.stamina).map((c) => cardValue(c, d)));
    let best = null;
    for (const a of acts) {
      let v;
      if (a.kind === "card") {
        const card = data.cards[a.id];
        let ev = 0;
        for (const [m, pm] of Object.entries(model)) {
          const oppMove = MOVES.includes(m) ? m : null;
          // where the distance ends up if they move
          let nd = st.dist;
          if (oppMove) nd += cfg.moves[oppMove].dist;
          nd = Math.max(0, Math.min(3, nd));
          const inR = card.range.includes(nd);
          const hc = hitChance(st, side, card, false, oppMove);
          ev += pm * (inR ? hc.p : 0);
        }
        const heavyRisk = card.heavy ? 0.35 * prof.caution : 0;
        v = ev * card.dmg * f.power * regionValue(st, side, card, prof) * (0.8 + prof.aggression * 0.5) - card.cost * sv - heavyRisk * (1 - ev) * 3;
        if (card.ko && danger(st, other(side))) v += card.ko * 20;
        if (card.rarity === "sig") v += 0.5;
      } else if (a.id === "guard") {
        v = pAttack * threat * 0.34 * (0.5 + prof.caution) + cfg.moves.guard.regen * sv + (danger(st, side) ? 1.2 : 0) - 0.2;
      } else if (a.id === "sidestep") {
        v = pAttack * threat * 0.3 * (0.4 + prof.caution) - a.cost * sv - 0.1;
      } else {
        // advance / retreat: worth what it does for the cards in hand next beat
        const nd = Math.max(0, Math.min(3, st.dist + cfg.moves[a.id].dist));
        v = 0.75 * bestAt(nd) - 0.15 + 0.35 * (Math.abs(st.dist - prof.range) - Math.abs(nd - prof.range));
        if (a.id === "retreat" && danger(st, side)) v += 0.8;
        if (a.id === "advance") v += prof.aggression * 0.3;
      }
      v *= 1 + (rng() - 0.5) * 2 * prof.noise;
      if (!best || v > best.v) best = { v, a };
    }
    const a = best.a;
    if (a.kind === "move") return { move: a.id };
    const card = data.cards[a.id];
    const boost = card.dmg >= 8 && me.stamina >= card.cost + 3 && (danger(st, other(side)) || rng() < prof.aggression * 0.3);
    return { card: a.idx, boost };
  };
  const chase = (st) => {
    const prof = data.fighters[st[side].id].ai;
    const c = data.config;
    const dn = st[other(side)];
    const pf = c.chase.finishBase + c.chase.finishPerHead * Math.min(1.5, headRatio(st, other(side)));
    return st[side].stamina >= c.chase.cost && pf + prof.aggression * 0.2 >= 0.55;
  };
  return { think, chase };
}

/** A bot that picks any legal action at random — the baseline a real player should beat. */
export function createMasher(data, side, rng) {
  return {
    think: (st) => {
      const acts = actions(st, side).filter((a) => a.ok);
      const a = acts[Math.floor(rng() * acts.length)];
      return a.kind === "move" ? { move: a.id } : { card: a.idx };
    },
    chase: () => rng() < 0.5,
  };
}
