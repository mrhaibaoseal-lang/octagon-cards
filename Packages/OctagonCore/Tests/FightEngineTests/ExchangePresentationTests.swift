import Testing
@testable import FightEngine

@Suite("Exchange Presentation Timeline (P5-2)")
struct ExchangePresentationTests {
    // MARK: - Helpers

    private let neutralOdds = OddsBreakdown(base: 0.5, finalOdds: 0.5)

    private func sideLog(
        _ side: Side,
        _ card: Card,
        succeeded: Bool = true,
        _ edit: (inout ExchangeSideLog) -> Void = { _ in }
    ) -> ExchangeSideLog {
        var log = ExchangeSideLog(
            side: side, card: card, odds: neutralOdds, roll: succeeded ? 0.1 : 0.9, succeeded: succeeded)
        edit(&log)
        return log
    }

    private func damaged(_ state: FightState, _ side: Side, _ zone: HitTarget, _ amount: Double) -> FightState {
        var next = state
        next[side].health[zone] = next[side].health[zone] - amount
        return next
    }

    private func kinds(_ beats: [ExchangeBeat]) -> [ExchangeBeatKind] { beats.map(\.kind) }

    private func expectEndsOnFinalState(_ beats: [ExchangeBeat], _ log: ExchangeLog) {
        #expect(beats.last?.display == ExchangeDisplayState(log.stateAfter))
    }

    // MARK: - Strikes

    @Test func bothSidesHitProducesTwoHitBeatsInSpeedOrder() {
        let before = FightState(distance: .mid)
        var after = damaged(before, .b, .head, 10.0)
        after = damaged(after, .a, .body, 14.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.jab) { $0.damageDealt = 10.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.bodyHook) { $0.damageDealt = 14.0; $0.targetHit = .body }
        )
        let beats = ExchangePresentation.build(log: log)

        #expect(kinds(beats) == [.reveal, .action, .hit, .action, .hit])
        #expect(beats[1].actor == .a)
        #expect(beats[2].actor == .a && beats[2].target == .b)
        #expect(beats[2].amount == 10.0 && beats[2].hitTarget == .head)
        #expect(!beats[2].isHeavy)
        // After A's hit only B has lost health; A's health drops on B's beat.
        #expect(beats[2].display.b.health.head == 90.0)
        #expect(beats[2].display.a.health.body == 100.0)
        #expect(beats[4].actor == .b && beats[4].target == .a)
        #expect(beats[4].isHeavy) // 14 >= heavy threshold
        #expect(beats[4].display.a.health.body == 86.0)
        expectEndsOnFinalState(beats, log)
    }

    @Test func firstSideDecidesWhoIsRevealedFirst() {
        let before = FightState(distance: .mid)
        let after = damaged(before, .a, .head, 8.0)
        let log = ExchangeLog(
            firstSide: .b,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.guardUp, succeeded: false),
            b: sideLog(.b, SampleData.jab) { $0.damageDealt = 8.0; $0.targetHit = .head }
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(beats[1].kind == .action && beats[1].actor == .b)
        #expect(beats[2].kind == .hit && beats[2].actor == .b)
        #expect(beats[3].kind == .action && beats[3].actor == .a)
        expectEndsOnFinalState(beats, log)
    }

    @Test func singleSideHitLeavesPassiveSecondActorWithoutResult() {
        let before = FightState(distance: .mid)
        let after = damaged(before, .b, .head, 9.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.cross) { $0.damageDealt = 9.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.stepIn, succeeded: false)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .hit, .action])
        #expect(beats[3].actor == .b)
        expectEndsOnFinalState(beats, log)
    }

    @Test func counterHitIsNarratedAsCounter() {
        let before = FightState(distance: .mid)
        let after = damaged(before, .a, .head, 13.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.jab, succeeded: false),
            b: sideLog(.b, SampleData.counterHook) { $0.damageDealt = 13.0; $0.targetHit = .head }
        )
        let beats = ExchangePresentation.build(log: log)
        // A's jab is read by the counter (no damage), then B's counter lands.
        #expect(kinds(beats) == [.reveal, .action, .missed, .action, .hit])
        #expect(beats[4].narration.contains("反擊命中"))
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Interrupts

    @Test func rockedFighterIsInterruptedAndSkipsTheirAction() {
        let before = FightState(distance: .mid)
        var after = damaged(before, .b, .head, 20.0)
        after.b.isRocked = true
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.headKick) {
                $0.damageDealt = 20.0; $0.targetHit = .head; $0.inflictedRocked = true
            },
            b: sideLog(.b, SampleData.cross) { $0.wasInterrupted = true }
        )
        let beats = ExchangePresentation.build(log: log)

        #expect(kinds(beats) == [.reveal, .action, .hit, .rocked, .interrupted])
        #expect(beats[2].isHeavy)
        #expect(!beats[2].display.b.isRocked)
        #expect(beats[3].display.b.isRocked)
        #expect(beats[4].actor == .b)
        #expect(beats.filter { $0.kind == .action && $0.actor == .b }.isEmpty)
        expectEndsOnFinalState(beats, log)
    }

    @Test func cutIsShownAsItsOwnBeat() {
        let before = FightState(distance: .close)
        var after = damaged(before, .b, .head, 9.0)
        after.b.cutSeverity = 1
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.closeElbow) {
                $0.damageDealt = 9.0; $0.targetHit = .head; $0.inflictedCut = true
            },
            b: sideLog(.b, SampleData.guardUp, succeeded: false)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .hit, .cut, .action])
        #expect(beats[3].display.b.cutSeverity == 1)
        #expect(beats[2].display.b.cutSeverity == 0)
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Defence

    @Test func successfulEvadeProducesDodgedBeat() {
        let before = FightState(distance: .mid)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: before,
            a: sideLog(.a, SampleData.cross, succeeded: false),
            b: sideLog(.b, SampleData.slip)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .dodged, .action])
        #expect(beats[2].actor == .b && beats[2].target == .a)
        #expect(beats[2].amount == 0.0)
        expectEndsOnFinalState(beats, log)
    }

    @Test func blockedStrikeShowsChipDamageNotAHit() {
        let before = FightState(distance: .mid)
        let after = damaged(before, .b, .head, 3.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.cross) { $0.damageDealt = 3.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.guardUp)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .blocked, .action])
        #expect(beats[2].actor == .b && beats[2].target == .a)
        #expect(beats[2].amount == 3.0)
        #expect(beats[2].display.b.health.head == 97.0)
        expectEndsOnFinalState(beats, log)
    }

    @Test func successfulFeintAndMoveGetTheirOwnBeats() {
        var before = FightState(distance: .mid)
        before.isClinch = false
        var after = before
        after.distance = .close
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.feintStep) { $0.feintSucceeded = true },
            b: sideLog(.b, SampleData.stepIn) { $0.movedDistanceTo = .close }
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .feint, .action, .move])
        #expect(beats[4].narration.contains("逼近"))
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Grappling

    @Test func takedownShowsSlamThenInterruptsTheOtherFighter() {
        let before = FightState(distance: .close)
        var after = damaged(before, .b, .body, 5.0)
        after.ground = GroundState(topSide: .a, position: .halfGuard)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.highCrotchSlam) {
                $0.takedownLanded = .halfGuard; $0.damageDealt = 5.0; $0.targetHit = .body
            },
            b: sideLog(.b, SampleData.cross) { $0.wasInterrupted = true }
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .takedown, .hit, .interrupted])
        #expect(beats[2].narration.contains("半防守"))
        #expect(beats[4].narration.contains("摔倒"))
        expectEndsOnFinalState(beats, log)
    }

    @Test func stuffedTakedownIsMissedNotTakedown() {
        let before = FightState(distance: .close)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: before,
            a: sideLog(.a, SampleData.doubleLeg, succeeded: false),
            b: sideLog(.b, SampleData.sprawl)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .missed, .action])
        #expect(beats[2].narration.contains("防摔"))
        expectEndsOnFinalState(beats, log)
    }

    @Test func sweepIsToldBeforeTheInterruptedTopFighter() {
        var before = FightState(distance: .close)
        before.ground = GroundState(topSide: .a, position: .fullGuard)
        var after = before
        after.ground = GroundState(topSide: .b, position: .sideControl)
        // Top (A) is the faster fighter, yet the story starts with B's sweep.
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.shortGnP, succeeded: false) { $0.wasInterrupted = true },
            b: sideLog(.b, SampleData.butterflySweep) { $0.sweptToPosition = .sideControl }
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .sweep, .interrupted])
        #expect(beats[1].actor == .b)
        #expect(beats[2].actor == .b && beats[2].target == .a)
        #expect(beats[3].actor == .a)
        #expect(beats[3].narration.contains("掃技"))
        expectEndsOnFinalState(beats, log)
    }

    @Test func positionAdvanceAndBottomRecoveryUseDifferentWording() {
        var before = FightState(distance: .close)
        before.ground = GroundState(topSide: .a, position: .halfGuard)
        var advanced = before
        advanced.ground = GroundState(topSide: .a, position: .sideControl)
        let advanceLog = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: advanced,
            a: sideLog(.a, SampleData.kneeSlicePass) { $0.positionAdvancedTo = .sideControl },
            b: sideLog(.b, SampleData.frameLockdown, succeeded: false)
        )
        let advanceBeats = ExchangePresentation.build(log: advanceLog)
        #expect(kinds(advanceBeats) == [.reveal, .action, .positionAdvance, .action])
        #expect(advanceBeats[2].narration.contains("推進"))

        var recovered = before
        recovered.ground = GroundState(topSide: .a, position: .fullGuard)
        let recoverLog = ExchangeLog(
            firstSide: .b,
            stateBefore: before,
            stateAfter: recovered,
            a: sideLog(.a, SampleData.legRide, succeeded: false),
            b: sideLog(.b, SampleData.shrimpEscape) { $0.positionAdvancedTo = .fullGuard }
        )
        let recoverBeats = ExchangePresentation.build(log: recoverLog)
        #expect(recoverBeats.contains { $0.kind == .positionAdvance && $0.actor == .b && $0.narration.contains("回到") })
        expectEndsOnFinalState(recoverBeats, recoverLog)
    }

    @Test func standUpEndsOnStandingState() {
        var before = FightState(distance: .close)
        before.ground = GroundState(topSide: .a, position: .halfGuard)
        var after = damaged(before, .a, .head, 6.0)
        after.ground = nil
        after.distance = .mid
        let log = ExchangeLog(
            firstSide: .b,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.shortGnP, succeeded: false),
            b: sideLog(.b, SampleData.upkickStandup) {
                $0.damageDealt = 6.0; $0.targetHit = .head; $0.stoodUpToStanding = true
            }
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats).contains(.standUp))
        let hitIndex = beats.firstIndex { $0.kind == .hit }
        let standIndex = beats.firstIndex { $0.kind == .standUp }
        #expect(hitIndex != nil && standIndex != nil && hitIndex! < standIndex!)
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Submissions

    private func submissionState(stage: SubmissionStage?) -> FightState {
        var state = FightState(distance: .close)
        let hold = stage.map {
            SubmissionHold(
                cardId: SampleData.rnc.id, name: SampleData.rnc.name,
                category: .choke, attackerSide: .a, stage: $0)
        }
        state.ground = GroundState(topSide: .a, position: .backControl, activeSubmission: hold)
        return state
    }

    @Test func submissionChainStartLockAndEscape() {
        // Start (stage 1)
        let none = submissionState(stage: nil)
        let setup = submissionState(stage: .setup)
        let startLog = ExchangeLog(
            firstSide: .a,
            stateBefore: none,
            stateAfter: setup,
            a: sideLog(.a, SampleData.rnc) { $0.submissionStageReached = .setup },
            b: sideLog(.b, SampleData.shellUp, succeeded: false)
        )
        let startBeats = ExchangePresentation.build(log: startLog)
        #expect(kinds(startBeats) == [.reveal, .action, .submissionStart, .action])
        expectEndsOnFinalState(startBeats, startLog)

        // Lock deeper (stage 2, not finished)
        let locked = submissionState(stage: .lockedIn)
        let lockLog = ExchangeLog(
            firstSide: .a,
            stateBefore: setup,
            stateAfter: locked,
            a: sideLog(.a, SampleData.rnc) { $0.submissionStageReached = .lockedIn },
            b: sideLog(.b, SampleData.shrimpEscape, succeeded: false)
        )
        let lockBeats = ExchangePresentation.build(log: lockLog)
        #expect(kinds(lockBeats) == [.reveal, .action, .submissionLock, .action])
        #expect(lockBeats[2].narration.contains("更深"))

        // Defender escapes completely
        var freed = setup
        freed.ground?.activeSubmission = nil
        let escapeLog = ExchangeLog(
            firstSide: .a,
            stateBefore: setup,
            stateAfter: freed,
            a: sideLog(.a, SampleData.rnc, succeeded: false),
            b: sideLog(.b, SampleData.shrimpEscape) { $0.submissionEscaped = true }
        )
        let escapeBeats = ExchangePresentation.build(log: escapeLog)
        // The escape beat already explains the failed attack, so no extra "missed" beat.
        #expect(kinds(escapeBeats) == [.reveal, .action, .action, .submissionEscape])
        #expect(escapeBeats[3].narration.contains("脫困"))
        expectEndsOnFinalState(escapeBeats, escapeLog)

        // Survives but stays held (stage 2 -> stage 1)
        let survivedLog = ExchangeLog(
            firstSide: .a,
            stateBefore: locked,
            stateAfter: setup,
            a: sideLog(.a, SampleData.rnc, succeeded: false),
            b: sideLog(.b, SampleData.frameLockdown) { $0.submissionEscaped = true }
        )
        let survivedBeats = ExchangePresentation.build(log: survivedLog)
        #expect(survivedBeats.last?.narration.contains("仍被鎖") == true)
    }

    @Test func submissionFinishEndsWithTapOut() {
        let locked = submissionState(stage: .lockedIn)
        var after = locked
        after.b.momentum = 0
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: locked,
            stateAfter: after,
            a: sideLog(.a, SampleData.rnc) { $0.submissionStageReached = .lockedIn },
            b: sideLog(.b, SampleData.shrimpEscape, succeeded: false) { $0.wasInterrupted = true },
            finish: ExchangeFinish(winner: .a, reason: .submission)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .submissionLock, .finish])
        #expect(beats[2].narration.contains("完全鎖死"))
        #expect(beats[3].actor == .a && beats[3].target == .b)
        #expect(beats[3].narration.contains("Tap out"))
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Referee and state-only changes

    @Test func refereeStandUpComesAfterBothFightersAct() {
        var before = FightState(distance: .close)
        before.ground = GroundState(topSide: .a, position: .fullGuard, stallCount: 2)
        var after = before
        after.ground = nil
        after.distance = .long
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.legRide, succeeded: false),
            b: sideLog(.b, SampleData.frameLockdown, succeeded: false),
            refereeStandUp: true
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .action, .refereeStandUp])
        #expect(beats[3].narration.contains("裁判"))
        expectEndsOnFinalState(beats, log)
    }

    @Test func rockedRecoveryClinchAndFenceAreReportedFromStateDiff() {
        var before = FightState(distance: .close)
        before.a.isRocked = true
        var after = before
        after.a.isRocked = false
        after.isClinch = true
        after.b.cage = .cornered
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.guardUp),
            b: sideLog(.b, SampleData.dirtyBoxing, succeeded: false)
        )
        let beats = ExchangePresentation.build(log: log)
        let tail = kinds(beats).suffix(3)
        #expect(Array(tail) == [.recover, .clinch, .cagePressure])
        let recover = beats.first { $0.kind == .recover }
        #expect(recover?.display.a.isRocked == false)
        let fence = beats.last
        #expect(fence?.actor == .a && fence?.target == .b)
        #expect(fence?.narration.contains("角落") == true)
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Finishes

    @Test func koEndsOnFinishBeatAndSuppressesInterruptedBeat() {
        let before = FightState(distance: .mid, b: FighterCondition(health: BodyHealth(head: 10.0)))
        let after = damaged(before, .b, .head, 25.0)
        #expect(after.b.health.head == 0.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.headKick) { $0.damageDealt = 25.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.cross) { $0.wasInterrupted = true },
            finish: ExchangeFinish(winner: .a, reason: .ko)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .hit, .finish])
        #expect(beats[2].display.b.health.head == 0.0)
        #expect(beats[3].narration.contains("KO"))
        #expect(beats[3].actor == .a && beats[3].target == .b)
        expectEndsOnFinalState(beats, log)
    }

    @Test func foldingFinishCorrectsHealthOnTheFinishBeat() {
        // Body TKO: the engine zeroes the body pool even though the last hit only did 12 damage.
        let before = FightState(distance: .close, b: FighterCondition(health: BodyHealth(body: 40.0)))
        var after = damaged(before, .b, .body, 12.0)
        after.b.health.body = 0.0
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.bodyHook) { $0.damageDealt = 12.0; $0.targetHit = .body },
            b: sideLog(.b, SampleData.cross) { $0.wasInterrupted = true },
            finish: ExchangeFinish(winner: .a, reason: .tkoBody)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(beats[2].kind == .hit && beats[2].display.b.health.body == 28.0)
        #expect(beats.last?.kind == .finish)
        #expect(beats.last?.display.b.health.body == 0.0)
        expectEndsOnFinalState(beats, log)
    }

    @Test func secondFighterCanFinishAfterTakingAHit() {
        let before = FightState(distance: .mid, a: FighterCondition(health: BodyHealth(legs: 8.0)))
        var after = damaged(before, .b, .head, 6.0)
        after = damaged(after, .a, .legs, 20.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.jab) { $0.damageDealt = 6.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.calfKick) { $0.damageDealt = 20.0; $0.targetHit = .legs },
            finish: ExchangeFinish(winner: .b, reason: .tkoLegs)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .hit, .action, .hit, .finish])
        #expect(beats.last?.actor == .b)
        #expect(beats.last?.narration.contains("TKO") == true)
    }

    @Test func doctorStoppageAfterCut() {
        let before = FightState(distance: .close)
        var after = damaged(before, .b, .head, 11.0)
        after.b.cutSeverity = 2
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.closeElbow) {
                $0.damageDealt = 11.0; $0.targetHit = .head; $0.inflictedCut = true
            },
            b: sideLog(.b, SampleData.cross) { $0.wasInterrupted = true },
            finish: ExchangeFinish(winner: .a, reason: .tkoDoctor)
        )
        let beats = ExchangePresentation.build(log: log)
        #expect(kinds(beats) == [.reveal, .action, .hit, .cut, .finish])
        #expect(beats.last?.narration.contains("醫生") == true)
        expectEndsOnFinalState(beats, log)
    }

    // MARK: - Names, determinism, engine-driven invariants

    @Test func fighterNamesAppearInNarration() {
        let before = FightState(distance: .mid)
        let after = damaged(before, .b, .head, 9.0)
        let log = ExchangeLog(
            firstSide: .a,
            stateBefore: before,
            stateAfter: after,
            a: sideLog(.a, SampleData.cross) { $0.damageDealt = 9.0; $0.targetHit = .head },
            b: sideLog(.b, SampleData.slip, succeeded: false)
        )
        let named = ExchangePresentation.build(log: log, nameA: "麥克", nameB: "傑克")
        #expect(named[0].narration.contains("麥克") && named[0].narration.contains("傑克"))
        #expect(named[2].narration.contains("麥克") && named[2].narration.contains("傑克"))
        let plain = ExchangePresentation.build(log: log)
        #expect(plain[0].narration.contains("A 方"))
        // Names only change wording, never structure.
        #expect(kinds(named) == kinds(plain))
        #expect(named.map(\.display) == plain.map(\.display))
    }

    @Test func sameLogAlwaysProducesIdenticalBeats() {
        var rng = SeededRNG(seed: 4242)
        let result = resolveExchange(
            a: FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .a),
            b: FighterPlay(fighter: SampleData.wrestler, card: SampleData.counterHook, side: .b),
            state: FightState(distance: .mid),
            rng: &rng
        )
        let first = ExchangePresentation.build(log: result.log)
        let second = ExchangePresentation.build(log: result.log)
        #expect(first == second)
        #expect(!first.isEmpty)
    }

    private func checkInvariants(_ log: ExchangeLog) {
        // Collect problems and assert once per log, so thousands of logs stay fast.
        var problems: [String] = []
        let beats = ExchangePresentation.build(log: log)
        if beats != ExchangePresentation.build(log: log) { problems.append("not deterministic") }
        if beats.first?.kind != .reveal { problems.append("first beat is not reveal") }
        if beats.first?.display != ExchangeDisplayState(log.stateBefore) { problems.append("first display != stateBefore") }
        if beats.last?.display != ExchangeDisplayState(log.stateAfter) { problems.append("last display != stateAfter") }
        if log.finish != nil {
            if beats.last?.kind != .finish { problems.append("finish log does not end on finish beat") }
            if beats.filter({ $0.kind == .finish }).count != 1 { problems.append("finish beat count != 1") }
        } else if beats.contains(where: { $0.kind == .finish }) {
            problems.append("finish beat without finish")
        }
        // Health never goes back up while the timeline plays.
        for (prev, next) in zip(beats, beats.dropFirst()) {
            for side in Side.allCases {
                for zone in HitTarget.allCases where next.display[side].health[zone] > prev.display[side].health[zone] {
                    problems.append("health rose for \(side) \(zone)")
                }
            }
        }
        for side in Side.allCases {
            let acted = beats.contains { $0.kind == .action && $0.actor == side }
            if log[side].wasInterrupted && acted { problems.append("interrupted \(side) has an action beat") }
            if !log[side].wasInterrupted && !acted { problems.append("\(side) has no action beat") }
        }
        #expect(problems.isEmpty, "\(problems) for \(log.a.card.id) vs \(log.b.card.id)")
    }

    @Test func standingExchangesFromTheRealEngineKeepAllInvariants() {
        let states = [
            FightState(distance: .long),
            FightState(distance: .mid),
            FightState(distance: .close),
            FightState(distance: .close, isClinch: true),
        ]
        for state in states {
            for cardA in SampleData.standingCards {
                for cardB in SampleData.standingCards {
                    for seed in UInt64(1)...2 {
                        var rng = SeededRNG(seed: seed &* 7919 &+ UInt64(cardA.speed + cardB.power))
                        let result = resolveExchange(
                            a: FighterPlay(fighter: SampleData.striker, card: cardA, side: .a),
                            b: FighterPlay(fighter: SampleData.wrestler, card: cardB, side: .b),
                            state: state,
                            rng: &rng
                        )
                        checkInvariants(result.log)
                    }
                }
            }
        }
    }

    @Test func takedownAndGroundExchangesFromTheRealEngineKeepAllInvariants() {
        // Standing takedown attempts against every standing card.
        for cardA in SampleData.takedownBridgeCards {
            for cardB in SampleData.standingCards {
                for seed in UInt64(1)...3 {
                    var rng = SeededRNG(seed: seed)
                    let result = resolveExchange(
                        a: FighterPlay(fighter: SampleData.wrestler, card: cardA, side: .a),
                        b: FighterPlay(fighter: SampleData.striker, card: cardB, side: .b),
                        state: FightState(distance: .close),
                        rng: &rng
                    )
                    checkInvariants(result.log)
                }
            }
        }
        // Ground matrix, including active submissions.
        for position in GroundPosition.allCases {
            for hold in [nil, SubmissionStage.setup, SubmissionStage.lockedIn] {
                var state = FightState(distance: .close)
                let activeHold = hold.map {
                    SubmissionHold(
                        cardId: SampleData.rnc.id, name: SampleData.rnc.name,
                        category: .choke, attackerSide: .a, stage: $0)
                }
                state.ground = GroundState(topSide: .a, position: position, activeSubmission: activeHold)
                for top in SampleData.topGroundCards {
                    for bottom in SampleData.bottomGroundCards {
                        for seed in UInt64(1)...3 {
                            var rng = SeededRNG(seed: seed)
                            let result = resolveExchange(
                                a: FighterPlay(fighter: SampleData.wrestler, card: top, side: .a),
                                b: FighterPlay(fighter: SampleData.bjjFighter, card: bottom, side: .b),
                                state: state,
                                rng: &rng
                            )
                            checkInvariants(result.log)
                        }
                    }
                }
            }
        }
    }

    @Test func buildingBeatsDoesNotChangeEngineResultsForTheSameSeed() {
        // Same seed twice, once with presentation built in between: the sequence of logs must be identical.
        func run(buildBeats: Bool) -> [ExchangeLog] {
            var rng = SeededRNG(seed: 99)
            var state = FightState(distance: .mid)
            var logs: [ExchangeLog] = []
            let cards = [SampleData.jab, SampleData.cross, SampleData.lowKick, SampleData.bodyHook, SampleData.headKick]
            for index in 0..<10 {
                let result = resolveExchange(
                    a: FighterPlay(fighter: SampleData.striker, card: cards[index % cards.count], side: .a),
                    b: FighterPlay(fighter: SampleData.wrestler, card: cards[(index + 2) % cards.count], side: .b),
                    state: state,
                    rng: &rng
                )
                if buildBeats { _ = ExchangePresentation.build(log: result.log) }
                logs.append(result.log)
                state = result.state
                if result.finish != nil { break }
            }
            return logs
        }
        #expect(run(buildBeats: true) == run(buildBeats: false))
    }
}
