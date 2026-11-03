"""Pydantic v2 data models for the UFC scraper and Elo/Bayesian rating calculator."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BoutStatRecord(BaseModel):
    """Single historical UFC bout record for chronological Elo and targeted attribute delta."""

    model_config = ConfigDict(extra="ignore")

    boutDate: str = Field(description="Bout date string (e.g. '2026-08-15' or 'Aug. 15, 2026')")
    isoDate: str = Field(description="Normalized ISO-8601 date YYYY-MM-DD for chronological sorting")
    headline: str = Field(description="Bout headline (e.g. 'Makhachev vs Machado Garry')")
    opponentId: str = Field(description="Opponent slug identifier (e.g. 'ian-machado-garry')")
    opponentName: str = Field(description="Opponent display name")
    result: Literal["W", "L", "D", "NC"]
    method: Literal["KO/TKO", "SUB", "U-DEC", "S-DEC", "M-DEC", "DEC", "OTHER"]
    round: int = Field(default=3, ge=1, le=5)
    time: str = Field(default="5:00")


class CareerRawStats(BaseModel):
    """Career statistical rates from UFC / ufcstats."""

    model_config = ConfigDict(extra="ignore")

    slpm: float = Field(default=3.5, ge=0.0, description="Sig. Strikes Landed per Min")
    strAccPct: float = Field(default=45.0, ge=0.0, le=100.0, description="Sig. Strike Accuracy %")
    sapm: float = Field(default=3.2, ge=0.0, description="Sig. Strikes Absorbed per Min")
    strDefPct: float = Field(default=54.0, ge=0.0, le=100.0, description="Sig. Strike Defense %")
    tdAvg: float = Field(default=1.5, ge=0.0, description="Takedowns Landed per 15 Min")
    tdAccPct: float = Field(default=40.0, ge=0.0, le=100.0, description="Takedown Accuracy %")
    tdDefPct: float = Field(default=65.0, ge=0.0, le=100.0, description="Takedown Defense %")
    subAvg: float = Field(default=0.5, ge=0.0, description="Submission Attempts per 15 Min")
    kdAvg: float = Field(default=0.35, ge=0.0, description="Knockdowns per 15 Min")
    avgFightTimeMinutes: float = Field(default=10.5, ge=0.5, description="Average fight duration in minutes")
    standingStrPct: float = Field(default=75.0, ge=0.0, le=100.0)
    clinchStrPct: float = Field(default=12.0, ge=0.0, le=100.0)
    groundStrPct: float = Field(default=13.0, ge=0.0, le=100.0)
    koWinPct: float = Field(default=35.0, ge=0.0, le=100.0)
    decWinPct: float = Field(default=45.0, ge=0.0, le=100.0)
    subWinPct: float = Field(default=20.0, ge=0.0, le=100.0)


class FighterAttributesModel(BaseModel):
    """The 10 core L1 fighter attributes (0..100), matching Swift FighterAttributes."""

    model_config = ConfigDict(extra="ignore")

    power: int = Field(default=50, ge=0, le=100)
    speed: int = Field(default=50, ge=0, le=100)
    accuracy: int = Field(default=50, ge=0, le=100)
    strikingDefense: int = Field(default=50, ge=0, le=100)
    chin: int = Field(default=50, ge=0, le=100)
    cardio: int = Field(default=50, ge=0, le=100)
    takedown: int = Field(default=50, ge=0, le=100)
    takedownDefense: int = Field(default=50, ge=0, le=100)
    submission: int = Field(default=50, ge=0, le=100)
    clinch: int = Field(default=50, ge=0, le=100)

    @field_validator(
        "power",
        "speed",
        "accuracy",
        "strikingDefense",
        "chin",
        "cardio",
        "takedown",
        "takedownDefense",
        "submission",
        "clinch",
        mode="before",
    )
    @classmethod
    def clamp_attr(cls, v: int | float) -> int:
        return max(0, min(100, int(round(v))))


class LastFightDelta(BaseModel):
    """Live buff/nerf delta generated from the fighter's most recent UFC bout."""

    model_config = ConfigDict(extra="ignore")

    boutDate: str
    opponentName: str
    result: str
    method: str
    round: int
    eloBefore: int
    eloAfter: int
    eloDelta: int
    attributeDeltas: dict[str, int]
    summary: str


class RawFighterProfile(BaseModel):
    """Raw scraped fighter profile prior to Bayesian/Elo rating computation."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    nickname: str | None = None
    weightClass: str = "Lightweight"
    stance: Literal["orthodox", "southpaw"] = "orthodox"
    fightingStyle: str | None = None
    age: int = 29
    heightCm: int = 178
    reachCm: int = 180
    wins: int = 0
    losses: int = 0
    draws: int = 0
    fullBodyImageUrl: str | None = None
    headshotImageUrl: str | None = None
    careerStats: CareerRawStats = Field(default_factory=CareerRawStats)
    bouts: list[BoutStatRecord] = Field(default_factory=list)


class ExportedFighter(BaseModel):
    """Final fighter JSON entry compatible with Swift OctagonCore Fighter + Roster metadata."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    nickname: str | None = None
    weightClass: str
    record: str
    stance: Literal["orthodox", "southpaw"]
    age: int
    heightCm: int
    reachCm: int
    eloRating: int
    overallRating: int
    fullBodyImageUrl: str | None = None
    headshotImageUrl: str | None = None
    attributes: FighterAttributesModel
    baseAttributes: FighterAttributesModel
    traits: list[str]
    lastFightPatchNote: str | None = None
    lastFightDelta: LastFightDelta | None = None
    careerStats: CareerRawStats
    bouts: list[BoutStatRecord]
