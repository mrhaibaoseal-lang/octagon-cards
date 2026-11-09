// Simulation for the card bout: the same engine and AI as the browser.
// node prototype/web/bout/sim.js [fightsPerPairing]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBout, playBeat, settleKnockdown, settleSub, checkInvariants, prepare, doCorner, setPlan, PLANS, SIDES } from "./engine.js";
import { createAI, createMasher, createFixedPlan } from "./ai.js";

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

/** Corner (from round 2 on) and then both plans, exactly as the browser does it. Returns the corner reports. */
export function beginRound(st, A, B) {
  const brains = { a: A, b: B };
  const info = { a: null, b: null };
  if (st.round > 0) for (const s of SIDES) info[s] = doCorner(st, s, brains[s].corner ? brains[s].corner(st) : ["coach", "rest"]);
  for (const s of SIDES) {
    const p = brains[s].plan ? brains[s].plan(st, info[s]) : { plan: "steady", target: null };
    setPlan(st, s, p.plan, p.target);
  }
  return info;
}

/** brainA/brainB: (data, side, rng) => { think(st), chase(st), corner(st), plan(st, info) } */
export function fight(idA, idB, seed, brainA = createAI, brainB = brainA, d = data, setup = null) {
  const st = createBout(d, idA, idB, seed);
  if (setup) setup(st);
  const ra = rngOf(seed * 7 + 1);
  const rb = rngOf(seed * 13 + 5);
  const A = brainA(d, "a", ra);
  const B = brainB(d, "b", rb);
  let beats = 0;
  const stats = { knockdowns: 0, whiffRange: 0, attacks: 0, hits: 0, plans: {}, groundBeats: 0, tdTried: 0, tdOk: 0, subLocks: 0, groundPounds: 0, clean: 0, stuns: 0, botTry: 0, botOk: 0 };
  let planned = -1;
  while (!st.over && beats < 400) {
    if (st.beat === 0 && planned !== st.round) {
      planned = st.round;
      beginRound(st, A, B);
      for (const s of SIDES) stats.plans[st.plan[s].plan] = (stats.plans[st.plan[s].plan] || 0) + 1;
    }
    if (st.mode === "ground") stats.groundBeats++;
    const ev = playBeat(st, A.think(st), B.think(st));
    for (const e of ev) {
      if (e.t === "attack") { stats.attacks++; if (e.hit) stats.hits++; if (e.quality === "clean") stats.clean++; if (e.stun) stats.stuns++; if (e.whiff === "range") stats.whiffRange++; }
      if (e.t === "takedown") { stats.tdTried++; if (e.ok) stats.tdOk++; }
      if (e.t === "gattack" && e.hit) stats.groundPounds++;
      if (e.t === "subLock") stats.subLocks++;
      if ((e.t === "gtry" || e.t === "gattack") && st.lastActs?.[e.by]?.role === "bottom" && e.p != null) { stats.botTry++; if (e.ok || e.hit) stats.botOk++; }
    }
    if (st.subPending) settleSub(st);
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
  let beats = 0, finish = 0, r1 = 0, kd = 0, atk = 0, hit = 0, whiff = 0, gb = 0, tdT = 0, tdO = 0, sl = 0, sub = 0, gtko = 0, cl = 0, stn = 0, bt = 0, bo = 0;
  for (const r of results) {
    const o = r.st.over;
    wins[o.winner ?? "draw"]++;
    beats += r.beats;
    const fin = !o.cards;
    if (fin) finish++;
    if (fin && o.round === 1) r1++;
    kd += r.stats.knockdowns;
    atk += r.stats.attacks; hit += r.stats.hits; whiff += r.stats.whiffRange;
    cl += r.stats.clean; stn += r.stats.stuns; bt += r.stats.botTry; bo += r.stats.botOk;
    gb += r.stats.groundBeats; tdT += r.stats.tdTried; tdO += r.stats.tdOk; sl += r.stats.subLocks;
    if (o.method.startsWith("降伏")) sub++;
    if (o.method.startsWith("TKO（地面")) gtko++;
  }
  const pct = (x) => `${Math.round((100 * x) / n)}%`;
  console.log(`${label.padEnd(34)} A ${pct(wins.a)}  B ${pct(wins.b)}  平 ${pct(wins.draw)} | 平均 ${(beats / n).toFixed(1)} 手 | 終結 ${pct(finish)}（R1 ${pct(r1)}）判定 ${pct(n - finish)} | 倒地 ${(kd / n).toFixed(2)}/場 | 命中 ${Math.round((100 * hit) / atk)}% 打實佔命中 ${Math.round((100 * cl) / Math.max(1, hit))}% 打晃 ${(stn / n).toFixed(1)}/場 距離落空 ${Math.round((100 * whiff) / atk)}%`);
  if (gb || tdT) console.log(`${"".padEnd(34)} 地面：佔 ${Math.round((100 * gb) / beats)}% 手 | 摔 ${(tdT / n).toFixed(1)} 次試／${(tdO / n).toFixed(1)} 次成功 | 鎖技 ${(sl / n).toFixed(2)}/場 | 降伏結束 ${pct(sub)} 地面TKO ${pct(gtko)} | 下位出手成功 ${Math.round((100 * bo) / Math.max(1, bt))}%`);
  return { wins, n, beats };
}

/**
 * Do the plans and target parts carry real decisions? Every line is "A's win rate" over four pairings
 * (Holloway/Poirier both ways and both mirrors). Pass: no fixed plan far above 50% against steady+head,
 * and the thinking computer beats every fixed choice (otherwise choosing well is worth nothing).
 */
function planTable(N) {
  const ids = ["holloway", "poirier"];
  const vs = (label, mkA, mkB) => {
    let w = 0, n = 0;
    for (const [x, y] of [[ids[0], ids[1]], [ids[1], ids[0]], [ids[0], ids[0]], [ids[1], ids[1]]]) {
      for (let i = 0; i < N; i++) {
        const o = fight(x, y, 41000 + i, mkA, mkB).st.over.winner;
        n++;
        w += o === "a" ? 1 : o ? 0 : 0.5;
      }
    }
    console.log(`${label.padEnd(34)} ${Math.round((100 * w) / n)}%`);
  };
  const F = (p, t) => (d, s, r) => createFixedPlan(d, s, r, p, t);
  console.log("A 的勝率（越接近 50% 越表示兩邊的選擇一樣好）：");
  for (const p of PLANS(data)) vs(`固定${p}+頭 對 steady+頭`, F(p, "head"), F("steady", "head"));
  vs("steady+身 對 steady+頭", F("steady", "body"), F("steady", "head"));
  vs("steady+腿 對 steady+頭", F("steady", "leg"), F("steady", "head"));
  vs("steady+無 對 steady+頭", F("steady", null), F("steady", "head"));
  vs("會想的電腦 對 steady+頭", createAI, F("steady", "head"));
  vs("會想的電腦 對 steady+無", createAI, F("steady", null));
  vs("會想的電腦 對 burst+頭", createAI, F("burst", "head"));
  vs("會想的電腦 對 counter+頭", createAI, F("counter", "head"));
  vs("會想的電腦 對 pressure+頭", createAI, F("pressure", "head"));
  vs("會想的電腦 對 probe+頭", createAI, F("probe", "head"));
}

/**
 * A plan should be the better choice in the situation it is made for. Each line starts a bout at round 2
 * with a staged situation; A plays the plan, B plays "steady"; both use the same thinking computer otherwise.
 * Pass: every plan is clearly above 50% in its own situation.
 */
function nicheTable(N) {
  const ids = ["holloway", "poirier"];
  const staged = (mutate) => (st) => {
    st.round = 1;
    st.rounds = [{ round: 1, dealt: { a: 0, b: 0 }, kd: { a: 0, b: 0 }, landed: { a: 0, b: 0 }, mix: { a: { ...st.a.rhist }, b: { ...st.b.rhist } }, plan: { a: "steady", b: "steady" } }];
    mutate(st);
  };
  const body = (st, s, ratio) => { st[s].body = ratio * ((st.data.config.stamina.max - st.data.config.stamina.min) / st.data.config.body.maxLoss); st[s].staminaMax = Math.max(st.data.config.stamina.min, st.data.config.stamina.max - st[s].body * st.data.config.body.maxLoss); };
  const head = (st, s, ratio) => { st[s].head = ratio * st.data.fighters[st[s].id].chin; };
  const cases = [
    ["probe 對 steady（我很累）", "probe", (st) => { st.a.stamina = 1.5; }],
    ["pressure 對 steady（他很累）", "pressure", (st) => { st.b.stamina = 3; }],
    ["burst 對 steady（他頭傷 70%）", "burst", (st) => head(st, "b", 0.7)],
    ["counter 對 steady（我頭傷 60%）", "counter", (st) => head(st, "a", 0.6)],
    ["steady+腿 對 steady+頭（他腿傷 60%）", "steady", (st) => { st.b.leg = 0.6 * st.data.config.leg.limp; }, "leg"],
    ["steady+身 對 steady+頭（他身傷 60%）", "steady", (st) => body(st, "b", 0.6), "body"],
    ["steady+頭 對 steady+頭（他頭傷 60%）", "steady", (st) => head(st, "b", 0.6), "head"],
  ];
  const F = (p, t) => (d, s, r) => createFixedPlan(d, s, r, p, t);
  for (const [label, plan, mutate, target = "head"] of cases) {
    let w = 0, n = 0;
    for (const [x, y] of [[ids[0], ids[1]], [ids[1], ids[0]], [ids[0], ids[0]], [ids[1], ids[1]]]) {
      for (let i = 0; i < N; i++) {
        const o = fight(x, y, 61000 + i, F(plan, target), F("steady", "head"), data, staged(mutate)).st.over.winner;
        n++;
        w += o === "a" ? 1 : o ? 0 : 0.5;
      }
    }
    console.log(`${label.padEnd(34)} ${Math.round((100 * w) / n)}%`);
  }
}

/**
 * The ground game: each pairing of the three styles with the thinking computer on both sides (sides swapped),
 * and each style against the masher. Pass: no style wins everything, the wrestler goes to the ground often and the
 * strikers rarely, and skill still beats mashing on the ground.
 */
function groundTable(N) {
  const ids = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
  const swap = (rs) => rs.map((r) => ({ ...r, st: { ...r.st, over: { ...r.st.over, winner: r.st.over.winner === "a" ? "b" : r.st.over.winner === "b" ? "a" : null } } }));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const x = Array.from({ length: N }, (_, k) => fight(ids[i], ids[j], 3000 + k));
      const y = swap(Array.from({ length: N }, (_, k) => fight(ids[j], ids[i], 7000 + k)));
      summarize(`${ids[i]} vs ${ids[j]}`, [...x, ...y]);
    }
    const m = Array.from({ length: N }, (_, k) => fight(ids[i], ids[i], 11000 + k, createAI, createMasher));
    summarize(`${ids[i]}(AI) vs 亂按`, m);
  }
}

if (process.argv[1] && process.argv[1].endsWith("sim.js")) {
  const N = Number(process.argv[2]) || 100;
  if (process.argv[3] === "ground") {
    groundTable(N);
    process.exit(0);
  }
  if (process.argv[3] === "plans") {
    planTable(N);
    process.exit(0);
  }
  if (process.argv[3] === "niches") {
    nicheTable(N);
    process.exit(0);
  }
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
