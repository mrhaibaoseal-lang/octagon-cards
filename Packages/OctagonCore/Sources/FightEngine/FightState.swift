/// Live fight state for the standing game (docs/STRIKING_AND_DECK.md §1, §4, §6).

/// Which corner a fighter is in. The state always holds exactly two.
public enum Side: String, Sendable, Codable, CaseIterable {
    case a
    case b

    public var opposite: Side { self == .a ? .b : .a }
}

/// Cage position of one fighter (§1).
public enum CagePosition: String, Sendable, Codable, CaseIterable {
    case center
    case againstCage
    case cornered
}

/// Three independent health pools (§4). Each is `0...max`; 0 triggers the zone's finish condition.
public struct BodyHealth: Sendable, Codable, Hashable {
    public static let max = 100.0

    public var head: Double
    public var body: Double
    public var legs: Double

    /// Values are clamped into `0...BodyHealth.max`.
    public init(head: Double = BodyHealth.max, body: Double = BodyHealth.max, legs: Double = BodyHealth.max) {
        self.head = Self.clamp(head)
        self.body = Self.clamp(body)
        self.legs = Self.clamp(legs)
    }

    public static let full = BodyHealth()

    private static func clamp(_ v: Double) -> Double { Swift.min(Swift.max(v, 0), max) }

    public subscript(target: HitTarget) -> Double {
        get {
            switch target {
            case .head: head
            case .body: body
            case .legs: legs
            }
        }
        set {
            let v = Self.clamp(newValue)
            switch target {
            case .head: head = v
            case .body: body = v
            case .legs: legs = v
            }
        }
    }
}

/// Everything that is tracked per fighter during a fight.
public struct FighterCondition: Sendable, Codable, Hashable {
    public static let maxStamina = 100.0
    public static let maxMomentum = 100.0

    public var health: BodyHealth
    public var stamina: Double
    public var momentum: Double
    public var cage: CagePosition
    /// Stunned: can only block / clinch / move (§4.1).
    public var isRocked: Bool

    public init(
        health: BodyHealth = .full,
        stamina: Double = FighterCondition.maxStamina,
        momentum: Double = 0,
        cage: CagePosition = .center,
        isRocked: Bool = false
    ) {
        self.health = health
        self.stamina = Swift.min(Swift.max(stamina, 0), Self.maxStamina)
        self.momentum = Swift.min(Swift.max(momentum, 0), Self.maxMomentum)
        self.cage = cage
        self.isRocked = isRocked
    }
}

public struct FightState: Sendable, Codable, Hashable {
    public var distance: Distance
    public var a: FighterCondition
    public var b: FighterCondition

    public init(
        distance: Distance = .long,
        a: FighterCondition = FighterCondition(),
        b: FighterCondition = FighterCondition()
    ) {
        self.distance = distance
        self.a = a
        self.b = b
    }

    public subscript(side: Side) -> FighterCondition {
        get { side == .a ? a : b }
        set {
            switch side {
            case .a: a = newValue
            case .b: b = newValue
            }
        }
    }
}
