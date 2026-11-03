/// Ground 4×4 tactical read matrix, sweeps, referee stand-up, and 2-stage submission chain engine
/// (see docs/GROUND_GAME_DESIGN.md §3–5 and docs/TASKS.md P3-2, P3-3).

public enum GroundOdds {
    /// Data-driven 4×4 Top base probability table (`GROUND_GAME_DESIGN.md` §3.3).
    /// Outer key = TopIntent, inner key = BottomIntent.
    public static let topBaseTable: [TopIntent: [BottomIntent: Double]] = [
        .advance: [
            .frame: 0.35,      // 平手：下位成功擋住轉位
            .escape: 0.75,     // 上位大賺：直接進下一階位置
            .sweepOrSub: 0.62, // 上位小賺：壓掉掃技並削體力
            .shell: 0.80,      // 上位大賺：輕鬆過腿進到更優位置
        ],
        .gnp: [
            .frame: 0.65,      // 上位小賺：中量砸拳傷害
            .escape: 0.68,     // 上位中賺：邊打邊消耗下位
            .sweepOrSub: 0.28, // 下位大逆轉：上位撐高被打中掃技翻轉或掉進三角絞/十字固
            .shell: 0.48,      // 平手：下位擋住大部分傷害
        ],
        .submission: [
            .frame: 0.58,      // 上位進入降伏小遊戲
            .escape: 0.25,     // 下位大賺：趁上位抓鎖失敗直接逃脫起身
            .sweepOrSub: 0.50, // 雙方比拼柔術數值
            .shell: 0.78,      // 上位大賺：深度鎖入
        ],
        .smother: [
            .frame: 0.62,      // 上位小賺：下位體力流失
            .escape: 0.85,     // 上位完封：抓到對手想站起來，重摔回地面並抽乾下位體力
            .sweepOrSub: 0.55, // 平手：上位重心很低，下位掃不動
            .shell: 0.65,      // 上位小賺：控制時間累積
        ],
    ]

    /// Data-driven 4×4 Bottom base probability table (`GROUND_GAME_DESIGN.md` §3.3).
    /// Outer key = TopIntent, inner key = BottomIntent.
    public static let bottomBaseTable: [TopIntent: [BottomIntent: Double]] = [
        .advance: [
            .frame: 0.65,
            .escape: 0.25,
            .sweepOrSub: 0.35,
            .shell: 0.20,
        ],
        .gnp: [
            .frame: 0.38,
            .escape: 0.35,
            .sweepOrSub: 0.74, // Oliveira-style sweep / bottom submission counter!
            .shell: 0.72,
        ],
        .submission: [
            .frame: 0.42,
            .escape: 0.75,     // Stand-up escape punishing failed top submission!
            .sweepOrSub: 0.50,
            .shell: 0.22,
        ],
        .smother: [
            .frame: 0.42,
            .escape: 0.15,     // Shut down by Khabib-style Dagestani ride!
            .sweepOrSub: 0.30,
            .shell: 0.45,
        ],
    ]

    /// Resolves effective `TopIntent` for any card (falls back gracefully if a standing card is played).
    public static func effectiveTopIntent(for card: Card) -> TopIntent {
        if let intent = card.topIntent { return intent }
        if card.tags.contains(.submission) { return .submission }
        switch card.type {
        case .strike, .counter: return .gnp
        case .move: return .advance
        case .block, .evade, .feint: return .smother
        }
    }

    /// Resolves effective `BottomIntent` for any card (falls back gracefully if a standing card is played).
    public static func effectiveBottomIntent(for card: Card) -> BottomIntent {
        if let intent = card.bottomIntent { return intent }
        if card.tags.contains(.submission) { return .sweepOrSub }
        switch card.type {
        case .counter: return .sweepOrSub
        case .move, .evade, .strike: return .escape
        case .block: return .shell
        case .feint: return .frame
        }
    }

    /// Positional dominance modifier (`GROUND_GAME_DESIGN.md` §2).
    public static func positionDominanceModifier(for role: GroundRole, at position: GroundPosition) -> Double {
        let topBonus: Double
        switch position {
        case .fullGuard: topBonus = 0.00
        case .halfGuard: topBonus = 0.05
        case .sideControl: topBonus = 0.10
        case .fullMount: topBonus = 0.14
        case .backControl: topBonus = 0.18
        }
        return role == .top ? topBonus : -topBonus * 0.8
    }

    /// Computes the `OddsBreakdown` for `my` play against `opp` play while `state.ground != nil`.
    public static func breakdown(
        my: FighterPlay,
        opp: FighterPlay,
        state: FightState,
        readModifier: Double = 0.0
    ) -> OddsBreakdown {
        guard let ground = state.ground else {
            return OddsBreakdown(base: 0.50, finalOdds: 0.50)
        }

        // Active 2-stage submission chain (`GROUND_GAME_DESIGN.md` §4)
        if let hold = ground.activeSubmission {
            return submissionChainBreakdown(
                my: my,
                opp: opp,
                hold: hold,
                ground: ground,
                state: state,
                readModifier: readModifier
            )
        }

        let role = ground.role(for: my.side)
        let topPlay = role == .top ? my : opp
        let bottomPlay = role == .bottom ? my : opp
        let topIntent = effectiveTopIntent(for: topPlay.card)
        let bottomIntent = effectiveBottomIntent(for: bottomPlay.card)

        let base: Double
        if role == .top {
            base = topBaseTable[topIntent]?[bottomIntent] ?? 0.50
        } else {
            base = bottomBaseTable[topIntent]?[bottomIntent] ?? 0.50
        }

        let myAttr = my.fighter.attributes
        let oppAttr = opp.fighter.attributes
        let attrMod: Double
        if role == .top {
            switch topIntent {
            case .advance:
                attrMod = (Double(myAttr.clinch + myAttr.takedown + my.card.accuracy) / 3.0
                    - Double(oppAttr.takedownDefense + oppAttr.submission) / 2.0) * 0.003
            case .gnp:
                attrMod = (Double(myAttr.power + myAttr.clinch + my.card.accuracy) / 3.0
                    - Double(oppAttr.strikingDefense + oppAttr.clinch) / 2.0) * 0.003
            case .submission:
                attrMod = (Double(myAttr.submission + my.card.accuracy) / 2.0
                    - Double(oppAttr.submission + oppAttr.takedownDefense) / 2.0) * 0.0035
            case .smother:
                attrMod = (Double(myAttr.clinch + myAttr.takedown) / 2.0
                    - Double(oppAttr.takedownDefense + oppAttr.cardio) / 2.0) * 0.003
            }
        } else {
            switch bottomIntent {
            case .frame:
                attrMod = (Double(myAttr.takedownDefense + myAttr.submission + my.card.accuracy) / 3.0
                    - Double(oppAttr.clinch)) * 0.0025
            case .escape:
                attrMod = (Double(myAttr.takedownDefense + myAttr.speed + my.card.accuracy) / 3.0
                    - Double(oppAttr.clinch + oppAttr.takedown) / 2.0) * 0.003
            case .sweepOrSub:
                attrMod = (Double(myAttr.submission + my.card.accuracy) / 2.0
                    - Double(oppAttr.submission + oppAttr.clinch) / 2.0) * 0.0035
            case .shell:
                attrMod = (Double(myAttr.strikingDefense + myAttr.clinch + my.card.accuracy) / 3.0
                    - Double(oppAttr.power)) * 0.0025
            }
        }

        // Positional modifier (plus penalty if card is played outside its allowed ground positions)
        var posMod = positionDominanceModifier(for: role, at: ground.position)
        if let allowed = my.card.allowedGroundPositions, !allowed.isEmpty, !allowed.contains(ground.position) {
            posMod -= 0.20
        }

        let myCond = state[my.side]
        let oppCond = state[opp.side]
        var condMod = Odds.conditionModifier(condition: myCond, card: my.card)
        let isSubAttempt = (role == .top && topIntent == .submission)
            || (role == .bottom && bottomIntent == .sweepOrSub && my.card.tags.contains(.submission))
        if isSubAttempt {
            let category = my.card.submissionCategory ?? .choke
            condMod += submissionEnvironmentModifier(
                round: state.round,
                defenderStamina: oppCond.stamina,
                category: category
            )
        }

        let momMod = Odds.momentumModifier(myCondition: myCond, oppCondition: oppCond)

        var traitMod = 0.0
        if role == .top {
            if my.fighter.has(.smother) && (topIntent == .smother || topIntent == .advance) {
                traitMod += 0.08
            }
            if my.fighter.has(.blackBeltBJJ) && (topIntent == .submission || topIntent == .advance) {
                traitMod += 0.08
            }
            if opp.fighter.has(.blackBeltBJJ) && topIntent == .submission {
                traitMod -= 0.06
            }
        } else {
            if my.fighter.has(.blackBeltBJJ) && (bottomIntent == .sweepOrSub || bottomIntent == .frame) {
                traitMod += 0.08
            }
            if opp.fighter.has(.smother) && bottomIntent == .escape {
                traitMod -= 0.08
            }
        }

        let clampedRead = min(max(readModifier, -0.10), 0.10)
        let finalOdds = Odds.resolve(
            base: base,
            modifiers: [attrMod, posMod, condMod, momMod, traitMod, clampedRead]
        )

        return OddsBreakdown(
            base: base,
            attributeModifier: attrMod,
            distanceModifier: posMod,
            conditionModifier: condMod,
            momentumModifier: momMod,
            traitModifier: traitMod,
            readModifier: clampedRead,
            finalOdds: finalOdds
        )
    }

    /// Sweat and low-stamina choke modifiers (`GROUND_GAME_DESIGN.md` §4).
    public static func submissionEnvironmentModifier(
        round: Int,
        defenderStamina: Double,
        category: SubmissionCategory
    ) -> Double {
        var mod = 0.0
        if round == 1 {
            // Round 1 dry grip bonus
            mod += 0.04
        } else if round >= 3 && category == .jointLock {
            // Round 3+ slippery sweat penalty for joint locks
            mod -= 0.06
        }
        if category == .choke && defenderStamina < 35.0 {
            // Gassed defender is much more vulnerable to chokes
            mod += 0.10
        }
        return mod
    }

    /// True when the submission defender chose an optimal posture/frame/escape card for their ground role.
    public static func isStrongSubmissionDefense(defenderCard: Card, defenderRole: GroundRole) -> Bool {
        switch defenderRole {
        case .bottom:
            let intent = effectiveBottomIntent(for: defenderCard)
            return intent == .frame || intent == .escape
        case .top:
            // Top fighter defending a bottom Triangle / Armbar: stacking (.advance) or heavy base (.smother)
            let intent = effectiveTopIntent(for: defenderCard)
            return intent == .smother || intent == .advance
        }
    }

    /// True when the submission defender chose a card that leaves their neck/limbs exposed.
    public static func isVulnerableSubmissionDefense(defenderCard: Card, defenderRole: GroundRole) -> Bool {
        switch defenderRole {
        case .bottom:
            return effectiveBottomIntent(for: defenderCard) == .shell
        case .top:
            // Top fighter reaching to punch (.gnp) while caught in a bottom submission leaves the arm/neck extended
            return effectiveTopIntent(for: defenderCard) == .gnp
        }
    }

    private static func submissionChainBreakdown(
        my: FighterPlay,
        opp: FighterPlay,
        hold: SubmissionHold,
        ground: GroundState,
        state: FightState,
        readModifier: Double
    ) -> OddsBreakdown {
        let isAttacker = (my.side == hold.attackerSide)
        let defSide = hold.attackerSide.opposite
        let defRole = ground.role(for: defSide)
        let defCard = isAttacker ? opp.card : my.card
        let strongDef = isStrongSubmissionDefense(defenderCard: defCard, defenderRole: defRole)
        let vulnDef = isVulnerableSubmissionDefense(defenderCard: defCard, defenderRole: defRole)

        let base: Double
        if isAttacker {
            switch hold.stage {
            case .setup:
                base = vulnDef ? 0.68 : (strongDef ? 0.50 : 0.56)
            case .lockedIn:
                base = vulnDef ? 0.72 : (strongDef ? 0.54 : 0.60)
            }
        } else {
            switch hold.stage {
            case .setup:
                base = strongDef ? 0.58 : 0.45
            case .lockedIn:
                base = strongDef ? 0.44 : 0.32
            }
        }

        let myAttr = my.fighter.attributes
        let oppAttr = opp.fighter.attributes
        let attrMod: Double
        if isAttacker {
            attrMod = Double(myAttr.submission - oppAttr.submission) * 0.004
        } else {
            attrMod = (Double(myAttr.submission + myAttr.takedownDefense) / 2.0 - Double(oppAttr.submission)) * 0.0035
        }

        let posMod = isAttacker ? positionDominanceModifier(for: ground.role(for: my.side), at: ground.position) * 0.5 : 0.0
        let myCond = state[my.side]
        let oppCond = state[opp.side]
        var condMod = Odds.conditionModifier(condition: myCond, card: my.card)
        let envMod = submissionEnvironmentModifier(
            round: state.round,
            defenderStamina: isAttacker ? oppCond.stamina : myCond.stamina,
            category: hold.category
        )
        condMod += isAttacker ? envMod : -envMod

        let momMod = Odds.momentumModifier(myCondition: myCond, oppCondition: oppCond)
        var traitMod = 0.0
        if my.fighter.has(.blackBeltBJJ) { traitMod += 0.08 }
        if opp.fighter.has(.blackBeltBJJ) { traitMod -= 0.06 }

        let clampedRead = min(max(readModifier, -0.10), 0.10)
        let finalOdds = Odds.resolve(
            base: base,
            modifiers: [attrMod, posMod, condMod, momMod, traitMod, clampedRead]
        )

        return OddsBreakdown(
            base: base,
            attributeModifier: attrMod,
            distanceModifier: posMod,
            conditionModifier: condMod,
            momentumModifier: momMod,
            traitModifier: traitMod,
            readModifier: clampedRead,
            finalOdds: finalOdds
        )
    }
}

public enum GroundExchangeEngine {
    /// Resolves a single ground exchange (4×4 matrix or active 2-stage submission chain).
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

        state.isClinch = false
        let stateBefore = state
        let wasRockedA = stateBefore.a.isRocked
        let wasRockedB = stateBefore.b.isRocked

        let oddsA = GroundOdds.breakdown(my: playA, opp: playB, state: stateBefore, readModifier: readModifierA)
        let oddsB = GroundOdds.breakdown(my: playB, opp: playA, state: stateBefore, readModifier: readModifierB)
        let rollA = rng.nextUnit()
        let succeededA = rollA < oddsA.finalOdds
        let rollB = rng.nextUnit()
        let succeededB = rollB < oddsB.finalOdds

        ExchangeEngine.adjustStamina(&state.a, by: -Double(playA.card.staminaCost))
        ExchangeEngine.adjustStamina(&state.b, by: -Double(playB.card.staminaCost))

        let speedA = ExchangeEngine.effectiveSpeed(
            fighter: playA.fighter, card: playA.card, staminaBefore: stateBefore.a.stamina)
        let speedB = ExchangeEngine.effectiveSpeed(
            fighter: playB.fighter, card: playB.card, staminaBefore: stateBefore.b.stamina)
        let firstSide: Side = (speedA >= speedB) ? .a : .b

        var logs: [Side: ExchangeSideLog] = [
            .a: ExchangeSideLog(side: .a, card: playA.card, odds: oddsA, roll: rollA, succeeded: succeededA),
            .b: ExchangeSideLog(side: .b, card: playB.card, odds: oddsB, roll: rollB, succeeded: succeededB),
        ]
        let plays: [Side: FighterPlay] = [.a: playA, .b: playB]
        var finish: ExchangeFinish? = nil
        var refereeStandUp = false

        guard var ground = state.ground else {
            return ExchangeLog(
                firstSide: firstSide,
                stateBefore: stateBefore,
                stateAfter: state,
                a: logs[.a]!,
                b: logs[.b]!
            )
        }

        // Case 1: Active 2-stage submission chain (`GROUND_GAME_DESIGN.md` §4)
        if let hold = ground.activeSubmission {
            let attSide = hold.attackerSide
            let defSide = attSide.opposite
            let defRole = ground.role(for: defSide)
            var attLog = logs[attSide]!
            var defLog = logs[defSide]!
            let defPlay = plays[defSide]!
            let fullBreakoutIntent = (defRole == .bottom && GroundOdds.effectiveBottomIntent(for: defPlay.card) == .escape)
                || (defRole == .top && GroundOdds.effectiveTopIntent(for: defPlay.card) == .advance)

            let attMargin = attLog.odds.finalOdds - attLog.roll
            let defMargin = defLog.odds.finalOdds - defLog.roll
            let attackerWon = (attLog.succeeded && !defLog.succeeded)
                || (attLog.succeeded && defLog.succeeded && attMargin >= defMargin)

            ground.stallCount = 0
            if attackerWon {
                switch hold.stage {
                case .setup:
                    var nextHold = hold
                    nextHold.stage = .lockedIn
                    ground.activeSubmission = nextHold
                    attLog.submissionStageReached = .lockedIn
                    ExchangeEngine.adjustStamina(&state[defSide], by: -6.0)
                    ExchangeEngine.adjustMomentum(&state[attSide], by: 14.0)
                    ExchangeEngine.adjustMomentum(&state[defSide], by: -10.0)
                case .lockedIn:
                    attLog.submissionStageReached = .lockedIn
                    finish = ExchangeFinish(winner: attSide, reason: .submission)
                    ExchangeEngine.adjustMomentum(&state[attSide], by: 20.0)
                }
            } else {
                // Defender wins the submission step
                defLog.submissionEscaped = true
                if hold.stage == .lockedIn && !fullBreakoutIntent {
                    // Miraculous defense in Stage 2 drops back to Stage 1 Setup (`S2 -> S1`)
                    var nextHold = hold
                    nextHold.stage = .setup
                    ground.activeSubmission = nextHold
                } else {
                    // Escapes back to ground position (`S1 -> ESC`)
                    ground.activeSubmission = nil
                }
                ExchangeEngine.adjustStamina(&state[attSide], by: -4.0)
                ExchangeEngine.adjustMomentum(&state[defSide], by: 12.0)
                ExchangeEngine.adjustMomentum(&state[attSide], by: -8.0)
            }

            state.ground = ground
            logs[attSide] = attLog
            logs[defSide] = defLog
        } else {
            // Case 2: Standard 4×4 Ground Read Matrix (`GROUND_GAME_DESIGN.md` §3.3)
            let topSide = ground.topSide
            let bottomSide = ground.bottomSide
            let topPlay = plays[topSide]!
            let bottomPlay = plays[bottomSide]!
            var topLog = logs[topSide]!
            var bottomLog = logs[bottomSide]!
            let topIntent = GroundOdds.effectiveTopIntent(for: topPlay.card)
            let bottomIntent = GroundOdds.effectiveBottomIntent(for: bottomPlay.card)

            var stalled = false

            switch (topIntent, bottomIntent) {
            // --- Row 1: Top Advance ---
            case (.advance, .frame):
                if topLog.succeeded && !bottomLog.succeeded {
                    applyTopAdvance(card: topPlay.card, bottomIntent: bottomIntent, ground: &ground, topLog: &topLog)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 10.0)
                } else {
                    stalled = true
                    ExchangeEngine.adjustMomentum(&state[bottomSide], by: 4.0)
                }

            case (.advance, .escape):
                if topLog.succeeded {
                    applyTopAdvance(card: topPlay.card, bottomIntent: bottomIntent, ground: &ground, topLog: &topLog)
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: -4.0)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 12.0)
                    ExchangeEngine.adjustMomentum(&state[bottomSide], by: -8.0)
                } else if bottomLog.succeeded {
                    applyBottomEscape(
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        bottomLog: &bottomLog, finish: &finish
                    )
                } else {
                    stalled = true
                }

            case (.advance, .sweepOrSub):
                if topLog.succeeded {
                    applyTopAdvance(card: topPlay.card, bottomIntent: bottomIntent, ground: &ground, topLog: &topLog)
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: -5.0)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 10.0)
                } else if bottomLog.succeeded {
                    applyBottomSweepOrSub(
                        ground: &ground, state: &state,
                        topSide: topSide, bottomSide: bottomSide,
                        bottomPlay: bottomPlay, topLog: &topLog, bottomLog: &bottomLog
                    )
                } else {
                    stalled = true
                }

            case (.advance, .shell):
                if topLog.succeeded {
                    applyTopAdvance(card: topPlay.card, bottomIntent: bottomIntent, ground: &ground, topLog: &topLog)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 14.0)
                    ExchangeEngine.adjustMomentum(&state[bottomSide], by: -8.0)
                } else {
                    stalled = true
                }

            // --- Row 2: Top Ground & Pound (GnP) ---
            case (.gnp, .sweepOrSub):
                // Oliveira Reversal Cell: Bottom catches Top posturing up to punch!
                if bottomLog.succeeded {
                    topLog.wasInterrupted = true
                    applyBottomSweepOrSub(
                        ground: &ground, state: &state,
                        topSide: topSide, bottomSide: bottomSide,
                        bottomPlay: bottomPlay, topLog: &topLog, bottomLog: &bottomLog
                    )
                } else if topLog.succeeded {
                    applyTopGnP(
                        multiplier: 0.90, canRock: true,
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        topLog: &topLog, finish: &finish
                    )
                } else {
                    stalled = true
                }

            case (.gnp, .shell):
                if bottomLog.succeeded {
                    // Shell absorbs most of the GnP; counts toward stalling
                    let mult = topLog.succeeded ? 0.30 : 0.15
                    applyTopGnP(
                        multiplier: mult, canRock: false,
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        topLog: &topLog, finish: &finish
                    )
                    stalled = true
                } else if topLog.succeeded {
                    applyTopGnP(
                        multiplier: 0.65, canRock: false,
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        topLog: &topLog, finish: &finish
                    )
                } else {
                    stalled = true
                }

            case (.gnp, .frame), (.gnp, .escape):
                if topLog.succeeded {
                    let mult = (bottomIntent == .escape) ? 1.05 : 0.85
                    applyTopGnP(
                        multiplier: mult, canRock: true,
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        topLog: &topLog, finish: &finish
                    )
                    let stamDrain = (bottomIntent == .escape) ? -4.5 : -2.5
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: stamDrain)
                } else if bottomIntent == .escape && bottomLog.succeeded {
                    applyBottomEscape(
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        bottomLog: &bottomLog, finish: &finish
                    )
                } else {
                    stalled = true
                }

            // --- Row 3: Top Submission ---
            case (.submission, .escape):
                // Bottom punishes Top's submission reach by slipping out and standing up!
                if bottomLog.succeeded {
                    applyBottomEscape(
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        bottomLog: &bottomLog, finish: &finish
                    )
                    ExchangeEngine.adjustStamina(&state[topSide], by: -4.0)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: -10.0)
                } else if topLog.succeeded {
                    startSubmission(
                        by: topSide, card: topPlay.card,
                        ground: &ground, state: &state, log: &topLog
                    )
                } else {
                    stalled = true
                }

            case (.submission, .shell):
                if topLog.succeeded {
                    startSubmission(
                        by: topSide, card: topPlay.card,
                        ground: &ground, state: &state, log: &topLog
                    )
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: -4.0)
                } else {
                    stalled = true
                }

            case (.submission, .frame):
                if topLog.succeeded && !bottomLog.succeeded {
                    startSubmission(
                        by: topSide, card: topPlay.card,
                        ground: &ground, state: &state, log: &topLog
                    )
                } else {
                    stalled = true
                    ExchangeEngine.adjustMomentum(&state[bottomSide], by: 4.0)
                }

            case (.submission, .sweepOrSub):
                let topMargin = topLog.odds.finalOdds - topLog.roll
                let botMargin = bottomLog.odds.finalOdds - bottomLog.roll
                if topLog.succeeded && (!bottomLog.succeeded || topMargin >= botMargin) {
                    startSubmission(
                        by: topSide, card: topPlay.card,
                        ground: &ground, state: &state, log: &topLog
                    )
                } else if bottomLog.succeeded {
                    applyBottomSweepOrSub(
                        ground: &ground, state: &state,
                        topSide: topSide, bottomSide: bottomSide,
                        bottomPlay: bottomPlay, topLog: &topLog, bottomLog: &bottomLog
                    )
                } else {
                    stalled = true
                }

            // --- Row 4: Top Smother (Khabib / Dagestani Ride) ---
            case (.smother, .escape):
                // Khabib Shutdown Cell: catches the standup attempt, drags back down, and drains gas tank!
                if topLog.succeeded {
                    ground.stallCount = 0
                    let drain = topPlay.fighter.has(.smother) ? -11.0 : -9.0
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: drain)
                    ExchangeEngine.adjustStamina(&state[topSide], by: 3.0)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 14.0)
                    ExchangeEngine.adjustMomentum(&state[bottomSide], by: -12.0)
                } else if bottomLog.succeeded {
                    applyBottomEscape(
                        ground: &ground, state: &state, rng: &rng,
                        topSide: topSide, bottomSide: bottomSide,
                        topPlay: topPlay, bottomPlay: bottomPlay,
                        bottomLog: &bottomLog, finish: &finish
                    )
                } else {
                    stalled = true
                }

            case (.smother, .frame), (.smother, .sweepOrSub), (.smother, .shell):
                if topLog.succeeded {
                    ExchangeEngine.adjustStamina(&state[bottomSide], by: -5.0)
                    ExchangeEngine.adjustStamina(&state[topSide], by: 2.0)
                    ExchangeEngine.adjustMomentum(&state[topSide], by: 6.0)
                }
                // Pure control without advance/damage/submission increments stall counter
                stalled = true
            }

            if state.ground != nil {
                if stalled {
                    ground.stallCount += 1
                    if ground.stallCount >= 3 && finish == nil {
                        state.ground = nil
                        state.distance = .long
                        refereeStandUp = true
                    } else {
                        state.ground = ground
                    }
                } else {
                    state.ground = ground
                }
            }

            logs[topSide] = topLog
            logs[bottomSide] = bottomLog
        }

        // Rocked recovery at end of exchange
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
            finish: finish,
            refereeStandUp: refereeStandUp
        )
    }

    // MARK: - Private Ground Resolution Helpers

    private static func applyTopAdvance(
        card: Card,
        bottomIntent: BottomIntent,
        ground: inout GroundState,
        topLog: inout ExchangeSideLog
    ) {
        if card.id == "back-take" && ground.position >= .halfGuard
            && (bottomIntent == .escape || bottomIntent == .shell || ground.position >= .sideControl)
        {
            // Agile Back Take (`GROUND_GAME_DESIGN.md` §2: HalfGuard / SideControl -> BackControl)
            ground.position = .backControl
            ground.stallCount = 0
            ground.activeSubmission = nil
        } else {
            ground.advance()
        }
        topLog.positionAdvancedTo = ground.position
    }

    private static func applyBottomEscape(
        ground: inout GroundState,
        state: inout FightState,
        rng: inout SeededRNG,
        topSide: Side,
        bottomSide: Side,
        topPlay: FighterPlay,
        bottomPlay: FighterPlay,
        bottomLog: inout ExchangeSideLog,
        finish: inout ExchangeFinish?
    ) {
        let canKickOff = ground.position.canStandUpDirectly && bottomPlay.card.power > 0
        let stoodUp = ground.escapeOrStandUp()
        if stoodUp {
            if canKickOff {
                let raw = ExchangeEngine.baseDamage(
                    attacker: bottomPlay.fighter,
                    card: bottomPlay.card,
                    staminaBefore: state[bottomSide].stamina
                )
                ExchangeEngine.applyDamage(
                    raw * 0.55,
                    to: bottomPlay.card.target ?? .head,
                    card: bottomPlay.card,
                    attackerSide: bottomSide,
                    defenderSide: topSide,
                    attacker: bottomPlay.fighter,
                    defender: topPlay.fighter,
                    canRock: false,
                    state: &state,
                    rng: &rng,
                    myLog: &bottomLog,
                    finish: &finish
                )
            }
            state.ground = nil
            state.isClinch = false
            state.distance = .mid
            bottomLog.stoodUpToStanding = true
            ExchangeEngine.adjustMomentum(&state[bottomSide], by: 14.0)
            ExchangeEngine.adjustMomentum(&state[topSide], by: -8.0)
        } else {
            bottomLog.positionAdvancedTo = ground.position
            ExchangeEngine.adjustMomentum(&state[bottomSide], by: 8.0)
        }
    }

    private static func applyBottomSweepOrSub(
        ground: inout GroundState,
        state: inout FightState,
        topSide: Side,
        bottomSide: Side,
        bottomPlay: FighterPlay,
        topLog: inout ExchangeSideLog,
        bottomLog: inout ExchangeSideLog
    ) {
        ground.stallCount = 0
        if bottomPlay.card.tags.contains(.submission) || bottomPlay.card.submissionCategory != nil {
            // Bottom submission trap (e.g. Triangle Choke or Armbar from guard)
            startSubmission(
                by: bottomSide,
                card: bottomPlay.card,
                ground: &ground,
                state: &state,
                log: &bottomLog
            )
        } else {
            // Sweep reversal: Bottom flips Top and lands in Side Control (or Full Mount for BJJ black belts)
            let targetPos: GroundPosition = bottomPlay.fighter.has(.blackBeltBJJ) ? .fullMount : .sideControl
            ground.sweep(to: targetPos)
            bottomLog.sweptToPosition = ground.position
            ExchangeEngine.adjustMomentum(&state[bottomSide], by: 18.0)
            ExchangeEngine.adjustMomentum(&state[topSide], by: -12.0)
            ExchangeEngine.adjustStamina(&state[topSide], by: -4.0)
        }
    }

    private static func startSubmission(
        by attackerSide: Side,
        card: Card,
        ground: inout GroundState,
        state: inout FightState,
        log: inout ExchangeSideLog
    ) {
        let oppSide = attackerSide.opposite
        ground.stallCount = 0
        ground.activeSubmission = SubmissionHold(
            cardId: card.id,
            name: card.name,
            category: card.submissionCategory ?? .choke,
            attackerSide: attackerSide,
            stage: .setup
        )
        log.submissionStageReached = .setup
        ExchangeEngine.adjustMomentum(&state[attackerSide], by: 14.0)
        ExchangeEngine.adjustMomentum(&state[oppSide], by: -10.0)
    }

    private static func applyTopGnP(
        multiplier: Double,
        canRock: Bool,
        ground: inout GroundState,
        state: inout FightState,
        rng: inout SeededRNG,
        topSide: Side,
        bottomSide: Side,
        topPlay: FighterPlay,
        bottomPlay: FighterPlay,
        topLog: inout ExchangeSideLog,
        finish: inout ExchangeFinish?
    ) {
        ground.stallCount = 0
        let posScale: Double
        switch ground.position {
        case .fullGuard: posScale = 0.72
        case .halfGuard: posScale = 0.85
        case .sideControl: posScale = 1.00
        case .fullMount: posScale = 1.28
        case .backControl: posScale = 1.15
        }
        let raw = ExchangeEngine.baseDamage(
            attacker: topPlay.fighter,
            card: topPlay.card,
            staminaBefore: state[topSide].stamina
        )
        let dmg = raw * posScale * multiplier
        let target = topPlay.card.target ?? .head
        let rockAllowed = canRock && (ground.position >= .sideControl || topPlay.card.power >= 65)
        ExchangeEngine.applyDamage(
            dmg,
            to: target,
            card: topPlay.card,
            attackerSide: topSide,
            defenderSide: bottomSide,
            attacker: topPlay.fighter,
            defender: bottomPlay.fighter,
            canRock: rockAllowed,
            state: &state,
            rng: &rng,
            myLog: &topLog,
            finish: &finish
        )
        if canRock {
            ExchangeEngine.adjustMomentum(&state[topSide], by: 10.0)
            ExchangeEngine.adjustMomentum(&state[bottomSide], by: -6.0)
        }
    }
}
