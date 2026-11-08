// Simulation for the deck-builder rules. Runs the same engine and AI as the game.
// node prototype/web/deck/sim.js [gamesPerPairing]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMatch, startHand, commitPlan, endFirstPhase, other, checkInvariants } from "./engine.js";
import { plan, playLive } from "./ai.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "rules", "deck");
const read = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
export const data = { config: read("config"), cards: read("cards"), fighters: read("fighters") };

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

/** One hand: the second seat commits blind, the first seat looks at the plan and plays, then the plan runs. */
export function playHand(state, rng, { firstLook = true } = {}) {
  startHand(state);
  const second = other(state.first);
  commitPlan(state, second, plan(state, second, { look: false, rng }));
  playLive(state, state.first, { look: firstLook, rng });
  endFirstPhase(state, (st, seat) => plan(st, seat, { look: false, rng }));
}

/** Plays a whole match. idA is always the seat that acts first. */
export function playMatch(idA, idB, seed, opts = {}) {
  const state = createMatch(data, idA, idB, seed);
  const rng = rngOf(seed * 7919 + 13);
  let guard = 200;
  while (!state.over && guard-- > 0) {
    playHand(state, rng, opts);
    const errs = checkInvariants(state);
    if (errs.length) throw new Error(`invariant: ${errs.join("; ")} (seed ${seed})`);
  }
  return state;
}

function main() {
  const games = Number(process.argv[2]) || 60;
  const ids = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
  const rows = [];
  const total = Object.fromEntries(ids.map((i) => [i, { w: 0, g: 0 }]));
  for (const x of ids) {
    for (const y of ids) {
      if (x >= y) continue;
      const r = { wins: { [x]: 0, [y]: 0 }, draws: 0, how: { KO: 0, tap: 0, decision: 0 }, hands: 0, ground: 0, gassed: 0, played: 0, takedowns: 0, firstWins: 0 };
      for (let i = 0; i < games; i++) {
        const swap = i % 2 === 1; // the seat that moves first alternates, so the order bias cancels
        const A = swap ? y : x;
        const B = swap ? x : y;
        const s = playMatch(A, B, 1000 + i);
        const w = s.over.winner;
        if (!w) r.draws++;
        else {
          const id = s[w].id;
          r.wins[id]++;
          if (w === "a") r.firstWins++;
        }
        r.how[s.over.how]++;
        r.hands += s.stats.hands;
        r.ground += s.stats.groundHands;
        r.gassed += s.stats.a.fallback + s.stats.b.fallback;
        r.played += s.stats.a.played + s.stats.b.played;
        r.takedowns += s.stats.a.takedowns + s.stats.b.takedowns;
      }
      total[x].w += r.wins[x] + r.draws / 2;
      total[y].w += r.wins[y] + r.draws / 2;
      total[x].g += games;
      total[y].g += games;
      rows.push({ x, y, r, games });
    }
  }
  for (const { x, y, r, games: g } of rows) {
    const pct = (n) => `${Math.round((n / g) * 100)}%`;
    console.log(
      `${x} vs ${y}: ${x} ${pct(r.wins[x])} / ${y} ${pct(r.wins[y])} / 平 ${pct(r.draws)} | KO ${pct(r.how.KO)} 降伏 ${pct(r.how.tap)} 判定 ${pct(r.how.decision)} | 每場 ${(r.hands / g).toFixed(1)} 手，地面 ${Math.round((r.ground / r.hands) * 100)}%，出牌 ${(r.played / g).toFixed(0)}，基本招 ${(r.gassed / g).toFixed(1)}，摔倒 ${(r.takedowns / g).toFixed(1)}`,
    );
  }
  console.log("總勝率:", ids.map((i) => `${i} ${Math.round((total[i].w / total[i].g) * 100)}%`).join("  "));
}

if (process.argv[1] && process.argv[1].endsWith("sim.js")) main();
