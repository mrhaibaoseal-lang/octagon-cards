"""Unit tests for the Python UFC scraper, Bayesian/Elo rating calculator, and 5-step pixelator."""

from __future__ import annotations

from PIL import Image, ImageDraw

from models import BoutStatRecord, CareerRawStats, RawFighterProfile
from pixelate_sprites import OUTLINE_RGBA, pixelate_cutout
from rating_calculator import calculate_roster_ratings, compute_base_attributes
from scrape_ufcstats import normalize_method, parse_ufc_date


def test_parse_ufc_date_and_method() -> None:
    assert parse_ufc_date("Aug. 15, 2026") == "2026-08-15"
    assert parse_ufc_date("Jan. 18, 2025") == "2025-01-18"
    assert normalize_method("Decision - Unanimous") == "U-DEC"
    assert normalize_method("KO/TKO") == "KO/TKO"
    assert normalize_method("Submission") == "SUB"


def test_bayesian_shrinkage_prevents_newcomer_outlier() -> None:
    newcomer = RawFighterProfile(
        id="newcomer-1",
        name="Newcomer One",
        weightClass="Lightweight",
        wins=1,
        losses=0,
        draws=0,
        careerStats=CareerRawStats(
            slpm=9.5,
            strAccPct=80.0,
            kdAvg=2.5,
            koWinPct=100.0,
        ),
    )
    veteran = RawFighterProfile(
        id="veteran-1",
        name="Veteran KO Artist",
        weightClass="Lightweight",
        wins=20,
        losses=2,
        draws=0,
        careerStats=CareerRawStats(
            slpm=6.2,
            strAccPct=58.0,
            kdAvg=1.2,
            koWinPct=75.0,
        ),
    )
    new_attrs = compute_base_attributes(newcomer)
    vet_attrs = compute_base_attributes(veteran)
    # 1-0 newcomer is shrunk toward the UFC prior and does not exceed 96
    assert 50 <= new_attrs.power <= 94
    assert 50 <= vet_attrs.power <= 96


def test_chronological_elo_and_targeted_attribute_deltas() -> None:
    striker = RawFighterProfile(
        id="ilia-topuria",
        name="Ilia Topuria",
        weightClass="Featherweight",
        wins=16,
        losses=0,
        draws=0,
        careerStats=CareerRawStats(slpm=4.6, strAccPct=47.0, kdAvg=0.85, koWinPct=62.0),
        bouts=[
            BoutStatRecord(
                boutDate="Oct. 26, 2024",
                isoDate="2024-10-26",
                headline="Topuria vs Holloway",
                opponentId="max-holloway",
                opponentName="Max Holloway",
                result="W",
                method="KO/TKO",
                round=3,
                time="1:34",
            )
        ],
    )
    vet = RawFighterProfile(
        id="max-holloway",
        name="Max Holloway",
        weightClass="Featherweight",
        wins=26,
        losses=8,
        draws=0,
        careerStats=CareerRawStats(
            slpm=7.1,
            strAccPct=48.0,
            kdAvg=0.35,
            koWinPct=46.0,
            avgFightTimeMinutes=15.0,
        ),
        bouts=[
            BoutStatRecord(
                boutDate="Oct. 26, 2024",
                isoDate="2024-10-26",
                headline="Topuria vs Holloway",
                opponentId="ilia-topuria",
                opponentName="Ilia Topuria",
                result="L",
                method="KO/TKO",
                round=3,
                time="1:34",
            )
        ],
    )
    roster = {f.id: f for f in calculate_roster_ratings([striker, vet])}
    topuria_out = roster["ilia-topuria"]
    holloway_out = roster["max-holloway"]

    # Winner by KO/TKO gets positive Elo delta and Power/Accuracy buff
    assert topuria_out.lastFightDelta is not None
    assert topuria_out.lastFightDelta.eloDelta > 0
    assert topuria_out.attributes.power > topuria_out.baseAttributes.power
    assert topuria_out.attributes.accuracy >= topuria_out.baseAttributes.accuracy

    # Loser by KO/TKO gets negative Elo delta and Chin/Defense nerf
    assert holloway_out.lastFightDelta is not None
    assert holloway_out.lastFightDelta.eloDelta < 0
    assert holloway_out.attributes.chin < holloway_out.baseAttributes.chin
    assert 2 <= len(topuria_out.traits) <= 4
    assert 2 <= len(holloway_out.traits) <= 4


def test_5_step_cutout_pixelator() -> None:
    # Create a synthetic 300x500 transparent image with a fighter silhouette
    src = Image.new("RGBA", (300, 500), (0, 0, 0, 0))
    draw = ImageDraw.Draw(src)
    draw.ellipse((110, 40, 190, 120), fill=(220, 175, 145, 255))
    draw.rectangle((95, 120, 205, 320), fill=(210, 165, 135, 255))
    draw.rectangle((95, 300, 205, 380), fill=(30, 40, 55, 255))

    body_sprite = pixelate_cutout(src, target_height=116, colors=32, is_square_headshot=False)
    assert body_sprite.size[1] == 116
    assert body_sprite.size[0] < 116

    # Check that dark outline pixels (#12141F) were generated and unique opaque colors <= 33
    pixels = list(body_sprite.get_flattened_data())
    opaque_colors = {px for px in pixels if px[3] > 0}
    assert OUTLINE_RGBA in opaque_colors
    assert len(opaque_colors) <= 33

    head_sprite = pixelate_cutout(src, target_height=64, colors=32, is_square_headshot=True)
    assert head_sprite.size == (64, 64)
