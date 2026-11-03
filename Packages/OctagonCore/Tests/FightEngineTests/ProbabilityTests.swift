import Testing
@testable import FightEngine

@Suite("Odds")
struct ProbabilityTests {
    @Test func clampsToBand() {
        #expect(Odds.clamp(-1) == 0.05)
        #expect(Odds.clamp(2) == 0.95)
        #expect(Odds.clamp(0.5) == 0.5)
    }

    @Test func neverCertain() {
        #expect(Odds.resolve(base: 0.9, modifiers: [0.3, 0.3]) == 0.95)
        #expect(Odds.resolve(base: 0.1, modifiers: [-0.3]) == 0.05)
    }

    @Test func modifiersAdd() {
        let p = Odds.resolve(base: 0.6, modifiers: [0.05, -0.1])
        #expect(abs(p - 0.55) < 1e-9)
    }
}
