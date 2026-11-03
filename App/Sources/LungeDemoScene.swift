import SpriteKit
import FightEngine

/// L0/L1 Octagon battle scene: supports standing range adjustments (`.long`, `.mid`, `.close`),
/// takedown transitions, top/bottom ground grappling posture, GnP animations, sweeps, and submission lock states.
final class LungeDemoScene: SKScene {
    enum Side { case left, right }

    private let leftFighter = SKSpriteNode(color: .systemGreen, size: CGSize(width: 56, height: 100))
    private let rightFighter = SKSpriteNode(color: .systemRed, size: CGSize(width: 56, height: 100))
    private let cageLine = SKShapeNode()
    private let statusLabel = SKLabelNode(fontNamed: "Menlo-Bold")
    private var currentDistance: Distance = .long
    private var currentGround: GroundState? = nil
    private var currentClinch: Bool = false
    private var leftHome = CGPoint.zero
    private var rightHome = CGPoint.zero

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.08, green: 0.09, blue: 0.13, alpha: 1)
        scaleMode = .resizeFill
        cageLine.strokeColor = SKColor(white: 1.0, alpha: 0.14)
        cageLine.lineWidth = 2
        addChild(cageLine)

        statusLabel.fontSize = 11
        statusLabel.fontColor = SKColor(white: 0.85, alpha: 1.0)
        statusLabel.horizontalAlignmentMode = .center
        statusLabel.verticalAlignmentMode = .top
        addChild(statusLabel)

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
        let y = size.height * 0.45
        return (
            CGPoint(x: size.width * (0.5 - spread), y: y),
            CGPoint(x: size.width * (0.5 + spread), y: y)
        )
    }

    private func updateBannerText(refereeStandUp: Bool = false, finish: ExchangeFinish? = nil) {
        if let fin = finish {
            let winnerText = fin.winner == .a ? "PLAYER A" : "AI B"
            statusLabel.text = "🏁 \(winnerText) WINS BY \(fin.reason.rawValue.uppercased())!"
            statusLabel.fontColor = .systemYellow
            return
        }
        if refereeStandUp {
            statusLabel.text = "🔔 REFEREE: WORK! STAND UP TO LONG RANGE"
            statusLabel.fontColor = .systemCyan
            return
        }
        if let g = currentGround {
            let topText = g.topSide == .a ? "🟢玩家上位" : "🔴AI上位"
            if let sub = g.activeSubmission {
                let stageText = sub.stage == .lockedIn ? "🔥階段2深鎖 LOCKED IN!" : "階段1抓把 SETUP"
                statusLabel.text = "🔒 \(sub.name) (\(stageText)) · \(topText)"
                statusLabel.fontColor = sub.stage == .lockedIn ? .systemOrange : .systemYellow
            } else {
                statusLabel.text = "🥋 \(g.position.displayName) · \(topText)"
                statusLabel.fontColor = .systemTeal
            }
        } else {
            switch currentDistance {
            case .long:
                statusLabel.text = "🥊 站立 · 遠距離 LONG RANGE"
            case .mid:
                statusLabel.text = "🥊 站立 · 中距離 MID RANGE"
            case .close:
                statusLabel.text = currentClinch
                    ? "🤼 站立 · 籠邊纏抱 / 泰拳箍頸 CLINCH"
                    : "🥊 站立 · 近距離 / 籠邊 CLOSE RANGE"
            }
            statusLabel.fontColor = SKColor(white: 0.85, alpha: 1.0)
        }
    }

    private func layoutFighters(animated: Bool) {
        statusLabel.position = CGPoint(x: size.width * 0.5, y: size.height - 8)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 16, y: size.height * 0.16))
        path.addLine(to: CGPoint(x: size.width - 16, y: size.height * 0.16))
        cageLine.path = path

        if let g = currentGround {
            let centerX = size.width * 0.5
            let bottomY = size.height * 0.30
            let topY = size.height * 0.48
            let topNode = (g.topSide == .a) ? leftFighter : rightFighter
            let bottomNode = (g.topSide == .a) ? rightFighter : leftFighter
            topNode.zPosition = 2
            bottomNode.zPosition = 1

            let topTarget = CGPoint(x: centerX - 6, y: topY)
            let bottomTarget = CGPoint(x: centerX + 6, y: bottomY)
            let rot: CGFloat = .pi / 2

            if animated {
                topNode.run(.group([
                    .move(to: topTarget, duration: 0.22),
                    .rotate(toAngle: rot, duration: 0.22),
                ]))
                bottomNode.run(.group([
                    .move(to: bottomTarget, duration: 0.22),
                    .rotate(toAngle: rot, duration: 0.22),
                ]))
            } else {
                topNode.position = topTarget
                bottomNode.position = bottomTarget
                topNode.zRotation = rot
                bottomNode.zRotation = rot
            }
        } else {
            let (lh, rh) = homes(for: currentDistance)
            leftHome = lh
            rightHome = rh
            leftFighter.zPosition = 1
            rightFighter.zPosition = 1

            if animated {
                leftFighter.run(.group([
                    .move(to: leftHome, duration: 0.20),
                    .rotate(toAngle: 0, duration: 0.20),
                ]))
                rightFighter.run(.group([
                    .move(to: rightHome, duration: 0.20),
                    .rotate(toAngle: 0, duration: 0.20),
                ]))
            } else {
                leftFighter.position = leftHome
                rightFighter.position = rightHome
                leftFighter.zRotation = 0
                rightFighter.zRotation = 0
            }
        }
    }

    func resetPositions(distance: Distance = .long) {
        currentDistance = distance
        currentGround = nil
        currentClinch = false
        leftFighter.removeAllActions()
        rightFighter.removeAllActions()
        leftFighter.color = .systemGreen
        rightFighter.color = .systemRed
        updateBannerText()
        layoutFighters(animated: false)
    }

    func playExchange(log: ExchangeLog) {
        currentDistance = log.stateAfter.distance
        currentGround = log.stateAfter.ground
        currentClinch = log.stateAfter.isClinch
        let (lh, rh) = homes(for: currentDistance)
        leftHome = lh
        rightHome = rh

        leftFighter.color = log.stateAfter.a.isRocked ? .systemYellow : .systemGreen
        rightFighter.color = log.stateAfter.b.isRocked ? .systemOrange : .systemRed
        updateBannerText(refereeStandUp: log.refereeStandUp, finish: log.finish)

        if let g = currentGround {
            // Ground animation (takedown entry, GnP, sweep, or submission squeeze)
            layoutFighters(animated: true)
            let topNode = (g.topSide == .a) ? leftFighter : rightFighter
            let bottomNode = (g.topSide == .a) ? rightFighter : leftFighter
            if log.a.damageDealt > 0 || log.b.damageDealt > 0 {
                // Ground & Pound posture-up and slam
                let posture = SKAction.moveBy(x: 0, y: 18, duration: 0.08)
                let slam = SKAction.moveBy(x: 0, y: -18, duration: 0.06)
                let flash = SKAction.sequence([
                    SKAction.colorize(with: .white, colorBlendFactor: 1, duration: 0.03),
                    SKAction.colorize(withColorBlendFactor: 0, duration: 0.15),
                ])
                topNode.run(.sequence([.wait(forDuration: 0.22), posture, slam]))
                bottomNode.run(.sequence([.wait(forDuration: 0.30), flash]))
            } else if g.activeSubmission != nil {
                // Submission squeeze pulse
                let pulse = SKAction.sequence([
                    SKAction.scale(to: 1.08, duration: 0.10),
                    SKAction.scale(to: 1.0, duration: 0.10),
                ])
                topNode.run(pulse)
                bottomNode.run(pulse)
            }
        } else {
            if log.a.damageDealt > 0 && log.a.damageDealt >= log.b.damageDealt {
                leftFighter.zRotation = 0
                rightFighter.zRotation = 0
                attack(from: .left, knockedOut: log.finish?.winner == .a)
            } else if log.b.damageDealt > 0 {
                leftFighter.zRotation = 0
                rightFighter.zRotation = 0
                attack(from: .right, knockedOut: log.finish?.winner == .b)
            } else {
                layoutFighters(animated: true)
            }
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
