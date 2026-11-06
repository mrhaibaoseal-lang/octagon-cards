import SpriteKit
import SwiftUI
import UIKit
import FightEngine

/// Battle page (landscape only, P6-1). The SpriteKit cage fills the whole screen and never changes size;
/// everything else is SwiftUI laid over it: broadcast bar and position strip on top, fan hand at the bottom,
/// info bottom-left, menu bottom-right.
struct BattleView: View {
    let session: BattleSession
    let onExit: () -> Void

    @State private var showDebugDrawer: Bool = false
    @State private var showRecap: Bool = false
    @State private var selectedCard: Int? = nil

    /// Width of the bottom-left panel. The hand gets whatever is left between the two side zones.
    private let sideZoneWidth: CGFloat = 150

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

                VStack(spacing: 6) {
                    BroadcastBar(session: session)
                    positionStrip(maxWidth: min(400, geo.size.width * 0.47))
                    BattleAlertBanners(alerts: currentAlerts)
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

                // P5-4: Rocked and deep locks pulse around the whole battle screen.
                BattleAlertFrame(alerts: currentAlerts)
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

    private var currentAlerts: [BattleAlert] {
        BattleAlert.current(
            state: session.displayState,
            nameA: session.fighterA.name,
            nameB: session.fighterB.name
        )
    }

    // MARK: - Position strip (under the broadcast bar)

    /// Always on screen and clear of the hand: range while standing, ground position otherwise.
    @ViewBuilder
    private func positionStrip(maxWidth: CGFloat) -> some View {
        if let ground = session.displayState.ground {
            groundStatusStrip(ground).frame(maxWidth: maxWidth)
        } else {
            distanceStrip
        }
    }

    private var distanceStrip: some View {
        let state = session.displayState
        return HStack(spacing: 3) {
            ForEach([Distance.long, .mid, .close], id: \.self) { d in
                let active = d == state.distance
                Text(BattleText.distancesText([d]))
                    .font(.system(size: 12, weight: active ? .heavy : .medium))
                    .foregroundStyle(active ? Color.black : Color.white.opacity(0.65))
                    .frame(width: 34)
                    .padding(.vertical, 3)
                    .background(active ? Color.yellow : Color.white.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            if state.isClinch {
                Text("纏抱")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 5)
            }
        }
        .padding(3)
        .background(Color.black.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .allowsHitTesting(false)
    }

    private func groundStatusStrip(_ ground: GroundState) -> some View {
        let isPlayerTop = (ground.topSide == .a)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(ground.position.displayName)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(.cyan)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
                Text(isPlayerTop ? "玩家上位" : "玩家下位")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background((isPlayerTop ? Color.green : Color.orange).opacity(0.35))
                    .clipShape(Capsule())
                Text("消極 \(ground.stallCount)/3")
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }

            // Positional hierarchy indicator (1..5)
            HStack(spacing: 3) {
                ForEach(GroundPosition.allCases, id: \.rawValue) { pos in
                    let active = (pos == ground.position)
                    Text(BattleText.shortPositionName(pos))
                        .font(.system(size: 11, weight: active ? .heavy : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity)
                        .background(active ? Color.cyan.opacity(0.45) : Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }

            if let hold = ground.activeSubmission {
                HStack(spacing: 6) {
                    Text("🔒【\(hold.name)】\(hold.attackerSide == .a ? "玩家發動" : "AI 發動")")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(.yellow)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Spacer(minLength: 0)
                    Text(hold.stage == .lockedIn ? "深鎖 2/2" : "抓把 1/2")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(hold.stage == .lockedIn ? .orange : .yellow)
                    ProgressView(value: hold.stage == .lockedIn ? 0.85 : 0.45)
                        .tint(hold.stage == .lockedIn ? .red : .yellow)
                        .frame(width: 50)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(Color.red.opacity(0.22))
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(6)
        .background(Color.black.opacity(0.65))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.cyan.opacity(0.45), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(false)
    }

    // MARK: - Bottom-left: deck counts, previous exchange, recap

    @ViewBuilder
    private var infoCluster: some View {
        if session.isPlaying {
            Text("點畫面跳過")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(.yellow)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.7))
                .clipShape(Capsule())
                .frame(width: sideZoneWidth, alignment: .leading)
                .allowsHitTesting(false)
        } else {
            Button { showRecap = true } label: {
                VStack(alignment: .leading, spacing: 3) {
                    if session.matchOutcome == nil, session.state.a.isRocked {
                        Text("Rocked：只能格擋、閃避、移動")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 4) {
                        if session.useFiveCardHandMode {
                            Text("抽 \(session.playerHand.drawPile.count) · 棄 \(session.playerHand.discardPile.count)")
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Text("戰報 ›")
                            .foregroundStyle(.yellow)
                    }
                    .font(.system(size: 11, weight: .semibold))

                    if let last = session.visibleRecaps.last {
                        // The tail of an exchange says how it ended, which is what matters at a glance.
                        ForEach(Array(last.lines.suffix(2).enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(size: 11))
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(6)
                .frame(width: sideZoneWidth, alignment: .leading)
                .background(Color.black.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Bottom-right: round scores, speed, menu

    private var menuCluster: some View {
        VStack(alignment: .trailing, spacing: 5) {
            ForEach(Array(session.completedRounds.prefix(session.shownCompletedRounds)), id: \.round) { rLog in
                if let sc = rLog.score {
                    Text("R\(sc.round) \(sc.pointsA)-\(sc.pointsB)")
                        .font(.system(size: 11, weight: .bold))
                        .monospacedDigit()
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Color.black.opacity(0.7))
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
                .font(.system(size: 12, weight: .bold))
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.7))
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
                .font(.system(size: 12, weight: .bold))
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.7))
                .clipShape(Capsule())
        }
    }

    // MARK: - Hand (fan)

    private func handLayer(availableWidth: CGFloat) -> some View {
        let state = session.state
        let fullLegalPool = FightMatchEngine.legalCards(from: SampleData.allCards, for: .a, in: state)
        let legalIds = Set(fullLegalPool.map(\.id))
        let displayedCards: [Card] = session.useFiveCardHandMode
            ? session.playerHand.activeHand
            : fullLegalPool
        // The fan is centred, so it has to stay clear of the wider side zone on both sides.
        let fanWidth = max(300, min(560, availableWidth - 2 * (sideZoneWidth + 16)))
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
                .font(.system(size: 17, weight: .heavy))
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
            Text(BattleText.outcomeSubtitle(outcome, judgeScorecards: session.judgeScorecards, seed: session.seed))
                .font(.system(size: 11))
                .monospacedDigit()
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

    /// How far a resting card sinks below the bottom edge. Everything needed to choose sits in the part still showing.
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
        let cardWidth = HandCard.width
        let spacing = n > 1 ? min(cardWidth + 2, (width - cardWidth) / CGFloat(n - 1)) : 0
        // The next card covers this much of each card's right edge, so the text has to stay out of it.
        let covered = max(0, cardWidth - spacing)
        return ZStack(alignment: .bottom) {
            ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                let rel = CGFloat(index) - mid
                HandCard(
                    card: card,
                    legal: legalIds.contains(card.id),
                    state: state,
                    isSelected: selected == index,
                    // Small angles: rotated text is what softens the card faces.
                    restAngle: Double(rel) * 2.5,
                    restOffset: CGSize(width: rel * spacing, height: restSink + rel * rel * 2),
                    coveredWidth: index == n - 1 ? 0 : covered,
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
                        coveredWidth: 0,
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
    static let width: CGFloat = 100
    private static let height: CGFloat = 130
    private static let playThreshold: CGFloat = 60

    let card: Card
    let legal: Bool
    let state: FightState
    let isSelected: Bool
    let restAngle: Double
    let restOffset: CGSize
    let coveredWidth: CGFloat
    let onTap: () -> Void
    let onPlay: () -> Void

    @State private var drag: CGFloat = 0

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
                        if legal, up > Self.playThreshold, abs(v.translation.width) < up {
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
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
                Text("⚡\(card.staminaCost)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
            }
            Text(card.name)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .fixedSize(horizontal: false, vertical: true)
            // Directly under the name, not at the card's foot: a resting card's lower part is off screen.
            if grounded {
                Text(BattleText.groundCardSubtitle(card))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.cyan)
                    .lineLimit(isSelected ? 3 : 2)
                    .minimumScaleFactor(0.85)
            } else {
                HStack(spacing: 3) {
                    Text(BattleText.distancesText(card.distances))
                        .foregroundStyle(inRange ? Color.green : Color.orange)
                    if let land = card.landingPosition {
                        Text("摔→\(BattleText.shortPositionName(land))")
                            .foregroundStyle(.cyan)
                    } else if let t = card.target {
                        Text("打\(BattleText.targetText(t))")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 7)
        .padding(.vertical, 7)
        .padding(.trailing, isSelected ? 7 : max(7, coveredWidth + 2))
        .frame(width: Self.width, height: Self.height, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color(red: 0.12, green: 0.14, blue: 0.21)))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(isSelected ? Color.yellow : stroke, lineWidth: isSelected ? 2 : 1)
        )
        .overlay(alignment: .top) {
            if isSelected && legal {
                Text("↑ 上拖出牌")
                    .font(.system(size: 10, weight: .heavy))
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
