import SwiftUI

/// Full commentary of every exchange so far, newest first (P5-3b). The exchange still playing is never listed:
/// `visibleRecaps` holds it back until playback ends or is skipped.
struct BattleRecapView: View {
    let session: BattleSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let recaps = Array(session.visibleRecaps.reversed())
        VStack(spacing: 0) {
            HStack {
                Text("📜 戰報")
                    .font(.system(.headline, design: .monospaced, weight: .heavy))
                Spacer()
                Button("關閉") { dismiss() }
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .buttonStyle(.bordered)
            }
            .padding(12)

            if recaps.isEmpty {
                Spacer()
                Text("還沒有交手紀錄")
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(recaps) { recap in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("R\(recap.round) · 第 \(recap.exchange) 手")
                                    .font(.system(.caption, design: .monospaced, weight: .heavy))
                                    .foregroundStyle(.yellow)
                                ForEach(Array(recap.lines.enumerated()), id: \.offset) { _, line in
                                    Text(line)
                                        .font(.system(.footnote, design: .monospaced))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                }
            }
        }
    }
}
