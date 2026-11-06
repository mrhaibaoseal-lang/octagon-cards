// Octagon Cards combat engine. Pure rules: no DOM, no timers, runs in browsers and Node.
// All numbers live in rules/*.json. Spec: docs/GAME_DESIGN.md.

const SIDES = ["a", "b"];
const TYPES = ["S", "G", "C"];
const MASK = (1n << 64n) - 1n;

export const opposite = (side) => (side === "a" ? "b" : "a");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- RNG (SplitMix64, same sequence as the Swift SeededRNG) ----------

export function nextUnit(state) {
  state.rng = (state.rng + 0x9e3779b97f4a7c15n) & MASK;
  let z = state.rng;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  z = z ^ (z >> 31n);
  return Number(z >> 11n) * 2 ** -53;
}

function shuffle(state, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(nextUnit(state) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------- Setup ----------

export function createMatch(data, idA, idB, seed = 1) {
  const state = {
    rules: data.rules,
    cards: data.cards,
    fighters: data.fighters,
    rng: BigInt.asUintN(64, BigInt(seed)),
    seed,
    range: "out",
    ground: null,
    round: 1,
    exchange: 1,
    stall: 0,
    phase: "exchange", // exchange | corner | over
    over: null,
    a: makeSide(data, idA),
    b: makeSide(data, idB),
    history: [],
    roundCards: [],
    roundScore: freshScore(),
    log: [],
  };
  for (const s of SIDES) {
    shuffle(state, state[s].draw);
    refillHand(state, s);
  }
  return state;
}

function makeSide(data, id) {
  const f = data.fighters[id];
  return {
    id,
    name: f.short,
    attrs: f.attrs,
    hp: data.rules.match.maxHp,
    stamina: data.rules.match.maxStamina,
    momentum: 0,
    rocked: false,
    pips: { head: 0, body: 0, legs: 0 },
    draw: [...f.deck],
    discard: [],
    hand: [],
  };
}

const freshScore = () => ({ a: { striking: 0, grappling: 0 }, b: { striking: 0, grappling: 0 } });

// ---------- Hand ----------

function drawOne(state, s) {
  const me = state[s];
  if (me.draw.length === 0) {
    me.draw = shuffle(state, me.discard);
    me.discard = [];
  }
  return me.draw.pop();
}

function refillHand(state, s) {
  const me = state[s];
  const size = state.rules.match.handSize;
  const sig = state.fighters[me.id].signature;
  me.hand = me.hand.filter((c) => c !== sig);
  while (me.hand.length < size && me.draw.length + me.discard.length > 0) me.hand.push(drawOne(state, s));
  // A hand always holds all three types, so every read can be acted on.
  for (const t of TYPES) {
    if (me.hand.some((c) => state.cards[c].type === t)) continue;
    let pool = me.draw;
    let idx = pool.findIndex((c) => state.cards[c].type === t);
    if (idx < 0) {
      pool = me.discard;
      idx = pool.findIndex((c) => state.cards[c].type === t);
    }
    if (idx < 0) continue;
    const counts = {};
    for (const c of me.hand) counts[state.cards[c].type] = (counts[state.cards[c].type] || 0) + 1;
    const swapAt = me.hand.findIndex((c) => counts[state.cards[c].type] > 1);
    if (swapAt < 0) continue;
    const taken = pool.splice(idx, 1)[0];
    pool.unshift(me.hand[swapAt]);
    me.hand[swapAt] = taken;
  }
  if (me.momentum >= state.rules.momentum.signatureCost) me.hand.push(sig);
}

// ---------- Queries used by AI, simulator and UI ----------

export function budget(state, s) {
  const e = state.rules.energy;
  const me = state[s];
  if (me.rocked) return e.rockedBudget;
  let b = e.base;
  if (me.stamina < e.gassedAt) b = 1;
  else if (me.stamina < e.tiredAt) b = 2;
  if (state[opposite(s)].rocked) b += e.swarmBonus;
  return b;
}

export const phaseOf = (state, s) => (state.ground ? (state.ground.top === s ? "top" : "bottom") : state.range);
const costOf = (state, cards) => cards.reduce((sum, c) => sum + state.cards[c].cost, 0);
const typeOfPlay = (state, cards) => (cards.length ? state.cards[cards[0]].type : "C");

/** Returns an error string, or null when the play is legal. An empty play means bracing (free, counts as defend). */
export function playError(state, s, cards) {
  if (cards.length === 0) return null;
  const counts = {};
  for (const c of state[s].hand) counts[c] = (counts[c] || 0) + 1;
  for (const c of cards) {
    if (!counts[c]) return "not in hand";
    counts[c]--;
  }
  if (new Set(cards.map((c) => state.cards[c].type)).size > 1) return "mixed types";
  if (costOf(state, cards) > budget(state, s)) return "over budget";
  return null;
}

function offRange(state, card) {
  return !state.ground && card.range !== "any" && card.range !== state.range;
}

function tierOdds(state, s, cards) {
  const t = state.rules.tiers;
  const me = state[s];
  const opp = state[opposite(s)];
  const type = typeOfPlay(state, cards);
  let diff;
  if (type === "G") diff = (state.ground && state.ground.top !== s ? (me.attrs.wrestling + me.attrs.submission) / 2 : me.attrs.wrestling) - opp.attrs.grappleDef;
  else diff = me.attrs.accuracy - opp.attrs.accuracy;
  let bonus = 0;
  for (const c of cards) {
    const card = state.cards[c];
    bonus += card.crit || 0;
    bonus += card.quality || 0;
    if (type === "G" && offRange(state, card)) bonus -= state.rules.grapple.offRangeQuality;
  }
  return {
    crit: clamp(t.baseCrit + bonus + diff * t.critPerStat, t.minCrit, t.maxCrit),
    graze: clamp(t.baseGraze - bonus - diff * t.grazePerStat, t.minGraze, t.maxGraze),
  };
}

function rollTier(state, s, cards) {
  const odds = tierOdds(state, s, cards);
  const r = nextUnit(state);
  if (r < odds.crit) return "crit";
  if (r < odds.crit + odds.graze) return "graze";
  return "clean";
}

function powerMult(state, side) {
  const d = state.rules.damage;
  const me = state[side];
  const tired = me.stamina < state.rules.energy.tiredAt ? state.rules.stamina.tiredDamageMult : 1;
  return (d.powerBase + me.attrs.power * d.powerPerStat) * tired;
}

/** Damage of one card before tier and situation multipliers. */
function cardDamage(state, side, cardId) {
  const card = state.cards[cardId];
  let dmg = (card.power || 0) * powerMult(state, side);
  if (offRange(state, card)) dmg *= state.rules.damage.offRangeMult;
  if (card.kick && state[side].pips.legs >= state.rules.debuff.threshold) dmg *= state.rules.debuff.legKickMult;
  return dmg;
}

/** What the UI shows before committing: clean-hit damage and tier chances. */
export function previewPlay(state, s, cards) {
  const type = typeOfPlay(state, cards.length ? cards : ["brace"]);
  const list = cards.length ? cards : ["brace"];
  const odds = tierOdds(state, s, list);
  const base = list.reduce((sum, c) => sum + cardDamage(state, s, c), 0);
  const d = state.rules.damage;
  let winMult = type === "S" ? d.winStrikeBonus : d.counterMult;
  if (state.ground) winMult *= state.ground.top === s ? d.groundPositionMult[state.ground.pos] : d.bottomStrikeMult;
  return {
    type,
    cost: costOf(state, cards),
    damage: Math.round(base * winMult * (state[opposite(s)].rocked ? d.swarmMult : 1)),
    critPct: Math.round(odds.crit * 100),
    grazePct: Math.round(odds.graze * 100),
    budget: budget(state, s),
  };
}

export function lockTapChance(state) {
  const lock = state.ground?.lock;
  if (!lock) return 0;
  const l = state.rules.lock;
  const atk = state[lock.attacker];
  const def = state[opposite(lock.attacker)];
  const defSkill = (def.attrs.submission + def.attrs.grappleDef) / 2;
  let p = l.tapBase + (atk.attrs.submission - defSkill) * l.tapPerStat + (lock.depth - 1) * l.tapDepthBonus;
  if (def.stamina < l.lowStaminaAt) p += l.lowStaminaBonus;
  return clamp(p, l.min, l.max);
}

/** How a card reads right now: the action name and a one-line effect. */
export function describeCard(state, s, cardId) {
  const card = state.cards[cardId];
  const g = state.ground;
  const role = g ? (g.top === s ? "top" : "bottom") : null;
  const dmg = Math.round(cardDamage(state, s, cardId) * (card.type === "S" ? state.rules.damage.winStrikeBonus : state.rules.damage.counterMult));
  let action = "";
  let effect = "";
  if (g?.lock) {
    action = state.rules.typeNames[card.type];
    effect = g.lock.attacker === s ? "贏了逼他拍墊" : "贏了就掙脫";
  } else if (g) {
    action = state.rules.groundLabels[role][card.type];
    if (card.type === "S") effect = `傷害 ${dmg}`;
    else if (card.type === "G") {
      if (role === "top") effect = card.lockTop && g.pos >= state.rules.lock.minTopPosition ? `鎖技：${card.name}` : "前進一個位置";
      else effect = "脫離或翻身";
    } else if (role === "bottom" && card.lockBottom) effect = `鎖技：${card.name}`;
    else effect = role === "top" ? "化解蹬踢" : "抓他砸拳";
  } else if (card.type === "S") effect = `傷害 ${dmg}`;
  else if (card.type === "C") effect = card.power ? `反擊 ${dmg}` : "硬撐";
  else if (card.clinchOnly) effect = "貼身入內";
  else if (card.pullGuard) effect = "拉進地面，你在下位";
  else effect = `摔倒 → ${state.rules.positions[card.landing || 0]}`;
  const off = offRange(state, card);
  return { action, effect, offRange: off };
}

// ---------- AI ----------

const beaterOf = (triangle, t) => TYPES.find((x) => triangle[x] === t);

function typeAvailable(state, s, type) {
  if (type === "C") return true; // bracing is always possible
  const b = budget(state, s);
  return state[s].hand.some((c) => state.cards[c].type === type && state.cards[c].cost <= b);
}

/** The opponent's honest tendencies. The UI shows these same numbers and chooseAI samples from them. */
export function getIntent(state, s) {
  const ai = state.rules.ai;
  const me = state[s];
  const oppSide = opposite(s);
  const style = state.fighters[me.id].style[phaseOf(state, s)];
  const w = { S: style.S, G: style.G, C: style.C };
  const tags = [];

  const recent = state.history.slice(-ai.adapt.window).map((h) => h[oppSide]);
  for (const t of recent) w[beaterOf(state.rules.triangle, t)] += ai.adapt.perMatch;
  if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
    w[beaterOf(state.rules.triangle, recent[recent.length - 1])] += ai.adapt.repeatBonus;
    tags.push("看穿你的習慣");
  }
  if (me.rocked) { w.C += ai.rockedCounter; tags.push("被打暈，想撐過去"); }
  if (state[oppSide].rocked) { w.S += ai.swarmStrike; tags.push("要衝上來追擊"); }
  if (me.stamina < ai.lowStaminaAt) { w.C += ai.lowStaminaCounter; tags.push("快沒力了"); }

  for (const t of TYPES) {
    if (!typeAvailable(state, s, t)) w[t] = 0;
    else w[t] = Math.max(w[t], ai.minWeight);
  }
  const total = w.S + w.G + w.C;
  const probs = { S: w.S / total, G: w.G / total, C: w.C / total };
  const top = TYPES.reduce((best, t) => (probs[t] > probs[best] ? t : best), "S");
  const tells = ai.tells[top];
  return {
    probs,
    top,
    tell: tells[(state.round * 7 + state.exchange * 3) % tells.length],
    tags,
    signatureReady: me.hand.includes(state.fighters[me.id].signature),
  };
}

function cardValue(state, s, cardId) {
  const card = state.cards[cardId];
  if (card.type === "G") {
    const g = state.ground;
    let v = card.cost + (card.quality || 0) * 4 + (card.landing || 0);
    if (offRange(state, card)) v -= 1.5;
    if (g && g.top === s && card.lockTop && g.pos >= state.rules.lock.minTopPosition) v += 3;
    if (!g && card.clinchOnly && state.range === "in") v -= 2;
    return v;
  }
  let v = cardDamage(state, s, cardId);
  const g = state.ground;
  if (card.type === "C" && g && g.top !== s && card.lockBottom) v += 8;
  if (card.signature) v += 10;
  return v;
}

/** Highest-value set of `type` cards within `limit` energy. Empty result means bracing. */
export function bestPlay(state, s, type, limit) {
  const hand = state[s].hand.filter((c) => state.cards[c].type === type && state.cards[c].cost <= limit);
  let best = [];
  let bestValue = 0;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let cost = 0;
    let value = 0;
    const cards = [];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      cost += state.cards[hand[i]].cost;
      value += cardValue(state, s, hand[i]);
      cards.push(hand[i]);
    }
    if (cost <= limit && value > bestValue) {
      bestValue = value;
      best = cards;
    }
  }
  return best;
}

function sampleType(state, probs) {
  const r = nextUnit(state);
  if (r < probs.S) return "S";
  if (r < probs.S + probs.G) return "G";
  return "C";
}

export function chooseAI(state, s) {
  const ai = state.rules.ai;
  const me = state[s];
  const intent = getIntent(state, s);
  const type = sampleType(state, intent.probs);
  const b = budget(state, s);
  let limit = nextUnit(state) < ai.commit.fullChance ? b : Math.max(1, b - 1);
  if (me.stamina < ai.commit.conserveAt) limit = Math.min(limit, 2);
  const sig = state.fighters[me.id].signature;
  if (me.hand.includes(sig) && state.cards[sig].type === type && state.cards[sig].cost <= b && nextUnit(state) < ai.signatureWeight + 0.4) {
    return { cards: [sig] };
  }
  return { cards: bestPlay(state, s, type, limit) };
}

export function chooseCorner(state, s) {
  const me = state[s];
  if (me.stamina < 45) return "breathe";
  if (me.hp < 45) return "patch";
  return "fire";
}

// ---------- Exchange ----------

function addStamina(state, s, delta) {
  state[s].stamina = clamp(state[s].stamina + delta, 0, state.rules.match.maxStamina);
}
function addMomentum(state, s, delta) {
  state[s].momentum = clamp(state[s].momentum + delta, 0, state.rules.match.maxMomentum);
}
function score(state, s, kind, amount) {
  state.roundScore[s][kind] += amount;
}

function finish(state, winner, method, events) {
  if (state.over) return;
  state.over = { winner, method, round: state.round, exchange: state.exchange };
  state.phase = "over";
  events.push({ kind: "finish", winner, method });
}

/** Lands a set of cards. One tier applies to the whole set. Returns true if the fight ended. */
function dealHit(state, att, cards, tier, mult, events) {
  const def = opposite(att);
  const t = state.rules.tiers;
  const tierMult = tier === "crit" ? t.critMult : tier === "graze" ? t.grazeMult : t.cleanMult;
  const wasRocked = state[def].rocked;
  const swarm = wasRocked ? state.rules.damage.swarmMult : 1;
  let headDamage = 0;
  let lastTarget = "head";
  for (const c of cards) {
    const card = state.cards[c];
    if (!card.power) continue;
    const dmg = Math.min(state.rules.damage.limit, cardDamage(state, att, c) * tierMult * mult * swarm);
    if (dmg <= 0) continue;
    const target = card.target || "head";
    state[def].hp = Math.max(0, state[def].hp - dmg);
    state[def].pips[target] = Math.min(state.rules.debuff.maxPips, state[def].pips[target] + 1);
    score(state, att, "striking", dmg * state.rules.score.damage);
    events.push({ kind: "hit", attacker: att, target, damage: Math.round(dmg), tier, card: c, name: card.name });
    lastTarget = target;
    if (target === "head") headDamage += dmg;
    if (state[def].hp <= 0) {
      finish(state, att, !state.ground && lastTarget === "head" ? "KO" : "TKO", events);
      return true;
    }
  }
  if (headDamage < state.rules.rocked.minDamage && tier !== "crit") return false;
  if (headDamage <= 0) return false;
  const r = state.rules.rocked;
  const chin = state[def].attrs.chin;
  if (wasRocked) {
    const p = clamp(r.flashKoBase + (r.chinPivot - chin) * r.flashKoPerChin + (r.flashKoHpPivot - state[def].hp) * r.flashKoPerHp + (tier === "crit" ? r.critBonus : 0), r.min, r.max);
    if (nextUnit(state) < p) {
      finish(state, att, state.ground ? "TKO" : "KO", events);
      return true;
    }
  }
  const headPips = state[def].pips.head >= state.rules.debuff.threshold ? r.headDebuffBonus : 0;
  const p = clamp(r.base + (headDamage - r.minDamage) * r.perDamage + (r.chinPivot - chin) * r.perChin + headPips + (tier === "crit" ? r.critBonus : 0), r.min, r.max);
  if (nextUnit(state) < p) {
    state[def].rocked = true;
    state[def].rockedAt = state.history.length;
    addMomentum(state, att, state.rules.momentum.rocked);
    score(state, att, "striking", state.rules.score.rocked);
    events.push({ kind: "rocked", side: def });
  }
  return false;
}

function setPosition(state, pos, events, by) {
  const g = state.ground;
  const next = clamp(pos, 0, state.rules.positions.length - 1);
  if (next === g.pos) return;
  if (next > g.pos) score(state, g.top, "grappling", state.rules.score.positionGain * (next - g.pos));
  g.pos = next;
  events.push({ kind: "position", top: g.top, pos: next, name: state.rules.positions[next], by });
}

function standUp(state, events, reason) {
  state.ground = null;
  state.range = "in";
  events.push({ kind: "standup", reason });
}

function startLock(state, attacker, cardName, depth, events) {
  state.ground.lock = { attacker, name: cardName, depth };
  score(state, attacker, "grappling", state.rules.score.lockAttempt);
  events.push({ kind: "lockStart", attacker, name: cardName, depth });
}

function setRange(state, range, events) {
  if (state.ground || state.range === range) return;
  state.range = range;
  events.push({ kind: "range", range });
}

function overcommit(state, loserCards) {
  const extra = Math.max(0, costOf(state, loserCards) - 1);
  const d = state.rules.damage;
  // Getting caught on a shot hurts less than walking into a counter: the shooter is already moving under the punch.
  const rate = typeOfPlay(state, loserCards) === "G" ? d.shootOvercommit : d.overcommitPerEnergy;
  return 1 + extra * rate;
}

function applyRangeEffects(state, cards, events) {
  for (const c of cards) if (state.cards[c].setRange) setRange(state, state.cards[c].setRange, events);
}

function winnerText(state, winType, loseType, ground, winnerSide) {
  if (ground) {
    const role = ground.top === winnerSide ? "top" : "bottom";
    return `${state.rules.groundLabels[role][winType]}得手`;
  }
  if (winType === "S") return "抓到他衝進來";
  if (winType === "C") return "反擊成功";
  return "摔進去了";
}

function resolveLock(state, winner, plays, events) {
  const lock = state.ground.lock;
  const l = state.rules.lock;
  const atk = lock.attacker;
  const def = opposite(atk);
  if (winner === atk) {
    const p = lockTapChance(state);
    if (nextUnit(state) < p) {
      events.push({ kind: "tap", attacker: atk, name: lock.name });
      finish(state, atk, "SUB", events);
      return;
    }
    lock.depth += 1;
    addStamina(state, def, -l.holdDrain);
    score(state, atk, "grappling", state.rules.score.lockAttempt);
    events.push({ kind: "lockDeepen", attacker: atk, name: lock.name, depth: lock.depth });
  } else if (winner === def) {
    state.ground.lock = null;
    addStamina(state, atk, -l.escapePenalty);
    addMomentum(state, def, state.rules.momentum.win);
    events.push({ kind: "lockEscape", side: def, name: lock.name });
  } else {
    addStamina(state, atk, -l.holdDrain);
    addStamina(state, def, -l.holdDrain);
    events.push({ kind: "lockHold", attacker: atk, name: lock.name });
  }
}

function resolveStandingWin(state, w, l, plays, events) {
  const wCards = plays[w];
  const lCards = plays[l];
  const type = typeOfPlay(state, wCards);
  const sc = state.rules.score;
  const tier = rollTier(state, w, wCards);
  if (type === "S") {
    const ended = dealHit(state, w, wCards, tier, state.rules.damage.winStrikeBonus * overcommit(state, lCards), events);
    if (ended) return;
    addStamina(state, l, -state.rules.stamina.whiffGrapple);
    applyRangeEffects(state, wCards, events);
    return;
  }
  if (type === "C") {
    const lockCard = wCards.find((c) => state.cards[c].lockAnywhere);
    const ended = dealHit(state, w, wCards, tier, state.rules.damage.counterMult * overcommit(state, lCards), events);
    if (ended) return;
    applyRangeEffects(state, wCards, events);
    if (lockCard) {
      state.ground = { top: l, pos: 0, lock: null };
      startLock(state, w, state.cards[lockCard].name, state.cards[lockCard].lockDepth || 1, events);
    }
    return;
  }
  // Grapple beats defend.
  const drain = state.rules.grapple.drainOnLanding * overcommit(state, lCards);
  const main = wCards.reduce((best, c) => ((state.cards[c].landing || 0) > (state.cards[best].landing || 0) ? c : best), wCards[0]);
  const card = state.cards[main];
  addStamina(state, l, -drain - (card.drain || 0));
  if (wCards.every((c) => state.cards[c].clinchOnly)) {
    setRange(state, "in", events);
    events.push({ kind: "clinch", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    return;
  }
  if (wCards.some((c) => state.cards[c].pullGuard)) {
    state.ground = { top: l, pos: 0, lock: null };
    events.push({ kind: "pullGuard", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    return;
  }
  const pos = (card.landing || 0) + state.rules.grapple.positionFromTier[tier];
  if (pos < 0) {
    setRange(state, "in", events);
    events.push({ kind: "clinch", side: w, stuffed: true });
    score(state, w, "grappling", sc.exchangeWin);
    return;
  }
  state.ground = { top: w, pos: clamp(pos, 0, state.rules.positions.length - 1), lock: null };
  score(state, w, "grappling", sc.takedown);
  addMomentum(state, w, state.rules.momentum.landing);
  events.push({ kind: "takedown", side: w, pos: state.ground.pos, name: state.rules.positions[state.ground.pos], tier });
  const slam = wCards.reduce((sum, c) => sum + (state.cards[c].slam || 0), 0);
  if (slam > 0) {
    state[l].hp = Math.max(1, state[l].hp - slam * state.rules.damage.slamToGround);
    events.push({ kind: "hit", attacker: w, target: "body", damage: slam, tier, card: main, name: "重摔" });
  }
}

function resolveGroundWin(state, w, l, plays, events) {
  const g = state.ground;
  const d = state.rules.damage;
  const wCards = plays[w];
  const lCards = plays[l];
  const type = typeOfPlay(state, wCards);
  const tier = rollTier(state, w, wCards);
  const isTop = g.top === w;
  const mult = overcommit(state, lCards);
  if (isTop) {
    if (type === "S") {
      dealHit(state, w, wCards, tier, d.winStrikeBonus * d.groundPositionMult[g.pos] * mult, events);
    } else if (type === "G") {
      const lockCard = wCards.find((c) => state.cards[c].lockTop);
      if (lockCard && g.pos >= state.rules.lock.minTopPosition && tier !== "graze") {
        startLock(state, w, state.cards[lockCard].name, state.cards[lockCard].lockDepth || 1, events);
        return;
      }
      const bonus = wCards.reduce((sum, c) => sum + (state.cards[c].advanceBonus || 0), 0);
      const step = (tier === "graze" ? 0 : tier === "crit" ? 2 : 1) + bonus;
      if (g.pos >= state.rules.positions.length - 1 && !lockCard) {
        addStamina(state, l, -state.rules.grapple.topControlDrain * mult);
        events.push({ kind: "ride", side: w });
      } else if (g.pos >= state.rules.positions.length - 1) {
        startLock(state, w, state.cards[lockCard].name, 1, events);
      } else {
        setPosition(state, g.pos + step, events, w);
        addStamina(state, l, -state.rules.grapple.drainOnLanding);
      }
    } else {
      // Stay heavy: swallow the upkick and drain the man underneath.
      addStamina(state, l, -state.rules.grapple.topControlDrain * mult);
      if (wCards.length) dealHit(state, w, wCards, tier, d.bottomCounterMult, events);
      if (!state.over) events.push({ kind: "ride", side: w });
    }
    return;
  }
  // Winner is underneath.
  if (type === "S") {
    const ended = dealHit(state, w, wCards, tier, d.winStrikeBonus * d.bottomStrikeMult * mult, events);
    if (!ended && tier === "crit") standUp(state, events, "upkick");
  } else if (type === "G") {
    // Getting out takes work: a graze changes nothing, a clean win recovers one position, only a great one jumps.
    if (tier === "graze") events.push({ kind: "ride", side: l, held: true });
    else if (tier === "clean" && g.pos > 0) setPosition(state, g.pos - 1, events, w);
    else if (tier === "crit" && g.pos === 0) {
      g.top = w;
      score(state, w, "grappling", state.rules.score.takedown);
      events.push({ kind: "sweep", side: w, name: state.rules.positions[0] });
    } else standUp(state, events, "getup");
  } else {
    const lockCard = wCards.find((c) => state.cards[c].lockBottom);
    if (lockCard) {
      startLock(state, w, state.cards[lockCard].name, state.cards[lockCard].lockDepth || 1, events);
      return;
    }
    const ended = wCards.length ? dealHit(state, w, wCards, tier, d.bottomCounterMult * mult, events) : false;
    if (!ended) setPosition(state, g.pos - 1, events, w);
  }
}

function resolveTrade(state, plays, events) {
  // Both land. The smaller commitment arrives first, and a rocking shot weakens the reply.
  const d = state.rules.damage;
  const costA = costOf(state, plays.a);
  const costB = costOf(state, plays.b);
  let first = "a";
  if (costB < costA) first = "b";
  else if (costB === costA && state.b.attrs.accuracy > state.a.attrs.accuracy) first = "b";
  const second = opposite(first);
  const groundMult = (s) => {
    if (!state.ground) return 1;
    return state.ground.top === s ? d.groundPositionMult[state.ground.pos] : d.bottomStrikeMult;
  };
  events.push({ kind: "trade", first });
  const tierFirst = rollTier(state, first, plays[first]);
  if (dealHit(state, first, plays[first], tierFirst, d.tradeMult * groundMult(first), events)) return;
  const interrupted = state[second].rocked && state[second].rockedAt === state.history.length;
  const tierSecond = rollTier(state, second, plays[second]);
  if (interrupted) events.push({ kind: "interrupted", side: second });
  dealHit(state, second, plays[second], tierSecond, d.tradeMult * groundMult(second) * (interrupted ? d.tradeInterruptMult : 1), events);
  addMomentum(state, "a", state.rules.momentum.trade);
  addMomentum(state, "b", state.rules.momentum.trade);
}

function resolveScramble(state, events) {
  const g = state.rules.grapple;
  const diff = state.a.attrs.wrestling - state.b.attrs.wrestling;
  const pA = clamp(0.5 + diff * 0.01, 0.1, 0.9);
  const w = nextUnit(state) < pA ? "a" : "b";
  const l = opposite(w);
  addStamina(state, "a", -g.scrambleStamina);
  addStamina(state, "b", -g.scrambleStamina);
  addMomentum(state, w, g.scrambleMomentum);
  setRange(state, "in", events);
  events.push({ kind: "scramble", winner: w, loser: l });
}

function resolveStandoff(state, events) {
  state.stall += 1;
  const m = state.rules.momentum;
  events.push({ kind: "standoff", stall: state.stall });
  if (state.stall >= state.rules.stall.limit) {
    addMomentum(state, "a", m.standoff);
    addMomentum(state, "b", m.standoff);
    state.stall = 0;
    if (state.ground && !state.ground.lock) standUp(state, events, "referee");
    else events.push({ kind: "referee" });
  }
}

/** Resolves one simultaneous exchange. `playA` / `playB` are arrays of card ids. Returns the event list. */
export function resolveExchange(state, playA, playB) {
  if (state.phase !== "exchange") throw new Error(`cannot resolve in phase ${state.phase}`);
  for (const [s, cards] of [["a", playA], ["b", playB]]) {
    const err = playError(state, s, cards);
    if (err) throw new Error(`${s} illegal play: ${err} (${cards.join(",")})`);
  }
  const events = [];
  const plays = { a: playA.length ? playA : ["brace"], b: playB.length ? playB : ["brace"] };
  const types = { a: typeOfPlay(state, plays.a), b: typeOfPlay(state, plays.b) };
  const tri = state.rules.triangle;
  const mirror = types.a === types.b;
  const winner = mirror ? null : tri[types.a] === types.b ? "a" : "b";
  const wasRocked = { a: state.a.rocked, b: state.b.rocked };
  const groundBefore = state.ground ? { ...state.ground } : null;
  const staminaCost = state.rules.stamina.perEnergy;
  const momentum = state.rules.momentum;

  for (const s of SIDES) {
    addStamina(state, s, -costOf(state, plays[s]) * staminaCost);
    if (plays[s].some((c) => state.cards[c].signature)) {
      addMomentum(state, s, -momentum.signatureCost);
      events.push({ kind: "signature", side: s, name: state.cards[plays[s][0]].name });
    }
  }
  events.unshift({ kind: "reveal", a: plays.a, b: plays.b, types, winner, ground: groundBefore });

  if (winner) {
    const l = opposite(winner);
    addMomentum(state, winner, momentum.win);
    addMomentum(state, l, momentum.lose);
    score(state, winner, types[winner] === "G" ? "grappling" : "striking", state.rules.score.exchangeWin);
    events.push({ kind: "verdict", winner, type: types[winner], text: winnerText(state, types[winner], types[l], state.ground, winner) });
  } else {
    events.push({ kind: "verdict", winner: null, type: types.a, text: types.a === "S" ? "對轟" : types.a === "G" ? "互相扭抱" : "誰都不動" });
  }

  if (state.ground?.lock) resolveLock(state, winner, plays, events);
  else if (winner) {
    if (state.ground) resolveGroundWin(state, winner, opposite(winner), plays, events);
    else resolveStandingWin(state, winner, opposite(winner), plays, events);
  } else if (types.a === "S") resolveTrade(state, plays, events);
  else if (types.a === "G") resolveScramble(state, events);
  else resolveStandoff(state, events);

  if (types.a !== "C" || types.b !== "C") state.stall = 0;

  state.history.push(types);
  endExchange(state, plays, types, wasRocked, events);
  return events;
}

function endExchange(state, plays, types, wasRocked, events) {
  if (state.over) return;
  const st = state.rules.stamina;
  for (const s of SIDES) {
    const me = state[s];
    // A fighter who was rocked coming in recovers unless they were rocked again this exchange.
    if (wasRocked[s] && me.rocked && me.rockedAt !== state.history.length - 1) me.rocked = false;
    let regen = st.regenPerExchange + ((me.attrs.cardio - 70) / 30) * st.cardioRegenBonus;
    if (types[s] === "C") regen += st.counterRegen;
    if (me.pips.body >= state.rules.debuff.threshold) regen += st.bodyDebuffRegen;
    addStamina(state, s, regen);
    // Played cards go to the discard pile. Bracing and signatures are not deck cards.
    for (const c of plays[s]) {
      const i = me.hand.indexOf(c);
      if (i >= 0) me.hand.splice(i, 1);
      if (!state.cards[c].signature && c !== "brace") me.discard.push(c);
    }
    refillHand(state, s);
  }
  if (state.ground) score(state, state.ground.top, "grappling", state.rules.score.controlPerPosition * (state.ground.pos + 1));

  if (state.exchange >= state.rules.match.exchangesPerRound) endRound(state, events);
  else state.exchange += 1;
}

function endRound(state, events) {
  const s = state.rules.score;
  const judges = s.judges.map((j) => {
    const perf = (side) => state.roundScore[side].striking * j.striking + state.roundScore[side].grappling * j.grappling;
    const gap = perf("a") - perf("b");
    const loserScore = Math.abs(gap) >= s.tenEightGap ? 8 : 9;
    if (Math.abs(gap) < 0.5) return { a: 10, b: 10 };
    return gap > 0 ? { a: 10, b: loserScore } : { a: loserScore, b: 10 };
  });
  state.roundCards.push({ round: state.round, judges });
  events.push({ kind: "roundEnd", round: state.round, judges });
  state.roundScore = freshScore();
  state.a.rocked = false;
  state.b.rocked = false;
  state.ground = null;
  state.range = "out";
  state.stall = 0;
  if (state.round >= state.rules.match.rounds) decide(state, events);
  else state.phase = "corner";
}

function decide(state, events) {
  const totals = state.rules.score.judges.map((j, i) => ({
    name: j.name,
    a: state.roundCards.reduce((sum, r) => sum + r.judges[i].a, 0),
    b: state.roundCards.reduce((sum, r) => sum + r.judges[i].b, 0),
  }));
  const votesA = totals.filter((t) => t.a > t.b).length;
  const votesB = totals.filter((t) => t.b > t.a).length;
  let winner = null;
  let decision = "平手";
  if (votesA > votesB && votesA >= 2) winner = "a";
  else if (votesB > votesA && votesB >= 2) winner = "b";
  if (winner) {
    const top = Math.max(votesA, votesB);
    const other = Math.min(votesA, votesB);
    decision = top === 3 ? "一致判定" : other === 1 ? "分歧判定" : "多數判定";
  }
  state.over = { winner, method: "DEC", decision, totals, round: state.round, exchange: state.exchange };
  state.phase = "over";
  events.push({ kind: "finish", winner, method: "DEC", decision, totals });
}

/** Between rounds. `choices` = { a: optionId, b: optionId }. */
export function applyCorner(state, choices) {
  if (state.phase !== "corner") throw new Error("not in corner");
  const st = state.rules.stamina;
  for (const s of SIDES) {
    const me = state[s];
    addStamina(state, s, st.cornerBase + me.attrs.cardio * st.cornerCardio);
    const opt = state.rules.corner.options.find((o) => o.id === choices[s]);
    if (!opt) throw new Error(`unknown corner option ${choices[s]}`);
    if (opt.stamina) addStamina(state, s, opt.stamina);
    if (opt.momentum) addMomentum(state, s, opt.momentum);
    if (opt.hp) me.hp = Math.min(state.rules.match.maxHp, me.hp + opt.hp);
    if (opt.clearPip) {
      const worst = Object.keys(me.pips).reduce((a, b) => (me.pips[a] >= me.pips[b] ? a : b));
      me.pips[worst] = Math.max(0, me.pips[worst] - opt.clearPip);
    }
    refillHand(state, s);
  }
  state.round += 1;
  state.exchange = 1;
  state.phase = "exchange";
}

// ---------- Invariants ----------

export function checkInvariants(state) {
  const errors = [];
  const m = state.rules.match;
  for (const s of SIDES) {
    const me = state[s];
    if (!(me.hp >= 0 && me.hp <= m.maxHp)) errors.push(`${s}.hp ${me.hp}`);
    if (!(me.stamina >= 0 && me.stamina <= m.maxStamina)) errors.push(`${s}.stamina ${me.stamina}`);
    if (!(me.momentum >= 0 && me.momentum <= m.maxMomentum)) errors.push(`${s}.momentum ${me.momentum}`);
    const f = state.fighters[me.id];
    const deckCards = me.hand.filter((c) => c !== f.signature).length + me.draw.length + me.discard.length;
    if (deckCards !== f.deck.length) errors.push(`${s} deck size ${deckCards} != ${f.deck.length}`);
  }
  if (state.ground) {
    if (state.ground.pos < 0 || state.ground.pos >= state.rules.positions.length) errors.push(`pos ${state.ground.pos}`);
    if (!SIDES.includes(state.ground.top)) errors.push("ground.top");
  }
  if (!["out", "in"].includes(state.range)) errors.push(`range ${state.range}`);
  if (state.phase === "over" && !state.over) errors.push("over without result");
  return errors;
}
