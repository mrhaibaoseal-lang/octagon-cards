// V3 realtime greybox: pure fight logic (no DOM). Positions are on the mat plane (x, z) in metres.
// All numbers come from rules/v3/config.json; no move names are special-cased here.

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeFighter(id, kit, x, cfg) {
  return {
    id, kit, x, z: 0, hp: cfg.fighter.hp, sta: cfg.fighter.sta,
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

function resolveHit(st, a, mId) {
  const cfg = st.cfg, m = cfg.moves[mId], t = st.f[1 - a.id];
  const d = dist(a, t);
  a.stats.thrown++;
  const bm = (a.stats.byMove[mId] ||= { thrown: 0, landed: 0 });
  bm.thrown++;
  st.seen[a.id].add(mId);
  const ev = { by: a.id, target: t.id, move: mId };
  if (d > m.max) return st.events.push({ ...ev, type: "miss" });
  if (t.dodge && t.dodge.t < cfg.dodge.invuln) return st.events.push({ ...ev, type: "dodged" });
  let dmg = m.dmg, stunMult = 1;
  if (d < m.min) dmg *= 0.5;
  // landing with the very tip of the range: a graze
  const tip = d > m.min + (m.max - m.min) * cfg.tip.from;
  if (tip) { dmg *= cfg.tip.dmg; stunMult *= cfg.tip.stun; }
  if (a.sta < cfg.fighter.tiredBelow) dmg *= cfg.fighter.tiredDmg;
  if (t.guard && !t.act) {
    dmg *= m.block;
    t.sta = Math.max(0, t.sta - m.guardSta);
    t.hp -= dmg; a.stats.dmg += dmg; t.stats.blocked++;
    return st.events.push({ ...ev, type: "block", dmg });
  }
  // a lighter strike can't stop a heavier one already coming: the target eats it and keeps throwing (a trade)
  const tm = t.act && t.act.phase !== "recovery" ? cfg.moves[t.act.move] : null;
  const trade = !!tm && tm.weight > m.weight;
  const counter = !!tm && !trade && t.act.phase === "windup";
  if (counter) dmg *= cfg.counter.dmg;
  t.hp -= dmg; a.stats.dmg += dmg; a.stats.landed++; bm.landed++;
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
  const regen = f.guard ? cfg.fighter.staRegenGuard : cfg.fighter.staRegen;
  if (!f.act && !f.dodge) f.sta = Math.min(cfg.fighter.sta, f.sta + regen * dt);

  if (f.stun > 0) { f.stun -= ms; f.guard = false; return; }

  if (f.act) {
    const m = cfg.moves[f.act.move];
    const prev = f.act.t;
    f.act.t += ms;
    if (m.lunge && prev < m.windup) {
      const step = m.lunge * (Math.min(f.act.t, m.windup) - prev) / m.windup;
      const room = Math.max(0, ax.d - cfg.arena.minDist);
      const s = Math.min(step, room);
      f.x += ax.dx * s; f.z += ax.dz * s;
    }
    if (f.act.phase === "windup" && f.act.t >= m.windup) { f.act.phase = "active"; resolveHit(st, f, f.act.move); }
    if (f.act && f.act.phase === "active" && f.act.t >= m.windup + m.active) f.act.phase = "recovery";
    if (f.act && f.act.t >= m.windup + m.active + m.recovery) f.act = null;
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
    f.act = { move: inp.atk, t: 0, phase: "windup" };
    f.sta -= m.sta; f.cds[inp.atk] = m.windup + m.active + m.recovery + m.cd;
    f.guard = false;
    st.events.push({ type: "start", by: f.id, move: inp.atk });
    return;
  }

  f.guard = !!inp.guard;
  const sp = cfg.fighter.speed;
  let fw = Math.max(-1, Math.min(1, inp.fwd || 0)), sd = Math.max(-1, Math.min(1, inp.side || 0));
  const mag = Math.hypot(fw, sd);
  if (mag > 1) { fw /= mag; sd /= mag; }
  const mult = (f.guard ? sp.guard : 1) * f.slowMult;
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
    if (f.hp <= 0 && st.phase === "fight") {
      f.hp = 0; f.down = true; st.phase = "over"; st.winner = 1 - f.id; st.how = "KO";
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
    f.hp = Math.min(cfg.fighter.hp, f.hp + cfg.round.healBetween);
    f.sta = cfg.round.staBetween;
    f.x = i ? h : -h; f.z = 0;
    f.act = null; f.dodge = null; f.stun = 0; f.slow = 0; f.slowMult = 1; f.cds = {}; f.guard = false;
  });
}
