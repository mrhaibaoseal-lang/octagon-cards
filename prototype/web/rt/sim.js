// Simulation for the real-time prototype: same engine and AI as the browser.
// node prototype/web/rt/sim.js [fightsPerPairing]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFight, step, checkInvariants } from "./engine.js";
import { createAI, createMasher } from "./ai.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "rules", "rt");
const read = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
export const data = { config: read("config"), moves: read("moves"), fighters: read("fighters") };

export function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** brainA/brainB: (data, side, rng) => think(state) */
export function fight(idA, idB, seed, brainA = (d, s, r) => createAI(d, s, r), brainB = brainA, d = data) {
  const st = createFight(d, idA, idB, seed);
  const ra = rngOf(seed * 31 + 1);
  const rb = rngOf(seed * 37 + 2);
  const A = brainA(d, "a", ra);
  const B = brainB(d, "b", rb);
  while (!st.over) {
    step(st, { a: A(st), b: B(st) });
    if (st.tick % 60 === 0) {
      const errs = checkInvariants(st);
      if (errs.length) throw new Error(`invariant: ${errs.join("; ")} seed ${seed}`);
    }
  }
  return st;
}

function summary(rows) {
  const n = rows.length;
  const pct = (k) => `${Math.round((rows.filter(k).length / n) * 100)}%`;
  const avg = (f) => (rows.reduce((x, s) => x + f(s), 0) / n).toFixed(1);
  return `KO ${pct((s) => s.over.how === "KO")} TKO ${pct((s) => s.over.how === "TKO")} 判定 ${pct((s) => s.over.how === "decision")} | 平均 ${avg((s) => s.tick / 60)} 秒，出手 ${avg((s) => s.a.stats.thrown + s.b.stats.thrown)}，命中 ${avg((s) => s.a.stats.landed + s.b.stats.landed)}，被擋 ${avg((s) => s.a.stats.blocked + s.b.stats.blocked)}，閃開 ${avg((s) => s.a.stats.slipped + s.b.stats.slipped)}，反擊 ${avg((s) => s.a.stats.counters + s.b.stats.counters)}，倒地 ${avg((s) => s.a.knockdowns + s.b.knockdowns)}`;
}

function main() {
  const n = Number(process.argv[2]) || 40;
  const ids = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
  for (const x of ids)
    for (const y of ids) {
      if (x > y) continue;
      const rows = [];
      let wx = 0;
      for (let i = 0; i < n; i++) {
        const swap = i % 2 === 1;
        const s = fight(swap ? y : x, swap ? x : y, 100 + i);
        rows.push(s);
        const w = s.over.winner;
        if (w && s[w].id === x) wx += x === y ? (w === "a" ? 1 : 0) : 1;
      }
      console.log(`${x} vs ${y}: ${x}${x === y ? "(左)" : ""} 勝 ${Math.round((wx / n) * 100)}% | ${summary(rows)}`);
    }
  // Skill check: the AI against a button masher with the same fighter.
  for (const x of ids) {
    let w = 0;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const s = fight(x, x, 500 + i, (d, sd, r) => createAI(d, sd, r), (d, sd, r) => createMasher(d, r));
      rows.push(s);
      if (s.over.winner === "a") w++;
    }
    console.log(`${x} AI vs 亂按: AI 勝 ${Math.round((w / n) * 100)}% | ${summary(rows)}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("sim.js")) main();
