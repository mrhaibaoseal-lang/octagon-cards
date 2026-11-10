// Plan B simulation: win rate of each tactic per matchup, and of each key-moment option.
// Same engine, cards, intent AI and tactic styles as auto.html. node prototype/web/v2/auto-sim.js [bouts per cell]
import { loadData } from "./load.node.js";
import { runAuto, offered } from "./auto.js";

const data = loadData(), N = Number(process.argv[2]) || 200;
const ids = Object.keys(data.fighters), T = data.tactics;
const pc = (x) => `${Math.round(x * 100)}%`.padStart(5);
function run(a, b, t, pick) {
  const r = { w: 0, fin: 0, finBy: 0, picks: 0 };
  for (let i = 0; i < N; i++) {
    const au = runAuto(data, a, b, 500 + i * 7919, t, pick), o = au.st.over;
    r.picks += au.picks / N;
    if (o.winner === "a") { r.w += 1 / N; if (o.how !== "DEC") r.fin += 1 / N; } else if (o.how !== "DEC") r.finBy += 1 / N;
  }
  return r;
}
const pairs = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));
console.log(`B 計畫模擬：每格 ${N} 場，關鍵時刻一律「照原本的打」。\n`);
console.log("一、各戰術的勝率（欄＝你>對手）");
console.log("戰術            " + pairs.map(([a, b]) => `${a.slice(0, 3)}>${b.slice(0, 3)}`.padStart(8)).join("") + "    平均   終結  被終結  關鍵時刻/場");
const best = {};
for (const t of T.tactics) {
  let row = T.styles[t].name.padEnd(10, "　"), s = { w: 0, fin: 0, finBy: 0, picks: 0 }, n = 0;
  for (const [a, b] of pairs) {
    if (!offered(data, a, t)) { row += "       —"; continue; }
    const r = run(a, b, t);
    row += pc(r.w).padStart(8);
    for (const k in s) s[k] += r[k];
    n++;
    const key = `${a}>${b}`;
    if (!best[key] || r.w > best[key].w) best[key] = { t, w: r.w };
    (best[key].all ||= []).push(r.w);
  }
  console.log(`${row}   ${pc(s.w / n)}  ${pc(s.fin / n)}  ${pc(s.finBy / n)}   ${(s.picks / n).toFixed(1)}`);
}
console.log("\n二、關鍵時刻各選項的勝率（戰術固定「" + T.styles[T.tactics[0]].name + "」，只在該時刻選這一項）");
for (const m of T.moments) console.log(`${m.title.padEnd(12, "　")}` + m.options.map((o) => {
  let w = 0;
  for (const [a, b] of pairs) w += run(a, b, T.tactics[0], (mm) => (mm.when === m.when ? o : "keep")).w / pairs.length;
  return `${o === "keep" ? "照原本的打" : T.styles[o].name} ${pc(w).trim()}`;
}).join("｜"));

console.log("\n三、檢查");
const tops = new Set(Object.values(best).map((x) => x.t));
const checks = [["沒有一種戰術在每個對戰都最好（至少兩種戰術各自是某個對戰的最佳）", tops.size >= 2]];
let bad = 0;
for (const [t, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${t}`); if (!ok) bad++; }
process.exitCode = bad ? 1 : 0;
