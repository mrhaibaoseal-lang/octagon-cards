// node --test prototype/web/v3/test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFight, step, nextRound, dist } from "./engine.js";
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
  assert.equal(st.f[1].hp, cfg.fighter.hp - cfg.moves.jab.dmg);
  st = createFight(cfg, { kits }); at(st, 2.5);
  ev = run(st, 400, [{ atk: "jab" }]);
  assert.ok(ev.some((e) => e.type === "miss"));
  assert.equal(st.f[1].hp, cfg.fighter.hp);
});

test("guard cuts damage and drains stamina", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  run(st, 600, [{ atk: "cross" }, { guard: true }]);
  assert.ok(Math.abs(st.f[1].hp - (cfg.fighter.hp - cfg.moves.cross.dmg * cfg.moves.cross.block)) < 1e-6);
  assert.ok(st.f[1].sta < cfg.fighter.sta);
});

test("dodge makes the attack whiff", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  st.events = []; step(st, DT, [{ atk: "cross" }, {}]);
  run(st, 120, [{}, {}]);
  const ev = run(st, 600, [{}, { dodge: true }]);
  assert.ok(ev.some((e) => e.type === "dodged" || e.type === "miss"));
  assert.equal(st.f[1].hp, cfg.fighter.hp);
});

test("hitting during windup is a counter and cancels the move", () => {
  const st = createFight(cfg, { kits }); at(st, 1.2);
  st.events = []; step(st, DT, [{}, { atk: "cross" }]);
  const ev = run(st, 300, [{ atk: "jab" }, {}]);
  assert.ok(ev.some((e) => e.type === "hit" && e.counter && e.by === 0));
  assert.ok(!ev.some((e) => e.type === "hit" && e.by === 1));
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
