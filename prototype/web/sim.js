// Balance simulator. Every game runs through the same engine, hands and AI as the real prototype.
// Usage: node prototype/web/sim.js [games] [--gate] [--mode=main]
//   --gate   only the strategy table and the pass conditions (fast)
//   --mode   match length: standard (default) or main
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMatch, resolveExchange, applyCorner, chooseAI, chooseCorner, getIntent, bestPlay, budget, nextUnit, opposite, checkInvariants, usableAt, arrange } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, "rules", name), "utf8"));
export const data = { rules: load("rules.json"), cards: load("cards.json"), fighters: load("fighters.json") };

const TYPES = ["S", "G", "C"];
const ARGS = process.argv.slice(2);
const MODE = (ARGS.find((a) => a.startsWith("--mode=")) || "--mode=standard").slice(7);

// ---------- Player strategies. Each returns an array of card ids. ----------

function randomPlay(state, s) {
  const b = budget(state, s);
  const type = TYPES[Math.floor(nextUnit(state) * 3)];
  const pool = state[s].hand.filter((c) => state.cards[c].type === type && usableAt(state, state.cards[c], state.dist));
  const cards = [];
  let left = b;
  for (const c of pool) {
    if (state.cards[c].cost <= left && nextUnit(state) < 0.5) {
      cards.push(c);
      left -= state.cards[c].cost;
    }
  }
  return arrange(state, cards) || [];
}

/** What a viewer actually sees: with blood in the eyes only the most likely type shows. */
function seen(intent) {
  if (!intent.blind) return intent.probs;
  const rest = (1 - intent.probs[intent.top]) / 2;
  return { S: rest, G: rest, C: rest, [intent.top]: intent.probs[intent.top] };
}

const spam = (type) => (state, s) => bestPlay(state, s, type, budget(state, s));
const spamCheap = (type) => (state, s) => bestPlay(state, s, type, 1);

function biggest(state, s) {
  return bestPlay(state, s, "S", budget(state, s));
}

/** Plays what the opponent's displayed intent says, and commits harder the more sure it is. */
function reader(state, s) {
  const intent = getIntent(state, opposite(s));
  const probs = seen(intent);
  const tri = state.rules.triangle;
  const beaterOf = (t) => TYPES.find((x) => tri[x] === t);
  const loserOf = (t) => tri[t];
  let bestType = "C";
  let bestEv = -Infinity;
  for (const t of TYPES) {
    // A type nobody can throw from here is no use, however good the read.
    if (t !== "C" && bestPlay(state, s, t, budget(state, s)).length === 0) continue;
    const ev = probs[loserOf(t)] - probs[beaterOf(t)];
    if (ev > bestEv) {
      bestEv = ev;
      bestType = t;
    }
  }
  const b = budget(state, s);
  const sure = probs[loserOf(bestType)];
  let limit = sure >= 0.45 ? b : sure >= 0.35 ? Math.min(b, 2) : 1;
  if (!state[opposite(s)].rocked) {
    if (state[s].stamina < 30) limit = Math.min(limit, 1);
    else if (state[s].stamina < 50) limit = Math.min(limit, 2);
  }
  const sig = state.fighters[state[s].id].signature;
  if (state[s].hand.includes(sig) && state.cards[sig].type === bestType && state.cards[sig].cost <= b) return [sig];
  return bestPlay(state, s, bestType, limit);
}

/** Same read, but always all-in. Shows whether commit sizing matters. */
function readerAllIn(state, s) {
  const probs = seen(getIntent(state, opposite(s)));
  const tri = state.rules.triangle;
  const best = TYPES.reduce((a, t) => (probs[tri[t]] > probs[tri[a]] ? t : a), "S");
  return bestPlay(state, s, best, budget(state, s));
}

export const strategies = {
  "亂出": randomPlay,
  "只出打擊（最大）": spam("S"),
  "只出摔抱（最大）": spam("G"),
  "只出防反（最大）": spam("C"),
  "只出打擊（1 能量）": spamCheap("S"),
  "只出防反（1 能量）": spamCheap("C"),
  "永遠最猛打擊": biggest,
  "看意圖但全押": readerAllIn,
  "看意圖並控制投入": reader,
};

// ---------- Game loop ----------

export function playGame(idA, idB, stratA, seed, data_ = data, mode = MODE) {
  const state = createMatch(data_, idA, idB, seed, mode);
  let exchanges = 0;
  let groundExchanges = 0;
  let minStamina = 100;
  const counts = {};
  while (state.phase !== "over") {
    if (state.phase === "corner") {
      applyCorner(state, { a: chooseCorner(state, "a"), b: chooseCorner(state, "b") });
      continue;
    }
    // Intent is read before either side commits, as in the real game.
    const playA = stratA ? stratA(state, "a") : chooseAI(state, "a").cards;
    const playB = chooseAI(state, "b").cards;
    if (state.ground) groundExchanges++;
    for (const e of resolveExchange(state, playA, playB)) counts[e.kind] = (counts[e.kind] || 0) + 1;
    minStamina = Math.min(minStamina, state.a.stamina);
    exchanges++;
    const errs = checkInvariants(state);
    if (errs.length) throw new Error(`invariant: ${errs.join("; ")} seed ${seed}`);
  }
  return { state, exchanges, groundExchanges, counts, minStamina };
}

function batch(idA, idB, strat, games, seedBase) {
  const r = { win: 0, loss: 0, draw: 0, exch: 0, KO: 0, TKO: 0, SUB: 0, DEC: 0, minStamina: 0, ground: 0, rocked: 0, takedown: 0, signature: 0, lock: 0, cut: 0, doctor: 0, whiff: 0, range: 0 };
  for (let i = 0; i < games; i++) {
    const g = playGame(idA, idB, strat, seedBase + i);
    if (g.state.over.winner === "a") r.win++;
    else if (g.state.over.winner === "b") r.loss++;
    else r.draw++;
    r[g.state.over.method]++;
    r.exch += g.exchanges;
    r.ground += g.groundExchanges;
    r.minStamina += g.minStamina;
    r.rocked += g.counts.rocked || 0;
    r.takedown += g.counts.takedown || 0;
    r.signature += g.counts.signature || 0;
    r.lock += g.counts.lockStart || 0;
    r.cut += g.counts.cut || 0;
    r.doctor += g.state.over.reason === "doctor" ? 1 : 0;
    r.whiff += g.counts.whiff || 0;
    r.range += g.counts.range || 0;
  }
  return r;
}

const pct = (n, games) => `${((100 * n) / games).toFixed(0)}%`.padStart(4);
const avg = (n, games) => (n / games).toFixed(1);

function row(label, r, games) {
  return `${label.padEnd(20)} 勝${pct(r.win, games)} 負${pct(r.loss, games)} | KO${pct(r.KO, games)} TKO${pct(r.TKO, games)} 降${pct(r.SUB, games)} 判${pct(r.DEC, games)} | ${avg(r.exch, games)}手 地面${pct(r.ground, r.exch)} | 暈${avg(r.rocked, games)} 摔${avg(r.takedown, games)} 鎖${avg(r.lock, games)} 招${avg(r.signature, games)} 割${avg(r.cut, games)} 醫${pct(r.doctor, games)} 空${avg(r.whiff, games)} 移${avg(r.range, games)} | 最低體力${(r.minStamina / games).toFixed(0)}`;
}

function tables(games) {
  console.log(`
=== AI vs AI 對戰表（各 ${games} 場，列 = A 方）===`);
  const ids = Object.keys(data.fighters).filter((id) => !data.fighters[id].hidden);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      console.log(row(`${a} vs ${b}`, batch(a, b, null, games, 5000), games));
    }
  }
  console.log(`
=== 玩家看意圖打真實選手（各 ${games} 場）===`);
  for (const a of ids) {
    for (const b of ids) {
      console.log(row(`${a} vs ${b}`, batch(a, b, reader, games, 9000), games));
    }
  }
}

function main() {
  const games = Number(ARGS.find((a) => /^\d+$/.test(a))) || 2000;
  console.log(`=== 打法勝率（同屬性 測試選手 vs 測試選手 AI，各 ${games} 場，${MODE}）===`);
  const results = {};
  for (const [name, strat] of Object.entries(strategies)) {
    results[name] = batch("neutral", "neutral", strat, games, 1000);
    console.log(row(name, results[name], games));
  }
  if (!ARGS.includes("--gate")) tables(games);
  const win = (n) => (100 * results[n].win) / games;
  const spams = ["只出打擊（最大）", "只出摔抱（最大）", "只出防反（最大）", "只出打擊（1 能量）", "只出防反（1 能量）", "永遠最猛打擊"];
  const worstSpam = Math.max(...spams.map(win));
  console.log("\n=== M1 通過條件 ===");
  console.log(`看意圖並控制投入 ≥ 75%：${win("看意圖並控制投入").toFixed(1)}% ${win("看意圖並控制投入") >= 75 ? "通過" : "未通過"}`);
  console.log(`亂出 < 50%：${win("亂出").toFixed(1)}% ${win("亂出") < 50 ? "通過" : "未通過"}`);
  console.log(`單一打法 ≤ 55%（最高）：${worstSpam.toFixed(1)}% ${worstSpam <= 55 ? "通過" : "未通過"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
