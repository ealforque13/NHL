#!/usr/bin/env python3
"""Refresh Hoist Official's NHL JSON and incrementally backfill H2H shots.

The existing data/matchups/*.json files are produced by a separate workflow/script.
This updater enriches those files in place; it does not create missing matchup histories.
Shot box scores are cached in data/shots-cache.json and reused on later runs.
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://api-web.nhle.com/v1'
STATS_BASE = 'https://api.nhle.com/stats/rest/en'
SEASON = '20262027'
TEAMS = 'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG'.split()
SHOTS_CACHE = ROOT / 'data' / 'shots-cache.json'
# Limit extra API calls per 15-minute GitHub Actions run; adjust via environment.
MAX_SHOT_REQUESTS = max(0, min(100, int(os.environ.get('MAX_SHOT_REQUESTS', '20'))))


def fetch_url(url):
    last = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={
                'User-Agent': 'NHLCentralDashboard/1.0 (GitHub Actions static data cache)',
                'Accept': 'application/json',
            })
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            last = exc
            print(f'Retry {attempt + 1}/3: {url}: {exc}', flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Unable to fetch {url}: {last}')


def fetch(path):
    return fetch_url(f'{BASE}/{path}')


def write(relative, payload):
    dest = ROOT / 'data' / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    tmp.replace(dest)


def fetch_special_teams():
    """Return verified per-player EVP/PPP; never substitute zero for missing fields."""
    params = urllib.parse.urlencode({
        'isAggregate': 'false', 'isGame': 'false',
        'cayenneExp': f'seasonId={SEASON} and gameTypeId=2',
        'limit': '-1', 'start': '0',
    })
    result = fetch_url(f'{STATS_BASE}/skater/summary?{params}')
    records = result.get('data')
    if not isinstance(records, list) or not records:
        raise ValueError('NHL Stats REST returned no skater summary records')
    stats = {}
    for player in records:
        pid = player.get('playerId')
        if pid is None:
            continue
        values = {}
        for output, candidates in (
            ('evenStrengthPoints', ('evPoints', 'evenStrengthPoints')),
            ('powerPlayPoints', ('ppPoints', 'powerPlayPoints')),
        ):
            for key in candidates:
                value = player.get(key)
                if value is not None and not isinstance(value, bool):
                    try:
                        number = int(value)
                        if number >= 0:
                            values[output] = number
                    except (TypeError, ValueError):
                        pass
                    break
        if values:
            stats[str(pid)] = values
    if not stats:
        raise ValueError('NHL Stats REST summary did not contain EVP or PPP fields')
    print(f'Loaded EVP/PPP breakdown for {len(stats)} skaters', flush=True)
    return stats


def enrich_club_stats(payload, special_teams):
    """Attach NHL Stats REST breakdown to the existing club-stats skater rows."""
    if not isinstance(payload, dict):
        return 0
    count = 0
    for group in ('skaters', 'forwards', 'defensemen'):
        players = payload.get(group)
        if not isinstance(players, list):
            continue
        for player in players:
            if not isinstance(player, dict):
                continue
            pid = player.get('playerId', player.get('id'))
            breakdown = special_teams.get(str(pid))
            if breakdown:
                player.update(breakdown)
                count += 1
    return count


def load_shots_cache():
    if not SHOTS_CACHE.is_file():
        return {}
    data = json.loads(SHOTS_CACHE.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError('shots-cache.json must be an object')
    return data


def boxscore_shots(boxscore):
    """Extract individual SOG by NHL player ID from the official game boxscore."""
    stats = boxscore.get('playerByGameStats', {})
    if not isinstance(stats, dict):
        raise ValueError('Boxscore missing playerByGameStats')
    shots = {}
    for side in ('awayTeam', 'homeTeam'):
        team = stats.get(side, {})
        for group in ('forwards', 'defense'):
            for player in team.get(group, []):
                pid, sog = player.get('playerId'), player.get('sog')
                if pid is not None and isinstance(sog, (int, float)) and not isinstance(sog, bool) and sog >= 0:
                    shots[str(pid)] = int(sog)
    if not shots:
        raise ValueError('No skater shot totals found in boxscore')
    return shots


def update_matchup_shots(failures):
    """Backfill the five most recent H2H games per player/opponent across all 32 teams.

    Existing shots are retained. Missing game boxscores are fetched incrementally,
    shared across teams, and persisted so later runs do not re-fetch them.
    """
    matchup_dir = ROOT / 'data' / 'matchups'
    paths = sorted(matchup_dir.glob('*.json')) if matchup_dir.is_dir() else []
    if not paths:
        print('Shots: no data/matchups/*.json found; existing updater does not generate them.', flush=True)
        return

    histories = []
    needed = {}  # gameId -> latest date; newest games get priority
    for path in paths:
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(payload.get('players'), list):
                raise ValueError('Missing players array')
            histories.append((path, payload))
            for player in payload['players']:
                groups = {}
                for game in player.get('games', []):
                    gid = game.get('gameId')
                    if gid is None:
                        continue
                    opponent = str(game.get('opponent', ''))
                    groups.setdefault(opponent, []).append(game)
                for games in groups.values():
                    for game in sorted(games, key=lambda g: str(g.get('date', '')), reverse=True)[:5]:
                        if game.get('shots') is not None or game.get('sog') is not None:
                            continue
                        gid = str(game['gameId'])
                        if gid.isdigit() and len(gid) == 10:
                            needed[gid] = max(needed.get(gid, ''), str(game.get('date', '')))
        except (ValueError, OSError, TypeError) as exc:
            failures.append(f'{path.relative_to(ROOT)}: {exc}')
            print(f'WARNING {failures[-1]}', file=sys.stderr, flush=True)

    cache = load_shots_cache()
    fetched = 0
    for gid in sorted(needed, key=lambda k: (needed[k], k), reverse=True):
        if gid in cache:
            continue
        if fetched >= MAX_SHOT_REQUESTS:
            break
        try:
            cache[gid] = boxscore_shots(fetch(f'gamecenter/{gid}/boxscore'))
            fetched += 1
            print(f'Shots boxscore OK {gid} ({len(cache[gid])} skaters)', flush=True)
        except Exception as exc:
            # Do not permanently cache errors; retry on next scheduled run.
            failures.append(f'shots boxscore {gid}: {exc}')
            print(f'WARNING {failures[-1]}', file=sys.stderr, flush=True)
            fetched += 1
        time.sleep(0.15)

    if fetched:
        write('shots-cache.json', cache)

    updated_files = updated_games = 0
    for path, payload in histories:
        changed = False
        for player in payload['players']:
            pid = str(player.get('id', player.get('playerId', '')))
            for game in player.get('games', []):
                if game.get('shots') is not None:
                    continue
                shots = cache.get(str(game.get('gameId')), {}).get(pid)
                if shots is not None:
                    game['shots'] = shots
                    updated_games += 1
                    changed = True
        if changed:
            # Preserve all existing keys and stats; only add per-game shots.
            write(f'matchups/{path.name}', payload)
            updated_files += 1
    remaining = sum(gid not in cache for gid in needed)
    print(f'Shots: {updated_games} player-games enriched in {updated_files} team files; '
          f'{len(cache)} cached games; {remaining} relevant games still to fetch.', flush=True)


def main():
    failures = []
    success = 0
    try:
        special_teams = fetch_special_teams()
    except Exception as exc:
        special_teams = {}
        failures.append(f'skater/summary EVP/PPP: {exc}')
        print(f'WARNING {failures[-1]}', file=sys.stderr, flush=True)
    endpoints = [('standings/now', 'standings.json'), ('skater-stats-leaders/current?categories=points,goals,assists&limit=20', 'leaders.json')]
    for code in TEAMS:
        endpoints.extend([
            (f'club-schedule-season/{code}/{SEASON}', f'schedules/{code}.json'),
            (f'roster/{code}/current', f'rosters/{code}.json'),
            (f'club-stats/{code}/{SEASON}/2', f'club-stats/{code}.json'),
        ])
    for path, destination in endpoints:
        try:
            payload = fetch(path)
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object')
            if destination == 'standings.json' and not isinstance(payload.get('standings'), list):
                raise ValueError('Missing standings array')
            if destination.startswith('schedules/') and not isinstance(payload.get('games'), list):
                raise ValueError('Missing games array')
            if destination.startswith('rosters/') and not any(k in payload for k in ('forwards', 'defensemen', 'goalies')):
                raise ValueError('Missing roster arrays')
            if destination.startswith('club-stats/') and special_teams:
                matched = enrich_club_stats(payload, special_teams)
                print(f'EVP/PPP enriched {destination}: {matched} skaters', flush=True)
            write(destination, payload)
            success += 1
            print(f'OK {destination}', flush=True)
        except Exception as exc:
            failures.append(f'{destination}: {exc}')
            print(f'ERROR {failures[-1]}', file=sys.stderr, flush=True)
    try:
        update_matchup_shots(failures)
    except Exception as exc:
        failures.append(f'H2H shots enrichment: {exc}')
        print(f'WARNING {failures[-1]}', file=sys.stderr, flush=True)
    write('metadata.json', {'lastAttemptUTC': datetime.now(timezone.utc).isoformat(), 'successfulRequests': success, 'totalRequests': len(endpoints) + 1, 'errors': failures})
    print(f'Finished: {success}/{len(endpoints)} standard requests successful', flush=True)
    if failures:
        print('Some data failed; existing JSON files were preserved where available.', file=sys.stderr)
    if success == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
