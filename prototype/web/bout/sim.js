// Simulation for the card bout: the same engine and AI as the browser.
// node prototype/web/bout/sim.js [fightsPerPairing]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBout, playBeat, settleKnockdown, checkInvariants, prepare } from "./engine.js";
import { createAI, createMasher } from "./ai.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "rules", "bout");
const read = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
export const data = prepare({ config: read("config"), cards: read("cards"), fighters: read("fighters") });

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

/** brainA/brainB: (data, side, rng) => { think(st), chase(st) } */
export function fight(idA, idB, seed, brainA = createAI, brainB = brainA, d = data) {
  const st = createBout(d, idA, idB, seed);
  const ra = rngOf(seed * 7 + 1);
  const rb = rngOf(seed * 13 + 5);
  const A = brainA(d, "a", ra);
  const B = brainB(d, "b", rb);
  let beats = 0;
  const stats = { knockdowns: 0, whiffRange: 0, attacks: 0, hits: 0 };
  while (!st.over && beats < 400) {
    const ev = playBeat(st, A.think(st), B.think(st));
    for (const e of ev) if (e.t === "attack") { stats.attacks++; if (e.hit) stats.hits++; if (e.whiff === "range") stats.whiffRange++; }
    if (st.pending) {
      const brain = st.pending.by === "a" ? A : B;
      const ev2 = settleKnockdown(st, brain.chase(st));
      stats.knockdowns++;
      void ev2;
    }
    checkInvariants(st);
    beats++;
  }
  return { st, beats: st.round * d.config.beatsPerRound + st.beat, stats };
}

function summarize(label, results) {
  const n = results.length;
  const wins = { a: 0, b: 0, draw: 0 };
  let beats = 0, finish = 0, r1 = 0, kd = 0, atk = 0, hit = 0, whiff = 0;
  for (const r of results) {
    const o = r.st.over;
    wins[o.winner ?? "draw"]++;
    beats += r.beats;
    const fin = !o.cards;
    if (fin) finish++;
    if (fin && o.round === 1) r1++;
    kd += r.stats.knockdowns;
    atk += r.stats.attacks; hit += r.stats.hits; whiff += r.stats.whiffRange;
  }
  const pct = (x) => `${Math.round((100 * x) / n)}%`;
  console.log(`${label.padEnd(34)} A ${pct(wins.a)}  B ${pct(wins.b)}  平 ${pct(wins.draw)} | 平均 ${(beats / n).toFixed(1)} 手 | 終結 ${pct(finish)}（R1 ${pct(r1)}）判定 ${pct(n - finish)} | 倒地 ${(kd / n).toFixed(2)}/場 | 命中 ${Math.round((100 * hit) / atk)}% 距離落空 ${Math.round((100 * whiff) / atk)}%`);
  return { wins, n, beats };
}

if (process.argv[1] && process.argv[1].endsWith("sim.js")) {
  const N = Number(process.argv[2]) || 100;
  const ids = ["holloway", "poirier"];
  const run = (a, b, brainA, brainB, seed0) => Array.from({ length: N }, (_, i) => fight(a, b, seed0 + i, brainA, brainB));
  const swap = (rs) => rs.map((r) => ({ ...r, st: { ...r.st, over: { ...r.st.over, winner: r.st.over.winner === "a" ? "b" : r.st.over.winner === "b" ? "a" : null } } }));
  // fairness: Holloway vs Poirier with sides swapped
  const x = run(ids[0], ids[1], createAI, createAI, 1000);
  const y = swap(run(ids[1], ids[0], createAI, createAI, 5000)); // swap so "a" is always Holloway
  summarize("Holloway(AI) vs Poirier(AI)", [...x, ...y]);
  // skill beats mashing
  summarize("Holloway(AI) vs Holloway(亂按)", run(ids[0], ids[0], createAI, createMasher, 9000));
  summarize("Poirier(AI) vs Poirier(亂按)", run(ids[1], ids[1], createAI, createMasher, 9500));
  summarize("亂按 vs 亂按（Holloway/Poirier）", run(ids[0], ids[1], createMasher, createMasher, 12000));
}
