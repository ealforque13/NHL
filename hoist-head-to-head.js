
/* ==========================================
   HOIST OFFICIAL — HEAD TO HEAD
   ==========================================

   Cached NHL schedules and expandable scoresheets.

   Features:
   - Last 10 regular-season meetings
   - Next-opponent detection
   - Team-coloured abbreviation badges
   - Win/loss records
   - Goals for and against
   - Expandable scoring summaries
   - Goaltending statistics
   - Team statistics
   - Automatic updates when switching teams
   - Direct rendering into the right-hand
     Head to Head column

========================================== */

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
    Number.isFinite(Number(v))
      ? Number(v)
      : 0;


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

    const color =
      TEAM_COLORS[team] || '#344563';

    const textColor =
      DARK_TEXT_TEAMS.has(team)
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
          border-radius:0;
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
    }).then(response => {
      if (!response.ok) {
        throw Error(`HTTP ${response.status}`);
      }

      return response.json();
    });
  }

  function history() {
    return historyPromise || (
      historyPromise = getCache('head-to-head.json')
        .then(data => Object.values(data.games || {}))
        .catch(error => {
          historyPromise = null;
          throw error;
        })
    );
  }

  function details() {
    return detailsPromise || (
      detailsPromise = getCache(
        'head-to-head-scoresheets.json'
      )
        .then(data => data.games || {})
        .catch(error => {
          detailsPromise = null;
          throw error;
        })
    );
  }


  /* ==========================================
     HEAD TO HEAD WIDGET
  ========================================== */

  function widget() {

    // Avoid creating duplicate widgets.
    if ($('hoist-h2h')) return;

    const overview = $('overview');

    if (!overview) return;

    // Dedicated right-hand column in index.html.
    const historyColumn = $(
      'hoist-h2h-history-column'
    );

    const card = document.createElement('article');

    card.id = 'hoist-h2h';
    card.className = 'panel section-panel';

    card.innerHTML = `
      <div class="section-head">

        <div>

          <div class="eyebrow">
            HEAD TO HEAD
          </div>

          <h3>Last 10 Matchups</h3>

          <p
            id="hoist-h2h-sub"
            class="muted"
          >
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

    if (historyColumn) {

      /*
       * NEW LAYOUT
       *
       * Render directly into the right column
       * beside Player Statistics.
       *
       * No copying, cloning or moving
       * generated matchup content.
       */

      historyColumn.replaceChildren(card);

      // Remove nested card styling.
      card.style.border = 'none';
      card.style.boxShadow = 'none';
      card.style.padding = '0';
      card.style.margin = '0';
      card.style.background = 'transparent';
      card.style.width = '100%';
      card.style.maxWidth = 'none';

    } else {

      /*
       * FALLBACK
       *
       * Support older HTML layouts without
       * the dedicated history column.
       */

      const mi = $('matchup-intelligence');

      if (mi) {
        overview.insertBefore(card, mi);
      } else {
        overview.appendChild(card);
      }
    }
  }


  /* ==========================================
     HELPERS
  ========================================== */

  function teamCode(value) {
    return (
      value?.abbrev ||
      value?.triCode ||
      value?.teamAbbrev?.default ||
      value?.teamAbbrev ||
      ''
    );
  }

  function periodLabel(period) {
    const n =
      period?.periodNumber ||
      period?.number ||
      period;

    if (n === 4) return 'OT';
    if (n === 5) return 'SO';

    return `${n}${
      n === 1 ? 'st' :
      n === 2 ? 'nd' :
      n === 3 ? 'rd' : 'th'
    }`;
  }


  /* ==========================================
     SCORING SUMMARY
  ========================================== */

  function scoring(payload) {

    const periods =
      payload?.landing?.summary?.scoring || [];

    if (
      !Array.isArray(periods) ||
      !periods.length
    ) {
      return `
        <p class="h2h-muted">
          Scoring details unavailable.
        </p>
      `;
    }

    return periods.map(period => {

      const goals =
        period.goals ||
        period.scoringPlays ||
        [];

      if (!goals.length) return '';

      const header = `
        <div class="h2h-period">
          ${esc(periodLabel(
            period.periodDescriptor ||
            period.periodNumber ||
            period.period
          ))}
        </div>
      `;

      const goalRows = goals.map(goal => {

        const assists =
          (goal.assists || [])
            .map(name)
            .join(', ') ||
          'Unassisted';

        const code =
          teamCode(
            goal.teamAbbrev
              ? {
                  abbrev:
                    typeof goal.teamAbbrev === 'string'
                      ? goal.teamAbbrev
                      : goal.teamAbbrev.default
                }
              : goal.team
          ) ||
          goal.teamAbbrev?.default ||
          goal.teamAbbrev ||
          '';

        const scorer =
          name(goal) ||
          name(goal.scorer) ||
          goal.name?.default ||
          '—';

        const tally =
          goal.goalsToDate != null
            ? ` (${num(goal.goalsToDate)})`
            : '';

        const strength =
          goal.strength === 'pp'
            ? ' · PP'
            : goal.strength === 'sh'
              ? ' · SH'
              : '';

        return `
          <div class="h2h-goal">

            <span class="h2h-time">
              ${esc(
                goal.timeInPeriod ||
                goal.time ||
                ''
              )}
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

      return players.map(player => {

        const shots =
          player.shotsAgainst ??
          player.shotsAgainstTotal;

        const saves =
          player.saves ??
          (
            shots != null &&
            player.goalsAgainst != null
              ? num(shots) -
                num(player.goalsAgainst)
              : null
          );

        const pct =
          player.savePctg ??
          (
            shots > 0 &&
            saves != null
              ? saves / shots
              : null
          );

        const outcome =
          player.decision || '';

        return `
          <div class="h2h-goalie">

            ${teamTag(code)}

            <div>

              <strong>
                ${esc(name(player))}
                ${esc(outcome)}
              </strong>

              <small>

                ${
                  saves != null &&
                  shots != null
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

  function stats(payload, game) {

    const entries =
      payload?.landing?.summary?.teamGameStats || [];

    const away =
      game.awayTeam.abbrev;

    const home =
      game.homeTeam.abbrev;

    if (
      !Array.isArray(entries) ||
      !entries.length
    ) {
      return `
        <p class="h2h-muted">
          Team statistics unavailable.
        </p>
      `;
    }

    const rows = entries
      .filter(entry =>
        statLabels[entry.category] ||
        statLabels[entry.name]
      )
      .map(entry => {

        const label =
          statLabels[entry.category] ||
          statLabels[entry.name];

        const awayValue =
          entry.awayValue ??
          entry.away ??
          '—';

        const homeValue =
          entry.homeValue ??
          entry.home ??
          '—';

        return `
          <div class="h2h-stat">

            <strong>
              ${esc(awayValue)}
            </strong>

            <span>
              ${esc(label)}
            </span>

            <strong>
              ${esc(homeValue)}
            </strong>

          </div>
        `;

      }).join('');

    return `
      <div class="h2h-stat-head">

        ${teamTag(away)}

        <b>Team stats</b>

        ${teamTag(home)}

      </div>

      ${
        rows ||
        `
          <p class="h2h-muted">
            Team statistics unavailable.
          </p>
        `
      }
    `;
  }


  /* ==========================================
     EXPANDED SCORESHEET
  ========================================== */

  function scoresheet(payload, game) {

    const summary =
      payload?.landing?.summary;

    const hasScoring =
      Array.isArray(summary?.scoring);

    const hasBox =
      !!payload?.boxscore?.playerByGameStats;

    if (!hasScoring && !hasBox) {
      return `
        <p class="h2h-muted">
          Detailed scoresheet not available
          for this game.
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
            ${stats(payload, game)}
          </div>

        </div>

      </div>
    `;
  }


  /* ==========================================
     RENDER HEAD-TO-HEAD RESULTS
  ========================================== */

  function paint(games, team, opponent, cache) {

    const sub = $('hoist-h2h-sub');
    const summary = $('hoist-h2h-summary');
    const list = $('hoist-h2h-games');

    if (!sub || !summary || !list) return;

    sub.textContent =
      `${team} vs ${opponent} · ` +
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

    let wins = 0;
    let gf = 0;
    let ga = 0;

    for (const game of games) {

      const home =
        game.homeTeam.abbrev === team;

      const own = num(
        (
          home
            ? game.homeTeam
            : game.awayTeam
        ).score
      );

      const against = num(
        (
          home
            ? game.awayTeam
            : game.homeTeam
        ).score
      );

      wins += own > against ? 1 : 0;

      gf += own;
      ga += against;
    }

    summary.innerHTML = `
      <span>

        <strong>
          ${wins}–${games.length - wins}
        </strong>

        ${esc(team)} record

      </span>

      <span>

        <strong>
          ${gf}–${ga}
        </strong>

        Goals for / against

      </span>
    `;

    list.innerHTML = games.map(game => {

      const home =
        game.homeTeam.abbrev === team;

      const own = num(
        (
          home
            ? game.homeTeam
            : game.awayTeam
        ).score
      );

      const against = num(
        (
          home
            ? game.awayTeam
            : game.homeTeam
        ).score
      );

      const win = own > against;

      const code =
        other(game, team);

      const id =
        String(game.id);

      const payload =
        cache[id];

      const date =
        String(game.gameDate || '');

      const parsedDate =
        new Date(date + 'T12:00:00');

      const formatted =
        Number.isNaN(parsedDate.getTime())
          ? date
          : parsedDate.toLocaleDateString(
              'en-US',
              {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              }
            );

      return `
        <details class="h2h-game">

          <summary class="h2h-game-toggle">

            <span
              class="h2h-result ${
                win
                  ? 'h2h-win'
                  : 'h2h-loss'
              }"
            >
              ${win ? 'W' : 'L'}
            </span>

            <span class="h2h-game-info">

              <strong>
                ${home ? 'vs' : 'at'}
                ${esc(code)}
              </strong>

              <small>
                ${esc(formatted)}
              </small>

            </span>

            <span class="h2h-game-score">

              <img
                src="${logo(game.awayTeam.abbrev)}"
                alt=""
                loading="lazy"
              >

              <b>
                ${num(game.awayTeam.score)}–${num(game.homeTeam.score)}
              </b>

              <img
                src="${logo(game.homeTeam.abbrev)}"
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
                ? scoresheet(payload, game)
                : `
                  <p class="h2h-muted">
                    Scoresheet is not cached yet.
                    Run the Update Head-to-Head History
                    workflow again to backfill
                    game details.
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
    const summary = $('hoist-h2h-summary');

    if (!sub || !list || !summary) return;

    const token = ++run;

    const team =
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
      .filter(game =>
        game?.gameDate &&
        !final(game) &&
        num(game.gameType) === 2
      )
      .sort((a, b) =>
        a.gameDate.localeCompare(b.gameDate)
      );

    const opponent =
      upcoming.length
        ? other(upcoming[0], team)
        : null;

    if (!opponent) {

      sub.textContent =
        'No upcoming regular-season opponent found ' +
        'for the selected team.';

      summary.innerHTML = '';

      list.innerHTML = `
        <div class="empty">
          Matchups appear when the next
          opponent is available.
        </div>
      `;

      return;
    }

    sub.textContent =
      `${team} vs ${opponent} · ` +
      `loading cached history…`;

    summary.innerHTML = '';

    list.innerHTML = `
      <div class="empty">
        Loading last 10 meetings…
      </div>
    `;

    try {

      const all = await history();

      if (token !== run) return;

      const unique = new Map();

      for (const game of all) {

        if (
          num(game.gameType) === 2 &&
          final(game) &&
          other(game, team) === opponent
        ) {

          unique.set(
            String(
              game.id ||
              `${game.gameDate}-` +
              `${game.homeTeam.abbrev}-` +
              `${game.awayTeam.abbrev}`
            ),
            game
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

      } catch (error) {

        console.warn(
          'Hoist scoresheets not yet cached:',
          error.message
        );

      }

      if (token !== run) return;

      paint(
        games,
        team,
        opponent,
        cache
      );

    } catch (error) {

      if (token !== run) return;

      sub.textContent =
        `${team} vs ${opponent} · ` +
        `historical cache unavailable`;

      summary.innerHTML = '';

      list.innerHTML = `
        <div class="empty">
          ${esc(error.message)}.
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
