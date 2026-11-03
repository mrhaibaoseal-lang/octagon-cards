// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OctagonCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FightEngine", targets: ["FightEngine"]),
    ],
    targets: [
        // Pure Swift: no UIKit / SwiftUI / SpriteKit imports allowed here (see RULES.md).
        .target(name: "FightEngine"),
        .testTarget(name: "FightEngineTests", dependencies: ["FightEngine"]),
    ]
)
