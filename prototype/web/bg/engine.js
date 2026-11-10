// Octagon Cards — one-on-one board battler (bg.html). Pure rules: no DOM, no clock; browser and simulation share this file.
// A bout is rounds x clashes turns. Each turn both sides shop (their own shop), then the two boards clash:
// the sides take turns, each picking one of its cards (once per pass) and a target for it; the side left standing damages the
// other FIGHTER's hp. hp 0 = KO; otherwise the rounds are scored 10-9 by clashes won.
// A takedown puts the clash on the ground for a while (who is on top, which cards can strike and how hard changes);
// combo cards hit harder in a row; lasting weakens stay on the real card until the round ends.
// All numbers and card properties come from rules/bg/*.json; the engine never compares card ids.

export const other = (s) => (s === "a" ? "b" : "a");
export const SIDES = ["a", "b"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function rand(st) {
  const a = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pickOne = (st, arr) => arr[Math.floor(rand(st) * arr.length)];

export function prepare(data) {
  for (const [id, d] of Object.entries(data.skills)) { d.id = id; d.kw = d.kw || []; d.fx = d.fx || []; }
  return data;
}
export const defOf = (st, c) => (c ? st.data.skills[c.id] : null);
/** A fresh copy of a card as it sits on a board. */
export function make(st, id, gold = false) {
  const d = st.data.skills[id], m = gold ? st.cfg.golden : 1;
  return { id, gold, atk: d.atk * m, hp: d.hp * m, kw: Object.fromEntries(d.kw.map((k) => [k, true])) };
}
const mulOf = (st, c) => (c.gold ? st.cfg.golden : 1);

export function createGame(data, aId, bId, seed = 1) {
  const cfg = data.config;
  const st = { data, cfg, rng: (seed >>> 0) || 1, round: 1, clash: 0, turn: 0, phase: "shop", over: null, log: [], rounds: [], wins: { a: 0, b: 0 }, c: null };
  for (const [s, id] of [["a", aId], ["b", bId]]) {
    st[s] = { id, f: data.fighters[id], hp: cfg.hp, board: Array(cfg.slots).fill(null), shown: [], lostLast: false, bonusGold: 0, discover: null,
      shop: { gold: 0, tier: 1, offers: [], frozen: false, upCost: cfg.shop.tierCost[1] }, stats: { won: 0, dmg: 0 } };
  }
  beginTurn(st);
  return st;
}

// ---------- effects (shared by the shop and the clash) ----------
const alive = (list) => list.filter((c) => c && c.hp > 0);
function targets(st, list, self, fx, bought) {
  const all = alive(list), others = all.filter((c) => c !== self);
  switch (fx.to) {
    case "self": return self ? [self] : [];
    case "bought": return bought ? [bought] : [];
    case "right": { const i = list.indexOf(self); for (let j = i + 1; j < list.length; j++) if (list[j] && list[j].hp > 0) return [list[j]]; return []; }
    case "leftmost": return all.slice(0, 1);
    case "others": return others;
    case "school": return others.filter((c) => defOf(st, c).school === fx.school);
    case "random": return others.length ? [pickOne(st, others)] : [];
    case "all": return all;
    default: return [];
  }
}
/** Run one buff / grant effect on a list of cards (board instances or clash units). Returns the cards it touched. */
function applyFx(st, list, self, fx, m, bought = null) {
  const n = fx.per ? alive(list).filter((c) => defOf(st, c).school === fx.per).length : 1;
  const hit = targets(st, list, self, fx, bought);
  for (const t of hit) {
    if (fx.do === "buff") { t.atk += (fx.atk || 0) * m * n; t.hp += (fx.hp || 0) * m * n; }
    if (fx.do === "grant") t.kw[fx.kw] = true;
  }
  return hit;
}
const powerFx = (st, s, when) => (st[s].f.power?.fx || []).filter((x) => x.when === when);

// ---------- shop ----------
export const goldFor = (st, s) => clamp(st.cfg.gold.start + st.cfg.gold.perTurn * (st.turn - 1), 0, st.cfg.gold.cap) + (st[s].lostLast ? st.cfg.gold.loser : 0) + st[s].bonusGold;
const pool = (st, tier) => Object.values(st.data.skills).filter((d) => d.tier <= tier);
const offerCount = (st, s) => st.cfg.shop.offers[st[s].shop.tier];
function roll(st, s) {
  const p = pool(st, st[s].shop.tier);
  st[s].shop.offers = Array.from({ length: offerCount(st, s) }, () => pickOne(st, p).id);
}
function reward(st, s, tier) {
  const p = pool(st, tier).filter((x) => x.tier === tier);
  st[s].discover = Array.from({ length: st.cfg.shop.discover }, () => pickOne(st, p).id);
}
function beginTurn(st) {
  st.turn++; st.clash++;
  if (st.clash > st.cfg.clashes) { st.clash = 1; st.round++; }
  st.phase = "shop";
  for (const s of SIDES) {
    const F = st[s], sh = F.shop;
    sh.gold = goldFor(st, s);
    F.bonusGold = 0;
    if (st.turn > 1) sh.upCost = Math.max(0, sh.upCost - st.cfg.shop.tierDrop);
    if (sh.frozen) { const p = pool(st, sh.tier); sh.offers = sh.offers.filter(Boolean); while (sh.offers.length < offerCount(st, s)) sh.offers.push(pickOne(st, p).id); }
    else roll(st, s);
    sh.frozen = false;
  }
  ev(st, "shop", {});
}

/** Where a bought card goes: { triple: true } (it completes three of a kind) | { slot } | null (no room). */
export function place(st, s, id) {
  const B = st[s].board;
  if (B.filter((c) => c && c.id === id && !c.gold).length >= 2) return { triple: true };
  const slot = B.findIndex((c) => !c);
  return slot >= 0 ? { slot } : null;
}
/** Put a new card on the board (a full board gets a temporary extra slot when the card completes a triple). */
function enter(st, s, id) {
  const F = st[s], B = F.board, card = make(st, id);
  let slot = B.findIndex((c) => !c);
  if (slot < 0) { B.push(null); slot = B.length - 1; }
  B[slot] = card;
  const school = defOf(st, card).school;
  for (const fx of powerFx(st, s, "buy")) if (!fx.school || fx.school === school) applyFx(st, B, null, fx, 1, card);
  for (const c of B) if (c && c !== card) for (const fx of defOf(st, c).fx) if (fx.when === "buy" && fx.school === school) applyFx(st, B, c, fx, mulOf(st, c));
  for (const fx of defOf(st, card).fx) if (fx.when === "play") applyFx(st, B, card, fx, mulOf(st, card));
  ev(st, "buy", { s, id });
  // three of a kind fold into one golden card that keeps their buffs, and earn a pick from the next tier
  const idx = B.map((c, i) => (c && c.id === id && !c.gold ? i : -1)).filter((i) => i >= 0);
  if (idx.length >= 3) {
    const d = st.data.skills[id], g = make(st, id, true);
    for (const i of idx.slice(0, 3)) { g.atk += B[i].atk - d.atk; g.hp += B[i].hp - d.hp; if (B[i].worn) g.worn = (g.worn || 0) + B[i].worn; Object.assign(g.kw, B[i].kw); B[i] = null; }
    B[idx[0]] = g;
    reward(st, s, Math.min(st.cfg.shop.maxTier, F.shop.tier + 1));
    ev(st, "triple", { s, id });
  }
  B.length = st.cfg.slots;
}
export function buy(st, s, i) {
  const F = st[s], sh = F.shop, id = sh.offers[i];
  if (st.phase !== "shop" || F.discover || !id || sh.gold < st.cfg.shop.cost || !place(st, s, id)) return false;
  sh.gold -= st.cfg.shop.cost;
  sh.offers[i] = null;
  enter(st, s, id);
  return true;
}
/** Take one of the offered reward cards (after a triple or a corner lesson). With no room the reward is lost. */
export function pick(st, s, i) {
  const F = st[s];
  if (!F.discover || !F.discover[i]) return false;
  const id = F.discover[i];
  F.discover = null;
  if (place(st, s, id)) enter(st, s, id);
  return true;
}
export function sell(st, s, slot) {
  const F = st[s];
  if (st.phase !== "shop" || !F.board[slot]) return false;
  F.board[slot] = null;
  F.shop.gold += st.cfg.shop.sell;
  return true;
}
export function swap(st, s, i, j) { if (st.phase !== "shop") return false; const B = st[s].board; [B[i], B[j]] = [B[j], B[i]]; return true; }
export function reroll(st, s) {
  const sh = st[s].shop;
  if (st.phase !== "shop" || sh.gold < st.cfg.shop.reroll) return false;
  sh.gold -= st.cfg.shop.reroll; sh.frozen = false;
  roll(st, s);
  return true;
}
export function freeze(st, s) { if (st.phase !== "shop") return false; st[s].shop.frozen = !st[s].shop.frozen; return true; }
export const canTier = (st, s) => st[s].shop.tier < st.cfg.shop.maxTier;
export function tierUp(st, s) {
  const sh = st[s].shop;
  if (st.phase !== "shop" || !canTier(st, s) || sh.gold < sh.upCost) return false;
  sh.gold -= sh.upCost;
  sh.tier++;
  sh.upCost = st.cfg.shop.tierCost[sh.tier] ?? 0;
  return true;
}

// ---------- log ----------
const view = (st) => {
  if (!st.c) return null;
  const unitView = (u) => (u ? { uid: u.uid, id: u.id, gold: u.gold, atk: u.atk, pow: power(st, u), hp: u.hp, kw: { ...u.kw }, dead: u.hp <= 0, stun: !!u.stun } : null);
  return { a: st.c.a.map(unitView), b: st.c.b.map(unitView), ground: st.c.ground ? { ...st.c.ground } : null };
};
function ev(st, t, o = {}) { const e = { t, ...o, hp: { a: st.a.hp, b: st.b.hp }, view: view(st) }; st.log.push(e); return e; }

// ---------- clash ----------
export function startClash(st) {
  if (st.phase !== "shop" || st.a.discover || st.b.discover) return false;
  st.phase = "clash";
  let uid = 0;
  const c = (st.c = { n: 0, turn: null, pending: null, opt: null, ace: null, reacted: false, ground: null, chain: { a: 0, b: 0 }, a: [], b: [] });
  for (const s of SIDES) {
    st[s].shown = st[s].board.map((x) => (x ? { ...x, kw: { ...x.kw } } : null));
    c[s] = st[s].board.map((x, slot) => (x ? { ...x, kw: { ...x.kw }, uid: ++uid, slot, side: s, acted: false, stun: false, swings: 0 } : null));
  }
  ev(st, "clash", {});
  for (const s of SIDES) {
    for (const fx of powerFx(st, s, "start")) fxInClash(st, s, null, fx, 1);
    for (const u of c[s]) if (u && u.hp > 0) for (const fx of defOf(st, u).fx) if (fx.when === "start") fxInClash(st, s, u, fx, mulOf(st, u));
  }
  reap(st);
  const na = alive(c.a).length, nb = alive(c.b).length;
  c.turn = na > nb ? "a" : nb > na ? "b" : rand(st) < 0.5 ? "a" : "b";
  const all = [...alive(c.b), ...alive(c.a)]; // ties go to the opponent's card: the player defends
  c.ace = all.reduce((m, u) => (!m || u.atk > m.atk ? u : m), null)?.uid ?? null;
  return true;
}
function fxInClash(st, s, self, fx, m) {
  const c = st.c;
  if (fx.do === "dmg") {
    const foes = alive(c[other(s)]);
    if (!foes.length) return;
    const t = pickOne(st, foes), d = harm(st, t, (fx.dmg || 0) * m, null);
    ev(st, "fx", { s, from: self?.uid, to: t.uid, dmg: d });
  } else {
    const hit = applyFx(st, c[s], self, fx, m);
    if (hit.length) ev(st, "fx", { s, from: self?.uid, buff: hit.map((u) => u.uid) });
  }
}
/** Deal damage to a unit; a slip soaks the first hit. Returns the damage that got through. */
function harm(st, t, dmg, from) {
  if (dmg <= 0 || t.hp <= 0) return 0;
  if (t.kw.slip) { delete t.kw.slip; ev(st, "slip", { uid: t.uid }); return 0; }
  t.hp -= dmg;
  if (from && from.kw.sub && st.c.ground && t.hp > 0) { t.hp = 0; ev(st, "sub", { uid: t.uid, from: from.uid }); }
  return dmg;
}
function reap(st) {
  const c = st.c;
  for (let guard = 0; guard < 20; guard++) {
    let any = false;
    for (const s of SIDES) for (const u of c[s]) {
      if (!u || u.hp > 0 || u.gone) continue;
      u.gone = true; any = true;
      ev(st, "break", { uid: u.uid, s });
      for (const fx of defOf(st, u).fx) if (fx.when === "break") fxInClash(st, s, u, fx, mulOf(st, u));
    }
    if (!any) break;
  }
}
/** A unit's attack right now. On the ground some schools cannot strike, the side underneath hits softer, and ground cards on top hit harder. */
export function power(st, u) {
  const g = st.c?.ground, G = st.cfg.ground;
  if (!u) return 0;
  if (!g) return u.atk;
  let m = G.schoolMul[defOf(st, u).school] ?? 1;
  if (u.kw.ground) { if (g.top === u.side) m *= G.topMul; } else if (g.top !== u.side) m *= G.bottomMul;
  return Math.ceil(u.atk * m);
}
/** u landed a takedown: a sprawl on the other side stops it once; on the ground it reverses who is on top. */
function takedown(st, u) {
  const c = st.c, s = u.side;
  if (c.ground) { if (c.ground.top !== s) { c.ground.top = s; ev(st, "reverse", { s, uid: u.uid }); } return; }
  const stop = alive(c[other(s)]).find((x) => x.kw.sprawl);
  if (stop) { ev(st, "stuffed", { s: other(s), uid: stop.uid, from: u.uid }); return; }
  c.ground = { top: s, left: st.cfg.ground.attacks };
  ev(st, "ground", { s, uid: u.uid });
}
function standUp(st, s = null, uid = null) { st.c.ground = null; ev(st, "standup", { s, uid }); }
const canHit = (st, u) => u && u.hp > 0 && power(st, u) > 0;
/** Whose attack is next and what may be chosen: { s, units, targets } (clash units), or null when the clash is over.
 *  Each card attacks once per pass through its side; a stunned card loses that turn; a guard must be hit first. */
export function options(st) {
  const c = st.c;
  if (st.phase !== "clash" || !c) return null;
  if (c.opt) return c.opt;
  if (!alive(c.a).length || !alive(c.b).length || c.n >= st.cfg.maxAttacks) return null;
  for (let tries = 0; tries < 4; tries++) {
    const s = c.turn, mine = alive(c[s]);
    const sitOut = () => { let n = 0; for (const x of mine) if (x.stun && !x.acted) { x.stun = false; x.acted = true; n++; ev(st, "stunned", { uid: x.uid }); } if (n) c.chain[s] = 0; return n; };
    const free = () => mine.filter((x) => canHit(st, x) && !x.acted);
    let sat = sitOut(), units = free();
    if (!units.length && !sat) { for (const x of mine) x.acted = false; sat = sitOut(); units = free(); }
    if (units.length) {
      const foes = alive(c[other(s)]), guards = foes.filter((x) => x.kw.guard);
      return (c.opt = { s, units, targets: guards.length ? guards : foes });
    }
    c.turn = other(s); // nobody on this side can attack right now: the other side goes
    if (c.ground && --c.ground.left <= 0) { standUp(st); return options(st); } // a turn spent stuck underneath still runs the clock
  }
  if (c.ground) { standUp(st); return options(st); } // nobody can strike down here: back to the feet
  return null;
}
/** Pick the attacker and the target for the next attack (by unit uid). False when that is not allowed. */
export function choose(st, uid, tid) {
  const o = options(st);
  if (!o) return false;
  const u = o.units.find((x) => x.uid === uid), t = o.targets.find((x) => x.uid === tid);
  if (!u || !t) return false;
  st.c.pending = { s: o.s, u, t };
  return true;
}
/** The next attack: the one chosen, or by default the leftmost free card at a random legal target. */
export function upcoming(st) {
  const c = st.c;
  if (st.phase !== "clash" || !c) return null;
  if (c.pending) return c.pending;
  const o = options(st);
  if (!o) return null;
  return (c.pending = { s: o.s, u: o.units[0], t: pickOne(st, o.targets) });
}
/** Is the next attack the one the timing bar is for? (the ace's first swing, once a clash) */
export function needsReact(st) {
  const p = upcoming(st), c = st.c;
  if (!p || c.reacted || p.u.uid !== c.ace || p.u.swings > 0) return null;
  return p;
}
function swing(st, u, t, mul) {
  const c = st.c, s = u.side, o = other(s), G = st.cfg.ground;
  u.swings++;
  // combo cards hit harder for every combo card this side threw just before
  let combo = 0;
  if (u.kw.combo) { combo = Math.min(c.chain[s], st.cfg.combo.max) * st.cfg.combo.atk * mulOf(st, u); c.chain[s]++; } else c.chain[s] = 0;
  const hit = Math.round((power(st, u) + combo) * mul);
  ev(st, "attack", { s, from: u.uid, to: t.uid, mul, combo });
  const got = harm(st, t, hit, u);
  if (got) ev(st, "dmg", { uid: t.uid, dmg: got });
  const back = u.kw.reach ? 0 : harm(st, u, power(st, t), t); // a long-range strike is not hit back
  if (back) ev(st, "dmg", { uid: u.uid, dmg: back });
  if (u.kw.sweep) for (const n of [c[o][t.slot - 1], c[o][t.slot + 1]]) if (n && n.hp > 0) { const d = harm(st, n, hit, u); if (d) ev(st, "dmg", { uid: n.uid, dmg: d }); }
  if (got && t.hp > 0) for (const fx of defOf(st, u).fx) if (fx.when === "hit") {
    const m = mulOf(st, u);
    if (fx.do === "weaken") {
      const n = Math.min(t.atk, fx.atk * m), real = st[o].board[t.slot];
      t.atk -= n;
      // a lasting weaken also wears the real card down until the round ends
      if (fx.lasting && real && real.id === t.id && real.gold === t.gold) { const k = Math.min(n, real.atk); real.atk -= k; real.worn = (real.worn || 0) + k; }
      ev(st, "weaken", { uid: t.uid, lasting: !!fx.lasting });
    }
    if (fx.do === "stun") { t.stun = true; ev(st, "stun", { uid: t.uid }); }
  }
  if (got && u.kw.takedown) takedown(st, u);
  else if (got && t.hp > 0 && t.kw.takedown && !c.ground && G.catch.includes(defOf(st, u).school)) takedown(st, t); // he caught the kick
  reap(st);
}
/** Resolve the next attack. grade (perfect | good | miss) applies when needsReact() said so. */
export function step(st, grade = null) {
  const c = st.c;
  if (st.phase !== "clash" || !c) return false;
  const react = grade ? needsReact(st) : null, p = upcoming(st);
  if (!p) { endClash(st); return true; }
  c.pending = null; c.opt = null; c.n++;
  const { s, u } = p, R = st.cfg.react;
  u.acted = true;
  c.turn = other(s);
  const down = !!c.ground;
  if (down && c.ground.top !== s && u.kw.getup) standUp(st, s, u.uid);
  let mul = 1;
  if (u.uid === c.ace && u.swings === 0) {
    c.reacted = true;
    if (react) {
      mul = s === "a" ? (grade === "perfect" ? R.perfectHit : grade === "good" ? R.goodHit : 1) : grade === "perfect" ? R.perfect : grade === "good" ? R.good : 1;
      ev(st, "react", { s, grade, uid: u.uid });
    }
  }
  swing(st, u, p.t, mul);
  if (u.kw.flurry && u.hp > 0) { const foes = alive(c[other(s)]), g = foes.filter((x) => x.kw.guard); if (foes.length) swing(st, u, p.t.hp > 0 ? p.t : pickOne(st, g.length ? g : foes), 1); }
  if (down && c.ground && --c.ground.left <= 0) standUp(st); // the referee stands them up
  return true;
}

function endClash(st) {
  const c = st.c, cfg = st.cfg, na = alive(c.a).length, nb = alive(c.b).length;
  const w = na && !nb ? "a" : nb && !na ? "b" : null;
  let dmg = 0;
  if (w) {
    const l = other(w);
    dmg = Math.min(cfg.damage.caps[st.round - 1] ?? 99, alive(c[w]).reduce((n, u) => n + defOf(st, u).tier, 0) + st[w].shop.tier);
    st[l].hp = Math.max(0, st[l].hp - dmg);
    st[w].stats.won++; st[w].stats.dmg += dmg;
    st.wins[w]++;
    // cards that asked for it grow when their side wins and they are still standing
    for (const u of alive(c[w])) for (const fx of defOf(st, u).fx) if (fx.when === "win") { const real = st[w].board[u.slot]; if (real && real.id === u.id) applyFx(st, st[w].board, real, fx, mulOf(st, real)); }
  }
  for (const s of SIDES) st[s].lostLast = w === other(s);
  ev(st, "clashend", { s: w, dmg });
  st.c = null;
  if (w && st[other(w)].hp <= 0) return finish(st, w, "KO");
  if (st.clash >= cfg.clashes) return endRound(st);
  beginTurn(st);
}
function finish(st, winner, how, total) {
  st.over = { winner, how, round: st.round, total };
  st.phase = "over";
  ev(st, "over", { s: winner, how });
}
function endRound(st) {
  const cfg = st.cfg, { a, b } = st.wins, big = Math.abs(a - b) >= cfg.score.big;
  const card = a > b ? { a: 10, b: big ? 8 : 9 } : b > a ? { a: big ? 8 : 9, b: 10 } : { a: 10, b: 10 };
  card.wins = { a, b };
  for (const s of SIDES) for (const x of st[s].board) if (x && x.worn) { x.atk += x.worn; delete x.worn; } // the minute's rest: worn-down cards recover
  st.rounds.push(card);
  st.wins = { a: 0, b: 0 };
  ev(st, "roundend", { card });
  if (st.round >= cfg.rounds) {
    const ta = st.rounds.reduce((n, c) => n + c.a, 0), tb = st.rounds.reduce((n, c) => n + c.b, 0);
    const w = ta > tb ? "a" : tb > ta ? "b" : st.a.hp > st.b.hp ? "a" : st.b.hp > st.a.hp ? "b" : null;
    return finish(st, w, "DEC", { a: ta, b: tb });
  }
  st.phase = "corner";
  st.cornered = { a: false, b: false };
}
/** Between rounds each side takes one corner option; when both have, the next shop opens. */
export function corner(st, s, id) {
  const o = st.cfg.corner[id], F = st[s];
  if (st.phase !== "corner" || !o || st.cornered[s]) return false;
  st.cornered[s] = true;
  if (o.heal) F.hp = Math.min(st.cfg.hp, F.hp + o.heal);
  if (o.gold) F.bonusGold += o.gold;
  if (!o.heal && !o.gold) reward(st, s, F.shop.tier); // a lesson: pick a card of the current tier
  if (st.cornered.a && st.cornered.b) beginTurn(st);
  return true;
}

/** Run a whole clash with no pauses (simulation). timing(st, p) grades the timing bar; pick(st, o) returns [attacker uid, target uid] for a side (default: leftmost card, random target). */
export function playClash(st, timing = () => "miss", pick = null) {
  if (!startClash(st)) return false;
  let guard = 0;
  while (st.phase === "clash" && guard++ < 1000) {
    const o = options(st), ch = o && pick ? pick(st, o) : null;
    if (ch) choose(st, ch[0], ch[1]);
    const p = o ? needsReact(st) : null;
    step(st, p ? timing(st, p) : null);
  }
  return true;
}
