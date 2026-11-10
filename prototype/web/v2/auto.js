// Octagon Cards — plan B: the bout plays itself. The player picks a tactic before the fight and between
// rounds, and one order at each key moment. Same engine, cards and intent AI as v2.html; a tactic or order
// is a "style" (rules/v2/tactics.json) that leans the answering bot. Pure rules: no DOM.
import { createBout, defOf, act, dig, runIntent, endExchange, corner } from "./engine.js";
import { lead, cornerPick, styleBot } from "./ai.js";

const CONDS = {
  aRocked: (st) => !!st.a.rocked,
  bRocked: (st) => !!st.b.rocked && !st.a.rocked,
  aTop: (st) => !!st.ground && st.ground.top === "a",
  aBottom: (st) => !!st.ground && st.ground.top === "b",
  closeLast: (st, T) => st.ex === st.cfg.exchanges && Math.abs(st.a.score - st.b.score) <= T.closeGap,
};

/** Is this style on offer to the fighter (some need a kind of card in the deck)? */
export function offered(data, fighterId, id) {
  if (id === "keep") return true;
  const s = data.tactics.styles[id];
  return !!s && (!s.needs || data.fighters[fighterId].deck.some((c) => data.cards[c] && data.cards[c].kind === s.needs));
}
export const tacticsFor = (data, fighterId) => data.tactics.tactics.filter((id) => offered(data, fighterId, id));

export function createAuto(data, aId, bId, seed, tactic) {
  return { data, st: createBout(data, aId, bId, seed), tactic, order: null, was: {}, picks: 0 };
}

/** Call at the start of an exchange. Returns the key moment that has just come up (or null). */
export function nextMoment(au) {
  const { st, data } = au, T = data.tactics;
  lead(st);
  if (st.over || st.phase !== "play") return null;
  let found = null;
  for (const m of T.moments) {
    const on = !!CONDS[m.when]?.(st, T), fresh = on && !au.was[m.when];
    au.was[m.when] = on;
    if (au.order && au.order.when === m.when && !on) au.order = null; // the moment has passed: back to the tactic
    if (fresh && !found) {
      const options = m.options.filter((id) => offered(data, st.a.id, id));
      if (options.length > 1) found = { when: m.when, title: m.title, options };
    }
  }
  if (found) au.order = null;
  return found;
}

export function choose(au, moment, id) {
  au.order = id === "keep" ? null : { when: moment.when, id };
  au.picks++;
}

/** Play the current exchange for both sides. The events are in st.log. */
export function playExchange(au) {
  const { st, data } = au;
  lead(st);
  const style = data.tactics.styles[au.order ? au.order.id : au.tactic], bot = styleBot(style.w);
  if (style.boost) dig(st, "a", style.boost);
  for (let i = 0; i < 30 && !st.over; i++) { const x = bot(st); if (!x || !act(st, x)) break; }
  runIntent(st);
  for (let i = 0; i < 30 && !st.over; i++) { const x = bot(st); if (!x || !act(st, x)) break; }
  endExchange(st);
}

/** Between rounds: optionally change tactic; both corners take their own rest option. */
export function nextRound(au, tactic) {
  if (tactic) au.tactic = tactic;
  au.was = {}; au.order = null;
  corner(au.st, cornerPick(au.st, "a"), cornerPick(au.st, "b"));
}

/** A whole auto bout for the simulation. pick(moment, au) -> option id; plan(au) -> tactic for the next round. */
export function runAuto(data, aId, bId, seed, tactic, pick = () => "keep", plan = null) {
  const au = createAuto(data, aId, bId, seed, tactic);
  let guard = 0;
  while (!au.st.over && guard++ < 200) {
    if (au.st.phase === "corner") { nextRound(au, plan ? plan(au) : null); continue; }
    const m = nextMoment(au);
    if (m) { const id = pick(m, au); choose(au, m, m.options.includes(id) ? id : m.options[0]); }
    playExchange(au);
  }
  return au;
}
export { defOf };
