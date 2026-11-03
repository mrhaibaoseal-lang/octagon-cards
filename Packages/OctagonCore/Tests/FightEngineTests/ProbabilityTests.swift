import Testing
@testable import FightEngine

@Suite("Odds")
struct ProbabilityTests {
    @Test func clampsToBand() {
        #expect(Odds.clamp(-1) == 0.05)
        #expect(Odds.clamp(2) == 0.95)
        #expect(Odds.clamp(0.5) == 0.5)
    }

    @Test func neverCertain() {
        #expect(Odds.resolve(base: 0.9, modifiers: [0.3, 0.3]) == 0.95)
        #expect(Odds.resolve(base: 0.1, modifiers: [-0.3]) == 0.05)
    }

    @Test func modifiersAdd() {
        let p = Odds.resolve(base: 0.6, modifiers: [0.05, -0.1])
        #expect(abs(p - 0.55) < 1e-9)
    }

    @Test func baseTableCoversAllSixBySixPairs() {
        #expect(Odds.baseTable.count == CardType.allCases.count)
        for myType in CardType.allCases {
            let row = Odds.baseTable[myType]
            #expect(row != nil)
            #expect(row?.count == CardType.allCases.count)
            for oppType in CardType.allCases {
                let p = Odds.baseProbability(my: myType, against: oppType)
                #expect(p >= Odds.minimum && p <= Odds.maximum)
            }
        }
        // Spot-check key entries from STRIKING_AND_DECK §2.1
        #expect(Odds.baseProbability(my: .strike, against: .strike) == 0.55)
        #expect(Odds.baseProbability(my: .strike, against: .block) == 0.35)
        #expect(Odds.baseProbability(my: .strike, against: .feint) == 0.65)
        #expect(Odds.baseProbability(my: .counter, against: .strike) == 0.60)
        #expect(Odds.baseProbability(my: .counter, against: .block) == 0.10)
        #expect(Odds.baseProbability(my: .feint, against: .counter) == 0.65)
    }

    @Test func everyCombinationStaysWithinFiveToNinetyFivePercent() {
        let extremeHigh = Fighter(
            id: "max", name: "Max",
            attributes: FighterAttributes(
                power: 100, speed: 100, accuracy: 100, strikingDefense: 100, chin: 100,
                cardio: 100, takedown: 100, takedownDefense: 100, submission: 100, clinch: 100
            ),
            traits: Trait.allCases
        )
        let extremeLow = Fighter(
            id: "min", name: "Min",
            attributes: FighterAttributes(
                power: 0, speed: 0, accuracy: 0, strikingDefense: 0, chin: 0,
                cardio: 0, takedown: 0, takedownDefense: 0, submission: 0, clinch: 0
            ),
            traits: []
        )
        let fighters = [SampleData.striker, SampleData.wrestler, extremeHigh, extremeLow]
        let states = [
            FightState(distance: .long),
            FightState(
                distance: .mid,
                a: FighterCondition(
                    health: BodyHealth(head: 10, body: 10, legs: 10),
                    stamina: 0,
                    momentum: 100
                ),
                b: FighterCondition(
                    health: .full,
                    stamina: 100,
                    momentum: 0
                )
            ),
            FightState(
                distance: .close,
                a: FighterCondition(health: .full, stamina: 100, momentum: 0),
                b: FighterCondition(
                    health: BodyHealth(head: 10, body: 10, legs: 10),
                    stamina: 0,
                    momentum: 100
                )
            ),
        ]

        for state in states {
            for myFighter in fighters {
                for oppFighter in fighters {
                    for myCard in SampleData.cards {
                        for oppCard in SampleData.cards {
                            let p = resolveOdds(
                                my: FighterPlay(fighter: myFighter, card: myCard, side: .a),
                                opp: FighterPlay(fighter: oppFighter, card: oppCard, side: .b),
                                state: state,
                                readModifier: 0.10
                            )
                            #expect(p >= Odds.minimum && p <= Odds.maximum)
                        }
                    }
                }
            }
        }
    }

    @Test func wrongDistanceReducesOdds() {
        // `cross` is only effective at `.mid`; `.long` and `.close` are 1 step away (-0.20).
        let midState = FightState(distance: .mid)
        let closeState = FightState(distance: .close)
        let longState = FightState(distance: .long)

        let pMid = resolveOdds(my: SampleData.cross, opp: SampleData.jab, state: midState)
        let pClose = resolveOdds(my: SampleData.cross, opp: SampleData.jab, state: closeState)
        let pLong = resolveOdds(my: SampleData.cross, opp: SampleData.jab, state: longState)

        #expect(pClose < pMid)
        #expect(pLong < pMid)
        #expect(abs((pMid - pClose) - 0.20) < 1e-9)

        // A long-only card at `.close` is 2 steps away (-0.35), worse than 1 step away (-0.20).
        let longOnlyKick = Card(
            id: "front-kick", name: "前踢", type: .strike, distances: [.long], target: .body,
            speed: 60, power: 50, accuracy: 65, staminaCost: 2, deckCost: 2, tags: [.kick]
        )
        let pKickLong = resolveOdds(my: longOnlyKick, opp: SampleData.jab, state: longState)
        let pKickMid = resolveOdds(my: longOnlyKick, opp: SampleData.jab, state: midState)
        let pKickClose = resolveOdds(my: longOnlyKick, opp: SampleData.jab, state: closeState)

        #expect(pKickLong > pKickMid)
        #expect(pKickMid > pKickClose)
        #expect(abs((pKickLong - pKickClose) - 0.35) < 1e-9)
    }

    @Test func attributesTraitsAndConditionModifyOdds() {
        let state = FightState(distance: .mid)
        // Striker has higher accuracy & counterPuncher trait vs Wrestler
        let strikerCounter = resolveOdds(
            my: FighterPlay(fighter: SampleData.striker, card: SampleData.counterHook, side: .a),
            opp: FighterPlay(fighter: SampleData.wrestler, card: SampleData.cross, side: .b),
            state: state
        )
        let wrestlerCounter = resolveOdds(
            my: FighterPlay(fighter: SampleData.wrestler, card: SampleData.counterHook, side: .a),
            opp: FighterPlay(fighter: SampleData.striker, card: SampleData.cross, side: .b),
            state: state
        )
        #expect(strikerCounter > wrestlerCounter)

        // Low stamina and damaged legs reduce kick odds
        let tiredLegDamagedState = FightState(
            distance: .mid,
            a: FighterCondition(
                health: BodyHealth(head: 100, body: 100, legs: 30),
                stamina: 10,
                momentum: 0
            )
        )
        let freshKick = resolveOdds(my: SampleData.lowKick, opp: SampleData.jab, state: state)
        let tiredKick = resolveOdds(my: SampleData.lowKick, opp: SampleData.jab, state: tiredLegDamagedState)
        #expect(tiredKick < freshKick)
    }
}
