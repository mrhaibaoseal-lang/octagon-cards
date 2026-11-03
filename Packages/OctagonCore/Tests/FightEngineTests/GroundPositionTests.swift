import Testing
@testable import FightEngine

@Suite("GroundPosition & Takedown Bridge (P3-1)")
struct GroundPositionTests {
    @Test func positionalHierarchyAdvanceAndRetreatTransitions() {
        // Advance progression: FullGuard -> HalfGuard -> SideControl -> FullMount -> BackControl
        var g = GroundState(topSide: .a, position: .fullGuard)
        #expect(g.bottomSide == .b)
        #expect(g.position.canStandUpDirectly)

        g.advance()
        #expect(g.position == .halfGuard)
        #expect(g.position.canStandUpDirectly)

        g.advance()
        #expect(g.position == .sideControl)
        #expect(!g.position.canStandUpDirectly)

        g.advance()
        #expect(g.position == .fullMount)
        #expect(!g.position.canStandUpDirectly)

        g.advance()
        #expect(g.position == .backControl)

        // Retreat progression (per GROUND_GAME_DESIGN.md §2 state diagram):
        // BackControl -> FullGuard (Peel Hands)
        var back = GroundState(topSide: .a, position: .backControl)
        let stoodFromBack = back.escapeOrStandUp()
        #expect(!stoodFromBack)
        #expect(back.position == .fullGuard)

        // FullMount -> HalfGuard (Bridge) -> StandUp!
        var mount = GroundState(topSide: .a, position: .fullMount)
        let stoodFromMount = mount.escapeOrStandUp()
        #expect(!stoodFromMount)
        #expect(mount.position == .halfGuard)
        let stoodFromHalf = mount.escapeOrStandUp()
        #expect(stoodFromHalf)

        // Sweep flips topSide and lands in SideControl (or specified position)
        var sweepState = GroundState(topSide: .a, position: .fullGuard)
        sweepState.sweep(to: .sideControl)
        #expect(sweepState.topSide == .b)
        #expect(sweepState.bottomSide == .a)
        #expect(sweepState.position == .sideControl)
    }

    @Test func takedownOddsIncreaseAtCloseRangeAgainstCageAndDamagedLegs() {
        let tdPlay = FighterPlay(fighter: SampleData.wrestler, card: SampleData.doubleLeg, side: .a)
        let strikePlay = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .b)

        let midCenterState = FightState(distance: .mid)
        var closeCageDamagedLegsState = FightState(distance: .close)
        closeCageDamagedLegsState.b.cage = .againstCage
        closeCageDamagedLegsState.b.health.legs = 35.0

        let pMid = Odds.resolveOdds(my: tdPlay, opp: strikePlay, state: midCenterState)
        let pCloseCage = Odds.resolveOdds(my: tdPlay, opp: strikePlay, state: closeCageDamagedLegsState)

        #expect(pCloseCage > pMid)
        #expect(pMid >= Odds.minimum && pCloseCage <= Odds.maximum)
    }

    @Test func successfulTakedownEntersExpectedGroundPosition() {
        let state = FightState(distance: .close)
        let playWrestler = FighterPlay(fighter: SampleData.wrestler, card: SampleData.cageTrip, side: .a)
        let playStriker = FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .b)

        var landed: ExchangeResult? = nil
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playWrestler, b: playStriker, state: state, rng: &rng)
            if res.log.a.takedownLanded != nil {
                landed = res
                break
            }
        }
        guard let res = landed else {
            Issue.record("Expected cageTrip takedown to land")
            return
        }

        #expect(res.state.isGrounded)
        #expect(res.state.ground?.topSide == .a)
        #expect(res.state.ground?.position == .halfGuard)
        #expect(res.log.a.takedownLanded == .halfGuard)
        #expect(res.state.isValid)
    }

    @Test func sprawlStuffsTakedownAndLeavesFightStanding() {
        let state = FightState(distance: .mid)
        let playWrestler = FighterPlay(fighter: SampleData.wrestler, card: SampleData.doubleLeg, side: .a)
        let playSprawl = FighterPlay(fighter: SampleData.striker, card: SampleData.sprawl, side: .b)

        var stuffed: ExchangeResult? = nil
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playWrestler, b: playSprawl, state: state, rng: &rng)
            if res.log.b.succeeded {
                stuffed = res
                break
            }
        }
        guard let res = stuffed else {
            Issue.record("Expected Sprawl to succeed")
            return
        }

        #expect(!res.state.isGrounded)
        #expect(res.log.a.takedownLanded == nil)
        // Wrestler paid doubleLeg staminaCost (3) + sprawl stuff penalty (4) = 7 stamina lost
        #expect(res.state.a.stamina == 93.0)
        #expect(res.state.b.momentum == 10.0)
    }

    @Test func interceptingKneeCountersTakedownAttempt() {
        let state = FightState(distance: .mid)
        let playWrestler = FighterPlay(fighter: SampleData.wrestler, card: SampleData.doubleLeg, side: .a)
        let playKnee = FighterPlay(fighter: SampleData.striker, card: SampleData.interceptKnee, side: .b)

        var countered: ExchangeResult? = nil
        for seed in UInt64(1)...1_000 {
            var rng = SeededRNG(seed: seed)
            let res = resolveExchange(a: playWrestler, b: playKnee, state: state, rng: &rng)
            if res.log.b.succeeded {
                countered = res
                break
            }
        }
        guard let res = countered else {
            Issue.record("Expected interceptKnee counter to land")
            return
        }

        #expect(!res.state.isGrounded)
        #expect(res.log.b.damageDealt > 20.0)
        #expect(res.state.a.health.head < BodyHealth.max)
    }
}
