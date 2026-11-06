import Foundation
import Observation
import UIKit
import FightEngine

/// One exchange's full commentary, kept for the "previous exchange" banner and the recap sheet (P5-3b).
struct ExchangeRecap: Identifiable {
    let id: Int
    let round: Int
    let exchange: Int
    let lines: [String]
}

/// Owns one sandbox match: selected fighters, engine state, hands, round bookkeeping and the SpriteKit scene.
/// Rules are unchanged from the original `ContentView`; this is only the logic moved out of the view.
@MainActor
@Observable
final class BattleSession {
    // MARK: Selection
    var matchup: SandboxMatchup? = .topuriaVsMakhachev
    var fighterA: Fighter
    var fighterB: Fighter
    var headshotDataA: Data? = nil
    var headshotDataB: Data? = nil

    // MARK: Match state
    var seed: UInt64
    var state = FightState()
    var playerHand: HandManager
    var aiHand: HandManager
    var useFiveCardHandMode: Bool = true
    var currentRound: Int = 1
    var currentExchange: Int = 1
    var roundHistory: [ExchangeLog] = []
    var completedRounds: [RoundLog] = []
    var replayExchanges: [FightReplayExchange] = []
    var matchOutcome: MatchOutcome? = nil
    var decisionType: DecisionType? = nil
    var judgeScorecards: [JudgeScorecard] = []
    var copiedToast: Bool = false

    // MARK: Display state (P5-3)
    // `state` is always the engine's truth and is updated the moment a card is played. Everything the
    // player sees (health bars, ground banner, round counters) follows `displayState`, which the playback
    // advances beat by beat and which snaps back to `state` when the exchange finishes or is skipped.
    var displayState = FightState()
    var shownRound: Int = 1
    var shownExchange: Int = 1
    var shownCompletedRounds: Int = 0
    var isPlaying: Bool = false
    /// Every exchange so far. The newest entry is written the moment a card is played, so while
    /// `isPlaying` it must not be shown; use `visibleRecaps`.
    var battleLog: [ExchangeRecap] = []
    var playbackSpeed: PlaybackSpeed = .standard

    let totalRounds = 3
    let exchangesPerRound = 8

    /// Shared SpriteKit scene; the battle view only presents it.
    let scene = LungeDemoScene(size: CGSize(width: 390, height: 260))

    @ObservationIgnored private var rng: SeededRNG
    private let ai = StyleAI()

    @ObservationIgnored private var playbackTask: Task<Void, Never>?
    @ObservationIgnored private var playbackGeneration = 0
    @ObservationIgnored private var pendingSceneReset = false
    @ObservationIgnored private var pendingFinish: ExchangeFinish?
    @ObservationIgnored private var layoutApplied = false

    private static let playbackSpeedKey = "playbackSpeed"

    func setPlaybackSpeed(_ speed: PlaybackSpeed) {
        playbackSpeed = speed
        UserDefaults.standard.set(speed.rawValue, forKey: Self.playbackSpeedKey)
    }

    static func randomSeed() -> UInt64 {
        UInt64.random(in: 1...999_999)
    }

    init() {
        let a = RealUFCRoster.fighter(id: "ilia-topuria") ?? SampleData.striker
        let b = RealUFCRoster.fighter(id: "islam-makhachev") ?? SampleData.wrestler
        var initRngA = SeededRNG(seed: 2026)
        var initRngB = SeededRNG(seed: 2027)
        let initialSeed = Self.randomSeed()

        fighterA = a
        fighterB = b
        playerHand = HandManager(side: .a, fighter: a, rng: &initRngA)
        aiHand = HandManager(side: .b, fighter: b, rng: &initRngB)
        seed = initialSeed
        rng = SeededRNG(seed: initialSeed)
        if let saved = UserDefaults.standard.string(forKey: Self.playbackSpeedKey),
           let speed = PlaybackSpeed(rawValue: saved) {
            playbackSpeed = speed
        }

        startNewMatch(withSeed: initialSeed)
    }

    // MARK: - Selection (pre-fight)

    func selectMatchup(_ m: SandboxMatchup) {
        matchup = m
        fighterA = m.playerFighter
        fighterB = m.aiFighter
        startNewMatch(withSeed: Self.randomSeed())
    }

    func selectFighterA(_ f: Fighter) {
        matchup = nil
        fighterA = f
        startNewMatch(withSeed: Self.randomSeed())
    }

    func selectFighterB(_ f: Fighter) {
        matchup = nil
        fighterB = f
        startNewMatch(withSeed: Self.randomSeed())
    }

    // MARK: - Derived

    /// Recaps the player may read now: the exchange still playing is held back so nothing leaks early.
    var visibleRecaps: [ExchangeRecap] {
        isPlaying ? Array(battleLog.dropLast()) : battleLog
    }

    var phaseSummaryText: String {
        BattleText.phaseSummary(displayState)
    }

    // MARK: - Match lifecycle

    func startNewMatch(withSeed newSeed: UInt64) {
        cancelPlayback()
        seed = newSeed
        rng = SeededRNG(seed: newSeed)
        state = FightState()
        currentRound = 1
        currentExchange = 1
        roundHistory = []
        completedRounds = []
        replayExchanges = []
        battleLog = []
        matchOutcome = nil
        decisionType = nil
        judgeScorecards = []
        copiedToast = false
        playerHand = HandManager(side: .a, fighter: fighterA, state: state, rng: &rng)
        aiHand = HandManager(side: .b, fighter: fighterB, state: state, rng: &rng)
        syncDisplayToEngine()
        scene.resetPositions(distance: .long)
        refreshPixelSprites()
    }

    func refreshPixelSprites() {
        let fA = fighterA
        let fB = fighterB
        Task {
            async let bodyA = FighterPixelSpriteService.shared.spritePNGData(for: fA, kind: .fullBody)
            async let bodyB = FighterPixelSpriteService.shared.spritePNGData(for: fB, kind: .fullBody)
            async let headA = FighterPixelSpriteService.shared.spritePNGData(for: fA, kind: .headshot)
            async let headB = FighterPixelSpriteService.shared.spritePNGData(for: fB, kind: .headshot)

            let (bA, bB, hA, hB) = await (bodyA, bodyB, headA, headB)
            if fighterA.id == fA.id {
                scene.applyFighterTexture(side: .left, pngData: bA)
                headshotDataA = hA
            }
            if fighterB.id == fB.id {
                scene.applyFighterTexture(side: .right, pngData: bB)
                headshotDataB = hB
            }
        }
    }

    // MARK: - Turn logic

    func playTurn(playerCard: Card) {
        // Hand is locked while an exchange is still playing.
        guard matchOutcome == nil, !isPlaying else { return }

        let aiPool = useFiveCardHandMode ? aiHand.activeHand : SampleData.allCards
        let aiCard = ai.chooseCard(
            fighter: fighterB,
            side: .b,
            availableCards: aiPool,
            state: state,
            history: roundHistory,
            rng: &rng
        )
        let readA = FightMatchEngine.computeReadModifier(for: .a, history: roundHistory)
        let readB = FightMatchEngine.computeReadModifier(for: .b, history: roundHistory)

        state.round = currentRound
        let exLog = ExchangeEngine.resolve(
            a: FighterPlay(fighter: fighterA, card: playerCard, side: .a),
            b: FighterPlay(fighter: fighterB, card: aiCard, side: .b),
            state: &state,
            rng: &rng,
            readModifierA: readA,
            readModifierB: readB
        )
        roundHistory.append(exLog)
        replayExchanges.append(
            FightReplayExchange(
                round: currentRound,
                exchange: currentExchange,
                cardIdA: playerCard.id,
                cardIdB: aiCard.id,
                oddsA: exLog.a.odds.finalOdds,
                oddsB: exLog.b.odds.finalOdds,
                rollA: exLog.a.roll,
                rollB: exLog.b.roll,
                damageByA: exLog.a.damageDealt,
                damageByB: exLog.b.damageDealt
            )
        )
        // Presentation only: reads the finished log, never touches `rng` or the fight state.
        let beats = ExchangePresentation.build(log: exLog, nameA: fighterA.name, nameB: fighterB.name)
        // Read before `currentRound` / `currentExchange` are advanced below.
        battleLog.append(
            ExchangeRecap(
                id: battleLog.count,
                round: currentRound,
                exchange: currentExchange,
                lines: beats.filter { $0.kind != .reveal }.map(\.narration)
            )
        )
        var roundTurnedOver = false

        if let fin = exLog.finish {
            let rLog = RoundLog(
                round: currentRound,
                exchanges: roundHistory,
                score: nil,
                stateAfterCorner: state
            )
            completedRounds.append(rLog)
            matchOutcome = .finish(
                winner: fin.winner,
                reason: fin.reason,
                round: currentRound,
                exchangeInRound: currentExchange
            )
            startPlayback(log: exLog, beats: beats, resetsScene: false)
            return
        }

        if currentExchange < exchangesPerRound {
            currentExchange += 1
            playerHand.playCard(playerCard, updatedState: state, rng: &rng)
            aiHand.playCard(aiCard, updatedState: state, rng: &rng)
        } else {
            let score = FightMatchEngine.scoreRound(
                round: currentRound,
                exchanges: roundHistory,
                endState: state
            )
            if currentRound < totalRounds {
                FightMatchEngine.applyCornerRecovery(
                    state: &state,
                    fighterA: fighterA,
                    fighterB: fighterB
                )
                let rLog = RoundLog(
                    round: currentRound,
                    exchanges: roundHistory,
                    score: score,
                    stateAfterCorner: state
                )
                completedRounds.append(rLog)
                roundHistory = []
                currentRound += 1
                currentExchange = 1
                state.round = currentRound
                playerHand.playCard(playerCard, updatedState: state, rng: &rng)
                aiHand.playCard(aiCard, updatedState: state, rng: &rng)
                // The scene is reset after this exchange has finished playing (P5-3). Resetting here used to run
                // `removeAllActions` in the same tick as the animation and cancelled the round's last exchange.
                roundTurnedOver = true
            } else {
                let rLog = RoundLog(
                    round: currentRound,
                    exchanges: roundHistory,
                    score: score,
                    stateAfterCorner: state
                )
                completedRounds.append(rLog)
                let tallied = FightMatchEngine.tallyJudgeScorecards(from: completedRounds)
                matchOutcome = tallied.outcome
                decisionType = tallied.decisionType
                judgeScorecards = tallied.scorecards
            }
        }
        startPlayback(log: exLog, beats: beats, resetsScene: roundTurnedOver)
    }

    // MARK: - Exchange playback (P5-3)

    /// Plays the beats of one already-resolved exchange. The engine state is already final; this only moves
    /// what the player sees (health bars, cage animation, narration) and never reads or advances `rng`.
    private func startPlayback(log: ExchangeLog, beats: [ExchangeBeat], resetsScene: Bool) {
        playbackTask?.cancel()
        playbackGeneration += 1
        let generation = playbackGeneration
        isPlaying = true
        pendingSceneReset = resetsScene
        pendingFinish = log.finish
        layoutApplied = false
        scene.beginExchange()

        // Show the pre-exchange picture first (the engine state has already moved on).
        displayState = log.stateBefore
        displayState.round = state.round

        let durations = BattlePlayback.timeline(for: beats, log: log, speed: playbackSpeed)
        playbackTask = Task { [weak self] in
            // Let the cage and hand area finish their transition before the first beat.
            do {
                try await Task.sleep(for: .seconds(BattlePlayback.stageTransition))
            } catch {
                return
            }
            for (beat, seconds) in zip(beats, durations) {
                guard let self, !Task.isCancelled, self.playbackGeneration == generation else { return }
                self.apply(beat: beat, log: log, duration: seconds)
                do {
                    try await Task.sleep(for: .seconds(seconds))
                } catch {
                    return
                }
            }
            // Hold so the last result stamp can be read.
            do {
                try await Task.sleep(for: .seconds(BattlePlayback.endHold))
            } catch {
                return
            }
            guard let self, !Task.isCancelled, self.playbackGeneration == generation else { return }
            self.completePlayback()
        }
    }

    private func apply(beat: ExchangeBeat, log: ExchangeLog, duration: TimeInterval) {
        var shown = displayState
        shown.a.health = beat.display.a.health
        shown.a.isRocked = beat.display.a.isRocked
        shown.a.cutSeverity = beat.display.a.cutSeverity
        shown.b.health = beat.display.b.health
        shown.b.isRocked = beat.display.b.isRocked
        shown.b.cutSeverity = beat.display.b.cutSeverity
        if beat.kind.changesPosition && !layoutApplied {
            layoutApplied = true
            shown.distance = log.stateAfter.distance
            shown.ground = log.stateAfter.ground
            shown.isClinch = log.stateAfter.isClinch
        }
        displayState = shown

        scene.play(beat: beat, log: log, duration: duration)
    }

    /// Tap-to-skip: jump to the end of the exchange right now.
    func skipPlayback() {
        guard isPlaying else { return }
        playbackTask?.cancel()
        completePlayback()
    }

    private func completePlayback() {
        guard isPlaying else { return }
        playbackTask = nil
        isPlaying = false
        syncDisplayToEngine()
        if pendingSceneReset {
            pendingSceneReset = false
            scene.resetPositions(distance: state.distance)
        } else {
            scene.settle(to: state, finish: pendingFinish)
        }
        pendingFinish = nil
    }

    private func cancelPlayback() {
        playbackTask?.cancel()
        playbackTask = nil
        playbackGeneration += 1
        isPlaying = false
        pendingSceneReset = false
        pendingFinish = nil
    }

    private func syncDisplayToEngine() {
        displayState = state
        shownRound = currentRound
        shownExchange = currentExchange
        shownCompletedRounds = completedRounds.count
    }

    // MARK: - Debug / replay

    func copyReplayBundle() {
        let bundle = FightReplayBundle(
            seed: seed,
            fighterAId: fighterA.id,
            fighterBId: fighterB.id,
            exchanges: replayExchanges,
            currentState: state,
            invariantViolations: state.validateInvariants()
        )
        if let data = try? JSONEncoder().encode(bundle),
           let json = String(data: data, encoding: .utf8) {
            UIPasteboard.general.string = json
            copiedToast = true
        }
    }
}
