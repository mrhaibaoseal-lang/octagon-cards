import SpriteKit
import SwiftUI
import FightEngine

/// P0 smoke screen: proves SwiftUI + SpriteKit + the pure-Swift FightEngine package
/// are wired together, and gives a first taste of the L0 "lunge" attack animation.
struct ContentView: View {
    @State private var scene = LungeDemoScene(size: CGSize(width: 390, height: 300))
    @State private var rolled: String = "—"

    var body: some View {
        VStack(spacing: 16) {
            Text("OCTAGON CARDS")
                .font(.system(.title, design: .monospaced, weight: .heavy))
            Text("P0 build OK")
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.secondary)

            SpriteView(scene: scene, options: [.ignoresSiblingOrder])
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 12) {
                Button("Left attacks") { scene.attack(from: .left) }
                Button("Right attacks") { scene.attack(from: .right) }
            }
            .buttonStyle(.borderedProminent)

            Button("Roll 60% odds") {
                let hit = Double.random(in: 0..<1) < Odds.resolve(base: 0.6)
                rolled = hit ? "HIT" : "MISS"
            }
            .buttonStyle(.bordered)
            Text("Result: \(rolled)")
                .font(.system(.body, design: .monospaced))
        }
        .padding()
    }
}

#Preview { ContentView() }
