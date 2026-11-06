import SwiftUI
import FightEngine

/// Debug formula drawer (ExchangeLog odds breakdown + invariant self-check). Presented as a sheet; collapsed by default.
struct DebugDrawerView: View {
    let session: BattleSession

    var body: some View {
        let violations = session.state.validateInvariants()
        let allLogs = session.completedRounds.flatMap(\.exchanges) + session.roundHistory

        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("🔍 即時算式戰報 (ExchangeLog)")
                        .font(.system(.caption, design: .monospaced, weight: .bold))
                    Spacer()
                    Text(violations.isEmpty ? "✅ 自檢通過 (0 違規)" : "❌ 違規: \(violations.count)")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(violations.isEmpty ? Color.green : Color.red)
                }

                if let latest = allLogs.last {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("最新交手 · 先手: \(latest.firstSide == .a ? "🟢 玩家 A" : "🔴 AI B") · 狀態: \(BattleText.stateAfterDescription(latest))")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                        sideFormulaView(label: "🟢 玩家 A", log: latest.a)
                        sideFormulaView(label: "🔴 AI B", log: latest.b)
                        if latest.refereeStandUp {
                            Text("🔔 雙方地面連續 3 次消極，裁判喊 Work! 強制分開回到站立遠距離！")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.cyan)
                        }
                        if let fin = latest.finish {
                            Text("🏁 終結觸發: \(fin.winner == .a ? "玩家 A" : "AI B") 以 \(BattleText.finishReasonText(fin.reason)) 獲勝")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.yellow)
                        }
                    }
                    .padding(8)
                    .background(Color.black.opacity(0.35))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Text("尚未出牌——點選手牌開始交手，進地面時手牌會自動翻面為上位/下位柔術摔角卡！")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Seed: #\(session.seed)")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(session.copiedToast ? "✓ 已複製" : "📋 重現碼") {
                        session.copyReplayBundle()
                    }
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .buttonStyle(.bordered)
                }
                .padding(.top, 6)
            }
            .padding(12)
        }
        .background(Color(red: 0.07, green: 0.08, blue: 0.11))
    }

    private func sideFormulaView(label: String, log: ExchangeSideLog) -> some View {
        let o = log.odds
        let status: String
        if log.wasInterrupted {
            status = "⚡ 被打斷"
        } else if log.succeeded {
            status = "✓ 成功"
        } else {
            status = "✗ 失敗"
        }

        var extraTags: [String] = []
        if log.inflictedRocked { extraTags.append("💥打暈!") }
        if log.inflictedCut { extraTags.append("🩸割傷!") }
        if let td = log.takedownLanded { extraTags.append("🤼摔進\(BattleText.shortPositionName(td))") }
        if let adv = log.positionAdvancedTo { extraTags.append("📍位置→\(BattleText.shortPositionName(adv))") }
        if let swp = log.sweptToPosition { extraTags.append("🔄掃技翻轉→\(BattleText.shortPositionName(swp))!") }
        if log.stoodUpToStanding { extraTags.append("🏃逃脫起身!") }
        if let sub = log.submissionStageReached {
            extraTags.append(sub == .lockedIn ? "🔒深鎖階段2!" : "🔒抓把階段1!")
        }
        if log.submissionEscaped { extraTags.append("🛡️掙脫鎖技!") }
        let extraText = extraTags.isEmpty ? "" : " " + extraTags.joined(separator: " ")

        return VStack(alignment: .leading, spacing: 2) {
            Text("\(label) 出【\(log.card.name)】 → \(status) | 傷: \(String(format: "%.1f", log.damageDealt))\(extraText)")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
            Text(
                String(
                    format: "算式: 基%.0f%% 屬%+.0f%% 位%+.0f%% 體%+.0f%% 勢%+.0f%% 特%+.0f%% 讀%+.0f%% = 最終 %.1f%% | 擲骰 %.3f",
                    o.base * 100,
                    o.attributeModifier * 100,
                    o.distanceModifier * 100,
                    o.conditionModifier * 100,
                    o.momentumModifier * 100,
                    o.traitModifier * 100,
                    o.readModifier * 100,
                    o.finalOdds * 100,
                    log.roll
                )
            )
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
        }
    }
}
