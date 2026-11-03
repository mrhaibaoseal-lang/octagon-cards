import Testing
@testable import FightEngine

@Suite("UFC Realism Features (Cuts, Clinch, 3-Judge Panel)")
struct RealismFeaturesTests {
    @Test func cutAndBleedingSystemWorksWithVisionPenaltyCutmanAndDoctorStoppage() {
        // 1. Vision penalty (-3% per cutSeverity level on strike / counter / evade, 0% on block)
        let cond = FighterCondition(cutSeverity: 2)
        #expect(cond.isBleeding)
        let strikeMod = Odds.conditionModifier(condition: cond, card: SampleData.jab)
        let counterMod = Odds.conditionModifier(condition: cond, card: SampleData.counterHook)
        let evadeMod = Odds.conditionModifier(condition: cond, card: SampleData.slip)
        let blockMod = Odds.conditionModifier(condition: cond, card: SampleData.guardUp)
        #expect(abs(strikeMod - (-0.06)) < 1e-9)
        #expect(abs(counterMod - (-0.06)) < 1e-9)
        #expect(abs(evadeMod - (-0.06)) < 1e-9)
        #expect(abs(blockMod - 0.0) < 1e-9)

        // 2. Standing elbow (`closeElbow`) opens a cut (`inflictedCut == true`, `cutSeverity == 1`)
        let closeState = FightState(distance: .close)
        let elbowPlay = FighterPlay(fighter: SampleData.striker, card: SampleData.closeElbow, side: .a)
        let passivePlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.feintStep, side: .b)
        var openedCutState: FightState? = nil
        for seed in UInt64(1)...2_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: elbowPlay, b: passivePlay, state: closeState, rng: &rng)
            if res.log.a.inflictedCut {
                openedCutState = res.state
                #expect(res.state.b.cutSeverity == 1)
                #expect(res.state.b.isBleeding)
                #expect(res.state.isValid)
                break
            }
        }
        #expect(openedCutState != nil)

        // 3. Ground elbows (`groundElbows`) from Full Mount also open cuts
        let mountState = FightState(
            distance: .close,
            ground: GroundState(topSide: .a, position: .fullMount)
        )
        let gnpElbowPlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.groundElbows, side: .a)
        let botEscapePlay = FighterPlay(fighter: SampleData.striker, card: SampleData.shrimpEscape, side: .b)
        var groundCutTriggered = false
        for seed in UInt64(1)...2_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: gnpElbowPlay, b: botEscapePlay, state: mountState, rng: &rng)
            if res.log.a.inflictedCut {
                groundCutTriggered = true
                #expect(res.state.b.cutSeverity == 1)
                #expect(res.state.isValid)
                break
            }
        }
        #expect(groundCutTriggered)

        // 4. Cutman reduces cutSeverity by 1 level per round break (`2 -> 1 -> 0`)
        var cornerState = FightState(
            distance: .close,
            a: FighterCondition(cutSeverity: 2),
            b: FighterCondition(cutSeverity: 1),
            isClinch: true
        )
        FightMatchEngine.applyCornerRecovery(
            state: &cornerState,
            fighterA: SampleData.striker,
            fighterB: SampleData.wrestler
        )
        #expect(cornerState.a.cutSeverity == 1)
        #expect(cornerState.b.cutSeverity == 0)
        #expect(!cornerState.b.isBleeding)
        #expect(!cornerState.isClinch)
        #expect(cornerState.isValid)

        // 5. Severe cut (`cutSeverity == 3`) + heavy elbow/head strike can trigger `.tkoDoctor`
        var severeCutState = FightState(distance: .close)
        severeCutState.b.cutSeverity = FighterCondition.maxCutSeverity
        severeCutState.b.health.head = 75.0
        var sawDoctorStoppage = false
        for seed in UInt64(1)...3_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: elbowPlay, b: passivePlay, state: severeCutState, rng: &rng)
            if res.finish == ExchangeFinish(winner: .a, reason: .tkoDoctor) {
                sawDoctorStoppage = true
                #expect(res.state.isValid)
                break
            }
        }
        #expect(sawDoctorStoppage)
    }

    @Test func clinchSubStateBoostsKneesElbowsAndTripsPenalizesKicksAndClearsCleanly() {
        let closeState = FightState(distance: .close, isClinch: false)
        // Wrestler has `.cagePinner` and `clinch: 80`
        let kneePlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.clinchKnee, side: .a)
        let feintPlay = FighterPlay(fighter: SampleData.striker, card: SampleData.feintStep, side: .b)

        var enteredClinchState: FightState? = nil
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: kneePlay, b: feintPlay, state: closeState, rng: &rng)
            if res.log.a.succeeded && !res.log.a.inflictedRocked {
                enteredClinchState = res.state
                break
            }
        }
        guard let clinchState = enteredClinchState else {
            Issue.record("Expected clinchKnee at .close to enter clinch state")
            return
        }
        #expect(clinchState.isClinch)
        // Wrestler's `.cagePinner` trait pushed Striker from `.center` to `.againstCage`
        #expect(clinchState.b.cage == .againstCage)
        #expect(clinchState.isValid)

        // Verify Clinch modifiers on Knees/Elbows (+bonus), Kicks (-penalty), and Clinch Trips (+bonus)
        let elbowPlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.closeElbow, side: .a)
        let kickPlay = FighterPlay(fighter: SampleData.striker, card: SampleData.lowKick, side: .b)
        let tripPlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.cageTrip, side: .a)

        let elbowNonClinch = Odds.breakdown(my: elbowPlay, opp: feintPlay, state: closeState).finalOdds
        let elbowInClinch = Odds.breakdown(my: elbowPlay, opp: feintPlay, state: clinchState).finalOdds
        #expect(elbowInClinch > elbowNonClinch)

        let kickNonClinch = Odds.breakdown(my: kickPlay, opp: feintPlay, state: closeState).finalOdds
        let kickInClinch = Odds.breakdown(my: kickPlay, opp: feintPlay, state: clinchState).finalOdds
        #expect(kickInClinch < kickNonClinch)

        let tripNonClinch = TakedownEngine.breakdown(my: tripPlay, opp: feintPlay, state: closeState).finalOdds
        let tripInClinch = TakedownEngine.breakdown(my: tripPlay, opp: feintPlay, state: clinchState).finalOdds
        #expect(tripInClinch > tripNonClinch)

        // Verify `pushOff` breaks the clinch and resets distance to `.mid`
        let pushOffPlay = FighterPlay(fighter: SampleData.striker, card: SampleData.pushOff, side: .b)
        let guardPlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.guardUp, side: .a)
        var brokeClinch = false
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: guardPlay, b: pushOffPlay, state: clinchState, rng: &rng)
            if res.log.b.succeeded {
                brokeClinch = true
                #expect(!res.state.isClinch)
                #expect(res.state.distance == .mid)
                #expect(res.state.isValid)
                break
            }
        }
        #expect(brokeClinch)
    }

    @Test func threeJudgePanelProducesUnanimousSplitAndMajorityDecisions() {
        let baseOdds = OddsBreakdown(base: 0.50, finalOdds: 0.50)
        let endState = FightState()

        func makeExchange(
            dmgA: Double = 0.0,
            dmgB: Double = 0.0,
            tdB: GroundPosition? = nil,
            advB: GroundPosition? = nil
        ) -> ExchangeLog {
            let logA = ExchangeSideLog(
                side: .a, card: SampleData.cross, odds: baseOdds, roll: 0.2, succeeded: dmgA > 0,
                damageDealt: dmgA, targetHit: dmgA > 0 ? .head : nil
            )
            var logB = ExchangeSideLog(
                side: .b, card: SampleData.doubleLeg, odds: baseOdds, roll: 0.2,
                succeeded: (dmgB > 0 || tdB != nil || advB != nil),
                damageDealt: dmgB, targetHit: dmgB > 0 ? .head : nil
            )
            logB.takedownLanded = tdB
            logB.positionAdvancedTo = advB
            return ExchangeLog(
                firstSide: .a,
                stateBefore: endState,
                stateAfter: endState,
                a: logA,
                b: logB
            )
        }

        // Round 1: Clear striking round for A (all 3 judges score 10-9 for A)
        let r1Score = FightMatchEngine.scoreRound(
            round: 1,
            exchanges: [makeExchange(dmgA: 24.0, dmgB: 4.0)],
            endState: endState
        )
        #expect(r1Score.judgeCards.count == 3)
        #expect(r1Score.judgeCards.allSatisfy { $0.pointsA == 10 && $0.pointsB == 9 })

        // Round 2: Clear grappling & striking round for B (all 3 judges score 10-9 for B)
        let r2Score = FightMatchEngine.scoreRound(
            round: 2,
            exchanges: [makeExchange(dmgA: 2.0, dmgB: 18.0, tdB: .halfGuard, advB: .sideControl)],
            endState: endState
        )
        #expect(r2Score.judgeCards.allSatisfy { $0.pointsA == 9 && $0.pointsB == 10 })

        // Round 3: Swing round! A lands more standing damage (19.0 vs 6.0),
        // while B lands a takedown + guard pass (`grapplingB = 14.0`).
        // Judge 1 (.striking) scores 10-9 for A; Judge 2 (.grappling) scores 10-9 for B!
        let r3Score = FightMatchEngine.scoreRound(
            round: 3,
            exchanges: [makeExchange(dmgA: 19.0, dmgB: 6.0, tdB: .halfGuard, advB: .sideControl)],
            endState: endState
        )
        let strikeJudgeR3 = r3Score.judgeCards.first { $0.bias == .striking }!
        let grappleJudgeR3 = r3Score.judgeCards.first { $0.bias == .grappling }!
        #expect(strikeJudgeR3.pointsA == 10 && strikeJudgeR3.pointsB == 9)
        #expect(grappleJudgeR3.pointsA == 9 && grappleJudgeR3.pointsB == 10)

        let roundLogs = [
            RoundLog(round: 1, exchanges: [], score: r1Score, stateAfterCorner: endState),
            RoundLog(round: 2, exchanges: [], score: r2Score, stateAfterCorner: endState),
            RoundLog(round: 3, exchanges: [], score: r3Score, stateAfterCorner: endState),
        ]
        let tallied = FightMatchEngine.tallyJudgeScorecards(from: roundLogs)
        #expect(tallied.decisionType == .split)
        #expect(tallied.scorecards.count == 3)
        let strikeTotal = tallied.scorecards.first { $0.bias == .striking }!
        let grappleTotal = tallied.scorecards.first { $0.bias == .grappling }!
        #expect(strikeTotal.pointsA == 29 && strikeTotal.pointsB == 28)
        #expect(grappleTotal.pointsA == 28 && grappleTotal.pointsB == 29)
    }
}
