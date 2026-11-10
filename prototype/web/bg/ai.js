// The shopping AI. Side b always uses it (with the fighter's `ai` block); the simulation also uses it for side a.
import * as E from "./engine.js";

const KW = { guard: 1.5, slip: 2.5, sweep: 2.5 };
export const W = { base: 3, stuck: 1 };
const has = (list, k) => list.filter((c) => c && c.kw[k]).length;
/** What a keyword is worth to side s: ground tools need a takedown, takedown defence needs a wrestler across the cage, combos need company. */
function kwWorth(st, s, c, k) {
  const B = st[s].board, foe = st[s === "a" ? "b" : "a"].shown, G = st.cfg.ground;
  if (k === "flurry") return c.atk;
  if (k === "reach") return 1.5 + c.atk / 2;
  if (k === "combo") return 1 + Math.min(3, has(B, "combo"));
  if (k === "takedown") return 2 + 1.5 * (has(B, "ground") + has(B, "sub"));
  if (k === "ground") return has(B, "takedown") ? 4 : 1;
  if (k === "sub") return has(B, "takedown") ? 6 : 1;
  if (k === "sprawl" || k === "getup") {
    const stuck = B.filter((x) => x && (G.schoolMul[E.defOf(st, x).school] ?? 1) === 0).length; // my cards that are useless on the ground
    return has(foe, "takedown") && !has(B, k) ? W.base + W.stuck * stuck : 0.5;
  }
  return KW[k] || 0;
}
function cardWorth(st, c, d, s) {
  let v = c.atk + c.hp + (c.gold ? 2 : 0);
  for (const k of Object.keys(c.kw)) v += kwWorth(st, s, c, k);
  return v + d.fx.filter((x) => x.when !== "play").length * 2;
}
/** What an offered card is worth to side s right now. */
function offerWorth(st, s, id) {
  const d = st.data.skills[id], B = st[s].board.filter(Boolean), f = st[s].f;
  let v = cardWorth(st, E.make(st, id), d, s) + d.tier;
  for (const x of d.fx) if (x.when === "play") v += B.filter((c) => x.to !== "school" || E.defOf(st, c).school === x.school).length * ((x.atk || 0) + (x.hp || 0) + (x.kw ? 2 : 0));
  if (d.school === f.ai?.prefer) v += f.ai.bias ?? 2;
  if (f.power?.fx.some((x) => x.school === d.school)) v += 1;
  const copies = B.filter((c) => c.id === id && !c.gold).length;
  return v + (copies === 1 ? 2 : copies >= 2 ? 9 : 0);
}

/** Takedowns go first with the ground cards right behind them; then a card that buffs "the card to its right"; then strongest attackers first, combo cards kept together. */
export function arrange(st, s) {
  const B = st[s].board.filter(Boolean).sort((x, y) => y.atk - x.atk || y.hp - x.hp), td = has(B, "takedown") > 0;
  const group = (c) => (c.kw.takedown ? 0 : c.kw.getup || (td && (c.kw.ground || c.kw.sub)) ? 1 : E.defOf(st, c).fx.some((x) => x.to === "right") ? 2 : c.kw.combo ? 3 : 4);
  const out = B.map((c, i) => [group(c), i, c]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
  st[s].board = [...out, ...Array(st.cfg.slots - out.length).fill(null)];
}

/** One whole shop visit for side s. skill = chance each choice is the best one rather than a random one. */
export function shop(st, s, skill = st[s].f.ai?.skill ?? 1) {
  const F = st[s], sh = F.shop, cfg = st.cfg.shop, sharp = () => E.rand(st) < skill;
  let rerolls = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (F.discover) {
      const opts = F.discover.map((id, i) => [i, E.place(st, s, id) ? offerWorth(st, s, id) : -1]).sort((x, y) => y[1] - x[1]);
      E.pick(st, s, sharp() ? opts[0][0] : Math.floor(E.rand(st) * opts.length));
      continue;
    }
    if (E.canTier(st, s) && sh.gold >= sh.upCost && st.turn >= sh.tier * 3 && sharp()) { E.tierUp(st, s); continue; }
    if (sh.gold < cfg.cost) break;
    const full = F.board.every(Boolean);
    const low = full ? F.board.reduce((m, c, i) => (m == null || cardWorth(st, c, E.defOf(st, c), s) < cardWorth(st, F.board[m], E.defOf(st, F.board[m]), s) ? i : m), null) : null;
    const opts = sh.offers.map((id, i) => {
      if (!id) return null;
      const p = E.place(st, s, id), v = offerWorth(st, s, id);
      if (p) return { i, v, sell: null };
      const lv = cardWorth(st, F.board[low], E.defOf(st, F.board[low]), s);
      return v > lv + 3 ? { i, v: v - lv, sell: low } : null;
    }).filter(Boolean).sort((x, y) => y.v - x.v);
    if (!opts.length) { if (sh.gold > cfg.cost && rerolls++ < 3) { E.reroll(st, s); continue; } break; }
    const o = sharp() ? opts[0] : opts[Math.floor(E.rand(st) * opts.length)];
    if (o.sell != null) E.sell(st, s, o.sell);
    if (!E.buy(st, s, o.i)) break;
  }
  if (sh.gold >= cfg.reroll && sharp() && sh.offers.filter(Boolean).some((id) => offerWorth(st, s, id) >= 12)) { if (!sh.frozen) E.freeze(st, s); }
  if (sharp()) arrange(st, s);
}
/** Which card attacks which: the best trade it can see. Returns [attacker uid, target uid]. skill = chance it looks at all. */
export function fight(st, o, skill = st[o.s].f.ai?.skill ?? 1) {
  if (E.rand(st) >= skill) return [o.units[Math.floor(E.rand(st) * o.units.length)].uid, o.targets[Math.floor(E.rand(st) * o.targets.length)].uid];
  const c = st.c, mine = c[o.s].filter((x) => x && x.hp > 0), tools = mine.some((x) => x.kw.ground || x.kw.sub);
  let best = null;
  for (const u of o.units) for (const t of o.targets) {
    const dmg = E.power(st, u), back = u.kw.reach ? 0 : E.power(st, t);
    const kills = !t.kw.slip && (dmg >= t.hp || (u.kw.sub && c.ground)), dies = !u.kw.slip && back >= u.hp;
    let v = t.kw.slip ? 4 - u.atk : kills ? 8 + 2 * t.atk + t.hp : Math.min(dmg, t.hp);
    v -= dies ? 5 + u.atk + u.hp : back * 0.5;
    if (u.kw.takedown && (!c.ground || c.ground.top !== o.s)) v += tools ? 5 : 2;
    if (u.kw.combo) v += 1;
    if (u.kw.getup && c.ground && c.ground.top !== o.s) v += 4;
    if (!c.ground && t.kw.takedown) v += kills ? 4 : st.cfg.ground.catch.includes(E.defOf(st, u).school) ? -8 : 0; // stop the shot before it comes; a kick he survives gets caught
    if (!best || v > best[0]) best = [v, u.uid, t.uid];
  }
  return [best[1], best[2]];
}
export function cornerPick(st, s) { return st[s].hp <= st.cfg.hp - st.cfg.corner.heal - 3 ? "heal" : "discover"; }

export const shoppers = { smart: (st) => shop(st, "a", 1), random: (st) => shop(st, "a", 0), none: () => {} };
/** How side a fights in the simulation: sharp picks its trades like the AI at full skill; blind takes the leftmost card and a random target. */
export const fighters = { sharp: (st, o) => fight(st, o, o.s === "a" ? 1 : undefined), blind: (st, o) => (o.s === "a" ? null : fight(st, o)) };

/** A whole bout: side a shops with `shopper`, side b with its own AI; timing(st, p) grades each timing bar. */
export function runGame(data, aId, bId, seed, shopper = shoppers.smart, timing = () => "miss", pick = fighters.sharp) {
  const st = E.createGame(data, aId, bId, seed);
  let guard = 0;
  while (!st.over && guard++ < 60) {
    if (st.phase === "corner") { E.corner(st, "a", shopper === shoppers.none ? "heal" : cornerPick(st, "a")); E.corner(st, "b", cornerPick(st, "b")); continue; }
    if (st.a.discover && shopper === shoppers.none) E.pick(st, "a", 0);
    shopper(st);
    shop(st, "b");
    if (!E.playClash(st, timing, pick)) break;
  }
  return st;
}
