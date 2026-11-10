// One-on-one board battler engine invariants. node --test prototype/web/bg/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadData } from "./load.node.js";
import * as E from "./engine.js";
import { shop, shoppers, runGame } from "./ai.js";

const data = loadData();
const fresh = (a = "holloway", b = "makhachev", seed = 3) => E.createGame(data, a, b, seed);
const put = (st, s, ids) => { st[s].board = Array(st.cfg.slots).fill(null); ids.forEach((id, i) => { if (id) st[s].board[i] = E.make(st, id); }); };
const offer = (st, s, ids) => { st[s].shop.offers = [...ids]; st[s].shop.gold = 99; };
const evs = (st, t) => st.log.filter((e) => e.t === t);
const run = (st) => { E.startClash(st); let n = 0; while (st.phase === "clash" && n++ < 500) E.step(st); };

test("same seed, same bout; every bout ends by KO or decision", () => {
  const a = runGame(data, "poirier", "makhachev", 11), b = runGame(data, "poirier", "makhachev", 11);
  assert.deepEqual(a.over, b.over);
  assert.equal(a.log.length, b.log.length);
  for (let i = 0; i < 40; i++) {
    const st = runGame(data, "holloway", "poirier", 50 + i, shoppers.random);
    assert.ok(st.over && ["KO", "DEC"].includes(st.over.how));
    assert.ok(st.turn <= data.config.rounds * data.config.clashes);
  }
});

test("every card has a school, a tier the shop can reach, and only known keywords and effects", () => {
  const kws = ["guard", "slip", "flurry", "sweep", "sub", "takedown", "sprawl", "getup", "ground", "combo", "reach"], whens = ["play", "buy", "start", "hit", "break", "win"];
  for (const d of Object.values(data.skills)) {
    assert.ok(["punch", "kick", "grap", "def"].includes(d.school), d.id);
    assert.ok(d.tier >= 1 && d.tier <= data.config.shop.maxTier, d.id);
    for (const k of d.kw) assert.ok(kws.includes(k), d.id + " " + k);
    for (const x of d.fx) assert.ok(whens.includes(x.when), d.id + " " + x.when);
  }
});

test("shop: gold grows each turn up to the cap; buying, selling, rerolling and tiering cost what the rules say", () => {
  const st = fresh(), c = data.config;
  assert.equal(st.a.shop.gold, c.gold.start);
  assert.equal(st.a.shop.offers.length, c.shop.offers[1]);
  assert.ok(E.buy(st, "a", 0));
  assert.equal(st.a.shop.gold, c.gold.start - c.shop.cost);
  assert.equal(E.buy(st, "a", 1), false, "not enough gold left");
  assert.ok(E.sell(st, "a", st.a.board.findIndex(Boolean)));
  assert.equal(st.a.shop.gold, c.gold.start - c.shop.cost + c.shop.sell);
  assert.ok(E.reroll(st, "a"));
  st.a.shop.gold = 99;
  const up = st.a.shop.upCost;
  assert.ok(E.tierUp(st, "a"));
  assert.equal(st.a.shop.gold, 99 - up);
  assert.equal(st.a.shop.tier, 2);
  st.turn = 30;
  assert.equal(E.goldFor(st, "a"), c.gold.cap);
});

test("shop: each side has its own offers and only draws cards of its tier or lower; a frozen shop is kept", () => {
  const st = fresh();
  for (let i = 0; i < 20; i++) { st.a.shop.gold = 9; E.reroll(st, "a"); for (const id of st.a.shop.offers) assert.equal(data.skills[id].tier, 1); }
  const keep = [...st.a.shop.offers];
  E.freeze(st, "a");
  put(st, "a", ["cross"]); put(st, "b", ["cross"]);
  run(st);
  assert.deepEqual(st.a.shop.offers, keep);
  assert.equal(st.a.shop.frozen, false, "frozen for one turn only");
});

test("three of a kind fold into one golden card with doubled stats that keeps the buffs, and earn a pick from the next tier", () => {
  const st = fresh("poirier");
  offer(st, "a", ["cross", "cross", "cross"]);
  E.buy(st, "a", 0); E.buy(st, "a", 1);
  assert.equal(E.place(st, "a", "cross").triple, true);
  E.buy(st, "a", 2);
  const cards = st.a.board.filter(Boolean), d = data.skills.cross, plus = st.a.f.power.fx[0].atk;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].gold, true);
  assert.equal(cards[0].atk, d.atk * 2 + plus * 3, "Poirier's +1 on each of the three is kept");
  assert.equal(cards[0].hp, d.hp * 2);
  assert.equal(st.a.discover.length, data.config.shop.discover);
  for (const id of st.a.discover) assert.equal(data.skills[id].tier, 2);
  assert.equal(E.buy(st, "a", 0), false, "must take the reward first");
  assert.ok(E.pick(st, "a", 0));
  assert.equal(st.a.discover, null);
  assert.equal(st.a.board.filter(Boolean).length, 2);
});

test("a full board can still take the third copy", () => {
  const st = fresh();
  put(st, "a", ["cross", "cross", "jab", "jab", "teep", "clinch"]);
  offer(st, "a", ["cross", "lowkick"]);
  assert.equal(E.buy(st, "a", 1), false, "no room for a new card");
  assert.ok(E.buy(st, "a", 0));
  assert.equal(st.a.board.length, data.config.slots);
  assert.equal(st.a.board.filter((c) => c && c.gold).length, 1);
});

test("shop effects: on-play buffs the school, on-buy grows the card that asked, and both are permanent", () => {
  const st = fresh();
  put(st, "a", ["cross", "lowkick", "bodyshot"]);
  offer(st, "a", ["coach"]);
  E.buy(st, "a", 0);
  const [cross, low, body] = st.a.board;
  assert.equal(cross.atk, data.skills.cross.atk + 1);
  assert.equal(low.atk, data.skills.lowkick.atk, "a kick is not a punch");
  assert.equal(body.atk, data.skills.bodyshot.atk + 1 + 1, "coach's buff and its own on-buy growth");
});

test("clash: cards trade blows until one side is gone; the winner's survivors hit the fighter, capped by round", () => {
  const st = fresh();
  put(st, "a", ["heavyhands", "heavyhands", "champheart"]); put(st, "b", ["jab"]);
  run(st);
  const e = evs(st, "clashend")[0];
  assert.equal(e.s, "a");
  assert.equal(e.dmg, data.config.damage.caps[0], "three tier-4 cards would do 13: capped in round 1");
  assert.equal(st.b.hp, data.config.hp - e.dmg);
  assert.equal(st.a.hp, data.config.hp);
  assert.equal(st.wins.a, 1);
  assert.equal(st.b.shop.gold, E.goldFor(st, "b"));
  assert.equal(st.b.lostLast, true, "the loser gets the extra gold next turn");
});

test("clash keywords: guard is hit first, slip soaks one hit, submission breaks whatever it damages on the ground only", () => {
  let st = fresh();
  put(st, "a", ["cross"]); put(st, "b", ["jab", "highguard", "jab"]);
  E.startClash(st);
  for (let i = 0; i < 30; i++) { const p = E.upcoming(st); if (!p) break; if (p.s === "a" && st.c.b.some((u) => u && u.hp > 0 && u.kw.guard)) assert.ok(p.t.kw.guard); E.step(st); }
  st = fresh();
  put(st, "a", ["slipstep"]); put(st, "b", ["heavyhands"]);
  E.startClash(st);
  E.step(st);
  assert.equal(evs(st, "slip").length, 1);
  assert.ok(st.c.a[0].hp > 0, "the first hit was slipped");
  st = fresh();
  put(st, "a", ["rnc"]); put(st, "b", ["champheart"]);
  st.b.board[0].kw = { guard: true };
  E.startClash(st);
  E.step(st);
  assert.equal(evs(st, "sub").length, 0, "standing: no submission");
  st = fresh();
  put(st, "a", ["rnc"]); put(st, "b", ["champheart"]);
  st.b.board[0].kw = { guard: true };
  E.startClash(st);
  st.c.ground = { top: "a", left: 99 };
  for (let i = 0; i < 3 && st.phase === "clash"; i++) E.step(st);
  assert.equal(evs(st, "sub").length, 1);
});

const G = data.config.ground;
const wall = (st) => { st.b.board[0].kw.guard = true; }; // make b's first card the one that gets hit

test("ground: a takedown that lands puts the clash on the ground; kicks cannot strike, the bottom hits softer, ground cards on top hit harder; then they are stood up", () => {
  const st = fresh();
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "highkick"]);
  E.startClash(st);
  assert.equal(E.upcoming(st).s, "a", "the side with more cards goes first");
  E.step(st);
  const g = evs(st, "ground")[0];
  assert.ok(g && g.s === "a" && st.c.ground.top === "a");
  const [, elbows] = st.c.a, [iron, kick] = st.c.b;
  assert.equal(E.power(st, kick), Math.ceil(kick.atk * G.schoolMul.kick));
  assert.equal(E.power(st, kick), 0, "a kick cannot be thrown from the ground");
  assert.equal(E.power(st, iron), Math.ceil(iron.atk * G.bottomMul));
  assert.equal(E.power(st, elbows), Math.ceil(elbows.atk * G.topMul));
  const at = st.log.indexOf(g);
  for (let i = 0; i < 40 && st.phase === "clash" && st.c.ground; i++) E.step(st);
  const up = st.log.findIndex((e, i) => i > at && e.t === "standup");
  if (up >= 0) assert.ok(st.log.slice(at, up).filter((e) => e.t === "attack").length <= G.attacks);
  else assert.equal(st.phase, "shop", "or the clash ended down there");
});

test("ground: a sprawl stops takedowns while it stands; a get-up card stands its side back up; a takedown from underneath reverses", () => {
  let st = fresh();
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "sprawl"]);
  E.startClash(st); E.step(st);
  assert.equal(evs(st, "stuffed").length, 1);
  assert.equal(evs(st, "ground").length, 0);
  assert.equal(st.c.ground, null);

  st = fresh();
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "shrimp"]);
  E.startClash(st);
  for (let i = 0; i < 6 && !evs(st, "standup").length; i++) E.step(st);
  const up = evs(st, "standup")[0];
  assert.ok(up && up.s === "b" && up.uid === st.c.b[1].uid, "the get-up card did it on its turn");

  st = fresh("poirier", "makhachev");
  put(st, "a", ["doubleleg", "highguard", "highguard"]); put(st, "b", ["doubleleg"]); wall(st);
  E.startClash(st);
  for (let i = 0; i < 8 && !evs(st, "reverse").length && st.phase === "clash"; i++) E.step(st);
  assert.equal(evs(st, "ground")[0].s, "a");
  assert.equal(evs(st, "reverse")[0].s, "b");
  assert.equal(st.c.ground.top, "b");
});

test("ground: a kick that lands on a takedown card gets caught", () => {
  const st = fresh("poirier", "makhachev");
  put(st, "a", ["lowkick", "highguard", "highguard"]); put(st, "b", ["doubleleg"]); wall(st);
  E.startClash(st); E.step(st);
  assert.ok(G.catch.includes(data.skills.lowkick.school));
  assert.equal(evs(st, "ground")[0].s, "b", "the kicker ends up underneath");
});

test("combo cards hit harder in a row; a long-range strike is not hit back", () => {
  let st = fresh("poirier", "makhachev");
  put(st, "a", ["cross", "cross", "cross"]); put(st, "b", ["ironwall", "ironwall"]);
  E.startClash(st);
  const base = st.c.a[0].atk;
  for (let i = 0; i < 3; i++) E.step(st);
  const mine = evs(st, "attack").filter((e) => e.s === "a");
  assert.deepEqual(mine.map((e) => e.combo), [0, data.config.combo.atk]);
  const hit = st.log[st.log.indexOf(mine[1]) + 1];
  assert.equal(hit.dmg, base + data.config.combo.atk);

  st = fresh();
  put(st, "a", ["highkick", "highguard", "highguard"]); put(st, "b", ["ironwall"]);
  E.startClash(st);
  const hp = st.c.a[0].hp;
  E.step(st);
  assert.equal(st.c.a[0].hp, hp, "the wall could not hit back");
});

test("a lasting weaken stays on the real card for the rest of the round, then it recovers", () => {
  const st = fresh("poirier", "makhachev");
  put(st, "a", ["lowkick", "highguard", "highguard"]); put(st, "b", ["ironwall"]);
  const base = st.b.board[0].atk;
  run(st);
  const worn = st.b.board[0].worn;
  assert.ok(worn >= 1);
  assert.equal(st.b.board[0].atk, base - worn);
  E.startClash(st);
  assert.equal(st.c.b[0].atk, base - worn, "the next clash starts with the worn-down card");
  let n = 0; while (st.phase === "clash" && n++ < 500) E.step(st);
  run(st);
  assert.equal(st.phase, "corner");
  assert.equal(st.b.board[0].atk, base);
  assert.equal(st.b.board[0].worn, undefined);
});

test("clash effects do not leak into the shop: a start-of-clash buff is gone afterwards", () => {
  const st = fresh();
  put(st, "a", ["jab", "cross"]); put(st, "b", ["teep"]);
  run(st);
  assert.equal(st.a.board[1].atk, data.skills.cross.atk);
});

test("the opponent's new purchases stay hidden: `shown` is the board he used last clash", () => {
  const st = fresh();
  put(st, "a", ["cross"]); put(st, "b", ["jab"]);
  run(st);
  assert.deepEqual(st.b.shown.filter(Boolean).map((c) => c.id), ["jab"]);
  shop(st, "b");
  assert.deepEqual(st.b.shown.filter(Boolean).map((c) => c.id), ["jab"]);
});

test("timing bar: once a clash on the strongest card's first swing; it scales that one hit", () => {
  const R = data.config.react;
  const st = fresh();
  put(st, "a", ["highguard"]); put(st, "b", ["heavyhands", "cross"]);
  E.startClash(st);
  const p = E.needsReact(st);
  assert.equal(p.s, "b", "his biggest card swings first");
  E.step(st, "perfect");
  assert.equal(evs(st, "react").length, 1);
  assert.equal(evs(st, "dmg").filter((e) => e.uid === st.c.a[0].uid).length, R.perfect === 0 ? 0 : 1, "a perfect press takes nothing");
  assert.equal(E.needsReact(st), null, "once a clash");
  const st2 = fresh();
  put(st2, "a", ["heavyhands", "cross"]); put(st2, "b", ["ironwall"]);
  E.startClash(st2);
  const q = E.needsReact(st2);
  assert.equal(q.s, "a");
  const atk = q.u.atk, target = q.t.uid;
  E.step(st2, "good");
  assert.equal(evs(st2, "dmg").find((e) => e.uid === target).dmg, Math.round(atk * R.goodHit));
});

test("rounds: three clashes make a round scored by clashes won; corner options apply; five rounds give a decision", () => {
  const st = fresh();
  for (let i = 0; i < data.config.clashes; i++) { put(st, "a", ["cross"]); put(st, "b", []); st.b.board[0] = null; put(st, "b", ["jab"]); st.b.board[0].atk = 0; run(st); }
  assert.equal(st.phase, "corner");
  assert.deepEqual([st.rounds[0].a, st.rounds[0].b], [10, 8]);
  st.a.hp = 20;
  E.corner(st, "a", "heal"); E.corner(st, "b", "gold");
  assert.equal(st.a.hp, 20 + data.config.corner.heal.heal);
  assert.equal(st.phase, "shop");
  assert.equal(st.round, 2);
  assert.equal(st.b.shop.gold, E.goldFor({ ...st, b: { ...st.b, bonusGold: data.config.corner.gold.gold } }, "b"));
});

test("the engine never looks at card ids", () => {
  const src = readFileSync(new URL("./engine.js", import.meta.url), "utf8");
  for (const id of Object.keys(data.skills)) assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(src), id);
});
