/// Probability helpers and matchup odds table for standing exchange resolution
/// (see docs/STRIKING_AND_DECK.md §2.1 & §2.1.1).
/// Rule: no outcome is ever certain, final odds are always clamped to 5%...95%.

/// Bundles a fighter and the card they chose for an exchange.
public struct FighterPlay: Sendable, Codable, Hashable {
    public var fighter: Fighter
    public var card: Card
    public var side: Side

    public init(fighter: Fighter, card: Card, side: Side = .a) {
        self.fighter = fighter
        self.card = card
        self.side = side
    }
}

public enum Odds {
    public static let minimum = 0.05
    public static let maximum = 0.95

    /// Data-driven 6×6 base probability table (STRIKING_AND_DECK §2.1).
    /// Outer key = my card type, inner key = opponent's card type.
    /// Passive-vs-passive cells (`—` in the doc table) use 0.50 as neutral baseline.
    public static let baseTable: [CardType: [CardType: Double]] = [
        .strike: [
            .strike: 0.55,
            .block: 0.35,
            .evade: 0.30,
            .counter: 0.40,
            .feint: 0.65,
            .move: 0.55,
        ],
        .block: [
            .strike: 0.65,
            .block: 0.50,
            .evade: 0.50,
            .counter: 0.50,
            .feint: 0.35,
            .move: 0.50,
        ],
        .evade: [
            .strike: 0.55,
            .block: 0.50,
            .evade: 0.50,
            .counter: 0.50,
            .feint: 0.40,
            .move: 0.50,
        ],
        .counter: [
            .strike: 0.60,
            .block: 0.10,
            .evade: 0.10,
            .counter: 0.10,
            .feint: 0.15,
            .move: 0.10,
        ],
        .feint: [
            .strike: 0.25,
            .block: 0.55,
            .evade: 0.50,
            .counter: 0.65,
            .feint: 0.30,
            .move: 0.40,
        ],
        .move: [
            .strike: 0.45,
            .block: 0.55,
            .evade: 0.55,
            .counter: 0.55,
            .feint: 0.50,
            .move: 0.50,
        ],
    ]

    /// Look up the base success probability for `my` card type against `opp` card type.
    public static func baseProbability(my: CardType, against opp: CardType) -> Double {
        baseTable[my]?[opp] ?? 0.50
    }

    /// Clamp a raw probability into the allowed 5%...95% band.
    public static func clamp(_ value: Double) -> Double {
        min(max(value, minimum), maximum)
    }

    /// Base probability plus a list of additive modifiers, clamped to 5%...95%.
    public static func resolve(base: Double, modifiers: [Double] = []) -> Double {
        clamp(modifiers.reduce(base, +))
    }

    /// Attribute differential modifier (STRIKING_AND_DECK §2.1.1 #2).
    public static func attributeModifier(
        myFighter: Fighter,
        myCard: Card,
        oppFighter: Fighter,
        oppCard: Card
    ) -> Double {
        let my = myFighter.attributes
        let opp = oppFighter.attributes
        let diff: Double
        switch myCard.type {
        case .strike:
            diff = (Double(my.accuracy + myCard.accuracy) / 2.0) - Double(opp.strikingDefense)
        case .block, .evade:
            diff = Double(my.strikingDefense) - (Double(opp.accuracy + oppCard.accuracy) / 2.0)
        case .counter:
            diff = (Double(my.accuracy + my.speed) / 2.0) - Double(opp.speed)
        case .feint:
            diff = Double(my.accuracy - opp.strikingDefense)
        case .move:
            diff = Double(my.speed - opp.speed)
        }
        return diff * 0.002
    }

    /// Distance mismatch penalty (STRIKING_AND_DECK §2.1.1 #3).
    /// 0 if `distance` is in `card.distances`, -0.20 if 1 step away, -0.35 if 2 steps away.
    public static func distanceModifier(for card: Card, at distance: Distance) -> Double {
        guard !card.distances.isEmpty else { return 0.0 }
        if card.isEffective(at: distance) {
            return 0.0
        }
        let minSteps = card.distances
            .map { abs($0.rawValue - distance.rawValue) }
            .min() ?? 0
        switch minSteps {
        case 0: return 0.0
        case 1: return -0.20
        default: return -0.35
        }
    }

    /// Stamina and leg-damage modifier (STRIKING_AND_DECK §2.1.1 #4).
    public static func conditionModifier(condition: FighterCondition, card: Card) -> Double {
        var mod = 0.0
        if condition.stamina < 40.0 {
            mod -= (40.0 - condition.stamina) * 0.003
        }
        if condition.health.legs < 50.0 {
            if card.type == .move || card.type == .evade || card.tags.contains(.kick) {
                mod -= 0.10
            }
        }
        return mod
    }

    /// Momentum differential modifier (STRIKING_AND_DECK §2.1.1 #5).
    public static func momentumModifier(
        myCondition: FighterCondition,
        oppCondition: FighterCondition
    ) -> Double {
        (myCondition.momentum - oppCondition.momentum) * 0.0005
    }

    /// Trait modifier (STRIKING_AND_DECK §2.1.1 #6).
    public static func traitModifier(
        myFighter: Fighter,
        myCard: Card,
        oppFighter: Fighter
    ) -> Double {
        var mod = 0.0
        if myFighter.has(.counterPuncher) && myCard.type == .counter {
            mod += 0.08
        }
        if myFighter.has(.onePunch) && myCard.type == .strike && myCard.power >= 75 {
            mod -= 0.05
        }
        if oppFighter.has(.unorthodox) && (myCard.type == .counter || myCard.type == .feint) {
            mod -= 0.06
        }
        return mod
    }

    /// Full exchange odds resolution for `my` play against `opp` play in `state`, clamped to 5%...95%.
    public static func resolveOdds(
        my: FighterPlay,
        opp: FighterPlay,
        state: FightState,
        readModifier: Double = 0.0
    ) -> Double {
        let base = baseProbability(my: my.card.type, against: opp.card.type)
        let myCondition = state[my.side]
        let oppCondition = state[opp.side]
        let clampedRead = min(max(readModifier, -0.10), 0.10)

        return resolve(
            base: base,
            modifiers: [
                attributeModifier(
                    myFighter: my.fighter, myCard: my.card,
                    oppFighter: opp.fighter, oppCard: opp.card
                ),
                distanceModifier(for: my.card, at: state.distance),
                conditionModifier(condition: myCondition, card: my.card),
                momentumModifier(myCondition: myCondition, oppCondition: oppCondition),
                traitModifier(myFighter: my.fighter, myCard: my.card, oppFighter: opp.fighter),
                clampedRead,
            ]
        )
    }

    /// Convenience overload when resolving directly from cards and optional fighters.
    public static func resolveOdds(
        my: Card,
        opp: Card,
        state: FightState,
        myFighter: Fighter = Fighter(id: "default-a", name: "Fighter A"),
        oppFighter: Fighter = Fighter(id: "default-b", name: "Fighter B"),
        mySide: Side = .a,
        readModifier: Double = 0.0
    ) -> Double {
        resolveOdds(
            my: FighterPlay(fighter: myFighter, card: my, side: mySide),
            opp: FighterPlay(fighter: oppFighter, card: opp, side: mySide.opposite),
            state: state,
            readModifier: readModifier
        )
    }
}

/// Top-level convenience forwarding to `Odds.resolveOdds(my:opp:state:readModifier:)`.
public func resolveOdds(
    my: FighterPlay,
    opp: FighterPlay,
    state: FightState,
    readModifier: Double = 0.0
) -> Double {
    Odds.resolveOdds(my: my, opp: opp, state: state, readModifier: readModifier)
}

/// Top-level convenience forwarding to `Odds.resolveOdds(my:opp:state:myFighter:oppFighter:mySide:readModifier:)`.
public func resolveOdds(
    my: Card,
    opp: Card,
    state: FightState,
    myFighter: Fighter = Fighter(id: "default-a", name: "Fighter A"),
    oppFighter: Fighter = Fighter(id: "default-b", name: "Fighter B"),
    mySide: Side = .a,
    readModifier: Double = 0.0
) -> Double {
    Odds.resolveOdds(
        my: my,
        opp: opp,
        state: state,
        myFighter: myFighter,
        oppFighter: oppFighter,
        mySide: mySide,
        readModifier: readModifier
    )
}
