import CoreGraphics
import Foundation
import UIKit

// P6-3 small chibi fighter: shared value types (docs/VISUAL_DIRECTION.md §3).
// Everything here is a plain Sendable value so the generator can run off the main actor.

// MARK: - Colour

struct ChibiRGB: Hashable, Sendable {
    var r: Int
    var g: Int
    var b: Int

    init(_ r: Int, _ g: Int, _ b: Int) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// "#RRGGBB" (the leading "#" is optional).
    init?(hex: String) {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = Int(s, radix: 16) else { return nil }
        self.init((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)
    }

    /// Multiply each channel (clamped), like the prototype's `shade`.
    func shaded(_ k: Double) -> ChibiRGB {
        ChibiRGB(
            min(255, Int(Double(r) * k)),
            min(255, Int(Double(g) * k)),
            min(255, Int(Double(b) * k))
        )
    }

    func mixed(with o: ChibiRGB, _ t: Double) -> ChibiRGB {
        ChibiRGB(
            Int(Double(r) * (1 - t) + Double(o.r) * t),
            Int(Double(g) * (1 - t) + Double(o.g) * t),
            Int(Double(b) * (1 - t) + Double(o.b) * t)
        )
    }

    var meanChannel: Double { Double(r + g + b) / 3.0 }
    var channelSum: Int { r + g + b }
}

// MARK: - Bitmap

/// RGBA8 pixel buffer, row 0 on top. Sprites produced by the generator only ever hold alpha 0 or 255,
/// so straight and premultiplied alpha are identical for them.
struct ChibiBitmap: Sendable {
    let width: Int
    let height: Int
    var pixels: [UInt8]

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        self.pixels = [UInt8](repeating: 0, count: width * height * 4)
    }

    /// Decodes any CGImage into premultiplied RGBA8 pixels.
    init?(cgImage: CGImage) {
        let w = cgImage.width
        let h = cgImage.height
        guard w > 0, h > 0 else { return nil }
        var buffer = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(
                      data: base, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  )
            else { return false }
            ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        self.width = w
        self.height = h
        self.pixels = buffer
    }

    init?(pngData: Data) {
        guard let image = UIImage(data: pngData), let cg = image.cgImage else { return nil }
        self.init(cgImage: cg)
    }

    func makeCGImage() -> CGImage? {
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
        return CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        )
    }

    func pngData() -> Data? {
        guard let cg = makeCGImage() else { return nil }
        return UIImage(cgImage: cg).pngData()
    }
}

// MARK: - Look table (data/fighter_looks.json)

enum ChibiBuild: String, Codable, Sendable {
    case slim, normal, stocky

    /// Multiplies shoulder / hip width and limb thickness.
    var scale: Double {
        switch self {
        case .slim: return 0.88
        case .normal: return 1.0
        case .stocky: return 1.12
        }
    }
}

/// Ink density per zone, 0 (none) … 3 (heavy). L / R = left / right side of the official photo.
struct ChibiInk: Codable, Sendable, Hashable {
    var chest = 0
    var belly = 0
    var upperL = 0
    var foreL = 0
    var upperR = 0
    var foreR = 0

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        chest = try c.decodeIfPresent(Int.self, forKey: .chest) ?? 0
        belly = try c.decodeIfPresent(Int.self, forKey: .belly) ?? 0
        upperL = try c.decodeIfPresent(Int.self, forKey: .upperL) ?? 0
        foreL = try c.decodeIfPresent(Int.self, forKey: .foreL) ?? 0
        upperR = try c.decodeIfPresent(Int.self, forKey: .upperR) ?? 0
        foreR = try c.decodeIfPresent(Int.self, forKey: .foreR) ?? 0
    }
}

struct ChibiLook: Codable, Sendable, Hashable {
    var skin: String?
    var build: ChibiBuild?
    var ink: ChibiInk?
    var inkTint: String?
    var shorts: String?
}

private struct ChibiLookFile: Codable {
    var fighters: [String: ChibiLook]
}

enum ChibiLooks {
    static let table: [String: ChibiLook] = load()

    static func look(for id: String) -> ChibiLook? { table[id] }

    private static func load() -> [String: ChibiLook] {
        guard let url = Bundle.main.url(forResource: "fighter_looks", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(ChibiLookFile.self, from: data)
        else { return [:] }
        return file.fighters
    }
}

/// A look with every default filled in (docs/VISUAL_DIRECTION.md §3.3: ink 0, normal build, skin sampled from the face).
struct ChibiStyle: Sendable, Hashable {
    var fighterId: String
    var skin: ChibiRGB
    var build: Double
    var ink: ChibiInk
    var inkTint: ChibiRGB?
    var shorts: ChibiRGB

    static let defaultShorts = ChibiRGB(44, 46, 54)
}

// MARK: - Stable hashing (Swift's Hasher is seeded per launch, so it must not feed the ink noise)

enum ChibiHash {
    static func fnv1a(_ text: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for byte in text.utf8 {
            h = (h ^ UInt32(byte)) &* 16_777_619
        }
        return h
    }

    static func lattice(_ x: Int, _ y: Int, _ seed: UInt32) -> Double {
        var h: UInt32 = 2_166_136_261 ^ seed
        h = (h ^ UInt32(truncatingIfNeeded: x)) &* 16_777_619
        h = (h ^ UInt32(truncatingIfNeeded: y)) &* 16_777_619
        h ^= h >> 15
        h = h &* 2_246_822_519
        h ^= h >> 13
        h = h &* 3_266_489_917
        h ^= h >> 16
        return Double(h & 0xFFFF) / 65535.0
    }

    /// Smooth value noise on a lattice; stable for a given (x, y, seed).
    static func valueNoise(_ x: Double, _ y: Double, _ seed: UInt32) -> Double {
        let xi = Int(x.rounded(.down))
        let yi = Int(y.rounded(.down))
        var fx = x - Double(xi)
        var fy = y - Double(yi)
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        let a = lattice(xi, yi, seed)
        let b = lattice(xi + 1, yi, seed)
        let c = lattice(xi, yi + 1, seed)
        let d = lattice(xi + 1, yi + 1, seed)
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    }
}
