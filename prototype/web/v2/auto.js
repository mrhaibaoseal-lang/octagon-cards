// Octagon Cards — plan B: the bout plays itself. The player picks a tactic before the fight and between
// rounds, and one order at each key moment. Same engine, cards and intent AI as v2.html; a tactic or order
// is a "style" (rules/v2/tactics.json) that leans the answering bot. Pure rules: no DOM.
import { createBout, defOf, act, dig, prepareFree, forecast, answers, runIntent, endExchange, corner } from "./engine.js";
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
  return { data, st: createBout(data, aId, bId, seed), tactic, order: null, was: {}, picks: 0, bonus: 0, reacts: {}, qte: { perfect: 0, good: 0, miss: 0 } };
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

// ---------- timing prompts (QTE). The front end measures the timing; the grade is perfect | good | miss. ----------

/** Does the order just chosen call for a timing prompt? (the ones that dig deep) */
export const needsPower = (au) => !!(au.order && au.data.tactics.styles[au.order.id].boost);
/** Grade of the "dig deep" prompt: more or less extra energy out of the same gas. */
export function power(au, grade) { au.bonus = au.data.tactics.qte.energy[grade] || 0; au.qte[grade]++; }

/** Call after nextMoment() returned null. If he is about to throw something heavy that can be answered,
 *  returns { name, id } (id = the basic defence a good timing gives for free); at most qte.perRound a round. */
export function reaction(au) {
  const { st, data } = au, q = data.tactics.qte;
  if (st.over || st.phase !== "play" || st.ground || st.a.rocked || !st.intent || st.intent.cancelled) return null;
  if ((au.reacts[st.round] || 0) >= q.perRound) return null;
  const heavy = forecast(st).find((x) => x.reach && (x.d.kind === "takedown" || (x.d.kind === "strike" && x.d.dmg * (x.d.hits || 1) >= q.heavy)));
  if (!heavy) return null;
  const d = heavy.d, ans = answers(st);
  const id = d.kind === "takedown" ? (ans.sprawl ? "sprawl" : null) : d.region === "legs" ? (ans.check ? "check" : null) : d.region === "head" && d.punch && ans.slip ? "slip" : ans.guard ? "guard" : null;
  if (!id) return null;
  au.reacts[st.round] = (au.reacts[st.round] || 0) + 1;
  return { name: d.name, id, answer: st.cfg.basics[id].name };
}
/** Grade of a reaction prompt: good or better sets the answer for free; perfect also gives energy for the counter. */
export function react(au, r, grade) {
  au.qte[grade]++;
  if (grade === "miss") return false;
  const ok = prepareFree(au.st, "a", r.id);
  if (ok && grade === "perfect") au.st.a.energy += au.data.tactics.qte.counter;
  return ok;
}

/** Play the current exchange for both sides. The events are in st.log. */
export function playExchange(au) {
  const { st, data } = au;
  lead(st);
  const style = data.tactics.styles[au.order ? au.order.id : au.tactic], bot = styleBot(style.w);
  if (style.boost && dig(st, "a", style.boost)) st.a.energy = Math.max(0, st.a.energy + au.bonus);
  au.bonus = 0;
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
export function runAuto(data, aId, bId, seed, tactic, pick = () => "keep", plan = null, timing = () => "miss") {
  const au = createAuto(data, aId, bId, seed, tactic);
  let guard = 0;
  while (!au.st.over && guard++ < 200) {
    if (au.st.phase === "corner") { nextRound(au, plan ? plan(au) : null); continue; }
    const m = nextMoment(au);
    if (m) { const id = pick(m, au); choose(au, m, m.options.includes(id) ? id : m.options[0]); if (needsPower(au)) power(au, timing(au)); }
    else { const r = reaction(au); if (r) react(au, r, timing(au)); }
    playExchange(au);
  }
  return au;
}
export { defOf };
