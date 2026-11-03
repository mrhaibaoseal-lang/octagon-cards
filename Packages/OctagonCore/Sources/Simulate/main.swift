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
        print(styleReport.formattedSummary(title: "OctagonCore MMA Simulator — StyleAI: Striker vs Wrestler (\(games) games)"))
        print("")

        let triangleGames = max(games / 3, 1_000)
        let wrestlerVsBJJ = BalanceSimulator.run(
            games: triangleGames,
            baseSeed: seed ^ 0xAAAA_AAAA_AAAA_AAAA,
            fighterA: SampleData.wrestler,
            fighterB: SampleData.bjjFighter,
            aiA: StyleAI(),
            aiB: StyleAI()
        )
        print(wrestlerVsBJJ.formattedSummary(title: "OctagonCore MMA Simulator — StyleAI: Wrestler vs BJJ Specialist (\(triangleGames) games)"))
        print("")

        let bjjVsStriker = BalanceSimulator.run(
            games: triangleGames,
            baseSeed: seed ^ 0x3333_3333_3333_3333,
            fighterA: SampleData.bjjFighter,
            fighterB: SampleData.striker,
            aiA: StyleAI(),
            aiB: StyleAI()
        )
        print(bjjVsStriker.formattedSummary(title: "OctagonCore MMA Simulator — StyleAI: BJJ Specialist vs Striker (\(triangleGames) games)"))

        let totalViolations = randomReport.invariantViolations
            + styleReport.invariantViolations
            + wrestlerVsBJJ.invariantViolations
            + bjjVsStriker.invariantViolations
        if totalViolations > 0 {
            fputs("ERROR: \(totalViolations) invariant violations detected!\n", stderr)
            exit(1)
        }
    }
}
