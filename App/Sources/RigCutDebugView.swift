import SwiftUI
import UIKit
import Vision
import Observation
import FightEngine

// P6-2 "Vision cut check": a development-only screen that runs Apple Vision on every roster fighter's official
// full-body photo, derives torso / upper-arm / forearm regions (docs/VISUAL_DIRECTION.md §3.3) and draws them on top
// of the photo so a human can mark each fighter usable / unusable. Not part of the game; no assembly, no animation.
// Photos are downloaded on the phone and cached under Caches (never stored in the repo).

// MARK: - Result types

enum RigJointKey: String, CaseIterable, Sendable {
    case neck, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist, leftHip, rightHip

    var visionName: VNHumanBodyPoseObservation.JointName {
        switch self {
        case .neck: return .neck
        case .leftShoulder: return .leftShoulder
        case .rightShoulder: return .rightShoulder
        case .leftElbow: return .leftElbow
        case .rightElbow: return .rightElbow
        case .leftWrist: return .leftWrist
        case .rightWrist: return .rightWrist
        case .leftHip: return .leftHip
        case .rightHip: return .rightHip
        }
    }

    var label: String {
        switch self {
        case .neck: return "頸"
        case .leftShoulder: return "肩L"
        case .rightShoulder: return "肩R"
        case .leftElbow: return "肘L"
        case .rightElbow: return "肘R"
        case .leftWrist: return "腕L"
        case .rightWrist: return "腕R"
        case .leftHip: return "胯L"
        case .rightHip: return "胯R"
        }
    }
}

struct RigJoint: Sendable {
    /// Image pixels, origin top-left.
    var point: CGPoint
    var confidence: Float
}

struct RigQuad: Sendable {
    var corners: [CGPoint]
    /// True when part of the region had to be extrapolated (joint missing / cropped by the photo edge).
    var estimated: Bool
}

struct RigCutResult: Sendable {
    var imageSize: CGSize
    var joints: [RigJointKey: RigJoint] = [:]
    var face: CGRect?
    var torso: RigQuad?
    var upperArms: [RigQuad] = []
    var forearms: [RigQuad] = []
    /// Reasons the automatic check considers the cut unusable.
    var failures: [String] = []
    /// Non-fatal observations (estimated hips, cropped hands, ...).
    var warnings: [String] = []

    var autoOK: Bool { failures.isEmpty }
}

// MARK: - Analyzer (pure; runs off the main actor)

enum RigCutAnalyzer {
    /// A joint counts as "found" at or above this confidence.
    static let strong: Float = 0.3
    /// Joints below this are dropped entirely.
    static let floor: Float = 0.05

    nonisolated static func analyze(data: Data) -> RigCutResult? {
        guard let source = UIImage(data: data), let flat = flatten(source), let cg = flat.cgImage else { return nil }
        let w = CGFloat(cg.width)
        let h = CGFloat(cg.height)
        var result = RigCutResult(imageSize: CGSize(width: w, height: h))

        let bodyRequest = VNDetectHumanBodyPoseRequest()
        let faceRequest = VNDetectFaceRectanglesRequest()
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
        do {
            try handler.perform([bodyRequest, faceRequest])
        } catch {
            result.failures.append("Vision 執行失敗：\(error.localizedDescription)")
            return result
        }

        if let face = faceRequest.results?.max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
            let b = face.boundingBox
            result.face = CGRect(x: b.minX * w, y: (1 - b.maxY) * h, width: b.width * w, height: b.height * h)
        } else {
            result.warnings.append("沒偵測到臉")
        }

        // Pick the observation with the most usable joints (the photos hold one person; this guards stray detections).
        var best: [RigJointKey: RigJoint] = [:]
        for obs in bodyRequest.results ?? [] {
            guard let points = try? obs.recognizedPoints(.all) else { continue }
            var found: [RigJointKey: RigJoint] = [:]
            for key in RigJointKey.allCases {
                if let p = points[key.visionName], p.confidence >= floor {
                    found[key] = RigJoint(point: CGPoint(x: p.location.x * w, y: (1 - p.location.y) * h), confidence: p.confidence)
                }
            }
            if found.count > best.count { best = found }
        }
        result.joints = best
        if best.isEmpty {
            result.failures.append("Vision 沒有偵測到人體姿勢")
            return result
        }

        func joint(_ k: RigJointKey) -> RigJoint? {
            guard let j = best[k], j.confidence >= strong else { return nil }
            return j
        }

        guard let shA = joint(.leftShoulder), let shB = joint(.rightShoulder) else {
            result.failures.append("肩膀沒偵測到（兩肩都要有）")
            return result
        }
        // Shoulder A = the one further left in the image, so the frame is the same for every photo.
        let (shL, shR) = shA.point.x <= shB.point.x ? (shA, shB) : (shB, shA)
        let span = shR.point.minus(shL.point).length
        if span < w * 0.15 {
            result.failures.append("兩肩距離過小（\(Int(span))px），疑似誤判")
            return result
        }
        let d = shR.point.minus(shL.point).unit
        var n = CGPoint(x: -d.y, y: d.x)
        if n.y < 0 { n = n.times(-1) }
        let mid = shL.point.plus(shR.point).times(0.5)

        // Neck / head sanity.
        if joint(.neck) == nil {
            result.warnings.append("頸沒偵測到")
        }
        if let face = result.face {
            if face.midX < shL.point.x || face.midX > shR.point.x {
                result.warnings.append("臉的水平位置不在兩肩之間（姿勢歪斜？）")
            }
            if face.maxY > mid.y + span * 0.15 {
                result.warnings.append("臉的下緣低於肩線，頭肩位置可疑")
            }
        }

        // Torso: from just above the shoulder line down to the hip line (or an estimate when the photo stops at the waist).
        let topMargin = span * 0.10
        let sideMargin = span * 0.08
        var bodyLen: CGFloat
        var torsoEstimated = false
        if let hA = joint(.leftHip), let hB = joint(.rightHip) {
            let hipMid = hA.point.plus(hB.point).times(0.5)
            bodyLen = hipMid.minus(mid).dot(n)
            if bodyLen < span * 0.4 {
                bodyLen = span * 1.1
                torsoEstimated = true
                result.warnings.append("胯的位置不合理，軀幹下緣以估算取代")
            }
        } else {
            bodyLen = span * 1.1
            torsoEstimated = true
            result.warnings.append("胯沒偵測到，軀幹下緣以肩寬×1.1 估算")
        }
        let roomBelow = (n.y > 0.01) ? (h - 1 - mid.y) / n.y : bodyLen
        if bodyLen > roomBelow {
            let ratio = max(roomBelow, 0) / bodyLen
            bodyLen = max(roomBelow, 0)
            torsoEstimated = true
            result.warnings.append("軀幹下緣被圖片底邊截斷，只剩預期高度的 \(Int(ratio * 100))%")
            if ratio < 0.6 {
                result.failures.append("軀幹被裁掉過多（剩 \(Int(ratio * 100))%）")
            }
        }
        let tl = shL.point.minus(d.times(sideMargin)).minus(n.times(topMargin))
        let tr = shR.point.plus(d.times(sideMargin)).minus(n.times(topMargin))
        let down = n.times(bodyLen + topMargin)
        result.torso = RigQuad(corners: [tl, tr, tr.plus(down), tl.plus(down)], estimated: torsoEstimated)

        // Arms: each side shoulder -> elbow -> wrist.
        let armWidth = span * 0.34
        // Vision labels follow the subject's own body, so pair joints by label (not by image side).
        let sides: [(String, RigJoint?, RigJointKey, RigJointKey)] = [
            ("左（受試者）", joint(.leftShoulder), .leftElbow, .leftWrist),
            ("右（受試者）", joint(.rightShoulder), .rightElbow, .rightWrist)
        ]
        for (sideName, shoulderJoint, elbowKey, wristKey) in sides {
            guard let shoulder = shoulderJoint else { continue }
            guard let elbow = joint(elbowKey) else {
                result.failures.append("\(sideName)手肘沒偵測到")
                continue
            }
            let upperVec = elbow.point.minus(shoulder.point)
            let upperLen = upperVec.length
            if upperLen < span * 0.25 {
                result.failures.append("\(sideName)上臂過短（\(Int(upperLen))px），肘位置可疑")
                continue
            }
            if elbow.point.y > h - 3 || elbow.point.x < 3 || elbow.point.x > w - 3 {
                result.failures.append("\(sideName)手肘貼在圖片邊緣（手臂被裁）")
                continue
            }
            result.upperArms.append(bandQuad(from: shoulder.point, to: elbow.point, width: armWidth, estimated: false))

            let dir = upperVec.unit
            if let wrist = joint(wristKey), wrist.point.minus(elbow.point).length > upperLen * 0.3 {
                result.forearms.append(bandQuad(from: elbow.point, to: wrist.point, width: armWidth * 0.85, estimated: false))
            } else {
                // Hand / wrist cropped away: extend the forearm along the upper-arm direction until the photo edge.
                let wanted = upperLen * 0.95
                let t = clampInside(from: elbow.point, dir: dir, maxLen: wanted, width: w, height: h)
                let ratio = wanted > 0 ? t / wanted : 0
                result.warnings.append("\(sideName)手腕沒偵測到，前臂以延伸估算（可見約 \(Int(ratio * 100))%）")
                if t > 4 {
                    result.forearms.append(
                        bandQuad(from: elbow.point, to: elbow.point.plus(dir.times(t)), width: armWidth * 0.85, estimated: true)
                    )
                }
            }
        }
        return result
    }

    private nonisolated static func bandQuad(from a: CGPoint, to b: CGPoint, width: CGFloat, estimated: Bool) -> RigQuad {
        let dir = b.minus(a).unit
        let perp = CGPoint(x: -dir.y, y: dir.x).times(width / 2)
        return RigQuad(corners: [a.plus(perp), b.plus(perp), b.minus(perp), a.minus(perp)], estimated: estimated)
    }

    private nonisolated static func clampInside(from a: CGPoint, dir: CGPoint, maxLen: CGFloat, width: CGFloat, height: CGFloat) -> CGFloat {
        var t = maxLen
        let inset: CGFloat = 1
        if dir.x > 0.001 { t = min(t, (width - inset - a.x) / dir.x) } else if dir.x < -0.001 { t = min(t, (inset - a.x) / dir.x) }
        if dir.y > 0.001 { t = min(t, (height - inset - a.y) / dir.y) } else if dir.y < -0.001 { t = min(t, (inset - a.y) / dir.y) }
        return max(t, 0)
    }

    /// Official PNGs are transparent cut-outs; Vision works better on an opaque mid-grey background.
    private nonisolated static func flatten(_ image: UIImage) -> UIImage? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor(white: 0.5, alpha: 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

private extension CGPoint {
    nonisolated func plus(_ o: CGPoint) -> CGPoint { CGPoint(x: x + o.x, y: y + o.y) }
    nonisolated func minus(_ o: CGPoint) -> CGPoint { CGPoint(x: x - o.x, y: y - o.y) }
    nonisolated func times(_ k: CGFloat) -> CGPoint { CGPoint(x: x * k, y: y * k) }
    nonisolated func dot(_ o: CGPoint) -> CGFloat { x * o.x + y * o.y }
    nonisolated var length: CGFloat { (x * x + y * y).squareRoot() }
    nonisolated var unit: CGPoint {
        let l = length
        return l > 0.0001 ? CGPoint(x: x / l, y: y / l) : CGPoint(x: 0, y: 1)
    }
}

// MARK: - Marks (persisted)

struct RigMarkEntry: Codable, Equatable {
    var usable: Bool
    var tags: [String] = []
}

enum RigFailureTag {
    static let all = ["肩頸位置錯", "手肘位置錯", "手臂被裁", "臉頭問題", "軀幹下緣", "姿勢特殊", "其他"]
}

// MARK: - Model

@MainActor
@Observable
final class RigCutModel {
    enum LoadState: Equatable {
        case idle
        case loading
        case noPhoto
        case failed(String)
        case done
    }

    let fighters: [Fighter] = RealUFCRoster.all
    var images: [String: UIImage] = [:]
    var results: [String: RigCutResult] = [:]
    var states: [String: LoadState] = [:]
    var marks: [String: RigMarkEntry] = [:]
    var runAllDone = 0
    var isRunningAll = false

    private static let marksKey = "rigCutMarks_v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.marksKey),
           let decoded = try? JSONDecoder().decode([String: RigMarkEntry].self, from: data) {
            marks = decoded
        }
    }

    func setMark(_ id: String, usable: Bool?, tags: [String] = []) {
        if let usable {
            marks[id] = RigMarkEntry(usable: usable, tags: usable ? [] : tags)
        } else {
            marks[id] = nil
        }
        if let data = try? JSONEncoder().encode(marks) {
            UserDefaults.standard.set(data, forKey: Self.marksKey)
        }
    }

    func toggleTag(_ id: String, tag: String) {
        guard var entry = marks[id], !entry.usable else { return }
        if let i = entry.tags.firstIndex(of: tag) { entry.tags.remove(at: i) } else { entry.tags.append(tag) }
        setMark(id, usable: false, tags: entry.tags)
    }

    func state(_ id: String) -> LoadState { states[id] ?? .idle }

    /// Download (or read the cached copy of) the full-body photo and analyze it.
    func load(_ fighter: Fighter) async {
        let id = fighter.id
        if state(id) == .loading || state(id) == .done { return }
        guard let urlString = fighter.fullBodyImageUrl else {
            states[id] = .noPhoto
            return
        }
        states[id] = .loading
        let outcome = await Self.fetchAndAnalyze(id: id, urlString: urlString)
        apply(outcome, for: id)
    }

    private func apply(_ outcome: FetchOutcome, for id: String) {
        switch outcome {
        case .failed(let message):
            states[id] = .failed(message)
        case .ok(let data, let result):
            if let image = UIImage(data: data) { images[id] = image }
            if let result { results[id] = result }
            states[id] = result == nil ? .failed("影像無法解析") : .done
        }
    }

    func retry(_ fighter: Fighter) async {
        states[fighter.id] = .idle
        await load(fighter)
    }

    /// Download + analyze everything, 3 at a time.
    func runAll() async {
        guard !isRunningAll else { return }
        isRunningAll = true
        runAllDone = 0
        let pending = fighters.filter { state($0.id) != .done }
        runAllDone = fighters.count - pending.count
        for f in pending where f.fullBodyImageUrl == nil { states[f.id] = .noPhoto }
        let jobs = pending.compactMap { f -> (String, String)? in
            guard let u = f.fullBodyImageUrl else { return nil }
            states[f.id] = .loading
            return (f.id, u)
        }
        await withTaskGroup(of: (String, FetchOutcome).self) { group in
            var iterator = jobs.makeIterator()
            func addNext() {
                if let job = iterator.next() {
                    group.addTask { (job.0, await Self.fetchAndAnalyze(id: job.0, urlString: job.1)) }
                }
            }
            for _ in 0..<3 { addNext() }
            while let (id, outcome) = await group.next() {
                apply(outcome, for: id)
                runAllDone += 1
                addNext()
            }
        }
        isRunningAll = false
    }

    enum FetchOutcome: Sendable {
        case failed(String)
        case ok(Data, RigCutResult?)
    }

    nonisolated static func fetchAndAnalyze(id: String, urlString: String) async -> FetchOutcome {
        guard let data = await photoData(id: id, urlString: urlString) else {
            return .failed("下載失敗（離線或被拒絕）")
        }
        let result = await Task.detached(priority: .userInitiated) { RigCutAnalyzer.analyze(data: data) }.value
        return .ok(data, result)
    }

    /// Raw official photo, cached on disk under Caches (re-downloadable, never committed).
    nonisolated static func photoData(id: String, urlString: String) async -> Data? {
        let fm = FileManager.default
        let dir = (fm.urls(for: .cachesDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("RigCutPhotos_v1", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("\(id).png")
        if let cached = try? Data(contentsOf: file), !cached.isEmpty { return cached }
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 20)
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              UIImage(data: data) != nil
        else { return nil }
        try? data.write(to: file, options: .atomic)
        return data
    }

    // MARK: Summary

    var markedUsable: Int { marks.values.filter(\.usable).count }
    var markedUnusable: Int { marks.values.filter { !$0.usable }.count }
    var autoOKCount: Int { results.values.filter(\.autoOK).count }
    var analyzedCount: Int { results.count }

    func summaryText() -> String {
        var lines: [String] = []
        lines.append("P6-2 Vision 切割結果：人工可用 \(markedUsable) / 不可用 \(markedUnusable) / 未標 \(fighters.count - marks.count)；自動判定 OK \(autoOKCount) / 已分析 \(analyzedCount)")
        for f in fighters {
            let auto: String
            if let r = results[f.id] { auto = r.autoOK ? "自動OK" : "自動FAIL" } else { auto = "未分析" }
            let manual: String
            if let m = marks[f.id] { manual = m.usable ? "人工可用" : "人工不可用" } else { manual = "未標" }
            var extra: [String] = []
            if let m = marks[f.id], !m.usable, !m.tags.isEmpty { extra.append("標籤:" + m.tags.joined(separator: "/")) }
            if let r = results[f.id] {
                if !r.failures.isEmpty { extra.append("失敗:" + r.failures.joined(separator: "；")) }
                if !r.warnings.isEmpty { extra.append("警告:" + r.warnings.joined(separator: "；")) }
            }
            lines.append("- \(f.name) | \(auto) | \(manual)" + (extra.isEmpty ? "" : " | " + extra.joined(separator: " | ")))
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - View

struct RigCutDebugView: View {
    let onClose: () -> Void

    @State private var model = RigCutModel()
    @State private var selectedId: String = RealUFCRoster.all.first?.id ?? ""
    @State private var showJoints = true
    @State private var showRegions = true
    @State private var showFace = true
    @State private var copied = false

    private var selected: Fighter? { model.fighters.first { $0.id == selectedId } }

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.06, blue: 0.09).ignoresSafeArea()
            VStack(spacing: 6) {
                topBar
                HStack(alignment: .top, spacing: 8) {
                    fighterList.frame(width: 190)
                    if let fighter = selected {
                        photoPane(fighter)
                        controlsPane(fighter)
                    } else {
                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .preferredColorScheme(.dark)
        .task(id: selectedId) {
            if let f = selected { await model.load(f) }
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 10) {
            Button("關閉", action: onClose).buttonStyle(.bordered)
            Text("Rig 切割驗證 (P6-2)").font(.system(size: 13, weight: .bold))
            Text("人工 ✅\(model.markedUsable) ❌\(model.markedUnusable) 未標\(model.fighters.count - model.marks.count) · 自動OK \(model.autoOKCount)/\(model.analyzedCount)")
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
            Spacer()
            Button(model.isRunningAll ? "分析中 \(model.runAllDone)/\(model.fighters.count)" : "全部下載並分析") {
                Task { await model.runAll() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isRunningAll)
            Button(copied ? "已複製" : "複製結果") {
                UIPasteboard.general.string = model.summaryText()
                copied = true
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    copied = false
                }
            }
            .buttonStyle(.bordered)
        }
        .font(.system(size: 12))
    }

    // MARK: List

    private var fighterList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(model.fighters) { f in
                    Button { selectedId = f.id } label: {
                        HStack(spacing: 4) {
                            Text(autoBadge(f.id)).font(.system(size: 11))
                            Text(f.name).font(.system(size: 11)).lineLimit(1)
                            Spacer(minLength: 2)
                            Text(markBadge(f.id)).font(.system(size: 11))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 5)
                        .background(f.id == selectedId ? Color.accentColor.opacity(0.35) : Color.white.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func autoBadge(_ id: String) -> String {
        if let r = model.results[id] { return r.autoOK ? "🟢" : "🔴" }
        switch model.state(id) {
        case .loading: return "⏳"
        case .failed, .noPhoto: return "⚠️"
        default: return "⚪️"
        }
    }

    private func markBadge(_ id: String) -> String {
        guard let m = model.marks[id] else { return "" }
        return m.usable ? "✅" : "❌"
    }

    // MARK: Photo

    private func photoPane(_ fighter: Fighter) -> some View {
        let image = model.images[fighter.id]
        let ratio = image.map { $0.size.width / max($0.size.height, 1) } ?? (460.0 / 700.0)
        return ZStack {
            Color(white: 0.5)
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                if let result = model.results[fighter.id] {
                    RigOverlay(result: result, showJoints: showJoints, showRegions: showRegions, showFace: showFace)
                }
            } else {
                stateMessage(fighter)
            }
        }
        .aspectRatio(ratio, contentMode: .fit)
        .frame(maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private func stateMessage(_ fighter: Fighter) -> some View {
        switch model.state(fighter.id) {
        case .loading, .idle:
            ProgressView()
        case .noPhoto:
            Text("沒有官方全身照").font(.caption).foregroundStyle(.black)
        case .failed(let msg):
            VStack(spacing: 6) {
                Text(msg).font(.caption).foregroundStyle(.black)
                Button("重試") { Task { await model.retry(fighter) } }.buttonStyle(.bordered)
            }
        case .done:
            EmptyView()
        }
    }

    // MARK: Controls

    private func controlsPane(_ fighter: Fighter) -> some View {
        let result = model.results[fighter.id]
        let entry = model.marks[fighter.id]
        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(fighter.name).font(.system(size: 14, weight: .bold))
                        Text(fighter.weightClass ?? "—").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { step(-1) } label: { Image(systemName: "chevron.left") }.buttonStyle(.bordered)
                    Button { step(1) } label: { Image(systemName: "chevron.right") }.buttonStyle(.bordered)
                }

                HStack(spacing: 10) {
                    Toggle("關節", isOn: $showJoints)
                    Toggle("區域框", isOn: $showRegions)
                    Toggle("臉框", isOn: $showFace)
                }
                .font(.system(size: 11))
                .toggleStyle(.switch)

                // Manual mark
                HStack(spacing: 8) {
                    Button { model.setMark(fighter.id, usable: true); step(1) } label: {
                        Text("✅ 可用").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(.green)
                    Button { model.setMark(fighter.id, usable: false, tags: entry?.tags ?? []) } label: {
                        Text("❌ 不可用").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(.red)
                    Button("清除") { model.setMark(fighter.id, usable: nil) }.buttonStyle(.bordered)
                }
                .font(.system(size: 13, weight: .semibold))

                if let entry, !entry.usable {
                    Text("失敗原因（可複選）").font(.system(size: 10)).foregroundStyle(.secondary)
                    FlowTags(tags: RigFailureTag.all, selected: Set(entry.tags)) { tag in
                        model.toggleTag(fighter.id, tag: tag)
                    }
                }

                if let result {
                    verdict(result)
                    jointTable(result)
                } else {
                    Text(stateText(fighter)).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Text("圖例：青＝軀幹，黃＝上臂，橙＝前臂（虛線＝估算），綠點＝可信關節，橙點＝信心低，洋紅＝臉框。")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
        .frame(maxWidth: .infinity)
    }

    private func stateText(_ f: Fighter) -> String {
        switch model.state(f.id) {
        case .loading: return "下載分析中…"
        case .noPhoto: return "沒有官方全身照 → 走退路（現有像素圖）"
        case .failed(let m): return m
        default: return "尚未分析"
        }
    }

    private func verdict(_ r: RigCutResult) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(r.autoOK ? "🟢 自動判定：可切" : "🔴 自動判定：不可切")
                .font(.system(size: 12, weight: .bold))
            ForEach(r.failures, id: \.self) { Text("✗ \($0)").font(.system(size: 10)).foregroundStyle(.red) }
            ForEach(r.warnings, id: \.self) { Text("△ \($0)").font(.system(size: 10)).foregroundStyle(.yellow) }
        }
    }

    private func jointTable(_ r: RigCutResult) -> some View {
        let text = RigJointKey.allCases.map { k -> String in
            if let j = r.joints[k] { return "\(k.label) \(String(format: "%.2f", j.confidence))" }
            return "\(k.label) —"
        }.joined(separator: "  ")
        return Text("信心：" + text).font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
    }

    private func step(_ delta: Int) {
        guard let i = model.fighters.firstIndex(where: { $0.id == selectedId }) else { return }
        let n = model.fighters.count
        selectedId = model.fighters[(i + delta + n) % n].id
    }
}

// MARK: - Overlay

private struct RigOverlay: View {
    let result: RigCutResult
    let showJoints: Bool
    let showRegions: Bool
    let showFace: Bool

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / max(result.imageSize.width, 1)
            func p(_ pt: CGPoint) -> CGPoint { CGPoint(x: pt.x * s, y: pt.y * s) }
            func draw(_ q: RigQuad, _ color: Color) {
                var path = Path()
                path.addLines(q.corners.map(p))
                path.closeSubpath()
                ctx.fill(path, with: .color(color.opacity(0.20)))
                ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.5, dash: q.estimated ? [4, 3] : []))
            }
            if showRegions {
                if let t = result.torso { draw(t, .cyan) }
                result.upperArms.forEach { draw($0, .yellow) }
                result.forearms.forEach { draw($0, .orange) }
            }
            if showFace, let f = result.face {
                let r = CGRect(x: f.minX * s, y: f.minY * s, width: f.width * s, height: f.height * s)
                ctx.stroke(Path(r), with: .color(.pink), lineWidth: 1.5)
            }
            if showJoints {
                let bones: [(RigJointKey, RigJointKey)] = [
                    (.leftShoulder, .rightShoulder), (.leftShoulder, .leftElbow), (.leftElbow, .leftWrist),
                    (.rightShoulder, .rightElbow), (.rightElbow, .rightWrist), (.leftHip, .rightHip), (.neck, .leftShoulder), (.neck, .rightShoulder)
                ]
                for (a, b) in bones {
                    guard let ja = result.joints[a], let jb = result.joints[b] else { continue }
                    var line = Path()
                    line.move(to: p(ja.point))
                    line.addLine(to: p(jb.point))
                    ctx.stroke(line, with: .color(.white.opacity(0.6)), lineWidth: 1)
                }
                for (key, j) in result.joints {
                    let c = p(j.point)
                    let good = j.confidence >= RigCutAnalyzer.strong
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x - 3.5, y: c.y - 3.5, width: 7, height: 7)),
                             with: .color(good ? .green : .orange))
                    ctx.draw(Text(key.label).font(.system(size: 8, weight: .bold)).foregroundStyle(.white),
                             at: CGPoint(x: c.x + 12, y: c.y - 7))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Wrapping tag chips

private struct FlowTags: View {
    let tags: [String]
    let selected: Set<String>
    let onTap: (String) -> Void

    var body: some View {
        // Fixed 4-column grid keeps this simple; the longest tag is 5 characters.
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
            ForEach(tags, id: \.self) { tag in
                Button { onTap(tag) } label: {
                    Text(tag)
                        .font(.system(size: 10))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(selected.contains(tag) ? Color.red.opacity(0.6) : Color.white.opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
                .buttonStyle(.plain)
            }
        }
    }
}
