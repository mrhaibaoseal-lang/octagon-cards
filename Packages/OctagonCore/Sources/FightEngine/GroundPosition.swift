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

/// Role on the ground (`Top` vs `Bottom`).
public enum GroundRole: String, Sendable, Codable, CaseIterable {
    case top
    case bottom
}

/// The 4 tactical intents available to the Top fighter on the ground (`GROUND_GAME_DESIGN.md` §3.1).
public enum TopIntent: String, Sendable, Codable, CaseIterable {
    /// 📍 推進位置 (Advance / Pass) — fullGuard -> halfGuard -> sideControl -> fullMount -> backControl.
    case advance
    /// 🔨 地面砸拳 (Ground & Pound) — deals damage & threatens TKO, but postures up (vulnerable to Sweep/Bottom Sub).
    case gnp
    /// 🔒 降伏攻擊 (Submission Attempt) — initiates or advances a 2-stage submission hold.
    case submission
    /// 🪨 重心壓制 (Posture / Smother / Ride) — drains opponent stamina, recovers own stamina, shuts down Escape.
    case smother
}

/// The 4 tactical intents available to the Bottom fighter on the ground (`GROUND_GAME_DESIGN.md` §3.2).
public enum BottomIntent: String, Sendable, Codable, CaseIterable {
    /// 🛡️ 防守過腿 / 鎖住距離 (Lockdown / Frame) — blocks positional advance and defends submissions.
    case frame
    /// 🏃 逃脫 / 起身 (Escape / Wall Walk) — retreats to better guard or stands up (punishes Top Submission).
    case escape
    /// 🔄 掃技翻轉 / 下位降伏 (Sweep / Bottom Sub) — punishes Top GnP by flipping top/bottom or locking Triangle/Armbar.
    case sweepOrSub
    /// 🐢 抱頭防守 (Shell Up) — absorbs GnP damage, but vulnerable to Advance and Submission.
    case shell
}

/// Stage in the 2-step submission chain minigame (`GROUND_GAME_DESIGN.md` §4).
public enum SubmissionStage: Int, Sendable, Codable, CaseIterable, Comparable {
    /// Stage 1: 抓把位 (Setup) — initial grip / wrist control / chin defense.
    case setup = 1
    /// Stage 2: 深鎖 (Locked In!) — deep choke or joint extension; one more win finishes by Tap Out.
    case lockedIn = 2

    public static func < (lhs: SubmissionStage, rhs: SubmissionStage) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Category of submission hold for sweat and stamina modifiers (`GROUND_GAME_DESIGN.md` §4).
public enum SubmissionCategory: String, Sendable, Codable, CaseIterable {
    /// Blood or air choke (RNC, Guillotine, Arm-Triangle, Triangle Choke) — bonus vs low-stamina opponent.
    case choke
    /// Joint lock (Kimura, Armbar) — slightly harder in sweaty late rounds (Round 3+).
    case jointLock
}

/// Active submission hold being contested on the ground (`GROUND_GAME_DESIGN.md` §4).
public struct SubmissionHold: Sendable, Codable, Hashable {
    public var cardId: String
    public var name: String
    public var category: SubmissionCategory
    public var attackerSide: Side
    public var stage: SubmissionStage

    public init(
        cardId: String,
        name: String,
        category: SubmissionCategory,
        attackerSide: Side,
        stage: SubmissionStage = .setup
    ) {
        self.cardId = cardId
        self.name = name
        self.category = category
        self.attackerSide = attackerSide
        self.stage = stage
    }
}

/// Active ground grappling state stored in `FightState.ground`.
public struct GroundState: Sendable, Codable, Hashable {
    public var topSide: Side
    public var position: GroundPosition
    /// Number of consecutive stalling/passive exchanges on the ground (at 3+, referee stands fighters up).
    public var stallCount: Int
    /// Non-nil when a 2-stage submission chain is currently in progress.
    public var activeSubmission: SubmissionHold?

    public var bottomSide: Side { topSide.opposite }

    public init(
        topSide: Side,
        position: GroundPosition = .fullGuard,
        stallCount: Int = 0,
        activeSubmission: SubmissionHold? = nil
    ) {
        self.topSide = topSide
        self.position = position
        self.stallCount = max(stallCount, 0)
        self.activeSubmission = activeSubmission
    }

    public func role(for side: Side) -> GroundRole {
        side == topSide ? .top : .bottom
    }

    /// Top fighter passes/advances one step up the positional hierarchy.
    public mutating func advance() {
        position = position.advanced
        stallCount = 0
        activeSubmission = nil
    }

    /// Bottom fighter executes a sweep: flips top/bottom roles and lands in `newPosition` (default `.sideControl`).
    public mutating func sweep(to newPosition: GroundPosition = .sideControl) {
        topSide = topSide.opposite
        position = newPosition
        stallCount = 0
        activeSubmission = nil
    }

    /// Bottom fighter attempts to escape/stand up (`GROUND_GAME_DESIGN.md` §2):
    /// - From `.fullGuard` or `.halfGuard`: returns `true` (stood up to standing!).
    /// - From `.sideControl`, `.fullMount`, or `.backControl`: recovers to `.halfGuard` / `.fullGuard` and returns `false`.
    public mutating func escapeOrStandUp(forceStandUp: Bool = false) -> Bool {
        stallCount = 0
        activeSubmission = nil
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
        if my.card.type == .counter {
            // Counter-takedown (e.g. Catch Kick Takedown): high odds vs kicks, medium vs punches, low vs passive
            if opp.card.type == .strike && opp.card.tags.contains(.kick) {
                base = 0.68
            } else if opp.card.type == .strike {
                base = 0.50
            } else {
                base = 0.18
            }
        } else if opp.card.type == .block && opp.card.tags.contains(.wrestling) {
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
        if state.isClinch {
            distMod += 0.06 + Double(myAttr.clinch - oppAttr.clinch) * 0.002
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
