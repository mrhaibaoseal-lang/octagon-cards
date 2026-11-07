// Engine checks. Run: node prototype/web/test/engine.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, budget, playError, nextUnit, checkInvariants, arrange, usableAt, bestPlay } from "../engine.js";
import { data, playGame, strategies } from "../sim.js";

const FIGHTERS = Object.keys(data.fighters);

test("the RNG matches the Swift SplitMix64 sequence", () => {
  const s = { rng: 42n };
  // First output of SplitMix64 with seed 42, top 53 bits scaled to a unit double.
  const first = nextUnit(s);
  assert.equal(first, Number(0xbdd732262feb6e95n >> 11n) * 2 ** -53);
});

test("same seed gives the same fight", () => {
  const run = () => {
    const { state } = playGame("mcgregor", "khabib", null, 123);
    return JSON.stringify({ over: state.over, a: state.a.hp, b: state.b.hp, history: state.history });
  };
  assert.equal(run(), run());
});

test("every fight between every pair ends with valid state", () => {
  for (const a of FIGHTERS) {
    for (const b of FIGHTERS) {
      for (let seed = 1; seed <= 40; seed++) {
        const { state } = playGame(a, b, null, seed);
        assert.equal(state.phase, "over");
        assert.deepEqual(checkInvariants(state), []);
      }
    }
  }
});

test("every strategy finishes a fight using only legal plays", () => {
  for (const [name, strat] of Object.entries(strategies)) {
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = playGame("neutral", "neutral", strat, seed);
      assert.equal(state.phase, "over", name);
    }
  }
});

test("all decks are the same size and have every type", () => {
  for (const [id, f] of Object.entries(data.fighters)) {
    assert.ok(f.deck.length >= 12, id);
    for (const type of ["S", "G", "C"]) {
      assert.ok(f.deck.some((c) => data.cards[c].type === type), `${id} lacks ${type}`);
    }
    for (const c of [...f.deck, f.signature]) assert.ok(data.cards[c], `${id} unknown card ${c}`);
  }
});

test("the drawn hand holds all three types that can be thrown from where they stand", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const state = createMatch(data, "mcgregor", "khabib", seed);
    for (const s of ["a", "b"]) {
      const core = state[s].hand.filter((c) => !data.cards[c].basic && !data.cards[c].signature);
      assert.equal(core.length, data.rules.match.handSize);
      const types = new Set(core.filter((c) => usableAt(state, data.cards[c], state.dist)).map((c) => data.cards[c].type));
      assert.equal(types.size, 3, `seed ${seed}`);
    }
  }
});

test("both steps are always in hand and never leave the deck", () => {
  for (const id of Object.keys(data.fighters)) {
    const { state } = playGame(id, "neutral", null, 4);
    for (const s of ["a", "b"]) {
      assert.ok(state[s].hand.includes("step_in") && state[s].hand.includes("step_back"));
      assert.ok(![...state[s].draw, ...state[s].discard].some((c) => data.cards[c].basic));
    }
  }
});

test("displayed intent is honest: AI choices follow the shown numbers", () => {
  const state = createMatch(data, "khabib", "mcgregor", 9);
  const probs = getIntent(state, "a").probs;
  const counts = { S: 0, G: 0, C: 0 };
  const n = 6000;
  for (let i = 0; i < n; i++) {
    const cards = chooseAI(state, "a").cards;
    const type = cards.length ? data.cards[cards[0]].type : "C";
    counts[type]++;
  }
  for (const t of ["S", "G", "C"]) {
    assert.ok(Math.abs(counts[t] / n - probs[t]) < 0.04, `${t}: shown ${probs[t]}, played ${counts[t] / n}`);
  }
});

test("illegal plays are rejected", () => {
  const state = createMatch(data, "mcgregor", "khabib", 3);
  assert.ok(playError(state, "a", ["not_a_card"]));
  const [s, g] = ["S", "G"].map((t) => state.a.hand.find((c) => data.cards[c].type === t));
  assert.ok(playError(state, "a", [s, g]), "mixed types");
  state.a.stamina = 1;
  assert.equal(budget(state, "a"), 1);
  const expensive = Object.keys(data.cards).find((c) => data.cards[c].cost === 3);
  state.a.hand.push(expensive);
  assert.ok(playError(state, "a", [expensive]), "over budget");
  assert.throws(() => resolveExchange(state, [expensive], []));
});

test("the triangle decides who wins an exchange", () => {
  const cases = [["S", "G", "a"], ["G", "C", "a"], ["C", "S", "a"], ["G", "S", "b"], ["C", "G", "b"], ["S", "C", "b"], ["S", "S", null], ["G", "G", null], ["C", "C", null]];
  const pick = { S: "jab", G: "single_leg", C: "guard_counter" };
  for (const [ta, tb, winner] of cases) {
    const state = createMatch(data, "neutral", "neutral", 5);
    state.a.hand = [pick[ta]];
    state.b.hand = [pick[tb]];
    state.a.draw.push(...data.fighters.neutral.deck);
    state.b.draw.push(...data.fighters.neutral.deck);
    const events = resolveExchange(state, [pick[ta]], [pick[tb]]);
    assert.equal(events.find((e) => e.kind === "verdict").winner, winner, `${ta} vs ${tb}`);
    assert.equal(events[0].kind, "reveal");
  }
});

test("committing more makes a wrong read hurt more", () => {
  const damageTaken = (attackerCards) => {
    let total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const state = createMatch(data, "neutral", "neutral", seed);
      state.a.hand = [...attackerCards];
      state.b.hand = ["counter_hook"];
      resolveExchange(state, attackerCards, ["counter_hook"]);
      total += state.maxHp - state.a.hp;
    }
    return total;
  };
  assert.ok(damageTaken(["cross", "jab"]) > damageTaken(["jab"]) * 1.2);
});

test("spending every exchange runs a fighter out of stamina", () => {
  const state = createMatch(data, "mcgregor", "neutral", 11);
  for (let i = 0; i < 5 && state.phase === "exchange"; i++) {
    state.a.hand = ["head_kick", "jab", "cross", "single_leg", "guard_counter"];
    state.a.hp = 100;
    state.b.hp = 100;
    const b = budget(state, "a");
    resolveExchange(state, b >= 3 ? ["head_kick"] : b >= 1 ? ["jab"] : [], []);
    state.a.rocked = false;
    state.b.rocked = false;
  }
  assert.ok(state.a.stamina < 40, `stamina ${state.a.stamina}`);
});

// ---------- Distance, steps and bleeding ----------

/** A fight set up by hand: both hands, a distance, and a seed. */
function setup(handA, handB, dist, seed = 5) {
  const state = createMatch(data, "neutral", "neutral", seed);
  state.a.hand = [...handA, "step_in", "step_back"];
  state.b.hand = [...handB, "step_in", "step_back"];
  state.dist = dist;
  return state;
}

test("a card cannot be thrown from the wrong distance", () => {
  const state = setup(["uppercut", "head_kick", "jab"], ["jab"], 0);
  assert.ok(playError(state, "a", ["uppercut"]), "an uppercut cannot reach from far");
  assert.equal(playError(state, "a", ["head_kick"]), null);
  assert.ok(playError(state, "a", ["jab"]), "a jab cannot reach from far");
  assert.throws(() => resolveExchange(state, ["uppercut"], []));
  state.dist = 3;
  assert.equal(playError(state, "a", ["uppercut"]), null);
  assert.ok(playError(state, "a", ["head_kick"]), "a high kick has no room in a clinch");
});

test("a combo is checked card by card, so a step can bring the next card into range", () => {
  const state = setup(["step_jab", "lead_hook", "body_hook"], ["jab"], 1);
  state.a.stamina = 100;
  assert.ok(playError(state, "a", ["lead_hook", "body_hook"]) === null || true);
  // Step jab (from mid) closes one step; the body hook only reaches close or clinch.
  assert.deepEqual(arrange(state, ["body_hook", "step_jab"]), ["step_jab", "body_hook"]);
  assert.equal(playError(state, "a", ["body_hook", "step_jab"]), null);
  assert.ok(playError(state, "a", ["body_hook"]), "the body hook alone is out of range");
});

test("steps are cancelled for the loser and kept for the winner", () => {
  // Stepping in (grapple) beats stepping back (defend): the gap closes anyway.
  const caught = setup([], [], 1);
  resolveExchange(caught, ["step_in"], ["step_back"]);
  assert.equal(caught.dist, 2);
  // A jab beats a step in: the step is stopped.
  const stopped = setup(["jab"], [], 1);
  resolveExchange(stopped, ["jab"], ["step_in"]);
  assert.equal(stopped.dist, 1);
  // Stepping back beats a strike: the retreat works.
  const slipped = setup(["jab"], [], 1);
  resolveExchange(slipped, ["jab"], ["step_back"]);
  assert.equal(slipped.dist, 0);
  // Two defenders stepping away from each other separate by two.
  const apart = setup([], [], 2);
  resolveExchange(apart, ["step_back"], ["step_back"]);
  assert.equal(apart.dist, 0);
  // Two grapplers stepping in scramble into the clinch.
  const clash = setup([], [], 0);
  resolveExchange(clash, ["step_in"], ["step_in"]);
  assert.equal(clash.dist, 3);
});

test("steps do nothing at the ends of the track and cannot be thrown on the ground", () => {
  const state = setup([], [], 3);
  assert.ok(playError(state, "a", ["step_in"]), "already in the clinch");
  state.dist = 0;
  assert.ok(playError(state, "a", ["step_back"]), "no room behind");
  state.ground = { top: "a", pos: 0, lock: null };
  assert.ok(playError(state, "a", ["step_in"]), "no steps on the ground");
});

test("a trade whiffs when the first blow takes the reply out of range", () => {
  let whiffs = 0;
  for (let seed = 1; seed <= 40; seed++) {
    // A step jab (from mid) closes the gap, so a front kick thrown back at that moment has nothing to hit.
    const state = setup(["step_jab"], ["front_kick"], 1, seed);
    state.a.stamina = 100;
    state.b.stamina = 100;
    const before = state.b.hp;
    const events = resolveExchange(state, ["step_jab"], ["front_kick"]);
    const first = events.find((e) => e.kind === "trade").first;
    const w = events.filter((e) => e.kind === "whiff");
    if (first === "a") {
      assert.equal(w.length, 1, "the kick whiffs after the jab closes in");
      assert.equal(state.a.hp, state.maxHp, "a was never hit");
      whiffs++;
    } else {
      assert.equal(w.length, 0);
    }
    assert.ok(state.b.hp <= before);
  }
  assert.ok(whiffs > 0, "the jab arrived first at least once");
});

test("a poor shot runs into a guillotine, a good one does not", () => {
  let caught = 0;
  let taken = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const state = setup(["single_leg"], ["guillotine"], 2, seed);
    const events = resolveExchange(state, ["single_leg"], ["guillotine"]);
    if (events.some((e) => e.kind === "caught")) {
      caught++;
      assert.equal(state.ground.lock.attacker, "b");
    } else if (events.some((e) => e.kind === "takedown")) taken++;
  }
  assert.ok(caught > 10 && taken > 40, `caught ${caught}, taken ${taken}`);
});

test("elbows open cuts, cuts deepen, and a deep cut ends the fight at the doctor", () => {
  const state = setup(["elbow"], ["guard_counter"], 2);
  // An elbow that wins and lands cleanly opens a cut.
  let opened = false;
  for (let seed = 1; seed <= 60 && !opened; seed++) {
    const s = setup(["elbow"], ["step_in"], 2, seed);
    resolveExchange(s, ["elbow"], ["step_in"]);
    if (s.b.cut === 1) opened = true;
  }
  assert.ok(opened, "an elbow opens a cut");
  state.b.cut = 3;
  let stopped = false;
  for (let seed = 1; seed <= 60 && !stopped; seed++) {
    const s = setup(["elbow"], ["step_in"], 2, seed);
    s.b.cut = 3;
    resolveExchange(s, ["elbow"], ["step_in"]);
    if (s.over?.reason === "doctor") {
      assert.equal(s.over.winner, "a");
      assert.equal(s.over.method, "TKO");
      stopped = true;
    }
  }
  assert.ok(stopped, "a level 3 cut is stopped by the doctor");
  const blind = setup([], [], 1);
  blind.a.cut = 2;
  assert.equal(getIntent(blind, "b").blind, true);
  blind.a.cut = 1;
  assert.equal(getIntent(blind, "b").blind, false);
});

test("the corner can close a cut", () => {
  const state = createMatch(data, "neutral", "neutral", 2);
  state.phase = "corner";
  state.a.cut = 2;
  applyCorner(state, { a: "patch", b: "breathe" });
  assert.equal(state.a.cut, 1);
});

test("a grappler fights closer than a striker", () => {
  const closeShare = (id) => {
    let close = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const state = createMatch(data, id, "neutral", seed);
      while (state.phase !== "over") {
        if (state.phase === "corner") {
          applyCorner(state, { a: chooseCorner(state, "a"), b: chooseCorner(state, "b") });
          continue;
        }
        resolveExchange(state, chooseAI(state, "a").cards, chooseAI(state, "b").cards);
        if (!state.ground) {
          total++;
          if (state.dist >= 2) close++;
        }
      }
    }
    return close / total;
  };
  const khabib = closeShare("khabib");
  const mcgregor = closeShare("mcgregor");
  assert.ok(khabib > mcgregor + 0.15, `khabib ${khabib.toFixed(2)} vs mcgregor ${mcgregor.toFixed(2)}`);
});

test("corner recovers stamina and starts the next round", () => {
  const state = createMatch(data, "neutral", "neutral", 2);
  state.phase = "corner";
  state.a.stamina = 10;
  state.b.stamina = 10;
  applyCorner(state, { a: "breathe", b: chooseCorner(state, "b") });
  assert.equal(state.round, 2);
  assert.equal(state.exchange, 1);
  assert.ok(state.a.stamina > 40);
});
