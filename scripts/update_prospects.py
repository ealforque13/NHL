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
# Discover team links from the public NHL league page, without guessing IDs.
from import_ep_prospects import parse_html
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
EP='https://www.eliteprospects.com'
SLUGS=dict(zip(TEAMS, 'anaheim-ducks boston-bruins buffalo-sabres carolina-hurricanes columbus-blue-jackets calgary-flames chicago-blackhawks colorado-avalanche dallas-stars detroit-red-wings edmonton-oilers florida-panthers los-angeles-kings minnesota-wild montreal-canadiens new-jersey-devils nashville-predators new-york-islanders new-york-rangers ottawa-senators philadelphia-flyers pittsburgh-penguins seattle-kraken san-jose-sharks st-louis-blues tampa-bay-lightning toronto-maple-leafs utah-mammoth vancouver-canucks vegas-golden-knights winnipeg-jets washington-capitals'.split()))
def ep_get(url):
    time.sleep(3)
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HoistRosterCache/1.0','Accept':'text/html'}),timeout=25) as r:
        return r.read().decode('utf-8')
def ep_links():
    links={'DET':EP+'/team/60/detroit-red-wings/in-the-system'}
    try:
        soup=BeautifulSoup(ep_get(EP+'/league/nhl'),'html.parser')
        reverse={v:k for k,v in SLUGS.items()}
        for a in soup.select('a[href]'):
            u=urljoin(EP,a['href']); parsed=urlparse(u)
            m=re.fullmatch(r'/team/(\d+)/([a-z0-9-]+)/?',parsed.path)
            if parsed.netloc=='www.eliteprospects.com' and m and m[2] in reverse:
                links[reverse[m[2]]]=EP+parsed.path.rstrip('/')+'/in-the-system'
    except Exception as e: print('::warning::EP discovery unavailable:',e)
    return links
def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    failures=[]
    links=ep_links()
    ep_blocked=False
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
                import unicodedata
                def key(p): return ''.join(c for c in unicodedata.normalize('NFKD',p['name'].casefold()) if c.isalnum())
                prior=json.loads(dest.read_text(encoding='utf-8')).get('players',[]) if dest.exists() else []
                merged={key(p):p for p in nhl+prospects}
                ep_ok=False
                if team in links and not ep_blocked:
                    try:
                        rows=parse_html(ep_get(links[team]))
                        for p in rows: merged.setdefault(key(p),p)
                        ep_ok=True
                        print(team, 'EP rows:',len(rows),flush=True)
                    except Exception as e:
                        print(f'::warning::{team}: EP unavailable: {e}')
                        if getattr(e,'code',None) in (401,403,429): ep_blocked=True
                else: print(f'::warning::{team}: EP link unavailable or access blocked')
                for p in prior:
                    if (not ep_ok and p.get('source')=='Elite Prospects') or (not ep_ok and not prospects and p.get('organizationGroup')!='NHL'):
                        merged.setdefault(key(p),p)
                if not prospects: print(f'::warning::{team}: NHL prospects empty; preserving cached prospects')
                prospects=[p for p in merged.values() if p.get('organizationGroup')!='NHL']
                tmp.write_text(json.dumps({'team':team,'updatedAt':datetime.now(timezone.utc).isoformat(),'players':nhl+prospects},ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(dest)
                print(team, 'NHL',len(nhl),'AHL',sum(p.get('organizationGroup')=='AHL' for p in prospects),'Prospects',sum(p.get('organizationGroup')=='Prospects' for p in prospects),flush=True)
            except Exception as e: failures.append(team); print(team,e,flush=True)
    if failures: print('::warning::Failed teams (prior caches preserved): '+', '.join(failures))
    if len(failures)==len(TEAMS): raise SystemExit(1)
if __name__=='__main__': main()
