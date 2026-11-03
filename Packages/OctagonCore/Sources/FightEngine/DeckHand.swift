/// 20-card deck builder, validation rules, and 5-card hand draw/replenish with automatic ground flip
/// (see docs/STRIKING_AND_DECK.md §11, docs/GROUND_GAME_DESIGN.md §3, and docs/TASKS.md P4-3).

public enum DeckBuilder {
    public static let standardDeckSize = 20
    public static let maxCopiesPerCard = 3
    public static let minStrikeOrCounterCards = 6
    public static let minDefenseCards = 4
    public static let minMoveCards = 3

    /// Computes the deck-building point budget for a fighter (`STRIKING_AND_DECK.md` §11).
    public static func deckBudget(for fighter: Fighter) -> Int {
        let a = fighter.attributes
        return 40 + (a.cardio + a.speed + a.accuracy) / 45
    }

    /// Generates a legal 20-card factory standing + takedown bridge deck tailored to `fighter`'s style.
    public static func defaultStandingDeck(for fighter: Fighter) -> [Card] {
        let a = fighter.attributes
        if a.takedown >= 75 {
            // Wrestler 20-card deck (heavy takedowns + cage pressure + dirty boxing)
            return [
                // Takedowns (5)
                SampleData.doubleLeg,
                SampleData.singleLeg,
                SampleData.cageTrip,
                SampleData.highCrotchSlam,
                SampleData.catchKickTakedown,
                // Strikes & Counters (6)
                SampleData.jab,
                SampleData.cross,
                SampleData.overhand,
                SampleData.bodyHook,
                SampleData.dirtyBoxing,
                SampleData.clinchKnee,
                // Defense: Block & Evade (4)
                SampleData.sprawl,
                SampleData.guardUp,
                SampleData.checkShield,
                SampleData.weave,
                // Feints (2)
                SampleData.feintStep,
                SampleData.levelFeint,
                // Moves (3)
                SampleData.stepIn,
                SampleData.stepIn,
                SampleData.pushOff,
            ]
        } else if a.submission >= 80 || fighter.has(.blackBeltBJJ) {
            // BJJ Specialist 20-card deck (clinch trips, jump guillotine, unorthodox kicks & submissions)
            return [
                // Takedowns & Submission Counters (4)
                SampleData.singleLeg,
                SampleData.cageTrip,
                SampleData.catchKickTakedown,
                SampleData.jumpGuillotine,
                // Strikes & Counters (7)
                SampleData.jab,
                SampleData.frontKick,
                SampleData.calfKick,
                SampleData.sideKick,
                SampleData.cross,
                SampleData.closeElbow,
                SampleData.clinchKnee,
                // Defense: Block & Evade (4)
                SampleData.sprawl,
                SampleData.guardUp,
                SampleData.checkShield,
                SampleData.slip,
                // Feints (2)
                SampleData.feintStep,
                SampleData.levelFeint,
                // Moves (3)
                SampleData.stepIn,
                SampleData.stepBack,
                SampleData.pushOff,
            ]
        } else {
            // Striker 20-card deck (precision striking at all 3 ranges + sprawl & intercept knee)
            return [
                // Strikes & Counters (11)
                SampleData.jab,
                SampleData.calfKick,
                SampleData.lowKick,
                SampleData.headKick,
                SampleData.cross,
                SampleData.leadHook,
                SampleData.uppercut,
                SampleData.overhand,
                SampleData.bodyHook,
                SampleData.closeElbow,
                SampleData.counterHook,
                SampleData.interceptKnee,
                // Defense: Block & Evade (4)
                SampleData.sprawl,
                SampleData.guardUp,
                SampleData.checkShield,
                SampleData.slip,
                // Feints (1)
                SampleData.feintStep,
                // Moves (3)
                SampleData.stepIn,
                SampleData.stepBack,
                SampleData.pushOff,
            ]
        }
    }

    /// Validates a 20-card standing deck against `STRIKING_AND_DECK.md` §11 rules.
    /// Returns an empty array when valid, or human-readable violation strings.
    public static func validateDeck(_ cards: [Card], for fighter: Fighter? = nil) -> [String] {
        var violations: [String] = []
        if cards.count != standardDeckSize {
            violations.append("Deck size must be \(standardDeckSize), got \(cards.count)")
        }

        var countsById: [String: Int] = [:]
        var strikeCount = 0
        var defenseCount = 0
        var moveCount = 0
        var totalCost = 0

        for card in cards {
            countsById[card.id, default: 0] += 1
            totalCost += card.deckCost
            switch card.type {
            case .strike, .counter:
                strikeCount += 1
            case .block, .evade:
                defenseCount += 1
            case .move:
                moveCount += 1
            case .feint:
                break
            }
        }

        for (id, count) in countsById where count > maxCopiesPerCard {
            violations.append("Card '\(id)' appears \(count) times (max \(maxCopiesPerCard))")
        }
        if strikeCount < minStrikeOrCounterCards {
            violations.append("Deck needs at least \(minStrikeOrCounterCards) strike/counter cards, got \(strikeCount)")
        }
        if defenseCount < minDefenseCards {
            violations.append("Deck needs at least \(minDefenseCards) block/evade cards, got \(defenseCount)")
        }
        if moveCount < minMoveCards {
            violations.append("Deck needs at least \(minMoveCards) move cards, got \(moveCount)")
        }
        if let fighter {
            let budget = deckBudget(for: fighter)
            if totalCost > budget {
                violations.append("Deck cost \(totalCost) exceeds fighter budget \(budget)")
            }
        }
        return violations
    }
}

/// Manages a fighter's 20-card standing deck, 5-card standing hand, draw/discard piles,
/// and automatic 5-card ground hand flip when entering or transitioning on the ground (`P4-3`).
public struct HandManager: Sendable, Codable, Hashable {
    public static let handSize = 5

    public var side: Side
    public var standingDeck: [Card]
    public var drawPile: [Card]
    public var discardPile: [Card]
    public var standingHand: [Card]
    public var groundHand: [Card]
    public var isShowingGroundHand: Bool

    public init(
        side: Side,
        fighter: Fighter,
        standingDeck: [Card]? = nil,
        state: FightState = FightState(),
        rng: inout SeededRNG
    ) {
        self.side = side
        let baseDeck = standingDeck ?? DeckBuilder.defaultStandingDeck(for: fighter)
        self.standingDeck = baseDeck.isEmpty ? DeckBuilder.defaultStandingDeck(for: fighter) : baseDeck
        self.drawPile = []
        self.discardPile = []
        self.standingHand = []
        self.groundHand = []
        self.isShowingGroundHand = state.isGrounded

        self.drawPile = shuffled(self.standingDeck, rng: &rng)
        syncWithState(state: state, rng: &rng)
    }

    /// Returns the currently active 5-card hand (standing hand when on the feet, ground hand when on the mat).
    public var activeHand: [Card] {
        isShowingGroundHand ? groundHand : standingHand
    }

    /// Consumes one played card from the active hand and replenishes back to 5 cards for the updated `state`.
    public mutating func playCard(_ card: Card, updatedState: FightState, rng: inout SeededRNG) {
        if isShowingGroundHand {
            if let idx = groundHand.firstIndex(where: { $0.id == card.id }) {
                groundHand.remove(at: idx)
            }
        } else {
            if let idx = standingHand.firstIndex(where: { $0.id == card.id }) {
                let removed = standingHand.remove(at: idx)
                discardPile.append(removed)
            } else if !standingHand.isEmpty {
                let removed = standingHand.removeFirst()
                discardPile.append(removed)
            }
        }
        syncWithState(state: updatedState, rng: &rng)
    }

    /// Synchronizes hand state with `state`:
    /// - If `state.ground != nil`: flips `isShowingGroundHand = true` and builds a 5-card ground hand
    ///   of legal Top or Bottom cards for `side` at `ground.position` covering all 4 tactical intents.
    /// - If `state.ground == nil`: flips `isShowingGroundHand = false` and refills `standingHand` to 5 cards
    ///   (ensuring at least 1 legal defensive/move card if `state[side].isRocked` is true).
    public mutating func syncWithState(state: FightState, rng: inout SeededRNG) {
        refillStandingHand(isRocked: state[side].isRocked, rng: &rng)
        if let ground = state.ground {
            isShowingGroundHand = true
            let role = ground.role(for: side)
            groundHand = buildGroundHand(for: role, at: ground.position, rng: &rng)
        } else {
            isShowingGroundHand = false
            groundHand = []
        }
    }

    // MARK: - Private Helpers

    private mutating func refillStandingHand(isRocked: Bool, rng: inout SeededRNG) {
        while standingHand.count < Self.handSize {
            if drawPile.isEmpty {
                if discardPile.isEmpty {
                    drawPile = shuffled(standingDeck, rng: &rng)
                } else {
                    drawPile = shuffled(discardPile, rng: &rng)
                    discardPile.removeAll(keepingCapacity: true)
                }
            }
            guard !drawPile.isEmpty else { break }
            standingHand.append(drawPile.removeFirst())
        }

        // Guarantee at least one legal defensive/move card in hand when Rocked
        if isRocked {
            let hasDefensive = standingHand.contains {
                $0.type == .block || $0.type == .evade || $0.type == .move
            }
            if !hasDefensive {
                if let defIdx = drawPile.firstIndex(where: { $0.type == .block || $0.type == .evade || $0.type == .move }) {
                    let defCard = drawPile.remove(at: defIdx)
                    if !standingHand.isEmpty {
                        discardPile.append(standingHand.removeLast())
                    }
                    standingHand.append(defCard)
                } else {
                    if !standingHand.isEmpty {
                        discardPile.append(standingHand.removeLast())
                    }
                    standingHand.append(SampleData.guardUp)
                }
            }
        }
    }

    private func buildGroundHand(
        for role: GroundRole,
        at position: GroundPosition,
        rng: inout SeededRNG
    ) -> [Card] {
        let legalPool = SampleData.groundCards.filter { $0.isLegalOnGround(as: role, at: position) }
        guard !legalPool.isEmpty else { return Array(SampleData.groundCards.prefix(Self.handSize)) }

        var chosen: [Card] = []
        chosen.reserveCapacity(Self.handSize)

        // 1. Pick 1 card from each of the 4 tactical intents so the player always has full 4x4 read options
        switch role {
        case .top:
            for intent in TopIntent.allCases {
                let candidates = legalPool.filter { $0.topIntent == intent }
                if !candidates.isEmpty {
                    let pick = candidates[Int(rng.next() % UInt64(candidates.count))]
                    chosen.append(pick)
                }
            }
        case .bottom:
            for intent in BottomIntent.allCases {
                let candidates = legalPool.filter { $0.bottomIntent == intent }
                if !candidates.isEmpty {
                    let pick = candidates[Int(rng.next() % UInt64(candidates.count))]
                    chosen.append(pick)
                }
            }
        }

        // 2. Fill remaining slots up to 5 cards from the remaining legal pool
        let chosenIds = Set(chosen.map(\.id))
        var remaining = shuffled(legalPool.filter { !chosenIds.contains($0.id) }, rng: &rng)
        while chosen.count < Self.handSize {
            if !remaining.isEmpty {
                chosen.append(remaining.removeFirst())
            } else {
                let fallback = legalPool[Int(rng.next() % UInt64(legalPool.count))]
                chosen.append(fallback)
            }
        }
        return chosen
    }

    private func shuffled(_ cards: [Card], rng: inout SeededRNG) -> [Card] {
        var copy = cards
        guard copy.count > 1 else { return copy }
        for i in stride(from: copy.count - 1, through: 1, by: -1) {
            let j = Int(rng.next() % UInt64(i + 1))
            if i != j {
                copy.swapAt(i, j)
            }
        }
        return copy
    }
}
