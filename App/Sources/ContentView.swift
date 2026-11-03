import SpriteKit
import SwiftUI
import UIKit
import FightEngine

struct ContentView: View {
    @State private var scene = LungeDemoScene(size: CGSize(width: 390, height: 165))
    @State private var seed: UInt64 = UInt64.random(in: 1...999_999)
    @State private var rng = SeededRNG(seed: 2026)
    @State private var state = FightState()
    @State private var currentRound: Int = 1
    @State private var currentExchange: Int = 1
    @State private var roundHistory: [ExchangeLog] = []
    @State private var completedRounds: [RoundLog] = []
    @State private var replayExchanges: [FightReplayExchange] = []
    @State private var matchOutcome: MatchOutcome? = nil
    @State private var showDebugDrawer: Bool = true
    @State private var filterEffectiveOnly: Bool = false
    @State private var copiedToast: Bool = false

    private let fighterA = SampleData.striker
    private let fighterB = SampleData.wrestler
    private let deck = SampleData.standingCards
    private let ai = StyleAI()
    private let totalRounds = 3
    private let exchangesPerRound = 8

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                headerBar
                scoreboardStrip
                SpriteView(scene: scene, options: [.ignoresSiblingOrder])
                    .frame(height: 165)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                fightersHUD

                if let outcome = matchOutcome {
                    outcomeBanner(outcome)
                } else {
                    cardSelectionSection
                }

                if showDebugDrawer {
                    debugDrawerSection
                }
            }
            .padding(12)
        }
        .background(Color(red: 0.05, green: 0.06, blue: 0.09).ignoresSafeArea())
        .onAppear {
            startNewMatch(withSeed: seed)
        }
    }

    // MARK: - Header & Scoreboard

    private var headerBar: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("OCTAGON CARDS · P2 沙盒")
                    .font(.system(.subheadline, design: .monospaced, weight: .heavy))
                Text("R\(currentRound)/\(totalRounds) · 交手 \(currentExchange)/\(exchangesPerRound) · \(distanceLabel(state.distance))")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(showDebugDrawer ? "隱藏算式" : "🔍 算式") {
                showDebugDrawer.toggle()
            }
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .buttonStyle(.bordered)

            Button(copiedToast ? "✓ 已複製" : "📋 重現碼") {
                copyReplayBundle()
            }
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .buttonStyle(.bordered)

            Button("🔄 重開") {
                startNewMatch(withSeed: UInt64.random(in: 1...999_999))
            }
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .buttonStyle(.borderedProminent)
        }
    }

    private var scoreboardStrip: some View {
        HStack(spacing: 8) {
            Text("Seed: #\(seed)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            ForEach(completedRounds, id: \.round) { rLog in
                if let sc = rLog.score {
                    Text("R\(sc.round): \(sc.pointsA)-\(sc.pointsB)")
                        .font(.system(.caption2, design: .monospaced, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.white.opacity(0.1))
                        .clipShape(Capsule())
                }
            }
        }
    }

    // MARK: - Fighter Status HUD

    private var fightersHUD: some View {
        HStack(spacing: 10) {
            fighterCard(title: "🟢 玩家: \(fighterA.name)", cond: state.a, tint: .green)
            fighterCard(title: "🔴 AI: \(fighterB.name)", cond: state.b, tint: .red)
        }
    }

    private func fighterCard(title: String, cond: FighterCondition, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                    .font(.system(.caption, design: .monospaced, weight: .bold))
                    .lineLimit(1)
                Spacer()
                if cond.isRocked {
                    Text("💥 ROCKED")
                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.orange)
                        .foregroundStyle(.black)
                        .clipShape(Capsule())
                }
            }
            statRow(label: "🧠 頭", value: cond.health.head, color: .red)
            statRow(label: "🫁 身", value: cond.health.body, color: .orange)
            statRow(label: "🦵 腿", value: cond.health.legs, color: .yellow)
            statRow(label: "⚡ 體", value: cond.stamina, color: .cyan)
            statRow(label: "🔥 勢", value: cond.momentum, color: .purple)
        }
        .padding(8)
        .background(tint.opacity(0.10))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(cond.isRocked ? Color.orange : tint.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func statRow(label: String, value: Double, color: Color) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 11, design: .monospaced))
                .frame(width: 34, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.white.opacity(0.12))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(color)
                        .frame(width: max(0, geo.size.width * CGFloat(value / 100.0)))
                }
            }
            .frame(height: 6)
            Text("\(Int(value.rounded()))")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .frame(width: 26, alignment: .trailing)
        }
    }

    // MARK: - Card Selection

    private var cardSelectionSection: some View {
        let legalIds = Set(FightMatchEngine.legalCards(from: deck, isRocked: state.a.isRocked).map(\.id))
        let displayedCards = filterEffectiveOnly
            ? deck.filter { $0.isEffective(at: state.distance) }
            : deck

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                if state.a.isRocked {
                    Text("⚠️ 被打暈 (Rocked)！僅能選 格擋/閃避/移動")
                        .font(.system(.caption, design: .monospaced, weight: .bold))
                        .foregroundStyle(.orange)
                } else {
                    Text("站立牌庫（\(displayedCards.count)/\(deck.count) 張）：")
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(filterEffectiveOnly ? "顯示全部 (28)" : "只看適用距離") {
                    filterEffectiveOnly.toggle()
                }
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .buttonStyle(.bordered)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(displayedCards) { card in
                    let isLegal = legalIds.contains(card.id)
                    let inRange = card.isEffective(at: state.distance)
                    Button {
                        playTurn(playerCard: card)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(card.name)
                                    .font(.system(.callout, design: .monospaced, weight: .bold))
                                Spacer()
                                Text(typeBadge(card.type))
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Color.white.opacity(0.15))
                                    .clipShape(Capsule())
                            }
                            HStack(spacing: 6) {
                                Text("距:\(distancesText(card.distances))")
                                    .foregroundStyle(inRange ? Color.green : Color.orange)
                                if let t = card.target {
                                    Text("標:\(targetText(t))")
                                }
                                Spacer()
                                Text("⚡-\(card.staminaCost)")
                            }
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(isLegal ? Color.white.opacity(0.08) : Color.white.opacity(0.02))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(inRange && isLegal ? Color.green.opacity(0.45) : Color.white.opacity(0.15), lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .disabled(!isLegal)
                    .opacity(isLegal ? 1.0 : 0.35)
                }
            }
        }
    }

    // MARK: - Match Outcome Banner

    private func outcomeBanner(_ outcome: MatchOutcome) -> some View {
        VStack(spacing: 8) {
            Text(outcomeHeadline(outcome))
                .font(.system(.title3, design: .monospaced, weight: .heavy))
            Text(outcomeSubtitle(outcome))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
            Button("🔥 再打一場（新 Seed）") {
                startNewMatch(withSeed: UInt64.random(in: 1...999_999))
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(Color.blue.opacity(0.18))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.blue.opacity(0.5), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Debug Formula Drawer

    private var debugDrawerSection: some View {
        let violations = state.validateInvariants()
        let allLogs = completedRounds.flatMap(\.exchanges) + roundHistory

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("🔍 即時算式戰報 (ExchangeLog)")
                    .font(.system(.caption, design: .monospaced, weight: .bold))
                Spacer()
                Text(violations.isEmpty ? "✅ 自檢通過 (0 違規)" : "❌ 違規: \(violations.count)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(violations.isEmpty ? Color.green : Color.red)
            }

            if let latest = allLogs.last {
                VStack(alignment: .leading, spacing: 4) {
                    Text("最新交手 · 先手: \(latest.firstSide == .a ? "🟢 玩家 A" : "🔴 AI B") · 交手後距離: \(distanceLabel(latest.stateAfter.distance))")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                    sideFormulaView(label: "🟢 玩家 A", log: latest.a)
                    sideFormulaView(label: "🔴 AI B", log: latest.b)
                    if let fin = latest.finish {
                        Text("🏁 終結觸發: \(fin.winner == .a ? "玩家 A" : "AI B") 以 \(finishReasonText(fin.reason)) 獲勝")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.yellow)
                    }
                }
                .padding(8)
                .background(Color.black.opacity(0.35))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                Text("尚未出牌——點選上方任一張卡牌開始第 1 次交手，這裡會即時顯示完整機率算式與 RNG 擲骰點數。")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func sideFormulaView(label: String, log: ExchangeSideLog) -> some View {
        let o = log.odds
        let status: String
        if log.wasInterrupted {
            status = "⚡ 被打斷"
        } else if log.succeeded {
            status = "✓ 成功"
        } else {
            status = "✗ 失敗"
        }
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(label) 出【\(log.card.name)】 → \(status) | 傷害: \(String(format: "%.1f", log.damageDealt))\(log.inflictedRocked ? " 💥打暈對手!" : "")")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
            Text(
                String(
                    format: "算式: 基%.0f%% 屬%+.0f%% 距%+.0f%% 體%+.0f%% 勢%+.0f%% 特%+.0f%% 讀%+.0f%% = 最終 %.1f%% | 擲骰 %.3f",
                    o.base * 100,
                    o.attributeModifier * 100,
                    o.distanceModifier * 100,
                    o.conditionModifier * 100,
                    o.momentumModifier * 100,
                    o.traitModifier * 100,
                    o.readModifier * 100,
                    o.finalOdds * 100,
                    log.roll
                )
            )
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Turn Logic

    private func startNewMatch(withSeed newSeed: UInt64) {
        seed = newSeed
        rng = SeededRNG(seed: newSeed)
        state = FightState()
        currentRound = 1
        currentExchange = 1
        roundHistory = []
        completedRounds = []
        replayExchanges = []
        matchOutcome = nil
        copiedToast = false
        scene.resetPositions(distance: .long)
    }

    private func playTurn(playerCard: Card) {
        guard matchOutcome == nil else { return }

        let aiCard = ai.chooseCard(
            fighter: fighterB,
            side: .b,
            availableCards: deck,
            state: state,
            history: roundHistory,
            rng: &rng
        )
        let readA = FightMatchEngine.computeReadModifier(for: .a, history: roundHistory)
        let readB = FightMatchEngine.computeReadModifier(for: .b, history: roundHistory)

        let exLog = ExchangeEngine.resolve(
            a: FighterPlay(fighter: fighterA, card: playerCard, side: .a),
            b: FighterPlay(fighter: fighterB, card: aiCard, side: .b),
            state: &state,
            rng: &rng,
            readModifierA: readA,
            readModifierB: readB
        )
        roundHistory.append(exLog)
        replayExchanges.append(
            FightReplayExchange(
                round: currentRound,
                exchange: currentExchange,
                cardIdA: playerCard.id,
                cardIdB: aiCard.id,
                oddsA: exLog.a.odds.finalOdds,
                oddsB: exLog.b.odds.finalOdds,
                rollA: exLog.a.roll,
                rollB: exLog.b.roll,
                damageByA: exLog.a.damageDealt,
                damageByB: exLog.b.damageDealt
            )
        )
        scene.playExchange(log: exLog)

        if let fin = exLog.finish {
            let rLog = RoundLog(
                round: currentRound,
                exchanges: roundHistory,
                score: nil,
                stateAfterCorner: state
            )
            completedRounds.append(rLog)
            matchOutcome = .finish(
                winner: fin.winner,
                reason: fin.reason,
                round: currentRound,
                exchangeInRound: currentExchange
            )
            return
        }

        if currentExchange < exchangesPerRound {
            currentExchange += 1
        } else {
            // End of round: score the round and either advance or conclude by decision
            let score = FightMatchEngine.scoreRound(
                round: currentRound,
                exchanges: roundHistory,
                endState: state
            )
            if currentRound < totalRounds {
                FightMatchEngine.applyCornerRecovery(
                    state: &state,
                    fighterA: fighterA,
                    fighterB: fighterB
                )
                let rLog = RoundLog(
                    round: currentRound,
                    exchanges: roundHistory,
                    score: score,
                    stateAfterCorner: state
                )
                completedRounds.append(rLog)
                roundHistory = []
                currentRound += 1
                currentExchange = 1
                scene.resetPositions(distance: state.distance)
            } else {
                let rLog = RoundLog(
                    round: currentRound,
                    exchanges: roundHistory,
                    score: score,
                    stateAfterCorner: state
                )
                completedRounds.append(rLog)
                let totalA = completedRounds.compactMap(\.score?.pointsA).reduce(0, +)
                let totalB = completedRounds.compactMap(\.score?.pointsB).reduce(0, +)
                if totalA > totalB {
                    matchOutcome = .decision(winner: .a, scoreA: totalA, scoreB: totalB)
                } else if totalB > totalA {
                    matchOutcome = .decision(winner: .b, scoreA: totalA, scoreB: totalB)
                } else {
                    matchOutcome = .draw(scoreA: totalA, scoreB: totalB)
                }
            }
        }
    }

    private func copyReplayBundle() {
        let bundle = FightReplayBundle(
            seed: seed,
            fighterAId: fighterA.id,
            fighterBId: fighterB.id,
            exchanges: replayExchanges,
            currentState: state,
            invariantViolations: state.validateInvariants()
        )
        if let data = try? JSONEncoder().encode(bundle),
           let json = String(data: data, encoding: .utf8) {
            UIPasteboard.general.string = json
            copiedToast = true
        }
    }

    // MARK: - Formatting Helpers

    private func distanceLabel(_ d: Distance) -> String {
        switch d {
        case .long: "遠距離 Long"
        case .mid: "中距離 Mid"
        case .close: "近距離 Close"
        }
    }

    private func distancesText(_ ds: [Distance]) -> String {
        ds.map {
            switch $0 {
            case .long: "遠"
            case .mid: "中"
            case .close: "近"
            }
        }.joined(separator: "/")
    }

    private func targetText(_ t: HitTarget) -> String {
        switch t {
        case .head: "頭"
        case .body: "身"
        case .legs: "腿"
        }
    }

    private func typeBadge(_ t: CardType) -> String {
        switch t {
        case .strike: "🗡️進攻"
        case .block: "🛡️格擋"
        case .evade: "💨閃避"
        case .counter: "↩️反擊"
        case .feint: "🎭佯攻"
        case .move: "🏃移動"
        }
    }

    private func finishReasonText(_ r: FinishReason) -> String {
        switch r {
        case .ko: "頭部 KO"
        case .tkoBody: "肝擊/身體 TKO"
        case .tkoLegs: "低掃/腿部 TKO"
        case .submission: "降伏 Tap Out (Submission)"
        }
    }

    private func outcomeHeadline(_ outcome: MatchOutcome) -> String {
        switch outcome {
        case let .finish(winner, reason, _, _):
            return winner == .a
                ? "🏆 玩家獲勝！（\(finishReasonText(reason))）"
                : "💀 AI 獲勝！（\(finishReasonText(reason))）"
        case let .decision(winner, scoreA, scoreB):
            return winner == .a
                ? "🏆 玩家判定獲勝！（\(scoreA)-\(scoreB)）"
                : "💀 AI 判定獲勝！（\(scoreB)-\(scoreA)）"
        case let .draw(scoreA, scoreB):
            return "🤝 雙方平手（\(scoreA)-\(scoreB)）"
        }
    }

    private func outcomeSubtitle(_ outcome: MatchOutcome) -> String {
        switch outcome {
        case let .finish(_, _, round, exchange):
            return "第 \(round) 回合 · 第 \(exchange) 次交手終結 | Seed #\(seed)"
        case .decision, .draw:
            let roundsText = completedRounds.compactMap { r -> String? in
                guard let s = r.score else { return nil }
                return "R\(s.round)(\(s.pointsA)-\(s.pointsB))"
            }.joined(separator: " · ")
            return "\(roundsText) | Seed #\(seed)"
        }
    }
}

#Preview { ContentView() }
