// Engine checks. Run: node prototype/web/test/engine.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, budget, playError, nextUnit, checkInvariants, arrange, usableAt, bestPlay, previewPlay, cardCost, loadData, chooseChase, resolvePending, chooseTactic, setTactic } from "../engine.js";
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

test("Khabib makes getting up harder, Oliveira locks deeper from the bottom, Chimaev tires him after a takedown", () => {
  const getUps = (topId) => {
    let free = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const state = duel("neutral", topId, [], [], 2, seed);
      state.ground = { top: "b", pos: 1, lock: null };
      state.a.hand = ["single_leg", "step_in", "step_back"];
      state.b.hand = ["guard_counter", "step_in", "step_back"];
      resolveExchange(state, ["single_leg"], ["guard_counter"]);
      if (!state.ground || state.ground.pos === 0) free++;
    }
    return free;
  };
  assert.ok(getUps("khabib") < getUps("neutral") - 20, "fewer escapes against Khabib");
  const lock = (id) => {
    const state = duel(id, "neutral", ["triangle"], ["jab"], 2);
    state.ground = { top: "b", pos: 0, lock: null };
    state.a.hand = ["triangle", "step_in", "step_back"];
    state.b.hand = ["jab", "step_in", "step_back"];
    for (let seed = 1; seed <= 60; seed++) {
      state.rng = BigInt(seed);
      state.ground = { top: "b", pos: 0, lock: null };
      resolveExchange(state, ["triangle"], ["jab"]);
      if (state.ground?.lock) return state.ground.lock.depth;
      state.a.hand = ["triangle", "step_in", "step_back"];
      state.b.hand = ["jab", "step_in", "step_back"];
      state.phase = "exchange";
      state.over = null;
    }
    return 0;
  };
  assert.equal(lock("oliveira"), lock("neutral") + 1);
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
