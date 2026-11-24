"""Import a locally saved Elite Prospects In the System page into Hoist cache.
Requires beautifulsoup4. No network access or access-control bypass.
"""
import argparse, json, re, unicodedata
from pathlib import Path
from bs4 import BeautifulSoup

def key(name):
    return ''.join(c for c in unicodedata.normalize('NFKD',name.casefold()) if c.isalnum())

def parse_page(path):
    return parse_html(Path(path).read_text(encoding='utf-8'))

def parse_html(html):
    soup=BeautifulSoup(html,'html.parser')
    lines=soup.select('td.line-content')
    if lines: soup=BeautifulSoup('\n'.join(x.get_text() for x in lines),'html.parser')
    result={}
    for row in soup.select('table tr'):
        a=row.select_one('[data-stat="player"] a[href*="/player/"]')
        if not a: continue
        m=re.search(r'/player/(\d+)',a['href']); n=re.fullmatch(r'(.+?)\s*\(([^)]+)\)',a.get_text(' ',strip=True))
        if not m or not n: continue
        name,pos=n.groups(); pos=pos.split('/')[0].upper()
        if pos not in ('C','LW','RW','L','R','F','D','G'): continue
        def cell(stat):
            x=row.select_one(f'[data-stat="{stat}"]'); return x.get_text(' ',strip=True) if x else ''
        club,league=cell('team'),cell('league')
        if league.lower()=='totals': league=''
        p=dict(id='ep-'+m[1],name=name,position=pos,number='',headshot='',organizationGroup='AHL' if league=='AHL' else 'Prospects',currentClub=club,league=league,source='Elite Prospects')
        if m[1] not in result or (club and not result[m[1]]['currentClub']): result[m[1]]=p
    if not result: raise ValueError('No player rows found; cache unchanged')
    return list(result.values())

def main():
    a=argparse.ArgumentParser(); a.add_argument('team'); a.add_argument('html'); a.add_argument('--root',type=Path,default=Path('data/prospects')); args=a.parse_args()
    team=args.team.upper(); assert re.fullmatch('[A-Z]{3}',team)
    dest=args.root/(team+'.json'); data=json.loads(dest.read_text(encoding='utf-8')); assert data['team']==team
    rows=parse_page(args.html); existing={key(p['name']):p for p in data['players'] if p.get('source')!='Elite Prospects'}
    for p in rows:
        if key(p['name']) not in existing: existing[key(p['name'])]=p
    data['players']=list(existing.values()); tmp=dest.with_suffix('.tmp'); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(dest)
    print(team, len(rows),'source players;',len(existing),'merged players')
if __name__=='__main__': main()
