// V2 simulation: the same engine, decks and intent AI as the game; bots answer for the player side.
// node prototype/web/v2/sim.js [bouts per cell]
import { loadData } from "./load.node.js";
import { bots, runBout } from "./ai.js";

const data = loadData();
const N = Number(process.argv[2]) || 400;
const ids = Object.keys(data.fighters);
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);

function cell(aId, bId, bot) {
  const r = { win: 0, lose: 0, draw: 0, ko: 0, koBy: 0, dec: 0, exs: 0, acts: 0, td: 0, rocked: 0, gasEnd: 0 };
  for (let i = 0; i < N; i++) {
    const st = runBout(data, aId, bId, 1000 + i * 7919, bot);
    const o = st.over;
    if (!o) continue;
    if (o.winner === "a") r.win++; else if (o.winner === "b") r.lose++; else r.draw++;
    if (o.how === "DEC") r.dec++; else if (o.winner === "a") r.ko++; else r.koBy++;
    r.exs += st.meta.exs; r.acts += st.meta.acts; r.td += st.a.stats.td + st.b.stats.td; r.rocked += st.a.stats.rocked + st.b.stats.rocked; r.gasEnd += st.a.gas;
  }
  return r;
}

console.log(`V2 模擬：每格 ${N} 場。玩家方（a）由機器人回應，對手（b）用遊戲裡同一個意圖 AI。\n`);
console.log("一、各種打法的勝率（三位選手互打平均）");
console.log("打法      勝    敗    平   終結  被終結  判定  每段出牌  每場段數  打晃/場  抱摔/場  賽後體力");
const summary = {};
for (const [name, bot] of Object.entries(bots)) {
  const t = { win: 0, lose: 0, draw: 0, ko: 0, koBy: 0, dec: 0, exs: 0, acts: 0, td: 0, rocked: 0, gasEnd: 0 };
  let n = 0;
  for (const a of ids) for (const b of ids) { if (a === b) continue; const r = cell(a, b, bot); for (const k in t) t[k] += r[k]; n += N; }
  summary[name] = t.win / n;
  console.log(`${name.padEnd(8)}${pct(t.win / n)}  ${pct(t.lose / n)}  ${pct(t.draw / n)}  ${pct(t.ko / n)}   ${pct(t.koBy / n)}   ${pct(t.dec / n)}   ${(t.acts / t.exs).toFixed(2).padStart(6)}   ${(t.exs / n).toFixed(1).padStart(6)}   ${(t.rocked / n).toFixed(2).padStart(5)}   ${(t.td / n).toFixed(2).padStart(5)}   ${(t.gasEnd / n).toFixed(1).padStart(6)}`);
}

console.log("\n二、對戰表（smart 回應）：列＝玩家，欄＝對手，數字＝玩家勝率");
console.log("            " + ids.map((x) => x.padEnd(11)).join(""));
for (const a of ids) {
  let row = a.padEnd(12);
  for (const b of ids) row += (a === b ? "  —" : pct(cell(a, b, bots.smart).win / N)).padEnd(11);
  console.log(row);
}

console.log("\n三、通過條件");
const checks = [
  ["會讀意圖的打法（smart）勝率最高", Object.entries(summary).every(([k, v]) => k === "smart" || summary.smart > v)],
  ["完全不防守（nodef）比 smart 低至少 8 個百分點：防守有用", summary.smart - summary.nodef >= 0.08],
  ["不用步法、只會貼上去（nomove）比 smart 低至少 8 個百分點：移動有用", summary.smart - summary.nomove >= 0.08],
  ["亂出牌（random）勝率 < 35%", summary.random < 0.35],
  ["只防守（turtle）勝率 < 35%", summary.turtle < 0.35],
  ["無腦全攻（allout）勝率低於 smart 至少 10 個百分點", summary.smart - summary.allout >= 0.1],
  ["smart 勝率在 50%～80%（對手不是沙包也不是打不贏）", summary.smart >= 0.5 && summary.smart <= 0.8],
];
let bad = 0;
for (const [t, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${t}`); if (!ok) bad++; }
process.exitCode = bad ? 1 : 0;
