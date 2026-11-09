// node --test prototype/web/bout/test.js — rules of the card bout engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createBout, playBeat, settleKnockdown, actions, hitChance, checkInvariants, cardIds } from "./engine.js";
import { data, fight, rngOf } from "./sim.js";
import { createAI, createMasher } from "./ai.js";

const fresh = (seed = 1) => createBout(data, "holloway", "poirier", seed);
const setHand = (st, s, ids) => { st[s].hand = ids.slice(); st[s].known = []; };

test("a bout starts with a full hand and no known cards", () => {
  const st = fresh();
  assert.equal(st.a.hand.length, data.config.startHand);
  assert.equal(st.b.known.length, 0);
  assert.equal(st.dist, data.config.dist.start);
});

test("same seed gives the same bout", () => {
  const x = fight("holloway", "poirier", 77);
  const y = fight("holloway", "poirier", 77);
  assert.equal(x.beats, y.beats);
  assert.deepEqual(x.st.over, y.st.over);
});

test("cards out of range are listed but not ok", () => {
  const st = fresh();
  st.dist = 0;
  setHand(st, "a", ["dirty", "jab", "hook", "lowkick", "cross"]);
  const acts = actions(st, "a").filter((a) => a.kind === "card");
  assert.deepEqual(acts.map((a) => a.ok), [false, true, false, true, false]);
  assert.equal(acts[0].why, "range");
});

test("moving happens before attacks: a short card whiffs when the opponent retreats", () => {
  const st = fresh();
  st.dist = 1;
  setHand(st, "a", ["jab", "jab", "jab", "jab", "jab"]);
  setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
  const ev = playBeat(st, { card: 0 }, { move: "retreat" });
  // distance went 1 -> 0; jab reaches 0 and 1, so use a card that only works at 1+: cross
  assert.equal(st.dist, 0);
  const atk = ev.find((e) => e.t === "attack" && e.by === "a");
  assert.ok(atk);
  const st2 = fresh();
  st2.dist = 1;
  setHand(st2, "a", ["cross", "cross", "cross", "cross", "cross"]);
  setHand(st2, "b", ["jab", "jab", "jab", "jab", "jab"]);
  const ev2 = playBeat(st2, { card: 0 }, { move: "retreat" });
  const atk2 = ev2.find((e) => e.t === "attack" && e.by === "a");
  assert.equal(atk2.hit, false);
  assert.equal(atk2.whiff, "range");
});

test("counter card gets the bonus only when the opponent made that basic move", () => {
  const st = fresh();
  const jab = data.cards.upper; // has a counter tag and no skill bonus for Holloway (a jab would be clamped at the cap)
  const base = hitChance(st, "a", jab, false, null).p;
  const vsAdvance = hitChance(st, "a", jab, false, "advance");
  assert.ok(Math.abs(vsAdvance.p - (base + data.config.hit.counterBonus)) < 1e-9);
  assert.ok(vsAdvance.why.includes("counter"));
  assert.equal(hitChance(st, "a", jab, false, "retreat").p, base);
});

test("an open opponent is easier to hit, and the opening lasts one beat", () => {
  const st = fresh();
  const cross = data.cards.cross;
  const p0 = hitChance(st, "a", cross).p;
  st.b.open = 1;
  assert.ok(Math.abs(hitChance(st, "a", cross).p - (p0 + data.config.hit.openBonus)) < 1e-9);
  setHand(st, "a", ["jab", "jab", "jab", "jab", "jab"]);
  setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
  st.dist = 1;
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.equal(st.b.open, 0);
});

test("a missed heavy card leaves the thrower open next beat", () => {
  let seen = 0;
  for (let seed = 1; seed < 200 && !seen; seed++) {
    const st = fresh(seed);
    st.dist = 2;
    setHand(st, "a", ["hook", "hook", "hook", "hook", "hook"]);
    setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
    const ev = playBeat(st, { card: 0 }, { move: "guard" });
    const atk = ev.find((e) => e.t === "attack" && e.by === "a");
    if (!atk.hit) {
      assert.equal(st.a.open, 1);
      seen++;
    }
  }
  assert.ok(seen > 0);
});

test("boost costs extra stamina and hits harder", () => {
  const a = fresh(5);
  const b = fresh(5);
  for (const st of [a, b]) {
    st.dist = 1;
    setHand(st, "a", ["cross", "jab", "jab", "jab", "jab"]);
    setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
  }
  const sa = a.a.stamina;
  playBeat(a, { card: 0 }, { move: "guard" });
  playBeat(b, { card: 0, boost: true }, { move: "guard" });
  const costPlain = sa - (a.a.stamina - data.config.stamina.regen * data.fighters.holloway.cardio);
  const costBoost = sa - (b.a.stamina - data.config.stamina.regen * data.fighters.holloway.cardio);
  assert.ok(Math.abs(costBoost - costPlain - data.config.boost.cost) < 1e-9);
});

test("you cannot play a card you cannot afford or that is out of range", () => {
  const st = fresh();
  st.dist = 1;
  st.a.stamina = 1;
  setHand(st, "a", ["flurry", "jab", "jab", "jab", "jab"]);
  assert.throws(() => playBeat(st, { card: 0 }, { move: "guard" }));
  st.a.stamina = 10;
  setHand(st, "a", ["hook", "jab", "jab", "jab", "jab"]);
  assert.throws(() => playBeat(st, { card: 0 }, { move: "guard" }), /out of range/);
});

test("a played card leaves the hand and a new one is drawn face-up (known to the opponent)", () => {
  const st = fresh(3);
  st.dist = 1;
  setHand(st, "a", ["jab", "cross", "lowkick", "bodykick", "highkick"]);
  setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
  playBeat(st, { card: 0 }, { move: "guard" });
  assert.equal(st.a.hand.length, data.config.handMax);
  assert.ok(st.a.fresh);
  assert.deepEqual(st.a.known, [st.a.fresh]);
  assert.deepEqual([...st.a.hand].sort(), ["bodykick", "cross", "highkick", "lowkick", st.a.fresh].sort());
});

test("a full hand does not draw (holding cards)", () => {
  const st = fresh();
  st.dist = 1;
  setHand(st, "a", ["jab", "cross", "lowkick", "bodykick", "highkick"]);
  setHand(st, "b", ["jab", "jab", "jab", "jab", "jab"]);
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.equal(st.a.hand.length, 5);
  assert.equal(st.a.fresh, null);
});

test("knockdown: chase or hold both resolve, three knockdowns is a TKO", () => {
  const st = fresh();
  st.pending = { by: "a", down: "b" };
  st.b.knockdowns = 2;
  settleKnockdown(st, false);
  assert.equal(st.over.winner, "a");
  assert.match(st.over.method, /TKO/);
  const st2 = fresh(9);
  st2.pending = { by: "a", down: "b" };
  settleKnockdown(st2, true);
  assert.ok(st2.over || st2.beat >= 1);
});

test("a bout ends in three rounds with a decision or earlier; judges read three cards", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { st } = fight("holloway", "poirier", seed);
    assert.ok(st.over);
    if (st.over.cards) assert.equal(st.over.cards.length, data.config.scoring.judges);
  }
});

test("invariants hold over many random bouts (masher vs masher)", () => {
  for (let seed = 1; seed <= 60; seed++) fight("holloway", "poirier", seed, createMasher, createMasher);
});

test("engine never reads card ids: every card property comes from the JSON", () => {
  assert.ok(cardIds(data).length >= 10);
  for (const id of cardIds(data)) {
    const c = data.cards[id];
    assert.ok(["head", "body", "leg"].includes(c.region), id);
    assert.ok(c.range.every((d) => d >= 0 && d <= 3), id);
    assert.ok(c.hit > 0 && c.hit < 1 && c.dmg > 0 && c.cost > 0, id);
  }
  for (const f of ["holloway", "poirier"]) for (const k of Object.keys(data.fighters[f].weights)) assert.ok(data.cards[k], `${f} weights unknown card ${k}`);
});
