import Foundation
import Testing
@testable import FightEngine

@Suite("FightMatch")
struct FightMatchTests {
    @Test func sameSeedProducesIdenticalMatchResult() throws {
        let config = FightMatchConfig(seed: 2026_11_03)
        let res1 = FightMatchEngine.runMatch(config: config, aiA: RandomAI(), aiB: RandomAI())
        let res2 = FightMatchEngine.runMatch(config: config, aiA: RandomAI(), aiB: RandomAI())

        #expect(res1 == res2)
        #expect(res1.finalState.isValid)

        // Also verify JSON Codable round-trip of the entire MatchResult replay bundle
        let encoded = try JSONEncoder().encode(res1)
        let decoded = try JSONDecoder().decode(MatchResult.self, from: encoded)
        #expect(decoded == res1)
    }

    @Test func singleRoundRunsEightExchangesAndRecoversStaminaInCorner() {
        var state = FightState(distance: .mid)
        var rng = SeededRNG(seed: 77)
        // Use purely defensive/movement decks so the round guaranteed goes all 8 exchanges
        let safeDeck = [SampleData.guardUp, SampleData.slip, SampleData.feintStep, SampleData.stepIn]

        let (roundLog, stopped) = FightMatchEngine.runRound(
            roundNumber: 1,
            exchangesPerRound: 8,
            fighterA: SampleData.striker,
            fighterB: SampleData.wrestler,
            deckA: safeDeck,
            deckB: safeDeck,
            aiA: RandomAI(),
            aiB: RandomAI(),
            state: &state,
            rng: &rng,
            applyCornerAtEnd: true
        )

        #expect(stopped == nil)
        #expect(roundLog.exchanges.count == 8)
        #expect(roundLog.score != nil)
        if let score = roundLog.score {
            #expect(score.pointsA == 10 || score.pointsB == 10)
            #expect(score.pointsA >= 8 && score.pointsB >= 8)
        }
        // Corner recovery resets distance to .long and clears cage position
        #expect(state.distance == .long)
        #expect(state.a.cage == .center)
        #expect(state.isValid)
    }

    @Test func randomAndStyleAIsCompleteFullMatchesWithBothDecisionsAndFinishes() {
        var sawFinish = false
        var sawDecision = false

        for seed in UInt64(1)...150 {
            let config = FightMatchConfig(seed: seed)
            let result = FightMatchEngine.runMatch(config: config, aiA: StyleAI(), aiB: RandomAI())

            #expect(result.rounds.count >= 1 && result.rounds.count <= 3)
            #expect(result.finalState.isValid)

            for r in result.rounds {
                #expect(r.exchanges.count >= 1 && r.exchanges.count <= 8)
                for ex in r.exchanges {
                    #expect(ex.stateAfter.isValid)
                }
            }

            switch result.outcome {
            case let .finish(winner, _, round, exchangeInRound):
                sawFinish = true
                #expect(winner == .a || winner == .b)
                #expect((1...3).contains(round))
                #expect((1...8).contains(exchangeInRound))
            case let .decision(winner, scoreA, scoreB):
                sawDecision = true
                #expect(winner == (scoreA > scoreB ? .a : .b))
                #expect(result.rounds.count == 3)
            case let .draw(scoreA, scoreB):
                sawDecision = true
                #expect(scoreA == scoreB)
            }
        }

        #expect(sawFinish)
        #expect(sawDecision)
    }

    @Test func rockedFighterOnlySelectsDefensiveOrMoveCards() {
        let legalWhenRocked = FightMatchEngine.legalCards(from: SampleData.cards, isRocked: true)
        #expect(!legalWhenRocked.isEmpty)
        for card in legalWhenRocked {
            #expect(card.type == .block || card.type == .evade || card.type == .move)
        }
    }

    @Test func readModifierTracksFeintsAndRepeatedMoves() {
        var state = FightState(distance: .mid)
        var rng = SeededRNG(seed: 10)
        var history: [ExchangeLog] = []

        for _ in 0..<3 {
            let log = ExchangeEngine.resolve(
                a: FighterPlay(fighter: SampleData.striker, card: SampleData.guardUp, side: .a),
                b: FighterPlay(fighter: SampleData.wrestler, card: SampleData.jab, side: .b),
                state: &state,
                rng: &rng
            )
            history.append(log)
        }

        // B threw 3 strikes in a row -> A gets read bonus of (3 - 1) * 0.03 = 0.06
        let readForA = FightMatchEngine.computeReadModifier(for: .a, history: history)
        #expect(abs(readForA - 0.06) < 1e-9)
    }
}
