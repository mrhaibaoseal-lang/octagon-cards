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
    gh: null, // the hand on the mat in progress (see groundHand)
    gHist: { lead: { a: [], b: [] }, ans: { a: [], b: [] } }, // what each side led with and answered with on the mat, for the AI to read habits
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
const GR = (state) => state.rules.ground;
const POINTS = ["wrist", "neck", "hip"];
/** Who leads on the mat: whoever holds a lock, otherwise the man on top. The other man answers. */
export const groundLeader = (state) => (state.ground.lock ? state.ground.lock.attacker : state.ground.top);

/**
 * Can `s` play this ground card where the mat stands now? Cards are tied to a role and a range of positions.
 * Once a lock is on, the man holding it has one step left (tighten) and the man in it can only try to escape.
 */
function groundCardUsable(state, s, card) {
  if (!card.cat) return false;
  const g = state.ground;
  const leading = groundLeader(state) === s;
  if (card.cat === "tighten") return leading;
  if (g.lock) return !leading && card.cat === "escape" && g.pos >= card.pos[0] && g.pos <= card.pos[1];
  if (card.side !== roleOf(state, s)) return false;
  return g.pos >= card.pos[0] && g.pos <= card.pos[1];
}

const GROUND_ORDER = ["punch", "ctrl", "pass", "lock", "tighten", "counter", "escape"];

/**
 * On the mat a fighter holds ground cards only (the stand-up hand is kept aside): the basic steps everyone has that fit this role
 * and position, plus a few of his own special moves drawn from his ground deck. Special moves that stop fitting go back.
 */
function refillGround(state, s) {
  const me = state[s];
  if (!me.stand) {
    me.stand = me.hand;
    me.hand = [];
  }
  const keep = me.hand.filter((c) => !isBasic(state, c) && groundCardUsable(state, s, state.cards[c]));
  me.gdraw.push(...me.hand.filter((c) => state.cards[c].cat && !isBasic(state, c) && !keep.includes(c)));
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
  const usable = (c) => groundCardUsable(state, s, state.cards[c]);
  while (hand.length < GR(state).handSize) {
    const c = take(usable);
    if (!c) break;
    hand.push(c);
  }
  const basics = GR(state).basics.filter((c) => usable(c));
  const all = [...hand, ...basics];
  all.sort((x, y) => GROUND_ORDER.indexOf(state.cards[x].cat) - GROUND_ORDER.indexOf(state.cards[y].cat) || Number(Boolean(state.cards[x].basic)) - Number(Boolean(state.cards[y].basic)) || state.cards[x].cost - state.cards[y].cost);
  me.hand = all;
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
  if (state.ground) return Boolean(s) && groundCardUsable(state, s, card);
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

/** Where a lock fight stands: the stage (1 to tapDepth - 1; reaching tapDepth is the tap), who holds it and what it is called. */
export function lockStatus(state) {
  const lock = state.ground?.lock;
  if (!lock) return null;
  return { attacker: lock.attacker, name: lock.name, aim: lock.aim, depth: lock.depth, tapDepth: state.rules.lock.tapDepth };
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

// ---------- Ground: steps, answers, AI ----------

const G_AIMS = ["punch", "wrist", "neck", "hip", "pass", "lock", "hold"];
const G_ANSWERS = ["cover", "frame", "shrimp", "hands", "escape", "counter"];
/** The answer that stops each aim for good. A punch is answered by a counter or a cover; a lock by its point's answer or an escape. */
const ANSWER_FOR = { wrist: "hands", neck: "frame", hip: "shrimp", pass: "frame" };

/** What a ground step goes for: a punch, one of the three points, the pass; a lock or a tighten goes for the point it works on. */
export function aimOf(state, cardId) {
  const c = state.cards[cardId];
  if (c.cat === "punch") return "punch";
  if (c.cat === "tighten") return state.ground?.lock?.aim || "wrist";
  return c.aim || "punch";
}

/** How many steps the man in charge can string together: more stamina, longer chain; stunned, one. */
export function groundMax(state, s) {
  const me = state[s];
  if (me.rocked) return 1;
  let n = GR(state).steps.find(([min]) => me.stamina >= min)[1];
  n += tagSum(state, s, "combo");
  if (isFinal(state)) n += 1;
  return clamp(n, 1, 4);
}

/** The hand on the mat in progress. Created when first asked for: the leader is the man on top (or whoever holds a lock). */
export function groundHand(state) {
  if (!state.ground) throw new Error("not on the mat");
  if (!state.gh) {
    const L = groundLeader(state);
    state.gh = { leader: L, resp: opposite(L), started: false, combo: [], i: 0, plan: null, stop: null, edge: null, thrown: { a: [], b: [] }, wasRocked: { a: state.a.rocked, b: state.b.rocked }, landed: 0 };
  }
  return state.gh;
}

/** Why this chain of steps cannot be played, or null. A lock card needs its point already under control (a control step earlier in the chain counts). */
export function groundComboError(state, s, cards) {
  const g = state.ground;
  const H = groundHand(state);
  if (H.leader !== s) return "not leading";
  if (H.started) return "already started";
  if (g.lock && !cards.length) return "choose a move";
  if (cards.length > groundMax(state, s)) return "too long";
  const have = {};
  for (const c of state[s].hand) have[c] = (have[c] || 0) + 1;
  const used = {};
  const pts = { ...g.pts };
  let lock = Boolean(g.lock);
  for (const c of cards) {
    const card = state.cards[c];
    if (!card || !have[c]) return "not in hand";
    if (!card.basic) {
      used[c] = (used[c] || 0) + 1;
      if (used[c] > have[c]) return "not in hand";
    }
    if (!groundCardUsable(state, s, card)) return "not usable here";
    if (card.cat === "ctrl") pts[card.aim] = Math.min(GR(state).ctrl.max, pts[card.aim] + 1);
    else if (card.cat === "lock") {
      if (lock) return "already locked";
      if (pts[card.aim] < 1) return "control first";
      lock = true;
    } else if (card.cat === "tighten" && !lock) return "no lock to tighten";
  }
  return null;
}

/** Why this answer cannot be played, or null. An answer picked live (a slow step was seen coming) works the same way. */
export function groundPlanError(state, s, plan) {
  const k = plan?.kind;
  const me = state[s];
  if (!GR(state).answers[k]) return "unknown response";
  const H = groundHand(state);
  if (H.resp !== s) return "not responding";
  if (me.rocked && !["cover", "frame", "hands", "shrimp"].includes(k)) return "stunned";
  if (k === "counter" || k === "escape") {
    const card = state.cards[plan.card];
    if (!card || !me.hand.includes(plan.card)) return "not in hand";
    if (card.cat !== k) return "wrong card";
    if (!groundCardUsable(state, s, card)) return "not usable here";
    if (!card.basic && H.thrown[s].includes(plan.card)) return "already used";
  }
  return null;
}

/** The cards that can back a counter or an escape from here. */
export function groundAnswerCards(state, s, kind) {
  return state[s].hand.filter((c) => state.cards[c].cat === kind && groundCardUsable(state, s, state.cards[c]) && !(!state.cards[c].basic && state.gh?.thrown[s].includes(c)));
}

/** The next step of the chain and whether the man answering can see it coming (null when the chain is over). */
export function groundWaiting(state) {
  const H = state.gh;
  if (!H?.started || H.stop || H.i >= H.combo.length) return null;
  const cid = H.combo[H.i];
  const speed = cardSpeed(state, H.leader, cid);
  const reaction = reactionOf(state, H.resp);
  return { index: H.i, of: H.combo.length, card: cid, aim: aimOf(state, cid), speed: Math.round(speed), reaction: Math.round(reaction), visible: speed < reaction };
}

/** The leader has laid out his steps and the other man his answer. A held position (no steps) resolves at once. Returns events. */
export function groundStart(state, combo, plan = { kind: "cover" }) {
  const g = state.ground;
  const H = groundHand(state);
  const L = H.leader;
  const S = H.resp;
  const err = groundComboError(state, L, combo);
  if (err) throw new Error(`${L} illegal chain: ${err} (${combo.join(",")})`);
  const perr = groundPlanError(state, S, plan);
  if (perr) throw new Error(`${S} illegal answer: ${perr}`);
  H.started = true;
  H.combo = [...combo];
  H.plan = { ...plan };
  const hist = (state.gHist ||= { lead: { a: [], b: [] }, ans: { a: [], b: [] } });
  hist.ans[S].push(plan.kind);
  hist.lead[L].push(combo.length ? aimOf(state, combo[0]) : "hold");
  const events = [{ kind: "gengage", leader: L, resp: S, n: combo.length, pts: { ...g.pts }, posture: g.posture, answer: plan.kind }];
  if (!combo.length) {
    groundHold(state, H, events);
    return finishGround(state, events);
  }
  state.stall = 0;
  return events;
}

/** Drives a whole hand: `react(state, waiting)` answers steps the man underneath can see (return an answer, or null to stay with the bet). */
export function resolveGround(state, combo, plan, react = null) {
  const events = groundStart(state, combo, plan);
  while (state.gh) {
    const w = groundWaiting(state);
    const reaction = w?.visible && react ? react(state, w) : null;
    events.push(...groundStep(state, reaction));
  }
  return events;
}

/** Nobody moves: he stays heavy. It catches an escape, drains him either way, and a referee stands them up if it drags on. */
function groundHold(state, H, events) {
  const R = GR(state);
  const L = H.leader;
  const S = H.resp;
  const caught = H.plan.kind === "escape";
  addStamina(state, S, -R.holdDrain * (caught ? R.caughtMult : 0.5));
  events.push({ kind: "ride", side: L, caught });
  if (caught) {
    H.edge = L;
    state.stall = 0;
    return;
  }
  state.stall += 1;
  events.push({ kind: "standoff", stall: state.stall, ground: true });
  if (state.stall >= state.rules.stall.limit) {
    addMomentum(state, "a", state.rules.momentum.standoff);
    addMomentum(state, "b", state.rules.momentum.standoff);
    state.stall = 0;
    standUp(state, events, "referee");
  }
}

/** Turns over the next step against the bet (or against `reaction`, an answer to a step that was seen coming). */
export function groundStep(state, reaction = null) {
  const H = state.gh;
  if (!H?.started) throw new Error("no ground hand in progress");
  const R = GR(state);
  const L = H.leader;
  const S = H.resp;
  const events = [];
  const cid = H.combo[H.i];
  const card = state.cards[cid];
  const speed = cardSpeed(state, L, cid);
  const visible = speed < reactionOf(state, S);
  let resp = H.plan;
  let fromPlan = true;
  if (visible && reaction) {
    const err = groundPlanError(state, S, reaction);
    if (err) throw new Error(`${S} illegal reaction: ${err}`);
    resp = reaction;
    fromPlan = false;
  }
  const g = state.ground;
  const aim = aimOf(state, cid);
  addStamina(state, L, -standCost(state, cid) * (1 + R.stepCost * H.i));
  H.thrown[L].push(cid);
  events.push({ kind: "gcard", side: L, card: cid, name: card.name, index: H.i, of: H.combo.length, aim, speed: Math.round(speed), visible, reply: { ...resp }, posture: g.posture });
  H.i += 1;
  runGroundStep(state, H, cid, aim, resp, fromPlan, speed, events);
  if (state.ground) state.ground.posture = state.ground.lock ? 0 : card.post ?? 1;
  if (state.over || H.stop || H.i >= H.combo.length) return finishGround(state, events);
  return events;
}

/** A step meets an answer. The answer either stops it, eases it, hijacks it (counter, escape) or does nothing. */
function runGroundStep(state, H, cid, aim, resp, fromPlan, speed, events) {
  const R = GR(state);
  const card = state.cards[cid];
  const A = R.answers[resp.kind];
  const spent = () => {
    if (fromPlan && (resp.kind === "counter" || resp.kind === "escape")) H.plan = { kind: "cover" };
  };
  if (resp.kind === "counter" && card.cat === "punch") {
    spent();
    groundCounter(state, H, cid, speed, resp, events);
    return;
  }
  if (resp.kind === "escape" && card.cat !== "punch") {
    spent();
    if (groundEscape(state, H, cid, resp, events)) return;
  } else if ((A.stops || []).includes(aim)) {
    groundStopped(state, H, cid, aim, resp, events);
    return;
  }
  const eased = (A.eases || []).includes(aim);
  switch (card.cat) {
    case "punch": landPunch(state, H, cid, resp, events); break;
    case "ctrl": landCtrl(state, H, cid, events); break;
    case "pass": landPass(state, H, cid, eased, events); break;
    case "lock": landLock(state, H, cid, events); break;
    case "tighten": landTighten(state, H, cid, events); break;
    default: break;
  }
}

const resetPts = (g) => {
  for (const p of POINTS) g.pts[p] = 0;
};

/** The answer stops the step: the chain ends, the man on top loses some of his hold, and the man underneath has the edge. */
function groundStopped(state, H, cid, aim, resp, events) {
  const R = GR(state);
  const g = state.ground;
  const L = H.leader;
  const S = H.resp;
  const card = state.cards[cid];
  events.push({ kind: "gstop", side: S, by: resp.kind, aim, card: cid, name: card.name });
  H.stop = "stop";
  H.edge = S;
  addStamina(state, L, -R.stop.drainLeader);
  addStamina(state, S, -R.stop.drainResp);
  for (const p of POINTS) g.pts[p] = Math.max(0, g.pts[p] - R.stop.ptsLoss);
  if (card.cat === "tighten" && g.lock) easeLock(state, S, events);
}

/** A lock gives up a stage; at the first stage it is gone. */
function easeLock(state, side, events) {
  const g = state.ground;
  const lock = g.lock;
  lock.depth -= 1;
  if (lock.depth <= 0) {
    g.lock = null;
    events.push({ kind: "lockEscape", side, name: lock.name });
  } else events.push({ kind: "lockEase", side, name: lock.name, depth: lock.depth });
}

function landPunch(state, H, cid, resp, events, scale = 1) {
  const R = GR(state);
  const D = state.rules.damage;
  const g = state.ground;
  const L = H.leader;
  const tier = rollTier(state, L, [cid], R.posture.topEdge[g.posture]);
  let m = D.winStrikeBonus * D.groundPositionMult[g.pos] * R.posture.dmg[g.posture] * R.punchScale * scale;
  if (resp.kind === "cover") m *= R.coverMult;
  else if (R.answers[resp.kind]?.punch) m *= R.answers[resp.kind].punch;
  H.landed += 1;
  return dealHit(state, L, [cid], tier, m, events);
}

function landCtrl(state, H, cid, events) {
  const R = GR(state);
  const g = state.ground;
  const L = H.leader;
  const aim = state.cards[cid].aim;
  // A hold already firm is harder to tighten further.
  const tier = rollTier(state, L, [cid], R.posture.topEdge[g.posture] - 0.04 * g.pts[aim]);
  const before = g.pts[aim];
  g.pts[aim] = Math.min(R.ctrl.max, before + R.ctrl[tier]);
  H.landed += 1;
  if (g.pts[aim] > before) score(state, L, "grappling", state.rules.score.positionGain * 0.25);
  events.push({ kind: "gctrl", side: L, point: aim, level: g.pts[aim], gained: g.pts[aim] - before, tier });
}

function landPass(state, H, cid, eased, events) {
  const R = GR(state);
  const g = state.ground;
  const L = H.leader;
  const S = H.resp;
  const card = state.cards[cid];
  const tier = rollTier(state, L, [cid], R.posture.topEdge[g.posture] + R.passHip * g.pts.hip);
  let step = (tier === "graze" ? 0 : tier === "crit" ? 2 : 1) + (card.advanceBonus || 0);
  if (eased) {
    step = Math.floor(step / 2);
    events.push({ kind: "geased", side: S, aim: "pass" });
  }
  H.landed += 1;
  if (step > 0) {
    g.pts.hip = Math.max(0, g.pts.hip - 1);
    setPosition(state, g.pos + step, events, L);
    addStamina(state, S, -state.rules.grapple.drainOnLanding);
  } else events.push({ kind: "ride", side: L });
}

function landLock(state, H, cid, events) {
  const R = GR(state);
  const g = state.ground;
  const L = H.leader;
  const card = state.cards[cid];
  const aim = card.aim;
  if (g.pts[aim] < 1) {
    // The hold was lost on the way (an earlier step failed): the lock has nothing to grab.
    events.push({ kind: "gctrl", side: L, point: aim, level: g.pts[aim], gained: 0, fail: true });
    return;
  }
  const tier = rollTier(state, L, [cid], R.posture.topEdge[g.posture]);
  if (tier === "graze") {
    events.push({ kind: "ride", side: L });
    return;
  }
  H.landed += 1;
  startLock(state, L, card.lock, card.lockDepth || 1, events, (g.pts[aim] >= 2 ? 1 : 0) + (tier === "crit" ? 1 : 0), aim);
}

function landTighten(state, H, cid, events) {
  const g = state.ground;
  const L = H.leader;
  const S = H.resp;
  const lock = g.lock;
  if (!lock || lock.attacker !== L) return;
  const R = GR(state);
  const tier = rollTier(state, L, [cid], R.posture.topEdge[g.posture]);
  if (tier === "graze") {
    events.push({ kind: "ride", side: L, held: true });
    return;
  }
  H.landed += 1;
  addStamina(state, S, -state.rules.lock.holdDrain);
  // The man in it may still hold on: his skill and stamina against the lock's depth. Rolled for both sides; the screen shows the chance.
  const chance = lockResistChance(state);
  if (nextUnit(state) < chance) {
    events.push({ kind: "lockResist", side: S, name: lock.name, depth: lock.depth, chance });
    return;
  }
  lock.depth += 1;
  score(state, L, "grappling", state.rules.score.lockAttempt);
  if (lock.depth >= state.rules.lock.tapDepth) {
    events.push({ kind: "tap", attacker: L, name: lock.name });
    finish(state, L, "SUB", events);
    return;
  }
  events.push({ kind: "lockDeepen", attacker: L, name: lock.name, depth: lock.depth });
}

/** The man underneath hits first (or not): a counter thrown at a punch. Quicker than the punch, it stops it; slower, they trade. */
function groundCounter(state, H, cid, speed, resp, events) {
  const R = GR(state);
  const D = state.rules.damage;
  const g = state.ground;
  const S = H.resp;
  const c = resp.card;
  const cc = state.cards[c];
  addStamina(state, S, -standCost(state, c));
  H.thrown[S].push(c);
  const cs = cardSpeed(state, S, c);
  const first = cs > speed;
  events.push({ kind: "gcounter", side: S, card: c, name: cc.name, first, speed: Math.round(cs), vs: Math.round(speed) });
  if (!first) {
    // Too slow: the punch lands (a little softened) and his own blow only grazes.
    if (landPunch(state, H, cid, resp, events, D.tradeMult)) return;
    dealHit(state, S, [c], "graze", D.tradeInterruptMult, events);
    return;
  }
  H.stop = "counter";
  H.edge = S;
  const tier = rollTier(state, S, [c], R.posture.bottomEdge[g.posture]);
  if (dealHit(state, S, [c], tier, D.bottomCounterMult, events)) return;
  // Catching a punch is not enough for a lock from underneath: it needs a critical read.
  if (cc.lockBottom && tier === "crit") {
    if (passive(state, S).lockDepthBottom) showAbility(state, S, events);
    startLock(state, S, cc.lock, cc.lockDepth || 1, events, passive(state, S).lockDepthBottom || 0, cc.aim);
    return;
  }
  if (tier === "crit") sweepOver(state, S, events);
  else if (tier === "clean") setPosition(state, g.pos - 1, events, S);
}

/**
 * The man underneath goes for the exit the moment something other than a punch comes. Returns true when it works (the chain ends).
 * His chance is the card's own plus the top man's posture, less what the man on top already controls.
 */
function groundEscape(state, H, cid, resp, events) {
  const R = GR(state);
  const g = state.ground;
  const L = H.leader;
  const S = H.resp;
  const card = state.cards[cid];
  const ec = state.cards[resp.card];
  addStamina(state, S, -standCost(state, resp.card));
  H.thrown[S].push(resp.card);
  const total = POINTS.reduce((n, p) => n + g.pts[p], 0);
  const extra = R.posture.bottomEdge[g.posture] - R.escapePts * total - (g.lock ? R.escapeLock * g.lock.depth : 0);
  const grades = ["graze", "clean", "crit"];
  let tier = rollTier(state, S, [resp.card], extra);
  // A heavy top man (escapePenalty) makes every escape one grade worse.
  if (passive(state, L).escapePenalty) {
    const worse = grades[Math.max(0, grades.indexOf(tier) - 1)];
    if (worse !== tier) showAbility(state, L, events);
    tier = worse;
  }
  events.push({ kind: "gescape", side: S, card: resp.card, name: ec.name, tier });
  if (tier === "graze") return false;
  H.stop = "escape";
  H.edge = S;
  if (g.lock) {
    if (tier === "crit") {
      const name = g.lock.name;
      g.lock = null;
      events.push({ kind: "lockEscape", side: S, name });
    } else easeLock(state, S, events);
    return true;
  }
  if (card.cat === "lock") return true;
  if (tier === "crit") {
    sweepOver(state, S, events);
    return true;
  }
  const to = R.escapeTo[g.pos];
  resetPts(g);
  if (to < 0) standUp(state, events, "getup");
  else setPosition(state, to, events, S);
  return true;
}

/** The man underneath turns the tables: he becomes the top man at the bottom of the pile. */
function sweepOver(state, w, events) {
  const g = state.ground;
  g.top = w;
  g.pos = state.rules.ground.sweepPos;
  g.lock = null;
  g.hist = [];
  resetPts(g);
  g.posture = 1;
  score(state, w, "grappling", state.rules.score.takedown);
  events.push({ kind: "sweep", side: w, name: state.rules.positions[g.pos] });
}

/** Everything a ground hand leaves behind: the edge, abilities, scores, the cards played and the next hands. */
function finishGround(state, events) {
  const H = state.gh;
  const R = GR(state);
  const L = H.leader;
  const S = H.resp;
  if (H.combo.length && !H.stop && !state.over && H.i >= H.combo.length) {
    H.stop = "done";
    H.edge = L;
    addStamina(state, S, -R.comboDrain);
    events.push({ kind: "comboDone", side: L, n: H.combo.length });
  }
  const rockedNow = (s) => state[s].rocked && state[s].rockedAt === state.history.length;
  if (rockedNow(S) && !rockedNow(L)) H.edge = L;
  if (rockedNow(L) && !rockedNow(S)) H.edge = S;
  const typeOfAnswer = R.answers[H.plan.kind]?.type || "C";
  const firstStep = H.combo.length ? state.cards[H.combo[0]].type : "C";
  const punchy = H.combo.some((c) => state.cards[c].cat === "punch");
  const types = { [L]: H.combo.length ? (punchy && firstStep === "S" ? "S" : "G") : "C", [S]: typeOfAnswer };
  if (H.edge && !state.over) {
    addMomentum(state, H.edge, state.rules.momentum.win);
    addMomentum(state, opposite(H.edge), state.rules.momentum.lose);
    score(state, H.edge, H.thrown[H.edge].some((c) => ["punch", "counter"].includes(state.cards[c].cat)) ? "striking" : "grappling", state.rules.score.exchangeWin);
  }
  state.history.push(types);
  if (!state.over) applyAbilities(state, types, H.edge, state.dist, true, events);
  state.cage = null; // nobody is pinned on the mat
  for (const s of SIDES) state[s].pressure = 0;
  state.gh = null;
  endExchange(state, H.thrown, types, H.wasRocked, events);
  state.exchangeCost = null;
  return events;
}

// ---------- Ground AI ----------

function groundStyle(state, s) {
  const f = state.fighters[state[s].id];
  const st = f.style[roleOf(state, s)];
  const plan = tactic(state, s);
  return { S: st.S + (plan.style?.S || 0), G: st.G + (plan.style?.G || 0), C: st.C + (plan.style?.C || 0) };
}

const readBoostOf = (state, s) => {
  let b = 1;
  for (const tag of Object.keys(state[opposite(s)].marks)) b *= state.rules.tags[tag]?.readBoost || 1;
  return b;
};

/** The value of a ground card for the AI's own choice among cards of the same kind. */
function groundCardValue(state, s, cardId) {
  const card = state.cards[cardId];
  const gm = state.rules.damage.groundPositionMult[state.ground.pos];
  // A slow step is read before it lands, so the AI trusts it less (a stunned man reads nothing).
  const readable = ["punch", "pass", "lock"].includes(card.cat) && cardSpeed(state, s, cardId) < reactionOf(state, opposite(s)) ? 0.3 : 1;
  if (card.cat === "punch") return (cardDamage(state, s, cardId) * gm + (card.cut ? 2 : 0)) * readable;
  if (card.cat === "pass") return (card.cost + (card.quality || 0) * 4 + (card.advanceBonus || 0) * 3) * readable;
  if (card.cat === "lock") return (4 + card.cost + (card.quality || 0) * 4) * readable;
  if (card.cat === "counter") return cardDamage(state, s, cardId) + (card.lockBottom ? 8 : 0) + (card.crit || 0) * 10;
  return card.cost + (card.crit || 0) * 10;
}

/** The best card in hand that fits `pred`, or null. */
function bestGroundCard(state, s, pred, skip = null) {
  let best = null;
  let bestValue = -Infinity;
  for (const c of state[s].hand) {
    const card = state.cards[c];
    if (!groundCardUsable(state, s, card) || !pred(card) || (skip && !card.basic && skip.has(c))) continue;
    const v = groundCardValue(state, s, c);
    if (v > bestValue) {
      bestValue = v;
      best = c;
    }
  }
  return best;
}

const lockCardsReady = (state, s) => state[s].hand.filter((c) => state.cards[c].cat === "lock" && state.ground.pts[state.cards[c].aim] >= 1);

/** The leader's tendencies on the mat: which step he reaches for first. Honest: the AI samples these same numbers. */
function groundLeadIntent(state, s) {
  const R = state.rules;
  const G = R.ground;
  const ai = R.ai;
  const A = G.ai;
  const g = state.ground;
  const me = state[s];
  const oppSide = opposite(s);
  const tags = [];
  const options = G_AIMS.map((id) => ({ id, label: G.aims[id].label, type: G.aims[id].type }));
  if (g.lock) {
    return { kind: "lead", ground: true, options: [{ id: "tighten", label: "收緊", type: "S" }], probs: { tighten: 1 }, top: "tighten", tell: "", tags: ["鎖住了，繼續收緊"], blind: state[oppSide].cut >= R.cut.blindAt, detail: true, signatureReady: false };
  }
  const st = groundStyle(state, s);
  const hand = me.hand.map((c) => state.cards[c]);
  const w = { punch: st.S, pass: st.G * A.passShare, hold: st.C };
  for (const p of POINTS) w[p] = ((st.G * A.ctrlShare) / 3) * (g.pts[p] >= 2 ? 0.25 : 1);
  // A lock in hand pulls him toward the point it needs.
  for (const c of hand) if (c.cat === "lock" && g.pts[c.aim] < 1) w[c.aim] *= 1.5;
  const ready = lockCardsReady(state, s);
  const fits = hand.filter((c) => c.cat === "lock");
  w.lock = fits.length ? st.G * A.lockShare * (0.5 + me.attrs.submission / 100) * (g.pos >= 3 ? 1.4 : 1) * (ready.length ? 1.6 : 1) : 0;
  if (fits.length) tags.push("手上有鎖技，想找機會");
  const boost = readBoostOf(state, s);
  const recent = (state.gHist?.ans[oppSide] || []).slice(-ai.adapt.window);
  for (const r of recent) for (const aim of G.answers[r]?.stops || []) w[aim] = Math.max(0, w[aim] - ai.adapt.perMatch * boost);
  if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2] && G.answers[recent[recent.length - 1]]?.stops) tags.push("避開你老用的應對");
  if (state[oppSide].rocked) { w.punch += ai.swarmStrike; tags.push("要衝上來追擊"); }
  if (me.rocked) { w.hold += ai.rockedCounter; tags.push("被打暈，只能撐著"); }
  if (me.stamina < ai.lowStaminaAt) { w.hold += ai.lowStaminaCounter; tags.push("快沒力了"); }
  const open = (id) => {
    if (id === "hold") return true;
    if (id === "lock") return fits.length > 0;
    if (id === "punch") return hand.some((c) => c.cat === "punch");
    if (id === "pass") return hand.some((c) => c.cat === "pass");
    return hand.some((c) => c.cat === "ctrl" && c.aim === id);
  };
  const probs = normalise(w, ai.minWeight, open);
  const top = Object.keys(probs).reduce((best, id) => (probs[id] > probs[best] ? id : best));
  const tells = ai.tells[G.aims[top].type];
  return { kind: "lead", ground: true, options, probs, top, tell: tells[(state.round * 7 + state.exchange * 3) % tells.length], tags, blind: state[oppSide].cut >= R.cut.blindAt, detail: true, signatureReady: false };
}

/** The man answering: which answer he will bet on before the steps turn over. */
function groundRespIntent(state, s) {
  const R = state.rules;
  const G = R.ground;
  const ai = R.ai;
  const A = G.ai;
  const g = state.ground;
  const me = state[s];
  const oppSide = opposite(s);
  const tags = [];
  const st = groundStyle(state, s);
  const w = {
    cover: st.C * A.coverShare,
    frame: st.G * A.frameShare + st.C * 0.15,
    shrimp: st.G * A.shrimpShare,
    hands: st.G * A.handsShare,
    escape: st.G * A.escapeShare,
    counter: st.S + st.C * 0.2,
  };
  for (const p of POINTS) if (g.pts[p] > 0) w[ANSWER_FOR[p]] += A.ptsLean * g.pts[p];
  if (g.lock) {
    w[ANSWER_FOR[g.lock.aim]] += A.lockLean;
    w.escape += A.lockEscape;
    w.counter = 0;
    w.cover *= 0.3;
    tags.push("被鎖住，要拆解");
  }
  const boost = readBoostOf(state, s);
  const leads = (state.gHist?.lead[oppSide] || []).slice(-ai.adapt.window);
  for (const aim of leads) {
    if (aim === "punch") { w.counter += ai.adapt.perMatch * boost * 0.7; w.cover += ai.adapt.perMatch * boost * 0.3; }
    else if (ANSWER_FOR[aim]) w[ANSWER_FOR[aim]] += ai.adapt.perMatch * boost;
  }
  if (leads.length >= 2 && leads[leads.length - 1] === leads[leads.length - 2]) tags.push("看穿你的習慣");
  if (me.stamina < ai.lowStaminaAt) { w.cover += ai.lowStaminaCounter; tags.push("快沒力了"); }
  if (me.rocked) {
    w.escape = 0;
    w.counter = 0;
    w.cover += ai.rockedCounter;
    tags.push("被打暈，想撐過去");
  }
  const counters = groundAnswerCards(state, s, "counter");
  const escapes = groundAnswerCards(state, s, "escape");
  const open = (id) => (id === "counter" ? counters.length > 0 && !me.rocked && !g.lock : id === "escape" ? escapes.length > 0 && !me.rocked : true);
  const probs = normalise(w, ai.minWeight, open);
  const top = Object.keys(probs).reduce((best, id) => (probs[id] > probs[best] ? id : best));
  const options = G_ANSWERS.map((id) => ({ id, label: G.answers[id].label, type: G.answers[id].type }));
  const tells = ai.tells[G.answers[top].type];
  return { kind: "respond", ground: true, options, probs, top, tell: tells[(state.round * 7 + state.exchange * 3) % tells.length], tags, blind: state[oppSide].cut >= R.cut.blindAt, detail: true, signatureReady: false };
}

function groundIntent(state, s) {
  return groundLeader(state) === s ? groundLeadIntent(state, s) : groundRespIntent(state, s);
}

/** The card for a wanted aim, or null. */
function cardForAim(state, s, aim, skip = null, pts = state.ground.pts) {
  if (aim === "punch") return bestGroundCard(state, s, (c) => c.cat === "punch", skip);
  if (aim === "pass") return bestGroundCard(state, s, (c) => c.cat === "pass", skip);
  if (aim === "lock") return bestGroundCard(state, s, (c) => c.cat === "lock" && pts[c.aim] >= 1, skip);
  if (aim === "tighten") return "lk_tighten";
  return bestGroundCard(state, s, (c) => c.cat === "ctrl" && c.aim === aim, skip);
}

/** The leader's chain: starts with the first step he reached for, then builds toward a lock or mixes things up. */
export function chooseGroundCombo(state, s) {
  const g = state.ground;
  const ai = state.rules.ai;
  const f = state.fighters[state[s].id];
  const intent = groundLeadIntent(state, s);
  const max = groundMax(state, s);
  if (g.lock) {
    const n = state[s].stamina < ai.commit.conserveAt ? 1 : Math.min(max, 1 + (nextUnit(state) < 0.4 ? 1 : 0));
    return Array(n).fill("lk_tighten");
  }
  let first = sampleId(state, intent.probs);
  if (first === "hold") return [];
  // Going for a lock with nothing under control yet: take the point it needs first.
  let lockGoal = null;
  if (first === "lock") {
    lockGoal = bestGroundCard(state, s, (c) => c.cat === "lock");
    if (lockGoal && g.pts[state.cards[lockGoal].aim] < 1) first = state.cards[lockGoal].aim;
  }
  const style = ai.lead.styles[f.leadStyle || "balanced"];
  let len = 1;
  let r = nextUnit(state);
  for (let i = 0; i < style.len.length; i++) {
    r -= style.len[i];
    if (r < 0) { len = i + 1; break; }
  }
  len = Math.min(len, max);
  if (state[s].stamina < ai.commit.conserveAt) len = Math.min(len, 2);
  const cards = [];
  const pts = { ...g.pts };
  let locked = false;
  const readyLock = () => state[s].hand.filter((c) => state.cards[c].cat === "lock" && pts[state.cards[c].aim] >= 1);
  const usedSpecial = new Set();
  for (let k = 0; k < len; k++) {
    let want;
    if (k === 0) want = first;
    else if (locked) want = "tighten";
    else if (readyLock().length && (lockGoal || nextUnit(state) < 0.6)) want = "lock";
    else {
      const prev = state.cards[cards[cards.length - 1]];
      if (!prev) break;
      const opts = [];
      if (prev.cat === "punch") opts.push("punch", "wrist", "neck", "hip");
      else opts.push("pass", "punch", ...POINTS.filter((p) => pts[p] < 2));
      want = opts[Math.floor(nextUnit(state) * opts.length)];
    }
    const card = cardForAim(state, s, want, usedSpecial, pts);
    if (!card) {
      if (k === 0) break;
      continue;
    }
    cards.push(card);
    if (!state.cards[card].basic) usedSpecial.add(card);
    const cd = state.cards[card];
    if (cd.cat === "ctrl") pts[cd.aim] = Math.min(2, pts[cd.aim] + 1);
    if (cd.cat === "lock") locked = true;
    if (cd.cat === "pass") pts.hip = Math.max(0, pts.hip - 1);
  }
  if (groundComboError(state, s, cards)) {
    const one = cards.slice(0, 1);
    return groundComboError(state, s, one) ? [] : one;
  }
  return cards;
}

function planFrom(state, s, kind) {
  if (kind === "counter" || kind === "escape") {
    const c = bestGroundCard(state, s, (card) => card.cat === kind, new Set(state.gh?.thrown[s] || []));
    return c ? { kind, card: c } : { kind: "cover" };
  }
  return { kind };
}

/** The AI's bet before the steps turn over, drawn from the shown tendencies. */
export function chooseGroundPlan(state, s) {
  const intent = groundRespIntent(state, s);
  return planFrom(state, s, sampleId(state, intent.probs));
}

/** A step he can see coming: the AI weighs each answer by what it would do against this very step, with some of its style mixed in. */
export function chooseGroundReaction(state, s, w) {
  const G = GR(state);
  const g = state.ground;
  const me = state[s];
  const card = state.cards[w.card];
  const aim = w.aim;
  const ev = {};
  if (me.rocked) return { kind: "cover" };
  if (card.cat === "punch") {
    const cc = bestGroundCard(state, s, (c) => c.cat === "counter", new Set(state.gh?.thrown[s] || []));
    const dmg = cardDamage(state, opposite(s), w.card);
    ev.cover = dmg * (1 - G.coverMult);
    ev.frame = dmg * (1 - G.answers.frame.punch) * 0.8;
    if (cc) ev.counter = cardSpeed(state, s, cc) > w.speed ? dmg * 0.9 + state.cards[cc].power + 6 : state.cards[cc].power * 0.5 - dmg * 0.2;
  } else {
    for (const [id, a] of Object.entries(G.answers)) {
      if ((a.stops || []).includes(aim)) ev[id] = 10;
      else if ((a.eases || []).includes(aim)) ev[id] = 4;
    }
    const total = POINTS.reduce((n, p) => n + g.pts[p], 0);
    if (groundAnswerCards(state, s, "escape").length) ev.escape = (card.cat === "lock" || card.cat === "tighten" ? 7 : 5) - total;
    ev.cover = 1;
  }
  const entries = Object.entries(ev);
  if (nextUnit(state) < G.reactVisible) {
    const [best] = entries.reduce((b, e) => (e[1] > b[1] ? e : b));
    return planFrom(state, s, best);
  }
  const intent = groundRespIntent(state, s);
  const kinds = entries.map(([k]) => k);
  return planFrom(state, s, pickWeighted(state, kinds, (k) => intent.probs[k] || 0.05));
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
          startLock(state, S, cc.name, cc.lockDepth || 1, events, passive(state, S).lockDepthBottom || 0, "neck");
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
    startLock(state, l, state.cards[ctx.catcher].name, 1, events, passive(state, l).lockDepthCatch || 0, "neck");
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
    me.gdraw.push(...me.hand.filter((c) => state.cards[c].cat && !state.cards[c].basic));
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

/** What a ground chain would do, for the screen: its cost, the damage if every punch lands clean, and how many steps there can be. */
export function previewGroundCombo(state, s, cards) {
  const R = GR(state);
  const D = state.rules.damage;
  const g = state.ground;
  let cost = 0;
  let damage = 0;
  for (let i = 0; i < cards.length; i++) {
    cost += standCost(state, cards[i]) * (1 + R.stepCost * i);
    const card = state.cards[cards[i]];
    if (card.power && card.cat === "punch") damage += cardDamage(state, s, cards[i]) * D.winStrikeBonus * D.groundPositionMult[g.pos] * R.posture.dmg[g.posture] * R.punchScale;
  }
  return { cost: Math.round(cost), damage: Math.round(damage), max: groundMax(state, s), stamina: Math.round(state[s].stamina) };
}

/** How a ground card reads right now. Same shape as describeStandingCard so the screen can draw both. */
function describeGroundCard(state, s, cardId) {
  const card = state.cards[cardId];
  const g = state.ground;
  const R = GR(state);
  const names = state.rules.positions;
  const foe = opposite(s);
  const aim = aimOf(state, cardId);
  const speed = Math.round(cardSpeed(state, s, cardId));
  const point = R.points[aim] || "";
  let effect = "";
  let blocked = "";
  if (card.cat === "punch") effect = `傷害 ${Math.round(cardDamage(state, s, cardId) * state.rules.damage.winStrikeBonus * state.rules.damage.groundPositionMult[g.pos] * R.punchScale)}${card.hits > 1 ? ` · ${card.hits} 連` : ""}`;
  else if (card.cat === "ctrl") effect = `控制${point}（${g.pts[aim]}/${R.ctrl.max}）`;
  else if (card.cat === "pass") effect = g.pos >= names.length - 1 ? "已在最高位" : `→ ${names[Math.min(names.length - 1, g.pos + 1)]}`;
  else if (card.cat === "lock") {
    effect = `${card.lock}（要先控制${point}）`;
    if (g.pts[aim] < 1) blocked = `先控制${point}`;
  } else if (card.cat === "tighten") effect = g.lock ? `鎖更深（${g.lock.depth}/${state.rules.lock.tapDepth}）` : "要先鎖住";
  else if (card.cat === "counter") effect = card.lockBottom ? `鎖技：${card.lock}` : `反擊 ${Math.round(cardDamage(state, s, cardId) * state.rules.damage.bottomCounterMult)}`;
  else {
    const to = R.escapeTo[g.pos];
    effect = g.lock ? "拆鎖退一階" : to < 0 ? "站起來" : `退到${names[to]}`;
  }
  return {
    action: R.aims[aim]?.label || (card.cat === "counter" ? "反制" : card.cat === "escape" ? "逃脫" : ""),
    effect,
    aim,
    height: aim,
    heightName: R.aims[aim]?.label || "",
    speed,
    cost: Math.round(standCost(state, cardId) * 10) / 10,
    unusable: !groundCardUsable(state, s, card) || Boolean(blocked),
    blocked,
    rangeText: posText(state, card),
    seenByFoe: !["counter", "escape"].includes(card.cat) && speed < reactionOf(state, foe),
    recovery: 0,
    setups: [],
    follows: [],
    counterOnly: ["counter", "escape"].includes(card.cat),
    post: card.post ?? 1,
  };
}

/** How a card reads right now: stand-up cards by height and speed, ground cards by what they go for. */
export function describeCard(state, s, cardId) {
  return state.ground ? describeGroundCard(state, s, cardId) : describeStandingCard(state, s, cardId);
}

/** The opponent's honest tendencies. The UI shows these same numbers and the choose* functions sample from them. */
export function getIntent(state, s) {
  if (state.ground) return groundIntent(state, s);
  return state.engage ? engageIntent(state, s) : footworkIntent(state, s);
}

/** The AI's next decision, whatever the step is: a footwork, a combo or a ground chain (when leading) or a response (when answering). */
export function chooseAI(state, s) {
  if (state.ground) return groundLeader(state) === s ? { cards: chooseGroundCombo(state, s) } : { plan: chooseGroundPlan(state, s) };
  if (!state.engage) return { footwork: chooseFootwork(state, s) };
  return state.engage.leader === s ? { cards: chooseCombo(state, s) } : { plan: choosePlan(state, s) };
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
const makeGround = (top, pos) => ({ top, pos, lock: null, hist: [], pts: { wrist: 0, neck: 0, hip: 0 }, posture: 1 });

/**
 * A lock goes on. How deep it starts depends on the card (base), on who is the better submission man, on how tired the victim is,
 * and on the fighter's own ability. The fight that follows is a guessing game: every wrong guess by the victim sinks it a stage deeper.
 */
function startLock(state, attacker, cardName, base, events, extra = 0, aim = "wrist") {
  const l = state.rules.lock;
  const atk = state[attacker];
  const def = state[opposite(attacker)];
  const edge = atk.attrs.submission - (def.attrs.submission + def.attrs.grappleDef) / 2;
  let depth = base + extra;
  if (edge >= l.edgeDeep) depth += 1;
  if (def.stamina < l.lowStaminaAt) depth += 1;
  depth = clamp(depth, 1, l.maxStart);
  state.ground.lock = { attacker, name: cardName, aim, depth, hist: [] };
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
      if (state.cards[c].cat) { if (!state.cards[c].basic) me.gdiscard.push(c); }
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
    const groundCards = onMat.filter((c) => state.cards[c].cat && !state.cards[c].basic).length + me.gdraw.length + me.gdiscard.length;
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
