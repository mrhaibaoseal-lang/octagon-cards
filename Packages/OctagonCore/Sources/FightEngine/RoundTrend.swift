/// Live "who is winning this round" read-out (docs/TASKS.md P5-4).
///
/// Pure presentation helper: it reuses `FightMatchEngine.scoreRound` (damage, Rocked counts, the three judge
/// cards) on the exchanges played so far and never changes how a round is scored. It does not touch
/// `SeededRNG` or any fight state, and it deliberately exposes no exact 10-point score — that is P5-5.

/// How lopsided the current round looks.
public enum RoundTrendLevel: String, Sendable, Codable, Hashable, CaseIterable {
    /// 勢均力敵
    case even
    /// 小幅領先
    case slight
    /// 明顯領先
    case clear

    public var displayName: String {
        switch self {
        case .even: "勢均力敵"
        case .slight: "小幅領先"
        case .clear: "明顯領先"
        }
    }
}

public struct RoundTrend: Sendable, Codable, Hashable {
    /// `0.0 ... 1.0`. `0.5` is dead even; toward `1.0` favours side A, toward `0.0` favours side B.
    public var value: Double
    /// The side currently ahead, `nil` while the round reads as even.
    public var leader: Side?
    public var level: RoundTrendLevel
    /// Exchanges the estimate was built from.
    public var exchangeCount: Int

    public init(value: Double, leader: Side?, level: RoundTrendLevel, exchangeCount: Int) {
        self.value = value
        self.leader = leader
        self.level = level
        self.exchangeCount = exchangeCount
    }

    public static let even = RoundTrend(value: 0.5, leader: nil, level: .even, exchangeCount: 0)

    /// Lead of `side` in `0.0 ... 1.0` (`0.5` when even). Handy for drawing one bar per corner.
    public func share(of side: Side) -> Double {
        side == .a ? value : 1.0 - value
    }

    /// Short label such as "勢均力敵" or "領先方 小幅領先" — callers add the fighter name.
    public var label: String { level.displayName }

    // MARK: - Tuning

    /// Edge magnitudes (`0 ... 1`) separating the three levels.
    static let slightThreshold = 0.12
    static let clearThreshold = 0.40
    /// Judge cards are coarse (a 10-9 is the smallest lead), so they only count for half an edge at most.
    static let judgeWeight = 0.5
    static let damageWeight = 0.6
    /// Added to the combined damage so that one early jab does not read as total domination.
    static let damageSmoothing = 24.0
    /// Damage-equivalent of one Rocked, matching `scoreRound`'s `rockedBy * 12.0`.
    static let rockedWeight = 12.0
    /// Exchanges needed before the read is allowed to reach full strength.
    static let fullConfidenceExchanges = 4

    /// Who came out ahead in one exchange (for the round progress cells), or `nil` for a wash.
    /// Uses the same weights `scoreRound` gives damage, Rocked, cuts, takedowns, position and submissions.
    public static func exchangeWinner(_ log: ExchangeLog) -> Side? {
        let diff = exchangeCredit(log.a) - exchangeCredit(log.b)
        if diff >= 1.0 { return .a }
        if diff <= -1.0 { return .b }
        return nil
    }

    private static func exchangeCredit(_ side: ExchangeSideLog) -> Double {
        var credit = side.damageDealt
        if side.inflictedRocked { credit += rockedWeight }
        if side.inflictedCut { credit += 4.0 }
        if side.takedownLanded != nil { credit += 8.0 }
        if side.positionAdvancedTo != nil || side.sweptToPosition != nil { credit += 6.0 }
        if let stage = side.submissionStageReached { credit += stage == .lockedIn ? 14.0 : 9.0 }
        return credit
    }

    /// Estimates the current round from the exchanges played so far.
    ///
    /// - Parameters:
    ///   - exchanges: this round's `ExchangeLog`s, in order (an empty list is "even").
    ///   - state: the fight state after the last exchange (its `round` and momentum feed `scoreRound`).
    public static func estimate(exchanges: [ExchangeLog], state: FightState) -> RoundTrend {
        guard !exchanges.isEmpty else { return .even }

        let score = FightMatchEngine.scoreRound(round: state.round, exchanges: exchanges, endState: state)

        let pressureA = score.damageByA + Double(score.rockedByA) * rockedWeight
        let pressureB = score.damageByB + Double(score.rockedByB) * rockedWeight
        let damageEdge = (pressureA - pressureB) / (pressureA + pressureB + damageSmoothing)

        var judgeEdge = 0.0
        if !score.judgeCards.isEmpty {
            let total = score.judgeCards.reduce(0.0) { $0 + Double($1.pointsA - $1.pointsB) }
            // A 10-8 round is a two point swing, so dividing by 2 maps one card into `-1 ... 1`.
            judgeEdge = total / Double(score.judgeCards.count) / 2.0
        }

        let confidence = Double(min(exchanges.count, fullConfidenceExchanges)) / Double(fullConfidenceExchanges)
        let edge = min(max((damageEdge * damageWeight + judgeEdge * judgeWeight) * confidence, -1.0), 1.0)

        let magnitude = abs(edge)
        let level: RoundTrendLevel
        if magnitude < slightThreshold {
            level = .even
        } else if magnitude < clearThreshold {
            level = .slight
        } else {
            level = .clear
        }
        let leader: Side? = level == .even ? nil : (edge > 0 ? .a : .b)

        return RoundTrend(
            value: min(max(0.5 + 0.5 * edge, 0.0), 1.0),
            leader: leader,
            level: level,
            exchangeCount: exchanges.count
        )
    }
}
