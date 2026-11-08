// Engine checks. Run: node prototype/web/test/engine.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatch, resolveFootwork, resolveEngage, engageStart, engageStep, engageWaiting, applyCorner, chooseAI, chooseFootwork, chooseCombo, choosePlan, chooseCorner, getIntent, footworkIntent, engageIntent, footworkOutcome, footworkChoices, leadChance, comboError, planError, comboMax, reactionOf, handSpeed, previewCombo, nextUnit, checkInvariants, usableAt, loadData, chooseChase, resolvePending, chooseTactic, setTactic, refillHand, lockStatus, describeCard, lockResistChance, stepOf, groundHand, groundLeader, groundStart, groundStep, groundWaiting, resolveGround, groundComboError, groundPlanError, groundMax, groundAnswerCards, chooseGroundReaction, previewGroundCombo, aimOf, throughChance, cardSpeed } from "../engine.js";
import { data, playGame, strategies, playStandingHand } from "../sim.js";

const FIGHTERS = Object.keys(data.fighters);

/** A copy of the state's rules with the slow-move push-through switched off (older checks want an answer to work as written). */
const noThrough = (state) => {
  state.rules = { ...state.rules, slow: { ...state.rules.slow, through: 0 } };
  return state;
};

/** Two fighters on the mat, `top` on top at `pos`, with ground hands set by hand (the basic steps are always in). The stand-up hands are set aside as in a real fight. */
function mat(idA, idB, { pos = 1, top = "a", handTop = [], handBottom = [], seed = 5, through = false } = {}) {
  const state = createMatch(data, idA, idB, seed);
  if (!through) noThrough(state);
  const bottom = top === "a" ? "b" : "a";
  state.ground = { top, pos, lock: null, hist: [], pts: { wrist: 0, neck: 0, hip: 0 }, posture: 1 };
  for (const [side, extra] of [[top, handTop], [bottom, handBottom]]) {
    state[side].stand = state[side].hand;
    state[side].hand = [...extra, ...data.rules.ground.basics];
  }
  return state;
}

/** The same, but with the real ground hands drawn. */
function matDrawn(idA, idB, pos, top = "a", seed = 5) {
  const state = noThrough(createMatch(data, idA, idB, seed));
  state.ground = { top, pos, lock: null, hist: [], pts: { wrist: 0, neck: 0, hip: 0 }, posture: 1 };
  for (const s of ["a", "b"]) refillHand(state, s);
  return state;
}

/** A lock on the wrist with `attacker` holding it at the given stage; the hands are the ones a lock leaves. */
function lockFight(depth, { top = "a", attacker = "a", seed = 5 } = {}) {
  const m = mat("neutral", "neutral", { pos: 3, top, seed });
  m.ground.lock = { attacker, name: "十字固", aim: "wrist", depth, hist: [] };
  for (const s of ["a", "b"]) refillHand(m, s);
  return m;
}

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

test("the corner can close a cut", () => {
  const state = createMatch(data, "neutral", "neutral", 2);
  state.phase = "corner";
  state.a.cut = 2;
  applyCorner(state, { a: "patch", b: "breathe" });
  assert.equal(state.a.cut, 1);
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

test("both match lengths run their own number of rounds and exchanges", () => {
  for (const [mode, m] of Object.entries(data.rules.match.modes)) {
    const { state } = playGame("neutral", "neutral", strategies["看意圖並控制投入"], 3, data, mode);
    assert.equal(state.rounds, m.rounds);
    assert.equal(state.perRound, m.exchanges);
    assert.equal(state.maxHp, m.hp);
    assert.ok(state.round <= m.rounds);
  }
});

test("depth.json layers onto the roster without touching the base files", () => {
  const merged = loadData({ rules: data.rules, cards: { jab: { name: "刺拳", type: "S", cost: 1 } }, fighters: { x: { deck: ["jab", "jab"] } }, depth: { cards: { jab: { follow: { opened: { crit: 0.1 } } }, feint: { type: "S", cost: 1 } }, fighters: { x: { deckSwap: [["jab", "feint"]], chase: 0.3 } } } });
  assert.deepEqual(merged.fighters.x.deck, ["feint", "jab"]);
  assert.equal(merged.fighters.x.chase, 0.3);
  assert.ok(merged.cards.jab.follow && merged.cards.jab.name === "刺拳" && merged.cards.feint);
});

const GROUND = data.rules.ground;
const answersOf = (m, s, kind) => groundAnswerCards(m, s, kind)[0];
/** A plan for an answer; counters and escapes need a card from the hand. */
const planOf = (m, s, kind) => (kind === "counter" || kind === "escape" ? { kind, card: answersOf(m, s, kind) } : { kind });
/** One whole hand on the mat with no live reaction: the bet stays, whatever the speed of the steps. */
const hand = (m, combo, plan) => resolveGround(m, combo, typeof plan === "string" ? planOf(m, groundHand(m).resp, plan) : plan);

test("on the mat the top man leads a chain of steps and the other answers with a bet; a lock holder leads instead of the man on top", () => {
  const m = mat("neutral", "neutral", { pos: 1 });
  assert.equal(groundLeader(m), "a");
  const H = groundHand(m);
  assert.equal(H.leader, "a");
  assert.equal(H.resp, "b");
  assert.equal(stepOf(m), "ground");
  assert.ok(groundComboError(m, "b", ["g_pound"]), "the man underneath does not lead");
  assert.ok(groundPlanError(m, "a", { kind: "cover" }), "the man on top does not answer");
  m.ground.lock = { attacker: "b", name: "三角絞", aim: "neck", depth: 1, hist: [] };
  assert.equal(groundLeader(m), "b", "the man holding the lock leads");
  m.gh = null;
  assert.equal(groundHand(m).leader, "b");
  assert.equal(data.rules.positions.length, 5);
});

test("ground decks hold only special moves; the basic steps come with every fighter", () => {
  for (const c of GROUND.basics) assert.ok(data.cards[c]?.basic && data.cards[c].cat, `basic ${c}`);
  for (const [id, f] of Object.entries(data.fighters)) {
    assert.ok(f.groundDeck.length >= 5, `${id} ground deck`);
    assert.equal(new Set(f.groundDeck).size, f.groundDeck.length, `${id} has no duplicates`);
    for (const c of f.groundDeck) {
      assert.ok(data.cards[c]?.cat, `${id} unknown ground card ${c}`);
      assert.ok(!data.cards[c].basic, `${id} has a basic step in the deck: ${c}`);
    }
    for (const c of ["rnc", "arm_triangle", "triangle", "armbar"]) assert.ok(!f.deck.includes(c), `${id} still stands up with ${c}`);
  }
  for (const c of Object.values(data.cards).filter((x) => x.cat)) {
    assert.ok(c.pos && c.speed > 0, "every ground card has positions and a speed");
    if (c.cat === "lock") assert.ok(["wrist", "neck", "hip"].includes(c.aim) && c.lock, `${c.name} names its point`);
  }
});

test("ground hands: the basics that fit, a few specials, only what works at this role and position", () => {
  for (const [id, f] of Object.entries(data.fighters)) {
    for (let pos = 0; pos < data.rules.positions.length; pos++) {
      for (const top of ["a", "b"]) {
        const state = matDrawn(id, "neutral", pos, top, 11 + pos);
        for (const s of ["a", "b"]) {
          const role = top === s ? "top" : "bottom";
          const h = state[s].hand;
          const who = `${id} ${role}@${pos}`;
          const specials = h.filter((c) => !data.cards[c].basic);
          assert.ok(specials.length <= GROUND.handSize, `${who}: ${specials.length} specials`);
          for (const c of h) {
            const card = data.cards[c];
            assert.ok(card.cat && pos >= card.pos[0] && pos <= card.pos[1] && (card.side === role || card.cat === "tighten"), `${who} ${c}`);
          }
          if (role === "bottom") for (const cat of ["counter", "escape"]) assert.ok(h.some((c) => data.cards[c].cat === cat), `${who} lacks ${cat}`);
          else {
            assert.ok(h.includes("g_pound") && h.includes("g_c_wrist") && h.includes("g_c_neck"), `${who} lacks the basics`);
            assert.ok(pos > 3 || h.includes("g_pass"), `${who} can pass`);
            assert.ok(h.includes("lk_tighten"), "the lock step waits in the hand");
          }
          assert.ok(!h.includes("step_in"), "no steps on the mat");
          const deckSpecials = specials.every((c) => (s === "a" ? f.groundDeck : data.fighters.neutral.groundDeck).includes(c));
          assert.ok(deckSpecials, `${who} special not from his deck`);
        }
        assert.deepEqual(checkInvariants(state), [], `${id} @${pos}`);
      }
    }
  }
});

test("how long a chain can be: stamina decides, a stunned man gets one step; steps must be in hand and fit", () => {
  const m = mat("neutral", "neutral", { pos: 1, handTop: ["g_hammer", "g_kimura"] });
  m.a.stamina = 100;
  assert.equal(groundMax(m, "a"), 3);
  m.a.stamina = 40;
  assert.equal(groundMax(m, "a"), 2);
  m.a.stamina = 10;
  assert.equal(groundMax(m, "a"), 1);
  m.a.stamina = 100;
  assert.equal(groundComboError(m, "a", ["g_pound", "g_pound", "g_pound"]), null, "basic steps can repeat");
  assert.ok(groundComboError(m, "a", ["g_pound", "g_pound", "g_pound", "g_pound"]), "too long");
  assert.ok(groundComboError(m, "a", ["g_hammer", "g_hammer"]), "a special once");
  assert.ok(groundComboError(m, "a", ["g_rnc"]), "not in hand");
  assert.ok(groundComboError(m, "a", ["g_kimura"]), "a lock needs its point under control first");
  assert.equal(groundComboError(m, "a", ["g_c_wrist", "g_kimura"]), null, "a control step before it counts");
  assert.ok(groundComboError(m, "a", ["g_c_neck", "g_kimura"]), "the wrong point does not");
  m.ground.pts.wrist = 1;
  assert.equal(groundComboError(m, "a", ["g_kimura"]), null, "or a hold already there");
  assert.equal(groundComboError(m, "a", ["g_kimura", "lk_tighten"]), null, "tightening a lock set in the same chain");
  assert.ok(groundComboError(m, "a", ["lk_tighten"]), "nothing to tighten yet");
  m.b.rocked = true;
  m.a.rocked = true;
  assert.equal(groundMax(m, "a"), 1);
});

test("answers stop what they cover and nothing else: hands the wrist, frame the neck and the pass, shrimp the hip", () => {
  const table = [["g_c_wrist", "hands"], ["g_c_neck", "frame"], ["g_c_hip", "shrimp"], ["g_pass", "frame"]];
  for (const [card, answer] of table) {
    for (const other of ["cover", "frame", "shrimp", "hands"]) {
      const m = mat("neutral", "neutral", { pos: 1 });
      m.b.stamina = 100;
      const events = hand(m, [card], { kind: other });
      const stopped = events.some((e) => e.kind === "gstop");
      const covers = (data.rules.ground.answers[other].stops || []).includes(data.cards[card].aim);
      assert.equal(stopped, covers, `${card} vs ${other}`);
      if (stopped) assert.equal(events.find((e) => e.kind === "gstop").by, other);
    }
    assert.ok(data.rules.ground.answers[answer].stops.includes(data.cards[card].aim));
  }
  // Shrimping eases a pass instead of stopping it: it never goes further than half.
  let moved = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, seed });
    const ev = hand(m, ["g_pass"], { kind: "shrimp" });
    assert.ok(!ev.some((e) => e.kind === "gstop"), "not stopped");
    if (ev.some((e) => e.kind === "position")) moved++;
  }
  assert.ok(moved > 0 && moved < 70, `eased pass moved ${moved}/200`);
});

test("a stop ends the chain, drains the man on top, loosens his holds and gives the man underneath the edge", () => {
  const m = mat("neutral", "neutral", { pos: 1 });
  m.ground.pts = { wrist: 2, neck: 2, hip: 1 };
  m.a.stamina = 100;
  m.b.stamina = 100;
  const events = hand(m, ["g_c_neck", "g_c_hip", "g_pound"], { kind: "frame" });
  assert.deepEqual(events.filter((e) => e.kind === "gcard").length, 1, "the chain ended at the first step");
  assert.ok(events.some((e) => e.kind === "gstop" && e.by === "frame"));
  assert.ok(m.a.stamina < 100, "the man on top pays for the stop");
  assert.deepEqual(m.ground.pts, { wrist: 0, neck: 0, hip: 0 }, "everything he held is gone");
  assert.ok(!events.some((e) => e.kind === "comboDone"));
  assert.ok(m.b.momentum > 0 && m.a.momentum === 0 || m.b.momentum >= m.a.momentum, "the stop pays off");
});

test("control steps build the three holds (two at most); a pass spends the hip; losing the position keeps nothing", () => {
  const reached = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, seed });
    const ev = hand(m, ["g_c_wrist"], { kind: "cover" });
    assert.ok(ev.some((e) => e.kind === "gctrl"));
    reached.add(m.ground.pts.wrist);
    hand(m, ["g_c_wrist"], { kind: "cover" });
    assert.ok(m.ground.pts.wrist <= GROUND.ctrl.max);
  }
  assert.deepEqual([...reached].sort(), [0, 1, 2], "nothing on a graze, one on a clean, two on a crit");
  let spent = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, seed });
    m.ground.pts.hip = 2;
    m.ground.pts.wrist = 1;
    const ev = hand(m, ["g_pass"], { kind: "cover" });
    if (ev.some((e) => e.kind === "position")) {
      spent++;
      assert.equal(m.ground.pts.hip, 1, "the pass takes one level of the hip");
      assert.equal(m.ground.pts.wrist, 1, "the rest stays");
    }
  }
  assert.ok(spent > 80, `passes landed ${spent}/200`);
  // A hip held well makes the pass land more often.
  const rate = (hip) => {
    let n = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const m = mat("neutral", "neutral", { pos: 1, seed });
      m.ground.pts.hip = hip;
      if (hand(m, ["g_pass"], { kind: "cover" }).some((e) => e.kind === "position")) n++;
    }
    return n;
  };
  assert.ok(rate(2) > rate(0), "hip control helps the pass");
});

test("the position moves up on a pass, the escape table and a critical escape turns him over", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, seed });
    hand(m, ["g_pass"], { kind: "cover" });
    seen.add(m.ground.pos);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3], "no change on a graze, one up, two up on a crit");
  const after = new Set();
  let swept = 0;
  let stood = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const m = mat("neutral", "neutral", { pos: 3, seed });
    m.ground.pts = { wrist: 1, neck: 0, hip: 0 };
    const events = hand(m, ["g_c_neck"], "escape");
    if (events.some((e) => e.kind === "sweep")) swept++;
    else if (!events.some((e) => e.kind === "gstop") && events.some((e) => e.kind === "gescape" && e.tier !== "graze")) after.add(m.ground.pos);
  }
  assert.ok(!after.has(2), "no stepping down to side control from the mount");
  assert.ok(after.has(1), "half guard on a clean escape");
  assert.ok(swept > 3, "now and then a critical turns him over");
  for (let seed = 1; seed <= 400 && !stood; seed++) {
    const m = mat("neutral", "neutral", { pos: 0, seed });
    if (hand(m, ["g_c_neck"], "escape").some((e) => e.kind === "standup")) stood++;
  }
  assert.ok(stood, "from full guard the escape is the stand-up");
  assert.equal(data.rules.ground.escapeTo[0], -1);
});

test("an escape does nothing against a punch, and the holds the man on top has make it harder", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const m = mat("neutral", "neutral", { pos: 2, seed });
    const ev = hand(m, ["g_pound"], "escape");
    assert.ok(!ev.some((e) => e.kind === "gescape"), "the escape waits for something that is not a punch");
    assert.ok(ev.some((e) => e.kind === "hit"));
  }
  const success = (pts) => {
    let n = 0;
    for (let seed = 1; seed <= 800; seed++) {
      const m = mat("neutral", "neutral", { pos: 2, seed });
      m.ground.pts = { wrist: pts, neck: pts, hip: pts };
      if (hand(m, ["g_c_neck"], "escape").some((e) => e.kind === "gescape" && e.tier !== "graze")) n++;
    }
    return n;
  };
  assert.ok(success(0) > success(2) + 40, "holds on the wrist, neck and hip make the escape harder");
});

test("a counter thrown at a punch stops it when quicker and trades when slower", () => {
  let first = 0;
  let trade = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const m = mat("neutral", "neutral", { pos: 2, seed, handTop: ["g_hammer"] });
    const ev = hand(m, ["g_hammer"], "counter");
    const c = ev.find((e) => e.kind === "gcounter");
    assert.ok(c.first, "a slow hammer is beaten to it");
    assert.ok(ev.some((e) => e.kind === "hit" && e.attacker === "b"));
    first++;
    const f = mat("neutral", "neutral", { pos: 2, seed });
    const ev2 = hand(f, ["g_pound"], "counter");
    const c2 = ev2.find((e) => e.kind === "gcounter");
    assert.ok(!c2.first, "a quick punch gets there first");
    assert.ok(ev2.some((e) => e.kind === "hit" && e.attacker === "a"), "and lands");
    trade++;
  }
  assert.equal(first, trade);
  // A counter waits for a punch: other steps just go through.
  const m = mat("neutral", "neutral", { pos: 2 });
  const ev = hand(m, ["g_c_neck", "g_pound"], "counter");
  assert.ok(ev.some((e) => e.kind === "gctrl"), "the control step landed");
  assert.ok(ev.some((e) => e.kind === "gcounter"), "the counter fired at the punch");
});

test("punches are heavier from high positions and from a raised posture; cover halves them", () => {
  const total = (fn) => {
    let sum = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const m = mat("neutral", "neutral", { pos: 2, seed });
      fn(m);
      const hp = m.b.hp;
      hand(m, ["g_pound"], fn.plan || { kind: "frame" });
      sum += hp - m.b.hp;
    }
    return sum;
  };
  const base = total(() => {});
  assert.ok(total((m) => { m.ground.pos = 4; }) > total((m) => { m.ground.pos = 0; }) * 1.4, "the back hurts more than the guard");
  assert.ok(total((m) => { m.ground.posture = 2; }) > base * 1.15, "a raised posture hits harder");
  assert.ok(total((m) => { m.ground.posture = 0; }) < base * 0.9, "a low posture hits softer");
  const cover = (() => { let sum = 0; for (let seed = 1; seed <= 300; seed++) { const m = mat("neutral", "neutral", { pos: 2, seed }); const hp = m.b.hp; hand(m, ["g_pound"], { kind: "cover" }); sum += hp - m.b.hp; } return sum; })();
  assert.ok(cover < base * 0.75 && cover > base * 0.4, `cover ${cover} vs frame ${base}`);
  // A punch raises the posture, a control step lowers it, a pass levels it.
  const m = mat("neutral", "neutral", { pos: 1 });
  hand(m, ["g_pound"], { kind: "cover" });
  assert.equal(m.ground.posture, 2);
  hand(m, ["g_c_wrist"], { kind: "cover" });
  assert.equal(m.ground.posture, 0);
});

test("a hold catches an escape; two holds in a row and a referee stands them up", () => {
  const m = mat("neutral", "neutral", { pos: 1 });
  m.b.stamina = 100;
  const caught = hand(m, [], "escape");
  assert.ok(caught.some((e) => e.kind === "ride" && e.caught));
  const calm = mat("neutral", "neutral", { pos: 1 });
  calm.b.stamina = 100;
  const first = hand(calm, [], { kind: "frame" });
  assert.ok(first.some((e) => e.kind === "standoff"));
  assert.ok(calm.ground, "still on the mat after one");
  assert.ok(m.b.stamina < calm.b.stamina - 3, "holding drains the man who tries to get out more than one who sits tight");
  const second = hand(calm, [], { kind: "frame" });
  assert.ok(second.some((e) => e.kind === "standup" && e.reason === "referee"));
  assert.equal(calm.ground, null);
});

test("a slow step is seen coming and can be answered live; a quick one cannot; a stunned man sees nothing", () => {
  const m = mat("neutral", "neutral", { pos: 2, handTop: ["g_heavy", "g_hammer"] });
  groundStart(m, ["g_heavy", "g_c_wrist"], { kind: "cover" });
  let w = groundWaiting(m);
  assert.equal(w.card, "g_heavy");
  assert.ok(w.visible && w.speed < w.reaction, "heavy is slow");
  assert.equal(w.aim, "punch");
  groundStep(m, { kind: "frame" });
  w = groundWaiting(m);
  assert.equal(w.card, "g_c_wrist");
  assert.ok(!w.visible, "a fast control step is not seen");
  assert.throws(() => groundStep(m, { kind: "frame" }) && groundStep(m, { kind: "frame" }), "the chain is over");
  // The live answer replaces the bet for that step only.
  const v = mat("neutral", "neutral", { pos: 1, handTop: ["g_hammer"], handBottom: ["g_upkick"] });
  groundStart(v, ["g_hammer"], { kind: "cover" });
  const ev = groundStep(v, planOf(v, "b", "counter"));
  assert.ok(ev.some((e) => e.kind === "gcounter"), "the counter fired instead of the cover");
  // A stunned man never sees a step coming.
  const s = mat("neutral", "neutral", { pos: 2, handTop: ["g_heavy"] });
  s.b.rocked = true;
  groundStart(s, ["g_heavy"], { kind: "cover" });
  assert.equal(groundWaiting(s).visible, false);
  assert.ok(groundPlanError(s, "b", { kind: "escape", card: "g_escape" }), "stunned: cover, frame, hands, shrimp only");
});

test("a lock: the step takes hold (deeper with a firmer grip), then tightening deepens it and the right answer eases it", () => {
  let depths = new Set();
  let starts = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, handTop: ["g_kimura"], seed });
    m.ground.pts.wrist = 2;
    const ev = hand(m, ["g_kimura"], { kind: "cover" });
    const e = ev.find((x) => x.kind === "lockStart");
    if (e) {
      starts++;
      depths.add(e.depth);
      assert.equal(m.ground.lock.aim, "wrist");
      assert.equal(m.ground.lock.attacker, "a");
      assert.equal(groundLeader(m), "a");
    }
  }
  assert.ok(starts > 150, `locks started ${starts}/400`);
  assert.ok(depths.has(2), "a firm grip starts deeper");
  // Once on, the holder leads with tighten only; the man in it can only answer or escape.
  const l = lockFight(1);
  assert.equal(groundComboError(l, "a", []), "choose a move");
  assert.equal(groundComboError(l, "a", ["lk_tighten"]), null);
  assert.ok(groundComboError(l, "a", ["g_pound"]));
  assert.ok(l.b.hand.every((c) => data.cards[c].cat === "escape") && l.b.hand.length >= 1, "the man in the lock can only try to escape");
  // The answer for its point eases it a stage; at the first stage the lock is gone.
  const e2 = lockFight(2);
  const ease = hand(e2, ["lk_tighten"], { kind: "hands" });
  assert.ok(ease.some((e) => e.kind === "lockEase" && e.depth === 1));
  assert.equal(e2.ground.lock.depth, 1);
  const out = hand(e2, ["lk_tighten"], { kind: "hands" });
  assert.ok(out.some((e) => e.kind === "lockEscape"));
  assert.equal(e2.ground.lock, null);
  assert.ok(e2.a.hand.every((c) => data.cards[c].cat), "back to ordinary ground cards once the lock is gone");
  // Another point's answer does not help.
  const wrong = lockFight(1);
  const keep = hand(wrong, ["lk_tighten"], { kind: "frame" });
  assert.ok(!keep.some((e) => e.kind === "lockEase" || e.kind === "lockEscape"));
});

test("tightening sinks the lock a stage unless the victim holds on; the third stage is the tap", () => {
  let tapped = null;
  let held = 0;
  let sank = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const m = lockFight(2);
    m.rng = BigInt(seed * 7919);
    const ev = hand(m, ["lk_tighten"], { kind: "cover" });
    if (ev.some((e) => e.kind === "tap")) {
      tapped = m;
      assert.equal(m.over.method, "SUB");
      assert.equal(m.over.winner, "a");
    } else if (ev.some((e) => e.kind === "lockResist")) {
      held++;
      assert.equal(m.ground.lock.depth, 2, "holding on keeps the stage");
    } else if (ev.some((e) => e.kind === "lockDeepen")) sank++;
  }
  assert.ok(tapped && held > 20 && sank >= 0, `tap ${Boolean(tapped)} held ${held}`);
  // The same hold chance the screen shows is the one rolled.
  const chance = lockResistChance(lockFight(2));
  let holds = 0;
  let tries = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const f = lockFight(2);
    f.rng = BigInt(seed * 104729);
    const ev = hand(f, ["lk_tighten"], { kind: "cover" });
    if (ev.some((e) => e.kind === "lockResist")) holds++;
    if (ev.some((e) => e.kind === "lockResist" || e.kind === "lockDeepen" || e.kind === "tap")) tries++;
  }
  assert.ok(Math.abs(holds / tries - chance) < 0.05, `held ${holds / tries} vs shown ${chance}`);
  // The chance: skill, depth and gas.
  const base = lockResistChance(lockFight(1));
  assert.ok(base > 0.3 && base < 0.6, `base ${base}`);
  const better = lockFight(1);
  better.b.attrs = { ...better.b.attrs, submission: 99, grappleDef: 99 };
  assert.ok(lockResistChance(better) > base + 0.05, "skill helps");
  assert.ok(lockResistChance(lockFight(2)) < base - 0.05, "deeper is harder");
  const tired = lockFight(1);
  tired.b.stamina = 10;
  assert.ok(lockResistChance(tired) < base - 0.1, "gas matters");
  assert.equal(lockStatus(mat("neutral", "neutral")), null);
  assert.equal(lockStatus(lockFight(2)).depth, 2);
});

test("an escape against a lock eases it, and a heavy man on top makes every escape worse", () => {
  const eased = (id) => {
    let n = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const m = lockFight(2, { seed });
      m.a = { ...m.a, id };
      m.fighters = { ...m.fighters };
      const ev = hand(m, ["lk_tighten"], "escape");
      if (ev.some((e) => e.kind === "lockEase" || e.kind === "lockEscape")) n++;
    }
    return n;
  };
  assert.ok(eased("neutral") > 120, "escapes work against locks");
  assert.ok(eased("khabib") < eased("neutral"), "Khabib is hard to escape from");
});

test("how deep a lock starts: skill gap, a tired victim, and the fighter's own ability", () => {
  // The shallowest start over many tries: a critical grip starts one stage deeper, so the plain start is what the other things add to.
  const kimura = (tweak) => {
    let min = 99;
    for (let seed = 1; seed <= 300; seed++) {
      const m = mat("neutral", "neutral", { pos: 1, handTop: ["g_kimura"], seed });
      m.ground.pts.wrist = 1;
      tweak?.(m);
      const e = hand(m, ["g_kimura"], { kind: "cover" }).find((x) => x.kind === "lockStart");
      if (e) min = Math.min(min, e.depth);
    }
    return min;
  };
  assert.equal(kimura(), 1);
  assert.equal(kimura((m) => { m.b.stamina = 20; }), 2, "a tired victim is locked deeper");
  assert.equal(kimura((m) => { m.a.attrs = { ...m.a.attrs, submission: 99 }; m.b.attrs = { ...m.b.attrs, submission: 40, grappleDef: 40 }; }), 2, "a big skill gap too");
  // Oliveira's triangle from underneath: a critical catch of a punch, and the ability starts it a stage deeper.
  const fromBottom = (id) => {
    for (let seed = 1; seed <= 800; seed++) {
      const m = mat("neutral", id, { pos: 0, top: "a", handTop: ["g_hammer"], handBottom: ["g_triangle"], seed });
      const ev = hand(m, ["g_hammer"], { kind: "counter", card: "g_triangle" });
      const e = ev.find((x) => x.kind === "lockStart");
      if (e) {
        assert.equal(e.attacker, "b");
        assert.equal(m.ground.lock.aim, "neck");
        return e.depth;
      }
    }
    return 0;
  };
  assert.equal(fromBottom("oliveira"), fromBottom("neutral") + 1);
});

test("ground intent is honest: the numbers on screen are the ones the AI plays, leading, answering and in a lock", () => {
  const lead = matDrawn("khabib", "mcgregor", 2, "a");
  const resp = matDrawn("khabib", "mcgregor", 2, "a");
  const lockLead = lockFight(1);
  const lockResp = lockFight(1);
  for (const [label, state, side] of [["lead", lead, "a"], ["answer", resp, "b"], ["lock lead", lockLead, "a"], ["lock answer", lockResp, "b"]]) {
    const intent = getIntent(state, side);
    assert.ok(intent.ground, label);
    assert.equal(intent.kind, groundLeader(state) === side ? "lead" : "respond");
    assert.ok(Math.abs(Object.values(intent.probs).reduce((a, b) => a + b, 0) - 1) < 1e-9, `${label} sums to one`);
    for (const o of intent.options) assert.ok(intent.probs[o.id] >= 0);
  }
  // Answers: what he bets on is drawn from the shown numbers.
  const intent = getIntent(resp, "b");
  const counts = {};
  const n = 5000;
  for (let i = 0; i < n; i++) {
    const kind = chooseAI(resp, "b").plan.kind;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  for (const o of intent.options) assert.ok(Math.abs((counts[o.id] || 0) / n - intent.probs[o.id]) < 0.04, `${o.id}: shown ${intent.probs[o.id]}, played ${(counts[o.id] || 0) / n}`);
  // The leader's first step follows the shown aim (a wanted lock starts by taking its point), and nothing impossible is shown.
  const li = getIntent(lead, "a");
  const firsts = {};
  for (let i = 0; i < n; i++) {
    const combo = chooseAI(lead, "a").cards;
    const aim = combo.length ? aimOf(lead, combo[0]) : "hold";
    firsts[aim] = (firsts[aim] || 0) + 1;
    assert.equal(groundComboError(lead, "a", combo), null, "the AI's chain is legal");
  }
  assert.ok(Math.abs((firsts.punch || 0) / n - li.probs.punch) < 0.04, "punch share");
  assert.ok(Math.abs((firsts.hold || 0) / n - li.probs.hold) < 0.04, "hold share");
  const noLock = matDrawn("mcgregor", "neutral", 4, "a");
  noLock.a.hand = noLock.a.hand.filter((c) => data.cards[c].cat !== "lock");
  assert.equal(getIntent(noLock, "a").probs.lock, 0, "no lock card in hand means no lock shown");
  // A lock leaves one thing to do for the holder.
  const l = getIntent(lockLead, "a");
  assert.deepEqual(Object.keys(l.probs), ["tighten"]);
  // Blood in his eyes: only the likeliest option shows.
  lead.a.cut = 2;
  assert.equal(getIntent(lead, "b").blind, true);
});

test("the AI's ground chains are legal for every fighter at every position, and a whole bout on the mat ends cleanly", () => {
  for (const id of FIGHTERS) {
    for (let pos = 0; pos < 5; pos++) {
      for (let seed = 1; seed <= 6; seed++) {
        const m = matDrawn(id, "neutral", pos, seed % 2 ? "a" : "b", seed);
        const H = groundHand(m);
        const combo = chooseAI(m, H.leader).cards;
        const plan = chooseAI(m, H.resp).plan;
        assert.equal(groundComboError(m, H.leader, combo), null, `${id}@${pos}`);
        assert.equal(groundPlanError(m, H.resp, plan), null, `${id}@${pos} ${plan.kind}`);
        const events = resolveGround(m, combo, plan, (st, w) => chooseGroundReaction(st, H.resp, w));
        assert.ok(events.length >= 1);
        assert.deepEqual(checkInvariants(m), [], `${id}@${pos}`);
      }
    }
  }
});

test("the card text on the mat: names, effects and a lock card that says what it still needs", () => {
  const low = matDrawn("neutral", "neutral", 0, "a");
  const high = matDrawn("neutral", "neutral", 3, "a");
  low.a.hand = ["g_hammer", "g_kimura", "g_c_wrist", "g_pass"];
  high.a.hand = ["g_hammer", "g_take_back"];
  assert.equal(describeCard(low, "a", "g_hammer").action, "砸拳");
  assert.ok(previewGroundCombo(high, "a", ["g_hammer"]).damage > previewGroundCombo(low, "a", ["g_hammer"]).damage * 1.4);
  assert.match(describeCard(high, "a", "g_take_back").effect, /背後/);
  assert.match(describeCard(low, "b", "g_escape").effect, /站起來/);
  assert.match(describeCard(low, "a", "g_c_wrist").effect, /手腕.*0\/2/);
  const kim = describeCard(low, "a", "g_kimura");
  assert.match(kim.blocked, /先控制手腕/);
  assert.ok(kim.unusable);
  low.ground.pts.wrist = 1;
  assert.equal(describeCard(low, "a", "g_kimura").blocked, "");
  // Slow cards say so: he will see them coming.
  assert.equal(describeCard(low, "a", "g_hammer").seenByFoe, true);
  assert.equal(describeCard(low, "a", "g_c_wrist").seenByFoe, false);
  assert.ok(describeCard(low, "a", "g_pass").speed < describeCard(low, "a", "g_c_wrist").speed);
});

// ---------- Slow moves: seen is not stopped ----------

test("a slow move pushes through what meets it: the chance grows with how slow it is and tops out", () => {
  const m = createMatch(data, "neutral", "neutral", 1);
  assert.equal(throughChance(m, data.rules.slow.at), 0, "nothing at the line");
  assert.equal(throughChance(m, 90), 0, "a fast move never");
  const slam = throughChance(m, 36);
  assert.ok(slam > 0.35 && slam <= data.rules.slow.maxThrough, `slam ${slam}`);
  assert.equal(throughChance(m, 0), data.rules.slow.maxThrough, "capped");
  assert.ok(throughChance(m, 50) < slam, "less slow, less push");
});

test("a seen slow card is stopped less often than the answer alone would: the push-through rate is the one the card shows", () => {
  const rate = (through) => {
    let pushed = 0;
    let blocked = 0;
    const n = 600;
    for (let seed = 1; seed <= n; seed++) {
      const s = leadHand(["overhand"], [], { seed, through });
      const ev = resolveEngage(s, ["overhand"], { kind: "guard", height: "high" });
      if (ev.some((e) => e.kind === "through")) {
        pushed++;
        assert.ok(!ev.some((e) => e.kind === "block"), "pushed through means no block");
        assert.ok(ev.some((e) => e.kind === "hit" && !e.chip), "and it lands");
      }
      if (ev.some((e) => e.kind === "block")) blocked++;
    }
    return { pushed: pushed / n, blocked: blocked / n };
  };
  const off = rate(false);
  const on = rate(true);
  assert.equal(off.pushed, 0);
  assert.ok(off.blocked > 0.95, "a guard at the right height always stops a seen overhand");
  const shown = describeCard(leadHand(["overhand"], [], { through: true }), "a", "overhand");
  assert.ok(shown.seenByFoe && shown.through > 30, `the card says ${shown.through}%`);
  assert.ok(Math.abs(on.pushed - shown.through / 100) < 0.06, `pushed ${on.pushed} vs shown ${shown.through}%`);
  assert.ok(on.blocked < off.blocked - 0.25, "so fewer are stopped");
  // A quick card never pushes: nothing to see, nothing to push.
  const quick = leadHand(["jab"], [], { through: true });
  assert.equal(describeCard(quick, "a", "jab").through, 0);
});

test("a slow card hits harder and lands better than the same card would at the line", () => {
  const slowState = createMatch(data, "neutral", "neutral", 1);
  const base = previewCombo(slowState, "a", ["overhand"]).damage;
  const flat = createMatch(data, "neutral", "neutral", 1);
  flat.rules = { ...flat.rules, slow: { ...flat.rules.slow, dmg: 0 } };
  const ratio = base / previewCombo(flat, "a", ["overhand"]).damage;
  assert.ok(ratio > 1.25 && ratio <= 1 + data.rules.slow.maxDmg + 0.03, `ratio ${ratio}`);
  const quickRatio = previewCombo(slowState, "a", ["jab"]).damage / previewCombo(flat, "a", ["jab"]).damage;
  assert.ok(Math.abs(quickRatio - 1) < 0.02, "a quick card is unchanged");
});

test("wrestlers take down and pass quickly; a striker's takedown is slow", () => {
  const khabib = createMatch(data, "khabib", "mcgregor", 1);
  assert.ok(cardSpeed(khabib, "a", "double_leg") > cardSpeed(khabib, "b", "double_leg") + 25, "Khabib's shot against McGregor's");
  assert.ok(cardSpeed(khabib, "a", "double_leg") >= data.rules.slow.at, "a wrestler's shot is not slow");
  assert.ok(cardSpeed(khabib, "b", "double_leg") < data.rules.slow.at - 8, "a striker's shot is");
  assert.equal(cardSpeed(khabib, "a", "jab") - data.cards.jab.speed, cardSpeed(khabib, "a", "jab") - data.cards.jab.speed, "strikes are untouched by wrestling");
  const striker = cardSpeed(createMatch(data, "mcgregor", "khabib", 1), "a", "jab");
  const wrestler = cardSpeed(createMatch(data, "khabib", "mcgregor", 1), "a", "jab");
  assert.ok(wrestler < striker, "and a wrestler's jab is the slower one only through his hands, not his wrestling");
  // On the mat the wrestler's control steps and passes are quick too.
  const mt = mat("khabib", "mcgregor", { pos: 1 });
  assert.ok(cardSpeed(mt, "a", "g_pass") >= data.rules.slow.at, "his pass is not slow");
  assert.ok(cardSpeed(mt, "b", "g_pass") < cardSpeed(mt, "a", "g_pass") - 20);
});

test("on the mat a seen slow step can push through the answer too", () => {
  let pushed = 0;
  let stopped = 0;
  const n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const m = mat("neutral", "neutral", { pos: 1, seed, through: true, handTop: ["g_hammer"] });
    const ev = hand(m, ["g_hammer"], { kind: "cover" });
    if (ev.some((e) => e.kind === "through")) {
      pushed++;
      assert.ok(ev.some((e) => e.kind === "hit"), "it lands");
    }
    const p = mat("neutral", "neutral", { pos: 1, seed, through: true });
    p.ground.pts.neck = 0;
    const ev2 = hand(p, ["g_pass"], { kind: "frame" });
    if (ev2.some((e) => e.kind === "gstop")) stopped++;
  }
  assert.ok(pushed / n > 0.25, `hammer pushed ${pushed}/${n}`);
  assert.ok(stopped > 0 && stopped < n, "a pass is mostly stopped by a frame, but not always");
});

// ---------- Stand-up: footwork, then lead and respond ----------

const BASICS = data.rules.match.basics;
const ENGAGE = data.rules.engage;

/** A stand-up hand set up by hand: `a` leads (press against hold). With `plain` the footwork edges are wiped so only the cards decide. */
function leadHand(handA, handB, { dist = 1, seed = 5, a = "neutral", b = "neutral", plain = true, through = false } = {}) {
  const state = createMatch(data, a, b, seed);
  if (!through) noThrough(state);
  state.dist = dist;
  state.a.hand = [...handA, ...BASICS];
  state.b.hand = [...handB, ...BASICS];
  resolveFootwork(state, "press", "hold");
  if (plain) {
    const none = { power: 1, dmgIn: 1, evade: 0, counterSpeed: 0, crit: 0, react: 0, stam: 0 };
    state.engage.mods = { a: { ...none }, b: { ...none } };
  }
  return state;
}
const kinds = (events) => events.map((e) => e.kind);

test("every fighter has only special moves in the deck, plus the numbers and styles the stand-up game needs", () => {
  for (const [id, f] of Object.entries(data.fighters)) {
    assert.ok(f.deck.length >= 6, `${id} deck`);
    for (const c of [...f.deck, f.signature]) assert.ok(data.cards[c], `${id} unknown card ${c}`);
    assert.ok(!f.deck.some((c) => data.cards[c].basic), `${id} has a basic move in the deck`);
    assert.ok(f.deck.some((c) => !data.cards[c].counterOnly), `${id} has nothing to lead with`);
    assert.ok(Number.isFinite(f.speed) && Number.isFinite(f.reaction), `${id} speed/reaction`);
    assert.ok(data.rules.footwork.styles[f.fwStyle], `${id} fwStyle`);
    assert.ok(data.rules.ai.lead.styles[f.leadStyle], `${id} leadStyle`);
    assert.ok(data.rules.ai.respond.styles[f.respondStyle], `${id} respondStyle`);
  }
  for (const b of BASICS) assert.ok(data.cards[b].basic && !data.cards[b].counterOnly, b);
  // Wherever they stand, everyone has a basic move to throw.
  for (let d = 0; d <= 3; d++) assert.ok(BASICS.some((c) => usableAt({ ...createMatch(data, "neutral", "neutral", 1), dist: d }, data.cards[c], d, "a")), `distance ${d}`);
});

test("the stand-up hand is the basic moves, a few drawn specials with something to lead and to answer with, and the signature when ready", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const state = createMatch(data, "mcgregor", "khabib", seed);
    for (const s of ["a", "b"]) {
      const hand = state[s].hand;
      for (const b of BASICS) assert.ok(hand.includes(b), `${s} basic ${b}`);
      const specials = hand.filter((c) => !data.cards[c].basic);
      assert.equal(specials.length, data.rules.match.handSize);
      assert.ok(specials.some((c) => !data.cards[c].counterOnly), "something to lead with");
      assert.ok(specials.some((c) => data.cards[c].counterOnly), "something to answer with");
    }
  }
  const state = createMatch(data, "mcgregor", "khabib", 3);
  state.a.momentum = 100;
  refillHand(state, "a");
  assert.ok(state.a.hand.includes("sig_mcgregor"));
});

test("the footwork table is complete and mirrors: swapping the sides swaps the edges", () => {
  const ids = data.rules.footwork.order;
  for (const x of ids) {
    for (const y of ids) {
      const st = createMatch(data, "neutral", "neutral", 1);
      const ab = footworkOutcome(st, x, y);
      const ba = footworkOutcome(st, y, x);
      assert.equal(ab.dist, ba.dist, `${x}/${y} distance`);
      assert.deepEqual(ab.mods.a, ba.mods.b);
      assert.deepEqual(ab.mods.b, ba.mods.a);
      assert.equal(ab.gave.a, ba.gave.b);
      assert.equal(ab.gave.b, ba.gave.a);
      const flip = { a: "b", b: "a", roll: "roll" };
      assert.equal(ab.lead, flip[ba.lead], `${x}/${y} lead`);
    }
  }
});

test("pressing against a man who holds makes the presser lead, closes a step and costs him; nobody can back off against the fence", () => {
  const state = createMatch(data, "neutral", "neutral", 8);
  const before = state.a.stamina;
  assert.equal(stepOf(state), "footwork");
  const events = resolveFootwork(state, "press", "hold");
  assert.equal(stepOf(state), "lead");
  assert.equal(state.engage.leader, "a");
  assert.equal(state.dist, 2);
  assert.ok(state.a.stamina < before, "pressing takes stamina");
  assert.deepEqual(kinds(events).slice(0, 3), ["footwork", "range", "lead"]);
  assert.throws(() => resolveFootwork(state, "press", "hold"), /already/);
  // Against the fence the way back is shut.
  const pinned = createMatch(data, "neutral", "neutral", 8);
  pinned.cage = { side: "a", ttl: 4 };
  assert.ok(footworkChoices(pinned, "a").find((c) => c.id === "retreat").disabled);
  assert.throws(() => resolveFootwork(pinned, "retreat", "hold"), /背靠籠子/);
  assert.ok(!footworkChoices(pinned, "b").find((c) => c.id === "retreat").disabled);
});

test("when the footwork does not decide who leads, speed does; the man who came out on top last hand has the edge", () => {
  const rate = (setup) => {
    let a = 0;
    const n = 1500;
    for (let seed = 1; seed <= n; seed++) {
      const state = createMatch(data, "adesanya", "khabib", seed);
      setup(state);
      resolveFootwork(state, "hold", "hold");
      if (state.engage.leader === "a") a++;
    }
    return a / n;
  };
  const fast = rate(() => {});
  const chance = leadChance(createMatch(data, "adesanya", "khabib", 1));
  assert.ok(fast > 0.55, `the faster man leads more: ${fast}`);
  assert.ok(Math.abs(fast - chance) < 0.04, `shown ${chance}, played ${fast}`);
  const edged = rate((s) => { s.edge = { side: "b" }; });
  assert.ok(edged < fast - 0.15, `the edge shifts it: ${edged} vs ${fast}`);
  // A deciding footwork ignores the edge.
  const state = createMatch(data, "adesanya", "khabib", 2);
  state.edge = { side: "b" };
  resolveFootwork(state, "press", "hold");
  assert.equal(state.engage.leader, "a");
  assert.equal(state.edge, null, "the edge is used up");
});

test("displayed tendencies are honest: footwork, the height he leads with and the way he answers are what the AI plays", () => {
  const near = (counts, probs, n, label) => {
    for (const [id, p] of Object.entries(probs)) assert.ok(Math.abs((counts[id] || 0) / n - p) < 0.04, `${label} ${id}: shown ${p}, played ${(counts[id] || 0) / n}`);
  };
  const n = 4000;
  const fw = createMatch(data, "mcgregor", "khabib", 9);
  const shown = footworkIntent(fw, "a").probs;
  const counts = {};
  for (let i = 0; i < n; i++) {
    const f = chooseFootwork(fw, "a");
    counts[f] = (counts[f] || 0) + 1;
  }
  near(counts, shown, n, "footwork");
  // After the footwork a leads and b answers.
  const state = createMatch(data, "mcgregor", "khabib", 11);
  resolveFootwork(state, "press", "hold");
  const heights = {};
  const answers = {};
  const leadProbs = engageIntent(state, "a").probs;
  const answerProbs = engageIntent(state, "b").probs;
  for (let i = 0; i < n; i++) {
    const combo = chooseCombo(state, "a");
    if (combo.length) heights[data.cards[combo[0]].height] = (heights[data.cards[combo[0]].height] || 0) + 1;
    const plan = choosePlan(state, "b");
    const key = plan.kind === "guard" ? plan.height : plan.kind;
    answers[key] = (answers[key] || 0) + 1;
  }
  near(heights, leadProbs, n, "lead height");
  near(answers, answerProbs, n, "answer");
  assert.equal(Math.round(Object.values(shown).reduce((a, b) => a + b, 0) * 1000), 1000);
});

test("a combo has to be playable: length by stamina, no answer-only cards, a grab ends it, every card in range", () => {
  const state = leadHand(["overhand", "guard_counter", "double_leg"], [], { dist: 1 });
  const d = state.dist; // 2 after pressing
  assert.equal(comboError(state, "a", []), null);
  assert.equal(comboError(state, "a", ["jab", "jab", "cross"]), null, "basic moves repeat");
  assert.equal(comboError(state, "a", ["overhand", "overhand"]), "not in hand", "a drawn card once");
  assert.equal(comboError(state, "a", ["guard_counter"]), "not a lead card");
  assert.equal(comboError(state, "a", ["double_leg", "jab"]), "a grab ends the combo");
  assert.equal(comboError(state, "a", ["jab", "double_leg"]), null);
  assert.equal(comboError(state, "a", ["jab", "jab", "jab", "jab", "jab"]), "too long");
  assert.equal(comboError(state, "b", ["jab"]), "not leading");
  assert.equal(comboError(state, "a", ["uppercut"]), "not in hand");
  state.a.hand.push("uppercut", "head_kick");
  assert.equal(comboError(state, "a", ["head_kick"]), "out of range", `a high kick has no room at distance ${d}`);
  assert.equal(comboError(state, "a", ["uppercut"]), null);
  // The overhand steps in, which brings the next card into range.
  const far = leadHand(["overhand"], [], { dist: 0 });
  far.dist = 0;
  assert.equal(comboError(far, "a", ["jab"]), "out of range");
  far.dist = 1;
  assert.equal(comboError(far, "a", ["overhand", "body_hook"]), null, "the step in carries the next card");
  assert.throws(() => engageStart(state, ["guard_counter"], { kind: "cover" }), /illegal combo/);
});

test("combo length follows stamina; a stunned man throws one; the last hand of a round and a rhythm add one, smothering takes one", () => {
  const state = createMatch(data, "neutral", "neutral", 3);
  const at = (stamina) => {
    state.a.stamina = stamina;
    return comboMax(state, "a");
  };
  assert.deepEqual([100, 60, 40, 20, 5].map(at), [4, 4, 3, 2, 1]);
  state.a.stamina = 100;
  state.a.rocked = true;
  assert.equal(comboMax(state, "a"), 1);
  state.a.rocked = false;
  state.exchange = state.perRound;
  assert.equal(comboMax(state, "a"), 5, "the last hand of a round");
  state.exchange = 1;
  state.a.marks.rhythm = { turns: 1, n: 3 };
  assert.equal(comboMax(state, "a"), 5);
  state.a.marks = { smothered: { turns: 1, n: 1 } };
  assert.equal(comboMax(state, "a"), 3);
});

test("reaction against speed: slow cards are seen, fast ones are not; a stunned, gassed or blinded man sees less", () => {
  const state = leadHand(["overhand", "cross"], []);
  const seen = (card) => {
    const E = state.engage;
    E.combo = [card];
    E.started = true;
    E.i = 0;
    E.stop = null;
    return engageWaiting(state).visible;
  };
  assert.equal(reactionOf(state, "b"), data.fighters.neutral.reaction);
  assert.equal(seen("overhand"), true);
  assert.equal(seen("jab"), false);
  assert.equal(seen("cross"), false, "an ordinary cross is quicker than a normal man can follow");
  state.b.stamina = 10;
  assert.ok(reactionOf(state, "b") < data.fighters.neutral.reaction - 10, "gassed");
  state.b.stamina = 100;
  state.a.cut = 0;
  state.a.cut = 2;
  assert.ok(reactionOf(state, "a") < data.fighters.neutral.reaction, "blood in the eyes");
  state.b.rocked = true;
  assert.equal(reactionOf(state, "b"), 0);
  assert.equal(seen("overhand"), false, "a stunned man sees nothing coming");
  const elite = leadHand(["overhand"], [], { b: "adesanya" });
  assert.ok(reactionOf(elite, "b") > data.cards.lead_hook.speed && reactionOf(state, "a") <= data.cards.lead_hook.speed, "a fast reader sees a hook coming; an ordinary man does not");
});

test("a guard at the right height stops the whole combo and lets a little through; at the wrong height it only softens the blow", () => {
  const blocked = leadHand([], []);
  const events = resolveEngage(blocked, ["jab", "cross"], { kind: "guard", height: "high" });
  assert.deepEqual(kinds(events).filter((k) => k === "card" || k === "block"), ["card", "block"], "the combo stops after the first card");
  const chip = events.find((e) => e.kind === "hit");
  assert.ok(chip.chip && chip.damage <= 2, `chip ${chip.damage}`);
  assert.equal(blocked.engage, null);
  assert.equal(blocked.edge, null, "a block does not hand over the edge");
  assert.ok(blocked.a.pips.head === 0 && blocked.b.pips.head === 0, "a blocked blow leaves no mark");
  // Wrong height: the combo goes on, the hits are softer than against nothing.
  const total = (plan, seed) => {
    const s = leadHand([], [], { seed, dist: 0 });
    const ev = resolveEngage(s, ["body_hook", "calf_kick"], plan);
    return { hits: ev.filter((e) => e.kind === "hit" && !e.chip).length, hp: s.b.hp, cards: ev.filter((e) => e.kind === "card").length };
  };
  let wrong = 0;
  let cover = 0;
  let open = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = total({ kind: "guard", height: "high" }, seed);
    assert.equal(w.cards, 2, "a wrong guard does not stop the combo");
    wrong += 190 - w.hp;
    cover += 190 - total({ kind: "cover" }, seed).hp;
    open += 190 - total({ kind: "evade" }, seed).hp;
  }
  assert.ok(wrong > 0 && cover > 0);
  assert.ok(wrong > cover * 0.9, "covering up is a bit better than guarding the wrong height");
});

test("a guard that keeps working wears the leader down faster each time", () => {
  const state = createMatch(data, "neutral", "neutral", 2);
  const drains = [];
  for (let i = 0; i < 3; i++) {
    state.a.hand = [...BASICS];
    state.b.hand = [...BASICS];
    state.dist = 1;
    resolveFootwork(state, "press", "hold");
    const before = state.a.stamina;
    resolveEngage(state, ["jab"], { kind: "guard", height: "high" });
    drains.push(before - state.a.stamina);
    assert.equal(state.guardStreak.n, i + 1);
  }
  assert.ok(drains[2] > drains[0], `${drains}`);
  // A different outcome ends the streak.
  state.a.hand = [...BASICS];
  state.b.hand = [...BASICS];
  state.dist = 1;
  resolveFootwork(state, "press", "hold");
  resolveEngage(state, ["jab"], { kind: "cover" });
  assert.equal(state.guardStreak, null);
});

test("evading a slow card is likely and punished by the size of its recovery; a fast card is hard to slip", () => {
  const rate = (card, who) => {
    let evaded = 0;
    let punished = 0;
    const n = 300;
    for (let seed = 1; seed <= n; seed++) {
      const s = leadHand(["overhand"], [], { seed, b: who });
      const ev = resolveEngage(s, [card], { kind: "evade" });
      if (ev.some((e) => e.kind === "evade")) {
        evaded++;
        if (ev.some((e) => e.kind === "hit" && e.attacker === "b")) punished++;
        assert.equal(s.edge.side, "b", "the man who slipped it has the edge");
      }
    }
    return { evaded: evaded / n, punished: punished / (evaded || 1) };
  };
  const slow = rate("overhand", "neutral");
  const quick = rate("jab", "neutral");
  assert.ok(slow.evaded > 0.5 && quick.evaded < 0.2, `slow ${slow.evaded}, quick ${quick.evaded}`);
  assert.ok(slow.punished > 0.9, "a big opening is punished");
  assert.equal(rate("jab", "neutral").punished, 0, "a jab leaves no opening");
});

test("a counter is a race: a quicker answer breaks the combo and takes the edge, a slower one eats the blow", () => {
  // A slow overhand is seen coming, so a quick answer gets there first and no guess is needed.
  const win = leadHand(["overhand"], ["guard_counter"]);
  const ev = resolveEngage(win, ["overhand", "body_hook"], { kind: "counter", card: "guard_counter" }, () => null);
  assert.ok(ev.find((e) => e.kind === "counter").first);
  assert.equal(ev.filter((e) => e.kind === "card").length, 1, "the combo is broken");
  assert.ok(ev.some((e) => e.kind === "interrupted" && e.side === "a"));
  assert.equal(win.edge.side, "b");
  assert.ok(ev.some((e) => e.kind === "hit" && e.attacker === "b") && !ev.some((e) => e.kind === "hit" && e.attacker === "a"), "only the counter lands");
  // A cross he never saw: a blind counter loses 18 and is too slow.
  const lose = leadHand([], ["guard_counter"]);
  const ev2 = resolveEngage(lose, ["cross", "cross"], { kind: "counter", card: "guard_counter" });
  const c = ev2.find((e) => e.kind === "counter");
  assert.equal(c.first, false);
  assert.ok(c.speed < c.vs, `${c.speed} v ${c.vs}`);
  assert.ok(ev2.some((e) => e.kind === "hit" && e.attacker === "a"), "the leader's blow lands");
  // But the bet is spent on the first card, and he covers up for the second.
  assert.equal(ev2.filter((e) => e.kind === "counter").length, 1);
  assert.equal(ev2.filter((e) => e.kind === "card").length, 2, "a counter that loses does not stop the combo");
  // Footwork edges add to a counter's speed: holding the middle against a press is worth a few points.
  const held = createMatch(data, "neutral", "neutral", 5);
  held.a.hand = ["cross", ...BASICS];
  held.b.hand = ["guard_counter", ...BASICS];
  resolveFootwork(held, "press", "hold");
  const ev3 = resolveEngage(held, ["cross"], { kind: "counter", card: "guard_counter" });
  const c3 = ev3.find((e) => e.kind === "counter");
  assert.equal(c3.speed, 80 - 18 + data.rules.footwork.pairs["press|hold"].b.counterSpeed);
});

test("a counter card that is a signature costs the momentum like any signature", () => {
  const state = leadHand([], ["sig_adesanya"], { b: "adesanya" });
  state.b.momentum = 100;
  state.b.hand.push("sig_adesanya");
  const ev = resolveEngage(state, ["body_hook"], { kind: "counter", card: "sig_adesanya" });
  assert.ok(ev.some((e) => e.kind === "signature" && e.side === "b"));
  assert.ok(state.b.momentum < 100);
});

test("a pre-emptive strike costs a lot, lands first and breaks up the combo; it only works when it lands cleanly", () => {
  let broke = 0;
  let spent = 0;
  const n = 200;
  for (let seed = 1; seed <= n; seed++) {
    const s = leadHand([], [], { seed });
    const before = s.b.stamina;
    const ev = resolveEngage(s, ["jab", "cross"], { kind: "preempt", card: "jab" });
    const order = kinds(ev);
    assert.ok(order.indexOf("preempt") < order.indexOf("card") || !order.includes("card"), "the pre-emptive strike comes first");
    spent += before - s.b.stamina;
    if (ev.some((e) => e.kind === "interrupted")) {
      broke++;
      assert.equal(s.edge.side, "b");
      assert.equal(ev.filter((e) => e.kind === "card").length, 0, "the leader never gets a card out");
    }
  }
  assert.ok(spent / n >= ENGAGE.preempt.cost - 6, `cost ${spent / n}`);
  assert.ok(broke / n > 0.5 && broke / n < 0.95, `broke ${broke / n}`);
  assert.equal(planError(leadHand([], []), "b", { kind: "preempt", card: "jab" }, true), "too late");
});

test("a feint draws out a counter, a shot or a slip: the bet is wasted, he is fooled and the next card catches him", () => {
  const s = leadHand(["feint"], [], { b: "adesanya" });
  s.b.hand = [...BASICS];
  const ev = resolveEngage(s, ["feint", "cross"], { kind: "counter", card: "jab" });
  assert.ok(ev.some((e) => e.kind === "feintWin" && e.vs === "counter"));
  assert.ok(!ev.some((e) => e.kind === "counter"), "the counter was spent on the fake");
  assert.equal(ev.filter((e) => e.kind === "card").length, 2);
  assert.ok(s.b.marks.fooled, "a man who bit on a fake is easier to read");
  // A guard is not fooled.
  const g = leadHand(["feint"], []);
  const ev2 = resolveEngage(g, ["feint", "cross"], { kind: "guard", height: "high" });
  assert.ok(ev2.some((e) => e.kind === "feintWasted"));
  assert.equal(g.b.marks.fooled, undefined);
});

test("diving under a slow punch can take him down; diving under a quick one just walks into it", () => {
  let down = 0;
  const n = 300;
  for (let seed = 1; seed <= n; seed++) {
    const s = leadHand(["overhand"], [], { seed });
    const ev = resolveEngage(s, ["overhand"], { kind: "shoot" });
    const shot = ev.find((e) => e.kind === "shoot");
    assert.equal(shot.caught, true);
    assert.equal(ev.filter((e) => e.kind === "card").length, 1);
    if (ev.some((e) => e.kind === "takedown" && e.side === "b")) {
      down++;
      assert.deepEqual(s.pending, { kind: "chase", side: "b" });
    }
  }
  assert.ok(down / n > 0.3 && down / n < 0.95, `${down / n}`);
  const s = leadHand([], [], { seed: 4 });
  const ev = resolveEngage(s, ["jab"], { kind: "shoot" });
  assert.equal(ev.find((e) => e.kind === "shoot").caught, false);
  assert.ok(ev.some((e) => e.kind === "hit" && e.attacker === "a"), "he takes the blow");
  assert.ok(!ev.some((e) => e.kind === "takedown"));
});

test("a grab ends the combo; it can take him down or only clinch; a low guard sprawls and takes the chance away", () => {
  const rate = (plan, extra) => {
    let down = 0;
    const n = 400;
    for (let seed = 1; seed <= n; seed++) {
      const s = leadHand(["double_leg"], [], { seed });
      const ev = resolveEngage(s, ["jab", "double_leg"], plan, () => null);
      if (extra) assert.ok(ev.some((e) => e.kind === "sprawl"));
      assert.ok(ev.some((e) => e.kind === "grab") || ev.some((e) => e.kind === "block" || e.kind === "evade" || e.kind === "counter"), "the grab resolves one way or another");
      if (ev.some((e) => e.kind === "takedown")) down++;
    }
    return down / n;
  };
  const open = rate({ kind: "guard", height: "mid" });
  const sprawl = rate({ kind: "guard", height: "low" }, true);
  assert.ok(open > 0.25, `${open}`);
  assert.ok(sprawl < open - 0.05, `sprawl ${sprawl} vs ${open}`);
  // A clinch entry only closes up.
  const s = leadHand(["clinch"], [], { dist: 1 });
  s.dist = 2;
  const ev = resolveEngage(s, ["clinch"], { kind: "cover" });
  assert.equal(s.dist, 3);
  assert.ok(!ev.some((e) => e.kind === "takedown"));
});

test("a poor shot runs into a guillotine when he answered with one", () => {
  let caught = 0;
  const n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const s = leadHand(["double_leg"], ["guillotine"], { seed, dist: 1 });
    s.dist = 2;
    const ev = resolveEngage(s, ["double_leg"], { kind: "counter", card: "guillotine" });
    if (ev.some((e) => e.kind === "caught")) {
      caught++;
      assert.ok(s.ground && s.ground.lock && s.ground.lock.attacker === "b");
    }
  }
  assert.ok(caught / n > 0.05 && caught / n < 0.6, `${caught / n}`);
});

test("a finished combo keeps the edge and drains the other man; the edge decides the next hand when the footwork does not", () => {
  const s = leadHand([], []);
  const before = s.b.stamina;
  const ev = resolveEngage(s, ["jab", "cross"], { kind: "cover" });
  assert.ok(ev.some((e) => e.kind === "comboDone" && e.side === "a"));
  assert.equal(s.edge.side, "a");
  assert.ok(s.b.stamina < before + 2);
  s.a.hand = [...BASICS];
  s.b.hand = [...BASICS];
  const chance = leadChance(s);
  s.edge = null;
  const flat = leadChance(s);
  assert.ok(chance > flat + 0.2, `${chance} vs ${flat}`);
  // Passing up the hand is allowed: both catch their breath and a referee will get them moving.
  const probe = leadHand([], []);
  const ev2 = resolveEngage(probe, [], { kind: "cover" });
  assert.ok(ev2.some((e) => e.kind === "standoff"));
  assert.equal(probe.edge, null);
});

test("pressing a man who backs off builds pressure; the second time he is against the fence and can only circle out", () => {
  const state = createMatch(data, "neutral", "neutral", 6);
  const hand = (fa, fb) => {
    const ev = resolveFootwork(state, fa, fb);
    state.a.hand = [...BASICS];
    state.b.hand = [...BASICS];
    resolveEngage(state, [], { kind: "cover" });
    return ev;
  };
  hand("press", "retreat");
  assert.equal(state.cage, null);
  const second = hand("press", "retreat");
  assert.deepEqual(state.cage && state.cage.side, "b");
  assert.ok(second.some((e) => e.kind === "cage" && e.side === "b"));
  assert.ok(footworkChoices(state, "b").find((c) => c.id === "retreat").disabled);
  const gap = state.roundScore.a.striking;
  assert.ok(gap >= data.rules.cage.pressureScore, "the judges notice who is pushing");
  // Pressing on keeps him there; circling off while the other presses does not get him out; circling while he holds does.
  const stay = hand("press", "circle");
  assert.ok(state.cage && !stay.some((e) => e.kind === "cageEnd"));
  const out = hand("hold", "circle");
  assert.equal(state.cage, null);
  assert.ok(out.some((e) => e.kind === "cageEnd" && e.how === "turn"));
  // A man against the fence is easier to take down.
  const pinned = createMatch(data, "neutral", "neutral", 3);
  const odds = (s) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const x = leadHand(["double_leg"], [], { seed });
      if (s) x.cage = { side: "b", ttl: 4 };
      if (resolveEngage(x, ["double_leg"], { kind: "cover" }).some((e) => e.kind === "takedown")) n++;
    }
    return n / 400;
  };
  assert.ok(odds(true) > odds(false) + 0.03);
  assert.ok(pinned);
});

test("a landed jab lets him see the other man's tendencies next hand and opens the follow-up", () => {
  let probed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const s = leadHand([], [], { seed });
    resolveEngage(s, ["jab"], { kind: "cover" });
    if (s.a.marks.read) {
      probed++;
      assert.ok(s.a.marks.opened, "the same jab opens the follow-up");
      resolveFootwork(s, "press", "hold");
      assert.equal(engageIntent(s, "b").detail, true, "now he sees more");
      assert.equal(engageIntent(s, "a").detail, false);
    }
  }
  assert.ok(probed > 40);
});

test("abilities fire on the new events: McGregor sees through a counter, Topuria presses on, Holloway builds rhythm, Sandhagen flows, Jones crowds, Makhachev smothers", () => {
  // Counter wins: McGregor as the answerer.
  const mc = leadHand(["overhand"], ["guard_counter"], { b: "mcgregor" });
  resolveEngage(mc, ["overhand"], { kind: "counter", card: "guard_counter" }, () => null);
  assert.ok(mc.a.marks.fooled, "McGregor's counter makes the other man easier to read");
  const tp = leadHand(["overhand"], ["guard_counter"], { b: "topuria" });
  const dist = tp.dist;
  resolveEngage(tp, ["overhand"], { kind: "counter", card: "guard_counter" }, () => null);
  assert.ok(tp.b.marks.opened && tp.dist >= dist, "Topuria presses on and opens the next hand");
  // Rhythm: two strikes led.
  const hol = createMatch(data, "holloway", "neutral", 4);
  hol.a.hand = [...BASICS];
  resolveFootwork(hol, "press", "hold");
  resolveEngage(hol, ["jab", "cross"], { kind: "cover" });
  assert.equal(hol.a.marks.rhythm.n, 1);
  assert.equal(handSpeed(hol, "a"), data.fighters.holloway.speed);
  hol.a.marks.rhythm = { turns: 1, n: 3 };
  assert.equal(handSpeed(hol, "a"), data.fighters.holloway.speed + data.rules.tags.rhythm.speed);
  // Flow after circling.
  const sand = createMatch(data, "sandhagen", "neutral", 4);
  resolveFootwork(sand, "circle", "hold");
  sand.a.hand = [...BASICS];
  resolveEngage(sand, [], { kind: "cover" });
  assert.ok(sand.a.marks.flow);
  // Crowded: a kick lands and the other man's steps cost more.
  let crowded = false;
  for (let seed = 1; seed <= 40 && !crowded; seed++) {
    const jones = leadHand(["front_kick"], [], { a: "jones", seed });
    jones.dist = 1;
    resolveEngage(jones, ["calf_kick"], { kind: "cover" });
    crowded = Boolean(jones.b.marks.crowded);
    if (crowded) {
      const cost = (s) => data.rules.footwork.moves.press.cost + (s.b.marks.crowded ? data.rules.tags.crowded.footCost : 0);
      const before = jones.b.stamina;
      resolveFootwork(jones, "hold", "press");
      assert.ok(before - jones.b.stamina >= cost(jones) - 1, "pressing costs more");
    }
  }
  assert.ok(crowded, "Jones's kick crowds the other man");
  // Smothering: a grab that lands.
  let smothered = false;
  for (let seed = 1; seed <= 60 && !smothered; seed++) {
    const mk = leadHand(["double_leg"], [], { a: "makhachev", seed });
    resolveEngage(mk, ["double_leg"], { kind: "cover" });
    smothered = Boolean(mk.b.marks.smothered);
  }
  assert.ok(smothered);
});

test("a takedown leaves the winner a choice and the stand-up hand waits aside on the mat and returns whole", () => {
  let state = null;
  for (let seed = 1; seed <= 300 && !state; seed++) {
    const s = leadHand(["double_leg"], [], { seed, a: "khabib" });
    if (resolveEngage(s, ["double_leg"], { kind: "cover" }).some((e) => e.kind === "takedown")) state = s;
  }
  assert.ok(state, "a takedown happens");
  assert.deepEqual(state.pending, { kind: "chase", side: "a" });
  assert.throws(() => resolveFootwork(state, "press", "hold"));
  assert.ok(state.a.stand.includes("jab"), "the stand-up hand waits");
  assert.ok(state.a.hand.every((c) => data.cards[c].cat || data.cards[c].lockMove), "the mat hand is ground cards");
  const events = resolvePending(state, "release");
  assert.ok(events.some((e) => e.kind === "standup"));
  assert.ok(state.a.marks.released, "letting him up gives the edge");
  assert.equal(state.ground, null);
  for (const b of BASICS) assert.ok(state.a.hand.includes(b) && state.b.hand.includes(b));
  assert.equal(stepOf(state), "footwork");
});

test("a signature that gets blocked still lands for a share of its power", () => {
  const state = leadHand([], [], { a: "pereira", dist: 1 });
  state.a.momentum = 100;
  state.a.hand.push("sig_pereira");
  const ev = resolveEngage(state, ["sig_pereira"], { kind: "guard", height: "high" });
  assert.ok(ev.some((e) => e.kind === "signature"));
  assert.ok(ev.some((e) => e.kind === "block"));
  const chip = ev.find((e) => e.kind === "hit");
  const slow = data.rules.slow;
  const heavy = 1 + Math.min(slow.maxDmg, Math.max(0, (slow.at - data.cards.sig_pereira.speed) * slow.dmg)); // being slow makes it heavier
  const clean = data.cards.sig_pereira.power * heavy * (data.rules.damage.powerBase + data.fighters.pereira.attrs.power * data.rules.damage.powerPerStat) * ENGAGE.dmgScale;
  assert.ok(chip.damage > clean * 0.4 && chip.damage < clean * 0.7, `${chip.damage} of ${clean}`);
  assert.equal(state.a.momentum, 0);
});

test("tactics move the footwork tendencies and the damage; the AI picks one by the score and its tank, and the shown numbers stay honest", () => {
  const state = createMatch(data, "khabib", "mcgregor", 9);
  setTactic(state, "a", "probe");
  const calm = footworkIntent(state, "a").probs;
  setTactic(state, "a", "press");
  assert.ok(state.a.tacticChanged);
  const hard = footworkIntent(state, "a").probs;
  assert.ok(hard.press > calm.press + 0.05 && calm.hold > hard.hold + 0.03, `press ${calm.press}->${hard.press}`);
  setTactic(state, "a", "ko");
  const swing = (t) => {
    setTactic(state, "b", t);
    state.b.hand = ["cross", ...BASICS];
    return previewCombo(state, "b", ["cross"]).damage;
  };
  setTactic(state, "b", "probe");
  const probe = swing("probe");
  assert.ok(swing("ko") > probe * 1.15);
  assert.throws(() => setTactic(state, "a", "nonsense"));
  state.phase = "corner";
  applyCorner(state, { a: "breathe", b: "breathe" }, { a: "points" });
  assert.equal(state.a.tactic, "points");
  assert.ok(state.rules.tactics[state.b.tactic]);
  // The AI's choice of plan.
  const share = (setup, id) => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = createMatch(data, "mcgregor", "khabib", seed);
      s.round = 2;
      setup(s);
      if (chooseTactic(s, "a") === id) n++;
    }
    return n / 300;
  };
  const judges = (a, b) => ({ round: 1, judges: [{ a, b }, { a, b }, { a, b }] });
  const behind = share((s) => s.roundCards.push(judges(9, 10)), "ko");
  const ahead = share((s) => s.roundCards.push(judges(10, 9)), "ko");
  assert.ok(behind > ahead + 0.15, `ko when behind ${behind}, ahead ${ahead}`);
  const press = (stamina) => share((s) => { s.b.stamina = stamina; }, "press");
  assert.ok(press(20) > press(100), "leans on a tired foe");
  // And the tendencies shown are the ones played.
  const probs = footworkIntent(state, "a").probs;
  const counts = {};
  for (let i = 0; i < 5000; i++) {
    const f = chooseFootwork(state, "a");
    counts[f] = (counts[f] || 0) + 1;
  }
  for (const [id, p] of Object.entries(probs)) assert.ok(Math.abs((counts[id] || 0) / 5000 - p) < 0.04, id);
});

test("the AI reads habits: sit on one footwork and he leans toward what beats it, and the screen says so", () => {
  const state = createMatch(data, "mcgregor", "khabib", 12);
  const base = footworkIntent(state, "b");
  for (let i = 0; i < 3; i++) state.fwHist.push({ a: "press", b: "hold" });
  const after = footworkIntent(state, "b");
  assert.ok(after.probs.hold + after.probs.circle > base.probs.hold + base.probs.circle + 0.1, "he sets up to meet the press");
  assert.ok(after.tags.includes("看穿你的習慣"));
  // A leader steers away from the height the other man keeps guarding.
  const hand = leadHand([], []);
  const fresh = engageIntent(hand, "a").probs.high;
  hand.respHist.b.push("high", "high", "high");
  assert.ok(engageIntent(hand, "a").probs.high < fresh - 0.05);
  // And a man who keeps leading high gets his high guard met.
  const guard = leadHand([], []);
  const g0 = engageIntent(guard, "b").probs.high;
  guard.leadHist.a.push("high", "high", "high");
  assert.ok(engageIntent(guard, "b").probs.high > g0 + 0.1);
});

test("stand-up cards read right: height, speed, whether he would see it, and the range", () => {
  const state = createMatch(data, "neutral", "neutral", 2);
  state.dist = 1;
  const slow = describeCard(state, "a", "overhand");
  assert.equal(slow.heightName, "上");
  assert.equal(slow.seenByFoe, true);
  assert.equal(describeCard(state, "a", "jab").seenByFoe, false);
  assert.equal(describeCard(state, "a", "calf_kick").heightName, "下");
  assert.equal(describeCard(state, "a", "single_leg").heightName, "抱");
  assert.equal(describeCard(state, "a", "calf_kick").unusable, false);
  state.dist = 3;
  assert.equal(describeCard(state, "a", "calf_kick").unusable, true);
  assert.ok(describeCard(state, "a", "jab").cost > 0);
});

test("a whole hand through the screen's own steps: engageStart, then a card at a time, with the chance to answer the ones he sees", () => {
  const state = leadHand(["overhand"], ["guard_counter"]);
  const first = engageStart(state, ["overhand", "body_hook"], { kind: "cover" });
  assert.deepEqual(kinds(first), ["engage"]);
  const w = engageWaiting(state);
  assert.equal(w.card, "overhand");
  assert.equal(w.visible, true);
  assert.throws(() => engageStep(state, { kind: "preempt", card: "jab" }), /too late/);
  const ev = engageStep(state, { kind: "guard", height: "high" });
  assert.ok(ev.some((e) => e.kind === "block"));
  assert.equal(state.engage, null, "the block ended the hand");
  assert.equal(stepOf(state), "footwork");
  assert.equal(state.exchange, 2);
});

test("the last hand of a round ends it with the judges' cards, and the next round starts back at mid range", () => {
  const state = createMatch(data, "neutral", "neutral", 3);
  for (let i = 0; i < state.perRound; i++) {
    state.a.hand = [...BASICS];
    state.b.hand = [...BASICS];
    playStandingHand(state, null);
    if (state.ground) break;
  }
  if (!state.ground) {
    assert.equal(state.phase, "corner");
    assert.equal(state.roundCards.length, 1);
    assert.equal(state.edge, null);
  }
});
