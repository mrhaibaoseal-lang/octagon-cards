/// Round & full-match loop, corner recovery, 10-Point Must simplified judging,
/// and AI card selection (see docs/STRIKING_AND_DECK.md §4.1, §5, §9, §10, §12 and docs/TASKS.md P2-5).

/// Score awarded for a completed round under the 10-Point Must system.
public struct RoundScore: Sendable, Codable, Hashable {
    public var round: Int
    public var pointsA: Int
    public var pointsB: Int
    public var damageByA: Double
    public var damageByB: Double
    public var rockedByA: Int
    public var rockedByB: Int

    public init(
        round: Int,
        pointsA: Int,
        pointsB: Int,
        damageByA: Double,
        damageByB: Double,
        rockedByA: Int,
        rockedByB: Int
    ) {
        self.round = round
        self.pointsA = pointsA
        self.pointsB = pointsB
        self.damageByA = damageByA
        self.damageByB = damageByB
        self.rockedByA = rockedByA
        self.rockedByB = rockedByB
    }
}

/// Complete record of a single round (up to 8 exchanges) plus optional judge score and corner recovery.
public struct RoundLog: Sendable, Codable, Hashable {
    public var round: Int
    public var exchanges: [ExchangeLog]
    /// Present when the round goes the distance; `nil` if stopped mid-round by KO/TKO.
    public var score: RoundScore?
    public var stateAfterCorner: FightState

    public init(
        round: Int,
        exchanges: [ExchangeLog],
        score: RoundScore?,
        stateAfterCorner: FightState
    ) {
        self.round = round
        self.exchanges = exchanges
        self.score = score
        self.stateAfterCorner = stateAfterCorner
    }
}

/// How a full match ended.
public enum MatchOutcome: Sendable, Codable, Hashable {
    case finish(winner: Side, reason: FinishReason, round: Int, exchangeInRound: Int)
    case decision(winner: Side, scoreA: Int, scoreB: Int)
    case draw(scoreA: Int, scoreB: Int)

    public var winner: Side? {
        switch self {
        case let .finish(winner, _, _, _): winner
        case let .decision(winner, _, _): winner
        case .draw: nil
        }
    }

    public var isFinish: Bool {
        if case .finish = self { return true }
        return false
    }
}

/// Reproducible configuration for a full match (can be serialized to JSON as a bug-report replay bundle).
public struct FightMatchConfig: Sendable, Codable, Hashable {
    public var seed: UInt64
    public var fighterA: Fighter
    public var fighterB: Fighter
    public var deckA: [Card]
    public var deckB: [Card]
    public var rounds: Int
    public var exchangesPerRound: Int

    public init(
        seed: UInt64,
        fighterA: Fighter = SampleData.striker,
        fighterB: Fighter = SampleData.wrestler,
        deckA: [Card] = SampleData.cards,
        deckB: [Card] = SampleData.cards,
        rounds: Int = 3,
        exchangesPerRound: Int = 8
    ) {
        self.seed = seed
        self.fighterA = fighterA
        self.fighterB = fighterB
        self.deckA = deckA.isEmpty ? SampleData.cards : deckA
        self.deckB = deckB.isEmpty ? SampleData.cards : deckB
        self.rounds = max(rounds, 1)
        self.exchangesPerRound = max(exchangesPerRound, 1)
    }
}

/// Full result of a simulated or played match, including every `ExchangeLog` and the seed.
public struct MatchResult: Sendable, Codable, Hashable {
    public var config: FightMatchConfig
    public var rounds: [RoundLog]
    public var outcome: MatchOutcome
    public var finalState: FightState

    public var allExchanges: [ExchangeLog] {
        rounds.flatMap(\.exchanges)
    }

    public init(
        config: FightMatchConfig,
        rounds: [RoundLog],
        outcome: MatchOutcome,
        finalState: FightState
    ) {
        self.config = config
        self.rounds = rounds
        self.outcome = outcome
        self.finalState = finalState
    }
}

// MARK: - AI Card Selection

public protocol FighterAI: Sendable {
    func chooseCard(
        fighter: Fighter,
        side: Side,
        availableCards: [Card],
        state: FightState,
        history: [ExchangeLog],
        rng: inout SeededRNG
    ) -> Card
}

/// Purely uniform random AI (respects the Rocked restriction when defensive/move cards exist).
public struct RandomAI: FighterAI {
    public init() {}

    public func chooseCard(
        fighter: Fighter,
        side: Side,
        availableCards: [Card],
        state: FightState,
        history: [ExchangeLog],
        rng: inout SeededRNG
    ) -> Card {
        let legal = FightMatchEngine.legalCards(from: availableCards, isRocked: state[side].isRocked)
        let idx = Int(rng.next() % UInt64(legal.count))
        return legal[idx]
    }
}

/// Style-aware heuristic AI that prefers distance-appropriate cards and conserves stamina when tired.
public struct StyleAI: FighterAI {
    public init() {}

    public func chooseCard(
        fighter: Fighter,
        side: Side,
        availableCards: [Card],
        state: FightState,
        history: [ExchangeLog],
        rng: inout SeededRNG
    ) -> Card {
        let cond = state[side]
        let legal = FightMatchEngine.legalCards(from: availableCards, isRocked: cond.isRocked)
        guard legal.count > 1 else { return legal[0] }

        // Weight each legal card by distance fit, stamina state, and fighter tendencies.
        var weights: [Double] = []
        weights.reserveCapacity(legal.count)
        for card in legal {
            var w = 1.0
            if card.isEffective(at: state.distance) {
                w += 1.5
            } else {
                w *= 0.35
            }
            if cond.stamina < 35.0 {
                if card.type == .block || card.type == .move {
                    w += 1.0
                } else if card.staminaCost >= 3 {
                    w *= 0.4
                }
            }
            if fighter.has(.counterPuncher) && card.type == .counter {
                w += 0.8
            }
            if state[side.opposite].isRocked && card.type == .strike {
                w += 1.8
            }
            weights.append(max(w, 0.05))
        }

        let total = weights.reduce(0.0, +)
        var pick = rng.nextUnit() * total
        for (i, w) in weights.enumerated() {
            pick -= w
            if pick <= 0 {
                return legal[i]
            }
        }
        return legal[legal.count - 1]
    }
}

// MARK: - Match & Round Engine

public enum FightMatchEngine {
    /// Enforces STRIKING_AND_DECK §4.1: a Rocked fighter can only choose Block / Evade / Move
    /// (falls back to all cards only if the pool has none of those types).
    public static func legalCards(from cards: [Card], isRocked: Bool) -> [Card] {
        let pool = cards.isEmpty ? SampleData.cards : cards
        guard isRocked else { return pool }
        let defensive = pool.filter { $0.type == .block || $0.type == .evade || $0.type == .move }
        return defensive.isEmpty ? pool : defensive
    }

    /// Computes the read bonus (`0.0 ... 0.10`) for `mySide` based on recent exchanges:
    /// +0.10 if `mySide` landed a successful feint on the immediately preceding exchange,
    /// plus +0.03 per consecutive repeated card type by the opponent (clamped to 0.10).
    public static func computeReadModifier(
        for mySide: Side,
        history: [ExchangeLog]
    ) -> Double {
        guard let last = history.last else { return 0.0 }
        var bonus = 0.0
        if last[mySide].feintSucceeded {
            bonus += 0.10
        }
        let oppSide = mySide.opposite
        let lastOppType = last[oppSide].card.type
        var streak = 0
        for log in history.reversed() {
            if log[oppSide].card.type == lastOppType {
                streak += 1
            } else {
                break
            }
        }
        if streak >= 2 {
            bonus += Double(streak - 1) * 0.03
        }
        return min(bonus, 0.10)
    }

    /// Corner stamina recovery and positional reset between rounds (STRIKING_AND_DECK §5).
    public static func applyCornerRecovery(
        state: inout FightState,
        fighterA: Fighter,
        fighterB: Fighter
    ) {
        state.distance = .long
        recoverFighter(&state.a, fighter: fighterA)
        recoverFighter(&state.b, fighter: fighterB)
    }

    private static func recoverFighter(_ cond: inout FighterCondition, fighter: Fighter) {
        let bodyFactor = 0.5 + 0.5 * (cond.health.body / BodyHealth.max)
        let baseRecovery = 12.0 + Double(fighter.attributes.cardio) * 0.18
        let gasTankBonus = fighter.has(.gasTank) ? 4.0 : 0.0
        let recovered = (baseRecovery + gasTankBonus) * bodyFactor
        cond.stamina = min(FighterCondition.maxStamina, cond.stamina + recovered)
        cond.isRocked = false
        cond.cage = .center
    }

    /// Simplified 10-Point Must judging for a completed round (STRIKING_AND_DECK §9).
    public static func scoreRound(
        round: Int,
        exchanges: [ExchangeLog],
        endState: FightState
    ) -> RoundScore {
        var damageByA = 0.0
        var damageByB = 0.0
        var rockedByA = 0
        var rockedByB = 0
        var strikesLandedA = 0
        var strikesLandedB = 0
        var tacticsA = 0
        var tacticsB = 0

        for ex in exchanges {
            damageByA += ex.a.damageDealt
            damageByB += ex.b.damageDealt
            if ex.a.inflictedRocked { rockedByA += 1 }
            if ex.b.inflictedRocked { rockedByB += 1 }
            if ex.a.damageDealt > 0 { strikesLandedA += 1 }
            if ex.b.damageDealt > 0 { strikesLandedB += 1 }
            if ex.a.feintSucceeded || ex.a.movedDistanceTo != nil { tacticsA += 1 }
            if ex.b.feintSucceeded || ex.b.movedDistanceTo != nil { tacticsB += 1 }
        }

        let perfA = damageByA
            + Double(rockedByA) * 12.0
            + Double(strikesLandedA) * 3.0
            + Double(tacticsA) * 1.5
            + endState.a.momentum * 0.05
        let perfB = damageByB
            + Double(rockedByB) * 12.0
            + Double(strikesLandedB) * 3.0
            + Double(tacticsB) * 1.5
            + endState.b.momentum * 0.05

        let diff = perfA - perfB
        let pointsA: Int
        let pointsB: Int
        if abs(diff) < 0.5 {
            pointsA = 10
            pointsB = 10
        } else if diff > 0 {
            pointsA = 10
            pointsB = (diff >= 28.0 || (rockedByA >= 2 && rockedByB == 0)) ? 8 : 9
        } else {
            pointsB = 10
            pointsA = (-diff >= 28.0 || (rockedByB >= 2 && rockedByA == 0)) ? 8 : 9
        }

        return RoundScore(
            round: round,
            pointsA: pointsA,
            pointsB: pointsB,
            damageByA: damageByA,
            damageByB: damageByB,
            rockedByA: rockedByA,
            rockedByB: rockedByB
        )
    }

    /// Runs a single round of up to `exchangesPerRound` exchanges.
    public static func runRound(
        roundNumber: Int,
        exchangesPerRound: Int = 8,
        fighterA: Fighter,
        fighterB: Fighter,
        deckA: [Card],
        deckB: [Card],
        aiA: some FighterAI,
        aiB: some FighterAI,
        state: inout FightState,
        rng: inout SeededRNG,
        applyCornerAtEnd: Bool = true
    ) -> (log: RoundLog, finish: (finish: ExchangeFinish, exchangeIndex: Int)?) {
        var roundExchanges: [ExchangeLog] = []
        roundExchanges.reserveCapacity(exchangesPerRound)

        for exchangeIdx in 1...max(exchangesPerRound, 1) {
            let cardA = aiA.chooseCard(
                fighter: fighterA,
                side: .a,
                availableCards: deckA,
                state: state,
                history: roundExchanges,
                rng: &rng
            )
            let cardB = aiB.chooseCard(
                fighter: fighterB,
                side: .b,
                availableCards: deckB,
                state: state,
                history: roundExchanges,
                rng: &rng
            )
            let readA = computeReadModifier(for: .a, history: roundExchanges)
            let readB = computeReadModifier(for: .b, history: roundExchanges)

            let exLog = ExchangeEngine.resolve(
                a: FighterPlay(fighter: fighterA, card: cardA, side: .a),
                b: FighterPlay(fighter: fighterB, card: cardB, side: .b),
                state: &state,
                rng: &rng,
                readModifierA: readA,
                readModifierB: readB
            )
            roundExchanges.append(exLog)

            if let finish = exLog.finish {
                let rLog = RoundLog(
                    round: roundNumber,
                    exchanges: roundExchanges,
                    score: nil,
                    stateAfterCorner: state
                )
                return (rLog, (finish, exchangeIdx))
            }
        }

        let score = scoreRound(round: roundNumber, exchanges: roundExchanges, endState: state)
        if applyCornerAtEnd {
            applyCornerRecovery(state: &state, fighterA: fighterA, fighterB: fighterB)
        }
        let rLog = RoundLog(
            round: roundNumber,
            exchanges: roundExchanges,
            score: score,
            stateAfterCorner: state
        )
        return (rLog, nil)
    }

    /// Runs a complete match (default: 3 rounds × 8 exchanges) with deterministic `config.seed`.
    public static func runMatch(
        config: FightMatchConfig,
        aiA: some FighterAI = RandomAI(),
        aiB: some FighterAI = RandomAI()
    ) -> MatchResult {
        var rng = SeededRNG(seed: config.seed)
        var state = FightState()
        var roundLogs: [RoundLog] = []
        roundLogs.reserveCapacity(config.rounds)

        for r in 1...config.rounds {
            let isFinalRound = (r == config.rounds)
            let (rLog, stopped) = runRound(
                roundNumber: r,
                exchangesPerRound: config.exchangesPerRound,
                fighterA: config.fighterA,
                fighterB: config.fighterB,
                deckA: config.deckA,
                deckB: config.deckB,
                aiA: aiA,
                aiB: aiB,
                state: &state,
                rng: &rng,
                applyCornerAtEnd: !isFinalRound
            )
            roundLogs.append(rLog)

            if let stopped {
                let outcome = MatchOutcome.finish(
                    winner: stopped.finish.winner,
                    reason: stopped.finish.reason,
                    round: r,
                    exchangeInRound: stopped.exchangeIndex
                )
                return MatchResult(
                    config: config,
                    rounds: roundLogs,
                    outcome: outcome,
                    finalState: state
                )
            }
        }

        let totalA = roundLogs.compactMap(\.score?.pointsA).reduce(0, +)
        let totalB = roundLogs.compactMap(\.score?.pointsB).reduce(0, +)
        let outcome: MatchOutcome
        if totalA > totalB {
            outcome = .decision(winner: .a, scoreA: totalA, scoreB: totalB)
        } else if totalB > totalA {
            outcome = .decision(winner: .b, scoreA: totalA, scoreB: totalB)
        } else {
            outcome = .draw(scoreA: totalA, scoreB: totalB)
        }

        return MatchResult(
            config: config,
            rounds: roundLogs,
            outcome: outcome,
            finalState: state
        )
    }
}
