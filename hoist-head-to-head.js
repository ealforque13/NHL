
/* Hoist Official head-to-head:
   Cached NHL schedules and expandable scoresheets
   with NHL team-coloured abbreviation badges.

   Updated:
   - Record card displays W–L–OTL
   - Goals For / Against summary removed
   - Renders into the dedicated right-hand column
*/

(() => {
'use strict';

const $ = id => document.getElementById(id);

const esc = s => String(s ?? '').replace(
  /[&<>"']/g,
  c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])
);

const logo = c =>
  `https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(c)}_light.svg`;

const final = g =>
  ['FINAL', 'OFF'].includes(g?.gameState) &&
  g?.homeTeam?.score != null &&
  g?.awayTeam?.score != null;

const other = (g, t) =>
  g?.homeTeam?.abbrev === t
    ? g.awayTeam?.abbrev
    : g?.awayTeam?.abbrev === t
      ? g.homeTeam?.abbrev
      : null;

const name = p =>
  p?.name?.default ||
  p?.name ||
  [
    p?.firstName?.default || p?.firstName,
    p?.lastName?.default || p?.lastName
  ].filter(Boolean).join(' ') ||
  '—';

const num = v =>
  Number.isFinite(Number(v)) ? Number(v) : 0;


/* ==========================================
   NHL TEAM COLOURS
========================================== */

const TEAM_COLORS = {
  ANA: '#F47A38',
  BOS: '#FFB81C',
  BUF: '#003087',
  CAR: '#CC0000',
  CBJ: '#002654',
  CGY: '#C8102E',
  CHI: '#CF0A2C',
  COL: '#6F263D',
  DAL: '#006847',
  DET: '#CE1126',
  EDM: '#FF4C00',
  FLA: '#C8102E',
  LAK: '#111111',
  MIN: '#154734',
  MTL: '#AF1E2D',
  NJD: '#CE1126',
  NSH: '#FFB81C',
  NYI: '#00539B',
  NYR: '#0038A8',
  OTT: '#C52032',
  PHI: '#F74902',
  PIT: '#FCB514',
  SEA: '#001628',
  SJS: '#006D75',
  STL: '#002F87',
  TBL: '#002868',
  TOR: '#00205B',
  UTA: '#69B3E7',
  VAN: '#00205B',
  VGK: '#B4975A',
  WPG: '#041E42',
  WSH: '#C8102E'
};

const DARK_TEXT_TEAMS = new Set([
  'ANA',
  'BOS',
  'NSH',
  'PIT',
  'UTA',
  'VGK'
]);

function teamTag(code) {
  const team = String(code || '').toUpperCase();
  const color = TEAM_COLORS[team] || '#344563';

  const textColor = DARK_TEXT_TEAMS.has(team)
    ? '#111827'
    : '#FFFFFF';

  return `
    <span
      class="h2h-team-tag"
      style="
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:34px;
        padding:4px 7px;
        border-radius:4px;
        background-color:${color} !important;
        color:${textColor} !important;
        font-size:11px;
        font-weight:800;
        line-height:1.2;
        white-space:nowrap;
        flex-shrink:0;
        box-sizing:border-box;
      "
    >${esc(team)}</span>
  `;
}


/* ==========================================
   DATA CACHE
========================================== */

let historyPromise = null;
let detailsPromise = null;
let run = 0;

function getCache(file) {
  return fetch(`data/${file}?v=6`, {
    cache: 'no-cache'
  }).then(r => {
    if (!r.ok) {
      throw Error(`HTTP ${r.status}`);
    }
    return r.json();
  });
}

function history() {
  return historyPromise || (
    historyPromise = getCache('head-to-head.json')
      .then(d => Object.values(d.games || {}))
      .catch(e => {
        historyPromise = null;
        throw e;
      })
  );
}

function details() {
  return detailsPromise || (
    detailsPromise = getCache('head-to-head-scoresheets.json')
      .then(d => d.games || {})
      .catch(e => {
        detailsPromise = null;
        throw e;
      })
  );
}


/* ==========================================
   HEAD-TO-HEAD WIDGET
========================================== */

function widget() {
  if ($('hoist-h2h')) return;

  const overview = $('overview');
  if (!overview) return;

  const card = document.createElement('article');

  card.id = 'hoist-h2h';
  card.className = 'panel section-panel';

  card.innerHTML = `
    <div class="section-head">
      <div>
        <div class="eyebrow">HEAD TO HEAD</div>
        <h3>Last 10 Matchups</h3>

        <p id="hoist-h2h-sub" class="muted">
          Finding the next opponent…
        </p>
      </div>
    </div>

    <div
      id="hoist-h2h-summary"
      class="h2h-summary"
    ></div>

    <div
      id="hoist-h2h-games"
      class="h2h-games"
    >
      <div class="empty">
        Loading historical results…
      </div>
    </div>
  `;

  /*
    Render directly inside the dedicated
    right-hand column.

    This prevents the history panel from
    disappearing when the page updates.
  */

  const historyColumn =
    $('hoist-h2h-history-column');

  if (historyColumn) {
    historyColumn.appendChild(card);
    return;
  }

  /*
    Fallback for older HTML versions.
  */

  const mi = $('matchup-intelligence');

  if (mi) {
    overview.insertBefore(card, mi);
  } else {
    overview.appendChild(card);
  }
}


/* ==========================================
   HELPERS
========================================== */

function teamCode(v) {
  return (
    v?.abbrev ||
    v?.triCode ||
    v?.teamAbbrev?.default ||
    v?.teamAbbrev ||
    ''
  );
}

function periodLabel(p) {
  const n = p?.periodNumber || p?.number || p;

  if (n === 4) return 'OT';
  if (n === 5) return 'SO';

  return `${n}${
    n === 1 ? 'st' :
    n === 2 ? 'nd' :
    n === 3 ? 'rd' : 'th'
  }`;
}

/*
  Determine whether a completed game
  ended in overtime or a shootout.

  NHL schedule data generally provides:
  gameOutcome.lastPeriodType = REG / OT / SO

  Other fields are checked as fallbacks.
*/

function overtimeLoss(g) {
  const periodType = String(
    g?.gameOutcome?.lastPeriodType ||
    g?.periodDescriptor?.periodType ||
    g?.lastPeriodType ||
    ''
  ).toUpperCase();

  if (periodType === 'OT' || periodType === 'SO') {
    return true;
  }

  const periodNumber = Number(
    g?.periodDescriptor?.number ||
    g?.periodDescriptor?.periodNumber ||
    0
  );

  return periodNumber >= 4;
}


/* ==========================================
   SCORING SUMMARY
========================================== */

function scoring(payload) {
  const periods =
    payload?.landing?.summary?.scoring || [];

  if (!Array.isArray(periods) || !periods.length) {
    return `
      <p class="h2h-muted">
        Scoring details unavailable.
      </p>
    `;
  }

  return periods.map(p => {
    const goals =
      p.goals ||
      p.scoringPlays ||
      [];

    if (!goals.length) return '';

    const header = `
      <div class="h2h-period">
        ${esc(periodLabel(
          p.periodDescriptor ||
          p.periodNumber ||
          p.period
        ))}
      </div>
    `;

    const goalRows = goals.map(g => {
      const assists =
        (g.assists || [])
          .map(name)
          .join(', ') ||
        'Unassisted';

      const code =
        teamCode(
          g.teamAbbrev
            ? {
                abbrev:
                  typeof g.teamAbbrev === 'string'
                    ? g.teamAbbrev
                    : g.teamAbbrev.default
              }
            : g.team
        ) ||
        g.teamAbbrev?.default ||
        g.teamAbbrev ||
        '';

      const scorer =
        name(g) ||
        name(g.scorer) ||
        g.name?.default ||
        '—';

      const tally =
        g.goalsToDate != null
          ? ` (${num(g.goalsToDate)})`
          : '';

      const strength =
        g.strength === 'pp'
          ? ' · PP'
          : g.strength === 'sh'
            ? ' · SH'
            : '';

      return `
        <div class="h2h-goal">

          <span class="h2h-time">
            ${esc(g.timeInPeriod || g.time || '')}
          </span>

          ${teamTag(code)}

          <div>
            <strong>
              ${esc(scorer)}${tally}${strength}
            </strong>

            <small>
              ${esc(assists)}
            </small>
          </div>

        </div>
      `;
    }).join('');

    return header + goalRows;
  }).join('') || `
    <p class="h2h-muted">
      No scoring plays available.
    </p>
  `;
}


/* ==========================================
   GOALTENDING SUMMARY
========================================== */

function goalies(payload) {
  const by =
    payload?.boxscore?.playerByGameStats || {};

  const teams = [
    [
      'awayTeam',
      teamCode(payload?.boxscore?.awayTeam)
    ],
    [
      'homeTeam',
      teamCode(payload?.boxscore?.homeTeam)
    ]
  ];

  return teams.map(([side, code]) => {
    const players =
      by[side]?.goalies || [];

    return players.map(p => {
      const shots =
        p.shotsAgainst ??
        p.shotsAgainstTotal;

      const saves =
        p.saves ??
        (
          shots != null &&
          p.goalsAgainst != null
            ? num(shots) - num(p.goalsAgainst)
            : null
        );

      const pct =
        p.savePctg ??
        (
          shots > 0 &&
          saves != null
            ? saves / shots
            : null
        );

      const outcome = p.decision || '';

      return `
        <div class="h2h-goalie">

          ${teamTag(code)}

          <div>
            <strong>
              ${esc(name(p))} ${esc(outcome)}
            </strong>

            <small>
              ${
                saves != null && shots != null
                  ? `${num(saves)} saves on ${num(shots)}`
                  : 'Goalie statistics unavailable'
              }

              ${
                pct != null
                  ? ` · ${Number(pct)
                      .toFixed(3)
                      .replace(/^0/, '')}`
                  : ''
              }
            </small>
          </div>

        </div>
      `;
    }).join('');
  }).join('') || `
    <p class="h2h-muted">
      Goaltending details unavailable.
    </p>
  `;
}


/* ==========================================
   TEAM STATISTICS
========================================== */

const statLabels = {
  sog: 'Shots',
  shots: 'Shots',
  faceoffWinningPctg: 'Faceoff %',
  faceoffPct: 'Faceoff %',
  powerPlayPct: 'Power play %',
  powerPlay: 'Power play',
  pim: 'Penalty minutes',
  penaltyMinutes: 'Penalty minutes',
  hits: 'Hits',
  blockedShotAttempts: 'Blocked shots',
  blockedShots: 'Blocked shots',
  giveaways: 'Giveaways',
  takeaways: 'Takeaways'
};

function stats(payload, g) {
  const entries =
    payload?.landing?.summary?.teamGameStats || [];

  const away = g.awayTeam.abbrev;
  const home = g.homeTeam.abbrev;

  if (!Array.isArray(entries) || !entries.length) {
    return `
      <p class="h2h-muted">
        Team statistics unavailable.
      </p>
    `;
  }

  const rows = entries
    .filter(x =>
      statLabels[x.category] ||
      statLabels[x.name]
    )
    .map(x => {
      const label =
        statLabels[x.category] ||
        statLabels[x.name];

      const a =
        x.awayValue ??
        x.away ??
        '—';

      const h =
        x.homeValue ??
        x.home ??
        '—';

      return `
        <div class="h2h-stat">
          <strong>${esc(a)}</strong>
          <span>${esc(label)}</span>
          <strong>${esc(h)}</strong>
        </div>
      `;
    })
    .join('');

  return `
    <div class="h2h-stat-head">
      ${teamTag(away)}
      <b>Team stats</b>
      ${teamTag(home)}
    </div>

    ${
      rows ||
      '<p class="h2h-muted">Team statistics unavailable.</p>'
    }
  `;
}


/* ==========================================
   EXPANDED SCORESHEET
========================================== */

function scoresheet(payload, g) {
  const summary =
    payload?.landing?.summary;

  const hasScoring =
    Array.isArray(summary?.scoring);

  const hasBox =
    !!payload?.boxscore?.playerByGameStats;

  if (!hasScoring && !hasBox) {
    return `
      <p class="h2h-muted">
        Detailed scoresheet not available for this game.
      </p>
    `;
  }

  return `
    <div class="h2h-score-grid">

      <div>
        <h4>Scoring</h4>
        ${scoring(payload)}
      </div>

      <div>
        <h4>Goalies</h4>
        ${goalies(payload)}

        <div class="h2h-stats">
          ${stats(payload, g)}
        </div>
      </div>

    </div>
  `;
}


/* ==========================================
   RENDER HEAD-TO-HEAD RESULTS
========================================== */

function paint(games, t, opp, cache) {
  const sub = $('hoist-h2h-sub');
  const summary = $('hoist-h2h-summary');
  const list = $('hoist-h2h-games');

  if (!sub || !summary || !list) return;

  sub.textContent =
    `${t} vs ${opp} · ` +
    `${games.length} most recent completed ` +
    `regular-season meetings` +
    (
      games.length < 10
        ? ' · limited history'
        : ''
    );

  if (!games.length) {
    summary.innerHTML = '';

    list.innerHTML = `
      <div class="empty">
        No completed regular-season meetings
        in the cached history.
      </div>
    `;

    return;
  }

  /* ========================================
     NEW RECORD CARD: W–L–OTL
  ======================================== */

  let wins = 0;
  let losses = 0;
  let otLosses = 0;

  for (const g of games) {
    const home =
      g.homeTeam.abbrev === t;

    const own = num(
      (home ? g.homeTeam : g.awayTeam).score
    );

    const against = num(
      (home ? g.awayTeam : g.homeTeam).score
    );

    if (own > against) {
      wins++;
    } else if (overtimeLoss(g)) {
      otLosses++;
    } else {
      losses++;
    }
  }

  /*
    Replaces both old summary boxes with
    one Record card.

    Styles are inline so this works without
    requiring additional CSS changes.
  */

  summary.style.display = 'block';
  summary.style.padding = '0';
  summary.style.margin = '22px 0 16px';

  summary.innerHTML = `
    <div
      class="hoist-h2h-record-card"
      style="
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        gap:0;
        width:100%;
        box-sizing:border-box;
        padding:14px 16px;
        background:rgba(120,150,200,.055);
        border:1px solid rgba(125,155,195,.22);
        border-radius:0;
      "
    >

      <div
        class="hoist-h2h-record-label"
        style="
          font-size:12px;
          font-weight:750;
          letter-spacing:.06em;
          line-height:1.3;
          color:#91afd8;
          margin-bottom:7px;
        "
      >
        RECORD
      </div>

      <div
        class="hoist-h2h-record-value"
        style="
          font-size:28px;
          font-weight:800;
          line-height:1.2;
          color:#ffffff;
        "
      >
        ${wins}–${losses}–${otLosses}
      </div>

      <div
        class="hoist-h2h-record-detail"
        style="
          margin-top:5px;
          font-size:11px;
          font-weight:400;
          letter-spacing:.02em;
          color:#8ea9d2;
        "
      >
        W – L – OTL
      </div>

    </div>
  `;

  /* ========================================
     INDIVIDUAL MATCHUPS
  ======================================== */

  list.innerHTML = games.map(g => {
    const home =
      g.homeTeam.abbrev === t;

    const own = num(
      (home ? g.homeTeam : g.awayTeam).score
    );

    const against = num(
      (home ? g.awayTeam : g.homeTeam).score
    );

    const win = own > against;
    const code = other(g, t);
    const id = String(g.id);
    const payload = cache[id];

    const date = String(g.gameDate || '');
    const d = new Date(date + 'T12:00:00');

    const formatted = Number.isNaN(d.getTime())
      ? date
      : d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

    return `
      <details class="h2h-game">

        <summary class="h2h-game-toggle">

          <span class="h2h-result ${
            win ? 'h2h-win' : 'h2h-loss'
          }">
            ${win ? 'W' : 'L'}
          </span>

          <span class="h2h-game-info">
            <strong>
              ${home ? 'vs' : 'at'} ${esc(code)}
            </strong>

            <small>${esc(formatted)}</small>
          </span>

          <span class="h2h-game-score">
            <img
              src="${logo(g.awayTeam.abbrev)}"
              alt=""
              loading="lazy"
            >

            <b>
              ${num(g.awayTeam.score)}–${num(g.homeTeam.score)}
            </b>

            <img
              src="${logo(g.homeTeam.abbrev)}"
              alt=""
              loading="lazy"
            >
          </span>

          <span
            class="h2h-chevron"
            aria-hidden="true"
          >⌄</span>

        </summary>

        <div class="h2h-score-content">
          ${
            payload
              ? scoresheet(payload, g)
              : `
                <p class="h2h-muted">
                  Scoresheet is not cached yet.
                  Run the Update Head-to-Head History
                  workflow again to backfill game details.
                </p>
              `
          }
        </div>

      </details>
    `;
  }).join('');
}


/* ==========================================
   UPDATE SELECTED TEAM
========================================== */

async function update() {
  widget();

  const sub = $('hoist-h2h-sub');
  const list = $('hoist-h2h-games');

  if (!sub || !list) return;

  const token = ++run;

  const t =
    $('team-select')?.value ||
    (
      typeof state !== 'undefined'
        ? state.team
        : null
    ) ||
    'MTL';

  const schedule =
    (
      typeof state !== 'undefined' &&
      Array.isArray(state.schedule)
    )
      ? state.schedule
      : [];

  const upcoming = schedule
    .filter(g =>
      g?.gameDate &&
      !final(g) &&
      num(g.gameType) === 2
    )
    .sort((a, b) =>
      a.gameDate.localeCompare(b.gameDate)
    );

  const opp = upcoming.length
    ? other(upcoming[0], t)
    : null;

  if (!opp) {
    sub.textContent =
      'No upcoming regular-season opponent found for the selected team.';

    $('hoist-h2h-summary').innerHTML = '';

    list.innerHTML = `
      <div class="empty">
        Matchups appear when the next opponent
        is available.
      </div>
    `;

    return;
  }

  sub.textContent =
    `${t} vs ${opp} · loading cached history…`;

  list.innerHTML = `
    <div class="empty">
      Loading last 10 meetings…
    </div>
  `;

  try {
    const all = await history();

    if (token !== run) return;

    const unique = new Map();

    for (const g of all) {
      if (
        num(g.gameType) === 2 &&
        final(g) &&
        other(g, t) === opp
      ) {
        unique.set(
          String(
            g.id ||
            `${g.gameDate}-${g.homeTeam.abbrev}-${g.awayTeam.abbrev}`
          ),
          g
        );
      }
    }

    const games = [...unique.values()]
      .sort((a, b) =>
        String(b.gameDate).localeCompare(
          String(a.gameDate)
        )
      )
      .slice(0, 10);

    let cache = {};

    try {
      cache = await details();
    } catch (e) {
      console.warn(
        'Hoist scoresheets not yet cached:',
        e.message
      );
    }

    if (token !== run) return;

    paint(games, t, opp, cache);

  } catch (e) {
    if (token !== run) return;

    sub.textContent =
      `${t} vs ${opp} · historical cache unavailable`;

    $('hoist-h2h-summary').innerHTML = '';

    list.innerHTML = `
      <div class="empty">
        ${esc(e.message)}.
        Run the "Update Head-to-Head History"
        GitHub Action.
      </div>
    `;
  }
}


/* ==========================================
   INITIALIZE
========================================== */

function init() {
  widget();

  $('team-select')?.addEventListener(
    'change',
    () => setTimeout(update, 800)
  );

  $('refresh')?.addEventListener(
    'click',
    () => setTimeout(update, 1500)
  );

  setTimeout(update, 1600);

  setTimeout(() => {
    if (
      !$('hoist-h2h-games')
        ?.querySelector('.h2h-game')
    ) {
      update();
    }
  }, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    init
  );
} else {
  init();
}

})();
