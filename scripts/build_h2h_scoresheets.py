"""Incrementally cache NHL gamecenter details for all recent head-to-head games.

Run after build_h2h.py has generated data/head-to-head.json.
Existing cached scoresheets are preserved between runs.
"""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

GAMES_FILE = Path('data/head-to-head.json')
OUT = Path('data/head-to-head-scoresheets.json')
MAX_NEW = max(0, int(os.environ.get('H2H_MAX_NEW', '800')))
WORKERS = max(1, min(8, int(os.environ.get('H2H_WORKERS', '5'))))


def get(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'HoistOfficial/1.0', 'Accept': 'application/json'},
            )
            with urllib.request.urlopen(req, timeout=22) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt * 2)


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
        raise SystemExit('Missing data/head-to-head.json. Run the history action first.')

    raw = json.loads(GAMES_FILE.read_text(encoding='utf-8'))
    game_data = raw.get('games', {})
    games = list(game_data.values()) if isinstance(game_data, dict) else list(game_data)
    if not games:
        raise SystemExit('Head-to-head history is empty.')

    existing = {}
    if OUT.exists():
        try:
            cached = json.loads(OUT.read_text(encoding='utf-8'))
            existing = cached.get('games', {})
            if not isinstance(existing, dict):
                raise ValueError('Cached games must be an object')
        except (ValueError, OSError) as error:
            raise SystemExit(f'Cannot read existing scoresheet cache: {error}')

    pairs = {}
    for game in games:
        away = (game.get('awayTeam') or {}).get('abbrev')
        home = (game.get('homeTeam') or {}).get('abbrev')
        gid = str(game.get('id', ''))
        if not away or not home or not gid.isdigit():
            continue
        pair = tuple(sorted((away, home)))
        pairs.setdefault(pair, []).append(game)

    # The most recent ten games for every pair, newest first.
    # Round-robin ordering gives all pairs their newest missing game before
    # fetching older games for any pair, rather than favoring Montreal.
    pair_games = {}
    for pair, items in pairs.items():
        recent = sorted(items, key=lambda g: (g.get('gameDate', ''), int(g['id'])), reverse=True)[:10]
        pair_games[pair] = [str(g['id']) for g in recent]

    wanted = set()
    for ids in pair_games.values():
        wanted.update(ids)

    missing = []
    seen = set()
