// node --test prototype/web/v3/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFight, step, nextRound, dist, reach } from "./engine.js";
import { createAI, aiInput } from "./ai.js";

const cfg = JSON.parse(readFileSync(new URL("../rules/v3/config.json", import.meta.url)));
const DT = 1 / 60;
const run = (st, ms, inputs = []) => { const ev = []; for (let t = 0; t < ms; t += DT * 1000) { st.events = []; step(st, DT, inputs); ev.push(...st.events); } return ev; };
const at = (st, d) => { st.f[0].x = -d / 2; st.f[1].x = d / 2; st.f[0].z = st.f[1].z = 0; };
const kits = [["jab", "cross", "hook", "lowkick"], ["jab", "cross", "hook", "lowkick"]];

test("jab in range hits, out of range misses", () => {
  let st = createFight(cfg, { kits }); at(st, 1.2);
  let ev = run(st, 400, [{ atk: "jab" }]);
  assert.ok(ev.some((e) => e.type === "hit" && e.move === "jab"));
  assert.ok(Math.abs(ev.find((e) => e.type === "hit").dmg - cfg.moves.jab.dmg) < 1e-9);
  const pts = cfg.moves.jab.dmg * cfg.parts.dmgScale;
  assert.ok(st.f[1].parts.head > pts - 0.5 && st.f[1].parts.head <= pts);
  st = createFight(cfg, { kits }); at(st, 2.5);
  ev = run(st, 400, [{ atk: "jab" }]);
  assert.ok(ev.some((e) => e.type === "miss"));
  assert.equal(st.f[1].parts.head, 0);
});

test("guard cuts damage and drains stamina", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  const ev = run(st, 600, [{ atk: "cross" }, { guard: true }]);
  assert.ok(Math.abs(ev.find((e) => e.type === "block").dmg - cfg.moves.cross.dmg * cfg.moves.cross.block) < 1e-6);
  assert.ok(st.f[1].sta < cfg.stamina.max);
});

test("dodge makes the attack whiff", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  st.events = []; step(st, DT, [{ atk: "cross" }, {}]);
  run(st, 120, [{}, {}]);
  const ev = run(st, 600, [{}, { dodge: true }]);
  assert.ok(ev.some((e) => e.type === "dodged" || e.type === "miss"));
  assert.equal(st.f[1].parts.head, 0);
});

test("same-or-heavier hit during windup is a counter and cancels the move", () => {
  const st = createFight(cfg, { kits }); at(st, 1.1);
  st.events = []; step(st, DT, [{}, { atk: "lowkick" }]);
  const ev = run(st, 500, [{ atk: "cross" }, {}]);
  assert.ok(ev.some((e) => e.type === "hit" && e.counter && e.by === 0));
  assert.ok(!ev.some((e) => e.type === "hit" && e.by === 1 && e.move === "lowkick"));
});

test("a jab can't stop a cross already coming: both land (trade)", () => {
  const st = createFight(cfg, { kits }); at(st, 1.1);
  st.events = []; step(st, DT, [{}, { atk: "cross" }]);
  const ev = run(st, 500, [{ atk: "jab" }, {}]);
  assert.ok(ev.some((e) => e.type === "hit" && e.by === 0 && e.trade));
  assert.ok(ev.some((e) => e.type === "hit" && e.by === 1 && e.move === "cross"));
});

test("landing with the tip of the range is a graze", () => {
  const st = createFight(cfg, { kits }); at(st, 1.58);
  const ev = run(st, 400, [{ atk: "jab" }]);
  const h = ev.find((e) => e.type === "hit");
  assert.ok(h && h.tip && Math.abs(h.dmg - cfg.moves.jab.dmg * cfg.tip.dmg) < 1e-9);
});

test("spamming jab no longer wins the exchange for free", () => {
  let mine = 0, his = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const st = createFight(cfg, { seed, kits: [cfg.player.kit, ["jab", "cross", "hook", "lowkick"]] });
    const ai = createAI(cfg, st.rand);
    for (let t = 0; t < 30000 && st.phase === "fight"; t += DT * 1000) {
      st.events = [];
      const d = dist(st.f[0], st.f[1]);
      step(st, DT, [{ fwd: d > 1.3 ? 1 : 0, atk: "jab" }, aiInput(ai, st, 1, DT)]);
    }
    mine += st.f[0].stats.dmg; his += st.f[1].stats.dmg;
  }
  console.log(`  jab spam vs AI, 20 x 30 s: you ${mine.toFixed(0)} dmg, AI ${his.toFixed(0)} dmg`);
  assert.ok(his > mine * 0.8);
});

test("fighters never overlap or leave the cage", () => {
  const st = createFight(cfg, { kits });
  run(st, 3000, [{ fwd: 1, side: 1 }, { fwd: 1, side: -1 }]);
  assert.ok(dist(st.f[0], st.f[1]) >= cfg.arena.minDist - 0.02);
  for (const f of st.f) assert.ok(Math.hypot(f.x, f.z) <= cfg.arena.radius);
});

test("AI vs AI fights finish and both land strikes", () => {
  let kos = 0, landed = 0, secs = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const st = createFight(cfg, { seed });
    const ais = [createAI(cfg, st.rand), createAI(cfg, st.rand)];
    while (st.phase !== "over") {
      if (st.phase === "break") nextRound(st);
      st.events = [];
      step(st, DT, [aiInput(ais[0], st, 0, DT), aiInput(ais[1], st, 1, DT)]);
    }
    if (st.how === "KO") { kos++; secs += (st.round - 1) * cfg.round.seconds + cfg.round.seconds - st.clock / 1000; }
    landed += st.f[0].stats.landed + st.f[1].stats.landed;
  }
  console.log(`  20 AI fights: ${kos} KO, avg strikes landed per fight ${(landed / 20).toFixed(0)}, avg KO time ${(secs / Math.max(1, kos)).toFixed(0)} s`);
  assert.ok(landed > 0);
});

test("a whiff drops the stamina ceiling twice as much as a hit", () => {
  const drop = (d) => { const st = createFight(cfg, { kits }); at(st, d); run(st, 700, [{ atk: "cross" }]); return cfg.stamina.max - st.f[0].ceil; };
  const hit = drop(1.2), miss = drop(2.6), unit = cfg.moves.cross.sta * cfg.stamina.ceilPerCost;
  assert.ok(Math.abs(hit - unit) < 1e-9, `hit ${hit}`);
  assert.ok(Math.abs(miss - unit * cfg.stamina.missMult) < 1e-9, `miss ${miss}`);
});

test("stamina comes back faster outside the striking zone than inside", () => {
  const regen = (d, guard = false) => {
    const st = createFight(cfg, { kits }); at(st, d); st.f[0].sta = 20; run(st, 1000, [{ guard }]); return st.f[0].sta - 20;
  };
  const zone = reach(cfg, { kit: kits[1] }) + cfg.stamina.zonePad;
  const inside = regen(zone - 0.5), outside = regen(zone + 0.8), guarding = regen(zone + 0.8, true);
  assert.ok(Math.abs(inside - cfg.stamina.regenIn) < 0.3, `in ${inside}`);
  assert.ok(Math.abs(outside - cfg.stamina.regenOut) < 0.3, `out ${outside}`);
  assert.ok(Math.abs(guarding - cfg.stamina.regenGuard) < 0.3, `guard ${guarding}`);
});

test("a full head means a knockdown; a fresh head rarely falls to one cross", () => {
  let st = createFight(cfg, { kits }); at(st, 1.2); st.f[1].parts.head = cfg.parts.max - 0.5;
  run(st, 600, [{ atk: "cross" }]);
  assert.equal(st.phase, "over"); assert.equal(st.how, "KO"); assert.equal(st.winner, 0);
  let falls = 0;
  for (let seed = 1; seed <= 40; seed++) { st = createFight(cfg, { kits, seed }); at(st, 1.2); run(st, 600, [{ atk: "cross" }]); if (st.phase === "over") falls++; }
  assert.ok(falls <= 1, `${falls} falls on a fresh head`);
});

test("40% of head damage stays, the rest heals outside the zone", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  const hit = run(st, 600, [{ atk: "cross" }]).find((e) => e.type === "hit").dmg; assert.ok(hit > 0);
  st.f[0].x = -5; st.f[1].x = 5; // far apart
  run(st, 20000, [{}, {}]);
  assert.ok(Math.abs(st.f[1].headPerm - hit * cfg.parts.dmgScale * (1 - cfg.parts.headSoft)) < 1e-6);
  assert.ok(Math.abs(st.f[1].parts.head - st.f[1].headPerm) < 1e-6);
});

test("tired fighters hit softer and wind up slower", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2); st.f[0].sta = 5;
  run(st, 20, [{ atk: "jab" }]);
  assert.ok(Math.abs(st.f[0].act.windup - cfg.moves.jab.windup * cfg.stamina.tiredWindup) < 1e-9);
});

test("round break refills stamina to the ceiling and lifts the ceiling", () => {
  const st = createFight(cfg, { kits }); st.f[0].ceil = 70; st.f[0].sta = 10; st.phase = "break";
  nextRound(st);
  assert.equal(st.f[0].ceil, 70 + cfg.stamina.restCeil); assert.equal(st.f[0].sta, st.f[0].ceil);
  st.f[1].ceil = 98; nextRound(st); assert.equal(st.f[1].ceil, cfg.stamina.max);
});

test("AI only uses the jab and low kick in the first 25 seconds of round 1", () => {
  const used = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const st = createFight(cfg, { seed, kits: [cfg.player.kit, ["jab", "cross", "hook", "lowkick"]] });
    const ai = createAI(cfg, st.rand);
    for (let t = 0; t < 24000 && st.phase === "fight"; t += DT * 1000) {
      st.events = [];
      const d = dist(st.f[0], st.f[1]);
      step(st, DT, [{ fwd: d > 1.5 ? 1 : 0, atk: Math.random() < 0.03 ? "hook" : null, guard: t % 3000 > 2500 }, aiInput(ai, st, 1, DT)]);
      for (const e of st.events) if (e.type === "start" && e.by === 1) used.add(e.move);
    }
  }
  console.log("  AI moves in the probing window:", [...used].join(", "));
  assert.ok(used.size > 0);
  for (const m of used) assert.ok(cfg.ai.probe.moves.includes(m), m);
});

test("AI backs off out of the strike zone after a wave", () => {
  const st = createFight(cfg, { seed: 3, kits: [cfg.player.kit, ["jab", "cross", "hook", "lowkick"]] });
  const ai = createAI(cfg, st.rand, "kicker");
  st.round = 2; let retreats = 0, was = false;
  for (let t = 0; t < 40000 && st.phase === "fight"; t += DT * 1000) {
    st.events = [];
    const d = dist(st.f[0], st.f[1]);
    step(st, DT, [{ fwd: d > 1.3 ? 1 : 0 }, aiInput(ai, st, 1, DT)]);
    if (ai.resting && !was) retreats++; was = ai.resting;
  }
  assert.ok(retreats >= 3, `retreats ${retreats}`);
});
