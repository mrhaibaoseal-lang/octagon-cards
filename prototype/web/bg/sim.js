// One-on-one board battler simulation: same engine, cards and opponent AI as bg.html. node prototype/web/bg/sim.js [bouts per cell]
import { loadData } from "./load.node.js";
import { shoppers, fighters, grounders, runGame } from "./ai.js";

const data = loadData(), N = Number(process.argv[2]) || 200, ids = Object.keys(data.fighters);
const pc = (x) => `${Math.round(x * 100)}%`.padStart(5);
const pairs = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));
function cell(a, b, shop, timing, pick, gpick) {
  const r = { w: 0, ko: 0, koBy: 0, turns: 0, early: 0, grounds: 0 };
  for (let i = 0; i < N; i++) {
    const st = runGame(data, a, b, 300 + i * 7919, shop, timing, pick, gpick), o = st.over;
    if (!o) continue;
    r.turns += st.turn / N;
    r.grounds += st.log.filter((e) => e.t === "ground").length / N;
    if (o.how === "KO" && o.round <= 2) r.early += 1 / N;
    if (o.winner === "a") { r.w += 1 / N; if (o.how === "KO") r.ko += 1 / N; } else if (o.how === "KO") r.koBy += 1 / N;
  }
  return r;
}
console.log(`一對一戰場模擬：每格 ${N} 場；對手用自己的商店 AI 與出手 AI，你這邊預設用同一個出手 AI（滿分）。\n\n一、你這邊各種逛法的勝率（時機條全部失敗）`);
console.log("逛法      " + pairs.map(([a, b]) => `${a.slice(0, 3)}>${b.slice(0, 3)}`.padStart(8)).join("") + "    平均    KO  被KO  前兩回合KO  平均段數");
const avg = {}, extra = {};
for (const [name, shop] of Object.entries(shoppers)) {
  let row = name.padEnd(8), s = { w: 0, ko: 0, koBy: 0, turns: 0, early: 0, grounds: 0 };
  for (const [a, b] of pairs) { const r = cell(a, b, shop); row += pc(r.w).padStart(8); for (const k in s) s[k] += r[k] / pairs.length; }
  avg[name] = s.w; extra[name] = s;
  console.log(`${row}   ${pc(s.w)} ${pc(s.ko)} ${pc(s.koBy)}      ${pc(s.early)}     ${s.turns.toFixed(1)}`);
}
let blind = 0;
for (const [a, b] of pairs) blind += cell(a, b, shoppers.smart, undefined, fighters.blind).w / pairs.length;
console.log(`\n同樣認真逛，但出手不挑（最左邊的牌、隨機目標）　${pc(blind)}`);
let guess = 0;
for (const [a, b] of pairs) guess += cell(a, b, shoppers.smart, undefined, undefined, grounders.guess).w / pairs.length;
console.log(`同樣認真逛，但地面猜拳亂猜（不看對手傾向）　${pc(guess)}　　每場平均 ${extra.smart.grounds.toFixed(1)} 次進地面`);
console.log("\n二、時機條（smart 逛法）");
const tm = {};
for (const g of ["miss", "good", "perfect"]) { let w = 0; for (const [a, b] of pairs) w += cell(a, b, shoppers.smart, () => g).w / pairs.length; tm[g] = w; console.log(`${{ miss: "全部失敗", good: "全部按到好", perfect: "全部完美" }[g]}　${pc(w)}`); }
// Style against style: no fighter powers, both sides shop with the same AI and differ only in the school they favour.
console.log("\n三、流派對打（不帶選手技能，雙方同一個 AI，只差偏好的流派；每組 " + N * 2 + " 場）");
const SCH = ["punch", "kick", "grap"], NAME = { punch: "拳", kick: "腿", grap: "摔" }, sdata = loadData(), style = {};
sdata.fighters = Object.fromEntries(SCH.map((k) => [k, { name: k, short: k, style: k, power: { text: "", fx: [] }, ai: { prefer: k, skill: 1, bias: 5 } }]));
for (const [x, y] of [["kick", "punch"], ["grap", "punch"], ["grap", "kick"]]) {
  let w = 0;
  for (let i = 0; i < N * 2; i++) { const st = runGame(sdata, i % 2 ? x : y, i % 2 ? y : x, 300 + i * 7919, shoppers.smart), o = st.over; if (o && o.winner && st[o.winner].id === x) w += 1 / (N * 2); }
  style[x + y] = w;
  console.log(`${NAME[x]} 對 ${NAME[y]}　${pc(w)}`);
}
console.log("\n四、檢查");
const checks = [
  ["認真逛（smart）對上對手 AI 的勝率在 50%～75%", avg.smart >= 0.5 && avg.smart <= 0.75],
  ["亂買（random）比 smart 低至少 15 個百分點：買什麼有差", avg.smart - avg.random >= 0.15],
  ["出手不挑比自己挑目標低至少 8 個百分點：戰鬥中的選擇有差", avg.smart - blind >= 0.08],
  ["地面讀對手傾向比亂猜高 3～15 個百分點：猜拳有東西可讀，但不是穩贏", avg.smart - guess >= 0.03 && avg.smart - guess <= 0.15],
  ["完全不買（none）勝率 < 5%", avg.none < 0.05],
  ["前兩回合就被 KO 的比例 < 5%：不會一開始就倒", extra.smart.early < 0.05 && extra.random.early < 0.05],
  ["平均打超過 10 段：商店用得到", extra.smart.turns >= 10],
  ["三種流派互打都在 35%～65%：沒有哪一種穩贏", Object.values(style).every((w) => w >= 0.35 && w <= 0.65)],
  ["時機條按到好比全失敗高 2～15 個百分點：有用但不是主角", tm.good - tm.miss >= 0.02 && tm.good - tm.miss <= 0.15],
];
let bad = 0;
for (const [t, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${t}`); if (!ok) bad++; }
process.exitCode = bad ? 1 : 0;
