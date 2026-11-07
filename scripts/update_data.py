#!/usr/bin/env python3
"""Fetch NHL data server-side for static GitHub Pages hosting."""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://api-web.nhle.com/v1'
SEASON = '20262027'
TEAMS = 'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG'.split()


def fetch(path):
    url = f'{BASE}/{path}'
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
            print(f'Retry {attempt + 1}/3: {path}: {exc}', flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Unable to fetch {path}: {last}')


def write(relative, payload):
    dest = ROOT / 'data' / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    tmp.replace(dest)


def main():
    failures = []
    success = 0
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
            write(destination, payload)
            success += 1
            print(f'OK {destination}', flush=True)
        except Exception as exc:
            failures.append(f'{destination}: {exc}')
            print(f'ERROR {failures[-1]}', file=sys.stderr, flush=True)
    write('metadata.json', {'lastAttemptUTC': datetime.now(timezone.utc).isoformat(), 'successfulRequests': success, 'totalRequests': len(endpoints), 'errors': failures})
    print(f'Finished: {success}/{len(endpoints)} requests successful', flush=True)
    if failures:
        print('Some data failed; existing JSON files were preserved where available.', file=sys.stderr)
    if success == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
