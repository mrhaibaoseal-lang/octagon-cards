"""Bayesian Shrinkage + Chronological MMA Elo & Targeted Attribute Calculator (P1-2).

Implements docs/POWER_SYSTEM.md §1.1, §1.2, and §2:
1. Empirical Bayes shrinkage toward UFC population priors + percentile scaling -> 10 L1 base attributes.
2. Chronological bout replay with opponent-quality Elo and method-specific targeted attribute deltas
   (KO/TKO buffs power/accuracy and nerfs loser's chin/defense; SUB buffs submission/clinch;
    5-round & grappling decisions buff cardio/takedown/clinch).
3. Automatic L2 Trait tagging (2–4 traits per fighter, including dynamic glassChin / ironChin updates).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from models import (
    BoutStatRecord,
    ExportedFighter,
    FighterAttributesModel,
    LastFightDelta,
    RawFighterProfile,
)

ELITE_GRAPPLER_SLUGS: set[str] = {
    "islam-makhachev",
    "khamzat-chimaev",
    "merab-dvalishvili",
    "arman-tsarukyan",
    "belal-muhammad",
    "umar-nurmagomedov",
    "shavkat-rakhmonov",
    "charles-oliveira",
    "alexandre-pantoja",
    "jon-jones",
    "diego-lopes",
}

HEAVY_DIVISIONS: dict[str, float] = {
    "Flyweight": -4.0,
    "Bantamweight": -2.0,
    "Featherweight": 0.0,
    "Lightweight": 1.5,
    "Welterweight": 3.0,
    "Middleweight": 4.5,
    "Light Heavyweight": 6.5,
    "Heavyweight": 8.0,
}


def clamp_int(val: float, lo: int = 40, hi: int = 99) -> int:
    return max(lo, min(hi, int(round(val))))


def shrink(raw_val: float, prior: float, n_fights: int, k: int = 8) -> float:
    """Empirical Bayes shrinkage: w = n / (n + k)."""
    w = n_fights / float(n_fights + k)
    return w * raw_val + (1.0 - w) * prior


def compute_base_attributes(profile: RawFighterProfile) -> FighterAttributesModel:
    """Compute Stage 1 L1 Base Attributes (0..100) using Bayesian shrinkage."""
    n_fights = max(1, profile.wins + profile.losses + profile.draws)
    cs = profile.careerStats
    div_mod = HEAVY_DIVISIONS.get(profile.weightClass, 1.0)

    slpm = shrink(cs.slpm, 3.65, n_fights)
    str_acc = shrink(cs.strAccPct, 46.0, n_fights)
    sapm = shrink(cs.sapm, 3.30, n_fights)
    str_def = shrink(cs.strDefPct, 54.5, n_fights)
    td_avg = shrink(cs.tdAvg, 1.50, n_fights)
    td_acc = shrink(cs.tdAccPct, 41.0, n_fights)
    td_def = shrink(cs.tdDefPct, 65.0, n_fights)
    sub_avg = shrink(cs.subAvg, 0.55, n_fights)
    kd_avg = shrink(cs.kdAvg, 0.38, n_fights)
    ko_pct = shrink(cs.koWinPct, 35.0, n_fights)
    sub_pct = shrink(cs.subWinPct, 20.0, n_fights)
    dec_pct = shrink(cs.decWinPct, 45.0, n_fights)

    ko_losses = sum(1 for b in profile.bouts if b.result == "L" and b.method == "KO/TKO")
    sub_losses = sum(1 for b in profile.bouts if b.result == "L" and b.method == "SUB")

    # 1. Power: KD rate + KO win % + SLpM + division mass
    power = 48.0 + kd_avg * 22.0 + ko_pct * 0.30 + slpm * 1.4 + div_mod

    # 2. Speed: SLpM pace + lighter division agility - age > 32 decay
    age_speed_mod = -max(0, profile.age - 32) * 1.1
    speed = 58.0 + slpm * 4.8 - div_mod * 1.0 + age_speed_mod

    # 3. Accuracy: Sig. Strike Accuracy % + output efficiency
    accuracy = 28.0 + str_acc * 0.96 + slpm * 1.1

    # 4. Striking Defense: Str. Def % - SApM penalty
    striking_def = 34.0 + str_def * 0.92 - sapm * 2.5

    # 5. Chin: Base durability - KO loss history - high SApM wear - age > 34 decay
    age_chin_mod = -max(0, profile.age - 34) * 1.2
    chin = (
        86.0
        - ko_losses * 5.5
        - max(0.0, sapm - 3.2) * 2.8
        + (2.0 if profile.losses <= 2 and n_fights >= 10 else 0.0)
        + age_chin_mod
    )

    # 6. Cardio: Fight duration + decision win share + combined pace (SLpM + TD Avg)
    five_round_wins = sum(1 for b in profile.bouts if b.result == "W" and b.round >= 4)
    cardio = (
        56.0
        + cs.avgFightTimeMinutes * 1.20
        + dec_pct * 0.14
        + (slpm + td_avg * 1.3) * 1.25
        + five_round_wins * 2.0
    )

    # 7. Takedown: TD Avg per 15 min + TD Accuracy %
    takedown = 45.0 + td_avg * 8.8 + td_acc * 0.34

    # 8. Takedown Defense: TD Defense %
    takedown_def = 28.0 + td_def * 0.72

    # 9. Submission: Sub Avg + Sub Win % + ground strike/control share - sub losses
    submission = 48.0 + sub_avg * 17.5 + sub_pct * 0.44 + cs.groundStrPct * 0.20 - sub_losses * 4.5

    # 10. Clinch & Top Control: Clinch % + Ground % + TD Avg + win ratio
    win_rate = shrink(profile.wins / float(n_fights), 0.62, n_fights)
    clinch = 54.0 + (cs.clinchStrPct + cs.groundStrPct) * 0.58 + td_avg * 4.8 + win_rate * 10.0

    return FighterAttributesModel(
        power=clamp_int(power, 50, 96),
        speed=clamp_int(speed, 52, 96),
        accuracy=clamp_int(accuracy, 52, 96),
        strikingDefense=clamp_int(striking_def, 50, 95),
        chin=clamp_int(chin, 55, 97),
        cardio=clamp_int(cardio, 55, 97),
        takedown=clamp_int(takedown, 45, 96),
        takedownDefense=clamp_int(takedown_def, 48, 96),
        submission=clamp_int(submission, 45, 97),
        clinch=clamp_int(clinch, 50, 97),
    )


def compute_overall(attrs: FighterAttributesModel) -> int:
    """Display-only OVR rating weighted by a fighter's top archetype strengths + core durability."""
    vals = [
        attrs.power,
        attrs.speed,
        attrs.accuracy,
        attrs.strikingDefense,
        attrs.chin,
        attrs.cardio,
        attrs.takedown,
        attrs.takedownDefense,
        attrs.submission,
        attrs.clinch,
    ]
    top_five_avg = sum(sorted(vals, reverse=True)[:5]) / 5.0
    all_avg = sum(vals) / 10.0
    return clamp_int(top_five_avg * 0.65 + all_avg * 0.35, 65, 97)


def assign_traits(
    profile: RawFighterProfile,
    attrs: FighterAttributesModel,
    bouts_chronological: list[BoutStatRecord],
) -> list[str]:
    """Automatically assign 2–4 L2 Trait tags from career & recent bout history (POWER_SYSTEM.md §2)."""
    traits: list[str] = []
    recent_3 = bouts_chronological[-3:] if bouts_chronological else []
    recent_ko_losses = sum(1 for b in recent_3 if b.result == "L" and b.method == "KO/TKO")
    total_ko_losses = sum(1 for b in bouts_chronological if b.result == "L" and b.method == "KO/TKO")

    # 1. Chin traits: Glass Chin vs Iron Chin
    if recent_ko_losses >= 2 or (total_ko_losses >= 3 and attrs.chin <= 76):
        traits.append("glassChin")
    elif total_ko_losses == 0 and (profile.wins + profile.losses) >= 14 and attrs.chin >= 86:
        traits.append("ironChin")
    elif attrs.chin >= 91 and recent_ko_losses == 0:
        traits.append("ironChin")

    # 2. One-Punch KO power
    if attrs.power >= 89 or (profile.careerStats.kdAvg >= 0.70 and profile.careerStats.koWinPct >= 50.0):
        traits.append("onePunch")

    # 3. Black Belt BJJ
    if attrs.submission >= 86 or profile.careerStats.subWinPct >= 38.0 or profile.careerStats.subAvg >= 1.2:
        traits.append("blackBeltBJJ")

    # 4. Smother (Heavy top pressure / wrestling)
    if (attrs.takedown >= 84 and attrs.clinch >= 85) or profile.careerStats.tdAvg >= 3.0:
        traits.append("smother")

    # 5. Gas Tank (Cardio machine)
    if attrs.cardio >= 90 or (
        profile.careerStats.avgFightTimeMinutes >= 13.0 and profile.careerStats.slpm >= 4.5
    ):
        traits.append("gasTank")

    # 6. Fast Starter (R1 finish specialist)
    r1_finishes = sum(
        1 for b in bouts_chronological if b.result == "W" and b.round == 1 and b.method in ("KO/TKO", "SUB")
    )
    if r1_finishes >= 2 or (profile.careerStats.avgFightTimeMinutes <= 7.8 and attrs.power >= 85):
        traits.append("fastStarter")

    # 7. Counter Puncher
    if attrs.accuracy >= 84 and attrs.strikingDefense >= 80 and profile.careerStats.slpm <= 4.6:
        traits.append("counterPuncher")

    # 8. Cage Pinner
    if profile.careerStats.clinchStrPct >= 17.0 or (attrs.clinch >= 86 and "smother" not in traits):
        traits.append("cagePinner")

    # 9. Unorthodox
    style_low = (profile.fightingStyle or "").lower()
    if (
        "freestyle" in style_low
        or "kickboxer" in style_low
        or (attrs.speed >= 86 and attrs.strikingDefense >= 82)
        or profile.id
        in {
            "jiri-prochazka",
            "sean-omalley",
            "cory-sandhagen",
            "dricus-du-plessis",
            "israel-adesanya",
            "diego-lopes",
        }
    ):
        if "unorthodox" not in traits:
            traits.append("unorthodox")

    # Ensure every fighter has between 2 and 4 traits
    fallback_order = [
        ("onePunch", attrs.power),
        ("counterPuncher", attrs.accuracy + attrs.strikingDefense - 70),
        ("gasTank", attrs.cardio),
        ("smother", attrs.takedown),
        ("blackBeltBJJ", attrs.submission),
        ("cagePinner", attrs.clinch),
        ("ironChin", attrs.chin),
    ]
    for t_name, _ in sorted(fallback_order, key=lambda x: x[1], reverse=True):
        if len(traits) >= 2:
            break
        if t_name == "ironChin" and "glassChin" in traits:
            continue
        if t_name not in traits:
            traits.append(t_name)

    return traits[:4]


def calculate_roster_ratings(
    profiles: list[RawFighterProfile],
) -> list[ExportedFighter]:
    """Run full 3-stage Bayesian + Chronological MMA Elo + Targeted Delta calculation."""
    base_attrs_map: dict[str, FighterAttributesModel] = {}
    elo_map: dict[str, float] = {}

    for p in profiles:
        base = compute_base_attributes(p)
        base_attrs_map[p.id] = base
        # Initial pre-UFC / baseline Elo seeded from career win-loss record & base OVR
        n_total = max(1, p.wins + p.losses + p.draws)
        win_ratio = p.wins / float(n_total)
        elo_map[p.id] = 1520.0 + (win_ratio - 0.65) * 320.0 + (compute_overall(base) - 78) * 6.0

    # Replay each fighter's bouts chronologically to compute opponent-weighted Elo & targeted attribute deltas
    exported: list[ExportedFighter] = []

    for p in profiles:
        base = base_attrs_map[p.id]
        cur_attrs: dict[str, float] = {
            "power": float(base.power),
            "speed": float(base.speed),
            "accuracy": float(base.accuracy),
            "strikingDefense": float(base.strikingDefense),
            "chin": float(base.chin),
            "cardio": float(base.cardio),
            "takedown": float(base.takedown),
            "takedownDefense": float(base.takedownDefense),
            "submission": float(base.submission),
            "clinch": float(base.clinch),
        }

        bouts_chrono = sorted(p.bouts, key=lambda b: b.isoDate)
        total_bouts = len(bouts_chrono)
        current_elo = elo_map[p.id]
        last_delta: LastFightDelta | None = None

        for idx, bout in enumerate(bouts_chrono):
            # Recency weighting: last 3 bouts carry highest dynamic impact (POWER_SYSTEM.md §1.2)
            recency_rank = total_bouts - 1 - idx
            if recency_rank == 0:
                recency_w = 1.00
            elif recency_rank == 1:
                recency_w = 0.75
            elif recency_rank == 2:
                recency_w = 0.55
            else:
                recency_w = 0.25

            opp_elo = elo_map.get(bout.opponentId, 1660.0 if bout.round == 5 else 1580.0)
            expected = 1.0 / (1.0 + 10.0 ** ((opp_elo - current_elo) / 400.0))

            if bout.result == "W":
                actual = 1.0
            elif bout.result == "L":
                actual = 0.0
            else:
                actual = 0.5

            finish_mult = 1.25 if bout.method in ("KO/TKO", "SUB") else 1.0
            if bout.method in ("KO/TKO", "SUB") and bout.round <= 2:
                finish_mult = 1.35

            k_factor = 34.0 * finish_mult
            elo_before = int(round(current_elo))
            elo_change = int(round(k_factor * (actual - expected)))
            current_elo += elo_change
            elo_after = int(round(current_elo))

            # Targeted attribute adjustments for this bout
            bout_attr_deltas: dict[str, float] = {}
            is_grappler = (
                p.id in ELITE_GRAPPLER_SLUGS
                or p.careerStats.tdAvg >= 2.2
                or (p.careerStats.clinchStrPct + p.careerStats.groundStrPct) >= 32.0
            )
            opp_is_grappler = bout.opponentId in ELITE_GRAPPLER_SLUGS

            if bout.result == "W":
                # Beating a strong opponent gives a larger buff (0.65x .. 1.45x)
                qual = (0.65 + 0.85 * (1.0 - expected)) * recency_w
                opp_base = base_attrs_map.get(bout.opponentId)
                iron_chin_bonus = 1.2 if (opp_base and opp_base.chin >= 86) else 0.0
                if bout.method == "KO/TKO":
                    bout_attr_deltas["power"] = (
                        3.6 * qual + (1.0 if bout.round <= 2 else 0.0) + iron_chin_bonus
                    )
                    bout_attr_deltas["accuracy"] = 2.0 * qual
                elif bout.method == "SUB":
                    bout_attr_deltas["submission"] = 3.8 * qual
                    bout_attr_deltas["clinch"] = 2.0 * qual
                else:
                    if is_grappler:
                        bout_attr_deltas["takedown"] = 2.2 * qual
                        bout_attr_deltas["clinch"] = 2.6 * qual
                        bout_attr_deltas["cardio"] = 2.0 * qual
                    else:
                        bout_attr_deltas["cardio"] = 2.5 * qual
                        bout_attr_deltas["speed"] = 1.8 * qual
                        bout_attr_deltas["accuracy"] = 1.5 * qual
                    if bout.round == 5:
                        bout_attr_deltas["cardio"] = bout_attr_deltas.get("cardio", 0.0) + 1.5 * recency_w
            elif bout.result == "L":
                # Losing as a heavy favorite hurts more than losing a close fight to a higher-Elo champion
                sev = (0.60 + 0.80 * expected) * recency_w
                if bout.method == "KO/TKO":
                    bout_attr_deltas["chin"] = -4.5 * sev
                    bout_attr_deltas["strikingDefense"] = -2.0 * sev
                elif bout.method == "SUB":
                    bout_attr_deltas["submission"] = -3.8 * sev
                    bout_attr_deltas["takedownDefense"] = -1.8 * sev
                else:
                    if opp_is_grappler:
                        bout_attr_deltas["takedownDefense"] = -2.4 * sev
                        bout_attr_deltas["cardio"] = -1.2 * sev
                    else:
                        bout_attr_deltas["strikingDefense"] = -1.6 * sev
                        bout_attr_deltas["cardio"] = -1.2 * sev

            rounded_deltas: dict[str, int] = {}
            for k_attr, delta_v in bout_attr_deltas.items():
                cur_attrs[k_attr] = max(42.0, min(98.0, cur_attrs[k_attr] + delta_v))
                r_int = int(round(delta_v))
                if r_int != 0:
                    rounded_deltas[k_attr] = r_int

            if idx == total_bouts - 1:
                delta_parts = [f"{k_a} {'+' if d_v > 0 else ''}{d_v}" for k_a, d_v in rounded_deltas.items()]
                delta_str = ", ".join(delta_parts) if delta_parts else "屬性持平"
                elo_sign = "+" if elo_change >= 0 else ""
                summary = (
                    f"{bout.result} vs {bout.opponentName} ({bout.method} R{bout.round}): "
                    f"Elo {elo_before}→{elo_after} ({elo_sign}{elo_change}) · {delta_str}"
                )
                last_delta = LastFightDelta(
                    boutDate=bout.boutDate,
                    opponentName=bout.opponentName,
                    result=bout.result,
                    method=bout.method,
                    round=bout.round,
                    eloBefore=elo_before,
                    eloAfter=elo_after,
                    eloDelta=elo_change,
                    attributeDeltas=rounded_deltas,
                    summary=summary,
                )

        final_attrs = FighterAttributesModel(
            power=clamp_int(cur_attrs["power"], 45, 98),
            speed=clamp_int(cur_attrs["speed"], 45, 98),
            accuracy=clamp_int(cur_attrs["accuracy"], 45, 98),
            strikingDefense=clamp_int(cur_attrs["strikingDefense"], 45, 97),
            chin=clamp_int(cur_attrs["chin"], 45, 98),
            cardio=clamp_int(cur_attrs["cardio"], 45, 98),
            takedown=clamp_int(cur_attrs["takedown"], 42, 98),
            takedownDefense=clamp_int(cur_attrs["takedownDefense"], 45, 98),
            submission=clamp_int(cur_attrs["submission"], 42, 98),
            clinch=clamp_int(cur_attrs["clinch"], 45, 98),
        )
        ovr = compute_overall(final_attrs)
        traits = assign_traits(p, final_attrs, bouts_chrono)

        exported.append(
            ExportedFighter(
                id=p.id,
                name=p.name,
                nickname=p.nickname,
                weightClass=p.weightClass,
                record=f"{p.wins}-{p.losses}-{p.draws}",
                stance=p.stance,
                age=p.age,
                heightCm=p.heightCm,
                reachCm=p.reachCm,
                eloRating=int(round(current_elo)),
                overallRating=ovr,
                fullBodyImageUrl=p.fullBodyImageUrl,
                headshotImageUrl=p.headshotImageUrl,
                attributes=final_attrs,
                baseAttributes=base,
                traits=traits,
                lastFightPatchNote=last_delta.summary if last_delta else None,
                lastFightDelta=last_delta,
                careerStats=p.careerStats,
                bouts=p.bouts,
            )
        )

    # Sort exported fighters by Elo / OVR descending
    exported.sort(key=lambda f: (f.overallRating, f.eloRating), reverse=True)
    return exported


def export_swift_roster(exported: list[ExportedFighter], swift_out: Path) -> None:
    """Generate Packages/OctagonCore/Sources/FightEngine/RealUFCRoster.swift from computed roster."""
    lines = [
        "/// Auto-generated real UFC fighter roster from data/fighters.json (P1-1 & P1-2).",
        "/// Contains 32 ranked UFC athletes with Bayesian + Chronological MMA Elo attributes,",
        "/// automatic L2 traits, official cutout PNG URLs, and Live Patch Notes.",
        "public enum RealUFCRoster {",
        "    public static let all: [Fighter] = [",
    ]
    for f in exported:
        a = f.attributes
        traits_str = ", ".join(f".{t}" for t in f.traits)
        nick = json.dumps(f.nickname, ensure_ascii=False) if f.nickname else "nil"
        body_url = json.dumps(f.fullBodyImageUrl) if f.fullBodyImageUrl else "nil"
        head_url = json.dumps(f.headshotImageUrl) if f.headshotImageUrl else "nil"
        patch = json.dumps(f.lastFightPatchNote, ensure_ascii=False) if f.lastFightPatchNote else "nil"
        name_esc = json.dumps(f.name, ensure_ascii=False)
        lines.extend(
            [
                "        Fighter(",
                f'            id: "{f.id}",',
                f"            name: {name_esc},",
                f"            nickname: {nick},",
                f'            weightClass: "{f.weightClass}",',
                f'            record: "{f.record}",',
                f"            stance: .{f.stance},",
                f"            eloRating: {f.eloRating},",
                f"            fullBodyImageUrl: {body_url},",
                f"            headshotImageUrl: {head_url},",
                f"            lastFightPatchNote: {patch},",
                "            attributes: FighterAttributes(",
                f"                power: {a.power}, speed: {a.speed}, accuracy: {a.accuracy},",
                f"                strikingDefense: {a.strikingDefense}, chin: {a.chin}, cardio: {a.cardio},",
                f"                takedown: {a.takedown}, takedownDefense: {a.takedownDefense},",
                f"                submission: {a.submission}, clinch: {a.clinch}",
                "            ),",
                f"            traits: [{traits_str}]",
                "        ),",
            ]
        )
    lines.extend(
        [
            "    ]",
            "",
            "    public static func fighter(id: String) -> Fighter? {",
            "        all.first { $0.id == id }",
            "    }",
            "}",
        ]
    )
    swift_out.parent.mkdir(parents=True, exist_ok=True)
    swift_out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute UFC fighter L1 attributes, MMA Elo, and L2 traits.")
    parser.add_argument(
        "--raw",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "raw_ufcstats.json",
        help="Input raw fighter JSON from scrape_ufcstats.py.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "fighters.json",
        help="Output fighters.json path.",
    )
    parser.add_argument(
        "--swift-out",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "Packages"
        / "OctagonCore"
        / "Sources"
        / "FightEngine"
        / "RealUFCRoster.swift",
        help="Output Swift roster catalog path.",
    )
    args = parser.parse_args()

    raw_data = json.loads(args.raw.read_text(encoding="utf-8"))
    profiles = [RawFighterProfile.model_validate(item) for item in raw_data]
    exported = calculate_roster_ratings(profiles)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = [f.model_dump(mode="json") for f in exported]
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    export_swift_roster(exported, args.swift_out)

    print(f"[P1-2 RatingEngine] Computed ratings for {len(exported)} UFC fighters -> {args.out}")
    print("\n=== 📊 Top 15 UFC Fighters & Live Patch Notes ===")
    for idx, f in enumerate(exported[:15], start=1):
        a = f.attributes
        print(
            f"{idx:02d}. {f.name} ({f.weightClass}, {f.record}) | "
            f"OVR {f.overallRating} | Elo {f.eloRating} | "
            f"PWR:{a.power} SPD:{a.speed} ACC:{a.accuracy} DEF:{a.strikingDefense} CHN:{a.chin} "
            f"CRD:{a.cardio} TD:{a.takedown} TDD:{a.takedownDefense} SUB:{a.submission} CLN:{a.clinch} | "
            f"Traits={f.traits}"
        )
        if f.lastFightPatchNote:
            print(f"    ↳ 🔁 {f.lastFightPatchNote}")


if __name__ == "__main__":
    main()
