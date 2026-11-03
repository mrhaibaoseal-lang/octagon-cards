import Foundation

/// Single historical UFC bout record for chronological Elo and targeted attribute delta (P1-2).
public struct BoutStatRecord: Sendable, Codable, Hashable {
    public var boutDate: String
    public var isoDate: String
    public var headline: String
    public var opponentId: String
    public var opponentName: String
    public var result: String
    public var method: String
    public var round: Int
    public var time: String

    public init(
        boutDate: String,
        isoDate: String,
        headline: String,
        opponentId: String,
        opponentName: String,
        result: String,
        method: String,
        round: Int = 3,
        time: String = "5:00"
    ) {
        self.boutDate = boutDate
        self.isoDate = isoDate
        self.headline = headline
        self.opponentId = opponentId
        self.opponentName = opponentName
        self.result = result
        self.method = method
        self.round = round
        self.time = time
    }
}

/// Career statistical rates from ufcstats / UFC.com (P1-1 / P1-2).
public struct CareerRawStats: Sendable, Codable, Hashable {
    public var slpm: Double
    public var strAccPct: Double
    public var sapm: Double
    public var strDefPct: Double
    public var tdAvg: Double
    public var tdAccPct: Double
    public var tdDefPct: Double
    public var subAvg: Double
    public var kdAvg: Double
    public var avgFightTimeMinutes: Double
    public var standingStrPct: Double
    public var clinchStrPct: Double
    public var groundStrPct: Double
    public var koWinPct: Double
    public var decWinPct: Double
    public var subWinPct: Double

    public init(
        slpm: Double = 3.5,
        strAccPct: Double = 45.0,
        sapm: Double = 3.2,
        strDefPct: Double = 54.0,
        tdAvg: Double = 1.5,
        tdAccPct: Double = 40.0,
        tdDefPct: Double = 65.0,
        subAvg: Double = 0.5,
        kdAvg: Double = 0.35,
        avgFightTimeMinutes: Double = 10.5,
        standingStrPct: Double = 75.0,
        clinchStrPct: Double = 12.0,
        groundStrPct: Double = 13.0,
        koWinPct: Double = 35.0,
        decWinPct: Double = 45.0,
        subWinPct: Double = 20.0
    ) {
        self.slpm = slpm
        self.strAccPct = strAccPct
        self.sapm = sapm
        self.strDefPct = strDefPct
        self.tdAvg = tdAvg
        self.tdAccPct = tdAccPct
        self.tdDefPct = tdDefPct
        self.subAvg = subAvg
        self.kdAvg = kdAvg
        self.avgFightTimeMinutes = avgFightTimeMinutes
        self.standingStrPct = standingStrPct
        self.clinchStrPct = clinchStrPct
        self.groundStrPct = groundStrPct
        self.koWinPct = koWinPct
        self.decWinPct = decWinPct
        self.subWinPct = subWinPct
    }
}

/// Raw scraped fighter profile prior to Bayesian/Elo rating computation.
public struct RawFighterProfile: Sendable, Codable, Hashable {
    public var id: String
    public var name: String
    public var nickname: String?
    public var weightClass: String
    public var stance: Stance
    public var fightingStyle: String?
    public var age: Int
    public var heightCm: Int
    public var reachCm: Int
    public var wins: Int
    public var losses: Int
    public var draws: Int
    public var fullBodyImageUrl: String?
    public var headshotImageUrl: String?
    public var careerStats: CareerRawStats
    public var bouts: [BoutStatRecord]

    public init(
        id: String,
        name: String,
        nickname: String? = nil,
        weightClass: String = "Lightweight",
        stance: Stance = .orthodox,
        fightingStyle: String? = nil,
        age: Int = 29,
        heightCm: Int = 178,
        reachCm: Int = 180,
        wins: Int = 10,
        losses: Int = 2,
        draws: Int = 0,
        fullBodyImageUrl: String? = nil,
        headshotImageUrl: String? = nil,
        careerStats: CareerRawStats = CareerRawStats(),
        bouts: [BoutStatRecord] = []
    ) {
        self.id = id
        self.name = name
        self.nickname = nickname
        self.weightClass = weightClass
        self.stance = stance
        self.fightingStyle = fightingStyle
        self.age = age
        self.heightCm = heightCm
        self.reachCm = reachCm
        self.wins = wins
        self.losses = losses
        self.draws = draws
        self.fullBodyImageUrl = fullBodyImageUrl
        self.headshotImageUrl = headshotImageUrl
        self.careerStats = careerStats
        self.bouts = bouts
    }
}

/// Live buff/nerf delta generated from the fighter's most recent UFC bout (POWER_SYSTEM.md §1.2).
public struct LastFightDelta: Sendable, Codable, Hashable {
    public var boutDate: String
    public var opponentName: String
    public var result: String
    public var method: String
    public var round: Int
    public var eloBefore: Int
    public var eloAfter: Int
    public var eloDelta: Int
    public var attributeDeltas: [String: Int]
    public var summary: String

    public init(
        boutDate: String,
        opponentName: String,
        result: String,
        method: String,
        round: Int,
        eloBefore: Int,
        eloAfter: Int,
        eloDelta: Int,
        attributeDeltas: [String: Int],
        summary: String
    ) {
        self.boutDate = boutDate
        self.opponentName = opponentName
        self.result = result
        self.method = method
        self.round = round
        self.eloBefore = eloBefore
        self.eloAfter = eloAfter
        self.eloDelta = eloDelta
        self.attributeDeltas = attributeDeltas
        self.summary = summary
    }
}

/// Pure-Swift Rating Engine (P1-2, see docs/POWER_SYSTEM.md §1–2).
/// Implements Empirical Bayes shrinkage, chronological MMA Elo opponent-quality weighting,
/// targeted attribute buffs/nerfs by win/loss method, and automatic L2 Trait assignment.
public enum RatingEngine {
    public static let eliteGrapplerSlugs: Set<String> = [
        "islam-makhachev", "khamzat-chimaev", "merab-dvalishvili",
        "arman-tsarukyan", "belal-muhammad", "umar-nurmagomedov",
        "shavkat-rakhmonov", "charles-oliveira", "alexandre-pantoja",
        "jon-jones", "diego-lopes",
    ]

    public static let divisionPowerMod: [String: Double] = [
        "Flyweight": -4.0,
        "Bantamweight": -2.0,
        "Featherweight": 0.0,
        "Lightweight": 1.5,
        "Welterweight": 3.0,
        "Middleweight": 4.5,
        "Light Heavyweight": 6.5,
        "Heavyweight": 8.0,
    ]

    private static func clampInt(_ val: Double, lo: Int = 40, hi: Int = 99) -> Int {
        min(max(Int(val.rounded()), lo), hi)
    }

    /// Empirical Bayes shrinkage: `w = n / (n + k)`.
    public static func shrink(raw: Double, prior: Double, fights: Int, k: Int = 8) -> Double {
        let n = max(1, fights)
        let w = Double(n) / Double(n + k)
        return w * raw + (1.0 - w) * prior
    }

    /// Stage 1: Compute L1 Base Attributes (0...100) using Bayesian shrinkage toward UFC priors.
    public static func computeBaseAttributes(for profile: RawFighterProfile) -> FighterAttributes {
        let nFights = max(1, profile.wins + profile.losses + profile.draws)
        let cs = profile.careerStats
        let divMod = divisionPowerMod[profile.weightClass] ?? 1.0

        let slpm = shrink(raw: cs.slpm, prior: 3.65, fights: nFights)
        let strAcc = shrink(raw: cs.strAccPct, prior: 46.0, fights: nFights)
        let sapm = shrink(raw: cs.sapm, prior: 3.30, fights: nFights)
        let strDef = shrink(raw: cs.strDefPct, prior: 54.5, fights: nFights)
        let tdAvg = shrink(raw: cs.tdAvg, prior: 1.50, fights: nFights)
        let tdAcc = shrink(raw: cs.tdAccPct, prior: 41.0, fights: nFights)
        let tdDef = shrink(raw: cs.tdDefPct, prior: 65.0, fights: nFights)
        let subAvg = shrink(raw: cs.subAvg, prior: 0.55, fights: nFights)
        let kdAvg = shrink(raw: cs.kdAvg, prior: 0.38, fights: nFights)
        let koPct = shrink(raw: cs.koWinPct, prior: 35.0, fights: nFights)
        let subPct = shrink(raw: cs.subWinPct, prior: 20.0, fights: nFights)
        let decPct = shrink(raw: cs.decWinPct, prior: 45.0, fights: nFights)

        let koLosses = profile.bouts.filter { $0.result == "L" && $0.method == "KO/TKO" }.count
        let subLosses = profile.bouts.filter { $0.result == "L" && $0.method == "SUB" }.count

        let power = 48.0 + kdAvg * 22.0 + koPct * 0.30 + slpm * 1.4 + divMod
        let ageSpeedMod = -Double(max(0, profile.age - 32)) * 1.1
        let speed = 58.0 + slpm * 4.8 - divMod * 1.0 + ageSpeedMod
        let accuracy = 28.0 + strAcc * 0.96 + slpm * 1.1
        let strikingDef = 34.0 + strDef * 0.92 - sapm * 2.5

        let ageChinMod = -Double(max(0, profile.age - 34)) * 1.2
        let lowLossBonus = (profile.losses <= 2 && nFights >= 10) ? 2.0 : 0.0
        let chin = 86.0 - Double(koLosses) * 5.5 - max(0.0, sapm - 3.2) * 2.8 + lowLossBonus + ageChinMod

        let fiveRoundWins = profile.bouts.filter { $0.result == "W" && $0.round >= 4 }.count
        let cardio = 56.0 + cs.avgFightTimeMinutes * 1.20 + decPct * 0.14 + (slpm + tdAvg * 1.3) * 1.25 + Double(fiveRoundWins) * 2.0

        let takedown = 45.0 + tdAvg * 8.8 + tdAcc * 0.34
        let takedownDef = 28.0 + tdDef * 0.72
        let submission = 48.0 + subAvg * 17.5 + subPct * 0.44 + cs.groundStrPct * 0.20 - Double(subLosses) * 4.5

        let winRate = shrink(raw: Double(profile.wins) / Double(nFights), prior: 0.62, fights: nFights)
        let clinch = 50.0 + (cs.clinchStrPct + cs.groundStrPct) * 0.54 + tdAvg * 4.5 + winRate * 9.0

        return FighterAttributes(
            power: clampInt(power, lo: 50, hi: 96),
            speed: clampInt(speed, lo: 52, hi: 96),
            accuracy: clampInt(accuracy, lo: 52, hi: 96),
            strikingDefense: clampInt(strikingDef, lo: 50, hi: 95),
            chin: clampInt(chin, lo: 55, hi: 97),
            cardio: clampInt(cardio, lo: 55, hi: 97),
            takedown: clampInt(takedown, lo: 45, hi: 96),
            takedownDefense: clampInt(takedownDef, lo: 48, hi: 96),
            submission: clampInt(submission, lo: 45, hi: 97),
            clinch: clampInt(clinch, lo: 50, hi: 97)
        )
    }

    /// Stage 3: Automatically assign 2–4 L2 Trait tags from career & recent bout history.
    public static func assignTraits(
        profile: RawFighterProfile,
        attributes attrs: FighterAttributes,
        boutsChronological: [BoutStatRecord]
    ) -> [Trait] {
        var traits: [Trait] = []
        let recent3 = boutsChronological.suffix(3)
        let recentKOLosses = recent3.filter { $0.result == "L" && $0.method == "KO/TKO" }.count
        let totalKOLosses = boutsChronological.filter { $0.result == "L" && $0.method == "KO/TKO" }.count

        if recentKOLosses >= 2 || (totalKOLosses >= 3 && attrs.chin <= 76) {
            traits.append(.glassChin)
        } else if totalKOLosses == 0 && (profile.wins + profile.losses) >= 14 && attrs.chin >= 86 {
            traits.append(.ironChin)
        } else if attrs.chin >= 91 && recentKOLosses == 0 {
            traits.append(.ironChin)
        }

        if attrs.power >= 89 || (profile.careerStats.kdAvg >= 0.70 && profile.careerStats.koWinPct >= 50.0) {
            traits.append(.onePunch)
        }

        if attrs.submission >= 86 || profile.careerStats.subWinPct >= 38.0 || profile.careerStats.subAvg >= 1.2 {
            traits.append(.blackBeltBJJ)
        }

        if (attrs.takedown >= 84 && attrs.clinch >= 85) || profile.careerStats.tdAvg >= 3.0 {
            traits.append(.smother)
        }

        if attrs.cardio >= 90 || (profile.careerStats.avgFightTimeMinutes >= 13.0 && profile.careerStats.slpm >= 4.5) {
            traits.append(.gasTank)
        }

        let r1Finishes = boutsChronological.filter {
            $0.result == "W" && $0.round == 1 && ($0.method == "KO/TKO" || $0.method == "SUB")
        }.count
        if r1Finishes >= 2 || (profile.careerStats.avgFightTimeMinutes <= 7.8 && attrs.power >= 85) {
            traits.append(.fastStarter)
        }

        if attrs.accuracy >= 84 && attrs.strikingDefense >= 80 && profile.careerStats.slpm <= 4.6 {
            traits.append(.counterPuncher)
        }

        if profile.careerStats.clinchStrPct >= 17.0 || (attrs.clinch >= 86 && !traits.contains(.smother)) {
            traits.append(.cagePinner)
        }

        let styleLow = (profile.fightingStyle ?? "").lowercased()
        let unorthodoxIds: Set<String> = [
            "jiri-prochazka", "sean-omalley", "cory-sandhagen",
            "dricus-du-plessis", "israel-adesanya", "diego-lopes",
        ]
        if styleLow.contains("freestyle") || styleLow.contains("kickboxer")
            || (attrs.speed >= 86 && attrs.strikingDefense >= 82)
            || unorthodoxIds.contains(profile.id)
        {
            if !traits.contains(.unorthodox) {
                traits.append(.unorthodox)
            }
        }

        let fallbackOrder: [(Trait, Int)] = [
            (.onePunch, attrs.power),
            (.counterPuncher, attrs.accuracy + attrs.strikingDefense - 70),
            (.gasTank, attrs.cardio),
            (.smother, attrs.takedown),
            (.blackBeltBJJ, attrs.submission),
            (.cagePinner, attrs.clinch),
            (.ironChin, attrs.chin),
        ]
        for (trait, _) in fallbackOrder.sorted(by: { $0.1 > $1.1 }) {
            if traits.count >= 2 { break }
            if trait == .ironChin && traits.contains(.glassChin) { continue }
            if !traits.contains(trait) {
                traits.append(trait)
            }
        }
        return Array(traits.prefix(4))
    }

    /// Stage 2 & Full Pipeline: Replay bouts chronologically to apply opponent-quality Elo & targeted attribute deltas.
    public static func calculateRosterRatings(profiles: [RawFighterProfile]) -> [Fighter] {
        var baseMap: [String: FighterAttributes] = [:]
        var eloMap: [String: Double] = [:]

        for p in profiles {
            let base = computeBaseAttributes(for: p)
            baseMap[p.id] = base
            let nTotal = max(1, p.wins + p.losses + p.draws)
            let winRatio = Double(p.wins) / Double(nTotal)
            eloMap[p.id] = 1520.0 + (winRatio - 0.65) * 320.0 + Double(base.overallRating - 78) * 6.0
        }

        var resultFighters: [Fighter] = []

        for p in profiles {
            let base = baseMap[p.id] ?? FighterAttributes()
            var power = Double(base.power)
            var speed = Double(base.speed)
            var accuracy = Double(base.accuracy)
            var strikingDef = Double(base.strikingDefense)
            var chin = Double(base.chin)
            var cardio = Double(base.cardio)
            var takedown = Double(base.takedown)
            var takedownDef = Double(base.takedownDefense)
            var submission = Double(base.submission)
            var clinch = Double(base.clinch)

            let boutsChrono = p.bouts.sorted { $0.isoDate < $1.isoDate }
            let totalBouts = boutsChrono.count
            var currentElo = eloMap[p.id] ?? 1550.0
            var lastPatchSummary: String? = nil

            for (idx, bout) in boutsChrono.enumerated() {
                let recencyRank = totalBouts - 1 - idx
                let recencyW: Double
                switch recencyRank {
                case 0: recencyW = 1.00
                case 1: recencyW = 0.75
                case 2: recencyW = 0.55
                default: recencyW = 0.25
                }

                let oppElo = eloMap[bout.opponentId] ?? (bout.round == 5 ? 1660.0 : 1580.0)
                let expected = 1.0 / (1.0 + pow(10.0, (oppElo - currentElo) / 400.0))

                let actual: Double
                switch bout.result {
                case "W": actual = 1.0
                case "L": actual = 0.0
                default: actual = 0.5
                }

                let isFinish = (bout.method == "KO/TKO" || bout.method == "SUB")
                let finishMult = isFinish ? (bout.round <= 2 ? 1.35 : 1.25) : 1.0
                let kFactor = 34.0 * finishMult
                let eloBefore = Int(currentElo.rounded())
                let eloChange = Int((kFactor * (actual - expected)).rounded())
                currentElo += Double(eloChange)
                let eloAfter = Int(currentElo.rounded())

                let isGrappler = eliteGrapplerSlugs.contains(p.id)
                    || p.careerStats.tdAvg >= 2.2
                    || (p.careerStats.clinchStrPct + p.careerStats.groundStrPct) >= 32.0
                let oppIsGrappler = eliteGrapplerSlugs.contains(bout.opponentId)

                var deltaNotes: [String] = []
                func applyDelta(_ name: String, _ target: inout Double, _ amount: Double) {
                    target = min(max(target + amount, 42.0), 98.0)
                    let r = Int(amount.rounded())
                    if r != 0 {
                        deltaNotes.append("\(name) \(r > 0 ? "+" : "")\(r)")
                    }
                }

                if bout.result == "W" {
                    let qual = (0.65 + 0.85 * (1.0 - expected)) * recencyW
                    let oppChin = baseMap[bout.opponentId]?.chin ?? 78
                    let ironChinBonus = oppChin >= 86 ? 1.2 : 0.0
                    if bout.method == "KO/TKO" {
                        applyDelta("power", &power, 3.6 * qual + (bout.round <= 2 ? 1.0 : 0.0) + ironChinBonus)
                        applyDelta("accuracy", &accuracy, 2.0 * qual)
                    } else if bout.method == "SUB" {
                        applyDelta("submission", &submission, 3.8 * qual)
                        applyDelta("clinch", &clinch, 2.0 * qual)
                    } else {
                        if isGrappler {
                            applyDelta("takedown", &takedown, 2.2 * qual)
                            applyDelta("clinch", &clinch, 2.6 * qual)
                            applyDelta("cardio", &cardio, 2.0 * qual)
                        } else {
                            applyDelta("cardio", &cardio, 2.5 * qual)
                            applyDelta("speed", &speed, 1.8 * qual)
                            applyDelta("accuracy", &accuracy, 1.5 * qual)
                        }
                        if bout.round == 5 {
                            applyDelta("cardio", &cardio, 1.5 * recencyW)
                        }
                    }
                } else if bout.result == "L" {
                    let sev = (0.60 + 0.80 * expected) * recencyW
                    if bout.method == "KO/TKO" {
                        applyDelta("chin", &chin, -4.5 * sev)
                        applyDelta("strikingDefense", &strikingDef, -2.0 * sev)
                    } else if bout.method == "SUB" {
                        applyDelta("submission", &submission, -3.8 * sev)
                        applyDelta("takedownDefense", &takedownDef, -1.8 * sev)
                    } else {
                        if oppIsGrappler {
                            applyDelta("takedownDefense", &takedownDef, -2.4 * sev)
                            applyDelta("cardio", &cardio, -1.2 * sev)
                        } else {
                            applyDelta("strikingDefense", &strikingDef, -1.6 * sev)
                            applyDelta("cardio", &cardio, -1.2 * sev)
                        }
                    }
                }

                if idx == totalBouts - 1 {
                    let deltaStr = deltaNotes.isEmpty ? "屬性持平" : deltaNotes.joined(separator: ", ")
                    let sign = eloChange >= 0 ? "+" : ""
                    lastPatchSummary = "\(bout.result) vs \(bout.opponentName) (\(bout.method) R\(bout.round)): Elo \(eloBefore)→\(eloAfter) (\(sign)\(eloChange)) · \(deltaStr)"
                }
            }

            let finalAttrs = FighterAttributes(
                power: clampInt(power, lo: 45, hi: 98),
                speed: clampInt(speed, lo: 45, hi: 98),
                accuracy: clampInt(accuracy, lo: 45, hi: 98),
                strikingDefense: clampInt(strikingDef, lo: 45, hi: 97),
                chin: clampInt(chin, lo: 45, hi: 98),
                cardio: clampInt(cardio, lo: 45, hi: 98),
                takedown: clampInt(takedown, lo: 42, hi: 98),
                takedownDefense: clampInt(takedownDef, lo: 45, hi: 98),
                submission: clampInt(submission, lo: 42, hi: 98),
                clinch: clampInt(clinch, lo: 45, hi: 98)
            )
            let traits = assignTraits(profile: p, attributes: finalAttrs, boutsChronological: boutsChrono)

            resultFighters.append(
                Fighter(
                    id: p.id,
                    name: p.name,
                    nickname: p.nickname,
                    weightClass: p.weightClass,
                    record: "\(p.wins)-\(p.losses)-\(p.draws)",
                    stance: p.stance,
                    eloRating: Int(currentElo.rounded()),
                    fullBodyImageUrl: p.fullBodyImageUrl,
                    headshotImageUrl: p.headshotImageUrl,
                    lastFightPatchNote: lastPatchSummary,
                    attributes: finalAttrs,
                    traits: traits
                )
            )
        }

        return resultFighters.sorted {
            if $0.overallRating != $1.overallRating {
                return $0.overallRating > $1.overallRating
            }
            return ($0.eloRating ?? 1500) > ($1.eloRating ?? 1500)
        }
    }

    /// Decode `[Fighter]` from `data/fighters.json` payload.
    public static func loadFighters(from jsonData: Data) throws -> [Fighter] {
        try JSONDecoder().decode([Fighter].self, from: jsonData)
    }
}
