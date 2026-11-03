/// Fighter data model (see docs/POWER_SYSTEM.md §1–2).
/// Pure value types: `Sendable` + `Codable`, no UI framework imports.

/// The 10 core attributes (L1 data base), each on a 0...100 scale.
/// NOTE: the docs say "10 core attributes" without listing them; this list is derived from the
/// stats mentioned across docs (Cardio, Accuracy, Str.Def, TD, TD Defense, Sub Avg, Chin, ...).
/// Recorded in docs/HANDOFF.md for `[規劃]` to confirm.
public struct FighterAttributes: Sendable, Codable, Hashable {
    public static let range = 0...100

    /// 打擊威力
    public var power: Int
    /// 速度（同時出手時誰先到）
    public var speed: Int
    /// 精準（基礎命中）
    public var accuracy: Int
    /// 打擊防禦 Str.Def
    public var strikingDefense: Int
    /// 下巴 / 抗打
    public var chin: Int
    /// 體能 Cardio
    public var cardio: Int
    /// 摔技 TD
    public var takedown: Int
    /// 防摔 TD Defense
    public var takedownDefense: Int
    /// 降伏 / 鎖技 Sub
    public var submission: Int
    /// 纏抱 / 籠邊控制 Clinch
    public var clinch: Int

    /// Values are clamped into `0...100`.
    public init(
        power: Int = 50,
        speed: Int = 50,
        accuracy: Int = 50,
        strikingDefense: Int = 50,
        chin: Int = 50,
        cardio: Int = 50,
        takedown: Int = 50,
        takedownDefense: Int = 50,
        submission: Int = 50,
        clinch: Int = 50
    ) {
        func c(_ v: Int) -> Int { min(max(v, Self.range.lowerBound), Self.range.upperBound) }
        self.power = c(power)
        self.speed = c(speed)
        self.accuracy = c(accuracy)
        self.strikingDefense = c(strikingDefense)
        self.chin = c(chin)
        self.cardio = c(cardio)
        self.takedown = c(takedown)
        self.takedownDefense = c(takedownDefense)
        self.submission = c(submission)
        self.clinch = c(clinch)
    }

    /// All 10 values in declaration order (handy for tests and OVR display).
    public var allValues: [Int] {
        [power, speed, accuracy, strikingDefense, chin, cardio, takedown, takedownDefense, submission, clinch]
    }
}

/// L2 traits (docs/POWER_SYSTEM.md §2). Raw values are stable identifiers for JSON data.
public enum Trait: String, Sendable, Codable, CaseIterable {
    case ironChin
    case fastStarter
    case gasTank
    case blackBeltBJJ
    case smother
    case onePunch
    case unorthodox
    case counterPuncher
    case cagePinner
    case glassChin
}

/// Orthodox / southpaw (docs/POWER_SYSTEM.md §4.2).
public enum Stance: String, Sendable, Codable, CaseIterable {
    case orthodox
    case southpaw
}

public struct Fighter: Sendable, Codable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var stance: Stance
    public var attributes: FighterAttributes
    /// 2–4 traits per fighter by design (not enforced here; data pipeline decides).
    public var traits: [Trait]

    public init(
        id: String,
        name: String,
        stance: Stance = .orthodox,
        attributes: FighterAttributes = FighterAttributes(),
        traits: [Trait] = []
    ) {
        self.id = id
        self.name = name
        self.stance = stance
        self.attributes = attributes
        self.traits = traits
    }

    public func has(_ trait: Trait) -> Bool { traits.contains(trait) }
}
