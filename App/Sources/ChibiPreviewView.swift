import SwiftUI
import UIKit
import Observation
import FightEngine

// P6-3 preview: development-only screen to look at every roster fighter's chibi, pose by pose, and to mark
// whose skin tone / ink / build / shorts / head needs fixing. Not wired into the fight (that is P6-4).

// MARK: - Marks

enum ChibiMarkTag {
    static let ok = "OK"
    static let problems = ["膚色太淺", "膚色太深", "刺青太多", "刺青太少", "刺青位置錯", "體型不對", "短褲色不對", "頭有問題", "認不出人"]
    static var all: [String] { [ok] + problems }
}

// MARK: - Model

@MainActor
@Observable
final class ChibiPreviewModel {
    enum LoadState: Equatable {
        case idle
        case loading
        case done
    }

    let fighters: [Fighter] = RealUFCRoster.all
    var images: [String: [ChibiPose: UIImage]] = [:]
    var styles: [String: ChibiStyle] = [:]
    var headOK: [String: Bool] = [:]
    var states: [String: LoadState] = [:]
    var marks: [String: [String]] = [:]
    var runAllDone = 0
    var isRunningAll = false

    private static let marksKey = "chibiMarks_v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.marksKey),
           let decoded = try? JSONDecoder().decode([String: [String]].self, from: data) {
            marks = decoded
        }
    }

    func state(_ id: String) -> LoadState { states[id] ?? .idle }

    func load(_ fighter: Fighter, force: Bool = false) async {
        let id = fighter.id
        if state(id) == .loading { return }
        if state(id) == .done && !force { return }
        states[id] = .loading
        if force { await ChibiFactory.shared.purge(fighterId: id) }
        let output = await ChibiFactory.shared.frames(for: fighter)
        var map: [ChibiPose: UIImage] = [:]
        for (pose, bmp) in output.frames {
            if let cg = bmp.makeCGImage() { map[pose] = UIImage(cgImage: cg) }
        }
        images[id] = map
        styles[id] = output.style
        headOK[id] = output.headOK
        states[id] = .done
    }

    func runAll() async {
        guard !isRunningAll else { return }
        isRunningAll = true
        let pending = fighters.filter { state($0.id) != .done }
        runAllDone = fighters.count - pending.count
        for f in pending {
            await load(f)
            runAllDone += 1
        }
        isRunningAll = false
    }

    func toggleTag(_ id: String, tag: String) {
        var tags = marks[id] ?? []
        if let i = tags.firstIndex(of: tag) {
            tags.remove(at: i)
        } else {
            if tag == ChibiMarkTag.ok {
                tags = [ChibiMarkTag.ok]
            } else {
                tags.removeAll { $0 == ChibiMarkTag.ok }
                tags.append(tag)
            }
        }
        marks[id] = tags.isEmpty ? nil : tags
        if let data = try? JSONEncoder().encode(marks) {
            UserDefaults.standard.set(data, forKey: Self.marksKey)
        }
    }

    func clearMark(_ id: String) {
        marks[id] = nil
        if let data = try? JSONEncoder().encode(marks) {
            UserDefaults.standard.set(data, forKey: Self.marksKey)
        }
    }

    var okCount: Int { marks.values.filter { $0 == [ChibiMarkTag.ok] }.count }
    var problemCount: Int { marks.values.filter { !$0.isEmpty && $0 != [ChibiMarkTag.ok] }.count }

    func summaryText() -> String {
        var lines = ["P6-3 小型 Q 版預覽標記：OK \(okCount) / 有問題 \(problemCount) / 未標 \(fighters.count - marks.count)"]
        for f in fighters {
            var parts = [f.name]
            if let tags = marks[f.id], !tags.isEmpty {
                parts.append(tags.joined(separator: "、"))
            } else {
                parts.append("未標")
            }
            if headOK[f.id] == false { parts.append("頭取不到（用了替代頭）") }
            lines.append("- " + parts.joined(separator: " | ") + "  (id: \(f.id))")
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - View

struct ChibiPreviewView: View {
    let onClose: () -> Void

    private enum Mode: String, CaseIterable {
        case single = "單人"
        case grid = "總覽"
    }

    @State private var model = ChibiPreviewModel()
    @State private var selectedId: String = RealUFCRoster.all.first?.id ?? ""
    @State private var pose: ChibiPose = .idle
    @State private var mode: Mode = .single
    @State private var mirrored = false
    @State private var copied = false

    private var selected: Fighter? { model.fighters.first { $0.id == selectedId } }

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.06, blue: 0.09).ignoresSafeArea()
            VStack(spacing: 6) {
                topBar
                switch mode {
                case .single:
                    HStack(alignment: .top, spacing: 8) {
                        fighterList.frame(width: 176)
                        if let fighter = selected {
                            stagePane(fighter)
                            controlsPane(fighter)
                        } else {
                            Spacer()
                        }
                    }
                case .grid:
                    gridPane
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
            Text("Q 版預覽 (P6-3)").font(.system(size: 13, weight: .bold))
            Text("OK \(model.okCount) · 問題 \(model.problemCount) · 未標 \(model.fighters.count - model.marks.count)")
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
            Picker("", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 120)
            Toggle("鏡像", isOn: $mirrored).toggleStyle(.switch).fixedSize()
            Spacer()
            Button(model.isRunningAll ? "產生中 \(model.runAllDone)/\(model.fighters.count)" : "產生全部") {
                Task { await model.runAll() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isRunningAll)
            Button(copied ? "已複製" : "複製標記") {
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

    private func markBadge(_ id: String) -> String {
        guard let tags = model.marks[id], !tags.isEmpty else { return "" }
        return tags == [ChibiMarkTag.ok] ? "✅" : "⚠️"
    }

    // MARK: Stage (single)

    private func stagePane(_ fighter: Fighter) -> some View {
        let scale: CGFloat = 3
        let cw = CGFloat(ChibiBodyRenderer.canvasWidth)
        let ch = CGFloat(ChibiBodyRenderer.canvasHeight)
        let window: CGFloat = 78 // logical px shown around the hip; wide enough for a full kick
        let hip = CGFloat(ChibiBodyRenderer.hipX)
        return VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Color(red: 0.16, green: 0.17, blue: 0.22))
                if let image = model.images[fighter.id]?[pose] {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: cw * scale, height: ch * scale)
                        .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                        .offset(x: (cw / 2 - hip) * scale * (mirrored ? -1 : 1))
                } else {
                    ProgressView()
                }
            }
            .frame(width: window * scale, height: ch * scale)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            HStack(spacing: 4) {
                ForEach(ChibiPose.allCases, id: \.self) { p in
                    Button { pose = p } label: {
                        Text(p.label)
                            .font(.system(size: 11, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 5)
                            .background(p == pose ? Color.accentColor.opacity(0.6) : Color.white.opacity(0.10))
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(width: window * scale)
        }
    }

    // MARK: Controls (single)

    private func controlsPane(_ fighter: Fighter) -> some View {
        let tags = model.marks[fighter.id] ?? []
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

                if model.headOK[fighter.id] == false {
                    Text("⚠️ 取不到官方照的頭（離線或照片不可用），現在是替代頭")
                        .font(.system(size: 10)).foregroundStyle(.yellow)
                }

                if let style = model.styles[fighter.id] {
                    styleInfo(style, hasEntry: ChibiLooks.look(for: fighter.id) != nil)
                }

                Text("標記（可複選；OK 與問題互斥）").font(.system(size: 10)).foregroundStyle(.secondary)
                ChibiFlowTags(tags: ChibiMarkTag.all, selected: Set(tags)) { tag in
                    model.toggleTag(fighter.id, tag: tag)
                }
                HStack {
                    Button("清除標記") { model.clearMark(fighter.id) }.buttonStyle(.bordered)
                    Button("重新取頭") { Task { await model.load(fighter, force: true) } }.buttonStyle(.bordered)
                    Button("OK 並下一位") {
                        if !tags.contains(ChibiMarkTag.ok) { model.toggleTag(fighter.id, tag: ChibiMarkTag.ok) }
                        step(1)
                    }
                    .buttonStyle(.borderedProminent).tint(.green)
                }
                .font(.system(size: 11, weight: .semibold))
            }
            .padding(.horizontal, 4)
        }
        .frame(maxWidth: .infinity)
    }

    private func styleInfo(_ s: ChibiStyle, hasEntry: Bool) -> some View {
        let buildName = s.build < 0.95 ? "細" : (s.build > 1.05 ? "壯" : "中")
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                swatch(s.skin)
                Text("膚色").font(.system(size: 10))
                swatch(s.shorts)
                Text("短褲").font(.system(size: 10))
                if let t = s.inkTint {
                    swatch(t)
                    Text("墨色").font(.system(size: 10))
                }
                Text("體型 \(buildName)").font(.system(size: 10))
            }
            Text("刺青 胸\(s.ink.chest) 腹\(s.ink.belly) ｜ 照片左臂 上\(s.ink.upperL) 前\(s.ink.foreL) ｜ 右臂 上\(s.ink.upperR) 前\(s.ink.foreR)")
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(.secondary)
            if !hasEntry {
                Text("不在外觀表上 → 預設值（無刺青、中體型、膚色取自臉）")
                    .font(.system(size: 10)).foregroundStyle(.yellow)
            }
        }
    }

    private func swatch(_ c: ChibiRGB) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color(red: Double(c.r) / 255, green: Double(c.g) / 255, blue: Double(c.b) / 255))
            .frame(width: 16, height: 12)
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.white.opacity(0.4), lineWidth: 0.5))
    }

    private func step(_ delta: Int) {
        guard let i = model.fighters.firstIndex(where: { $0.id == selectedId }) else { return }
        let n = model.fighters.count
        selectedId = model.fighters[(i + delta + n) % n].id
    }

    // MARK: Grid (overview)

    private var gridPane: some View {
        let scale: CGFloat = 2
        let window: CGFloat = 56
        let ch = CGFloat(ChibiBodyRenderer.canvasHeight)
        let cw = CGFloat(ChibiBodyRenderer.canvasWidth)
        let hip = CGFloat(ChibiBodyRenderer.hipX)
        return ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 8) {
                ForEach(model.fighters) { f in
                    Button {
                        selectedId = f.id
                        mode = .single
                    } label: {
                        VStack(spacing: 2) {
                            ZStack {
                                Color(red: 0.16, green: 0.17, blue: 0.22)
                                if let image = model.images[f.id]?[pose] {
                                    Image(uiImage: image)
                                        .interpolation(.none)
                                        .resizable()
                                        .frame(width: cw * scale, height: ch * scale)
                                        .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                                        .offset(x: (cw / 2 - hip) * scale * (mirrored ? -1 : 1))
                                } else {
                                    Text("…").foregroundStyle(.secondary)
                                }
                            }
                            .frame(width: window * scale, height: ch * scale)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            Text(f.name.split(separator: " ").last.map(String.init) ?? f.name)
                                .font(.system(size: 9)).lineLimit(1)
                            Text(markBadge(f.id)).font(.system(size: 9))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 4)
        }
        .task {
            await model.runAll()
        }
    }
}

// MARK: - Wrapping tag chips

private struct ChibiFlowTags: View {
    let tags: [String]
    let selected: Set<String>
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
            ForEach(tags, id: \.self) { tag in
                Button { onTap(tag) } label: {
                    Text(tag)
                        .font(.system(size: 10))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(background(for: tag))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func background(for tag: String) -> Color {
        guard selected.contains(tag) else { return Color.white.opacity(0.10) }
        return tag == ChibiMarkTag.ok ? Color.green.opacity(0.6) : Color.red.opacity(0.6)
    }
}
