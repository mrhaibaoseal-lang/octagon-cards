/// Presentation timeline for a single exchange (docs/TASKS.md P5-2).
///
/// `ExchangePresentation.build(log:)` converts an already-resolved `ExchangeLog` into an ordered list of
/// beats that the App can reveal one by one (health bars, floating numbers, narration). It is a pure
/// function of the log: it never touches `SeededRNG`, never mutates fight state, and the same log
/// always produces exactly the same beats. Timing (how long each beat lasts) is decided by the App.

// MARK: - Display state

/// Per-fighter values the App needs to draw while a timeline is playing.
public struct ExchangeDisplayCondition: Sendable, Equatable, Hashable {
    public var health: BodyHealth
    public var isRocked: Bool
    public var cutSeverity: Int

    public init(health: BodyHealth, isRocked: Bool, cutSeverity: Int) {
        self.health = health
        self.isRocked = isRocked
        self.cutSeverity = cutSeverity
    }

    public init(_ condition: FighterCondition) {
        self.init(health: condition.health, isRocked: condition.isRocked, cutSeverity: condition.cutSeverity)
    }
}

/// Snapshot of what both fighters should look like right after a beat.
public struct ExchangeDisplayState: Sendable, Equatable, Hashable {
    public var a: ExchangeDisplayCondition
    public var b: ExchangeDisplayCondition

    public init(a: ExchangeDisplayCondition, b: ExchangeDisplayCondition) {
        self.a = a
        self.b = b
    }

    public init(_ state: FightState) {
        self.init(a: ExchangeDisplayCondition(state.a), b: ExchangeDisplayCondition(state.b))
    }

    public subscript(side: Side) -> ExchangeDisplayCondition {
        get { side == .a ? a : b }
        set {
            switch side {
            case .a: a = newValue
            case .b: b = newValue
            }
        }
    }
}

// MARK: - Beats

public enum ExchangeBeatKind: String, Sendable, Equatable, Hashable, CaseIterable {
    /// Both cards are turned face up.
    case reveal
    /// A fighter starts their card (`actor`).
    case action
    /// Damage lands (`actor` hit `target`; see `amount` / `hitTarget`).
    case hit
    /// The defender absorbed the attack; `amount` is chip damage (can be 0).
    case blocked
    /// The defender slipped the attack (`actor` = defender who evaded, `target` = whiffing attacker).
    case dodged
    /// The card had no effect (whiffed, was read, or was neutralised).
    case missed
    /// A feint worked and rattled the opponent.
    case feint
    /// Distance changed or the fighter repositioned.
    case move
    /// Standing takedown landed; the fight goes to the ground.
    case takedown
    /// Top fighter improved position on the ground.
    case positionAdvance
    /// Bottom fighter reversed to the top.
    case sweep
    /// Bottom fighter stood up (or recovered guard).
    case standUp
    /// A submission hold was started (stage 1).
    case submissionStart
    /// A submission hold was locked deeper (stage 2) or finished.
    case submissionLock
    /// The defender escaped or survived a submission step.
    case submissionEscape
    /// The defender is Rocked by the previous hit (`target`).
    case rocked
    /// A cut was opened (`target`).
    case cut
    /// The slower fighter never got to act (`actor` = interrupted fighter).
    case interrupted
    /// Referee stood the fighters up after ground stalling.
    case refereeStandUp
    /// Fighters tied up in a clinch.
    case clinch
    /// A fighter was pushed back onto the fence (`target`).
    case cagePressure
    /// A Rocked fighter recovered (`actor`).
    case recover
    /// The fight ends here (`actor` = winner, `target` = loser). Always the last beat when present.
    case finish
}

public struct ExchangeBeat: Sendable, Equatable, Hashable {
    public var kind: ExchangeBeatKind
    /// Fighter performing the beat (or featured in it); `nil` for neutral beats like `.reveal`.
    public var actor: Side?
    /// Fighter on the receiving end, if any.
    public var target: Side?
    /// Name of the card involved, if any.
    public var cardName: String?
    /// Damage shown for `.hit` / `.blocked` beats (0 otherwise).
    public var amount: Double
    /// Body zone hit by `.hit` / `.blocked` beats.
    public var hitTarget: HitTarget?
    /// True for hits that deserve extra emphasis (hit-stop, bigger floating number).
    public var isHeavy: Bool
    /// Traditional-Chinese commentary line.
    public var narration: String
    /// Health / Rocked / cut state to display right after this beat.
    public var display: ExchangeDisplayState

    public init(
        kind: ExchangeBeatKind,
        actor: Side? = nil,
        target: Side? = nil,
        cardName: String? = nil,
        amount: Double = 0.0,
        hitTarget: HitTarget? = nil,
        isHeavy: Bool = false,
        narration: String,
        display: ExchangeDisplayState
    ) {
        self.kind = kind
        self.actor = actor
        self.target = target
        self.cardName = cardName
        self.amount = amount
        self.hitTarget = hitTarget
        self.isHeavy = isHeavy
        self.narration = narration
        self.display = display
    }
}

// MARK: - Builder

public enum ExchangePresentation {
    /// Damage at or above this value (or any Rocked) is flagged `isHeavy`.
    /// Mirrors the 12-point threshold the engine uses for Rocked checks.
    public static let heavyDamageThreshold = 12.0

    /// Builds the ordered beat list for one exchange.
    ///
    /// Order: reveal → (first fighter: action, result, Rocked / cut, position change) →
    /// (second fighter, or an `.interrupted` beat) → state-only changes (referee stand-up, clinch,
    /// fence, Rocked recovery) → finish. The last beat's `display` always equals `log.stateAfter`.
    ///
    /// - Parameters:
    ///   - nameA / nameB: Names used in the narration. Defaults keep the function usable without fighter data.
    public static func build(log: ExchangeLog, nameA: String = "A 方", nameB: String = "B 方") -> [ExchangeBeat] {
        var builder = Builder(log: log, nameA: nameA, nameB: nameB)
        return builder.run()
    }

    private struct Builder {
        let log: ExchangeLog
        let nameA: String
        let nameB: String
        var display: ExchangeDisplayState
        var beats: [ExchangeBeat] = []

        init(log: ExchangeLog, nameA: String, nameB: String) {
            self.log = log
            self.nameA = nameA
            self.nameB = nameB
            self.display = ExchangeDisplayState(log.stateBefore)
        }

        func name(_ side: Side) -> String { side == .a ? nameA : nameB }

        func zoneName(_ zone: HitTarget) -> String {
            switch zone {
            case .head: "頭部"
            case .body: "軀幹"
            case .legs: "腿部"
            }
        }

        func points(_ value: Double) -> String { "\(Int(value.rounded())) 點" }

        mutating func emit(
            _ kind: ExchangeBeatKind,
            actor: Side? = nil,
            target: Side? = nil,
            card: Card? = nil,
            amount: Double = 0.0,
            hitTarget: HitTarget? = nil,
            isHeavy: Bool = false,
            _ narration: String
        ) {
            beats.append(
                ExchangeBeat(
                    kind: kind,
                    actor: actor,
                    target: target,
                    cardName: card?.name,
                    amount: amount,
                    hitTarget: hitTarget,
                    isHeavy: isHeavy,
                    narration: narration,
                    display: display
                )
            )
        }

        mutating func run() -> [ExchangeBeat] {
            emit(
                .reveal,
                "雙方亮牌：\(nameA)「\(log.a.card.name)」對上 \(nameB)「\(log.b.card.name)」"
            )

            // The side that interrupts someone acts first in the story (only possible on the ground,
            // where the log's `firstSide` is just a speed tie-break).
            var order = [log.firstSide, log.firstSide.opposite]
            if log[order[0]].wasInterrupted && !log[order[1]].wasInterrupted {
                order.swapAt(0, 1)
            }
            for (index, side) in order.enumerated() {
                resolve(side, isFirst: index == 0)
            }

            if let finish = log.finish {
                emitFinish(finish)
            } else {
                emitStateChanges()
            }

            // The timeline always ends on the engine's final state.
            if !beats.isEmpty {
                beats[beats.count - 1].display = ExchangeDisplayState(log.stateAfter)
            }
            return beats
        }

        // MARK: Per-fighter beats

        private mutating func resolve(_ side: Side, isFirst: Bool) {
            let mine = log[side]
            let other = log[side.opposite]
            let foe = side.opposite

            if mine.wasInterrupted {
                if log.finish == nil {
                    emit(.interrupted, actor: side, target: foe, "\(name(side))還來不及出手，\(interruptReason(other))")
                }
                return
            }

            emit(.action, actor: side, card: mine.card, actionText(side: side, log: mine, isFirst: isFirst))

            var hasResult = false
            let before = log.stateBefore

            if let pos = mine.takedownLanded {
                emit(.takedown, actor: side, target: foe, card: mine.card,
                     "\(name(side))抱摔成功！壓制在\(pos.displayName)")
                hasResult = true
            }

            if let stage = mine.submissionStageReached {
                let isFinish = log.finish?.reason == .submission && log.finish?.winner == side
                switch stage {
                case .setup:
                    emit(.submissionStart, actor: side, target: foe, card: mine.card,
                         "\(name(side))纏上「\(mine.card.name)」，開始尋找鎖點")
                case .lockedIn:
                    let text = isFinish
                        ? "\(name(side))把「\(submissionName(side: side, fallback: mine.card))」完全鎖死！"
                        : "\(name(side))鎖得更深了，\(name(foe))岌岌可危！"
                    emit(.submissionLock, actor: side, target: foe, card: mine.card, text)
                }
                hasResult = true
            }

            if mine.submissionEscaped {
                let stillHeld = log.stateAfter.ground?.activeSubmission != nil
                let text = stillHeld
                    ? "\(name(side))勉強撐過這一步，但仍被鎖著"
                    : "\(name(side))成功脫困！"
                emit(.submissionEscape, actor: side, target: foe, card: mine.card, text)
                hasResult = true
            }

            if let pos = mine.sweptToPosition {
                emit(.sweep, actor: side, target: foe, card: mine.card,
                     "\(name(side))掃技翻轉！反壓到\(pos.displayName)")
                hasResult = true
            }

            if let zone = mine.targetHit {
                emitDamage(side: side, mine: mine, other: other, zone: zone)
                hasResult = true
            }

            if mine.stoodUpToStanding {
                emit(.standUp, actor: side, target: foe, card: mine.card, "\(name(side))站起來了，回到站立戰")
                hasResult = true
            } else if let pos = mine.positionAdvancedTo, mine.sweptToPosition == nil {
                let role = before.ground?.role(for: side)
                let text = role == .bottom
                    ? "\(name(side))調整身位，回到\(pos.displayName)"
                    : "\(name(side))推進位置到\(pos.displayName)"
                emit(.positionAdvance, actor: side, target: foe, card: mine.card, text)
                hasResult = true
            }

            if mine.feintSucceeded {
                emit(.feint, actor: side, target: foe, card: mine.card,
                     "\(name(side))的假動作奏效，\(name(foe))被騙得慢了半拍")
                hasResult = true
            }

            if let distance = mine.movedDistanceTo {
                emit(.move, actor: side, card: mine.card, moveText(side: side, from: before.distance, to: distance))
                hasResult = true
            }

            if !hasResult {
                emitNoEffect(side: side, mine: mine, other: other)
            }
        }

        private mutating func emitDamage(side: Side, mine: ExchangeSideLog, other: ExchangeSideLog, zone: HitTarget) {
            let foe = side.opposite
            let damage = mine.damageDealt
            display[foe].health[zone] = display[foe].health[zone] - damage

            let wasBlocked = isBlockedStrike(mine: mine, other: other)
            if wasBlocked {
                emit(.blocked, actor: foe, target: side, card: mine.card, amount: damage, hitTarget: zone,
                     "\(name(foe))擋住了\(name(side))的「\(mine.card.name)」，仍受到\(points(damage))傷害")
                return
            }

            let heavy = damage >= ExchangePresentation.heavyDamageThreshold || mine.inflictedRocked
            let verb = mine.card.type == .counter ? "反擊命中" : "命中"
            emit(.hit, actor: side, target: foe, card: mine.card, amount: damage, hitTarget: zone, isHeavy: heavy,
                 "\(name(side))的「\(mine.card.name)」\(verb)\(name(foe))的\(zoneName(zone))，造成\(points(damage))傷害")

            if mine.inflictedRocked {
                display[foe].isRocked = true
                emit(.rocked, actor: side, target: foe,
                     "\(name(foe))被打得搖搖晃晃（Rocked）！")
            }
            if mine.inflictedCut {
                display[foe].cutSeverity = log.stateAfter[foe].cutSeverity
                emit(.cut, actor: side, target: foe,
                     "\(name(foe))臉上被劃開傷口（流血程度 \(log.stateAfter[foe].cutSeverity)）")
            }
        }

        /// Standing: opponent's block succeeded against a strike. Ground: top GnP into a shell.
        private func isBlockedStrike(mine: ExchangeSideLog, other: ExchangeSideLog) -> Bool {
            if let ground = log.stateBefore.ground {
                let role = ground.role(for: mine.side)
                return role == .top
                    && mine.card.type != .counter
                    && GroundOdds.effectiveTopIntent(for: mine.card) == .gnp
                    && GroundOdds.effectiveBottomIntent(for: other.card) == .shell
                    && !mine.inflictedRocked
            }
            return mine.card.type == .strike
                && !mine.card.isTakedown
                && other.card.type == .block
                && other.succeeded
                && !mine.inflictedRocked
        }

        private mutating func emitNoEffect(side: Side, mine: ExchangeSideLog, other: ExchangeSideLog) {
            guard isOffensive(mine) else { return }
            // During an active submission chain, the start / lock / escape beats already tell the story.
            if log.stateBefore.ground?.activeSubmission != nil { return }
            let foe = side.opposite
            let isAttack = mine.card.type == .strike || mine.card.isTakedown

            if isAttack && other.card.type == .evade && other.succeeded {
                emit(.dodged, actor: foe, target: side, card: other.card,
                     "\(name(foe))閃開了「\(mine.card.name)」，\(name(side))撲了個空")
            } else if mine.card.isTakedown && other.card.type == .block
                        && other.card.tags.contains(.wrestling) && other.succeeded {
                emit(.missed, actor: side, target: foe, card: mine.card,
                     "\(name(foe))及時伸腿防摔，\(name(side))的「\(mine.card.name)」被化解")
            } else if other.card.type == .counter && other.succeeded {
                emit(.missed, actor: side, target: foe, card: mine.card,
                     "\(name(side))的「\(mine.card.name)」被\(name(foe))看穿，準備迎接反擊")
            } else if mine.card.type == .feint {
                emit(.missed, actor: side, target: foe, card: mine.card,
                     "\(name(side))的假動作被看穿了")
            } else {
                emit(.missed, actor: side, target: foe, card: mine.card,
                     "\(name(side))的「\(mine.card.name)」沒有奏效")
            }
        }

        /// True when the card was an attempt to do something to the opponent (so having no effect is notable).
        private func isOffensive(_ mine: ExchangeSideLog) -> Bool {
            if let ground = log.stateBefore.ground {
                switch ground.role(for: mine.side) {
                case .top:
                    let intent = GroundOdds.effectiveTopIntent(for: mine.card)
                    return intent == .advance || intent == .gnp || intent == .submission
                case .bottom:
                    let intent = GroundOdds.effectiveBottomIntent(for: mine.card)
                    return intent == .escape || intent == .sweepOrSub
                }
            }
            return mine.card.type == .strike || mine.card.type == .counter
                || mine.card.type == .feint || mine.card.isTakedown
        }

        // MARK: State-only changes and finish

        private mutating func emitStateChanges() {
            let before = log.stateBefore
            let after = log.stateAfter

            if log.refereeStandUp {
                emit(.refereeStandUp, "裁判見雙方僵持太久，喊停並讓兩人重新站起")
            }

            for side in [Side.a, Side.b] {
                if before[side].isRocked && !after[side].isRocked {
                    display[side].isRocked = false
                    emit(.recover, actor: side, "\(name(side))穩住腳步，從搖晃中恢復")
                }
            }

            if !before.isClinch && after.isClinch {
                emit(.clinch, "雙方纏在一起，進入貼身纏鬥")
            }

            for side in [Side.a, Side.b] where cageRank(after[side].cage) > cageRank(before[side].cage) {
                let text = after[side].cage == .cornered
                    ? "\(name(side))被逼進角落！"
                    : "\(name(side))被逼到鐵網邊"
                emit(.cagePressure, actor: side.opposite, target: side, text)
            }
        }

        private func cageRank(_ cage: CagePosition) -> Int {
            switch cage {
            case .center: 0
            case .againstCage: 1
            case .cornered: 2
            }
        }

        private mutating func emitFinish(_ finish: ExchangeFinish) {
            let winner = finish.winner
            let loser = winner.opposite
            display = ExchangeDisplayState(log.stateAfter)
            let text: String
            switch finish.reason {
            case .ko:
                text = "KO！\(name(winner))擊倒了\(name(loser))，比賽結束！"
            case .tkoBody:
                text = "\(name(loser))軀幹挨了重擊，痛到無法繼續，\(name(winner))以 TKO 獲勝！"
            case .tkoLegs:
                text = "\(name(loser))的腿撐不住了，\(name(winner))以 TKO 獲勝！"
            case .tkoDoctor:
                text = "醫生檢查傷口後叫停比賽，\(name(winner))以醫生終止獲勝！"
            case .submission:
                text = "\(name(loser))拍地認輸（Tap out），\(name(winner))以降伏獲勝！"
            }
            emit(.finish, actor: winner, target: loser, isHeavy: true, text)
        }

        // MARK: Narration helpers

        private func actionText(side: Side, log mine: ExchangeSideLog, isFirst: Bool) -> String {
            let lead = isFirst ? "\(name(side))搶先" : "\(name(side))接著"
            let card = "「\(mine.card.name)」"
            if mine.card.isTakedown { return "\(lead)壓低重心，使出\(card)" }
            switch mine.card.type {
            case .strike: return "\(lead)出手：\(card)"
            case .block: return "\(lead)架起防守：\(card)"
            case .evade: return "\(lead)閃身：\(card)"
            case .counter: return "\(lead)伺機反擊：\(card)"
            case .feint: return "\(lead)虛晃一招：\(card)"
            case .move: return "\(lead)移動：\(card)"
            }
        }

        private func moveText(side: Side, from: Distance, to: Distance) -> String {
            if to > from { return "\(name(side))向前逼近" }
            if to < from { return "\(name(side))拉開距離" }
            return "\(name(side))調整站位"
        }

        private func submissionName(side: Side, fallback: Card) -> String {
            if let hold = log.stateBefore.ground?.activeSubmission, hold.attackerSide == side {
                return hold.name
            }
            return fallback.name
        }

        private func interruptReason(_ other: ExchangeSideLog) -> String {
            if other.inflictedRocked { return "就被打得失神" }
            if other.takedownLanded != nil { return "就被摔倒在地" }
            if other.submissionStageReached != nil { return "就被反鎖住" }
            if other.sweptToPosition != nil { return "就被掃技翻轉" }
            return "就被打斷了"
        }
    }
}
