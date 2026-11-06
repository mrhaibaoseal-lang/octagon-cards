import Foundation
import Observation
import SwiftUI
import FightEngine

/// First-launch roster sprite prefetch state (moved out of `ContentView`, behavior unchanged).
@MainActor
@Observable
final class RosterPrefetchModel {
    var progress: FighterPixelSpriteService.PrefetchProgress? = nil
    var isPrefetching: Bool = false
    var showOverlay: Bool = false

    /// Same UserDefaults key the old `@AppStorage` used, so existing installs keep their "already prefetched" flag.
    private static let completedOnceKey = "rosterPrefetchCompletedOnce"

    private var hasCompletedFirstPrefetch: Bool {
        get { UserDefaults.standard.bool(forKey: Self.completedOnceKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.completedOnceKey) }
    }

    /// Downloads every roster sprite not yet on device (first launch, or retry after failures).
    /// Already-downloaded sprites are skipped, so later launches finish instantly without any network.
    /// Returns `true` when a download run actually happened (caller should refresh on-screen sprites).
    func runIfNeeded() async -> Bool {
        guard !isPrefetching else { return false }
        let roster = RealUFCRoster.all
        let missing = await FighterPixelSpriteService.shared.missingSpriteCount(in: roster)
        guard missing > 0 else { return false }

        isPrefetching = true
        // Full-screen progress only the very first time; later runs (new fighters from a roster
        // update, or sprites that failed before) download quietly with the small top indicator.
        if !hasCompletedFirstPrefetch {
            showOverlay = true
        }
        let result = await FighterPixelSpriteService.shared.prefetchAll(roster) { [self] progress in
            self.progress = progress
        }
        progress = result
        isPrefetching = false
        hasCompletedFirstPrefetch = true
        if result.failed == 0 {
            showOverlay = false
        }
        return true
    }
}

/// Small top capsule shown while a background prefetch is running and the full overlay is hidden.
struct RosterPrefetchPill: View {
    let model: RosterPrefetchModel

    var body: some View {
        if model.isPrefetching, !model.showOverlay, let p = model.progress {
            Text("⬇️ 背景下載選手圖 \(p.completed)/\(p.total)")
                .font(.system(.caption2, design: .monospaced, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.top, 2)
                .onTapGesture { model.showOverlay = true }
        }
    }
}

/// Full-screen first-launch progress card.
struct RosterPrefetchOverlay: View {
    let model: RosterPrefetchModel
    let onRetry: () -> Void

    var body: some View {
        let p = model.progress ?? .init(completed: 0, total: 0, failed: 0)
        ZStack {
            Color.black.opacity(0.75).ignoresSafeArea()
            VStack(spacing: 12) {
                Text(model.isPrefetching ? "首次下載選手像素圖" : "選手圖下載完成")
                    .font(.system(.headline, design: .monospaced, weight: .heavy))
                Text("只需下載一次，之後每場比賽都直接讀取手機內的圖，不用再連網。")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                ProgressView(value: p.fraction)
                    .tint(.orange)
                Text("\(p.completed) / \(p.total)" + (p.failed > 0 ? " · 失敗 \(p.failed)（改用剪影）" : ""))
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                if model.isPrefetching {
                    Button("背景下載，先開始玩") { model.showOverlay = false }
                        .buttonStyle(.bordered)
                } else {
                    HStack {
                        if p.failed > 0 {
                            Button("重試失敗的 \(p.failed) 張") { onRetry() }
                                .buttonStyle(.borderedProminent)
                                .tint(.orange)
                        }
                        Button("關閉") { model.showOverlay = false }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .font(.system(.caption, design: .monospaced))
            .padding(20)
            .frame(maxWidth: 320)
            .background(Color(red: 0.10, green: 0.11, blue: 0.16), in: RoundedRectangle(cornerRadius: 14))
        }
    }
}
