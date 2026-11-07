"""Build static regular-season NHL head-to-head cache for GitHub Pages."""
import json, os, time, urllib.request, urllib.error
from pathlib import Path

TEAMS = 'ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH'.split()
# Include 2017-18 onward; enough history for most pairings, including newer franchises.
FIRST_YEAR = 2017
CURRENT_YEAR = 2026
OUTPUT = Path('data/head-to-head.json')

def get_json(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'HoistOfficialCache/1.0','Accept':'application/json'})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            if attempt == 3:
                raise RuntimeError(f'{url}: {exc}') from exc
            time.sleep(2 ** attempt)

def main():
    existing = {}
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            pass
    games = dict(existing.get('games', {}))
    errors = []
    successes = 0
    # Query each season for each franchise, then deduplicate by NHL game ID.
    for team in TEAMS:
        for year in range(CURRENT_YEAR, FIRST_YEAR - 1, -1):
            season = f'{year}{year+1}'
            try:
                data = get_json(f'https://api-web.nhle.com/v1/club-schedule-season/{team}/{season}')
                successes += 1
                for g in data.get('games', []):
                    home, away = g.get('homeTeam') or {}, g.get('awayTeam') or {}
                    if g.get('gameType') != 2 or g.get('gameState') not in ('FINAL','OFF'):
                        continue
                    if not home.get('abbrev') or not away.get('abbrev'):
                        continue
                    if home.get('score') is None or away.get('score') is None:
                        continue
                    gid = str(g.get('id') or f"{g.get('gameDate')}-{home['abbrev']}-{away['abbrev']}")
                    games[gid] = {'id':gid, 'gameDate':g.get('gameDate'), 'gameType':2, 'gameState':'FINAL',
                                  'homeTeam':{'abbrev':home['abbrev'],'score':home['score']},
                                  'awayTeam':{'abbrev':away['abbrev'],'score':away['score']}}
            except Exception as exc:
                errors.append(f'{team} {season}: {exc}')
            time.sleep(.08)
    if not successes:
        raise SystemExit('No NHL schedules could be fetched; keeping existing cache untouched.')
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({'format':1,'seasons':f'{FIRST_YEAR}-{CURRENT_YEAR+1}', 'games':games}, separators=(',',':')),encoding='utf-8')
    print(f'Wrote {len(games)} unique regular-season games; {successes} schedules fetched; {len(errors)} failures')
    for e in errors[:20]: print('WARN',e)

if __name__ == '__main__': main()
