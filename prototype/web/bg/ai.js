// The shopping AI. Side b always uses it (with the fighter's `ai` block); the simulation also uses it for side a.
import * as E from "./engine.js";

const KW = { guard: 1.5, slip: 2.5, sweep: 2.5, sub: 6 };
function cardWorth(st, c, d) {
  let v = c.atk + c.hp + (c.gold ? 2 : 0);
  for (const k of Object.keys(c.kw)) v += k === "flurry" ? c.atk : KW[k] || 0;
  return v + d.fx.filter((x) => x.when !== "play").length * 2;
}
/** What an offered card is worth to side s right now. */
function offerWorth(st, s, id) {
  const d = st.data.skills[id], B = st[s].board.filter(Boolean), f = st[s].f;
  let v = cardWorth(st, E.make(st, id), d) + d.tier;
  for (const x of d.fx) if (x.when === "play") v += B.filter((c) => x.to !== "school" || E.defOf(st, c).school === x.school).length * ((x.atk || 0) + (x.hp || 0) + (x.kw ? 2 : 0));
  if (d.school === f.ai?.prefer) v += 2;
  if (f.power?.fx.some((x) => x.school === d.school)) v += 1;
  const copies = B.filter((c) => c.id === id && !c.gold).length;
  return v + (copies === 1 ? 2 : copies >= 2 ? 9 : 0);
}

/** Strongest attackers first; a card that buffs "the card to its right" goes just left of the best attacker. */
export function arrange(st, s) {
  const B = st[s].board.filter(Boolean).sort((x, y) => y.atk - x.atk || y.hp - x.hp);
  const lead = B.filter((c) => E.defOf(st, c).fx.some((x) => x.to === "right")), rest = B.filter((c) => !lead.includes(c));
  const out = [...lead, ...rest];
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
    const low = full ? F.board.reduce((m, c, i) => (m == null || cardWorth(st, c, E.defOf(st, c)) < cardWorth(st, F.board[m], E.defOf(st, F.board[m])) ? i : m), null) : null;
    const opts = sh.offers.map((id, i) => {
      if (!id) return null;
      const p = E.place(st, s, id), v = offerWorth(st, s, id);
      if (p) return { i, v, sell: null };
      const lv = cardWorth(st, F.board[low], E.defOf(st, F.board[low]));
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
export function cornerPick(st, s) { return st[s].hp <= st.cfg.hp - st.cfg.corner.heal - 3 ? "heal" : "discover"; }

export const shoppers = { smart: (st) => shop(st, "a", 1), random: (st) => shop(st, "a", 0), none: () => {} };

/** A whole bout: side a shops with `shopper`, side b with its own AI; timing(st, p) grades each timing bar. */
export function runGame(data, aId, bId, seed, shopper = shoppers.smart, timing = () => "miss") {
  const st = E.createGame(data, aId, bId, seed);
  let guard = 0;
  while (!st.over && guard++ < 60) {
    if (st.phase === "corner") { E.corner(st, "a", shopper === shoppers.none ? "heal" : cornerPick(st, "a")); E.corner(st, "b", cornerPick(st, "b")); continue; }
    if (st.a.discover && shopper === shoppers.none) E.pick(st, "a", 0);
    shopper(st);
    shop(st, "b");
    if (!E.playClash(st, timing)) break;
  }
  return st;
}
