/// Starter and full standing card catalog used by tests, the simulator (P2-6), and the app sandbox.
public enum SampleData {
    // MARK: - Original 10 Starter Cards (P2-1)

    public static let jab = Card(
        id: "jab", name: "刺拳", type: .strike, distances: [.long, .mid], target: .head,
        speed: 85, power: 25, accuracy: 80, staminaCost: 1, deckCost: 1, tags: [.punch])
    public static let cross = Card(
        id: "cross", name: "直拳", type: .strike, distances: [.mid], target: .head,
        speed: 65, power: 55, accuracy: 65, staminaCost: 2, deckCost: 2, tags: [.punch])
    public static let lowKick = Card(
        id: "low-kick", name: "低掃", type: .strike, distances: [.long, .mid], target: .legs,
        speed: 55, power: 50, accuracy: 70, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let headKick = Card(
        id: "head-kick", name: "高踢", type: .strike, distances: [.long, .mid], target: .head,
        speed: 35, power: 90, accuracy: 35, staminaCost: 4, deckCost: 3, tags: [.kick])
    public static let bodyHook = Card(
        id: "body-hook", name: "肝臟鉤拳", type: .strike, distances: [.mid, .close], target: .body,
        speed: 55, power: 60, accuracy: 60, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let guardUp = Card(
        id: "guard", name: "抱頭格擋", type: .block, distances: [.mid, .close],
        speed: 70, power: 0, accuracy: 70, staminaCost: 1, deckCost: 1)
    public static let slip = Card(
        id: "slip", name: "側閃", type: .evade, distances: [.long, .mid],
        speed: 75, power: 0, accuracy: 60, staminaCost: 2, deckCost: 2)
    public static let counterHook = Card(
        id: "counter-hook", name: "反擊鉤拳", type: .counter, distances: [.mid], target: .head,
        speed: 70, power: 60, accuracy: 55, staminaCost: 2, deckCost: 3, tags: [.punch])
    public static let feintStep = Card(
        id: "feint", name: "假動作", type: .feint, distances: [.long, .mid],
        speed: 80, power: 0, accuracy: 55, staminaCost: 1, deckCost: 1)
    public static let stepIn = Card(
        id: "step-in", name: "前進逼近", type: .move, distances: [.long, .mid],
        speed: 60, power: 0, accuracy: 60, staminaCost: 1, deckCost: 1, preferredDistance: .close)

    // MARK: - Expanded Standing Catalog (P4-1: +18 cards = 28 total standing cards across Long/Mid/Close)

    public static let frontKick = Card(
        id: "front-kick", name: "前踢", type: .strike, distances: [.long], target: .body,
        speed: 70, power: 46, accuracy: 72, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let calfKick = Card(
        id: "calf-kick", name: "小腿卡夫踢", type: .strike, distances: [.long], target: .legs,
        speed: 76, power: 42, accuracy: 78, staminaCost: 1, deckCost: 2, tags: [.kick])
    public static let sideKick = Card(
        id: "side-kick", name: "側踹", type: .strike, distances: [.long, .mid], target: .body,
        speed: 60, power: 52, accuracy: 68, staminaCost: 2, deckCost: 2, tags: [.kick])
    public static let supermanPunch = Card(
        id: "superman-punch", name: "超人拳", type: .strike, distances: [.long], target: .head,
        speed: 62, power: 68, accuracy: 52, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let bodyKick = Card(
        id: "body-kick", name: "中段掃踢", type: .strike, distances: [.long, .mid], target: .body,
        speed: 52, power: 64, accuracy: 62, staminaCost: 3, deckCost: 2, tags: [.kick])
    public static let leadHook = Card(
        id: "lead-hook", name: "左鉤拳", type: .strike, distances: [.mid, .close], target: .head,
        speed: 68, power: 60, accuracy: 64, staminaCost: 2, deckCost: 2, tags: [.punch])
    public static let uppercut = Card(
        id: "uppercut", name: "上鉤拳", type: .strike, distances: [.mid, .close], target: .head,
        speed: 58, power: 72, accuracy: 56, staminaCost: 3, deckCost: 2, tags: [.punch])
    public static let overhand = Card(
        id: "overhand", name: "過肩重拳", type: .strike, distances: [.mid], target: .head,
        speed: 45, power: 85, accuracy: 45, staminaCost: 3, deckCost: 3, tags: [.punch])
    public static let closeElbow = Card(
        id: "close-elbow", name: "貼身橫肘", type: .strike, distances: [.close], target: .head,
        speed: 66, power: 70, accuracy: 62, staminaCost: 2, deckCost: 2, tags: [.elbow])
    public static let clinchKnee = Card(
        id: "clinch-knee", name: "箍頸膝撞", type: .strike, distances: [.close], target: .body,
        speed: 58, power: 72, accuracy: 64, staminaCost: 3, deckCost: 2, tags: [.knee])
    public static let dirtyBoxing = Card(
        id: "dirty-boxing", name: "內圍髒拳", type: .strike, distances: [.close], target: .head,
        speed: 72, power: 52, accuracy: 70, staminaCost: 2, deckCost: 2, tags: [.punch])

    public static let checkShield = Card(
        id: "check-shield", name: "提脛擋踢", type: .block, distances: [.long, .mid],
        speed: 72, power: 0, accuracy: 72, staminaCost: 1, deckCost: 1)
    public static let weave = Card(
        id: "weave", name: "搖閃潛避", type: .evade, distances: [.mid, .close],
        speed: 70, power: 0, accuracy: 62, staminaCost: 2, deckCost: 2)
    public static let catchKickCounter = Card(
        id: "catch-kick-counter", name: "接踢反擊直拳", type: .counter, distances: [.long, .mid], target: .head,
        speed: 64, power: 64, accuracy: 52, staminaCost: 2, deckCost: 3, tags: [.punch])
    public static let shortCounterElbow = Card(
        id: "short-counter-elbow", name: "迎擊短肘", type: .counter, distances: [.close], target: .head,
        speed: 72, power: 62, accuracy: 56, staminaCost: 2, deckCost: 3, tags: [.elbow])
    public static let levelFeint = Card(
        id: "level-feint", name: "虛晃換位", type: .feint, distances: [.mid, .close],
        speed: 76, power: 0, accuracy: 58, staminaCost: 1, deckCost: 1)
    public static let stepBack = Card(
        id: "step-back", name: "滑步後撤", type: .move, distances: [.mid, .close],
        speed: 66, power: 0, accuracy: 64, staminaCost: 1, deckCost: 1, preferredDistance: .long)
    public static let pushOff = Card(
        id: "push-off", name: "推開脫離", type: .move, distances: [.close],
        speed: 64, power: 0, accuracy: 66, staminaCost: 1, deckCost: 1, preferredDistance: .mid)

    /// 10 starter example cards covering all six card types (P2-1 baseline).
    public static let cards: [Card] = [
        jab, cross, lowKick, headKick, bodyHook,
        guardUp, slip, counterHook, feintStep, stepIn,
    ]

    /// Complete 28-card standing catalog covering Long, Mid, and Close distances across all 6 card types (P4-1).
    public static let standingCards: [Card] = [
        // Strikes (16)
        jab, frontKick, calfKick, lowKick, sideKick, supermanPunch, headKick,
        cross, leadHook, uppercut, overhand, bodyHook, bodyKick,
        closeElbow, clinchKnee, dirtyBoxing,
        // Blocks (2)
        guardUp, checkShield,
        // Evades (2)
        slip, weave,
        // Counters (3)
        counterHook, catchKickCounter, shortCounterElbow,
        // Feints (2)
        feintStep, levelFeint,
        // Moves (3)
        stepIn, stepBack, pushOff,
    ]

    // MARK: - Takedown & Anti-Takedown Bridge Cards (P3-1 / P4-2: 8 cards)

    public static let doubleLeg = Card(
        id: "double-leg", name: "爆發雙腿摔", type: .strike, distances: [.mid, .close], target: .body,
        speed: 68, power: 15, accuracy: 66, staminaCost: 3, deckCost: 2,
        tags: [.wrestling], landingPosition: .fullGuard)
    public static let singleLeg = Card(
        id: "single-leg", name: "單腿抓摔", type: .strike, distances: [.mid, .close], target: .legs,
        speed: 70, power: 10, accuracy: 70, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], landingPosition: .fullGuard)
    public static let cageTrip = Card(
        id: "cage-trip", name: "籠邊絆摔", type: .strike, distances: [.close], target: .legs,
        speed: 66, power: 15, accuracy: 68, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], landingPosition: .halfGuard)
    public static let highCrotchSlam = Card(
        id: "high-crotch-slam", name: "高跨重摔", type: .strike, distances: [.close], target: .body,
        speed: 55, power: 45, accuracy: 56, staminaCost: 4, deckCost: 3,
        tags: [.wrestling], landingPosition: .sideControl)
    public static let catchKickTakedown = Card(
        id: "catch-kick-td", name: "接踢反摔", type: .counter, distances: [.long, .mid], target: .legs,
        speed: 68, power: 15, accuracy: 60, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], landingPosition: .halfGuard)

    public static let sprawl = Card(
        id: "sprawl", name: "下壓防摔 Sprawl", type: .block, distances: [.mid, .close],
        speed: 78, power: 0, accuracy: 75, staminaCost: 2, deckCost: 2,
        tags: [.wrestling])
    public static let interceptKnee = Card(
        id: "intercept-knee", name: "迎擊飛膝", type: .counter, distances: [.mid, .close], target: .head,
        speed: 74, power: 82, accuracy: 48, staminaCost: 3, deckCost: 3,
        tags: [.knee])
    public static let jumpGuillotine = Card(
        id: "jump-guillotine", name: "順勢拉斷頭台", type: .counter, distances: [.mid, .close], target: .head,
        speed: 72, power: 20, accuracy: 52, staminaCost: 3, deckCost: 3,
        tags: [.submission], landingPosition: .fullGuard, submissionCategory: .choke)

    /// All 8 standing-to-ground takedown & anti-takedown bridge cards (P3-1).
    public static let takedownBridgeCards: [Card] = [
        doubleLeg, singleLeg, cageTrip, highCrotchSlam, catchKickTakedown,
        sprawl, interceptKnee, jumpGuillotine,
    ]

    // MARK: - Ground Top Cards (P3-2 / P4-2: 10 cards — Advance, Smother, GnP)

    public static let kneeSlicePass = Card(
        id: "knee-slice-pass", name: "膝切過腿", type: .move, distances: [.close],
        speed: 68, power: 0, accuracy: 68, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], topIntent: .advance,
        allowedGroundPositions: [.fullGuard, .halfGuard])
    public static let stackPass = Card(
        id: "stack-pass", name: "疊壓過腿", type: .move, distances: [.close],
        speed: 60, power: 0, accuracy: 66, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], topIntent: .advance,
        allowedGroundPositions: [.fullGuard, .halfGuard])
    public static let mountTransition = Card(
        id: "mount-transition", name: "跨騎上馬", type: .move, distances: [.close],
        speed: 64, power: 0, accuracy: 65, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], topIntent: .advance,
        allowedGroundPositions: [.halfGuard, .sideControl])
    public static let backTake = Card(
        id: "back-take", name: "靈巧搶背", type: .move, distances: [.close],
        speed: 66, power: 0, accuracy: 62, staminaCost: 2, deckCost: 3,
        tags: [.wrestling], topIntent: .advance,
        allowedGroundPositions: [.halfGuard, .sideControl, .fullMount, .backControl])

    public static let dagestaniHandcuff = Card(
        id: "dagestani-handcuff", name: "達吉斯坦鎖腕重壓", type: .block, distances: [.close],
        speed: 66, power: 0, accuracy: 74, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], topIntent: .smother)
    public static let legRide = Card(
        id: "leg-ride", name: "雙腿纏繞騎乘壓制", type: .block, distances: [.close],
        speed: 64, power: 0, accuracy: 72, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], topIntent: .smother)

    public static let shortGnP = Card(
        id: "short-gnp", name: "地面短拳連擊", type: .strike, distances: [.close], target: .head,
        speed: 74, power: 46, accuracy: 72, staminaCost: 2, deckCost: 1,
        tags: [.punch], topIntent: .gnp)
    public static let posturedHammerfist = Card(
        id: "postured-hammerfist", name: "撐高鐵鎚重擊", type: .strike, distances: [.close], target: .head,
        speed: 60, power: 72, accuracy: 60, staminaCost: 3, deckCost: 2,
        tags: [.punch], topIntent: .gnp)
    public static let groundElbows = Card(
        id: "ground-elbows", name: "地面剃刀砸肘", type: .strike, distances: [.close], target: .head,
        speed: 66, power: 68, accuracy: 65, staminaCost: 2, deckCost: 2,
        tags: [.elbow], topIntent: .gnp,
        allowedGroundPositions: [.halfGuard, .sideControl, .fullMount])
    public static let mountedBarrage = Card(
        id: "mounted-barrage", name: "騎乘暴雨重拳", type: .strike, distances: [.close], target: .head,
        speed: 62, power: 84, accuracy: 62, staminaCost: 3, deckCost: 3,
        tags: [.punch], topIntent: .gnp,
        allowedGroundPositions: [.fullMount, .backControl])

    // MARK: - Core Submission Cards (P3-3 / P4-2: 6 cards — 4 Top + 2 Bottom)

    public static let rnc = Card(
        id: "rnc", name: "背後裸絞 RNC", type: .strike, distances: [.close], target: .head,
        speed: 68, power: 30, accuracy: 72, staminaCost: 3, deckCost: 3,
        tags: [.submission], topIntent: .submission, submissionCategory: .choke,
        allowedGroundPositions: [.backControl, .fullMount])
    public static let guillotine = Card(
        id: "guillotine", name: "斷頭台絞技", type: .strike, distances: [.close], target: .head,
        speed: 66, power: 25, accuracy: 64, staminaCost: 3, deckCost: 2,
        tags: [.submission], topIntent: .submission, submissionCategory: .choke,
        allowedGroundPositions: [.fullGuard, .halfGuard, .sideControl, .fullMount])
    public static let armTriangle = Card(
        id: "arm-triangle", name: "肩固/達斯絞", type: .strike, distances: [.close], target: .head,
        speed: 64, power: 25, accuracy: 68, staminaCost: 3, deckCost: 2,
        tags: [.submission], topIntent: .submission, submissionCategory: .choke,
        allowedGroundPositions: [.halfGuard, .sideControl, .fullMount])
    public static let kimura = Card(
        id: "kimura", name: "木村鎖關節技", type: .strike, distances: [.close], target: .body,
        speed: 62, power: 30, accuracy: 65, staminaCost: 3, deckCost: 2,
        tags: [.submission], topIntent: .submission, submissionCategory: .jointLock,
        allowedGroundPositions: [.halfGuard, .sideControl, .fullMount])

    public static let triangleChoke = Card(
        id: "triangle-choke", name: "下位三角絞", type: .counter, distances: [.close], target: .head,
        speed: 68, power: 25, accuracy: 66, staminaCost: 3, deckCost: 3,
        tags: [.submission], bottomIntent: .sweepOrSub, submissionCategory: .choke,
        allowedGroundPositions: [.fullGuard, .halfGuard])
    public static let armbar = Card(
        id: "armbar", name: "下位飛身十字固", type: .counter, distances: [.close], target: .body,
        speed: 66, power: 30, accuracy: 64, staminaCost: 3, deckCost: 3,
        tags: [.submission], bottomIntent: .sweepOrSub, submissionCategory: .jointLock,
        allowedGroundPositions: [.fullGuard, .halfGuard, .fullMount])

    // MARK: - Ground Bottom Defense, Escape & Sweep Cards (P3-2 / P4-2: 6 cards)

    public static let frameLockdown = Card(
        id: "frame-lockdown", name: "撐架鎖腿防過腿", type: .block, distances: [.close],
        speed: 72, power: 0, accuracy: 72, staminaCost: 1, deckCost: 1,
        tags: [.wrestling], bottomIntent: .frame)
    public static let shellUp = Card(
        id: "shell-up", name: "雙手抱頭防砸拳", type: .block, distances: [.close],
        speed: 74, power: 0, accuracy: 74, staminaCost: 1, deckCost: 1,
        bottomIntent: .shell)
    public static let shrimpEscape = Card(
        id: "shrimp-escape", name: "蝦行退位恢復防守", type: .evade, distances: [.close],
        speed: 68, power: 0, accuracy: 66, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], bottomIntent: .escape)
    public static let wallWalkStandup = Card(
        id: "wall-walk-standup", name: "扶籠穿手起身", type: .move, distances: [.close],
        speed: 64, power: 0, accuracy: 64, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], bottomIntent: .escape,
        allowedGroundPositions: [.fullGuard, .halfGuard, .sideControl])
    public static let upkickStandup = Card(
        id: "upkick-standup", name: "蹬踏踢開起身", type: .move, distances: [.close], target: .head,
        speed: 66, power: 30, accuracy: 62, staminaCost: 2, deckCost: 2,
        tags: [.kick], bottomIntent: .escape,
        allowedGroundPositions: [.fullGuard, .halfGuard])
    public static let butterflySweep = Card(
        id: "butterfly-sweep", name: "蝴蝶勾掃技翻轉", type: .counter, distances: [.close],
        speed: 68, power: 0, accuracy: 66, staminaCost: 2, deckCost: 2,
        tags: [.wrestling], bottomIntent: .sweepOrSub)

    /// 14 Top ground cards covering Advance, Smother, GnP, and Top Submissions.
    public static let topGroundCards: [Card] = [
        kneeSlicePass, stackPass, mountTransition, backTake,
        dagestaniHandcuff, legRide,
        shortGnP, posturedHammerfist, groundElbows, mountedBarrage,
        rnc, guillotine, armTriangle, kimura,
    ]

    /// 8 Bottom ground cards covering Frame, Shell, Escape, Sweep, and Bottom Submissions.
    public static let bottomGroundCards: [Card] = [
        frameLockdown, shellUp,
        shrimpEscape, wallWalkStandup, upkickStandup,
        butterflySweep, triangleChoke, armbar,
    ]

    /// 22 dedicated ground cards (14 Top + 8 Bottom).
    public static let groundCards: [Card] = topGroundCards + bottomGroundCards

    /// Complete 30-card grappling & ground catalog (8 takedown bridge + 22 ground cards, P4-2).
    public static let grapplingAndGroundCards: [Card] = takedownBridgeCards + groundCards

    /// Complete 58-card MMA catalog (28 standing + 30 grappling/ground cards, P4-1 & P4-2).
    public static let allCards: [Card] = standingCards + grapplingAndGroundCards

    /// A well-rounded striker.
    public static let striker = Fighter(
        id: "sample-striker", name: "Sample Striker", stance: .orthodox,
        attributes: FighterAttributes(
            power: 78, speed: 72, accuracy: 75, strikingDefense: 65, chin: 70,
            cardio: 68, takedown: 35, takedownDefense: 64, submission: 30, clinch: 50),
        traits: [.onePunch, .counterPuncher])

    /// A wrestler with a weaker chin.
    public static let wrestler = Fighter(
        id: "sample-wrestler", name: "Sample Wrestler", stance: .southpaw,
        attributes: FighterAttributes(
            power: 55, speed: 58, accuracy: 55, strikingDefense: 50, chin: 55,
            cardio: 85, takedown: 88, takedownDefense: 80, submission: 60, clinch: 82),
        traits: [.gasTank, .smother, .cagePinner])

    /// A Brazilian Jiu-Jitsu submission specialist (Charles Oliveira / Demian Maia archetype).
    public static let bjjFighter = Fighter(
        id: "sample-bjj", name: "Sample BJJ Specialist", stance: .orthodox,
        attributes: FighterAttributes(
            power: 56, speed: 62, accuracy: 62, strikingDefense: 54, chin: 58,
            cardio: 76, takedown: 52, takedownDefense: 62, submission: 92, clinch: 76),
        traits: [.blackBeltBJJ, .unorthodox])
}
