// Rule checks for the deck-builder engine. Run: node prototype/web/deck/test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, startHand, commitPlan, endFirstPhase, perform, options, fallbackIds, checkInvariants, previewPlan, zoneOf, roleOf } from "./engine.js";
import { plan } from "./ai.js";
import { data, playMatch, rngOf } from "./sim.js";

const ids = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));

/** A fresh match with the first hand started and hands set by hand. */
function setup({ a = "khabib", b = "mcgregor", handA = [], handB = [], dist = 2, seed = 3 } = {}) {
  const s = createMatch(data, a, b, seed);
  startHand(s);
  s.dist = dist;
  s.a.hand.stand = handA;
  s.b.hand.stand = handB;
  return s;
}

const card = (id) => ({ k: "card", id });

test("every deck lists only known cards and fits its zone", () => {
  for (const id of ids) {
    for (const zone of ["stand", "ground"]) {
      for (const [cid, n] of Object.entries(data.fighters[id].deck[zone])) {
        assert.ok(data.cards[cid], `${id}: unknown card ${cid}`);
        assert.equal(data.cards[cid].zone, zone, `${id}: ${cid} is in the wrong deck`);
        assert.ok(n > 0);
      }
    }
  }
});

test("full matches keep invariants and always finish (all pairings, both seats)", () => {
  for (const x of ids) for (const y of ids) if (x !== y) for (let i = 0; i < 4; i++) {
    const s = playMatch(x, y, 50 + i);
    assert.ok(s.over, `${x} vs ${y} did not finish`);
    assert.deepEqual(checkInvariants(s), []);
  }
});

test("a round starts with the full deck back: 5 cards in hand, the rest in the draw pile, nothing discarded", () => {
  const s = createMatch(data, "khabib", "oliveira", 9);
  for (const side of ["a", "b"]) {
    const deck = data.fighters[s[side].id].deck.stand;
    const total = Object.values(deck).reduce((x, y) => x + y, 0);
    assert.equal(s[side].hand.stand.length, 5);
    assert.equal(s[side].piles.stand.draw.length, total - 5);
    assert.equal(s[side].piles.stand.discard.length, 0);
  }
});

test("no reshuffle inside a round: played cards stay in the discard pile", () => {
  const s = setup({ handA: ["jab", "jab", "guard"], dist: 1 });
  s.first = "a";
  const draw0 = s.a.piles.stand.draw.length;
  perform(s, "a", card("jab"));
  perform(s, "a", card("jab"));
  assert.equal(s.a.piles.stand.discard.length, 2);
  assert.equal(s.a.piles.stand.draw.length, draw0);
});

test("a played card needs the right range and energy", () => {
  const s = setup({ handA: ["cross", "high_kick", "guard"], dist: 2 });
  s.first = "a";
  assert.equal(perform(s, "a", card("high_kick")).why, "range");
  assert.equal(perform(s, "a", card("cross")).status, "ok");
  assert.equal(s.a.energy, 1);
  assert.equal(perform(s, "a", card("high_kick")).status, "canceled");
});

test("block soaks damage and head hits that get through build dizziness", () => {
  const s = setup({ handA: ["cross", "cross"], handB: ["guard"], dist: 1 });
  s.first = "a";
  s.b.block = 5;
  perform(s, "a", card("cross"));
  assert.equal(s.b.hp, 100 - 4);
  assert.equal(s.b.block, 0);
  assert.equal(s.b.dizzy, 0, "4 damage is a small hit");
});

test("slip negates the next hit and counter returns damage", () => {
  const s = setup({ handA: ["cross"], dist: 1 });
  s.b.slip = true;
  perform(s, "a", card("cross"));
  assert.equal(s.b.hp, 100);
  assert.equal(s.b.slip, false);
  const t = setup({ handA: ["cross"], dist: 1 });
  t.b.counter = { dmg: 13, at: "head" };
  perform(t, "a", card("cross"));
  assert.equal(t.b.hp, 100);
  assert.equal(t.a.hp, 87);
});

test("takedown goes to the mat and swaps hands; sprawl stops it", () => {
  const s = setup({ handA: ["shoot"], dist: 2 });
  perform(s, "a", card("shoot"));
  assert.equal(s.pos, "ground");
  assert.equal(s.top, "a");
  assert.equal(s.control, 3);
  assert.equal(zoneOf(s), "ground");
  assert.ok(s.a.hand.ground.length >= 1 && s.b.hand.ground.length >= 1, "both draw ground cards on entry");
  assert.ok(s.a.hand.ground.every((id) => data.cards[id].role === "top"));
  assert.ok(s.b.hand.ground.every((id) => data.cards[id].role === "bottom"));
  const t = setup({ handA: ["shoot"], dist: 2 });
  t.b.sprawl = true;
  perform(t, "a", card("shoot"));
  assert.equal(t.pos, "stand");
  assert.equal(t.b.sprawl, false);
});

test("stand-up cards cannot be played on the mat and ground cards cannot be played standing", () => {
  const s = setup({ handA: ["shoot", "jab"], dist: 2 });
  perform(s, "a", card("shoot"));
  s.a.energy = 3;
  s.a.hand.stand = ["jab"];
  assert.equal(perform(s, "a", card("jab")).status, "canceled");
  const t = setup({ handA: ["jab"], dist: 1 });
  t.a.hand.ground = ["gnp"];
  assert.equal(perform(t, "a", card("gnp")).status, "canceled");
});

test("the stand-up hand is kept while on the mat and comes back after the escape", () => {
  const s = setup({ handA: ["shoot", "jab", "guard"], dist: 2 });
  perform(s, "a", card("shoot"));
  assert.deepEqual(s.a.hand.stand, ["jab", "guard"]);
  s.b.energy = 3;
  s.b.hand.ground = ["scramble"];
  s.control = 3;
  perform(s, "b", card("scramble"));
  assert.equal(s.pos, "stand");
  assert.equal(s.dist, data.config.ground.standUpDistance);
  assert.deepEqual(s.a.hand.stand, ["jab", "guard"]);
});

test("ground draws only the cards for your role (no dead hands)", () => {
  for (let seed = 1; seed < 25; seed++) {
    const s = setup({ a: "mcgregor", b: "khabib", handA: ["shoot"], dist: 2, seed });
    s.a.hand.stand = ["double_leg"];
    s.b.hand.stand = ["double_leg"];
    perform(s, "b", card("double_leg"));
    assert.equal(s.pos, "ground");
    for (const side of ["a", "b"]) {
      const role = roleOf(s, side);
      assert.ok(s[side].hand.ground.every((id) => data.cards[id].role === role));
    }
  }
});

test("locks fill and tap at the threshold; break-lock pulls them back", () => {
  const s = setup({ dist: 2 });
  s.pos = "ground";
  s.top = "a";
  s.control = 0;
  s.a.hand.ground = ["armlock", "armlock", "armlock"];
  s.a.energy = 9;
  perform(s, "a", card("armlock"));
  assert.equal(s.lock.a, 6);
  s.b.hand.ground = ["break"];
  s.b.energy = 3;
  perform(s, "b", card("break"));
  assert.equal(s.lock.a, 1);
  perform(s, "a", card("armlock"));
  perform(s, "a", card("armlock"));
  assert.equal(s.over?.how, "tap");
  assert.equal(s.over.winner, "a");
});

test("sweep swaps top and bottom only when control is low", () => {
  const s = setup({});
  s.pos = "ground";
  s.top = "a";
  s.control = 3;
  s.b.hand.ground = ["sweep"];
  s.b.energy = 3;
  perform(s, "b", card("sweep"));
  assert.equal(s.top, "a", "too much control");
  s.control = 1;
  s.b.hand.ground = ["sweep"];
  s.b.energy = 3;
  perform(s, "b", card("sweep"));
  assert.equal(s.top, "b");
});

test("referee stands them up after hands with no progress", () => {
  const s = setup({});
  s.pos = "ground";
  s.top = "a";
  s.control = 2;
  s.progress = false;
  commitPlan(s, "b", []);
  endFirstPhase(s);
  assert.equal(s.stall, 1);
  startHand(s);
  endFirstPhase(s);
  assert.equal(s.pos, "stand", "second quiet hand ends it");
});

test("fallback moves appear only when pile and hand are empty for this position", () => {
  const s = setup({ handA: ["jab"] });
  assert.deepEqual(fallbackIds(s, "a"), []);
  s.a.hand.stand = [];
  assert.deepEqual(fallbackIds(s, "a"), [], "still cards in the pile");
  s.a.piles.stand.draw = [];
  assert.deepEqual(fallbackIds(s, "a"), data.config.fallback.stand);
  assert.ok(options(s, "a").some((o) => o.k === "card" && o.fb && o.ok));
});

test("one step per hand", () => {
  const s = setup({ dist: 1 });
  assert.equal(perform(s, "a", { k: "step", d: 1 }).status, "ok");
  assert.equal(s.dist, 2);
  assert.equal(perform(s, "a", { k: "step", d: 1 }).status, "canceled");
});

test("committed plan: out-of-range card is not thrown and stays in hand; a changed position makes the seat re-plan", () => {
  const s = setup({ handA: ["jab"], handB: ["high_kick", "guard"], dist: 2 });
  s.first = "a";
  commitPlan(s, "b", [card("high_kick")]);
  const pre = previewPlan(s);
  assert.equal(pre.steps[0].status, "whiff");
  endFirstPhase(s);
  assert.deepEqual(s.b.hand.stand, ["high_kick", "guard"]);
  const t = setup({ handA: ["shoot"], handB: ["jab"], dist: 2 });
  t.first = "a";
  commitPlan(t, "b", [card("jab")]);
  perform(t, "a", card("shoot"));
  let replanned = false;
  endFirstPhase(t, (st, seat) => {
    replanned = true;
    assert.equal(seat, "b");
    return [];
  });
  assert.ok(replanned);
});

test("the seat that sees the plan is always the same one (Slay-the-Spire style)", () => {
  const s = createMatch(data, "khabib", "mcgregor", 4);
  const firsts = [];
  for (let i = 0; i < 4; i++) {
    startHand(s);
    firsts.push(s.first);
    endFirstPhase(s);
  }
  assert.deepEqual(firsts, ["a", "a", "a", "a"]);
});

test("alternateFirst: true brings back the swap", () => {
  const d = { ...data, config: { ...data.config, match: { ...data.config.match, alternateFirst: true } } };
  const s = createMatch(d, "khabib", "mcgregor", 4);
  const firsts = [];
  for (let i = 0; i < 4; i++) {
    startHand(s);
    firsts.push(s.first);
    endFirstPhase(s);
  }
  assert.deepEqual(firsts, ["a", "b", "a", "b"]);
});

test("head hits that go through build to a stun; stunned fighters take more and lose energy next hand", () => {
  const s = setup({ handA: ["hook", "hook", "hook"], dist: 1 });
  s.a.energy = 9;
  perform(s, "a", card("hook"));
  perform(s, "a", card("hook"));
  assert.equal(s.b.stunned, true);
  const hp = s.b.hp;
  s.a.hand.stand = ["hook"];
  perform(s, "a", card("hook"));
  assert.equal(hp - s.b.hp, 13, "10 × 1.25 rounded");
  commitPlan(s, "b", []);
  endFirstPhase(s);
  startHand(s);
  const m = data.config.match;
  assert.equal(s.b.energy, m.energy + (m.secondEnergyBonus || 0) - data.config.status.dizzy.energyLoss);
});

test("AI plans are legal and the look-ahead seat never plays an illegal line", () => {
  for (const [x, y] of [["khabib", "mcgregor"], ["oliveira", "khabib"], ["mcgregor", "oliveira"]]) {
    const s = createMatch(data, x, y, 21);
    const rng = rngOf(5);
    for (let i = 0; i < 10 && !s.over; i++) {
      startHand(s);
      const second = s.first === "a" ? "b" : "a";
      commitPlan(s, second, plan(s, second, { look: false, rng }));
      for (const a of plan(s, s.first, { look: true, rng })) {
        assert.equal(perform(s, s.first, a).status, "ok");
        if (s.pos !== "stand") break;
      }
      endFirstPhase(s, (st, seat) => plan(st, seat, { look: false, rng }));
    }
  }
});
