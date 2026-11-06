import SwiftUI

/// App root: navigation between the pre-fight page and the battle page, plus the roster-prefetch overlays.
/// All fight logic lives in `BattleSession`; screens live in `PreFightView` / `BattleView`.
struct ContentView: View {
    private enum Screen {
        case preFight
        case battle
    }

    @State private var session = BattleSession()
    @State private var prefetch = RosterPrefetchModel()
    @State private var screen: Screen = .preFight
    @State private var showRigCut = false

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.06, blue: 0.09).ignoresSafeArea()
            switch screen {
            case .preFight:
                PreFightView(session: session) {
                    screen = .battle
                }
            case .battle:
                BattleView(session: session) {
                    // Leaving a bout abandons it; the next bout always starts fresh.
                    session.startNewMatch(withSeed: BattleSession.randomSeed())
                    screen = .preFight
                }
            }
        }
        .overlay(alignment: .top) {
            RosterPrefetchPill(model: prefetch)
        }
        .overlay(alignment: .bottomLeading) {
            // Dev-only entry for the P6-2 Vision cut check; kept out of PreFightView/BattleView on purpose.
            if screen == .preFight {
                Button("🔬 Rig") { showRigCut = true }
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.ultraThinMaterial, in: Capsule())
                    .opacity(0.6)
                    .padding(.leading, 12)
                    .padding(.bottom, 6)
            }
        }
        .fullScreenCover(isPresented: $showRigCut) {
            RigCutDebugView { showRigCut = false }
        }
        .overlay {
            if prefetch.showOverlay {
                RosterPrefetchOverlay(model: prefetch) {
                    Task { await prefetchAndRefresh() }
                }
            }
        }
        .task {
            await prefetchAndRefresh()
        }
    }

    /// Runs the roster prefetch and swaps any fallback silhouettes on screen for freshly downloaded sprites.
    private func prefetchAndRefresh() async {
        if await prefetch.runIfNeeded() {
            session.refreshPixelSprites()
        }
    }
}

#Preview { ContentView() }
