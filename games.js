
'use strict';

/* Hoist Official — Games: league matchups from existing cached team schedules. */
(() => {
  const codes = 'ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG'.split(' ');
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayFmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'});
  const longFmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const timeFmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',hour12:true});

  const today = () => {
    const parts=dayFmt.formatToParts(new Date());
    const get=key=>parts.find(p=>p.type===key)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };

  let games = [], loaded = false, loading = null;

  const teamCode = team => String(team?.abbrev || team?.triCode || team?.code || '').toUpperCase();

  const teamName = team => {
    const name=team?.name || team?.placeName?.default || team?.commonName?.default || team?.abbrev;
    return typeof name==='object' ? name.default || teamCode(team) : name || teamCode(team);
  };

  const gameDate = game => {
    // NHL club schedules provide gameDate in league-local date.
    return String(game.gameDate || '').slice(0,10);
  };

  const logo = team => team?.logo || `https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(teamCode(team))}_dark.svg`;

  const final = game => ['FINAL','OFF'].includes(String(game.gameState).toUpperCase());
  const live = game => ['LIVE','CRIT'].includes(String(game.gameState).toUpperCase());

  const period = game => {
    const n=game.periodDescriptor?.number || game.period;
    const type=game.periodDescriptor?.periodType;
    return type==='SO'?'SO':type==='OT'?'OT':n?`${n}${n===1?'st':n===2?'nd':n===3?'rd':'th'} period`:'Live';
  };

  function card(game){
    const away=game.awayTeam || {},home=game.homeTeam || {};
    const done=final(game),ongoing=live(game),showScores=done||ongoing;

    const status=done
      ? `Final${game.gameOutcome?.lastPeriodType==='OT'?' (OT)':game.gameOutcome?.lastPeriodType==='SO'?' (SO)':''}`
      : ongoing
        ? `${period(game)}${game.clock?.timeRemaining?' · '+game.clock.timeRemaining:''}`
        : game.gameState==='FUT'?'Scheduled':'Upcoming';

    const start=game.startTimeUTC
      ? timeFmt.format(new Date(game.startTimeUTC))+' ET'
      : 'Time TBD';

    const row=(team)=>`<div class="hoist-game-team">
      <img loading="lazy" src="${escape(logo(team))}" alt=""/>
      <span class="hoist-game-team-name">${escape(teamName(team))}</span>
      ${showScores?`<strong class="hoist-game-team-score">${escape(team.score ?? '–')}</strong>`:''}
    </div>`;

    return `<article class="hoist-game-card">
      <div class="hoist-game-card-head">
        <span>${escape(start)}</span>
        <span class="${ongoing?'hoist-game-live':''}">${escape(status)}</span>
      </div>
      ${row(away)}
      ${row(home)}
      <div class="hoist-game-card-foot">
        <span>${escape(teamCode(away))} @ ${escape(teamCode(home))}</span>
        <span>${done?'Completed':ongoing?'In progress':'NHL matchup'}</span>
      </div>
    </article>`;
  }

  function render(){
    const date=byId('hoist-games-date')?.value || today();
    const target=byId('hoist-games-grid'),status=byId('hoist-games-status');
    if(!target||!status)return;

    byId('hoist-games-day').textContent=longFmt.format(new Date(date+'T12:00:00-05:00'));

    if(!loaded){
      status.textContent='Loading cached NHL schedules…';
      target.innerHTML='';
      return;
    }

    const selected=games.filter(g=>gameDate(g)===date)
      .sort((a,b)=>String(a.startTimeUTC||'').localeCompare(String(b.startTimeUTC||'')));

    status.textContent=selected.length
      ? `${selected.length} ${selected.length===1?'game':'games'} scheduled`
      : 'No NHL games scheduled for this date.';

    target.innerHTML=selected.map(card).join('');
  }

  async function load(){
    if(loaded)return;
    if(loading)return loading;

    loading=(async()=>{
      const results=await Promise.allSettled(codes.map(async code=>{
        const response=await fetch(`./data/schedules/${code}.json`,{cache:'no-cache'});
        if(!response.ok)throw new Error(`${code}: HTTP ${response.status}`);

        const payload=await response.json();
        if(!Array.isArray(payload.games))throw new Error(`${code}: missing games`);

        return payload.games;
      }));

      const unique=new Map();

      for(const result of results){
        if(result.status!=='fulfilled')continue;

        for(const game of result.value){
          if(!game.id)continue;
          const old=unique.get(String(game.id));

          if(!old || (Object.keys(game).length>Object.keys(old).length)){
            unique.set(String(game.id),game);
          }
        }
      }

      games=[...unique.values()];
      loaded=true;

      const failures=results.filter(r=>r.status==='rejected').length;

      render();

      if(failures){
        byId('hoist-games-status').textContent+=
          ` · ${failures} team schedules unavailable; some games may be missing.`;
      }
    })().catch(error=>{
      byId('hoist-games-status').textContent=
        `Unable to load cached NHL schedules: ${error.message}`;
      loading=null;
    });

    return loading;
  }

  function shift(days){
    const input=byId('hoist-games-date');
    const date=new Date(`${input.value}T12:00:00Z`);

    date.setUTCDate(date.getUTCDate()+days);
    input.value=date.toISOString().slice(0,10);

    render();
  }

  function init(){
    const input=byId('hoist-games-date');
    if(!input)return;

    input.value=today();
    input.addEventListener('change',render);

    byId('hoist-games-prev').addEventListener('click',()=>shift(-1));
    byId('hoist-games-next').addEventListener('click',()=>shift(1));

    byId('hoist-games-today').addEventListener('click',()=>{
      input.value=today();
      render();
    });

    document.addEventListener('hoist:games-open',()=>{
      load();
      render();
    });

    if(!byId('games').classList.contains('hidden'))load();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init);
  }else{
    init();
  }
})();
