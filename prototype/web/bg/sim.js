// Battlegrounds-mode simulation: same engine, skills and opponent builds as bg.html. node prototype/web/bg/sim.js [bouts per cell]
import { loadData } from "./load.node.js";
import { shoppers, runGame } from "./ai.js";

const data = loadData(), N = Number(process.argv[2]) || 200, ids = Object.keys(data.fighters);
const pc = (x) => `${Math.round(x * 100)}%`.padStart(5);
const pairs = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));
function cell(a, b, shop, timing) {
  const r = { w: 0, fin: 0, finBy: 0, rounds: 0 };
  for (let i = 0; i < N; i++) {
    const st = runGame(data, a, b, 300 + i * 7919, shop, timing), o = st.over;
    r.rounds += o.round / N;
    if (o.winner === "a") { r.w += 1 / N; if (o.how !== "DEC") r.fin += 1 / N; } else if (o.how !== "DEC") r.finBy += 1 / N;
  }
  return r;
}
console.log(`戰場式模擬：每格 ${N} 場。\n\n一、各種逛商店方式的勝率（時機條全部失敗）`);
console.log("方式      " + pairs.map(([a, b]) => `${a.slice(0, 3)}>${b.slice(0, 3)}`.padStart(8)).join("") + "    平均   終結  被終結  平均回合");
const avg = {};
for (const [name, shop] of Object.entries(shoppers)) {
  let row = name.padEnd(8), s = { w: 0, fin: 0, finBy: 0, rounds: 0 };
  for (const [a, b] of pairs) { const r = cell(a, b, shop); row += pc(r.w).padStart(8); for (const k in s) s[k] += r[k] / pairs.length; }
  avg[name] = s.w;
  console.log(`${row}   ${pc(s.w)}  ${pc(s.fin)}  ${pc(s.finBy)}   ${s.rounds.toFixed(1)}`);
}
console.log("\n二、時機條（smart 逛法）");
const tm = {};
for (const g of ["miss", "good", "perfect"]) { let w = 0; for (const [a, b] of pairs) w += cell(a, b, shoppers.smart, () => g).w / pairs.length; tm[g] = w; console.log(`${{ miss: "全部失敗", good: "全部按到好", perfect: "全部完美" }[g]}　${pc(w)}`); }
console.log("\n三、檢查");
const checks = [
  ["會挑會排的逛法（smart）在 45%～75%", avg.smart >= 0.45 && avg.smart <= 0.75],
  ["亂買（random）比 smart 低至少 8 個百分點：買什麼、怎麼排有差", avg.smart - avg.random >= 0.08],
  ["完全不買（none）勝率 < 20%：不構築就打不贏", avg.none < 0.2],
  ["時機條按到好比全失敗高 3～20 個百分點：有用但不是主角", tm.good - tm.miss >= 0.03 && tm.good - tm.miss <= 0.2],
];
let bad = 0;
for (const [t, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${t}`); if (!ok) bad++; }
process.exitCode = bad ? 1 : 0;
