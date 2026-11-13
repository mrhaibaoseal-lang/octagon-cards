// Prints one match hand by hand: node prototype/web/deck/trace.js khabib mcgregor 3 [maxHands]
import { data, rngOf } from "./sim.js";
import { createMatch, startHand, commitPlan, endFirstPhase, other, eventText } from "./engine.js";
import { plan, playLive } from "./ai.js";

const [A = "khabib", B = "mcgregor", seed = "1", maxHands = "12"] = process.argv.slice(2);
const state = createMatch(data, A, B, Number(seed));
const rng = rngOf(Number(seed) * 7919 + 13);
const nm = (s) => data.fighters[state[s].id].short;
let hands = 0;
while (!state.over && hands++ < Number(maxHands)) {
  startHand(state);
  const second = other(state.first);
  commitPlan(state, second, plan(state, second, { look: false, rng }));
  const planned = state.plan.actions.map((a) => (a.k === "card" ? data.cards[a.id].name : a.d > 0 ? "上步" : "退步")).join(" > ");
  console.log(`\n== 回合${state.round} 第${state.hand}手  ${data.config.distance.names[state.dist]}  ${state.pos === "ground" ? `地面 上位${nm(state.top)} 控制${state.control}` : "站立"}  先手 ${nm(state.first)}  HP ${state.a.hp}/${state.b.hp}`);
  console.log(`   ${nm(second)} 的計畫: ${planned || "（不動）"}`);
  console.log(`   ${nm(state.first)} 手牌: ${state[state.first].hand[state.pos === "stand" ? "stand" : "ground"].map((id) => data.cards[id].name).join(" ")}`);
  playLive(state, state.first, { look: true, rng });
  endFirstPhase(state, (st, seat) => plan(st, seat, { look: false, rng }));
  for (const e of state.log) {
    const t = eventText(state, e);
    if (t && e.t !== "draw" && e.t !== "hand") console.log("   ·", t);
  }
}
console.log(state.over ? `\n結束：${state.over.winner ? nm(state.over.winner) : "平手"} ${state.over.how}` : "\n（未結束）");
