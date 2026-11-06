import SwiftUI
import FightEngine

// P5-4 局勢顯示：回合進度格、局勢條、血條損失強調、全畫面警示。
// 這裡只讀 `displayState` 與 `RoundTrend`，不碰引擎與 `SeededRNG`。

// MARK: - Round progress cells + trend bar

/// One thin strip under the top bar: 8 progress cells, then the trend bar. Never shows exact points.
struct RoundStatusStrip: View {
    let exchangesPerRound: Int
    /// Who came out ahead in each finished exchange of this round (`nil` = a wash).
    let winners: [Side?]
    /// 1-based exchange about to be (or currently being) played; `nil` once the match is over.
    let currentExchange: Int?
    let trend: RoundTrend

    var body: some View {
        HStack(spacing: 8) {
            progressCells
                .frame(width: 112)
            TrendBar(trend: trend)
        }
        .frame(height: 26)
    }

    private var progressCells: some View {
        HStack(spacing: 3) {
            ForEach(0..<exchangesPerRound, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(fill(for: index))
                    .frame(height: 10)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(Color.yellow, lineWidth: index + 1 == currentExchange ? 1.5 : 0)
                    )
            }
        }
        .animation(.easeOut(duration: 0.25), value: winners.count)
    }

    private func fill(for index: Int) -> Color {
        guard index < winners.count else { return Color.white.opacity(0.10) }
        switch winners[index] {
        case .some(.a): return Color.green.opacity(0.85)
        case .some(.b): return Color.red.opacity(0.85)
        case .none: return Color.gray.opacity(0.65)
        }
    }
}

/// Tug-of-war bar: green (player, left) against red (AI, right) with a centre tick and a text read-out.
struct TrendBar: View {
    let trend: RoundTrend

    var body: some View {
        VStack(spacing: 2) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    HStack(spacing: 0) {
                        Rectangle().fill(Color.green.opacity(0.8))
                            .frame(width: geo.size.width * CGFloat(trend.value))
                        Rectangle().fill(Color.red.opacity(0.8))
                    }
                    .clipShape(Capsule())
                    Rectangle()
                        .fill(Color.white.opacity(0.85))
                        .frame(width: 2)
                        .offset(x: geo.size.width / 2 - 1)
                }
                .animation(.easeInOut(duration: 0.5), value: trend.value)
            }
            .frame(height: 8)

            Text(caption)
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundStyle(captionColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var caption: String {
        switch trend.leader {
        case .some(.a): return "🟢 玩家 \(trend.label)"
        case .some(.b): return "🔴 AI \(trend.label)"
        case .none: return "⚖️ \(trend.label)"
        }
    }

    private var captionColor: Color {
        switch trend.leader {
        case .some(.a): return .green
        case .some(.b): return .red
        case .none: return .secondary
        }
    }
}

// MARK: - Health bar with loss emphasis

/// A bar that keeps a bright "ghost" segment where the health used to be, then drains it, and shows the loss amount.
struct HealthBarRow: View {
    let label: String
    let value: Double
    let color: Color
    var tracksLoss: Bool = false

    @State private var ghost: Double = 0
    @State private var lossText: String? = nil
    @State private var lossOpacity: Double = 0
    @State private var flash: Bool = false

    private var isLow: Bool { tracksLoss && value <= 25 }

    var body: some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 11, design: .monospaced))
                .frame(width: 34, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.white.opacity(0.12))
                    if tracksLoss {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.white.opacity(0.9))
                            .frame(width: width(of: ghost, in: geo.size.width))
                    }
                    RoundedRectangle(cornerRadius: 3)
                        .fill(isLow ? Color.red : color)
                        .frame(width: width(of: value, in: geo.size.width))
                        .animation(.easeOut(duration: 0.3), value: value)
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(Color.white, lineWidth: flash ? 1.5 : 0)
                )
            }
            .frame(height: 6)
            ZStack(alignment: .trailing) {
                Text("\(Int(value.rounded()))")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isLow ? Color.red : Color.primary)
                if let lossText {
                    Text(lossText)
                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                        .foregroundStyle(.red)
                        .offset(y: -9)
                        .opacity(lossOpacity)
                }
            }
            .frame(width: 26, alignment: .trailing)
        }
        .onAppear { ghost = value }
        .onChange(of: value) { oldValue, newValue in
            guard tracksLoss else { return }
            if newValue < oldValue - 0.5 {
                ghost = max(ghost, oldValue)
                lossText = "-\(Int((oldValue - newValue).rounded()))"
                lossOpacity = 1
                flash = true
                withAnimation(.easeOut(duration: 0.5).delay(0.45)) { ghost = newValue }
                withAnimation(.easeIn(duration: 0.9).delay(0.7)) {
                    lossOpacity = 0
                    flash = false
                }
            } else {
                ghost = newValue
                lossText = nil
                flash = false
            }
        }
    }

    private func width(of v: Double, in total: CGFloat) -> CGFloat {
        max(0, total * CGFloat(min(max(v, 0), 100) / 100.0))
    }
}

// MARK: - Full-screen alerts

struct BattleAlert: Identifiable, Equatable {
    enum Kind: Equatable { case rocked, deepLock, bleeding }

    let id: String
    let kind: Kind
    let text: String

    var color: Color {
        switch kind {
        case .rocked: .orange
        case .deepLock: .red
        case .bleeding: Color(red: 0.8, green: 0.1, blue: 0.15)
        }
    }

    /// Rocked and deep locks also tint the whole screen edge; bleeding only gets a banner.
    var pulsesScreen: Bool { kind != .bleeding }

    /// Alerts for the state the player is currently shown (`displayState`), most urgent first.
    static func current(
        state: FightState,
        nameA: String,
        nameB: String,
        playerLabel: String = "玩家",
        opponentLabel: String = "AI"
    ) -> [BattleAlert] {
        var alerts: [BattleAlert] = []

        if let hold = state.ground?.activeSubmission, hold.stage == .lockedIn {
            let text = hold.attackerSide == .a
                ? "🔒 深鎖【\(hold.name)】！再贏一手，\(opponentLabel) 就認輸"
                : "🔒 \(opponentLabel) 深鎖【\(hold.name)】！再輸一手，你就投降"
            alerts.append(BattleAlert(id: "lock", kind: .deepLock, text: text))
        }
        if state.a.isRocked {
            alerts.append(BattleAlert(id: "rockedA", kind: .rocked, text: "💥 \(playerLabel) \(nameA) 被打暈 ROCKED！只能防守"))
        }
        if state.b.isRocked {
            alerts.append(BattleAlert(id: "rockedB", kind: .rocked, text: "💥 \(opponentLabel) \(nameB) 被打暈 ROCKED！快追擊"))
        }
        if state.a.cutSeverity > 0 {
            alerts.append(BattleAlert(id: "cutA", kind: .bleeding, text: "🩸 \(playerLabel) 流血 Lv.\(state.a.cutSeverity)"))
        }
        if state.b.cutSeverity > 0 {
            alerts.append(BattleAlert(id: "cutB", kind: .bleeding, text: "🩸 \(opponentLabel) 流血 Lv.\(state.b.cutSeverity)"))
        }
        return alerts
    }
}

/// Non-interactive overlay: a pulsing coloured frame around the whole battle area plus stacked banners at the top.
struct BattleAlertOverlay: View {
    let alerts: [BattleAlert]

    @State private var pulse = false

    private var frameAlert: BattleAlert? { alerts.first(where: \.pulsesScreen) }

    var body: some View {
        ZStack(alignment: .top) {
            if let frameAlert {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(frameAlert.color, lineWidth: 5)
                    .shadow(color: frameAlert.color.opacity(0.9), radius: pulse ? 14 : 4)
                    .opacity(pulse ? 1.0 : 0.45)
                    .transition(.opacity)
            }
            VStack(spacing: 4) {
                ForEach(alerts) { alert in
                    Text(alert.text)
                        .font(.system(size: 12, weight: .heavy, design: .monospaced))
                        .foregroundStyle(alert.kind == .rocked ? Color.black : Color.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity)
                        .background(alert.color.opacity(0.92))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
        }
        .animation(.easeInOut(duration: 0.25), value: alerts)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}
