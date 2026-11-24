
"""Cache NHL organizational rosters, supplemented by PuckPedia."""

import json
import time
import re
import unicodedata
import urllib.request

from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup


SEASON = 20262027

TEAMS = (
    "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA "
    "LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS "
    "STL TBL TOR UTA VAN VGK WPG WSH"
).split()

SLUGS = dict(zip(TEAMS, (
    "anaheim-ducks boston-bruins buffalo-sabres "
    "carolina-hurricanes columbus-blue-jackets "
    "calgary-flames chicago-blackhawks colorado-avalanche "
    "dallas-stars detroit-red-wings edmonton-oilers "
    "florida-panthers los-angeles-kings minnesota-wild "
    "montreal-canadiens new-jersey-devils nashville-predators "
    "new-york-islanders new-york-rangers ottawa-senators "
    "philadelphia-flyers pittsburgh-penguins seattle-kraken "
    "san-jose-sharks st-louis-blues tampa-bay-lightning "
    "toronto-maple-leafs utah-mammoth vancouver-canucks "
    "vegas-golden-knights winnipeg-jets washington-capitals"
).split()))

ROOT = Path(__file__).resolve().parents[1] / "data" / "prospects"

BASE = "https://api-web.nhle.com/v1/"
PUCKPEDIA = "https://puckpedia.com"


def fetch(path):
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                BASE + path,
                headers={
                    "User-Agent": "HoistRosterCache/1.0",
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)

        except Exception:
            if attempt == 2:
                raise

            time.sleep(2 ** attempt)


def label(value):
    if isinstance(value, dict):
        return value.get("default", "")

    return str(value or "")


def name_key(name):
    return "".join(
        c for c in unicodedata.normalize(
            "NFKD", name.casefold()
        )
        if c.isalnum()
    )


def clean_name(name):
    name = " ".join(name.split())

    if "," in name:
        last, first = name.split(",", 1)
        name = f"{first.strip()} {last.strip()}"

    return name


def players(data):
    groups = [
        ("forwards", "F"),
        ("defensemen", "D"),
        ("goalies", "G")
    ]

    for group, position in groups:
        for player in data.get(group, []):
            name = (
                label(player.get("firstName")) + " " +
                label(player.get("lastName"))
            ).strip()

            if name and player.get("id"):
                yield {
                    "id": player["id"],
                    "name": name,
                    "position": player.get("positionCode") or position,
                    "headshot": player.get("headshot") or "",
                    "number": player.get("sweaterNumber") or ""
                }


def classify(player):
    player["organizationGroup"] = "Prospects"

    try:
        details = fetch(f"player/{player['id']}/landing")

        rows = [
            row for row in details.get("seasonTotals", [])
            if row.get("season") == SEASON
            and row.get("gameTypeId") == 2
        ]

        leagues = {
            label(row.get("leagueAbbrev")).upper()
            for row in rows
        }

        if leagues == {"AHL"}:
            player["organizationGroup"] = "AHL"

        if len(leagues) == 1 and rows:
            clubs = {
                label(row.get("teamName"))
                for row in rows
            } - {""}

            if len(clubs) == 1:
                player["currentClub"] = next(iter(clubs))

    except Exception as error:
        print(
            f"Player {player['id']} detail unavailable: {error}",
            flush=True
        )

    return player


def puckpedia_get(team):
    url = (
        f"{PUCKPEDIA}/team/"
        f"{SLUGS[team]}/depth-chart"
    )

    time.sleep(3)

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "HoistRosterCache/1.0",
            "Accept": "text/html"
        }
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def make_player(name, position, href, status):
    return {
        "id": None,
        "name": clean_name(name),
        "position": position,
        "headshot": "",
        "number": "",
        "organizationGroup": "Prospects",
        "source": "PuckPedia",
        "contractStatus": status,
        "profileUrl": PUCKPEDIA + href
    }


def parse_puckpedia(html):
    soup = BeautifulSoup(html, "html.parser")

    results = {}
    signed_count = 0
    unsigned_count = 0

    # Signed NHL and non-roster players.
    # Restrict extraction to roster tables to avoid
    # collecting players mentioned in trades or news.

    for table in soup.select("table.pp_table-roster"):
        for row in table.select("tr"):

            link = row.select_one(
                'a.pp_link[href^="/player/"]'
            )

            if not link:
                continue

            name = link.get_text(" ", strip=True)

            if not name:
                continue

            position = ""

            for span in row.select("span"):
                field = span.get_text(" ", strip=True).lower()

                if field == "pos":
                    value = span.find_next_sibling("span")

                    if value:
                        position = value.get_text(
                            " ", strip=True
                        ).upper()

                    break

                if field == "catches":
                    position = "G"

            position = position.replace(",", "/")

            player = make_player(
                name,
                position,
                link["href"],
                "Signed"
            )

            key = name_key(player["name"])

            if key not in results:
                signed_count += 1
                results[key] = player

    # Unsigned draft rights.
    # PuckPedia displays names as Lastname, Firstname
    # inside separate positional groups.

    heading = soup.find(
        string=lambda value: (
            value and
            value.strip() == "Unsigned Draft Choices"
        )
    )

    if heading:
        section = heading.parent.parent

        for group in section.select("div.text-sm2"):

            group_heading = group.find(
                "div", recursive=False
            )

            title = (
                group_heading.get_text(" ", strip=True).lower()
                if group_heading else ""
            )

            position = ""

            if "forward" in title:
                position = "F"

            elif "defen" in title:
                position = "D"

            elif "goaltend" in title or "goalie" in title:
                position = "G"

            for link in group.select(
                'a[href^="/player/"]'
            ):
                name_element = link.select_one(".pp_link")

                if not name_element:
                    continue

                name = name_element.get_text(
                    " ", strip=True
                )

                if not name:
                    continue

                player = make_player(
                    name,
                    position,
                    link["href"],
                    "Unsigned"
                )

                age_match = re.search(
                    r"\bage\s*(\d+)",
                    link.get_text(" ", strip=True),
                    re.IGNORECASE
                )

                if age_match:
                    player["age"] = int(age_match.group(1))

                key = name_key(player["name"])

                if key not in results:
                    unsigned_count += 1
                    results[key] = player

    # Reject unexpectedly empty or incomplete responses
    # so existing prospect caches are not overwritten.

    if signed_count < 15:
        raise ValueError(
            f"Incomplete PuckPedia roster: {signed_count} players"
        )

    if not heading:
        raise ValueError(
            "PuckPedia unsigned draft section not found"
        )

    print(
        f"PuckPedia: {signed_count} signed, "
        f"{unsigned_count} unsigned",
        flush=True
    )

    return list(results.values())


def main():
    ROOT.mkdir(parents=True, exist_ok=True)

    failures = []
    puckpedia_failures = []
    puckpedia_blocked = False

    with ThreadPoolExecutor(max_workers=5) as pool:

        for team in TEAMS:

            print(f"\nUpdating {team}...", flush=True)

            dest = ROOT / f"{team}.json"
            tmp = dest.with_suffix(".tmp")

            try:
                prior = []

                if dest.exists():
                    prior = json.loads(
                        dest.read_text(encoding="utf-8")
                    ).get("players", [])

                prior_by_name = {
                    name_key(p["name"]): p
                    for p in prior
                    if p.get("name")
                }

                # NHL roster remains the primary source.

                roster_data = fetch(f"roster/{team}/current")
                nhl = list(players(roster_data))

                if not nhl:
                    raise ValueError("Empty NHL roster")

                nhl_ids = {p["id"] for p in nhl}

                for player in nhl:
                    player["organizationGroup"] = "NHL"

                # NHL-listed prospects.

                prospects_ok = False
                prospects = []

                try:
                    data = fetch(f"prospects/{team}")

                    if not any(
                        isinstance(data.get(group), list)
                        for group in (
                            "forwards",
                            "defensemen",
                            "goalies"
                        )
                    ):
                        raise ValueError(
                            "Unexpected NHL prospects response"
                        )

                    prospects = list(
                        pool.map(
                            classify,
                            [
                                p for p in players(data)
                                if p["id"] not in nhl_ids
                            ]
                        )
                    )

                    prospects_ok = bool(prospects)

                except Exception as error:
                    print(
                        f"::warning::{team}: "
                        f"NHL prospects unavailable: {error}"
                    )

                merged = {
                    name_key(p["name"]): p
                    for p in nhl + prospects
                }

                # Supplement missing players from PuckPedia.

                puckpedia_ok = False

                if not puckpedia_blocked:

                    try:
                        rows = parse_puckpedia(
                            puckpedia_get(team)
                        )

                        for player in rows:

                            key = name_key(player["name"])

                            if key in merged:
                                # Preserve NHL information.
                                merged[key]["contractStatus"] = (
                                    player["contractStatus"]
                                )
                                merged[key]["profileUrl"] = (
                                    player["profileUrl"]
                                )

                                if not merged[key].get("position"):
                                    merged[key]["position"] = (
                                        player["position"]
                                    )

                                continue

                            # Recover previously known NHL IDs,
                            # headshots and club information.

                            old = prior_by_name.get(key, {})

                            for field in (
                                "id",
                                "headshot",
                                "number",
                                "currentClub"
                            ):
                                if old.get(field):
                                    player[field] = old[field]

                            if (
                                prospects_ok is False
                                and old.get("organizationGroup") == "AHL"
                            ):
                                player["organizationGroup"] = "AHL"

                            merged[key] = player

                        puckpedia_ok = True

                    except Exception as error:

                        print(
                            f"::warning::{team}: "
                            f"PuckPedia unavailable: {error}",
                            flush=True
                        )

                        if getattr(error, "code", None) in (
                            401, 403, 429
                        ):
                            puckpedia_blocked = True

                if not puckpedia_ok:
                    puckpedia_failures.append(team)

                    print(
                        f"::warning::{team}: "
                        "Preserving cached external prospects"
                    )

                # Protect previously cached players if a
                # data source is temporarily unavailable.

                for player in prior:

                    if not player.get("name"):
                        continue

                    if player.get("organizationGroup") == "NHL":
                        continue

                    external = player.get("source") in (
                        "Elite Prospects",
                        "PuckPedia"
                    )

                    if (
                        (external and not puckpedia_ok)
                        or (not external and not prospects_ok)
                    ):
                        merged.setdefault(
                            name_key(player["name"]),
                            player
                        )

                # Deduplicate by NHL ID where available.

                final_players = []
                seen_ids = set()

                for player in merged.values():

                    player_id = player.get("id")

                    if player_id:
                        if player_id in seen_ids:
                            continue

                        seen_ids.add(player_id)

                    final_players.append(player)

                final_players.sort(
                    key=lambda p: (
                        {
                            "NHL": 0,
                            "AHL": 1,
                            "Prospects": 2
                        }.get(p.get("organizationGroup"), 3),
                        p.get("name", "").casefold()
                    )
                )

                output = {
                    "team": team,
                    "updatedAt": datetime.now(
                        timezone.utc
                    ).isoformat(),
                    "players": final_players
                }

                tmp.write_text(
                    json.dumps(
                        output,
                        ensure_ascii=False,
                        indent=2
                    ),
                    encoding="utf-8"
                )

                tmp.replace(dest)

                counts = {
                    group: sum(
                        p.get("organizationGroup") == group
                        for p in final_players
                    )
                    for group in (
                        "NHL", "AHL", "Prospects"
                    )
                }

                print(
                    team,
                    "NHL", counts["NHL"],
                    "AHL", counts["AHL"],
                    "Prospects", counts["Prospects"],
                    "TOTAL", len(final_players),
                    "PuckPedia", "OK" if puckpedia_ok else "FAILED",
                    flush=True
                )

            except Exception as error:
                failures.append(team)

                print(
                    f"::warning::{team}: {error}",
                    flush=True
                )

    if failures:
        print(
            "::warning::Failed teams "
            "(prior caches preserved): "
            + ", ".join(failures)
        )

    if puckpedia_failures:
        print(
            "::warning::PuckPedia unavailable for: "
            + ", ".join(puckpedia_failures)
        )

    if len(failures) == len(TEAMS):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
