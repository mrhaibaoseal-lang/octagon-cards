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
export function loadData({ rules, cards, fighters, depth = {}, ground = {} }) {
  const merged = { rules, cards: { ...cards, ...(ground.cards || {}) }, fighters: { ...fighters } };
  for (const [id, extra] of Object.entries(depth.cards || {})) merged.cards[id] = { ...merged.cards[id], ...extra };
  // Ground decks (rules/ground.json). A fighter without one gets the default deck, so a new roster entry never breaks the ground game.
  for (const id of Object.keys(merged.fighters)) {
    const g = ground.fighters?.[id] || {};
    merged.fighters[id] = { ...merged.fighters[id], groundDeck: g.groundDeck || ground.defaultDeck || [], lockMix: g.lockMix || null };
  }
  for (const [id, extra] of Object.entries(depth.fighters || {})) {
    const base = merged.fighters[id];
    if (!base) continue;
    const { deckSwap = [], deck: fixedDeck, ...rest } = extra;
    // M1.4: a fighter's deck is only his special moves; the basic moves everyone has come from rules.match.basics.
    const deck = fixedDeck ? [...fixedDeck] : [...base.deck];
    for (const [from, to] of deckSwap) {
      const i = deck.indexOf(from);
      if (i >= 0) deck[i] = to;
      else deck.push(to);
    }
    merged.fighters[id] = { ...base, ...rest, deck };
  }
  // Where a stand-up card lands decides what guards it: the target gives the height, a grab is its own height.
  const byTarget = { head: "high", body: "mid", legs: "low" };
  for (const [id, c] of Object.entries(merged.cards)) {
    if (c.cat || c.lockMove || c.height) continue;
    const height = c.type === "G" ? "grab" : byTarget[c.target];
    if (height) merged.cards[id] = { ...c, height };
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
    engage: null, // the stand-up hand in progress once the footwork is in: { leader, resp, combo, plan, ... }
    edge: null, // { side }: who came out of the last hand on top; they lead the next one unless the footwork says otherwise
    guardStreak: null, // { side, n }: how many hands in a row a fighter has blocked a combo
    fwHist: [], // every pair of footwork picks, for the AI to read habits from
    respHist: { a: [], b: [] }, // what each side answered with (guard height or response kind)
    leadHist: { a: [], b: [] }, // the height each side led with
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
    shuffle(state, state[s].gdraw);
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
    // The ground game has its own deck. On the mat `hand` holds ground cards and the stand-up hand waits in `stand`.
    gdraw: [...(f.groundDeck || [])],
    gdiscard: [],
    stand: null,
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

const isBasic = (state, c) => Boolean(state.cards[c].basic);


// ---------- Ground hand ----------

/** "top" or "bottom" for a fighter on the mat. */
export const roleOf = (state, s) => (state.ground.top === s ? "top" : "bottom");
const GROUND_CATS = (state) => state.rules.ground.cats;
/** The kind of a ground play: a card's category, or the free option (hold on top, cover underneath) for an empty play. */
export function groundCatOf(state, s, cards) {
  if (cards.length) return state.cards[cards[0]].cat || state.cards[cards[0]].lockMove;
  return roleOf(state, s) === "top" ? "hold" : "cover";
}
/** Can this ground card be thrown by `s` from where the mat stands now? */
function groundCardUsable(state, s, card) {
  if (!card.cat) return false;
  if (state.ground.lock) return false;
  const cat = GROUND_CATS(state)[card.cat];
  return cat.side === roleOf(state, s) && state.ground.pos >= card.pos[0] && state.ground.pos <= card.pos[1];
}
/** The three attack or defence moves of a lock fight, as hand cards. */
function lockHand(state, s) {
  const side = state.ground.lock.attacker === s ? "attack" : "defend";
  return Object.keys(state.cards).filter((c) => state.cards[c].lockSide === side);
}

/**
 * On the mat a fighter holds ground cards only (the stand-up hand is kept aside). Cards that still work stay; the rest go back,
 * and the hand is topped up so that every kind of play this role has here (punch / pass / lock, or frame / counter / escape) is in it.
 * In a lock fight the hand is the three attack or defence moves.
 */
function refillGround(state, s) {
  const me = state[s];
  if (!me.stand) {
    me.stand = me.hand;
    me.hand = [];
  }
  if (state.ground.lock) {
    me.gdraw.push(...me.hand.filter((c) => state.cards[c].cat));
    me.hand = lockHand(state, s);
    return;
  }
  const keep = me.hand.filter((c) => groundCardUsable(state, s, state.cards[c]));
  me.gdraw.push(...me.hand.filter((c) => state.cards[c].cat && !keep.includes(c)));
  const hand = keep;
  const take = (pred) => {
    let i = me.gdraw.findIndex(pred);
    if (i < 0 && me.gdiscard.length) {
      me.gdraw = shuffle(state, me.gdraw.concat(me.gdiscard));
      me.gdiscard = [];
      i = me.gdraw.findIndex(pred);
    }
    return i < 0 ? null : me.gdraw.splice(i, 1)[0];
  };
  const role = roleOf(state, s);
  const usable = (c) => groundCardUsable(state, s, state.cards[c]);
  for (const [cat, def] of Object.entries(GROUND_CATS(state))) {
    if (def.side !== role || def.free || hand.some((c) => state.cards[c].cat === cat)) continue;
    const c = take((x) => usable(x) && state.cards[x].cat === cat);
    if (c) hand.push(c);
  }
  while (hand.length < state.rules.ground.handSize) {
    const c = take(usable);
    if (!c) break;
    hand.push(c);
  }
  const order = Object.keys(GROUND_CATS(state));
  hand.sort((x, y) => order.indexOf(state.cards[x].cat) - order.indexOf(state.cards[y].cat) || state.cards[x].cost - state.cards[y].cost);
  me.hand = hand;
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
  if (state.ground) {
    // On the mat only ground cards work, and only the ones that fit this role and position. In a lock fight only the lock moves.
    if (card.lockMove) return Boolean(state.ground.lock) && (!s || card.lockSide === (state.ground.lock.attacker === s ? "attack" : "defend"));
    return Boolean(s) && groundCardUsable(state, s, card);
  }
  if (card.cat || card.lockMove) return false;
  // A fighter against the fence has nowhere to back off to.
  if (s && state.cage?.side === s && card.move < 0) return false;
  return !card.range || (d >= card.range[0] && d <= card.range[1]);
}





function tierOdds(state, s, cards, extra = 0) {
  const t = state.rules.tiers;
  const me = state[s];
  const opp = state[opposite(s)];
  const type = typeOfPlay(state, cards);
  let diff;
  if (type === "G") diff = (state.ground && state.ground.top !== s ? (me.attrs.wrestling + me.attrs.submission) / 2 : me.attrs.wrestling) - opp.attrs.grappleDef;
  else diff = me.attrs.accuracy - opp.attrs.accuracy;
  let bonus = extra;
  for (const c of cards) {
    const card = state.cards[c];
    bonus += card.crit || 0;
    bonus += card.quality || 0;
    if (card.signature) bonus += state.rules.signature.winCrit;
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

function rollTier(state, s, cards, extra = 0) {
  const odds = tierOdds(state, s, cards, extra);
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


/**
 * When the man in the lock guesses wrong the lock does not always sink: he can still hold on. The chance is his skill (submission and
 * takedown defence) against the attacker's, less the deeper the lock already is, less when he is gassed. The screen shows it, and a
 * human defender plays it out as a timing bar (`resist` in the options of resolveExchange); the AI is simply rolled.
 */
export function lockResistChance(state) {
  const lock = state.ground?.lock;
  if (!lock) return 0;
  const r = state.rules.lock.resist;
  const atk = state[lock.attacker];
  const def = state[opposite(lock.attacker)];
  const skill = (def.attrs.submission + def.attrs.grappleDef) / 2;
  let p = r.base + (skill - 75) * r.perSkill - (atk.attrs.submission - 75) * r.perAttacker - (lock.depth - 1) * r.perDepth;
  if (def.stamina < state.rules.lock.lowStaminaAt) p += r.lowStamina;
  return clamp(p, r.min, r.max);
}

/** Would these two lock moves be a wrong guess by the defender (so that he has to resist)? For the screen to know when to ask. */
export function lockGuessWrong(state, playA, playB) {
  const lock = state.ground?.lock;
  if (!lock || !playA.length || !playB.length) return false;
  const plays = { a: playA, b: playB };
  const atk = lock.attacker;
  return state.rules.lock.beats[state.cards[plays[atk][0]].lockMove] !== state.cards[plays[opposite(atk)][0]].lockMove;
}

/** Where a lock fight stands: the stage (1 to tapDepth - 1; reaching tapDepth is the tap), who holds it and what it is called. */
export function lockStatus(state) {
  const lock = state.ground?.lock;
  if (!lock) return null;
  return { attacker: lock.attacker, name: lock.name, depth: lock.depth, tapDepth: state.rules.lock.tapDepth };
}


/** "任何位置", "騎乘" or "半防守~側控" for a ground card. */
export function posText(state, card) {
  const names = state.rules.positions;
  if (!card.pos || (card.pos[0] === 0 && card.pos[1] === names.length - 1)) return "";
  return card.pos[0] === card.pos[1] ? names[card.pos[0]] : `${names[card.pos[0]]}~${names[card.pos[1]]}`;
}

/** "近距", "中~近距" or "" for a card that works anywhere. */
export function rangeText(state, card) {
  const r = card.range;
  const short = state.rules.dist.short;
  if (!r || (r[0] === 0 && r[1] === short.length - 1)) return "";
  return r[0] === r[1] ? `${short[r[0]]}距` : `${short[r[0]]}~${short[r[1]]}距`;
}

// ---------- AI ----------



/** How far outside their comfortable range a fighter stands (0 when inside it). */
function distGap(state, s, d) {
  const [lo, hi] = state.fighters[state[s].id].prefer;
  return d < lo ? lo - d : d > hi ? d - hi : 0;
}

// ---------- Ground AI ----------

/** Who comes out ahead when the man on top plays `top` and the man underneath plays `bottom`: "top", "bottom" or "none". */
export const groundOutcome = (state, top, bottom) => state.rules.ground.matrix[top][bottom];

/** The plays that beat `oppCat` for a fighter in `role`. Empty when nothing does. */
export function groundWinners(state, role, oppCat) {
  const cats = state.rules.ground.cats;
  const own = Object.keys(cats).filter((c) => cats[c].side === role);
  if (!cats[oppCat] || cats[oppCat].side === role) return [];
  return own.filter((c) => (role === "top" ? groundOutcome(state, c, oppCat) === "top" : groundOutcome(state, oppCat, c) === "bottom"));
}

function catAvailable(state, s, cat) {
  const def = state.rules.ground.cats[cat];
  if (def.free) return true;
  const b = budget(state, s);
  return state[s].hand.some((c) => state.cards[c].cat === cat && cardCost(state, s, c) <= b && usableAt(state, state.cards[c], state.dist, s));
}

/** The tendencies of a fighter on the mat. Same shape as the stand-up intent, but keyed by the ground plays (or lock moves). */
function groundIntent(state, s) {
  const R = state.rules;
  const ai = R.ai;
  const g = state.ground;
  const me = state[s];
  const oppSide = opposite(s);
  const f = state.fighters[me.id];
  const plan = tactic(state, s);
  const tags = [];
  const w = {};
  let ids;
  let labels;
  let typeOf;
  let kind;
  let readBoost = 1;
  for (const tag of Object.keys(state[oppSide].marks)) readBoost *= R.tags[tag]?.readBoost || 1;
  const window = ai.adapt.window;
  if (g.lock) {
    const attacking = g.lock.attacker === s;
    kind = attacking ? "attack" : "defend";
    ids = attacking ? Object.keys(R.lock.beats) : Object.values(R.lock.beats);
    labels = attacking ? R.lock.attack : R.lock.defend;
    typeOf = Object.fromEntries(ids.map((id, i) => [id, ["S", "G", "C"][i]]));
    const mix = attacking ? ids.map((id) => f.lockMix?.[id] ?? 1) : ids.map(() => 1);
    const sum = mix.reduce((a, b) => a + b, 0);
    ids.forEach((id, i) => { w[id] = mix[i] / sum; });
    const recent = (g.lock.hist || []).slice(-window).map((h) => h[oppSide]);
    // The defender reads the attacker's habits; an attacker steers clear of the move the defender keeps expecting.
    const shift = (move, amount) => {
      if (attacking) {
        const k = ids.find((x) => R.lock.beats[x] === move);
        w[k] = Math.max(0, w[k] - amount);
      } else w[R.lock.beats[move]] += amount;
    };
    for (const m of recent) shift(m, ai.adapt.perMatch * readBoost);
    if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
      shift(recent[recent.length - 1], ai.adapt.repeatBonus);
      tags.push(attacking ? "他在避開你的老招" : "看穿你的習慣");
    }
  } else {
    const role = roleOf(state, s);
    kind = role;
    const cats = R.ground.cats;
    ids = Object.keys(cats).filter((c) => cats[c].side === role);
    labels = Object.fromEntries(ids.map((c) => [c, cats[c].label]));
    typeOf = Object.fromEntries(ids.map((c) => [c, cats[c].type]));
    const style = f.style[role];
    const st = { S: style.S + (plan.style?.S || 0), G: style.G + (plan.style?.G || 0), C: style.C + (plan.style?.C || 0) };
    if (role === "top") {
      const lockW = st.G * R.ground.lockShare * (0.5 + me.attrs.submission / 100);
      Object.assign(w, { punch: st.S, pass: st.G * (1 - R.ground.lockShare), lock: lockW, hold: st.C });
      if (g.pos >= 3) { w.lock *= 1.4; tags.push("占了高位，想找鎖技"); }
    } else {
      Object.assign(w, { escape: st.G * 0.6, frame: st.G * 0.4, counter: st.S + st.C * 0.5, cover: st.C * 0.5 });
    }
    const free = ids.find((c) => cats[c].free);
    if (me.rocked) { w[free] += ai.rockedCounter; tags.push("被打暈，想撐過去"); }
    if (state[oppSide].rocked && role === "top") { w.punch += ai.swarmStrike; tags.push("要衝上來追擊"); }
    if (me.stamina < ai.lowStaminaAt) { w[free] += ai.lowStaminaCounter; tags.push("快沒力了"); }
    const recent = (g.hist || []).slice(-window).map((h) => h[oppSide]);
    const lean = (cat, amount) => {
      const wins = groundWinners(state, role, cat);
      for (const c of wins) w[c] += amount / wins.length;
    };
    for (const c of recent) lean(c, ai.adapt.perMatch * readBoost);
    if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
      lean(recent[recent.length - 1], ai.adapt.repeatBonus);
      tags.push("看穿你的習慣");
    }
  }
  for (const [tag] of Object.entries(me.marks)) {
    const def = R.tags[tag];
    if (!def?.sharpen) continue;
    for (const id of ids) w[id] = w[id] ** def.sharpen;
    tags.push(def.label);
  }
  for (const id of ids) {
    const open = g.lock ? true : catAvailable(state, s, id);
    w[id] = open ? Math.max(w[id], ai.minWeight) : 0;
  }
  const total = ids.reduce((sum, id) => sum + w[id], 0);
  const probs = Object.fromEntries(ids.map((id) => [id, w[id] / total]));
  const top = ids.reduce((best, id) => (probs[id] > probs[best] ? id : best), ids[0]);
  const tells = ai.tells[typeOf[top]];
  return {
    ground: true,
    kind,
    options: ids.map((id) => ({ id, label: labels[id], type: typeOf[id] })),
    probs,
    top,
    tell: tells[(state.round * 7 + state.exchange * 3) % tells.length],
    tags,
    blind: state[oppSide].cut >= R.cut.blindAt,
    signatureReady: false,
  };
}






/** Rough worth of a ground card, used to pick between cards of the kind that was chosen. */
function groundCardValue(state, s, cardId) {
  const card = state.cards[cardId];
  const top = roleOf(state, s) === "top";
  const gm = top ? state.rules.damage.groundPositionMult[state.ground.pos] : 1;
  if (card.cat === "punch") return cardDamage(state, s, cardId) * gm + (card.cut ? 2 : 0);
  if (card.cat === "pass") return card.cost + (card.quality || 0) * 4 + (card.advanceBonus || 0) * 3;
  if (card.cat === "lock") return 4 + card.cost + (card.quality || 0) * 4;
  if (card.cat === "counter") return cardDamage(state, s, cardId) + (card.lockBottom ? 8 : 0) + (card.crit || 0) * 10;
  return card.cost + (card.crit || 0) * 10; // frame, escape
}

/** The best usable card of one ground kind within `limit` energy, or null. */
export function bestGroundCard(state, s, cat, limit) {
  let best = null;
  let bestValue = -Infinity;
  for (const c of state[s].hand) {
    const card = state.cards[c];
    if (card.cat !== cat || cardCost(state, s, c) > limit || !usableAt(state, card, state.dist, s)) continue;
    const v = groundCardValue(state, s, c);
    if (v > bestValue) {
      bestValue = v;
      best = c;
    }
  }
  return best;
}

/** Samples one option from the shown ground tendencies. */
export function sampleGround(state, intent) {
  let r = nextUnit(state);
  for (const o of intent.options) {
    r -= intent.probs[o.id];
    if (r < 0) return o.id;
  }
  return intent.options[intent.options.length - 1].id;
}

function chooseGroundAI(state, s) {
  const ai = state.rules.ai;
  const me = state[s];
  const intent = getIntent(state, s);
  const pick = sampleGround(state, intent);
  if (state.ground.lock) return { cards: [me.hand.find((c) => state.cards[c].lockMove === pick)] };
  if (state.rules.ground.cats[pick].free) return { cards: [] };
  const b = budget(state, s);
  let limit = nextUnit(state) < ai.commit.fullChance + (tactic(state, s).commit || 0) ? b : Math.max(1, b - 1);
  if (me.stamina < ai.commit.conserveAt) limit = Math.min(limit, 2);
  const legal = me.hand.filter((c) => state.cards[c].cat === pick && usableAt(state, state.cards[c], state.dist, s)).map((c) => cardCost(state, s, c));
  limit = Math.min(b, Math.max(limit, Math.min(...legal)));
  return { cards: [bestGroundCard(state, s, pick, limit)] };
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

// ---------- Standing fight (M1.4a) ----------
// One hand = three steps. 1) both pick a footwork at once; the pair decides who leads, the new distance and small edges for each side.
// 2) the leader lays out a combo (1 to 4 cards, face down) and the other side picks a response. 3) the cards turn over one at a time:
// a card slower than the responder's reaction is seen and can be answered on the spot, a faster one only meets what he bet beforehand.

const FWR = (state) => state.rules.footwork;
const ENG = (state) => state.rules.engage;
export const HEIGHTS = ["high", "mid", "low", "grab"];
const GUARDS = ["high", "mid", "low"];
const RESPONSES = ["high", "mid", "low", "cover", "evade", "counter", "shoot", "preempt"];
const fighterOf = (state, s) => state.fighters[state[s].id];

/** "footwork" while the two have yet to pick a step, "lead" once the hand has a leader, "ground" on the mat. */
export const stepOf = (state) => (state.ground ? "ground" : state.engage ? "lead" : "footwork");

/** Sum of a numeric field over a fighter's live tags (each tag may need a stack level, `<key>At`). */
function tagSum(state, s, key) {
  let v = 0;
  for (const [tag, m] of Object.entries(state[s].marks)) {
    const def = state.rules.tags[tag] || {};
    if (def[key] && m.n >= (def[`${key}At`] || 1)) v += def[key];
  }
  return v;
}

/** How quick his hands are right now: the fighter's own speed, a rhythm bonus, less when tired. */
export function handSpeed(state, s) {
  const me = state[s];
  const e = state.rules.energy;
  const tired = me.stamina < e.gassedAt ? 14 : me.stamina < e.tiredAt ? 6 : 0;
  return (fighterOf(state, s).speed ?? 75) + tagSum(state, s, "speed") - tired;
}

/** Reaction: a card quicker than this cannot be seen coming. A stunned fighter sees nothing; blood in the eyes and a gassed body cost some. */
export function reactionOf(state, s) {
  const me = state[s];
  if (me.rocked) return 0;
  const r = ENG(state).reaction;
  const e = state.rules.energy;
  let v = fighterOf(state, s).reaction ?? 75;
  if (me.stamina < e.gassedAt) v += r.gassed;
  else if (me.stamina < e.tiredAt) v += r.tired;
  if (me.cut >= state.rules.cut.blindAt) v += r.blind;
  if (state.engage) v += state.engage.mods?.[s]?.react || 0;
  return v;
}

/** Speed of a card when this fighter throws it. */
export function cardSpeed(state, s, cardId) {
  const sp = ENG(state).speedAttr;
  return state.cards[cardId].speed + (handSpeed(state, s) - sp.pivot) * sp.perPoint;
}

/** Stamina a card takes out of the fighter standing. */
export const standCost = (state, cardId) => state.cards[cardId].cost * ENG(state).perCost;

/** How many cards the leader can string together: more stamina, longer combo; stunned, one; rhythm and smothering move it. */
export function comboMax(state, s) {
  const me = state[s];
  let n = ENG(state).comboLen.find(([min]) => me.stamina >= min)[1];
  if (me.rocked) return 1;
  n += tagSum(state, s, "combo");
  if (isFinal(state)) n += 1;
  return clamp(n, 1, 5);
}

const modOf = (state, s, key, fallback = 0) => state.engage?.mods?.[s]?.[key] ?? fallback;

// ---------- Footwork ----------

/** The four steps with their state for this fighter: against the fence nobody can back off. */
export function footworkChoices(state, s) {
  const R = FWR(state);
  return R.order.map((id) => {
    const m = R.moves[id];
    const penned = id === "retreat" && state.cage?.side === s;
    return { id, ...m, disabled: penned, reason: penned ? "背靠籠子" : "" };
  });
}

/** What a pair of steps does, seen from side a: who leads (or "roll"), the distance change, who gives ground and each side's edges. */
export function footworkOutcome(state, fa, fb) {
  const R = FWR(state);
  const swap = R.order.indexOf(fa) > R.order.indexOf(fb);
  const key = swap ? `${fb}|${fa}` : `${fa}|${fb}`;
  const row = R.pairs[key];
  if (!row) throw new Error(`no footwork row ${key}`);
  const mk = (m = {}) => ({ power: 1, dmgIn: 1, evade: 0, counterSpeed: 0, crit: 0, react: 0, stam: 0, ...m });
  const first = mk(row.a);
  const second = mk(row.b);
  let lead = row.lead;
  if (lead === "first") lead = swap ? "b" : "a";
  else if (lead === "second") lead = swap ? "a" : "b";
  const gave = { a: false, b: false };
  if (row.gave === "first") gave[swap ? "b" : "a"] = true;
  if (row.gave === "second") gave[swap ? "a" : "b"] = true;
  const bias = row.bias || 0;
  return { key, dist: row.dist, lead, biasA: swap ? -bias : bias, gave, mods: swap ? { a: second, b: first } : { a: first, b: second }, text: row.text };
}

/** How quick to the punch: speed, a taller man's reach and a bit of momentum. */
function initiative(state, s) {
  const L = FWR(state).leadRoll;
  return handSpeed(state, s) + ((fighterOf(state, s).height || 175) - 175) * L.perHeight + state[s].momentum * L.perMomentum;
}

/** Chance that side a leads when the pair of steps does not decide it. A fighter who just came out on top has the edge. */
export function leadChance(state, biasA = 0) {
  const L = FWR(state).leadRoll;
  let p = 0.5 + (initiative(state, "a") - initiative(state, "b")) * L.perInit + biasA;
  if (state.edge) p += state.edge.side === "a" ? L.edge : -L.edge;
  return clamp(p, L.min, L.max);
}

/** For the screen: what each of his possible steps would do against `mine`, with his real chance of picking it. */
export function previewFootwork(state, s, mine) {
  const opp = opposite(s);
  const intent = footworkIntent(state, opp);
  return FWR(state).order.map((his) => {
    const out = footworkOutcome(state, s === "a" ? mine : his, s === "a" ? his : mine);
    const pYou = out.lead === "roll" ? (s === "a" ? leadChance(state, out.biasA) : 1 - leadChance(state, out.biasA)) : out.lead === s ? 1 : 0;
    return {
      his,
      prob: intent.probs[his] || 0,
      pYouLead: pYou,
      dist: clampDist(state, state.dist + out.dist),
      mine: out.mods[s],
      theirs: out.mods[opp],
      youGiveGround: out.gave[s],
      heGivesGround: out.gave[opp],
      text: out.text,
    };
  });
}

function applyEffects(state, s, list, events) {
  for (const d of list) {
    const to = d.to === "foe" ? opposite(s) : s;
    if (d.tag) queueMark(state, to, d.tag, d.turns || 1, d.stack, d.max);
    if (d.stamina) addStamina(state, to, d.stamina);
    if (d.momentum) addMomentum(state, to, d.momentum);
    if (d.dist) setDist(state, state.dist + d.dist, events, null);
  }
}

/** Each fighter's ability triggers, standing version: `ctx.on(t, s)` says whether trigger `t` fired for side `s`. */
function runStandingAbilities(state, ctx, events) {
  for (const s of SIDES) {
    const ab = state.fighters[state[s].id].ability;
    if (!ab?.triggers) continue;
    let fired = false;
    for (const t of ab.triggers) {
      if (t.ground || !STANDING_ON.includes(t.on)) continue;
      if (t.dist && (ctx.startDist < t.dist[0] || ctx.startDist > t.dist[1])) continue;
      if (!ctx.on(t, s)) continue;
      applyEffects(state, s, t.do, events);
      fired = true;
    }
    if (fired) events.push({ kind: "ability", side: s, name: ab.name });
  }
}
const STANDING_ON = ["footwork", "lead", "counter", "comboDone", "block", "evade", "hit", "takedown", "grab", "play"];

/** Pressure from giving ground and the way out of it: a fighter against the fence who circles off gets away unless the other presses. */
function updateCageFw(state, out, fw, events) {
  const c = state.rules.cage;
  if (state.cage) {
    const pinned = state.cage.side;
    if (fw[pinned] === "circle" && fw[opposite(pinned)] !== "press") {
      state.cage = null;
      state[pinned].pressure = 0;
      events.push({ kind: "cageEnd", side: pinned, how: "turn" });
      setDist(state, c.escapeDist, events, pinned);
      return;
    }
  }
  const gave = out.gave;
  for (const s of SIDES) {
    if (gave[s]) state[s].pressure += 1 + (tactic(state, opposite(s)).pressure || 0);
    else if (gave[opposite(s)]) state[s].pressure = Math.max(0, state[s].pressure - 1);
  }
  if (state.cage) {
    const pinned = state.cage.side;
    if (gave[pinned]) state.cage.ttl = c.ttl;
    else if (--state.cage.ttl <= 0) {
      state.cage = null;
      events.push({ kind: "cageEnd", side: pinned, how: "fade" });
    }
    return;
  }
  const side = SIDES.find((x) => gave[x] && state[x].pressure >= c.pressureAt);
  if (side) {
    state.cage = { side, ttl: c.ttl };
    score(state, opposite(side), "striking", c.pressureScore);
    events.push({ kind: "cage", side, how: "pressure" });
  }
}

/** Both fighters' steps, at once. Sets the distance and who leads, and opens the hand (`state.engage`). */
export function resolveFootwork(state, fa, fb) {
  if (state.phase !== "exchange") throw new Error(`cannot resolve in phase ${state.phase}`);
  if (state.pending) throw new Error("a pending choice has to be resolved first");
  if (state.ground) throw new Error("no footwork on the mat");
  if (state.engage) throw new Error("this hand already has its footwork");
  const fw = { a: fa, b: fb };
  for (const s of SIDES) {
    const ch = footworkChoices(state, s).find((c) => c.id === fw[s]);
    if (!ch) throw new Error(`unknown footwork ${fw[s]}`);
    if (ch.disabled) throw new Error(`${s} illegal footwork: ${ch.reason}`);
  }
  const events = [];
  const out = footworkOutcome(state, fa, fb);
  const wasRocked = { a: state.a.rocked, b: state.b.rocked };
  for (const s of SIDES) {
    const m = FWR(state).moves[fw[s]];
    let cost = m.cost;
    for (const tag of Object.keys(state[s].marks)) if (cost > 0) cost += state.rules.tags[tag]?.footCost || 0;
    if (cost > 0 && state[s].pips.legs >= state.rules.debuff.threshold) cost += state.rules.debuff.legFootCost; // bad legs slow the feet
    addStamina(state, s, -cost + (m.regen || 0) + out.mods[s].stam);
  }
  (state.fwHist ||= []).push({ a: fa, b: fb });
  events.push({ kind: "footwork", a: fa, b: fb, text: out.text, key: out.key });
  setDist(state, state.dist + out.dist, events, null);
  let leader = out.lead;
  let chance = null;
  if (leader === "roll") {
    chance = leadChance(state, out.biasA);
    leader = nextUnit(state) < chance ? "a" : "b";
  }
  const edge = state.edge?.side ?? null;
  state.edge = null;
  events.push({ kind: "lead", side: leader, chance, edge });
  state.engage = { leader, resp: opposite(leader), fw, mods: out.mods, startDist: state.dist, wasRocked, started: false, combo: [], i: 0, landed: 0, exposed: false, stop: null, edge: null, counterBy: null, thrown: { a: [], b: [] }, plan: null, log: [] };
  updateCageFw(state, out, fw, events);
  runStandingAbilities(state, { startDist: state.dist, on: (t, s) => t.on === "footwork" && (!t.moves || t.moves.includes(fw[s])) }, events);
  return events;
}

// ---------- Lead and respond ----------

/** Why this combo cannot be played, or null. Basic moves can repeat; drawn cards only as many times as the hand holds them. */
export function comboError(state, s, cards) {
  const E = state.engage;
  if (!E || E.leader !== s) return "not leading";
  if (E.started) return "already started";
  if (cards.length > comboMax(state, s)) return "too long";
  const have = {};
  for (const c of state[s].hand) have[c] = (have[c] || 0) + 1;
  const used = {};
  let d = state.dist;
  for (let i = 0; i < cards.length; i++) {
    const card = state.cards[cards[i]];
    if (!card || card.hidden || card.counterOnly) return "not a lead card";
    if (!have[cards[i]]) return "not in hand";
    if (!card.basic) {
      used[cards[i]] = (used[cards[i]] || 0) + 1;
      if (used[cards[i]] > have[cards[i]]) return "not in hand";
    }
    if (card.height === "grab" && i !== cards.length - 1) return "a grab ends the combo";
    if (!usableAt(state, card, d, s)) return "out of range";
    d = clampDist(state, d + (card.move || 0));
  }
  return null;
}

/** Why this response cannot be played, or null. A response chosen live (a card was seen coming) cannot be a pre-emptive strike. */
export function planError(state, s, plan, live = false) {
  const k = plan?.kind;
  const me = state[s];
  if (!["guard", "cover", "evade", "counter", "shoot", "preempt"].includes(k)) return "unknown response";
  if (k === "guard" && !GUARDS.includes(plan.height)) return "guard where";
  if (me.rocked && !["guard", "cover"].includes(k)) return "stunned";
  if (k === "preempt" && live) return "too late";
  if (k === "counter" || k === "preempt") {
    const card = state.cards[plan.card];
    if (!card || !me.hand.includes(plan.card)) return "not in hand";
    if (!card.basic && state.engage?.thrown[s].includes(plan.card)) return "already used";
    if (!card.power || card.feint) return "not a strike";
    if (!usableAt(state, card, state.dist, s)) return "out of range";
  }
  return null;
}

/** Cards the responder could answer with: any striking card in hand that reaches from here. */
export function counterCards(state, s) {
  return state[s].hand.filter((c) => {
    const card = state.cards[c];
    if (!card.basic && state.engage?.thrown[s].includes(c)) return false;
    return card.power && !card.feint && usableAt(state, card, state.dist, s);
  });
}

function evadeChance(state, s, speed) {
  const ev = ENG(state).evade;
  return clamp(ev.base + (reactionOf(state, s) - speed) * ev.perDiff + modOf(state, s, "evade"), ev.min, ev.max);
}

/** How fast his answering strike gets there. A counter thrown at a card he never saw coming is a guess, and a slower one. */
function counterSpeed(state, s, cardId, blind = false) {
  return cardSpeed(state, s, cardId) + modOf(state, s, "counterSpeed") + (state.cards[cardId].counterSpeed || 0) - (blind ? ENG(state).counter.blindPenalty : 0);
}

/** The response the plan gives for cards he cannot see: a counter or a shot is a one-time bet and is used up on the first card. */
const planFor = (E) => E.plan || { kind: "cover" };

const tradeBonus = (state, s) => 1 + (passive(state, s).tradeBonus || 0);

/** The leader's next card and whether the responder can see it coming (null when the combo is over). */
export function engageWaiting(state) {
  const E = state.engage;
  if (!E?.started || E.stop || E.i >= E.combo.length) return null;
  const cid = E.combo[E.i];
  const speed = cardSpeed(state, E.leader, cid);
  const reaction = reactionOf(state, E.resp);
  return { index: E.i, of: E.combo.length, card: cid, speed: Math.round(speed), reaction: Math.round(reaction), visible: speed < reaction };
}

/** The leader has laid out his cards and the responder his bet. Resolves any pre-emptive strike. Returns events. */
export function engageStart(state, combo, plan = { kind: "cover" }) {
  const E = state.engage;
  if (!E) throw new Error("no hand in progress");
  const L = E.leader;
  const S = E.resp;
  const err = comboError(state, L, combo);
  if (err) throw new Error(`${L} illegal combo: ${err} (${combo.join(",")})`);
  const perr = planError(state, S, plan);
  if (perr) throw new Error(`${S} illegal response: ${perr}`);
  E.started = true;
  E.combo = [...combo];
  E.plan = { ...plan };
  (state.respHist ||= { a: [], b: [] })[S].push(plan.kind === "guard" ? plan.height : plan.kind);
  (state.leadHist ||= { a: [], b: [] })[L].push(combo.length ? state.cards[combo[0]].height : "pass");
  const events = [{ kind: "engage", leader: L, resp: S, n: combo.length }];
  if (!combo.length) {
    probe(state, events);
    return finishHand(state, events);
  }
  state.stall = 0;
  if (plan.kind === "preempt") preempt(state, E, events);
  if (state.over || E.stop) return finishHand(state, events);
  return events;
}

function probe(state, events) {
  state.stall += 1;
  events.push({ kind: "standoff", stall: state.stall });
  if (state.stall >= state.rules.stall.limit) {
    addMomentum(state, "a", state.rules.momentum.standoff);
    addMomentum(state, "b", state.rules.momentum.standoff);
    state.stall = 0;
    events.push({ kind: "referee" });
  }
}

/** A strike thrown before the leader's first card, at a price. If it lands it breaks up the whole combo. */
function preempt(state, E, events) {
  const R = ENG(state);
  const L = E.leader;
  const S = E.resp;
  const cid = E.plan.card;
  addStamina(state, S, -R.preempt.cost - standCost(state, cid));
  spendSignature(state, S, cid, events);
  events.push({ kind: "preempt", side: S, card: cid, name: state.cards[cid].name });
  E.thrown[S].push(cid);
  const tier = rollTier(state, S, [cid], modOf(state, S, "crit"));
  E.plan = { kind: "cover" };
  if (dealHit(state, S, [cid], tier, R.dmgScale * modOf(state, S, "power") * modOf(state, L, "dmgIn"), events)) return;
  if (tier !== "graze") {
    E.stop = "preempt";
    E.counterBy = S;
    E.edge = S;
    events.push({ kind: "interrupted", side: L });
  }
}

/** Drives a whole hand: `react(state, waiting)` answers cards the responder can see (return a response, or null to stay with the bet). */
export function resolveEngage(state, combo, plan, react = null) {
  const events = engageStart(state, combo, plan);
  while (state.engage) {
    const w = engageWaiting(state);
    const reaction = w?.visible && react ? react(state, w) : null;
    events.push(...engageStep(state, reaction));
  }
  return events;
}

/** Turns over the next card against the bet (or against `reaction`, an answer to a card that was seen coming). */
export function engageStep(state, reaction = null) {
  const E = state.engage;
  if (!E?.started) throw new Error("no combo in progress");
  const L = E.leader;
  const S = E.resp;
  const R = ENG(state);
  const events = [];
  const cid = E.combo[E.i];
  const card = state.cards[cid];
  const speed = cardSpeed(state, L, cid);
  const visible = speed < reactionOf(state, S);
  let resp = planFor(E);
  let fromPlan = true;
  if (visible && reaction) {
    const err = planError(state, S, reaction, true);
    if (err) throw new Error(`${S} illegal reaction: ${err}`);
    resp = reaction;
    fromPlan = false;
  }
  // Each card after the first in a combo costs a little more: a long string of blows wears him out.
  addStamina(state, L, -standCost(state, cid) * (1 + R.stepCost * E.i));
  if (card.signature) {
    addMomentum(state, L, -state.rules.momentum.signatureCost);
    events.push({ kind: "signature", side: L, name: card.name });
  }
  E.thrown[L].push(cid);
  events.push({ kind: "card", side: L, card: cid, name: card.name, index: E.i, of: E.combo.length, height: card.height, speed: Math.round(speed), visible, reply: { ...resp } });
  E.i += 1;
  if (!usableAt(state, card, state.dist, L)) {
    events.push({ kind: "whiff", side: L, card: cid, name: card.name });
  } else if (card.feint) throwFeint(state, E, resp, fromPlan, events);
  else if (card.height === "grab") throwGrab(state, E, cid, resp, speed, fromPlan, events, visible);
  else throwStrike(state, E, cid, resp, speed, fromPlan, events, visible);
  if (state.over || E.stop || E.i >= E.combo.length) return finishHand(state, events);
  return events;
}

const spentBet = (E, fromPlan, resp) => {
  if (fromPlan && (resp.kind === "counter" || resp.kind === "shoot")) E.plan = { kind: "cover" };
};

function throwFeint(state, E, resp, fromPlan, events) {
  const L = E.leader;
  const S = E.resp;
  const R = ENG(state);
  if (!["counter", "shoot", "evade"].includes(resp.kind)) {
    events.push({ kind: "feintWasted", side: L });
    return;
  }
  // He reacted to a fake: whatever he spent is gone, and the next card catches him moving.
  if (resp.kind === "counter") {
    addStamina(state, S, -standCost(state, resp.card));
    spendSignature(state, S, resp.card, events);
    E.thrown[S].push(resp.card);
  } else if (resp.kind === "shoot") addStamina(state, S, -R.shoot.cost);
  else addStamina(state, S, -R.evade.cost);
  events.push({ kind: "feintWin", side: L, vs: resp.kind });
  queueMark(state, S, "fooled", 1);
  E.exposed = true;
  spentBet(E, fromPlan, resp);
}

/** A signature move used as an answer costs the momentum just as when it leads. */
function spendSignature(state, s, cardId, events) {
  if (!state.cards[cardId].signature) return;
  addMomentum(state, s, -state.rules.momentum.signatureCost);
  events.push({ kind: "signature", side: s, name: state.cards[cardId].name });
}

/** Punishes a card that was dodged or caught: the slower the card, the bigger the opening. */
function punish(state, E, card, events) {
  const S = E.resp;
  const L = E.leader;
  if (!card.recovery) return false;
  const tier = rollTier(state, S, ["punish"], modOf(state, S, "crit"));
  return dealHit(state, S, ["punish"], tier, card.recovery * ENG(state).punishMult * ENG(state).dmgScale * modOf(state, L, "dmgIn"), events);
}

function throwStrike(state, E, cid, resp, speed, fromPlan, events, visible) {
  const L = E.leader;
  const S = E.resp;
  const card = state.cards[cid];
  const R = ENG(state);
  const baseMult = R.dmgScale * modOf(state, L, "power") * modOf(state, S, "dmgIn");
  const critAdd = E.landed * R.critStep + (E.exposed ? R.feintCrit : 0) + modOf(state, L, "crit");
  const hit = (mult, extra = 0, trade = 1) => {
    const tier = rollTier(state, L, [cid], critAdd + extra);
    if (tier === "crit") addMomentum(state, L, state.rules.momentum.crit);
    const ended = dealHit(state, L, [cid], tier, baseMult * mult * trade, events);
    if (!ended) E.landed += 1;
    return ended;
  };
  const moveOn = () => {
    if (card.move) shiftDist(state, card.move, events, L);
  };
  switch (resp.kind) {
    case "guard": {
      if (resp.height === card.height) {
        const chip = card.signature ? state.rules.signature.glanceMult / state.rules.tiers.grazeMult : R.block.mult;
        events.push({ kind: "block", side: S, height: resp.height, card: cid });
        if (dealHit(state, L, [cid], "graze", baseMult * chip, events, { chip: true })) return;
        const streak = state.guardStreak?.side === S ? state.guardStreak.n + 1 : 1;
        state.guardStreak = { side: S, n: streak };
        addStamina(state, S, -R.block.drainResp);
        addStamina(state, L, -(R.block.drainLeader + (streak - 1) * R.block.streakDrain));
        E.stop = "block";
        return;
      }
      if (hit(R.mismatchMult)) return;
      moveOn();
      return;
    }
    case "cover":
      addStamina(state, S, R.coverRegen);
      if (hit(R.coverMult)) return;
      moveOn();
      return;
    case "evade": {
      addStamina(state, S, -R.evade.cost);
      const p = evadeChance(state, S, speed);
      if (nextUnit(state) < p) {
        events.push({ kind: "evade", side: S, card: cid, chance: p });
        moveOn();
        E.stop = "evade";
        E.edge = S;
        punish(state, E, card, events);
        return;
      }
      events.push({ kind: "evadeFail", side: S, chance: p });
      if (hit(1, R.evade.failCrit)) return;
      moveOn();
      return;
    }
    case "counter": {
      const cc = state.cards[resp.card];
      addStamina(state, S, -standCost(state, resp.card));
      spendSignature(state, S, resp.card, events);
      E.thrown[S].push(resp.card);
      spentBet(E, fromPlan, resp);
      if (cc.counterVs === "grab") {
        events.push({ kind: "counterWrong", side: S, name: cc.name });
        if (hit(1, R.counter.wrongCrit)) return;
        moveOn();
        return;
      }
      const cs = counterSpeed(state, S, resp.card, !visible);
      events.push({ kind: "counter", side: S, card: resp.card, name: cc.name, speed: Math.round(cs), vs: Math.round(speed), first: cs > speed });
      if (cs > speed) {
        const tier = rollTier(state, S, [resp.card], modOf(state, S, "crit"));
        if (dealHit(state, S, [resp.card], tier, R.dmgScale * state.rules.damage.counterMult * modOf(state, S, "power") * modOf(state, L, "dmgIn"), events)) return;
        events.push({ kind: "interrupted", side: L });
        if (cc.move) shiftDist(state, cc.move, events, S);
        if (cc.lockAnywhere && tier !== "graze") {
          state.ground = makeGround(L, 0);
          startLock(state, S, cc.name, cc.lockDepth || 1, events, passive(state, S).lockDepthBottom || 0);
        }
        E.stop = "counter";
        E.counterBy = S;
        E.edge = S;
        return;
      }
      if (hit(R.counter.failMult, R.counter.failCrit, tradeBonus(state, L))) return;
      moveOn();
      // His answer still gets there unless the blow stunned him.
      if (state[S].rocked && state[S].rockedAt === state.history.length) {
        events.push({ kind: "interrupted", side: S });
        return;
      }
      const tier = rollTier(state, S, [resp.card], modOf(state, S, "crit"));
      if (dealHit(state, S, [resp.card], tier, R.dmgScale * state.rules.damage.counterMult * R.counter.secondMult * tradeBonus(state, S) * modOf(state, L, "dmgIn"), events)) return;
      if (cc.move) shiftDist(state, cc.move, events, S);
      return;
    }
    case "shoot": {
      addStamina(state, S, -R.shoot.cost);
      spentBet(E, fromPlan, resp);
      if (card.shootable) {
        events.push({ kind: "shoot", side: S, card: cid, caught: true });
        const tier = rollTier(state, S, ["counter_shot"], R.shoot.bonus);
        landGrab(state, S, L, "counter_shot", tier, events, {});
        E.stop = "shoot";
        E.edge = S;
        E.counterBy = S;
        return;
      }
      events.push({ kind: "shoot", side: S, card: cid, caught: false });
      if (hit(R.shoot.stuffMult, R.counter.wrongCrit)) return;
      moveOn();
      return;
    }
    default:
      if (hit(1)) return;
      moveOn();
  }
}

function throwGrab(state, E, cid, resp, speed, fromPlan, events, visible) {
  const L = E.leader;
  const S = E.resp;
  const card = state.cards[cid];
  const R = ENG(state);
  let extra = 0;
  let catcher = null;
  E.stop = "grab";
  if (resp.kind === "evade") {
    addStamina(state, S, -R.evade.cost);
    const p = evadeChance(state, S, speed);
    if (nextUnit(state) < p) {
      events.push({ kind: "evade", side: S, card: cid, chance: p });
      E.stop = "evade";
      E.edge = S;
      punish(state, E, card, events);
      return;
    }
    events.push({ kind: "evadeFail", side: S, chance: p });
  } else if (resp.kind === "counter") {
    const cc = state.cards[resp.card];
    addStamina(state, S, -standCost(state, resp.card));
    spendSignature(state, S, resp.card, events);
    E.thrown[S].push(resp.card);
    spentBet(E, fromPlan, resp);
    if (cc.counterVs === "grab") {
      catcher = resp.card;
      events.push({ kind: "counter", side: S, card: resp.card, name: cc.name, speed: 0, vs: 0, first: false, catch: true });
    } else {
      const cs = counterSpeed(state, S, resp.card, !visible);
      events.push({ kind: "counter", side: S, card: resp.card, name: cc.name, speed: Math.round(cs), vs: Math.round(speed), first: cs > speed });
      if (cs > speed) {
        const tier = rollTier(state, S, [resp.card], modOf(state, S, "crit"));
        if (dealHit(state, S, [resp.card], tier, R.dmgScale * state.rules.damage.counterMult * R.counter.grabMult * modOf(state, S, "power") * modOf(state, L, "dmgIn"), events)) return;
        events.push({ kind: "interrupted", side: L });
        E.stop = "counter";
        E.counterBy = S;
        E.edge = S;
        return;
      }
    }
  } else if (resp.kind === "shoot") {
    addStamina(state, S, -R.shoot.cost);
    spentBet(E, fromPlan, resp);
    resolveScramble(state, events);
    E.stop = "grab";
    E.edge = null;
    return;
  } else if (resp.kind === "guard" && resp.height === "low") {
    extra -= R.sprawl;
    events.push({ kind: "sprawl", side: S });
  }
  const tier = rollTier(state, L, [cid], extra + E.landed * R.critStep + (E.exposed ? R.feintCrit : 0) + modOf(state, L, "crit"));
  const where = landGrab(state, L, S, cid, tier, events, { catcher, card });
  E.grab = where;
  if (where === "ground" || where === "clinch") E.edge = L;
  if (where === "caught") E.edge = S;
}

/**
 * A grab goes in. `clinchEntry` cards only close to the clinch; the rest try to take him down (the tier says how well it lands),
 * a pull-guard drags him on top of you, and a poor shot can run into a guillotine. Returns "clinch", "ground" or "caught".
 */
function landGrab(state, w, l, cid, tier, events, ctx = {}) {
  const card = state.cards[cid];
  const sc = state.rules.score;
  const G = state.rules.grapple;
  if (card.clinchEntry) {
    if (card.drain) addStamina(state, l, -card.drain);
    const before = state.dist;
    setDist(state, state.rules.dist.clinch, events, w);
    if (before < state.dist) events.push({ kind: "clinch", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    events.push({ kind: "grab", side: w, where: "clinch" });
    return "clinch";
  }
  addStamina(state, l, -G.drainOnLanding - (card.drain || 0));
  if (card.pullGuard) {
    state.ground = makeGround(l, 0);
    events.push({ kind: "pullGuard", side: w });
    score(state, w, "grappling", sc.exchangeWin);
    events.push({ kind: "grab", side: w, where: "ground" });
    return "ground";
  }
  if (ctx.catcher && tier === "graze") {
    state.ground = makeGround(w, 0);
    events.push({ kind: "caught", side: l, name: state.cards[ctx.catcher].name });
    if (passive(state, l).lockDepthCatch) showAbility(state, l, events);
    startLock(state, l, state.cards[ctx.catcher].name, 1, events, passive(state, l).lockDepthCatch || 0);
    return "caught";
  }
  const pos = (card.landing || 0) + G.positionFromTier[tier];
  if (pos < 0) {
    setDist(state, state.rules.dist.clinch, events, w);
    events.push({ kind: "clinch", side: w, stuffed: true });
    score(state, w, "grappling", sc.exchangeWin);
    events.push({ kind: "grab", side: w, where: "clinch" });
    return "clinch";
  }
  state.ground = makeGround(w, clamp(pos, 0, state.rules.positions.length - 1));
  score(state, w, "grappling", sc.takedown);
  addMomentum(state, w, state.rules.momentum.landing);
  events.push({ kind: "takedown", side: w, pos: state.ground.pos, name: state.rules.positions[state.ground.pos], tier });
  events.push({ kind: "grab", side: w, where: "ground" });
  if (card.slam > 0) {
    state[l].hp = Math.max(1, state[l].hp - card.slam * state.rules.damage.slamToGround);
    events.push({ kind: "hit", attacker: w, target: "body", damage: card.slam, tier, card: cid, name: "重摔" });
  }
  return "ground";
}

/** The hand is over: who has the edge now, the points, abilities, then the usual end of an exchange. */
function finishHand(state, events) {
  const E = state.engage;
  const R = ENG(state);
  const L = E.leader;
  const S = E.resp;
  if (E.combo.length && !E.stop && !state.over && E.i >= E.combo.length) {
    E.stop = "done";
    E.edge = L;
    addStamina(state, S, -R.comboDrain);
    events.push({ kind: "comboDone", side: L, n: E.combo.length });
  }
  if (E.stop !== "block") state.guardStreak = null;
  const wasRocked = E.wasRocked;
  const rockedNow = (s) => state[s].rocked && state[s].rockedAt === state.history.length;
  if (rockedNow(S) && !rockedNow(L)) E.edge = L;
  if (rockedNow(L) && !rockedNow(S)) E.edge = S;
  state.edge = E.edge && !state.over ? { side: E.edge } : null;
  if (E.edge && E.combo.length) {
    const grabbed = E.grab === "ground" || E.grab === "clinch";
    score(state, E.edge, grabbed || (E.edge === S && E.stop === "shoot") ? "grappling" : "striking", R.edgeScore);
    addMomentum(state, E.edge, state.rules.momentum.win);
    addMomentum(state, opposite(E.edge), state.rules.momentum.lose);
  }
  const hits = events.filter((e) => e.kind === "hit" && !e.chip);
  if (!state.over) {
    const played = (s) => E.thrown[s].map((c) => state.cards[c]);
    runStandingAbilities(state, {
      startDist: E.startDist,
      on: (t, s) => {
        switch (t.on) {
          case "lead": return s === L && E.combo.length > 0;
          case "counter": return E.counterBy === s;
          case "comboDone": return E.stop === "done" && s === L;
          case "block": return E.stop === "block" && s === S;
          case "evade": return E.stop === "evade" && s === S;
          case "hit": return hits.some((e) => e.attacker === s && e.tier !== "graze" && (!t.target || e.target === t.target) && (!t.type || state.cards[e.card]?.type === t.type) && (!t.kick || state.cards[e.card]?.kick));
          case "takedown": return events.some((e) => e.kind === "takedown" && e.side === s);
          case "grab": return events.some((e) => e.kind === "grab" && e.side === s);
          case "play": return s === L && played(s).filter((c) => (!t.type || c.type === t.type) && !c.feint).length >= (t.min || 1);
          default: return false;
        }
      },
    }, events);
  }
  if (state.ground) {
    state.cage = null; // nobody is pinned on the mat
    for (const s of SIDES) state[s].pressure = 0;
  }
  const types = { [L]: E.combo.length ? "S" : "C", [S]: "C" };
  state.history.push(types);
  state.engage = null;
  endExchange(state, E.thrown, types, wasRocked, events);
  state.exchangeCost = null;
  const down = events.find((e) => e.kind === "takedown");
  if (down && !state.over && state.phase === "exchange" && state.ground) state.pending = { kind: "chase", side: down.side };
  return events;
}

// ---------- Card text for the screen ----------

const HEIGHT_NAMES = { high: "上", mid: "中", low: "下", grab: "抱", feint: "假" };
export const heightName = (h) => HEIGHT_NAMES[h] || "";

/** How a standing card reads right now. `foe` is the other side, so a card can say whether he would see it coming. */
export function describeStandingCard(state, s, cardId) {
  const card = state.cards[cardId];
  const foe = opposite(s);
  const speed = Math.round(cardSpeed(state, s, cardId));
  const dmg = card.power ? Math.round(cardDamage(state, s, cardId) * ENG(state).dmgScale) : 0;
  let effect = "";
  if (card.feint) effect = "騙他反應";
  else if (card.clinchEntry) effect = "貼進纏抱";
  else if (card.pullGuard) effect = "拉進地面，你在下位";
  else if (card.height === "grab") effect = `摔倒 → ${state.rules.positions[card.landing || 0]}`;
  else if (card.counterOnly) effect = card.counterVs === "grab" ? "他抱腿時勒住" : `反擊 ${dmg}`;
  else effect = `${dmg}${card.hits > 1 ? ` · ${card.hits} 連` : ""}`;
  if (card.move && !card.counterOnly) effect += card.move > 0 ? ` · 進 ${card.move}` : ` · 退 ${-card.move}`;
  const setups = (card.setup || []).map((st) => ({ tag: st.tag, label: state.rules.tags[st.tag]?.label || st.tag, when: st.when }));
  const follows = Object.entries(card.follow || {}).map(([tag, eff]) => ({ tag, label: state.rules.tags[tag]?.label || tag, bonus: Math.round(((eff.crit || 0) + (eff.quality || 0)) * 100), live: Boolean(state[s].marks[tag]) }));
  return {
    effect,
    height: card.height,
    heightName: HEIGHT_NAMES[card.height] || "",
    speed,
    cost: Math.round(standCost(state, cardId) * 10) / 10,
    unusable: !usableAt(state, card, state.dist, s),
    rangeText: rangeText(state, card),
    seenByFoe: !card.counterOnly && speed < reactionOf(state, foe),
    recovery: card.recovery || 0,
    setups,
    follows,
    counterOnly: Boolean(card.counterOnly),
  };
}

/** What a combo would do, for the screen: its cost, where the fighters end up, and the damage if every card lands clean. */
export function previewCombo(state, s, cards) {
  let d = state.dist;
  let cost = 0;
  let dmg = 0;
  for (const c of cards) {
    const card = state.cards[c];
    cost += standCost(state, c);
    dmg += card.power ? cardDamage(state, s, c) * ENG(state).dmgScale : 0;
    d = clampDist(state, d + (card.move || 0));
  }
  return { cost: Math.round(cost), damage: Math.round(dmg), endDist: d, max: comboMax(state, s), stamina: Math.round(state[s].stamina) };
}

// ---------- Standing AI ----------

const sampleId = (state, probs) => {
  let r = nextUnit(state);
  const ids = Object.keys(probs);
  for (const id of ids) {
    r -= probs[id];
    if (r < 0) return id;
  }
  return ids[ids.length - 1];
};

function normalise(w, floor, open) {
  for (const id of Object.keys(w)) w[id] = open(id) ? Math.max(w[id], floor) : 0;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([id, v]) => [id, v / total]));
}

/** The honest tendency of a fighter's next step. The screen shows these numbers and chooseFootwork samples them. */
export function footworkIntent(state, s) {
  const R = FWR(state);
  const ai = state.rules.ai;
  const me = state[s];
  const oppSide = opposite(s);
  const f = fighterOf(state, s);
  const style = R.styles[f.fwStyle || "balanced"][phaseOf(state, s)];
  const plan = tactic(state, s);
  const w = {};
  for (const id of R.order) w[id] = style[id] + (plan.fw?.[id] || 0);
  const tags = [];
  let readBoost = 1;
  for (const tag of Object.keys(state[oppSide].marks)) readBoost *= state.rules.tags[tag]?.readBoost || 1;
  const recent = (state.fwHist || []).slice(-ai.adapt.window).map((h) => h[oppSide]);
  for (const m of recent) for (const [t, share] of Object.entries(R.lean[m])) w[t] += ai.adapt.perMatch * readBoost * share;
  if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
    for (const [t, share] of Object.entries(R.lean[recent[recent.length - 1]])) w[t] += ai.adapt.repeatBonus * share;
    tags.push("看穿你的習慣");
  }
  if (me.rocked) { w.retreat += 0.5; w.hold += ai.rockedCounter; w.press *= 0.3; tags.push("被打暈，想撐過去"); }
  if (state[oppSide].rocked) { w.press += ai.swarmStrike; tags.push("要衝上來追擊"); }
  if (me.stamina < ai.lowStaminaAt) { w.hold += ai.lowStaminaCounter; w.press *= 0.5; tags.push("快沒力了"); }
  if (state.cage) {
    const c = state.rules.cage;
    if (state.cage.side === s) { w.circle += c.pinnedCircle; w.press += c.pinnedPress; tags.push("背靠籠子，想脫離"); }
    else { w.press += c.pinnerPress; tags.push("把你逼在籠邊，想壓上"); }
  }
  const [lo, hi] = f.prefer;
  if (state.dist < lo) { w.press += ai.wantClose; tags.push("想拉近距離"); }
  else if (state.dist > hi) { w.retreat += ai.wantOut * 0.5; w.circle += ai.wantOut * 0.5; tags.push("想拉開距離"); }
  for (const [tag] of Object.entries(me.marks)) {
    const def = state.rules.tags[tag];
    if (!def?.sharpen) continue;
    for (const id of R.order) w[id] **= def.sharpen;
    tags.push(def.label);
  }
  const probs = normalise(w, ai.minWeight, (id) => !footworkChoices(state, s).find((c) => c.id === id).disabled);
  const top = R.order.reduce((best, id) => (probs[id] > probs[best] ? id : best), R.order[0]);
  const tells = ai.footTells[top];
  return {
    kind: "footwork",
    options: R.order.map((id) => ({ id, label: R.moves[id].label, short: R.moves[id].short })),
    probs,
    top,
    tell: tells[(state.round * 7 + state.exchange * 3) % tells.length],
    tags,
    blind: state[oppSide].cut >= state.rules.cut.blindAt,
    signatureReady: me.hand.includes(f.signature),
  };
}

const leadPool = (state, s) => state[s].hand.filter((c) => !state.cards[c].counterOnly);

/** After the steps: how the leader will start (the height of his first card) or how the responder will meet it. Also honest. */
export function engageIntent(state, s) {
  const E = state.engage;
  const ai = state.rules.ai;
  const me = state[s];
  const oppSide = opposite(s);
  const f = fighterOf(state, s);
  const tags = [];
  const leading = E.leader === s;
  let probs;
  let options;
  if (leading) {
    const style = ai.lead.styles[f.leadStyle || "balanced"];
    const w = { ...style.heights };
    if (state[oppSide].rocked) { w.high += 0.4; tags.push("要追擊"); }
    if (state.dist >= 3) w.mid += 0.3;
    const recent = (state.respHist?.[oppSide] || []).slice(-ai.adapt.window);
    for (const r of recent) if (GUARDS.includes(r)) w[r] = Math.max(0, w[r] - ai.engage.adaptHeight * 0.5);
    if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2] && GUARDS.includes(recent[recent.length - 1])) tags.push("避開你老守的位置");
    if (me.rocked) tags.push("被打暈，只能出一張");
    const pool = leadPool(state, s);
    probs = normalise(w, ai.minWeight, (h) => pool.some((c) => state.cards[c].height === h && usableAt(state, state.cards[c], state.dist, s)));
    options = HEIGHTS.map((h) => ({ id: h, label: ai.heightWords[h] }));
  } else {
    const style = ai.respond.styles[f.respondStyle || "balanced"];
    const w = { ...style };
    const heights = (state.leadHist?.[oppSide] || []).slice(-ai.adapt.window);
    for (const h of heights) {
      if (GUARDS.includes(h)) w[h] += ai.engage.adaptHeight;
      else if (h === "grab") { w.low += ai.engage.adaptHeight * 0.5; w.shoot += ai.engage.adaptHeight * 0.5; }
    }
    if (heights.length >= 2 && heights[heights.length - 1] === heights[heights.length - 2]) tags.push("看穿你的習慣");
    for (const [kind, key] of [["counter", "counterSpeed"], ["evade", "evade"]]) if (modOf(state, s, key) > 0) w[kind] += 0.06 + modOf(state, s, key) * 0.2;
    if (me.stamina < ai.lowStaminaAt) { w.cover += ai.lowStaminaCounter; tags.push("快沒力了"); }
    if (me.rocked) {
      for (const k of ["evade", "counter", "shoot", "preempt"]) w[k] = 0;
      w.cover += ai.rockedCounter;
      tags.push("被打暈，想撐過去");
    }
    const strikers = counterCards(state, s);
    const preemptOk = !me.rocked && me.stamina >= ai.engage.preemptMinStamina + ENG(state).preempt.cost && strikers.length > 0;
    probs = normalise(w, ai.minWeight, (id) => (id === "counter" ? strikers.length > 0 && !me.rocked : id === "preempt" ? preemptOk : me.rocked ? ["high", "mid", "low", "cover"].includes(id) : true));
    options = RESPONSES.map((id) => ({ id, label: { high: "架高", mid: "架中", low: "架低", cover: "抱頭", evade: "閃身", counter: "反擊", shoot: "抱摔", preempt: "搶先" }[id] }));
  }
  const top = Object.keys(probs).reduce((best, id) => (probs[id] > probs[best] ? id : best));
  return {
    kind: leading ? "lead" : "respond",
    options,
    probs,
    top,
    tell: "",
    tags,
    blind: state[oppSide].cut >= state.rules.cut.blindAt,
    detail: Boolean(state[oppSide].marks.read),
    signatureReady: me.hand.includes(f.signature),
  };
}

export function chooseFootwork(state, s) {
  return sampleId(state, footworkIntent(state, s).probs);
}

const strikeValue = (state, s, c) => {
  const card = state.cards[c];
  if (card.height === "grab") return 6 + (card.landing || 0) * 4 + (card.quality || 0) * 40;
  let v = cardDamage(state, s, c) + followValue(state, s, card) + (card.setup ? 2 : 0);
  if (card.signature) v += 10;
  // A slow card he can see coming is worth less unless it is a special that wins on power.
  if (cardSpeed(state, s, c) < reactionOf(state, opposite(s))) v *= 0.75;
  return v;
};

function followValue(state, s, card) {
  let v = 0;
  for (const [tag, eff] of Object.entries(card.follow || {})) if (state[s].marks[tag]) v += ((eff.crit || 0) + (eff.quality || 0)) * 30;
  return v;
}

const pickWeighted = (state, items, weight) => {
  const w = items.map((x) => Math.max(0.01, weight(x)) ** 1.5);
  let r = nextUnit(state) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= w[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};

/** The AI's combo: the first card's height is drawn from the shown tendencies; the rest mixes heights and ends on its best shot. */
export function chooseCombo(state, s, opts = {}) {
  const intent = engageIntent(state, s);
  const ai = state.rules.ai;
  const f = fighterOf(state, s);
  const style = ai.lead.styles[f.leadStyle || "balanced"];
  const max = comboMax(state, s);
  const h0 = opts.height || sampleId(state, intent.probs);
  const pool = leadPool(state, s);
  let len = 1;
  let r = nextUnit(state);
  for (let i = 0; i < style.len.length; i++) {
    r -= style.len[i];
    if (r < 0) { len = i + 1; break; }
  }
  len = Math.min(len, max);
  if (me_lowStamina(state, s)) len = Math.min(len, 2);
  const cards = [];
  const used = new Set();
  let d = state.dist;
  for (let k = 0; k < len; k++) {
    let cands = pool.filter((c) => usableAt(state, state.cards[c], d, s) && (state.cards[c].basic || !used.has(c)));
    if (k === 0) {
      const first = cands.filter((c) => state.cards[c].height === h0 && !state.cards[c].feint);
      cands = first.length ? first : cands.filter((c) => !state.cards[c].feint);
    } else {
      const last = k === len - 1;
      const prev = state.cards[cards[k - 1]];
      if (prev.height === "grab") break;
      const feint = cands.filter((c) => state.cards[c].feint);
      const grabs = cands.filter((c) => state.cards[c].height === "grab");
      if (!last) cands = cands.filter((c) => state.cards[c].height !== "grab");
      if (feint.length && k === 1 && !last && nextUnit(state) < style.feint) {
        cards.push(feint[0]);
        used.add(feint[0]);
        continue;
      }
      if (last && grabs.length && nextUnit(state) < style.shootAfter) cands = grabs;
      else {
        cands = cands.filter((c) => !state.cards[c].feint && state.cards[c].height !== "grab");
        const mixed = cands.filter((c) => state.cards[c].height !== prev.height);
        if (mixed.length && nextUnit(state) < 0.6) cands = mixed;
      }
    }
    if (!cands.length) break;
    const pick = k === len - 1 && k > 0 && cands.length > 1 && nextUnit(state) < 0.5
      ? cands.reduce((best, c) => (strikeValue(state, s, c) > strikeValue(state, s, best) ? c : best))
      : pickWeighted(state, cands, (c) => strikeValue(state, s, c));
    cards.push(pick);
    used.add(pick);
    d = clampDist(state, d + (state.cards[pick].move || 0));
    if (state.cards[pick].height === "grab") break;
  }
  const sig = f.signature;
  if (cards.length === 0 && pool.includes(sig) && usableAt(state, state.cards[sig], d, s)) cards.push(sig);
  return cards;
}
const me_lowStamina = (state, s) => state[s].stamina < state.rules.ai.commit.conserveAt;

function bestCounter(state, s, minSpeed = 0) {
  const list = counterCards(state, s).filter((c) => !state.cards[c].counterVs && (!state.cards[c].signature || state.cards[c].counterOnly));
  if (!list.length) return null;
  return list.reduce((best, c) => {
    const v = (x) => state.cards[x].speed * 0.5 + state.cards[x].power + (state.cards[x].signature ? 12 : 0);
    return v(c) > v(best) ? c : best;
  });
}

/** The AI's bet before the cards turn over, drawn from the shown tendencies. */
export function choosePlan(state, s) {
  const intent = engageIntent(state, s);
  const pick = sampleId(state, intent.probs);
  if (GUARDS.includes(pick)) return { kind: "guard", height: pick };
  if (pick === "counter") {
    const c = bestCounter(state, s);
    return c ? { kind: "counter", card: c } : { kind: "cover" };
  }
  if (pick === "preempt") {
    const list = counterCards(state, s).filter((c) => !state.cards[c].counterVs && !state.cards[c].signature);
    if (!list.length) return { kind: "cover" };
    return { kind: "preempt", card: list.reduce((best, c) => (state.cards[c].power * state.cards[c].speed > state.cards[best].power * state.cards[best].speed ? c : best)) };
  }
  return { kind: pick };
}

/** A card he can see coming: the AI weighs each answer by what it would do against this very card, with some of its own style mixed in. */
export function chooseReaction(state, s, w) {
  const L = opposite(s);
  const R = ENG(state);
  const card = state.cards[w.card];
  const me = state[s];
  if (me.rocked) return { kind: "cover" };
  const dmg = card.power ? cardDamage(state, L, w.card) : 8;
  const ev = {};
  const guardH = card.height === "grab" ? "low" : card.height === "feint" ? "high" : card.height;
  ev[`guard:${guardH}`] = card.height === "grab" ? 3 : dmg * (1 - R.block.mult * 0.6) + 5;
  ev.cover = dmg * (1 - R.coverMult);
  const p = evadeChance(state, s, w.speed);
  ev.evade = p * (dmg + (card.recovery || 0) * R.punishMult + 5) - (1 - p) * dmg * R.evade.failCrit * 4;
  const cc = card.height === "grab" ? null : bestCounter(state, s);
  if (cc) {
    const first = counterSpeed(state, s, cc) > w.speed;
    ev.counter = first ? dmg * 0.9 + state.cards[cc].power + 6 : state.cards[cc].power * 0.5 - dmg * 0.2;
  }
  if (card.shootable) ev.shoot = 30 * clamp(0.4 + (me.attrs.wrestling - state[L].attrs.grappleDef) * 0.01, 0.1, 0.8) - 4;
  else if (card.height !== "grab") ev.shoot = -dmg;
  if (card.feint) { ev.cover = 3; for (const k of Object.keys(ev)) if (k !== "cover") ev[k] = -4; }
  const entries = Object.entries(ev);
  if (nextUnit(state) < state.rules.ai.engage.reactVisible) {
    const [best] = entries.reduce((b, e) => (e[1] > b[1] ? e : b));
    return reactionFrom(state, s, best);
  }
  const intent = engageIntent(state, s);
  const kinds = entries.map(([k]) => k);
  const weightOf = (k) => (k.startsWith("guard:") ? intent.probs[k.slice(6)] : intent.probs[k] || 0.05);
  return reactionFrom(state, s, pickWeighted(state, kinds, weightOf));
}

function reactionFrom(state, s, key) {
  if (key.startsWith("guard:")) return { kind: "guard", height: key.slice(6) };
  if (key === "counter") {
    const c = bestCounter(state, s);
    return c ? { kind: "counter", card: c } : { kind: "cover" };
  }
  return { kind: key };
}

/**
 * Stand-up hand: the fighter's drawn special moves (rules.match.handSize of them, always including something to lead with and,
 * when the deck has one, something to answer with), then the basic moves everyone always has, then the signature when the momentum is full.
 */
export function refillHand(state, s) {
  const me = state[s];
  if (state.ground) return refillGround(state, s);
  if (me.stand) {
    // Back on his feet: the unplayed ground cards go back to the pile and the stand-up hand returns.
    me.gdraw.push(...me.hand.filter((c) => state.cards[c].cat));
    me.hand = me.stand;
    me.stand = null;
  }
  const size = state.rules.match.handSize;
  const sig = state.fighters[me.id].signature;
  const core = me.hand.filter((c) => c !== sig && !isBasic(state, c));
  while (core.length < size && me.draw.length + me.discard.length > 0) core.push(drawOne(state, s));
  const answers = (c) => Boolean(state.cards[c].counterOnly);
  for (const wantAnswer of [false, true]) {
    if (core.some((c) => answers(c) === wantAnswer)) continue;
    let pool = me.draw;
    let idx = pool.findIndex((c) => answers(c) === wantAnswer);
    if (idx < 0) {
      pool = me.discard;
      idx = pool.findIndex((c) => answers(c) === wantAnswer);
    }
    if (idx < 0) continue;
    const others = core.filter((c) => answers(c) !== wantAnswer);
    if (others.length < 2) continue;
    const swapAt = core.findIndex((c) => answers(c) !== wantAnswer);
    const taken = pool.splice(idx, 1)[0];
    pool.unshift(core[swapAt]);
    core[swapAt] = taken;
  }
  me.hand = [...core, ...state.rules.match.basics];
  if (me.momentum >= state.rules.momentum.signatureCost) me.hand.push(sig);
}

/** Returns an error string, or null when the play is legal. Ground hands only: stand-up hands go through comboError and planError. An empty play is the free option. */
export function playError(state, s, cards) {
  if (!state.ground) return "stand-up hands use comboError and planError";
  if (cards.length === 0) return state.ground.lock ? "choose a move" : null;
  const counts = {};
  for (const c of state[s].hand) counts[c] = (counts[c] || 0) + 1;
  for (const c of cards) {
    if (!counts[c]) return "not in hand";
    counts[c]--;
  }
  // On the mat a hand is one card (one move in a lock fight), and a lock fight cannot be sat out.
  if (cards.length > 1) return "one card on the ground";
  if (costOf(state, cards, s) > budget(state, s)) return "over budget";
  if (!usableAt(state, state.cards[cards[0]], state.dist, s)) return "out of range";
  return null;
}

/** What the screen shows before a ground play is committed: its cost, the clean-hit damage and the tier chances. */
export function previewPlay(state, s, cards) {
  const type = typeOfPlay(state, cards);
  const odds = tierOdds(state, s, cards);
  const base = cards.reduce((sum, c) => sum + cardDamage(state, s, c), 0);
  const d = state.rules.damage;
  const winMult = state.ground.top === s ? d.winStrikeBonus * d.groundPositionMult[state.ground.pos] : d.bottomCounterMult;
  return {
    type,
    order: cards,
    cost: costOf(state, cards, s),
    endDist: null,
    damage: Math.round(base * winMult * (state[opposite(s)].rocked ? d.swarmMult : 1) * (tactic(state, opposite(s)).dmgIn || 1)),
    critPct: Math.round(odds.crit * 100),
    grazePct: Math.round(odds.graze * 100),
    budget: budget(state, s),
  };
}

/** How a card reads right now: the action name and a one-line effect. Ground cards and lock moves here; stand-up cards in describeStandingCard. */
export function describeCard(state, s, cardId) {
  const card = state.cards[cardId];
  const g = state.ground;
  if (!g) return describeStandingCard(state, s, cardId);
  const role = g.top === s ? "top" : "bottom";
  let action = "";
  let effect = "";
  if (g.lock) {
    const l = state.rules.lock;
    action = card.lockSide === "attack" ? "進攻" : "防守";
    effect = card.lockSide === "attack" ? `被${l.defend[l.beats[card.lockMove]]}擋住就退一階` : `猜中${l.attack[Object.keys(l.beats).find((k) => l.beats[k] === card.lockMove)]}就退一階`;
  } else {
    const cat = state.rules.ground.cats[card.cat];
    action = cat.label;
    const gm = state.rules.damage.groundPositionMult[g.pos];
    const gdmg = Math.round(cardDamage(state, s, cardId) * (role === "top" ? state.rules.damage.winStrikeBonus * gm : state.rules.damage.bottomCounterMult));
    const names = state.rules.positions;
    if (card.cat === "punch") effect = `傷害 ${gdmg}${card.hits > 1 ? ` · ${card.hits} 連` : ""}`;
    else if (card.cat === "pass") effect = g.pos >= names.length - 1 ? "已在最高位" : `→ ${names[Math.min(names.length - 1, g.pos + 1)]}`;
    else if (card.cat === "lock") effect = `鎖技：${card.lock}`;
    else if (card.cat === "frame") effect = g.pos > 0 ? `擋過位 · 退到${names[g.pos - 1]}` : "擋過位";
    else if (card.cat === "counter") effect = card.lockBottom ? `鎖技：${card.lock}` : `反擊 ${gdmg}`;
    else {
      const to = state.rules.ground.escapeTo[g.pos];
      effect = to < 0 ? "站起來" : `退到${names[to]}`;
    }
  }
  return { action, effect, cost: cardCost(state, s, cardId), unusable: !usableAt(state, card, state.dist, s), blocked: "", rangeText: posText(state, card), setups: [], follows: [] };
}

/** The opponent's honest tendencies. The UI shows these same numbers and the choose* functions sample from them. */
export function getIntent(state, s) {
  if (state.ground) return groundIntent(state, s);
  return state.engage ? engageIntent(state, s) : footworkIntent(state, s);
}

/** The AI's next decision, whatever the step is: a footwork, a combo (when leading) or a response (when answering), or a ground play. */
export function chooseAI(state, s) {
  if (state.ground) return chooseGroundAI(state, s);
  if (!state.engage) return { footwork: chooseFootwork(state, s) };
  return state.engage.leader === s ? { cards: chooseCombo(state, s) } : { plan: choosePlan(state, s) };
}

/** Resolves one simultaneous exchange on the mat. `playA` / `playB` are arrays of card ids. Stand-up hands go through resolveFootwork and resolveEngage. */
export function resolveExchange(state, playA, playB, opts = {}) {
  if (state.phase !== "exchange") throw new Error(`cannot resolve in phase ${state.phase}`);
  if (state.pending) throw new Error("a pending choice has to be resolved first");
  if (!state.ground) throw new Error("stand-up hands go through resolveFootwork and resolveEngage");
  for (const [s, cards] of [["a", playA], ["b", playB]]) {
    const err = playError(state, s, cards);
    if (err) throw new Error(`${s} illegal play: ${err} (${cards.join(",")})`);
  }
  return resolveGroundExchange(state, playA, playB, opts);
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
function dealHit(state, att, cards, tier, mult, events, opts = {}) {
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
      if (opts.chip) {
        // A blocked blow: a little gets through, but it leaves no mark, scores nothing and cannot stun or cut.
        events.push({ kind: "hit", attacker: att, target, damage: Math.round(dmg), tier, card: c, name: card.name, chip: true });
        if (state[def].hp <= 0) {
          finish(state, att, "TKO", events);
          return true;
        }
        continue;
      }
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
    if (opts.chip) continue;
    if (tier !== "graze") queueSetups(state, att, [c], "hit");
    // Elbows open cuts on any clean hit; everything else needs a critical hit.
    if (target === "head" && (card.cut ? tier !== "graze" : tier === "crit") && cutOpens(state, att, def, events)) return true;
  }
  if (opts.chip) return false;
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

/** A fresh mat situation: `top` is on top at position `pos`. */
const makeGround = (top, pos) => ({ top, pos, lock: null, hist: [] });

/**
 * A lock goes on. How deep it starts depends on the card (base), on who is the better submission man, on how tired the victim is,
 * and on the fighter's own ability. The fight that follows is a guessing game: every wrong guess by the victim sinks it a stage deeper.
 */
function startLock(state, attacker, cardName, base, events, extra = 0) {
  const l = state.rules.lock;
  const atk = state[attacker];
  const def = state[opposite(attacker)];
  const edge = atk.attrs.submission - (def.attrs.submission + def.attrs.grappleDef) / 2;
  let depth = base + extra;
  if (edge >= l.edgeDeep) depth += 1;
  if (def.stamina < l.lowStaminaAt) depth += 1;
  depth = clamp(depth, 1, l.maxStart);
  state.ground.lock = { attacker, name: cardName, depth, hist: [] };
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



/**
 * One round of a lock fight. The attacker picked a move and the defender picked the answer; no energy, no dice, only the guess.
 * A right guess eases the lock a stage (past the first, he is out); a wrong one sinks it deeper, and the last stage is the tap.
 */
function resolveLock(state, plays, events, opts = {}) {
  const lock = state.ground.lock;
  const l = state.rules.lock;
  const atk = lock.attacker;
  const def = opposite(atk);
  const move = (s) => state.cards[plays[s][0]].lockMove;
  const guessed = l.beats[move(atk)] === move(def);
  (lock.hist ||= []).push({ [atk]: move(atk), [def]: move(def) });
  if (guessed) {
    addMomentum(state, def, state.rules.momentum.win);
    addMomentum(state, atk, state.rules.momentum.lose);
    lock.depth -= 1;
    addStamina(state, atk, -l.escapePenalty);
    if (lock.depth <= 0) {
      state.ground.lock = null;
      events.push({ kind: "lockEscape", side: def, name: lock.name });
    } else {
      events.push({ kind: "lockEase", side: def, name: lock.name, depth: lock.depth });
    }
    return;
  }
  addMomentum(state, atk, state.rules.momentum.win);
  addMomentum(state, def, state.rules.momentum.lose);
  addStamina(state, def, -l.holdDrain);
  // A wrong guess still has to sink the lock: the man in it may hold on.
  const chance = lockResistChance(state);
  const held = typeof opts.resist === "boolean" ? opts.resist : nextUnit(state) < chance;
  if (held) {
    events.push({ kind: "lockResist", side: def, name: lock.name, depth: lock.depth, chance });
    return;
  }
  lock.depth += 1;
  score(state, atk, "grappling", state.rules.score.lockAttempt);
  if (lock.depth >= l.tapDepth) {
    events.push({ kind: "tap", attacker: atk, name: lock.name });
    finish(state, atk, "SUB", events);
    return;
  }
  events.push({ kind: "lockDeepen", attacker: atk, name: lock.name, depth: lock.depth });
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
      if (startedOnGround && t.on !== "takedown" && !t.ground) continue;
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




/** Overcommitting on the mat: the loser pays for energy beyond the first, as on his feet. */
function groundOvercommit(state, loser) {
  const extra = Math.max(0, (state.exchangeCost?.[loser] ?? 0) - 1);
  return 1 + extra * state.rules.damage.overcommitPerEnergy;
}

/** The man underneath turns the tables: he becomes the top man at the bottom of the pile. */
function sweepOver(state, w, events) {
  const g = state.ground;
  g.top = w;
  g.pos = state.rules.ground.sweepPos;
  g.lock = null;
  g.hist = []; // what was played before belongs to the old roles
  score(state, w, "grappling", state.rules.score.takedown);
  events.push({ kind: "sweep", side: w, name: state.rules.positions[g.pos] });
}

/** Wins by the man on top. `bCat` is what the man underneath played, `bCards` the cards he threw. */
function groundTopWins(state, w, l, wCards, cat, bCat, tier, events) {
  const g = state.ground;
  const R = state.rules;
  const mult = groundOvercommit(state, l);
  if (cat === "punch") {
    const cover = bCat === "cover" ? R.ground.coverMult : 1;
    dealHit(state, w, wCards, tier, R.damage.winStrikeBonus * R.damage.groundPositionMult[g.pos] * cover * mult, events);
    return;
  }
  if (cat === "pass") {
    const bonus = wCards.reduce((sum, c) => sum + (state.cards[c].advanceBonus || 0), 0);
    const step = (tier === "graze" ? 0 : tier === "crit" ? 2 : 1) + bonus;
    if (step > 0) {
      setPosition(state, g.pos + step, events, w);
      addStamina(state, l, -R.grapple.drainOnLanding);
    } else {
      events.push({ kind: "ride", side: w });
    }
    return;
  }
  if (cat === "lock") {
    // A lock that was only brushed does not take hold.
    if (tier === "graze") {
      events.push({ kind: "ride", side: w });
      return;
    }
    const card = state.cards[wCards[0]];
    startLock(state, w, card.lock, card.lockDepth || 1, events);
    return;
  }
  // Hold: he stays heavy. It catches an escape, and drains him either way.
  addStamina(state, l, -R.grapple.topControlDrain * mult * (bCat === "escape" ? 1.5 : 0.5));
  events.push({ kind: "ride", side: w, caught: bCat === "escape" });
}

/** Wins by the man underneath: he stops what was coming, and with a good roll he works free. */
function groundBottomWins(state, w, l, wCards, cat, tier, events) {
  const g = state.ground;
  const R = state.rules;
  const mult = groundOvercommit(state, l);
  const card = state.cards[wCards[0]];
  if (cat === "counter") {
    const ended = dealHit(state, w, wCards, tier, R.damage.bottomCounterMult * mult, events);
    if (ended) return;
    // Catching a punch is not enough for a lock from underneath: it needs a critical read.
    if (card.lockBottom && tier === "crit") {
      if (passive(state, w).lockDepthBottom) showAbility(state, w, events);
      startLock(state, w, card.lock, card.lockDepth || 1, events, passive(state, w).lockDepthBottom || 0);
      return;
    }
    if (tier === "crit") sweepOver(state, w, events);
    else if (tier === "clean") setPosition(state, g.pos - 1, events, w);
    return;
  }
  // A heavy top man (escapePenalty) makes every escape one grade worse.
  const grades = ["graze", "clean", "crit"];
  let eTier = tier;
  if (cat === "escape") {
    eTier = grades[Math.max(0, grades.indexOf(tier) - (passive(state, l).escapePenalty || 0))];
    if (eTier !== tier) showAbility(state, l, events);
  }
  events.push({ kind: "stopped", side: w, by: cat });
  if (eTier === "graze") {
    addStamina(state, l, -R.grapple.drainOnLanding * 0.5);
    return;
  }
  if (eTier === "crit") {
    sweepOver(state, w, events);
    return;
  }
  if (cat === "escape") {
    const to = R.ground.escapeTo[g.pos];
    if (to < 0) standUp(state, events, "getup");
    else setPosition(state, to, events, w);
  } else if (g.pos > 0) setPosition(state, g.pos - 1, events, w);
  else addStamina(state, l, -R.grapple.topControlDrain * mult);
}

/**
 * One exchange on the mat. The man on top chooses an action (punch / pass / lock, or the free hold),
 * the man underneath guesses (frame beats pass, counter beats punch, escape beats lock, or the free cover).
 * In a lock fight both pick a move instead. rules.ground.matrix says who comes out ahead.
 */
function resolveGroundExchange(state, playA, playB, opts = {}) {
  const R = state.rules;
  const g = state.ground;
  const events = [];
  const plays = { a: [...playA], b: [...playB] };
  const lockFight = Boolean(g.lock);
  const cat = { a: groundCatOf(state, "a", plays.a), b: groundCatOf(state, "b", plays.b) };
  const types = { a: lockFight ? state.cards[plays.a[0]].type : R.ground.cats[cat.a].type, b: lockFight ? state.cards[plays.b[0]].type : R.ground.cats[cat.b].type };
  const wasRocked = { a: state.a.rocked, b: state.b.rocked };
  const groundBefore = { ...g };
  const startDist = state.dist;
  state.exchangeCost = { a: costOf(state, plays.a, "a"), b: costOf(state, plays.b, "b") };
  for (const s of SIDES) addStamina(state, s, -state.exchangeCost[s] * R.stamina.perEnergy);

  // Who comes out ahead.
  let winner = null;
  let text = R.ground.wins.stalemate;
  let guessed = false;
  if (lockFight) {
    const atk = g.lock.attacker;
    guessed = R.lock.beats[state.cards[plays[atk][0]].lockMove] === state.cards[plays[opposite(atk)][0]].lockMove;
    winner = guessed ? opposite(atk) : atk;
    text = guessed ? "猜中了！" : "沒猜中";
  } else {
    const top = g.top;
    const out = groundOutcome(state, cat[top], cat[opposite(top)]);
    winner = out === "top" ? top : out === "bottom" ? opposite(top) : null;
    if (winner) text = R.ground.wins[cat[winner]];
  }
  const labelOf = (s) => (lockFight ? (state.cards[plays[s][0]].lockSide === "attack" ? "進攻" : "防守") : R.ground.cats[cat[s]].label);
  events.push({ kind: "reveal", a: plays.a, b: plays.b, types, labels: { a: labelOf("a"), b: labelOf("b") }, winner, ground: groundBefore, dist: state.dist, cost: { ...state.exchangeCost } });
  events.push({ kind: "verdict", winner, type: winner ? types[winner] : types.a, text });

  if (winner && !lockFight) {
    const l = opposite(winner);
    addMomentum(state, winner, R.momentum.win);
    addMomentum(state, l, R.momentum.lose);
    score(state, winner, cat[winner] === "punch" || cat[winner] === "counter" ? "striking" : "grappling", R.score.exchangeWin);
    const tier = rollTier(state, winner, plays[winner]);
    const isTop = g.top === winner;
    if (isTop) groundTopWins(state, winner, l, plays[winner], cat[winner], cat[l], tier, events);
    else groundBottomWins(state, winner, l, plays[winner], cat[winner], tier, events);
  } else if (!lockFight) {
    // Nobody acted on anything: both catch their breath, and a referee will stand them up if it drags on.
    state.stall += 1;
    events.push({ kind: "standoff", stall: state.stall, ground: true });
    if (state.stall >= R.stall.limit) {
      addMomentum(state, "a", R.momentum.standoff);
      addMomentum(state, "b", R.momentum.standoff);
      state.stall = 0;
      standUp(state, events, "referee");
    }
  } else {
    resolveLock(state, plays, events, opts);
  }
  if (winner || lockFight) state.stall = 0;
  if (!lockFight) (g.hist ||= []).push({ a: cat.a, b: cat.b });

  state.history.push(types);
  if (!state.over) applyAbilities(state, types, winner, startDist, true, events);
  state.cage = null; // nobody is pinned on the mat
  for (const s of SIDES) state[s].pressure = 0;
  endExchange(state, plays, types, wasRocked, events);
  state.exchangeCost = null;
  return events;
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
      if (i < 0) continue; // a card already used earlier this hand
      me.hand.splice(i, 1);
      if (state.cards[c].cat) me.gdiscard.push(c);
      else if (!state.cards[c].signature && !state.cards[c].basic && !state.cards[c].lockMove) me.discard.push(c);
    }
    refillHand(state, s);
  }
  if (state.ground) score(state, state.ground.top, "grappling", state.rules.score.controlByPos[state.ground.pos]);

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
  state.edge = null;
  state.guardStreak = null;
  state.a.rocked = false;
  state.b.rocked = false;
  // The cutman works on the cut between rounds.
  for (const side of SIDES) state[side].cut = Math.max(0, state[side].cut - state.rules.cut.roundHeal);
  state.ground = null;
  state.dist = state.rules.dist.start;
  state.stall = 0;
  for (const side of SIDES) refillHand(state, side); // back to the stand-up hand
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
    // On the mat `hand` is the ground hand and the stand-up hand waits in `stand`.
    const standHand = me.stand ?? me.hand;
    const onMat = me.stand ? me.hand : [];
    const deckCards = standHand.filter((c) => c !== f.signature && !state.cards[c].basic).length + me.draw.length + me.discard.length;
    if (deckCards !== f.deck.length) errors.push(`${s} deck size ${deckCards} != ${f.deck.length}`);
    const groundCards = onMat.filter((c) => state.cards[c].cat).length + me.gdraw.length + me.gdiscard.length;
    if (groundCards !== f.groundDeck.length) errors.push(`${s} ground deck size ${groundCards} != ${f.groundDeck.length}`);
    if (Boolean(me.stand) !== Boolean(state.ground) && state.phase === "exchange" && !state.pending) errors.push(`${s} hand/mat mismatch`);
    if (!(Number.isInteger(me.cut) && me.cut >= 0 && me.cut <= state.rules.cut.max)) errors.push(`${s}.cut ${me.cut}`);
    if (!state.ground) for (const basic of state.rules.match.basics) if (!standHand.includes(basic)) errors.push(`${s} missing ${basic}`);
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
