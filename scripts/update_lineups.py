
#!/usr/bin/env python3
"""Build Hoist Official projected-lineup JSON from Daily Faceoff page HTML.

By default, parse a locally saved HTML file with --html. Network retrieval is
opt-in and should only be enabled after verifying permission for automated use.
"""

import argparse
import json
import os
import time
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
        raise ValueError(
            'Missing __NEXT_DATA__ script; page structure may have changed'
        )

    data = json.loads(''.join(parser.parts))
    combos = data['props']['pageProps']['combinations']

    if (
        not isinstance(combos.get('players'), list)
        or not combos.get('teamAbbreviation')
    ):
        raise ValueError('Invalid combinations data')

    return combos


def player_info(p):
    # Extract player-specific jersey artwork URL.
    jersey_url = p.get('jerseyUrl')

    if (
        not isinstance(jersey_url, str)
        or not jersey_url.startswith(
            'https://api.dailyfaceoff.com/uploads/player/jersey/'
        )
    ):
        jersey_url = None

    return {
        'name': p.get('name'),
        'number': p.get('jerseyNumber'),
        'position': (p.get('positionIdentifier') or '').upper(),
        'positionName': p.get('positionName'),
        'sourcePlayerId': p.get('playerId'),
        'jerseyUrl': jersey_url,
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

    # Daily Faceoff includes multiple entries per player
    # for different special teams units.
    def group(key, expected):
        values = groups.get(key, [])

        # FIX: Allow incomplete forward lines.
        # Any forward line can contain 2 or 3 players.
        # This prevents the entire team update from failing
        # when Daily Faceoff temporarily leaves one spot empty.
        minimum = 2 if key.startswith('f') else expected

        if not minimum <= len(values) <= expected:
            raise ValueError(
                f'{key}: expected {minimum}-{expected} players, '
                f'got {len(values)}'
            )

        if len(values) < expected:
            print(
                f'PARTIAL {c["teamAbbreviation"]} {key}: '
                f'{len(values)}/{expected} players',
                flush=True
            )

        return values

    return {
        'team': c['teamAbbreviation'],
        'teamName': c.get('teamName'),
        'source': 'Daily Faceoff',
        'sourceUpdatedAt': c.get('updatedAt'),
        'sourceDescription': c.get('sourceName'),
        'cachedAtUTC': datetime.now(timezone.utc).isoformat(),

        'forwards': [
            group(f'f{i}', 3)
            for i in range(1, 5)
        ],

        'defense': [
            group(f'd{i}', 2)
            for i in range(1, 4)
        ],

        'powerPlay': [
            group(f'pp{i}', 5)
            for i in range(1, 3)
        ],

        'penaltyKill': [
            group(f'pk{i}', 4)
            for i in range(1, 3)
        ],

        'goalies': group('g', 2),

        'injuries': [
            player_info(p)
            for p in c['players']
            if (
                p.get('injuryStatus')
                and p.get('categoryIdentifier') == 'oi'
            )
        ],
    }


TEAMS = {
    'ANA': 'anaheim-ducks',
    'BOS': 'boston-bruins',
    'BUF': 'buffalo-sabres',
    'CAR': 'carolina-hurricanes',
    'CBJ': 'columbus-blue-jackets',
    'CGY': 'calgary-flames',
    'CHI': 'chicago-blackhawks',
    'COL': 'colorado-avalanche',
    'DAL': 'dallas-stars',
    'DET': 'detroit-red-wings',
    'EDM': 'edmonton-oilers',
    'FLA': 'florida-panthers',
    'LAK': 'los-angeles-kings',
    'MIN': 'minnesota-wild',
    'MTL': 'montreal-canadiens',
    'NJD': 'new-jersey-devils',
    'NSH': 'nashville-predators',
    'NYI': 'new-york-islanders',
    'NYR': 'new-york-rangers',
    'OTT': 'ottawa-senators',
    'PHI': 'philadelphia-flyers',
    'PIT': 'pittsburgh-penguins',
    'SEA': 'seattle-kraken',
    'SJS': 'san-jose-sharks',
    'STL': 'st-louis-blues',
    'TBL': 'tampa-bay-lightning',
    'TOR': 'toronto-maple-leafs',
    'UTA': 'utah-mammoth',
    'VAN': 'vancouver-canucks',
    'VGK': 'vegas-golden-knights',
    'WPG': 'winnipeg-jets',
    'WSH': 'washington-capitals',
}


def save_result(result, output):
    output.parent.mkdir(parents=True, exist_ok=True)

    # Atomic replacement, never replace a valid file
    # with an invalid response.
    temp = output.with_suffix('.tmp')

    temp.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8'
    )

    temp.replace(output)


def update_teams(teams, delay):
    if os.environ.get('DAILY_FACEOFF_SCRAPING_ALLOWED') != '1':
        raise SystemExit(
            'Set DAILY_FACEOFF_SCRAPING_ALLOWED=1 only when authorized'
        )

    failures = []
    updated = 0

    for idx, team in enumerate(teams):
        if team not in TEAMS:
            raise ValueError(
                f'Unknown NHL team abbreviation: {team}'
            )

        url = (
            f'https://www.dailyfaceoff.com/teams/'
            f'{TEAMS[team]}/line-combinations'
        )

        try:
            req = Request(
                url,
                headers={
                    'User-Agent': (
                        'HoistOfficialLineups/1.0 '
                        '(+https://ealforque13.github.io/NHL/)'
                    ),
                    'Accept': 'text/html',
                }
            )

            with urlopen(req, timeout=30) as response:
                html = response.read().decode('utf-8')

            result = transform(parse_html(html))

            if result['team'].upper() != team:
                raise ValueError(
                    f'Team mismatch: requested {team}, '
                    f'received {result["team"]}'
                )

            dest = (
                ROOT
                / 'data'
                / 'projected-lineups'
                / f'{team}.json'
            )

            save_result(result, dest)

            updated += 1

            print(
                f'OK {team}: {result.get("sourceUpdatedAt")}',
                flush=True
            )

        except Exception as exc:
            failures.append(team)

            print(
                f'FAILED {team}: '
                f'{type(exc).__name__}: {exc}',
                flush=True
            )

        if idx + 1 < len(teams):
            time.sleep(max(0, delay))

    print(
        f'Lineup refresh complete: '
        f'{updated}/{len(teams)} updated; '
        f'failures: {", ".join(failures) or "none"}'
    )

    if failures:
        raise SystemExit(1)


def main():
    ap = argparse.ArgumentParser()

    ap.add_argument(
        '--html',
        help='Saved Daily Faceoff page HTML to parse without networking'
    )

    ap.add_argument(
        '--url',
        help='Daily Faceoff lineup page URL (requires explicit permission flag)'
    )

    ap.add_argument(
        '--output',
        help=(
            'Output path; defaults to '
            'data/projected-lineups/TEAM.json'
        )
    )

    ap.add_argument(
        '--all',
        action='store_true',
        help='Update all 32 NHL teams'
    )

    ap.add_argument(
        '--team',
        help='Update one NHL team by abbreviation, e.g. MTL'
    )

    ap.add_argument(
        '--delay',
        type=float,
        default=2.0,
        help='Seconds between team requests'
    )

    args = ap.parse_args()

    if args.all or args.team:
        update_teams(
            [args.team.upper()] if args.team else list(TEAMS),
            args.delay
        )
        return

    if args.html:
        html = Path(args.html).read_text(
            encoding='utf-8'
        )

    elif args.url:
        if os.environ.get('DAILY_FACEOFF_SCRAPING_ALLOWED') != '1':
            print(
                'Skipping: automated Daily Faceoff retrieval '
                'is not enabled.'
            )
            return

        if (
            not args.url.startswith(
                'https://www.dailyfaceoff.com/teams/'
            )
            or '/line-combinations' not in args.url
        ):
            raise ValueError(
                'Only Daily Faceoff team line-combinations '
                'URLs are supported'
            )

        request = Request(
            args.url,
            headers={
                'User-Agent': 'HoistOfficialLineups/1.0',
                'Accept': 'text/html'
            }
        )

        with urlopen(request, timeout=25) as response:
            html = response.read().decode('utf-8')

    else:
        print(
            'No HTML supplied. Use --html for an offline test; '
            'no lineup files changed.'
        )
        return

    result = transform(parse_html(html))

    destination = (
        Path(args.output)
        if args.output
        else (
            ROOT
            / 'data'
            / 'projected-lineups'
            / (result['team'] + '.json')
        )
    )

    save_result(result, destination)

    print(
        f"Saved {destination} ({result['team']})"
    )


if __name__ == '__main__':
    main()
