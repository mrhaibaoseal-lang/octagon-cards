import Foundation
import FightEngine

/// Playback speed for the exchange timeline (P5-3). Standard targets roughly 3-4 seconds per exchange.
enum PlaybackSpeed: String, CaseIterable, Identifiable {
    case fast
    case standard
    case slow

    var id: String { rawValue }

    var label: String {
        switch self {
        case .fast: "快速"
        case .standard: "標準"
        case .slow: "慢速"
        }
    }

    /// Multiplier applied to every beat duration.
    var multiplier: Double {
        switch self {
        case .fast: 0.55
        case .standard: 1.0
        case .slow: 1.5
        }
    }
}

/// Timing rules for playing an `ExchangePresentation` beat list. Pure data: it never touches the engine or `SeededRNG`.
enum BattlePlayback {
    /// Scene speed used while the finishing blow lands and the loser goes down (KO slow motion).
    static let finishSlowMotion: Double = 0.4
    /// Extra freeze on heavy hits, in seconds.
    static let heavyHitStop: TimeInterval = 0.08
    /// Non-finish beats of one exchange are stretched/squeezed so their total lands in this range (standard speed).
    static let standardRange: ClosedRange<TimeInterval> = 3.0...4.2
    /// How long the finish beat holds (real seconds at standard speed).
    static let finishHold: TimeInterval = 1.6

    static func baseDuration(_ kind: ExchangeBeatKind) -> TimeInterval {
        switch kind {
        case .reveal: 0.60
        case .action: 0.40
        case .hit: 0.75
        case .blocked: 0.60
        case .dodged: 0.60
        case .missed: 0.45
        case .feint: 0.50
        case .move: 0.45
        case .takedown: 0.80
        case .positionAdvance: 0.55
        case .sweep: 0.65
        case .standUp: 0.55
        case .submissionStart: 0.65
        case .submissionLock: 0.75
        case .submissionEscape: 0.65
        case .rocked: 0.55
        case .cut: 0.50
        case .interrupted: 0.45
        case .refereeStandUp: 0.75
        case .clinch: 0.55
        case .cagePressure: 0.45
        case .recover: 0.45
        case .finish: finishHold
        }
    }

    /// True when this beat is the blow that ends a standing fight (KO / TKO); it plays in slow motion.
    static func isFinishingBlow(_ beat: ExchangeBeat, in log: ExchangeLog) -> Bool {
        guard let fin = log.finish, fin.reason != .submission, beat.kind == .hit else { return false }
        return beat.target == fin.winner.opposite
    }

    /// Real-time seconds each beat should stay on screen.
    static func timeline(for beats: [ExchangeBeat], log: ExchangeLog, speed: PlaybackSpeed) -> [TimeInterval] {
        func isFixed(_ beat: ExchangeBeat) -> Bool {
            beat.kind == .finish || isFinishingBlow(beat, in: log)
        }

        let raw = beats.map { beat -> TimeInterval in
            var d = baseDuration(beat.kind)
            if beat.kind == .hit && beat.isHeavy { d += heavyHitStop }
            return d
        }
        let flexibleTotal = zip(beats, raw).reduce(0.0) { $0 + (isFixed($1.0) ? 0 : $1.1) }
        let scale: Double
        if flexibleTotal > 0 {
            let target = min(max(flexibleTotal, standardRange.lowerBound), standardRange.upperBound)
            scale = target / flexibleTotal
        } else {
            scale = 1
        }

        return zip(beats, raw).map { beat, d in
            let seconds: TimeInterval
            if beat.kind == .finish {
                seconds = d
            } else if isFinishingBlow(beat, in: log) {
                seconds = d / finishSlowMotion
            } else {
                seconds = d * scale
            }
            return max(0.12, seconds * speed.multiplier)
        }
    }
}

extension ExchangeBeatKind {
    /// Beats after which the standing/ground layout (distance, ground state, clinch) should look like the
    /// exchange's final state. Health, Rocked and cuts are always driven by each beat's own `display`.
    var changesPosition: Bool {
        switch self {
        case .move, .takedown, .positionAdvance, .sweep, .standUp,
             .submissionStart, .submissionLock, .submissionEscape,
             .refereeStandUp, .clinch, .finish:
            true
        default:
            false
        }
    }
}
