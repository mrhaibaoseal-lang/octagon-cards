/// Single standing exchange resolution and structured combat log
/// (see docs/STRIKING_AND_DECK.md §12.1–12.4 and docs/TASKS.md P2-4).

/// How an exchange finished the fight.
public enum FinishReason: String, Sendable, Codable, Hashable, CaseIterable {
    case ko
    case tkoBody
    case tkoLegs
    case tkoDoctor
    case submission

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
    public var takedownLanded: GroundPosition?
    public var positionAdvancedTo: GroundPosition?
    public var sweptToPosition: GroundPosition?
    public var stoodUpToStanding: Bool
    public var submissionStageReached: SubmissionStage?
    public var submissionEscaped: Bool
    public var inflictedCut: Bool

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
        movedDistanceTo: Distance? = nil,
        takedownLanded: GroundPosition? = nil,
        positionAdvancedTo: GroundPosition? = nil,
        sweptToPosition: GroundPosition? = nil,
        stoodUpToStanding: Bool = false,
        submissionStageReached: SubmissionStage? = nil,
        submissionEscaped: Bool = false,
        inflictedCut: Bool = false
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
        self.takedownLanded = takedownLanded
        self.positionAdvancedTo = positionAdvancedTo
        self.sweptToPosition = sweptToPosition
        self.stoodUpToStanding = stoodUpToStanding
        self.submissionStageReached = submissionStageReached
        self.submissionEscaped = submissionEscaped
        self.inflictedCut = inflictedCut
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
    /// True if 3 consecutive stalling exchanges on the ground prompted a Referee Stand Up (`GROUND_GAME_DESIGN.md` §5).
    public var refereeStandUp: Bool

    public init(
        firstSide: Side,
        stateBefore: FightState,
        stateAfter: FightState,
        a: ExchangeSideLog,
        b: ExchangeSideLog,
        finish: ExchangeFinish? = nil,
        refereeStandUp: Bool = false
    ) {
        self.firstSide = firstSide
        self.stateBefore = stateBefore
        self.stateAfter = stateAfter
        self.a = a
        self.b = b
        self.finish = finish
        self.refereeStandUp = refereeStandUp
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
        var raw = (Double(attacker.attributes.power) * 0.40 + Double(card.power) * 0.60) * 0.285
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

        if state.ground != nil {
            return GroundExchangeEngine.resolve(
                a: playA,
                b: playB,
                state: &state,
                rng: &rng,
                readModifierA: readModifierA,
                readModifierB: readModifierB
            )
        }

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

            if finish != nil || oppLog.inflictedRocked || oppLog.takedownLanded != nil || oppLog.submissionStageReached != nil {
                myLog.wasInterrupted = true
                logs[activeSide] = myLog
                continue
            }

            let raw = baseDamage(
                attacker: myPlay.fighter,
                card: myPlay.card,
                staminaBefore: stateBefore[activeSide].stamina
            )

            // Standing Takedown card resolution (P3-1 bridge: STRIKING_AND_DECK §8)
            if myPlay.card.isTakedown, let landingPos = myPlay.card.landingPosition {
                if oppPlay.card.type == .counter && oppLog.succeeded {
                    // Intercepted by opponent's counter (e.g. intercepting knee or jump guillotine)
                } else if oppPlay.card.type == .block && oppPlay.card.tags.contains(.wrestling) && oppLog.succeeded {
                    // Stuffed by dedicated Sprawl
                    state.isClinch = false
                    adjustStamina(&state[activeSide], by: -4.0)
                    adjustMomentum(&state[activeSide], by: -8.0)
                    adjustMomentum(&state[oppSide], by: 10.0)
                } else if (oppPlay.card.type == .evade || oppPlay.card.type == .move) && oppLog.succeeded && !myLog.succeeded {
                    state.isClinch = false
                    adjustStamina(&state[activeSide], by: -3.0)
                    adjustMomentum(&state[activeSide], by: -6.0)
                    adjustMomentum(&state[oppSide], by: 6.0)
                } else if myLog.succeeded {
                    state.ground = GroundState(topSide: activeSide, position: landingPos)
                    state.isClinch = false
                    myLog.takedownLanded = landingPos
                    adjustMomentum(&state[activeSide], by: 14.0)
                    adjustMomentum(&state[oppSide], by: -10.0)
                    adjustStamina(&state[oppSide], by: -4.0)
                    if myPlay.card.power > 0 {
                        let slamDmg = raw * 0.45
                        let target = myPlay.card.target ?? .body
                        applyDamage(
                            slamDmg,
                            to: target,
                            attackerSide: activeSide,
                            defenderSide: oppSide,
                            attacker: myPlay.fighter,
                            defender: oppPlay.fighter,
                            card: myPlay.card,
                            canRock: false,
                            state: &state,
                            rng: &rng,
                            myLog: &myLog,
                            finish: &finish
                        )
                    }
                } else {
                    adjustStamina(&state[activeSide], by: -3.0)
                    adjustMomentum(&state[activeSide], by: -6.0)
                    adjustMomentum(&state[oppSide], by: 6.0)
                }
                logs[activeSide] = myLog
                continue
            }

            switch myPlay.card.type {
            case .strike:
                if oppPlay.card.type == .counter && oppLog.succeeded {
                    // Intercepted by opponent's successful counter-attack.
                    break
                } else if oppPlay.card.type == .evade && oppLog.succeeded {
                    // Opponent evaded completely: slips the tie-up, attacker whiffs and loses extra stamina/momentum.
                    state.isClinch = false
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
                        card: myPlay.card,
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
                            card: myPlay.card,
                            canRock: true,
                            state: &state,
                            rng: &rng,
                            myLog: &myLog,
                            finish: &finish
                        )
                        adjustMomentum(&state[activeSide], by: 10.0)
                        adjustMomentum(&state[oppSide], by: -6.0)
                        if finish == nil && state.ground == nil && state.distance == .close
                            && (myPlay.card.tags.contains(.knee) || myPlay.card.tags.contains(.elbow) || myPlay.card.id == "dirty-boxing")
                        {
                            if !myLog.inflictedRocked {
                                state.isClinch = true
                            }
                            if myPlay.fighter.has(.cagePinner) {
                                state[oppSide].cage = pushedBackCagePosition(from: state[oppSide].cage)
                            }
                        }
                    } else {
                        adjustMomentum(&state[activeSide], by: -3.0)
                    }
                }

            case .counter:
                if myLog.succeeded {
                    if myPlay.card.tags.contains(.submission) && oppPlay.card.isTakedown {
                        // Standing submission counter (e.g. Jump Guillotine on a takedown shot)
                        let landPos = myPlay.card.landingPosition ?? .fullGuard
                        let hold = SubmissionHold(
                            cardId: myPlay.card.id,
                            name: myPlay.card.name,
                            category: myPlay.card.submissionCategory ?? .choke,
                            attackerSide: activeSide,
                            stage: .setup
                        )
                        state.ground = GroundState(topSide: oppSide, position: landPos, activeSubmission: hold)
                        state.isClinch = false
                        myLog.submissionStageReached = .setup
                        adjustMomentum(&state[activeSide], by: 16.0)
                        adjustMomentum(&state[oppSide], by: -12.0)
                        adjustStamina(&state[oppSide], by: -5.0)
                    } else {
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
                            card: myPlay.card,
                            canRock: true,
                            state: &state,
                            rng: &rng,
                            myLog: &myLog,
                            finish: &finish
                        )
                    }
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
                    if state.distance != .close || myPlay.card.id == "push-off" {
                        state.isClinch = false
                    } else if state.distance == .close && state.ground == nil
                        && (myPlay.fighter.has(.cagePinner) || myPlay.fighter.attributes.clinch >= 75)
                    {
                        state.isClinch = true
                    }
                    myLog.movedDistanceTo = state.distance
                    adjustMomentum(&state[activeSide], by: 6.0)
                }

            case .block:
                if oppPlay.card.type != .strike && myLog.succeeded {
                    adjustStamina(&state[activeSide], by: 2.0)
                    adjustMomentum(&state[activeSide], by: 2.0)
                }

            case .evade:
                if myLog.succeeded {
                    state.isClinch = false
                    if oppPlay.card.type != .strike {
                        adjustMomentum(&state[activeSide], by: 2.0)
                    }
                }
            }

            logs[activeSide] = myLog
        }

        // 5. Rocked recovery: if a fighter started the exchange Rocked, survived, and was not
        // newly Rocked this exchange, they recover their footing.
        let finalLogA = logs[.a]!
        let finalLogB = logs[.b]!
        if finalLogA.inflictedRocked || finalLogB.inflictedRocked || state.ground != nil || state.distance != .close {
            state.isClinch = false
        }
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

    // MARK: - Internal Helpers

    static func applyDamage(
        _ damage: Double,
        to target: HitTarget,
        attackerSide: Side,
        defenderSide: Side,
        attacker: Fighter,
        defender: Fighter,
        card: Card? = nil,
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
                // Cut / Bleeding & Doctor Stoppage check (`STRIKING_AND_DECK.md` / UFC Elbow Cut rules)
                let isElbow = card?.tags.contains(.elbow) == true
                if state[defenderSide].cutSeverity >= FighterCondition.maxCutSeverity && clampedDamage >= 10.0 {
                    let pDoctor = Odds.resolve(
                        base: 0.35,
                        modifiers: [
                            isElbow ? 0.10 : 0.0,
                            (clampedDamage - 10.0) * 0.01,
                        ]
                    )
                    if rng.roll(probability: pDoctor) {
                        finish = ExchangeFinish(winner: attackerSide, reason: .tkoDoctor)
                        return
                    }
                } else if state[defenderSide].cutSeverity < FighterCondition.maxCutSeverity {
                    let canOpenCut = (isElbow && clampedDamage >= 8.0)
                        || clampedDamage >= 16.0
                        || (state[defenderSide].isBleeding && clampedDamage >= 11.0)
                    if canOpenCut {
                        let baseCut = isElbow ? 0.25 : (state[defenderSide].isBleeding ? 0.12 : 0.06)
                        let pCut = Odds.resolve(
                            base: baseCut,
                            modifiers: [(clampedDamage - 10.0) * 0.01]
                        )
                        if rng.roll(probability: pCut) {
                            let newSev = min(
                                FighterCondition.maxCutSeverity,
                                state[defenderSide].cutSeverity + 1
                            )
                            state[defenderSide].cutSeverity = newSev
                            myLog.inflictedCut = true
                            // When an existing cut is split open further to Lv.2 or Lv.3,
                            // the ringside doctor may stop the bout (`tkoDoctor`).
                            if newSev >= 2 {
                                let pDoc = Odds.resolve(
                                    base: newSev >= 3 ? 0.35 : 0.12,
                                    modifiers: [isElbow ? 0.08 : 0.0]
                                )
                                if rng.roll(probability: pDoc) {
                                    finish = ExchangeFinish(winner: attackerSide, reason: .tkoDoctor)
                                    return
                                }
                            }
                        }
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
                if clampedDamage >= 10.5 && legsAfter < 54.0 {
                    let pBuckle = Odds.resolve(
                        base: 0.09,
                        modifiers: [
                            (clampedDamage - 10.5) * 0.012,
                            (54.0 - legsAfter) * 0.004,
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

    private static func pushedBackCagePosition(from current: CagePosition) -> CagePosition {
        switch current {
        case .center: .againstCage
        case .againstCage, .cornered: .cornered
        }
    }

    static func adjustStamina(_ condition: inout FighterCondition, by delta: Double) {
        condition.stamina = min(max(condition.stamina + delta, 0.0), FighterCondition.maxStamina)
    }

    static func adjustMomentum(_ condition: inout FighterCondition, by delta: Double) {
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
