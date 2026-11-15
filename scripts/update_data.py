#!/usr/bin/env python3
"""Fetch NHL data server-side for static GitHub Pages hosting.

Adds EVP and PPP to cached club skater stats from NHL Stats REST skater/summary.
"""
import json
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
        'isAggregate': 'false',
        'isGame': 'false',
        'cayenneExp': f'seasonId={SEASON} and gameTypeId=2',
        'limit': '-1',
        'start': '0',
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
    write('metadata.json', {'lastAttemptUTC': datetime.now(timezone.utc).isoformat(), 'successfulRequests': success, 'totalRequests': len(endpoints) + 1, 'errors': failures})
    print(f'Finished: {success}/{len(endpoints)} standard requests successful', flush=True)
    if failures:
        print('Some data failed; existing JSON files were preserved where available.', file=sys.stderr)
    if success == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
