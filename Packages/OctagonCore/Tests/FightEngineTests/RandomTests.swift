import Foundation
import Testing
@testable import FightEngine

@Suite("SeededRNG")
struct RandomTests {
    @Test func sameSeedProducesIdenticalSequence() {
        var rng1 = SeededRNG(seed: 0xDEAD_BEEF_CAFE_BABE)
        var rng2 = SeededRNG(seed: 0xDEAD_BEEF_CAFE_BABE)

        for _ in 0..<1_000 {
            #expect(rng1.next() == rng2.next())
            #expect(rng1.nextUnit() == rng2.nextUnit())
        }
        #expect(rng1 == rng2)
    }

    @Test func differentSeedsProduceDifferentSequences() {
        var rng1 = SeededRNG(seed: 1)
        var rng2 = SeededRNG(seed: 2)
        let seq1 = (0..<16).map { _ in rng1.next() }
        let seq2 = (0..<16).map { _ in rng2.next() }
        #expect(seq1 != seq2)
    }

    @Test func unitValuesStayInHalfOpenZeroToOne() {
        var rng = SeededRNG(seed: 42)
        for _ in 0..<2_000 {
            let u = rng.nextUnit()
            #expect(u >= 0.0 && u < 1.0)
        }
    }

    @Test func rollRespectsClampedOddsAndReproducibility() {
        var rngA = SeededRNG(seed: 2026)
        var rngB = SeededRNG(seed: 2026)

        let outcomesA = (0..<500).map { _ in rngA.roll(probability: 0.60) }
        let outcomesB = (0..<500).map { _ in rngB.roll(probability: 0.60) }
        #expect(outcomesA == outcomesB)

        // Empirical frequency over 2,000 rolls at 60% should stay reasonably close to 0.60.
        var rngStats = SeededRNG(seed: 99)
        var hits = 0
        let total = 2_000
        for _ in 0..<total {
            if rngStats.roll(probability: 0.60) {
                hits += 1
            }
        }
        let rate = Double(hits) / Double(total)
        #expect(rate > 0.54 && rate < 0.66)

        // Even 0% or 100% inputs are clamped to 5%...95%, so neither is ever impossible/certain.
        var rngLow = SeededRNG(seed: 7)
        var rngHigh = SeededRNG(seed: 7)
        let lowHits = (0..<2_000).filter { _ in rngLow.roll(probability: 0.0) }.count
        let highHits = (0..<2_000).filter { _ in rngHigh.roll(probability: 1.0) }.count
        #expect(lowHits > 0 && lowHits < 250)
        #expect(highHits > 1_750 && highHits < 2_000)
    }

    @Test func codablePreservesMidStreamState() throws {
        var rng = SeededRNG(seed: 123_456)
        _ = (0..<25).map { _ in rng.next() }

        let data = try JSONEncoder().encode(rng)
        var restored = try JSONDecoder().decode(SeededRNG.self, from: data)

        for _ in 0..<100 {
            #expect(rng.next() == restored.next())
        }
    }
}
