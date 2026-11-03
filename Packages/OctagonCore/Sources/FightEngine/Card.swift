/// Card data model (see docs/STRIKING_AND_DECK.md §2–3).

/// The six card types (§2).
public enum CardType: String, Sendable, Codable, CaseIterable {
    case strike
    case block
    case evade
    case counter
    case feint
    case move
}

/// Range axis (§1). Ordered from far to close.
public enum Distance: Int, Sendable, Codable, CaseIterable, Comparable {
    case long = 0
    case mid = 1
    case close = 2

    public static func < (lhs: Distance, rhs: Distance) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Where a strike lands (§4 three health zones).
public enum HitTarget: String, Sendable, Codable, CaseIterable {
    case head
    case body
    case legs
}

/// Card tags (§3, POWER_SYSTEM §5.2).
public enum CardTag: String, Sendable, Codable, CaseIterable {
    case punch
    case kick
    case elbow
    case knee
    case wrestling
    case submission
}

public struct Card: Sendable, Codable, Hashable, Identifiable {
    /// Stat scale for `speed`, `power`, `accuracy`: 0...100.
    public static let statRange = 0...100

    public var id: String
    public var name: String
    public var type: CardType
    /// Distances where this card works at full effect (outside → odds penalty, see P2-2).
    public var distances: [Distance]
    /// Only meaningful for strikes / counters; `nil` for block, evade, feint, move.
    public var target: HitTarget?
    /// Who arrives first in simultaneous exchanges.
    public var speed: Int
    /// Base damage.
    public var power: Int
    /// Base hit chance.
    public var accuracy: Int
    /// Stamina spent when played.
    public var staminaCost: Int
    /// Deck-building budget cost.
    public var deckCost: Int
    public var tags: [CardTag]
    /// For `.move` cards: the target distance this movement seeks (`.close` = advance, `.long` = retreat, `.mid` = reset).
    public var preferredDistance: Distance?

    /// `speed` / `power` / `accuracy` are clamped into `0...100`; costs are floored at 0.
    public init(
        id: String,
        name: String,
        type: CardType,
        distances: [Distance],
        target: HitTarget? = nil,
        speed: Int,
        power: Int,
        accuracy: Int,
        staminaCost: Int,
        deckCost: Int,
        tags: [CardTag] = [],
        preferredDistance: Distance? = nil
    ) {
        func c(_ v: Int) -> Int { min(max(v, Self.statRange.lowerBound), Self.statRange.upperBound) }
        self.id = id
        self.name = name
        self.type = type
        self.distances = distances
        self.target = target
        self.speed = c(speed)
        self.power = c(power)
        self.accuracy = c(accuracy)
        self.staminaCost = max(staminaCost, 0)
        self.deckCost = max(deckCost, 0)
        self.tags = tags
        self.preferredDistance = preferredDistance
    }

    /// True if the card is at full effect at `distance`.
    public func isEffective(at distance: Distance) -> Bool { distances.contains(distance) }
}
