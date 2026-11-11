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
 *  The top man uses his own number. The bottom man moves second, so he also keeps going until he could beat what the top man shows (shown + 2), up to standCap.
 *  One card short of a full hand (`cards` held, fiveWin on) either of them reaches a little further: one more safe card wins outright. */
export function g21Threshold(st, s, role, foeShown = 0, cards = 2) {
  const A = ai21(st, s), X = st.cfg.ground21;
  const th = role === "top" ? A.hitBelow.top : Math.min(A.standCap, Math.max(A.hitBelow.bottom, foeShown + 2));
  return X.fiveWin && cards === X.hits + 1 ? Math.max(th, A.fiveBelow) : th;
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
/** A player who does the sums: uses only what side s can see (g21View) plus the opponent's published threshold. */
export function g21Smart(st, s) {
  const v = E.g21View(st, s);
  if (!v || v.turn !== s) return null;
  const X = st.cfg.ground21, G = st.cfg.ground, foe = s === "a" ? "b" : "a", F = ai21(st, foe), N = X.max;
  const cash = (gap, layer) => E.g21Cash(st, gap, layer);
  // what a fresh hand one layer deeper is worth to the top man: about 60% to win it (the head start and moving first help), by an average gap
  const fresh = (layer) => (layer > G.layers ? 0 : 0.6 * Math.max(cash(6, layer), fresh(layer + 1)));
  const canDeep = v.layer < G.layers && v.hand < X.hands;
  /** What winning by `gap` is worth to the top man with total `tt` (bottom total tb; null = he bust). */
  const winVal = (gap, tt, tb) => (tt >= v.subAt && tb !== X.bust ? Math.max(X.submit, cash(gap, v.layer)) : Math.max(cash(gap, v.layer), canDeep ? fresh(v.layer + 1) : 0));
  if (v.phase === "decide") return v.actions.includes("deeper") && fresh(v.layer + 1) > v.cash ? "deeper" : "cash";
  const SLIP = 4; // what getting out one layer is worth, in damage points
  if (v.role === "top") {
    // the bottom man will play his threshold against what I show him; his hidden card is any number
    const hidden = v.mine.cards[1], shownTo = (total) => total - hidden;
    // where the bottom man ends up from total t with k cards still to take: a total, "bust", or "five" (a full hand, which wins)
    const botEnd = (shown, bust, t, k, p, out) => {
      if (k === 0 || t >= g21Threshold(st, foe, "bottom", shown, 2 + X.hits - k)) return void (out[t] = (out[t] || 0) + p);
      for (let d = 1; d <= N; d++) { const n = t + d; if (n > bust) out.bust = (out.bust || 0) + p / N; else if (k === 1 && X.fiveWin) out.five = (out.five || 0) + p / N; else botEnd(shown, bust, n, k - 1, p / N, out); }
    };
    const memo = new Map(), ends = (shown, start) => { const key = shown * 100 + start; if (!memo.has(key)) { const out = {}; botEnd(shown, v.foe.bust, start, X.hits, 1 / N, out); memo.set(key, out); } return memo.get(key); };
    const stood = new Map(), stand = (T) => {
      if (stood.has(T)) return stood.get(T);
      let val = 0;
      for (let h = 1; h <= N; h++) {
        for (const [k, p] of Object.entries(ends(shownTo(T), v.foe.shownSum + h))) { const tb = k === "bust" || k === "five" ? null : Number(k); val += p * (k === "five" ? -SLIP : tb == null ? winVal(X.bustGap, T, null) : T > tb ? winVal(T - tb, T, tb) : T < tb ? -SLIP : 0); }
      }
      stood.set(T, val);
      return val;
    };
    const best = (T, k) => Math.max(stand(T), k > 0 ? hit(T, k) : -Infinity);
    const hit = (T, k) => { let val = 0; for (let d = 1; d <= N; d++) val += (T + d > v.mine.bust ? -SLIP : k === 1 && X.fiveWin ? winVal(X.fiveGap, T + d, null) : best(T + d, k - 1)) / N; return val; };
    return v.actions.includes("hit") && hit(v.mine.total, v.mine.hitsLeft) > stand(v.mine.total) ? "hit" : "stand";
  }
  // bottom: the top man has finished. His hidden card is whatever keeps him under the line; if he chose to stop, he is probably at or over his threshold
  const th = g21Threshold(st, foe, "top"), post = [];
  let sum = 0;
  for (let h = 1; h <= N; h++) {
    const T = v.foe.shownSum + h;
    const w = T > v.foe.bust ? 0 : v.foe.hitsLeft === 0 ? 1 : T > th ? 1 : T === th ? 2 / 3 : T === th - 1 ? 1 / 3 : 0.02;
    post.push([T, w]); sum += w;
  }
  if (!sum) return "stand";
  const stand = (t) => post.reduce((n, [T, w]) => n + (w / sum) * (t > T ? SLIP : t === T ? 0 : -winVal(T - t, T, t)), 0);
  const lose = post.reduce((n, [T, w]) => n + (w / sum) * -winVal(X.bustGap, T, null), 0);
  const best = (t, k) => Math.max(stand(t), k > 0 ? hit(t, k) : -Infinity);
  const hit = (t, k) => { let val = 0; for (let d = 1; d <= N; d++) val += (t + d > v.mine.bust ? lose : k === 1 && X.fiveWin ? SLIP : best(t + d, k - 1)) / N; return val; };
  return v.actions.includes("hit") && hit(v.mine.total, v.mine.hitsLeft) > stand(v.mine.total) ? "hit" : "stand";
}
/** Hit or stand on a coin flip, cash or go deeper on a coin flip. */
export const g21Random = (st, s) => { const o = E.g21Options(st); return o && o.turn === s ? o.actions[Math.floor(E.rand(st) * o.actions.length)] : null; };
/** The textbook line: always draw to `n`, always cash in. */
export const g21Fixed = (n) => (st, s) => { const v = E.g21View(st, s); return !v || v.turn !== s ? null : v.phase === "decide" ? "cash" : v.mine.total < n && v.actions.includes("hit") ? "hit" : "stand"; };
/** How side a plays the blackjack ground in the simulation; side b always plays its own threshold. */
const vs21 = (mine) => (st, s) => (s === "a" ? mine(st, s) : g21Pick(st, s));
export const grounders21 = { smart: vs21(g21Smart), random: vs21(g21Random), fixed17: vs21(g21Fixed(17)) };

export function cornerPick(st, s) { return st[s].hp <= st.cfg.hp - st.cfg.corner.heal - 3 ? "heal" : "discover"; }

export const shoppers = { smart: (st) => shop(st, "a", 1), random: (st) => shop(st, "a", 0), none: () => {} };
/** How side a fights in the simulation: sharp picks its trades like the AI at full skill; blind takes the leftmost card and a random target. */
export const fighters = { sharp: (st, o) => fight(st, o, o.s === "a" ? 1 : undefined), blind: (st, o) => (o.s === "a" ? null : fight(st, o)) };

/** A whole bout: side a shops with `shopper`, side b with its own AI; timing(st, p) grades each timing bar. */
export function runGame(data, aId, bId, seed, shopper = shoppers.smart, timing = () => "miss", pick = fighters.sharp, gpick = null) {
  const st = E.createGame(data, aId, bId, seed);
  gpick ||= st.cfg.ground.mode === "21" ? grounders21.smart : grounders.read;
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
