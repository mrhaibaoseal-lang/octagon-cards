import Foundation

// P6-3: pixel head from the official full-body photo, using only the alpha silhouette
// (find top of head and neck from row widths; no pose detection). Port of pipeline/chibi_proto/proto.py.

enum ChibiHeadExtractor {
    /// Head height in logical pixels (docs/VISUAL_DIRECTION.md §3.2).
    static let headHeight = 25
    static let colorCount = 18
    static let outline = ChibiRGB(18, 20, 31)

    /// Returns the outlined head sprite (width x (headHeight+2)), or nil when the silhouette has no usable head.
    static func extract(photoData: Data) -> ChibiBitmap? {
        guard let src = decodePhoto(photoData) else { return nil }
        guard let crop = cropHead(src) else { return nil }
        return makeSprite(crop: crop, hpx: headHeight)
    }

    /// Face tone for fighters without a table entry: darker quarter of the centre-lower face (avoids highlights).
    static func faceSkin(of sprite: ChibiBitmap) -> ChibiRGB {
        let w = sprite.width
        let h = sprite.height
        var samples: [(Double, ChibiRGB)] = []
        let x0 = Int(Double(w) * 0.36)
        let x1 = max(x0 + 1, Int(Double(w) * 0.64))
        let y0 = Int(Double(h) * 0.55)
        let y1 = max(y0 + 1, Int(Double(h) * 0.72))
        for y in y0..<min(y1, h) {
            for x in x0..<min(x1, w) {
                let i = (y * w + x) * 4
                guard sprite.pixels[i + 3] > 0 else { continue }
                let c = ChibiRGB(Int(sprite.pixels[i]), Int(sprite.pixels[i + 1]), Int(sprite.pixels[i + 2]))
                samples.append((c.meanChannel, c))
            }
        }
        guard !samples.isEmpty else { return ChibiRGB(200, 150, 120) }
        samples.sort { $0.0 < $1.0 }
        return samples[samples.count / 4].1
    }

    // MARK: Steps

    private struct Crop {
        var width: Int
        var height: Int
        /// Premultiplied RGBA, with the jaw-rounding mask already applied.
        var pixels: [UInt8]
    }

    private static func decodePhoto(_ data: Data) -> ChibiBitmap? {
        ChibiBitmap(pngData: data)
    }

    private static func median(_ values: ArraySlice<Double>) -> Double {
        guard !values.isEmpty else { return 0 }
        let s = values.sorted()
        let n = s.count
        return n % 2 == 1 ? s[n / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
    }

    private static func cropHead(_ src: ChibiBitmap) -> Crop? {
        let w = src.width
        let h = src.height
        let px = src.pixels
        guard h > 80, w > 20 else { return nil }

        var rowCount = [Int](repeating: 0, count: h)
        for y in 0..<h {
            var c = 0
            let base = y * w * 4
            for x in 0..<w where px[base + x * 4 + 3] > 128 { c += 1 }
            rowCount[y] = c
        }
        guard let top = rowCount.firstIndex(where: { $0 > 0 }) else { return nil }

        // 5-row moving average (zero padded, like the prototype).
        var prof = [Double](repeating: 0, count: h)
        for y in 0..<h {
            var s = 0
            for k in -2...2 {
                let yy = y + k
                if yy >= 0 && yy < h { s += rowCount[yy] }
            }
            prof[y] = Double(s) / 5.0
        }

        // Shoulders: first row whose width exceeds 1.7x the median of everything above it.
        var shoulder: Int?
        var y = top + 25
        while y < h {
            if prof[y] > 1.7 * median(prof[(top + 5)..<y]) {
                shoulder = y
                break
            }
            y += 1
        }
        let sh = min(shoulder ?? (top + 200), h - 1)
        let from = top + (sh - top) / 2
        guard from < sh else { return nil }
        var neck = from
        var best = prof[from]
        for yy in from..<sh where prof[yy] < best {
            best = prof[yy]
            neck = yy
        }
        guard neck - top >= 12 else { return nil }

        var x0 = w
        var x1 = -1
        for yy in top..<neck {
            let base = yy * w * 4
            for x in 0..<w where px[base + x * 4 + 3] > 128 {
                if x < x0 { x0 = x }
                if x > x1 { x1 = x }
            }
        }
        guard x1 > x0 else { return nil }

        let cw = x1 - x0 + 1
        let ch = neck - top
        var out = [UInt8](repeating: 0, count: cw * ch * 4)
        // Jaw-rounding ellipse on the lower part of the crop.
        let cx = Double(cw) / 2
        let cy = Double(ch) * 0.52
        let ax = Double(cw) * 0.54
        let ay = Double(ch) * 0.50
        for yy in 0..<ch {
            for xx in 0..<cw {
                if Double(yy) > cy {
                    let nx = (Double(xx) - cx) / ax
                    let ny = (Double(yy) - cy) / ay
                    if nx * nx + ny * ny > 1 { continue }
                }
                let s = ((top + yy) * w + (x0 + xx)) * 4
                let d = (yy * cw + xx) * 4
                out[d] = px[s]
                out[d + 1] = px[s + 1]
                out[d + 2] = px[s + 2]
                out[d + 3] = px[s + 3]
            }
        }
        return Crop(width: cw, height: ch, pixels: out)
    }

    private struct Px {
        var r: Double
        var g: Double
        var b: Double
        var opaque: Bool
    }

    /// Alpha-weighted box downsample (transparent pixels never bleed colour into the edge), then tone, sharpen,
    /// quantize and outline.
    private static func makeSprite(crop: Crop, hpx: Int) -> ChibiBitmap? {
        let iw = crop.width
        let ih = crop.height
        let tw = max(4, Int((Double(iw) * Double(hpx) / Double(ih)).rounded()))
        let sx = Double(iw) / Double(tw)
        let sy = Double(ih) / Double(hpx)

        var grid = [Px](repeating: Px(r: 0, g: 0, b: 0, opaque: false), count: tw * hpx)
        for ty in 0..<hpx {
            let fy0 = Double(ty) * sy
            let fy1 = Double(ty + 1) * sy
            for tx in 0..<tw {
                let fx0 = Double(tx) * sx
                let fx1 = Double(tx + 1) * sx
                var sumR = 0.0, sumG = 0.0, sumB = 0.0, sumA = 0.0, wsum = 0.0
                var yy = Int(fy0.rounded(.down))
                while Double(yy) < fy1 && yy < ih {
                    let wy = min(fy1, Double(yy + 1)) - max(fy0, Double(yy))
                    var xx = Int(fx0.rounded(.down))
                    while Double(xx) < fx1 && xx < iw {
                        let wx = min(fx1, Double(xx + 1)) - max(fx0, Double(xx))
                        let wgt = wx * wy
                        if wgt > 0 {
                            let i = (yy * iw + xx) * 4
                            sumR += Double(crop.pixels[i]) * wgt
                            sumG += Double(crop.pixels[i + 1]) * wgt
                            sumB += Double(crop.pixels[i + 2]) * wgt
                            sumA += Double(crop.pixels[i + 3]) * wgt
                            wsum += wgt
                        }
                        xx += 1
                    }
                    yy += 1
                }
                guard wsum > 0, sumA > 0 else { continue }
                let alpha = sumA / wsum
                guard alpha > 128 else { continue }
                // premultiplied sums -> straight colour
                grid[ty * tw + tx] = Px(
                    r: min(255, sumR * 255 / sumA),
                    g: min(255, sumG * 255 / sumA),
                    b: min(255, sumB * 255 / sumA),
                    opaque: true
                )
            }
        }

        tone(&grid)
        sharpen(&grid, w: tw, h: hpx)
        let colors = quantize(grid, count: colorCount)

        // Outline: 1px ring around the opaque area, in a padded bitmap.
        let pw = tw + 2
        let ph = hpx + 2
        var out = ChibiBitmap(width: pw, height: ph)
        var solid = [Bool](repeating: false, count: pw * ph)
        for y in 0..<hpx {
            for x in 0..<tw {
                guard grid[y * tw + x].opaque else { continue }
                let c = colors[y * tw + x]
                let i = ((y + 1) * pw + (x + 1)) * 4
                out.pixels[i] = UInt8(clamping: c.r)
                out.pixels[i + 1] = UInt8(clamping: c.g)
                out.pixels[i + 2] = UInt8(clamping: c.b)
                out.pixels[i + 3] = 255
                solid[(y + 1) * pw + (x + 1)] = true
            }
        }
        for y in 0..<ph {
            for x in 0..<pw where !solid[y * pw + x] {
                let nearSolid = (x > 0 && solid[y * pw + x - 1]) || (x < pw - 1 && solid[y * pw + x + 1])
                    || (y > 0 && solid[(y - 1) * pw + x]) || (y < ph - 1 && solid[(y + 1) * pw + x])
                if nearSolid {
                    let i = (y * pw + x) * 4
                    out.pixels[i] = UInt8(outline.r)
                    out.pixels[i + 1] = UInt8(outline.g)
                    out.pixels[i + 2] = UInt8(outline.b)
                    out.pixels[i + 3] = 255
                }
            }
        }
        return out
    }

    /// Contrast 1.06 around the mean grey and saturation 1.1, as in the prototype.
    private static func tone(_ grid: inout [Px]) {
        var sum = 0.0
        var n = 0.0
        for p in grid where p.opaque {
            sum += 0.299 * p.r + 0.587 * p.g + 0.114 * p.b
            n += 1
        }
        guard n > 0 else { return }
        let mean = sum / n
        for i in grid.indices where grid[i].opaque {
            var p = grid[i]
            p.r = mean + 1.06 * (p.r - mean)
            p.g = mean + 1.06 * (p.g - mean)
            p.b = mean + 1.06 * (p.b - mean)
            let gray = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b
            p.r = min(255, max(0, gray + 1.1 * (p.r - gray)))
            p.g = min(255, max(0, gray + 1.1 * (p.g - gray)))
            p.b = min(255, max(0, gray + 1.1 * (p.b - gray)))
            grid[i] = p
        }
    }

    /// Light unsharp mask (3x3 binomial blur over opaque neighbours, amount 0.7).
    private static func sharpen(_ grid: inout [Px], w: Int, h: Int) {
        let src = grid
        let kernel: [(Int, Int, Double)] = [
            (-1, -1, 1), (0, -1, 2), (1, -1, 1),
            (-1, 0, 2), (0, 0, 4), (1, 0, 2),
            (-1, 1, 1), (0, 1, 2), (1, 1, 1),
        ]
        for y in 0..<h {
            for x in 0..<w {
                let p = src[y * w + x]
                guard p.opaque else { continue }
                var br = 0.0, bg = 0.0, bb = 0.0, bw = 0.0
                for (dx, dy, k) in kernel {
                    let nx = x + dx
                    let ny = y + dy
                    guard nx >= 0, ny >= 0, nx < w, ny < h else { continue }
                    let q = src[ny * w + nx]
                    guard q.opaque else { continue }
                    br += q.r * k
                    bg += q.g * k
                    bb += q.b * k
                    bw += k
                }
                guard bw > 0 else { continue }
                grid[y * w + x] = Px(
                    r: min(255, max(0, p.r + 0.7 * (p.r - br / bw))),
                    g: min(255, max(0, p.g + 0.7 * (p.g - bg / bw))),
                    b: min(255, max(0, p.b + 0.7 * (p.b - bb / bw))),
                    opaque: true
                )
            }
        }
    }

    /// Median-cut palette; returns one colour per pixel (transparent pixels get a dummy colour).
    private static func quantize(_ grid: [Px], count: Int) -> [ChibiRGB] {
        var items: [(Int, Double, Double, Double)] = []
        for (i, p) in grid.enumerated() where p.opaque { items.append((i, p.r, p.g, p.b)) }
        var result = [ChibiRGB](repeating: ChibiRGB(0, 0, 0), count: grid.count)
        guard !items.isEmpty else { return result }

        var boxes: [[Int]] = [Array(items.indices)]

        func range(_ box: [Int]) -> (channel: Int, span: Double) {
            var lo = [255.0, 255.0, 255.0]
            var hi = [0.0, 0.0, 0.0]
            for k in box {
                let v = [items[k].1, items[k].2, items[k].3]
                for c in 0..<3 {
                    lo[c] = min(lo[c], v[c])
                    hi[c] = max(hi[c], v[c])
                }
            }
            var bestC = 0
            var bestSpan = hi[0] - lo[0]
            for c in 1..<3 where hi[c] - lo[c] > bestSpan {
                bestSpan = hi[c] - lo[c]
                bestC = c
            }
            return (bestC, bestSpan)
        }

        while boxes.count < count {
            var pick = -1
            var pickScore = 0.0
            for (bi, box) in boxes.enumerated() where box.count > 1 {
                let score = Double(box.count) * range(box).span
                if score > pickScore {
                    pickScore = score
                    pick = bi
                }
            }
            guard pick >= 0 else { break }
            let box = boxes[pick]
            let channel = range(box).channel
            let sorted = box.sorted { a, b in
                let va = channel == 0 ? items[a].1 : (channel == 1 ? items[a].2 : items[a].3)
                let vb = channel == 0 ? items[b].1 : (channel == 1 ? items[b].2 : items[b].3)
                return va < vb
            }
            let mid = sorted.count / 2
            boxes[pick] = Array(sorted[..<mid])
            boxes.append(Array(sorted[mid...]))
        }

        for box in boxes {
            var r = 0.0, g = 0.0, b = 0.0
            for k in box {
                r += items[k].1
                g += items[k].2
                b += items[k].3
            }
            let n = Double(box.count)
            let color = ChibiRGB(Int((r / n).rounded()), Int((g / n).rounded()), Int((b / n).rounded()))
            for k in box { result[items[k].0] = color }
        }
        return result
    }
}
