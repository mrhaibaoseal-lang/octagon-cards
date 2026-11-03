/// Single standing exchange resolution and structured combat log
/// (see docs/STRIKING_AND_DECK.md §12.1–12.4 and docs/TASKS.md P2-4).

/// How a standing exchange finished the fight.
public enum FinishReason: String, Sendable, Codable, Hashable, CaseIterable {
    case ko
    case tkoBody
    case tkoLegs

    public static func from(depletedTarget: HitTarget) -> FinishReason {
        switch depletedTarget {
        case .head: .ko
        case .body: .tkoBody
        case .legs: .tkoLegs
        }
    }
}

/// Winner and reason when an exchange ends the fight.
public struct ExchangeFinish: Sendable, Codable, Hashable {
    public var winner: Side
    public var reason: FinishReason

    public init(winner: Side, reason: FinishReason) {
        self.winner = winner
        self.reason = reason
    }
}

/// Per-fighter resolution details recorded in `ExchangeLog`.
public struct ExchangeSideLog: Sendable, Codable, Hashable {
    public var side: Side
    public var card: Card
    public var odds: OddsBreakdown
    /// Raw uniform draw in `0.0 ..< 1.0` from `SeededRNG.nextUnit()`.
    public var roll: Double
    /// True when `roll < odds.finalOdds`.
    public var succeeded: Bool
    /// True if the opponent acted first and KO'd or Rocked this fighter before they could act.
    public var wasInterrupted: Bool
    public var damageDealt: Double
    public var targetHit: HitTarget?
    public var inflictedRocked: Bool
    public var feintSucceeded: Bool
    public var movedDistanceTo: Distance?

    public init(
        side: Side,
        card: Card,
        odds: OddsBreakdown,
        roll: Double,
        succeeded: Bool,
        wasInterrupted: Bool = false,
        damageDealt: Double = 0.0,
        targetHit: HitTarget? = nil,
        inflictedRocked: Bool = false,
        feintSucceeded: Bool = false,
        movedDistanceTo: Distance? = nil
    ) {
        self.side = side
        self.card = card
        self.odds = odds
        self.roll = roll
        self.succeeded = succeeded
        self.wasInterrupted = wasInterrupted
        self.damageDealt = damageDealt
        self.targetHit = targetHit
        self.inflictedRocked = inflictedRocked
        self.feintSucceeded = feintSucceeded
        self.movedDistanceTo = movedDistanceTo
    }
}

/// Full audit trail of a single exchange for tests, balancing, and the in-app `[Debug]` drawer.
public struct ExchangeLog: Sendable, Codable, Hashable {
    public var firstSide: Side
    public var stateBefore: FightState
    public var stateAfter: FightState
    public var a: ExchangeSideLog
    public var b: ExchangeSideLog
    public var finish: ExchangeFinish?

    public init(
        firstSide: Side,
        stateBefore: FightState,
        stateAfter: FightState,
        a: ExchangeSideLog,
        b: ExchangeSideLog,
        finish: ExchangeFinish? = nil
    ) {
        self.firstSide = firstSide
        self.stateBefore = stateBefore
        self.stateAfter = stateAfter
        self.a = a
        self.b = b
        self.finish = finish
    }

    public subscript(side: Side) -> ExchangeSideLog {
        get { side == .a ? a : b }
        set {
            switch side {
            case .a: a = newValue
            case .b: b = newValue
            }
        }
    }
}

/// Value-returning wrapper pairing the updated `FightState` and `ExchangeLog`.
public struct ExchangeResult: Sendable, Codable, Hashable {
    public var state: FightState
    public var log: ExchangeLog

    public var finish: ExchangeFinish? { log.finish }

    public init(state: FightState, log: ExchangeLog) {
        self.state = state
        self.log = log
    }
}

public enum ExchangeEngine {
    /// Base strike/counter damage before matchup multipliers (STRIKING_AND_DECK §12.2).
    public static func baseDamage(
        attacker: Fighter,
        card: Card,
        staminaBefore: Double
    ) -> Double {
        var raw = (Double(attacker.attributes.power) * 0.40 + Double(card.power) * 0.60) * 0.265
        if staminaBefore < 40.0 {
            raw *= 0.80
        }
        if attacker.has(.onePunch) && card.power >= 75 {
            raw *= 1.15
        }
        return raw
    }

    /// Effective speed used to decide who acts first in an exchange (STRIKING_AND_DECK §12.1).
    public static func effectiveSpeed(
        fighter: Fighter,
        card: Card,
        staminaBefore: Double
    ) -> Double {
        let base = Double(fighter.attributes.speed + card.speed) / 2.0
        return staminaBefore < 40.0 ? base * 0.85 : base
    }

    /// Chin-check probability for inflicting `Rocked` on a heavy head shot (STRIKING_AND_DECK §12.3).
    public static func rockedProbability(
        damage: Double,
        attacker: Fighter,
        defender: Fighter
    ) -> Double {
        Odds.resolve(
            base: 0.22,
            modifiers: [
                (damage - 12.0) * 0.02,
                (60.0 - Double(defender.attributes.chin)) * 0.005,
                defender.has(.ironChin) ? -0.15 : 0.0,
                defender.has(.glassChin) ? 0.15 : 0.0,
                attacker.has(.onePunch) ? 0.10 : 0.0,
            ]
        )
    }

    /// Mutating exchange resolution. Updates `state` in place and returns the `ExchangeLog`.
    @discardableResult
    public static func resolve(
        a: FighterPlay,
        b: FighterPlay,
        state: inout FightState,
        rng: inout SeededRNG,
        readModifierA: Double = 0.0,
        readModifierB: Double = 0.0
    ) -> ExchangeLog {
        var playA = a
        playA.side = .a
        var playB = b
        playB.side = .b

        let stateBefore = state
        let wasRockedA = stateBefore.a.isRocked
        let wasRockedB = stateBefore.b.isRocked

        // 1. Compute odds breakdown on pre-exchange state and roll RNG for both sides.
        let oddsA = Odds.breakdown(my: playA, opp: playB, state: stateBefore, readModifier: readModifierA)
        let oddsB = Odds.breakdown(my: playB, opp: playA, state: stateBefore, readModifier: readModifierB)
        let rollA = rng.nextUnit()
        let succeededA = rollA < oddsA.finalOdds
        let rollB = rng.nextUnit()
        let succeededB = rollB < oddsB.finalOdds

        // 2. Deduct upfront card stamina costs.
        adjustStamina(&state.a, by: -Double(playA.card.staminaCost))
        adjustStamina(&state.b, by: -Double(playB.card.staminaCost))

        // 3. Determine initiative order by effective speed (ties go to Side.a).
        let speedA = effectiveSpeed(fighter: playA.fighter, card: playA.card, staminaBefore: stateBefore.a.stamina)
        let speedB = effectiveSpeed(fighter: playB.fighter, card: playB.card, staminaBefore: stateBefore.b.stamina)
        let firstSide: Side = (speedA >= speedB) ? .a : .b

        var logs: [Side: ExchangeSideLog] = [
            .a: ExchangeSideLog(side: .a, card: playA.card, odds: oddsA, roll: rollA, succeeded: succeededA),
            .b: ExchangeSideLog(side: .b, card: playB.card, odds: oddsB, roll: rollB, succeeded: succeededB),
        ]
        let plays: [Side: FighterPlay] = [.a: playA, .b: playB]
        var finish: ExchangeFinish? = nil

        // 4. Resolve first actor, then second actor (unless interrupted by finish or new Rocked).
        for activeSide in [firstSide, firstSide.opposite] {
            let oppSide = activeSide.opposite
            guard var myLog = logs[activeSide], let oppLog = logs[oppSide],
                  let myPlay = plays[activeSide], let oppPlay = plays[oppSide]
            else { continue }

            if finish != nil || oppLog.inflictedRocked {
                myLog.wasInterrupted = true
                logs[activeSide] = myLog
                continue
            }

            let raw = baseDamage(
                attacker: myPlay.fighter,
                card: myPlay.card,
                staminaBefore: stateBefore[activeSide].stamina
            )

            switch myPlay.card.type {
            case .strike:
                if oppPlay.card.type == .counter && oppLog.succeeded {
                    // Intercepted by opponent's successful counter-attack.
                    break
                } else if oppPlay.card.type == .evade && oppLog.succeeded {
                    // Opponent evaded completely: attacker whiffs and loses extra stamina/momentum.
                    adjustStamina(&state[activeSide], by: -2.0)
                    adjustMomentum(&state[activeSide], by: -5.0)
                    adjustMomentum(&state[oppSide], by: 8.0)
                } else if oppPlay.card.type == .block && oppLog.succeeded {
                    // Blocked: chip/bleed-through damage only, never triggers Rocked.
                    let mult = myLog.succeeded ? 0.45 : 0.25
                    let dmg = raw * mult
                    let target = myPlay.card.target ?? .head
                    applyDamage(
                        dmg,
                        to: target,
                        attackerSide: activeSide,
                        defenderSide: oppSide,
                        attacker: myPlay.fighter,
                        defender: oppPlay.fighter,
                        canRock: false,
                        state: &state,
                        rng: &rng,
                        myLog: &myLog,
                        finish: &finish
                    )
                    adjustMomentum(&state[oppSide], by: 4.0)
                } else {
                    if myLog.succeeded {
                        let target = myPlay.card.target ?? .head
                        applyDamage(
                            raw,
                            to: target,
                            attackerSide: activeSide,
                            defenderSide: oppSide,
                            attacker: myPlay.fighter,
                            defender: oppPlay.fighter,
                            canRock: true,
                            state: &state,
                            rng: &rng,
                            myLog: &myLog,
                            finish: &finish
                        )
                        adjustMomentum(&state[activeSide], by: 10.0)
                        adjustMomentum(&state[oppSide], by: -6.0)
                    } else {
                        adjustMomentum(&state[activeSide], by: -3.0)
                    }
                }

            case .counter:
                if myLog.succeeded {
                    let mult: Double
                    if oppPlay.card.type == .strike {
                        mult = myPlay.fighter.has(.counterPuncher) ? 1.80 : 1.60
                        adjustMomentum(&state[activeSide], by: 16.0)
                        adjustMomentum(&state[oppSide], by: -10.0)
                    } else {
                        mult = 0.80
                        adjustMomentum(&state[activeSide], by: 8.0)
                    }
                    let target = myPlay.card.target ?? .head
                    applyDamage(
                        raw * mult,
                        to: target,
                        attackerSide: activeSide,
                        defenderSide: oppSide,
                        attacker: myPlay.fighter,
                        defender: oppPlay.fighter,
                        canRock: true,
                        state: &state,
                        rng: &rng,
                        myLog: &myLog,
                        finish: &finish
                    )
                } else {
                    adjustStamina(&state[activeSide], by: -1.0)
                    adjustMomentum(&state[activeSide], by: -4.0)
                }

            case .feint:
                if myLog.succeeded {
                    myLog.feintSucceeded = true
                    adjustMomentum(&state[activeSide], by: 10.0)
                    adjustMomentum(&state[oppSide], by: -6.0)
                } else {
                    adjustMomentum(&state[activeSide], by: -2.0)
                }

            case .move:
                if myLog.succeeded {
                    state.distance = nextDistance(from: state.distance, card: myPlay.card)
                    state[activeSide].cage = improvedCagePosition(from: state[activeSide].cage)
                    myLog.movedDistanceTo = state.distance
                    adjustMomentum(&state[activeSide], by: 6.0)
                }

            case .block:
                if oppPlay.card.type != .strike && myLog.succeeded {
                    adjustStamina(&state[activeSide], by: 2.0)
                    adjustMomentum(&state[activeSide], by: 2.0)
                }

            case .evade:
                if oppPlay.card.type != .strike && myLog.succeeded {
                    adjustMomentum(&state[activeSide], by: 2.0)
                }
            }

            logs[activeSide] = myLog
        }

        // 5. Rocked recovery: if a fighter started the exchange Rocked, survived, and was not
        // newly Rocked this exchange, they recover their footing.
        let finalLogA = logs[.a]!
        let finalLogB = logs[.b]!
        if finish == nil {
            if wasRockedA && !finalLogB.inflictedRocked {
                state.a.isRocked = false
            }
            if wasRockedB && !finalLogA.inflictedRocked {
                state.b.isRocked = false
            }
        }

        return ExchangeLog(
            firstSide: firstSide,
            stateBefore: stateBefore,
            stateAfter: state,
            a: finalLogA,
            b: finalLogB,
            finish: finish
        )
    }

    /// Value-returning convenience overload.
    public static func resolve(
        a: FighterPlay,
        b: FighterPlay,
        state: FightState,
        rng: inout SeededRNG,
        readModifierA: Double = 0.0,
        readModifierB: Double = 0.0
    ) -> ExchangeResult {
        var nextState = state
        let log = resolve(
            a: a,
            b: b,
            state: &nextState,
            rng: &rng,
            readModifierA: readModifierA,
            readModifierB: readModifierB
        )
        return ExchangeResult(state: nextState, log: log)
    }

    // MARK: - Private Helpers

    private static func applyDamage(
        _ damage: Double,
        to target: HitTarget,
        attackerSide: Side,
        defenderSide: Side,
        attacker: Fighter,
        defender: Fighter,
        canRock: Bool,
        state: inout FightState,
        rng: inout SeededRNG,
        myLog: inout ExchangeSideLog,
        finish: inout ExchangeFinish?
    ) {
        let clampedDamage = max(0.0, damage)
        state[defenderSide].health[target] -= clampedDamage
        myLog.damageDealt = clampedDamage
        myLog.targetHit = target

        if state[defenderSide].health[target] <= 0.0 {
            finish = ExchangeFinish(winner: attackerSide, reason: .from(depletedTarget: target))
            return
        }

        if canRock {
            switch target {
            case .head:
                let headAfter = state[defenderSide].health.head
                if clampedDamage >= 18.0 || (clampedDamage >= 12.0 && headAfter < 55.0) {
                    let pRock = rockedProbability(damage: clampedDamage, attacker: attacker, defender: defender)
                    if rng.roll(probability: pRock) {
                        state[defenderSide].isRocked = true
                        adjustMomentum(&state[defenderSide], by: -10.0)
                        myLog.inflictedRocked = true
                    }
                }
            case .body:
                // STRIKING_AND_DECK §4: Heavy liver/body shot when defender's body & gas tank are worn
                // has a small chance (clamped 5%...95%) to fold them immediately for a Body TKO.
                let bodyAfter = state[defenderSide].health.body
                let defStamina = state[defenderSide].stamina
                if clampedDamage >= 11.0 && bodyAfter < 78.0 && defStamina < 82.0 {
                    let pFold = Odds.resolve(
                        base: 0.07,
                        modifiers: [
                            (clampedDamage - 11.0) * 0.012,
                            (82.0 - defStamina) * 0.0025,
                            (78.0 - bodyAfter) * 0.003,
                        ]
                    )
                    if rng.roll(probability: pFold) {
                        state[defenderSide].health.body = 0.0
                        finish = ExchangeFinish(winner: attackerSide, reason: .tkoBody)
                    }
                }
            case .legs:
                // STRIKING_AND_DECK §4: Heavy leg kick on already-compromised legs can buckle the base for a Leg TKO.
                let legsAfter = state[defenderSide].health.legs
                if clampedDamage >= 11.0 && legsAfter < 48.0 {
                    let pBuckle = Odds.resolve(
                        base: 0.08,
                        modifiers: [
                            (clampedDamage - 11.0) * 0.012,
                            (48.0 - legsAfter) * 0.004,
                        ]
                    )
                    if rng.roll(probability: pBuckle) {
                        state[defenderSide].health.legs = 0.0
                        finish = ExchangeFinish(winner: attackerSide, reason: .tkoLegs)
                    }
                }
            }
        }
    }

    private static func nextDistance(from current: Distance, card: Card) -> Distance {
        if let goal = card.preferredDistance {
            if goal.rawValue > current.rawValue {
                return Distance(rawValue: current.rawValue + 1) ?? current
            } else if goal.rawValue < current.rawValue {
                return Distance(rawValue: current.rawValue - 1) ?? current
            } else {
                return current
            }
        }
        switch current {
        case .long:
            return .mid
        case .mid:
            return card.distances.contains(.close) ? .close : .long
        case .close:
            return .mid
        }
    }

    private static func improvedCagePosition(from current: CagePosition) -> CagePosition {
        switch current {
        case .cornered: .againstCage
        case .againstCage, .center: .center
        }
    }

    private static func adjustStamina(_ condition: inout FighterCondition, by delta: Double) {
        condition.stamina = min(max(condition.stamina + delta, 0.0), FighterCondition.maxStamina)
    }

    private static func adjustMomentum(_ condition: inout FighterCondition, by delta: Double) {
        condition.momentum = min(max(condition.momentum + delta, 0.0), FighterCondition.maxMomentum)
    }
}

/// Top-level convenience forwarding to `ExchangeEngine.resolve(a:b:state:rng:readModifierA:readModifierB:)`.
public func resolveExchange(
    a: FighterPlay,
    b: FighterPlay,
    state: FightState,
    rng: inout SeededRNG,
    readModifierA: Double = 0.0,
    readModifierB: Double = 0.0
) -> ExchangeResult {
    ExchangeEngine.resolve(
        a: a,
        b: b,
        state: state,
        rng: &rng,
        readModifierA: readModifierA,
        readModifierB: readModifierB
    )
}
