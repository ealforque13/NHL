"""Fetch permitted FanDuel Ontario data; stop on access errors. Python 3.12."""
import argparse, json, os, re, tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo
BASE='https://sbapi.on.sportsbook.fanduel.ca/api/'
TEAMS=dict(zip('Anaheim Ducks|Boston Bruins|Buffalo Sabres|Calgary Flames|Carolina Hurricanes|Chicago Blackhawks|Colorado Avalanche|Columbus Blue Jackets|Dallas Stars|Detroit Red Wings|Edmonton Oilers|Florida Panthers|Los Angeles Kings|Minnesota Wild|Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|New York Rangers|Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|St. Louis Blues|Tampa Bay Lightning|Toronto Maple Leafs|Utah Mammoth|Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets'.split('|'),'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG'.split()))
def fetch(endpoint, **params):
    params['_ak']=os.environ['FANDUEL_APP_KEY']
    with urlopen(BASE+endpoint+'?'+urlencode(params),timeout=30) as r: return json.load(r)
def events(doc):
    out={}
    for e in doc['attachments']['events'].values():
        names=e['name'].split(' @ ')
        if len(names)!=2 or any(n not in TEAMS for n in names) or e.get('inPlay'): continue
        dt=datetime.fromisoformat(e['openDate'].replace('Z','+00:00'))
        out[str(e['eventId'])]={'date':dt.astimezone(ZoneInfo('America/Toronto')).date().isoformat(),'away':TEAMS[names[0]],'home':TEAMS[names[1]],'start':dt.isoformat(),'prices':[]}
    return out
def extract(doc, games):
    for m in doc['attachments']['markets'].values():
        g=games.get(str(m['eventId'])); t=m['marketType']
        if not g or m.get('marketStatus')!='OPEN' or m.get('inPlay'): continue
        if t=='MONEY_LINE': kind,line='moneyline',1
        elif t=='ANY_TIME_GOAL_SCORER': kind,line='goals',1
        else:
            match=re.fullmatch(r'PLAYER_TO_(?:SCORE|RECORD)_(\d+)\+_(GOALS|POINTS|SHOTS_ON_GOAL)',t)
            if not match: continue
            line=int(match[1]); kind={'GOALS':'goals','POINTS':'points','SHOTS_ON_GOAL':'shots'}[match[2]]
        for r in m['runners']:
            odds=r.get('winRunnerOdds',{}).get('americanDisplayOdds',{}).get('americanOddsInt')
            if r.get('runnerStatus')!='ACTIVE' or not isinstance(odds,int) or abs(odds)<100: continue
            name=r['runnerName']; team=TEAMS.get(name) if kind=='moneyline' else None
            if kind=='moneyline' and not team: continue
            row={'market':kind,'line':line,'name':name,'team':team,'odds':odds}
            g['prices']=[p for p in g['prices'] if (p['market'],p['line'],p['name'])!=(kind,line,name)]; g['prices'].append(row)
def main():
    p=argparse.ArgumentParser();p.add_argument('--schedule');p.add_argument('--event',action='append',default=[]);p.add_argument('--output',default='data/odds.json');a=p.parse_args()
    offline=bool(a.schedule)
    doc=json.loads(Path(a.schedule).read_text()) if offline else fetch('content-managed-page',page='CUSTOM',customPageId='nhl',pbHorizontal='false',timezone='America/Toronto')
    games=events(doc);extract(doc,games)
    if offline:
        for f in a.event: extract(json.loads(Path(f).read_text()),games)
    else:
        for eid in games: extract(fetch('event-page',eventId=eid,tab='same-game-parlay-',useCombinedTouchdownsVirtualMarket='true',useQuickBets='true'),games)
    result={'source':'FanDuel Ontario','snapshot':offline,'updatedAt':None if offline else datetime.now(timezone.utc).isoformat(),'games':list(games.values())}
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,delete=False) as f: json.dump(result,f,ensure_ascii=False); temp=f.name
    os.replace(temp,path);print(len(games),'games;',sum(len(g['prices']) for g in games.values()),'prices')
if __name__=='__main__': main()
