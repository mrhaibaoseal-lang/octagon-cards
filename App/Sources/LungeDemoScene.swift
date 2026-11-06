import SpriteKit
import FightEngine

/// The scene's own `Side` (left / right) shadows the engine's `Side` (.a / .b) inside the class,
/// so engine sides are always spelled `EngineSide` here. `.a` is the left fighter, `.b` the right one.
private typealias EngineSide = FightEngine.Side

/// L0/L1 Octagon battle scene: standing range adjustments (`.long`, `.mid`, `.close`), takedown transitions,
/// top/bottom ground grappling posture, GnP, sweeps and submission pulses.
///
/// P5-3: the scene no longer animates a whole exchange at once. `BattleSession` feeds it one
/// `ExchangeBeat` at a time through `play(beat:log:duration:)`; every beat animation is sized as a fraction of
/// the beat's duration so it always finishes before the next beat starts. Nothing here uses `SeededRNG`
/// or changes fight state.
final class LungeDemoScene: SKScene {
    enum Side { case left, right }

    private let leftFighter = SKSpriteNode(color: .systemGreen, size: CGSize(width: 56, height: 100))
    private let rightFighter = SKSpriteNode(color: .systemRed, size: CGSize(width: 56, height: 100))
    private var leftHasTexture: Bool = false
    private var rightHasTexture: Bool = false
    private let cageLine = SKShapeNode()
    private let statusLabel = SKLabelNode(fontNamed: "Menlo-Bold")
    private let flashOverlay = SKSpriteNode(color: .white, size: .zero)
    private var currentDistance: Distance = .long
    private var currentGround: GroundState? = nil
    private var currentClinch: Bool = false
    private var rockedA = false
    private var rockedB = false
    /// Loser of a standing KO / TKO; stays on the canvas after the fight ends.
    private var downedSide: EngineSide? = nil

    private var isSetUp = false

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.08, green: 0.09, blue: 0.13, alpha: 1)
        scaleMode = .resizeFill
        // The battle page can present this same scene more than once (back to pre-fight and in again);
        // nodes must only be added the first time.
        guard !isSetUp else {
            layoutFighters(animated: false)
            return
        }
        isSetUp = true
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

        flashOverlay.alpha = 0
        flashOverlay.zPosition = 15
        addChild(flashOverlay)

        layoutFighters(animated: false)
    }

    override func didChangeSize(_ oldSize: CGSize) {
        guard leftFighter.parent != nil else { return }
        layoutFighters(animated: false)
    }

    // MARK: - Layout

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

    private func node(_ side: EngineSide) -> SKSpriteNode {
        side == .a ? leftFighter : rightFighter
    }

    /// +1 when the fighter faces right (left corner), -1 when facing left.
    private func dir(_ side: EngineSide) -> CGFloat {
        side == .a ? 1 : -1
    }

    /// Where a fighter stands (and how it is rotated) in the scene's current logical state.
    private func rest(_ side: EngineSide) -> (pos: CGPoint, rot: CGFloat) {
        if let g = currentGround {
            let centerX = size.width * 0.5
            if g.topSide == side {
                return (CGPoint(x: centerX - 6, y: size.height * 0.48), .pi / 2)
            }
            return (CGPoint(x: centerX + 6, y: size.height * 0.30), .pi / 2)
        }
        let (lh, rh) = homes(for: currentDistance)
        var p = side == .a ? lh : rh
        var rot: CGFloat = 0
        if downedSide == side {
            // Pushed away from the winner and lying down.
            let away = dir(side.opposite)
            p.x += away * 28
            p.y -= 22
            rot = -away * (.pi / 2)
        }
        return (p, rot)
    }

    private func layoutFighters(animated: Bool, duration: TimeInterval = 0.22) {
        statusLabel.position = CGPoint(x: size.width * 0.5, y: size.height - 8)
        flashOverlay.size = size
        flashOverlay.position = CGPoint(x: size.width * 0.5, y: size.height * 0.5)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 16, y: size.height * 0.16))
        path.addLine(to: CGPoint(x: size.width - 16, y: size.height * 0.16))
        cageLine.path = path

        for side in [EngineSide.a, EngineSide.b] {
            let n = node(side)
            let r = rest(side)
            if let g = currentGround {
                n.zPosition = (g.topSide == side) ? 2 : 1
            } else {
                n.zPosition = 1
            }
            if animated {
                n.run(.group([
                    .move(to: r.pos, duration: duration),
                    .rotate(toAngle: r.rot, duration: duration),
                ]))
            } else {
                n.position = r.pos
                n.zRotation = r.rot
            }
        }
    }

    // MARK: - Banner

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

    // MARK: - Textures & tint

    func applyFighterTexture(side: Side, pngData: Data) {
        guard !pngData.isEmpty, let image = UIImage(data: pngData) else { return }
        let texture = SKTexture(image: image)
        texture.filteringMode = .nearest
        let targetH: CGFloat = 104
        let aspect = max(0.38, min(0.85, image.size.width / max(1, image.size.height)))
        let targetW = round(targetH * aspect)

        let node = (side == .left) ? leftFighter : rightFighter
        node.texture = texture
        node.size = CGSize(width: targetW, height: targetH)
        node.color = .white
        node.colorBlendFactor = 0.0
        if side == .left {
            leftHasTexture = true
        } else {
            rightHasTexture = true
        }
        applyTintNow()
    }

    private func tintParams(_ side: EngineSide) -> (SKColor, CGFloat) {
        let hasTexture = side == .a ? leftHasTexture : rightHasTexture
        let rocked = side == .a ? rockedA : rockedB
        if rocked {
            return (side == .a ? .systemYellow : .systemOrange, hasTexture ? 0.55 : 1.0)
        }
        if hasTexture {
            return (.white, 0.0)
        }
        return (side == .a ? .systemGreen : .systemRed, 1.0)
    }

    private func applyTintNow() {
        for side in [EngineSide.a, EngineSide.b] {
            let (c, f) = tintParams(side)
            node(side).color = c
            node(side).colorBlendFactor = f
        }
    }

    /// Flash a fighter a solid color, then fade back to its normal (or Rocked) tint.
    private func flashAction(_ side: EngineSide, color: SKColor = .white) -> SKAction {
        let (c, f) = tintParams(side)
        return SKAction.sequence([
            SKAction.colorize(with: color, colorBlendFactor: 1, duration: 0.02),
            SKAction.colorize(with: c, colorBlendFactor: f, duration: 0.14),
        ])
    }

    // MARK: - Resets

    func resetPositions(distance: Distance = .long) {
        speed = 1
        clearEffects()
        downedSide = nil
        rockedA = false
        rockedB = false
        currentDistance = distance
        currentGround = nil
        currentClinch = false
        for n in [leftFighter, rightFighter] {
            n.removeAllActions()
            n.setScale(1)
            n.alpha = 1
        }
        applyTintNow()
        updateBannerText()
        layoutFighters(animated: false)
    }

    /// Jump straight to the final look of an exchange (used when playback finishes or is skipped).
    /// A standing KO / TKO leaves the loser lying on the canvas.
    func settle(to state: FightState, finish: ExchangeFinish?) {
        speed = 1
        clearEffects()
        adoptStructure(state)
        rockedA = state.a.isRocked
        rockedB = state.b.isRocked
        if let fin = finish, fin.reason != .submission, state.ground == nil {
            downedSide = fin.winner.opposite
        } else {
            downedSide = nil
        }
        for n in [leftFighter, rightFighter] {
            n.removeAllActions()
            n.setScale(1)
            n.alpha = 1
        }
        applyTintNow()
        updateBannerText(finish: finish)
        layoutFighters(animated: false)
    }

    /// Called before the first beat of an exchange.
    func beginExchange() {
        speed = 1
        clearEffects()
    }

    private func clearEffects() {
        removeChildren(in: children.filter { $0.name == "floater" })
        flashOverlay.removeAllActions()
        flashOverlay.alpha = 0
    }

    private func adoptStructure(_ state: FightState) {
        currentDistance = state.distance
        currentGround = state.ground
        currentClinch = state.isClinch
    }

    /// Stops whatever the previous beat was doing and puts both fighters on their resting pose.
    private func snapToRest() {
        applyTintNow()
        for side in [EngineSide.a, EngineSide.b] {
            let n = node(side)
            let r = rest(side)
            n.removeAllActions()
            n.position = r.pos
            n.zRotation = r.rot
            n.setScale(1)
            n.alpha = 1
        }
    }

    // MARK: - Floating text & screen flash

    private func floaterPoint(_ side: EngineSide) -> CGPoint {
        let p = rest(side).pos
        return CGPoint(x: p.x, y: p.y + (currentGround == nil ? 74 : 60))
    }

    private func spawnFloater(
        _ text: String,
        at point: CGPoint,
        color: SKColor,
        big: Bool = false,
        delay: TimeInterval = 0
    ) {
        let fontSize: CGFloat = big ? 26 : 16
        let container = SKNode()
        container.name = "floater"
        container.zPosition = 20
        container.alpha = 0
        container.setScale(0.6)

        let shadow = SKLabelNode(fontNamed: "Menlo-Bold")
        shadow.text = text
        shadow.fontSize = fontSize
        shadow.fontColor = SKColor(white: 0, alpha: 0.85)
        shadow.verticalAlignmentMode = .center
        shadow.position = CGPoint(x: 1.5, y: -1.5)
        container.addChild(shadow)

        let label = SKLabelNode(fontNamed: "Menlo-Bold")
        label.text = text
        label.fontSize = fontSize
        label.fontColor = color
        label.verticalAlignmentMode = .center
        container.addChild(label)

        container.position = CGPoint(
            x: min(max(point.x, 44), max(44, size.width - 44)),
            y: min(point.y, size.height - 30)
        )
        addChild(container)
        container.run(.sequence([
            .wait(forDuration: delay),
            .group([
                .fadeIn(withDuration: 0.04),
                .scale(to: big ? 1.25 : 1.0, duration: 0.10),
            ]),
            .group([
                .moveBy(x: 0, y: 30, duration: 0.8),
                .sequence([.wait(forDuration: 0.5), .fadeOut(withDuration: 0.3)]),
            ]),
            .removeFromParent(),
        ]))
    }

    private func flashScreen(alpha: CGFloat, delay: TimeInterval = 0) {
        flashOverlay.removeAllActions()
        flashOverlay.run(.sequence([
            .wait(forDuration: delay),
            .fadeAlpha(to: alpha, duration: 0.02),
            .fadeAlpha(to: 0, duration: 0.18),
        ]))
    }

    // MARK: - Beat playback

    /// Plays one beat of an exchange. `duration` is the real time the beat stays on screen.
    func play(beat: ExchangeBeat, log: ExchangeLog, duration: TimeInterval) {
        // Slow motion for the finishing blow; it stays on through the finish beat.
        if BattlePlayback.isFinishingBlow(beat, in: log) {
            speed = CGFloat(BattlePlayback.finishSlowMotion)
        }
        // All animation lengths below are in scene time, so scale the real duration by the scene speed.
        let d = max(0.1, duration * Double(speed))

        rockedA = beat.display.a.isRocked
        rockedB = beat.display.b.isRocked
        snapToRest()

        let grounded = currentGround != nil

        switch beat.kind {
        case .reveal:
            for side in [EngineSide.a, EngineSide.b] {
                node(side).run(.sequence([
                    .moveBy(x: 0, y: 6, duration: 0.2 * d),
                    .moveBy(x: 0, y: -6, duration: 0.2 * d),
                ]))
            }

        case .action:
            if let side = beat.actor {
                // Ready stance: lean back a little, then settle.
                let lean: CGFloat = grounded ? 0 : -dir(side) * 8
                node(side).run(.sequence([
                    .moveBy(x: lean, y: grounded ? 6 : 0, duration: 0.35 * d),
                    .move(to: rest(side).pos, duration: 0.35 * d),
                ]))
            }

        case .hit:
            playHit(beat, d: d)

        case .blocked:
            playBlocked(beat, d: d)

        case .dodged:
            playDodged(beat, d: d)

        case .missed:
            if let side = beat.actor {
                if grounded {
                    bob(side, d: d)
                } else {
                    whiffLunge(side, reach: 40, d: d)
                }
                spawnFloater("落空", at: floaterPoint(side), color: SKColor(white: 0.8, alpha: 1), delay: 0.3 * d)
            }

        case .feint:
            playFeint(beat, d: d)

        case .move:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.5 * d))

        case .takedown:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("抱摔!", at: centerPoint, color: .systemCyan, big: true, delay: 0.1 * d)
            flashScreen(alpha: 0.16, delay: 0.1 * d)

        case .positionAdvance:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("壓制升級", at: centerPoint, color: .systemTeal, delay: 0.1 * d)

        case .sweep:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("翻身反轉!", at: centerPoint, color: .systemMint, big: true, delay: 0.1 * d)

        case .standUp:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("起身", at: centerPoint, color: .systemMint, delay: 0.1 * d)

        case .submissionStart:
            adoptStructure(log.stateAfter)
            updateBannerText()
            pulse(d: d, scale: 1.06)
            spawnFloater("鎖技起手", at: centerPoint, color: .systemYellow, delay: 0.05 * d)

        case .submissionLock:
            adoptStructure(log.stateAfter)
            updateBannerText()
            pulse(d: d, scale: 1.10)
            spawnFloater("深鎖!", at: centerPoint, color: .systemOrange, big: true, delay: 0.05 * d)
            flashScreen(alpha: 0.14, delay: 0.05 * d)

        case .submissionEscape:
            adoptStructure(log.stateAfter)
            updateBannerText()
            pulse(d: d, scale: 1.06)
            spawnFloater("脫困!", at: centerPoint, color: .systemGreen, delay: 0.05 * d)

        case .rocked:
            if let side = beat.target {
                let wobble = SKAction.sequence([
                    .moveBy(x: 5, y: 0, duration: 0.08 * d),
                    .moveBy(x: -10, y: 0, duration: 0.16 * d),
                    .moveBy(x: 10, y: 0, duration: 0.16 * d),
                    .moveBy(x: -5, y: 0, duration: 0.08 * d),
                ])
                node(side).run(wobble)
                spawnFloater("ROCKED!", at: floaterPoint(side), color: .systemOrange, big: true)
                flashScreen(alpha: 0.12)
            }

        case .cut:
            if let side = beat.target {
                node(side).run(flashAction(side, color: .systemRed))
                spawnFloater("割傷", at: floaterPoint(side), color: .systemRed)
            }

        case .interrupted:
            if let side = beat.actor {
                node(side).run(.sequence([
                    .moveBy(x: -dir(side) * 8, y: 0, duration: 0.15 * d),
                    .move(to: rest(side).pos, duration: 0.3 * d),
                ]))
                spawnFloater("被打斷", at: floaterPoint(side), color: SKColor(white: 0.8, alpha: 1))
            }

        case .refereeStandUp:
            adoptStructure(log.stateAfter)
            updateBannerText(refereeStandUp: true)
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("裁判分開", at: centerPoint, color: .systemCyan, delay: 0.1 * d)

        case .clinch:
            adoptStructure(log.stateAfter)
            updateBannerText()
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            spawnFloater("纏鬥", at: centerPoint, color: .systemOrange, delay: 0.1 * d)

        case .cagePressure:
            if let side = beat.target {
                let away = dir(side.opposite)
                node(side).run(.sequence([
                    .moveBy(x: away * 10, y: 0, duration: 0.25 * d),
                    .move(to: rest(side).pos, duration: 0.3 * d),
                ]))
                spawnFloater("貼籠", at: floaterPoint(side), color: SKColor(white: 0.85, alpha: 1))
            }

        case .recover:
            if let side = beat.actor {
                spawnFloater("回神", at: floaterPoint(side), color: .systemGreen)
            }

        case .finish:
            playFinish(log: log, d: d)
        }
    }

    private var centerPoint: CGPoint {
        CGPoint(x: size.width * 0.5, y: size.height * 0.72)
    }

    // MARK: Beat animations

    private func damageText(_ amount: Double) -> String {
        "-\(Int(amount.rounded()))"
    }

    private func bob(_ side: EngineSide, d: TimeInterval) {
        node(side).run(.sequence([
            .moveBy(x: 0, y: 12, duration: 0.15 * d),
            .moveBy(x: 0, y: -12, duration: 0.10 * d),
        ]))
    }

    private func pulse(d: TimeInterval, scale: CGFloat) {
        let action = SKAction.sequence([
            .scale(to: scale, duration: 0.15 * d),
            .scale(to: 1.0, duration: 0.15 * d),
        ])
        leftFighter.run(action)
        rightFighter.run(action)
    }

    /// Lunge toward the middle and come back without touching anyone.
    private func whiffLunge(_ side: EngineSide, reach: CGFloat, d: TimeInterval) {
        let home = rest(side).pos
        let mid = (rest(.a).pos.x + rest(.b).pos.x) / 2
        let target = CGPoint(x: mid - dir(side) * reach, y: home.y)
        node(side).run(.sequence([
            .moveBy(x: -dir(side) * 8, y: 0, duration: 0.15 * d),
            .move(to: target, duration: 0.12 * d),
            .move(to: home, duration: 0.35 * d),
        ]))
    }

    private func playHit(_ beat: ExchangeBeat, d: TimeInterval) {
        guard let atk = beat.actor else { return }
        let def = beat.target ?? atk.opposite
        let heavy = beat.isHeavy
        let stop = heavy ? BattlePlayback.heavyHitStop : 0.03
        let text = damageText(beat.amount)
        let color: SKColor = heavy ? .systemYellow : .systemOrange

        if currentGround != nil {
            // Ground & pound: posture up, then slam down.
            let posture = SKAction.moveBy(x: 0, y: 18, duration: 0.12 * d)
            let slam = SKAction.moveBy(x: 0, y: -18, duration: 0.08 * d)
            node(atk).run(.sequence([.wait(forDuration: 0.15 * d), posture, slam]))
            node(def).run(.sequence([.wait(forDuration: 0.35 * d), flashAction(def)]))
            spawnFloater(text, at: floaterPoint(def), color: color, big: heavy, delay: 0.35 * d)
            if heavy { flashScreen(alpha: 0.22, delay: 0.35 * d) }
            return
        }

        let home = rest(atk).pos
        let defHome = rest(def).pos
        let mid = (rest(.a).pos.x + rest(.b).pos.x) / 2
        let impact = CGPoint(x: mid - dir(atk) * 32, y: home.y)
        let hitAt = 0.30 * d

        node(atk).run(.sequence([
            .moveBy(x: -dir(atk) * 12, y: 0, duration: 0.18 * d),
            .move(to: impact, duration: 0.12 * d),
            .wait(forDuration: stop),
            .move(to: home, duration: 0.35 * d),
        ]))
        node(def).run(.sequence([
            .wait(forDuration: hitAt + stop),
            .group([
                flashAction(def),
                .sequence([
                    .moveBy(x: dir(atk) * (heavy ? 26 : 14), y: 0, duration: 0.12 * d),
                    .move(to: defHome, duration: 0.35 * d),
                ]),
            ]),
        ]))
        spawnFloater(text, at: floaterPoint(def), color: color, big: heavy, delay: hitAt)
        if heavy { flashScreen(alpha: 0.22, delay: hitAt) }
    }

    private func playBlocked(_ beat: ExchangeBeat, d: TimeInterval) {
        guard let atk = beat.actor else { return }
        let def = beat.target ?? atk.opposite
        let label = beat.amount >= 0.5 ? "格擋 \(damageText(beat.amount))" : "格擋"

        if currentGround == nil {
            let home = rest(atk).pos
            let defHome = rest(def).pos
            let mid = (rest(.a).pos.x + rest(.b).pos.x) / 2
            let impact = CGPoint(x: mid - dir(atk) * 24, y: home.y)
            node(atk).run(.sequence([
                .moveBy(x: -dir(atk) * 10, y: 0, duration: 0.18 * d),
                .move(to: impact, duration: 0.12 * d),
                .wait(forDuration: 0.03),
                .move(to: home, duration: 0.35 * d),
            ]))
            node(def).run(.sequence([
                .wait(forDuration: 0.30 * d),
                .group([
                    flashAction(def, color: .systemCyan),
                    .sequence([
                        .moveBy(x: dir(atk) * 6, y: 0, duration: 0.10 * d),
                        .move(to: defHome, duration: 0.30 * d),
                    ]),
                ]),
            ]))
        } else {
            bob(atk, d: d)
            node(def).run(.sequence([.wait(forDuration: 0.30 * d), flashAction(def, color: .systemCyan)]))
        }
        spawnFloater(label, at: floaterPoint(def), color: .systemCyan, delay: 0.30 * d)
    }

    private func playDodged(_ beat: ExchangeBeat, d: TimeInterval) {
        guard let evader = beat.actor else { return }
        let atk = beat.target ?? evader.opposite

        if currentGround == nil {
            whiffLunge(atk, reach: 20, d: d)
            let evaderHome = rest(evader).pos
            node(evader).run(.sequence([
                .wait(forDuration: 0.22 * d),
                .group([
                    .fadeAlpha(to: 0.5, duration: 0.08 * d),
                    .moveBy(x: dir(atk) * 22, y: 10, duration: 0.10 * d),
                ]),
                .group([
                    .fadeAlpha(to: 1.0, duration: 0.15 * d),
                    .move(to: evaderHome, duration: 0.2 * d),
                ]),
            ]))
        } else {
            bob(atk, d: d)
            node(evader).run(.sequence([
                .wait(forDuration: 0.22 * d),
                .fadeAlpha(to: 0.5, duration: 0.08 * d),
                .fadeAlpha(to: 1.0, duration: 0.15 * d),
            ]))
        }
        spawnFloater("閃避!", at: floaterPoint(evader), color: .systemMint, delay: 0.25 * d)
    }

    private func playFeint(_ beat: ExchangeBeat, d: TimeInterval) {
        guard let side = beat.actor else { return }
        let foe = beat.target ?? side.opposite
        let fakeOut = SKAction.sequence([
            .moveBy(x: dir(side) * 14, y: 0, duration: 0.10 * d),
            .moveBy(x: -dir(side) * 14, y: 0, duration: 0.10 * d),
        ])
        node(side).run(.sequence([fakeOut, fakeOut, .move(to: rest(side).pos, duration: 0.05 * d)]))
        node(foe).run(.sequence([
            .wait(forDuration: 0.25 * d),
            .moveBy(x: dir(side) * 8, y: 0, duration: 0.08 * d),
            .move(to: rest(foe).pos, duration: 0.2 * d),
        ]))
        spawnFloater("佯攻!", at: floaterPoint(foe), color: .systemPurple, delay: 0.25 * d)
    }

    private func playFinish(log: ExchangeLog, d: TimeInterval) {
        guard let fin = log.finish else { return }
        adoptStructure(log.stateAfter)
        let loser = fin.winner.opposite
        let standing = currentGround == nil

        if fin.reason != .submission && standing {
            downedSide = loser
            layoutFighters(animated: true, duration: 0.5 * d)
        } else {
            layoutFighters(animated: true, duration: min(0.25, 0.4 * d))
            if fin.reason == .submission { pulse(d: d, scale: 1.08) }
        }

        let headline: String
        switch fin.reason {
        case .ko: headline = "KO!"
        case .tkoBody, .tkoLegs: headline = "TKO!"
        case .tkoDoctor: headline = "醫生叫停"
        case .submission: headline = "TAP!"
        }
        updateBannerText(finish: fin)
        spawnFloater(headline, at: centerPoint, color: .systemYellow, big: true, delay: 0.05 * d)
        flashScreen(alpha: 0.30)
    }
}
