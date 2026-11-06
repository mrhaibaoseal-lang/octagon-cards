import FightEngine

/// Pure formatting helpers shared by the pre-fight, battle and debug views.
/// Text is unchanged from the original `ContentView`; only the location moved.
enum BattleText {
    static func shortPositionName(_ pos: GroundPosition) -> String {
        switch pos {
        case .fullGuard: "全防守"
        case .halfGuard: "半防守"
        case .sideControl: "側控"
        case .fullMount: "騎乘"
        case .backControl: "背控"
        }
    }

    static func distanceLabel(_ d: Distance) -> String {
        switch d {
        case .long: "遠距離 Long"
        case .mid: "中距離 Mid"
        case .close: "近距離 Close"
        }
    }

    static func distancesText(_ ds: [Distance]) -> String {
        ds.map {
            switch $0 {
            case .long: "遠"
            case .mid: "中"
            case .close: "近"
            }
        }.joined(separator: "/")
    }

    static func targetText(_ t: HitTarget) -> String {
        switch t {
        case .head: "頭"
        case .body: "身"
        case .legs: "腿"
        }
    }

    /// Phase summary for a live fight state (ground / clinch / standing distance).
    static func phaseSummary(_ state: FightState) -> String {
        if let g = state.ground {
            return "地面·\(shortPositionName(g.position))"
        }
        if state.isClinch {
            return "🤼 籠邊纏抱 Clinch"
        }
        return distanceLabel(state.distance)
    }

    static func stateAfterDescription(_ log: ExchangeLog) -> String {
        if let g = log.stateAfter.ground {
            let top = g.topSide == .a ? "玩家上位" : "AI上位"
            return "地面 \(shortPositionName(g.position)) (\(top))"
        }
        if log.stateAfter.isClinch {
            return "🤼 籠邊纏抱 Clinch"
        }
        return distanceLabel(log.stateAfter.distance)
    }

    static func cardBadge(_ card: Card) -> String {
        if let top = card.topIntent {
            switch top {
            case .advance: return "📍過腿"
            case .gnp: return "🔨砸拳"
            case .submission: return "🔒降伏"
            case .smother: return "🪨重壓"
            }
        }
        if let bot = card.bottomIntent {
            switch bot {
            case .frame: return "🛡️防過腿"
            case .escape: return "🏃逃脫"
            case .sweepOrSub: return card.tags.contains(.submission) ? "🔒下位鎖" : "🔄掃技"
            case .shell: return "🐢抱頭"
            }
        }
        if card.isTakedown {
            return "🤼抱摔"
        }
        switch card.type {
        case .strike: return "🗡️進攻"
        case .block: return "🛡️格擋"
        case .evade: return "💨閃避"
        case .counter: return "↩️反擊"
        case .feint: return "🎭佯攻"
        case .move: return "🏃移動"
        }
    }

    static func groundCardSubtitle(_ card: Card) -> String {
        if let top = card.topIntent {
            switch top {
            case .advance: return "推進下一階位置"
            case .gnp: return "威力:\(card.power) 命中:\(card.accuracy)%"
            case .submission: return card.submissionCategory == .choke ? "絞技 (2階段)" : "關節技 (2階段)"
            case .smother: return "封印起身+吸乾體力"
            }
        }
        if let bot = card.bottomIntent {
            switch bot {
            case .frame: return "阻擋過腿與重壓"
            case .escape: return "退位恢復/扶籠起身"
            case .sweepOrSub: return card.tags.contains(.submission) ? "抓砸拳鎖入階段1" : "抓砸拳翻轉上下位"
            case .shell: return "吸收地面砸拳傷害"
            }
        }
        return "地面戰術卡"
    }

    static func finishReasonText(_ r: FinishReason) -> String {
        switch r {
        case .ko: "頭部 KO"
        case .tkoBody: "肝擊/身體 TKO"
        case .tkoLegs: "低掃/腿部 TKO"
        case .tkoDoctor: "醫務暫停 TKO (Doctor Stoppage)"
        case .submission: "降伏 Tap Out (Submission)"
        }
    }

    static func outcomeHeadline(_ outcome: MatchOutcome, decisionType: DecisionType?) -> String {
        switch outcome {
        case let .finish(winner, reason, _, _):
            return winner == .a
                ? "🏆 玩家獲勝！（\(finishReasonText(reason))）"
                : "💀 AI 獲勝！（\(finishReasonText(reason))）"
        case let .decision(winner, scoreA, scoreB):
            let typeLabel = decisionType?.displayName ?? "判定"
            return winner == .a
                ? "🏆 玩家獲勝！\(typeLabel)（\(scoreA)-\(scoreB)）"
                : "💀 AI 獲勝！\(typeLabel)（\(scoreB)-\(scoreA)）"
        case let .draw(scoreA, scoreB):
            return "🤝 雙方平手（\(scoreA)-\(scoreB)）"
        }
    }

    static func outcomeSubtitle(_ outcome: MatchOutcome, judgeScorecards: [JudgeScorecard], seed: UInt64) -> String {
        switch outcome {
        case let .finish(_, _, round, exchange):
            return "第 \(round) 回合 · 第 \(exchange) 次交手終結 | Seed #\(seed)"
        case .decision, .draw:
            let judgesText = judgeScorecards.map { c in
                let shortBias: String = switch c.bias {
                case .striking: "J1(站立)"
                case .grappling: "J2(摔柔)"
                case .balanced: "J3(均衡)"
                }
                return "\(shortBias) \(c.pointsA)-\(c.pointsB)"
            }.joined(separator: " · ")
            return "\(judgesText) | Seed #\(seed)"
        }
    }
}
