// Octagon Cards combat engine. Pure rules: no DOM, no timers, runs in browsers and Node.
// All numbers live in rules/*.json. Spec: docs/GAME_DESIGN.md.

const SIDES = ["a", "b"];
const TYPES = ["S", "G", "C"];
const MASK = (1n << 64n) - 1n;

export const opposite = (side) => (side === "a" ? "b" : "a");

/**
 * Joins the base rule files with rules/depth.json, which layers cross-hand setups, abilities and tactics on top of the roster.
 * `cards` and `fighters` entries in depth.json are merged into the base entry of the same id (or added when new);
 * a fighter's `deckSwap` is a list of [old, new] card pairs applied to their deck.
 */
export function loadData({ rules, cards, fighters, depth = {} }) {
  const merged = { rules, cards: { ...cards }, fighters: { ...fighters } };
  for (const [id, extra] of Object.entries(depth.cards || {})) merged.cards[id] = { ...merged.cards[id], ...extra };
  for (const [id, extra] of Object.entries(depth.fighters || {})) {
    const base = merged.fighters[id];
    if (!base) continue;
    const { deckSwap = [], ...rest } = extra;
    const deck = [...base.deck];
    for (const [from, to] of deckSwap) {
      const i = deck.indexOf(from);
      if (i >= 0) deck[i] = to;
      else deck.push(to);
    }
    merged.fighters[id] = { ...base, ...rest, deck };
  }
  return merged;
}
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

export function createMatch(data, idA, idB, seed = 1, mode = "standard") {
  const length = data.rules.match.modes[mode];
  if (!length) throw new Error(`unknown match length ${mode}`);
  const state = {
    mode,
    rounds: length.rounds,
    perRound: length.exchanges, // exchanges in each round
    maxHp: length.hp,
    rules: data.rules,
    cards: data.cards,
    fighters: data.fighters,
    rng: BigInt.asUintN(64, BigInt(seed)),
    seed,
    dist: data.rules.dist.start, // 0 far, 1 mid, 2 close, 3 clinch. Shared by both fighters while standing.
    ground: null,
    cage: null, // { side, ttl }: the fighter whose back is to the fence
    pending: null, // a choice the winner of a takedown still has to make
    round: 1,
    exchange: 1,
    stall: 0,
    phase: "exchange", // exchange | corner | over
    over: null,
    a: makeSide(data, idA, length.hp),
    b: makeSide(data, idB, length.hp),
    history: [],
    pendingMarks: [], // setups earned this exchange; they take hold when it ends
    roundCards: [],
    roundScore: freshScore(),
    log: [],
  };
  for (const s of SIDES) {
    shuffle(state, state[s].draw);
    refillHand(state, s);
  }
  for (const s of SIDES) state[s].tactic = chooseTactic(state, s);
  return state;
}

function makeSide(data, id, maxHp) {
  const f = data.fighters[id];
  return {
    id,
    name: f.short,
    attrs: f.attrs,
    hp: maxHp,
    stamina: data.rules.match.maxStamina,
    momentum: 0,
    rocked: false,
    pips: { head: 0, body: 0, legs: 0 },
    cut: 0, // bleeding level 0-3
    marks: {}, // short-lived tags: { tag: { turns, n } }
    tactic: null, // this round's game plan (rules.tactics id)
    tacticChanged: false, // whether it differs from last round's
    pressure: 0, // how much ground this fighter has recently given up
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

const BASIC_STEPS = ["step_in", "step_back"];
const CAGE_CARDS = ["cage_push", "cage_turn"];
const isBasic = (state, c) => Boolean(state.cards[c].basic);

/** Draws up to a full hand, then adds the permanent steps and, when the fighter has the momentum, the signature. */
function refillHand(state, s) {
  const me = state[s];
  const size = state.rules.match.handSize;
  const sig = state.fighters[me.id].signature;
  const core = me.hand.filter((c) => c !== sig && !isBasic(state, c));
  while (core.length < size && me.draw.length + me.discard.length > 0) core.push(drawOne(state, s));
  // The drawn cards always hold all three types that can be played from where the fighters stand now,
  // so every read can be acted on. A type the deck cannot play from here at all is skipped.
  const playable = (c, t) => state.cards[c].type === t && usableAt(state, state.cards[c], state.dist, s);
  const holds = (list, t) => list.some((c) => playable(c, t));
  for (const t of TYPES) {
    if (holds(core, t)) continue;
    let pool = me.draw;
    let idx = pool.findIndex((c) => playable(c, t));
    if (idx < 0) {
      pool = me.discard;
      idx = pool.findIndex((c) => playable(c, t));
    }
    if (idx < 0) continue;
    // Swap out a card whose removal leaves every type that is currently covered still covered. Dead cards go first.
    const covered = TYPES.filter((x) => holds(core, x));
    const order = core.map((c, i) => i).sort((i, j) => Number(usableAt(state, state.cards[core[i]], state.dist, s)) - Number(usableAt(state, state.cards[core[j]], state.dist, s)));
    const swapAt = order.find((i) => {
      const rest = core.filter((_, k) => k !== i);
      return covered.every((x) => holds(rest, x));
    });
    if (swapAt === undefined) continue;
    const taken = pool.splice(idx, 1)[0];
    pool.unshift(core[swapAt]);
    core[swapAt] = taken;
  }
  me.hand = [...core, ...BASIC_STEPS];
  // Up against the fence a fighter gets two ways out.
  if (state.cage?.side === s && !state.ground) me.hand.push(...CAGE_CARDS);
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
  if (isFinal(state)) b += state.rules.match.finalExchange.energyBonus;
  if (state[opposite(s)].rocked) b += e.swarmBonus;
  for (const [tag, m] of Object.entries(me.marks)) {
    const def = state.rules.tags[tag] || {};
    if (def.budget && m.n >= (def.budgetAt || 1)) b += def.budget;
  }
  return Math.max(1, b);
}

/** The last exchange of a round: everyone has an extra energy to spend and the judges weigh it more. */
export const isFinal = (state) => state.exchange === state.perRound;

/** This round's game plan for a fighter, as numbers (rules.tactics). */
const tactic = (state, s) => state.rules.tactics[state[s].tactic] || {};

/** The always-on part of a fighter's ability (see rules/depth.json). */
const passive = (state, s) => state.fighters[state[s].id].ability?.passive || {};
/** Tells the screen that a passive just did something. */
const showAbility = (state, s, events) => events.push({ kind: "ability", side: s, name: state.fighters[state[s].id].ability.name });

/** Which style table applies: the ground roles, or the outside / inside of the stand-up game. */
export const phaseOf = (state, s) => (state.ground ? (state.ground.top === s ? "top" : "bottom") : state.dist >= 2 ? "in" : "out");
/** What a card costs this fighter right now. A leg injury (or a tag) makes steps dearer, though never beyond what they can spend. */
export function cardCost(state, s, c) {
  const card = state.cards[c];
  let extra = 0;
  if (card.move) {
    if (state[s].pips.legs >= state.rules.debuff.threshold) extra += state.rules.debuff.legMoveCost;
    for (const tag of Object.keys(state[s].marks)) extra += state.rules.tags[tag]?.moveCost || 0;
  }
  return extra ? Math.min(card.cost + extra, Math.max(card.cost, budget(state, s))) : card.cost;
}
const costOf = (state, cards, s) => cards.reduce((sum, c) => sum + cardCost(state, s, c), 0);
/** A play counts as the type of its real cards. A step thrown in with them (move first, then strike) takes on that type. */
export function typeOfPlay(state, cards) {
  if (!cards.length) return "C";
  const real = cards.find((c) => !state.cards[c].moveOnly);
  return state.cards[real ?? cards[0]].type;
}
const clampDist = (state, d) => clamp(d, 0, state.rules.dist.names.length - 1);

/** Can this card be thrown from distance `d`? On the ground distance does not apply, but steps do not exist there. */
export function usableAt(state, card, d, s) {
  // Fence cards exist only for the fighter who is up against it. A fighter against the fence has nowhere to back off to.
  if (card.cageOnly) return Boolean(s) && !state.ground && state.cage?.side === s;
  if (state.ground) return !card.moveOnly;
  if (s && state.cage?.side === s && card.type === "C" && card.move < 0) return false;
  return !card.range || (d >= card.range[0] && d <= card.range[1]);
}

/** Net distance change a set of cards asks for (positive closes in). */
const moveOf = (state, cards) => (state.ground ? 0 : cards.reduce((sum, c) => sum + (state.cards[c].move || 0), 0));

/** Cards are thrown in order and each one is checked where the previous ones left the fighters. */
function sequenceError(state, cards, s) {
  let d = state.dist;
  for (const c of cards) {
    const card = state.cards[c];
    if (!usableAt(state, card, d, s)) return "out of range";
    if (!state.ground) d = clampDist(state, d + (card.move || 0));
  }
  return null;
}

/** A legal order for these cards (the given order when it works), or null when none exists. */
export function arrange(state, cards, s) {
  if (cards.length <= 1) return sequenceError(state, cards, s) ? null : [...cards];
  const permute = (rest, done) => {
    if (!rest.length) return sequenceError(state, done, s) ? null : done;
    for (let i = 0; i < rest.length; i++) {
      const found = permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...done, rest[i]]);
      if (found) return found;
    }
    return null;
  };
  if (!sequenceError(state, cards, s)) return [...cards];
  return permute(cards, []);
}

/** Returns an error string, or null when the play is legal. An empty play means bracing (free, counts as defend). */
export function playError(state, s, cards) {
  if (cards.length === 0) return null;
  const counts = {};
  for (const c of state[s].hand) counts[c] = (counts[c] || 0) + 1;
  for (const c of cards) {
    if (!counts[c]) return "not in hand";
    counts[c]--;
  }
  // One kind of play, except that a single step may come with it: "step in, then jab".
  const real = cards.filter((c) => !state.cards[c].moveOnly);
  const steps = cards.filter((c) => state.cards[c].moveOnly);
  const kinds = (list) => new Set(list.map((c) => state.cards[c].type)).size;
  if (kinds(cards) > 1 && !(real.length && steps.length === 1 && kinds(real) === 1)) return "mixed types";
  if (cards.length > 1 && cards.some((c) => state.cards[c].cageOnly)) return "fence cards go alone";
  if (costOf(state, cards, s) > budget(state, s)) return "over budget";
  if (!arrange(state, cards, s)) return "out of range";
  return null;
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
    // A card that follows a setup gets its bonus when the tag from last exchange is still on.
    for (const [tag, eff] of Object.entries(card.follow || {})) if (me.marks[tag]) bonus += (eff.crit || 0) + (eff.quality || 0);
  }
  for (const [tag, m] of Object.entries(me.marks)) {
    const def = state.rules.tags[tag] || {};
    bonus += (def.crit || 0) * (def.perStack ? m.n : 1);
  }
  const plan = tactic(state, s);
  bonus += (plan.crit || 0) + (type === "G" ? plan.gQuality || 0 : 0);
  // A man with his back to the fence is easier to take down.
  if (type === "G" && state.cage?.side === opposite(s)) bonus += state.rules.cage.takedownBonus;
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
  let dmg = (card.power || 0) * powerMult(state, side) * (tactic(state, side).dmgOut || 1);
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
  const order = arrange(state, cards, s) || cards;
  return {
    type,
    order,
    cost: costOf(state, cards, s),
    endDist: state.ground ? null : clampDist(state, state.dist + moveOf(state, order)),
    damage: Math.round(base * winMult * (state[opposite(s)].rocked ? d.swarmMult : 1) * (tactic(state, opposite(s)).dmgIn || 1)),
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
  } else if (card.cage) {
    effect = card.cage === "turn" ? "贏了：脫離籠邊" : "贏了：和他換位置";
  } else if (card.moveOnly) {
    effect = card.move > 0 ? `靠近 ${card.move} 格` : `拉開 ${-card.move} 格`;
  } else if (card.type === "S") effect = `傷害 ${dmg}${card.hits > 1 ? ` · ${card.hits} 連` : ""}`;
  else if (card.type === "C") effect = card.catchShot ? "他摔不好就勒住" : card.power ? `反擊 ${dmg}` : "硬撐";
  else if (card.pullGuard) effect = "拉進地面，你在下位";
  else effect = `摔倒 → ${state.rules.positions[card.landing || 0]}`;
  if (!g && card.move && !card.moveOnly) effect += card.move > 0 ? ` · 進 ${card.move}` : ` · 退 ${-card.move}`;
  // Setups this card lays down, and the ones it can follow (live when the tag is on).
  const setups = (card.setup || []).map((st) => ({ tag: st.tag, label: state.rules.tags[st.tag]?.label || st.tag, when: st.when, to: st.to || "self" }));
  const follows = Object.entries(card.follow || {}).map(([tag, eff]) => ({ tag, label: state.rules.tags[tag]?.label || tag, bonus: Math.round(((eff.crit || 0) + (eff.quality || 0)) * 100), live: Boolean(state[s].marks[tag]) }));
  return { action, effect, cost: cardCost(state, s, cardId), unusable: !usableAt(state, card, state.dist, s), blocked: !g && state.cage?.side === s && card.type === "C" && card.move < 0 ? "背靠籠子" : "", rangeText: rangeText(state, card), setups, follows };
}

/** "近距", "中~近距" or "" for a card that works anywhere. */
export function rangeText(state, card) {
  const r = card.range;
  const short = state.rules.dist.short;
  if (!r || (r[0] === 0 && r[1] === short.length - 1)) return "";
  return r[0] === r[1] ? `${short[r[0]]}距` : `${short[r[0]]}~${short[r[1]]}距`;
}

// ---------- AI ----------

const beaterOf = (triangle, t) => TYPES.find((x) => triangle[x] === t);

function typeAvailable(state, s, type) {
  if (type === "C") return true; // bracing is always possible
  const b = budget(state, s);
  return state[s].hand.some((c) => state.cards[c].type === type && cardCost(state, s, c) <= b && usableAt(state, state.cards[c], state.dist, s));
}

/** How far outside their comfortable range a fighter stands (0 when inside it). */
function distGap(state, s, d) {
  const [lo, hi] = state.fighters[state[s].id].prefer;
  return d < lo ? lo - d : d > hi ? d - hi : 0;
}

/** The opponent's honest tendencies. The UI shows these same numbers and chooseAI samples from them. */
export function getIntent(state, s) {
  const ai = state.rules.ai;
  const me = state[s];
  const oppSide = opposite(s);
  const style = state.fighters[me.id].style[phaseOf(state, s)];
  const plan = tactic(state, s);
  const w = { S: style.S + (plan.style?.S || 0), G: style.G + (plan.style?.G || 0), C: style.C + (plan.style?.C || 0) };
  const tags = [];

  // Having been fooled makes the other side read you better.
  let readBoost = 1;
  for (const tag of Object.keys(state[oppSide].marks)) readBoost *= state.rules.tags[tag]?.readBoost || 1;
  const recent = state.history.slice(-ai.adapt.window).map((h) => h[oppSide]);
  for (const t of recent) w[beaterOf(state.rules.triangle, t)] += ai.adapt.perMatch * readBoost;
  if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
    w[beaterOf(state.rules.triangle, recent[recent.length - 1])] += ai.adapt.repeatBonus;
    tags.push("看穿你的習慣");
  }
  if (me.rocked) { w.C += ai.rockedCounter; tags.push("被打暈，想撐過去"); }
  if (state[oppSide].rocked) { w.S += ai.swarmStrike; tags.push("要衝上來追擊"); }
  if (me.stamina < ai.lowStaminaAt) { w.C += ai.lowStaminaCounter; tags.push("快沒力了"); }
  if (state.cage && !state.ground) {
    const c = state.rules.cage;
    if (state.cage.side === s) { w.C += c.pinnedC; w.G += c.pinnedG; tags.push("背靠籠子，想脫離"); }
    else { w.G += c.pinnerG; tags.push("把你逼在籠邊，想摔"); }
  }
  if (!state.ground) {
    const [lo, hi] = state.fighters[me.id].prefer;
    if (state.dist < lo) { w.G += ai.wantClose; tags.push("想拉近距離"); }
    else if (state.dist > hi) { w.C += ai.wantOut; tags.push("想拉開距離"); }
  }

  // A fighter caught out by a feint (or any tag that sharpens) shows his hand: the likely type gets likelier.
  for (const [tag] of Object.entries(me.marks)) {
    const def = state.rules.tags[tag];
    if (!def?.sharpen) continue;
    for (const t of TYPES) w[t] = w[t] ** def.sharpen;
    tags.push(def.label);
  }
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
    // Blood in the eyes: the viewer only makes out the single most likely type.
    blind: state[oppSide].cut >= state.rules.cut.blindAt,
    signatureReady: me.hand.includes(state.fighters[me.id].signature),
  };
}

/** How much a follow-up bonus that is live right now is worth to the AI when picking cards. */
function followValue(state, s, card) {
  let v = 0;
  for (const [tag, eff] of Object.entries(card.follow || {})) if (state[s].marks[tag]) v += ((eff.crit || 0) + (eff.quality || 0)) * 30;
  return v;
}

function cardValue(state, s, cardId) {
  const card = state.cards[cardId];
  if (card.cageOnly) return card.cage === "turn" ? 12 : 6;
  const g = state.ground;
  // Moving toward a comfortable distance is worth something, moving away from it costs something.
  let step = 0;
  if (!g && card.move) step = (distGap(state, s, state.dist) - distGap(state, s, clampDist(state, state.dist + card.move))) * 3;
  if (card.moveOnly) return step > 0 ? 0.5 + step : 0;
  if (card.type === "G") {
    let v = card.cost + (card.quality || 0) * 4 + (card.landing || 0) + step + followValue(state, s, card);
    if (g && g.top === s && card.lockTop && g.pos >= state.rules.lock.minTopPosition) v += 3;
    return v;
  }
  let v = cardDamage(state, s, cardId) + step;
  v += (card.setup ? 2 : 0) + followValue(state, s, card);
  if (card.type === "C" && g && g.top !== s && card.lockBottom) v += 8;
  if (card.catchShot) v += 3;
  if (card.signature) v += 10;
  return v;
}

/** Highest-value ordered set of `type` cards that can legally be thrown within `limit` energy. Empty means bracing. */
export function bestPlay(state, s, type, limit) {
  const hand = state[s].hand.filter((c) => state.cards[c].type === type && cardCost(state, s, c) <= limit && usableAt(state, state.cards[c], state.dist, s));
  let best = [];
  // A strike or grapple that was chosen is always thrown, however poor; only a defend falls back to bracing.
  let bestValue = type === "C" ? 0 : -Infinity;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let cost = 0;
    let value = 0;
    const cards = [];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      cost += cardCost(state, s, hand[i]);
      value += cardValue(state, s, hand[i]);
      cards.push(hand[i]);
    }
    if (cost > limit || value <= bestValue) continue;
    if (cards.length > 1 && cards.some((c) => state.cards[c].cageOnly)) continue;
    const ordered = arrange(state, cards, s);
    if (!ordered) continue;
    bestValue = value;
    best = ordered;
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
  let limit = nextUnit(state) < ai.commit.fullChance + (tactic(state, s).commit || 0) ? b : Math.max(1, b - 1);
  if (me.stamina < ai.commit.conserveAt) limit = Math.min(limit, 2);
  // Holding back never means failing to throw the type the shown odds promised: spend what the cheapest legal card costs.
  if (type !== "C") {
    const legal = me.hand.filter((c) => state.cards[c].type === type && usableAt(state, state.cards[c], state.dist, s)).map((c) => cardCost(state, s, c));
    if (legal.length) limit = Math.min(b, Math.max(limit, Math.min(...legal)));
  }
  const sig = state.fighters[me.id].signature;
  if (me.hand.includes(sig) && state.cards[sig].type === type && cardCost(state, s, sig) <= b && nextUnit(state) < ai.signatureWeight + 0.4) {
    return { cards: [sig] };
  }
  return { cards: bestPlay(state, s, type, limit) };
}

/** AI: follow the man down, or let him up. Grapplers follow nearly always, strikers often would rather stand. */
export function chooseChase(state, s) {
  const f = state.fighters[state[s].id];
  const foe = state[opposite(s)];
  const c = state.rules.chase;
  let p = f.chase ?? c.default;
  p += foe.stamina < 30 ? c.tiredFoeBonus : 0;
  p -= Math.max(0, foe.attrs.submission - c.dangerPivot) * c.perSubmission;
  return nextUnit(state) < clamp(p, 0.1, 0.95) ? "follow" : "release";
}

/** Settles the choice left by a takedown: "follow" stays on the ground, "release" lets him stand and keeps the edge. */
export function resolvePending(state, choice) {
  const p = state.pending;
  if (!p) throw new Error("nothing pending");
  state.pending = null;
  const events = [];
  const follow = choice !== "release";
  events.push({ kind: "chase", side: p.side, follow });
  if (!follow) {
    standUp(state, events, "release");
    const tag = state.rules.chase.tag;
    state[p.side].marks[tag] = { turns: state.rules.chase.turns, n: 1 };
    events.push({ kind: "mark", side: p.side, tag, n: 1 });
  }
  for (const s of SIDES) refillHand(state, s);
  return events;
}

/** Rounds won by `s` minus rounds won by the other side, by the judges' majority so far. */
function roundLead(state, s) {
  let lead = 0;
  for (const card of state.roundCards) {
    const mine = card.judges.filter((j) => j[s] > j[opposite(s)]).length;
    const theirs = card.judges.filter((j) => j[opposite(s)] > j[s]).length;
    lead += mine > theirs ? 1 : theirs > mine ? -1 : 0;
  }
  return lead;
}

/**
 * The AI's plan for the coming round: the fighter's own taste, bent by the score, the damage and the gas tank.
 * Behind on the cards or the foe about to go: swing for the finish. Ahead or tired: keep it safe. Foe gassed: lean on him.
 */
export function chooseTactic(state, s) {
  const me = state[s];
  const foe = state[opposite(s)];
  const bias = state.fighters[me.id].tactics || {};
  const lead = roundLead(state, s);
  const hp = me.hp / state.maxHp;
  const foeHp = foe.hp / state.maxHp;
  const last = state.round >= state.rounds;
  const w = {};
  for (const id of Object.keys(state.rules.tactics)) w[id] = bias[id] ?? 1;
  if (lead < 0) { w.ko += 1.2 * -lead; w.points += 0.6; w.press += 0.4; }
  if (lead > 0) w.probe += 1.2 * lead;
  if (last && lead < 0) w.ko += 1.5;
  if (last && lead > 0) w.probe += 1;
  if (me.stamina < 40) w.probe += 1.5;
  if (hp < 0.35) w.probe += 1;
  if (me.cut >= 2) w.probe += 0.8;
  if (foeHp < 0.35) w.ko += 1.5;
  if (foe.stamina < 35) w.press += 1;
  if (me.tactic) w[me.tactic] *= 1.6; // a plan tends to be kept unless something changed
  const ids = Object.keys(w);
  const weights = ids.map((id) => w[id] ** 1.5);
  let r = nextUnit(state) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i];
    if (r <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/** Fixes a fighter's plan for the round and remembers whether it changed. */
export function setTactic(state, s, id) {
  if (!state.rules.tactics[id]) throw new Error(`unknown tactic ${id}`);
  const prev = state[s].tactic;
  state[s].tacticChanged = Boolean(prev) && prev !== id;
  state[s].tactic = id;
}

export function chooseCorner(state, s) {
  const me = state[s];
  if (me.cut >= 2) return "patch";
  if (me.stamina < 45) return "breathe";
  if (me.hp < state.maxHp * 0.45) return "patch";
  return "fire";
}

// ---------- Exchange ----------

function addStamina(state, s, delta) {
  state[s].stamina = clamp(state[s].stamina + delta, 0, state.rules.match.maxStamina);
}
function addMomentum(state, s, delta) {
  state[s].momentum = clamp(state[s].momentum + delta, 0, state.rules.match.maxMomentum);
}
/** A setup earned this exchange. It takes hold when the exchange ends and lasts `turns` exchanges. `stack` adds a level up to `max`. */
function queueMark(state, side, tag, turns = 1, stack = false, max = 1) {
  state.pendingMarks.push({ side, tag, turns, stack, max });
}

/** Setups that read "when I win the exchange" or "when my card lands". `to` says who gets the tag. */
function queueSetups(state, side, cards, when) {
  for (const c of cards) {
    for (const st of state.cards[c]?.setup || []) {
      if (st.when !== when) continue;
      queueMark(state, st.to === "foe" ? opposite(side) : side, st.tag, st.turns || 1, st.stack, st.max);
    }
  }
}

/** Expired tags drop off, then the new ones take hold. Runs at the end of every exchange. */
function settleMarks(state, events) {
  const had = {};
  for (const s of SIDES) had[s] = Object.fromEntries(Object.entries(state[s].marks).map(([t, m]) => [t, m.n]));
  for (const s of SIDES) {
    for (const [tag, m] of Object.entries(state[s].marks)) {
      m.turns -= 1;
      if (m.turns <= 0) delete state[s].marks[tag];
    }
  }
  for (const p of state.pendingMarks) {
    const mine = state[p.side].marks;
    const before = had[p.side][p.tag];
    if (p.stack && before) mine[p.tag] = { turns: p.turns, n: Math.min(p.max || 1, before + 1) };
    else mine[p.tag] = { turns: p.turns, n: 1 };
    events.push({ kind: "mark", side: p.side, tag: p.tag, n: mine[p.tag].n });
  }
  state.pendingMarks = [];
}

function score(state, s, kind, amount) {
  state.roundScore[s][kind] += amount * (isFinal(state) ? state.rules.match.finalExchange.scoreMult : 1) * (tactic(state, s).scoreMult || 1);
}

function finish(state, winner, method, events, reason = null) {
  if (state.over) return;
  state.over = { winner, method, reason, round: state.round, exchange: state.exchange };
  state.phase = "over";
  events.push({ kind: "finish", winner, method, reason });
}

/** A cutting blow just landed on `def`'s head. Opens the cut, or deepens it. Returns true when the doctor stops the fight. */
function cutOpens(state, att, def, events) {
  const c = state.rules.cut;
  if (state[def].cut >= c.doctorAt) {
    events.push({ kind: "doctor", side: def });
    finish(state, att, "TKO", events, "doctor");
    return true;
  }
  state[def].cut = Math.min(c.max, state[def].cut + 1);
  score(state, att, "striking", state.rules.score.cut * state[def].cut);
  events.push({ kind: "cut", side: def, level: state[def].cut });
  return false;
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
    const total = Math.min(state.rules.damage.limit, cardDamage(state, att, c) * tierMult * mult * swarm * (tactic(state, def).dmgIn || 1));
    if (total <= 0) continue;
    const hits = card.hits || 1;
    const dmg = total / hits;
    const target = card.target || "head";
    for (let k = 0; k < hits; k++) {
      state[def].hp = Math.max(0, state[def].hp - dmg);
      const morePips = passive(state, att).extraPips?.[target] || 0;
      if (morePips && state[def].pips[target] < state.rules.debuff.maxPips) showAbility(state, att, events);
      state[def].pips[target] = Math.min(state.rules.debuff.maxPips, state[def].pips[target] + 1 + morePips);
      score(state, att, "striking", dmg * state.rules.score.damage);
      events.push({ kind: "hit", attacker: att, target, damage: Math.round(dmg), tier, card: c, name: card.name });
      lastTarget = target;
      if (target === "head") headDamage += dmg;
      if (state[def].hp <= 0) {
        finish(state, att, !state.ground && lastTarget === "head" ? "KO" : "TKO", events);
        return true;
      }
    }
    if (tier !== "graze") queueSetups(state, att, [c], "hit");
    // Elbows open cuts on any clean hit; everything else needs a critical hit.
    if (target === "head" && (card.cut ? tier !== "graze" : tier === "crit") && cutOpens(state, att, def, events)) return true;
  }
  if (headDamage < state.rules.rocked.minDamage && tier !== "crit") return false;
  if (headDamage <= 0) return false;
  const r = state.rules.rocked;
  const chin = state[def].attrs.chin;
  if (wasRocked) {
    const p = clamp(r.flashKoBase + (r.chinPivot - chin) * r.flashKoPerChin + (r.flashKoHpPivot - state[def].hp) * r.flashKoPerHp + (tier === "crit" ? r.critBonus : 0) + (passive(state, att).rockedKoBonus || 0), r.min, r.max);
    if (nextUnit(state) < p) {
      if (passive(state, att).rockedKoBonus) showAbility(state, att, events);
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
  state.dist = state.rules.dist.standUp;
  events.push({ kind: "standup", reason, dist: state.dist });
}

function startLock(state, attacker, cardName, depth, events) {
  state.ground.lock = { attacker, name: cardName, depth };
  score(state, attacker, "grappling", state.rules.score.lockAttempt);
  events.push({ kind: "lockStart", attacker, name: cardName, depth });
}

/** Moves the shared distance and says so. Steps do nothing on the ground. */
function setDist(state, next, events, by) {
  if (state.ground) return;
  next = clampDist(state, next);
  if (next === state.dist) return;
  events.push({ kind: "range", dist: next, from: state.dist, by });
  state.dist = next;
}
const shiftDist = (state, delta, events, by) => delta && setDist(state, state.dist + delta, events, by);

function overcommit(state, loserCards, loser) {
  const extra = Math.max(0, (state.exchangeCost?.[loser] ?? costOf(state, loserCards, loser)) - 1);
  const d = state.rules.damage;
  // Getting caught on a shot hurts less than walking into a counter: the shooter is already moving under the punch.
  const rate = typeOfPlay(state, loserCards) === "G" ? d.shootOvercommit : d.overcommitPerEnergy;
  return 1 + extra * rate;
}

function winnerText(state, winType, loseType, ground, winnerSide, cards) {
  if (ground) {
    const role = ground.top === winnerSide ? "top" : "bottom";
    return `${state.rules.groundLabels[role][winType]}得手`;
  }
  const stepsOnly = cards.every((c) => state.cards[c].moveOnly);
  if (winType === "S") return "抓到他衝進來";
  if (winType === "C") return stepsOnly ? "閃開了" : "反擊成功";
  return stepsOnly ? "逼近了" : "摔進去了";
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

/** The fighter on the fence turns out of it. They end up in the middle, free. */
function escapeCage(state, w, events) {
  state.cage = null;
  state[w].pressure = 0;
  events.push({ kind: "cageEnd", side: w, how: "turn" });
  setDist(state, state.rules.cage.escapeDist, events, w);
}

/** The fighter on the fence shoves off and the two swap places: now the other one has his back to it. */
function pushOff(state, w, l, events) {
  const c = state.rules.cage;
  addStamina(state, l, -state.rules.grapple.drainOnLanding);
  state.cage = { side: l, ttl: c.ttl };
  state[l].pressure = c.pressureAt;
  state[w].pressure = 0;
  events.push({ kind: "cage", side: l, how: "push" });
  setDist(state, c.pushDist, events, w);
}

/**
 * Who is being pushed back? A fighter who keeps giving ground (backing off, or being run onto) ends up against the fence.
 * Ground given is read from the distance changes this exchange caused: closing costs the other fighter, retreating costs the retreater.
 */
function updateCage(state, events, types) {
  const c = state.rules.cage;
  if (state.ground) {
    state.cage = null;
    for (const s of SIDES) state[s].pressure = 0;
    return;
  }
  if (events.some((e) => e.kind === "cage" || e.kind === "cageEnd")) return;
  const gave = { a: false, b: false };
  for (const e of events) {
    if (e.kind !== "range" || !e.by) continue;
    if (e.dist > e.from) gave[opposite(e.by)] = true;
    else if (types[e.by] === "C") gave[e.by] = true;
    else gave[opposite(e.by)] = true; // pushed away by a strike
  }
  // Close in, a grapple that wins drives the other man back onto the fence even when no distance changes hands.
  const winnerType = types.a === types.b ? null : state.rules.triangle[types.a] === types.b ? "a" : "b";
  if (winnerType && types[winnerType] === "G" && state.dist >= state.rules.cage.closeDist) gave[opposite(winnerType)] = true;
  // Pressure builds each time ground is given and only drains when the other man gives ground back.
  for (const s of SIDES) {
    if (gave[s]) state[s].pressure += 1 + (tactic(state, opposite(s)).pressure || 0);
    else if (gave[opposite(s)]) state[s].pressure = Math.max(0, state[s].pressure - 1);
  }
  if (state.cage) {
    const pinned = state.cage.side;
    if (state.dist === 0) {
      state.cage = null;
      events.push({ kind: "cageEnd", side: pinned, how: "gap" });
    } else if (gave[pinned]) state.cage.ttl = c.ttl;
    else if (--state.cage.ttl <= 0) {
      state.cage = null;
      events.push({ kind: "cageEnd", side: pinned, how: "fade" });
    }
    return;
  }
  const side = SIDES.find((x) => gave[x] && state[x].pressure >= c.pressureAt);
  if (side && state.dist >= 1) {
    state.cage = { side, ttl: c.ttl };
    events.push({ kind: "cage", side, how: "pressure" });
  }
}

/**
 * Each fighter's ability is a list of triggers (rules/depth.json): "when X happened this exchange, do Y".
 * X: win / play / hit / takedown / moved, optionally narrowed by card type, start distance or body target.
 * Y: put a tag on themselves or the foe, drain stamina, shift the distance, add momentum.
 */
function applyAbilities(state, types, winner, startDist, startedOnGround, events) {
  for (const s of SIDES) {
    const ab = state.fighters[state[s].id].ability;
    if (!ab?.triggers) continue;
    let fired = false;
    for (const t of ab.triggers) {
      if (startedOnGround && t.on !== "takedown") continue;
      if (t.type && types[s] !== t.type) continue;
      if (t.dist && (startDist < t.dist[0] || startDist > t.dist[1])) continue;
      let ok = false;
      if (t.on === "win") ok = winner === s;
      else if (t.on === "play") ok = true;
      else if (t.on === "hit") ok = events.some((e) => e.kind === "hit" && e.attacker === s && e.tier !== "graze" && (!t.target || e.target === t.target));
      else if (t.on === "takedown") ok = events.some((e) => e.kind === "takedown" && e.side === s);
      else if (t.on === "moved") ok = events.some((e) => e.kind === "range" && e.by === s);
      if (!ok) continue;
      for (const d of t.do) {
        const to = d.to === "foe" ? opposite(s) : s;
        if (d.tag) queueMark(state, to, d.tag, d.turns || 1, d.stack, d.max);
        if (d.stamina) addStamina(state, to, d.stamina);
        if (d.momentum) addMomentum(state, to, d.momentum);
        if (d.dist && !state.ground) setDist(state, state.dist + d.dist, events, null);
      }
      fired = true;
    }
    if (fired) events.push({ kind: "ability", side: s, name: ab.name });
  }
}

function resolveStandingWin(state, w, l, plays, events) {
  const wCards = plays[w];
  const lCards = plays[l];
  const type = typeOfPlay(state, wCards);
  const sc = state.rules.score;
  const tier = rollTier(state, w, wCards);
  // Only the winner's steps happen. The loser's plan was stopped, so their steps are cancelled.
  if (type === "S") {
    const ended = dealHit(state, w, wCards, tier, state.rules.damage.winStrikeBonus * overcommit(state, lCards, l), events);
    if (ended) return;
    addStamina(state, l, -state.rules.stamina.whiffGrapple);
    shiftDist(state, moveOf(state, wCards), events, w);
    return;
  }
  if (type === "C") {
    const lockCard = wCards.find((c) => state.cards[c].lockAnywhere);
    const ended = dealHit(state, w, wCards, tier, state.rules.damage.counterMult * overcommit(state, lCards, l), events);
    if (ended) return;
    shiftDist(state, moveOf(state, wCards), events, w);
    if (wCards.some((c) => state.cards[c].cage === "turn")) escapeCage(state, w, events);
    if (lockCard) {
      state.ground = { top: l, pos: 0, lock: null };
      startLock(state, w, state.cards[lockCard].name, state.cards[lockCard].lockDepth || 1, events);
    }
    return;
  }
  // Grapple beats defend. Steps alone only close the gap.
  if (wCards.some((c) => state.cards[c].cage === "push")) {
    pushOff(state, w, l, events);
    return;
  }
  const takers = wCards.filter((c) => !state.cards[c].moveOnly);
  if (takers.length === 0) {
    const grab = wCards.reduce((sum, c) => sum + (state.cards[c].drain || 0), 0);
    if (grab) addStamina(state, l, -grab);
    const before = state.dist;
    shiftDist(state, moveOf(state, wCards), events, w);
    if (state.dist === state.rules.dist.clinch && before < state.dist) events.push({ kind: "clinch", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    return;
  }
  const drain = state.rules.grapple.drainOnLanding * overcommit(state, lCards, l);
  const main = takers.reduce((best, c) => ((state.cards[c].landing || 0) > (state.cards[best].landing || 0) ? c : best), takers[0]);
  const card = state.cards[main];
  addStamina(state, l, -drain - (card.drain || 0));
  if (wCards.some((c) => state.cards[c].pullGuard)) {
    state.ground = { top: l, pos: 0, lock: null };
    events.push({ kind: "pullGuard", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    return;
  }
  // A poor shot runs into a guillotine.
  const catcher = tier === "graze" ? lCards.find((c) => state.cards[c].catchShot) : null;
  if (catcher) {
    state.ground = { top: w, pos: 0, lock: null };
    events.push({ kind: "caught", side: l, name: state.cards[catcher].name });
    if (passive(state, l).lockDepthCatch) showAbility(state, l, events);
    startLock(state, l, state.cards[catcher].name, 1 + (passive(state, l).lockDepthCatch || 0), events);
    return;
  }
  const pos = (card.landing || 0) + state.rules.grapple.positionFromTier[tier];
  if (pos < 0) {
    setDist(state, state.rules.dist.clinch, events, w);
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
  const mult = overcommit(state, lCards, l);
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
    // A heavy top man (escapePenalty) makes every escape one grade worse.
    const grades = ["graze", "clean", "crit"];
    const eTier = grades[Math.max(0, grades.indexOf(tier) - (passive(state, l).escapePenalty || 0))];
    if (eTier !== tier) showAbility(state, l, events);
    if (eTier === "graze") events.push({ kind: "ride", side: l, held: true });
    else if (eTier === "clean" && g.pos > 0) setPosition(state, g.pos - 1, events, w);
    else if (eTier === "crit" && g.pos === 0) {
      g.top = w;
      score(state, w, "grappling", state.rules.score.takedown);
      events.push({ kind: "sweep", side: w, name: state.rules.positions[0] });
    } else standUp(state, events, "getup");
  } else {
    const lockCard = wCards.find((c) => state.cards[c].lockBottom);
    if (lockCard) {
      if (passive(state, w).lockDepthBottom) showAbility(state, w, events);
      startLock(state, w, state.cards[lockCard].name, (state.cards[lockCard].lockDepth || 1) + (passive(state, w).lockDepthBottom || 0), events);
      return;
    }
    const ended = wCards.length ? dealHit(state, w, wCards, tier, d.bottomCounterMult * mult, events) : false;
    if (!ended) setPosition(state, g.pos - 1, events, w);
  }
}

function resolveTrade(state, plays, events) {
  // Both land. The smaller commitment arrives first, and a rocking shot weakens the reply.
  const d = state.rules.damage;
  const costA = state.exchangeCost.a;
  const costB = state.exchangeCost.b;
  const rush = (s) => Object.entries(state[s].marks).some(([tag, m]) => state.rules.tags[tag]?.first && m.n >= state.rules.tags[tag].first);
  let first = "a";
  if (rush("a") !== rush("b")) first = rush("b") ? "b" : "a";
  else if (costB < costA) first = "b";
  else if (rush("a") === rush("b") && costB === costA && state.b.attrs.accuracy > state.a.attrs.accuracy) first = "b";
  const second = opposite(first);
  const groundMult = (s) => {
    if (!state.ground) return 1;
    return state.ground.top === s ? d.groundPositionMult[state.ground.pos] : d.bottomStrikeMult;
  };
  events.push({ kind: "trade", first });
  const tradeBonus = (side) => 1 + (passive(state, side).tradeBonus || 0);
  for (const side of SIDES) if (passive(state, side).tradeBonus) showAbility(state, side, events);
  const tierFirst = rollTier(state, first, plays[first]);
  if (dealHit(state, first, plays[first], tierFirst, d.tradeMult * groundMult(first) * tradeBonus(first), events)) return;
  // The first blow may have changed the distance, and the reply is thrown from wherever that left them.
  shiftDist(state, moveOf(state, plays[first]), events, first);
  const reply = [];
  let reach = state.dist;
  for (const c of plays[second]) {
    const card = state.cards[c];
    if (usableAt(state, card, reach, second)) {
      reply.push(c);
      if (!state.ground) reach = clampDist(state, reach + (card.move || 0));
    } else {
      events.push({ kind: "whiff", side: second, card: c, name: card.name });
    }
  }
  const interrupted = state[second].rocked && state[second].rockedAt === state.history.length;
  if (interrupted) events.push({ kind: "interrupted", side: second });
  if (reply.length) {
    const tierSecond = rollTier(state, second, reply);
    if (dealHit(state, second, reply, tierSecond, d.tradeMult * groundMult(second) * tradeBonus(second) * (interrupted ? d.tradeInterruptMult : 1), events)) return;
    shiftDist(state, moveOf(state, reply), events, second);
  }
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
  setDist(state, state.rules.dist.clinch, events, w);
  events.push({ kind: "scramble", winner: w, loser: l });
}

function resolveStandoff(state, plays, events) {
  // Nobody is committed, so both fighters' steps happen together.
  shiftDist(state, moveOf(state, plays.a) + moveOf(state, plays.b), events, null);
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
  if (state.pending) throw new Error("a pending choice has to be resolved first");
  for (const [s, cards] of [["a", playA], ["b", playB]]) {
    const err = playError(state, s, cards);
    if (err) throw new Error(`${s} illegal play: ${err} (${cards.join(",")})`);
  }
  const events = [];
  const order = (cards, s) => (cards.length ? arrange(state, cards, s) : ["brace"]);
  const plays = { a: order(playA, "a"), b: order(playB, "b") };
  const types = { a: typeOfPlay(state, plays.a), b: typeOfPlay(state, plays.b) };
  const tri = state.rules.triangle;
  const mirror = types.a === types.b;
  const winner = mirror ? null : tri[types.a] === types.b ? "a" : "b";
  const wasRocked = { a: state.a.rocked, b: state.b.rocked };
  const groundBefore = state.ground ? { ...state.ground } : null;
  const startDist = state.dist;
  const staminaCost = state.rules.stamina.perEnergy;
  const momentum = state.rules.momentum;
  state.exchangeCost = { a: costOf(state, plays.a, "a"), b: costOf(state, plays.b, "b") }; // priced before the blows change anything

  for (const s of SIDES) {
    addStamina(state, s, -state.exchangeCost[s] * staminaCost);
    if (plays[s].some((c) => state.cards[c].signature)) {
      addMomentum(state, s, -momentum.signatureCost);
      events.push({ kind: "signature", side: s, name: state.cards[plays[s][0]].name });
    }
  }
  events.unshift({ kind: "reveal", a: plays.a, b: plays.b, types, winner, ground: groundBefore, dist: state.dist, cost: { ...state.exchangeCost } });

  if (winner) {
    const l = opposite(winner);
    addMomentum(state, winner, momentum.win);
    addMomentum(state, l, momentum.lose);
    score(state, winner, types[winner] === "G" ? "grappling" : "striking", state.rules.score.exchangeWin);
    events.push({ kind: "verdict", winner, type: types[winner], text: winnerText(state, types[winner], types[l], state.ground, winner, plays[winner]) });
    queueSetups(state, winner, plays[winner], "win");
  } else {
    events.push({ kind: "verdict", winner: null, type: types.a, text: types.a === "S" ? "對轟" : types.a === "G" ? "互相扭抱" : "誰都不動" });
  }

  if (state.ground?.lock) resolveLock(state, winner, plays, events);
  else if (winner) {
    if (state.ground) resolveGroundWin(state, winner, opposite(winner), plays, events);
    else resolveStandingWin(state, winner, opposite(winner), plays, events);
  } else if (types.a === "S") resolveTrade(state, plays, events);
  else if (types.a === "G") resolveScramble(state, events);
  else resolveStandoff(state, plays, events);

  const onClinch = state.rules.setups?.clinch;
  if (onClinch) {
    for (const e of events) {
      const side = e.kind === "clinch" ? e.side : e.kind === "scramble" ? e.winner : null;
      if (side) queueMark(state, side, onClinch.tag, onClinch.turns || 1);
    }
  }
  if (types.a !== "C" || types.b !== "C") state.stall = 0;

  state.history.push(types);
  if (!state.over) applyAbilities(state, types, winner, startDist, Boolean(groundBefore), events);
  if (!state.over) updateCage(state, events, types);
  endExchange(state, plays, types, wasRocked, events);
  state.exchangeCost = null;
  // Whoever just took the other man down chooses whether to follow him to the ground.
  const down = events.find((e) => e.kind === "takedown");
  if (down && !state.over && state.phase === "exchange" && state.ground) state.pending = { kind: "chase", side: down.side };
  return events;
}

function endExchange(state, plays, types, wasRocked, events) {
  if (state.over) return;
  settleMarks(state, events);
  const st = state.rules.stamina;
  for (const s of SIDES) {
    const me = state[s];
    // A fighter who was rocked coming in recovers unless they were rocked again this exchange.
    if (wasRocked[s] && me.rocked && me.rockedAt !== state.history.length - 1) me.rocked = false;
    let regen = st.regenPerExchange + ((me.attrs.cardio - 70) / 30) * st.cardioRegenBonus;
    if (types[s] === "C") regen += st.counterRegen;
    regen += tactic(state, s).regen || 0;
    if (me.pips.body >= state.rules.debuff.threshold) regen += st.bodyDebuffRegen;
    addStamina(state, s, regen);
    // Played cards go to the discard pile. Bracing and signatures are not deck cards.
    for (const c of plays[s]) {
      const i = me.hand.indexOf(c);
      if (i >= 0) me.hand.splice(i, 1);
      if (!state.cards[c].signature && !state.cards[c].basic && c !== "brace") me.discard.push(c);
    }
    refillHand(state, s);
  }
  if (state.ground) score(state, state.ground.top, "grappling", state.rules.score.controlPerPosition * (state.ground.pos + 1));

  if (state.exchange >= state.perRound) endRound(state, events);
  else state.exchange += 1;
}

function endRound(state, events) {
  const s = state.rules.score;
  const judges = s.judges.map((j) => {
    const perf = (side) => state.roundScore[side].striking * j.striking + state.roundScore[side].grappling * j.grappling;
    const gap = perf("a") - perf("b");
    const loserScore = Math.abs(gap) >= s.tenEightPerExchange * state.perRound ? 8 : 9;
    if (Math.abs(gap) < 0.5) return { a: 10, b: 10 };
    return gap > 0 ? { a: 10, b: loserScore } : { a: loserScore, b: 10 };
  });
  state.roundCards.push({ round: state.round, judges, score: state.roundScore });
  events.push({ kind: "roundEnd", round: state.round, judges });
  state.roundScore = freshScore();
  for (const side of SIDES) {
    state[side].marks = {};
    state[side].pressure = 0;
  }
  state.cage = null;
  state.a.rocked = false;
  state.b.rocked = false;
  // The cutman works on the cut between rounds.
  for (const side of SIDES) state[side].cut = Math.max(0, state[side].cut - state.rules.cut.roundHeal);
  state.ground = null;
  state.dist = state.rules.dist.start;
  state.stall = 0;
  if (state.round >= state.rounds) decide(state, events);
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
export function applyCorner(state, choices, tactics = {}) {
  if (state.phase !== "corner") throw new Error("not in corner");
  const st = state.rules.stamina;
  for (const s of SIDES) {
    const me = state[s];
    addStamina(state, s, st.cornerBase + me.attrs.cardio * st.cornerCardio);
    const opt = state.rules.corner.options.find((o) => o.id === choices[s]);
    if (!opt) throw new Error(`unknown corner option ${choices[s]}`);
    if (opt.stamina) addStamina(state, s, opt.stamina);
    if (opt.momentum) addMomentum(state, s, opt.momentum);
    if (opt.hp) me.hp = Math.min(state.maxHp, me.hp + opt.hp);
    if (opt.clearCut) me.cut = Math.max(0, me.cut - opt.clearCut);
    if (opt.clearPip) {
      const worst = Object.keys(me.pips).reduce((a, b) => (me.pips[a] >= me.pips[b] ? a : b));
      me.pips[worst] = Math.max(0, me.pips[worst] - opt.clearPip);
    }
    refillHand(state, s);
  }
  state.round += 1;
  state.exchange = 1;
  state.phase = "exchange";
  for (const s of SIDES) setTactic(state, s, tactics[s] ?? chooseTactic(state, s));
}

// ---------- Invariants ----------

export function checkInvariants(state) {
  const errors = [];
  const m = state.rules.match;
  for (const s of SIDES) {
    const me = state[s];
    if (!(me.hp >= 0 && me.hp <= state.maxHp)) errors.push(`${s}.hp ${me.hp}`);
    if (!(me.stamina >= 0 && me.stamina <= m.maxStamina)) errors.push(`${s}.stamina ${me.stamina}`);
    if (!(me.momentum >= 0 && me.momentum <= m.maxMomentum)) errors.push(`${s}.momentum ${me.momentum}`);
    const f = state.fighters[me.id];
    const deckCards = me.hand.filter((c) => c !== f.signature && !state.cards[c].basic).length + me.draw.length + me.discard.length;
    if (deckCards !== f.deck.length) errors.push(`${s} deck size ${deckCards} != ${f.deck.length}`);
    if (!(Number.isInteger(me.cut) && me.cut >= 0 && me.cut <= state.rules.cut.max)) errors.push(`${s}.cut ${me.cut}`);
    for (const step of BASIC_STEPS) if (!me.hand.includes(step)) errors.push(`${s} missing ${step}`);
  }
  if (state.ground) {
    if (state.ground.pos < 0 || state.ground.pos >= state.rules.positions.length) errors.push(`pos ${state.ground.pos}`);
    if (!SIDES.includes(state.ground.top)) errors.push("ground.top");
  }
  if (!Number.isInteger(state.dist) || state.dist < 0 || state.dist >= state.rules.dist.names.length) errors.push(`dist ${state.dist}`);
  if (state.phase === "over" && !state.over) errors.push("over without result");
  if (state.cage && (!SIDES.includes(state.cage.side) || state.ground)) errors.push("cage state");
  return errors;
}
