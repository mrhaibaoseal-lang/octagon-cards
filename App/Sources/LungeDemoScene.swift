import SpriteKit
import FightEngine

/// L0 standing battle scene: two fighters facing off in the Octagon.
/// Reflects current `Distance` (`.long`, `.mid`, `.close`), `isRocked`, KO knockdown, and lunge animations.
final class LungeDemoScene: SKScene {
    enum Side { case left, right }

    private let leftFighter = SKSpriteNode(color: .systemGreen, size: CGSize(width: 56, height: 104))
    private let rightFighter = SKSpriteNode(color: .systemRed, size: CGSize(width: 56, height: 104))
    private let cageLine = SKShapeNode()
    private var currentDistance: Distance = .long
    private var leftHome = CGPoint.zero
    private var rightHome = CGPoint.zero

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.08, green: 0.09, blue: 0.13, alpha: 1)
        scaleMode = .resizeFill
        cageLine.strokeColor = SKColor(white: 1.0, alpha: 0.12)
        cageLine.lineWidth = 2
        addChild(cageLine)
        addChild(leftFighter)
        addChild(rightFighter)
        layoutFighters(animated: false)
    }

    override func didChangeSize(_ oldSize: CGSize) {
        guard leftFighter.parent != nil else { return }
        layoutFighters(animated: false)
    }

    private func homes(for distance: Distance) -> (CGPoint, CGPoint) {
        let spread: CGFloat
        switch distance {
        case .long: spread = 0.28
        case .mid: spread = 0.19
        case .close: spread = 0.11
        }
        let y = size.height * 0.46
        return (
            CGPoint(x: size.width * (0.5 - spread), y: y),
            CGPoint(x: size.width * (0.5 + spread), y: y)
        )
    }

    private func layoutFighters(animated: Bool) {
        let (lh, rh) = homes(for: currentDistance)
        leftHome = lh
        rightHome = rh

        let path = CGMutablePath()
        path.move(to: CGPoint(x: 16, y: size.height * 0.18))
        path.addLine(to: CGPoint(x: size.width - 16, y: size.height * 0.18))
        cageLine.path = path

        if animated {
            leftFighter.run(.move(to: leftHome, duration: 0.20))
            rightFighter.run(.move(to: rightHome, duration: 0.20))
        } else {
            leftFighter.position = leftHome
            rightFighter.position = rightHome
        }
    }

    func resetPositions(distance: Distance = .long) {
        currentDistance = distance
        leftFighter.removeAllActions()
        rightFighter.removeAllActions()
        leftFighter.zRotation = 0
        rightFighter.zRotation = 0
        leftFighter.color = .systemGreen
        rightFighter.color = .systemRed
        layoutFighters(animated: false)
    }

    func playExchange(log: ExchangeLog) {
        currentDistance = log.stateAfter.distance
        let (lh, rh) = homes(for: currentDistance)
        leftHome = lh
        rightHome = rh

        leftFighter.color = log.stateAfter.a.isRocked ? .systemYellow : .systemGreen
        rightFighter.color = log.stateAfter.b.isRocked ? .systemOrange : .systemRed

        if log.a.damageDealt > 0 && log.a.damageDealt >= log.b.damageDealt {
            attack(from: .left, knockedOut: log.finish?.winner == .a)
        } else if log.b.damageDealt > 0 {
            attack(from: .right, knockedOut: log.finish?.winner == .b)
        } else {
            layoutFighters(animated: true)
        }
    }

    func attack(from side: Side, knockedOut: Bool = false) {
        let attacker = side == .left ? leftFighter : rightFighter
        let defender = side == .left ? rightFighter : leftFighter
        let home = side == .left ? leftHome : rightHome
        let defenderHome = side == .left ? rightHome : leftHome
        let dir: CGFloat = side == .left ? 1 : -1
        let impactX = (leftHome.x + rightHome.x) / 2 - dir * 32

        let windUp = SKAction.moveBy(x: -dir * 12, y: 0, duration: 0.08)
        let lunge = SKAction.move(to: CGPoint(x: impactX, y: home.y), duration: 0.07)
        let hitStop = SKAction.wait(forDuration: 0.07)
        let recoil = SKAction.move(to: home, duration: 0.22)

        let flash = SKAction.sequence([
            SKAction.colorize(with: .white, colorBlendFactor: 1, duration: 0.02),
            SKAction.colorize(withColorBlendFactor: 0, duration: 0.14),
        ])
        let defenderReaction: SKAction
        if knockedOut {
            defenderReaction = SKAction.group([
                SKAction.moveBy(x: dir * 28, y: -22, duration: 0.22),
                SKAction.rotate(byAngle: -dir * (.pi / 2), duration: 0.22),
            ])
        } else {
            defenderReaction = SKAction.sequence([
                SKAction.moveBy(x: dir * 16, y: 0, duration: 0.05),
                SKAction.move(to: defenderHome, duration: 0.22),
            ])
        }

        attacker.removeAllActions()
        defender.removeAllActions()
        attacker.run(.sequence([windUp, lunge, hitStop, recoil]))
        defender.run(.sequence([
            SKAction.wait(forDuration: 0.15),
            SKAction.group([flash, defenderReaction]),
        ]))
    }
}
