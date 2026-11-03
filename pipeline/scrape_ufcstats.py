"""UFC & ufcstats Athlete Scraper (P1-1).

Fetches official career statistics, transparent cutout PNG URLs, bio attributes,
and chronological bout records for UFC fighters, outputting `data/raw_ufcstats.json`.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Literal

import httpx
from bs4 import BeautifulSoup

from models import BoutStatRecord, CareerRawStats, RawFighterProfile

DEFAULT_FEATURED_SLUGS: list[str] = [
    # Pound-for-Pound & Lightweight / Welterweight
    "islam-makhachev",
    "arman-tsarukyan",
    "charles-oliveira",
    "justin-gaethje",
    "dustin-poirier",
    "max-holloway",
    "dan-hooker",
    "michael-chandler",
    # Featherweight & Bantamweight
    "ilia-topuria",
    "alexander-volkanovski",
    "diego-lopes",
    "merab-dvalishvili",
    "sean-omalley",
    "umar-nurmagomedov",
    "petr-yan",
    "cory-sandhagen",
    # Welterweight & Middleweight
    "jack-della-maddalena",
    "shavkat-rakhmonov",
    "belal-muhammad",
    "ian-machado-garry",
    "khamzat-chimaev",
    "dricus-du-plessis",
    "sean-strickland",
    "israel-adesanya",
    "robert-whittaker",
    # Light Heavyweight & Heavyweight
    "alex-pereira",
    "magomed-ankalaev",
    "jiri-prochazka",
    "tom-aspinall",
    "jon-jones",
    "ciryl-gane",
    "alexandre-pantoja",
]

# Known southpaw fighters in the UFC roster (ufc.com bio omits stance field)
KNOWN_SOUTHPAWS: set[str] = {
    "islam-makhachev",
    "dustin-poirier",
    "conor-mcgregor",
    "israel-adesanya",
    "leon-edwards",
    "jack-della-maddalena",
    "cory-sandhagen",
    "ciryl-gane",
    "colby-covington",
    "luke-rockhold",
    "nate-diaz",
    "valentina-shevchenko",
}

MONTH_MAP: dict[str, int] = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def parse_ufc_date(raw_date: str) -> str:
    """Convert 'Aug. 15, 2026' or 'May 23, 2015' into ISO 'YYYY-MM-DD'."""
    cleaned = raw_date.replace(".", "").replace(",", "").strip()
    parts = cleaned.split()
    if len(parts) == 3:
        mon_str, day_str, year_str = parts
        month = MONTH_MAP.get(mon_str[:3].lower(), 1)
        try:
            day = int(day_str)
            year = int(year_str)
            return f"{year:04d}-{month:02d}-{day:02d}"
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(raw_date.strip())
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return "2024-01-01"


def normalize_method(
    raw_method: str,
) -> Literal["KO/TKO", "SUB", "U-DEC", "S-DEC", "M-DEC", "DEC", "OTHER"]:
    """Map raw UFC method string into canonical finish code."""
    up = raw_method.upper()
    if "KO" in up or "TKO" in up or "DOCTOR" in up:
        return "KO/TKO"
    if "SUB" in up:
        return "SUB"
    if "UNANIMOUS" in up or "U-DEC" in up:
        return "U-DEC"
    if "SPLIT" in up or "S-DEC" in up:
        return "S-DEC"
    if "MAJORITY" in up or "M-DEC" in up:
        return "M-DEC"
    if "DEC" in up:
        return "DEC"
    return "OTHER"


def normalize_division(raw_div: str | None) -> str:
    """Normalize 'Lightweight Division' -> 'Lightweight'."""
    if not raw_div:
        return "Lightweight"
    return raw_div.replace("Division", "").replace("Title Holder", "").strip() or "Lightweight"


def extract_float(text: str, default: float = 0.0) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
    return float(m.group(1)) if m else default


def parse_fight_cards(soup: BeautifulSoup, slug: str) -> list[BoutStatRecord]:
    """Extract bout history cards from a UFC athlete page DOM."""
    bouts: list[BoutStatRecord] = []
    for card in soup.select(".c-card-event--athlete-results"):
        headline_el = card.select_one(".c-card-event--athlete-results__headline")
        date_el = card.select_one(".c-card-event--athlete-results__date")
        if not headline_el or not date_el:
            continue

        headline = headline_el.get_text(" ", strip=True)
        raw_date = date_el.get_text(strip=True)
        iso_date = parse_ufc_date(raw_date)

        links = [
            (a.get_text(strip=True), a.get("href", ""))
            for a in card.select(".c-card-event--athlete-results__headline a")
        ]
        if len(links) >= 2:
            red_name, red_href = links[0]
            blue_name, blue_href = links[1]
            red_slug = (
                red_href.rstrip("/").split("/")[-1]
                if "/athlete/" in red_href
                else red_name.lower().replace(" ", "-")
            )
            blue_slug = (
                blue_href.rstrip("/").split("/")[-1]
                if "/athlete/" in blue_href
                else blue_name.lower().replace(" ", "-")
            )
        else:
            parts = [p.strip() for p in headline.split("vs")]
            red_name = parts[0] if parts else "Fighter A"
            blue_name = parts[1] if len(parts) > 1 else "Opponent"
            red_slug = red_name.lower().replace(" ", "-")
            blue_slug = blue_name.lower().replace(" ", "-")

        is_red = (red_slug == slug) or (slug.split("-")[-1] in red_slug)
        opp_id = blue_slug if is_red else red_slug
        opp_name = blue_name if is_red else red_name

        red_win = bool(
            card.select_one(
                ".c-card-event--athlete-results__red-image .c-card-event--athlete-results__plaque.win"
            )
        )
        blue_win = bool(
            card.select_one(
                ".c-card-event--athlete-results__blue-image .c-card-event--athlete-results__plaque.win"
            )
        )
        plaques = [
            p.get_text(strip=True).upper() for p in card.select(".c-card-event--athlete-results__plaque")
        ]

        result: Literal["W", "L", "D", "NC"] = "W"
        if red_win or blue_win:
            if (is_red and red_win) or (not is_red and blue_win):
                result = "W"
            else:
                result = "L"
        elif any("DRAW" in p for p in plaques):
            result = "D"
        elif any("NC" in p or "NO CONTEST" in p for p in plaques):
            result = "NC"

        round_num = 3
        time_str = "5:00"
        method_raw = "Decision - Unanimous"

        for res in card.select(".c-card-event--athlete-results__result"):
            lbl_el = res.select_one(".c-card-event--athlete-results__result-label")
            txt_el = res.select_one(".c-card-event--athlete-results__result-text")
            if not lbl_el or not txt_el:
                continue
            lbl = lbl_el.get_text(strip=True).lower()
            val = txt_el.get_text(strip=True)
            if "round" in lbl:
                try:
                    round_num = max(1, min(5, int(val)))
                except ValueError:
                    round_num = 3
            elif "time" in lbl:
                time_str = val
            elif "method" in lbl:
                method_raw = val

        bouts.append(
            BoutStatRecord(
                boutDate=raw_date,
                isoDate=iso_date,
                headline=headline,
                opponentId=opp_id,
                opponentName=opp_name,
                result=result,
                method=normalize_method(method_raw),
                round=round_num,
                time=time_str,
            )
        )
    return bouts


def scrape_athlete_profile(
    client: httpx.Client, slug: str, max_history_pages: int = 3
) -> RawFighterProfile | None:
    """Scrape a single fighter profile and paginated fight history from ufc.com."""
    url = f"https://www.ufc.com/athlete/{slug}"
    resp = client.get(url)
    if resp.status_code != 200:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    name_el = soup.select_one(".hero-profile__name")
    if not name_el:
        return None
    name = name_el.get_text(strip=True)

    nick_el = soup.select_one(".hero-profile__nickname")
    nickname = nick_el.get_text(strip=True).strip('"') if nick_el else None

    div_el = soup.select_one(".hero-profile__division-title")
    weight_class = normalize_division(div_el.get_text(strip=True) if div_el else None)

    rec_el = soup.select_one(".hero-profile__division-body")
    wins, losses, draws = 15, 2, 0
    if rec_el:
        m = re.search(r"(\d+)-(\d+)-(\d+)", rec_el.get_text(strip=True))
        if m:
            wins, losses, draws = int(m.group(1)), int(m.group(2)), int(m.group(3))

    # Extract official transparent PNG URLs (full body cutout + headshot)
    full_body_url: str | None = None
    headshot_url: str | None = None
    for img in soup.select("img"):
        src = img.get("src", "")
        if not src:
            continue
        if "athlete_bio_full_body" in src and not full_body_url:
            full_body_url = src
        elif (
            "event_results_athlete_headshot" in src
            and slug.split("-")[-1].upper() in src.upper()
            and not headshot_url
        ):
            headshot_url = src
    if not headshot_url:
        for img in soup.select("img"):
            src = img.get("src", "")
            if "event_results_athlete_headshot" in src:
                headshot_url = src
                break

    # Bio fields
    age = 29
    height_cm = 178
    reach_cm = 180
    fighting_style: str | None = None
    for field in soup.select(".c-bio__field"):
        lbl_el = field.select_one(".c-bio__label")
        txt_el = field.select_one(".c-bio__text")
        if not lbl_el or not txt_el:
            continue
        lbl = lbl_el.get_text(strip=True).lower()
        val = txt_el.get_text(strip=True)
        if lbl == "age":
            age = int(extract_float(val, 29))
        elif lbl == "height":
            inches = extract_float(val, 70.0)
            height_cm = int(round(inches * 2.54))
        elif lbl == "reach":
            inches = extract_float(val, 71.0)
            reach_cm = int(round(inches * 2.54))
        elif "fighting style" in lbl:
            fighting_style = val

    # Career stats
    sig_landed = 0.0
    sig_attempted = 0.0
    td_landed = 0.0
    td_attempted = 0.0
    for stat_el in soup.select(".c-overlap__stats"):
        txt = stat_el.get_text(" ", strip=True)
        low = txt.lower()
        if "sig. strikes landed" in low:
            sig_landed = extract_float(txt, 0.0)
        elif "sig. strikes attempted" in low:
            sig_attempted = extract_float(txt, 0.0)
        elif "takedowns landed" in low:
            td_landed = extract_float(txt, 0.0)
        elif "takedowns attempted" in low:
            td_attempted = extract_float(txt, 0.0)

    str_acc_pct = round((sig_landed / sig_attempted) * 100.0, 1) if sig_attempted > 0 else 46.0
    td_acc_pct = round((td_landed / td_attempted) * 100.0, 1) if td_attempted > 0 else 40.0

    slpm = 3.5
    sapm = 3.1
    td_avg = 1.5
    sub_avg = 0.5
    str_def_pct = 54.0
    td_def_pct = 65.0
    kd_avg = 0.35
    avg_fight_minutes = 10.5

    for grp in soup.select(".c-stat-compare__group"):
        num_el = grp.select_one(".c-stat-compare__number")
        lbl_el = grp.select_one(".c-stat-compare__label")
        if not num_el or not lbl_el:
            continue
        num_txt = num_el.get_text(" ", strip=True)
        low = lbl_el.get_text(" ", strip=True).lower()
        if "sig. str. landed" in low:
            slpm = extract_float(num_txt, 3.5)
        elif "sig. str. absorbed" in low:
            sapm = extract_float(num_txt, 3.1)
        elif "takedown avg" in low:
            td_avg = extract_float(num_txt, 0.5)
        elif "submission avg" in low:
            sub_avg = extract_float(num_txt, 0.2)
        elif "sig. str. defense" in low:
            str_def_pct = extract_float(num_txt, 54.0)
        elif "takedown defense" in low:
            td_def_pct = extract_float(num_txt, 65.0)
        elif "knockdown avg" in low:
            kd_avg = extract_float(num_txt, 0.35)
        elif "average fight time" in low:
            m = re.search(r"(\d+):(\d+)", num_txt)
            if m:
                parsed_mins = round(int(m.group(1)) + int(m.group(2)) / 60.0, 2)
                avg_fight_minutes = parsed_mins if parsed_mins >= 0.5 else 10.5

    standing_pct = 75.0
    clinch_pct = 12.0
    ground_pct = 13.0
    ko_win_pct = 35.0
    dec_win_pct = 45.0
    sub_win_pct = 20.0

    for bar in soup.select(".c-stat-3bar__group"):
        txt = bar.get_text(" ", strip=True)
        low = txt.lower()
        pct_match = re.search(r"\((\d+)%\)", txt)
        pct_val = float(pct_match.group(1)) if pct_match else 0.0
        if "standing" in low:
            standing_pct = pct_val
        elif "clinch" in low:
            clinch_pct = pct_val
        elif "ground" in low:
            ground_pct = pct_val
        elif "ko/tko" in low:
            ko_win_pct = pct_val
        elif "dec" in low:
            dec_win_pct = pct_val
        elif "sub" in low:
            sub_win_pct = pct_val

    # Collect bout history across pages
    all_bouts = parse_fight_cards(soup, slug)
    seen_keys = {(b.isoDate, b.opponentId) for b in all_bouts}
    for page_idx in range(1, max_history_pages):
        p_resp = client.get(f"{url}?page={page_idx}")
        if p_resp.status_code != 200:
            break
        p_soup = BeautifulSoup(p_resp.text, "html.parser")
        more = parse_fight_cards(p_soup, slug)
        if not more:
            break
        added = 0
        for b in more:
            key = (b.isoDate, b.opponentId)
            if key not in seen_keys:
                seen_keys.add(key)
                all_bouts.append(b)
                added += 1
        if added == 0:
            break

    stance: Literal["orthodox", "southpaw"] = "southpaw" if slug in KNOWN_SOUTHPAWS else "orthodox"

    return RawFighterProfile(
        id=slug,
        name=name,
        nickname=nickname,
        weightClass=weight_class,
        stance=stance,
        fightingStyle=fighting_style,
        age=age,
        heightCm=height_cm,
        reachCm=reach_cm,
        wins=wins,
        losses=losses,
        draws=draws,
        fullBodyImageUrl=full_body_url,
        headshotImageUrl=headshot_url,
        careerStats=CareerRawStats(
            slpm=slpm,
            strAccPct=str_acc_pct,
            sapm=sapm,
            strDefPct=str_def_pct,
            tdAvg=td_avg,
            tdAccPct=td_acc_pct,
            tdDefPct=td_def_pct,
            subAvg=sub_avg,
            kdAvg=kd_avg,
            avgFightTimeMinutes=avg_fight_minutes,
            standingStrPct=standing_pct,
            clinchStrPct=clinch_pct,
            groundStrPct=ground_pct,
            koWinPct=ko_win_pct,
            decWinPct=dec_win_pct,
            subWinPct=sub_win_pct,
        ),
        bouts=all_bouts,
    )


def discover_ranked_slugs(client: httpx.Client, limit: int = 40) -> list[str]:
    """Fetch athlete slugs from ufc.com/rankings."""
    resp = client.get("https://www.ufc.com/rankings")
    if resp.status_code != 200:
        return DEFAULT_FEATURED_SLUGS[:limit]
    soup = BeautifulSoup(resp.text, "html.parser")
    slugs: list[str] = list(DEFAULT_FEATURED_SLUGS)
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/athlete/" in href:
            slug = href.rstrip("/").split("/")[-1]
            if slug and slug not in slugs:
                slugs.append(slug)
            if len(slugs) >= limit:
                break
    return slugs[:limit]


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape UFC athlete stats, cutouts, and fight histories.")
    parser.add_argument("--limit", type=int, default=24, help="Maximum number of fighters to scrape.")
    parser.add_argument(
        "--from-rankings",
        action="store_true",
        help="Include additional athletes from ufc.com/rankings.",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=3,
        help="Max fight history pagination pages per athlete.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "raw_ufcstats.json",
        help="Output path for raw scraped JSON.",
    )
    args = parser.parse_args()

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
    }
    profiles: list[RawFighterProfile] = []
    with httpx.Client(headers=headers, follow_redirects=True, timeout=20.0) as client:
        slugs = (
            discover_ranked_slugs(client, limit=args.limit)
            if args.from_rankings
            else DEFAULT_FEATURED_SLUGS[: args.limit]
        )
        print(f"[P1-1 Scraper] Scraping {len(slugs)} UFC fighters (pages={args.pages})...")
        for idx, slug in enumerate(slugs, start=1):
            try:
                profile = scrape_athlete_profile(client, slug, max_history_pages=args.pages)
                if profile:
                    profiles.append(profile)
                    print(
                        f"  [{idx:02d}/{len(slugs):02d}] {profile.name} ({profile.weightClass}, "
                        f"{profile.wins}-{profile.losses}-{profile.draws}) · "
                        f"bouts={len(profile.bouts)} · bodyPNG={'YES' if profile.fullBodyImageUrl else 'NO'}"
                    )
                else:
                    print(f"  [{idx:02d}/{len(slugs):02d}] Skipped {slug} (not found)")
            except Exception as exc:
                print(f"  [{idx:02d}/{len(slugs):02d}] Error scraping {slug}: {exc}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = [p.model_dump(mode="json") for p in profiles]
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[P1-1 Scraper] Saved {len(profiles)} fighters to {args.out}")


if __name__ == "__main__":
    main()
