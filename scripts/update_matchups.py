#!/usr/bin/env python3
"""Build cached NHL matchup production for GitHub Pages.

Regular season only, current and two prior seasons. Uses active roster skaters.
Run AFTER update_data.py. Keeps old team files if any player requests fail.
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
SEASONS = ('20242025', '20252026', '20262027')
TEAMS = 'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG'.split()


def fetch(path):
    req = urllib.request.Request(f'{API}/{path}', headers={'User-Agent': 'NHLCentral/MatchupCache', 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt * 2)


def read(path):
    with (DATA / path).open(encoding='utf-8') as handle:
        return json.load(handle)


def write(path, value):
    target = DATA / path
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    tmp.replace(target)


def localized(value):
    return value if isinstance(value, str) else (value or {}).get('default', (value or {}).get('en', ''))


def normalize_game(row, season):
    opp = localized(row.get('opponentAbbrev') or row.get('opponentTeamAbbrev') or '')
    if not opp:
        return None
    return {
        'opponent': opp, 'date': row.get('gameDate', ''), 'gameId': row.get('gameId'),
        'season': season, 'goals': int(row.get('goals') or 0),
        'assists': int(row.get('assists') or 0),
        'points': int(row.get('points') or 0),
    }


def player_logs(player):
    pid = player['id']
    games = []
    for season in SEASONS:
        try:
            response = fetch(f'player/{pid}/game-log/{season}/2')
        except urllib.error.HTTPError as exc:
            if exc.code == 404:  # Player did not play in this season
                continue
            raise
        rows = response.get('gameLog', [])
        if not isinstance(rows, list):
            raise ValueError(f'Unexpected game-log shape for {pid}, {season}')
        for row in rows:
            game = normalize_game(row, season)
            if game:
                games.append(game)
    games.sort(key=lambda game: (game['date'], str(game['gameId'])))
    return {'id': pid, 'name': player['name'], 'number': player['number'],
            'position': player['position'], 'games': games}


def main():
    roster_players = {}
    for code in TEAMS:
        try:
            roster = read(f'rosters/{code}.json')
            players = []
            for group in ('forwards', 'defensemen'):
                for player in roster.get(group, []):
                    pid = player.get('id')
                    if not pid:
                        continue
                    players.append({'id': pid,
                                    'name': (localized(player.get('firstName')) + ' ' + localized(player.get('lastName'))).strip(),
                                    'number': player.get('sweaterNumber'),
                                    'position': player.get('positionCode', '')})
            roster_players[code] = players
        except (OSError, ValueError) as exc:
            print(f'Roster missing for {code}: {exc}', flush=True)

    unique = {p['id']: p for group in roster_players.values() for p in group}
    print(f'Fetching {len(unique)} active skaters across {len(SEASONS)} regular seasons...', flush=True)
    results = {}
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        tasks = {executor.submit(player_logs, p): pid for pid, p in unique.items()}
        for future in concurrent.futures.as_completed(tasks):
            pid = tasks[future]
            try:
                results[pid] = future.result()
            except Exception as exc:
                failures.append(f'{pid}: {exc}')
                print(f'Player {pid} unavailable: {exc}', flush=True)

    count = 0
    for code, players in roster_players.items():
        included = [results[p['id']] for p in players if p['id'] in results]
        if not included:
            print(f'Skipping {code}: no usable player logs; existing cache preserved', flush=True)
            continue
        write(f'matchups/{code}.json', {
            'team': code, 'seasons': list(SEASONS), 'gameType': 'regular season',
            'updatedUTC': datetime.now(timezone.utc).isoformat(),
            'players': included, 'requestedPlayers': len(players),
            'complete': len(included) == len(players)
        })
        count += 1
        print(f'OK matchups/{code}.json ({len(included)}/{len(players)} skaters)', flush=True)
    print(f'Matchup cache: {count} team files written; {len(failures)} player fetch failures', flush=True)
    if count == 0:
        raise SystemExit('No matchup data could be generated; check NHL API and roster files')


if __name__ == '__main__':
    main()
