import Testing
@testable import FightEngine

@Suite("Ground 4x4 Matrix, Sweeps & 2-Stage Submissions (P3-2, P3-3, P4-2)")
struct GroundExchangeTests {
    @Test func groundCatalogCoversAllPositionsAndIntents() {
        #expect(SampleData.takedownBridgeCards.count == 8)
        #expect(SampleData.groundCards.count == 22)
        #expect(SampleData.grapplingAndGroundCards.count == 30)
        #expect(SampleData.allCards.count == 58)

        let uniqueIds = Set(SampleData.allCards.map(\.id))
        #expect(uniqueIds.count == 58)

        // Every GroundPosition must have legal Top cards for all 4 TopIntents
        // and legal Bottom cards for all 4 BottomIntents.
        for pos in GroundPosition.allCases {
            for topIntent in TopIntent.allCases {
                let matchingTop = SampleData.topGroundCards.filter {
                    $0.topIntent == topIntent && $0.isLegalOnGround(as: .top, at: pos)
                }
                #expect(!matchingTop.isEmpty, "Missing Top card for \(topIntent) at \(pos)")
            }
            for bottomIntent in BottomIntent.allCases {
                let matchingBottom = SampleData.bottomGroundCards.filter {
                    $0.bottomIntent == bottomIntent && $0.isLegalOnGround(as: .bottom, at: pos)
                }
                #expect(!matchingBottom.isEmpty, "Missing Bottom card for \(bottomIntent) at \(pos)")
            }
        }
    }

    @Test func groundOddsAlwaysClampedAndRespect4x4Matrix() {
        for pos in GroundPosition.allCases {
            let state = FightState(ground: GroundState(topSide: .a, position: pos))
            for topCard in SampleData.topGroundCards {
                for botCard in SampleData.bottomGroundCards {
                    let playTop = FighterPlay(fighter: SampleData.wrestler, card: topCard, side: .a)
                    let playBot = FighterPlay(fighter: SampleData.bjjFighter, card: botCard, side: .b)
                    let pTop = Odds.resolveOdds(my: playTop, opp: playBot, state: state)
                    let pBot = Odds.resolveOdds(my: playBot, opp: playTop, state: state)
                    #expect(pTop >= Odds.minimum && pTop <= Odds.maximum)
                    #expect(pBot >= Odds.minimum && pBot <= Odds.maximum)
                }
            }
        }

        // Verify signature 4x4 counter relationships in FullGuard with neutral fighters
        let neutralA = Fighter(id: "a", name: "A")
        let neutralB = Fighter(id: "b", name: "B")
        let guardState = FightState(ground: GroundState(topSide: .a, position: .fullGuard))

        // 1. Top Advance beats Shell / Escape much better than Frame
        let pAdvVsShell = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralA, card: SampleData.kneeSlicePass, side: .a),
            opp: FighterPlay(fighter: neutralB, card: SampleData.shellUp, side: .b),
            state: guardState
        )
        let pAdvVsFrame = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralA, card: SampleData.kneeSlicePass, side: .a),
            opp: FighterPlay(fighter: neutralB, card: SampleData.frameLockdown, side: .b),
            state: guardState
        )
        #expect(pAdvVsShell > pAdvVsFrame)

        // 2. Bottom Sweep/Sub counters Top GnP
        let pSweepVsGnP = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralB, card: SampleData.butterflySweep, side: .b),
            opp: FighterPlay(fighter: neutralA, card: SampleData.posturedHammerfist, side: .a),
            state: guardState
        )
        let pSweepVsSmother = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralB, card: SampleData.butterflySweep, side: .b),
            opp: FighterPlay(fighter: neutralA, card: SampleData.dagestaniHandcuff, side: .a),
            state: guardState
        )
        #expect(pSweepVsGnP > pSweepVsSmother)

        // 3. Bottom Escape counters Top Submission, but gets crushed by Top Smother
        let pEscVsSub = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralB, card: SampleData.wallWalkStandup, side: .b),
            opp: FighterPlay(fighter: neutralA, card: SampleData.guillotine, side: .a),
            state: guardState
        )
        let pEscVsSmother = Odds.resolveOdds(
            my: FighterPlay(fighter: neutralB, card: SampleData.wallWalkStandup, side: .b),
            opp: FighterPlay(fighter: neutralA, card: SampleData.dagestaniHandcuff, side: .a),
            state: guardState
        )
        #expect(pEscVsSub > pEscVsSmother)
    }

    @Test func khabibSmotherShutsDownEscapeAndDrainsStamina() {
        var state = FightState(ground: GroundState(topSide: .a, position: .halfGuard))
        state.a.stamina = 80.0
        state.b.stamina = 80.0

        let topSmother = FighterPlay(fighter: SampleData.wrestler, card: SampleData.dagestaniHandcuff, side: .a)
        let botEscape = FighterPlay(fighter: SampleData.striker, card: SampleData.wallWalkStandup, side: .b)

        var shutDown: ExchangeResult? = nil
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: topSmother, b: botEscape, state: state, rng: &rng)
            if res.log.a.succeeded {
                shutDown = res
                break
            }
        }
        guard let res = shutDown else {
            Issue.record("Expected Khabib smother to shut down escape")
            return
        }

        // Still on the ground in HalfGuard, Bottom lost 2 (card) + 11 (smother trait drain) = 13 stamina!
        #expect(res.state.isGrounded)
        #expect(res.state.ground?.topSide == .a)
        #expect(res.state.ground?.position == .halfGuard)
        #expect(res.state.b.stamina == 67.0)
        // Top spent 2 stamina on card and recovered +3 from smother ride = 81.0
        #expect(res.state.a.stamina == 81.0)
        #expect(res.state.isValid)
    }

    @Test func oliveiraBottomSweepFlipsTopSideAgainstGnP() {
        let state = FightState(ground: GroundState(topSide: .a, position: .fullGuard))
        let topGnP = FighterPlay(fighter: SampleData.wrestler, card: SampleData.posturedHammerfist, side: .a)
        let botSweep = FighterPlay(fighter: SampleData.bjjFighter, card: SampleData.butterflySweep, side: .b)

        var swept: ExchangeResult? = nil
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: topGnP, b: botSweep, state: state, rng: &rng)
            if res.log.b.sweptToPosition != nil {
                swept = res
                break
            }
        }
        guard let res = swept else {
            Issue.record("Expected Bottom Butterfly Sweep to reverse Top GnP")
            return
        }

        #expect(res.state.isGrounded)
        #expect(res.state.ground?.topSide == .b)
        #expect(res.state.ground?.bottomSide == .a)
        #expect(res.state.ground?.position == .fullMount) // BJJ black belt lands directly in Full Mount!
        #expect(res.log.a.wasInterrupted)
        #expect(res.log.a.damageDealt == 0.0)
        #expect(res.state.isValid)
    }

    @Test func oliveiraBottomTriangleCatchesGnPIntoTwoStageSubmissionFinish() {
        var state = FightState(ground: GroundState(topSide: .a, position: .fullGuard))
        let topGnP = FighterPlay(fighter: SampleData.striker, card: SampleData.posturedHammerfist, side: .a)
        let botTriangle = FighterPlay(fighter: SampleData.bjjFighter, card: SampleData.triangleChoke, side: .b)

        // Step 1: Catch Top GnP in Triangle Choke Setup (Stage 1)
        var step1Done = false
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: topGnP, b: botTriangle, state: state, rng: &rng)
            if res.state.ground?.activeSubmission?.stage == .setup {
                state = res.state
                step1Done = true
                #expect(res.log.b.submissionStageReached == .setup)
                #expect(res.state.ground?.activeSubmission?.attackerSide == .b)
                break
            }
        }
        #expect(step1Done)

        // Step 2: Advance from Setup (Stage 1) -> LockedIn (Stage 2)
        let topShell = FighterPlay(fighter: SampleData.striker, card: SampleData.shellUp, side: .a)
        var step2Done = false
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: topShell, b: botTriangle, state: state, rng: &rng)
            if res.state.ground?.activeSubmission?.stage == .lockedIn && res.finish == nil {
                state = res.state
                step2Done = true
                #expect(res.log.b.submissionStageReached == .lockedIn)
                break
            }
        }
        #expect(step2Done)

        // Step 3: Finish from LockedIn (Stage 2) -> Tap Out (.submission)!
        var step3Done = false
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: topShell, b: botTriangle, state: state, rng: &rng)
            if let finish = res.finish {
                step3Done = true
                #expect(finish.winner == .b)
                #expect(finish.reason == .submission)
                #expect(res.state.isValid)
                break
            }
        }
        #expect(step3Done)
    }

    @Test func topRearNakedChokeSetupAndDefenderEscapeBackToGround() {
        let initialHold = SubmissionHold(
            cardId: SampleData.rnc.id,
            name: SampleData.rnc.name,
            category: .choke,
            attackerSide: .a,
            stage: .setup
        )
        let state = FightState(
            ground: GroundState(topSide: .a, position: .backControl, activeSubmission: initialHold)
        )
        let playTop = FighterPlay(fighter: SampleData.wrestler, card: SampleData.rnc, side: .a)
        let playBot = FighterPlay(fighter: SampleData.bjjFighter, card: SampleData.frameLockdown, side: .b)

        var escaped: ExchangeResult? = nil
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playTop, b: playBot, state: state, rng: &rng)
            if res.log.b.submissionEscaped {
                escaped = res
                break
            }
        }
        guard let res = escaped else {
            Issue.record("Expected defender to escape Stage 1 RNC setup")
            return
        }

        #expect(res.state.isGrounded)
        #expect(res.state.ground?.activeSubmission == nil)
        #expect(res.state.ground?.position == .backControl)
        #expect(res.finish == nil)
    }

    @Test func threeConsecutivePassiveGroundExchangesTriggerRefereeStandUp() {
        var state = FightState(ground: GroundState(topSide: .a, position: .fullGuard))
        let topSmother = FighterPlay(fighter: SampleData.wrestler, card: SampleData.dagestaniHandcuff, side: .a)
        let botFrame = FighterPlay(fighter: SampleData.bjjFighter, card: SampleData.frameLockdown, side: .b)
        var rng = SeededRNG(seed: 101)

        // Exchange 1: stallCount becomes 1
        let log1 = ExchangeEngine.resolve(a: topSmother, b: botFrame, state: &state, rng: &rng)
        #expect(state.isGrounded)
        #expect(state.ground?.stallCount == 1)
        #expect(!log1.refereeStandUp)

        // Exchange 2: stallCount becomes 2
        let log2 = ExchangeEngine.resolve(a: topSmother, b: botFrame, state: &state, rng: &rng)
        #expect(state.isGrounded)
        #expect(state.ground?.stallCount == 2)
        #expect(!log2.refereeStandUp)

        // Exchange 3: stallCount reaches 3 -> Referee yells "Work!" and stands fighters up to Long range!
        let log3 = ExchangeEngine.resolve(a: topSmother, b: botFrame, state: &state, rng: &rng)
        #expect(!state.isGrounded)
        #expect(state.ground == nil)
        #expect(state.distance == .long)
        #expect(log3.refereeStandUp)
        #expect(state.isValid)
    }

    @Test func jumpGuillotineCountersTakedownDirectlyIntoSubmissionSetup() {
        let state = FightState(distance: .mid)
        let playWrestler = FighterPlay(fighter: SampleData.wrestler, card: SampleData.doubleLeg, side: .a)
        let playGuillotine = FighterPlay(fighter: SampleData.bjjFighter, card: SampleData.jumpGuillotine, side: .b)

        var caught: ExchangeResult? = nil
        for seed in UInt64(1)...500 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playWrestler, b: playGuillotine, state: state, rng: &rng)
            if res.log.b.submissionStageReached == .setup {
                caught = res
                break
            }
        }
        guard let res = caught else {
            Issue.record("Expected Jump Guillotine to counter Double Leg into Stage 1 Setup")
            return
        }

        #expect(res.state.isGrounded)
        #expect(res.state.ground?.position == .fullGuard)
        #expect(res.state.ground?.activeSubmission?.attackerSide == .b)
        #expect(res.state.ground?.activeSubmission?.stage == .setup)
        #expect(res.log.a.wasInterrupted)
        #expect(res.state.isValid)
    }
}
