import FightEngine

/// Preset pairings offered on the pre-fight screen.
enum SandboxMatchup: Int, CaseIterable, Identifiable {
    case topuriaVsMakhachev = 0
    case oliveiraVsMakhachev = 1
    case pereiraVsChimaev = 2
    case aspinallVsJones = 3
    case omalleyVsMerab = 4

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .topuriaVsMakhachev: "🥊Topuria vs 🤼Makhachev"
        case .oliveiraVsMakhachev: "🥋Oliveira vs 🤼Makhachev"
        case .pereiraVsChimaev: "🗿Pereira vs 🐺Chimaev"
        case .aspinallVsJones: "👑Aspinall vs 🐐Jones"
        case .omalleyVsMerab: "⚡O'Malley vs 🫁Merab"
        }
    }

    var playerFighter: Fighter {
        switch self {
        case .topuriaVsMakhachev: RealUFCRoster.fighter(id: "ilia-topuria") ?? SampleData.striker
        case .oliveiraVsMakhachev: RealUFCRoster.fighter(id: "charles-oliveira") ?? SampleData.bjjFighter
        case .pereiraVsChimaev: RealUFCRoster.fighter(id: "alex-pereira") ?? SampleData.striker
        case .aspinallVsJones: RealUFCRoster.fighter(id: "tom-aspinall") ?? SampleData.striker
        case .omalleyVsMerab: RealUFCRoster.fighter(id: "sean-omalley") ?? SampleData.striker
        }
    }

    var aiFighter: Fighter {
        switch self {
        case .topuriaVsMakhachev: RealUFCRoster.fighter(id: "islam-makhachev") ?? SampleData.wrestler
        case .oliveiraVsMakhachev: RealUFCRoster.fighter(id: "islam-makhachev") ?? SampleData.wrestler
        case .pereiraVsChimaev: RealUFCRoster.fighter(id: "khamzat-chimaev") ?? SampleData.wrestler
        case .aspinallVsJones: RealUFCRoster.fighter(id: "jon-jones") ?? SampleData.wrestler
        case .omalleyVsMerab: RealUFCRoster.fighter(id: "merab-dvalishvili") ?? SampleData.wrestler
        }
    }
}
