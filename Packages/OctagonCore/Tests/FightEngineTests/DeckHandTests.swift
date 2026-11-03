import Testing
@testable import FightEngine

@Suite("20-Card Deck & 5-Card Hand Auto-Flip (P4-3)")
struct DeckHandTests {
    @Test func factoryDecksPassAllValidationRules() {
        for fighter in [SampleData.striker, SampleData.wrestler, SampleData.bjjFighter] {
            let deck = DeckBuilder.defaultStandingDeck(for: fighter)
            #expect(deck.count == DeckBuilder.standardDeckSize)
            let violations = DeckBuilder.validateDeck(deck, for: fighter)
            #expect(violations.isEmpty, "Violations for \(fighter.name): \(violations)")
        }
    }

    @Test func handDrawsFiveCardsReplenishesAndAutoFlipsOnGroundAndStandUp() {
        var rng = SeededRNG(seed: 2026)
        var state = FightState(distance: .mid)
        var handA = HandManager(side: .a, fighter: SampleData.wrestler, state: state, rng: &rng)
        var handB = HandManager(side: .b, fighter: SampleData.bjjFighter, state: state, rng: &rng)

        // 1. Starts standing with 5 cards in hand and 15 in draw pile
        #expect(!handA.isShowingGroundHand)
        #expect(handA.activeHand.count == 5)
        #expect(handA.drawPile.count == 15)
        #expect(handA.activeHand.allSatisfy { !$0.isGroundCard })

        // 2. Play a card while remaining standing -> replenishes back to 5 cards
        let playedStanding = handA.activeHand[0]
        handA.playCard(playedStanding, updatedState: state, rng: &rng)
        #expect(handA.activeHand.count == 5)
        #expect(handA.discardPile.count == 1)
        #expect(handA.drawPile.count == 14)

        // 3. Transition to ground (Wrestler A on Top in HalfGuard, BJJ B on Bottom)
        state.ground = GroundState(topSide: .a, position: .halfGuard)
        handA.syncWithState(state: state, rng: &rng)
        handB.syncWithState(state: state, rng: &rng)

        #expect(handA.isShowingGroundHand)
        #expect(handB.isShowingGroundHand)
        #expect(handA.activeHand.count == 5)
        #expect(handB.activeHand.count == 5)
        #expect(handA.activeHand.allSatisfy { $0.isLegalOnGround(as: .top, at: .halfGuard) })
        #expect(handB.activeHand.allSatisfy { $0.isLegalOnGround(as: .bottom, at: .halfGuard) })

        // Top hand covers all 4 TopIntents; Bottom hand covers all 4 BottomIntents
        for topIntent in TopIntent.allCases {
            #expect(handA.activeHand.contains { $0.topIntent == topIntent })
        }
        for bottomIntent in BottomIntent.allCases {
            #expect(handB.activeHand.contains { $0.bottomIntent == bottomIntent })
        }

        // 4. Sweep! Roles flip (B becomes Top in FullMount, A becomes Bottom)
        state.ground?.sweep(to: .fullMount)
        handA.syncWithState(state: state, rng: &rng)
        handB.syncWithState(state: state, rng: &rng)

        #expect(handA.activeHand.allSatisfy { $0.isLegalOnGround(as: .bottom, at: .fullMount) })
        #expect(handB.activeHand.allSatisfy { $0.isLegalOnGround(as: .top, at: .fullMount) })

        // 5. Stand up! Both hands automatically flip back to their 5-card standing hands
        state.ground = nil
        state.distance = .long
        handA.syncWithState(state: state, rng: &rng)
        handB.syncWithState(state: state, rng: &rng)

        #expect(!handA.isShowingGroundHand)
        #expect(!handB.isShowingGroundHand)
        #expect(handA.activeHand.count == 5)
        #expect(handB.activeHand.count == 5)
        #expect(handA.activeHand.allSatisfy { !$0.isGroundCard })
    }
}
