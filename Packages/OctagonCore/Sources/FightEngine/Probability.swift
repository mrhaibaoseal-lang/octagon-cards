/// Probability helpers shared by all exchange resolution (see docs/STRIKING_AND_DECK.md §2.1).
/// Rule: no outcome is ever certain, final odds are always clamped to 5%...95%.
public enum Odds {
    public static let minimum = 0.05
    public static let maximum = 0.95

    /// Clamp a raw probability into the allowed band.
    public static func clamp(_ value: Double) -> Double {
        min(max(value, minimum), maximum)
    }

    /// Base probability plus a list of additive modifiers, clamped to 5%...95%.
    public static func resolve(base: Double, modifiers: [Double] = []) -> Double {
        clamp(modifiers.reduce(base, +))
    }
}
