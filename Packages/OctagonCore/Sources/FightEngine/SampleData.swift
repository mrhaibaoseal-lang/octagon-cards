/// Starter and full standing card catalog used by tests, the simulator (P2-6), and the app sandbox.
public enum SampleData {
    // MARK: - Original 10 Starter Cards (P2-1)

    public static let jab = Card(
        id: "jab", name: "刺拳", type: .strike, distances: [.long, .mid], target: .head,
        speed: 85, power: 25, accuracy: 80, staminaCost: 1, deckCost: 1, tags: [.punch])
    public static let cross = Card(
        id: "cross", name: "直拳", type: .strike, distances: [.mid], target: .head,
        speed: 65, power: 55, accuracy: 65, staminaCost: 2, deckCost: 2, tags: [.punch])
    public static let lowKick = Card(
        id: "low-kick", name: "低掃", type: .strike, distances: [.long, .mid], target: .legs,
        speed: 55, power: 50, accuracy: 70, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let headKick = Card(
        id: "head-kick", name: "高踢", type: .strike, distances: [.long, .mid], target: .head,
        speed: 35, power: 90, accuracy: 35, staminaCost: 4, deckCost: 3, tags: [.kick])
    public static let bodyHook = Card(
        id: "body-hook", name: "肝臟鉤拳", type: .strike, distances: [.mid, .close], target: .body,
        speed: 55, power: 60, accuracy: 60, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let guardUp = Card(
        id: "guard", name: "抱頭格擋", type: .block, distances: [.mid, .close],
        speed: 70, power: 0, accuracy: 70, staminaCost: 1, deckCost: 1)
    public static let slip = Card(
        id: "slip", name: "側閃", type: .evade, distances: [.long, .mid],
        speed: 75, power: 0, accuracy: 60, staminaCost: 2, deckCost: 2)
    public static let counterHook = Card(
        id: "counter-hook", name: "反擊鉤拳", type: .counter, distances: [.mid], target: .head,
        speed: 70, power: 60, accuracy: 55, staminaCost: 2, deckCost: 3, tags: [.punch])
    public static let feintStep = Card(
        id: "feint", name: "假動作", type: .feint, distances: [.long, .mid],
        speed: 80, power: 0, accuracy: 55, staminaCost: 1, deckCost: 1)
    public static let stepIn = Card(
        id: "step-in", name: "前進逼近", type: .move, distances: [.long, .mid],
        speed: 60, power: 0, accuracy: 60, staminaCost: 1, deckCost: 1, preferredDistance: .close)

    // MARK: - Expanded Standing Catalog (P4-1: +18 cards = 28 total standing cards across Long/Mid/Close)

    public static let frontKick = Card(
        id: "front-kick", name: "前踢", type: .strike, distances: [.long], target: .body,
        speed: 70, power: 46, accuracy: 72, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let calfKick = Card(
        id: "calf-kick", name: "小腿卡夫踢", type: .strike, distances: [.long], target: .legs,
        speed: 76, power: 42, accuracy: 78, staminaCost: 1, deckCost: 2, tags: [.kick])
    public static let sideKick = Card(
        id: "side-kick", name: "側踹", type: .strike, distances: [.long, .mid], target: .body,
        speed: 60, power: 52, accuracy: 68, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let supermanPunch = Card(
        id: "superman-punch", name: "超人拳", type: .strike, distances: [.long], target: .head,
        speed: 62, power: 68, accuracy: 52, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let bodyKick = Card(
        id: "body-kick", name: "中段掃踢", type: .strike, distances: [.long, .mid], target: .body,
        speed: 52, power: 64, accuracy: 62, staminaCost: 3, deckCost: 2, tags: [.kick])
    public static let leadHook = Card(
        id: "lead-hook", name: "左鉤拳", type: .strike, distances: [.mid, .close], target: .head,
        speed: 68, power: 60, accuracy: 64, staminaCost: 2, deckCost: 2, tags: [.punch])
    public static let uppercut = Card(
        id: "uppercut", name: "上鉤拳", type: .strike, distances: [.mid, .close], target: .head,
        speed: 58, power: 72, accuracy: 56, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let overhand = Card(
        id: "overhand", name: "過肩重拳", type: .strike, distances: [.mid], target: .head,
        speed: 45, power: 85, accuracy: 45, staminaCost: 3, deckCost: 3, tags: [.punch])
    public static let closeElbow = Card(
        id: "close-elbow", name: "貼身橫肘", type: .strike, distances: [.close], target: .head,
        speed: 66, power: 70, accuracy: 62, staminaCost: 2, deckCost: 2, tags: [.elbow])
    public static let clinchKnee = Card(
        id: "clinch-knee", name: "箍頸膝撞", type: .strike, distances: [.close], target: .body,
        speed: 58, power: 72, accuracy: 64, staminaCost: 3, deckCost: 2, tags: [.knee])
    public static let dirtyBoxing = Card(
        id: "dirty-boxing", name: "內圍髒拳", type: .strike, distances: [.close], target: .head,
        speed: 72, power: 52, accuracy: 70, staminaCost: 2, deckCost: 2, tags: [.punch])

    public static let checkShield = Card(
        id: "check-shield", name: "提脛擋踢", type: .block, distances: [.long, .mid],
        speed: 72, power: 0, accuracy: 72, staminaCost: 1, deckCost: 1)
    public static let weave = Card(
        id: "weave", name: "搖閃潛避", type: .evade, distances: [.mid, .close],
        speed: 70, power: 0, accuracy: 62, staminaCost: 2, deckCost: 2)
    public static let catchKickCounter = Card(
        id: "catch-kick-counter", name: "接踢反擊直拳", type: .counter, distances: [.long, .mid], target: .head,
        speed: 64, power: 64, accuracy: 52, staminaCost: 2, deckCost: 3, tags: [.punch])
    public static let shortCounterElbow = Card(
        id: "short-counter-elbow", name: "迎擊短肘", type: .counter, distances: [.close], target: .head,
        speed: 72, power: 62, accuracy: 56, staminaCost: 2, deckCost: 3, tags: [.elbow])
    public static let levelFeint = Card(
        id: "level-feint", name: "虛晃換位", type: .feint, distances: [.mid, .close],
        speed: 76, power: 0, accuracy: 58, staminaCost: 1, deckCost: 1)
    public static let stepBack = Card(
        id: "step-back", name: "滑步後撤", type: .move, distances: [.mid, .close],
        speed: 66, power: 0, accuracy: 64, staminaCost: 1, deckCost: 1, preferredDistance: .long)
    public static let pushOff = Card(
        id: "push-off", name: "推開脫離", type: .move, distances: [.close],
        speed: 64, power: 0, accuracy: 66, staminaCost: 1, deckCost: 1, preferredDistance: .mid)

    /// 10 starter example cards covering all six card types (P2-1 baseline).
    public static let cards: [Card] = [
        jab, cross, lowKick, headKick, bodyHook,
        guardUp, slip, counterHook, feintStep, stepIn,
    ]

    /// Complete 28-card standing catalog covering Long, Mid, and Close distances across all 6 card types (P4-1).
    public static let standingCards: [Card] = [
        // Strikes (16)
        jab, frontKick, calfKick, lowKick, sideKick, supermanPunch, headKick,
        cross, leadHook, uppercut, overhand, bodyHook, bodyKick,
        closeElbow, clinchKnee, dirtyBoxing,
        // Blocks (2)
        guardUp, checkShield,
        // Evades (2)
        slip, weave,
        // Counters (3)
        counterHook, catchKickCounter, shortCounterElbow,
        // Feints (2)
        feintStep, levelFeint,
        // Moves (3)
        stepIn, stepBack, pushOff,
    ]

    /// A well-rounded striker.
    public static let striker = Fighter(
        id: "sample-striker", name: "Sample Striker", stance: .orthodox,
        attributes: FighterAttributes(
            power: 78, speed: 72, accuracy: 75, strikingDefense: 65, chin: 70,
            cardio: 68, takedown: 35, takedownDefense: 60, submission: 30, clinch: 50),
        traits: [.onePunch, .counterPuncher])

    /// A wrestler with a weaker chin.
    public static let wrestler = Fighter(
        id: "sample-wrestler", name: "Sample Wrestler", stance: .southpaw,
        attributes: FighterAttributes(
            power: 55, speed: 58, accuracy: 55, strikingDefense: 50, chin: 55,
            cardio: 85, takedown: 88, takedownDefense: 80, submission: 60, clinch: 82),
        traits: [.gasTank, .smother, .cagePinner])
}
