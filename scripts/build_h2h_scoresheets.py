
"""Incrementally cache NHL gamecenter scoresheets for the last 10 regular-season
meetings of every NHL team pairing.

Run after scripts/build_h2h.py. Preserves previously cached game details.
"""
import json
import os
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

GAMES_FILE = Path('data/head-to-head.json')
OUT = Path('data/head-to-head-scoresheets.json')
MAX_NEW = max(0, int(os.environ.get('H2H_MAX_NEW', '800')))
WORKERS = max(1, min(8, int(os.environ.get('H2H_WORKERS', '5'))))


def get(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'HoistOfficial/1.0',
                    'Accept': 'application/json'
                }
            )
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def fetch_game(gid):
    base = f'https://api-web.nhle.com/v1/gamecenter/{gid}'

    landing = get(base + '/landing')
    boxscore = get(base + '/boxscore')

    return gid, {
        'landing': {
            'summary': landing.get('summary', {}),
            'periodDescriptor': landing.get('periodDescriptor', {}),
            'homeTeam': landing.get('homeTeam', {}),
            'awayTeam': landing.get('awayTeam', {}),
        },
        'boxscore': {
            'playerByGameStats': boxscore.get('playerByGameStats', {}),
            'homeTeam': boxscore.get('homeTeam', {}),
            'awayTeam': boxscore.get('awayTeam', {}),
        },
    }


def main():
    if not GAMES_FILE.exists():
        raise SystemExit(
            'Missing data/head-to-head.json. Run history collector first.'
        )

    raw = json.loads(GAMES_FILE.read_text(encoding='utf-8'))
    game_data = raw.get('games', {})

    games = (
        list(game_data.values())
        if isinstance(game_data, dict)
        else list(game_data)
    )

    if not games:
        raise SystemExit('Head-to-head history is empty.')

    existing = {}

    if OUT.exists():
        cached = json.loads(OUT.read_text(encoding='utf-8'))
        existing = cached.get('games', {})

        if not isinstance(existing, dict):
            raise SystemExit(
                'Existing scoresheet cache has invalid games structure.'
            )

    # Group games by the two teams involved.
    pairs = {}

    for game in games:
        away = (game.get('awayTeam') or {}).get('abbrev')
        home = (game.get('homeTeam') or {}).get('abbrev')
        gid = str(game.get('id', ''))

        if (
            not away
            or not home
            or not gid.isdigit()
            or game.get('gameType') != 2
        ):
            continue

        pair = tuple(sorted((away, home)))
        pairs.setdefault(pair, []).append(game)

    # Find the 10 most recent games for every team pairing.
    pair_games = {}

    for pair, items in pairs.items():
        recent = sorted(
            items,
            key=lambda g: (
                g.get('gameDate') or '',
                int(g['id'])
            ),
            reverse=True,
        )[:10]

        pair_games[pair] = [str(g['id']) for g in recent]

    wanted = (
        set().union(*map(set, pair_games.values()))
        if pair_games
        else set()
    )

    missing = []
    seen = set()

    # Round-robin ordering:
    # Download the newest missing game for each pairing,
    # then the second newest, and so on.
    # This prevents Montreal or any other team from
    # receiving priority over the rest of the NHL.
    max_depth = max(
        (len(ids) for ids in pair_games.values()),
        default=0
    )

    for depth in range(max_depth):
        for pair in sorted(pair_games):
            ids = pair_games[pair]

            if depth < len(ids):
                gid = ids[depth]

                if gid not in existing and gid not in seen:
                    seen.add(gid)
                    missing.append(gid)

    selected = missing[:MAX_NEW]

    print(
        f'{len(pairs)} pairs; '
        f'{len(wanted)} unique games needed; '
        f'{len(existing)} cached; '
        f'{len(missing)} missing; '
        f'fetching {len(selected)}',
        flush=True,
    )

    failures = []
    fetched = 0

    # Download missing gamecenter details.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(fetch_game, gid): gid
            for gid in selected
        }

        for future in as_completed(futures):
            gid = futures[future]

            try:
                _, payload = future.result()
                existing[gid] = payload
                fetched += 1

            except Exception as exc:
                failures.append((gid, str(exc)))

    # Save all cached scoresheets, including older data.
    OUT.parent.mkdir(parents=True, exist_ok=True)

    OUT.write_text(
        json.dumps(
            {
                'format': 1,
                'games': existing
            },
            separators=(',', ':')
        ),
        encoding='utf-8',
    )

    remaining = sum(
        gid not in existing
        for gid in wanted
    )

    years = Counter(
        gid[:4]
        for gid in existing
        if gid.isdigit()
    )

    print(
        f'Fetched {fetched}; '
        f'failed {len(failures)}; '
        f'cached total {len(existing)}; '
        f'remaining {remaining}',
        flush=True,
    )

    print(
        'Cached game IDs by season start year:',
        dict(sorted(years.items())),
        flush=True
    )

    for gid, error in failures[:20]:
        print(
            f'WARN game {gid}: {error}',
            flush=True
        )

    if selected and not fetched:
        raise SystemExit(
            'All selected scoresheet requests failed; '
            'see WARN lines above.'
        )


if __name__ == '__main__':
    main()
