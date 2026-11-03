import Foundation

/// Aggregated statistics for a single `CardType` across a batch of simulated matches.
public struct CardTypeStats: Sendable, Codable, Hashable {
    public var type: CardType
    public var played: Int = 0
    public var succeeded: Int = 0
    public var interrupted: Int = 0
    public var playedByMatchWinner: Int = 0
    public var totalDamage: Double = 0.0

    public init(type: CardType) {
        self.type = type
    }

    /// Share of all card plays (`0.0 ... 1.0`).
    public func usageRate(totalPlays: Int) -> Double {
        totalPlays > 0 ? Double(played) / Double(totalPlays) : 0.0
    }

    /// Rate at which the card achieved its effect without being interrupted (`0.0 ... 1.0`).
    public var successRate: Double {
        played > 0 ? Double(succeeded) / Double(played) : 0.0
    }

    /// Match win rate of the fighter who played this card type (`0.0 ... 1.0`).
    public var matchWinRateWhenPlayed: Double {
        played > 0 ? Double(playedByMatchWinner) / Double(played) : 0.0
    }
}

/// Complete telemetry report from running `N` simulated matches (see docs/TASKS.md P2-6 & P3-4).
public struct SimulationReport: Sendable, Codable, Hashable {
    public var games: Int
    public var baseSeed: UInt64
    public var fighterAName: String
    public var fighterBName: String
    public var totalRounds: Int = 0
    public var totalExchanges: Int = 0
    public var groundExchanges: Int = 0
    public var takedownsLanded: Int = 0
    public var sweepsExecuted: Int = 0
    public var refereeStandUps: Int = 0
    public var invariantViolations: Int = 0

    public var winsA: Int = 0
    public var winsB: Int = 0
    public var draws: Int = 0

    public var koCount: Int = 0
    public var tkoBodyCount: Int = 0
    public var tkoLegsCount: Int = 0
    public var submissionCount: Int = 0
    public var decisionCount: Int = 0
    public var rockedOccurrences: Int = 0

    public var cardTypeStats: [CardType: CardTypeStats]

    public init(
        games: Int,
        baseSeed: UInt64,
        fighterAName: String = SampleData.striker.name,
        fighterBName: String = SampleData.wrestler.name
    ) {
        self.games = games
        self.baseSeed = baseSeed
        self.fighterAName = fighterAName
        self.fighterBName = fighterBName
        var map: [CardType: CardTypeStats] = [:]
        for t in CardType.allCases {
            map[t] = CardTypeStats(type: t)
        }
        self.cardTypeStats = map
    }

    public var totalFinishes: Int {
        koCount + tkoBodyCount + tkoLegsCount + submissionCount
    }

    public var finishRate: Double {
        games > 0 ? Double(totalFinishes) / Double(games) : 0.0
    }

    public var koRate: Double {
        games > 0 ? Double(koCount) / Double(games) : 0.0
    }

    public var tkoBodyRate: Double {
        games > 0 ? Double(tkoBodyCount) / Double(games) : 0.0
    }

    public var tkoLegsRate: Double {
        games > 0 ? Double(tkoLegsCount) / Double(games) : 0.0
    }

    public var submissionRate: Double {
        games > 0 ? Double(submissionCount) / Double(games) : 0.0
    }

    public var decisionRate: Double {
        games > 0 ? Double(decisionCount + draws) / Double(games) : 0.0
    }

    /// Formats a human-readable Markdown/ASCII summary table for CLI output and `docs/HANDOFF.md`.
    public func formattedSummary(title: String) -> String {
        func pct(_ v: Double) -> String {
            String(format: "%5.1f%%", v * 100.0)
        }
        let totalPlays = totalExchanges * 2
        let avgExchanges = games > 0 ? Double(totalExchanges) / Double(games) : 0.0
        let avgRocked = games > 0 ? Double(rockedOccurrences) / Double(games) : 0.0
        let groundShare = totalExchanges > 0 ? Double(groundExchanges) / Double(totalExchanges) : 0.0

        var lines: [String] = []
        lines.append("=== \(title) ===")
        lines.append("Games: \(games) | Total Exchanges: \(totalExchanges) (avg \(String(format: "%.1f", avgExchanges))/game, Ground \(pct(groundShare))) | Invariant Violations: \(invariantViolations)")
        lines.append("Fighter Win Rate: Side A (\(fighterAName)) \(pct(Double(winsA) / Double(max(games, 1)))) (\(winsA)) | Side B (\(fighterBName)) \(pct(Double(winsB) / Double(max(games, 1)))) (\(winsB)) | Draw \(pct(Double(draws) / Double(max(games, 1)))) (\(draws))")
        lines.append("Outcomes: Total Finish \(pct(finishRate)) [Head KO \(pct(koRate)) (\(koCount)), Body TKO \(pct(tkoBodyRate)) (\(tkoBodyCount)), Legs TKO \(pct(tkoLegsRate)) (\(tkoLegsCount)), Submission \(pct(submissionRate)) (\(submissionCount))] | Decision \(pct(decisionRate)) (\(decisionCount + draws))")
        lines.append("Drama & Grappling: Rocked \(rockedOccurrences) (avg \(String(format: "%.2f", avgRocked))/game) | Takedowns \(takedownsLanded) | Sweeps \(sweepsExecuted) | Ref StandUps \(refereeStandUps)")
        lines.append("")
        lines.append("| CardType | Played | Usage % | Effect Success % | Match Win % (when played) | Avg Dmg/Play |")
        lines.append("|---|---:|---:|---:|---:|---:|")
        for t in CardType.allCases {
            let s = cardTypeStats[t] ?? CardTypeStats(type: t)
            let avgDmg = s.played > 0 ? s.totalDamage / Double(s.played) : 0.0
            lines.append(
                "| \(t.rawValue.padding(toLength: 7, withPad: " ", startingAt: 0)) "
                + "| \(String(format: "%6d", s.played)) "
                + "| \(pct(s.usageRate(totalPlays: totalPlays))) "
                + "| \(pct(s.successRate)) "
                + "| \(pct(s.matchWinRateWhenPlayed)) "
                + "| \(String(format: "%6.2f", avgDmg)) |"
            )
        }
        return lines.joined(separator: "\n")
    }
}

public enum BalanceSimulator {
    /// Runs `games` full 3-round matches, checking `validateInvariants()` on every single exchange.
    public static func run(
        games: Int,
        baseSeed: UInt64 = 1,
        fighterA: Fighter = SampleData.striker,
        fighterB: Fighter = SampleData.wrestler,
        deckA: [Card] = SampleData.allCards,
        deckB: [Card] = SampleData.allCards,
        aiA: some FighterAI = RandomAI(),
        aiB: some FighterAI = RandomAI()
    ) -> SimulationReport {
        var report = SimulationReport(
            games: games,
            baseSeed: baseSeed,
            fighterAName: fighterA.name,
            fighterBName: fighterB.name
        )
        guard games > 0 else { return report }

        for i in 0..<games {
            let seed = baseSeed &+ UInt64(i) &* 0x9E37_79B9_7F4A_7C15
            let config = FightMatchConfig(
                seed: seed,
                fighterA: fighterA,
                fighterB: fighterB,
                deckA: deckA,
                deckB: deckB
            )
            let result = FightMatchEngine.runMatch(config: config, aiA: aiA, aiB: aiB)

            if !result.finalState.isValid {
                report.invariantViolations += 1
            }

            let matchWinner = result.outcome.winner
            switch result.outcome {
            case let .finish(winner, reason, _, _):
                if winner == .a { report.winsA += 1 } else { report.winsB += 1 }
                switch reason {
                case .ko: report.koCount += 1
                case .tkoBody: report.tkoBodyCount += 1
                case .tkoLegs: report.tkoLegsCount += 1
                case .submission: report.submissionCount += 1
                }
            case let .decision(winner, _, _):
                if winner == .a { report.winsA += 1 } else { report.winsB += 1 }
                report.decisionCount += 1
            case .draw:
                report.draws += 1
            }

            report.totalRounds += result.rounds.count
            for roundLog in result.rounds {
                if !roundLog.stateAfterCorner.isValid {
                    report.invariantViolations += 1
                }
                for ex in roundLog.exchanges {
                    report.totalExchanges += 1
                    if ex.stateBefore.isGrounded {
                        report.groundExchanges += 1
                    }
                    if !ex.stateAfter.isValid {
                        report.invariantViolations += 1
                    }
                    if ex.a.inflictedRocked { report.rockedOccurrences += 1 }
                    if ex.b.inflictedRocked { report.rockedOccurrences += 1 }
                    if ex.a.takedownLanded != nil { report.takedownsLanded += 1 }
                    if ex.b.takedownLanded != nil { report.takedownsLanded += 1 }
                    if ex.a.sweptToPosition != nil { report.sweepsExecuted += 1 }
                    if ex.b.sweptToPosition != nil { report.sweepsExecuted += 1 }
                    if ex.refereeStandUp { report.refereeStandUps += 1 }

                    recordSide(ex.a, matchWinner: matchWinner, into: &report.cardTypeStats)
                    recordSide(ex.b, matchWinner: matchWinner, into: &report.cardTypeStats)
                }
            }
        }

        return report
    }

    private static func recordSide(
        _ sideLog: ExchangeSideLog,
        matchWinner: Side?,
        into table: inout [CardType: CardTypeStats]
    ) {
        let type = sideLog.card.type
        var stats = table[type] ?? CardTypeStats(type: type)
        stats.played += 1
        if sideLog.wasInterrupted {
            stats.interrupted += 1
        } else if sideLog.succeeded {
            stats.succeeded += 1
        }
        if matchWinner == sideLog.side {
            stats.playedByMatchWinner += 1
        }
        stats.totalDamage += sideLog.damageDealt
        table[type] = stats
    }
}
