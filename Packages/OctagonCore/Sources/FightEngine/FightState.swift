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
    /// Non-nil when the fight is on the ground (`docs/GROUND_GAME_DESIGN.md` §2).
    public var ground: GroundState?
    /// Current round number (1-indexed; used for round sweat/grip modifiers in `GROUND_GAME_DESIGN.md` §4).
    public var round: Int

    public var isGrounded: Bool { ground != nil }

    public init(
        distance: Distance = .long,
        a: FighterCondition = FighterCondition(),
        b: FighterCondition = FighterCondition(),
        ground: GroundState? = nil,
        round: Int = 1
    ) {
        self.distance = distance
        self.a = a
        self.b = b
        self.ground = ground
        self.round = Swift.max(round, 1)
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

    /// Verifies that all numerical state fields are finite and within their legal bounds (0...100).
    /// Returns an empty array when valid, or a list of human-readable violation descriptions.
    public func validateInvariants() -> [String] {
        var violations: [String] = []
        for side in Side.allCases {
            let cond = self[side]
            let prefix = "Side.\(side.rawValue)"
            for target in HitTarget.allCases {
                let hp = cond.health[target]
                if hp.isNaN || hp.isInfinite || hp < 0.0 || hp > BodyHealth.max {
                    violations.append("\(prefix).health.\(target.rawValue) out of range: \(hp)")
                }
            }
            if cond.stamina.isNaN || cond.stamina.isInfinite || cond.stamina < 0.0 || cond.stamina > FighterCondition.maxStamina {
                violations.append("\(prefix).stamina out of range: \(cond.stamina)")
            }
            if cond.momentum.isNaN || cond.momentum.isInfinite || cond.momentum < 0.0 || cond.momentum > FighterCondition.maxMomentum {
                violations.append("\(prefix).momentum out of range: \(cond.momentum)")
            }
        }
        if round < 1 {
            violations.append("round out of range: \(round)")
        }
        if let g = ground, g.stallCount < 0 {
            violations.append("ground.stallCount out of range: \(g.stallCount)")
        }
        return violations
    }

    public var isValid: Bool {
        validateInvariants().isEmpty
    }
}
