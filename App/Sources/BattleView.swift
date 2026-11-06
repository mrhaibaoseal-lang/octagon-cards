import SpriteKit
import SwiftUI
import UIKit
import FightEngine

/// Battle page (landscape only, P6-1). The SpriteKit cage fills the whole screen and never changes size;
/// everything else is SwiftUI laid over it: broadcast bar on top, fan hand at the bottom, info bottom-left,
/// menu bottom-right.
struct BattleView: View {
    let session: BattleSession
    let onExit: () -> Void

    @State private var showDebugDrawer: Bool = false
    @State private var showRecap: Bool = false
    @State private var selectedCard: Int? = nil

    /// Space the broadcast bar takes, so banners and the ground strip sit just below it.
    private let barClearance: CGFloat = 58

    var body: some View {
        GeometryReader { geo in
            ZStack {
                SpriteView(scene: session.scene, options: [.ignoresSiblingOrder])
                    .ignoresSafeArea()

                if session.isPlaying {
                    // While an exchange plays, tapping anywhere on the cage skips to its end.
                    Color.clear
                        .contentShape(Rectangle())
                        .ignoresSafeArea()
                        .onTapGesture { session.skipPlayback() }
                }

                VStack(spacing: 0) {
                    BroadcastBar(session: session)
                    if let ground = session.displayState.ground {
                        groundStatusStrip(ground)
                            .padding(.top, 6)
                            .padding(.horizontal, 8)
                    }
                    Spacer(minLength: 0)
                    HStack(alignment: .bottom, spacing: 8) {
                        infoCluster
                        Spacer(minLength: 0)
                        menuCluster
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 4)
                }

                handLayer(availableWidth: geo.size.width)

                if let outcome = session.matchOutcome, !session.isPlaying {
                    outcomeBanner(outcome)
                        .frame(maxWidth: 440)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // P5-4: Rocked / deep lock / bleeding stay visible over the whole battle screen.
                BattleAlertOverlay(
                    alerts: BattleAlert.current(
                        state: session.displayState,
                        nameA: session.fighterA.name,
                        nameB: session.fighterB.name
                    ),
                    topOffset: barClearance
                )
            }
            .animation(.easeInOut(duration: 0.28), value: session.isPlaying)
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
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
        .onChange(of: session.isPlaying) { _, playing in
            if playing { selectedCard = nil }
        }
    }

    // MARK: - Bottom-left: deck counts, hand hint, previous exchange

    private var infoCluster: some View {
        VStack(alignment: .leading, spacing: 3) {
            if session.isPlaying {
                Text("🎬 交手進行中・點畫面跳過")
                    .font(.system(size: 10, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.yellow)
            } else {
                if session.matchOutcome == nil {
                    handHeaderText
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    if session.useFiveCardHandMode, session.displayState.ground == nil {
                        Text("🂠 抽 \(session.playerHand.drawPile.count) · 棄 \(session.playerHand.discardPile.count)")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                if let last = session.visibleRecaps.last {
                    Button { showRecap = true } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("📜 上一手 · R\(last.round) 第 \(last.exchange) 手")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(.yellow)
                            ForEach(Array(last.lines.prefix(3).enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(.system(size: 9, design: .monospaced))
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("\(session.displayState.ground == nil ? "🥊" : "🥋") \(session.phaseSummaryText)")
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(6)
        .frame(width: 200, alignment: .leading)
        .background(Color.black.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(!session.isPlaying)
    }

    @ViewBuilder
    private var handHeaderText: some View {
        let state = session.state
        if let ground = state.ground {
            let roleText = ground.topSide == .a ? "上位 Top" : "下位 Bottom"
            Text("🥋 地面手牌（\(roleText)）")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(.cyan)
        } else if state.a.isRocked {
            Text("⚠️ Rocked！只能格擋/閃避/移動")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(.orange)
        } else {
            Text(session.useFiveCardHandMode ? "🃏 站立手牌 · 點選放大，上拖出牌" : "📚 全部合法卡牌 · 上拖出牌")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Bottom-right: round scores, speed, menu

    private var menuCluster: some View {
        HStack(spacing: 6) {
            ForEach(Array(session.completedRounds.prefix(session.shownCompletedRounds)), id: \.round) { rLog in
                if let sc = rLog.score {
                    Text("R\(sc.round) \(sc.pointsA)-\(sc.pointsB)")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.black.opacity(0.55))
                        .clipShape(Capsule())
                }
            }
            speedMenu
            mainMenu
        }
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
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.55))
                .clipShape(Capsule())
        }
    }

    private var mainMenu: some View {
        Menu {
            Button { showDebugDrawer = true } label: { Label("算式", systemImage: "function") }
            Button { session.copyReplayBundle() } label: {
                Label(session.copiedToast ? "已複製重現碼" : "複製重現碼", systemImage: "doc.on.doc")
            }
            Button { showRecap = true } label: { Label("戰報", systemImage: "scroll") }
            Button { session.useFiveCardHandMode.toggle() } label: {
                Label(session.useFiveCardHandMode ? "切換全牌庫" : "切換5張手牌", systemImage: "rectangle.stack")
            }
            Divider()
            Button { session.startNewMatch(withSeed: BattleSession.randomSeed()) } label: {
                Label("重開", systemImage: "arrow.clockwise")
            }
            Button(role: .destructive) { onExit() } label: {
                Label("回選角", systemImage: "chevron.backward")
            }
            Divider()
            Text("Seed #\(session.seed)")
        } label: {
            Text("☰ 選單")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.55))
                .clipShape(Capsule())
        }
    }

    // MARK: - Ground strip (under the broadcast bar)

    private func groundStatusStrip(_ ground: GroundState) -> some View {
        let isPlayerTop = (ground.topSide == .a)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("🥋 \(ground.position.displayName)")
                    .font(.system(size: 11, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.cyan)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(isPlayerTop ? "🟢 玩家上位" : "🔴 玩家下位")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background((isPlayerTop ? Color.green : Color.orange).opacity(0.3))
                    .clipShape(Capsule())
                Text("消極 \(ground.stallCount)/3")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            // Positional hierarchy indicator (1..5)
            HStack(spacing: 3) {
                ForEach(GroundPosition.allCases, id: \.rawValue) { pos in
                    let active = (pos == ground.position)
                    Text("\(pos.rawValue).\(BattleText.shortPositionName(pos))")
                        .font(.system(size: 9, weight: active ? .heavy : .regular, design: .monospaced))
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity)
                        .background(active ? Color.cyan.opacity(0.4) : Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }

            if let hold = ground.activeSubmission {
                let attLabel = hold.attackerSide == .a ? "🟢 玩家發動" : "🔴 AI 發動"
                HStack(spacing: 6) {
                    Text("🔒【\(hold.name)】\(attLabel)")
                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                        .foregroundStyle(.yellow)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(hold.stage == .lockedIn ? "🔥 深鎖 2/2" : "抓把 1/2")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(hold.stage == .lockedIn ? .orange : .yellow)
                    ProgressView(value: hold.stage == .lockedIn ? 0.85 : 0.45)
                        .tint(hold.stage == .lockedIn ? .red : .yellow)
                        .frame(width: 70)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(Color.red.opacity(0.22))
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(6)
        .frame(maxWidth: 400)
        .background(Color.black.opacity(0.6))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.cyan.opacity(0.45), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(false)
    }

    // MARK: - Hand (fan)

    private func handLayer(availableWidth: CGFloat) -> some View {
        let state = session.state
        let fullLegalPool = FightMatchEngine.legalCards(from: SampleData.allCards, for: .a, in: state)
        let legalIds = Set(fullLegalPool.map(\.id))
        let displayedCards: [Card] = session.useFiveCardHandMode
            ? session.playerHand.activeHand
            : fullLegalPool
        // Keep the fan clear of the info cluster (left) and the menu (right).
        let fanWidth = max(300, min(560, availableWidth - 430))
        let hidden = session.isPlaying || session.matchOutcome != nil

        return HandFanView(
            cards: displayedCards,
            legalIds: legalIds,
            state: state,
            selected: $selectedCard
        ) { card in
            selectedCard = nil
            session.playTurn(playerCard: card)
        }
        .frame(width: fanWidth, height: 160)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        // Slides out while an exchange plays so fighters and the flipped cards are never covered.
        .offset(y: hidden ? 260 : 0)
        .allowsHitTesting(!hidden)
    }

    private func outcomeBanner(_ outcome: MatchOutcome) -> some View {
        VStack(spacing: 6) {
            Text(BattleText.outcomeHeadline(outcome, decisionType: session.decisionType))
                .font(.system(.headline, design: .monospaced, weight: .heavy))
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
            Text(BattleText.outcomeSubtitle(outcome, judgeScorecards: session.judgeScorecards, seed: session.seed))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("🔥 再打一場（新 Seed）") {
                session.startNewMatch(withSeed: BattleSession.randomSeed())
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Color.blue.opacity(0.45))
        .background(Color.black.opacity(0.7))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.blue.opacity(0.7), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Fan hand

/// Five cards fanned out along the bottom edge. Tap = raise and enlarge; drag up = play. A hand of more than six
/// (the "all legal cards" debug mode) falls back to a horizontal row with the same gestures.
struct HandFanView: View {
    let cards: [Card]
    let legalIds: Set<String>
    let state: FightState
    @Binding var selected: Int?
    let onPlay: (Card) -> Void

    private let cardWidth: CGFloat = 96
    private let cardHeight: CGFloat = 128
    /// How far a resting card sinks below the bottom edge, so only its top part peeks out.
    private let restSink: CGFloat = 44

    var body: some View {
        GeometryReader { geo in
            if cards.count > 6 {
                scrollRow
            } else {
                fan(width: geo.size.width)
            }
        }
    }

    private func fan(width: CGFloat) -> some View {
        let n = cards.count
        let mid = CGFloat(n - 1) / 2
        let spacing = n > 1 ? min(82, (width - cardWidth - 16) / CGFloat(n - 1)) : 0
        return ZStack(alignment: .bottom) {
            ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                let rel = CGFloat(index) - mid
                HandCard(
                    card: card,
                    legal: legalIds.contains(card.id),
                    state: state,
                    isSelected: selected == index,
                    restAngle: Double(rel) * 5,
                    restOffset: CGSize(width: rel * spacing, height: restSink + rel * rel * 3),
                    onTap: { selected = (selected == index) ? nil : index },
                    onPlay: { onPlay(card) }
                )
                .zIndex(selected == index ? 100 : Double(index))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }

    private var scrollRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                    HandCard(
                        card: card,
                        legal: legalIds.contains(card.id),
                        state: state,
                        isSelected: selected == index,
                        restAngle: 0,
                        restOffset: CGSize(width: 0, height: restSink),
                        onTap: { selected = (selected == index) ? nil : index },
                        onPlay: { onPlay(card) }
                    )
                }
            }
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
    }
}

/// One card in the hand. Selected cards rise and grow; a clear upward drag plays a legal card.
private struct HandCard: View {
    let card: Card
    let legal: Bool
    let state: FightState
    let isSelected: Bool
    let restAngle: Double
    let restOffset: CGSize
    let onTap: () -> Void
    let onPlay: () -> Void

    @State private var drag: CGFloat = 0

    private let width: CGFloat = 96
    private let height: CGFloat = 128
    private let playThreshold: CGFloat = 60

    var body: some View {
        face
            .scaleEffect(isSelected ? 1.2 : 1, anchor: .bottom)
            .rotationEffect(.degrees(isSelected ? 0 : restAngle), anchor: .bottom)
            .offset(
                x: restOffset.width,
                y: (isSelected ? -6 : restOffset.height) + min(0, drag)
            )
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: isSelected)
            .gesture(
                DragGesture(minimumDistance: 12, coordinateSpace: .global)
                    .onChanged { v in
                        if abs(v.translation.height) > abs(v.translation.width) {
                            drag = v.translation.height
                        }
                    }
                    .onEnded { v in
                        let up = -v.translation.height
                        withAnimation(.easeOut(duration: 0.15)) { drag = 0 }
                        if legal, up > playThreshold, abs(v.translation.width) < up {
                            onPlay()
                        }
                    }
            )
            .onTapGesture(perform: onTap)
    }

    private var face: some View {
        let grounded = state.isGrounded
        let inRange = grounded ? true : card.isEffective(at: state.distance)
        let stroke: Color = grounded && legal
            ? Color.cyan.opacity(0.7)
            : (inRange && legal ? Color.green.opacity(0.7) : Color.white.opacity(0.25))
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 2) {
                Text(BattleText.cardBadge(card))
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.white.opacity(0.15))
                    .clipShape(Capsule())
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                Text("⚡\(card.staminaCost)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Text(card.name)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            if grounded {
                Text(BattleText.groundCardSubtitle(card))
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.cyan)
                    .lineLimit(3)
            } else {
                Text("距 \(BattleText.distancesText(card.distances))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(inRange ? Color.green : Color.orange)
                if let land = card.landingPosition {
                    Text("摔→\(BattleText.shortPositionName(land))")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.cyan)
                } else if let t = card.target {
                    Text("標 \(BattleText.targetText(t))")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(7)
        .frame(width: width, height: height, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color(red: 0.12, green: 0.14, blue: 0.21)))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(isSelected ? Color.yellow : stroke, lineWidth: isSelected ? 2 : 1)
        )
        .overlay(alignment: .top) {
            if isSelected && legal {
                Text("↑ 上拖出牌")
                    .font(.system(size: 9, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.yellow)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color.black.opacity(0.8))
                    .clipShape(Capsule())
                    .offset(y: -15)
            }
        }
        .opacity(legal ? 1.0 : 0.4)
    }
}
