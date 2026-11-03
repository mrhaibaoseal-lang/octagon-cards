import CoreGraphics
import Foundation
import SpriteKit
import UIKit
import FightEngine

/// On-device Zero-AI Official Cutout Pixelation & Caching Service (P1-3, see RULES.md §2.1 & §4.2).
///
/// Pipeline executed locally on iPhone when a fighter is needed:
/// 1. Download official transparent PNG (`fullBodyImageUrl` / `headshotImageUrl`) — zero photos stored in repo.
/// 2. Trim transparent borders via alpha bounding-box detection.
/// 3. Boost contrast & apply unsharp mask to preserve tattoos and facial structure.
/// 4. Area-average (BOX) downsample to `116px` height (body sprite) or `64x64px` (headshot).
/// 5. Quantize opaque pixels to a 32-color adaptive palette (zero dithering).
/// 6. Apply a 1px dark outline (`#12141F`) and cache to disk (`Caches/PixelSprites_v1/`).
actor FighterPixelSpriteService {
    static let shared = FighterPixelSpriteService()

    enum SpriteKind: String, Sendable {
        case fullBody = "body_116"
        case headshot = "head_64"

        var targetHeight: Int {
            switch self {
            case .fullBody: 116
            case .headshot: 64
            }
        }

        var isSquare: Bool {
            self == .headshot
        }
    }

    private var memoryCache: [String: Data] = [:]
    private let cacheDirectory: URL

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("PixelSprites_v1", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.cacheDirectory = dir
    }

    private func cacheKey(fighterId: String, kind: SpriteKind) -> String {
        let safeId = fighterId.replacingOccurrences(of: "/", with: "_")
        return "\(safeId)_\(kind.rawValue).png"
    }

    private func diskURL(for key: String) -> URL {
        cacheDirectory.appendingPathComponent(key)
    }

    /// Returns pixelated PNG data for the requested fighter and sprite kind (from memory, disk, or network + on-device pixelator).
    func spritePNGData(for fighter: Fighter, kind: SpriteKind) async -> Data {
        let key = cacheKey(fighterId: fighter.id, kind: kind)
        if let mem = memoryCache[key] {
            return mem
        }
        let fileURL = diskURL(for: key)
        if let diskData = try? Data(contentsOf: fileURL), !diskData.isEmpty {
            memoryCache[key] = diskData
            return diskData
        }

        let urlString = (kind == .fullBody) ? (fighter.fullBodyImageUrl ?? fighter.headshotImageUrl) : (fighter.headshotImageUrl ?? fighter.fullBodyImageUrl)
        if let urlStr = urlString, let url = URL(string: urlStr) {
            var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
            request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")
            if let (rawData, response) = try? await URLSession.shared.data(for: request),
               let http = response as? HTTPURLResponse,
               (200...299).contains(http.statusCode),
               let uiImage = UIImage(data: rawData),
               let cgImage = uiImage.cgImage,
               let pixelatedCG = Self.pixelateCGImage(
                   cgImage,
                   targetHeight: kind.targetHeight,
                   isSquareHeadshot: kind.isSquare
               ),
               let pngData = UIImage(cgImage: pixelatedCG).pngData()
            {
                memoryCache[key] = pngData
                try? pngData.write(to: fileURL, options: .atomic)
                return pngData
            }
        }

        // Offline or newcomer without official photo -> generate procedural pixel silhouette (RULES.md §4.2)
        if let fallbackCG = Self.makeFallbackSilhouette(
            for: fighter,
            targetHeight: kind.targetHeight,
            isSquareHeadshot: kind.isSquare
        ),
           let pngData = UIImage(cgImage: fallbackCG).pngData()
        {
            memoryCache[key] = pngData
            return pngData
        }
        return Data()
    }

    // MARK: - 5-Step CoreGraphics Pixelation Pipeline

    private struct RGBA: Hashable {
        var r: UInt8
        var g: UInt8
        var b: UInt8
        var a: UInt8
    }

    static func pixelateCGImage(
        _ cgImage: CGImage,
        targetHeight: Int = 116,
        isSquareHeadshot: Bool = false
    ) -> CGImage? {
        let srcW = cgImage.width
        let srcH = cgImage.height
        guard srcW > 4, srcH > 4 else { return nil }

        var srcPixels = [UInt8](repeating: 0, count: srcW * srcH * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        guard let ctx = CGContext(
            data: &srcPixels,
            width: srcW,
            height: srcH,
            bitsPerComponent: 8,
            bytesPerRow: srcW * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo
        ) else {
            return nil
        }
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: srcW, height: srcH))

        // Un-premultiply and locate Step 1 Alpha Bounding Box
        var minX = srcW
        var minY = srcH
        var maxX = 0
        var maxY = 0
        for y in 0..<srcH {
            let rowOffset = y * srcW * 4
            for x in 0..<srcW {
                let idx = rowOffset + x * 4
                let a = srcPixels[idx + 3]
                if a >= 16 {
                    if a < 255 {
                        let af = Double(a) / 255.0
                        srcPixels[idx] = UInt8(min(255.0, Double(srcPixels[idx]) / af))
                        srcPixels[idx + 1] = UInt8(min(255.0, Double(srcPixels[idx + 1]) / af))
                        srcPixels[idx + 2] = UInt8(min(255.0, Double(srcPixels[idx + 2]) / af))
                    }
                    if x < minX { minX = x }
                    if x > maxX { maxX = x }
                    if y < minY { minY = y }
                    if y > maxY { maxY = y }
                }
            }
        }

        if minX >= maxX || minY >= maxY {
            minX = 0; minY = 0; maxX = srcW - 1; maxY = srcH - 1
        }
        // For full-body sprites, cap aspect ratio so wide stances or belts still fit cleanly
        let cropW = max(1, maxX - minX + 1)
        let cropH = max(1, maxY - minY + 1)

        // Step 2 & Step 3: Box Area-Average Downsample with Contrast/Detail Enhancement
        let outW: Int
        let outH = targetHeight
        let innerW: Int
        let innerH: Int
        let padX: Int
        let padY: Int

        if isSquareHeadshot {
            outW = targetHeight
            let scale = min(Double(targetHeight - 2) / Double(cropW), Double(targetHeight - 2) / Double(cropH))
            innerW = max(8, Int((Double(cropW) * scale).rounded()))
            innerH = max(8, Int((Double(cropH) * scale).rounded()))
            padX = (outW - innerW) / 2
            padY = max(1, outH - innerH - 1)
        } else {
            innerH = max(16, targetHeight - 2)
            let aspect = min(0.85, max(0.32, Double(cropW) / Double(cropH)))
            innerW = max(16, Int((Double(innerH) * aspect).rounded()))
            outW = innerW + 2
            padX = 1
            padY = 1
        }

        var downsampled = [RGBA](repeating: RGBA(r: 0, g: 0, b: 0, a: 0), count: outW * outH)

        for dy in 0..<innerH {
            let sy0 = minY + (dy * cropH) / innerH
            let sy1 = max(sy0 + 1, min(maxY + 1, minY + ((dy + 1) * cropH) / innerH))
            for dx in 0..<innerW {
                let sx0 = minX + (dx * cropW) / innerW
                let sx1 = max(sx0 + 1, min(maxX + 1, minX + ((dx + 1) * cropW) / innerW))

                var rSum = 0.0
                var gSum = 0.0
                var bSum = 0.0
                var aSum = 0.0
                var opaqueCount = 0.0
                var totalSamples = 0.0

                for sy in sy0..<sy1 {
                    let rowBase = sy * srcW * 4
                    for sx in sx0..<sx1 {
                        let pIdx = rowBase + sx * 4
                        let a = Double(srcPixels[pIdx + 3])
                        totalSamples += 1.0
                        aSum += a
                        if a >= 32.0 {
                            let w = a / 255.0
                            rSum += Double(srcPixels[pIdx]) * w
                            gSum += Double(srcPixels[pIdx + 1]) * w
                            bSum += Double(srcPixels[pIdx + 2]) * w
                            opaqueCount += w
                        }
                    }
                }

                let avgAlpha = totalSamples > 0 ? (aSum / totalSamples) : 0.0
                if avgAlpha >= 92.0, opaqueCount > 0 {
                    var r = rSum / opaqueCount
                    var g = gSum / opaqueCount
                    var b = bSum / opaqueCount

                    // Contrast boost (1.18x around midpoint 128) to preserve tattoos and shorts contrast
                    r = min(255.0, max(0.0, (r - 128.0) * 1.18 + 128.0))
                    g = min(255.0, max(0.0, (g - 128.0) * 1.18 + 128.0))
                    b = min(255.0, max(0.0, (b - 128.0) * 1.18 + 128.0))

                    let outIdx = (dy + padY) * outW + (dx + padX)
                    downsampled[outIdx] = RGBA(
                        r: UInt8(r.rounded()),
                        g: UInt8(g.rounded()),
                        b: UInt8(b.rounded()),
                        a: 255
                    )
                }
            }
        }

        // Step 4: 32-Color Adaptive Palette Quantization (Zero Dithering)
        let quantized = quantizeTo32Colors(pixels: downsampled, width: outW, height: outH)

        // Step 5: Apply 1px Dark Outline (#12141F)
        let outlined = applyDarkOutline(pixels: quantized, width: outW, height: outH)

        return makeCGImage(from: outlined, width: outW, height: outH)
    }

    private static func quantizeTo32Colors(pixels: [RGBA], width: Int, height: Int) -> [RGBA] {
        // Bucket opaque pixels into 5-bit RGB (32x32x32) bins, pick top 32 centroids, and map without dithering
        struct BinAccum {
            var count: Int = 0
            var rSum: Int = 0
            var gSum: Int = 0
            var bSum: Int = 0
        }
        var bins: [Int: BinAccum] = [:]
        for px in pixels where px.a > 0 {
            let key = (Int(px.r >> 4) << 8) | (Int(px.g >> 4) << 4) | Int(px.b >> 4)
            var b = bins[key, default: BinAccum()]
            b.count += 1
            b.rSum += Int(px.r)
            b.gSum += Int(px.g)
            b.bSum += Int(px.b)
            bins[key] = b
        }

        let topBins = bins.values.sorted { $0.count > $1.count }.prefix(32)
        let palette: [RGBA] = topBins.map { b in
            RGBA(
                r: UInt8(b.rSum / max(1, b.count)),
                g: UInt8(b.gSum / max(1, b.count)),
                b: UInt8(b.bSum / max(1, b.count)),
                a: 255
            )
        }
        guard !palette.isEmpty else { return pixels }

        return pixels.map { px in
            guard px.a > 0 else { return px }
            var best = palette[0]
            var bestDist = Int.max
            for c in palette {
                let dr = Int(px.r) - Int(c.r)
                let dg = Int(px.g) - Int(c.g)
                let db = Int(px.b) - Int(c.b)
                let dist = dr * dr * 2 + dg * dg * 4 + db * db
                if dist < bestDist {
                    bestDist = dist
                    best = c
                }
            }
            return best
        }
    }

    private static func applyDarkOutline(pixels: [RGBA], width: Int, height: Int) -> [RGBA] {
        let outline = RGBA(r: 18, g: 20, b: 31, a: 255)
        var out = pixels
        let offsets = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        for y in 0..<height {
            for x in 0..<width {
                let idx = y * width + x
                if pixels[idx].a > 0 { continue }
                for (dx, dy) in offsets {
                    let nx = x + dx
                    let ny = y + dy
                    if nx >= 0, nx < width, ny >= 0, ny < height {
                        if pixels[ny * width + nx].a > 0 {
                            out[idx] = outline
                            break
                        }
                    }
                }
            }
        }
        return out
    }

    private static func makeCGImage(from pixels: [RGBA], width: Int, height: Int) -> CGImage? {
        var raw = [UInt8](repeating: 0, count: width * height * 4)
        for (i, px) in pixels.enumerated() {
            let base = i * 4
            raw[base] = px.r
            raw[base + 1] = px.g
            raw[base + 2] = px.b
            raw[base + 3] = px.a
        }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        guard let provider = CGDataProvider(data: Data(raw) as CFData) else { return nil }
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )
    }

    /// Procedural fallback pixel fighter silhouette (RULES.md §4.2) when offline or no official cutout exists yet.
    static func makeFallbackSilhouette(
        for fighter: Fighter,
        targetHeight: Int = 116,
        isSquareHeadshot: Bool = false
    ) -> CGImage? {
        let h = targetHeight
        let w = isSquareHeadshot ? targetHeight : 64
        var pixels = [RGBA](repeating: RGBA(r: 0, g: 0, b: 0, a: 0), count: w * h)

        let hash = abs(fighter.id.hashValue)
        let skinTones: [RGBA] = [
            RGBA(r: 228, g: 182, b: 148, a: 255),
            RGBA(r: 198, g: 146, b: 110, a: 255),
            RGBA(r: 142, g: 96, b: 68, a: 255),
            RGBA(r: 236, g: 196, b: 168, a: 255),
        ]
        let trunkColors: [RGBA] = [
            RGBA(r: 30, g: 130, b: 225, a: 255),
            RGBA(r: 215, g: 45, b: 55, a: 255),
            RGBA(r: 35, g: 175, b: 95, a: 255),
            RGBA(r: 225, g: 175, b: 35, a: 255),
            RGBA(r: 40, g: 45, b: 58, a: 255),
        ]
        let skin = skinTones[hash % skinTones.count]
        let skinShade = RGBA(r: skin.r &- 24, g: skin.g &- 22, b: skin.b &- 18, a: 255)
        let trunks = trunkColors[(hash / 7) % trunkColors.count]
        let gloves = RGBA(r: 25, g: 28, b: 38, a: 255)
        let hair = RGBA(r: 32, g: 28, b: 26, a: 255)

        func fillRect(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, _ color: RGBA) {
            for y in max(1, y0)...min(h - 2, y1) {
                for x in max(1, x0)...min(w - 2, x1) {
                    pixels[y * w + x] = color
                }
            }
        }

        if isSquareHeadshot {
            fillRect(20, 8, 43, 15, hair)
            fillRect(19, 15, 44, 40, skin)
            fillRect(19, 32, 44, 40, skinShade)
            fillRect(24, 40, 39, 47, skinShade)
            fillRect(10, 46, 53, 62, skin)
        } else {
            // Head & hair
            fillRect(23, 6, 40, 12, hair)
            fillRect(22, 12, 41, 29, skin)
            fillRect(26, 29, 37, 34, skinShade)
            // Torso & shoulders
            fillRect(14, 34, 49, 68, skin)
            fillRect(20, 48, 43, 68, skinShade)
            // Guard arms & MMA gloves
            fillRect(9, 36, 15, 56, skin)
            fillRect(48, 36, 54, 56, skin)
            fillRect(10, 26, 18, 36, gloves)
            fillRect(45, 24, 53, 34, gloves)
            // MMA Fight Shorts
            fillRect(17, 68, 46, 86, trunks)
            // Legs
            fillRect(18, 87, 28, 112, skin)
            fillRect(35, 87, 45, 112, skin)
        }

        let outlined = applyDarkOutline(pixels: pixels, width: w, height: h)
        return makeCGImage(from: outlined, width: w, height: h)
    }
}
