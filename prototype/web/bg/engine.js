// Octagon Cards — battlegrounds-style mode. Pure rules: no DOM, no clock; the browser and the simulation share this file.
// A bout is `rounds` rounds. Before each round side a shops (buy / sell / reorder skills); side b's board for the
// round is public. In a round the two boards fire slot by slot, left to right, for `exchanges` passes.
// All numbers and skill properties come from rules/bg/*.json; the engine never compares skill names.

export const other = (s) => (s === "a" ? "b" : "a");
const SIDES = ["a", "b"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;

export function rand(st) {
  const a = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function prepare(data) {
  for (const [id, d] of Object.entries(data.skills)) { d.id = id; d.active = d.kind === "strike" || d.kind === "takedown"; }
  return data;
}
const parse = (x) => { const [id, lv] = String(x).split(":"); return { id, lv: Number(lv) || 1 }; };
export const skillOf = (st, c) => (c ? st.data.skills[c.id] : null);
export const lvMul = (st, c) => st.cfg.levelMul[(c.lv || 1) - 1] ?? 1;
const fits = (m, d) => !m || Object.entries(m).every(([k, v]) => d[k] === v);

function fillBoard(st, list) {
  const b = Array(st.cfg.slots).fill(null);
  list.slice(0, st.cfg.slots).forEach((x, i) => (b[i] = parse(x)));
  return b;
}

export function createGame(data, aId, bId, seed = 1) {
  const st = { data, cfg: data.config, rng: (seed >>> 0) || 1, round: 0, ex: 0, cursor: 0, phase: "shop", over: null, log: [], rounds: [], shop: { tier: 1, gold: 0, offers: [], special: null }, reacted: false, wonLast: false };
  for (const [s, id] of [["a", aId], ["b", bId]]) {
    const f = data.fighters[id];
    st[s] = { id, f, stun: 0, chinLoss: 0, chinUp: 0, gas: f.gas, score: 0, rocked: null, weak: 0, board: Array(st.cfg.slots).fill(null), x: {}, stats: { dmg: 0, blocks: 0, td: 0 } };
  }
  st.a.board = fillBoard(st, st.a.f.start);
  beginShop(st);
  return st;
}

// ---------- derived stats ----------
function passive(st, s, key) {
  let n = 0;
  for (const c of st[s].board) { const d = skillOf(st, c); if (d && d.kind === "passive" && d[key]) n += d[key] * lvMul(st, c); }
  return n;
}
export const chinOf = (st, s) => Math.round(st[s].f.chin + st[s].chinUp - st[s].chinLoss + passive(st, s, "chin"));
export const gasMaxOf = (st, s) => Math.round(st[s].f.gas + passive(st, s, "gas"));

/** The numbers printed on a card for side s (so the UI and the engine never disagree). */
export function view(st, s, c) {
  const d = skillOf(st, c), F = st[s], m = lvMul(st, c), bn = F.f.bonus && fits(F.f.bonus.match, d) ? F.f.bonus : null;
  const out = { name: d.name, kind: d.kind, lv: c.lv || 1, gas: d.gas || 0 };
  if (d.kind === "strike") { out.dmg = r1((d.dmg * m + (bn?.dmg || 0)) * F.f.power); out.hits = d.hits || 1; out.acc = clamp(d.acc + (bn?.acc || 0), 0, 1); out.region = d.region; }
  if (d.kind === "takedown") out.p = clamp(d.p + F.f.wrestle + (bn?.p || 0) + (c.lv - 1) * 0.1, 0, 1);
  if (d.counter) out.counter = r1(d.counter * m);
  return out;
}

// ---------- log ----------
const snap = (st) => {
  const one = (s) => ({ stun: r1(st[s].stun), chin: chinOf(st, s), gas: st[s].gas, gasMax: gasMaxOf(st, s), rocked: !!st[s].rocked, score: r1(st[s].score), weak: st[s].weak });
  return { a: one("a"), b: one("b"), round: st.round, ex: st.ex };
};
function ev(st, t, o = {}) { const e = { t, ...o, snap: snap(st) }; st.log.push(e); return e; }

// ---------- shop ----------
export function goldFor(st) { const g = st.cfg.gold; return g.base + g.perRound * (st.round - 1) + (st.wonLast ? g.win : 0); }

function roll(st) {
  const sh = st.cfg.shop, pool = Object.values(st.data.skills).filter((d) => d.kind !== "special" && d.tier <= st.shop.tier);
  const out = [];
  while (out.length < sh.offers && pool.length) out.push(pool.splice(Math.floor(rand(st) * pool.length), 1)[0].id);
  st.shop.offers = out;
}
function rollSpecial(st) {
  const pool = Object.values(st.data.skills).filter((d) => d.kind === "special" && d.tier <= st.shop.tier);
  st.shop.special = pool.length && rand(st) < st.cfg.shop.specialChance ? pool[Math.floor(rand(st) * pool.length)].id : null;
}

function beginShop(st) {
  st.round++;
  st.phase = "shop";
  st.shop.gold = goldFor(st);
  st.b.board = fillBoard(st, st.b.f.builds[Math.min(st.round, st.b.f.builds.length) - 1]);
  for (const s of SIDES) st[s].gas = gasMaxOf(st, s);
  roll(st); rollSpecial(st);
  ev(st, "shop", {});
}

export const costOf = (st, id) => st.data.skills[id].cost ?? st.cfg.shop.cost;
/** Where a bought skill would go: { merge: slot } | { slot } | null (no room). */
export function place(st, id) {
  const B = st.a.board, same = B.findIndex((c) => c && c.id === id && c.lv < st.cfg.shop.maxLevel);
  if (same >= 0) return { merge: same };
  const empty = B.findIndex((c) => !c);
  return empty >= 0 ? { slot: empty } : null;
}
export function buy(st, i) {
  if (st.phase !== "shop") return false;
  const id = st.shop.offers[i];
  if (!id || costOf(st, id) > st.shop.gold) return false;
  const p = place(st, id);
  if (!p) return false;
  st.shop.gold -= costOf(st, id);
  st.shop.offers[i] = null;
  if (p.merge != null) st.a.board[p.merge].lv++; else st.a.board[p.slot] = { id, lv: 1 };
  st.a.gas = gasMaxOf(st, "a");
  ev(st, "buy", { id, merge: p.merge != null });
  return true;
}
export function buySpecial(st) {
  if (st.phase !== "shop" || !st.shop.special) return false;
  const d = st.data.skills[st.shop.special];
  if (costOf(st, d.id) > st.shop.gold) return false;
  st.shop.gold += (d.gold || 0) - costOf(st, d.id);
  if (d.stun) st.a.stun = Math.max(0, st.a.stun - d.stun);
  if (d.chinUp) st.a.chinUp += d.chinUp;
  st.shop.special = null;
  ev(st, "special", { id: d.id });
  return true;
}
export function sell(st, slot) {
  if (st.phase !== "shop" || !st.a.board[slot]) return false;
  st.a.board[slot] = null;
  st.shop.gold += st.cfg.shop.sell;
  st.a.gas = gasMaxOf(st, "a");
  return true;
}
export function swap(st, i, j) {
  if (st.phase !== "shop") return false;
  const B = st.a.board;
  [B[i], B[j]] = [B[j], B[i]];
  return true;
}
export function reroll(st) {
  if (st.phase !== "shop" || st.shop.gold < st.cfg.shop.reroll) return false;
  st.shop.gold -= st.cfg.shop.reroll;
  roll(st);
  return true;
}
export const tierCost = (st) => st.cfg.shop.tierCost[st.shop.tier] ?? null;
export function tierUp(st) {
  const c = tierCost(st);
  if (st.phase !== "shop" || c == null || st.shop.gold < c) return false;
  st.shop.gold -= c;
  st.shop.tier++;
  return true;
}

// ---------- fight ----------
export function startRound(st) {
  if (st.phase !== "shop") return false;
  st.phase = "fight";
  st.ex = 1; st.cursor = 0; st.reacted = false;
  for (const s of SIDES) { st[s].score = 0; st[s].gas = gasMaxOf(st, s); resetExchange(st, s); }
  ev(st, "round", {});
  return true;
}
function resetExchange(st, s) {
  const F = st[s];
  F.x = { used: {}, grounded: false, setup: false, last: null, slow: 0 };
}
const sideAt = (st, p) => ((p % 2 === 0) === (st.ex % 2 === 1) ? "a" : "b");

/** Would this slot act now? Returns the skill or null (empty, passive, defence, grounded, or needs unmet). */
function acts(st, s, slot) {
  const c = st[s].board[slot], d = skillOf(st, c);
  if (!d || !d.active || st[s].x.grounded) return null;
  if (d.needs === "grounded" && !st[other(s)].x.grounded) return null;
  return { c, d };
}
/** The next skill that will fire: { s, slot, c, d } or null when the exchange has nothing left. */
export function upcoming(st) {
  if (st.phase !== "fight") return null;
  for (let p = st.cursor; p < st.cfg.slots * 2; p++) {
    const s = sideAt(st, p), slot = Math.floor(p / 2), a = acts(st, s, slot);
    if (a) return { p, s, slot, ...a };
  }
  return null;
}
function blocker(st, s, d) {
  const F = st[s];
  for (let i = 0; i < F.board.length; i++) {
    const c = F.board[i], k = skillOf(st, c);
    if (k && k.kind === "defence" && fits(k.blocks, d) && (F.x.used[i] || 0) < (k.charges || 1)) return { i, c, k };
  }
  return null;
}
const total = (st, s, c) => { const v = view(st, s, c); return v.dmg * v.hits; };
/** Is the next thing b's heavy strike that a cannot block — the moment for the player's timing bar? */
export function needsReact(st) {
  const u = upcoming(st);
  if (!u || u.s !== "b" || st.reacted || u.d.kind !== "strike" || st.b.gas < (u.d.gas || 0)) return null;
  if (total(st, "b", u.c) < st.cfg.react.heavy || blocker(st, "a", u.d)) return null;
  return u;
}

function finish(st, winner, how) {
  if (st.over) return;
  st.over = { winner, how, round: st.round };
  st.phase = "over";
  ev(st, "over", { s: winner, how });
}
function hurt(st, s, o, dmg, region, clean, d) {
  const A = st[s], D = st[o], cfg = st.cfg;
  A.stats.dmg += dmg;
  A.score += dmg * cfg.score.perDmg * (clean ? 1 : cfg.score.graze);
  if (D.rocked) { D.rocked.hp -= dmg; if (D.rocked.hp <= 0) return finish(st, s, "TKO"); }
  if (region !== "head") return;
  if (clean && d && d.ko && rand(st) < clamp(d.ko * (1 + cfg.ko.stunScale * Math.min(1, D.stun / chinOf(st, o))), 0, 0.9)) return finish(st, s, "KO");
  D.stun += dmg;
  if (!D.rocked && D.stun >= chinOf(st, o)) { D.rocked = { hp: cfg.rock.hp }; ev(st, "rocked", { s: o }); }
}

function strike(st, u, grade) {
  const { s, slot, c, d } = u, o = other(s), A = st[s], D = st[o], cfg = st.cfg, v = view(st, s, c), m = lvMul(st, c);
  const b = blocker(st, o, d);
  if (b) {
    D.x.used[b.i] = (D.x.used[b.i] || 0) + 1;
    D.stats.blocks++;
    D.score += cfg.score.block;
    ev(st, "block", { s: o, slot: b.i, by: b.k.id, id: d.id, from: slot });
    const back = (b.k.counter || 0) * lvMul(st, b.c) + passive(st, o, "onBlock");
    if (b.k.back) A.weak = clamp(A.weak + b.k.back * lvMul(st, b.c), 0, 0.5);
    if (back > 0) { const dmg = r1(back * D.f.power * (1 - D.weak)); ev(st, "counter", { s: o, dmg }); hurt(st, o, s, dmg, "head", true, null); }
    A.x.last = d.type; A.x.setup = false;
    return;
  }
  if (grade === "perfect") {
    st.a.stats.blocks++;
    ev(st, "react", { s: "a", grade, id: d.id, from: slot });
    const dmg = r1(cfg.react.counter * st.a.f.power);
    ev(st, "counter", { s: "a", dmg });
    hurt(st, "a", "b", dmg, "head", true, null);
    A.x.last = d.type; A.x.setup = false;
    return;
  }
  const aft = d.after && A.x.last === d.after.type ? d.after : null;
  const ramp = passive(st, s, "ramp") * (st.ex - 1);
  let acc = v.acc + (A.x.setup ? cfg.hit.setup : 0) + (aft?.acc || 0) + (A.rocked ? cfg.hit.rocked : 0) - A.x.slow;
  if (D.x.grounded) acc += 0.1;
  acc = clamp(acc, cfg.hit.min, cfg.hit.max);
  A.x.slow = 0;
  let landed = false;
  for (let h = 0; h < (d.hits || 1) && !st.over; h++) {
    let clean = rand(st) < acc, mul = clean ? 1 : cfg.hit.graze;
    if (grade === "good") { clean = false; mul = cfg.react.good; }
    const dmg = r1((v.dmg + (aft?.dmg || 0) + ramp) * mul * (1 - A.weak));
    ev(st, "hit", { s, slot, id: d.id, region: d.region, dmg, clean, grade: grade || null, combo: !!aft });
    if (clean) {
      landed = true;
      if (d.drain) D.gas = Math.max(0, D.gas - Math.round(d.drain * m));
      if (d.weaken) D.weak = clamp(D.weak + d.weaken * m, 0, 0.5);
    }
    if (d.slow) D.x.slow = d.slow;
    hurt(st, s, o, dmg, d.region, clean, d);
  }
  A.x.setup = !!d.setup && landed;
  A.x.last = d.type;
}

function takedown(st, u) {
  const { s, slot, c, d } = u, o = other(s), A = st[s], D = st[o], cfg = st.cfg;
  const b = blocker(st, o, d);
  if (b) {
    D.x.used[b.i] = (D.x.used[b.i] || 0) + 1;
    D.stats.blocks++; D.score += cfg.score.block;
    if (b.k.drainOnBlock) A.gas = Math.max(0, A.gas - b.k.drainOnBlock);
    ev(st, "block", { s: o, slot: b.i, by: b.k.id, id: d.id, from: slot });
    const back = passive(st, o, "onBlock");
    if (back > 0) { const dmg = r1(back * D.f.power); ev(st, "counter", { s: o, dmg }); hurt(st, o, s, dmg, "head", true, null); }
    return;
  }
  const p = clamp(view(st, s, c).p - D.f.tdDef, 0.05, 0.95), ok = rand(st) < p;
  if (ok) { D.x.grounded = true; A.stats.td++; A.score += cfg.score.takedown; }
  A.x.last = "takedown";
  ev(st, "takedown", { s, slot, id: d.id, ok, p });
}

/** Fire the next skill (grade = the player's timing when needsReact() said so). Returns false when the bout is not in a fight. */
export function step(st, grade = null) {
  if (st.phase !== "fight" || st.over) return false;
  const u = upcoming(st), want = grade ? needsReact(st) : null;
  if (!u) { endExchange(st); return true; }
  st.cursor = u.p + 1;
  const A = st[u.s], cost = u.d.gas || 0;
  if (A.gas < cost) { A.gas = Math.min(gasMaxOf(st, u.s), A.gas + st.cfg.fizzleRegen); ev(st, "tired", { s: u.s, slot: u.slot, id: u.d.id }); return true; }
  A.gas -= cost;
  const react = want && want.p === u.p ? grade : null;
  if (react) st.reacted = true;
  if (u.d.kind === "strike") strike(st, u, react && react !== "miss" ? react : null); else takedown(st, u);
  return true;
}

function endExchange(st) {
  const cfg = st.cfg;
  for (const s of SIDES) {
    st[s].gas = clamp(st[s].gas + cfg.gasRegen + passive(st, s, "regen"), 0, gasMaxOf(st, s));
    if (!st[s].rocked) st[s].stun = Math.max(0, r1(st[s].stun - (cfg.stunDecay || 0))); // he shakes it off between exchanges
    resetExchange(st, s);
  }
  st.cursor = 0;
  if (st.ex >= cfg.exchanges) return endRound(st);
  st.ex++;
  ev(st, "exchange", {});
}

function endRound(st) {
  const cfg = st.cfg, d = st.a.score - st.b.score, big = Math.abs(d) >= cfg.score.big;
  const card = d > 0.001 ? { a: 10, b: big ? 8 : 9 } : d < -0.001 ? { a: big ? 8 : 9, b: 10 } : { a: 10, b: 10 };
  card.pts = { a: r1(st.a.score), b: r1(st.b.score) };
  st.rounds.push(card);
  st.wonLast = d > 0.001;
  for (const s of SIDES) {
    const F = st[s];
    if (F.rocked) { F.rocked = null; F.chinLoss += cfg.rock.chinLoss; F.stun = r1(chinOf(st, s) * cfg.rock.after); }
    else F.stun = Math.max(0, F.stun - cfg.rest.stun);
  }
  ev(st, "roundend", { card });
  if (st.round >= cfg.rounds) {
    const ta = st.rounds.reduce((n, c) => n + c.a, 0), tb = st.rounds.reduce((n, c) => n + c.b, 0);
    st.over = { winner: ta > tb ? "a" : tb > ta ? "b" : null, how: "DEC", round: st.round, total: { a: ta, b: tb } };
    st.phase = "over";
    ev(st, "over", { s: st.over.winner, how: "DEC" });
  } else beginShop(st);
}

/** Run the whole round with no pauses (simulation). timing(st) gives the grade for each timing bar. */
export function playRound(st, timing = () => "miss") {
  startRound(st);
  let guard = 0;
  const r = st.round;
  while (st.phase === "fight" && st.round === r && guard++ < 500) step(st, needsReact(st) ? timing(st) : null);
}
