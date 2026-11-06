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
