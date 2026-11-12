
#!/usr/bin/env python3
"""Best-effort Daily Faceoff projected lineups cache.

Only run if automated access is permitted. No login, bypass, or protected API.
The parser is deliberately conservative: an incomplete page does not replace
existing JSON. HTML structure must be verified against live pages before use.
"""
import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEAMS = {
    'ANA':'anaheim-ducks','BOS':'boston-bruins','BUF':'buffalo-sabres',
    'CGY':'calgary-flames','CAR':'carolina-hurricanes','CHI':'chicago-blackhawks',
    'COL':'colorado-avalanche','CBJ':'columbus-blue-jackets','DAL':'dallas-stars',
    'DET':'detroit-red-wings','EDM':'edmonton-oilers','FLA':'florida-panthers',
    'LAK':'los-angeles-kings','MIN':'minnesota-wild','MTL':'montreal-canadiens',
    'NSH':'nashville-predators','NJD':'new-jersey-devils','NYI':'new-york-islanders',
    'NYR':'new-york-rangers','OTT':'ottawa-senators','PHI':'philadelphia-flyers',
    'PIT':'pittsburgh-penguins','SJS':'san-jose-sharks','SEA':'seattle-kraken',
    'STL':'st-louis-blues','TBL':'tampa-bay-lightning','TOR':'toronto-maple-leafs',
    'UTA':'utah-mammoth','VAN':'vancouver-canucks','VGK':'vegas-golden-knights',
    'WSH':'washington-capitals','WPG':'winnipeg-jets',
}
BASE = 'https://www.dailyfaceoff.com'
UA = 'HoistOfficialLineupCache/1.0 (public projected-lineups cache)'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept':'text/html'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode('utf-8', errors='replace')


def robots_allow(url):
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(BASE + '/robots.txt')
    parser.read()
    return parser.can_fetch(UA, url)


def roster(code):
    path = ROOT / 'data' / 'rosters' / f'{code}.json'
    payload = json.loads(path.read_text(encoding='utf-8'))
    people = {}
    for group in ('forwards', 'defensemen', 'goalies'):
        for p in payload.get(group, []):
            first = p.get('firstName', {})
            last = p.get('lastName', {})
            if isinstance(first, dict): first = first.get('default', '')
            if isinstance(last, dict): last = last.get('default', '')
            name = f'{first} {last}'.strip()
            if not name: continue
            people[name] = {'name':name, 'id':p.get('id'),
                            'number':p.get('sweaterNumber'),
                            'position':p.get('positionCode'),
                            'headshot':p.get('headshot', '')}
    return people


def extract_section(text, start, stops):
    m = re.search(start, text, flags=re.I)
    if not m: raise ValueError('Section not found: ' + start)
    section = text[m.end():]
    end = [hit.start() for pat in stops for hit in [re.search(pat, section, flags=re.I)] if hit]
    return section[:min(end)] if end else section


def names_in_section(section, people, limit):
    # Match whole names from the NHL roster in displayed order. Never infer lines.
    matches = []
    for name, person in people.items():
        pattern = r'(?<!\w)' + re.escape(name).replace(r'\ ', r'\s+') + r'(?!\w)'
        m = re.search(pattern, section, flags=re.I)
        if m: matches.append((m.start(), person))
    matches.sort(key=lambda item: item[0])
    result = [p for _, p in matches]
    if len(result) < limit:
        raise ValueError(f'Incomplete section: {len(result)} of {limit} names found')
    return result[:limit]


def parse(html, code, url):
    soup = BeautifulSoup(html, 'html.parser')
    for el in soup(['script','style','noscript']): el.decompose()
    text = soup.get_text(' ', strip=True)
    # Restrict to the first set of displayed lines, before cap summary / editorial.
    forwards = extract_section(text, r'\bForwards\b', [r'\bDefensive Pairings\b', r'\bDefense\b'])
    defense = extract_section(text, r'\bDefensive Pairings\b', [r'\bClick player jersey\b', r'\bCap Summary\b'])
    goalies = extract_section(text, r'\bGoalies\b', [r'\bClick player jersey\b', r'\bInjuries\b'])
    people = roster(code)
    f = names_in_section(forwards, people, 12)
    d = names_in_section(defense, people, 6)
    g = names_in_section(goalies, people, 2)
    return {'team':code,'type':'projected','status':'projected',
            'source':'Daily Faceoff','sourceUrl':url,
            'updatedAt':datetime.now(timezone.utc).isoformat(),
            'forwards':[f[i:i+3] for i in range(0,12,3)],
            'defense':[d[i:i+2] for i in range(0,6,2)],
            'goalies':[[g[0]],[g[1]]]}


def main():
    # Explicit opt-in until access rights and parser have been verified.
    if os.environ.get('DAILY_FACEOFF_SCRAPING_ALLOWED') != '1':
        print('Skipping: set DAILY_FACEOFF_SCRAPING_ALLOWED=1 only after confirming automated access is permitted.')
        return
    successes = 0
    for code, slug in TEAMS.items():
        url = f'{BASE}/teams/{slug}/line-combinations'
        try:
            if not robots_allow(url):
                print(f'SKIP {code}: robots.txt does not permit access')
                continue
            payload = parse(fetch(url), code, url)
            target = ROOT / 'data' / 'projected-lineups' / f'{code}.json'
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix('.tmp')
            tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',',':'))+'\n', encoding='utf-8')
            tmp.replace(target)
            successes += 1
            print(f'OK {code}')
        except Exception as exc:
            print(f'WARN {code}: {exc}; previous data preserved')
        time.sleep(1.5)
    print(f'Updated {successes}/{len(TEAMS)} projected lineups')


if __name__ == '__main__':
    main()
