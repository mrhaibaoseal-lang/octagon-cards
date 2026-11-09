// node --test prototype/web/bout/test.js — rules of the card bout engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createBout, playBeat, settleKnockdown, actions, odds, dmgMul, heldCard, cardIds } from "./engine.js";
import { data, fight } from "./sim.js";
import { createMasher } from "./ai.js";

const cfg = data.config;
const fresh = (seed = 1) => createBout(data, "holloway", "poirier", seed);
const setHand = (st, s, ids, charged = -1) => { st[s].hand = ids.map((id, i) => ({ id, charged: i === charged })); };
const at = (dist, a, b, seed = 1) => { const st = fresh(seed); st.dist = dist; setHand(st, "a", a); setHand(st, "b", b); return st; };
const JABS = ["jab", "jab", "lowkick", "lowkick"];
const near = (x, y) => Math.abs(x - y) < 1e-9;

test("a bout starts with a fresh hand of handDraw cards", () => {
  const st = fresh();
  assert.equal(st.a.hand.length, cfg.handDraw);
  assert.equal(heldCard(st, "a"), null);
});

test("same seed gives the same bout", () => {
  const x = fight("holloway", "poirier", 77);
  const y = fight("holloway", "poirier", 77);
  assert.equal(x.beats, y.beats);
  assert.deepEqual(x.st.over, y.st.over);
});

test("most strikes land: an undefended strike touches about 1 - baseMiss of the time", () => {
  let landed = 0, n = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = at(1, ["jab", "jab", "jab", "jab"], ["fakejab", "jab", "jab", "jab"], seed);
    const ev = playBeat(st, { card: 0 }, { card: 0 }); // b feints: no defense
    n++;
    if (ev.find((e) => e.t === "attack" && e.by === "a").hit) landed++;
  }
  assert.ok(Math.abs(landed / n - (1 - cfg.hit.baseMiss)) < 0.05, `landed ${landed / n}`);
});

test("a landed strike is either clean (full damage) or a graze (a fraction)", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200 && seen.size < 2; seed++) {
    const st = at(2, ["cross", "jab", "jab", "jab"], ["fakejab", "jab", "jab", "jab"], seed);
    const ev = playBeat(st, { card: 0 }, { card: 0 });
    const e = ev.find((x) => x.t === "attack" && x.by === "a");
    if (!e.hit) continue;
    const full = data.cards.cross.dmg * data.fighters.holloway.power;
    seen.add(e.quality);
    if (e.quality === "clean") assert.ok(Math.abs(e.dmg - full) < 0.11);
    else assert.ok(Math.abs(e.dmg - full * cfg.hit.grazeMul) < 0.11);
  }
  assert.equal(seen.size, 2);
});

test("a step lets you use a card from the next distance; out-of-range cards stay grey", () => {
  const st = at(1, ["cross", "dirty", "jab", "jab"], JABS);
  const now = actions(st, "a", 0).filter((a) => a.kind === "card");
  const stepIn = actions(st, "a", 1).filter((a) => a.kind === "card");
  assert.equal(now[0].ok, false); // cross needs 近
  assert.equal(stepIn[0].ok, true);
  assert.equal(stepIn[1].ok, false); // dirty needs 纏抱
  assert.throws(() => playBeat(st, { card: 0 }, { move: "guard" }), /out of range/);
  playBeat(st, { card: 0, step: 1 }, { move: "guard" });
  assert.equal(st.dist, 2);
});

test("only a full retreat makes a strike miss on range; the opponent's card-step does not", () => {
  const st = at(2, ["cross", "jab", "jab", "jab"], JABS);
  const ev = playBeat(st, { card: 0 }, { move: "retreat" });
  assert.equal(ev.find((e) => e.t === "attack" && e.by === "a").whiff, "range");
  let ranged = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const s2 = at(2, ["cross", "jab", "jab", "jab"], ["jab", "jab", "jab", "jab"], seed);
    const e2 = playBeat(s2, { card: 0 }, { card: 0, step: -1 }).find((e) => e.t === "attack" && e.by === "a");
    if (e2.whiff === "range") ranged++;
  }
  assert.equal(ranged, 0);
});

test("every beat unplayed cards go away except the held one, which is charged and public", () => {
  const st = at(1, ["jab", "cross", "hook", "lowkick"], JABS);
  playBeat(st, { card: 0, hold: 2 }, { move: "guard" });
  assert.equal(st.a.hand[0].id, "hook");
  assert.equal(st.a.hand[0].charged, true);
  assert.equal(heldCard(st, "a"), "hook");
  assert.equal(st.a.hand.length, cfg.handDraw + 1);
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.equal(heldCard(st, "a"), null);
  assert.ok(near(dmgMul(st, "a", data.cards.hook, true, false), cfg.charge.dmgMul));
});

test("combo, opening and counter raise the clean chance by their configured bonus", () => {
  const st = fresh();
  st.dist = 2;
  const cross = data.cards.cross;
  const base = odds(st, "a", cross, { d: 2 }).clean;
  st.a.landedLast = true;
  assert.ok(near(odds(st, "a", cross, { d: 2 }).clean, Math.min(cfg.hit.cleanMax, base + cfg.combo.hitBonus)));
  st.a.landedLast = false;
  st.b.open = 1;
  assert.ok(near(odds(st, "a", cross, { d: 2 }).clean, Math.min(cfg.hit.cleanMax, base + cfg.hit.openBonus)));
  st.b.open = 0;
  const up = data.cards.upper;
  const u0 = odds(st, "a", up, { d: 2 }).clean;
  assert.ok(near(odds(st, "a", up, { d: 2, opp: { step: 1 } }).clean, u0 + cfg.hit.counterBonus));
  assert.ok(near(odds(st, "a", up, { d: 2, opp: { move: "advance" } }).clean, u0 + cfg.hit.counterBonus));
});

test("a fighter's favourite range raises clean hits", () => {
  const st = fresh();
  const jab = data.cards.jab;
  const rb = data.fighters.holloway.rangeBonus;
  const [hi, lo] = jab.range.slice().sort((x, y) => (rb[y] || 0) - (rb[x] || 0));
  assert.ok((rb[hi] || 0) > (rb[lo] || 0), "test needs two jab distances with different bonuses");
  assert.ok(odds(st, "a", jab, { d: hi }).clean > odds(st, "a", jab, { d: lo }).clean);
});

test("a feint opens a defending opponent, and does nothing against an attacker", () => {
  const st = at(1, ["fakejab", "jab", "jab", "jab"], JABS);
  playBeat(st, { card: 0 }, { move: "guard" });
  assert.equal(st.b.open, 1);
  const st2 = at(1, ["fakejab", "jab", "jab", "jab"], JABS);
  const ev2 = playBeat(st2, { card: 0 }, { card: 0 });
  assert.equal(ev2.find((e) => e.t === "feint").ok, false);
  assert.equal(st2.b.open, 0);
});

test("a trap is set as a side action (you still act), then fires: clean hit, cancel, and an opening", () => {
  const st = at(2, ["trapslip", "jab", "jab", "jab"], JABS);
  const ev = playBeat(st, { card: 1, trap: 0 }, { move: "guard" });
  assert.ok(st.a.trap);
  assert.ok(ev.find((e) => e.t === "attack" && e.by === "a")); // the jab was still thrown
  setHand(st, "b", ["cross", "jab", "jab", "jab"]);
  setHand(st, "a", ["jab", "jab", "jab", "jab"]);
  st.dist = 2;
  const head0 = st.b.head;
  const ev2 = playBeat(st, { move: "guard" }, { card: 0 });
  const tr = ev2.find((e) => e.t === "trap");
  assert.ok(tr && tr.cancel);
  assert.equal(ev2.find((e) => e.t === "attack" && e.by === "b").whiff, "trapped");
  assert.ok(st.b.head > head0);
  assert.equal(st.b.open, 1);
  assert.equal(st.a.trap, null);
});

test("a counter trap fires when the opponent steps in with a card", () => {
  const st = at(1, ["trapcounter", "jab", "jab", "jab"], JABS);
  playBeat(st, { move: "guard", trap: 0 }, { move: "guard" });
  setHand(st, "b", ["cross", "jab", "jab", "jab"]);
  st.dist = 1;
  const ev = playBeat(st, { move: "guard" }, { card: 0, step: 1 });
  assert.ok(ev.find((e) => e.t === "trap"));
});

test("a trap lasts its beats and only one can be set", () => {
  const st = at(1, ["trapcounter", "trapcatch", "jab", "jab"], JABS);
  playBeat(st, { move: "guard", trap: 0, hold: 1 }, { move: "guard" });
  const left = actions(st, "a").filter((a) => a.kind === "card" && data.cards[a.id].kind === "trap");
  assert.ok(left.every((a) => !a.ok && a.why === "trap"));
  for (let i = 0; i < data.cards.trapcounter.trap.beats; i++) {
    assert.ok(st.a.trap, `still set after ${i} beats`);
    playBeat(st, { move: "guard" }, { move: "guard" });
  }
  assert.equal(st.a.trap, null);
});

test("traps are never the main action", () => {
  const st = at(1, ["trapslip", "jab", "jab", "jab"], JABS);
  assert.throws(() => playBeat(st, { card: 0 }, { move: "guard" }), /traps are set/);
});

test("a missed heavy card opens you", () => {
  for (let seed = 1; seed < 400; seed++) {
    const s2 = at(2, ["hook", "jab", "jab", "jab"], JABS, seed);
    const ev = playBeat(s2, { card: 0 }, { move: "sidestep" });
    if (!ev.find((e) => e.t === "attack" && e.by === "a").hit) {
      assert.equal(s2.a.open, 1);
      return;
    }
  }
  assert.fail("hook never missed");
});

test("a clean push kick moves the opponent away", () => {
  for (let seed = 1; seed < 200; seed++) {
    const st = at(2, ["teep", "jab", "jab", "jab"], JABS, seed);
    const ev = playBeat(st, { card: 0 }, { move: "guard" });
    if (ev.find((e) => e.t === "attack" && e.by === "a").quality === "clean") {
      assert.equal(st.dist, 1);
      return;
    }
  }
  assert.fail("teep never landed clean");
});

test("you cannot spend stamina you do not have", () => {
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
  const st2 = fresh(9);
  st2.pending = { by: "a", down: "b" };
  settleKnockdown(st2, true);
  assert.ok(st2.over || st2.beat >= 1);
});

test("bouts end and judges read three cards", () => {
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
    if (c.kind === "trap") assert.ok((c.trap.on.move || c.trap.on.tag) && c.trap.beats > 0, id);
  }
  for (const f of ["holloway", "poirier"]) for (const k of Object.keys(data.fighters[f].weights)) assert.ok(data.cards[k], `${f} weights unknown card ${k}`);
});
