import Foundation

// P6-3: shared chibi body drawn at logical resolution straight from a pose table (no sprite rotation), so lines stay
// clean at ~65px tall. Port of pipeline/chibi_proto/proto.py; skin, build, ink and shorts come from `ChibiStyle`.

typealias ChibiV2 = SIMD2<Double>

// MARK: - Poses

/// Angles are degrees from "straight down"; positive = toward the facing direction (right). F = front/lead limb,
/// B = back/rear limb. u/f = upper arm/forearm, t/s = thigh/shin.
struct ChibiPoseParams: Sendable {
    var lean: Double
    var uF: Double
    var fF: Double
    var uB: Double
    var fB: Double
    var tF: Double
    var sF: Double
    var tB: Double
    var sB: Double
    var headDx: Int
    var headDy: Int
}

enum ChibiPose: String, CaseIterable, Sendable, Hashable {
    case idle, idle2, jab, cross, kick, hurt, down

    var label: String {
        switch self {
        case .idle: return "待機1"
        case .idle2: return "待機2"
        case .jab: return "刺拳"
        case .cross: return "直拳"
        case .kick: return "踢"
        case .hurt: return "受擊"
        case .down: return "倒地"
        }
    }

    var params: ChibiPoseParams {
        switch self {
        case .idle:
            return ChibiPoseParams(lean: 4, uF: 22, fF: 165, uB: 20, fB: 168, tF: 24, sF: -4, tB: -16, sB: -34, headDx: 0, headDy: 0)
        case .idle2:
            return ChibiPoseParams(lean: 5, uF: 26, fF: 146, uB: 6, fB: 146, tF: 27, sF: -6, tB: -18, sB: -38, headDx: 0, headDy: 1)
        case .jab:
            return ChibiPoseParams(lean: 12, uF: 84, fF: 90, uB: 10, fB: 150, tF: 30, sF: -2, tB: -22, sB: -36, headDx: 1, headDy: 1)
        case .cross:
            return ChibiPoseParams(lean: 20, uF: 20, fF: 140, uB: 78, fB: 88, tF: 34, sF: -4, tB: -28, sB: -40, headDx: 2, headDy: 1)
        case .kick:
            return ChibiPoseParams(lean: -20, uF: 30, fF: 150, uB: -14, fB: 120, tF: 2, sF: -2, tB: 84, sB: 80, headDx: -1, headDy: 0)
        case .hurt:
            return ChibiPoseParams(lean: -16, uF: -8, fF: 70, uB: -22, fB: 55, tF: 20, sF: -6, tB: -14, sB: -30, headDx: -2, headDy: 1)
        case .down:
            return ChibiPoseParams(lean: -44, uF: -50, fF: -8, uB: -62, fB: -14, tF: 44, sF: -14, tB: 14, sB: -56, headDx: -5, headDy: 3)
        }
    }
}

// MARK: - Canvas

struct ChibiCanvas {
    let w: Int
    let h: Int
    var px: [UInt8]
    /// Ink blob size in pixels.
    var cell: Double = 3

    init(w: Int, h: Int) {
        self.w = w
        self.h = h
        self.px = [UInt8](repeating: 0, count: w * h * 4)
    }

    mutating func set(_ i: Int, _ c: ChibiRGB) {
        px[i * 4] = UInt8(clamping: c.r)
        px[i * 4 + 1] = UInt8(clamping: c.g)
        px[i * 4 + 2] = UInt8(clamping: c.b)
        px[i * 4 + 3] = 255
    }

    func center(_ x: Int, _ y: Int) -> ChibiV2 { ChibiV2(Double(x) + 0.5, Double(y) + 0.5) }

    /// 1px dark ring just outside `m` (4-neighbour dilation); overwrites whatever is there.
    mutating func ring(_ m: [Bool]) {
        var dil = m
        for y in 0..<h {
            for x in 0..<w where m[y * w + x] {
                if x > 0 { dil[y * w + x - 1] = true }
                if x < w - 1 { dil[y * w + x + 1] = true }
                if y > 0 { dil[(y - 1) * w + x] = true }
                if y < h - 1 { dil[(y + 1) * w + x] = true }
            }
        }
        for i in 0..<(w * h) where dil[i] && !m[i] { set(i, ChibiHeadExtractor.outline) }
    }

    func capsuleMask(_ a: ChibiV2, _ b: ChibiV2, _ r0: Double, _ r1: Double) -> [Bool] {
        let d = b - a
        let len2 = max((d * d).sum(), 0.0001)
        var m = [Bool](repeating: false, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let p = center(x, y)
                let t = min(1, max(0, ((p - a) * d).sum() / len2))
                let c = a + d * t
                let q = p - c
                if (q * q).sum().squareRoot() <= r0 + (r1 - r0) * t { m[y * w + x] = true }
            }
        }
        return m
    }

    /// Tapered capsule with 3-tone shading and optional ink blobs in limb-local coordinates.
    @discardableResult
    mutating func limb(
        _ a: ChibiV2, _ b: ChibiV2, _ r0: Double, _ r1: Double, _ col: ChibiRGB,
        ink: Int = 0, inkSeed: UInt32 = 0, tint: ChibiRGB? = nil,
        lightSign: Double = 1, ring doRing: Bool = true
    ) -> [Bool] {
        let d = b - a
        let len = max((d * d).sum().squareRoot(), 0.01)
        let u = d / len
        var m = [Bool](repeating: false, count: w * h)
        var tArr = [Double](repeating: 0, count: w * h)
        var perpArr = [Double](repeating: 0, count: w * h)
        var rArr = [Double](repeating: 0, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let p = center(x, y)
                let t = min(1, max(0, ((p - a) * u).sum() / len))
                let c = a + d * t
                let r = r0 + (r1 - r0) * t
                let q = p - c
                let i = y * w + x
                if (q * q).sum().squareRoot() <= r {
                    m[i] = true
                    tArr[i] = t
                    rArr[i] = r
                    perpArr[i] = q.x * (-u.y) + q.y * u.x
                }
            }
        }
        if doRing { ring(m) }
        let shade = col.shaded(0.72)
        let hi = col.shaded(1.12)
        let inkColor = ink > 0 ? Self.inkColor(skin: col, tint: tint) : col
        let blob = max(2.2, cell)
        for i in 0..<(w * h) where m[i] {
            let nd = perpArr[i] / max(rArr[i], 0.01) * lightSign
            var c = col
            if nd > 0.40 { c = shade } else if nd < -0.60 { c = hi }
            if ink > 0, abs(nd) < 0.85,
               Self.inkHit(tArr[i] * len, perpArr[i], density: ink, seed: inkSeed, cell: blob)
            {
                c = inkColor
            }
            set(i, c)
        }
        return m
    }

    mutating func poly(_ pts: [ChibiV2], _ col: ChibiRGB) -> [Bool] {
        var m = [Bool](repeating: true, count: w * h)
        let n = pts.count
        for y in 0..<h {
            for x in 0..<w {
                let p = center(x, y)
                for k in 0..<n {
                    let p0 = pts[k]
                    let p1 = pts[(k + 1) % n]
                    if (p1.x - p0.x) * (p.y - p0.y) - (p1.y - p0.y) * (p.x - p0.x) < 0 {
                        m[y * w + x] = false
                        break
                    }
                }
            }
        }
        ring(m)
        for i in 0..<(w * h) where m[i] { set(i, col) }
        return m
    }

    static func inkColor(skin: ChibiRGB, tint: ChibiRGB?) -> ChibiRGB {
        let base = skin.meanChannel > 110 ? ChibiRGB(38, 44, 58) : ChibiRGB(20, 20, 28)
        if let tint { return base.mixed(with: tint, 0.55) }
        return base
    }

    /// Stable blobs in part-local coordinates: the ink follows the limb and does not shimmer between frames.
    static func inkHit(_ lx: Double, _ ly: Double, density: Int, seed: UInt32, cell: Double) -> Bool {
        let threshold: Double
        switch density {
        case 1: threshold = 0.30
        case 2: threshold = 0.42
        case 3: threshold = 0.54
        default: return false
        }
        return ChibiHash.valueNoise(lx / cell, ly / cell, seed) < threshold
    }
}

// MARK: - Renderer

enum ChibiBodyRenderer {
    /// Bumped whenever the drawing changes, so cached frames regenerate.
    static let version = 1
    /// Body height below the head anchor, in logical pixels (whole figure ≈ 65px with the 25px head).
    static let bodyHeight = 38

    /// Canvas geometry shared by every pose: feet rest 3px above the bottom, hip x at 48% of the width.
    static var canvasWidth: Int { Int(Double(bodyHeight) * 3.0) }
    static var canvasHeight: Int { Int(Double(bodyHeight) * 2.2) }
    static var hipX: Double { Double(canvasWidth) * 0.48 }

    private static func rot(_ degrees: Double) -> ChibiV2 {
        let r = degrees * Double.pi / 180
        return ChibiV2(sin(r), cos(r))
    }

    private static func seed(_ style: ChibiStyle, _ zone: String) -> UInt32 {
        ChibiHash.fnv1a(style.fighterId + zone)
    }

    static func render(pose: ChibiPose, style: ChibiStyle, head: ChibiBitmap?) -> ChibiBitmap {
        let P = pose.params
        let H = Double(bodyHeight)
        let W = canvasWidth
        let cH = canvasHeight
        var c = ChibiCanvas(w: W, h: cH)
        c.cell = H * 0.085
        let u = H
        let build = style.build
        let skin = style.skin
        let shorts = style.shorts
        let trim = shorts.channelSum < 200 ? shorts.shaded(1.5) : shorts.shaded(0.6)
        let ink = style.ink
        let tint = style.inkTint

        let torso = 0.40 * u
        let thigh = 0.33 * u
        let shin = 0.33 * u
        let ua = 0.27 * u
        let fa = 0.25 * u
        let sw = 0.62 * u * build
        let hw = 0.34 * u * build
        let rArm = max(1.5, 0.085 * u * build)
        let rLeg = max(1.8, 0.095 * u * build)

        // Forward kinematics: hip at the origin, then shift so the lowest foot rests on the floor.
        let hip = ChibiV2(0, 0)
        let hipF = ChibiV2(hip.x + hw * 0.30, hip.y)
        let hipB = ChibiV2(hip.x - hw * 0.30, hip.y)
        let kF = hipF + rot(P.tF) * thigh
        let aF = kF + rot(P.sF) * shin
        let kB = hipB + rot(P.tB) * thigh
        let aB = kB + rot(P.sB) * shin
        let floor = max(aF.y, aB.y)
        let ox = Double(W) * 0.48
        let oy = Double(cH) - 3 - floor - rLeg * 0.6
        func T(_ p: ChibiV2) -> ChibiV2 { ChibiV2(p.x + ox, p.y + oy) }

        let lean = rot(P.lean)
        let chest = ChibiV2(hip.x + lean.x * torso, hip.y - lean.y * torso)
        let across = ChibiV2(lean.y, lean.x)
        let shF = chest + across * (sw * 0.40)
        let shB = chest + across * (-sw * 0.60)
        let eF = shF + rot(P.uF) * ua
        let wF = eF + rot(P.fF) * fa
        let eB = shB + rot(P.uB) * ua
        let wB = eB + rot(P.fB) * fa

        func arm(_ sh: ChibiV2, _ e: ChibiV2, _ w: ChibiV2, upper: Int, fore: Int, upperSeed: UInt32, foreSeed: UInt32) {
            let dv = w - e
            let len = max((dv * dv).sum().squareRoot(), 0.01)
            let v = dv / len
            let g = w + v * (rArm * 0.9)
            let outer = c.capsuleMask(T(sh), T(e), rArm * 1.1, rArm * 0.9)
            let outer2 = c.capsuleMask(T(e), T(w), rArm * 0.9, rArm * 0.72)
            var union = outer
            for i in union.indices where outer2[i] { union[i] = true }
            c.ring(union)
            c.limb(T(sh), T(e), rArm * 1.1, rArm * 0.9, skin, ink: upper, inkSeed: upperSeed, tint: tint, ring: false)
            c.limb(T(e), T(w), rArm * 0.9, rArm * 0.72, skin, ink: fore, inkSeed: foreSeed, tint: tint, ring: false)
            // wrist tape + glove
            c.limb(T(w - v * (rArm * 0.5)), T(w + v * (rArm * 0.2)), rArm * 0.78, rArm * 0.78, ChibiRGB(232, 232, 236), ring: false)
            c.limb(T(g), T(g + v * 0.1), rArm * 1.3, rArm * 1.3, ChibiRGB(34, 36, 44))
        }

        func leg(_ hp: ChibiV2, _ k: ChibiV2, _ a: ChibiV2, _ tone: ChibiRGB) {
            let foot = ChibiV2(a.x + rLeg * 1.3, a.y + rLeg * 0.35)
            var union = c.capsuleMask(T(hp), T(k), rLeg * 1.15, rLeg * 0.9)
            let m2 = c.capsuleMask(T(k), T(a), rLeg * 0.9, rLeg * 0.6)
            let m3 = c.capsuleMask(T(a), T(foot), rLeg * 0.55, rLeg * 0.42)
            for i in union.indices where m2[i] || m3[i] { union[i] = true }
            c.ring(union)
            c.limb(T(a), T(foot), rLeg * 0.55, rLeg * 0.42, tone, ring: false)
            c.limb(T(k), T(a), rLeg * 0.9, rLeg * 0.6, tone, ring: false)
            c.limb(T(hp), T(k), rLeg * 1.15, rLeg * 0.9, tone, ring: false)
            let mid = ChibiV2(hp.x + (k.x - hp.x) * 0.68, hp.y + (k.y - hp.y) * 0.68)
            c.limb(T(hp), T(mid), rLeg * 1.3, rLeg * 1.2, shorts)
        }

        let upperBSeed = seed(style, "upperR")
        let foreBSeed = seed(style, "foreR")
        let upperFSeed = seed(style, "upperL")
        let foreFSeed = seed(style, "foreL")

        // Back arm (photo-right) behind everything, then legs, pelvis, torso, neck, head, front arm.
        arm(shB, eB, wB, upper: ink.upperR, fore: ink.foreR, upperSeed: upperBSeed, foreSeed: foreBSeed)
        leg(hipB, kB, aB, skin.shaded(0.9))
        leg(hipF, kF, aF, skin)
        c.limb(T(hipB), T(hipF), rLeg * 1.3, rLeg * 1.3, shorts)

        let tp: [ChibiV2] = [
            T(shB + across * (-rArm * 0.3)),
            T(shF + across * (rArm * 0.3)),
            T(hip + across * (hw * 0.72)),
            T(hip + across * (-hw * 0.72)),
        ]
        let tm = c.poly(tp, skin)

        let a0 = T(chest)
        var su = [Double](repeating: 0, count: W * cH)
        var sv = [Double](repeating: 0, count: W * cH)
        for y in 0..<cH {
            for x in 0..<W where tm[y * W + x] {
                let p = c.center(x, y)
                su[y * W + x] = ((p.x - a0.x) * across.x + (p.y - a0.y) * across.y) / (sw * 0.75)
                sv[y * W + x] = ((p.x - a0.x) * lean.x + (p.y - a0.y) * lean.y) / torso
            }
        }
        let shadeTone = skin.shaded(0.72)
        let lightTone = skin.shaded(1.12)
        let chestSeed = seed(style, "chest")
        let bellySeed = seed(style, "belly")
        let inkColor = ChibiCanvas.inkColor(skin: skin, tint: tint)
        let blob = max(2.2, c.cell)
        for i in 0..<(W * cH) where tm[i] {
            if su[i] < -0.55 { c.set(i, shadeTone) }
            if su[i] > 0.62 { c.set(i, lightTone) }
        }
        // Pec line and a short ab line, only where the size can hold them.
        for i in 0..<(W * cH) where tm[i] {
            if H >= 30, abs(sv[i] - 0.42) < 0.5 / torso, abs(su[i]) < 0.62 { c.set(i, shadeTone) }
            if H >= 36, abs(su[i] - 0.02) < 0.45 / (sw * 0.75), sv[i] > 0.42, sv[i] < 0.95 { c.set(i, shadeTone) }
        }
        // Torso ink in stable local cells.
        for i in 0..<(W * cH) where tm[i] {
            let zoneChest = sv[i] < 0.55
            let density = zoneChest ? ink.chest : ink.belly
            if density > 0, abs(su[i]) < 0.86, sv[i] > -0.05,
               ChibiCanvas.inkHit(su[i] * sw * 0.75, sv[i] * torso, density: density, seed: zoneChest ? chestSeed : bellySeed, cell: blob)
            {
                c.set(i, inkColor)
            }
        }
        // Waistband and shorts top.
        for i in 0..<(W * cH) where tm[i] {
            if sv[i] > 0.98 { c.set(i, trim) }
            if sv[i] > 1.05 { c.set(i, shorts) }
        }

        // Neck.
        let neckTop = ChibiV2(chest.x + lean.x * 0.10 * u, chest.y - lean.y * 0.10 * u)
        c.limb(T(chest + across * (-sw * 0.1)), T(neckTop + across * (-sw * 0.1)), rArm * 1.35, rArm * 1.25, skin.shaded(0.8))
        let anchor = T(neckTop + across * (-sw * 0.1))

        // Head, between neck and front arm so the guard glove can overlap the jaw edge.
        let headSprite = head ?? fallbackHead(skin: skin)
        let hx = Int(anchor.x - Double(headSprite.width) / 2) + P.headDx
        let hy = Int(anchor.y - Double(headSprite.height) + max(2.0, Double(ChibiHeadExtractor.headHeight) * 0.08)) + P.headDy
        for sy in 0..<headSprite.height {
            for sx in 0..<headSprite.width {
                let si = (sy * headSprite.width + sx) * 4
                guard headSprite.pixels[si + 3] > 0 else { continue }
                let dx = hx + sx
                let dy = hy + sy
                guard dx >= 0, dy >= 0, dx < W, dy < cH else { continue }
                let di = (dy * W + dx) * 4
                c.px[di] = headSprite.pixels[si]
                c.px[di + 1] = headSprite.pixels[si + 1]
                c.px[di + 2] = headSprite.pixels[si + 2]
                c.px[di + 3] = 255
            }
        }

        arm(shF, eF, wF, upper: ink.upperL, fore: ink.foreL, upperSeed: upperFSeed, foreSeed: foreFSeed)

        var out = ChibiBitmap(width: W, height: cH)
        out.pixels = c.px
        return out
    }

    /// §3.6 stand-in when no photo head is available: a plain skin-toned oval with the same outline.
    static func fallbackHead(skin: ChibiRGB) -> ChibiBitmap {
        let w = 21
        let h = ChibiHeadExtractor.headHeight + 2
        var bmp = ChibiBitmap(width: w, height: h)
        var solid = [Bool](repeating: false, count: w * h)
        for y in 1..<(h - 1) {
            for x in 1..<(w - 1) {
                let nx = (Double(x) + 0.5 - Double(w) / 2) / (Double(w - 2) / 2)
                let ny = (Double(y) + 0.5 - Double(h) / 2) / (Double(h - 2) / 2)
                if nx * nx + ny * ny <= 1 { solid[y * w + x] = true }
            }
        }
        for y in 0..<h {
            for x in 0..<w {
                let i = (y * w + x) * 4
                if solid[y * w + x] {
                    let c = normX(x, w) > 0.35 ? skin.shaded(0.72) : skin
                    bmp.pixels[i] = UInt8(clamping: c.r)
                    bmp.pixels[i + 1] = UInt8(clamping: c.g)
                    bmp.pixels[i + 2] = UInt8(clamping: c.b)
                    bmp.pixels[i + 3] = 255
                } else {
                    let near = (x > 0 && solid[y * w + x - 1]) || (x < w - 1 && solid[y * w + x + 1])
                        || (y > 0 && solid[(y - 1) * w + x]) || (y < h - 1 && solid[(y + 1) * w + x])
                    if near {
                        let o = ChibiHeadExtractor.outline
                        bmp.pixels[i] = UInt8(o.r)
                        bmp.pixels[i + 1] = UInt8(o.g)
                        bmp.pixels[i + 2] = UInt8(o.b)
                        bmp.pixels[i + 3] = 255
                    }
                }
            }
        }
        return bmp
    }

    private static func normX(_ x: Int, _ w: Int) -> Double {
        (Double(x) + 0.5 - Double(w) / 2) / (Double(w) / 2)
    }
}
