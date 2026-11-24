"""Cache NHL-listed prospects, with AHL classification from latest season records."""
import json, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
TEAMS='ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH'.split()
ROOT=Path(__file__).resolve().parents[1]/'data'/'prospects'
BASE='https://api-web.nhle.com/v1/'
def fetch(path):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE+path,headers={'User-Agent':'HoistRosterCache/1.0','Accept':'application/json'}),timeout=20) as r: return json.load(r)
        except Exception:
            if i==2: raise
            time.sleep(2**i)
def label(x): return x.get('default','') if isinstance(x,dict) else str(x or '')
def players(data):
    for group,pos in [('forwards','F'),('defensemen','D'),('goalies','G')]:
        for p in data.get(group,[]):
            name=(label(p.get('firstName'))+' '+label(p.get('lastName'))).strip()
            if name and p.get('id'): yield dict(id=p['id'],name=name,position=p.get('positionCode') or pos,headshot=p.get('headshot') or '',number=p.get('sweaterNumber') or '')
def classify(p):
    p['organizationGroup']='Prospects'
    try:
        d=fetch(f"player/{p['id']}/landing")
        rows=[r for r in d.get('seasonTotals',[]) if r.get('season')==20262027 and r.get('gameTypeId')==2]
        leagues={label(r.get('leagueAbbrev')).upper() for r in rows}
        if leagues=={'AHL'}:
            p['organizationGroup']='AHL'
        if len(leagues)==1 and rows:
            clubs={label(r.get('teamName')) for r in rows}-{''}
            if len(clubs)==1: p['currentClub']=next(iter(clubs))
    except Exception as e: print(f"Player {p['id']} detail unavailable: {e}")
    return p
def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    failures=[]
    with ThreadPoolExecutor(max_workers=5) as pool:
        for team in TEAMS:
            try:
                data=fetch('prospects/'+team)
                if not any(isinstance(data.get(k),list) for k in ('forwards','defensemen','goalies')): raise ValueError('Unexpected prospects response')
                roster=fetch('roster/'+team+'/current')
                nhl=list(players(roster)); ids={p['id'] for p in nhl}
                for p in nhl: p['organizationGroup']='NHL'
                prospects=list(pool.map(classify,[p for p in players(data) if p['id'] not in ids]))
                dest=ROOT/(team+'.json'); tmp=dest.with_suffix('.tmp')
                tmp.write_text(json.dumps({'team':team,'updatedAt':datetime.now(timezone.utc).isoformat(),'players':nhl+prospects},ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(dest)
                print(team,len(nhl),len(prospects),flush=True)
            except Exception as e: failures.append(team); print(team,e,flush=True)
    if failures: print('::warning::Failed teams (prior caches preserved): '+', '.join(failures))
    if len(failures)==len(TEAMS): raise SystemExit(1)
if __name__=='__main__': main()
