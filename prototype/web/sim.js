// Balance simulator. Every game runs through the same engine, hands and AI as the real prototype.
// Usage: node prototype/web/sim.js [games] [--gate] [--mode=main]
//   --gate   only the strategy table and the pass conditions (fast)
//   --mode   match length: standard (default) or main
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData, cardCost, createMatch, resolveExchange, resolveFootwork, resolveEngage, applyCorner, chooseAI, chooseFootwork, chooseCombo, choosePlan, chooseReaction, chooseCorner, chooseChase, resolvePending, getIntent, bestGroundCard, budget, nextUnit, opposite, checkInvariants, roleOf, groundWinners, groundOutcome, footworkChoices, previewFootwork, counterCards, comboMax, planError, comboError, reactionOf, cardSpeed } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, "rules", name), "utf8"));
export const data = loadData({ rules: load("rules.json"), cards: load("cards.json"), fighters: load("fighters.json"), depth: load("depth.json"), ground: load("ground.json") });

const ARGS = process.argv.slice(2);
const MODE = (ARGS.find((a) => a.startsWith("--mode=")) || "--mode=standard").slice(7);
const pick = (state, list) => list[Math.floor(nextUnit(state) * list.length)];

// ---------- Player strategies. Each is a set of overrides; anything left out is played by the AI. ----------
// footwork(state, s) -> id        combo(state, s) -> card ids      plan(state, s) -> response
// react(state, s, waiting) -> response or null (a card that was seen coming)      ground(state, s) -> card ids

/** A random move in a lock fight, or a random kind of ground play and then a random card of that kind. */
function randomGround(state, s) {
  const hand = state[s].hand;
  if (state.ground.lock) return [hand[Math.floor(nextUnit(state) * hand.length)]];
  const cats = state.rules.ground.cats;
  const role = roleOf(state, s);
  const kinds = Object.keys(cats).filter((c) => cats[c].side === role && (cats[c].free || hand.some((x) => state.cards[x].cat === c && cardCost(state, s, x) <= budget(state, s))));
  const kind = kinds[Math.floor(nextUnit(state) * kinds.length)];
  if (cats[kind].free) return [];
  const cards = hand.filter((x) => state.cards[x].cat === kind && cardCost(state, s, x) <= budget(state, s));
  return [cards[Math.floor(nextUnit(state) * cards.length)]];
}

function randomFootwork(state, s) {
  return pick(state, footworkChoices(state, s).filter((c) => !c.disabled)).id;
}

function randomCombo(state, s) {
  const max = comboMax(state, s);
  const len = 1 + Math.floor(nextUnit(state) * max);
  const cards = [];
  for (let k = 0; k < len; k++) {
    const options = state[s].hand.filter((c) => !comboError(state, s, [...cards, c]));
    if (!options.length) break;
    cards.push(pick(state, options));
  }
  return cards;
}

function randomPlan(state, s) {
  const options = [{ kind: "guard", height: "high" }, { kind: "guard", height: "mid" }, { kind: "guard", height: "low" }, { kind: "cover" }, { kind: "evade" }, { kind: "shoot" }];
  const strikers = counterCards(state, s);
  if (strikers.length) options.push({ kind: "counter", card: pick(state, strikers) });
  return pick(state, options.filter((p) => !planError(state, s, p)));
}

/** A spam player never changes his mind about one footwork (falling back to holding when the fence shuts it). */
const alwaysFootwork = (id) => ({ footwork: (state, s) => (footworkChoices(state, s).find((c) => c.id === id).disabled ? "hold" : id) });
/** The longest combo he can throw, best card each time, no thought for what the other man does. */
function biggestCombo(state, s) {
  const cards = [];
  for (let k = 0; k < comboMax(state, s); k++) {
    const options = state[s].hand.filter((c) => !comboError(state, s, [...cards, c]));
    if (!options.length) break;
    cards.push(options.reduce((best, c) => ((state.cards[c].power || 0) > (state.cards[best].power || 0) ? c : best)));
  }
  return cards;
}
const alwaysPlan = (plan) => ({ plan: (state, s) => (planError(state, s, plan) ? { kind: "cover" } : plan), react: (state, s) => (planError(state, s, plan, true) ? null : plan) });

/** What a viewer actually sees: with blood in the eyes only the most likely option shows. */
function seen(intent) {
  if (!intent.blind) return intent.probs;
  const ids = Object.keys(intent.probs);
  const rest = (1 - intent.probs[intent.top]) / (ids.length - 1);
  return Object.fromEntries(ids.map((id) => [id, id === intent.top ? intent.probs[id] : rest]));
}

/**
 * The reader picks the footwork whose outcomes look best against the tendencies on screen (a softmax, so he mixes a little as a person does),
 * leads where the guard he sees is weakest, and guards where he expects the shot. It is the same information the screen gives a player.
 */
function readerFootwork(state, s) {
  const choices = footworkChoices(state, s).filter((c) => !c.disabled);
  const shownProbs = seen(getIntent(state, opposite(s)));
  const values = choices.map((c) => {
    const rows = previewFootwork(state, s, c.id);
    let v = 0;
    for (const r of rows) {
      const p = shownProbs[r.his] ?? r.prob;
      const lead = r.pYouLead - 0.5;
      const edges = (r.mine.counterSpeed - r.theirs.counterSpeed) * 0.03 + (r.mine.evade - r.theirs.evade) * 0.6 + (r.theirs.dmgIn - r.mine.dmgIn) * 0.6 + (r.mine.power - r.theirs.power) * 0.5 + (r.mine.crit - r.theirs.crit) * 2;
      const ground = (r.heGivesGround ? 0.1 : 0) - (r.youGiveGround ? 0.1 : 0);
      v += p * (lead * 0.25 + edges + ground);
    }
    return v;
  });
  const t = 0.12;
  const w = values.map((v) => Math.exp((v - Math.max(...values)) / t));
  let r = nextUnit(state) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < choices.length; i++) {
    r -= w[i];
    if (r <= 0) return choices[i].id;
  }
  return choices[choices.length - 1].id;
}

/**
 * Leads the way a careful player would: cards the other man cannot see coming (faster than his reaction) whenever there are any, heights mixed
 * and never the same one twice in a row, the heaviest hidden card last, and a shorter string when the tank is low.
 */
function readerCombo(state, s) {
  const foe = opposite(s);
  const reaction = reactionOf(state, foe);
  const max = comboMax(state, s);
  const want = state[s].stamina < 45 ? Math.min(max, 2) : max;
  const probed = Boolean(state[s].marks.read);
  const answers = probed ? getIntent(state, foe).probs : null;
  const cards = [];
  for (let k = 0; k < want; k++) {
    let options = state[s].hand.filter((c) => !comboError(state, s, [...cards, c]) && !state.cards[c].feint);
    if (k < want - 1) options = options.filter((c) => state.cards[c].height !== "grab");
    const hidden = options.filter((c) => cardSpeed(state, s, c) >= reaction);
    if (hidden.length) options = hidden;
    if (!options.length) break;
    const prev = cards.length ? state.cards[cards[cards.length - 1]].height : null;
    const mixed = options.filter((c) => state.cards[c].height !== prev);
    if (mixed.length) options = mixed;
    const open = (c) => (answers && answers[state.cards[c].height] !== undefined ? 1 - answers[state.cards[c].height] : 0.7);
    const score = (c) => (state.cards[c].power || 4) * open(c) + (k === want - 1 ? (state.cards[c].power || 0) * 0.5 : 0) + nextUnit(state) * 3;
    cards.push(options.reduce((best, c) => (score(c) > score(best) ? c : best)));
    if (state.cards[cards[cards.length - 1]].height === "grab") break;
  }
  return cards.length ? cards : chooseCombo(state, s);
}

function readerPlan(state, s) {
  // Guard where the other man leads most often (what he showed, or what he has done), keep a fast counter for when the footwork favours one.
  const foe = opposite(s);
  const shown = state[s].marks.read ? getIntent(state, foe).probs : null;
  const seen = (state.leadHist?.[foe] || []).slice(-6);
  const weight = (h) => (shown ? shown[h] : (seen.filter((x) => x === h).length + 1) / (seen.length + 3));
  if (state[s].rocked) return { kind: "cover" };
  const bonus = state.engage.mods[s].counterSpeed;
  const strikers = counterCards(state, s).filter((c) => !state.cards[c].counterVs && !state.cards[c].signature);
  if (bonus >= 4 && strikers.length && nextUnit(state) < 0.4) {
    return { kind: "counter", card: strikers.reduce((best, c) => (state.cards[c].speed > state.cards[best].speed ? c : best)) };
  }
  const heights = ["high", "mid", "low"];
  const h = heights.reduce((best, k) => (weight(k) + nextUnit(state) * 0.15 > weight(best) + nextUnit(state) * 0.15 ? k : best));
  return { kind: "guard", height: h };
}

/** On the mat the reader takes the option that comes out ahead most often against the shown tendencies; lock fights use the guess table. */
function groundReader(state, s) {
  const intent = getIntent(state, opposite(s));
  const probs = seen(intent);
  const hand = state[s].hand;
  if (state.ground.lock) {
    const l = state.rules.lock;
    const attacking = state.ground.lock.attacker === s;
    const pickId = Object.keys(probs).reduce((best, id) => (probs[id] > probs[best] ? id : best));
    const mine = attacking ? Object.keys(l.beats).find((k) => l.beats[k] !== pickId) : Object.keys(l.beats).find((k) => k === pickId);
    const move = attacking ? mine : l.beats[pickId];
    return [hand.find((c) => state.cards[c].lockMove === move)];
  }
  const cats = state.rules.ground.cats;
  const role = roleOf(state, s);
  const mineCats = Object.keys(cats).filter((c) => cats[c].side === role);
  let best = mineCats.find((c) => cats[c].free);
  let bestEv = -Infinity;
  for (const c of mineCats) {
    if (!cats[c].free && !hand.some((x) => state.cards[x].cat === c && cardCost(state, s, x) <= budget(state, s))) continue;
    let ev = 0;
    for (const [o, p] of Object.entries(probs)) {
      const out = role === "top" ? groundOutcome(state, c, o) : groundOutcome(state, o, c);
      const mineWins = out === role;
      const theirsWins = out !== "none" && !mineWins;
      ev += p * (mineWins ? 1 : theirsWins ? -1 : 0);
    }
    if (ev > bestEv) {
      bestEv = ev;
      best = c;
    }
  }
  if (cats[best].free) return [];
  const b = budget(state, s);
  let limit = bestEv >= 0.45 ? b : bestEv >= 0.3 ? Math.min(b, 2) : 1;
  if (!state[opposite(s)].rocked) {
    if (state[s].stamina < 30) limit = Math.min(limit, 1);
    else if (state[s].stamina < 50) limit = Math.min(limit, 2);
  }
  const legal = hand.filter((x) => state.cards[x].cat === best).map((x) => cardCost(state, s, x));
  return [bestGroundCard(state, s, best, Math.max(limit, Math.min(...legal)))];
}

export const strategies = {
  "亂出": { footwork: randomFootwork, combo: randomCombo, plan: randomPlan, react: (state, s) => (nextUnit(state) < 0.5 ? null : randomPlan(state, s)), ground: randomGround },
  "只走位：壓上": alwaysFootwork("press"),
  "只走位：守中線": alwaysFootwork("hold"),
  "只走位：繞圈": alwaysFootwork("circle"),
  "只走位：後撤": alwaysFootwork("retreat"),
  "只出最長連段": { combo: biggestCombo },
  "永遠架高": alwaysPlan({ kind: "guard", height: "high" }),
  "永遠抱頭": alwaysPlan({ kind: "cover" }),
  "永遠閃身": alwaysPlan({ kind: "evade" }),
  "永遠抱摔": alwaysPlan({ kind: "shoot" }),
  "看意圖": { footwork: readerFootwork, combo: readerCombo, plan: readerPlan, ground: groundReader },
};
const SPAMS = ["只走位：壓上", "只走位：守中線", "只走位：繞圈", "只走位：後撤", "只出最長連段", "永遠架高", "永遠抱頭", "永遠閃身", "永遠抱摔"];

// ---------- Game loop ----------

/** Plays one hand on his feet through the same calls the screen makes. Returns the events. */
export function playStandingHand(state, strat, stratB = null) {
  const sides = { a: strat, b: stratB };
  const pickFor = (s, key, ai) => (sides[s]?.[key] ? sides[s][key](state, s) : ai(state, s));
  const fa = pickFor("a", "footwork", chooseFootwork);
  const fb = pickFor("b", "footwork", chooseFootwork);
  const events = resolveFootwork(state, fa, fb);
  const L = state.engage.leader;
  const S = opposite(L);
  const combo = pickFor(L, "combo", chooseCombo);
  const plan = pickFor(S, "plan", choosePlan);
  events.push(...resolveEngage(state, combo, plan, (st, w) => (sides[S]?.react ? sides[S].react(st, S, w) : chooseReaction(st, S, w))));
  events.footwork = { a: fa, b: fb };
  return events;
}

export function playGame(idA, idB, stratA, seed, data_ = data, mode = MODE, stratB = null) {
  const state = createMatch(data_, idA, idB, seed, mode);
  let exchanges = 0;
  let groundExchanges = 0;
  let minStamina = 100;
  const counts = {};
  const fw = { a: {}, b: {} };
  while (state.phase !== "over") {
    if (state.phase === "corner") {
      applyCorner(state, { a: chooseCorner(state, "a"), b: chooseCorner(state, "b") });
      continue;
    }
    let events;
    if (state.ground) {
      groundExchanges++;
      const playA = stratA?.ground ? stratA.ground(state, "a") : chooseAI(state, "a").cards;
      const playB = stratB?.ground ? stratB.ground(state, "b") : chooseAI(state, "b").cards;
      events = resolveExchange(state, playA, playB);
    } else {
      events = playStandingHand(state, stratA, stratB);
      for (const s of ["a", "b"]) fw[s][events.footwork[s]] = (fw[s][events.footwork[s]] || 0) + 1;
      if (events.find((e) => e.kind === "lead")?.side === "a") counts.ledA = (counts.ledA || 0) + 1;
      counts.standing = (counts.standing || 0) + 1;
    }
    if (state.pending) events.push(...resolvePending(state, chooseChase(state, state.pending.side)));
    for (const e of events) {
      counts[e.kind] = (counts[e.kind] || 0) + 1;
      if (e.kind === "counter" && e.first) counts.counterFirst = (counts.counterFirst || 0) + 1;
    }
    minStamina = Math.min(minStamina, state.a.stamina);
    exchanges++;
    const errs = checkInvariants(state);
    if (errs.length) throw new Error(`invariant: ${errs.join("; ")} seed ${seed}`);
  }
  return { state, exchanges, groundExchanges, counts, minStamina, fw };
}

function batch(idA, idB, strat, games, seedBase) {
  const r = { win: 0, loss: 0, draw: 0, exch: 0, KO: 0, TKO: 0, SUB: 0, DEC: 0, minStamina: 0, ground: 0, rocked: 0, takedown: 0, signature: 0, lock: 0, cut: 0, doctor: 0, standing: 0, led: 0, block: 0, evade: 0, counterFirst: 0, comboDone: 0, cage: 0, fwA: {}, fwB: {} };
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
    r.standing += g.counts.standing || 0;
    r.led += g.counts.ledA || 0;
    r.block += g.counts.block || 0;
    r.evade += g.counts.evade || 0;
    r.counterFirst += g.counts.counterFirst || 0;
    r.comboDone += g.counts.comboDone || 0;
    r.cage += g.counts.cage || 0;
    for (const s of ["a", "b"]) for (const [k, v] of Object.entries(g.fw[s])) r[s === "a" ? "fwA" : "fwB"][k] = (r[s === "a" ? "fwA" : "fwB"][k] || 0) + v;
  }
  return r;
}

const pct = (n, games) => `${((100 * n) / games).toFixed(0)}%`.padStart(4);
const avg = (n, games) => (n / games).toFixed(1);

function row(label, r, games) {
  return `${label.padEnd(14)} 勝${pct(r.win, games)} 負${pct(r.loss, games)} | KO${pct(r.KO, games)} TKO${pct(r.TKO, games)} 降${pct(r.SUB, games)} 判${pct(r.DEC, games)} | ${avg(r.exch, games)}手 地面${pct(r.ground, r.exch)} 帶頭${pct(r.led, r.standing || 1)} | 暈${avg(r.rocked, games)} 摔${avg(r.takedown, games)} 鎖${avg(r.lock, games)} 招${avg(r.signature, games)} 割${avg(r.cut, games)} 醫${pct(r.doctor, games)} | 防${avg(r.block, games)} 閃${avg(r.evade, games)} 截${avg(r.counterFirst, games)} 連段${avg(r.comboDone, games)} 籠${avg(r.cage, games)} | 最低體力${(r.minStamina / games).toFixed(0)}`;
}

/** Footwork shares as "壓 40% 守 22% 繞 25% 撤 13%". */
function fwShare(fw) {
  const total = Object.values(fw).reduce((a, b) => a + b, 0) || 1;
  return data.rules.footwork.order.map((id) => `${data.rules.footwork.moves[id].short}${pct(fw[id] || 0, total)}`).join(" ");
}
const maxShare = (fw) => Math.max(...Object.values(fw)) / (Object.values(fw).reduce((a, b) => a + b, 0) || 1);

function tables(games) {
  console.log(`
=== AI vs AI 對戰表（各 ${games} 場，列 = A 方）===`);
  const ids = Object.keys(data.fighters).filter((id) => !data.fighters[id].hidden);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const r = batch(a, b, null, games, 5000);
      console.log(row(`${a} vs ${b}`, r, games) + ` | 走位 ${fwShare(r.fwA)}`);
    }
  }
  console.log(`
=== 玩家看意圖打真實選手（各 ${games} 場）===`);
  for (const a of ids) {
    for (const b of ids) {
      console.log(row(`${a} vs ${b}`, batch(a, b, strategies["看意圖"], games, 9000), games));
    }
  }
}

function main() {
  const games = Number(ARGS.find((a) => /^\d+$/.test(a))) || 2000;
  console.log(`=== 打法勝率（同屬性 測試選手 vs 測試選手 AI，各 ${games} 場，${MODE}）===`);
  const results = {};
  for (const [name, strat] of Object.entries(strategies)) {
    results[name] = batch("neutral", "neutral", strat, games, 1000);
    console.log(row(name, results[name], games) + ` | 走位 ${fwShare(results[name].fwA)}`);
  }
  const base = batch("neutral", "neutral", null, games, 1000);
  console.log(`${"AI 自己".padEnd(14)} 走位 ${fwShare(base.fwA)}（對 AI 勝 ${pct(base.win, games)}）`);
  if (!ARGS.includes("--gate")) tables(games);
  const win = (n) => (100 * results[n].win) / games;
  const worstSpam = Math.max(...SPAMS.map(win));
  const worstName = SPAMS.find((n) => win(n) === worstSpam);
  const readerShare = maxShare(results["看意圖"].fwA);
  const aiShare = maxShare(base.fwA);
  console.log("\n=== M1.4a 通過條件 ===");
  console.log(`看意圖 ≥ 60%（暫定；舊的三角相剋是 75%）：${win("看意圖").toFixed(1)}%，AI 鏡像 ${((100 * base.win) / games).toFixed(1)}% ${win("看意圖") >= 60 ? "通過" : "未通過"}`);
  console.log(`亂出 < 50%：${win("亂出").toFixed(1)}% ${win("亂出") < 50 ? "通過" : "未通過"}`);
  console.log(`單一打法 ≤ 55%（最高：${worstName}）：${worstSpam.toFixed(1)}% ${worstSpam <= 55 ? "通過" : "未通過"}`);
  console.log(`單一走位使用率 ≤ 55%（看意圖的人 ${(100 * readerShare).toFixed(0)}%、AI ${(100 * aiShare).toFixed(0)}%）：${readerShare <= 0.55 && aiShare <= 0.55 ? "通過" : "未通過"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
