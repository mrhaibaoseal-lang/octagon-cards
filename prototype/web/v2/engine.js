// Octagon Cards V2 — "solve the exchange" bout engine (docs/REDESIGN_V2.md, step 1).
// Pure rules: no DOM, no clock. The browser and the simulation use this same file.
// All numbers and card properties come from rules/v2/*.json; the engine never compares card names.
//
// Side "b" leads: before each exchange it commits an INTENT (a list of cards / basic moves).
// Side "a" answers: it sees as much of that intent as its read level allows, then plays any number of
// cards with its energy; each resolves at once. Then b's intent runs. Defence steps in b's intent are
// already standing while a plays (so a's strikes can be guarded, slipped, checked or sprawled on).
// 3 rounds x 5 exchanges. Energy is per exchange; gas is the whole-fight tank.

export const other = (s) => (s === "a" ? "b" : "a");
export const SIDES = ["a", "b"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;

export function rand(st) {
  const a = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Put ids and defaults onto the card and basic-move tables. Call once after loading the JSON. */
export function prepare(data) {
  const fill = (id, c, basic) => {
    c.id = id;
    c.kind = c.kind || "strike";
    c.scene = c.scene || "stand";
    c.cost = c.cost ?? 1;
    c.basic = basic;
  };
  for (const [id, c] of Object.entries(data.cards)) if (!id.startsWith("_")) fill(id, c, false);
  for (const [id, c] of Object.entries(data.config.basics)) fill(id, c, true);
  return data;
}

export const defOf = (st, id) => st.data.cards[id] || st.cfg.basics[id];

function shuffle(st, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(st) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const setDef = (F, d) => { F.def[d.def] = d; if (d.def === "guard") F.block = d.blocks ?? 99; };
const newSeq = () => ({ setup: false, last: null, cleans: 0, struggle: 0 });

export function createBout(data, aId, bId, seed = 1) {
  const st = { data, cfg: data.config, rng: (seed >>> 0) || 1, round: 1, ex: 1, tick: 0, turn: "a", range: 0, pos: 0, ground: null, phase: "play", over: null, log: [], intent: null, rounds: [], groundTicks: 0 };
  for (const [s, id] of [["a", aId], ["b", bId]]) {
    const f = data.fighters[id];
    st[s] = {
      id, f, gas: f.gas, gasMax: f.gas, chin: f.chin, stun: 0, bodyDmg: 0, bodyLoss: 0, legDmg: 0,
      energy: 0, throttled: 0, draw: shuffle(st, [...f.deck]), discard: [], hand: [], readPts: 0,
      rocked: null, openUntil: -1, def: {}, seq: newSeq(), score: 0, dealtEx: 0,
      hist: { head: 0, body: 0, legs: 0, td: 0, def: 0, n: 0 },
      stats: { dmg: 0, td: 0, tdTry: 0, rocked: 0, clean: 0, landed: 0 },
    };
  }
  beginExchange(st);
  return st;
}

// ---------- queries ----------
export const legStacks = (st, s) => Math.floor(st[s].legDmg / st.cfg.legs.perStack);
export const lowGas = (st, s) => st[s].gas <= st[s].f.gas * st.cfg.lowGasFrac;
export const onCage = (st, s) => (s === "a" ? st.pos <= -2 : st.pos >= 2);
export const scene = (st, s) => (!st.ground ? "stand" : st.ground.top === s ? "top" : "bottom");
export const isOpen = (st, s) => st[s].openUntil >= st.tick;
export function readLevel(st, s) {
  const lv = st.cfg.read.levels;
  let n = 0;
  for (let i = 0; i < lv.length; i++) if (st[s].readPts >= lv[i]) n = i;
  return n;
}
export const cost = (st, s, d) => d.cost + (d.kind === "move" && legStacks(st, s) >= st.cfg.legs.moveStacks ? 1 : 0);
const powerMul = (st, s) => (legStacks(st, s) >= st.cfg.legs.powerStacks ? st.cfg.legs.power : 1);

/** Can side s do d right now (ignoring energy)? why: scene | range | cage | done */
export function usable(st, s, d) {
  if (d.scene !== scene(st, s)) return { ok: false, why: "scene" };
  if (d.range && !d.range.includes(st.range)) return { ok: false, why: "range" };
  if (d.kind === "move") {
    const o = other(s);
    if (d.move === "advance" && st.range >= 1 && onCage(st, o)) return { ok: false, why: "cage" };
    if (d.move === "retreat" && (st.range === 0 || onCage(st, s))) return { ok: false, why: st.range === 0 ? "range" : "cage" };
    if (d.move === "circle" && !(s === "a" ? st.pos < 0 : st.pos > 0)) return { ok: false, why: "cage" };
  }
  if (d.kind === "defence" && st[s].def[d.def]) return { ok: false, why: "done" };
  if (d.kind === "control" && st[s].def.control) return { ok: false, why: "done" };
  return { ok: true };
}

export function cleanChance(st, s, d) {
  const h = st.cfg.hit, A = st[s], o = other(s), D = st[o];
  let p = d.clean + (A.f.skill?.[d.id] || 0);
  if (A.seq.setup) p += h.setup;
  if (A.seq.last && A.seq.last !== d.region) p += h.levelChange;
  if (isOpen(st, o)) p += h.open;
  if (D.rocked) p += h.rocked;
  if (lowGas(st, s)) p += h.tired;
  if (!st.ground && onCage(st, o)) p += h.cage;
  return clamp(p, h.min, h.max);
}
export function koChance(st, s, d) {
  const A = st[s], D = st[other(s)];
  if (!d.ko) return 0;
  return clamp(d.ko * A.f.power * (1 + st.cfg.ko.stunScale * Math.min(1, D.stun / D.chin)) * (D.rocked ? st.cfg.rock.koMul : 1), 0, 0.95);
}
export function tdChance(st, s, d) {
  const t = st.cfg.td, A = st[s], o = other(s), D = st[o];
  let p = t.base + A.f.wrestle + (A.f.skill?.[d.id] || 0) - D.f.tdDef;
  if (A.seq.setup) p += t.setup;
  if (onCage(st, o)) p += t.cage;
  if (st.range === 2) p += t.clinch;
  if (lowGas(st, o)) p += t.tired;
  if (D.rocked) p += t.rocked;
  p += legStacks(st, o) * st.cfg.legs.td;
  return clamp(p, t.min, t.max);
}
export function escChance(st, s, d) {
  const g = st.cfg.ground, A = st[s], D = st[other(s)];
  let p = g.escape + A.f.escape + (d.bonus || 0) + (D.def.control ? g.control : 0) + (st.ground ? st.ground.pass * g.pass : 0) + A.seq.struggle * g.struggle;
  if (lowGas(st, s)) p += g.tired;
  return clamp(p, g.min, g.max);
}

/** Numbers to print on a card. know = the viewer may see the defender's prepared defences. */
export function preview(st, s, d, know = false) {
  const A = st[s], D = st[other(s)], u = usable(st, s, d);
  const out = { ok: u.ok, why: u.why, cost: cost(st, s, d) };
  if (d.kind === "strike") {
    let clean = cleanChance(st, s, d), mul = 1;
    if (know && D.def.guard && st.cfg.guard[d.region] < 1) { mul = st.cfg.guard[d.region]; if (d.region === "head") clean = 0; out.blocked = "guard"; out.block = D.block; }
    if (know && D.def.slip && d.region === "head" && d.punch) out.blocked = "slip";
    if (know && D.def.check && d.region === "legs") out.blocked = "check";
    out.clean = clean;
    out.dmg = r1(d.dmg * A.f.power * mul * powerMul(st, s));
    out.hits = d.hits || 1;
    out.ko = koChance(st, s, d);
    out.up = A.seq.setup || (!!A.seq.last && A.seq.last !== d.region) || isOpen(st, other(s)) || !!D.rocked;
  }
  if (d.kind === "takedown") out.p = know && D.def.sprawl ? 0 : tdChance(st, s, d);
  if (d.kind === "escape") out.p = escChance(st, s, d);
  return out;
}

// ---------- log ----------
const snap = (st) => {
  const one = (F) => ({ stun: r1(F.stun), chin: F.chin, gas: F.gas, gasMax: F.gasMax, body: r1(F.bodyDmg), legs: r1(F.legDmg), rocked: !!F.rocked, score: r1(F.score), energy: F.energy });
  return { a: one(st.a), b: one(st.b), range: st.range, pos: st.pos, ground: st.ground ? st.ground.top : null };
};
function ev(st, t, o = {}) { st.log.push({ t, round: st.round, ex: st.ex, ...o, snap: snap(st) }); }

const addScore = (st, s, x) => { st[s].score += x * (st.ex === st.cfg.exchanges ? st.cfg.score.lastMul : 1); };
const addRead = (st, s, x) => { st[s].readPts += x * (st[s].f.readRate || 1); };
function setOpen(st, s) {
  st[s].openUntil = s === "b" && st.turn === "b" ? st.tick + 1 : st.tick;
  ev(st, "open", { s });
}
function finish(st, winner, how) {
  if (st.over) return;
  st.over = { winner, how, round: st.round, ex: st.ex };
  st.phase = "over";
  ev(st, "over", { s: winner, how });
}
function cancelIntent(st) {
  if (st.intent && !st.intent.cancelled) { st.intent.cancelled = true; st.b.def = {}; }
}

// ---------- flow ----------
function drawTo(st, s) {
  const F = st[s];
  while (F.hand.length < st.cfg.handSize) {
    if (!F.draw.length) { if (!F.discard.length) break; F.draw = shuffle(st, F.discard); F.discard = []; }
    F.hand.push(F.draw.pop());
  }
}

export function beginExchange(st) {
  const cfg = st.cfg;
  st.intent = null;
  st.turn = "a";
  for (const s of SIDES) {
    const F = st[s], O = st[other(s)];
    F.energy = F.rocked ? cfg.rock.energy : lowGas(st, s) ? cfg.lowGasEnergy : cfg.energy;
    if (O.rocked && !F.rocked) F.energy += cfg.rock.chase;
    if (s === "b") F.energy += cfg.leadEnergy || 0; // the leader shows his hand first, so he gets more to work with
    F.throttled = 0; F.def = {}; F.seq = newSeq(); F.dealtEx = 0;
    drawTo(st, s);
  }
  st.phase = "play";
}

/** b commits its intent: { cat, steps:[{id}], cats:{cat:share}, focus, throttle, habits, forced }. */
export function setIntent(st, intent) {
  const B = st.b, cfg = st.cfg;
  st.intent = intent;
  const n = intent.throttle || 0;
  B.gas = Math.max(0, B.gas - n * cfg.throttle.gas);
  B.energy += n * cfg.throttle.energy;
  B.throttled = n;
  let total = 0;
  for (const step of intent.steps) {
    const d = defOf(st, step.id);
    total += cost(st, "b", d);
    if (d.kind === "defence") { setDef(B, d); step.pre = true; }
    if (d.kind === "control") { B.def.control = true; step.held = true; }
  }
  B.energy = Math.max(0, B.energy - total);
}

/** What side a is allowed to know about b's intent at its read level. */
export function visibleIntent(st) {
  const it = st.intent;
  if (!it) return null;
  const level = readLevel(st, "a");
  const out = { level, cats: it.cats, cancelled: !!it.cancelled, forced: !!it.forced };
  if (level >= 1 || it.forced) {
    out.cat = it.cat;
    out.focus = it.focus || null;
    const ds = it.steps.map((x) => defOf(st, x.id));
    out.advance = ds.some((d) => d.kind === "move" && d.move === "advance");
    out.hasDef = ds.some((d) => d.kind === "defence" || d.kind === "control");
  }
  if (level >= 2) { out.steps = it.steps.map((x) => x.id); out.habits = it.habits || []; out.throttle = it.throttle || 0; }
  return out;
}

export function canThrottle(st, s = "a") {
  const t = st.cfg.throttle;
  return st[s].throttled < t.max && st[s].gas >= t.gas;
}

/** Everything side a may do right now. */
export function legal(st) {
  const out = [];
  if (st.over || st.phase !== "play") return out;
  const A = st.a;
  A.hand.forEach((id, i) => {
    const d = defOf(st, id);
    if (usable(st, "a", d).ok) { if (cost(st, "a", d) <= A.energy) out.push({ type: "card", i, d }); }
    else if (scene(st, "a") === "bottom" && A.seq.struggle < st.cfg.ground.struggleMax) out.push({ type: "struggle", i, d });
  });
  for (const d of Object.values(st.cfg.basics)) if (usable(st, "a", d).ok && cost(st, "a", d) <= A.energy) out.push({ type: "basic", id: d.id, d });
  if (canThrottle(st)) out.push({ type: "throttle" });
  return out;
}

/** Side a plays one thing. action: {type:"card",i} | {type:"basic",id} | {type:"throttle"} | {type:"struggle",i} */
export function act(st, action) {
  if (st.over || st.phase !== "play") return false;
  const A = st.a, cfg = st.cfg;
  if (action.type === "throttle") {
    if (!canThrottle(st)) return false;
    A.gas -= cfg.throttle.gas; A.energy += cfg.throttle.energy; A.throttled++;
    ev(st, "throttle", { s: "a" });
    return true;
  }
  if (action.type === "struggle") {
    const id = A.hand[action.i];
    if (!id || scene(st, "a") !== "bottom" || usable(st, "a", defOf(st, id)).ok || A.seq.struggle >= cfg.ground.struggleMax) return false;
    A.discard.push(A.hand.splice(action.i, 1)[0]);
    A.seq.struggle++;
    ev(st, "struggle", { s: "a", id });
    return true;
  }
  const d = action.type === "card" ? defOf(st, A.hand[action.i]) : cfg.basics[action.id];
  if (!d) return false;
  if (!usable(st, "a", d).ok) return false;
  const c = cost(st, "a", d);
  if (c > A.energy) return false;
  A.energy -= c;
  if (action.type === "card") A.discard.push(A.hand.splice(action.i, 1)[0]);
  perform(st, "a", d);
  return true;
}

function perform(st, s, d) {
  const cfg = st.cfg, A = st[s], o = other(s), D = st[o];
  A.hist.n++;
  switch (d.kind) {
    case "strike":
      A.hist[d.region]++;
      for (let i = 0; i < (d.hits || 1) && !st.over; i++) strikeOnce(st, s, d);
      break;
    case "feint": {
      A.seq.setup = true;
      const bit = (d.baits || []).filter((k) => D.def[k]);
      addRead(st, s, cfg.read.setup);
      ev(st, "feint", { s, id: d.id, bit });
      for (const k of bit) { delete D.def[k]; if (k === "sprawl") setOpen(st, o); }
      break;
    }
    case "defence":
      setDef(A, d); A.hist.def++;
      ev(st, "defence", { s, id: d.id });
      break;
    case "move": {
      const dir = s === "a" ? 1 : -1;
      if (d.move === "advance") { if (st.range === 0) st.range = 1; st.pos = clamp(st.pos + dir, -2, 2); addScore(st, s, cfg.score.advance); }
      if (d.move === "retreat") { st.range = Math.max(0, st.range - 1); st.pos = clamp(st.pos - dir, -2, 2); addScore(st, s, cfg.score.retreat); }
      if (d.move === "circle") st.pos = clamp(st.pos + dir, -2, 2);
      if (d.move === "clinch") st.range = 2;
      ev(st, "move", { s, id: d.id });
      break;
    }
    case "takedown": takedown(st, s, d); break;
    case "control":
      A.def.control = true;
      addScore(st, s, cfg.score.control);
      D.gas = Math.max(0, D.gas - 1);
      ev(st, "control", { s, id: d.id });
      break;
    case "pass":
      if (st.ground) st.ground.pass++;
      ev(st, "pass", { s, id: d.id });
      break;
    case "escape": {
      const p = escChance(st, s, d), ok = rand(st) < p;
      if (ok) { st.ground = null; st.range = 1; if (s === "a") cancelIntent(st); }
      ev(st, "escape", { s, id: d.id, ok, p });
      break;
    }
    case "standup":
      st.ground = null; st.range = 1;
      if (s === "a") cancelIntent(st);
      ev(st, "standup", { s, id: d.id });
      break;
  }
}

function strikeOnce(st, s, d) {
  const cfg = st.cfg, A = st[s], o = other(s), D = st[o];
  if (d.region === "head" && d.punch && D.def.slip) {
    const c = D.def.slip;
    delete D.def.slip;
    A.seq.setup = false; A.seq.last = d.region;
    addRead(st, o, cfg.read.defence);
    ev(st, "slip", { s: o, id: d.id, by: c.id });
    damage(st, o, "head", c.counter * D.f.power, true, c);
    return;
  }
  if (d.region === "legs" && D.def.check) {
    const c = D.def.check;
    delete D.def.check;
    A.seq.setup = false; A.seq.last = d.region;
    A.legDmg += c.back;
    addRead(st, o, cfg.read.defence);
    ev(st, "check", { s: o, id: d.id, by: c.id });
    return;
  }
  const bonus = A.seq.setup || (!!A.seq.last && A.seq.last !== d.region) || isOpen(st, o) || !!D.rocked;
  const sure = isOpen(st, o) || !!D.rocked || !!st.ground;
  if (!sure && rand(st) < cfg.hit.miss) {
    A.seq.setup = false; A.seq.last = d.region;
    ev(st, "miss", { s, id: d.id });
    if (d.finisher && !bonus) setOpen(st, s);
    return;
  }
  let clean = rand(st) < cleanChance(st, s, d), mul = 1;
  const guard = !!D.def.guard && cfg.guard[d.region] < 1;
  if (guard) {
    mul = cfg.guard[d.region];
    if (d.region === "head") clean = false;
    if (--D.block <= 0) delete D.def.guard; // a guard only soaks up so many shots
  }
  const dmg = r1(d.dmg * A.f.power * (clean ? 1 : cfg.hit.graze) * mul * powerMul(st, s));
  A.seq.setup = !!d.setup; A.seq.last = d.region;
  A.stats.landed++;
  if (clean) { A.seq.cleans++; A.stats.clean++; }
  if (d.setup) addRead(st, s, cfg.read.setup);
  ev(st, "hit", { s, id: d.id, region: d.region, dmg, clean, guard });
  damage(st, s, d.region, dmg, clean, d);
  if (st.over) return;
  const t = A.f.trait;
  if (clean && t && t.type === "thirdClean" && A.seq.cleans === t.n) { ev(st, "trait", { s }); addStun(st, o, t.stun); }
  if (d.finisher && !clean && !bonus) setOpen(st, s);
  if (d.push && !st.ground) st.range = 0;
}

function damage(st, s, region, dmg, clean, d) {
  const cfg = st.cfg, A = st[s], o = other(s), D = st[o];
  A.dealtEx += dmg; A.stats.dmg += dmg;
  addScore(st, s, dmg * cfg.score.perDmg * (clean ? 1 : cfg.score.grazeMul));
  if (D.rocked) { D.rocked.hp -= dmg; if (D.rocked.hp <= 0) return finish(st, s, "TKO"); }
  if (region === "head") {
    if (clean && d.ko && rand(st) < koChance(st, s, d)) return finish(st, s, "KO");
    addStun(st, o, dmg);
  } else if (region === "body") {
    D.bodyDmg += dmg;
    const loss = Math.floor(D.bodyDmg / cfg.body.perGas) - D.bodyLoss;
    if (loss > 0) { D.bodyLoss += loss; D.gasMax = Math.max(4, D.gasMax - loss); D.gas = Math.max(0, Math.min(D.gas - loss, D.gasMax)); }
  } else D.legDmg += dmg;
}

function addStun(st, o, x) {
  const D = st[o];
  D.stun += x;
  if (!D.rocked && D.stun >= D.chin) {
    D.rocked = { hp: st.cfg.rock.hp, clearAt: st.tick + 1 };
    st[other(o)].stats.rocked++;
    addScore(st, other(o), st.cfg.score.rocked);
    if (o === "b") cancelIntent(st);
    ev(st, "rocked", { s: o });
  }
}

function takedown(st, s, d) {
  const cfg = st.cfg, A = st[s], o = other(s), D = st[o];
  A.hist.td++; A.stats.tdTry++;
  A.gas = Math.max(0, A.gas - (d.gas || 0));
  if (D.def.sprawl) {
    delete D.def.sprawl;
    A.gas = Math.max(0, A.gas - cfg.td.sprawlGas);
    addScore(st, o, cfg.score.sprawl);
    addRead(st, o, cfg.read.defence);
    ev(st, "sprawl", { s: o, id: d.id });
    setOpen(st, s);
    return;
  }
  const p = tdChance(st, s, d), ok = rand(st) < p;
  if (ok) {
    st.ground = { top: s, stall: 0, pass: 0 };
    A.stats.td++;
    addScore(st, s, cfg.score.takedown);
    if (s === "a") cancelIntent(st);
  } else A.gas = Math.max(0, A.gas - cfg.td.failGas);
  ev(st, "takedown", { s, id: d.id, ok, p });
}

/** Side a is done: b's intent runs, then gas, read, stall, round bookkeeping. */
export function endExchange(st) {
  if (st.over || st.phase !== "play") return;
  const cfg = st.cfg, it = st.intent, B = st.b;
  st.turn = "b";
  if (it) {
    if (it.cancelled) ev(st, "cancelled", { s: "b" });
    for (const step of it.steps) {
      if (st.over || it.cancelled) break;
      if (step.pre) continue;
      const d = defOf(st, step.id), before = st.ground;
      if (step.held) delete B.def.control; // it was standing while a played; now it scores
      if (!usable(st, "b", d).ok) {
        if (d.kind === "strike" || d.kind === "takedown") {
          B.gas = Math.max(0, B.gas - 1);
          ev(st, "whiff", { s: "b", id: d.id });
          if (d.finisher) setOpen(st, "b");
        }
        continue;
      }
      perform(st, "b", d);
      if (st.ground !== before) break; // the scene changed: the rest of the plan no longer applies
    }
  }
  if (st.over) return;
  if (st.ground) st.groundTicks++;
  for (const s of SIDES) {
    const F = st[s], O = st[other(s)];
    let ch = F.energy > 0 ? F.energy : F.f.trait?.type === "bigTank" ? 0 : -cfg.gasFullCost;
    if (st.ground && st.ground.top !== s) ch -= cfg.ground.bottomGas + (O.f.trait?.type === "topDrain" ? O.f.trait.gas : 0);
    F.gas = clamp(F.gas + ch, 0, F.gasMax);
    if (F.rocked) { if (st.tick >= F.rocked.clearAt) recover(st, s); }
    else F.stun = Math.max(0, F.stun - cfg.stunDecay);
    addRead(st, s, cfg.read.perExchange);
    F.discard.push(...F.hand); F.hand = [];
  }
  if (st.ground) {
    if (st[st.ground.top].dealtEx <= 0) st.ground.stall++; else st.ground.stall = 0;
    if (st.ground.stall >= cfg.ground.stall) { st.ground = null; st.range = 1; ev(st, "refstand", {}); }
  }
  st.tick++;
  if (st.ex >= cfg.exchanges) endRound(st);
  else { st.ex++; beginExchange(st); }
}

function recover(st, s) {
  const F = st[s];
  F.rocked = null;
  F.chin = Math.max(8, F.chin - st.cfg.rock.chinLoss);
  F.stun = r1(F.chin * st.cfg.rock.after);
  ev(st, "recover", { s });
}

function endRound(st) {
  const cfg = st.cfg, d = st.a.score - st.b.score;
  const big = Math.abs(d) >= cfg.score.big;
  const card = d > 0.001 ? { a: 10, b: big ? 8 : 9 } : d < -0.001 ? { a: big ? 8 : 9, b: 10 } : { a: 10, b: 10 };
  card.pts = { a: r1(st.a.score), b: r1(st.b.score) };
  st.rounds.push(card);
  for (const s of SIDES) { if (st[s].rocked) recover(st, s); st[s].score = 0; }
  st.ground = null; st.range = 0; st.pos = 0; st.intent = null;
  ev(st, "roundend", { card });
  if (st.round >= cfg.rounds) {
    const ta = st.rounds.reduce((n, c) => n + c.a, 0), tb = st.rounds.reduce((n, c) => n + c.b, 0);
    st.over = { winner: ta > tb ? "a" : tb > ta ? "b" : null, how: "DEC", round: st.round, ex: st.ex, total: { a: ta, b: tb } };
    st.phase = "over";
    ev(st, "over", { s: st.over.winner, how: "DEC" });
  } else st.phase = "corner";
}

/** Between rounds: each side picks one corner option, then the next round starts. */
export function corner(st, pickA, pickB) {
  if (st.phase !== "corner") return false;
  const c = st.cfg.corner;
  for (const [s, pick] of [["a", pickA], ["b", pickB]]) {
    const F = st[s], o = c.options[pick] || {};
    F.gas = clamp(F.gas + c.base.gas + (o.gas || 0), 0, F.gasMax);
    F.stun = Math.max(0, F.stun - c.base.stun - (o.stun || 0));
    if (o.read) addRead(st, s, o.read);
  }
  st.round++; st.ex = 1;
  ev(st, "corner", { a: pickA, b: pickB });
  beginExchange(st);
  return true;
}
