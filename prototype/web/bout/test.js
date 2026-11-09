// node --test prototype/web/bout/test.js — rules of the card bout engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createBout, playBeat, settleKnockdown, actions, hitChance, dmgMul, heldCard, checkInvariants, cardIds } from "./engine.js";
import { data, fight } from "./sim.js";
import { createMasher } from "./ai.js";

const cfg = data.config;
const fresh = (seed = 1) => createBout(data, "holloway", "poirier", seed);
const setHand = (st, s, ids, charged = -1) => { st[s].hand = ids.map((id, i) => ({ id, charged: i === charged })); };
const at = (dist, a, b, seed = 1) => { const st = fresh(seed); st.dist = dist; setHand(st, "a", a); setHand(st, "b", b); return st; };
const JABS = ["jab", "jab", "lowkick", "lowkick"];

test("a bout starts with a fresh hand of handDraw cards", () => {
  const st = fresh();
  assert.equal(st.a.hand.length, cfg.handDraw);
  assert.equal(heldCard(st, "a"), null);
  assert.equal(st.dist, cfg.dist.start);
});

test("same seed gives the same bout", () => {
  const x = fight("holloway", "poirier", 77);
  const y = fight("holloway", "poirier", 77);
  assert.equal(x.beats, y.beats);
  assert.deepEqual(x.st.over, y.st.over);
});

test("cards out of range are listed but not ok", () => {
  const st = at(1, ["dirty", "jab", "hook", "lowkick"], JABS);
  const acts = actions(st, "a").filter((a) => a.kind === "card");
  assert.deepEqual(acts.map((a) => a.ok), [false, true, false, true]);
  assert.equal(acts[0].why, "range");
});

test("every beat the unplayed cards are thrown away except the held one, which is charged and public", () => {
  const st = at(1, ["jab", "cross", "hook", "lowkick"], JABS);
  playBeat(st, { card: 0, hold: 2 }, { move: "guard" });
  assert.equal(st.a.hand.length, cfg.handDraw + 1);
  assert.equal(st.a.hand[0].id, "hook");
  assert.equal(st.a.hand[0].charged, true);
  assert.equal(heldCard(st, "a"), "hook");
  assert.equal(st.a.hand.filter((h) => h.charged).length, 1);
  // no hold → a completely new hand
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.equal(st.a.hand.length, cfg.handDraw);
  assert.equal(heldCard(st, "a"), null);
});

test("you cannot hold the card you are playing", () => {
  const st = at(1, ["jab", "cross", "hook", "lowkick"], JABS);
  assert.throws(() => playBeat(st, { card: 0, hold: 0 }, { move: "guard" }), /bad hold/);
});

test("a charged card hits harder", () => {
  const st = fresh();
  const hook = data.cards.hook;
  assert.ok(Math.abs(dmgMul(st, "a", hook, true, false) - cfg.charge.dmgMul) < 1e-9);
  assert.equal(dmgMul(st, "a", hook, false, false), 1);
});

test("movement comes first: a close-range card whiffs when the opponent retreats", () => {
  const st = at(2, ["cross", "jab", "jab", "jab"], JABS);
  const ev = playBeat(st, { card: 0 }, { move: "retreat" });
  assert.equal(st.dist, 1);
  const atk = ev.find((e) => e.t === "attack" && e.by === "a");
  assert.equal(atk.hit, false);
  assert.equal(atk.whiff, "range");
});

test("combo cards get stronger only after you landed last beat", () => {
  const st = fresh();
  const cross = data.cards.cross;
  const p0 = hitChance(st, "a", cross).p;
  st.a.landedLast = true;
  const p1 = hitChance(st, "a", cross);
  assert.ok(Math.abs(p1.p - (p0 + cfg.combo.hitBonus)) < 1e-9);
  assert.ok(p1.why.includes("combo"));
  assert.ok(Math.abs(dmgMul(st, "a", cross, false, false) - cfg.combo.dmgMul) < 1e-9);
  assert.equal(hitChance(st, "a", data.cards.jab).why.includes("combo"), false); // jab is not a combo card
});

test("counter card gets the bonus only when the opponent made that basic move", () => {
  const st = fresh();
  const up = data.cards.upper;
  const base = hitChance(st, "a", up, false, null).p;
  assert.ok(Math.abs(hitChance(st, "a", up, false, "advance").p - (base + cfg.hit.counterBonus)) < 1e-9);
  assert.equal(hitChance(st, "a", up, false, "retreat").p, base);
});

test("a feint opens a defending opponent, and does nothing against an attacker", () => {
  const st = at(1, ["fakejab", "jab", "jab", "jab"], JABS);
  const ev = playBeat(st, { card: 0 }, { move: "guard" });
  assert.equal(ev.find((e) => e.t === "feint").ok, true);
  assert.equal(st.b.open, 1);
  const st2 = at(1, ["fakejab", "jab", "jab", "jab"], ["jab", "jab", "jab", "jab"]);
  const ev2 = playBeat(st2, { card: 0 }, { card: 0 });
  assert.equal(ev2.find((e) => e.t === "feint").ok, false);
  assert.equal(st2.b.open, 0);
});

test("a trap is face-down for its owner, fires on the matching action and can cancel that strike", () => {
  const st = at(2, ["trapslip", "jab", "jab", "jab"], ["jab", "jab", "jab", "jab"]);
  playBeat(st, { card: 0 }, { move: "guard" });
  assert.ok(st.a.trap);
  // b throws a straight punch into it
  setHand(st, "b", ["cross", "jab", "jab", "jab"]);
  setHand(st, "a", ["jab", "jab", "jab", "jab"]);
  st.dist = 2;
  const head0 = st.b.head;
  const ev = playBeat(st, { move: "guard" }, { card: 0 });
  const tr = ev.find((e) => e.t === "trap");
  assert.ok(tr && tr.cancel);
  assert.equal(ev.find((e) => e.t === "attack" && e.by === "b").whiff, "trapped");
  assert.ok(st.b.head > head0);
  assert.equal(st.a.trap, null);
});

test("a trap expires after its beats and only one can be set", () => {
  const st = at(1, ["trapcounter", "trapcatch", "jab", "jab"], JABS);
  playBeat(st, { card: 0, hold: 1 }, { move: "guard" });
  assert.ok(st.a.trap);
  const acts = actions(st, "a").filter((a) => a.kind === "card" && data.cards[a.id].kind === "trap");
  assert.ok(acts.every((a) => !a.ok && a.why === "trap"));
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.equal(st.a.trap, null);
});

test("a push kick moves the opponent away when it lands", () => {
  for (let seed = 1; seed < 100; seed++) {
    const st = at(2, ["teep", "jab", "jab", "jab"], JABS, seed);
    const ev = playBeat(st, { card: 0 }, { move: "guard" });
    if (ev.find((e) => e.t === "attack" && e.by === "a").hit) {
      assert.equal(st.dist, 1);
      return;
    }
  }
  assert.fail("teep never landed");
});

test("an open opponent is easier to hit and a missed heavy card opens you", () => {
  const st = fresh();
  const cross = data.cards.cross;
  const p0 = hitChance(st, "a", cross).p;
  st.b.open = 1;
  assert.ok(Math.abs(hitChance(st, "a", cross).p - (p0 + cfg.hit.openBonus)) < 1e-9);
  for (let seed = 1; seed < 200; seed++) {
    const s2 = at(2, ["hook", "jab", "jab", "jab"], JABS, seed);
    const ev = playBeat(s2, { card: 0 }, { move: "guard" });
    if (!ev.find((e) => e.t === "attack" && e.by === "a").hit) {
      assert.equal(s2.a.open, 1);
      return;
    }
  }
  assert.fail("hook never missed");
});

test("you cannot play a card you cannot afford", () => {
  const st = at(2, ["flurry", "jab", "jab", "jab"], JABS);
  st.a.stamina = 1;
  assert.throws(() => playBeat(st, { card: 0 }, { move: "guard" }));
});

test("knockdown: three knockdowns is a TKO; a chase can finish", () => {
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

test("bouts end, judges read three cards", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { st } = fight("holloway", "poirier", seed);
    assert.ok(st.over);
    if (st.over.cards) assert.equal(st.over.cards.length, cfg.scoring.judges);
  }
});

test("invariants hold over many random bouts (masher vs masher)", () => {
  for (let seed = 1; seed <= 60; seed++) fight("holloway", "poirier", seed, createMasher, createMasher);
});

test("every card property comes from the JSON", () => {
  for (const id of cardIds(data)) {
    const c = data.cards[id];
    assert.ok(["strike", "feint", "trap"].includes(c.kind), id);
    assert.ok(c.text && c.text.length <= 14, `${id} text too long for the card face`);
    if (c.kind === "strike") assert.ok(["head", "body", "leg"].includes(c.region) && c.hit > 0 && c.dmg > 0, id);
    if (c.kind === "trap") assert.ok(c.trap.on.move || c.trap.on.tag, id);
  }
  for (const f of ["holloway", "poirier"]) for (const k of Object.keys(data.fighters[f].weights)) assert.ok(data.cards[k], `${f} weights unknown card ${k}`);
});
