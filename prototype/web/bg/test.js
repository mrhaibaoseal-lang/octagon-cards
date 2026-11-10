// Battlegrounds-mode engine invariants. node --test prototype/web/bg/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadData } from "./load.node.js";
import * as E from "./engine.js";
import { shoppers, runGame } from "./ai.js";

const data = loadData();
const fresh = (a = "poirier", b = "holloway", seed = 3) => E.createGame(data, a, b, seed);
const set = (st, s, list) => { st[s].board = Array(st.cfg.slots).fill(null); list.forEach((x, i) => { const [id, lv] = x.split(":"); st[s].board[i] = { id, lv: Number(lv) || 1 }; }); };
const evs = (st, t) => st.log.filter((e) => e.t === t);

test("same seed, same bout; every bout ends", () => {
  const a = runGame(data, "poirier", "makhachev", 11), b = runGame(data, "poirier", "makhachev", 11);
  assert.deepEqual(a.over, b.over);
  assert.equal(a.log.length, b.log.length);
  for (let i = 0; i < 40; i++) { const st = runGame(data, "holloway", "poirier", 50 + i, shoppers.random); assert.ok(st.over); assert.ok(["KO", "TKO", "DEC"].includes(st.over.how)); }
});

test("every start board and opponent build uses real skills, within the slot count", () => {
  for (const f of Object.values(data.fighters)) for (const list of [f.start, ...f.builds]) {
    assert.ok(list.length <= data.config.slots);
    for (const x of list) assert.ok(data.skills[x.split(":")[0]], x);
  }
  assert.equal(Object.values(data.fighters)[0].builds.length, data.config.rounds);
});

test("shop: buying costs gold, a duplicate merges into a level, a full board refuses, selling refunds", () => {
  const st = fresh();
  st.shop.gold = 20;
  st.shop.offers = ["jab", "lowkick", "slip", "check"];
  assert.ok(E.buy(st, 0));
  assert.equal(st.a.board.find((c) => c && c.id === "jab").lv, 2, "merged");
  assert.equal(st.shop.gold, 20 - data.config.shop.cost);
  assert.ok(E.buy(st, 1)); assert.ok(E.buy(st, 2)); assert.ok(E.buy(st, 3));
  assert.equal(st.a.board.filter(Boolean).length, 5);
  st.shop.offers = ["cardio"];
  assert.equal(E.buy(st, 0), false, "no room");
  const g = st.shop.gold;
  assert.ok(E.sell(st, 4));
  assert.equal(st.shop.gold, g + data.config.shop.sell);
  assert.ok(E.buy(st, 0));
  st.shop.gold = 0; st.shop.offers = ["cross"];
  assert.equal(E.buy(st, 0), false, "no gold");
});

test("shop: a higher tier is needed for stronger skills; passives change the stats at once", () => {
  const st = fresh();
  for (let i = 0; i < 30; i++) { st.shop.gold = 9; E.reroll(st); for (const id of st.shop.offers) assert.ok(data.skills[id].tier <= 1); }
  st.shop.gold = 99;
  assert.ok(E.tierUp(st));
  assert.equal(st.shop.tier, 2);
  const g = E.gasMaxOf(st, "a");
  st.shop.offers = ["cardio"];
  E.buy(st, 0);
  assert.equal(E.gasMaxOf(st, "a"), g + data.skills.cardio.gas);
});

test("fight: boards fire left to right, the two sides alternating; an empty or passive slot takes no turn", () => {
  const st = fresh();
  set(st, "a", ["jab", "cardio", "cross"]); set(st, "b", ["lowkick"]);
  E.startRound(st);
  const order = [];
  for (let i = 0; i < 3; i++) { const u = E.upcoming(st); order.push(u.s + u.c.id); E.step(st); }
  assert.deepEqual(order, ["ajab", "blowkick", "across"]);
});

test("fight: a matching defence stops the strike and counters, once per exchange", () => {
  const st = fresh();
  set(st, "a", ["cross", "cross"]); set(st, "b", ["slip"]);
  E.startRound(st);
  E.step(st); E.step(st);
  assert.equal(evs(st, "block").length, 1);
  assert.equal(evs(st, "counter").length, 1);
  assert.ok(st.a.stun > 0);
  assert.equal(evs(st, "hit").filter((e) => e.s === "a").length, 1, "the second cross gets through");
});

test("fight: a skill with no gas fizzles; a takedown stops the rest of his exchange and enables ground strikes", () => {
  let st = fresh();
  set(st, "a", ["hook"]); set(st, "b", []);
  E.startRound(st);
  st.a.gas = 0;
  E.step(st);
  assert.equal(evs(st, "tired").length, 1);
  st = fresh("makhachev", "poirier");
  set(st, "a", ["shot", "gnp"]); set(st, "b", ["jab", "cross"]);
  E.startRound(st);
  st.a.f = { ...st.a.f, wrestle: 5 };
  E.step(st);
  assert.equal(evs(st, "takedown")[0].ok, true);
  const u = E.upcoming(st);
  assert.equal(u.s + u.c.id, "agnp", "his jab and cross are skipped; the ground strike fires");
});

test("timing bar: only for a heavy strike that nothing blocks, once a round; perfect negates it and counters", () => {
  const st = fresh();
  set(st, "a", []); set(st, "b", ["highkick:2", "highkick:2"]);
  E.startRound(st);
  assert.ok(E.needsReact(st));
  E.step(st, "perfect");
  assert.equal(evs(st, "react").length, 1);
  assert.equal(st.a.stun, 0);
  assert.ok(st.b.stun > 0);
  assert.equal(E.needsReact(st), null, "once a round");
  const st2 = fresh();
  set(st2, "a", ["check"]); set(st2, "b", ["highkick:2"]);
  E.startRound(st2);
  assert.equal(E.needsReact(st2), null, "the check already stops it");
});

test("the numbers on a card are the ones the engine uses", () => {
  const st = fresh();
  set(st, "a", ["cross:2"]); set(st, "b", []);
  const v = E.view(st, "a", st.a.board[0]);
  assert.equal(v.dmg, (data.skills.cross.dmg * data.config.levelMul[1] + st.a.f.bonus.dmg) * st.a.f.power);
  E.startRound(st);
  let clean = null;
  for (let i = 0; i < 20 && !clean; i++) { E.step(st); clean = evs(st, "hit").find((e) => e.clean); st.a.gas = 9; }
  assert.equal(clean.dmg, v.dmg);
});

test("the engine never looks at skill names", () => {
  const src = readFileSync(new URL("./engine.js", import.meta.url), "utf8");
  for (const id of Object.keys(data.skills)) assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(src), id);
});
