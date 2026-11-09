// Opponent for the card bout. It sees what the player sees: the table, its own hand, the player's held card,
// and whether the player has a trap set (not which). It learns the player's habits over the fight.
import { actions, hitChance, dmgMul, other, danger, headRatio, limping, heldCard, chaseOdds } from "./engine.js";

const MOVES = ["advance", "retreat", "sidestep", "guard"];
const KINDS = ["card", "feint", "trap", ...MOVES];

/** How likely is the opponent to do each thing this beat. Prior + what they actually did, blended by `adapt`. */
function oppModel(st, s, adapt) {
  const o = st[other(s)];
  const prior = { card: 0.5, feint: 0.06, trap: 0.06, advance: 0.13, retreat: 0.09, guard: 0.09, sidestep: 0.07 };
  const n = KINDS.reduce((x, k) => x + (o.hist[k] || 0), 0);
  const out = {};
  for (const k of KINDS) {
    const learned = n > 0 ? (o.hist[k] || 0) / n : prior[k];
    const w = Math.min(adapt, n / (n + 6));
    out[k] = prior[k] * (1 - w) + learned * w;
  }
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
    const all = actions(st, side);
    const acts = all.filter((a) => a.ok);
    const stam = me.stamina / me.staminaMax;
    const sv = 0.25 + (1 - stam) * 0.6; // what one point of stamina is worth right now (in damage)
    const oppHeld = heldCard(st, other(side));
    const oppHeldCard = oppHeld ? data.cards[oppHeld] : null;
    const threat = (oppHeldCard?.kind === "strike" && oppHeldCard.range.includes(st.dist) ? oppHeldCard.dmg * cfg.charge.dmgMul * 0.5 : 0) + 3.5;
    const pAttack = model.card + (oppHeldCard?.kind === "strike" ? 0.15 : 0);
    // chance that one of my strikes walks into their trap (they have one set, kind unknown)
    const trapRisk = (card) => {
      if (!opp.trap) return 0;
      const ws = data.fighters[opp.id].weights;
      let all2 = 0, hit = 0;
      for (const [id, k] of Object.entries(ws)) {
        const c = data.cards[id];
        if (c.kind !== "trap") continue;
        all2 += k;
        if (c.trap.on.tag && card.tags.includes(c.trap.on.tag)) hit += k;
      }
      return all2 ? hit / all2 : 0;
    };
    const strikeValue = (card, charged, d) => {
      if (!card.range.includes(d)) return -1;
      const hc = hitChance(st, side, card, false, null);
      return hc.p * card.dmg * f.power * dmgMul(st, side, card, charged, false) * regionValue(st, side, card, prof) - card.cost * sv;
    };
    const bestAt = (d) => Math.max(0, ...me.hand.map((h) => ({ c: data.cards[h.id], h })).filter(({ c }) => c.kind === "strike" && c.cost <= me.stamina).map(({ c, h }) => strikeValue(c, h.charged, d)));

    let best = null;
    for (const a of acts) {
      let v;
      if (a.kind === "card") {
        const card = data.cards[a.id];
        if (card.kind === "strike") {
          let ev = 0;
          for (const [m, pm] of Object.entries(model)) {
            const oppMove = MOVES.includes(m) ? m : null;
            let nd = st.dist;
            if (oppMove) nd += cfg.moves[oppMove].dist;
            nd = Math.max(0, Math.min(3, nd));
            const inR = card.range.includes(nd);
            ev += pm * (inR ? hitChance(st, side, card, false, oppMove).p : 0);
          }
          const heavyRisk = card.heavy ? 0.35 * prof.caution : 0;
          v = ev * card.dmg * f.power * dmgMul(st, side, card, a.charged, false) * regionValue(st, side, card, prof) * (0.8 + prof.aggression * 0.5) - card.cost * sv - heavyRisk * (1 - ev) * 3;
          v -= trapRisk(card) * 4;
          if (card.ko && danger(st, other(side))) v += card.ko * 20;
          if (card.rarity === "sig") v += 0.5;
        } else if (card.kind === "feint") {
          const pDef = card.feint.against.reduce((x, m) => x + (model[m] || 0), 0);
          v = pDef * 5.5 - card.cost * sv - 0.3;
        } else {
          const on = card.trap.on;
          const pOne = on.move ? model[on.move] || 0 : (model.card + 0.1) * tagShare(st, side, on.tag);
          const pFire = 1 - Math.pow(1 - pOne, card.trap.beats);
          v = pFire * (card.trap.dmg * f.power + (card.trap.cancel ? 4 : 0)) * (0.6 + prof.caution) - card.cost * sv - 0.8;
        }
      } else if (a.id === "guard") {
        v = pAttack * threat * 0.34 * (0.5 + prof.caution) + cfg.moves.guard.regen * sv + (danger(st, side) ? 1.2 : 0) - 0.2;
      } else if (a.id === "sidestep") {
        v = pAttack * threat * 0.3 * (0.4 + prof.caution) - a.cost * sv - 0.1;
      } else {
        const nd = Math.max(0, Math.min(3, st.dist + cfg.moves[a.id].dist));
        v = 0.75 * bestAt(nd) - 0.15 + 0.35 * (Math.abs(st.dist - prof.range) - Math.abs(nd - prof.range));
        if (a.id === "retreat" && danger(st, side)) v += 0.8;
        if (a.id === "advance") v += prof.aggression * 0.3 - (opp.trap ? 0.6 : 0);
      }
      v *= 1 + (rng() - 0.5) * 2 * prof.noise;
      if (!best || v > best.v) best = { v, a };
    }
    const a = best.a;
    // hold: keep the best strike for next beat (not the one being played)
    let hold = null, hv = 1.2;
    me.hand.forEach((h, i) => {
      if (a.kind === "card" && i === a.idx) return;
      const c = data.cards[h.id];
      if (c.kind !== "strike") return;
      const v = c.dmg * c.hit * (c.heavy ? 1.2 : 1) * (c.rarity === "sig" ? 1.5 : 1);
      if (v > hv) { hv = v; hold = i; }
    });
    if (a.kind === "move") return { move: a.id, hold };
    const card = data.cards[a.id];
    const boost = card.kind === "strike" && card.dmg >= 8 && me.stamina >= card.cost + 3 && (danger(st, other(side)) || rng() < prof.aggression * 0.3);
    return { card: a.idx, boost, hold };
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
      const acts = actions(st, side).filter((a) => a.ok);
      const a = acts[Math.floor(rng() * acts.length)];
      const others = st[side].hand.map((_, i) => i).filter((i) => !(a.kind === "card" && i === a.idx));
      const hold = rng() < 0.5 && others.length ? others[Math.floor(rng() * others.length)] : null;
      return a.kind === "move" ? { move: a.id, hold } : { card: a.idx, hold };
    },
    chase: () => rng() < 0.5,
  };
}
