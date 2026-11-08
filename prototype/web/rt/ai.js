// Real-time opponent AI. It only produces button inputs for its seat, the same inputs a player gives, and runs on the same engine.
// It sees the other fighter with a reaction delay, cannot tell a feint from a real cross, and slowly learns what the other side keeps doing.

import { gap, looksLike, strikeIds, other } from "./engine.js";

const FOLLOW = { jab: ["cross", "jab", "hook", "body"], cross: ["hook", "body", "lowkick"], body: ["hook", "headkick"], hook: ["cross", "body"], lowkick: ["jab", "cross"], headkick: [] };

export function createAI(data, side, rng, overrides = {}) {
  const ids = strikeIds(data);
  const mem = {
    seen: [], // opponent's look per tick
    lastReact: -1, // tick (in the opponent's timeline) of the action already answered
    guardUntil: -1,
    backUntil: -1,
    walk: 0,
    walkUntil: -1,
    nextThink: 0,
    habit: Object.fromEntries(ids.map((k) => [k, 0])),
    oppGuard: 0,
    lastOppAct: "idle",
  };

  function prof(st) {
    return { ...data.fighters[st[side].id].ai, ...overrides };
  }

  /** How much the other fighter leans on one strike (0..1), learned from what was seen. */
  function share(id) {
    const total = Object.values(mem.habit).reduce((x, y) => x + y, 0);
    return total > 2 ? mem.habit[id] / total : 0;
  }

  function pick(weights) {
    const list = Object.entries(weights).filter(([, w]) => w > 0);
    const sum = list.reduce((x, [, w]) => x + w, 0);
    if (!sum) return null;
    let r = rng() * sum;
    for (const [k, w] of list) if ((r -= w) <= 0) return k;
    return list[list.length - 1][0];
  }

  function chooseStrike(st, P, d) {
    const me = st[side];
    const guardRate = Math.min(1, mem.oppGuard);
    const w = {};
    for (const id of ids) {
      const m = data.moves[id];
      if (d > m.reach - 4) continue;
      if (me.stamina < m.cost && id !== "jab") continue;
      let base = { jab: 3, cross: 2, hook: 1.4, body: 1.6 * P.body * 2, lowkick: 1.4 * P.body * 2, headkick: 0.35 }[id] ?? 1;
      // Against a fighter who keeps his hands up, go to the body and legs (and look for the high kick after).
      if (m.at !== "head") base *= 1 + 2 * guardRate * P.adapt;
      else if (m.kind === "punch") base *= 1 - 0.6 * guardRate * P.adapt;
      w[id] = base;
    }
    return pick(w);
  }

  return function think(st) {
    const P = prof(st);
    const me = st[side];
    const op = st[other(side)];
    const now = st.tick;
    const look = looksLike(st, op);
    mem.seen.push(look);
    if (mem.seen.length > 64) mem.seen.shift();
    const seenNow = mem.seen[Math.max(0, mem.seen.length - 1 - P.reaction)] || look;
    // Learn: count each new strike the other fighter starts, and how often he sits behind his guard.
    if (look.act === "strike" && mem.lastOppAct !== "strike") {
      for (const k of ids) mem.habit[k] *= 0.97;
      mem.habit[look.move] = (mem.habit[look.move] || 0) + 1;
    }
    mem.lastOppAct = look.act;
    mem.oppGuard = mem.oppGuard * 0.995 + (op.guard ? 0.005 : 0);

    const d = gap(st);
    const input = { move: 0, guard: false, press: null };

    // Busy: maybe queue the next strike of a combo when this one lands.
    if (me.act === "strike") {
      const m = data.moves[me.move];
      const left = me.len - me.t;
      if (me.landed && left <= 6 && left > 4 && rng() < P.combo * 0.5) {
        const next = (FOLLOW[me.move] || []).filter((id) => data.moves[id].reach >= d && me.stamina >= data.moves[id].cost);
        if (next.length) input.press = next[Math.floor(rng() * next.length)];
      }
      return input;
    }
    if (me.act !== "idle") return input;

    // A slip that worked: answer right away.
    if (me.counterUntil >= now) {
      input.press = d <= data.moves.hook.reach ? "hook" : "cross";
      return input;
    }

    // React to what was seen `reaction` ticks ago: a strike winding up in range.
    if (seenNow.act === "strike" && seenNow.phase === "startup" && mem.lastReact !== seenNow.move + ":" + Math.floor(now / 20)) {
      const m = data.moves[seenNow.move];
      mem.lastReact = seenNow.move + ":" + Math.floor(now / 20);
      if (d <= m.reach + 25 && rng() < 0.45 + 0.5 * P.bait) {
        const habit = share(seenNow.move) * P.adapt;
        if (m.kind === "punch" && m.at === "head") {
          const r = rng();
          if (r < P.counter + habit) input.press = "slip";
          else if (r < P.counter + habit + P.guard) mem.guardUntil = now + 24;
        } else if (m.at === "head") {
          if (rng() < P.guard + habit) mem.guardUntil = now + 30;
          else mem.backUntil = now + 14;
        } else if (rng() < 0.4 + habit) mem.backUntil = now + 14;
      }
    }
    if (input.press) return input;

    // Punish a whiff or a slow recovery.
    if (look.act === "strike" && look.phase === "recovery" && d <= data.moves.cross.reach && rng() < 0.25 + P.aggression * 0.5) {
      input.press = d <= data.moves.hook.reach && me.stamina >= data.moves.hook.cost ? "hook" : "cross";
      return input;
    }
    if (op.act === "stun" && d <= data.moves.cross.reach && rng() < P.aggression * 0.3) {
      input.press = chooseStrike(st, P, d);
      if (input.press) return input;
    }

    if (now <= mem.guardUntil) input.guard = true;
    if (now <= mem.backUntil) {
      input.move = -1;
      return input;
    }

    // Neutral: walk to the preferred range, sometimes throw.
    if (now >= mem.nextThink) {
      mem.nextThink = now + 6 + Math.floor(rng() * 8);
      const tired = me.stamina < 25;
      const want = P.range + (tired ? 40 : 0);
      if (d > want + 18) mem.walk = 1;
      else if (d < want - 22) mem.walk = -1;
      else mem.walk = rng() < 0.3 ? (rng() < 0.5 ? 1 : -1) : 0;
      mem.walkUntil = now + 8 + Math.floor(rng() * 10);
      // In range and not throwing: keep the hands up some of the time (how often is the fighter's guard habit).
      mem.holdGuard = d < want + 50 && rng() < P.guard * 1.6;
      const aggr = P.aggression * (tired ? 0.35 : 1);
      if (rng() < aggr * 0.16) {
        const s = rng() < 0.08 * (1 - P.counter) ? "feint" : chooseStrike(st, P, d);
        if (s) input.press = s;
      }
    }
    if (now <= mem.walkUntil) input.move = mem.walk;
    if (mem.holdGuard && !input.press) input.guard = true;
    return input;
  };
}

/** A button masher: random buttons at random times, random walking. For checking that skill beats mashing. */
export function createMasher(data, rng, rate = 0.06) {
  const ids = strikeIds(data);
  let walk = 0;
  let until = 0;
  return function think(st) {
    if (st.tick >= until) {
      walk = Math.floor(rng() * 3) - 1;
      until = st.tick + 10 + Math.floor(rng() * 30);
    }
    const input = { move: walk, guard: rng() < 0.15, press: null };
    if (rng() < rate) {
      const r = rng();
      input.press = r < 0.1 ? "slip" : r < 0.15 ? "feint" : ids[Math.floor(rng() * ids.length)];
    }
    return input;
  };
}
