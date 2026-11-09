
'use strict';

const SEASON = '20262027';

const TEAMS = [
  ['ANA','Anaheim Ducks','Pacific','Western'],
  ['BOS','Boston Bruins','Atlantic','Eastern'],
  ['BUF','Buffalo Sabres','Atlantic','Eastern'],
  ['CGY','Calgary Flames','Pacific','Western'],
  ['CAR','Carolina Hurricanes','Metropolitan','Eastern'],
  ['CHI','Chicago Blackhawks','Central','Western'],
  ['COL','Colorado Avalanche','Central','Western'],
  ['CBJ','Columbus Blue Jackets','Metropolitan','Eastern'],
  ['DAL','Dallas Stars','Central','Western'],
  ['DET','Detroit Red Wings','Atlantic','Eastern'],
  ['EDM','Edmonton Oilers','Pacific','Western'],
  ['FLA','Florida Panthers','Atlantic','Eastern'],
  ['LAK','Los Angeles Kings','Pacific','Western'],
  ['MIN','Minnesota Wild','Central','Western'],
  ['MTL','Montreal Canadiens','Atlantic','Eastern'],
  ['NSH','Nashville Predators','Central','Western'],
  ['NJD','New Jersey Devils','Metropolitan','Eastern'],
  ['NYI','New York Islanders','Metropolitan','Eastern'],
  ['NYR','New York Rangers','Metropolitan','Eastern'],
  ['OTT','Ottawa Senators','Atlantic','Eastern'],
  ['PHI','Philadelphia Flyers','Metropolitan','Eastern'],
  ['PIT','Pittsburgh Penguins','Metropolitan','Eastern'],
  ['SJS','San Jose Sharks','Pacific','Western'],
  ['SEA','Seattle Kraken','Pacific','Western'],
  ['STL','St. Louis Blues','Central','Western'],
  ['TBL','Tampa Bay Lightning','Atlantic','Eastern'],
  ['TOR','Toronto Maple Leafs','Atlantic','Eastern'],
  ['UTA','Utah Mammoth','Central','Western'],
  ['VAN','Vancouver Canucks','Pacific','Western'],
  ['VGK','Vegas Golden Knights','Pacific','Western'],
  ['WSH','Washington Capitals','Metropolitan','Eastern'],
  ['WPG','Winnipeg Jets','Central','Western']
].map(([code, name, division, conference]) => ({
  code,
  name,
  division,
  conference
}));

const $ = id => document.getElementById(id);

const state = {
  team: localStorage.getItem('nhl-central-team') || 'MTL',
  tab: 'overview',
  schedule: [],
  standings: [],
  roster: [],
  request: 0
};

const base = './data';

const team = code =>
  TEAMS.find(t => t.code === code) || TEAMS[14];

const logo = code =>
  `https://assets.nhle.com/logos/nhl/svg/${code}_light.svg`;

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const localName = obj =>
  typeof obj === 'string'
    ? obj
    : (obj?.default || obj?.en || '');

const fmtDate = (
  s,
  opts = {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }
) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('en-CA', opts);

const get = async path => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const r = await fetch(`${base}/${path}`, {
      signal: ctrl.signal,
      cache: 'no-cache'
    });

    if (!r.ok) {
      throw Error(
        `Data file ${path} returned ${r.status}. ` +
        'Run the Update NHL data GitHub Action first.'
      );
    }

    return await r.json();
  } finally {
    clearTimeout(timer);
  }
};

/* ==========================================
   STATUS & MESSAGES
   ========================================== */

function setStatus(msg) {
  $('data-status').textContent = msg;
}

function message(msg) {
  $('error').textContent = msg;
  $('error').classList.remove('hidden');
}

function clearMessage() {
  $('error').classList.add('hidden');
}

/* ==========================================
   INITIAL SETUP
   ========================================== */

function setup() {
  const options = TEAMS.map(
    t => `<option value="${t.code}">${t.name}</option>`
  ).join('');

  ['team-select', 'compare-a', 'compare-b'].forEach(id => {
    $(id).innerHTML = options;
  });

  if (!TEAMS.some(t => t.code === state.team)) {
    state.team = 'MTL';
  }

  $('team-select').value = state.team;
  $('compare-a').value = 'MTL';
  $('compare-b').value = 'TOR';

  $('team-select').addEventListener('change', e => {
    state.team = e.target.value;

    localStorage.setItem(
      'nhl-central-team',
      state.team
    );

    loadTeam();
  });

  document.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      switchTab(b.dataset.tab);
    });
  });

  document.querySelectorAll('[data-go]').forEach(b => {
    b.addEventListener('click', () => {
      switchTab(b.dataset.go);
    });
  });

  $('refresh').addEventListener('click', () => loadAll());

  $('schedule-filter').addEventListener(
    'change',
    renderSchedule
  );

  // FIX: The legacy Standings dropdown may no longer exist.
  // The new Standings buttons are managed separately.
  $('standings-filter')?.addEventListener(
    'change',
    renderStandings
  );

  $('compare-a').addEventListener(
    'change',
    renderCompare
  );

  $('compare-b').addEventListener(
    'change',
    renderCompare
  );

  loadAll();
}

/* ==========================================
   NAVIGATION
   ========================================== */

function switchTab(tab) {
  state.tab = tab;

  document.querySelectorAll('.tab-section').forEach(s => {
    s.classList.toggle('hidden', s.id !== tab);
  });

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  $('page-title').textContent = ({
    overview: 'Team Overview',
    schedule: 'Season Schedule',
    roster: 'Roster & Leaders',
    standings: 'NHL Standings',
    compare: 'Compare Teams',
    analytics: 'Team Analytics',
    calendar: 'Game Calendar',
    fantasy: 'Fantasy Planner'
  })[tab];
}

/* ==========================================
   LOAD DATA
   ========================================== */

async function loadAll() {
  setStatus('Refreshing NHL data…');

  await Promise.all([
    loadStandings(),
    loadTeam()
  ]);

  $('updated').textContent =
    `Updated ${new Date().toLocaleString()}`;

  setStatus('NHL data · cached updates');
}

async function loadTeam() {
  const token = ++state.request;
  const t = team(state.team);

  $('team-name').textContent = t.name;

  $('team-meta').textContent =
    `${t.division} Division · ${t.conference} Conference`;

  $('team-logo').src = logo(t.code);

  $('team-logo').onerror = () => {
    $('team-logo').style.visibility = 'hidden';
  };

  $('team-logo').style.visibility = 'visible';

  clearMessage();

  [
    'next-game',
    'recent-games',
    'schedule-list',
    'roster-body'
  ].forEach(id => {
    $(id).innerHTML =
      '<div class="empty">Loading NHL data…</div>';
  });

  const [sched, roster] = await Promise.allSettled([
    get(`schedules/${t.code}.json`),
    get(`rosters/${t.code}.json`)
  ]);

  if (token !== state.request) return;

  if (
    sched.status === 'fulfilled' &&
    Array.isArray(sched.value.games)
  ) {
    state.schedule = sched.value.games;
    renderGames();
  } else {
    state.schedule = [];
    renderGames();

    message(
      'Schedule data is unavailable. In GitHub, open ' +
      'Actions → Update NHL data → Run workflow, then ' +
      'refresh this page after the workflow finishes.'
    );
  }

  if (roster.status === 'fulfilled') {
    const r = roster.value;

    state.roster = [
      ...(r.forwards || []),
      ...(r.defensemen || []),
      ...(r.goalies || [])
    ];

    renderRoster();
  } else {
    $('roster-body').innerHTML =
      '<tr><td colspan="4" class="muted">' +
      'Roster data is temporarily unavailable.' +
      '</td></tr>';
  }

  renderStandings();
  renderCompare();
}

async function loadStandings() {
  try {
    const data = await get('standings.json');

    state.standings = data.standings || [];

    renderStandings();
    renderCompare();
    renderOverviewStats();
  } catch (e) {
    state.standings = [];

    renderStandings();
    renderCompare();
    renderOverviewStats();

    message(
      'Standings are unavailable. Run the Update NHL data ' +
      'workflow in GitHub Actions to generate the data files.'
    );
  }
}

/* ==========================================
   GAME HELPERS
   ========================================== */

const isFinal = g =>
  ['FINAL', 'OFF'].includes(g.gameState);

const isUpcoming = g => !isFinal(g);

const opponent = g =>
  g.homeTeam?.abbrev === state.team
    ? g.awayTeam
    : g.homeTeam;

const isHome = g =>
  g.homeTeam?.abbrev === state.team;

const score = g =>
  `${g.awayTeam?.score ?? '–'} – ${g.homeTeam?.score ?? '–'}`;

const outcome = g => {
  const own = isHome(g) ? g.homeTeam : g.awayTeam;
  const opp = opponent(g);

  return Number(own?.score) > Number(opp?.score)
    ? 'W'
    : 'L';
};

/* ==========================================
   GAME RENDERING

   NEXT GAME:
   Date + logos + team abbreviations.
   No time or venue.
   ========================================== */

function renderGames() {
  const games = [...state.schedule].sort(
    (a, b) => a.gameDate.localeCompare(b.gameDate)
  );

  const played = games.filter(isFinal);
  const future = games.filter(isUpcoming);
  const next = future[0];

  // NEXT GAME DATE

  $('next-date').textContent = next
    ? fmtDate(next.gameDate, {
        month: 'short',
        day: 'numeric'
      })
    : 'SEASON COMPLETE';

  // NEXT GAME TEAMS WITH LOGOS

  if (next) {
    const awayCode = next.awayTeam?.abbrev || '—';
    const homeCode = next.homeTeam?.abbrev || '—';

    const away = escapeHtml(awayCode);
    const home = escapeHtml(homeCode);

    $('next-game').innerHTML = `
      <div class="hoist-next-teams">

        <img
          src="${logo(awayCode)}"
          alt="${away} logo"
          loading="lazy"
        >

        <span>${away}</span>

        <strong>vs</strong>

        <img
          src="${logo(homeCode)}"
          alt="${home} logo"
          loading="lazy"
        >

        <span>${home}</span>

      </div>
    `;
  } else {
    $('next-game').innerHTML =
      '<span class="muted">No upcoming games</span>';
  }

  // LAST 5 RESULTS

  const recent = played.slice(-5).reverse();

  $('recent-games').innerHTML = recent.length
    ? recent.map(g => `
        <div class="game-row">
          <div>
            <span class="result ${
              outcome(g) === 'W' ? 'win' : 'loss'
            }">
              ${outcome(g)}
            </span>
            ${isHome(g) ? 'vs' : '@'}
            ${escapeHtml(opponent(g)?.abbrev || '—')}
            <span class="sub">
              ${fmtDate(g.gameDate)}
            </span>
          </div>
          <span class="game-score">
            ${score(g)}
          </span>
        </div>
      `).join('')
    : '<div class="empty">No completed games yet.</div>';

  // RECENT FORM

  $('form').textContent = recent.length
    ? recent.map(outcome).reverse().join(' · ')
    : '—';

  renderSchedule();
  renderOverviewStats();
}

/* ==========================================
   GAME TIME
   Used by the season schedule only.
   ========================================== */

function formatStart(s) {
  if (!s) return 'Time TBA';

  return new Date(s).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/* ==========================================
   SEASON SCHEDULE
   ========================================== */

function renderSchedule() {
  const filter = $('schedule-filter').value;

  const games = state.schedule.filter(g =>
    filter === 'all' ||
    (filter === 'upcoming' && isUpcoming(g)) ||
    (filter === 'final' && isFinal(g)) ||
    (filter === 'home' && isHome(g)) ||
    (filter === 'away' && !isHome(g))
  );

  $('schedule-list').innerHTML = games.length
    ? games.map(g => {
        const opp = opponent(g);

        return `
          <div class="schedule-row">

            <span class="date">
              ${fmtDate(g.gameDate)}
            </span>

            <span class="opponent">
              <img
                src="${logo(opp?.abbrev || 'MTL')}"
                alt=""
              >
              ${isHome(g) ? 'vs' : '@'}
              ${escapeHtml(team(opp?.abbrev).name)}
            </span>

            <span class="game-score">
              ${
                isFinal(g)
                  ? score(g)
                  : formatStart(g.startTimeUTC)
                      .split(' ')
                      .slice(0, 2)
                      .join(' ')
              }
            </span>

            <span class="status muted">
              ${
                isFinal(g)
                  ? outcome(g) === 'W'
                    ? 'WIN'
                    : 'LOSS'
                  : escapeHtml(g.gameState || 'Scheduled')
              }
            </span>

          </div>
        `;
      }).join('')
    : '<div class="empty">' +
      'No games match this filter, or the schedule is unavailable.' +
      '</div>';
}

/* ==========================================
   OVERVIEW STATISTICS
   ========================================== */

function statFor(code) {
  return state.standings.find(s =>
    s.teamAbbrev?.default === code ||
    s.teamAbbrev === code
  );
}

function renderOverviewStats() {
  const s = statFor(state.team);

  $('record').textContent = s
    ? `${s.wins ?? 0} – ${s.losses ?? 0} – ${s.otLosses ?? 0}`
    : '—';

  $('points').textContent = s?.points ?? '—';

  $('points-detail').textContent = s
    ? `${s.gamesPlayed ?? 0} games played`
    : 'Season total';

  const diff = s?.goalDifferential ??
    (s
      ? Number(s.goalFor) - Number(s.goalAgainst)
      : null);

  $('goal-diff').textContent =
    diff == null || !Number.isFinite(diff)
      ? '—'
      : diff > 0
        ? `+${diff}`
        : String(diff);

  const values = [
    ['Games Played', s?.gamesPlayed],
    ['Goals For', s?.goalFor],
    ['Goals Against', s?.goalAgainst],
    [
      'Points %',
      s?.pointPctg == null
        ? null
        : `${(s.pointPctg * 100).toFixed(1)}%`
    ]
  ];

  $('snapshot').innerHTML = values.map(
    ([label, val]) => `
      <div class="snapshot-item">
        <div class="label">${label}</div>
        <div class="number">${val ?? '—'}</div>
      </div>
    `
  ).join('');
}

/* ==========================================
   ROSTER
   ========================================== */

function renderRoster() {
  const r = state.roster;

  $('roster-body').innerHTML = r.length
    ? r.map(p => `
        <tr>
          <td>
            ${escapeHtml(localName(p.firstName))}
            ${escapeHtml(localName(p.lastName))}
          </td>
          <td>${escapeHtml(p.positionCode)}</td>
          <td>#${escapeHtml(p.sweaterNumber ?? '—')}</td>
          <td>${escapeHtml(p.shootsCatches ?? '—')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="muted">' +
      'No roster data available.' +
      '</td></tr>';
}

/* ==========================================
   STANDINGS
   ========================================== */

function renderStandings() {
  // FIX: The new Standings UI no longer uses the legacy
  // dropdown and table. Do not run the old renderer
  // when either element is missing.
  const filterEl = $('standings-filter');
  const bodyEl = $('standings-body');

  if (!filterEl || !bodyEl) return;

  const filter = filterEl.value;

  const data = state.standings.filter(s =>
    filter === 'all' ||
    (
      filter === 'Eastern' ||
      filter === 'Western'
        ? s.conferenceName === filter
        : s.divisionName === filter
    )
  );

  const sorted = [...data].sort(
    (a, b) =>
      (b.points ?? 0) - (a.points ?? 0) ||
      (b.pointPctg ?? 0) - (a.pointPctg ?? 0)
  );

  bodyEl.innerHTML = sorted.length
    ? sorted.map((s, i) => {
        const code = localName(s.teamAbbrev);

        return `
          <tr class="${code === state.team ? 'highlight' : ''}">
            <td>${i + 1}</td>
            <td>
              <img src="${logo(code)}" alt="">
              ${escapeHtml(localName(s.teamName) || team(code).name)}
            </td>
            <td>${s.gamesPlayed ?? '—'}</td>
            <td>${s.wins ?? '—'}</td>
            <td>${s.losses ?? '—'}</td>
            <td>${s.otLosses ?? '—'}</td>
            <td><strong>${s.points ?? '—'}</strong></td>
            <td>${s.goalDifferential ?? '—'}</td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="8" class="muted">' +
      'Standings are currently unavailable.' +
      '</td></tr>';
}

/* ==========================================
   COMPARE TEAMS
   ========================================== */

function renderCompare() {
  const a = statFor($('compare-a').value);
  const b = statFor($('compare-b').value);

  const fields = [
    ['Points', 'points'],
    ['Games Played', 'gamesPlayed'],
    ['Wins', 'wins'],
    ['Losses', 'losses'],
    ['OT Losses', 'otLosses'],
    ['Goals For', 'goalFor'],
    ['Goals Against', 'goalAgainst'],
    ['Goal Differential', 'goalDifferential']
  ];

  $('compare-results').innerHTML = `
    <div class="compare-row">
      <strong>
        ${escapeHtml(team($('compare-a').value).name)}
      </strong>
      <span class="compare-label">STATISTIC</span>
      <strong>
        ${escapeHtml(team($('compare-b').value).name)}
      </strong>
    </div>
  ` + fields.map(([label, key]) => `
    <div class="compare-row">
      <strong>${a?.[key] ?? '—'}</strong>
      <span class="compare-label">${label}</span>
      <strong>${b?.[key] ?? '—'}</strong>
    </div>
  `).join('');
}

/* ==========================================
   START APP
   ========================================== */

document.addEventListener('DOMContentLoaded', setup);
