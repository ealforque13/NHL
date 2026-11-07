'use strict';
/* NHL Central matchup intelligence: cached JSON only, no direct NHL API calls. */
(() => {
  const $m = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cache = new Map();
  let generation = 0;
  const isFinal = game => ['FINAL', 'OFF'].includes(game.gameState);
  const sum = (rows, key) => rows.reduce((n, row) => n + (Number(row[key]) || 0), 0);
  const picture = id => `https://assets.nhle.com/mugs/nhl/20262027/${encodeURIComponent(id)}.png`;

  async function load(code) {
    if (cache.has(code)) return cache.get(code);
    const response = await fetch(`./data/matchups/${encodeURIComponent(code)}.json`, {cache: 'no-cache'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.players)) throw Error('Invalid matchup data');
    cache.set(code, payload);
    return payload;
  }

  function leaderboard(payload, opponent, targetId) {
    const rows = payload.players.map(player => {
      const games = player.games.filter(game => game.opponent === opponent);
      return {player, gp: games.length, g: sum(games, 'goals'), a: sum(games, 'assists'), pts: sum(games, 'points')};
    }).filter(row => row.gp > 0).sort((a,b) => b.pts/a.gp - a.pts/b.gp || b.pts - a.pts || b.gp - a.gp).slice(0, 12);
    $m(targetId).innerHTML = rows.length ? rows.map(row => `<tr><td><span class="mi-person"><img src="${picture(row.player.id)}" alt="" loading="lazy" onerror="this.style.display='none'"><span><strong>${escape(row.player.name)}</strong><small>#${escape(row.player.number ?? '—')} · ${escape(row.player.position)}</small></span></span></td><td>${row.gp}</td><td>${row.g}</td><td>${row.a}</td><td><strong>${row.pts}</strong></td><td>${(row.pts/row.gp).toFixed(2)}</td></tr>`).join('') : '<tr><td colspan="6">No completed games against this opponent in the covered seasons.</td></tr>';
    return rows.length;
  }

  function hotPlayers(payload) {
    const rows = payload.players.map(player => {
      const recent = player.games.filter(game => game.season === '20262027').slice(-5);
      const pts = sum(recent, 'points');
      let streak = 0;
      for (let i = recent.length - 1; i >= 0 && recent[i].points > 0; i--) streak++;
      return {player, gp: recent.length, pts, g: sum(recent, 'goals'), a: sum(recent, 'assists'), streak};
    }).filter(row => row.gp).sort((a,b) => b.pts - a.pts || b.streak - a.streak || b.g - a.g).slice(0, 8);
    $m('mi-hot').innerHTML = rows.length ? rows.map(row => `<tr><td><span class="mi-person"><img src="${picture(row.player.id)}" alt="" loading="lazy" onerror="this.style.display='none'"><span><strong>${escape(row.player.name)}</strong><small>${row.streak ? `${row.streak}-game point streak` : 'No active point streak'}</small></span></span></td><td>${row.gp}</td><td>${row.g}</td><td>${row.a}</td><td><strong>${row.pts}</strong></td><td>${row.gp ? (row.pts/row.gp).toFixed(2) : '—'}</td></tr>`).join('') : '<tr><td colspan="6">No completed games available this season.</td></tr>';
  }

  async function update() {
    const token = ++generation;
    const selected = state.team;
    const next = [...state.schedule].filter(game => game.gameType === 2 && !isFinal(game)).sort((a,b) => a.gameDate.localeCompare(b.gameDate))[0];
    const opp = next && (next.homeTeam?.abbrev === selected ? next.awayTeam?.abbrev : next.homeTeam?.abbrev);
    $m('mi-title').textContent = opp ? `${team(selected).name} vs. ${team(opp).name}` : 'No upcoming regular-season matchup';
    $m('mi-left-title').textContent = `${team(selected).name} vs. opponent`;
    $m('mi-right-title').textContent = opp ? `${team(opp).name} vs. ${team(selected).name}` : 'Opponent production';
    for (const id of ['mi-left', 'mi-right', 'mi-hot']) $m(id).innerHTML = '<tr><td colspan="6">Loading cached player statistics…</td></tr>';
    $m('mi-note').textContent = 'Loading historical matchup data…';
    try {
      const [ours, theirs] = await Promise.allSettled([load(selected), opp ? load(opp) : Promise.resolve(null)]);
      if (token !== generation) return;
      if (ours.status === 'fulfilled') hotPlayers(ours.value);
      else $m('mi-hot').innerHTML = '<tr><td colspan="6">Player data unavailable. Run the matchup data workflow.</td></tr>';
      if (!opp) {
        $m('mi-left').innerHTML = $m('mi-right').innerHTML = '<tr><td colspan="6">No upcoming regular-season opponent found.</td></tr>';
      } else {
        if (ours.status === 'fulfilled') leaderboard(ours.value, opp, 'mi-left');
        else $m('mi-left').innerHTML = '<tr><td colspan="6">Matchup data unavailable.</td></tr>';
        if (theirs.status === 'fulfilled') leaderboard(theirs.value, selected, 'mi-right');
        else $m('mi-right').innerHTML = '<tr><td colspan="6">Opponent data unavailable.</td></tr>';
      }
      const partial = [ours, theirs].some(x => x.status === 'fulfilled' && x.value && !x.value.complete);
      $m('mi-note').textContent = `Regular-season games, 2024–25 through 2026–27 · Active roster skaters · Ranked by PTS/GP · ${partial ? 'Some player logs unavailable; rankings may be incomplete.' : 'Minimum 1 matchup game.'}`;
    } catch (error) {
      if (token === generation) $m('mi-note').textContent = `Unable to load matchup data: ${error.message}`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Observe original team's successful schedule render, without modifying original app.js.
    const original = renderGames;
    renderGames = function (...args) {
      const result = original.apply(this, args);
      update();
      return result;
    };
    update();
  });
})();
