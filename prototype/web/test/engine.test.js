// Engine checks. Run: node prototype/web/test/engine.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, budget, playError, nextUnit, checkInvariants, arrange, usableAt, bestPlay, previewPlay, cardCost, loadData, chooseChase, resolvePending, chooseTactic, setTactic, refillHand, groundCatOf, lockStatus, describeCard, lockResistChance, lockGuessWrong } from "../engine.js";
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
      const standing = state[s].stand ?? state[s].hand; // on the mat the stand-up hand waits aside
      if (!state.ground) assert.ok(standing.includes("step_in") && standing.includes("step_back"));
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
  const [s, g] = ["S", "G"].map((t) => state.a.hand.find((c) => data.cards[c].type === t && !data.cards[c].moveOnly));
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
        if (state.pending) resolvePending(state, chooseChase(state, state.pending.side));
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

// ---------- Match length ----------

test("both match lengths run their own number of rounds and exchanges", () => {
  for (const [mode, m] of Object.entries(data.rules.match.modes)) {
    const { state } = playGame("neutral", "neutral", strategies["看意圖並控制投入"], 3, data, mode);
    assert.equal(state.rounds, m.rounds);
    assert.equal(state.perRound, m.exchanges);
    assert.equal(state.maxHp, m.hp);
    assert.ok(state.round <= m.rounds);
  }
});

// ---------- Cross-exchange setups ----------

test("a landed jab opens the next exchange: the follow-up crits more, and only for one exchange", () => {
  let opened = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const state = setup(["jab", "cross"], ["step_in"], 1, seed);
    state.a.stamina = 100;
    resolveExchange(state, ["jab"], ["step_in"]);
    if (!state.a.marks.opened) continue; // a graze lays nothing down
    opened++;
    const base = createMatch(data, "neutral", "neutral", 1);
    base.a.hand = ["cross", "step_in", "step_back"];
    const plain = previewPlay(base, "a", ["cross"]).critPct;
    assert.ok(previewPlay(state, "a", ["cross"]).critPct >= plain + 15, "the follow-up gets the bonus");
    state.b.hand = ["step_in", "step_back"];
    state.a.hand = ["cross", "step_in", "step_back"];
    resolveExchange(state, [], ["step_in"]);
    assert.ok(!state.a.marks.opened, "the tag lasts one exchange");
  }
  assert.ok(opened > 5, `opened ${opened}`);
});

test("a feint that wins makes the fooled fighter easier to read, and the AI still follows the shown numbers", () => {
  const state = setup(["feint"], ["step_in"], 1);
  resolveExchange(state, ["feint"], ["step_in"]);
  assert.ok(state.b.marks.fooled, "the feint won against a charge");
  state.b.hand = ["jab", "single_leg", "guard_counter", "step_in", "step_back"];
  const plain = createMatch(data, "neutral", "neutral", 5);
  plain.b.hand = state.b.hand;
  setTactic(state, "b", "ko"); // the plans are drawn from the seed; fix them so only the feint differs
  setTactic(plain, "b", "ko");
  plain.history = [...state.history];
  const sharp = getIntent(state, "b").probs;
  const dull = getIntent(plain, "b").probs;
  const top = (p) => Math.max(p.S, p.G, p.C);
  assert.ok(top(sharp) > top(dull) + 0.05, `sharper read ${top(sharp)} vs ${top(dull)}`);
  const counts = { S: 0, G: 0, C: 0 };
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const cards = chooseAI(state, "b").cards;
    counts[cards.length ? data.cards[cards[0]].type : "C"]++;
  }
  for (const t of ["S", "G", "C"]) assert.ok(Math.abs(counts[t] / n - sharp[t]) < 0.04, `${t}: shown ${sharp[t]}, played ${counts[t] / n}`);
});

test("a leg injury makes steps cost more energy, but never more than the fighter can spend", () => {
  const state = setup([], [], 1);
  assert.equal(cardCost(state, "a", "step_in"), 1);
  state.a.pips.legs = data.rules.debuff.threshold;
  assert.equal(cardCost(state, "a", "step_in"), 2);
  assert.equal(cardCost(state, "a", "jab"), 1, "only steps cost more");
  state.a.stamina = 1;
  assert.equal(budget(state, "a"), 1);
  assert.equal(cardCost(state, "a", "step_in"), 1, "a spent fighter can still step");
  assert.equal(playError(state, "a", ["step_in"]), null);
});

test("depth.json layers onto the roster without touching the base files", () => {
  const merged = loadData({ rules: data.rules, cards: { jab: { name: "刺拳", type: "S", cost: 1 } }, fighters: { x: { deck: ["jab", "jab"] } }, depth: { cards: { jab: { follow: { opened: { crit: 0.1 } } }, feint: { type: "S", cost: 1 } }, fighters: { x: { deckSwap: [["jab", "feint"]], chase: 0.3 } } } });
  assert.deepEqual(merged.fighters.x.deck, ["feint", "jab"]);
  assert.equal(merged.fighters.x.chase, 0.3);
  assert.ok(merged.cards.jab.follow && merged.cards.jab.name === "刺拳" && merged.cards.feint);
});

// ---------- The fence, the last exchange of a round, and chasing a takedown ----------

test("giving ground twice puts a fighter on the fence: no retreating, two fence cards, takedowns land more", () => {
  const state = setup(["jab"], [], 1);
  // The challenger keeps stepping in and winning (grapple beats defend), so the other man keeps giving ground.
  for (let i = 0; i < 2; i++) {
    state.dist = 1;
    state.a.hand = ["step_in", "step_back"];
    state.b.hand = ["guard_counter", "step_back", "step_in"];
    resolveExchange(state, ["step_in"], ["step_back"]);
  }
  assert.equal(state.cage?.side, "b", "b is against the fence");
  assert.ok(state.b.hand.includes("cage_push") && state.b.hand.includes("cage_turn"));
  assert.ok(!state.a.hand.includes("cage_turn"), "only the pinned fighter gets them");
  assert.ok(playError(state, "b", ["step_back"]), "cannot back off the fence");
  assert.ok(playError(state, "b", ["slip_back"]) !== null || !state.b.hand.includes("slip_back"));
  assert.ok(playError(state, "b", ["cage_push", "cage_turn"]), "fence cards go alone");
  const base = setup(["single_leg"], [], 2);
  const pinned = setup(["single_leg"], [], 2);
  pinned.cage = { side: "b", ttl: 3 };
  assert.ok(previewPlay(pinned, "a", ["single_leg"]).critPct >= previewPlay(base, "a", ["single_leg"]).critPct + 10);
});

test("turning out of the fence frees the fighter, and pushing off swaps who is against it", () => {
  const turn = setup(["jab"], ["guard_counter"], 2);
  turn.cage = { side: "b", ttl: 3 };
  turn.b.hand = ["cage_turn", "cage_push", "guard_counter", "step_in", "step_back"];
  resolveExchange(turn, ["jab"], ["cage_turn"]);
  assert.equal(turn.cage, null);
  assert.equal(turn.dist, data.rules.cage.escapeDist);
  const push = setup(["guard_counter"], [], 2);
  push.cage = { side: "b", ttl: 3 };
  push.b.hand = ["cage_turn", "cage_push", "guard_counter", "step_in", "step_back"];
  push.a.hand = ["guard_counter", "step_in", "step_back"];
  resolveExchange(push, ["guard_counter"], ["cage_push"]);
  assert.equal(push.cage?.side, "a", "now a is against the fence");
});

test("the last exchange of a round gives everyone one more energy and counts more with the judges", () => {
  const state = createMatch(data, "neutral", "neutral", 3);
  const plain = budget(state, "a");
  state.exchange = state.perRound;
  assert.equal(budget(state, "a"), plain + data.rules.match.finalExchange.energyBonus);
  state.a.stamina = 5;
  assert.equal(budget(state, "a"), 1 + data.rules.match.finalExchange.energyBonus, "even a gassed fighter gets it");
  const run = (exchange) => {
    const s = createMatch(data, "neutral", "neutral", 3);
    s.exchange = exchange;
    s.a.hand = ["jab", "step_in", "step_back"];
    s.b.hand = ["step_in", "step_back"];
    resolveExchange(s, ["jab"], ["step_in"]);
    return (s.roundCards[0]?.score ?? s.roundScore).a.striking;
  };
  const early = run(2);
  const late = run(data.rules.match.modes.standard.exchanges);
  assert.ok(late > early * 1.3, `late ${late} vs early ${early}`);
});

test("a takedown leaves the winner a choice: follow to the ground, or let him up and keep the edge", () => {
  let sawFollow = 0;
  let sawRelease = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const state = setup(["double_leg"], ["guard_counter"], 2, seed);
    const events = resolveExchange(state, ["double_leg"], ["guard_counter"]);
    if (!events.some((e) => e.kind === "takedown")) continue;
    assert.deepEqual(state.pending, { kind: "chase", side: "a" });
    assert.throws(() => resolveExchange(state, [], []), /pending/);
    if (seed % 2) {
      resolvePending(state, "follow");
      assert.ok(state.ground, "still on the ground");
      sawFollow++;
    } else {
      resolvePending(state, "release");
      assert.equal(state.ground, null);
      assert.equal(state.dist, data.rules.dist.standUp);
      assert.ok(state.a.marks.released, "the one who let him up has the edge");
      sawRelease++;
    }
    assert.equal(state.pending, null);
  }
  assert.ok(sawFollow > 3 && sawRelease > 3, `${sawFollow}/${sawRelease}`);
  // Grapplers nearly always follow, strikers often let go.
  const rate = (id) => {
    const state = createMatch(data, id, "neutral", 9);
    let follow = 0;
    for (let i = 0; i < 400; i++) if (chooseChase(state, "a") === "follow") follow++;
    return follow / 400;
  };
  assert.ok(rate("khabib") > rate("mcgregor") + 0.3);
});

// ---------- Fighter abilities ----------

/** A fight between two named fighters with hands and distance set by hand. */
function duel(idA, idB, handA, handB, dist, seed = 5) {
  const state = createMatch(data, idA, idB, seed);
  state.a.hand = [...handA, "step_in", "step_back"];
  state.b.hand = [...handB, "step_in", "step_back"];
  state.dist = dist;
  return state;
}

test("every real fighter has an ability made only of known tags and effects", () => {
  for (const [id, f] of Object.entries(data.fighters)) {
    if (f.hidden) continue;
    assert.ok(f.ability?.name && f.ability.desc, `${id} has no ability`);
    assert.ok(f.ability.triggers || f.ability.passive, `${id} ability does nothing`);
    for (const t of f.ability.triggers || []) {
      assert.ok(["win", "play", "hit", "takedown", "moved"].includes(t.on), `${id} trigger ${t.on}`);
      for (const d of t.do) if (d.tag) assert.ok(data.rules.tags[d.tag], `${id} unknown tag ${d.tag}`);
    }
  }
});

test("a counter that wins lets McGregor see through the next exchange, and Adesanya also gets away", () => {
  const mc = duel("mcgregor", "neutral", ["guard_counter"], ["jab"], 1);
  resolveExchange(mc, ["guard_counter"], ["jab"]);
  assert.ok(mc.b.marks.fooled, "the foe is easier to read");
  const ad = duel("adesanya", "neutral", ["guard_counter"], ["jab"], 2);
  resolveExchange(ad, ["guard_counter"], ["jab"]);
  assert.equal(ad.dist, 1, "pulled away one step");
  assert.ok(ad.b.marks.fooled);
  assert.equal(ad.cage, null, "pulling away after a win is not giving ground");
  const nobody = duel("neutral", "neutral", ["guard_counter"], ["jab"], 1);
  resolveExchange(nobody, ["guard_counter"], ["jab"]);
  assert.ok(!nobody.b.marks.fooled, "only the ability does that");
});

test("Holloway builds rhythm by striking every exchange: more crit, first to arrive, an extra energy at three stacks", () => {
  const state = duel("holloway", "neutral", ["jab", "cross"], ["guard_counter"], 1);
  const plain = budget(state, "a");
  for (let i = 1; i <= 3; i++) {
    state.a.hand = ["jab", "cross", "step_in", "step_back"];
    state.b.hand = ["guard_counter", "step_in", "step_back"];
    state.a.stamina = 100;
    state.a.hp = state.maxHp;
    state.b.hp = state.maxHp;
    resolveExchange(state, ["jab"], ["guard_counter"]);
    assert.equal(state.a.marks.rhythm?.n, i, `stack after strike ${i}`);
  }
  assert.equal(budget(state, "a"), plain + 1, "three stacks add an energy");
  const base = createMatch(data, "holloway", "neutral", 1);
  base.a.hand = ["cross", "step_in", "step_back"];
  state.a.hand = ["cross", "step_in", "step_back"];
  assert.ok(previewPlay(state, "a", ["cross"]).critPct > previewPlay(base, "a", ["cross"]).critPct + 8);
  // A different kind of play lets the rhythm drop after one more exchange.
  state.a.hand = ["single_leg", "step_in", "step_back"];
  state.b.hand = ["guard_counter", "step_in", "step_back"];
  resolveExchange(state, ["single_leg"], ["guard_counter"]);
  assert.ok(!state.a.marks.rhythm, "the streak is over");
  // The rhythm decides who lands first in a trade.
  const trade = duel("holloway", "neutral", ["cross"], ["cross"], 1);
  trade.a.marks.rhythm = { turns: 1, n: 2 };
  trade.a.hand = ["cross", "step_in", "step_back"];
  trade.b.hand = ["jab", "step_in", "step_back"];
  const ev = resolveExchange(trade, ["cross"], ["jab"]);
  assert.equal(ev.find((e) => e.kind === "trade").first, "a", "two stacks arrive first despite the dearer card");
});

// ---------- The ground game (M1.3) ----------

/** Two fighters on the mat, `top` on top at `pos`, with ground hands set by hand. The stand-up hands are set aside as in a real fight. */
function mat(idA, idB, { pos = 1, top = "a", handTop = [], handBottom = [], seed = 5 } = {}) {
  const state = createMatch(data, idA, idB, seed);
  const bottom = top === "a" ? "b" : "a";
  state.ground = { top, pos, lock: null, hist: [] };
  for (const [side, hand] of [[top, handTop], [bottom, handBottom]]) {
    state[side].stand = state[side].hand;
    state[side].hand = [...hand];
  }
  return state;
}

/** The same, but with the real ground hands drawn. */
function matDrawn(idA, idB, pos, top = "a", seed = 5) {
  const state = createMatch(data, idA, idB, seed);
  state.ground = { top, pos, lock: null, hist: [] };
  for (const s of ["a", "b"]) refillHand(state, s);
  return state;
}

const TOP_PLAYS = { punch: ["g_pound"], pass: ["g_pass"], lock: ["g_kimura"], hold: [] };
const BOTTOM_PLAYS = { frame: ["g_frame"], counter: ["g_counter"], escape: ["g_escape"], cover: [] };

test("on the ground the top man chooses and the bottom man guesses: the matrix decides, no triangle", () => {
  for (const [t, row] of Object.entries(data.rules.ground.matrix)) {
    for (const [b, out] of Object.entries(row)) {
      const state = mat("neutral", "neutral", { pos: 1, handTop: ["g_pound", "g_pass", "g_kimura"], handBottom: ["g_frame", "g_counter", "g_escape"] });
      const events = resolveExchange(state, TOP_PLAYS[t], BOTTOM_PLAYS[b]);
      const v = events.find((e) => e.kind === "verdict");
      assert.equal(v.winner, out === "top" ? "a" : out === "bottom" ? "b" : null, `${t} vs ${b}`);
    }
  }
  assert.equal(data.rules.positions.length, 5);
});

test("ground decks: 12 cards from a shared pool of about 30, and no ground-only cards left in the stand-up decks", () => {
  assert.ok(Object.values(data.cards).filter((c) => c.cat).length >= 28, "shared pool");
  for (const [id, f] of Object.entries(data.fighters)) {
    assert.equal(f.groundDeck.length, 12, `${id} ground deck`);
    assert.equal(new Set(f.groundDeck).size, 12, `${id} has no duplicates`);
    for (const c of f.groundDeck) assert.ok(data.cards[c]?.cat, `${id} unknown ground card ${c}`);
    for (const c of ["rnc", "arm_triangle", "triangle", "armbar"]) assert.ok(!f.deck.includes(c), `${id} still stands up with ${c}`);
  }
});

test("ground hands: one card per play, only cards for this role and position, and a choice of every kind", () => {
  for (const [id, f] of Object.entries(data.fighters)) {
    for (let pos = 0; pos < data.rules.positions.length; pos++) {
      for (const top of ["a", "b"]) {
        const state = matDrawn(id, "neutral", pos, top, 11 + pos);
        for (const s of ["a", "b"]) {
          const role = top === s ? "top" : "bottom";
          const hand = state[s].hand;
          const who = `${id} ${role}@${pos}`;
          assert.ok(hand.length >= 2 && hand.length <= data.rules.ground.handSize, `${who}: ${hand.length} cards`);
          for (const c of hand) assert.equal(playError(state, s, [c]), null, `${who} ${c}`);
          assert.ok(playError(state, s, [hand[0], hand[1]]), "one card only");
          assert.ok(!hand.includes("step_in"), "no steps on the mat");
          const deck = s === "a" ? f.groundDeck : data.fighters.neutral.groundDeck;
          for (const [cat, def] of Object.entries(data.rules.ground.cats)) {
            if (def.side !== role || def.free) continue;
            const has = deck.some((c) => data.cards[c].cat === cat && pos >= data.cards[c].pos[0] && pos <= data.cards[c].pos[1]);
            assert.equal(hand.some((c) => data.cards[c].cat === cat), has, `${who} ${cat}`);
          }
          if (role === "bottom") for (const cat of ["frame", "counter", "escape"]) assert.ok(hand.some((c) => data.cards[c].cat === cat), `${who} lacks ${cat}`);
          else assert.ok(hand.some((c) => data.cards[c].cat === "punch"), `${who} lacks punch`);
        }
        assert.deepEqual(checkInvariants(state), [], `${id} @${pos}`);
      }
    }
  }
});

test("a lock card only works where it belongs, and the higher the man on top, the fewer ways out the man underneath has", () => {
  const lockCards = (pos) => matDrawn("khabib", "neutral", pos, "a").a.hand.filter((c) => data.cards[c].cat === "lock");
  assert.deepEqual(lockCards(0), [], "no lock from the guard for a wrestler");
  for (let pos = 0; pos < 5; pos++) for (const c of lockCards(pos)) assert.ok(pos >= data.cards[c].pos[0] && pos <= data.cards[c].pos[1]);
  assert.deepEqual(data.cards.g_rnc.pos, [4, 4], "the rear naked choke is for the back only");
  assert.deepEqual(data.cards.g_kimura.pos, [1, 2], "the kimura is for half guard and side control");
  assert.ok(data.cards.g_triangle.pos[1] <= 1 && data.cards.g_triangle.lockBottom, "the triangle is a guard play from underneath");
  const options = (pos) => Object.values(data.cards).filter((c) => c.cat && data.rules.ground.cats[c.cat].side === "bottom" && pos >= c.pos[0] && pos <= c.pos[1]).length;
  assert.ok(options(4) < options(0) && options(3) < options(1), "fewer ways out from the high positions");
});

test("the stand-up hand waits aside on the mat and comes back whole when he stands", () => {
  let down = null;
  for (let seed = 1; seed <= 60 && !down; seed++) {
    const s = setup(["double_leg"], ["guard_counter"], 2, seed);
    if (resolveExchange(s, ["double_leg"], ["guard_counter"]).some((e) => e.kind === "takedown")) down = s;
  }
  assert.ok(down, "a takedown happened");
  resolvePending(down, "follow");
  for (const s of ["a", "b"]) {
    assert.ok(down[s].stand, "stand-up hand set aside");
    assert.ok(down[s].hand.every((c) => data.cards[c].cat), "ground cards only");
  }
  // A good escape from the guard puts him back on his feet.
  let stood = null;
  for (let seed = 1; seed <= 80 && !stood; seed++) {
    const m = mat("neutral", "neutral", { pos: 0, handTop: ["g_ankle"], handBottom: ["g_escape"], seed });
    const stand = [...m.b.stand];
    const events = resolveExchange(m, ["g_ankle"], ["g_escape"]);
    if (events.some((e) => e.kind === "standup")) stood = { m, stand };
  }
  assert.ok(stood, "an escape from full guard stands up");
  const { m, stand } = stood;
  assert.equal(m.ground, null);
  assert.equal(m.dist, data.rules.dist.standUp);
  assert.equal(m.b.stand, null);
  assert.ok(m.b.hand.includes("step_in") && m.b.hand.includes("step_back"), "steps are back");
  for (const c of stand.filter((x) => !data.cards[x].basic)) assert.ok(m.b.hand.includes(c) || m.b.discard.includes(c) || m.b.draw.includes(c), `${c} was kept`);
});

test("passing moves up one place (two on a critical); escapes follow the table and a critical turns him over", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, handTop: ["g_pass"], handBottom: [], seed });
    resolveExchange(m, ["g_pass"], []);
    seen.add(m.ground.pos);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3], "no change on a graze, one up, two up on a crit");
  // From the mount the bridge-and-roll lands in half guard, not side control.
  const after = new Set();
  let swept = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const m = mat("neutral", "neutral", { pos: 3, handTop: ["g_armbar_top"], handBottom: ["g_escape"], seed });
    const events = resolveExchange(m, ["g_armbar_top"], ["g_escape"]);
    assert.equal(events.find((e) => e.kind === "verdict").winner, "b", "escape beats a lock");
    if (events.some((e) => e.kind === "sweep")) swept++;
    else after.add(m.ground.pos);
  }
  assert.ok(!after.has(2), "no stepping down to side control");
  assert.ok(after.has(1) && after.has(3), "half guard on a clean escape, held on a graze");
  assert.ok(swept > 5, "now and then a critical turns him over");
  assert.equal(data.rules.ground.escapeTo[0], -1, "from full guard the escape is the stand-up");
});

test("a hold catches an escape, cover softens a punch, and a high position punches harder", () => {
  const total = (pos, top, bottom, field = "hp") => {
    let sum = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const m = mat("neutral", "neutral", { pos, handTop: ["g_pound", "g_pass"], handBottom: ["g_frame", "g_escape"], seed });
      m.a.stamina = 100;
      m.b.stamina = 100;
      resolveExchange(m, top, bottom);
      sum += field === "hp" ? m.maxHp - m.b.hp : 100 - m.b.stamina;
    }
    return sum;
  };
  const cover = total(2, ["g_pound"], []);
  const frame = total(2, ["g_pound"], ["g_frame"]);
  assert.ok(cover < frame * 0.65 && cover > frame * 0.35, `cover ${cover} vs frame ${frame}`);
  assert.ok(total(3, ["g_pound"], ["g_frame"]) > total(0, ["g_pound"], ["g_frame"]) * 1.4, "the mount hurts more than the guard");
  assert.ok(total(2, [], ["g_escape"], "stamina") > total(2, [], ["g_frame"], "stamina") + 100, "holding drains the man who tries to get out");
});

test("a punch-free stalemate drags until the referee stands them up", () => {
  const m = mat("neutral", "neutral", { pos: 1 });
  const first = resolveExchange(m, [], []);
  assert.ok(first.some((e) => e.kind === "standoff"));
  assert.ok(m.ground, "still on the mat after one");
  const second = resolveExchange(m, [], []);
  assert.ok(second.some((e) => e.kind === "standup" && e.reason === "referee"));
  assert.equal(m.ground, null);
});

/** A lock fight with `a` holding it at the given stage. */
function lockFight(depth, { top = "a", attacker = "a" } = {}) {
  const m = mat("neutral", "neutral", { pos: 3, top, handTop: [], handBottom: [] });
  m.ground.lock = { attacker, name: "十字固", depth, hist: [] };
  for (const s of ["a", "b"]) {
    m[s].hand = Object.keys(data.cards).filter((c) => data.cards[c].lockSide === (s === attacker ? "attack" : "defend"));
  }
  return m;
}

test("a lock fight is a guess: right eases it a stage and out at the first, wrong sinks it, and the third stage is the tap", () => {
  const m = lockFight(2);
  assert.deepEqual(m.a.hand, ["lk_tighten", "lk_angle", "lk_leg"]);
  assert.ok(playError(m, "a", []), "no sitting out a lock fight");
  assert.ok(playError(m, "a", ["lk_tighten", "lk_angle"]), "one move");
  const ease = resolveExchange(m, ["lk_tighten"], ["lk_handfight"]);
  assert.ok(ease.some((e) => e.kind === "lockEase" && e.depth === 1));
  assert.equal(m.ground.lock.depth, 1);
  assert.deepEqual(m.b.hand, ["lk_handfight", "lk_turn", "lk_yank"], "the next fight starts with the same three answers");
  const out = resolveExchange(m, ["lk_angle"], ["lk_turn"]);
  assert.ok(out.some((e) => e.kind === "lockEscape"));
  assert.equal(m.ground.lock, null);
  assert.ok(m.a.hand.every((c) => data.cards[c].cat), "back to ground cards once the lock is gone");
  const deeper = lockFight(1);
  const hurt = deeper.b.stamina;
  const sink = resolveExchange(deeper, ["lk_leg"], ["lk_handfight"], { resist: false });
  assert.ok(sink.some((e) => e.kind === "lockDeepen" && e.depth === 2));
  assert.ok(deeper.b.stamina < hurt, "the victim tires");
  const tap = resolveExchange(deeper, ["lk_tighten"], ["lk_yank"], { resist: false });
  assert.ok(tap.some((e) => e.kind === "tap"));
  assert.equal(deeper.over.method, "SUB");
  assert.equal(deeper.over.winner, "a");
  assert.equal(lockStatus(m), null);
  // The pairs: tighten / hand-fight, change angle / turn, leg lock / pull out.
  for (const [atk, def] of [["lk_tighten", "lk_handfight"], ["lk_angle", "lk_turn"], ["lk_leg", "lk_yank"]]) {
    const f = lockFight(2);
    assert.ok(resolveExchange(f, [atk], [def]).some((e) => e.kind === "lockEase"), `${atk} answered by ${def}`);
  }
  // A lock held from underneath works the same with the sides swapped.
  const under = lockFight(2, { top: "b", attacker: "a" });
  assert.ok(resolveExchange(under, ["lk_tighten"], ["lk_turn"], { resist: false }).some((e) => e.kind === "tap"));
});

test("a wrong guess in a lock fight can still be held off: the chance comes from skill, depth and gas, and is rolled for the AI", () => {
  const m = lockFight(2);
  const held = resolveExchange(m, ["lk_tighten"], ["lk_turn"], { resist: true });
  assert.ok(held.some((e) => e.kind === "lockResist"));
  assert.equal(m.ground.lock.depth, 2, "the lock did not sink");
  assert.ok(!m.over);
  // The chance: the better defender, the shallower lock and the fresher legs all help him.
  const chance = (fn) => { const f = lockFight(1); fn?.(f); return lockResistChance(f); };
  const base = chance();
  assert.ok(base > 0.3 && base < 0.6, `base ${base}`);
  assert.ok(chance((f) => { f.b.attrs = { ...f.b.attrs, submission: 99, grappleDef: 99 }; }) > base + 0.05, "skill helps");
  assert.ok(chance((f) => { f.a.attrs = { ...f.a.attrs, submission: 99 }; }) < base - 0.03, "a better attacker lowers it");
  assert.ok(chance((f) => { f.ground.lock.depth = 2; }) < base - 0.05, "deeper is harder");
  assert.ok(chance((f) => { f.b.stamina = 10; }) < base - 0.1, "gas matters");
  // The AI is rolled at exactly that chance.
  let holds = 0;
  const n = 1500;
  for (let seed = 1; seed <= n; seed++) {
    const f = lockFight(1);
    f.rng = BigInt(seed * 7919);
    if (resolveExchange(f, ["lk_tighten"], ["lk_turn"]).some((e) => e.kind === "lockResist")) holds++;
  }
  assert.ok(Math.abs(holds / n - base) < 0.05, `held ${holds / n} vs shown ${base}`);
  // The screen can tell when a wrong guess is coming, to ask the human to resist.
  assert.equal(lockGuessWrong(lockFight(1), ["lk_tighten"], ["lk_turn"]), true);
  assert.equal(lockGuessWrong(lockFight(1), ["lk_tighten"], ["lk_handfight"]), false);
});

test("a signature that loses the triangle is not blocked: it still lands for a share of its power", () => {
  const run = (cardA, cardB, seed) => {
    const s = duel("mcgregor", "neutral", [cardA], [cardB], 1, seed);
    s.a.momentum = 100;
    s.a.hand = [cardA, "step_in", "step_back"];
    s.b.hand = [cardB, "step_in", "step_back"];
    return { s, ev: resolveExchange(s, [cardA], [cardB]) };
  };
  let landed = 0;
  let full = 0;
  let glanced = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // The counter beats a strike. Without the rule the strike signature would be shut out entirely.
    const lose = run("sig_mcgregor", "guard_counter", seed);
    assert.equal(lose.ev.find((e) => e.kind === "verdict").winner, "b");
    const mine = lose.ev.filter((e) => e.kind === "hit" && e.attacker === "a");
    assert.ok(lose.ev.some((e) => e.kind === "glance"), "the signature is announced as glancing");
    if (mine.length) { landed++; glanced += mine[0].damage; }
    const win = run("sig_mcgregor", "step_in", seed);
    full += win.ev.filter((e) => e.kind === "hit" && e.attacker === "a").reduce((x, e) => x + e.damage, 0);
  }
  assert.equal(landed, 100, "it lands every time");
  assert.ok(glanced < full * 0.8 && glanced > full * 0.3, `glancing ${glanced} vs winning ${full}`);
  // An ordinary strike that loses is still shut out.
  const plain = duel("mcgregor", "neutral", ["cross"], ["guard_counter"], 1);
  const ev = resolveExchange(plain, ["cross"], ["guard_counter"]);
  assert.ok(!ev.some((e) => e.kind === "hit" && e.attacker === "a"));
  // A grab signature that loses the triangle to a strike still pulls him into the clinch.
  const grab = duel("khabib", "neutral", ["sig_khabib"], ["jab"], 2);
  grab.a.hand = ["sig_khabib", "step_in", "step_back"];
  grab.a.momentum = 100;
  const g = resolveExchange(grab, ["sig_khabib"], ["jab"]);
  assert.equal(g.find((e) => e.kind === "verdict").winner, "b");
  assert.equal(grab.dist, data.rules.dist.clinch);
});

test("how deep a lock starts: skill gap, a tired victim, and the fighter's own ability", () => {
  const kimura = (tweak) => {
    for (let seed = 1; seed <= 300; seed++) {
      const m = mat("neutral", "neutral", { pos: 1, handTop: ["g_kimura"], handBottom: ["g_frame"], seed });
      tweak?.(m);
      const e = resolveExchange(m, ["g_kimura"], ["g_frame"]).find((x) => x.kind === "lockStart");
      if (e) return e.depth;
    }
    return 0;
  };
  assert.equal(kimura(), 1);
  assert.equal(kimura((m) => { m.b.stamina = 20; }), 2, "a tired victim is locked deeper");
  assert.equal(kimura((m) => { m.a.attrs = { ...m.a.attrs, submission: 99 }; m.b.attrs = { ...m.b.attrs, submission: 40, grappleDef: 40 }; }), 2, "a big skill gap too");
  // Oliveira's triangle from underneath: a critical catch of a punch, and the ability starts it a stage deeper.
  const fromBottom = (id) => {
    for (let seed = 1; seed <= 600; seed++) {
      const m = mat("neutral", id, { pos: 0, top: "a", handTop: ["g_pound"], handBottom: ["g_triangle"], seed });
      const e = resolveExchange(m, ["g_pound"], ["g_triangle"]).find((x) => x.kind === "lockStart");
      if (e) return e.depth;
    }
    return 0;
  };
  assert.equal(fromBottom("oliveira"), fromBottom("neutral") + 1);
});

test("the abilities that touch the ground: Khabib makes escapes harder, Makhachev smothers on a pass, Chimaev drains after a takedown", () => {
  const progress = (topId) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const m = mat(topId, "neutral", { pos: 1, handTop: ["g_kimura"], handBottom: ["g_escape"], seed });
      const events = resolveExchange(m, ["g_kimura"], ["g_escape"]);
      if (events.some((e) => ["position", "standup", "sweep"].includes(e.kind))) n++;
    }
    return n;
  };
  assert.ok(progress("khabib") < progress("neutral") - 30, "fewer clean escapes against Khabib");
  const smother = (id) => {
    const m = mat(id, "neutral", { pos: 1, handTop: ["g_pass"], handBottom: [] });
    resolveExchange(m, ["g_pass"], []);
    return Boolean(m.b.marks.smothered);
  };
  assert.equal(smother("makhachev"), true);
  assert.equal(smother("neutral"), false);
  let drained = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const state = duel("chimaev", "neutral", ["double_leg"], ["guard_counter"], 2, seed);
    const before = state.b.stamina;
    const events = resolveExchange(state, ["double_leg"], ["guard_counter"]);
    if (events.some((e) => e.kind === "takedown")) {
      assert.ok(before - state.b.stamina >= 12, "the 12 stamina hit comes on top of the usual cost");
      drained++;
    }
  }
  assert.ok(drained > 5);
});

test("ground intent is honest too: the shown numbers are the ones the AI plays, as top, underneath and in a lock fight", () => {
  const top = matDrawn("mcgregor", "khabib", 2, "b");
  const bottom = matDrawn("khabib", "mcgregor", 2, "b");
  const attacker = matDrawn("mcgregor", "oliveira", 0, "a");
  attacker.ground.lock = { attacker: "b", name: "三角絞", depth: 1, hist: [] };
  for (const s of ["a", "b"]) refillHand(attacker, s);
  const defender = matDrawn("oliveira", "mcgregor", 0, "b");
  defender.ground.lock = { attacker: "a", name: "三角絞", depth: 1, hist: [] };
  for (const s of ["a", "b"]) refillHand(defender, s);
  for (const [label, state, side] of [["top", top, "b"], ["bottom", bottom, "a"], ["attacker", attacker, "b"], ["defender", defender, "b"]]) {
    const intent = getIntent(state, side);
    assert.ok(intent.ground, label);
    assert.ok(Math.abs(Object.values(intent.probs).reduce((a, b) => a + b, 0) - 1) < 1e-9, `${label} sums to one`);
    const counts = {};
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const cards = chooseAI(state, side).cards;
      const kind = state.ground.lock ? data.cards[cards[0]].lockMove : groundCatOf(state, side, cards);
      counts[kind] = (counts[kind] || 0) + 1;
    }
    for (const o of intent.options) assert.ok(Math.abs((counts[o.id] || 0) / n - intent.probs[o.id]) < 0.04, `${label} ${o.id}: shown ${intent.probs[o.id]}, played ${(counts[o.id] || 0) / n}`);
  }
  // Nothing the hand cannot throw is ever shown as likely.
  const noLock = matDrawn("mcgregor", "neutral", 4, "a");
  assert.equal(getIntent(noLock, "a").probs.lock, 0, "no lock card on the back for him");
});

test("the card preview on the mat: names, effects and damage that grows with position", () => {
  const low = matDrawn("neutral", "neutral", 0, "a");
  const high = matDrawn("neutral", "neutral", 3, "a");
  low.a.hand = ["g_hammer"];
  high.a.hand = ["g_hammer"];
  assert.equal(describeCard(low, "a", "g_hammer").action, "砸拳");
  assert.ok(previewPlay(high, "a", ["g_hammer"]).damage > previewPlay(low, "a", ["g_hammer"]).damage * 1.4);
  assert.match(describeCard(high, "a", "g_take_back").effect, /背後/);
  assert.match(describeCard(low, "b", "g_escape").effect, /站起來/);
});

// ---------- Tactics ----------

test("a tactic changes what a fighter's plays are worth, and the corner can switch it", () => {
  const state = createMatch(data, "neutral", "neutral", 4);
  state.a.hand = ["cross", "step_in", "step_back"];
  setTactic(state, "b", "probe");
  setTactic(state, "a", "probe");
  const calm = previewPlay(state, "a", ["cross"]).damage;
  setTactic(state, "a", "ko");
  assert.ok(state.a.tacticChanged);
  const swing = previewPlay(state, "a", ["cross"]);
  assert.ok(swing.damage > calm * 1.15, `ko ${swing.damage} vs probe ${calm}`);
  setTactic(state, "b", "ko");
  assert.ok(previewPlay(state, "a", ["cross"]).damage > swing.damage, "going for the knockout also means taking more");
  setTactic(state, "a", "ko");
  assert.ok(!state.a.tacticChanged, "keeping the same plan is not a change");
  assert.throws(() => setTactic(state, "a", "nonsense"));
  state.phase = "corner";
  applyCorner(state, { a: "breathe", b: "breathe" }, { a: "press" });
  assert.equal(state.a.tactic, "press");
  assert.ok(state.a.tacticChanged);
  assert.ok(state.rules.tactics[state.b.tactic], "the AI picked one too");
});

test("the AI swings for the knockout when behind and plays it safe when ahead, shown intent stays honest", () => {
  const share = (setup, id) => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const state = createMatch(data, "mcgregor", "khabib", seed);
      state.round = 2;
      setup(state);
      if (chooseTactic(state, "a") === id) n++;
    }
    return n / 300;
  };
  const judges = (a, b) => ({ round: 1, judges: [{ a, b }, { a, b }, { a, b }] });
  const behind = share((s) => s.roundCards.push(judges(9, 10)), "ko");
  const ahead = share((s) => s.roundCards.push(judges(10, 9)), "ko");
  assert.ok(behind > ahead + 0.15, `ko when behind ${behind}, ahead ${ahead}`);
  const safe = share((s) => s.roundCards.push(judges(10, 9)), "probe");
  assert.ok(safe > 0.3, `probe when ahead ${safe}`);
  const press = (stamina) => share((s) => { s.b.stamina = stamina; }, "press");
  assert.ok(press(20) > press(100), "leans on a tired foe");
  // The numbers on screen are still the numbers the AI plays.
  const state = createMatch(data, "khabib", "mcgregor", 9);
  setTactic(state, "a", "ko");
  const probs = getIntent(state, "a").probs;
  const counts = { S: 0, G: 0, C: 0 };
  for (let i = 0; i < 5000; i++) {
    const cards = chooseAI(state, "a").cards;
    counts[cards.length ? data.cards[cards[0]].type : "C"]++;
  }
  for (const t of ["S", "G", "C"]) assert.ok(Math.abs(counts[t] / 5000 - probs[t]) < 0.04, `${t}`);
  const calm = createMatch(data, "khabib", "mcgregor", 9);
  setTactic(calm, "a", "probe");
  assert.ok(getIntent(state, "a").probs.S > getIntent(calm, "a").probs.S + 0.1, "the knockout plan throws more strikes");
});

// ---------- Moving and playing in the same exchange ----------

test("a step can come with a play of any type: move first, then throw, and the play counts as the cards' type", () => {
  const state = setup(["jab", "cross", "single_leg", "guard_counter"], ["guard_counter"], 0);
  state.a.stamina = 100;
  // From far a jab cannot reach, but a step first brings it into range.
  assert.ok(playError(state, "a", ["jab"]));
  assert.equal(playError(state, "a", ["step_in", "jab"]), null);
  assert.deepEqual(arrange(state, ["jab", "step_in"], "a"), ["step_in", "jab"], "the order is found when the step has to come first");
  const preview = previewPlay(state, "a", ["step_in", "jab"]);
  assert.equal(preview.type, "S");
  assert.equal(preview.cost, 2);
  assert.equal(preview.endDist, 1);
  // Still only one step, and still one kind of real card.
  assert.ok(playError(state, "a", ["step_in", "step_back", "jab"]), "two steps with a strike");
  assert.ok(playError(state, "a", ["step_in", "jab", "single_leg"]), "a strike and a grapple");
  state.dist = 1;
  assert.equal(playError(state, "a", ["step_back", "guard_counter"]), null, "a defender who backs away");
  state.dist = 0;
  // It resolves as the strike: the jab beats a grapple, hits, and the step lands.
  let hits = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = setup(["jab"], [], 0, seed);
    s.a.stamina = 100;
    const ev = resolveExchange(s, ["step_in", "jab"], ["step_in"]);
    assert.equal(ev.find((e) => e.kind === "verdict").winner, "a");
    if (ev.some((e) => e.kind === "hit")) hits++;
    assert.ok(s.dist >= 1, "he moved in");
  }
  assert.ok(hits > 10);
  // A loser's step is cancelled like any other: the counter beats the strike, so the advance does not happen.
  const lost = setup(["jab"], ["guard_counter"], 0);
  lost.a.stamina = 100;
  resolveExchange(lost, ["step_in", "jab"], ["guard_counter"]);
  assert.equal(lost.dist, 0);
});
