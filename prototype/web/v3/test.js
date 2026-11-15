// node --test prototype/web/v3/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFight, step, nextRound, dist, ceilOf } from "./engine.js";
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
  assert.equal(st.f[0].stats.byPart.head, cfg.moves.jab.dmg);
  st = createFight(cfg, { kits }); at(st, 2.5);
  ev = run(st, 400, [{ atk: "jab" }]);
  assert.ok(ev.some((e) => e.type === "miss"));
  assert.equal(st.f[1].dmg.head, 0);
});

test("guard cuts damage and drains stamina", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  run(st, 600, [{ atk: "cross" }, { guard: true }]);
  assert.ok(Math.abs(st.f[0].stats.byPart.head - cfg.moves.cross.dmg * cfg.moves.cross.block) < 1e-6);
  assert.ok(st.f[1].sta < cfg.fighter.sta);
});

test("dodge makes the attack whiff", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  st.events = []; step(st, DT, [{ atk: "cross" }, {}]);
  run(st, 120, [{}, {}]);
  const ev = run(st, 600, [{}, { dodge: true }]);
  assert.ok(ev.some((e) => e.type === "dodged" || e.type === "miss"));
  assert.equal(st.f[1].dmg.head, 0);
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

test("a whiff costs more stamina ceiling than a hit", () => {
  let st = createFight(cfg, { kits }); at(st, 1.2);
  run(st, 600, [{ atk: "cross" }]);
  const hit = cfg.fighter.sta - st.f[0].ceil;
  st = createFight(cfg, { kits }); at(st, 3);
  run(st, 600, [{ atk: "cross" }]);
  const miss = cfg.fighter.sta - st.f[0].ceil;
  assert.ok(Math.abs(hit - cfg.moves.cross.sta * cfg.stamina.ceilPerSta) < 1e-9);
  assert.ok(Math.abs(miss - hit * cfg.stamina.missMult) < 1e-9);
});

test("stamina comes back faster outside the fire zone", () => {
  const regen = (d) => { const st = createFight(cfg, { kits }); at(st, d); st.f[0].sta = 40; run(st, 1000); return st.f[0].sta - 40; };
  const inside = regen(1.5), outside = regen(4);
  assert.ok(Math.abs(inside - cfg.stamina.regenIn) < 0.3, `inside ${inside}`);
  assert.ok(outside > inside * 3, `outside ${outside}`);
});

test("head damage at 100 always knocks down; a fresh head does not", () => {
  let st = createFight(cfg, { kits }); at(st, 1.2);
  st.f[1].dmg.head = 100;
  const ev = run(st, 400, [{ atk: "jab" }]);
  assert.equal(st.phase, "over"); assert.equal(st.how, "KO"); assert.equal(st.winner, 0);
  assert.ok(ev.some((e) => e.type === "hit" && e.ko));
  let kos = 0;
  for (let seed = 1; seed <= 30; seed++) { st = createFight(cfg, { kits, seed }); at(st, 1.2); run(st, 600, [{ atk: "cross" }]); if (st.phase === "over") kos++; }
  assert.equal(kos, 0);
});

test("head damage rises with hits, only 60% heals; leg damage slows; low kick targets leg", () => {
  const st = createFight(cfg, { kits }); at(st, 1.4);
  run(st, 600, [{ atk: "lowkick" }]);
  assert.ok(st.f[1].dmg.leg > 0 && st.f[1].dmg.head === 0);
  const s2 = createFight(cfg, { kits }); at(s2, 1.2);
  run(s2, 600, [{ atk: "cross" }]);
  const h0 = s2.f[0].stats.byPart.head; at(s2, 4); s2.f[1].act = null; s2.f[1].stun = 0;
  run(s2, 60000);
  assert.ok(Math.abs(s2.f[1].dmg.head - h0 * (1 - cfg.damage.softFrac)) < 1e-6);
  const s3 = createFight(cfg, { kits }); s3.f[0].dmg.leg = 100; at(s3, 3);
  const x0 = s3.f[0].x; run(s3, 1000, [{ fwd: 1 }]);
  assert.ok(s3.f[0].x - x0 < cfg.fighter.speed.forward * (1 - cfg.damage.legSpeed) + 0.05);
});

test("below 25% of the ceiling is tired: weaker, slower windup", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  st.f[0].sta = 10; // jab costs 4, still allowed
  run(st, 400, [{ atk: "jab" }]);
  assert.ok(Math.abs(st.f[0].stats.byPart.head - cfg.moves.jab.dmg * cfg.stamina.tiredDmg) < 1e-9);
  assert.ok(ceilOf(st, st.f[0]) <= 100);
});

test("AI only uses jab and low kick in the first 25 s of round 1", () => {
  const big = [["jab", "cross", "hook", "lowkick"], ["jab", "cross", "hook", "lowkick", "highkick", "superman"]];
  let starts = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const st = createFight(cfg, { seed, kits: big });
    const ais = [createAI(cfg, st.rand), createAI(cfg, st.rand)];
    for (let t = 0; t < 25000; t += DT * 1000) {
      st.events = [];
      step(st, DT, [aiInput(ais[0], st, 0, DT), aiInput(ais[1], st, 1, DT)]);
      if (st.phase !== "fight") break;
      for (const e of st.events) if (e.type === "start" && e.by === 1) { starts++; assert.ok(cfg.ai.probe.moves.includes(e.move), e.move); }
    }
  }
  assert.ok(starts > 0);
});

test("AI throws waves of 2-3 and backs off", () => {
  const st = createFight(cfg, { seed: 3 }); st.round = 2; // past the probe
  const ai = createAI(cfg, st.rand, "kicker");
  const bursts = []; let cur = 0, mode = ai.mode;
  for (let t = 0; t < 60000; t += DT * 1000) {
    st.events = [];
    step(st, DT, [{ fwd: st.f[0].x < 0 && dist(st.f[0], st.f[1]) > 1.3 ? 1 : 0 }, aiInput(ai, st, 1, DT)]);
    if (st.phase !== "fight") break;
    cur += st.events.filter((e) => e.type === "start" && e.by === 1).length;
    if (ai.mode !== mode) { if (ai.mode === "wait") { bursts.push(cur); cur = 0; } mode = ai.mode; }
  }
  assert.ok(bursts.length >= 2 && bursts.every((b) => b <= 4), bursts.join());
});
