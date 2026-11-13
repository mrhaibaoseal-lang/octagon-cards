// Octagon Cards — one-on-one board battler (bg.html). Pure rules: no DOM, no clock; browser and simulation share this file.
// A bout is rounds x clashes turns. Each turn both sides shop (their own shop), then the two boards clash:
// the sides take turns, each picking one of its cards (once per pass) and a target for it; the side left standing damages the
// other FIGHTER's hp. hp 0 = KO; otherwise the rounds are scored 10-9 by clashes won.
// A takedown that lands pauses the cards and starts a ground game: a few beats of hidden-move guessing (rules/bg ground.moves / beat)
// on three layers of position; the winner of a beat moves deeper, hits the fighter, or breaks free. Then the cards fight on.
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

/** The stamina numbers of the ground game in use (the EA ground has its own block; the poker block is the default). */
const groundStam = (cfg) => (cfg.ground.mode === "ea" ? cfg.groundEA : cfg.groundPoker);
export function createGame(data, aId, bId, seed = 1) {
  const cfg = data.config;
  const st = { data, cfg, rng: (seed >>> 0) || 1, round: 1, clash: 0, turn: 0, phase: "shop", over: null, log: [], rounds: [], wins: { a: 0, b: 0 }, c: null };
  for (const [s, id] of [["a", aId], ["b", bId]]) {
    st[s] = { id, f: data.fighters[id], hp: cfg.hp, board: Array(cfg.slots).fill(null), shown: [], lostLast: false, bonusGold: 0, discover: null,
      shop: { gold: 0, tier: 1, offers: [], frozen: false, upCost: cfg.shop.tierCost[1] }, stats: { won: 0, dmg: 0 }, stam: groundStam(cfg).stamina };
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
  return { a: st.c.a.map(unitView), b: st.c.b.map(unitView), ground: st.c.ground ? structuredClone(st.c.ground) : null };
};
function ev(st, t, o = {}) { const e = { t, ...o, hp: { a: st.a.hp, b: st.b.hp }, stam: { a: st.a.stam, b: st.b.stam }, view: view(st) }; st.log.push(e); return e; }

// ---------- clash ----------
export function startClash(st) {
  if (st.phase !== "shop" || st.a.discover || st.b.discover) return false;
  st.phase = "clash";
  let uid = 0;
  const c = (st.c = { n: 0, turn: null, pending: null, opt: null, ace: null, reacted: false, ground: null, grounds: 0, ko: null, sub: null, gchoice: null, glast: { a: null, b: null }, chain: { a: 0, b: 0 }, a: [], b: [] });
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
/** A unit's attack right now (the ground game is played with moves, not cards, so nothing changes down there). */
export const power = (st, u) => (u ? u.atk : 0);
/** What target t hits u back for when u attacks it: its attack, or that much less (never below 0) when u strikes from long range. */
export const counter = (st, u, t) => Math.max(0, power(st, t) - (u.kw.reach ? st.cfg.reachCounter : 0));
/** u landed a takedown: a sprawl on the other side stops it; otherwise the ground game starts with u's side on top. */
function takedown(st, u) {
  const c = st.c, s = u.side;
  if (c.ground || c.grounds >= st.cfg.ground.perClash) return; // one ground game a clash: after that a takedown is just a hit
  const stop = alive(c[other(s)]).find((x) => x.kw.sprawl);
  if (stop) { ev(st, "stuffed", { s: other(s), uid: stop.uid, from: u.uid }); return; }
  c.ground = { top: s, layer: st.cfg.ground.start, beat: 1 };
  c.grounds++;
  ev(st, "ground", { s, uid: u.uid });
  if (isPoker(st)) startPoker(st);
  else if (isEA(st)) startEA(st);
  else if (is21(st)) deal21(st);
}
function standUp(st, s = null, uid = null) { st.c.ground = null; ev(st, "standup", { s, uid }); }
const canHit = (st, u) => u && u.hp > 0 && power(st, u) > 0;
/** Whose attack is next and what may be chosen: { s, units, targets } (clash units), or null when the clash is over or the ground game is on.
 *  Each card attacks once per pass through its side; a stunned card loses that turn; a guard must be hit first. */
export function options(st) {
  const c = st.c;
  if (st.phase !== "clash" || !c) return null;
  if (c.opt) return c.opt;
  if (c.ko || c.sub || c.ground || !alive(c.a).length || !alive(c.b).length || c.n >= st.cfg.maxAttacks) return null;
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
  }
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
  if (st.phase !== "clash" || !c || c.ground) return null;
  if (c.pending) return c.pending;
  const o = options(st);
  if (!o) return null;
  return (c.pending = { s: o.s, u: o.units[0], t: pickOne(st, o.targets) });
}
/** Is the next attack the one the timing bar is for? (the ace's first swing, once a clash) */
export function needsReact(st) {
  const p = upcoming(st), c = st.c;
  if (!p || c.ground || c.reacted || p.u.uid !== c.ace || p.u.swings > 0) return null;
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
  const back = harm(st, u, counter(st, u, t), t); // a long-range strike is hit back for less
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
/** Resolve the next attack (or, on the ground, the next beat). grade (perfect | good | miss) applies when needsReact() said so. */
export function step(st, grade = null) {
  const c = st.c;
  if (st.phase !== "clash" || !c) return false;
  if (c.ground) { if (isPoker(st)) runPoker(st); else if (isEA(st)) runEA(st, grade); else if (is21(st)) run21(st); else runBeat(st); return true; }
  const react = grade ? needsReact(st) : null, p = upcoming(st);
  if (!p) { endClash(st); return true; }
  c.pending = null; c.opt = null; c.n++;
  const { s, u } = p, R = st.cfg.react;
  u.acted = true;
  c.turn = other(s);
  let mul = 1;
  if (u.uid === c.ace && u.swings === 0) {
    c.reacted = true;
    if (react) {
      mul = s === "a" ? (grade === "perfect" ? R.perfectHit : grade === "good" ? R.goodHit : 1) : grade === "perfect" ? R.perfect : grade === "good" ? R.good : 1;
      ev(st, "react", { s, grade, uid: u.uid });
    }
  }
  swing(st, u, p.t, mul);
  if (u.kw.flurry && u.hp > 0 && !c.ground) { const foes = alive(c[other(s)]), g = foes.filter((x) => x.kw.guard); if (foes.length) swing(st, u, p.t.hp > 0 ? p.t : pickOne(st, g.length ? g : foes), 1); }
  return true;
}

// ---------- the ground game ----------
/** The moves side s may pick this beat: the moves of its role (top or bottom). Every layer has the full ring, so no move is locked. */
export function groundMoves(st, s) {
  const c = st.c, g = c?.ground, G = st.cfg.ground;
  if (!g) return [];
  const role = g.top === s ? "top" : "bottom";
  return Object.keys(G.moves).filter((id) => G.moves[id].role === role);
}
/** What the ground game looks like right now: { top, layer, beat, max, moves: { a, b }, last } or null. */
export function groundOptions(st) {
  const c = st.c, g = c?.ground;
  if (st.phase !== "clash" || !g || c.ko || is21(st) || isPoker(st) || isEA(st)) return null;
  return { top: g.top, layer: g.layer, beat: g.beat, max: st.cfg.ground.beats, moves: { a: groundMoves(st, "a"), b: groundMoves(st, "b") }, last: c.glast };
}
/** Side s picks its move for this beat (hidden until both have). False when it is not allowed. */
export function chooseGround(st, s, move) {
  if (isEA(st)) { const o = eaOptions(st); if (!o || o.phase !== "pick" || !o.moves[s].includes(move)) return false; (st.c.gchoice ||= {})[s] = move; return true; } // both men pick at the same moment
  if (isPoker(st)) { const o = pokerOptions(st); if (!o || o.turn !== s || !o.actions.includes(move)) return false; st.c.gchoice = { [s]: move }; return true; }
  if (is21(st)) { const o = g21Options(st); if (!o || o.turn !== s || !o.actions.includes(move)) return false; st.c.gchoice = { [s]: move }; return true; }
  if (!groundOptions(st) || !groundMoves(st, s).includes(move)) return false;
  (st.c.gchoice ||= {})[s] = move;
  return true;
}
/** Damage a hitting move does for side s right now. A flat move: its base plus a bonus for each of s's cards with the move's keyword.
 *  A move with byLayer hits harder the deeper the position is, and counts as one layer deeper while s has a card with its upKw. */
export function groundDamage(st, s, id) {
  const h = st.cfg.ground.moves[id]?.hit, g = st.c?.ground;
  if (!h) return 0;
  if (h.byLayer) {
    const up = h.upKw && alive(st.c[s]).some((u) => u.kw[h.upKw]) ? 1 : 0;
    return h.byLayer[clamp((g ? g.layer : 1) + up, 1, h.byLayer.length) - 1];
  }
  return h.base + (h.cardKw ? h.perCard * alive(st.c[s]).filter((u) => u.kw[h.cardKw]).reduce((n, u) => n + mulOf(st, u), 0) : 0);
}
function runBeat(st) {
  const c = st.c, mv = {};
  for (const s of SIDES) { const ok = groundMoves(st, s); mv[s] = c.gchoice?.[s] && ok.includes(c.gchoice[s]) ? c.gchoice[s] : pickOne(st, ok); }
  c.gchoice = null;
  groundBeat(st, mv);
}
function groundBeat(st, mv) {
  const c = st.c, G = st.cfg.ground, g = c.ground, top = g.top, bot = other(top), mt = G.moves[mv[top]], mb = G.moves[mv[bot]];
  const res = G.beat[mv[top]] === mv[bot] ? "top" : G.beat[mv[bot]] === mv[top] ? "bottom" : "tie";
  let dmg = 0, drop = 0, flip = false;
  if (res === "top") {
    dmg = groundDamage(st, top, mv[top]); // measured on the layer the beat was played on
    if (mt.gain) g.layer = Math.min(G.layers, g.layer + mt.gain);
  } else if (res === "bottom") {
    const has = (kw) => kw && alive(c[bot]).some((u) => u.kw[kw]);
    if (has(mb.flip)) flip = true;
    else { drop = 1 + (has(mb.extra) ? G.extra : 0); g.layer -= drop; }
  }
  c.glast = { ...mv };
  if (flip) g.top = bot;
  if (dmg) { st[bot].hp = Math.max(0, st[bot].hp - dmg); st[top].stats.dmg += dmg; }
  const n = g.beat++; // the beat just played; the position shows the next one
  ev(st, "gbeat", { top, moves: mv, res, dmg, drop, flip, layer: g.layer, beat: n });
  if (st[bot].hp <= 0) { c.ko = bot; c.ground = null; return; } // finished on the mat
  if (g.layer < 1 || g.beat > G.beats) standUp(st);
}

// ---------- the ground game, blackjack style (ground.mode "21"; numbers in rules/bg ground21) ----------
// Each hand both sides get two numbers (1..10 drawn with replacement, weighted like a real deck: ground21.deck). The top man hits or stands first, then the bottom man.
// (With ground21.topLast the bottom man goes first and the top man answers.) Over the bust line loses the hand. Otherwise the higher total wins: the bottom man slips out one layer and the ground goes on;
// the top man either cashes the gap in as damage (times the layer) and stays where he is, or passes one layer deeper without hitting.
// Each layer may tighten the bottom man (ground21.layerRules: fewer cards to take, a lower bust line).
// Each side hides its second card from the other until the hand is decided: g21View(st, s) is what side s may know.
const is21 = (st) => st.cfg.ground.mode === "21";
/** The odds of each number, as [[value, chance], ...]: ground21.deck gives a weight per value 1..10 (like a real deck, where 10 / J / Q / K all count 10). */
export function g21Odds(st) {
  const w = st.cfg.ground21.deck, sum = w.reduce((a, b) => a + b, 0);
  return w.map((x, i) => [i + 1, x / sum]).filter(([, p]) => p > 0);
}
function draw21(st) {
  let r = rand(st);
  const odds = g21Odds(st);
  for (const [v, p] of odds) if ((r -= p) < 0) return v;
  return odds.at(-1)[0];
}
const hasKw = (st, s, kw) => alive(st.c[s]).some((u) => u.kw[kw]);
function deal21(st) {
  const g = st.c.ground;
  g.hands = { a: [draw21(st), draw21(st)], b: [draw21(st), draw21(st)] };
  g.hits = { a: 0, b: 0 }; g.stood = { a: false, b: false }; g.phase = g21First(st); g.gap = 0;
  // what the board gives each side this hand (the cards cannot change while they grapple): for the screen
  g.info = { bonus: { a: g21Bonus(st, "a"), b: g21Bonus(st, "b") }, bust: { a: g21Bust(st, "a"), b: g21Bust(st, "b") }, hits: { a: g21Hits(st, "a"), b: g21Hits(st, "b") }, subAt: g21SubAt(st) };
  ev(st, "g21deal", { top: g.top, layer: g.layer, hand: g.beat });
}
/** The top man's head start: one point for each of his ground cards (a golden one counts double), up to startCap. */
export function g21Bonus(st, s) {
  const X = st.cfg.ground21, g = st.c?.ground;
  if (!g || g.top !== s) return 0;
  return Math.min(X.startCap, alive(st.c[s]).filter((u) => u.kw[X.startKw]).reduce((n, u) => n + mulOf(st, u), 0));
}
export const g21Total = (st, s) => st.c.ground.hands[s].reduce((n, v) => n + v, 0) + g21Bonus(st, s);
/** Which role decides first in a hand: "bottom" when ground21.topLast (the top man answers what he sees, like a dealer), else "top". */
export const g21First = (st) => (st.cfg.ground21.topLast ? "bottom" : "top");
/** What this layer does to the bottom man: { botHits, botBust } (either may be missing). */
export const g21Layer = (st, layer = st.c.ground.layer) => st.cfg.ground21.layerRules?.[layer - 1] || {};
/** The total side s may not go over: the layer may lower it for the bottom man, and a get-up card gives him upAdd more. */
export const g21Bust = (st, s) => {
  const X = st.cfg.ground21;
  if (st.c.ground.top === s) return X.bust;
  return (g21Layer(st).botBust ?? X.bust) + (hasKw(st, s, X.upKw) ? X.upAdd : 0);
};
/** How many cards side s may still ask for in a hand: hits, or fewer for the bottom man where the layer pins him. */
export const g21Hits = (st, s) => (st.c.ground.top === s ? st.cfg.ground21.hits : g21Layer(st).botHits ?? st.cfg.ground21.hits);
/** The total the top man needs for a submission: the bust line, or lower with a submission card. */
export const g21SubAt = (st) => { const X = st.cfg.ground21; return hasKw(st, st.c.ground.top, X.subKw) ? X.subAt : X.bust; };
/** Damage for cashing in a win by `gap` on `layer`. */
export const g21Cash = (st, gap, layer) => { const X = st.cfg.ground21; return Math.min(X.cap, Math.ceil(gap / X.div) * X.layerMul[layer - 1]); };
/** Whose decision it is and what it may be: { top, layer, hand, hands, phase, turn, actions } or null. */
export function g21Options(st) {
  const c = st.c, g = c?.ground, X = st.cfg.ground21;
  if (st.phase !== "clash" || !g || c.ko || !is21(st)) return null;
  const turn = g.phase === "bottom" ? other(g.top) : g.top;
  const actions = g.phase === "decide" ? (g.layer < st.cfg.ground.layers && g.beat < X.hands ? ["cash", "deeper"] : ["cash"]) : g.hits[turn] < g21Hits(st, turn) ? ["hit", "stand"] : ["stand"];
  return { top: g.top, layer: g.layer, hand: g.beat, hands: X.hands, last: g.beat >= X.hands, phase: g.phase, turn, actions };
}
/** What side s can see of the hand: everything of its own, and the other side's cards except the hidden second one (shown once the hand is decided). */
export function g21View(st, s) {
  const o = g21Options(st);
  if (!o) return null;
  const g = st.c.ground, X = st.cfg.ground21, f = other(s), open = g.phase === "decide";
  const shown = g.hands[f].filter((_, i) => open || i !== 1);
  return { ...o, role: g.top === s ? "top" : "bottom", subAt: g21SubAt(st), gap: g.gap, cash: open ? g21Cash(st, g.gap, g.layer) : 0,
    mine: { cards: [...g.hands[s]], bonus: g21Bonus(st, s), total: g21Total(st, s), bust: g21Bust(st, s), hitsLeft: g21Hits(st, s) - g.hits[s], stood: g.stood[s] },
    foe: { shown, hidden: !open, bonus: g21Bonus(st, f), shownSum: shown.reduce((n, v) => n + v, 0) + g21Bonus(st, f), bust: g21Bust(st, f), hitsLeft: g21Hits(st, f) - g.hits[f], stood: g.stood[f] } };
}
function run21(st) {
  const c = st.c, g = c.ground, X = st.cfg.ground21, o = g21Options(st), s = o.turn;
  const act = o.actions.includes(c.gchoice?.[s]) ? c.gchoice[s] : pickOne(st, o.actions);
  c.gchoice = null;
  if (g.phase === "decide") {
    if (act === "deeper") { g.layer++; g.beat++; ev(st, "g21deep", { s, layer: g.layer }); return deal21(st); }
    const dmg = g21Cash(st, g.gap, g.layer);
    hurt21(st, dmg);
    g.beat++;
    const stay = X.stay && g.beat <= X.hands && st[other(g.top)].hp > 0; // he pounds and keeps the position: another hand on this layer
    ev(st, "g21cash", { s, dmg, layer: g.layer, stay });
    return stay ? deal21(st) : end21(st);
  }
  if (act === "hit") {
    const card = draw21(st);
    g.hands[s].push(card); g.hits[s]++;
    ev(st, "g21hit", { s, card });
    if (g21Total(st, s) > g21Bust(st, s)) return show21(st, s);
    if (g.hits[s] < g21Hits(st, s)) return;
    if (X.fiveWin && g.hits[s] >= X.hits) return show21(st, null, s); // a full hand of five and still under the line: the hand is his
  }
  g.stood[s] = true;
  const last = g.phase !== g21First(st);
  if (!last) g.phase = g.phase === "top" ? "bottom" : "top"; // the event already shows whose decision is next
  ev(st, "g21stand", { s });
  if (last) show21(st, null);
}
/** The hand is decided: `bust` is the side that went over; `five` the side that filled its hand without going over (it wins whatever the totals); neither = a showdown. */
function show21(st, bust, five = null) {
  const g = st.c.ground, X = st.cfg.ground21, top = g.top, bot = other(top), tt = g21Total(st, top), tb = g21Total(st, bot);
  if (!bust && !five) bust = tb > g21Bust(st, bot) ? bot : tt > g21Bust(st, top) ? top : null; // a total over the line at the showdown is a bust too
  const res = five ? (five === top ? "top" : "bottom") : bust ? (bust === top ? "bottom" : "top") : tt > tb ? "top" : tb > tt ? "bottom" : "tie";
  const out = { top, why: five ? "five" : bust ? "bust" : "show", bust, five, totals: { [top]: tt, [bot]: tb }, layer: g.layer };
  if (res === "top") {
    g.gap = five ? X.fiveGap : bust ? X.bustGap : tt - tb;
    if (tt >= g21SubAt(st) && (five || tb !== X.bust)) { // a submission: never worth less than cashing in
      const dmg = Math.max(X.submit, g21Cash(st, g.gap, g.layer));
      hurt21(st, dmg);
      ev(st, "g21end", { ...out, res: "sub", gap: g.gap, dmg });
      return end21(st);
    }
    g.phase = "decide";
    return void ev(st, "g21end", { ...out, res, gap: g.gap, cash: g21Cash(st, g.gap, g.layer) });
  }
  if (res === "tie") { ev(st, "g21end", { ...out, res }); return end21(st); }
  g.layer--; g.beat++;
  ev(st, "g21end", { ...out, res, to: g.layer });
  if (g.layer < 1 || g.beat > X.hands) return end21(st);
  deal21(st);
}
function hurt21(st, dmg) { const top = st.c.ground.top, bot = other(top); st[bot].hp = Math.max(0, st[bot].hp - dmg); st[top].stats.dmg += dmg; }
function end21(st) {
  const c = st.c, bot = other(c.ground.top);
  if (st[bot].hp <= 0) { c.ko = bot; c.ground = null; return; } // finished on the mat
  standUp(st);
}

// ---------- the ground game, Texas hold'em style (ground.mode "poker"; numbers in rules/bg groundPoker) ----------
// The chips are stamina (st[s].stam, carried through the bout). A hand: both ante, two hole cards each, five on the table (three shown first, two more
// before the second round), two betting rounds, a showdown. The bottom man acts first in every round, the top man answers.
// The loser's stake is gone, the winner takes his own back. The top man winning cashes in (pot / 2 x layer) or passes deeper; the bottom man winning
// slips out one layer; a split stands them up. A submission ends the bout (how "SUB"). The cards on the board add small effects (fx when "ground").
const isPoker = (st) => st.cfg.ground.mode === "poker";
export const pokerOn = isPoker;
const PK = (st) => st.cfg.groundPoker;
/** Cards are 0..51: rank = c % 13 + 2 (2..14, ace high), suit = floor(c / 13). */
export const cardRank = (c) => (c % 13) + 2;
export const cardSuit = (c) => Math.floor(c / 13);
/** Best five of the cards (up to seven): { cls 0..8, score (a number, higher wins), hi (the rank that names it) }.
 *  cls: 0 high card, 1 pair, 2 two pair, 3 three, 4 straight, 5 flush, 6 full house, 7 four, 8 straight flush. */
export function evalHand(cards) {
  const rc = new Array(15).fill(0), sm = [0, 0, 0, 0], sn = [0, 0, 0, 0];
  let all = 0;
  for (const c of cards) { const r = (c % 13) + 2, s = (c / 13) | 0; rc[r]++; sm[s] |= 1 << r; sn[s]++; all |= 1 << r; }
  const straight = (m) => { m |= ((m >> 14) & 1) << 1; for (let h = 14; h >= 5; h--) if (((m >> (h - 4)) & 31) === 31) return h; return 0; };
  const pack = (cls, rs) => { let v = cls; for (let i = 0; i < 5; i++) v = v * 15 + (rs[i] || 0); return v; };
  const rest = (used, n) => { const out = []; for (let r = 14; r >= 2 && out.length < n; r--) if (rc[r] && !used.includes(r)) out.push(r); return out; };
  const fs = sn.findIndex((n) => n >= 5);
  if (fs >= 0) { const h = straight(sm[fs]); if (h) return { cls: 8, score: pack(8, [h]), hi: h }; }
  const four = [], three = [], two = [];
  for (let r = 14; r >= 2; r--) { if (rc[r] === 4) four.push(r); else if (rc[r] === 3) three.push(r); else if (rc[r] === 2) two.push(r); }
  if (four.length) return { cls: 7, score: pack(7, [four[0], ...rest([four[0]], 1)]), hi: four[0] };
  if (three.length && (three.length > 1 || two.length)) return { cls: 6, score: pack(6, [three[0], three.length > 1 ? Math.max(three[1], two[0] || 0) : two[0]]), hi: three[0] };
  if (fs >= 0) { const rs = []; for (let r = 14; r >= 2 && rs.length < 5; r--) if ((sm[fs] >> r) & 1) rs.push(r); return { cls: 5, score: pack(5, rs), hi: rs[0] }; }
  const sh = straight(all);
  if (sh) return { cls: 4, score: pack(4, [sh]), hi: sh };
  if (three.length) return { cls: 3, score: pack(3, [three[0], ...rest([three[0]], 2)]), hi: three[0] };
  if (two.length >= 2) return { cls: 2, score: pack(2, [two[0], two[1], ...rest([two[0], two[1]], 1)]), hi: two[0] };
  if (two.length) return { cls: 1, score: pack(1, [two[0], ...rest([two[0]], 3)]), hi: two[0] };
  const hi = rest([], 5);
  return { cls: 0, score: pack(0, hi), hi: hi[0] };
}
const pFx = (st, s, kind) => alive(st.c[s]).flatMap((u) => defOf(st, u).fx.filter((x) => x.when === "ground" && x.do === kind).map((x) => ({ ...x, n: (x.n || 0) * mulOf(st, u) })));
const pSum = (st, s, kind) => pFx(st, s, kind).reduce((n, x) => n + x.n, 0);
function shuffled(st) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(rand(st) * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
/** The hand class side s needs to submit on `layer` at a showdown win: Infinity when it cannot. The layer's own rule is the top man's; cards can lower it or give it to the bottom man. */
export function pokerSubRank(st, s, layer = st.c.ground.layer) {
  const g = st.c.ground, role = g.top === s ? "top" : "bottom", P = PK(st);
  let r = role === "top" && layer >= P.subLayer ? P.subRank[layer - 1] ?? Infinity : Infinity;
  for (const x of pFx(st, s, "sub")) if (x.role === role && x.layer === layer) r = Math.min(r, x.rank);
  return r;
}
/** Damage for cashing in a pot on `layer`: half the pot rounded up, times the layer, capped; a pounding card adds on top. */
export function pokerCash(st, pot, layer, s = st.c.ground.top) {
  const P = PK(st);
  return Math.min(P.cap, Math.ceil(pot / 2) * P.cashMul[layer - 1]) + pSum(st, s, "cashplus");
}
function startPoker(st) {
  const g = st.c.ground;
  g.dealt = 0; g.used = { refill: { a: false, b: false } };
  g.left = { swap: { a: pSum(st, "a", "swap"), b: pSum(st, "b", "swap") }, peek: { a: pSum(st, "a", "peek"), b: pSum(st, "b", "peek") } };
  dealPoker(st);
}
function pay(st, s, n) { const k = Math.max(0, Math.min(n, st[s].stam)); st[s].stam -= k; st.c.ground.h.put[s] += k; return k; }
function dealPoker(st) {
  const g = st.c.ground, P = PK(st), bot = other(g.top), first = g.dealt === 0, d = shuffled(st);
  g.dealt++;
  const h = (g.h = { deck: d, hole: { a: [d[0], d[1]], b: [d[2], d[3]] }, board: d.slice(4, 9), next: 9, shown: 3, round: 1, put: { a: 0, b: 0 }, street: { a: 0, b: 0 }, raises: 0, acted: { a: false, b: false },
    turn: bot, phase: "bet", swapQ: [], peeked: { a: [], b: [] }, log: [], reveal: false, win: null });
  for (const s of SIDES) pay(st, s, P.ante + (first ? pSum(st, other(s), "ante") : 0));
  if (first) for (const s of [bot, g.top]) if (g.left.swap[s] > 0) h.swapQ.push(s);
  if (h.swapQ.length) h.phase = "swap";
  ev(st, "pdeal", { top: g.top, layer: g.layer, hand: g.dealt });
  if (!h.swapQ.length) enterBet(st);
}
/** A man with no stamina left cannot bet, and neither can the one facing him: straight to the showdown. */
function enterBet(st) {
  const g = st.c.ground, h = g.h;
  h.phase = "bet"; h.turn = other(g.top); h.raises = 0; h.acted = { a: false, b: false }; h.street = { a: 0, b: 0 };
  if (st.a.stam <= 0 || st.b.stam <= 0) showdown(st);
}
/** Whose decision it is and what it may be: { top, layer, hand, hands, round, phase, turn, actions, owe, raise, allin, pot } or null. */
export function pokerOptions(st) {
  const c = st.c, g = c?.ground, h = g?.h, P = PK(st);
  if (st.phase !== "clash" || !h || c.ko || c.sub || !isPoker(st)) return null;
  const base = { top: g.top, layer: g.layer, hand: g.dealt, hands: P.hands, round: h.round, phase: h.phase };
  if (h.phase === "decide") return { ...base, turn: g.top, actions: ["cash", ...(g.layer < st.cfg.ground.layers && g.dealt < P.hands ? ["deeper"] : [])], cash: h.win.cash, pot: h.win.pot };
  if (h.phase === "swap") return { ...base, turn: h.swapQ[0], actions: ["keep", "swap0", "swap1"] };
  const me = h.turn, opp = other(me), owe = Math.max(0, h.street[opp] - h.street[me]), room = Math.max(0, st[me].stam - owe);
  const k = Math.min(P.raise[h.round - 1], room, st[opp].stam), kAll = Math.min(room, st[opp].stam), canRaise = h.raises < P.maxRaises && k > 0;
  const canAll = canRaise && g.layer >= P.allInLayer && kAll > k;
  const actions = ["fold", "call"];
  if (canRaise) actions.push("raise");
  if (canAll) actions.push("allin");
  if (g.left.peek[me] > 0 && h.peeked[me].length < 2) actions.push("peek");
  return { ...base, turn: me, actions, owe: Math.min(owe, st[me].stam), raise: canRaise ? k : 0, allin: canAll ? kAll : 0, pot: h.put.a + h.put.b };
}
/** What side s can see: all of its own cards, the table so far, the other man's cards only when peeked or at the showdown, and the betting so far. */
export function pokerView(st, s) {
  const o = pokerOptions(st);
  if (!o) return null;
  const g = st.c.ground, h = g.h, f = other(s), board = h.board.slice(0, h.shown), mine = evalHand([...h.hole[s], ...board]);
  const known = [0, 1].map((i) => (h.reveal || h.peeked[s].includes(i) ? h.hole[f][i] : null));
  return { ...o, role: g.top === s ? "top" : "bottom", board, mine: { cards: [...h.hole[s]], stam: st[s].stam, put: h.put[s], street: h.street[s], hand: mine, left: { swap: g.left.swap[s], peek: g.left.peek[s] } },
    foe: { cards: known, stam: st[f].stam, put: h.put[f], street: h.street[f], hand: h.reveal ? evalHand([...h.hole[f], ...board]) : null }, log: h.log.map((x) => ({ ...x })), subRank: pokerSubRank(st, g.top) };
}
function runPoker(st) {
  const c = st.c, g = c.ground, h = g.h, o = pokerOptions(st), s = o.turn, opp = other(s), P = PK(st);
  const act = o.actions.includes(c.gchoice?.[s]) ? c.gchoice[s] : h.phase === "decide" ? "cash" : h.phase === "swap" ? "keep" : "call";
  c.gchoice = null;
  if (h.phase === "decide") {
    ev(st, "pact", { s, act, hand: g.dealt, layer: g.layer });
    if (act === "deeper") { g.layer++; ev(st, "pdeep", { s, layer: g.layer }); return dealPoker(st); }
    const dmg = pokerCash(st, h.win.pot, g.layer), bot = other(g.top);
    st[bot].hp = Math.max(0, st[bot].hp - dmg); st[g.top].stats.dmg += dmg;
    const stay = g.dealt < P.hands && st[bot].hp > 0;
    ev(st, "pcash", { s, dmg, layer: g.layer, stay });
    return stay ? dealPoker(st) : endPoker(st);
  }
  if (h.phase === "swap") {
    h.swapQ.shift();
    if (act !== "keep") { h.hole[s][Number(act.slice(4))] = h.deck[h.next++]; g.left.swap[s]--; }
    ev(st, "pact", { s, act, hand: g.dealt, layer: g.layer });
    if (!h.swapQ.length) enterBet(st);
    return;
  }
  if (act === "peek") {
    const free = [0, 1].filter((i) => !h.peeked[s].includes(i)), i = free[Math.floor(rand(st) * free.length)];
    h.peeked[s].push(i); g.left.peek[s]--;
    return void ev(st, "pact", { s, act, hand: g.dealt, layer: g.layer, card: h.hole[opp][i], idx: i });
  }
  const entry = { s, act, round: h.round, facing: o.owe > 0, canRaise: o.raise > 0, canAllin: o.allin > 0 };
  h.log.push(entry);
  if (act === "fold") { ev(st, "pact", { ...entry, hand: g.dealt, layer: g.layer, amt: 0 }); return settle(st, opp, "fold"); }
  let amt = pay(st, s, o.owe);
  if (act === "raise" || act === "allin") { amt += pay(st, s, act === "raise" ? o.raise : o.allin); h.raises++; h.acted[opp] = false; }
  h.street[s] += amt; h.acted[s] = true;
  ev(st, "pact", { ...entry, hand: g.dealt, layer: g.layer, amt });
  if (h.acted[opp] && h.street[s] === h.street[opp]) return nextRound(st);
  h.turn = opp;
}
function nextRound(st) {
  const g = st.c.ground, h = g.h;
  if (h.round >= 2) return showdown(st);
  h.round = 2; h.shown = 5;
  ev(st, "pboard", { round: 2 });
  enterBet(st);
}
function showdown(st) {
  const g = st.c.ground, h = g.h;
  h.shown = 5; h.reveal = true;
  const ha = evalHand([...h.hole.a, ...h.board]), hb = evalHand([...h.hole.b, ...h.board]);
  settle(st, ha.score > hb.score ? "a" : hb.score > ha.score ? "b" : null, "show", { a: ha, b: hb });
}
/** The hand is over: `w` won (null = split), by "fold" or "show". Stakes, drain, submissions, then what the winner does with it. */
function settle(st, w, how, hands = null) {
  const g = st.c.ground, h = g.h, P = PK(st), top = g.top, bot = other(top), pot = h.put.a + h.put.b, layer = g.layer;
  const out = { how, pot, layer, hand: g.dealt, hands, board: h.board.slice(0, how === "show" ? 5 : h.shown), hole: how === "show" ? { a: [...h.hole.a], b: [...h.hole.b] } : null };
  if (!w) {
    for (const s of SIDES) st[s].stam += h.put[s];
    ev(st, "pend", { ...out, res: "tie" });
    return endPoker(st);
  }
  const l = other(w);
  st[w].stam += h.put[w];
  let drained = 0;
  if (w === top) for (const x of pFx(st, top, "drain")) { const k = Math.min(st[l].stam, x.n); st[l].stam -= k; drained += k; }
  let sub = null;
  if (w === top) {
    if (how === "show" && layer >= P.subLayer && hands[top].cls >= pokerSubRank(st, top)) sub = "lock";
    else if (st[l].stam <= 0 && layer >= P.subLayer) {
      const back = pFx(st, l, "refill").find((x) => layer >= (x.layer || 1));
      if (back && !g.used.refill[l]) { g.used.refill[l] = true; st[l].stam += back.n; out.refill = back.n; } else sub = "drain";
    }
  } else if (how === "show" && hands[bot].cls >= pokerSubRank(st, bot)) sub = "counter";
  Object.assign(out, { winner: w, drained });
  if (sub) {
    ev(st, "pend", { ...out, res: "sub", sub });
    c_sub(st, l);
    return;
  }
  if (w === top) {
    h.win = { pot, cash: pokerCash(st, pot, layer) };
    h.phase = "decide";
    return void ev(st, "pend", { ...out, res: "top", cash: h.win.cash });
  }
  g.layer--;
  ev(st, "pend", { ...out, res: "bottom", to: g.layer });
  if (g.layer < 1 || g.dealt >= P.hands) return endPoker(st);
  dealPoker(st);
}
function c_sub(st, loser) { const c = st.c; c.sub = loser; c.ground = null; ev(st, "psub", { s: other(loser), loser }); }
function endPoker(st) {
  const c = st.c, bot = other(c.ground.top);
  if (st[bot].hp <= 0) { c.ko = bot; c.ground = null; return; } // finished on the mat
  standUp(st);
}

// ---------- the ground game, EA UFC style (ground.mode "ea"; numbers in rules/bg groundEA) ----------
// Every beat both men drag a direction at the same moment. The three directions mean the same thing to both: up = pass (deny the pass),
// right = pound (cover up), left = submission (defend it). The same direction is a DENIAL: the attacker pays extra stamina and the bottom man gains a
// point of space (two points and he is out one layer; out of the first layer he stands up). A different one LANDS: a pass goes one layer deeper, a pound
// hurts him and drains his stamina (and makes him cover up next beat), a submission starts a staged timing game whose escape chance falls with his
// stamina; surviving every stage ends it, otherwise the bout is over (how "SUB"). Stamina is st[s].stam, carried through the bout.
// eaBeat is a pure function of a small virtual state, so the screen, the opponent and the simulated reader all use the same rule.
const isEA = (st) => st.cfg.ground.mode === "ea";
export const eaOn = isEA;
const EAX = (st) => st.cfg.groundEA;
export const EA_MOVES = ["pass", "pound", "sub"];
const eFx = (st, s, kind) => alive(st.c[s]).flatMap((u) => defOf(st, u).fx.filter((x) => x.when === "groundEA" && x.do === kind).map((x) => ({ ...x, n: (x.n || 0) * mulOf(st, u) })));
const eSum = (st, s, kind) => eFx(st, s, kind).reduce((n, x) => n + x.n, 0);
/** What the cards on the board do in this ground (fixed for the ground: nobody swings while they grapple). */
function eaMods(st) {
  const top = st.c.ground.top, bot = other(top);
  return { poundPlus: eSum(st, top, "poundplus"), drainPlus: eSum(st, top, "drainplus"), stageCut: eSum(st, top, "stagecut"), passCut: eSum(st, top, "passcut"), quick: eSum(st, bot, "quick") > 0 };
}
/** A direction that is closed on this layer for both men: the submission before layer X.subFrom, the pass on the deepest layer. */
export const eaLocked = (X, layers, layer, m) => (m === "sub" && layer < (X.subFrom || 1)) || (m === "pass" && layer >= layers);
/** What an attack costs the top man in stamina. */
export const eaCost = (X, M, t) => Math.max(1, X.cost[t] - (t === "pass" ? M.passCut : 0));
/** The chance the bottom man gets out of one stage of a submission, from his stamina. */
export const eaEscape = (X, botSta) => Math.min(X.escMax, X.escBase + X.escSta * (botSta / X.stamina));
/** The number of stages a submission has here. */
export const eaStages = (X, M, layer) => Math.max(1, X.stages[layer - 1] - M.stageCut);
/** The chance a submission goes the whole way (he fails every stage). */
export const eaSubOdds = (X, M, layer, botSta) => (1 - eaEscape(X, botSta)) ** eaStages(X, M, layer);
/** One beat on a virtual state V = { layer, space, covered, topSta, botSta, quickUsed, dmg }: the top man's move t (or "rest") against the bottom man's b.
 *  Returns what happened: { kind: rest | deny | pass | pound | sub, dmg, drain, esc, up, stages }. */
export function eaBeat(X, layers, V, M, t, b) {
  V.covered = false;
  const r = { kind: "", dmg: 0, drain: 0, esc: false, up: false, stages: 0 };
  if (t === "rest") { V.topSta = Math.min(X.stamina, V.topSta + X.rest); V.space++; r.kind = "rest"; }
  else {
    V.topSta = Math.max(0, V.topSta - eaCost(X, M, t));
    if (t === b) { V.topSta = Math.max(0, V.topSta - X.denied); V.space++; r.kind = "deny"; }
    else if (t === "pass") { V.space = 0; if (V.layer < layers) V.layer++; r.kind = "pass"; }
    else if (t === "pound") {
      r.dmg = X.pound[V.layer - 1] + M.poundPlus; r.drain = X.drain + M.drainPlus;
      V.botSta = Math.max(0, V.botSta - r.drain); V.covered = true; V.dmg = (V.dmg || 0) + r.dmg; r.kind = "pound";
    } else { r.kind = "sub"; r.stages = eaStages(X, M, V.layer); }
  }
  const need = M.quick && !V.quickUsed ? 1 : X.need;
  if (r.kind !== "sub" && V.space >= need) { if (need < X.need) V.quickUsed = true; V.space = 0; V.layer--; r.esc = true; if (V.layer < 1) r.up = true; }
  return r;
}
/** Set up the EA ground on st.c.ground ({ top, layer, beat }): the cards on the board are read once, here. */
export function startEA(st) {
  const g = st.c.ground;
  Object.assign(g, { space: 0, covered: false, lastTop: null, lastBot: null, hist: { top: [], bot: [] }, quickUsed: false, phase: "pick", sub: null, mods: eaMods(st) });
  ev(st, "eadeal", { top: g.top, layer: g.layer });
}
/** What may be picked now: { phase: "pick", top, layer, beat, beats, moves: { a, b } } or { phase: "sub", ... stage, stages, escape }. */
export function eaOptions(st) {
  const c = st.c, g = c?.ground, X = EAX(st);
  if (st.phase !== "clash" || !g || c.ko || !isEA(st)) return null;
  const bot = other(g.top), base = { top: g.top, layer: g.layer, beat: g.beat, beats: X.beats };
  if (g.phase === "sub") return { ...base, phase: "sub", stage: g.sub.stage, stages: g.sub.stages, escape: eaEscape(X, st[bot].stam) };
  const open = EA_MOVES.filter((m) => !eaLocked(X, st.cfg.ground.layers, g.layer, m)), ok = open.filter((m) => eaCost(X, g.mods, m) <= st[g.top].stam);
  return { ...base, phase: "pick", moves: { [g.top]: ok.length ? ok : ["rest"], [bot]: open } };
}
/** What side s sees: the options plus both stamina bars, the space, the cards' effects and what a move costs. */
export function eaView(st, s) {
  const o = eaOptions(st);
  if (!o) return null;
  const g = st.c.ground, X = EAX(st), M = g.mods, bot = other(g.top);
  return { ...o, role: g.top === s ? "top" : "bottom", sta: { a: st.a.stam, b: st.b.stam }, space: g.space, covered: g.covered, lastTop: g.lastTop, lastBot: g.lastBot, mods: { ...M }, quick: M.quick && !g.quickUsed,
    costs: Object.fromEntries(EA_MOVES.map((m) => [m, eaCost(X, M, m)])), stages: eaStages(X, M, g.layer), escape: eaEscape(X, st[bot].stam), subOdds: eaSubOdds(X, M, g.layer, st[bot].stam) };
}
function runEA(st, grade) {
  const c = st.c, g = c.ground, X = EAX(st), o = eaOptions(st);
  if (g.phase === "sub") return eaStage(st, grade);
  const top = g.top, bot = other(top), pickFor = (s) => (c.gchoice?.[s] && o.moves[s].includes(c.gchoice[s]) ? c.gchoice[s] : pickOne(st, o.moves[s]));
  const t = pickFor(top), b = pickFor(bot);
  c.gchoice = null;
  const V = { layer: g.layer, space: g.space, covered: g.covered, topSta: st[top].stam, botSta: st[bot].stam, quickUsed: g.quickUsed, dmg: 0 };
  const r = eaBeat(X, st.cfg.ground.layers, V, g.mods, t, b);
  st[top].stam = V.topSta; st[bot].stam = V.botSta;
  Object.assign(g, { layer: V.layer, space: V.space, covered: V.covered, quickUsed: V.quickUsed, lastTop: t, lastBot: b });
  g.hist.top.push(t); g.hist.bot.push(b);
  const n = g.beat++;
  if (r.dmg) { st[bot].hp = Math.max(0, st[bot].hp - r.dmg); st[top].stats.dmg += r.dmg; }
  ev(st, "eabeat", { top, mt: t, mb: b, ...r, layer: g.layer, space: g.space, beat: n }); // (t is the event type, so the moves are mt / mb)
  if (st[bot].hp <= 0) { c.ko = bot; c.ground = null; return; } // finished on the mat
  if (r.up) return endEA(st);
  if (r.kind === "sub") { g.phase = "sub"; g.sub = { stage: 0, stages: r.stages }; return void ev(st, "easubstart", { top, layer: g.layer, stages: r.stages, escape: eaEscape(X, st[bot].stam) }); }
  if (g.beat > X.beats) endEA(st);
}
/** One stage of a submission. grade (perfect | good | miss) is the player's (side a) timing: it moves his side's chance by X.timing[grade]. */
function eaStage(st, grade) {
  const c = st.c, g = c.ground, X = EAX(st), top = g.top, bot = other(top), S = g.sub;
  const base = eaEscape(X, st[bot].stam), mod = grade ? X.timing[grade] || 0 : 0;
  const p = Math.max(0.02, Math.min(X.escMax, base + ("a" === bot ? mod : -mod)));
  const esc = rand(st) < p;
  S.stage++;
  ev(st, "easub", { top, bot, stage: S.stage, stages: S.stages, base, p, grade: grade || null, escaped: esc });
  if (esc) { st[bot].stam = Math.max(0, st[bot].stam - X.escDrain); g.phase = "pick"; g.sub = null; g.space = 0; g.covered = false; if (g.beat > X.beats) endEA(st); return; }
  if (S.stage >= S.stages) { c.sub = bot; c.ground = null; ev(st, "easubmit", { s: top, loser: bot }); }
}
function endEA(st) { standUp(st); }

function endClash(st) {
  const c = st.c, cfg = st.cfg, na = alive(c.a).length, nb = alive(c.b).length;
  const w = c.ko ? other(c.ko) : c.sub ? other(c.sub) : na && !nb ? "a" : nb && !na ? "b" : null;
  let dmg = 0;
  if (w) {
    const l = other(w);
    dmg = c.ko || c.sub ? 0 : Math.min(cfg.damage.caps[st.round - 1] ?? 99, alive(c[w]).reduce((n, u) => n + defOf(st, u).tier, 0) + st[w].shop.tier);
    st[l].hp = Math.max(0, st[l].hp - dmg);
    st[w].stats.won++; st[w].stats.dmg += dmg;
    st.wins[w]++;
    // cards that asked for it grow when their side wins and they are still standing
    for (const u of alive(c[w])) for (const fx of defOf(st, u).fx) if (fx.when === "win") { const real = st[w].board[u.slot]; if (real && real.id === u.id) applyFx(st, st[w].board, real, fx, mulOf(st, real)); }
  }
  for (const s of SIDES) st[s].lostLast = w === other(s);
  ev(st, "clashend", { s: w, dmg });
  st.c = null;
  if (c.sub) return finish(st, w, "SUB");
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
  for (const s of SIDES) st[s].stam = Math.min(groundStam(st.cfg).stamina, st[s].stam + groundStam(st.cfg).regen); // a minute's rest gives stamina back
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

/** Run a whole clash with no pauses (simulation). timing(st, p) grades the timing bar; pick(st, o) returns [attacker uid, target uid] for a side
 *  (default: leftmost card, random target); gpick(st, side) returns that side's ground move (default: random). */
export function playClash(st, timing = () => "miss", pick = null, gpick = null) {
  if (!startClash(st)) return false;
  let guard = 0;
  while (st.phase === "clash" && guard++ < 1000) {
    if (st.c.ground) { if (gpick) for (const s of SIDES) { const m = gpick(st, s); if (m) chooseGround(st, s, m); } step(st); continue; }
    const o = options(st), ch = o && pick ? pick(st, o) : null;
    if (ch) choose(st, ch[0], ch[1]);
    const p = o ? needsReact(st) : null;
    step(st, p ? timing(st, p) : null);
  }
  return true;
}
