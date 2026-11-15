// V3 realtime greybox: pure fight logic (no DOM). Positions are on the mat plane (x, z) in metres.
// All numbers come from rules/v3/config.json; no move names are special-cased here.

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeFighter(id, kit, x, cfg) {
  return {
    id, kit, x, z: 0, sta: cfg.stamina.max, ceil: cfg.stamina.max,
    parts: { head: 0, body: 0, legs: 0 }, headPerm: 0, inZone: false,
    act: null, guard: false, dodge: null, stun: 0, slow: 0, slowMult: 1, cds: {},
    dodgeCd: 0, down: false,
    stats: { thrown: 0, landed: 0, blocked: 0, dmg: 0, byMove: {} },
  };
}

export function pickKit(cfg, rand) {
  const o = cfg.opponent;
  const kit = [...o.always];
  const rest = o.pool.filter((m) => !kit.includes(m));
  while (kit.length < o.kitSize && rest.length) kit.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return kit;
}

export function createFight(cfg, { kits, seed = 1 } = {}) {
  const rand = rng(seed);
  const k = kits || [cfg.player.kit, pickKit(cfg, rand)];
  const h = cfg.arena.startDist / 2;
  return {
    cfg, rand, round: 1, clock: cfg.round.seconds * 1000, phase: "fight", winner: null, how: null,
    f: [makeFighter(0, k[0], -h, cfg), makeFighter(1, k[1], h, cfg)],
    events: [], seen: [new Set(), new Set()],
  };
}

export const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
function axis(a, b) {
  const d = dist(a, b) || 1e-6;
  return { dx: (b.x - a.x) / d, dz: (b.z - a.z) / d, d };
}

export const reach = (cfg, f) => Math.max(...f.kit.map((k) => cfg.moves[k].max));
export const isTired = (cfg, f) => f.sta < f.ceil * cfg.stamina.tiredBelow;
const windupOf = (f) => f.act.windup;
function dropCeil(cfg, f, amount) { f.ceil = Math.max(cfg.stamina.ceilMin, f.ceil - amount); f.sta = Math.min(f.sta, f.ceil); }

// Can this fighter start a move right now?
export function canUse(st, f, id) {
  const m = st.cfg.moves[id];
  return !!m && f.kit.includes(id) && !f.act && !f.dodge && f.stun <= 0 && !f.down && !(f.cds[id] > 0) && f.sta >= m.sta;
}

export function inRange(st, f, id) {
  const m = st.cfg.moves[id];
  const o = st.f[1 - f.id];
  const d = dist(f, o);
  return d <= m.max + (m.lunge || 0) && d >= m.min * 0.5;
}

// damage goes to one body part (hidden). Head: part of it heals, part stays. Head hits by a heavy move can drop the target.
function wound(st, t, m, dmg, knockCheck = false) {
  const p = st.cfg.parts, part = m.target;
  t.parts[part] = Math.min(p.max, t.parts[part] + dmg);
  if (part === "head") {
    t.headPerm = Math.min(p.max, t.headPerm + dmg * (1 - p.headSoft));
    if (knockCheck && m.weight >= p.knockWeight) {
      const prob = p.knockK * Math.pow(t.parts.head / p.max, 3) * dmg / p.knockDmgRef;
      if (t.parts.head >= p.max || st.rand() < prob) t.knocked = true;
    }
    if (t.parts.head >= p.max) t.knocked = true;
  } else if (part === "body") dropCeil(st.cfg, t, dmg * p.bodyCeil);
}

function resolveHit(st, a, mId) {
  const cfg = st.cfg, m = cfg.moves[mId], t = st.f[1 - a.id];
  const d = dist(a, t);
  a.stats.thrown++;
  const bm = (a.stats.byMove[mId] ||= { thrown: 0, landed: 0 });
  bm.thrown++;
  st.seen[a.id].add(mId);
  const ev = { by: a.id, target: t.id, move: mId };
  const whiff = () => dropCeil(cfg, a, m.sta * cfg.stamina.ceilPerCost * (cfg.stamina.missMult - 1));
  if (d > m.max) { whiff(); return st.events.push({ ...ev, type: "miss" }); }
  if (t.dodge && t.dodge.t < cfg.dodge.invuln) { whiff(); return st.events.push({ ...ev, type: "dodged" }); }
  let dmg = m.dmg, stunMult = 1;
  if (d < m.min) dmg *= 0.5;
  // landing with the very tip of the range: a graze
  const tip = d > m.min + (m.max - m.min) * cfg.tip.from;
  if (tip) { dmg *= cfg.tip.dmg; stunMult *= cfg.tip.stun; }
  if (isTired(cfg, a)) dmg *= cfg.stamina.tiredDmg;
  if (isTired(cfg, t)) dmg *= cfg.stamina.tiredTaken;
  if (t.guard && !t.act) {
    dmg *= m.block;
    t.sta = Math.max(0, t.sta - m.guardSta);
    wound(st, t, m, dmg); a.stats.dmg += dmg; t.stats.blocked++;
    return st.events.push({ ...ev, type: "block", dmg });
  }
  // a lighter strike can't stop a heavier one already coming: the target eats it and keeps throwing (a trade)
  const tm = t.act && t.act.phase !== "recovery" ? cfg.moves[t.act.move] : null;
  const trade = !!tm && tm.weight > m.weight;
  const counter = !!tm && !trade && t.act.phase === "windup";
  if (counter) dmg *= cfg.counter.dmg;
  wound(st, t, m, dmg, true); a.stats.dmg += dmg; a.stats.landed++; bm.landed++;
  if (m.slow) { t.slow = m.slow.ms; t.slowMult = m.slow.mult; }
  if (!trade) {
    t.act = null; t.guard = false;
    t.stun = m.stun * stunMult * (counter ? cfg.counter.stun : 1);
    const ax = axis(a, t);
    t.x += ax.dx * m.push; t.z += ax.dz * m.push;
  }
  st.events.push({ ...ev, type: "hit", dmg, counter, trade, tip });
}

// input: { fwd: -1..1 (toward opponent), side: -1..1, guard: bool, dodge: bool, atk: moveId|null }
function stepFighter(st, f, inp, dt) {
  const cfg = st.cfg, o = st.f[1 - f.id];
  const ms = dt * 1000;
  for (const k in f.cds) f.cds[k] -= ms;
  f.dodgeCd -= ms;
  if (f.slow > 0) f.slow -= ms; else f.slowMult = 1;
  const ax = axis(f, o);
  const S = cfg.stamina, P = cfg.parts;
  f.inZone = ax.d <= reach(cfg, o) + S.zonePad;
  let regen = f.guard ? S.regenGuard : f.inZone ? S.regenIn : S.regenOut;
  if (f.parts.body > P.bodyHeavy) regen *= P.bodyRegen;
  if (!f.act && !f.dodge) f.sta = Math.min(f.ceil, f.sta + regen * dt);
  // the soft part of head damage heals slowly; faster out of the zone
  if (f.parts.head > f.headPerm) f.parts.head = Math.max(f.headPerm, f.parts.head - (f.inZone ? P.headHealIn : P.headHealOut) * dt);

  if (f.stun > 0) { f.stun -= ms; f.guard = false; return; }

  if (f.act) {
    const m = cfg.moves[f.act.move], wu = windupOf(f);
    const prev = f.act.t;
    f.act.t += ms;
    if (m.lunge && prev < wu) {
      const step = m.lunge * (Math.min(f.act.t, wu) - prev) / wu;
      const room = Math.max(0, ax.d - cfg.arena.minDist);
      const s = Math.min(step, room);
      f.x += ax.dx * s; f.z += ax.dz * s;
    }
    if (f.act.phase === "windup" && f.act.t >= wu) { f.act.phase = "active"; resolveHit(st, f, f.act.move); }
    if (f.act && f.act.phase === "active" && f.act.t >= wu + m.active) f.act.phase = "recovery";
    if (f.act && f.act.t >= wu + m.active + m.recovery) f.act = null;
    f.guard = false;
    return;
  }

  if (f.dodge) {
    f.dodge.t += ms;
    const v = cfg.dodge.dist / (cfg.dodge.ms / 1000);
    f.x += f.dodge.vx * v * dt; f.z += f.dodge.vz * v * dt;
    if (f.dodge.t >= cfg.dodge.ms) f.dodge = null;
    f.guard = false;
    return;
  }

  if (inp.dodge && f.dodgeCd <= 0 && f.sta >= cfg.dodge.sta) {
    let fw = inp.fwd, sd = inp.side;
    if (Math.abs(fw) < 0.2 && Math.abs(sd) < 0.2) fw = -1; // default: step back
    const n = Math.hypot(fw, sd) || 1;
    fw /= n; sd /= n;
    f.dodge = { t: 0, vx: ax.dx * fw + -ax.dz * sd, vz: ax.dz * fw + ax.dx * sd };
    f.sta -= cfg.dodge.sta; f.dodgeCd = cfg.dodge.ms + cfg.dodge.cd;
    st.events.push({ type: "dodge", by: f.id });
    return;
  }

  if (inp.atk && canUse(st, f, inp.atk)) {
    const m = cfg.moves[inp.atk];
    const wu = m.windup * (isTired(cfg, f) ? S.tiredWindup : 1);
    f.act = { move: inp.atk, t: 0, phase: "windup", windup: wu };
    f.sta -= m.sta; dropCeil(cfg, f, m.sta * S.ceilPerCost);
    f.cds[inp.atk] = wu + m.active + m.recovery + m.cd;
    f.guard = false;
    st.events.push({ type: "start", by: f.id, move: inp.atk });
    return;
  }

  f.guard = !!inp.guard;
  const sp = cfg.fighter.speed;
  let fw = Math.max(-1, Math.min(1, inp.fwd || 0)), sd = Math.max(-1, Math.min(1, inp.side || 0));
  const mag = Math.hypot(fw, sd);
  if (mag > 1) { fw /= mag; sd /= mag; }
  const mult = (f.guard ? sp.guard : 1) * f.slowMult * (1 - f.parts.legs / P.max * P.legSlow);
  const vf = fw * (fw > 0 ? sp.forward : sp.back) * mult;
  const vs = sd * sp.side * mult;
  // side = along the left-hand perpendicular (-dz, dx)
  f.x += (ax.dx * vf - ax.dz * vs) * dt;
  f.z += (ax.dz * vf + ax.dx * vs) * dt;
}

function constrain(st) {
  const [a, b] = st.f, cfg = st.cfg;
  // octagon fence: keep inside the inscribed circle of the octagon
  const r = cfg.arena.radius * Math.cos(Math.PI / 8) - 0.35;
  for (let i = 0; i < 4; i++) {
    const ax = axis(a, b);
    if (ax.d < cfg.arena.minDist) {
      const p = (cfg.arena.minDist - ax.d) / 2;
      a.x -= ax.dx * p; a.z -= ax.dz * p; b.x += ax.dx * p; b.z += ax.dz * p;
    }
    for (const f of st.f) {
      const d = Math.hypot(f.x, f.z);
      if (d > r) { f.x *= r / d; f.z *= r / d; }
    }
  }
}

export function step(st, dt, inputs) {
  if (st.phase !== "fight") return;
  const order = st.rand() < 0.5 ? [0, 1] : [1, 0];
  for (const i of order) stepFighter(st, st.f[i], inputs[i] || {}, dt);
  constrain(st);
  for (const f of st.f) {
    if (f.knocked && st.phase === "fight") {
      f.down = true; st.phase = "over"; st.winner = 1 - f.id; st.how = "KO";
      st.events.push({ type: "ko", target: f.id });
    }
  }
  if (st.phase !== "fight") return;
  st.clock -= dt * 1000;
  if (st.clock <= 0) {
    st.clock = 0;
    if (st.round >= st.cfg.round.count) {
      const [a, b] = st.f.map((f) => f.stats.dmg);
      st.phase = "over"; st.how = "判定";
      st.winner = Math.abs(a - b) < 1 ? -1 : a > b ? 0 : 1;
    } else st.phase = "break";
  }
}

export function nextRound(st) {
  const cfg = st.cfg;
  st.round++; st.clock = cfg.round.seconds * 1000; st.phase = "fight";
  const h = cfg.arena.startDist / 2;
  st.f.forEach((f, i) => {
    f.ceil = Math.min(cfg.stamina.max, f.ceil + cfg.stamina.restCeil);
    f.sta = f.ceil;
    f.x = i ? h : -h; f.z = 0;
    f.act = null; f.dodge = null; f.stun = 0; f.slow = 0; f.slowMult = 1; f.cds = {}; f.guard = false;
  });
}
