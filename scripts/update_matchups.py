
#!/usr/bin/env python3
"""
Build cached NHL player matchup production for GitHub Pages.

Regular-season games only.

Head to Head:
    Career regular-season matchup statistics.

Hot Players:
    Current-season game logs remain available.

Run AFTER update_data.py.
"""

import concurrent.futures
import json
import pathlib
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

API = "https://api-web.nhle.com/v1"

CURRENT_SEASON = "20262027"
FIRST_SEASON = 2005

TEAMS = """
ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA
LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS
SEA STL TBL TOR UTA VAN VGK WSH WPG
""".split()

MAX_WORKERS = 8


def fetch(path):
    url = f"{API}/{path}"

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NHLCentral/MatchupCache",
            "Accept": "application/json",
        },
    )

    for attempt in range(4):
        try:
            with urllib.request.urlopen(
                req,
                timeout=30,
            ) as response:
                return json.load(response)

        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise

            if attempt == 3:
                raise

        except (
            urllib.error.URLError,
            TimeoutError,
            ValueError,
            OSError,
        ):
            if attempt == 3:
                raise

        time.sleep(2 * (attempt + 1))


def read(path):
    with (DATA / path).open(
        encoding="utf-8"
    ) as handle:
        return json.load(handle)


def write(path, value):
    target = DATA / path

    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    tmp = target.with_suffix(".tmp")

    tmp.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ) + "\n",
        encoding="utf-8",
    )

    tmp.replace(target)


def localized(value):
    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        return value.get(
            "default",
            value.get("en", ""),
        )

    return ""


def season_id(year):
    return f"{year}{year + 1}"


def normalize_game(row, season):
    opponent = localized(
        row.get("opponentAbbrev")
        or row.get("opponentTeamAbbrev")
        or ""
    )

    if not opponent:
        return None

    return {
        "opponent": opponent,
        "date": row.get("gameDate", ""),
        "gameId": row.get("gameId"),
        "season": season,
        "goals": int(
            row.get("goals") or 0
        ),
        "assists": int(
            row.get("assists") or 0
        ),
        "points": int(
            row.get("points") or 0
        ),
    }


def get_player_seasons(player_id):
    """
    Retrieve the seasons actually played by
    this NHL player from their landing profile.
    """

    profile = fetch(
        f"player/{player_id}/landing"
    )

    seasons = set()

    for entry in profile.get(
        "seasonTotals",
        []
    ):
        if entry.get("gameTypeId") != 2:
            continue

        season = str(
            entry.get("season", "")
        )

        if (
            len(season) == 8
            and season.isdigit()
            and int(season[:4]) >= FIRST_SEASON
            and season <= CURRENT_SEASON
        ):
            seasons.add(season)

    return sorted(seasons)


def player_logs(player):
    player_id = player["id"]

    seasons = get_player_seasons(
        player_id
    )

    games = []
    failed_seasons = []

    for season in seasons:
        try:
            response = fetch(
                f"player/{player_id}/game-log/{season}/2"
            )

            rows = response.get(
                "gameLog",
                []
            )

            if not isinstance(rows, list):
                raise ValueError(
                    "Unexpected game-log response"
                )

            for row in rows:
                game = normalize_game(
                    row,
                    season,
                )

                if game:
                    games.append(game)

        except urllib.error.HTTPError as exc:
            failed_seasons.append(
                f"{season}: HTTP {exc.code}"
            )

        except Exception as exc:
            failed_seasons.append(
                f"{season}: {exc}"
            )

    games.sort(
        key=lambda game: (
            game["date"],
            str(game["gameId"]),
        )
    )

    return {
        "id": player_id,
        "name": player["name"],
        "number": player["number"],
        "position": player["position"],
        "headshot": player.get(
            "headshot"
        ),
        "games": games,
        "seasons": seasons,
        "failedSeasons": failed_seasons,
    }


def main():
    roster_players = {}

    for code in TEAMS:
        try:
            roster = read(
                f"rosters/{code}.json"
            )

            players = []

            for group in (
                "forwards",
                "defensemen",
            ):
                for player in roster.get(
                    group,
                    []
                ):
                    player_id = player.get(
                        "id"
                    )

                    if not player_id:
                        continue

                    name = (
                        localized(
                            player.get(
                                "firstName"
                            )
                        )
                        + " "
                        + localized(
                            player.get(
                                "lastName"
                            )
                        )
                    ).strip()

                    players.append({
                        "id": player_id,
                        "name": name,
                        "number": player.get(
                            "sweaterNumber"
                        ),
                        "position": player.get(
                            "positionCode",
                            "",
                        ),
                        "headshot": player.get(
                            "headshot"
                        ),
                    })

            roster_players[code] = players

        except (
            OSError,
            ValueError,
        ) as exc:
            print(
                f"Roster missing for {code}: {exc}",
                flush=True,
            )

    unique = {
        player["id"]: player
        for group in roster_players.values()
        for player in group
    }

    print(
        f"Fetching career regular-season "
        f"logs for {len(unique)} skaters...",
        flush=True,
    )

    results = {}
    failures = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as executor:

        tasks = {
            executor.submit(
                player_logs,
                player,
            ): player_id
            for player_id, player
            in unique.items()
        }

        for future in concurrent.futures.as_completed(
            tasks
        ):
            player_id = tasks[future]

            try:
                result = future.result()

                if result["failedSeasons"]:
                    failures.append(
                        str(player_id)
                    )

                    print(
                        f"Partial data for "
                        f"{player_id}: "
                        f"{result['failedSeasons']}",
                        flush=True,
                    )

                results[player_id] = result

            except Exception as exc:
                failures.append(
                    str(player_id)
                )

                print(
                    f"Player {player_id} "
                    f"unavailable: {exc}",
                    flush=True,
                )

    count = 0

    for code, players in roster_players.items():
        included = [
            results[player["id"]]
            for player in players
            if player["id"] in results
        ]

        if not included:
            print(
                f"Skipping {code}: "
                f"no usable player logs",
                flush=True,
            )
            continue

        # Do not overwrite an existing team file
        # if any of its players have missing seasons.

        incomplete = (
            len(included) != len(players)
            or any(
                player["failedSeasons"]
                for player in included
            )
        )

        if incomplete:
            print(
                f"Skipping {code}: "
                f"incomplete career data; "
                f"existing cache preserved",
                flush=True,
            )
            continue

        all_seasons = sorted({
            season
            for player in included
            for season in player["seasons"]
        })

        write(
            f"matchups/{code}.json",
            {
                "team": code,
                "seasons": all_seasons,
                "gameType": "regular season",
                "updatedUTC": datetime.now(
                    timezone.utc
                ).isoformat(),
                "players": included,
                "requestedPlayers": len(
                    players
                ),
                "complete": True,
            },
        )

        count += 1

        print(
            f"OK matchups/{code}.json "
            f"({len(included)} skaters, "
            f"{len(all_seasons)} seasons)",
            flush=True,
        )

    print(
        f"Matchup cache: "
        f"{count} team files written; "
        f"{len(failures)} players "
        f"with request failures",
        flush=True,
    )

    if count == 0:
        raise SystemExit(
            "No complete matchup data "
            "could be generated."
        )


if __name__ == "__main__":
    main()
