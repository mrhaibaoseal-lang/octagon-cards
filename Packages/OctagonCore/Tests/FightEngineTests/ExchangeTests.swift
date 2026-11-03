import Testing
@testable import FightEngine

@Suite("Exchange")
struct ExchangeTests {
    /// Finds a seed where `(aSucceeded, bSucceeded)` matches the desired booleans for the given plays.
    private func findSeed(
        a: FighterPlay,
        b: FighterPlay,
        state: FightState,
        wantA: Bool,
        wantB: Bool
    ) -> UInt64 {
        let oddsA = Odds.breakdown(my: a, opp: b, state: state).finalOdds
        let oddsB = Odds.breakdown(my: b, opp: a, state: state).finalOdds
        for seed in UInt64(1)...10_000 {
            var rng = SeededRNG(seed: seed)
            let rA = rng.nextUnit() < oddsA
            let rB = rng.nextUnit() < oddsB
            if rA == wantA && rB == wantB {
                return seed
            }
        }
        return 1
    }

    @Test func strikeLandsAndUpdatesHealthStaminaMomentum() {
        let state = FightState(distance: .mid)
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.feintStep, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: true, wantB: false)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        #expect(result.state.isValid)
        #expect(result.log.a.succeeded)
        #expect(result.log.a.damageDealt > 0)
        #expect(result.log.a.targetHit == .head)
        #expect(result.state.b.health.head < BodyHealth.max)
        #expect(result.state.a.stamina == FighterCondition.maxStamina - Double(SampleData.cross.staminaCost))
        #expect(result.state.a.momentum > 0)
    }

    @Test func blockAbsorbsMostDamageAndPreventsRocked() {
        var state = FightState(distance: .mid)
        state.b.health.head = 50.0 // Vulnerable head health
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.headKick, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.guardUp, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: false, wantB: true)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        let raw = ExchangeEngine.baseDamage(
            attacker: SampleData.striker,
            card: SampleData.headKick,
            staminaBefore: 100.0
        )
        #expect(result.state.isValid)
        #expect(result.log.b.succeeded)
        #expect(abs(result.log.a.damageDealt - raw * 0.25) < 1e-9)
        #expect(!result.state.b.isRocked)
        #expect(result.state.b.momentum > 0)
    }

    @Test func evadeDodgesCompletelyAndTaxesAttackerStamina() {
        let state = FightState(distance: .mid)
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.slip, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: true, wantB: true)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        #expect(result.state.isValid)
        #expect(result.log.b.succeeded)
        #expect(result.log.a.damageDealt == 0)
        #expect(result.state.b.health.head == BodyHealth.max)
        // Attacker paid cross staminaCost (2) + whiff penalty (2) = 4
        #expect(result.state.a.stamina == 96.0)
        #expect(result.state.b.momentum == 8.0)
    }

    @Test func counterInterceptsStrikeAndDealsBonusDamage() {
        let state = FightState(distance: .mid)
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.counterHook, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.cross, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: true, wantB: true)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        let raw = ExchangeEngine.baseDamage(
            attacker: SampleData.striker,
            card: SampleData.counterHook,
            staminaBefore: 100.0
        )
        #expect(result.state.isValid)
        #expect(result.log.a.succeeded)
        // Striker has `.counterPuncher`, so multiplier is 1.80x
        #expect(abs(result.log.a.damageDealt - raw * 1.80) < 1e-9)
        // Opponent's strike was intercepted and dealt 0 damage
        #expect(result.log.b.damageDealt == 0)
        #expect(result.state.a.health.head == BodyHealth.max)
    }

    @Test func feintSucceedsAndFlagsReadBonus() {
        let state = FightState(distance: .mid)
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.feintStep, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.guardUp, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: true, wantB: false)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        #expect(result.state.isValid)
        #expect(result.log.a.feintSucceeded)
        #expect(result.state.a.momentum == 10.0)
    }

    @Test func moveShiftsDistanceAndImprovesCagePosition() {
        var state = FightState(distance: .long)
        state.a.cage = .cornered
        let playA = FighterPlay(fighter: SampleData.wrestler, card: SampleData.stepIn, side: .a)
        let playB = FighterPlay(fighter: SampleData.striker, card: SampleData.guardUp, side: .b)
        let seed = findSeed(a: playA, b: playB, state: state, wantA: true, wantB: false)
        var rng = SeededRNG(seed: seed)

        let result = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
        #expect(result.state.isValid)
        #expect(result.state.distance == .mid)
        #expect(result.log.a.movedDistanceTo == .mid)
        #expect(result.state.a.cage == .againstCage)
    }

    @Test func heavyHeadStrikeTriggersRockedAndRecoversNextExchange() {
        var state = FightState(distance: .mid)
        state.b.health.head = 55.0
        // Striker's cross (speed 65) is faster than Wrestler's headKick (speed 35), so A acts first.
        let playA = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .a)
        let playB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.headKick, side: .b)

        // Find a seed where A hits and the Chin Check triggers Rocked on B
        var rockedResult: ExchangeResult? = nil
        for seed in UInt64(1)...5_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playA, b: playB, state: state, rng: &rng)
            if res.log.a.inflictedRocked {
                rockedResult = res
                break
            }
        }
        guard let rocked = rockedResult else {
            Issue.record("Expected to find a seed that triggers Rocked")
            return
        }
        #expect(rocked.log.firstSide == .a)
        #expect(rocked.state.b.isRocked)
        #expect(rocked.log.b.wasInterrupted)

        // Next exchange: B blocks and survives without being newly rocked -> recovers from Rocked
        var rng2 = SeededRNG(seed: 42)
        let recovery = resolveExchange(
            a: FighterPlay(fighter: SampleData.striker, card: SampleData.jab, side: .a),
            b: FighterPlay(fighter: SampleData.wrestler, card: SampleData.guardUp, side: .b),
            state: rocked.state,
            rng: &rng2
        )
        #expect(recovery.state.isValid)
        if !recovery.log.a.inflictedRocked && recovery.finish == nil {
            #expect(!recovery.state.b.isRocked)
        }
    }

    @Test func finishConditionsAndInterruptionForAllThreeTargets() {
        // 1. Head KO
        var headState = FightState(distance: .mid)
        headState.b.health.head = 5.0
        let crossA = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .a)
        let crossB = FighterPlay(fighter: SampleData.wrestler, card: SampleData.cross, side: .b)
        var rngHead = SeededRNG(seed: findSeed(a: crossA, b: crossB, state: headState, wantA: true, wantB: true))
        let resHead = resolveExchange(a: crossA, b: crossB, state: headState, rng: &rngHead)
        #expect(resHead.finish == ExchangeFinish(winner: .a, reason: .ko))
        #expect(resHead.log.b.wasInterrupted)
        #expect(resHead.log.b.damageDealt == 0)

        // 2. Body TKO
        var bodyState = FightState(distance: .mid)
        bodyState.b.health.body = 5.0
        let bodyA = FighterPlay(fighter: SampleData.striker, card: SampleData.bodyHook, side: .a)
        var rngBody = SeededRNG(seed: findSeed(a: bodyA, b: crossB, state: bodyState, wantA: true, wantB: false))
        let resBody = resolveExchange(a: bodyA, b: crossB, state: bodyState, rng: &rngBody)
        #expect(resBody.finish == ExchangeFinish(winner: .a, reason: .tkoBody))

        // 3. Legs TKO
        var legsState = FightState(distance: .mid)
        legsState.b.health.legs = 5.0
        let kickA = FighterPlay(fighter: SampleData.striker, card: SampleData.lowKick, side: .a)
        var rngLegs = SeededRNG(seed: findSeed(a: kickA, b: crossB, state: legsState, wantA: true, wantB: false))
        let resLegs = resolveExchange(a: kickA, b: crossB, state: legsState, rng: &rngLegs)
        #expect(resLegs.finish == ExchangeFinish(winner: .a, reason: .tkoLegs))
    }

    @Test func invariantsHoldAcrossFiveHundredRandomExchanges() {
        var rng = SeededRNG(seed: 2026_11_03)
        var state = FightState()
        let cards = SampleData.cards

        for _ in 0..<500 {
            let cardA = cards[Int(rng.next() % UInt64(cards.count))]
            let cardB = cards[Int(rng.next() % UInt64(cards.count))]
            let log = ExchangeEngine.resolve(
                a: FighterPlay(fighter: SampleData.striker, card: cardA, side: .a),
                b: FighterPlay(fighter: SampleData.wrestler, card: cardB, side: .b),
                state: &state,
                rng: &rng
            )
            #expect(state.validateInvariants().isEmpty)
            if log.finish != nil {
                state = FightState()
            }
        }
    }
}
