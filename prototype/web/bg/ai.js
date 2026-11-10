// Shopping bots for side a (simulation and tests only; the player shops by hand in the browser).
import * as E from "./engine.js";

/** How much a skill is worth to this board, roughly. Looks only at skill properties. */
function worth(st, id, lv = 1) {
  const d = st.data.skills[id], B = st.a.board.map((c) => E.skillOf(st, c)).filter(Boolean), foe = st.b.board.map((c) => E.skillOf(st, c)).filter(Boolean);
  let v = d.tier * 2;
  if (d.kind === "strike") v += (d.dmg * (d.hits || 1) * d.acc) / 2 - (d.gas || 0) * 0.5 + (d.setup ? 1.5 : 0);
  if (d.after && B.some((k) => k.type === d.after.type)) v += 2;
  if (d.kind === "defence") v += foe.filter((k) => k.active && Object.entries(d.blocks).every(([a, b]) => k[a] === b)).length ? 4 : -2;
  if (d.kind === "takedown") v += 1 + (B.some((k) => k.needs === "grounded") ? 2 : 0);
  if (d.needs === "grounded") v += B.some((k) => k.kind === "takedown") ? 3 : -4;
  if (d.kind === "passive") v += 2 + (d.onBlock && !B.some((k) => k.kind === "defence") ? -3 : 0);
  return v * (1 + (lv - 1) * 0.5);
}

/** Put openers first, combo finishers after what they follow, takedowns before ground strikes. */
export function arrange(st) {
  const rank = (c) => { const d = E.skillOf(st, c); if (!d) return 9; if (!d.active) return 8; if (d.setup) return 0; if (d.kind === "takedown") return 1; if (d.needs) return 2; if (d.after) return 5; return 3 + (d.gas || 0) * 0.1; };
  st.a.board.sort((x, y) => rank(x) - rank(y));
}

export const shoppers = {
  none() {},
  random(st) {
    for (let n = 0; n < 6; n++) { const i = Math.floor(E.rand(st) * st.shop.offers.length); E.buy(st, i); }
  },
  smart(st) {
    const sh = st.cfg.shop;
    if (st.shop.special) { const d = st.data.skills[st.shop.special]; if (d.gold || (d.stun && st.a.stun > E.chinOf(st, "a") * 0.4) || d.chinUp) E.buySpecial(st); }
    if (st.round >= 2 && E.tierCost(st) != null && st.shop.gold >= E.tierCost(st) + (st.round >= 4 ? 0 : sh.cost) && st.a.board.filter(Boolean).length >= 4) E.tierUp(st), E.reroll(st);
    for (let guard = 0; guard < 12; guard++) {
      let best = -1, bv = 0;
      st.shop.offers.forEach((id, i) => {
        if (!id || E.costOf(st, id) > st.shop.gold) return;
        const p = E.place(st, id);
        let v = worth(st, id) + (p && p.merge != null ? (st.a.board.some((c) => !c) ? 1 : 4) : 0);
        if (!p) { // full: worth it only if clearly better than the weakest thing on the board
          const low = Math.min(...st.a.board.map((c) => worth(st, c.id, c.lv)));
          v = st.shop.gold + sh.sell >= E.costOf(st, id) && v > low + 2 ? v - low : 0;
        }
        if (v > bv) { bv = v; best = i; }
      });
      if (best < 0 || bv < 3) { if (st.shop.gold > sh.cost && E.reroll(st)) continue; break; }
      const id = st.shop.offers[best];
      if (!E.place(st, id)) { let w = 0; st.a.board.forEach((c, i) => { if (worth(st, c.id, c.lv) < worth(st, st.a.board[w].id, st.a.board[w].lv)) w = i; }); E.sell(st, w); }
      if (!E.buy(st, best)) break;
    }
    arrange(st);
  },
};

/** Play a whole bout: shop with `shopper`, then fight; timing(st) is the grade for each timing bar. */
export function runGame(data, aId, bId, seed, shopper = shoppers.smart, timing = () => "miss") {
  const st = E.createGame(data, aId, bId, seed);
  let guard = 0;
  while (!st.over && guard++ < 20) { shopper(st); E.playRound(st, timing); }
  return st;
}
