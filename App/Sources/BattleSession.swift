import Foundation
import Observation
import UIKit
import FightEngine

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

    let totalRounds = 3
    let exchangesPerRound = 8

    /// Shared SpriteKit scene; the battle view only presents it.
    let scene = LungeDemoScene(size: CGSize(width: 390, height: 260))

    @ObservationIgnored private var rng: SeededRNG
    private let ai = StyleAI()

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

    var phaseSummaryText: String {
        BattleText.phaseSummary(state)
    }

    // MARK: - Match lifecycle

    func startNewMatch(withSeed newSeed: UInt64) {
        seed = newSeed
        rng = SeededRNG(seed: newSeed)
        state = FightState()
        currentRound = 1
        currentExchange = 1
        roundHistory = []
        completedRounds = []
        replayExchanges = []
        matchOutcome = nil
        decisionType = nil
        judgeScorecards = []
        copiedToast = false
        playerHand = HandManager(side: .a, fighter: fighterA, state: state, rng: &rng)
        aiHand = HandManager(side: .b, fighter: fighterB, state: state, rng: &rng)
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
        guard matchOutcome == nil else { return }

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
        scene.playExchange(log: exLog)

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
                scene.resetPositions(distance: state.distance)
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
