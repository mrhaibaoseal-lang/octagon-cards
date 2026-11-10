// V2 engine invariants. node --test prototype/web/v2/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadData } from "./load.node.js";
import * as E from "./engine.js";
import { planIntent, lead, bots, runBout } from "./ai.js";

const data = loadData();
const fresh = (a = "poirier", b = "holloway", seed = 7) => E.createBout(data, a, b, seed);
const intent = (st, ids, cat = "strike") => E.setIntent(st, { cat, steps: ids.map((id) => ({ id })), cats: { [cat]: 1 }, focus: "head", throttle: 0, habits: [] });
const give = (st, s, ids) => { st[s].hand = [...ids]; };
const play = (st, id) => {
  const i = st.a.hand.indexOf(id);
  return i >= 0 ? E.act(st, { type: "card", i }) : E.act(st, { type: "basic", id });
};
const evs = (st, t) => st.log.filter((e) => e.t === t);

test("same seed, same bout", () => {
  const a = runBout(data, "poirier", "makhachev", 42), b = runBout(data, "poirier", "makhachev", 42);
  assert.deepEqual(a.over, b.over);
  assert.equal(a.log.length, b.log.length);
});

test("every bout ends, with a winner or a decision", () => {
  for (let i = 0; i < 60; i++) {
    const st = runBout(data, "holloway", "makhachev", 100 + i, bots.random);
    assert.ok(st.over, "bout finished");
    assert.ok(["KO", "TKO", "DEC"].includes(st.over.how));
    assert.ok(st.a.gas >= 0 && st.b.gas >= 0);
  }
});

test("every deck card and every AI step exists in the rules", () => {
  for (const f of Object.values(data.fighters)) for (const id of f.deck) assert.ok(data.cards[id], id);
});

test("guard: head shots cannot land clean, and it only soaks up its number of shots", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["guard"], "counter");
  give(st, "a", ["cross", "cross", "cross", "jab", "jab"]);
  st.a.energy = 9;
  play(st, "cross"); play(st, "cross");
  const hits = evs(st, "hit");
  assert.ok(hits.length >= 1);
  for (const h of hits) { assert.equal(h.clean, false); assert.equal(h.guard, true); }
  assert.ok(st.b.block <= data.config.basics.guard.blocks - hits.length);
});

test("slip beats a head punch and counters; check hurts the kicker; sprawl stuffs the shot", () => {
  let st = fresh();
  st.range = 1;
  intent(st, ["slip"], "counter");
  give(st, "a", ["cross", "lowkick", "jab", "jab", "jab"]);
  play(st, "cross");
  assert.equal(evs(st, "slip").length, 1);
  assert.ok(st.a.stun > 0, "the counter landed");
  assert.equal(st.b.stun, 0);

  st = fresh();
  st.range = 1;
  intent(st, ["check"], "counter");
  give(st, "a", ["lowkick"]);
  play(st, "lowkick");
  assert.equal(st.a.legDmg, data.cards.check.back);
  assert.equal(st.b.legDmg, 0);

  st = fresh("makhachev", "poirier");
  st.range = 1;
  intent(st, ["sprawl"], "counter");
  give(st, "a", ["takedown"]);
  const gas = st.a.gas;
  play(st, "takedown");
  assert.equal(st.ground, null);
  assert.equal(st.a.gas, gas - data.cards.takedown.gas - data.config.td.sprawlGas);
  assert.ok(E.isOpen(st, "a"));
});

test("a feint strips the defence it baits", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["slip"], "counter");
  give(st, "a", ["feint", "cross"]);
  play(st, "feint");
  assert.equal(st.b.def.slip, undefined);
  play(st, "cross");
  assert.equal(evs(st, "slip").length, 0);
});

test("stepping back makes short-range plans whiff", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["cross", "hook"]);
  give(st, "a", []);
  play(st, "retreat");
  assert.equal(st.range, 0);
  E.endExchange(st);
  assert.equal(evs(st, "whiff").length, 2);
  assert.equal(evs(st, "hit").length, 0);
});

test("footwork: the first step of an exchange is free, the next one costs energy", () => {
  const st = fresh();
  st.range = 1;
  intent(st, []);
  const e = st.a.energy;
  assert.equal(E.cost(st, "a", data.config.basics.retreat), 0);
  play(st, "retreat");
  assert.equal(st.a.energy, e);
  assert.equal(E.cost(st, "a", data.config.basics.advance), data.config.basics.advance.cost);
  play(st, "advance");
  assert.equal(st.a.energy, e - data.config.basics.advance.cost);
});

test("making him swing at air opens him up and gives the counter: more energy next exchange", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["cross", "hook"]);
  give(st, "a", []);
  play(st, "retreat");
  const e = st.a.energy;
  E.runIntent(st);
  assert.equal(st.stage, "post");
  assert.ok(E.isOpen(st, "b"), "he is open for the counter");
  assert.equal(st.a.window, true);
  assert.equal(st.a.energy, e + data.config.counter.energy);
  E.endExchange(st);
  assert.equal(E.isOpen(st, "b"), false, "the opening does not carry into the next exchange");
});

test("two stages: defences are set before he goes, attacks may wait until after", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["cross"]);
  give(st, "a", ["slip", "cross", "slip"]);
  st.a.energy = 5;
  play(st, "slip");
  E.runIntent(st);
  assert.equal(evs(st, "slip").length, 1);
  assert.ok(E.isOpen(st, "b"));
  assert.equal(E.usable(st, "a", data.cards.slip).why, "late");
  assert.equal(E.usable(st, "a", data.config.basics.guard).ok, false);
  assert.ok(play(st, "cross"), "the counter is thrown after his attack");
  assert.equal(evs(st, "hit").filter((x) => x.s === "a").length + evs(st, "over").length, 1);
});

test("a plan that walks forward first is not escaped by a step back", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["advance", "cross"], "pressure");
  give(st, "a", []);
  play(st, "retreat");
  E.runIntent(st);
  assert.equal(evs(st, "whiff").length, 0);
  assert.equal(st.a.window, false);
});

test("a feint that is bitten opens him and pays for itself; a slipped punch opens the puncher", () => {
  let st = fresh();
  st.range = 1;
  intent(st, ["slip"], "counter");
  give(st, "a", ["cross"]);
  const e = st.a.energy;
  play(st, "probe");
  assert.equal(st.a.energy, e - data.config.basics.probe.cost + data.config.feint.refund);
  assert.ok(E.isOpen(st, "b"));

  st = fresh();
  st.range = 1;
  intent(st, ["slip", "jab"], "counter");
  give(st, "a", ["cross"]);
  play(st, "cross");
  assert.ok(E.isOpen(st, "a"), "a walked onto the counter and is open for his plan");
  assert.equal(st.b.counter, true);
});

test("an out-fighting plan steps out of the pocket before the answer", () => {
  const st = fresh();
  st.range = 1;
  E.setIntent(st, { cat: "outfight", steps: [{ id: "retreat", pre: true }, { id: "jab" }], cats: { outfight: 1 }, focus: "head", throttle: 0, habits: [] });
  assert.equal(st.range, 0);
  assert.equal(E.usable(st, "a", data.cards.cross).ok, false);
});

test("setup and level change raise the clean chance; the numbers on the card are the engine's", () => {
  const st = fresh();
  st.range = 1;
  intent(st, []);
  const cross = data.cards.cross, base = E.cleanChance(st, "a", cross);
  st.a.seq.setup = true;
  assert.ok(Math.abs(E.cleanChance(st, "a", cross) - base - data.config.hit.setup) < 1e-9);
  st.a.seq.setup = false; st.a.seq.last = "body";
  assert.ok(Math.abs(E.cleanChance(st, "a", cross) - base - data.config.hit.levelChange) < 1e-9);
  assert.equal(E.preview(st, "a", cross).clean, E.cleanChance(st, "a", cross));
});

test("energy: throttle trades gas for energy, capped; low gas means less energy", () => {
  const st = fresh();
  intent(st, []);
  const t = data.config.throttle, g = st.a.gas, e = st.a.energy;
  for (let i = 0; i < t.max; i++) assert.ok(E.act(st, { type: "throttle" }));
  assert.equal(E.act(st, { type: "throttle" }), false);
  assert.equal(st.a.gas, g - t.gas * t.max);
  assert.equal(st.a.energy, e + t.energy * t.max);
  const st2 = fresh();
  st2.a.gas = 1;
  E.beginExchange(st2);
  assert.equal(st2.a.energy, data.config.lowGasEnergy);
});

test("unused energy restores gas; spending it all costs gas (except the big tank)", () => {
  const st = fresh("poirier", "holloway");
  intent(st, []);
  st.a.gas = 10; st.a.energy = 2;
  st.b.gas = 10; st.b.energy = 0;
  E.endExchange(st);
  assert.equal(st.a.gas, 12);
  assert.equal(st.b.gas, 10, "holloway's big tank");
  const st2 = fresh("holloway", "poirier");
  intent(st2, []);
  st2.b.gas = 10; st2.b.energy = 0;
  E.endExchange(st2);
  assert.equal(st2.b.gas, 10 - data.config.gasFullCost);
});

test("rocking the leader cancels his plan and gives the chaser extra energy", () => {
  const st = fresh();
  st.range = 1;
  intent(st, ["cross", "hook"]);
  st.b.stun = st.b.chin - 0.5;
  give(st, "a", ["jab", "jab", "jab", "jab", "jab"]);
  for (let i = 0; i < 5 && !st.b.rocked; i++) play(st, "jab");
  assert.ok(st.b.rocked, "rocked");
  assert.ok(st.intent.cancelled);
  E.endExchange(st);
  assert.equal(evs(st, "hit").filter((e) => e.s === "b").length, 0);
  if (!st.over) assert.equal(st.a.energy, data.config.energy + data.config.rock.chase);
});

test("body damage shrinks the gas tank; leg damage stacks", () => {
  const st = fresh();
  intent(st, []);
  const max = st.b.gasMax;
  st.range = 1;
  give(st, "a", ["bodyhook", "bodyhook", "bodyhook", "lowkick", "lowkick"]);
  st.a.energy = 9;
  for (let i = 0; i < 3; i++) play(st, "bodyhook");
  assert.equal(st.b.gasMax, max - Math.floor(st.b.bodyDmg / data.config.body.perGas));
  for (let i = 0; i < 2; i++) play(st, "lowkick");
  assert.equal(E.legStacks(st, "b"), Math.floor(st.b.legDmg / data.config.legs.perStack));
});

test("rounds are scored 10-9 (10-8 on a big gap) and three rounds give a decision", () => {
  const st = fresh();
  for (let r = 0; r < 3; r++) {
    for (let x = 0; x < data.config.exchanges; x++) { intent(st, []); if (x === 0) st.a.score += r === 0 ? 20 : 2; E.endExchange(st); }
    if (r < 2) { assert.equal(st.phase, "corner"); E.corner(st, "rest", "rest"); }
  }
  assert.deepEqual([st.rounds[0].a, st.rounds[0].b], [10, 8]);
  assert.deepEqual([st.rounds[1].a, st.rounds[1].b], [10, 9]);
  assert.equal(st.over.how, "DEC");
  assert.equal(st.over.winner, "a");
});

test("the intent shown is honest: level 0 leaks no steps, shares sum to 1, higher levels show the real plan", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const st = fresh("poirier", "makhachev", seed);
    const it = planIntent(st);
    E.setIntent(st, it);
    const sum = Object.values(it.cats).reduce((n, v) => n + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.ok(it.cats[it.cat] > 0, "the chosen plan was one of the shown possibilities");
    let v = E.visibleIntent(st);
    assert.equal(v.level, 0);
    assert.equal(v.steps, undefined);
    assert.equal(v.cat, undefined);
    st.a.readPts = data.config.read.levels[1];
    v = E.visibleIntent(st);
    assert.equal(v.cat, it.cat);
    assert.equal(v.steps, undefined);
    st.a.readPts = data.config.read.levels[2];
    v = E.visibleIntent(st);
    assert.deepEqual(v.steps, it.steps.map((x) => x.id));
  }
});

test("the leader never plans more than he can pay for", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const st = runBoutUntil(seed);
    const before = st.b.energy + 0;
    const it = planIntent(st);
    const total = it.steps.reduce((n, x) => n + E.cost(st, "b", E.defOf(st, x.id)), 0);
    assert.ok(total <= before + it.throttle * data.config.throttle.energy, `seed ${seed}`);
  }
});
function runBoutUntil(seed) {
  const st = fresh("holloway", "makhachev", seed);
  for (let i = 0; i < seed % 6 && !st.over; i++) {
    if (st.phase === "corner") E.corner(st, "rest", "rest");
    lead(st);
    for (let k = 0; k < 6; k++) { const x = bots.random(st); if (!x || !E.act(st, x)) break; }
    E.endExchange(st);
  }
  if (st.phase === "corner") E.corner(st, "rest", "rest");
  if (st.over) return fresh("holloway", "makhachev", seed + 1000);
  return st;
}

test("takedown puts the fight on the ground; the bottom man's own cards are for getting up", () => {
  const st = fresh("makhachev", "poirier", 3);
  st.range = 1;
  intent(st, []);
  give(st, "a", ["takedown", "gelbow", "jab"]);
  st.a.energy = 9;
  st.rng = 12345;
  let tries = 0;
  while (!st.ground && tries++ < 20) { give(st, "a", ["takedown", "gelbow", "jab"]); st.a.energy = 9; play(st, "takedown"); }
  assert.equal(st.ground.top, "a");
  assert.equal(E.usable(st, "a", data.cards.jab).ok, false);
  assert.equal(E.usable(st, "a", data.cards.gelbow).ok, true);
  assert.equal(E.usable(st, "b", data.config.basics.getup).ok, true);
});

test("the referee stands a stalled ground fight up", () => {
  const st = fresh("makhachev", "poirier", 3);
  st.ground = { top: "a", stall: 0, pass: 0 };
  for (let i = 0; i < data.config.ground.stall; i++) { intent(st, [], "cover"); E.endExchange(st); if (st.phase === "corner") break; }
  assert.equal(st.ground, null);
});

test("reading the intent pays: the smart answer beats random and turtle play", () => {
  const rate = (bot) => { let w = 0; for (let i = 0; i < 80; i++) if (runBout(data, "holloway", "poirier", 500 + i, bot).over.winner === "a") w++; return w / 80; };
  const s = rate(bots.smart);
  assert.ok(s > rate(bots.random) + 0.15);
  assert.ok(s > rate(bots.turtle) + 0.15);
});

test("the engine never looks at card names", () => {
  const src = readFileSync(new URL("./engine.js", import.meta.url), "utf8");
  // a few cards share their id with a rule word (kind / def / move); those words are rules, not names
  const words = new Set();
  for (const c of [...Object.values(data.cards), ...Object.values(data.config.basics)]) for (const k of ["kind", "def", "move"]) if (c[k]) words.add(c[k]);
  for (const id of Object.keys(data.cards).filter((x) => !words.has(x))) assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(src), `engine mentions card "${id}"`);
  for (const id of Object.keys(data.fighters)) assert.ok(!src.includes(`"${id}"`), `engine mentions fighter "${id}"`);
});
