
'use strict';

/* ==========================================
   HOIST OFFICIAL — NHL DASHBOARD V2

   Calendar updates:
   - Opponent logos only (no abbreviations)
   - W = Win
   - L = Regulation loss
   - O = Overtime / shootout loss
   - Result letter appears before final score
   - Home games remain red
   - Away games remain blue
   - Today indicator and legend retained

   Data comes from local JSON files.
   ========================================== */

(() => {
  const el = id => document.getElementById(id);

  const safe = s => String(s ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );

  const code = o =>
    typeof o === 'string'
      ? o
      : (o?.default || o?.en || '');

  const num = n => Number(n) || 0;

  const gameFinal = g =>
    ['FINAL', 'OFF'].includes(g.gameState) &&
    g.homeTeam?.score != null &&
    g.awayTeam?.score != null;

  const isHome = (g, t) =>
    g.homeTeam?.abbrev === t;

  /* ==========================================
     GAME RESULT CLASSIFICATION
     ========================================== */

  function result(g, t) {
    if (!gameFinal(g)) return '';

    const home = isHome(g, t);
    const own = home ? g.homeTeam : g.awayTeam;
    const other = home ? g.awayTeam : g.homeTeam;

    // All wins, including OT/SO wins, count as W.
    if (num(own.score) > num(other.score)) {
      return 'W';
    }

    // NHL schedule data may expose the ending
    // period in either of these fields.
    const periodType = String(
      g.gameOutcome?.lastPeriodType ||
      g.periodDescriptor?.periodType ||
      ''
    ).toUpperCase();

    if (periodType === 'OT' || periodType === 'SO') {
      return 'O';
    }

    // A final loss without an OT/SO indicator
    // is treated as a regulation loss.
    return 'L';
  }

  const v = {
    month: new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    ),
    stats: null,
    leaders: null,
    schedules: new Map(),
    request: 0
  };

  const getLocal = async path => {
    const r = await fetch(`data/${path}`, {
      cache: 'no-store'
    });

    if (!r.ok) {
      throw Error(`${path}: HTTP ${r.status}`);
    }

    return r.json();
  };

  function dateKey(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function gameTime(g) {
    if (!g.startTimeUTC) return 'TBA';

    const d = new Date(g.startTimeUTC);

    if (Number.isNaN(d.getTime())) return 'TBA';

    return d.toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /* ==========================================
     CALENDAR STYLES
     ========================================== */

  function installCalendarStyles() {
    if (document.getElementById(
      'hoist-calendar-home-away-styles'
    )) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'hoist-calendar-home-away-styles';

    style.textContent = `
      /* HOME GAME - RED */

      #v2-calendar .v2-game.hoist-home-game {
        background: rgba(220, 38, 38, .20) !important;
        border: 1px solid rgba(239, 68, 68, .58) !important;
        border-radius: 8px !important;
        color: inherit;
      }

      #v2-calendar .v2-game.hoist-home-game:hover {
        background: rgba(220, 38, 38, .35) !important;
      }

      /* AWAY GAME - BLUE */

      #v2-calendar .v2-game.hoist-away-game {
        background: rgba(37, 99, 235, .20) !important;
        border: 1px solid rgba(59, 130, 246, .58) !important;
        border-radius: 8px !important;
        color: inherit;
      }

      #v2-calendar .v2-game.hoist-away-game:hover {
        background: rgba(37, 99, 235, .35) !important;
      }

      /* COMPACT GAME TILE */

      #v2-calendar .hoist-calendar-game {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 5px !important;
        width: 100%;
        padding: 7px 3px !important;
        text-align: center;
        white-space: normal !important;
      }

      /* OPPONENT LOGO */

      #v2-calendar .hoist-calendar-game
      .hoist-calendar-logo {
        display: block;
        width: 30px !important;
        height: 30px !important;
        min-width: 30px !important;
        max-width: 30px !important;
        max-height: 30px !important;
        object-fit: contain;
        flex: none !important;
        margin: 0 auto !important;
      }

      /* SCORE AND RESULT */

      #v2-calendar .hoist-calendar-score {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 12px !important;
        font-weight: 800;
        line-height: 1.2;
        white-space: nowrap;
      }

      #v2-calendar .hoist-result-letter {
        display: inline-block;
        font-weight: 900;
        font-size: 11px;
        line-height: 1.2;
      }

      #v2-calendar .hoist-result-w {
        color: #4ade80;
      }

      #v2-calendar .hoist-result-l {
        color: #fb7185;
      }

      #v2-calendar .hoist-result-o {
        color: #fbbf24;
      }

      /* TODAY */

      #v2-calendar .hoist-today {
        border: 2px solid #60a5fa !important;
        background: rgba(59, 130, 246, .10) !important;
        position: relative;
      }

      #v2-calendar .hoist-today-badge {
        position: absolute;
        top: 5px;
        right: 5px;
        padding: 2px 4px;
        border-radius: 4px;
        background: #2563eb;
        color: #fff;
        font-size: 8px;
        font-weight: 800;
        letter-spacing: .04em;
        pointer-events: none;
      }

      #v2-calendar .hoist-today > .v2-day-number {
        color: #93c5fd;
      }

      /* HOME / AWAY LEGEND */

      .hoist-calendar-legend {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 24px;
        padding: 12px 0 4px;
      }

      .hoist-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 650;
      }

      .hoist-legend-dot {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .hoist-legend-home {
        background: rgba(220, 38, 38, .65);
        border: 1px solid #ef4444;
      }

      .hoist-legend-away {
        background: rgba(37, 99, 235, .65);
        border: 1px solid #3b82f6;
      }

      @media (max-width: 600px) {
        #v2-calendar .hoist-calendar-game
        .hoist-calendar-logo {
          width: 22px !important;
          height: 22px !important;
          min-width: 22px !important;
          max-width: 22px !important;
          max-height: 22px !important;
        }

        #v2-calendar .hoist-calendar-score {
          font-size: 10px !important;
          gap: 2px;
        }

        #v2-calendar .hoist-result-letter {
          font-size: 10px;
        }

        .hoist-calendar-legend {
          gap: 16px;
        }

        .hoist-legend-item {
          font-size: 11px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function installCalendarLegend() {
    const calendarElement = el('v2-calendar');

    if (!calendarElement) return;

    let legend = document.querySelector(
      '.hoist-calendar-legend'
    );

    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'hoist-calendar-legend';

      calendarElement.insertAdjacentElement(
        'afterend',
        legend
      );
    }

    legend.innerHTML = `
      <span class="hoist-legend-item">
        <span class="hoist-legend-dot hoist-legend-home"></span>
        Home Game
      </span>

      <span class="hoist-legend-item">
        <span class="hoist-legend-dot hoist-legend-away"></span>
        Away Game
      </span>
    `;
  }

  /* ==========================================
     ANALYTICS — GOALS AND RESULTS
     ========================================== */

  function renderChart() {
    const played = [...state.schedule]
      .filter(gameFinal)
      .sort((a, b) =>
        a.gameDate.localeCompare(b.gameDate)
      );

    const recent = played.slice(-10);

    if (!recent.length) {
      el('v2-chart').innerHTML =
        '<div class="empty">No completed regular-season games yet.</div>';

      el('v2-form').textContent = '—';

      el('v2-splits').innerHTML =
        '<div class="empty">No completed games available.</div>';

      return;
    }

    const max = Math.max(
      1,
      ...recent.flatMap(g => [
        num(g.homeTeam.score),
        num(g.awayTeam.score)
      ])
    );

    el('v2-chart').innerHTML = recent.map(g => {
      const gf = num(
        (isHome(g, state.team)
          ? g.homeTeam
          : g.awayTeam).score
      );

      const ga = num(
        (isHome(g, state.team)
          ? g.awayTeam
          : g.homeTeam).score
      );

      return `
        <div
          class="v2-bar-group"
          title="${safe(g.gameDate)} · ${safe(result(g, state.team))} ${gf}-${ga}"
        >
          <div class="v2-bars">
            <span
              class="v2-bar-for"
              style="height:${Math.max(3, gf / max * 100)}%"
            ></span>

            <span
              class="v2-bar-against"
              style="height:${Math.max(3, ga / max * 100)}%"
            ></span>
          </div>

          <small>
            ${safe(
              (isHome(g, state.team)
                ? g.awayTeam
                : g.homeTeam)?.abbrev
            )}
          </small>
        </div>
      `;
    }).join('');

    const wins = recent.filter(
      g => result(g, state.team) === 'W'
    ).length;

    el('v2-form').textContent =
      `${wins}-${recent.length - wins} last ${recent.length} · Blue: goals for · Red: goals against`;

    const split = home => {
      const games = played.filter(
        g => isHome(g, state.team) === home
      );

      const wins = games.filter(
        g => result(g, state.team) === 'W'
      ).length;

      const gf = games.reduce(
        (n, g) => n + num(
          (home ? g.homeTeam : g.awayTeam).score
        ),
        0
      );

      const ga = games.reduce(
        (n, g) => n + num(
          (home ? g.awayTeam : g.homeTeam).score
        ),
        0
      );

      return {
        gp: games.length,
        wins,
        gf,
        ga
      };
    };

    el('v2-splits').innerHTML = [
      ['Home', split(true)],
      ['Away', split(false)]
    ].map(([label, s]) => `
      <div class="v2-split">
        <strong>${label}</strong>
        <span>${s.wins} W / ${s.gp} GP</span>
        <span>GF ${s.gf} · GA ${s.ga}</span>
        <span>
          ${s.gp ? (s.wins / s.gp * 100).toFixed(0) : '—'}% win rate
        </span>
      </div>
    `).join('');
  }

  /* ==========================================
     TEAM PLAYER STATISTICS
     ========================================== */

  function players() {
    const raw = v.stats;
    const skaters = raw?.skaters || [];
    const key = el('v2-player-filter').value;

    if (!skaters.length) {
      el('v2-players').innerHTML =
        '<tr><td colspan="6">Player statistics unavailable. Run the GitHub Actions data update.</td></tr>';
      return;
    }

    const list = [...skaters]
      .sort(
        (a, b) =>
          num(b[key]) - num(a[key]) ||
          num(b.points) - num(a.points)
      )
      .slice(0, 30);

    el('v2-players').innerHTML = list.map(p => {
      const gp = num(p.gamesPlayed);
      const pts = num(p.points);

      return `
        <tr>
          <td>
            ${safe(code(p.firstName))}
            ${safe(code(p.lastName))}
          </td>
          <td>${gp}</td>
          <td>${num(p.goals)}</td>
          <td>${num(p.assists)}</td>
          <td>${pts}</td>
          <td>${gp ? (pts / gp).toFixed(2) : '—'}</td>
        </tr>
      `;
    }).join('');
  }

  /* ==========================================
     NHL SCORING LEADERS
     ========================================== */

  function leaders() {
    const key = el('v2-leader-filter').value;
    const data = v.leaders?.[key] || [];

    el('v2-leaders').innerHTML = data.length
      ? data.slice(0, 20).map((p, i) => `
          <div class="v2-leader">
            <b>${i + 1}</b>

            <span>
              ${safe(code(p.firstName))}
              ${safe(code(p.lastName))}
              <small>${safe(p.teamAbbrev || '')}</small>
            </span>

            <strong>${num(p.value)}</strong>
          </div>
        `).join('')
      : '<div class="empty">League leader data unavailable. Check the data refresh workflow.</div>';
  }

  /* ==========================================
     LOAD LOCAL STATISTICS
     ========================================== */

  async function loadStats() {
    const token = ++v.request;

    v.stats = null;
    players();

    const [stats, leadersData] =
      await Promise.allSettled([
        getLocal(`club-stats/${state.team}.json`),
        v.leaders
          ? Promise.resolve(v.leaders)
          : getLocal('leaders.json')
      ]);

    if (token !== v.request) return;

    v.stats =
      stats.status === 'fulfilled'
        ? stats.value
        : null;

    if (leadersData.status === 'fulfilled') {
      v.leaders = leadersData.value;
    }

    players();
    leaders();
  }

  /* ==========================================
     INTERACTIVE CALENDAR
     ========================================== */

  function calendar() {
    const y = v.month.getFullYear();
    const m = v.month.getMonth();
    const today = dateKey(new Date());

    el('v2-month-label').textContent =
      v.month.toLocaleDateString('en-CA', {
        month: 'long',
        year: 'numeric'
      });

    const games = new Map();

    state.schedule.forEach(g => {
      if (!games.has(g.gameDate)) {
        games.set(g.gameDate, []);
      }

      games.get(g.gameDate).push(g);
    });

    const first = new Date(y, m, 1).getDay();
    const last = new Date(y, m + 1, 0).getDate();

    let out = '';

    for (let i = 0; i < first; i++) {
      out += '<div class="v2-day v2-blank"></div>';
    }

    for (let day = 1; day <= last; day++) {
      const date =
        `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const entries = games.get(date) || [];
      const isToday = date === today;

      out += `
        <div
          class="v2-day ${isToday ? 'hoist-today' : ''}"
          data-calendar-date="${date}"
        >
          <b class="v2-day-number">${day}</b>

          ${isToday
            ? '<span class="hoist-today-badge">TODAY</span>'
            : ''
          }

          ${entries.map(g => {
            const home = isHome(g, state.team);

            const opp = home
              ? g.awayTeam
              : g.homeTeam;

            const abbreviation = opp?.abbrev || 'MTL';
            const homeAway = home ? 'vs' : '@';

            const locationClass = home
              ? 'hoist-home-game'
              : 'hoist-away-game';

            const final = gameFinal(g);
            const resultLetter = final
              ? result(g, state.team)
              : '';

            const gameClass = final
              ? resultLetter === 'W'
                ? 'v2-win'
                : 'v2-loss'
              : '';

            const finalScore = final
              ? `${num(g.awayTeam.score)}-${num(g.homeTeam.score)}`
              : '';

            // Final games: result letter + score.
            // Upcoming games: time only.
            const gameInfo = final
              ? `${resultLetter} ${finalScore}`
              : gameTime(g);

            const resultClass =
              resultLetter === 'W'
                ? 'hoist-result-w'
                : resultLetter === 'O'
                  ? 'hoist-result-o'
                  : 'hoist-result-l';

            const scoreHtml = final
              ? `
                <span class="hoist-calendar-score">
                  <span class="hoist-result-letter ${resultClass}">
                    ${resultLetter}
                  </span>
                  <span>${safe(finalScore)}</span>
                </span>
              `
              : `
                <span class="hoist-calendar-score">
                  ${safe(gameTime(g))}
                </span>
              `;

            return `
              <button
                type="button"
                class="v2-game hoist-calendar-game ${locationClass} ${gameClass}"
                data-date="${date}"
                data-game="${safe(g.id || '')}"
                title="${safe(homeAway)} ${safe(abbreviation)} · ${safe(gameInfo)}"
              >
                <img
                  class="hoist-calendar-logo"
                  src="${logo(abbreviation)}"
                  alt="${safe(abbreviation)} logo"
                  loading="lazy"
                  onerror="this.style.display='none'"
                >

                ${scoreHtml}
              </button>
            `;
          }).join('')}
        </div>
      `;
    }

    el('v2-calendar').innerHTML = out;

    installCalendarLegend();
  }

  /* ==========================================
     CALENDAR GAME DETAILS
     ========================================== */

  function selectCalendar(e) {
    const b = e.target.closest('[data-date]');

    if (!b) return;

    const g = state.schedule.find(
      g =>
        g.gameDate === b.dataset.date &&
        String(g.id || '') === b.dataset.game
    );

    if (!g) return;

    const opponent = isHome(g, state.team)
      ? g.awayTeam
      : g.homeTeam;

    el('v2-calendar-detail').textContent =
      `${g.gameDate} · ` +
      `${isHome(g, state.team) ? 'Home vs' : 'Away at'} ` +
      `${opponent?.abbrev || 'opponent'} · ` +
      (
        gameFinal(g)
          ? `${result(g, state.team)} · Final: ${g.awayTeam.score}–${g.homeTeam.score}`
          : g.startTimeUTC
            ? new Date(g.startTimeUTC).toLocaleString()
            : 'Time TBA'
      );
  }

  /* ==========================================
     FANTASY PLANNER
     ========================================== */

  async function fantasy() {
    const ref = el('v2-fantasy-team').value;

    const remaining =
      el('v2-fantasy-mode').value === 'remaining';

    el('v2-fantasy-status').textContent =
      'Comparing 32 team schedules…';

    const codes = TEAMS.map(t => t.code);

    const outcomes = await Promise.all(
      codes.map(async c => {
        try {
          if (!v.schedules.has(c)) {
            const d = await getLocal(
              `schedules/${c}.json`
            );

            v.schedules.set(c, d.games || []);
          }

          return {
            code: c,
            games: v.schedules.get(c)
          };
        } catch {
          return {
            code: c,
            games: null
          };
        }
      })
    );

    const reference = outcomes.find(
      x => x.code === ref
    );

    if (!reference?.games) {
      el('v2-fantasy-status').textContent =
        'Reference schedule unavailable. Run the data workflow.';
      return;
    }

    const today = dateKey(new Date());

    const valid = g =>
      g.gameType === 2 &&
      (!remaining || g.gameDate >= today);

    const occupied = new Set(
      reference.games
        .filter(valid)
        .map(g => g.gameDate)
    );

    const rows = outcomes
      .filter(x => x.code !== ref && x.games)
      .map(x => {
        const games = x.games.filter(valid);

        return {
          code: x.code,
          total: games.length,
          off: games.filter(
            g => !occupied.has(g.gameDate)
          ).length
        };
      })
      .sort(
        (a, b) =>
          b.off - a.off ||
          a.code.localeCompare(b.code)
      );

    el('v2-fantasy-results').innerHTML =
      rows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${safe(team(r.code).name)}</td>
          <td><strong>${r.off}</strong></td>
          <td>${r.total}</td>
        </tr>
      `).join('');

    el('v2-fantasy-status').textContent =
      `Compared ${rows.length + 1} teams · ` +
      `${remaining
        ? 'Remaining games (from today)'
        : 'Full regular season'} · ` +
      `${outcomes.filter(x => !x.games).length} schedules unavailable`;
  }

  /* ==========================================
     TEAM CHANGE HANDLER
     ========================================== */

  function onTeam() {
    renderChart();
    calendar();
    loadStats();
  }

  /* ==========================================
     INITIALIZATION
     ========================================== */

  document.addEventListener('DOMContentLoaded', () => {
    installCalendarStyles();
    installCalendarLegend();

    const options = TEAMS.map(
      t => `<option value="${t.code}">${safe(t.name)}</option>`
    ).join('');

    el('v2-fantasy-team').innerHTML = options;
    el('v2-fantasy-team').value = state.team;

    el('v2-player-filter').addEventListener(
      'change',
      players
    );

    el('v2-leader-filter').addEventListener(
      'change',
      leaders
    );

    el('v2-prev').addEventListener('click', () => {
      v.month = new Date(
        v.month.getFullYear(),
        v.month.getMonth() - 1,
        1
      );

      calendar();
    });

    el('v2-next').addEventListener('click', () => {
      v.month = new Date(
        v.month.getFullYear(),
        v.month.getMonth() + 1,
        1
      );

      calendar();
    });

    el('v2-calendar').addEventListener(
      'click',
      selectCalendar
    );

    el('v2-fantasy-team').addEventListener(
      'change',
      fantasy
    );

    el('v2-fantasy-mode').addEventListener(
      'change',
      fantasy
    );

    // Preserve the original app.js game rendering,
    // then refresh V2 analytics and calendar.
    const originalGames = renderGames;

    renderGames = function (...args) {
      const output = originalGames(...args);
      onTeam();
      return output;
    };

    document
      .querySelector('[data-tab="fantasy"]')
      .addEventListener('click', fantasy);

    loadStats();
    calendar();
  });
})();
