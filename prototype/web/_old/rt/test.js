// node prototype/web/rt/test.js — rules of the real-time engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createFight, step, gap, looksLike, phaseOf } from "./engine.js";
import { data, fight } from "./sim.js";
import { createAI, createMasher } from "./ai.js";

const m = data.moves;
const cfg = data.config;

/** Fight with the two fighters `d` apart (centre to centre). */
function at(d) {
  const st = createFight(data, "holloway", "poirier", 1);
  const mid = (st.a.x + st.b.x) / 2;
  st.a.x = mid - d / 2;
  st.b.x = mid + d / 2;
  return st;
}
const run = (st, n, inputs = {}) => {
  for (let i = 0; i < n; i++) step(st, typeof inputs === "function" ? inputs(i) : i === 0 ? inputs : { a: { guard: inputs.a?.guard }, b: { guard: inputs.b?.guard } });
};
const events = (st, n, inputs) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    step(st, typeof inputs === "function" ? inputs(i) : i === 0 ? inputs : { a: { guard: inputs.a?.guard }, b: { guard: inputs.b?.guard } });
    out.push(...st.events);
  }
  return out;
};
const pw = (id) => data.fighters[id].power;

test("a jab in range lands after its startup", () => {
  const st = at(100);
  const hp = st.b.hp;
  const ev = events(st, m.jab.startup + 3, { a: { press: "jab" } });
  const hit = ev.find((e) => e.t === "hit");
  assert.ok(hit);
  assert.ok(Math.abs(hp - st.b.hp - m.jab.dmg * pw("holloway")) < 1e-6);
});

test("out of range the strike whiffs and recovers slower", () => {
  const st = at(m.hook.reach + 60);
  const ev = events(st, 60, { a: { press: "hook" } });
  assert.ok(ev.some((e) => e.t === "whiff" && e.side === "a"));
  assert.equal(st.b.hp, cfg.hp);
});

test("guard: head strikes only chip, body shots go through", () => {
  const st = at(90);
  events(st, 30, { a: { press: "cross" }, b: { guard: true } });
  const chip = cfg.hp - st.b.hp;
  assert.ok(chip > 0 && chip < m.cross.dmg * pw("holloway") * 0.5);
  const st2 = at(90);
  events(st2, 30, { a: { press: "body" }, b: { guard: true } });
  assert.ok(Math.abs(cfg.hp - st2.b.hp - m.body.dmg * pw("holloway")) < 1e-6);
});

test("slip dodges a head punch and the next strike is a counter", () => {
  const st = at(90);
  // b throws a cross; a slips just before it lands, then answers with a hook.
  const ev = events(st, 70, (i) => ({ a: { press: i === m.cross.startup - 4 ? "slip" : i === m.cross.startup + 12 ? "hook" : null }, b: { press: i === 0 ? "cross" : null } }));
  assert.ok(ev.some((e) => e.t === "slipped" && e.side === "a"));
  const hit = ev.find((e) => e.t === "hit" && e.from === "a");
  assert.ok(hit, "the counter hook lands");
  assert.equal(hit.counter, "slip");
});

test("slip does not dodge a kick", () => {
  const st = at(120);
  const ev = events(st, 60, (i) => ({ a: { press: i === m.lowkick.startup - 4 ? "slip" : null }, b: { press: i === 0 ? "lowkick" : null } }));
  assert.ok(ev.some((e) => e.t === "hit" && e.from === "b"));
  assert.ok(!ev.some((e) => e.t === "slipped"));
});

test("a feint looks exactly like a cross while it winds up, and never hits", () => {
  const st = at(90);
  step(st, { a: { press: "feint" } });
  step(st, {});
  const look = looksLike(st, st.a);
  assert.equal(look.act, "strike");
  assert.equal(look.move, "cross");
  run(st, 40, {});
  assert.equal(st.b.hp, cfg.hp);
});

test("hitting a man while he winds up is a counter", () => {
  const st = at(100);
  // b starts a hook (slow), a jabs into it.
  const ev = events(st, 40, (i) => ({ a: { press: i === 2 ? "jab" : null }, b: { press: i === 0 ? "hook" : null } }));
  const hit = ev.find((e) => e.t === "hit" && e.from === "a");
  assert.equal(hit.counter, "punish");
});

test("enough head damage in a short time is a knockdown; three is a TKO", () => {
  const st = at(80);
  st.b.daze = cfg.daze.limit * data.fighters.poirier.chin - 1;
  events(st, 40, { a: { press: "cross" } });
  assert.equal(st.b.knockdowns, 1);
  assert.equal(st.b.act, "down");
  st.b.knockdowns = cfg.daze.maxKnockdowns - 1;
  st.b.act = "idle";
  st.b.daze = 999;
  events(st, 40, { a: { press: "jab" } });
  assert.equal(st.over?.how, "TKO");
});

test("body shots drain stamina and lower its cap", () => {
  const st = at(90);
  events(st, 40, { a: { press: "body" } });
  assert.ok(st.b.stamina < cfg.stamina.max);
  assert.ok(st.b.bodyLoss > 0);
});

test("fighters never leave the cage or overlap, and the clock ends the round", () => {
  const st = fight("holloway", "poirier", 7, (d, s, r) => createMasher(d, r, 0.02), (d, s, r) => createMasher(d, r, 0.02));
  assert.ok(st.over);
  assert.ok(gap(st) >= cfg.minGap - 0.01);
});

test("skill beats mashing: the AI wins most fights against a masher", () => {
  let w = 0;
  for (let i = 0; i < 20; i++) if (fight("holloway", "holloway", 900 + i, (d, s, r) => createAI(d, s, r), (d, s, r) => createMasher(d, r)).over.winner === "a") w++;
  assert.ok(w >= 16, `AI won ${w}/20`);
});
