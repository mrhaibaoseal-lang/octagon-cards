import Testing
@testable import FightEngine

@Suite("Round Trend (P5-4)")
struct RoundTrendTests {
    // MARK: - Helpers

    private let neutralOdds = OddsBreakdown(base: 0.5, finalOdds: 0.5)

    private func sideLog(
        _ side: Side,
        _ card: Card,
        _ edit: (inout ExchangeSideLog) -> Void = { _ in }
    ) -> ExchangeSideLog {
        var log = ExchangeSideLog(side: side, card: card, odds: neutralOdds, roll: 0.1, succeeded: true)
        edit(&log)
        return log
    }

    private func exchange(
        a: (inout ExchangeSideLog) -> Void = { _ in },
        b: (inout ExchangeSideLog) -> Void = { _ in }
    ) -> ExchangeLog {
        let state = FightState(distance: .mid)
        return ExchangeLog(
            firstSide: .a,
            stateBefore: state,
            stateAfter: state,
            a: sideLog(.a, SampleData.jab, a),
            b: sideLog(.b, SampleData.jab, b)
        )
    }

    private func hit(_ damage: Double, rocked: Bool = false) -> (inout ExchangeSideLog) -> Void {
        { log in
            log.damageDealt = damage
            log.targetHit = .head
            log.inflictedRocked = rocked
        }
    }

    private let endState = FightState(distance: .mid)

    // MARK: - Empty and even

    @Test func emptyRoundIsEven() {
        let trend = RoundTrend.estimate(exchanges: [], state: endState)
        #expect(trend.value == 0.5)
        #expect(trend.leader == nil)
        #expect(trend.level == .even)
        #expect(trend.exchangeCount == 0)
        #expect(trend == RoundTrend.even)
    }

    @Test func identicalTradesStayExactlyEven() {
        let logs = (0..<8).map { _ in exchange(a: hit(8.0), b: hit(8.0)) }
        let trend = RoundTrend.estimate(exchanges: logs, state: endState)
        #expect(trend.value == 0.5)
        #expect(trend.leader == nil)
        #expect(trend.level == .even)
    }

    @Test func oneEarlyJabDoesNotReadAsDomination() {
        let trend = RoundTrend.estimate(exchanges: [exchange(a: hit(6.0))], state: endState)
        #expect(trend.level != .clear)
        #expect(trend.value >= 0.5)
        #expect(trend.value < 0.6)
    }

    // MARK: - One-sided rounds

    @Test func sideAControllingRoundIsClearLeadForA() {
        let logs = (0..<8).map { i in exchange(a: hit(10.0, rocked: i % 4 == 0)) }
        let trend = RoundTrend.estimate(exchanges: logs, state: endState)
        #expect(trend.leader == .a)
        #expect(trend.level == .clear)
        #expect(trend.value > 0.85)
        #expect(trend.share(of: .a) == trend.value)
        #expect(abs(trend.share(of: .b) - (1.0 - trend.value)) < 1e-12)
    }

    @Test func sideBControllingRoundIsClearLeadForB() {
        let logs = (0..<8).map { i in exchange(b: hit(10.0, rocked: i % 4 == 0)) }
        let trend = RoundTrend.estimate(exchanges: logs, state: endState)
        #expect(trend.leader == .b)
        #expect(trend.level == .clear)
        #expect(trend.value < 0.15)
    }

    @Test func mirroredRoundsMirrorTheValue() {
        let forA = (0..<6).map { _ in exchange(a: hit(9.0), b: hit(3.0)) }
        let forB = (0..<6).map { _ in exchange(a: hit(3.0), b: hit(9.0)) }
        let trendA = RoundTrend.estimate(exchanges: forA, state: endState)
        let trendB = RoundTrend.estimate(exchanges: forB, state: endState)
        #expect(abs(trendA.value + trendB.value - 1.0) < 1e-9)
        #expect(trendA.leader == .a)
        #expect(trendB.leader == .b)
        #expect(trendA.level == trendB.level)
    }

    @Test func grapplingOnlyControlStillCountsAsALead() {
        let logs = (0..<4).map { _ in
            exchange(a: { $0.takedownLanded = .sideControl; $0.positionAdvancedTo = .fullMount })
        }
        let trend = RoundTrend.estimate(exchanges: logs, state: endState)
        #expect(trend.leader == .a)
        #expect(trend.level != .even)
    }

    @Test func leadGrowsAsAdvantageGrows() {
        var previous = 0.5
        for count in 1...8 {
            let logs = (0..<count).map { _ in exchange(a: hit(9.0), b: hit(2.0)) }
            let value = RoundTrend.estimate(exchanges: logs, state: endState).value
            #expect(value >= previous - 1e-12)
            previous = value
        }
        #expect(previous > 0.65)
    }

    // MARK: - Range and purity

    @Test func realMatchesAlwaysStayInRangeAndConsistent() {
        for seed in UInt64(1)...UInt64(40) {
            let result = FightMatchEngine.runMatch(
                config: FightMatchConfig(seed: seed), aiA: StyleAI(), aiB: StyleAI())
            for roundLog in result.rounds {
                for count in 0...roundLog.exchanges.count {
                    let prefix = Array(roundLog.exchanges.prefix(count))
                    let trend = RoundTrend.estimate(exchanges: prefix, state: roundLog.stateAfterCorner)
                    #expect(trend.value >= 0.0 && trend.value <= 1.0)
                    #expect(trend.exchangeCount == count)
                    #expect(trend.leader == nil || trend.level != .even)
                    #expect(trend.level != .even || trend.leader == nil)
                    if let leader = trend.leader {
                        #expect(leader == .a ? trend.value > 0.5 : trend.value < 0.5)
                    }
                }
            }
        }
    }

    @Test func estimateIsDeterministicAndLeavesRoundScoringUntouched() {
        let result = FightMatchEngine.runMatch(
            config: FightMatchConfig(seed: 77), aiA: StyleAI(), aiB: StyleAI())
        for roundLog in result.rounds {
            let before = FightMatchEngine.scoreRound(
                round: roundLog.round, exchanges: roundLog.exchanges, endState: roundLog.stateAfterCorner)
            let first = RoundTrend.estimate(exchanges: roundLog.exchanges, state: roundLog.stateAfterCorner)
            let second = RoundTrend.estimate(exchanges: roundLog.exchanges, state: roundLog.stateAfterCorner)
            let after = FightMatchEngine.scoreRound(
                round: roundLog.round, exchanges: roundLog.exchanges, endState: roundLog.stateAfterCorner)
            #expect(first == second)
            #expect(before == after)
            if let recorded = roundLog.score, roundLog.stateAfterCorner.round == roundLog.round {
                // The engine's own record was produced before corner recovery, so only compare the parts
                // that corner recovery cannot change.
                #expect(recorded.damageByA == before.damageByA)
                #expect(recorded.damageByB == before.damageByB)
                #expect(recorded.rockedByA == before.rockedByA)
                #expect(recorded.rockedByB == before.rockedByB)
            }
        }
    }

    // MARK: - Per-exchange winner (progress cells)

    @Test func exchangeWinnerFollowsCreditAndTreatsWashesAsNil() {
        #expect(RoundTrend.exchangeWinner(exchange()) == nil)
        #expect(RoundTrend.exchangeWinner(exchange(a: hit(8.0), b: hit(8.0))) == nil)
        #expect(RoundTrend.exchangeWinner(exchange(a: hit(8.0))) == .a)
        #expect(RoundTrend.exchangeWinner(exchange(b: hit(5.0))) == .b)
        // A Rocked outweighs a slightly bigger plain hit.
        #expect(RoundTrend.exchangeWinner(exchange(a: hit(6.0, rocked: true), b: hit(10.0))) == .a)
        // Grappling credit counts even without damage.
        #expect(RoundTrend.exchangeWinner(exchange(b: { $0.takedownLanded = .sideControl })) == .b)
    }

    @Test func levelNamesAreTheAgreedTraditionalChinese() {
        #expect(RoundTrendLevel.even.displayName == "勢均力敵")
        #expect(RoundTrendLevel.slight.displayName == "小幅領先")
        #expect(RoundTrendLevel.clear.displayName == "明顯領先")
    }
}
