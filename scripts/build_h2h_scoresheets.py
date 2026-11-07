"""Incrementally cache NHL gamecenter landing + boxscore for recent head-to-head games.
No browser requests to NHL API are needed. Re-run workflow to backfill more games.
"""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

GAMES_FILE = Path('data/head-to-head.json')
OUT = Path('data/head-to-head-scoresheets.json')
MAX_NEW = int(os.environ.get('H2H_MAX_NEW', '800'))


def get(url):
    for n in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HoistOfficial/1.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=22) as response:
                return json.load(response)
        except Exception:
            if n == 2:
                raise
            time.sleep(1 + n * 2)


def fetch_game(gid):
    base = f'https://api-web.nhle.com/v1/gamecenter/{gid}'
    landing = get(base + '/landing')
    boxscore = get(base + '/boxscore')
    return gid, {'landing': {
        'summary': landing.get('summary', {}),
        'periodDescriptor': landing.get('periodDescriptor', {}),
        'homeTeam': landing.get('homeTeam', {}),
        'awayTeam': landing.get('awayTeam', {}),
    }, 'boxscore': {
        'playerByGameStats': boxscore.get('playerByGameStats', {}),
        'homeTeam': boxscore.get('homeTeam', {}),
        'awayTeam': boxscore.get('awayTeam', {}),
    }}


def main():
    if not GAMES_FILE.exists():
        raise SystemExit('Missing data/head-to-head.json. Run the history action first.')
    raw = json.loads(GAMES_FILE.read_text(encoding='utf-8'))
    games = list(raw.get('games', {}).values())
    if not games:
        raise SystemExit('Head-to-head history is empty.')
    existing = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding='utf-8')).get('games', {})
        except (ValueError, OSError):
            pass
    # One game may belong to several pairings, but only needs one scoresheet.
    pairs = {}
    for g in games:
        a = (g.get('awayTeam') or {}).get('abbrev')
        h = (g.get('homeTeam') or {}).get('abbrev')
        if not a or not h or not str(g.get('id', '')).isdigit():
            continue
        pairs.setdefault(tuple(sorted((a, h))), []).append(g)
    # Prioritize Montreal and most recent matchups, then backfill the remaining pairs.
    wanted = {}
    for pair, items in pairs.items():
        for g in sorted(items, key=lambda x: x.get('gameDate', ''), reverse=True)[:10]:
            gid = str(g['id'])
            priority = (0 if 'MTL' in pair else 1, -int(g.get('gameDate', '0000')[:4] or 0))
            if gid not in wanted or priority < wanted[gid]:
                wanted[gid] = priority
    missing = [gid for gid in sorted(wanted, key=lambda k: (wanted[k], k), reverse=False) if gid not in existing][:MAX_NEW]
    print(f'{len(pairs)} pairs; {len(wanted)} unique games needed; {len(existing)} cached; fetching {len(missing)}')
    failed = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_game, gid): gid for gid in missing}
        for future in as_completed(futures):
            gid = futures[future]
            try:
                _, payload = future.result()
                existing[gid] = payload
            except Exception as e:
                failed.append((gid, str(e)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'format': 1, 'games': existing}, separators=(',', ':')), encoding='utf-8')
    print(f'Cached {len(existing)} game scoresheets; failed {len(failed)}')
    for gid, error in failed[:12]:
        print('WARN', gid, error)
    if missing and len(failed) == len(missing) and not existing:
        raise SystemExit('No gamecenter details could be fetched. Check NHL API availability.')


if __name__ == '__main__':
    main()
