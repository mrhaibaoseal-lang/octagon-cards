// The shopping AI. Side b always uses it (with the fighter's `ai` block); the simulation also uses it for side a.
import * as E from "./engine.js";

const KW = { guard: 1.5, slip: 2.5, sweep: 2.5 };
export const W = { base: 3, stuck: 1 };
const has = (list, k) => list.filter((c) => c && c.kw[k]).length;
/** What a keyword is worth to side s: ground tools need a takedown, takedown defence needs a wrestler across the cage, combos need company. */
function kwWorth(st, s, c, k) {
  const B = st[s].board, foe = st[s === "a" ? "b" : "a"].shown;
  if (k === "flurry") return c.atk;
  if (k === "reach") return 1.5 + c.atk / 2;
  if (k === "combo") return 1 + Math.min(3, has(B, "combo"));
  if (k === "takedown") return 2 + 1.5 * (has(B, "ground") + has(B, "sub"));
  if (k === "ground") return has(B, "takedown") ? 4 : 1;
  if (k === "sub") return has(B, "takedown") ? 6 : 1;
  if (k === "sprawl" || k === "getup") return has(foe, "takedown") && !has(B, k) ? W.base : 0.5;
  return KW[k] || 0;
}
function cardWorth(st, c, d, s) {
  let v = c.atk + c.hp;
  for (const k of Object.keys(c.kw)) v += kwWorth(st, s, c, k);
  return v + d.fx.filter((x) => x.when !== "play" && x.when !== "ground" && x.when !== "groundEA").length * 2;
}
/** What an offered card is worth to side s right now. */
function offerWorth(st, s, id, o = {}) {
  const d = st.data.skills[id], B = st[s].board.filter(Boolean), f = st[s].f;
  let v = cardWorth(st, E.make(st, id), d, s) + d.tier;
  for (const x of d.fx) if (x.when === "play") v += B.filter((c) => x.to !== "school" || E.defOf(st, c).school === x.school).length * ((x.atk || 0) + (x.hp || 0) + (x.kw ? 2 : 0));
  if (d.school === f.ai?.prefer) v += f.ai.bias ?? 2;
  if (f.power?.fx.some((x) => x.school === d.school)) v += 1;
  // a copy you already hold levels it up: worth more the higher the level it reaches (and Lv3 / Lv4 pay a free pick)
  const m = E.mergeTarget(st, s, id);
  if (m >= 0) v += LEVEL_BONUS[E.cellAt(st, s, m).lv] + (o.merge || 0);
  return v;
}
/** What reaching level 2 / 3 / 4 by a merge is worth to the shopping AI (index = the level the card has now). */
export const LEVEL_BONUS = [0, 4, 7, 10];
/** Move benched cards onto the board: into a free cell, or in place of a weaker card on it. */
function fill(st, s) {
  const F = st[s], n = st.cfg.slots;
  for (let b = n; b < E.cellCount(st); b++) {
    const c = E.cellAt(st, s, b);
    if (!c) continue;
    const free = F.board.findIndex((x) => !x);
    if (free >= 0) { E.swap(st, s, b, free); continue; }
    let low = 0;
    for (let i = 1; i < n; i++) if (cardWorth(st, F.board[i], E.defOf(st, F.board[i]), s) < cardWorth(st, F.board[low], E.defOf(st, F.board[low]), s)) low = i;
    if (cardWorth(st, c, E.defOf(st, c), s) > cardWorth(st, F.board[low], E.defOf(st, F.board[low]), s)) E.swap(st, s, b, low);
  }
}

/** Takedowns go first with the ground cards right behind them; then a card that buffs "the card to its right"; then strongest attackers first, combo cards kept together. */
export function arrange(st, s) {
  const B = st[s].board.filter(Boolean).sort((x, y) => y.atk - x.atk || y.hp - x.hp), td = has(B, "takedown") > 0;
  const group = (c) => (c.kw.takedown ? 0 : c.kw.getup || (td && (c.kw.ground || c.kw.sub)) ? 1 : E.defOf(st, c).fx.some((x) => x.to === "right") ? 2 : c.kw.combo ? 3 : 4);
  const out = B.map((c, i) => [group(c), i, c]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
  st[s].board = [...out, ...Array(st.cfg.slots - out.length).fill(null)];
}

/** One whole shop visit for side s. skill = chance each choice is the best one rather than a random one. */
export function shop(st, s, skill = st[s].f.ai?.skill ?? 1, o = {}) {
  const F = st[s], sh = F.shop, cfg = st.cfg.shop, sharp = () => E.rand(st) < skill, cells = E.cellCount(st);
  let rerolls = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (F.discover) {
      const opts = F.discover.map((id, i) => [i, E.place(st, s, id) ? offerWorth(st, s, id) : -1]).sort((x, y) => y[1] - x[1]);
      E.pick(st, s, sharp() ? opts[0][0] : Math.floor(E.rand(st) * opts.length));
      continue;
    }
    if (E.canTier(st, s) && sh.gold >= sh.upCost && (o.climb || st.turn >= sh.tier * 3) && sharp()) { E.tierUp(st, s); continue; }
    if (sh.gold < cfg.cost) break;
    const full = Array.from({ length: cells }, (_, i) => i).every((i) => E.cellAt(st, s, i)), worthAt = (i) => cardWorth(st, E.cellAt(st, s, i), E.defOf(st, E.cellAt(st, s, i)), s);
    let low = null;
    if (full) for (let i = 0; i < cells; i++) if (low == null || worthAt(i) < worthAt(low)) low = i;
    const opts = sh.offers.map((id, i) => {
      if (!id) return null;
      const p = E.place(st, s, id), v = offerWorth(st, s, id, o);
      if (p) return { i, v, sell: null };
      const lv = worthAt(low);
      return v > lv + 3 ? { i, v: v - lv, sell: low } : null;
    }).filter(Boolean).sort((x, y) => y.v - x.v);
    if (!opts.length) { if (!o.climb && sh.gold > cfg.cost && rerolls++ < 3) { E.reroll(st, s); continue; } break; }
    const pk = sharp() ? opts[0] : opts[Math.floor(E.rand(st) * opts.length)];
    if (pk.sell != null) E.sell(st, s, pk.sell);
    if (!E.buy(st, s, pk.i)) break;
    fill(st, s);
  }
  if (sh.gold >= cfg.reroll && sharp() && sh.offers.filter(Boolean).some((id) => offerWorth(st, s, id) >= 12)) { if (!sh.frozen) E.freeze(st, s); }
  if (sharp()) { fill(st, s); arrange(st, s); }
}
/** Which card attacks which: the best trade it can see. Returns [attacker uid, target uid]. skill = chance it looks at all. */
export function fight(st, o, skill = st[o.s].f.ai?.skill ?? 1) {
  if (E.rand(st) >= skill) return [o.units[Math.floor(E.rand(st) * o.units.length)].uid, o.targets[Math.floor(E.rand(st) * o.targets.length)].uid];
  const c = st.c, mine = c[o.s].filter((x) => x && x.hp > 0), tools = mine.some((x) => x.kw.ground || x.kw.sub);
  let best = null;
  for (const u of o.units) for (const t of o.targets) {
    const dmg = E.power(st, u), back = E.counter(st, u, t);
    const kills = !t.kw.slip && dmg >= t.hp, dies = !u.kw.slip && back >= u.hp;
    let v = t.kw.slip ? 4 - u.atk : kills ? 8 + 2 * t.atk + t.hp : Math.min(dmg, t.hp);
    v -= dies ? 5 + u.atk + u.hp : back * 0.5;
    if (u.kw.takedown) v += tools ? 5 : 2;
    if (u.kw.combo) v += 1;
    if (t.kw.takedown) v += kills ? 4 : st.cfg.ground.catch.includes(E.defOf(st, u).school) ? -8 : 0; // stop the shot before it comes; a kick he survives gets caught
    if (!best || v > best[0]) best = [v, u.uid, t.uid];
  }
  return [best[1], best[2]];
}

// ---------- the ground game: how the opponent picks its move ----------
const SIDES = ["a", "b"];
const count = (st, s, kw) => st.c[s].filter((u) => u && u.hp > 0 && u.kw[kw]).length;
/** The chance side s picks each of its moves this beat, as { move: 0..1 }. This is also the table the screen shows, so the numbers are the real ones. */
export function groundWeights(st, s) {
  const c = st.c, G = st.cfg.ground, A = G.ai, g = c.ground, f = st[s].f, foe = s === "a" ? "b" : "a", last = c.glast?.[foe];
  const mine = E.groundMoves(st, s), theirs = E.groundMoves(st, foe), w = {};
  for (const m of mine) {
    const def = G.moves[m], kw = def.hit?.cardKw || def.hit?.upKw;
    let x = A.base[m] * (f.ai?.ground?.[m] ?? 1);
    x *= Math.max(0.2, 1 + (A.layerLean[m] || 0) * (g.layer - 1));
    if (def.gain && g.layer >= G.layers) x *= 0.3; // already as deep as it goes
    if (kw) x *= 1 + A.cardBoost * count(st, s, kw);
    if (last && G.beat[m] === last) x *= 1 + A.react; // leans toward what beat his last move
    if (theirs.some((y) => E.groundDamage(st, foe, y) >= A.bigHit && G.beat[m] === y)) x *= 1 + A.threat; // he can finish: cover it
    w[m] = x;
  }
  const sum = Object.values(w).reduce((n, v) => n + v, 0);
  for (const m of mine) w[m] = (1 - A.flat) * (w[m] / sum) + A.flat / mine.length; // never fully predictable
  return w;
}
const draw = (st, w) => { let r = E.rand(st); for (const [m, p] of Object.entries(w)) if ((r -= p) <= 0) return m; return Object.keys(w)[0]; };
/** The opponent's move: drawn from its own table. */
export const groundPick = (st, s) => draw(st, groundWeights(st, s));
/** The best answer to what the other side is likely to do (what a player who reads the table does). Ties go to the first. */
export function groundRead(st, s) {
  const G = st.cfg.ground, foe = s === "a" ? "b" : "a", q = groundWeights(st, foe), val = (s2, m) => E.groundDamage(st, s2, m) || (G.moves[m].gain ? 2 : 1);
  let best = null;
  for (const m of E.groundMoves(st, s)) {
    let ev = 0;
    for (const [y, p] of Object.entries(q)) ev += p * (G.beat[m] === y ? val(s, m) : G.beat[y] === m ? -val(foe, y) : 0);
    if (!best || ev > best[0]) best = [ev, m];
  }
  return best[1];
}
/** Pure guessing: any move that is allowed, equally likely. */
export const groundGuess = (st, s) => { const ok = E.groundMoves(st, s); return ok[Math.floor(E.rand(st) * ok.length)]; };
/** How side a plays the ground in the simulation: read the table, or guess blind. Side b always plays its own table. */
export const grounders = { read: (st, s) => (s === "a" ? groundRead(st, s) : groundPick(st, s)), guess: (st, s) => (s === "a" ? groundGuess(st, s) : groundPick(st, s)) };

// ---------- the blackjack ground game (ground.mode "21") ----------
const ai21 = (st, s) => ({ ...st.cfg.ground21.ai, ...(st[s].f.ai?.ground21 || {}) });
/** The total below which side s asks for another card, given what it could see with `foeShown` on the table. This is the number the screen shows.
 *  Whoever moves first uses his own number (hitBelow for his role). Whoever moves second also keeps going until he could beat what the other man shows
 *  (shown + 2), up to standCap. One card short of a full hand (`cards` held, fiveWin on) either reaches a little further: one more safe card wins outright. */
export function g21Threshold(st, s, role, foeShown = 0, cards = 2) {
  const A = ai21(st, s), X = st.cfg.ground21, second = role !== E.g21First(st);
  const th = second ? Math.min(A.standCap, Math.max(A.hitBelow[role], foeShown + 2)) : A.hitBelow[role];
  const limit = role === "top" || !st.c?.ground ? X.hits : E.g21Layer(st).botHits ?? X.hits; // pinned at this layer he may take fewer
  return X.fiveWin && limit >= X.hits && cards === X.hits + 1 ? Math.max(th, A.fiveBelow) : th;
}
/** The opponent's decision: hit below its threshold (give or take the jitter), else stand; after a win, cash in unless it pays less than deepBelow. */
export function g21Pick(st, s) {
  const v = E.g21View(st, s);
  if (!v || v.turn !== s) return null;
  const A = ai21(st, s);
  if (v.phase === "decide") return v.actions.includes("deeper") && v.cash < A.deepBelow ? "deeper" : "cash";
  if (!v.actions.includes("hit")) return "stand";
  const th = g21Threshold(st, s, v.role, v.foe.shownSum, v.mine.cards.length) + Math.floor(E.rand(st) * (2 * A.jitter + 1)) - A.jitter;
  return v.mine.total < th ? "hit" : "stand";
}
/** A player who does the sums: uses only what side s can see (g21View) plus the opponent's published threshold. Works from either seat and in either order. */
export function g21Smart(st, s) {
  const v = E.g21View(st, s);
  if (!v || v.turn !== s) return null;
  const X = st.cfg.ground21, G = st.cfg.ground, foe = s === "a" ? "b" : "a", ODDS = E.g21Odds(st), meTop = v.role === "top", foeRole = meTop ? "bottom" : "top";
  const cash = (gap, layer) => E.g21Cash(st, gap, layer);
  const after = X.hands - v.hand, canDeep = v.layer < G.layers && after > 0;
  // what sitting on top at `layer` with h hands still to play is worth: about 45% of hands won and cashed, by an average gap
  const pos = (layer, h) => (layer > G.layers || h <= 0 ? 0 : h * 0.45 * cash(6, layer));
  // without stay a cash ends the ground, so the only future is the hand one layer deeper
  const fresh = (layer) => (layer > G.layers ? 0 : 0.6 * Math.max(cash(6, layer), fresh(layer + 1)));
  /** What winning by `gap` is worth to the top man with total `tt` (bottom total tb; null = he bust or the top man filled his hand). */
  const winVal = (gap, tt, tb) => {
    if (tt >= v.subAt && tb !== X.bust) return Math.max(X.submit, cash(gap, v.layer));
    return X.stay ? Math.max(cash(gap, v.layer) + pos(v.layer, after), canDeep ? pos(v.layer + 1, after) : 0) : Math.max(cash(gap, v.layer), canDeep ? fresh(v.layer + 1) : 0);
  };
  if (v.phase === "decide") {
    if (!v.actions.includes("deeper")) return "cash";
    return (X.stay ? pos(v.layer + 1, after) > v.cash + pos(v.layer, after) : fresh(v.layer + 1) > v.cash) ? "deeper" : "cash";
  }
  const full = X.hits + 2; // a hand this long that has not gone over wins outright (fiveWin)
  const SLIP = 4; // what getting out one layer is worth, in damage points
  /** The hand's worth to the top man. Each end is a total, "bust" or "five" (a full hand). */
  const topVal = (t, b) => {
    if (t === "five") return winVal(X.fiveGap, Infinity, null);
    if (b === "five" || t === "bust") return -SLIP;
    if (b === "bust") return winVal(X.bustGap, t, null);
    return t > b ? winVal(t - b, t, b) : t < b ? -SLIP : 0;
  };
  const mine = (myEnd, foeEnd) => (meTop ? topVal(myEnd, foeEnd) : -topVal(foeEnd, myEnd));
  const n0 = v.mine.cards.length + v.mine.hitsLeft; // cards held once every hit is taken
  /** My best line from total t with k cards still allowed, against `vsFoe(myTotal)` = what my standing on that total is worth. */
  const play = (t, k, vsFoe, ifBust) => {
    const stand = vsFoe(t);
    if (k <= 0) return stand;
    let hit = 0;
    for (const [d, q] of ODDS) hit += q * (t + d > v.mine.bust ? ifBust : X.fiveWin && n0 - k + 1 >= full ? (meTop ? topVal("five", null) : -topVal(null, "five")) : play(t + d, k - 1, vsFoe, ifBust));
    return Math.max(stand, hit);
  };
  const choose = (vsFoe, ifBust) => {
    if (!v.actions.includes("hit")) return "stand";
    const stand = vsFoe(v.mine.total);
    let hit = 0;
    for (const [d, q] of ODDS) hit += q * (v.mine.total + d > v.mine.bust ? ifBust : X.fiveWin && v.mine.cards.length + 1 >= full ? (meTop ? topVal("five", null) : -topVal(null, "five")) : play(v.mine.total + d, v.mine.hitsLeft - 1, vsFoe, ifBust));
    return hit > stand ? "hit" : "stand";
  };
  if (v.foe.stood || v.foe.hitsLeft === 0) {
    // I move second: he has finished. His hidden card is whatever kept him under the line, and if he chose to stop he is probably at or over his number
    const th = g21Threshold(st, foe, foeRole, 0, v.foe.shown.length + 1), post = [];
    let sum = 0;
    for (const [h, ph] of ODDS) {
      const T = v.foe.shownSum + h;
      const w = ph * (T > v.foe.bust ? 0 : v.foe.hitsLeft === 0 ? 1 : T > th ? 1 : T === th ? 2 / 3 : T === th - 1 ? 1 / 3 : 0.02);
      post.push([T, w]); sum += w;
    }
    if (!sum) return "stand";
    const vsFoe = (t) => post.reduce((n, [T, w]) => n + (w / sum) * mine(t, T), 0);
    const ifBust = post.reduce((n, [T, w]) => n + (w / sum) * mine("bust", T), 0);
    return choose(vsFoe, ifBust);
  }
  // I move first: he will play his number against what I show him (my total less my hidden card); his own hidden card is any number
  const hidden = v.mine.cards[1], lim = v.foe.hitsLeft;
  const foeEnd = (shown, t, k, p, out) => {
    const cards = 2 + lim - k;
    if (k === 0 || t >= g21Threshold(st, foe, foeRole, shown, cards)) return void (out[t] = (out[t] || 0) + p);
    for (const [d, q] of ODDS) { const n = t + d; if (n > v.foe.bust) out.bust = (out.bust || 0) + p * q; else if (X.fiveWin && cards + 1 >= full) out.five = (out.five || 0) + p * q; else foeEnd(shown, n, k - 1, p * q, out); }
  };
  const memo = new Map(), ends = (shown, start) => { const key = shown * 100 + start; if (!memo.has(key)) { const out = {}; foeEnd(shown, start, lim, 1, out); memo.set(key, out); } return memo.get(key); };
  const stood = new Map(), vsFoe = (T) => {
    if (!stood.has(T)) {
      let val = 0;
      for (const [h, ph] of ODDS) for (const [k, p] of Object.entries(ends(T - hidden, v.foe.shownSum + h))) val += ph * p * mine(T, k === "bust" || k === "five" ? k : Number(k));
      stood.set(T, val);
    }
    return stood.get(T);
  };
  return choose(vsFoe, mine("bust", null));
}
/** Hit or stand on a coin flip, cash or go deeper on a coin flip. */
export const g21Random = (st, s) => { const o = E.g21Options(st); return o && o.turn === s ? o.actions[Math.floor(E.rand(st) * o.actions.length)] : null; };
/** The textbook line: always draw to `n`, always cash in. */
export const g21Fixed = (n) => (st, s) => { const v = E.g21View(st, s); return !v || v.turn !== s ? null : v.phase === "decide" ? "cash" : v.mine.total < n && v.actions.includes("hit") ? "hit" : "stand"; };
/** How side a plays the blackjack ground in the simulation; side b always plays its own threshold. */
const vs21 = (mine) => (st, s) => (s === "a" ? mine(st, s) : g21Pick(st, s));
export const grounders21 = { smart: vs21(g21Smart), random: vs21(g21Random), fixed17: vs21(g21Fixed(17)) };

// ---------- the Texas hold'em ground game (ground.mode "poker") ----------
const otherOf = (s) => (s === "a" ? "b" : "a");
/** The opponent's published style: the config defaults, overridden by the fighter's ai.poker. These numbers are what the screen shows. */
export const pokerStyle = (st, s) => ({ ...st.cfg.groundPoker.ai, ...(st[s].f.ai?.poker || {}) });
/** The chance of each action for a man of this style holding a hand of class `cls` (0..8), given what he may do: { facing (a bet to answer), canRaise, canAllin }.
 *  The opponent plays by drawing from this, and a reader uses the same table as the odds of what he saw: one source for both. */
export function pokerDist(style, cls, ctx) {
  if (ctx.canAllin && cls >= style.allin) return { allin: 1 };
  const pr = ctx.canRaise ? (cls >= style.raise ? 1 : style.bluff) : 0, rest = 1 - pr;
  if (ctx.facing) return cls >= style.call ? { raise: pr, call: rest } : { raise: pr, fold: rest };
  return { raise: pr, call: rest };
}
const drawFrom = (st, dist) => { let r = E.rand(st); for (const [a, p] of Object.entries(dist)) if (p > 0 && (r -= p) < 0) return a; return Object.keys(dist).find((a) => dist[a] > 0); };
/** Swap the lower hole card when the hand is nothing. Returns "keep" | "swap0" | "swap1". */
const pokerSwap = (v) => (v.mine.hand.cls === 0 ? `swap${E.cardRank(v.mine.cards[0]) <= E.cardRank(v.mine.cards[1]) ? 0 : 1}` : "keep");
const pokerDecide = (st, s, v) => (v.actions.includes("deeper") && v.cash < pokerStyle(st, s).deepBelow ? "deeper" : "cash");
/** The opponent's move: drawn from its own table. */
export function pokerPick(st, s) {
  const v = E.pokerView(st, s);
  if (!v || v.turn !== s) return null;
  if (v.phase === "decide") return pokerDecide(st, s, v);
  if (v.phase === "swap") return pokerSwap(v);
  return drawFrom(st, pokerDist(pokerStyle(st, s), v.mine.hand.cls, { facing: v.owe > 0, canRaise: v.raise > 0, canAllin: v.allin > 0 }));
}
/** A fixed line: bet by the class of the hand, never bluff. */
const FIXED = { raise: 2, bluff: 0, call: 1, allin: 3, deepBelow: 3 };
export function pokerFixed(st, s) {
  const v = E.pokerView(st, s);
  if (!v || v.turn !== s) return null;
  if (v.phase === "decide") return pokerDecide(st, s, v);
  if (v.phase === "swap") return pokerSwap(v);
  return drawFrom(st, pokerDist(FIXED, v.mine.hand.cls, { facing: v.owe > 0, canRaise: v.raise > 0, canAllin: v.allin > 0 }));
}
/** Any legal move at random (a free fold is not offered: nobody folds for nothing). */
export function pokerRandom(st, s) {
  const v = E.pokerView(st, s);
  if (!v || v.turn !== s) return null;
  const ok = v.actions.filter((a) => a !== "peek" && !(a === "fold" && v.owe === 0));
  return ok[Math.floor(E.rand(st) * ok.length)];
}
/** Chance side s wins the showdown against the cards the opponent may hold, given what it did this hand and his published style (Monte Carlo, N samples). */
export function pokerEquity(st, s, v, N = 140) {
  const foe = otherOf(s), style = pokerStyle(st, foe), mine = v.mine.cards, board = v.board, seen = new Set([...mine, ...board, ...v.foe.cards.filter((c) => c != null)]);
  const unseen = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c));
  let x = ((st.rng ^ (v.foe.put * 97 + v.mine.put * 31 + board.length)) >>> 0) || 1; // a private random stream: the game's own is not touched
  const rnd = () => { x = (x + 0x6d2b79f5) >>> 0; let t = Math.imul(x ^ (x >>> 15), x | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let num = 0, den = 0;
  for (let n = 0; n < N; n++) {
    const pool = unseen.slice(), take = () => pool.splice(Math.floor(rnd() * pool.length), 1)[0], hole = [];
    for (const c of v.foe.cards) { if (c != null) hole.push(c); }
    while (hole.length < 2) hole.push(take());
    let w = 1;
    for (const e of v.log) if (e.s === foe) {
      const b = board.slice(0, e.round === 1 ? 3 : 5), cls = E.evalHand([...hole, ...b]).cls;
      w *= Math.max(0.02, pokerDist(style, cls, e)[e.act] ?? 0);
    }
    const full = board.slice();
    while (full.length < 5) full.push(take());
    const a = E.evalHand([...mine, ...full]).score, b = E.evalHand([...hole, ...full]).score;
    num += w * (a > b ? 1 : a === b ? 0.5 : 0); den += w;
  }
  return num / den;
}
/** A player who reads: peeks when it can, works out its chance against what the opponent's style makes of his betting, and bets by that. */
export function pokerRead(st, s) {
  const v = E.pokerView(st, s);
  if (!v || v.turn !== s) return null;
  if (v.phase === "decide") return pokerDecide(st, s, v);
  if (v.phase === "swap") return pokerSwap(v);
  if (v.actions.includes("peek")) return "peek";
  const eq = pokerEquity(st, s, v), pot = v.pot;
  if (v.owe > 0 && eq < v.owe / (pot + v.owe)) return "fold"; // the odds the call is offered at
  const kill = v.role === "top" && v.foe.stam <= v.allin; // he cannot cover an all-in: if it wins he is drained, and drained in side control or deeper is a submission
  if (v.allin > 0 && (eq >= 0.8 || (kill && eq >= 0.55))) return "allin";
  if (v.raise > 0 && eq >= 0.6) return "raise";
  return "call";
}
const vsPoker = (mine) => (st, s) => (s === "a" ? mine(st, s) : pokerPick(st, s));
export const groundersPoker = { reader: vsPoker(pokerRead), fixed: vsPoker(pokerFixed), random: vsPoker(pokerRandom) };

// ---------- the EA ground: how the opponent picks its direction, and the players the simulation uses ----------
const eaState = (st) => {
  const g = st.c.ground, bot = E.other(g.top);
  return { layer: g.layer, space: g.space, covered: g.covered, topSta: st[g.top].stam, botSta: st[bot].stam, quickUsed: g.quickUsed, dmg: 0, lastTop: g.lastTop, lastBot: g.lastBot };
};
const eaStyleOf = (st, s, role) => st[s].f.ai?.groundEA?.[role] || { pass: 3, pound: 3, sub: 3 };
/** The chance each direction is picked by a man of `style` in `role` ("top" attacks, "bot" defends) on the virtual state V, as { move: 0..1 } (or { rest: 1 } when the top man can afford nothing).
 *  Style weights, then: the top man shies away from what the bottom man just guarded (he remembers) and goes for a submission when it is on;
 *  the bottom man covers up after eating a strike, guards what the top man just did (he remembers) and guards the finish harder when it is on. */
/** The top man holds more the more winded he is; the bottom man bursts more when one more point of space gets him out. */
const holdK = (X, V) => 0.5 + X.ai.holdTired * (1 - V.topSta / X.stamina);
const burstK = (X, V) => (V.space >= X.need - 1 ? X.ai.burstNear : 1);
function eaTableV(X, layers, style, role, V, M) {
  const A = X.ai, odds = E.eaSubOdds(X, M, V.layer, V.botSta), w = {};
  for (const m of E.EA_MOVES) {
    let x = style[m] ?? (m === "down" ? A.down : 3);
    if (role === "top") {
      if (E.eaCost(X, M, m) > V.topSta || E.eaLocked(X, layers, V.layer, m)) x = 0;
      else {
        if (V.lastBot === "down") { if (m === "down") x *= 1 + A.memory; } // he burst last beat: hold him down this time
        else if (V.lastBot && V.lastBot !== m && m !== "down") x *= 1 + A.memory / 2;
        if (m === "sub") x *= 0.5 + odds * A.subTop;
        if (m === "down") x *= holdK(X, V);
      }
    } else {
      if (V.covered && m === "pound") x *= A.cover;
      if (V.lastTop === m && m !== "down") x *= 1 + A.memory;
      if (m === "sub") x *= 0.6 + odds * A.subBot;
      if (m === "down") x = V.botSta < X.burst ? 0 : x * burstK(X, V);
      if (E.eaLocked(X, layers, V.layer, m)) x = 0;
    }
    w[m] = x;
  }
  const ok = E.EA_MOVES.filter((m) => w[m] > 0), sum = ok.reduce((n, m) => n + w[m], 0);
  if (!ok.length) return { rest: 1 };
  return Object.fromEntries(E.EA_MOVES.map((m) => [m, w[m] > 0 ? (1 - A.flat) * (w[m] / sum) + A.flat / ok.length : 0]));
}
/** What the screen may say about the opponent's table without giving the odds: one clue per thing that moves it this beat, as { m, up, why }
 *  (m = his direction, up = he does it more / less, why = the reason's key). Each clue is one of the multipliers in eaTableV, so none of them lies. */
export function eaClues(X, layers, role, V, M) {
  const A = X.ai, odds = E.eaSubOdds(X, M, V.layer, V.botSta), open = (m) => !E.eaLocked(X, layers, V.layer, m), out = [];
  if (role === "bot") {
    if (V.covered) out.push({ m: "pound", up: true, why: "covered" });
    if (V.lastTop && V.lastTop !== "rest" && V.lastTop !== "down" && open(V.lastTop)) out.push({ m: V.lastTop, up: true, why: "memory" });
    if (open("sub")) { const k = 0.6 + odds * A.subBot; if (k > 1.15) out.push({ m: "sub", up: true, why: "tired" }); else if (k < 0.85) out.push({ m: "sub", up: false, why: "fresh" }); }
    if (V.botSta < X.burst) out.push({ m: "down", up: false, why: "spent" });
    else if (burstK(X, V) > 1) out.push({ m: "down", up: true, why: "near" });
  } else {
    if (V.lastBot === "down") out.push({ m: "down", up: true, why: "memory" });
    else if (V.lastBot && open(V.lastBot)) out.push({ m: V.lastBot, up: false, why: "memory" });
    if (open("sub")) { const k = 0.5 + odds * A.subTop; if (k > 1.15) out.push({ m: "sub", up: true, why: "tired" }); else if (k < 0.85) out.push({ m: "sub", up: false, why: "fresh" }); }
    if (holdK(X, V) > 1.15) out.push({ m: "down", up: true, why: "winded" });
  }
  return out;
}
/** The opponent's real table this beat, with the reasons the screen shows beside it: { w, why: [text] }. This is exactly what it draws from. */
export function eaTable(st, s) {
  const g = st.c.ground, X = st.cfg.groundEA, role = g.top === s ? "top" : "bot", V = eaState(st), style = eaStyleOf(st, s, role), N = X.names;
  const w = eaTableV(X, st.cfg.ground.layers, style, role, V, g.mods), why = [];
  if (role === "bot") {
    if (V.covered) why.push("你剛<b>砸中他</b>：他想護頭");
    if (V.lastTop) why.push(`你上一拍<b>${N.top[V.lastTop]}</b>：他防著這招`);
    if (E.eaSubOdds(X, g.mods, V.layer, V.botSta) > 0.12) why.push(`他體力 ${V.botSta}：防降伏變弱`);
    if (V.botSta < X.burst) why.push(`他體力 ${V.botSta}：爆發不起來`);
    else if (burstK(X, V) > 1) why.push("他再 1 格就脫出：想爆發");
  } else {
    if (V.lastBot === "down") why.push("你上一拍<b>爆發</b>：他想壓住你");
    else if (V.lastBot) why.push(`你上一拍<b>${N.bot[V.lastBot]}</b>：他少用${N.top[V.lastBot]}`);
    if (holdK(X, V) > 1.15) why.push(`他體力 ${V.topSta}：想壓住喘口氣`);
    if (E.eaSubOdds(X, g.mods, V.layer, V.botSta) > 0.12) why.push(`你體力 ${V.botSta}：他想<b>降伏</b>`);
    if (w.rest) why.push(`他體力 ${V.topSta}：沒力出招，要喘口氣`);
  }
  const fav = E.EA_MOVES.reduce((b, m) => ((style[m] ?? 3) > (style[b] ?? 3) ? m : b), "pass");
  why.push(`${st[s].f.short}：愛${(role === "top" ? N.top : N.bot)[fav]}（基本傾向）`);
  return { w, why, clues: eaClues(X, st.cfg.ground.layers, role, V, g.mods), habit: fav };
}
const eaDraw = (st, w) => { let r = E.rand(st); const es = Object.entries(w).filter(([, p]) => p > 0); for (const [m, p] of es) if ((r -= p) <= 0) return m; return es.at(-1)[0]; };
/** The opponent's direction: drawn from its own table. */
export function eaPick(st, s) {
  const o = E.eaOptions(st);
  if (!o || o.phase !== "pick") return null;
  const w = eaTable(st, s).w;
  const m = eaDraw(st, w);
  return o.moves[s].includes(m) ? m : o.moves[s][0];
}
/** A player who reads: looks two beats ahead against what the shown table says the opponent will do (and a plain table for the beat after), and picks the direction worth most. */
export function eaRead(st, s) {
  const o = E.eaOptions(st);
  if (!o || o.phase !== "pick") return null;
  const mine = o.moves[s];
  if (mine[0] === "rest") return "rest";
  const g = st.c.ground, X = st.cfg.groundEA, L = st.cfg.ground.layers, M = g.mods, W = X.ai.value, top = g.top === s, f = s === "a" ? "b" : "a", V0 = eaState(st);
  const styles = { top: eaStyleOf(st, g.top, "top"), bot: eaStyleOf(st, E.other(g.top), "bot") };
  const val = (V) => V.dmg + V.layer * W.pos + (V.topSta - V.botSta) * W.sta;
  const look = (V, depth) => {
    if (depth <= 0) return val(V);
    const tt = eaTableV(X, L, styles.top, "top", V, M), bt = eaTableV(X, L, styles.bot, "bot", V, M);
    let ev = 0;
    for (const [t, pt] of Object.entries(tt)) if (pt) for (const [b, pb] of Object.entries(bt)) if (pb) ev += pt * pb * pair(V, t, b, depth);
    return ev;
  };
  const pair = (V, t, b, depth) => {
    const v = { ...V }, r = E.eaBeat(X, L, v, M, t, b);
    v.lastTop = t; v.lastBot = b;
    if (r.kind === "sub") {
      const p = (1 - E.eaEscape(X, v.botSta)) ** r.stages;
      return p * (W.sub + v.dmg) + (1 - p) * look({ ...v, botSta: Math.max(0, v.botSta - X.escDrain), space: 0, covered: false }, depth - 1);
    }
    return look(v, depth - 1);
  };
  const foe = eaTable(st, f).w;
  let best = null;
  for (const m of mine) {
    let ev = 0;
    for (const [o2, p] of Object.entries(foe)) if (p) ev += p * (top ? pair(V0, m, o2, 2) : pair(V0, o2, m, 2));
    if (!top) ev = -ev;
    if (!best || ev > best[0]) best = [ev, m];
  }
  return best[1];
}
/** A fixed line: the same mix of directions every beat, whatever the opponent shows. */
const eaMix = (wt, wb) => (st, s) => {
  const o = E.eaOptions(st);
  if (!o || o.phase !== "pick") return null;
  const mine = o.moves[s];
  if (mine[0] === "rest") return "rest";
  const w = Object.fromEntries(mine.map((m) => [m, (st.c.ground.top === s ? wt : wb)[m]]));
  return eaDraw(st, w);
};
/** The rule anyone can memorise from the shown table, with no looking ahead: on top go where his guard is thinnest, underneath guard what he shows most.
 *  `skip` leaves a direction out on top (the submission costs the most and rarely finishes a fresh man). */
const eaLowest = (skip) => (st, s) => {
  const o = E.eaOptions(st);
  if (!o || o.phase !== "pick") return null;
  const all = o.moves[s];
  if (all[0] === "rest") return "rest";
  const top = st.c.ground.top === s, foe = eaTable(st, E.other(s)).w, p = (m) => foe[m] ?? 0;
  const mine = top && all.some((m) => m !== skip) ? all.filter((m) => m !== skip) : all;
  return mine.reduce((b, m) => ((top ? p(m) < p(b) : p(m) > p(b)) ? m : b));
};
/** The rule anyone can memorise from the clues alone (no table): count the arrows on each direction (his habit counts as half an arrow);
 *  on top go where he guards least, underneath guard what he throws most. Ties go to the first open direction. */
const eaByClues = (st, s) => {
  const o = E.eaOptions(st);
  if (!o || o.phase !== "pick") return null;
  const mine = o.moves[s];
  if (mine[0] === "rest") return "rest";
  const top = st.c.ground.top === s, T = eaTable(st, E.other(s)), score = Object.fromEntries(E.EA_MOVES.map((m) => [m, m === T.habit ? 0.5 : 0]));
  for (const c of T.clues) score[c.m] += c.up ? 1 : -1;
  return mine.reduce((b, m) => ((top ? score[m] < score[b] : score[m] > score[b]) ? m : b));
};
const eaRandom = (st, s) => { const o = E.eaOptions(st); return o && o.phase === "pick" ? o.moves[s][Math.floor(E.rand(st) * o.moves[s].length)] : null; };
const vsEA = (mine) => (st, s) => (s === "a" ? mine(st, s) : eaPick(st, s));
/** Side a: reads the table, plays one of three memorised mixes, or picks at random; side b always plays its own table. */
export const groundersEA = {
  reader: vsEA(eaRead),
  mixBal: vsEA(eaMix({ pass: 0.3, pound: 0.35, sub: 0.2, down: 0.15 }, { pass: 0.3, pound: 0.35, sub: 0.2, down: 0.15 })),
  mixPound: vsEA(eaMix({ pass: 0.2, pound: 0.5, sub: 0.15, down: 0.15 }, { pass: 0.2, pound: 0.5, sub: 0.15, down: 0.15 })),
  mixSub: vsEA(eaMix({ pass: 0.25, pound: 0.2, sub: 0.4, down: 0.15 }, { pass: 0.25, pound: 0.2, sub: 0.4, down: 0.15 })),
  mixDown: vsEA(eaMix({ pass: 0.3, pound: 0.3, sub: 0.1, down: 0.3 }, { pass: 0.2, pound: 0.25, sub: 0.2, down: 0.35 })),
  clues: vsEA(eaByClues),
  lowest: vsEA(eaLowest()),
  lowestNoSub: vsEA(eaLowest("sub")),
  random: vsEA(eaRandom),
};

export function cornerPick(st, s) { return st[s].hp <= st.cfg.hp - st.cfg.corner.heal - 3 ? "heal" : "discover"; }

export const shoppers = {
  smart: (st) => shop(st, "a", 1), random: (st) => shop(st, "a", 0), none: () => {},
  /** Always buys a copy it already holds first (the levelling plan) / climbs the shop as soon as it can afford it (the tier plan). */
  leveler: (st) => shop(st, "a", 1, { merge: 40 }), climber: (st) => shop(st, "a", 1, { climb: true }),
};
/** How side a fights in the simulation: sharp picks its trades like the AI at full skill; blind takes the leftmost card and a random target. */
export const fighters = { sharp: (st, o) => fight(st, o, o.s === "a" ? 1 : undefined), blind: (st, o) => (o.s === "a" ? null : fight(st, o)) };

/** A whole bout: side a shops with `shopper`, side b with its own AI; timing(st, p) grades each timing bar. */
export function runGame(data, aId, bId, seed, shopper = shoppers.smart, timing = () => "miss", pick = fighters.sharp, gpick = null) {
  const st = E.createGame(data, aId, bId, seed);
  gpick ||= st.cfg.ground.mode === "ea" ? groundersEA.reader : st.cfg.ground.mode === "poker" ? groundersPoker.reader : st.cfg.ground.mode === "21" ? grounders21.smart : grounders.read;
  let guard = 0;
  while (!st.over && guard++ < 60) {
    if (st.phase === "corner") { E.corner(st, "a", shopper === shoppers.none ? "heal" : cornerPick(st, "a")); E.corner(st, "b", cornerPick(st, "b")); continue; }
    if (st.a.discover && shopper === shoppers.none) E.pick(st, "a", 0);
    shopper(st);
    shop(st, "b");
    if (!E.playClash(st, timing, pick, gpick)) break;
  }
  return st;
}
