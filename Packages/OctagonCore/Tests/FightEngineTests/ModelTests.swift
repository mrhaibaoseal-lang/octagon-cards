import Foundation
import Testing
@testable import FightEngine

/// Compile-time proof that the models are `Sendable` (Swift 6 strict concurrency).
private func requireSendable<T: Sendable>(_: T.Type) {}

@Suite("Models")
struct ModelTests {
    @Test func typesAreSendable() {
        requireSendable(Fighter.self)
        requireSendable(Card.self)
        requireSendable(FightState.self)
        requireSendable(FighterCondition.self)
        requireSendable(BodyHealth.self)
    }

    @Test func fighterCodableRoundTrip() throws {
        let data = try JSONEncoder().encode(SampleData.striker)
        let decoded = try JSONDecoder().decode(Fighter.self, from: data)
        #expect(decoded == SampleData.striker)
    }

    @Test func fighterHasTenAttributes() {
        #expect(SampleData.striker.attributes.allValues.count == 10)
        #expect(SampleData.striker.has(.onePunch))
        #expect(!SampleData.striker.has(.glassChin))
    }

    @Test func attributesAreClamped() {
        let a = FighterAttributes(power: 150, speed: -5)
        #expect(a.power == 100)
        #expect(a.speed == 0)
        #expect(a.allValues.allSatisfy { FighterAttributes.range.contains($0) })
    }

    @Test func sampleDeckHasTenCardsCoveringAllTypes() {
        let cards = SampleData.cards
        #expect(cards.count == 10)
        #expect(Set(cards.map(\.id)).count == 10)
        #expect(Set(cards.map(\.type)) == Set(CardType.allCases))
    }

    @Test func standingCatalogCoversAllDistancesAndTypes() {
        let catalog = SampleData.standingCards
        #expect(catalog.count == 28)
        #expect(Set(catalog.map(\.id)).count == 28)

        // Every distance (.long, .mid, .close) must have all 6 card types available
        for dist in Distance.allCases {
            let effectiveAtDist = catalog.filter { $0.isEffective(at: dist) }
            let typesAtDist = Set(effectiveAtDist.map(\.type))
            #expect(typesAtDist == Set(CardType.allCases))
            // And strikes at every distance must cover head and body/legs
            let strikeTargets = Set(effectiveAtDist.filter { $0.type == .strike }.compactMap(\.target))
            #expect(strikeTargets.contains(.head))
            #expect(strikeTargets.count >= 2)
        }
    }

    @Test func cardsCodableRoundTrip() throws {
        let data = try JSONEncoder().encode(SampleData.cards)
        let decoded = try JSONDecoder().decode([Card].self, from: data)
        #expect(decoded == SampleData.cards)
    }

    @Test func strikesHaveTargetsAndStatsInRange() {
        for card in SampleData.cards {
            #expect(!card.distances.isEmpty)
            #expect(Card.statRange.contains(card.speed))
            #expect(Card.statRange.contains(card.power))
            #expect(Card.statRange.contains(card.accuracy))
            if card.type == .strike || card.type == .counter {
                #expect(card.target != nil)
            }
        }
    }

    @Test func cardDistanceEffectiveness() {
        #expect(SampleData.cross.isEffective(at: .mid))
        #expect(!SampleData.cross.isEffective(at: .close))
        #expect(Distance.long < Distance.close)
    }

    @Test func fightStateDefaultsAndCodable() throws {
        let state = FightState()
        #expect(state.distance == .long)
        #expect(state.a.health == .full)
        #expect(state.a.stamina == FighterCondition.maxStamina)
        #expect(state.a.momentum == 0)
        #expect(state.a.cage == .center)
        #expect(!state.b.isRocked)

        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(FightState.self, from: data)
        #expect(decoded == state)
    }

    @Test func healthSubscriptClamps() {
        var health = BodyHealth()
        health[.head] = -20
        health[.legs] = 500
        #expect(health.head == 0)
        #expect(health.legs == BodyHealth.max)
        #expect(health[.body] == BodyHealth.max)
    }

    @Test func fightStateSideSubscript() {
        var state = FightState()
        state[.b].isRocked = true
        state[.a].stamina = 40
        #expect(state.b.isRocked)
        #expect(!state.a.isRocked)
        #expect(state[.a].stamina == 40)
        #expect(Side.a.opposite == .b)
    }
}
