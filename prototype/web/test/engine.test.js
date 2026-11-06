// Engine checks. Run: node prototype/web/test/engine.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, budget, playError, nextUnit, checkInvariants } from "../engine.js";
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

test("the opening hand holds all three types", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const state = createMatch(data, "mcgregor", "khabib", seed);
    for (const s of ["a", "b"]) {
      const types = new Set(state[s].hand.map((c) => data.cards[c].type));
      assert.equal(types.size, 3, `seed ${seed}`);
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
      total += 100 - state.a.hp;
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
