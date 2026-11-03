/// Fighter data model (see docs/POWER_SYSTEM.md §1–2).
/// Pure value types: `Sendable` + `Codable`, no UI framework imports.

/// The 10 core attributes (L1 data base), each on a 0...100 scale.
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

    /// Display-only overall rating (combat strictly uses the 10 individual L1 attributes; see POWER_SYSTEM.md §1).
    public var overallRating: Int {
        let vals = allValues
        let sortedDesc = vals.sorted(by: >)
        let top5Sum = sortedDesc.prefix(5).reduce(0, +)
        let allSum = vals.reduce(0, +)
        let weighted = (Double(top5Sum) / 5.0) * 0.65 + (Double(allSum) / 10.0) * 0.35
        return min(max(Int(weighted.rounded()), 50), 99)
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

    public var displayName: String {
        switch self {
        case .ironChin: "🧱鐵下巴"
        case .fastStarter: "💨開局型"
        case .gasTank: "🫁鐵肺"
        case .blackBeltBJJ: "🕸️柔術黑帶"
        case .smother: "🐻壓制怪"
        case .onePunch: "🥊一擊必殺"
        case .unorthodox: "🌀詭譎怪招"
        case .counterPuncher: "🎯反擊大師"
        case .cagePinner: "🧗壓籠專家"
        case .glassChin: "🩹玻璃下巴"
        }
    }
}

/// Orthodox / southpaw (docs/POWER_SYSTEM.md §4.2).
public enum Stance: String, Sendable, Codable, CaseIterable {
    case orthodox
    case southpaw
}

public struct Fighter: Sendable, Codable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var nickname: String?
    public var weightClass: String?
    public var record: String?
    public var stance: Stance
    public var eloRating: Int?
    public var fullBodyImageUrl: String?
    public var headshotImageUrl: String?
    public var lastFightPatchNote: String?
    public var attributes: FighterAttributes
    /// 2–4 traits per fighter by design (not enforced here; data pipeline decides).
    public var traits: [Trait]

    public init(
        id: String,
        name: String,
        nickname: String? = nil,
        weightClass: String? = nil,
        record: String? = nil,
        stance: Stance = .orthodox,
        eloRating: Int? = nil,
        fullBodyImageUrl: String? = nil,
        headshotImageUrl: String? = nil,
        lastFightPatchNote: String? = nil,
        attributes: FighterAttributes = FighterAttributes(),
        traits: [Trait] = []
    ) {
        self.id = id
        self.name = name
        self.nickname = nickname
        self.weightClass = weightClass
        self.record = record
        self.stance = stance
        self.eloRating = eloRating
        self.fullBodyImageUrl = fullBodyImageUrl
        self.headshotImageUrl = headshotImageUrl
        self.lastFightPatchNote = lastFightPatchNote
        self.attributes = attributes
        self.traits = traits
    }

    public var overallRating: Int {
        attributes.overallRating
    }

    public func has(_ trait: Trait) -> Bool { traits.contains(trait) }
}
