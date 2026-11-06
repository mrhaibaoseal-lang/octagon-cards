import SpriteKit
import SwiftUI
import UIKit
import FightEngine

/// Battle page. The page itself never scrolls: the cage takes whatever height is left, and the
/// ground-info zone and hand zone have fixed heights so cards don't move when the ground banner appears.
struct BattleView: View {
    let session: BattleSession
    let onExit: () -> Void

    @State private var showDebugDrawer: Bool = false
    @State private var showRecap: Bool = false

    private let infoZoneHeight: CGFloat = 96
    private let handZoneHeight: CGFloat = 206

    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height
            VStack(spacing: 8) {
                topBar
                Group {
                    if isLandscape {
                        landscapeBody
                    } else {
                        portraitBody
                    }
                }
                .overlay {
                    // While an exchange plays, tapping anywhere on the battle area skips to its end.
                    if session.isPlaying {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture { session.skipPlayback() }
                    }
                }
            }
            .padding(10)
        }
        .sheet(isPresented: $showDebugDrawer) {
            DebugDrawerView(session: session)
                .presentationDetents([.medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .sheet(isPresented: $showRecap) {
            // No background interaction: the hand stays untouchable while the recap is open.
            BattleRecapView(session: session)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Layouts

    private var portraitBody: some View {
        VStack(spacing: 8) {
            cage
            fightersHUD
            // While an exchange plays the cage takes the freed space and the cards are shown inside it.
            if !session.isPlaying {
                infoZone.frame(height: infoZoneHeight)
                    .transition(.opacity)
                handZone.frame(height: handZoneHeight)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.28), value: session.isPlaying)
    }

    private var landscapeBody: some View {
        HStack(spacing: 10) {
            VStack(spacing: 8) {
                cage
                fightersHUD
            }
            VStack(spacing: 8) {
                if session.isPlaying {
                    playingPlaceholder
                } else {
                    infoZone.frame(height: infoZoneHeight)
                    handZone.frame(maxHeight: .infinity)
                }
            }
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        VStack(spacing: 4) {
            HStack(spacing: 6) {
                Button("← 選角") { onExit() }
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .buttonStyle(.bordered)

                Text("R\(session.shownRound)/\(session.totalRounds) · 交手 \(session.shownExchange)/\(session.exchangesPerRound)")
                    .font(.system(.subheadline, design: .monospaced, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Spacer(minLength: 0)

                Button("🔍 算式") { showDebugDrawer.toggle() }
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .buttonStyle(.bordered)

                Button(session.copiedToast ? "✓ 已複製" : "📋 重現碼") {
                    session.copyReplayBundle()
                }
                .font(.system(.caption2, design: .monospaced, weight: .semibold))
                .buttonStyle(.bordered)

                Button("🔄 重開") {
                    session.startNewMatch(withSeed: BattleSession.randomSeed())
                }
                .font(.system(.caption2, design: .monospaced, weight: .semibold))
                .buttonStyle(.borderedProminent)
            }
            scoreboardStrip
        }
    }

    private var scoreboardStrip: some View {
        HStack(spacing: 8) {
            Text("Seed: #\(session.seed)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            speedMenu
            ForEach(Array(session.completedRounds.prefix(session.shownCompletedRounds)), id: \.round) { rLog in
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
        .frame(height: 18)
    }

    private var speedMenu: some View {
        Menu {
            ForEach(PlaybackSpeed.allCases) { speed in
                Button {
                    session.setPlaybackSpeed(speed)
                } label: {
                    if speed == session.playbackSpeed {
                        Label(speed.label, systemImage: "checkmark")
                    } else {
                        Text(speed.label)
                    }
                }
            }
        } label: {
            Text("⏱ \(session.playbackSpeed.label)")
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.white.opacity(0.1))
                .clipShape(Capsule())
        }
    }

    // MARK: - Cage

    private var cage: some View {
        SpriteView(scene: session.scene, options: [.ignoresSiblingOrder])
            .frame(minHeight: 150, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Fighter HUD

    private var fightersHUD: some View {
        HStack(spacing: 8) {
            FighterStatusCard(
                fighter: session.fighterA,
                headData: session.headshotDataA,
                roleTag: "🟢 玩家",
                cond: session.displayState.a,
                tint: .green
            )
            FighterStatusCard(
                fighter: session.fighterB,
                headData: session.headshotDataB,
                roleTag: "🔴 AI",
                cond: session.displayState.b,
                tint: .red
            )
        }
    }

    // MARK: - Fixed info zone (ground / submission chain, or standing phase)

    @ViewBuilder
    private var infoZone: some View {
        if let ground = session.displayState.ground {
            groundStatusBanner(ground)
        } else {
            standingStatusBanner
        }
    }

    private var recapButton: some View {
        Button("📜") { showRecap = true }
            .font(.system(size: 12))
            .buttonStyle(.bordered)
            .controlSize(.mini)
    }

    /// Landscape right column while an exchange plays.
    private var playingPlaceholder: some View {
        Text("🎬 交手進行中・點畫面跳過")
            .font(.system(.caption, design: .monospaced, weight: .heavy))
            .foregroundStyle(.yellow)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yellow.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.yellow.opacity(0.35), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var standingStatusBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("🥊 站立 · \(session.phaseSummaryText)")
                    .font(.system(.caption, design: .monospaced, weight: .heavy))
                    .lineLimit(1)
                Spacer()
                recapButton
            }
            if let last = session.visibleRecaps.last {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("上一手 · R\(last.round) 第 \(last.exchange) 手")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(.yellow)
                        ForEach(Array(last.lines.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            } else {
                Text("進入地面後，這裡會顯示位置、上下位與鎖技進度。")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func groundStatusBanner(_ ground: GroundState) -> some View {
        let isPlayerTop = (ground.topSide == .a)
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("🥋 地面階段 · \(ground.position.displayName)")
                    .font(.system(.caption, design: .monospaced, weight: .heavy))
                    .foregroundStyle(.cyan)
                    .lineLimit(1)
                Spacer()
                Text(isPlayerTop ? "🟢 玩家上位 (Top)" : "🔴 玩家下位 (Bottom)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background((isPlayerTop ? Color.green : Color.orange).opacity(0.25))
                    .clipShape(Capsule())
                Text("消極 \(ground.stallCount)/3")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                recapButton
            }

            // Positional hierarchy indicator (1..5)
            HStack(spacing: 4) {
                ForEach(GroundPosition.allCases, id: \.rawValue) { pos in
                    let active = (pos == ground.position)
                    Text("\(pos.rawValue).\(BattleText.shortPositionName(pos))")
                        .font(.system(size: 9, weight: active ? .heavy : .regular, design: .monospaced))
                        .padding(.vertical, 3)
                        .frame(maxWidth: .infinity)
                        .background(active ? Color.cyan.opacity(0.35) : Color.white.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }

            if let hold = ground.activeSubmission {
                let attLabel = hold.attackerSide == .a ? "🟢 玩家發動" : "🔴 AI 發動"
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text("🔒 鎖技對決：【\(hold.name)】(\(attLabel))")
                            .font(.system(size: 11, weight: .heavy, design: .monospaced))
                            .foregroundStyle(.yellow)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Spacer()
                        Text(hold.stage == .lockedIn ? "🔥 階段 2/2 深鎖 (再贏即投降!)" : "階段 1/2 抓把位 (Setup)")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(hold.stage == .lockedIn ? .orange : .yellow)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    ProgressView(value: hold.stage == .lockedIn ? 0.85 : 0.45)
                        .tint(hold.stage == .lockedIn ? .red : .yellow)
                }
                .padding(5)
                .background(Color.red.opacity(0.18))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.cyan.opacity(0.10))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.cyan.opacity(0.40), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Hand zone (cards, or outcome banner once the match is over)

    @ViewBuilder
    private var handZone: some View {
        if let outcome = session.matchOutcome {
            outcomeBanner(outcome)
        } else {
            cardSelectionSection
        }
    }

    private var cardSelectionSection: some View {
        let state = session.state
        let fullLegalPool = FightMatchEngine.legalCards(from: SampleData.allCards, for: .a, in: state)
        let legalIds = Set(fullLegalPool.map(\.id))
        let displayedCards: [Card] = session.useFiveCardHandMode
            ? session.playerHand.activeHand
            : fullLegalPool

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                handHeaderText(count: displayedCards.count)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer()
                Button(session.useFiveCardHandMode ? "切換全牌庫" : "切換5張手牌") {
                    session.useFiveCardHandMode.toggle()
                }
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .buttonStyle(.bordered)
            }

            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(Array(displayedCards.enumerated()), id: \.offset) { _, card in
                        cardButton(card, legalIds: legalIds, state: state)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private func handHeaderText(count: Int) -> some View {
        let state = session.state
        if let ground = state.ground {
            let roleText = ground.topSide == .a ? "上位 Top" : "下位 Bottom"
            Text("🥋 地面手牌（已自動翻面為\(roleText)卡 · \(count) 張）：")
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(.cyan)
        } else if state.a.isRocked {
            Text("⚠️ 被打暈 (Rocked)！僅能選 格擋/閃避/移動")
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(.orange)
        } else {
            Text(
                session.useFiveCardHandMode
                    ? "🃏 站立手牌 (5/5) · 抽牌堆剩 \(session.playerHand.drawPile.count) 張 / 棄牌 \(session.playerHand.discardPile.count) 張："
                    : "📚 全部合法卡牌（\(count) 張）："
            )
            .font(.system(.caption, design: .monospaced, weight: .semibold))
            .foregroundStyle(.secondary)
        }
    }

    private func cardButton(_ card: Card, legalIds: Set<String>, state: FightState) -> some View {
        let isLegal = legalIds.contains(card.id)
        let inRange = state.isGrounded ? true : card.isEffective(at: state.distance)
        return Button {
            session.playTurn(playerCard: card)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(card.name)
                        .font(.system(.callout, design: .monospaced, weight: .bold))
                        .lineLimit(1)
                    Spacer()
                    Text(BattleText.cardBadge(card))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.white.opacity(0.15))
                        .clipShape(Capsule())
                }
                HStack(spacing: 6) {
                    if state.isGrounded {
                        Text(BattleText.groundCardSubtitle(card))
                            .foregroundStyle(.cyan)
                    } else {
                        Text("距:\(BattleText.distancesText(card.distances))")
                            .foregroundStyle(inRange ? Color.green : Color.orange)
                        if let land = card.landingPosition {
                            Text("摔→\(BattleText.shortPositionName(land))")
                                .foregroundStyle(.cyan)
                        } else if let t = card.target {
                            Text("標:\(BattleText.targetText(t))")
                        }
                    }
                    Spacer()
                    Text("⚡-\(card.staminaCost)")
                }
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
            }
            .padding(7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isLegal ? Color.white.opacity(0.08) : Color.white.opacity(0.02))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(
                        state.isGrounded && isLegal
                            ? Color.cyan.opacity(0.50)
                            : (inRange && isLegal ? Color.green.opacity(0.45) : Color.white.opacity(0.15)),
                        lineWidth: 1
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .disabled(!isLegal)
        .opacity(isLegal ? 1.0 : 0.35)
    }

    private func outcomeBanner(_ outcome: MatchOutcome) -> some View {
        VStack(spacing: 8) {
            Text(BattleText.outcomeHeadline(outcome, decisionType: session.decisionType))
                .font(.system(.title3, design: .monospaced, weight: .heavy))
                .multilineTextAlignment(.center)
            Text(BattleText.outcomeSubtitle(outcome, judgeScorecards: session.judgeScorecards, seed: session.seed))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("🔥 再打一場（新 Seed）") {
                session.startNewMatch(withSeed: BattleSession.randomSeed())
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.blue.opacity(0.18))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.blue.opacity(0.5), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Fighter status card (HUD)

/// Compact in-fight status card. Badge row height is reserved so a Rocked/bleeding badge never resizes the HUD.
struct FighterStatusCard: View {
    let fighter: Fighter
    let headData: Data?
    let roleTag: String
    let cond: FighterCondition
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if let data = headData, let uiImg = UIImage(data: data) {
                    Image(uiImage: uiImg)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 34, height: 34)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(roleTag) \(fighter.name)")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .lineLimit(1)
                    Text("OVR \(fighter.overallRating) · Elo \(fighter.eloRating ?? 1600) · \(fighter.record ?? "")")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 4) {
                if cond.isBleeding {
                    Text("🩸 流血 Lv.\(cond.cutSeverity)")
                        .font(.system(size: 9, weight: .heavy, design: .monospaced))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.red)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                if cond.isRocked {
                    Text("💥 ROCKED")
                        .font(.system(size: 9, weight: .heavy, design: .monospaced))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.orange)
                        .foregroundStyle(.black)
                        .clipShape(Capsule())
                }
                if !(cond.isBleeding || cond.isRocked), !fighter.traits.isEmpty {
                    Text(fighter.traits.map(\.displayName).joined(separator: " "))
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(tint)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .frame(height: 16)

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
                        .animation(.easeOut(duration: 0.3), value: value)
                }
            }
            .frame(height: 6)
            Text("\(Int(value.rounded()))")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .frame(width: 26, alignment: .trailing)
        }
    }
}
