/// Deterministic, injectable pseudo-random number generator (SplitMix64) for reproducible
/// exchanges, AI decisions, and balance simulations (see docs/TASKS.md P2-3).
public struct SeededRNG: RandomNumberGenerator, Sendable, Codable, Hashable {
    public private(set) var state: UInt64

    public init(seed: UInt64) {
        self.state = seed
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9e3779b97f4a7c15
        var z = state
        z = (z ^ (z >> 30)) &* 0xbf58476d1ce4e5b9
        z = (z ^ (z >> 27)) &* 0x94d049bb133111eb
        return z ^ (z >> 31)
    }

    /// Uniform `Double` in `0.0 ..< 1.0` using the top 53 bits of `next()`.
    public mutating func nextUnit() -> Double {
        Double(next() >> 11) * 0x1.0p-53
    }

    /// Rolls against `probability` after clamping to `5%...95%` via `Odds.clamp`.
    public mutating func roll(probability: Double) -> Bool {
        nextUnit() < Odds.clamp(probability)
    }
}
