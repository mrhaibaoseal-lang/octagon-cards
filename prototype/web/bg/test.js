// One-on-one board battler engine invariants. node --test prototype/web/bg/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadData } from "./load.node.js";
import * as E from "./engine.js";
import { shop, shoppers, runGame, groundWeights, groundPick, groundRead, grounders, g21Threshold, g21Pick, g21Smart, grounders21, pokerDist, pokerStyle, pokerPick, pokerEquity, groundersPoker } from "./ai.js";

const data = loadData(); data.config.ground.mode = "rps"; // the guessing-game tests; the blackjack ground has its own copy (d21) further down
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
  const kws = ["guard", "slip", "flurry", "sweep", "sub", "takedown", "sprawl", "getup", "ground", "combo", "reach"], whens = ["play", "buy", "start", "hit", "break", "win", "ground"];
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

test("clash keywords: guard is hit first, slip soaks one hit, a standing submission card is just a card", () => {
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
  assert.ok(st.c.b[0].hp > 0, "a choke does not break a card by itself any more");
});

const G = data.config.ground;
const wall = (st) => { st.b.board[0].kw.guard = true; }; // make b's first card the one that gets hit
/** Start a clash with a takedown already landed: side "top" is on top at layer. */
const down = (a, b, top = "a", layer = 1, who = ["poirier", "makhachev"]) => { const st = fresh(...who); put(st, "a", a); put(st, "b", b); E.startClash(st); st.c.ground = { top, layer, beat: 1 }; return st; };
const beat = (st, ma, mb) => { assert.ok(E.chooseGround(st, "a", ma), "a may play " + ma); assert.ok(E.chooseGround(st, "b", mb), "b may play " + mb); E.step(st); return evs(st, "gbeat").at(-1); };

test("ground: a takedown that lands pauses the cards and starts the guessing game on the first layer, the taker on top", () => {
  const st = fresh();
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "highkick"]);
  E.startClash(st);
  assert.equal(E.upcoming(st).s, "a", "the side with more cards goes first");
  E.step(st);
  const g = evs(st, "ground")[0];
  assert.ok(g && g.s === "a");
  assert.deepEqual({ top: st.c.ground.top, layer: st.c.ground.layer, beat: st.c.ground.beat }, { top: "a", layer: G.start, beat: 1 });
  assert.equal(E.options(st), null, "no card attacks while they grapple");
  const o = E.groundOptions(st);
  assert.deepEqual(o.moves.a, ["press", "strike", "sub"], "the top man may go for the finish from the very first layer");
  assert.deepEqual(o.moves.b, ["guard", "rise", "turn"]);
});

test("ground: the six moves form one ring; each beats the next, loses to the one before, draws with the opposite", () => {
  const top = Object.keys(G.moves).filter((m) => G.moves[m].role === "top"), bot = Object.keys(G.moves).filter((m) => G.moves[m].role === "bottom");
  for (const t of top) {
    const win = bot.filter((b) => G.beat[t] === b), lose = bot.filter((b) => G.beat[b] === t);
    assert.equal(win.length, 1, t + " beats exactly one");
    assert.equal(lose.length, 1, t + " loses to exactly one");
    assert.equal(bot.length - win.length - lose.length, 1, t + " draws with the last");
  }
  for (const [t, b, res] of [["press", "guard", "top"], ["press", "rise", "bottom"], ["press", "turn", "tie"], ["strike", "rise", "top"], ["strike", "turn", "bottom"], ["strike", "guard", "tie"]]) {
    const st = down(["cross"], ["cross"], "a", 2);
    assert.equal(beat(st, t, b).res, res, `${t} against ${b}`);
  }
});

test("ground: the top man pressing a layer deeper, striking the fighter, or finishing; the bottom man escaping a layer, or flipping with a takedown card", () => {
  let st = down(["cross"], ["cross"], "a", 1);
  assert.equal(beat(st, "press", "guard").dmg, 0);
  assert.equal(st.c.ground.layer, 2);
  assert.equal(st.c.ground.beat, 2);

  st = down(["cross"], ["cross"], "a", 2);
  const e = beat(st, "strike", "rise");
  assert.equal(e.dmg, G.moves.strike.hit.base);
  assert.equal(st.b.hp, data.config.hp - e.dmg);
  assert.equal(st.a.stats.dmg, e.dmg);
  assert.equal(st.c.ground.layer, 2, "a strike does not move the position");

  st = down(["elbows", "groundpound"], ["cross"], "a", 2);
  assert.equal(beat(st, "strike", "rise").dmg, G.moves.strike.hit.base + 2 * G.moves.strike.hit.perCard, "each ground card adds to the strike");

  const by = G.moves.sub.hit.byLayer;
  for (let layer = 1; layer <= G.layers; layer++) {
    st = down(["cross"], ["cross"], "a", layer);
    assert.ok(E.groundMoves(st, "a").includes("sub"), "the finish can be tried on every layer");
    assert.equal(beat(st, "sub", "turn").dmg, by[layer - 1], "and it hurts more the deeper the position");
    st = down(["rnc"], ["cross"], "a", layer);
    assert.equal(beat(st, "sub", "turn").dmg, by[Math.min(by.length, layer + 1) - 1], "a submission card counts as one layer deeper");
  }
  assert.ok(by.every((d, i) => i === 0 || d > by[i - 1]), "deeper = heavier");

  st = down(["cross"], ["cross"], "a", 3);
  assert.equal(beat(st, "press", "guard").dmg, 0);
  assert.equal(st.c.ground.layer, G.layers, "nothing deeper than the last layer");

  st = down(["cross"], ["cross"], "a", 3);
  beat(st, "press", "rise");
  assert.equal(st.c.ground.layer, 2, "the bottom man wins: one layer out");

  st = down(["cross"], ["shrimp"], "a", 3);
  beat(st, "press", "rise");
  assert.equal(st.c.ground.layer, 3 - 1 - G.extra, "a get-up card escapes an extra layer with the stand-up move");

  st = down(["cross"], ["doubleleg"], "a", 2);
  const f = beat(st, "strike", "turn");
  assert.equal(f.res, "bottom");
  assert.equal(f.flip, true);
  assert.equal(st.c.ground.top, "b", "a takedown card turns the position over");
  assert.equal(st.c.ground.layer, 2, "and the layer stays");
});

test("ground: it ends when the bottom man gets out of the first layer, after the last beat, or on a knockout; then the cards carry on", () => {
  let st = down(["cross"], ["cross"], "a", 1);
  beat(st, "press", "rise");
  assert.equal(st.c.ground, null);
  assert.equal(evs(st, "standup").length, 1);
  assert.ok(E.options(st), "back to the cards");

  st = down(["cross"], ["cross"], "a", 1);
  for (let i = 0; i < G.beats; i++) beat(st, "press", "turn");
  assert.equal(st.c.ground, null, "the referee stands them up");
  assert.equal(evs(st, "gbeat").length, G.beats);

  st = down(["cross"], ["cross"], "a", 3);
  st.b.hp = 3;
  beat(st, "sub", "turn");
  assert.equal(st.b.hp, 0);
  assert.equal(st.c.ground, null);
  E.step(st);
  assert.equal(st.over.winner, "a");
  assert.equal(st.over.how, "KO");

  st = down(["cross"], ["cross"], "a", 1);
  E.step(st);
  assert.equal(evs(st, "gbeat").length, 1, "an unanswered beat plays itself with random moves");
});

test("ground: on every layer the ring is whole: the top man wins three of nine pairings, loses three, draws three, and has a counter to every bottom move", () => {
  const top = Object.keys(G.moves).filter((m) => G.moves[m].role === "top"), bot = Object.keys(G.moves).filter((m) => G.moves[m].role === "bottom");
  for (let layer = 1; layer <= G.layers; layer++) {
    const tally = { top: 0, bottom: 0, tie: 0 }, answered = new Set();
    for (const t of top) for (const b of bot) {
      const st = down(["cross"], ["cross"], "a", layer);
      assert.deepEqual(E.groundMoves(st, "a"), top, `all top moves on layer ${layer}`);
      assert.deepEqual(E.groundMoves(st, "b"), bot, `all bottom moves on layer ${layer}`);
      const res = beat(st, t, b).res;
      tally[res]++;
      if (res === "top") answered.add(b);
    }
    assert.deepEqual(tally, { top: 3, bottom: 3, tie: 3 }, `layer ${layer}`);
    assert.equal(answered.size, bot.length, `on layer ${layer} every escape has a move that beats it`);
  }
});

test("ground: a long-range strike is hit back for less (reachCounter), never below zero, and the fighter AI counts it the same way", () => {
  const R = data.config.reachCounter;
  assert.ok(R > 0);
  const st = fresh();
  put(st, "a", ["highkick", "highguard", "highguard"]); put(st, "b", ["ironwall"]);
  E.startClash(st);
  const u = st.c.a[0], t = st.c.b[0];
  t.atk = R + 3;
  assert.equal(E.counter(st, u, t), 3, "a long-range card takes the counter minus the reduction");
  assert.equal(E.counter(st, { kw: {} }, t), R + 3, "a plain card takes all of it");
  t.atk = Math.max(0, R - 1);
  assert.equal(E.counter(st, u, t), 0);
  t.atk = R + 3;
  const hp = u.hp;
  E.choose(st, u.uid, t.uid); E.step(st);
  assert.equal(u.hp, hp - 3);
});

test("ground: a sprawl stops a takedown while it stands; a kick that lands on a takedown card gets caught", () => {
  let st = fresh();
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "sprawl"]);
  E.startClash(st); E.step(st);
  assert.equal(evs(st, "stuffed").length, 1);
  assert.equal(evs(st, "ground").length, 0);
  assert.equal(st.c.ground, null);

  st = fresh("poirier", "makhachev");
  put(st, "a", ["lowkick", "highguard", "highguard"]); put(st, "b", ["doubleleg"]); wall(st);
  E.startClash(st); E.step(st);
  assert.ok(G.catch.includes(data.skills.lowkick.school));
  assert.equal(evs(st, "ground")[0].s, "b", "the kicker ends up underneath");
});

test("ground AI: the table sums to one over the moves it may play, leans toward the counter of your last move, and covers a finish", () => {
  let st = down(["cross"], ["cross"], "b", 1);
  let w = groundWeights(st, "b");
  assert.deepEqual(Object.keys(w).sort(), ["press", "strike", "sub"]);
  assert.ok(Math.abs(Object.values(w).reduce((n, v) => n + v, 0) - 1) < 1e-9);
  const before = groundWeights(st, "a");
  st.c.glast = { a: "guard", b: "press" };
  const after = groundWeights(st, "b");
  assert.ok(after.press > w.press || after.strike < w.strike, "he leans toward what beat your last move");
  assert.ok(groundWeights(st, "a").rise > before.rise * 0.99);

  st = down(["cross"], ["cross"], "b", 3);
  const covered = groundWeights(st, "a"), plain = down(["cross"], ["cross"], "b", 1);
  assert.ok(covered.guard > groundWeights(plain, "a").guard, "the bottom man guards against the finish when it is on");
  assert.ok(E.groundMoves(st, "b").includes(groundPick(st, "b")));
  assert.ok(E.groundMoves(st, "a").includes(groundRead(st, "a")));
  assert.ok(E.groundMoves(st, "a").includes(grounders.guess(st, "a")));
});

// ---------- the blackjack ground game (ground.mode "21") ----------
const d21 = loadData(); d21.config.ground.mode = "21";
d21.config.ground21.topLast = false; // these tests follow the first order (the top man first); the default order (topLast) has its own test below
const X = d21.config.ground21;
/** A clash already on the ground in 21 mode with the hands stacked: h = { a: [..], b: [..] }. */
const down21 = (a, b, h, top = "a", layer = 1, who = ["poirier", "makhachev"]) => {
  const st = E.createGame(d21, ...who, 3); put(st, "a", a); put(st, "b", b); E.startClash(st);
  st.c.ground = { top, layer, beat: 1, hands: { a: [...h.a], b: [...h.b] }, hits: { a: 0, b: 0 }, stood: { a: false, b: false }, phase: "top", gap: 0 };
  return st;
};
const act = (st, s, m) => { assert.ok(E.chooseGround(st, s, m), `${s} may ${m}`); E.step(st); };
const last = (st, t) => evs(st, t).at(-1);

test("21 ground: a takedown deals two numbers a side, the top man decides first, and the cards wait", () => {
  const st = E.createGame(d21, "holloway", "makhachev", 3);
  put(st, "a", ["doubleleg", "elbows", "highguard"]); put(st, "b", ["ironwall", "highkick"]);
  E.startClash(st); E.step(st);
  assert.equal(evs(st, "ground").length, 1);
  assert.equal(evs(st, "g21deal").length, 1);
  const g = st.c.ground;
  for (const s of ["a", "b"]) { assert.equal(g.hands[s].length, 2); for (const v of g.hands[s]) assert.ok(Number.isInteger(v) && v >= 1 && v <= X.max); }
  assert.equal(E.options(st), null, "no card attacks while they grapple");
  assert.equal(E.groundOptions(st), null, "the guessing game is off in 21 mode");
  const o = E.g21Options(st);
  assert.deepEqual({ top: o.top, layer: o.layer, phase: o.phase, turn: o.turn, actions: o.actions }, { top: "a", layer: G.start, phase: "top", turn: "a", actions: ["hit", "stand"] });
  assert.equal(E.chooseGround(st, "b", "stand"), false, "the bottom man waits for the top man");
  assert.equal(E.chooseGround(st, "a", "cash"), false, "nothing to cash yet");
  act(st, "a", "stand");
  assert.equal(E.g21Options(st).turn, "b");
});

test("21 ground: the higher total wins; the top man cashes the gap in (half, rounded up, times the layer, capped) and stays on top for another hand", () => {
  const pay = (gap, layer) => Math.min(X.cap, Math.ceil(gap / X.div) * X.layerMul[layer - 1]); // the rule, written out
  for (const [layer, ha, hb] of [[1, [10, 9], [10, 4]], [2, [10, 9], [10, 4]], [3, [10, 9], [10, 4]], [3, [10, 9], [1, 1]]]) {
    const dmg = pay(19 - hb[0] - hb[1], layer);
    const st = down21(["cross"], ["cross"], { a: ha, b: hb }, "a", layer), hp = st.b.hp;
    act(st, "a", "stand"); act(st, "b", "stand");
    const e = last(st, "g21end");
    assert.equal(e.res, "top"); assert.equal(e.gap, 19 - (hb[0] + hb[1])); assert.equal(e.cash, dmg);
    assert.equal(E.g21Options(st).phase, "decide");
    act(st, "a", "cash");
    assert.equal(st.b.hp, hp - dmg, `layer ${layer}`);
    assert.equal(last(st, "g21cash").stay, true);
    assert.deepEqual({ layer: st.c.ground.layer, beat: st.c.ground.beat, phase: st.c.ground.phase, top: st.c.ground.top }, { layer, beat: 2, phase: "top", top: "a" }, "same layer, next hand");
    assert.equal(evs(st, "g21deal").length, 1);
    assert.equal(evs(st, "standup").length, 0);
  }
  // on the last hand the cash ends the ground
  const st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 4] });
  st.c.ground.beat = X.hands;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(E.g21Options(st).last, true);
  act(st, "a", "cash");
  assert.equal(last(st, "g21cash").stay, false);
  assert.equal(st.c.ground, null);
  assert.equal(evs(st, "standup").length, 1);
  // with stay off a cash always ends it (the first version)
  const off = loadData(); off.config.ground.mode = "21"; off.config.ground21.stay = false; off.config.ground21.topLast = false;
  const s2 = E.createGame(off, "poirier", "makhachev", 3); put(s2, "a", ["cross"]); put(s2, "b", ["cross"]); E.startClash(s2);
  s2.c.ground = { top: "a", layer: 1, beat: 1, hands: { a: [10, 9], b: [10, 4] }, hits: { a: 0, b: 0 }, stood: { a: false, b: false }, phase: "top", gap: 0 };
  act(s2, "a", "stand"); act(s2, "b", "stand"); act(s2, "a", "cash");
  assert.equal(s2.c.ground, null);
});

test("21 ground: each layer pins the bottom man harder: side control lets him take fewer cards, the mount lowers his bust line", () => {
  const R = X.layerRules;
  let st = down21(["cross"], ["cross"], { a: [10, 7], b: [5, 5] }, "a", 1);
  assert.equal(E.g21Hits(st, "b"), X.hits); assert.equal(E.g21Bust(st, "b"), X.bust);
  st = down21(["cross"], ["cross"], { a: [10, 7], b: [2, 2] }, "a", 2);
  assert.equal(E.g21Hits(st, "b"), R[1].botHits); assert.equal(E.g21Hits(st, "a"), X.hits, "the top man is not pinned");
  act(st, "a", "stand");
  for (let i = 0; i < R[1].botHits; i++) { act(st, "b", "hit"); if (st.c.ground?.phase !== "bottom" || st.c.ground.beat > 1) break; }
  if (st.c.ground?.phase === "bottom") assert.deepEqual(E.g21Options(st).actions, ["stand"], "no third card in side control");
  assert.equal(evs(st, "g21end").filter((e) => e.why === "five").length, 0, "he cannot reach five cards there");
  st = down21(["cross"], ["cross"], { a: [10, 7], b: [10, 10] }, "a", 3);
  assert.equal(E.g21Bust(st, "b"), R[2].botBust); assert.equal(E.g21Bust(st, "a"), X.bust);
  st = down21(["cross"], ["shrimp"], { a: [10, 7], b: [10, 10] }, "a", 3);
  assert.equal(E.g21Bust(st, "b"), R[2].botBust + X.upAdd, "a get-up card still helps under the mount");
  st = down21(["cross"], ["cross"], { a: [10, 7], b: [10, 10, 1] }, "a", 3);
  st.c.ground.hits.b = 1;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.deepEqual({ res: last(st, "g21end").res, why: last(st, "g21end").why }, { res: "top", why: "bust" }, "21 is over the line under the mount");
  // the screen gets the same limits with every deal
  const g = runGame(d21, "makhachev", "poirier", 77);
  for (const e of g.log.filter((x) => x.t === "g21deal")) {
    const gi = e.view.ground, bot = gi.top === "a" ? "b" : "a";
    assert.equal(gi.info.hits[bot], R[e.layer - 1].botHits ?? X.hits);
    assert.equal(gi.info.hits[gi.top], X.hits);
  }
});

test("21 ground: going deeper gives up the cash for a new hand one layer in; not from the last layer or the last hand", () => {
  let st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 4] }), hp = st.b.hp;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.deepEqual(E.g21Options(st).actions, ["cash", "deeper"]);
  act(st, "a", "deeper");
  assert.equal(st.b.hp, hp, "nothing was cashed");
  assert.deepEqual({ layer: st.c.ground.layer, beat: st.c.ground.beat, phase: st.c.ground.phase }, { layer: 2, beat: 2, phase: "top" });
  assert.equal(evs(st, "g21deal").length, 1, "a new hand was dealt");
  st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 4] }, "a", G.layers);
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.deepEqual(E.g21Options(st).actions, ["cash"], "the last layer only cashes");
  st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 4] });
  st.c.ground.beat = X.hands;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.deepEqual(E.g21Options(st).actions, ["cash"], "no hand left to play");
});

test("21 ground: the bottom man winning slips out one layer and the ground goes on; out of the first layer, or level, they stand up", () => {
  let st = down21(["cross"], ["cross"], { a: [10, 5], b: [10, 9] }, "a", 2), hp = { a: st.a.hp, b: st.b.hp };
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "bottom");
  assert.deepEqual({ top: st.c.ground.top, layer: st.c.ground.layer, beat: st.c.ground.beat, phase: st.c.ground.phase }, { top: "a", layer: 1, beat: 2, phase: "top" });
  assert.deepEqual({ a: st.a.hp, b: st.b.hp }, hp);
  st = down21(["cross"], ["cross"], { a: [10, 5], b: [10, 9] }, "a", 1);
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(st.c.ground, null, "out of the first layer");
  st = down21(["cross"], ["cross"], { a: [10, 8], b: [9, 9] }, "a", 3);
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "tie");
  assert.equal(st.c.ground, null, "the referee stands them up");
  assert.deepEqual({ a: st.a.hp, b: st.b.hp }, hp);
  assert.ok(E.options(st), "the cards carry on");
});

test("21 ground: going over the line loses the hand; a top bust lets the bottom man out, a bottom bust counts as a gap of bustGap", () => {
  let st = down21(["cross"], ["cross"], { a: [10, 10, 1], b: [5, 5] }, "a", 2);
  act(st, "a", "hit");
  assert.deepEqual({ res: last(st, "g21end").res, why: last(st, "g21end").why, bust: last(st, "g21end").bust }, { res: "bottom", why: "bust", bust: "a" });
  assert.equal(st.c.ground.layer, 1);
  st = down21(["cross"], ["cross"], { a: [5, 5], b: [10, 10, 1] }, "a", 2);
  act(st, "a", "stand"); act(st, "b", "hit");
  const e = last(st, "g21end");
  assert.deepEqual({ res: e.res, why: e.why, gap: e.gap, cash: e.cash }, { res: "top", why: "bust", gap: X.bustGap, cash: E.g21Cash(st, X.bustGap, 2) });
  st = down21(["cross"], ["cross"], { a: [1, 1], b: [5, 5] });
  st.c.ground.hits.a = X.hits;
  assert.deepEqual(E.g21Options(st).actions, ["stand"], "no more cards after the limit");
});

test("21 ground: the numbers come in a real deck's odds (10 / J / Q / K all count 10), so five cards under the line is rare", () => {
  const st = E.createGame(d21, "poirier", "makhachev", 7), odds = E.g21Odds(st);
  assert.ok(Math.abs(odds.reduce((n, [, p]) => n + p, 0) - 1) < 1e-9);
  assert.deepEqual(odds.map(([v]) => v), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(Math.abs(odds.at(-1)[1] - 4 / 13) < 1e-9, "a ten is four times as likely as any other number");
  // the dealer follows those odds: count every card dealt or drawn over many bouts
  const seen = Array(11).fill(0);
  for (let i = 0; i < 40; i++) {
    const g = runGame(d21, "makhachev", "poirier", 500 + i);
    for (const e of g.log) {
      if (e.t === "g21hit") seen[e.card]++;
      if (e.t === "g21deal") for (const x of ["a", "b"]) for (const v of e.view.ground.hands[x]) seen[v]++;
    }
  }
  const n = seen.reduce((a, b) => a + b, 0), tens = seen[10] / n;
  assert.ok(n > 500, `${n} cards seen`);
  assert.ok(tens > 0.25 && tens < 0.37, `tens ${(tens * 100).toFixed(1)}% (a real deck: 30.8%)`);
  // chance that five random cards stay at the line or under, with these odds
  let dist = new Map([[0, 1]]);
  for (let k = 0; k < 5; k++) { const nx = new Map(); for (const [t, p] of dist) for (const [v, q] of odds) nx.set(t + v, (nx.get(t + v) || 0) + p * q); dist = nx; }
  const under = [...dist].filter(([t]) => t <= X.bust).reduce((a, [, p]) => a + p, 0);
  assert.ok(under < 0.08, `five cards under ${X.bust}: ${(under * 100).toFixed(1)}%`);
});

test("21 ground: a full hand that has not gone over wins outright, whatever the totals; the opponent reaches for it one card short", () => {
  assert.equal(X.fiveWin, true);
  // the bottom man fills his hand: he is out a layer although the top man holds more
  let st = down21(["cross"], ["cross"], { a: [10, 10], b: [1, 1, 1, 1] }, "a", 1);
  st.c.ground.hits.b = X.hits - 1;
  act(st, "a", "stand"); act(st, "b", "hit");
  let e = last(st, "g21end");
  assert.deepEqual({ res: e.res, why: e.why, five: e.five, to: e.to }, { res: "bottom", why: "five", five: "b", to: 0 });
  assert.ok(e.totals.b < e.totals.a, "he won with the smaller total");
  assert.equal(st.c.ground, null, "out of the first layer: on his feet");
  // the top man fills his: the bottom man never gets to answer, and the win counts as a gap of fiveGap
  st = down21(["cross"], ["cross"], { a: [1, 1, 1, 1], b: [10, 10] }, "a", 2);
  st.c.ground.hits.a = X.hits - 1;
  act(st, "a", "hit");
  e = last(st, "g21end");
  assert.deepEqual({ res: e.res, why: e.why, five: e.five, gap: e.gap, cash: e.cash }, { res: "top", why: "five", five: "a", gap: X.fiveGap, cash: E.g21Cash(st, X.fiveGap, 2) });
  assert.equal(st.c.ground.hits.b, 0);
  assert.equal(E.g21Options(st).phase, "decide");
  // a card short of full, the opponent's published number goes up to fiveBelow
  const A = { ...X.ai, ...d21.fighters.makhachev.ai.ground21 };
  assert.equal(g21Threshold(st, "b", "top", 0, X.hits + 1), Math.max(A.hitBelow.top, A.fiveBelow));
  assert.equal(g21Threshold(st, "b", "top", 0, X.hits), A.hitBelow.top);
  assert.equal(g21Threshold(st, "b", "bottom", 17, X.hits + 1), Math.max(19, A.fiveBelow));
  // with the rule off the last card just ends his turn
  const off = loadData(); off.config.ground.mode = "21"; off.config.ground21.fiveWin = false; off.config.ground21.topLast = false;
  st = E.createGame(off, "poirier", "makhachev", 3); put(st, "a", ["cross"]); put(st, "b", ["cross"]); E.startClash(st);
  st.c.ground = { top: "a", layer: 2, beat: 1, hands: { a: [1, 1, 1, 1], b: [10, 10] }, hits: { a: X.hits - 1, b: 0 }, stood: { a: false, b: false }, phase: "top", gap: 0 };
  act(st, "a", "hit");
  assert.equal(evs(st, "g21end").length, 0);
  assert.equal(st.c.ground.phase, "bottom");
});

test("21 ground: the cards on the board change the hand: ground cards give the top man a head start, a submission card finishes on 20, a get-up card moves the bottom man's line up one", () => {
  let st = down21(["elbows", "groundpound"], ["cross"], { a: [5, 5], b: [5, 5] });
  assert.equal(E.g21Bonus(st, "a"), 2); assert.equal(E.g21Total(st, "a"), 12);
  assert.equal(E.g21Bonus(st, "b"), 0, "only the top man gets it");
  st = down21(["elbows", "elbows", "groundpound", "groundpound"], ["cross"], { a: [5, 5], b: [5, 5] });
  assert.equal(E.g21Bonus(st, "a"), X.startCap, "capped");
  st = down21(["cross"], ["shrimp"], { a: [10, 9], b: [10, 10, 2] });
  assert.equal(E.g21Bust(st, "b"), X.bust + X.upAdd); assert.equal(E.g21Bust(st, "a"), X.bust);
  st.c.ground.hits.b = 1;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "bottom", "22 is still alive with a get-up card, and it wins");
  st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 10, 2] });
  assert.equal(E.g21Bust(st, "b"), X.bust);
  // a submission
  st = down21(["guillotine"], ["cross"], { a: [10, 10], b: [10, 5] });
  let hp = st.b.hp;
  assert.equal(E.g21SubAt(st), X.subAt);
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "sub");
  assert.equal(hp - st.b.hp, Math.max(X.submit, E.g21Cash(st, 5, 1)));
  assert.equal(st.c.ground, null);
  st = down21(["cross"], ["cross"], { a: [10, 10], b: [10, 5] });
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "top", "20 without the card is a plain win");
  st = down21(["cross"], ["cross"], { a: [10, 10, 1], b: [10, 5] });
  st.c.ground.hits.a = 1; hp = st.b.hp;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "sub", "21 on the nose finishes without a card");
  st = down21(["guillotine"], ["cross"], { a: [10, 10, 1], b: [10, 10, 1] });
  st.c.ground.hits.a = 1; st.c.ground.hits.b = 1;
  act(st, "a", "stand"); act(st, "b", "stand");
  assert.equal(last(st, "g21end").res, "tie", "21 against 21 is level");
});

test("21 ground: each side hides its second card until the hand is decided; a finish on the mat is a knockout", () => {
  let st = down21(["elbows"], ["cross"], { a: [7, 6], b: [3, 8] });
  let v = E.g21View(st, "a");
  assert.deepEqual(v.foe.shown, [3]); assert.equal(v.foe.shownSum, 3); assert.equal(v.foe.hidden, true);
  assert.deepEqual(v.mine.cards, [7, 6]); assert.equal(v.mine.total, 14); assert.equal(v.role, "top");
  v = E.g21View(st, "b");
  assert.deepEqual(v.foe.shown, [7]); assert.equal(v.foe.shownSum, 8, "what he shows includes his head start");
  act(st, "a", "stand"); act(st, "b", "stand");
  v = E.g21View(st, "b");
  assert.deepEqual(v.foe.shown, [7, 6]); assert.equal(v.foe.hidden, false);
  st = down21(["cross"], ["cross"], { a: [10, 9], b: [10, 4] }, "a", 3);
  st.b.hp = 5;
  act(st, "a", "stand"); act(st, "b", "stand"); act(st, "a", "cash");
  assert.equal(st.b.hp, 0);
  E.step(st);
  assert.deepEqual({ winner: st.over?.winner, how: st.over?.how }, { winner: "a", how: "KO" });
});

test("21 ground AI: it hits below its published threshold and stands above it; the bottom man chases what the top man shows; players only act on their turn", () => {
  const A = { ...X.ai, ...d21.fighters.makhachev.ai.ground21 };
  let st = down21(["cross"], ["cross"], { a: [2, 2], b: [5, 5] }, "b");
  assert.equal(g21Threshold(st, "b", "top"), A.hitBelow.top);
  assert.equal(g21Threshold(st, "b", "bottom", 3), A.hitBelow.bottom);
  assert.equal(g21Threshold(st, "b", "bottom", 17), 19, "he needs two more than he can see");
  assert.equal(g21Threshold(st, "b", "bottom", 20), A.standCap);
  for (const [hand, want] of [[[A.hitBelow.top - A.jitter - 6, 5], "hit"], [[A.hitBelow.top + A.jitter - 5, 5], "stand"]]) {
    for (let seed = 1; seed < 30; seed++) { st = down21(["cross"], ["cross"], { a: [2, 2], b: hand }, "b"); st.rng = seed; assert.equal(g21Pick(st, "b"), want); }
  }
  assert.equal(g21Pick(st, "a"), null, "not his turn");
  assert.equal(g21Smart(st, "a"), null);
  st = down21(["cross"], ["cross"], { a: [10, 4], b: [10, 5 + 0] }, "b", 1);
  act(st, "b", "stand"); act(st, "a", "stand");
  assert.equal(E.g21Options(st).phase, "decide");
  assert.equal(g21Pick(st, "b"), 1 < A.deepBelow ? "deeper" : "cash");
  // the player who does the sums
  st = down21(["cross"], ["cross"], { a: [10, 10], b: [5, 5] });
  assert.equal(g21Smart(st, "a"), "stand");
  st = down21(["cross"], ["cross"], { a: [4, 4], b: [5, 5] });
  assert.equal(g21Smart(st, "a"), "hit");
  st = down21(["cross"], ["cross"], { a: [10, 2], b: [10, 9] }, "b");
  act(st, "b", "stand");
  assert.equal(g21Smart(st, "a"), "hit", "12 cannot beat a man who stood");
  for (const k of Object.keys(grounders21)) {
    const g = runGame(d21, "makhachev", "poirier", 21, shoppers.smart, undefined, undefined, grounders21[k]);
    assert.ok(g.over && ["KO", "DEC"].includes(g.over.how), k);
  }
  const a = runGame(d21, "makhachev", "holloway", 5), b = runGame(d21, "makhachev", "holloway", 5);
  assert.deepEqual(a.over, b.over); assert.equal(a.log.length, b.log.length);
  assert.ok(evs(a, "g21deal").length > 0, "the bout reached the ground");
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

test("21 ground, default order (topLast): the bottom man decides first and the top man answers; the second man chases what he can see", () => {
  const dd = loadData();
  assert.equal(dd.config.ground.mode, "21"); assert.equal(dd.config.ground21.topLast, true);
  const st = E.createGame(dd, "makhachev", "poirier", 3);
  put(st, "a", ["doubleleg", "cross"]); put(st, "b", ["cross"]);
  E.startClash(st);
  for (let i = 0; i < 10 && !st.c.ground; i++) { const o = E.options(st); if (o?.s === "a") E.choose(st, o.units.find((u) => u.kw.takedown)?.uid ?? o.units[0].uid, o.targets[0].uid); E.step(st); }
  assert.ok(st.c.ground && st.c.ground.top === "a", "a takedown put a on top");
  let o = E.g21Options(st);
  assert.deepEqual({ phase: o.phase, turn: o.turn }, { phase: "bottom", turn: "b" }, "the bottom man goes first");
  assert.equal(E.chooseGround(st, "a", "stand"), false, "the top man waits");
  assert.ok(E.chooseGround(st, "b", "stand")); E.step(st);
  o = E.g21Options(st);
  assert.deepEqual({ phase: o.phase, turn: o.turn }, { phase: "top", turn: "a" }, "then the top man answers");
  // the published numbers: the man who moves first plays his own number, the man who answers chases what he sees (shown + 2)
  const A = { ...dd.config.ground21.ai, ...dd.fighters.makhachev.ai.ground21 }, B = { ...dd.config.ground21.ai, ...dd.fighters.poirier.ai.ground21 };
  assert.equal(g21Threshold(st, "a", "top", 17), Math.min(A.standCap, Math.max(A.hitBelow.top, 19)));
  assert.equal(g21Threshold(st, "a", "top", 3), A.hitBelow.top);
  assert.equal(g21Threshold(st, "b", "bottom", 17), B.hitBelow.bottom, "the first man does not chase");
  assert.ok(["hit", "stand"].includes(g21Smart(st, "a")));
  assert.ok(["hit", "stand"].includes(g21Pick(st, "a")));
  // a whole bout plays through in this order
  for (const k of Object.keys(grounders21)) {
    const g = runGame(dd, "makhachev", "poirier", 31, shoppers.smart, undefined, undefined, grounders21[k]);
    assert.ok(g.over && ["KO", "DEC"].includes(g.over.how), k);
    const first = g.log.find((e) => e.t === "g21stand" || e.t === "g21hit");
    if (first) assert.notEqual(first.s, first.view.ground.top, "the first decision of a hand is the bottom man's");
  }
});

// ---------- the poker ground (ground.mode "poker") ----------
const SUITS = { s: 0, h: 1, d: 2, c: 3 }, RANKS = "23456789TJQKA";
/** "As Td" ... -> card numbers */
const cd = (str) => str.split(" ").map((x) => RANKS.indexOf(x[0]) + 13 * SUITS[x[1]]);
const pdata = () => { const d = loadData(); d.config.ground.mode = "poker"; return d; };
/** A poker ground with `top` on top. aBoard / bBoard are the card ids on each board; a takedown card is always among them for the man on top. */
function pg(top = "a", aBoard = null, bBoard = null, tweak = null) {
  const d = pdata();
  if (tweak) tweak(d);
  const st = E.createGame(d, "makhachev", "poirier", 5);
  put(st, "a", aBoard || [top === "a" ? "doubleleg" : "cross"]); put(st, "b", bBoard || [top === "b" ? "doubleleg" : "cross"]);
  E.startClash(st);
  st.c.turn = top; // the man with the takedown card throws first
  for (let i = 0; i < 20 && st.c && !st.c.ground; i++) { const o = E.options(st); if (o) E.choose(st, (o.units.find((u) => u.kw.takedown) || o.units[0]).uid, o.targets[0].uid); E.step(st); }
  assert.ok(st.c.ground && st.c.ground.top === top, "a takedown put " + top + " on top");
  return st;
}
const noFx = (d) => { for (const id of ["singleleg", "doubleleg"]) d.skills[id].fx = d.skills[id].fx.filter((x) => x.when !== "ground"); };
/** A ground with no card effects at all, so the plain rules show. */
const plain = (top = "a") => pg(top, null, null, noFx);
/** Give the hand fixed cards: a / b hole cards and the five on the table. */
function setHand(st, a, b, board) { const h = st.c.ground.h; h.hole.a = cd(a); h.hole.b = cd(b); h.board = cd(board); }
const pact = (st, s, a) => { assert.ok(E.chooseGround(st, s, a), `${s} may ${a}`); E.step(st); };
const turnOf = (st) => E.pokerOptions(st).turn;
/** Everyone checks to the showdown. */
function checkDown(st) { for (let i = 0; i < 4 && E.pokerOptions(st)?.phase === "bet"; i++) pact(st, turnOf(st), "call"); }
const AA_KK = ["As Ah", "Ks Kh", "2c 7d 9s Jh 3c"]; // the top man (a) wins this one

test("poker hands: every class, kickers, the wheel, and the best five of seven", () => {
  const ev = (x) => E.evalHand(cd(x)), cls = (x) => ev(x).cls;
  assert.equal(cls("As Kd 9c 5h 3d 2s 7c"), 0);
  assert.equal(cls("As Ad 9c 5h 3d 2s 7c"), 1);
  assert.equal(cls("As Ad 9c 9h 3d 2s 7c"), 2);
  assert.equal(cls("As Ad 9c 9h 3d 3s 7c"), 2, "three pairs are still two pair");
  assert.equal(cls("As Ad Ac 5h 3d 2s 7c"), 3);
  assert.equal(cls("9s 8d 7c 6h 5d Ks 2c"), 4);
  assert.equal(cls("As 2d 3c 4h 5d Ks 9c"), 4, "the wheel");
  assert.equal(ev("As 2d 3c 4h 5d Ks 9c").hi, 5, "the wheel is a five-high straight");
  assert.equal(cls("Qs Kd Ac 2h 3d 9s 7c"), 0, "ace-high does not wrap round");
  assert.equal(cls("As 9s 7s 4s 2s Kd Kc"), 5);
  assert.equal(cls("As Ad Ac 5h 5d 2s 7c"), 6);
  assert.equal(cls("As Ad Ac 5h 5d 5s 7c"), 6, "two threes: the better one is the three, the other makes the pair");
  assert.equal(cls("As Ad Ac Ah 5d 2s 7c"), 7);
  assert.equal(cls("9s 8s 7s 6s 5s Ks 2c"), 8);
  assert.equal(cls("As 2s 3s 4s 5s Kd 9c"), 8, "the steel wheel");
  assert.equal(cls("9s 8s 7s 6s 5d Ks 2s"), 5, "a flush and a straight that are not the same five cards");
  assert.equal(cls("As Ks Qs Js Ts 2s 2d"), 8);
  const beats = (x, y) => assert.ok(ev(x).score > ev(y).score, `${x} beats ${y}`);
  beats("As Ad 9c 5h 3d 2s 7c", "Ks Kd 9c 5h 3d 2s 7c");
  beats("As Ad Kc 5h 3d 2s 7c", "As Ad Qc 5h 3d 2s 7c");
  beats("As Ad 9c 9h 3d 2s 7c", "Ks Kd 9c 9h 3d 2s 7c");
  beats("As Ad 9c 9h Kd 2s 7c", "As Ad 9c 9h Qd 2s 7c");
  beats("As Ad 9c 9h 3d 3s Kc", "As Ad 9c 9h 3d 3s Qc");
  beats("As Ad 9c 9h 3d 3s Kc", "Ks Kd 9c 9h 3d 3s Ac");
  beats("6s 5d 4c 3h 2d Ks 9c", "As 2d 3c 4h 5d Ks 9c");
  beats("As Ad Ac Kh Kd 2s 7c", "Ks Kd Kc Ah Ad 2s 7c");
  beats("As Ad Ac Ah Kd 2s 7c", "Ks Kd Kc Kh Ad 2s 7c");
  beats("As Ad Ac Ah Kd 2s 7c", "As Ad Ac Ah Qd 2s 7c");
  beats("Ks Qs 9s 4s 2s Ad Ac", "Js Ts 9s 4s 2s Ad Ac");
  beats("As Ks Qs 4s 2s 9d 9c", "As Ks Js 4s 2s 9d 9c");
  beats("Ts 9s 8s 7s 6s Ad Ac", "9s 8s 7s 6s 5s Ad Ac");
  assert.equal(ev("As Kd 9c 5h 3d").score, ev("Ac Kh 9d 5s 3c").score, "suits never break a tie");
});

test("poker hands: agrees with a slow, independent evaluator on thousands of random hands", () => {
  // the reference scores a 5-card hand by counting ranks; the best of the 21 five-card subsets of seven cards
  const five = (cs) => {
    const r = cs.map((c) => (c % 13) + 2).sort((a, b) => b - a), su = cs.map((c) => Math.floor(c / 13)), fl = su.every((x) => x === su[0]);
    const cnt = {}; for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
    const g = Object.entries(cnt).map(([k, v]) => [v, Number(k)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let sr = 0; if (new Set(r).size === 5) { if (r[0] - r[4] === 4) sr = r[0]; else if (r.join() === "14,5,4,3,2") sr = 5; }
    const ks = sr ? [sr] : g.map((x) => x[1]);
    const cls = sr && fl ? 8 : g[0][0] === 4 ? 7 : g[0][0] === 3 && g[1]?.[0] === 2 ? 6 : fl ? 5 : sr ? 4 : g[0][0] === 3 ? 3 : g[0][0] === 2 && g[1]?.[0] === 2 ? 2 : g[0][0] === 2 ? 1 : 0;
    return [cls, ...ks];
  };
  const cmp = (x, y) => { for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const best = (cs) => { let b = null; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const v = five(cs.filter((_, k) => k !== i && k !== j)); if (!b || cmp(v, b) > 0) b = v; } return b; };
  const rs = { rng: 12345 }, seen = new Set();
  const deal = () => { const d = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { const j = Math.floor(E.rand(rs) * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
  for (let n = 0; n < 4000; n++) {
    const d = deal(), x = d.slice(0, 7), y = d.slice(7, 14), ex = E.evalHand(x), ey = E.evalHand(y), bx = best(x), by = best(y);
    assert.equal(ex.cls, bx[0], x.join());
    seen.add(ex.cls);
    assert.equal(Math.sign(ex.score - ey.score), Math.sign(cmp(bx, by)), `${x} vs ${y}`);
  }
  assert.ok(seen.size >= 6, "the random hands cover most classes");
});

test("poker ground: a takedown deals a hand: both ante 1, two hole cards each, three on the table, the bottom man acts first", () => {
  const st = plain("a"), g = st.c.ground, h = g.h;
  assert.equal(g.dealt, 1);
  assert.equal(st.a.stam, 19); assert.equal(st.b.stam, 19);
  assert.deepEqual(h.put, { a: 1, b: 1 });
  assert.equal(h.hole.a.length, 2); assert.equal(h.hole.b.length, 2); assert.equal(h.shown, 3);
  assert.equal(new Set([...h.hole.a, ...h.hole.b, ...h.board]).size, 9, "nine different cards from one 52-card deck");
  const o = E.pokerOptions(st);
  assert.deepEqual({ turn: o.turn, round: o.round, phase: o.phase, pot: o.pot, owe: o.owe }, { turn: "b", round: 1, phase: "bet", pot: 2, owe: 0 });
  assert.equal(E.chooseGround(st, "a", "call"), false, "the top man waits");
  assert.equal(E.options(st), null, "the cards wait");
  const first = [...h.hole.a, ...h.board].join();
  setHand(st, ...AA_KK); checkDown(st); pact(st, "a", "cash");
  assert.equal(st.c.ground.dealt, 2);
  assert.notEqual([...st.c.ground.h.hole.a, ...st.c.ground.h.board].join(), first, "a new shuffle for each hand");
});

test("poker ground: betting runs bottom first; round one raises 2, round two raises 4, two raises a round; a call matches; a fold ends the hand", () => {
  const st = plain("a"), P = st.cfg.groundPoker;
  setHand(st, ...AA_KK);
  let o = E.pokerOptions(st);
  assert.deepEqual(o.actions, ["fold", "call", "raise"], "no all-in in the first layer");
  assert.equal(o.raise, P.raise[0]);
  pact(st, "b", "raise");
  assert.equal(st.b.stam, 17); assert.equal(st.c.ground.h.street.b, 2);
  o = E.pokerOptions(st);
  assert.equal(o.turn, "a"); assert.equal(o.owe, 2); assert.ok(o.actions.includes("raise"));
  pact(st, "a", "raise"); // call 2 and raise 2 more: the second raise of the round
  assert.equal(st.a.stam, 15);
  o = E.pokerOptions(st);
  assert.equal(o.turn, "b"); assert.equal(o.owe, 2); assert.ok(!o.actions.includes("raise"), "two raises a round at most");
  pact(st, "b", "call");
  assert.equal(st.b.stam, 15);
  o = E.pokerOptions(st);
  assert.deepEqual({ round: o.round, turn: o.turn, owe: o.owe, pot: o.pot }, { round: 2, turn: "b", owe: 0, pot: 10 }, "two more cards, a new round, the bottom man again");
  assert.equal(st.c.ground.h.shown, 5);
  assert.equal(o.raise, P.raise[1]);
  pact(st, "b", "raise");
  assert.equal(st.b.stam, 11);
  // a fold: the folder's stake is gone, the other man takes his own back
  pact(st, "a", "fold");
  assert.equal(st.a.stam, 15, "the folder keeps what is left, not what he put in");
  assert.equal(st.b.stam, 20, "the winner gets his own 9 back");
  assert.equal(st.c.ground, null, "the bottom man won the hand: out of the first layer, he stands up");
});

test("poker ground: a raise is capped by what the other man can cover; all-in only in side control and the mount", () => {
  const st = plain("a");
  st.c.ground.layer = 2;
  setHand(st, ...AA_KK);
  let o = E.pokerOptions(st);
  assert.ok(o.actions.includes("allin"), "side control: all-in is offered");
  assert.equal(o.allin, 19, "everything he has left");
  st.a.stam = 3; // the top man can cover only 3 more
  o = E.pokerOptions(st);
  assert.equal(o.allin, 3, "he cannot be raised by more than the other man can call");
  assert.equal(o.raise, 2);
  pact(st, "b", "allin");
  assert.equal(st.b.stam, 16); assert.equal(E.pokerOptions(st).owe, 3);
  pact(st, "a", "call");
  assert.equal(st.a.stam, 4, "he called with all he had, won, and has his 4 back");
  // someone is out of stamina: the rest of the table is dealt out and the cards are shown
  assert.equal(st.c.ground.h.phase, "decide");
  assert.ok(st.c.ground.h.reveal);
  assert.equal(st.c.ground.h.shown, 5);
  const m = plain("a"); m.c.ground.layer = 3;
  assert.ok(E.pokerOptions(m).actions.includes("allin"), "the mount too");
  assert.ok(!E.pokerOptions(plain("a")).actions.includes("allin"), "not in half guard");
});

test("poker ground: the loser's stake is gone, the winner takes his own back; the stamina carries through the bout and comes back by 6 a round", () => {
  const st = plain("a");
  setHand(st, ...AA_KK);
  pact(st, "b", "raise"); pact(st, "a", "call"); // 3 each
  checkDown(st);
  assert.equal(st.c.ground.h.phase, "decide");
  assert.equal(st.a.stam, 20, "the winner has his stake back");
  assert.equal(st.b.stam, 17, "the loser put 3 in and lost them");
  pact(st, "a", "cash");
  assert.equal(st.c.ground.dealt, 2);
  assert.equal(st.b.stam, 16, "and he antes again out of what is left");
  // a split pot gives both their stake back and stands them up
  const t = plain("a");
  setHand(t, "2s 3h", "2d 3c", "As Ks Qh 9d 8c");
  checkDown(t);
  assert.equal(t.a.stam, 20); assert.equal(t.b.stam, 20);
  assert.equal(t.c.ground, null, "a split: stand up");
  // the minute's rest
  const u = E.createGame(pdata(), "makhachev", "poirier", 5);
  put(u, "a", ["cross"]); put(u, "b", ["cross"]);
  u.a.stam = 10; u.b.stam = 18; u.clash = u.cfg.clashes;
  E.playClash(u);
  assert.equal(u.rounds.length, 1, "the round ended");
  assert.equal(u.a.stam, 16); assert.equal(u.b.stam, 20, "up to 6 more, never over the top");
});

test("poker ground: the top man winning cashes in (half the pot rounded up, times the layer, capped) and stays for another hand, or passes deeper", () => {
  const st = plain("a");
  setHand(st, ...AA_KK);
  pact(st, "b", "raise"); pact(st, "a", "call");
  pact(st, "b", "raise"); pact(st, "a", "call"); // round 2: 4 more each
  assert.equal(st.c.ground.h.put.b, 7);
  let o = E.pokerOptions(st);
  assert.equal(o.phase, "decide");
  assert.deepEqual({ turn: o.turn, cash: o.cash, pot: o.pot, actions: o.actions }, { turn: "a", cash: 7, pot: 14, actions: ["cash", "deeper"] });
  const hp = st.b.hp;
  pact(st, "a", "cash");
  assert.equal(st.b.hp, hp - 7); assert.equal(st.a.stats.dmg, 7);
  assert.equal(st.c.ground.layer, 1, "he stays on the layer"); assert.equal(st.c.ground.dealt, 2);
  // side control doubles it, the mount quadruples it, and it stops at the cap
  for (const [layer, want] of [[2, 2], [3, 4]]) {
    const t = plain("a"); t.c.ground.layer = layer; setHand(t, ...AA_KK); checkDown(t);
    assert.equal(E.pokerOptions(t).cash, want);
  }
  const big = plain("a"); big.c.ground.layer = 3; setHand(big, ...AA_KK);
  pact(big, "b", "raise"); pact(big, "a", "raise"); pact(big, "b", "call"); checkDown(big);
  assert.equal(E.pokerOptions(big).cash, big.cfg.groundPoker.cap);
  // deeper: no hit, one layer in, a new hand
  const d = plain("a"); setHand(d, ...AA_KK); checkDown(d);
  const hp2 = d.b.hp; pact(d, "a", "deeper");
  assert.equal(d.b.hp, hp2); assert.equal(d.c.ground.layer, 2); assert.equal(d.c.ground.dealt, 2);
  // not from the mount, not on the last hand
  const m = plain("a"); m.c.ground.layer = 3; setHand(m, ...AA_KK); checkDown(m);
  assert.deepEqual(E.pokerOptions(m).actions, ["cash"]);
  const l = plain("a"); l.c.ground.dealt = 3; setHand(l, ...AA_KK); checkDown(l);
  assert.deepEqual(E.pokerOptions(l).actions, ["cash"]);
  pact(l, "a", "cash"); assert.equal(l.c.ground, null, "three hands at most: then they stand up");
});

test("poker ground: the bottom man winning slips out one layer; out of the first layer he stands up; a fold hands it over too", () => {
  const st = plain("a"); st.c.ground.layer = 2;
  setHand(st, "Ks Kh", "As Ah", "2c 7d 9s Jh 3c"); checkDown(st);
  assert.equal(st.c.ground.layer, 1); assert.equal(st.c.ground.dealt, 2); assert.equal(st.c.ground.top, "a", "still the same man on top");
  const t = plain("a");
  setHand(t, "Ks Kh", "As Ah", "2c 7d 9s Jh 3c"); checkDown(t);
  assert.equal(t.c.ground, null, "out of the first layer: stand up");
  const f = plain("a"); f.c.ground.layer = 2;
  pact(f, "b", "raise"); pact(f, "a", "fold");
  assert.equal(f.c.ground.layer, 1, "the top man gave up the hand: the bottom man slips out");
  const l = plain("a"); l.c.ground.dealt = 3; l.c.ground.layer = 2; setHand(l, "Ks Kh", "As Ah", "2c 7d 9s Jh 3c"); checkDown(l);
  assert.equal(l.c.ground, null, "no fourth hand");
});

test("poker ground: draining the bottom man to nothing in side control or the mount is a submission that ends the bout; in half guard it only leaves him unable to bet", () => {
  const drain = (layer) => {
    const st = plain("a"); st.c.ground.layer = layer; st.b.stam = 2;
    setHand(st, ...AA_KK);
    pact(st, "b", "raise"); // 2 more: all he has
    assert.equal(st.b.stam, 0);
    pact(st, "a", "call");
    return st;
  };
  for (const layer of [2, 3]) {
    const st = drain(layer);
    assert.equal(st.c.sub, "b"); assert.equal(st.c.ground, null);
    const log = evs(st, "pend").at(-1);
    assert.deepEqual({ res: log.res, sub: log.sub }, { res: "sub", sub: "drain" });
    let n = 0; while (st.phase === "clash" && n++ < 50) E.step(st);
    assert.deepEqual({ how: st.over.how, winner: st.over.winner }, { how: "SUB", winner: "a" });
    assert.equal(st.a.hp, st.cfg.hp, "no damage: the bout is simply over");
    assert.equal(st.a.stats.won, 1);
  }
  const half = drain(1);
  assert.ok(half.c.ground, "half guard: no submission"); assert.equal(half.c.sub, null);
  assert.equal(half.c.ground.h.phase, "decide");
  pact(half, "a", "cash");
  // out of breath for the rest of this ground: the next hand has nothing to bet with, so it goes straight to the cards
  assert.equal(half.b.stam, 0);
  assert.equal(evs(half, "pdeal").length, 2); assert.equal(evs(half, "pend").length, 2);
  assert.equal(evs(half, "pend").at(-1).pot, 1, "only the top man's ante is in");
  assert.equal(evs(half, "pact").filter((e) => e.hand === 2 && e.act === "raise").length, 0);
  // the top man losing never submits him
  const top = plain("a"); top.c.ground.layer = 2; top.a.stam = 2;
  setHand(top, "Ks Kh", "As Ah", "2c 7d 9s Jh 3c");
  pact(top, "b", "raise"); pact(top, "a", "call"); // all of his
  assert.equal(top.a.stam, 0); assert.equal(top.c.sub, null, "only the bottom man is submitted");
  assert.equal(evs(top, "pend")[0].res, "bottom");
});

test("poker ground: a big hand locks it: a full house or better from side control, two pair or better from the mount, never from half guard; a fold never locks", () => {
  const run = (layer, a, board) => { const st = plain("a"); st.c.ground.layer = layer; setHand(st, a, "Qs Jh", board); checkDown(st); return st; };
  assert.equal(run(2, "Ad Ac", "Ah 7s 7d 3c 9h").c.sub, "b", "full house in side control");
  assert.equal(run(2, "Ad Ac", "Ah 2s 7d 3c 9h").c.sub, null, "three of a kind is not enough in side control");
  assert.equal(run(2, "Ad 7c", "Ah 7s 2d 3c 9h").c.sub, null, "two pair is not enough in side control");
  assert.equal(run(3, "Ad 7c", "Ah 7s 2d 3c 9h").c.sub, "b", "two pair in the mount");
  assert.equal(run(3, "Ad Kc", "Ah 7s 2d 3c 9h").c.sub, null, "one pair is not");
  assert.equal(run(1, "Ad Ac", "Ah 7s 7d 3c 9h").c.sub, null, "never from half guard");
  assert.equal(run(2, "Ad Ac", "Ah 7s 7d 3c 9h").c.ground, null);
  assert.equal(evs(run(2, "Ad Ac", "Ah 7s 7d 3c 9h"), "pend").at(-1).sub, "lock");
  const f = plain("a"); f.c.ground.layer = 3; setHand(f, "Ad 7c", "Qs Jh", "Ah 7s 2d 3c 9h");
  pact(f, "b", "fold"); assert.equal(f.c.sub, null, "no showdown, no lock");
});

test("poker ground: the cards on the board - each effect lives in the card's own data", () => {
  // a single leg: the first hand, swap one hole card
  const s1 = pg("a", ["singleleg"], ["highguard"]);
  let o = E.pokerOptions(s1);
  assert.deepEqual({ phase: o.phase, turn: o.turn, actions: o.actions }, { phase: "swap", turn: "a", actions: ["keep", "swap0", "swap1"] });
  const h1 = s1.c.ground.h, was = [...h1.hole.a], next = h1.deck[h1.next];
  pact(s1, "a", "swap1");
  assert.deepEqual([h1.hole.a[0], h1.hole.a[1]], [was[0], next], "the second card is replaced by the next card of the deck");
  assert.equal(E.pokerOptions(s1).phase, "bet");
  setHand(s1, ...AA_KK); checkDown(s1); pact(s1, "a", "cash");
  assert.equal(E.pokerOptions(s1).phase, "bet", "only the first hand");
  const s0 = pg("a", ["singleleg"], ["highguard"]); pact(s0, "a", "keep"); assert.equal(E.pokerOptions(s0).phase, "bet");
  // a double leg: he antes 2 more on the first hand only
  const s2 = pg("a", ["doubleleg"], ["cross"]);
  assert.deepEqual(s2.c.ground.h.put, { a: 1, b: 3 }); assert.equal(s2.b.stam, 17);
  setHand(s2, ...AA_KK); checkDown(s2);
  assert.equal(E.pokerOptions(s2).pot, 4); assert.equal(E.pokerOptions(s2).cash, 2);
  pact(s2, "a", "cash");
  assert.deepEqual(s2.c.ground.h.put, { a: 1, b: 1 });
  // a wrestling coach: one look at one of his hole cards a ground
  const s3 = pg("a", ["doubleleg", "wrestlecoach"], ["cross"]);
  setHand(s3, ...AA_KK);
  pact(s3, "b", "call");
  assert.ok(E.pokerOptions(s3).actions.includes("peek"), "the top man may look");
  assert.deepEqual(E.pokerView(s3, "a").foe.cards.filter((c) => c != null), []);
  pact(s3, "a", "peek");
  const seen = E.pokerView(s3, "a").foe.cards.filter((c) => c != null);
  assert.equal(seen.length, 1); assert.ok(cd("Ks Kh").includes(seen[0]));
  assert.equal(E.pokerOptions(s3).turn, "a", "looking does not use the turn");
  assert.ok(!E.pokerOptions(s3).actions.includes("peek"), "once a ground");
  checkDown(s3); pact(s3, "a", "cash");
  assert.ok(!E.pokerOptions(s3).actions.includes("peek"), "not again on the next hand");
  assert.deepEqual(E.pokerView(s3, "b").foe.cards, [null, null], "he sees nothing of yours");
  // ground elbows: every hand the top man wins costs him one more
  const s4 = pg("a", ["doubleleg", "elbows"], ["cross"]);
  setHand(s4, ...AA_KK); checkDown(s4);
  assert.equal(s4.b.stam, 20 - 3 - 1, "lost his stake of 3 and 1 more");
  // ground and pound: +2 when you cash in
  const s5 = pg("a", ["doubleleg", "groundpound"], ["cross"]);
  setHand(s5, ...AA_KK); checkDown(s5);
  assert.equal(E.pokerOptions(s5).cash, 2 + 2); const hp = s5.b.hp; pact(s5, "a", "cash"); assert.equal(s5.b.hp, hp - 4);
  // a rear-naked choke: two pair locks it from side control, and only there
  const s6 = pg("a", ["doubleleg", "rnc"], ["cross"]); s6.c.ground.layer = 2;
  setHand(s6, "Ad 7c", "Qs Jh", "Ah 7s 2d 3c 9h"); checkDown(s6);
  assert.equal(s6.c.sub, "b");
  const s6b = pg("a", ["doubleleg", "rnc"], ["cross"]); setHand(s6b, "Ad 7c", "Qs Jh", "Ah 7s 2d 3c 9h"); checkDown(s6b);
  assert.equal(s6b.c.sub, null, "half guard: still not");
  // a guillotine: the bottom man submits from half guard with two pair at a won showdown
  const s7 = pg("a", ["doubleleg"], ["cross", "guillotine"]);
  setHand(s7, "Qs Jh", "Ad 7c", "Ah 7s 2d 3c 9h"); checkDown(s7);
  assert.equal(s7.c.sub, "a"); let n = 0; while (s7.phase === "clash" && n++ < 50) E.step(s7);
  assert.deepEqual({ how: s7.over.how, winner: s7.over.winner }, { how: "SUB", winner: "b" });
  const s7b = pg("a", ["doubleleg"], ["cross", "guillotine"]); setHand(s7b, "Qs Jh", "Ad 9c", "Ah 7s 2d 3c 4h"); checkDown(s7b);
  assert.equal(s7b.c.sub, null, "one pair is not enough");
  const s7c = pg("a", ["doubleleg"], ["cross"]); setHand(s7c, "Qs Jh", "Ad 7c", "Ah 7s 2d 3c 9h"); checkDown(s7c);
  assert.equal(s7c.c.sub, null, "no card, no counter");
  // a shrimp: the first time he is drained in side control, 3 back; once a ground
  const s8 = pg("a", ["doubleleg"], ["cross", "shrimp"]); s8.c.ground.layer = 2; s8.b.stam = 2; setHand(s8, ...AA_KK);
  pact(s8, "b", "raise"); pact(s8, "a", "call");
  assert.equal(s8.c.sub, null); assert.equal(s8.b.stam, 3); assert.equal(E.pokerOptions(s8).phase, "decide");
  assert.equal(evs(s8, "pend").at(-1).refill, 3);
  const s9 = pg("a", ["doubleleg"], ["cross", "shrimp"]); s9.c.ground.layer = 2; s9.b.stam = 2; setHand(s9, ...AA_KK);
  pact(s9, "b", "raise"); pact(s9, "a", "call"); pact(s9, "a", "deeper"); // a new hand, one layer deeper
  s9.b.stam = 2; setHand(s9, ...AA_KK); pact(s9, "b", "raise"); pact(s9, "a", "call");
  assert.equal(s9.c.sub, "b", "the second time there is no shrimp left");
  const s10 = pg("a", ["doubleleg"], ["cross", "shrimp"]); s10.b.stam = 2; setHand(s10, ...AA_KK);
  pact(s10, "b", "raise"); pact(s10, "a", "call"); assert.equal(s10.b.stam, 0, "half guard: the shrimp does not help");
});

test("poker ground: you see your own cards, the table, and his only after a look or the showdown; a knockout on the mat ends the bout", () => {
  const st = plain("a"); setHand(st, ...AA_KK);
  const v = E.pokerView(st, "a");
  assert.deepEqual(v.mine.cards, cd("As Ah")); assert.deepEqual(v.foe.cards, [null, null]); assert.equal(v.board.length, 3); assert.equal(v.mine.hand.cls, 1);
  assert.equal(v.foe.hand, null);
  checkDown(st);
  const w = E.pokerView(st, "a");
  assert.deepEqual(w.foe.cards, cd("Ks Kh")); assert.equal(w.board.length, 5); assert.equal(w.foe.hand.cls, 1);
  const k = plain("a"); k.b.hp = 1; setHand(k, ...AA_KK); checkDown(k); pact(k, "a", "cash");
  assert.equal(k.c.ko, "b"); let n = 0; while (k.phase === "clash" && n++ < 50) E.step(k);
  assert.deepEqual({ how: k.over.how, winner: k.over.winner }, { how: "KO", winner: "a" });
});

test("poker ground AI: the published style is the table it plays from; the reader uses only what it can see and leaves the game's dice alone", () => {
  const d = pdata();
  for (const id of Object.keys(d.fighters)) {
    const S = pokerStyle(E.createGame(d, id, "poirier", 1), "a");
    assert.deepEqual(S, { ...d.config.groundPoker.ai, ...d.fighters[id].ai.poker }, "the style on screen is the fighter's ai.poker over the defaults");
  }
  const spread = (key) => Math.max(...Object.values(d.fighters).map((f) => f.ai.poker[key])) - Math.min(...Object.values(d.fighters).map((f) => f.ai.poker[key]));
  assert.ok(spread("raise") >= 2 && spread("bluff") >= 0.1 && spread("allin") >= 1, "the fighters play very differently");
  // the table: below the raise class only bluffs raise; at it the man always raises; facing a bet below the call class he folds
  const S = { raise: 2, bluff: 0.2, call: 1, allin: 3, deepBelow: 3 }, free = { facing: false, canRaise: true, canAllin: true }, face = { ...free, facing: true };
  assert.deepEqual(pokerDist(S, 1, free), { raise: 0.2, call: 0.8 });
  assert.deepEqual(pokerDist(S, 2, free), { raise: 1, call: 0 });
  assert.deepEqual(pokerDist(S, 3, free), { allin: 1 });
  assert.deepEqual(pokerDist(S, 3, { ...free, canAllin: false }), { raise: 1, call: 0 });
  assert.deepEqual(pokerDist(S, 0, face), { raise: 0.2, fold: 0.8 });
  assert.deepEqual(pokerDist(S, 1, face), { raise: 0.2, call: 0.8 });
  assert.deepEqual(pokerDist(S, 0, { facing: false, canRaise: false, canAllin: false }), { raise: 0, call: 1 });
  // the opponent plays that table: poirier (raise class 1, bluff 15%) raises a high card 15% of the time and a pair always
  let bluffs = 0, strong = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const g = plain("a");
    g.rng = (i * 7919 + 13) >>> 0;
    setHand(g, "As Ah", "7s 2h", "Kc 9d 4s Jh 3c");
    if (pokerPick(g, "b") === "raise") bluffs++;
    setHand(g, "As Ah", "7s 7h", "Kc 9d 4s Jh 3c");
    if (pokerPick(g, "b") === "raise") strong++;
  }
  assert.ok(Math.abs(bluffs / N - d.fighters.poirier.ai.poker.bluff) < 0.06, `bluffs ${bluffs / N}`);
  assert.equal(strong, N, "a pair is at his raise class: always");
  // the reader: same cards -> same answer, the game's random state untouched
  const r = plain("a"); setHand(r, ...AA_KK); const rng0 = r.rng;
  r.c.ground.h.turn = "a";
  const e1 = pokerEquity(r, "a", E.pokerView(r, "a")), e2 = pokerEquity(r, "a", E.pokerView(r, "a"));
  assert.equal(e1, e2); assert.equal(r.rng, rng0); assert.ok(e1 > 0.7, "a pair of aces on that table is a favourite");
  setHand(r, "3s 4h", "Ks Kh", "2c 7d 9s Jh 8c");
  assert.ok(pokerEquity(r, "a", E.pokerView(r, "a")) < 0.45, "nothing much is an underdog");
  // it learns from his betting: poirier raises with a pair or better (or bluffs 15%), so a raise from him is a stronger hand than a random one
  const q = plain("b"); q.c.ground.layer = 1; setHand(q, "Ks Qh", "9s 2h", "Kc 9d 4s Jh 3c");
  const raised = pokerEquity(q, "a", { ...E.pokerView(q, "a"), log: [{ s: "b", act: "raise", round: 1, facing: false, canRaise: true, canAllin: false }] });
  const open = pokerEquity(q, "a", { ...E.pokerView(q, "a"), log: [] });
  assert.ok(raised < open, "a raise from him makes his hand stronger than average");
  // whole bouts play through with each kind of player, and every bout ends
  for (const k of Object.keys(groundersPoker)) {
    for (let i = 0; i < 6; i++) {
      const g = runGame(pdata(), ["makhachev", "poirier", "holloway"][i % 3], ["poirier", "holloway", "makhachev"][i % 3], 40 + i, shoppers.smart, undefined, undefined, groundersPoker[k]);
      assert.ok(g.over && ["KO", "DEC", "SUB"].includes(g.over.how), k);
    }
  }
});
