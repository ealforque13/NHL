#!/usr/bin/env python3
"""Build Hoist Official projected-lineup JSON from Daily Faceoff page HTML.

By default, parse a locally saved HTML file with --html. Network retrieval is
opt-in and should only be enabled after verifying permission for automated use.
"""
import argparse
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]

class NextDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.capture = False
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == '__NEXT_DATA__':
            self.capture = True
    def handle_endtag(self, tag):
        if tag == 'script' and self.capture:
            self.capture = False
    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

def parse_html(html):
    parser = NextDataParser()
    parser.feed(html)
    if not parser.parts:
        raise ValueError('Missing __NEXT_DATA__ script; page structure may have changed')
    data = json.loads(''.join(parser.parts))
    combos = data['props']['pageProps']['combinations']
    if not isinstance(combos.get('players'), list) or not combos.get('teamAbbreviation'):
        raise ValueError('Invalid combinations data')
    return combos

def player_info(p):
    return {
        'name': p.get('name'), 'number': p.get('jerseyNumber'),
        'position': (p.get('positionIdentifier') or '').upper(),
        'sourcePlayerId': p.get('playerId'),
        'injuryStatus': p.get('injuryStatus'),
        'gameTimeDecision': bool(p.get('gameTimeDecision')),
    }

def transform(c):
    groups = {}
    for p in c['players']:
        gid = p.get('groupIdentifier')
        if not gid or not p.get('name'):
            continue
        groups.setdefault(gid, []).append(player_info(p))
    # DFO includes multiple entries per player for different special teams units.
    def group(key, expected):
        values = groups.get(key, [])
        if len(values) != expected:
            raise ValueError(f'{key}: expected {expected} players, got {len(values)}')
        return values
    return {
        'team': c['teamAbbreviation'],
        'teamName': c.get('teamName'),
        'source': 'Daily Faceoff',
        'sourceUpdatedAt': c.get('updatedAt'),
        'sourceDescription': c.get('sourceName'),
        'cachedAtUTC': datetime.now(timezone.utc).isoformat(),
        'forwards': [group(f'f{i}', 3) for i in range(1, 5)],
        'defense': [group(f'd{i}', 2) for i in range(1, 4)],
        'powerPlay': [group(f'pp{i}', 5) for i in range(1, 3)],
        'penaltyKill': [group(f'pk{i}', 4) for i in range(1, 3)],
        'goalies': group('g', 2),
        'injuries': [player_info(p) for p in c['players'] if p.get('injuryStatus') and p.get('categoryIdentifier') == 'oi'],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', help='Saved Daily Faceoff page HTML to parse without networking')
    ap.add_argument('--url', help='Daily Faceoff lineup page URL (requires explicit permission flag)')
    ap.add_argument('--output', help='Output path; defaults to data/projected-lineups/TEAM.json')
    args = ap.parse_args()
    if args.html:
        html = Path(args.html).read_text(encoding='utf-8')
    elif args.url:
        if os.environ.get('DAILY_FACEOFF_SCRAPING_ALLOWED') != '1':
            print('Skipping: automated Daily Faceoff retrieval is not enabled.')
            return
        if not args.url.startswith('https://www.dailyfaceoff.com/teams/') or '/line-combinations' not in args.url:
            raise ValueError('Only Daily Faceoff team line-combinations URLs are supported')
        request = Request(args.url, headers={'User-Agent': 'HoistOfficialLineups/1.0', 'Accept': 'text/html'})
        with urlopen(request, timeout=25) as response:
            html = response.read().decode('utf-8')
    else:
        print('No HTML supplied. Use --html for an offline test; no lineup files changed.')
        return
    result = transform(parse_html(html))
    destination = Path(args.output) if args.output else ROOT / 'data' / 'projected-lineups' / (result['team'] + '.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(destination)
    print(f"Saved {destination} ({result['team']})")

if __name__ == '__main__':
    main()
