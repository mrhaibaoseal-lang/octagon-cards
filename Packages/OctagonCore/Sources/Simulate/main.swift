import Foundation
import FightEngine

/// Command-line balance & invariant stress simulator (docs/TASKS.md P2-6).
/// Usage: `swift run Simulate --games 10000 [--seed 1]`
@main
struct SimulateCLI {
    static func main() {
        var games = 10_000
        var seed: UInt64 = 2026_11_03

        let args = Array(CommandLine.arguments.dropFirst())
        var idx = 0
        while idx < args.count {
            switch args[idx] {
            case "--games", "-n":
                if idx + 1 < args.count, let parsed = Int(args[idx + 1]), parsed > 0 {
                    games = parsed
                    idx += 1
                }
            case "--seed", "-s":
                if idx + 1 < args.count, let parsed = UInt64(args[idx + 1]) {
                    seed = parsed
                    idx += 1
                }
            default:
                break
            }
            idx += 1
        }

        let randomReport = BalanceSimulator.run(
            games: games,
            baseSeed: seed,
            aiA: RandomAI(),
            aiB: RandomAI()
        )
        print(randomReport.formattedSummary(title: "OctagonCore Balance Simulator — RandomAI vs RandomAI (\(games) games)"))
        print("")

        let styleReport = BalanceSimulator.run(
            games: games,
            baseSeed: seed ^ 0x5555_5555_5555_5555,
            aiA: StyleAI(),
            aiB: StyleAI()
        )
        print(styleReport.formattedSummary(title: "OctagonCore Balance Simulator — StyleAI vs StyleAI (\(games) games)"))

        let totalViolations = randomReport.invariantViolations + styleReport.invariantViolations
        if totalViolations > 0 {
            fputs("ERROR: \(totalViolations) invariant violations detected!\n", stderr)
            exit(1)
        }
    }
}
