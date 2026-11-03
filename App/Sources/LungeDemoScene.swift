import SpriteKit

/// Placeholder L0 battle scene: two colored blocks facing off.
/// An attack = wind-up, fast lunge, hit-stop, flash + shake on the defender, recoil.
final class LungeDemoScene: SKScene {
    enum Side { case left, right }

    private let leftFighter = SKSpriteNode(color: .systemGreen, size: CGSize(width: 60, height: 110))
    private let rightFighter = SKSpriteNode(color: .systemRed, size: CGSize(width: 60, height: 110))
    private var leftHome = CGPoint.zero
    private var rightHome = CGPoint.zero

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.09, green: 0.09, blue: 0.14, alpha: 1)
        scaleMode = .resizeFill
        layoutFighters()
        addChild(leftFighter)
        addChild(rightFighter)
    }

    override func didChangeSize(_ oldSize: CGSize) {
        guard leftFighter.parent != nil else { return }
        layoutFighters()
    }

    private func layoutFighters() {
        leftHome = CGPoint(x: size.width * 0.25, y: size.height * 0.45)
        rightHome = CGPoint(x: size.width * 0.75, y: size.height * 0.45)
        leftFighter.position = leftHome
        rightFighter.position = rightHome
    }

    func attack(from side: Side) {
        let attacker = side == .left ? leftFighter : rightFighter
        let defender = side == .left ? rightFighter : leftFighter
        let home = side == .left ? leftHome : rightHome
        let defenderHome = side == .left ? rightHome : leftHome
        let dir: CGFloat = side == .left ? 1 : -1
        let impactX = (leftHome.x + rightHome.x) / 2 - dir * 36

        let windUp = SKAction.moveBy(x: -dir * 14, y: 0, duration: 0.10)
        let lunge = SKAction.move(to: CGPoint(x: impactX, y: home.y), duration: 0.08)
        let hitStop = SKAction.wait(forDuration: 0.08)
        let recoil = SKAction.move(to: home, duration: 0.25)

        let flash = SKAction.sequence([
            SKAction.colorize(with: .white, colorBlendFactor: 1, duration: 0.02),
            SKAction.colorize(withColorBlendFactor: 0, duration: 0.15),
        ])
        let knock = SKAction.sequence([
            SKAction.moveBy(x: dir * 18, y: 0, duration: 0.05),
            SKAction.move(to: defenderHome, duration: 0.25),
        ])

        attacker.removeAllActions()
        defender.removeAllActions()
        attacker.run(.sequence([
            windUp, lunge,
            .run { defender.run(.group([flash, knock])) },
            hitStop, recoil,
        ]))
    }
}
