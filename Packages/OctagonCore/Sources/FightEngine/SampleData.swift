/// Starter content used by tests, the simulator (P2-6) and early prototypes.
/// Numbers are first-pass values, not final balance.
public enum SampleData {
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
        speed: 60, power: 0, accuracy: 60, staminaCost: 1, deckCost: 1)

    /// 10 example cards covering all six card types.
    public static let cards: [Card] = [
        jab, cross, lowKick, headKick, bodyHook,
        guardUp, slip, counterHook, feintStep, stepIn,
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
