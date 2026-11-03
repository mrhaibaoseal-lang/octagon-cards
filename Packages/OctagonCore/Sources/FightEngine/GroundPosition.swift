/// Ground positional hierarchy, state machine, and standing-to-ground takedown bridge
/// (see docs/GROUND_GAME_DESIGN.md §2 and docs/STRIKING_AND_DECK.md §8, docs/TASKS.md P3-1).

/// The 5 hierarchical ground positions from least dominant (1) to most dominant (5) for the top fighter.
public enum GroundPosition: Int, Sendable, Codable, CaseIterable, Comparable {
    /// 1. 全防守 (Full Guard) — Top 50 / Bottom 50; Bottom can threaten triangle, armbar, sweeps, upkick standup.
    case fullGuard = 1
    /// 2. 半防守 (Half Guard) — Top 65 / Bottom 35; Top can GnP or pass; Bottom can recover guard or underhook standup.
    case halfGuard = 2
    /// 3. 側向控制 (Side Control) — Top 80 / Bottom 20; Top can elbow, kimura, arm-triangle; Bottom must shrimp.
    case sideControl = 3
    /// 4. 騎乘位 (Full Mount) — Top 90 / Bottom 10; Heavy GnP TKO threat and armbar; Bottom must bridge to half guard.
    case fullMount = 4
    /// 5. 背後控制 (Back Control) — Top 95 / Bottom 05; Maximum RNC threat; Bottom must peel hands to full guard.
    case backControl = 5

    public static func < (lhs: GroundPosition, rhs: GroundPosition) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    public var displayName: String {
        switch self {
        case .fullGuard: "全防守 Full Guard"
        case .halfGuard: "半防守 Half Guard"
        case .sideControl: "側控 Side Control"
        case .fullMount: "騎乘 Full Mount"
        case .backControl: "背控 Back Control"
        }
    }

    /// Next position when the Top fighter succeeds with a positional pass/advance (`GROUND_GAME_DESIGN.md` §2).
    public var advanced: GroundPosition {
        switch self {
        case .fullGuard: .halfGuard
        case .halfGuard: .sideControl
        case .sideControl: .fullMount
        case .fullMount: .backControl
        case .backControl: .backControl
        }
    }

    /// Resulting position when the Bottom fighter recovers guard / shrimps / bridges / peels hands (`GROUND_GAME_DESIGN.md` §2).
    public var retreated: GroundPosition {
        switch self {
        case .backControl: .fullGuard
        case .fullMount: .halfGuard
        case .sideControl: .halfGuard
        case .halfGuard: .fullGuard
        case .fullGuard: .fullGuard
        }
    }

    /// True if the Bottom fighter can stand up directly to the feet from this position (Full Guard / Half Guard).
    public var canStandUpDirectly: Bool {
        self == .fullGuard || self == .halfGuard
    }
}

/// Active ground grappling state stored in `FightState.ground`.
public struct GroundState: Sendable, Codable, Hashable {
    public var topSide: Side
    public var position: GroundPosition
    /// Number of consecutive stalling/passive exchanges on the ground (at 3+, referee stands fighters up).
    public var stallCount: Int

    public var bottomSide: Side { topSide.opposite }

    public init(
        topSide: Side,
        position: GroundPosition = .fullGuard,
        stallCount: Int = 0
    ) {
        self.topSide = topSide
        self.position = position
        self.stallCount = max(stallCount, 0)
    }

    /// Top fighter passes/advances one step up the positional hierarchy.
    public mutating func advance() {
        position = position.advanced
        stallCount = 0
    }

    /// Bottom fighter executes a sweep: flips top/bottom roles and lands in `newPosition` (default `.sideControl`).
    public mutating func sweep(to newPosition: GroundPosition = .sideControl) {
        topSide = topSide.opposite
        position = newPosition
        stallCount = 0
    }

    /// Bottom fighter attempts to escape/stand up (`GROUND_GAME_DESIGN.md` §2):
    /// - From `.fullGuard` or `.halfGuard`: returns `true` (stood up to standing!).
    /// - From `.sideControl`, `.fullMount`, or `.backControl`: recovers to `.halfGuard` / `.fullGuard` and returns `false`.
    public mutating func escapeOrStandUp(forceStandUp: Bool = false) -> Bool {
        stallCount = 0
        if forceStandUp || position.canStandUpDirectly {
            return true
        }
        position = position.retreated
        return false
    }
}

// MARK: - Takedown Bridge (Standing -> Ground)

public enum TakedownEngine {
    /// Computes the `OddsBreakdown` for a standing takedown card (`my.card.isTakedown == true`)
    /// against `opp` play in `state` (see `STRIKING_AND_DECK.md` §8).
    public static func breakdown(
        my: FighterPlay,
        opp: FighterPlay,
        state: FightState,
        readModifier: Double = 0.0
    ) -> OddsBreakdown {
        let base: Double
        if opp.card.type == .block && opp.card.tags.contains(.wrestling) {
            // Dedicated Sprawl defense
            base = 0.30
        } else if opp.card.type == .counter {
            // Intercepting knee / guillotine counter
            base = 0.40
        } else if opp.card.type == .evade || opp.card.type == .move {
            base = 0.38
        } else {
            // Opponent threw a regular strike, feint, or high guard
            base = 0.58
        }

        let myAttr = my.fighter.attributes
        let oppAttr = opp.fighter.attributes
        let attrMod = (Double(myAttr.takedown + my.card.accuracy) / 2.0 - Double(oppAttr.takedownDefense)) * 0.003

        // Distance modifier: close range gets a bonus (+0.10) if effective, out-of-range gets standard penalty
        var distMod = Odds.distanceModifier(for: my.card, at: state.distance)
        if state.distance == .close && my.card.isEffective(at: .close) {
            distMod += 0.10
        }

        // Condition modifier: attacker stamina penalty + defender leg-damage bonus (+0.10 when legs < 50)
        let myCond = state[my.side]
        let oppCond = state[opp.side]
        var condMod = Odds.conditionModifier(condition: myCond, card: my.card)
        if oppCond.health.legs < 50.0 {
            condMod += 0.10
        }
        if oppCond.cage != .center {
            condMod += 0.08
        }

        let momMod = Odds.momentumModifier(myCondition: myCond, oppCondition: oppCond)

        var traitMod = 0.0
        if my.fighter.has(.smother) {
            traitMod += 0.06
        }
        if my.fighter.has(.cagePinner) && oppCond.cage != .center {
            traitMod += 0.06
        }
        if opp.fighter.has(.unorthodox) {
            traitMod -= 0.04
        }

        let clampedRead = min(max(readModifier, -0.10), 0.10)
        let finalOdds = Odds.resolve(
            base: base,
            modifiers: [attrMod, distMod, condMod, momMod, traitMod, clampedRead]
        )

        return OddsBreakdown(
            base: base,
            attributeModifier: attrMod,
            distanceModifier: distMod,
            conditionModifier: condMod,
            momentumModifier: momMod,
            traitModifier: traitMod,
            readModifier: clampedRead,
            finalOdds: finalOdds
        )
    }
}
