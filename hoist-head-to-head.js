
/*
  HOIST OFFICIAL — HEAD-TO-HEAD HISTORY

  Features:
  - Last 10 completed regular-season matchups
  - W-L-OTL record
  - Expandable scoresheets
  - Scoring, goaltending and team statistics
  - NHL team-coloured abbreviation badges
  - Responsive desktop and mobile layout
  - Season-by-season scoresheet JSON loading
  - Temporary legacy cache fallback

  Required data:
  data/head-to-head.json
  data/head-to-head-scoresheets/YYYY.json
*/

(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const esc = value => String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char])
  );

  const num = value =>
    Number.isFinite(Number(value)) ? Number(value) : 0;

  const logo = code =>
    `https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(code)}_light.svg`;

  const final = game =>
    ['FINAL', 'OFF'].includes(game?.gameState) &&
    game?.homeTeam?.score != null &&
    game?.awayTeam?.score != null;

  const other = (game, team) =>
    game?.homeTeam?.abbrev === team
      ? game.awayTeam?.abbrev
      : game?.awayTeam?.abbrev === team
        ? game.homeTeam?.abbrev
        : null;

  function playerName(player) {
    if (!player) return '—';

    if (typeof player.name === 'string') {
      return player.name;
    }

    if (player.name?.default) {
      return player.name.default;
    }

    return [
      player.firstName?.default || player.firstName,
      player.lastName?.default || player.lastName
    ].filter(Boolean).join(' ') || '—';
  }

  /*
    NHL TEAM COLOURS
  */

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
    'ANA', 'BOS', 'NSH', 'PIT', 'UTA', 'VGK'
  ]);

  function teamTag(code) {
    const team = String(code || '').toUpperCase();
    const color = TEAM_COLORS[team] || '#344563';

    const textColor = DARK_TEXT_TEAMS.has(team)
      ? '#111827'
      : '#FFFFFF';

    return `
      <span class="h2h-team-tag"
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

  /*
    DATA LOADING
  */

  let historyPromise = null;
  let legacyDetailsPromise = null;
  let run = 0;

  const seasonPromises = new Map();

  function getCache(file) {
    return fetch(`data/${file}?v=7`, {
      cache: 'no-cache'
    }).then(response => {
      if (!response.ok) {
        throw new Error(
          `${file}: HTTP ${response.status}`
        );
      }

      return response.json();
    });
  }

  function history() {
    if (!historyPromise) {
      historyPromise = getCache('head-to-head.json')
        .then(data => Object.values(data.games || {}))
        .catch(error => {
          historyPromise = null;
          throw error;
        });
    }

    return historyPromise;
  }

  /*
    Each NHL game ID starts with its season year.

    Example:
    2024020001 -> 2024.json

    New directory:
    data/head-to-head-scoresheets/
  */

  function seasonOf(game) {
    const id = String(game?.id || '');
    const year = id.slice(0, 4);

    return /^\d{4}$/.test(year) ? year : null;
  }

  function loadSeason(year) {
    if (!seasonPromises.has(year)) {
      const request = getCache(
        `head-to-head-scoresheets/${year}.json`
      ).then(data => {
        if (
          !data ||
          !data.games ||
          typeof data.games !== 'object' ||
          Array.isArray(data.games)
        ) {
          throw new Error(
            `Invalid scoresheet data for ${year}`
          );
        }

        return data.games;
      }).catch(error => {
        seasonPromises.delete(year);
        throw error;
      });

      seasonPromises.set(year, request);
    }

    return seasonPromises.get(year);
  }

  /*
    Load only the seasons required for the
    selected ten games.

    During migration, the original combined JSON
    remains available as a fallback.
  */

  async function details(games) {
    if (!games.length) return {};

    const years = [
      ...new Set(
        games.map(seasonOf).filter(Boolean)
      )
    ];

    const results = await Promise.allSettled(
      years.map(loadSeason)
    );

    const combined = {};
    let successful = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        Object.assign(combined, result.value);
        successful++;
      } else {
        console.warn(
          `Hoist: ${years[index]} scoresheets unavailable`,
          result.reason
        );
      }
    });

    /*
      Temporary fallback to original combined JSON.

      Remove this fallback after the new season
      files have been deployed and verified.
    */

    if (successful === 0) {
      if (!legacyDetailsPromise) {
        legacyDetailsPromise = getCache(
          'head-to-head-scoresheets.json'
        ).then(data => data.games || {})
          .catch(error => {
            legacyDetailsPromise = null;
            throw error;
          });
      }

      try {
        return await legacyDetailsPromise;
      } catch (error) {
        console.warn(
          'Legacy scoresheet cache unavailable:',
          error
        );
      }
    }

    return combined;
  }

  /*
    RESPONSIVE HEADER STYLING
  */

  function installHeaderStyles() {
    if ($('hoist-h2h-header-styles')) return;

    const style = document.createElement('style');
    style.id = 'hoist-h2h-header-styles';

    style.textContent = `
      #hoist-h2h .hoist-h2h-top-row {
        display:flex!important;
        align-items:flex-start!important;
        justify-content:space-between!important;
        gap:18px!important;
        width:100%!important;
        min-width:0!important;
        margin-bottom:20px!important;
      }

      #hoist-h2h .hoist-h2h-heading {
        flex:1 1 auto!important;
        min-width:0!important;
      }

      #hoist-h2h .hoist-h2h-heading h3 {
        margin:0!important;
      }

      #hoist-h2h .hoist-h2h-heading .muted {
        margin-top:9px!important;
        line-height:1.5!important;
      }

      #hoist-h2h #hoist-h2h-summary {
        display:block!important;
        flex:0 0 140px!important;
        width:140px!important;
        min-width:0!important;
        max-width:140px!important;
        margin:0!important;
        padding:0!important;
        align-self:flex-start!important;
        box-sizing:border-box!important;
      }

      #hoist-h2h .hoist-h2h-record-card {
        display:flex!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
        padding:11px 12px!important;
        margin:0!important;
        background:rgba(120,150,200,.055)!important;
        border:1px solid rgba(125,155,195,.22)!important;
        border-radius:0!important;
        gap:0!important;
      }

      #hoist-h2h .hoist-h2h-record-label {
        font-size:11px!important;
        font-weight:750!important;
        letter-spacing:.06em!important;
        line-height:1.3!important;
        color:#91afd8!important;
        margin-bottom:7px!important;
      }

      #hoist-h2h .hoist-h2h-record-value {
        font-size:25px!important;
        font-weight:800!important;
        line-height:1.2!important;
        color:#ffffff!important;
        white-space:nowrap!important;
      }

      #hoist-h2h .hoist-h2h-record-detail {
        margin-top:5px!important;
        font-size:10px!important;
        font-weight:400!important;
        letter-spacing:.02em!important;
        line-height:1.3!important;
        color:#8ea9d2!important;
        white-space:nowrap!important;
      }

      @media(max-width:480px) {
        #hoist-h2h .hoist-h2h-top-row {
          gap:8px!important;
        }

        #hoist-h2h .hoist-h2h-heading {
          flex:1 1 0!important;
          min-width:0!important;
        }

        #hoist-h2h #hoist-h2h-summary {
          flex:0 0 95px!important;
          width:95px!important;
          min-width:95px!important;
          max-width:95px!important;
        }

        #hoist-h2h .hoist-h2h-record-card {
          width:95px!important;
          max-width:95px!important;
          padding:8px!important;
        }

        #hoist-h2h .hoist-h2h-record-label {
          font-size:9px!important;
          margin-bottom:5px!important;
        }

        #hoist-h2h .hoist-h2h-record-value {
          font-size:19px!important;
        }

        #hoist-h2h .hoist-h2h-record-detail {
          font-size:8px!important;
          margin-top:4px!important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /*
    CREATE HEAD-TO-HEAD WIDGET
  */

  function widget() {
    installHeaderStyles();

    if ($('hoist-h2h')) return;

    const overview = $('overview');
    if (!overview) return;

    const card = document.createElement('article');

    card.id = 'hoist-h2h';
    card.className = 'panel section-panel';

    card.innerHTML = `
      <div class="hoist-h2h-top-row">
        <div class="hoist-h2h-heading">
          <div class="eyebrow">HEAD TO HEAD</div>

          <h3>Last 10 Matchups</h3>

          <p id="hoist-h2h-sub" class="muted">
            Finding the next opponent…
          </p>
        </div>

        <div
          id="hoist-h2h-summary"
          class="h2h-summary"
        ></div>
      </div>

      <div
        id="hoist-h2h-games"
        class="h2h-games"
      >
        <div class="empty">
          Loading historical results…
        </div>
      </div>
    `;

    const column = $('hoist-h2h-history-column');

    if (column) {
      column.appendChild(card);
      return;
    }

    const matchup = $('matchup-intelligence');

    if (matchup) {
      overview.insertBefore(card, matchup);
    } else {
      overview.appendChild(card);
    }
  }

  /*
    HELPERS
  */

  function teamCode(value) {
    if (typeof value === 'string') return value;

    return (
      value?.abbrev ||
      value?.triCode ||
      value?.teamAbbrev?.default ||
      value?.teamAbbrev ||
      ''
    );
  }

  function periodLabel(period) {
    const raw =
      period?.periodNumber ||
      period?.number ||
      period;

    const n = Number(raw);

    if (n === 4) return 'OT';
    if (n === 5) return 'SO';

    if (!n) return 'Period';

    return `${n}${
      n === 1 ? 'st' :
      n === 2 ? 'nd' :
      n === 3 ? 'rd' : 'th'
    }`;
  }

  function overtimeLoss(game) {
    const type = String(
      game?.gameOutcome?.lastPeriodType ||
      game?.periodDescriptor?.periodType ||
      game?.lastPeriodType ||
      ''
    ).toUpperCase();

    if (type === 'OT' || type === 'SO') {
      return true;
    }

    const number = Number(
      game?.periodDescriptor?.number ||
      game?.periodDescriptor?.periodNumber ||
      0
    );

    return number >= 4;
  }

  /*
    SCORING SUMMARY
  */

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

    const output = periods.map(period => {
      const goals =
        period.goals ||
        period.scoringPlays ||
        [];

      if (!Array.isArray(goals) || !goals.length) {
        return '';
      }

      const header = `
        <div class="h2h-period">
          ${esc(periodLabel(
            period.periodDescriptor ||
            period.periodNumber ||
            period.period
          ))}
        </div>
      `;

      const rows = goals.map(goal => {
        const assists = (goal.assists || [])
          .map(playerName)
          .join(', ') || 'Unassisted';

        const code =
          teamCode(goal.teamAbbrev) ||
          teamCode(goal.team);

        const scorer =
          playerName(goal.scorer) !== '—'
            ? playerName(goal.scorer)
            : playerName(goal);

        const tally = goal.goalsToDate != null
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

      return header + rows;
    }).join('');

    return output || `
      <p class="h2h-muted">
        No scoring plays available.
      </p>
    `;
  }

  /*
    GOALTENDING SUMMARY
  */

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

    const output = teams.map(([side, code]) => {
      const players = by[side]?.goalies || [];

      return players.map(player => {
        const shots =
          player.shotsAgainst ??
          player.shotsAgainstTotal;

        const saves =
          player.saves ??
          (
            shots != null &&
            player.goalsAgainst != null
              ? num(shots) - num(player.goalsAgainst)
              : null
          );

        const pct =
          player.savePctg ??
          (
            shots > 0 && saves != null
              ? saves / shots
              : null
          );

        const outcome = player.decision || '';

        return `
          <div class="h2h-goalie">
            ${teamTag(code)}

            <div>
              <strong>
                ${esc(playerName(player))}
                ${esc(outcome)}
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
    }).join('');

    return output || `
      <p class="h2h-muted">
        Goaltending details unavailable.
      </p>
    `;
  }

  /*
    TEAM STATISTICS
  */

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

    if (!Array.isArray(entries) || !entries.length) {
      return `
        <p class="h2h-muted">
          Team statistics unavailable.
        </p>
      `;
    }

    const away = game.awayTeam.abbrev;
    const home = game.homeTeam.abbrev;

    const rows = entries
      .filter(item =>
        statLabels[item.category] ||
        statLabels[item.name]
      )
      .map(item => {
        const label =
          statLabels[item.category] ||
          statLabels[item.name];

        const awayValue =
          item.awayValue ??
          item.away ??
          '—';

        const homeValue =
          item.homeValue ??
          item.home ??
          '—';

        return `
          <div class="h2h-stat">
            <strong>${esc(awayValue)}</strong>
            <span>${esc(label)}</span>
            <strong>${esc(homeValue)}</strong>
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
        '<p class="h2h-muted">Team statistics unavailable.</p>'
      }
    `;
  }

  /*
    EXPANDED SCORESHEET
  */

  function scoresheet(payload, game) {
    const summary = payload?.landing?.summary;

    const hasScoring =
      Array.isArray(summary?.scoring);

    const hasBox =
      !!payload?.boxscore?.playerByGameStats;

    if (!hasScoring && !hasBox) {
      return `
        <p class="h2h-muted">
          Detailed scoresheet not available.
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

  /*
    RENDER HEAD-TO-HEAD RESULTS
  */

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

    /*
      W-L-OTL RECORD
    */

    let wins = 0;
    let losses = 0;
    let otLosses = 0;

    for (const game of games) {
      const home =
        game.homeTeam.abbrev === team;

      const own = num(
        (home ? game.homeTeam : game.awayTeam).score
      );

      const against = num(
        (home ? game.awayTeam : game.homeTeam).score
      );

      if (own > against) {
        wins++;
      } else if (overtimeLoss(game)) {
        otLosses++;
      } else {
        losses++;
      }
    }

    summary.innerHTML = `
      <div class="hoist-h2h-record-card">
        <div class="hoist-h2h-record-label">
          RECORD
        </div>

        <div class="hoist-h2h-record-value">
          ${wins}–${losses}–${otLosses}
        </div>

        <div class="hoist-h2h-record-detail">
          W – L – OTL
        </div>
      </div>
    `;

    /*
      INDIVIDUAL MATCHUPS
    */

    list.innerHTML = games.map(game => {
      const home =
        game.homeTeam.abbrev === team;

      const own = num(
        (home ? game.homeTeam : game.awayTeam).score
      );

      const against = num(
        (home ? game.awayTeam : game.homeTeam).score
      );

      const win = own > against;
      const code = other(game, team);
      const id = String(game.id);
      const payload = cache[id];

      const date = String(game.gameDate || '');
      const parsed = new Date(date + 'T12:00:00');

      const formatted = Number.isNaN(parsed.getTime())
        ? date
        : parsed.toLocaleDateString('en-US', {
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
                    workflow to backfill game details.
                  </p>
                `
            }
          </div>
        </details>
      `;
    }).join('');
  }

  /*
    UPDATE SELECTED TEAM
  */

  async function update() {
    widget();

    const sub = $('hoist-h2h-sub');
    const list = $('hoist-h2h-games');

    if (!sub || !list) return;

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

    const opponent = upcoming.length
      ? other(upcoming[0], team)
      : null;

    if (!opponent) {
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
      `${team} vs ${opponent} · loading cached history…`;

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
              `${game.gameDate}-${game.homeTeam.abbrev}-${game.awayTeam.abbrev}`
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

      if (!games.length) {
        paint([], team, opponent, {});
        return;
      }

      let cache = {};

      try {
        cache = await details(games);
      } catch (error) {
        console.warn(
          'Hoist scoresheets unavailable:',
          error
        );
      }

      if (token !== run) return;

      paint(games, team, opponent, cache);

    } catch (error) {
      if (token !== run) return;

      sub.textContent =
        `${team} vs ${opponent} · historical cache unavailable`;

      $('hoist-h2h-summary').innerHTML = '';

      list.innerHTML = `
        <div class="empty">
          ${esc(error.message)}
          Run the Update Head-to-Head History
          GitHub Action.
        </div>
      `;
    }
  }

  /*
    INITIALIZE
  */

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
