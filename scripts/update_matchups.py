
#!/usr/bin/env python3
"""Build cached NHL matchup production for GitHub Pages.

Regular season only, 2010–11 through 2026–27.
Uses active roster skaters.

Run AFTER update_data.py.

Features:
- Extended historical player game logs
- Keeps the existing matchup JSON structure
- Preserves historical team and home/away information
- Reuses previously cached player-season logs
- Keeps existing team files if no player requests succeed
- Compatible with Head-to-Head Player Statistics and
  expandable five-game histories
"""

import concurrent.futures
import json
import pathlib
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
API = 'https://api-web.nhle.com/v1'

SEASONS = tuple(
    f'{year}{year + 1}'
    for year in range(2010, 2027)
)

CURRENT_SEASON = '20262027'

TEAMS = (
    'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA '
    'LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS '
    'SEA STL TBL TOR UTA VAN VGK WSH WPG'
).split()

PLAYER_CACHE = DATA / 'matchup-player-seasons'


def fetch(path):
    req = urllib.request.Request(
        f'{API}/{path}',
        headers={
            'User-Agent': 'NHLCentral/MatchupCache',
            'Accept': 'application/json'
        }
    )

    for attempt in range(3):
        try:
            with urllib.request.urlopen(
                req,
                timeout=25
            ) as response:
                return json.load(response)

        except (
            urllib.error.URLError,
            TimeoutError,
            ValueError,
            OSError
        ):
            if attempt == 2:
                raise

            time.sleep(1 + attempt * 2)


def read(path):
    with (DATA / path).open(
        encoding='utf-8'
    ) as handle:
        return json.load(handle)


def write(path, value):
    target = DATA / path

    target.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    tmp = target.with_suffix('.tmp')

    tmp.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(',', ':')
        ) + '\n',
        encoding='utf-8'
    )

    tmp.replace(target)


def localized(value):
    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        return value.get(
            'default',
            value.get('en', '')
        )

    return ''


def normalize_game(row, season):
    opp = localized(
        row.get('opponentAbbrev')
        or row.get('opponentTeamAbbrev')
        or ''
    )

    if not opp:
        return None

    return {
        'opponent': opp,
        'date': row.get('gameDate', ''),
        'gameId': row.get('gameId'),
        'homeRoadFlag': (
            row.get('homeRoadFlag')
            or row.get('homeAway')
            or ''
        ),
        'team': localized(
            row.get('teamAbbrev')
            or row.get('teamName')
            or ''
        ),
        'season': season,
        'goals': int(row.get('goals') or 0),
        'assists': int(row.get('assists') or 0),
        'points': int(row.get('points') or 0),
    }


def season_cache_path(pid, season):
    return (
        PLAYER_CACHE
        / str(pid)
        / f'{season}.json'
    )


def load_cached_season(pid, season):
    path = season_cache_path(pid, season)

    if not path.exists():
        return None

    try:
        with path.open(
            encoding='utf-8'
        ) as handle:
            payload = json.load(handle)

        if isinstance(payload, list):
            return payload

    except (
        OSError,
        ValueError,
        TypeError
    ):
        pass

    return None


def save_cached_season(pid, season, games):
    path = season_cache_path(pid, season)

    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    tmp = path.with_suffix('.tmp')

    tmp.write_text(
        json.dumps(
            games,
            ensure_ascii=False,
            separators=(',', ':')
        ) + '\n',
        encoding='utf-8'
    )

    tmp.replace(path)


def fetch_player_season(pid, season):
    cached = load_cached_season(
        pid,
        season
    )

    # Historical seasons do not change.
    # Reuse cached logs whenever available.
    if (
        cached is not None
        and season != CURRENT_SEASON
    ):
        return cached

    try:
        response = fetch(
            f'player/{pid}/game-log/{season}/2'
        )

    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            save_cached_season(
                pid,
                season,
                []
            )
            return []

        # Preserve previously cached data if
        # the current-season refresh fails.
        if cached is not None:
            return cached

        raise

    except Exception:
        if cached is not None:
            return cached

        raise

    rows = response.get(
        'gameLog',
        []
    )

    if not isinstance(rows, list):
        raise ValueError(
            f'Unexpected game-log shape '
            f'for {pid}, {season}'
        )

    games = []

    for row in rows:
        game = normalize_game(
            row,
            season
        )

        if game:
            games.append(game)

    save_cached_season(
        pid,
        season,
        games
    )

    return games


def player_logs(player):
    pid = player['id']
    games = []

    for season in SEASONS:
        season_games = fetch_player_season(
            pid,
            season
        )

        games.extend(season_games)

    # Ensure newest games appear last.
    games.sort(
        key=lambda game: (
            game.get('date', ''),
            str(game.get('gameId', ''))
        )
    )

    return {
        'id': pid,
        'name': player['name'],
        'number': player['number'],
        'position': player['position'],
        'headshot': player.get('headshot'),
        'games': games
    }


def main():
    roster_players = {}

    for code in TEAMS:
        try:
            roster = read(
                f'rosters/{code}.json'
            )

            players = []

            for group in (
                'forwards',
                'defensemen'
            ):
                for player in roster.get(
                    group,
                    []
                ):
                    pid = player.get('id')

                    if not pid:
                        continue

                    players.append({
                        'id': pid,
                        'name': (
                            localized(
                                player.get('firstName')
                            )
                            + ' '
                            + localized(
                                player.get('lastName')
                            )
                        ).strip(),
                        'number': player.get(
                            'sweaterNumber'
                        ),
                        'position': player.get(
                            'positionCode',
                            ''
                        ),
                        'headshot': player.get(
                            'headshot'
                        )
                    })

            roster_players[code] = players

        except (
            OSError,
            ValueError
        ) as exc:
            print(
                f'Roster missing for '
                f'{code}: {exc}',
                flush=True
            )

    unique = {
        player['id']: player
        for group in roster_players.values()
        for player in group
    }

    print(
        f'Fetching {len(unique)} active '
        f'skaters across {len(SEASONS)} '
        f'regular seasons...',
        flush=True
    )

    results = {}
    failures = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=12
    ) as executor:

        tasks = {
            executor.submit(
                player_logs,
                player
            ): pid
            for pid, player in unique.items()
        }

        for future in concurrent.futures.as_completed(
            tasks
        ):
            pid = tasks[future]

            try:
                results[pid] = future.result()

            except Exception as exc:
                failures.append(
                    f'{pid}: {exc}'
                )

                print(
                    f'Player {pid} unavailable: '
                    f'{exc}',
                    flush=True
                )

    count = 0

    for code, players in roster_players.items():
        included = [
            results[player['id']]
            for player in players
            if player['id'] in results
        ]

        if not included:
            print(
                f'Skipping {code}: no usable '
                f'player logs; existing '
                f'cache preserved',
                flush=True
            )
            continue

        write(
            f'matchups/{code}.json',
            {
                'team': code,
                'seasons': list(SEASONS),
                'gameType': 'regular season',
                'updatedUTC': datetime.now(
                    timezone.utc
                ).isoformat(),
                'players': included,
                'requestedPlayers': len(players),
                'complete': (
                    len(included) == len(players)
                )
            }
        )

        count += 1

        print(
            f'OK matchups/{code}.json '
            f'({len(included)}/{len(players)} '
            f'skaters)',
            flush=True
        )

    print(
        f'Matchup cache: {count} team '
        f'files written; '
        f'{len(failures)} player '
        f'fetch failures',
        flush=True
    )

    if count == 0:
        raise SystemExit(
            'No matchup data could be '
            'generated; check NHL API '
            'and roster files'
        )


if __name__ == '__main__':
    main()
