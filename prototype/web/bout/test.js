// node --test prototype/web/bout/test.js — rules of the card bout engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createBout, playBeat, settleKnockdown, actions, odds, dmgMul, heldCard, cardIds, setPlan, planDmg, moveCost, stepCost, targetScale, partRatio, injuries, cornerOptions, doCorner, PLANS, TARGETS } from "./engine.js";
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
    assert.ok(["strike", "feint", "trap", "takedown", "sprawl", "ground"].includes(c.kind), id);
    assert.ok(c.text && c.text.length <= 14, `${id} text too long for the card face`);
    if (c.kind === "ground") assert.ok(["top", "bottom"].includes(c.role) && c.act, id);
    if (c.kind === "strike") assert.ok(["head", "body", "leg"].includes(c.region) && c.hit > 0 && c.dmg > 0, id);
    if (c.kind === "trap") assert.ok((c.trap.on.move || c.trap.on.tag) && c.trap.beats > 0, id);
  }
  for (const f of ["holloway", "poirier"]) for (const k of Object.keys(data.fighters[f].weights)) assert.ok(data.cards[k], `${f} weights unknown card ${k}`);
});

// ---------- round plan, target part and corner ----------
const countKinds = (st, s, kind, n = 300) => {
  let k = 0;
  for (let i = 0; i < n; i++) {
    setPlan(st, s, st.plan[s].plan, st.plan[s].target);
    k += st[s].hand.filter((h) => data.cards[h.id].kind === kind).length;
  }
  return k;
};

test("a plan changes how often cards come: counter draws more traps, probe more feints", () => {
  const base = fresh(5);
  const steady = countKinds(base, "a", "trap");
  const c = fresh(5);
  c.plan.a = { plan: "counter", target: null };
  assert.ok(countKinds(c, "a", "trap") > steady * 1.2, "counter should draw clearly more traps");
  const p = fresh(5);
  const f0 = countKinds(p, "a", "feint");
  p.plan.a = { plan: "probe", target: null };
  assert.ok(countKinds(p, "a", "feint") > f0 * 1.3, "probe should draw clearly more feints");
});

test("a target part raises how many cards for that part you draw", () => {
  const count = (target) => {
    const st = fresh(8);
    st.plan.a = { plan: "steady", target };
    let n = 0;
    for (let i = 0; i < 300; i++) { setPlan(st, "a", "steady", target); n += st.a.hand.filter((h) => data.cards[h.id].region === "leg").length; }
    return n;
  };
  assert.ok(count("leg") > count(null) * 1.3);
});

test("plans change damage and stamina exactly as configured; steady changes nothing", () => {
  const st = fresh();
  const jab = data.cards.jab;
  assert.equal(planDmg(st, "a", jab), 1);
  setPlan(st, "a", "burst", null);
  assert.ok(near(planDmg(st, "a", jab), cfg.plans.burst.dmgMul));
  setPlan(st, "a", "probe", null);
  assert.ok(near(planDmg(st, "a", jab), cfg.plans.probe.dmgMul));
  // regen: a guard beat restores more with probe than with burst
  const gain = (plan) => {
    const s2 = at(1, JABS, JABS);
    setPlan(s2, "a", plan, null);
    setHand(s2, "a", JABS);
    s2.a.stamina = 5;
    playBeat(s2, { move: "guard" }, { move: "guard" });
    return s2.a.stamina - 5;
  };
  assert.ok(gain("probe") > gain("burst"));
});

test("pressure makes the opponent's retreat cost more, for a move and for a step back", () => {
  const st = fresh();
  assert.equal(moveCost(st, "b", "retreat"), cfg.moves.retreat.cost);
  setPlan(st, "a", "pressure", null);
  assert.equal(moveCost(st, "b", "retreat"), cfg.moves.retreat.cost + cfg.plans.pressure.foeRetreatCost);
  assert.equal(stepCost(st, "b", -1), cfg.step.cost + cfg.plans.pressure.foeRetreatCost);
  assert.equal(moveCost(st, "a", "retreat"), cfg.moves.retreat.cost, "pressure does not tax the one who presses");
});

test("the target bonus is small against a fresh part and large against a hurt one", () => {
  const st = fresh();
  setPlan(st, "a", "steady", "leg");
  const fresh0 = targetScale(st, "a", "leg");
  st.b.leg = cfg.leg.limp * 0.8;
  const hurt = targetScale(st, "a", "leg");
  assert.ok(hurt > fresh0 * 1.8, `${fresh0} → ${hurt}`);
  const low = data.cards.lowkick;
  assert.ok(planDmg(st, "a", low) > 1);
  assert.equal(planDmg(st, "a", data.cards.jab), 1, "other parts get nothing");
  assert.ok(odds(st, "a", low, { d: 1 }).why.includes("target"));
  assert.ok(!odds(st, "a", data.cards.jab, { d: 1 }).why.includes("target"));
});

test("plans can only be chosen before a round starts, and only from the table", () => {
  const st = fresh();
  assert.throws(() => setPlan(st, "a", "nonsense", null), /unknown plan/);
  assert.throws(() => setPlan(st, "a", "steady", "elbow"), /unknown target/);
  playBeat(st, { move: "guard" }, { move: "guard" });
  assert.throws(() => setPlan(st, "a", "burst", null), /before the round/);
  assert.ok(PLANS(data).length >= 4 && TARGETS(data).length === 3);
});

test("corner: the doctor is only offered when something is hurt, and he treats the worst part", () => {
  const st = fresh();
  assert.equal(cornerOptions(st, "a").doctor, false);
  assert.throws(() => doCorner(st, "a", ["doctor"]), /not available/);
  st.a.head = data.fighters.holloway.chin * 0.8;
  st.a.leg = cfg.leg.limp * 0.5;
  assert.equal(injuries(st, "a")[0].part, "head");
  const before = partRatio(st, "a", "head");
  const r = doCorner(st, "a", ["doctor", "rest"]);
  assert.equal(r.healed, "head");
  assert.ok(near(partRatio(st, "a", "head"), before * (1 - cfg.corner.doctorRelief)));
  assert.equal(r.rested, true);
  assert.throws(() => doCorner(st, "a", ["coach", "rest", "doctor"]), /two at most/);
});

test("corner: rest restores stamina up to the cap; the coach reports true habits and an honest-but-noisy feel", () => {
  const st = fresh(11);
  for (let i = 0; i < cfg.beatsPerRound; i++) playBeat(st, { move: "guard" }, { move: "retreat" });
  assert.equal(st.round, 1);
  assert.equal(st.rounds.length, 1);
  assert.equal(st.rounds[0].mix.b.retreat, cfg.beatsPerRound);
  st.a.stamina = st.a.staminaMax - 1;
  const r = doCorner(st, "a", ["coach", "rest"]);
  assert.equal(st.a.stamina, st.a.staminaMax);
  assert.ok(["ours", "theirs", "close"].includes(r.intel.feel));
  const habit = r.intel.facts.find((f) => f.k === "habit");
  assert.deepEqual([habit.what, habit.n, habit.of], ["retreat", cfg.beatsPerRound, cfg.beatsPerRound]);
});

test("probing leaves a true fact about the opponent at the end of the round", () => {
  const st = fresh(12);
  setPlan(st, "a", "probe", null);
  for (let i = 0; i < cfg.beatsPerRound; i++) playBeat(st, { move: "guard" }, { move: "guard" });
  const r = doCorner(st, "a", ["coach"]);
  const f = r.intel.facts.find((x) => x.k === "weak" || x.k === "range");
  assert.ok(f, "probe should scout something");
  if (f.k === "weak") {
    const avg = (key) => Object.values(data.fighters).filter((x) => x && x.chin).reduce((t, x) => t + x[key], 0) / 2;
    assert.ok(data.fighters.poirier[f.what] / avg(f.what) < 1, "the fact must be a real weakness of the opponent");
  }
  const r2 = doCorner(fresh(12), "a", ["coach"]);
  assert.equal(r2.intel, null, "no round yet: nothing to report");
});

test("whole bouts with plans and corners keep every invariant", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { st } = fight("holloway", "poirier", seed);
    assert.ok(st.over);
    assert.equal(st.rounds.length, st.over.cards ? cfg.rounds : st.rounds.length);
  }
});

test("ground: thinking-computer bouts with a wrestler keep every invariant and end", () => {
  for (let seed = 1; seed <= 40; seed++) assert.ok(fight("poirier", "makhachev", seed).st.over);
});

test("ground: a masher-vs-masher bout with a wrestler never breaks an invariant", () => {
  for (let seed = 1; seed <= 40; seed++) fight("makhachev", "poirier", seed, createMasher, createMasher);
});
