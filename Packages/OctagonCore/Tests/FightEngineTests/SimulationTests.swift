import Testing
@testable import FightEngine

@Suite("Simulation")
struct SimulationTests {
    @Test func simulatorRunsWithZeroInvariantViolationsAndDeterministicOutput() {
        let rep1 = BalanceSimulator.run(games: 200, baseSeed: 42, aiA: RandomAI(), aiB: RandomAI())
        let rep2 = BalanceSimulator.run(games: 200, baseSeed: 42, aiA: RandomAI(), aiB: RandomAI())

        #expect(rep1 == rep2)
        #expect(rep1.games == 200)
        #expect(rep1.invariantViolations == 0)
        #expect(rep1.winsA + rep1.winsB + rep1.draws == 200)
        #expect(rep1.totalFinishes + rep1.decisionCount + rep1.draws == 200)
        #expect(rep1.totalExchanges > 1_000)

        for t in CardType.allCases {
            let stats = rep1.cardTypeStats[t]
            #expect(stats != nil)
            #expect((stats?.played ?? 0) > 0)
        }
    }
}
