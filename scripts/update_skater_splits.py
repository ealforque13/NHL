import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

season = 20262027
rows = []
start = 0
while True:
    params = {'isAggregate':'false','isGame':'false','start':start,'limit':100,'sort':json.dumps([{'property':'playerId','direction':'ASC'}]),'cayenneExp':f'seasonId={season} and gameTypeId=2'}
    url = 'https://api.nhle.com/stats/rest/en/skater/summary?' + urlencode(params)
    with urlopen(Request(url, headers={'User-Agent':'HoistOfficial/1.0','Accept':'application/json'}), timeout=45) as response:
        payload = json.load(response)
    batch = payload['data']
    rows.extend(batch)
    start += len(batch)
    if start >= int(payload['total']): break
    if not batch: raise RuntimeError('Incomplete NHL response')
players = {}
for row in rows:
    if row.get('playerId') is None: continue
    record = {k:row[k] for k in ('gamesPlayed','points','evPoints','ppPoints','shPoints','evGoals') if isinstance(row.get(k),(int,float))}
    if 'evPoints' in record or 'ppPoints' in record:
        players[str(row['playerId'])] = record
if not players: raise RuntimeError('No strength-split statistics returned; preserving existing cache')
path = Path('data/skater-splits.json')
path.parent.mkdir(parents=True, exist_ok=True)
tmp = path.with_suffix('.tmp')
tmp.write_text(json.dumps({'season':season,'players':players}, separators=(',',':'))+'\n')
os.replace(tmp,path)
print(f'Updated strength splits for {len(players)} skaters')
