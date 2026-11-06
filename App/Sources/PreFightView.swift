import SwiftUI
import UIKit
import FightEngine

/// Pre-fight page (landscape): matchup pickers on the left, the two fighters and the start button on the right.
struct PreFightView: View {
    let session: BattleSession
    let onStart: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    presetSection
                    customSection
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            .frame(maxWidth: .infinity)

            VStack(spacing: 8) {
                ScrollView {
                    VStack(spacing: 8) {
                        FighterPreviewCard(
                            fighter: session.fighterA,
                            headData: session.headshotDataA,
                            roleTag: "🟢 玩家",
                            tint: .green
                        )
                        FighterPreviewCard(
                            fighter: session.fighterB,
                            headData: session.headshotDataB,
                            roleTag: "🔴 AI",
                            tint: .red
                        )
                    }
                    .padding(.vertical, 8)
                }
                .scrollIndicators(.hidden)

                Button(action: onStart) {
                    Text("🥊 開始對戰")
                        .font(.system(.headline, design: .monospaced, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .padding(.bottom, 8)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 14)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("OCTAGON CARDS · 真實UFC名單")
                .font(.system(.subheadline, design: .monospaced, weight: .heavy))
            Text("賽前 · 選擇對戰雙方")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private var presetSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("熱門對戰")
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(.secondary)
            ForEach(SandboxMatchup.allCases) { m in
                Button {
                    session.selectMatchup(m)
                } label: {
                    Text(m.label)
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(session.matchup == m ? Color.blue.opacity(0.38) : Color.white.opacity(0.07))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var customSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("自選選手")
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(.secondary)
            fighterMenu(
                title: "🟢 換角: \(session.fighterA.name) (OVR \(session.fighterA.overallRating))",
                tint: .green,
                onPick: { session.selectFighterA($0) }
            )
            fighterMenu(
                title: "🔴 換敵: \(session.fighterB.name) (OVR \(session.fighterB.overallRating))",
                tint: .red,
                onPick: { session.selectFighterB($0) }
            )
        }
    }

    private func fighterMenu(title: String, tint: Color, onPick: @escaping (Fighter) -> Void) -> some View {
        Menu {
            ForEach(RealUFCRoster.all) { f in
                Button {
                    onPick(f)
                } label: {
                    Text("\(f.name) (OVR \(f.overallRating) · Elo \(f.eloRating ?? 1600) · \(f.weightClass ?? ""))")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .lineLimit(1)
                Spacer()
                Text("▼")
                    .font(.system(size: 10, design: .monospaced))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(tint.opacity(0.16))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

/// Read-only fighter summary shown on the pre-fight page.
struct FighterPreviewCard: View {
    let fighter: Fighter
    let headData: Data?
    let roleTag: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let data = headData, let uiImg = UIImage(data: data) {
                    Image(uiImage: uiImg)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 44, height: 44)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(roleTag) \(fighter.name)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .lineLimit(2)
                    Text("OVR \(fighter.overallRating) · Elo \(fighter.eloRating ?? 1600)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            Text("\(fighter.weightClass ?? "") · \(fighter.record ?? "")")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if !fighter.traits.isEmpty {
                Text(fighter.traits.map(\.displayName).joined(separator: " "))
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(tint)
            }

            if let patch = fighter.lastFightPatchNote {
                Text("🔁 \(patch)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.10))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(tint.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
