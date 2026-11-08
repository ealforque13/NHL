
'use strict';

/*
  HOIST OFFICIAL — MATCHUP INTELLIGENCE

  Cached JSON only.
  No direct NHL API calls.

  Head to Head:
  - Independent column sorting
  - GP minimum filter
  - Dynamic team abbreviations

  Hot Players:
  - Last five games
  - Point indicators
  - Active streak descriptions
*/

(() => {

  const $m = id => document.getElementById(id);

  const escape = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  const cache = new Map();

  let generation = 0;

  /*
    Each matchup table has its own
    sorting configuration.
  */

  const tableSort = {
    'mi-left': {
      key: 'ppg',
      direction: 'desc'
    },
    'mi-right': {
      key: 'ppg',
      direction: 'desc'
    }
  };

  const sortColumns = {
    goals: 'g',
    assists: 'a',
    points: 'pts',
    ppg: 'ppg'
  };

  const isFinal = game =>
    ['FINAL', 'OFF'].includes(game.gameState);

  const sum = (rows, key) =>
    rows.reduce(
      (n, row) => n + (Number(row[key]) || 0),
      0
    );

  /* ==========================================
     PLAYER HEADSHOTS
     ========================================== */

  const picture = (player, club) =>
    (
      typeof player.headshot === 'string' &&
      player.headshot.startsWith('https://')
    )
      ? player.headshot
      : `https://assets.nhle.com/mugs/nhl/20262027/${encodeURIComponent(club)}/${encodeURIComponent(player.id)}.png`;

  const avatar = (player, club) => {

    const fallback =
      `https://assets.nhle.com/mugs/nhl/20252026/${encodeURIComponent(club)}/${encodeURIComponent(player.id)}.png`;

    const initials = String(player.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map(x => x[0])
      .slice(0, 2)
      .join('');

    return `
      <img
        src="${escape(picture(player, club))}"
        alt="${escape(player.name)}"
        loading="lazy"
        onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${escape(fallback)}'}else{this.style.display='none';this.nextElementSibling.style.display='inline-flex'}"
      >

      <span
        class="mi-avatar-fallback"
        style="display:none"
      >
        ${escape(initials)}
      </span>
    `;
  };

  /* ==========================================
     LAST FIVE GAME POINT INDICATORS
     ========================================== */

  function lastFiveBoxes(games) {

    const recent = games.slice(-5);

    const padded = [
      ...Array(
        Math.max(0, 5 - recent.length)
      ).fill(null),
      ...recent
    ];

    return `
      <span
        class="hoist-last-five-boxes"
        aria-label="Point production in last five games"
      >
        ${padded.map(game => {

          const status = game === null
            ? 'did-not-play'
            : Number(game.points) > 0
              ? 'has-point'
              : 'no-point';

          const label = game === null
            ? 'No game available'
            : Number(game.points) > 0
              ? `${Number(game.points)} point(s)`
              : '0 points';

          return `
            <span
              class="hoist-last-five-box ${status}"
              title="${escape(label)}"
              aria-label="${escape(label)}"
            ></span>
          `;

        }).join('')}
      </span>
    `;
  }

  /* ==========================================
     LOAD CACHED MATCHUP DATA
     ========================================== */

  async function load(code) {

    if (cache.has(code)) {
      return cache.get(code);
    }

    const response = await fetch(
      `./data/matchups/${encodeURIComponent(code)}.json`,
      {
        cache: 'no-cache'
      }
    );

    if (!response.ok) {
      throw Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (!Array.isArray(payload.players)) {
      throw Error('Invalid matchup data');
    }

    cache.set(code, payload);

    return payload;
  }

  /* ==========================================
     MATCHUP TABLE SORTING
     ========================================== */

  function sortRows(rows, targetId) {

    const config = tableSort[targetId];

    const key = sortColumns[config.key];

    const direction =
      config.direction === 'desc' ? -1 : 1;

    rows.sort((a, b) => {

      const valueA = Number(a[key]) || 0;
      const valueB = Number(b[key]) || 0;

      const difference =
        (valueA - valueB) * direction;

      if (difference !== 0) {
        return difference;
      }

      return (
        b.pts - a.pts ||
        b.gp - a.gp ||
        String(a.player.name).localeCompare(
          String(b.player.name)
        )
      );
    });

    return rows;
  }

  /* ==========================================
     UPDATE SORT HEADER INDICATORS
     ========================================== */

  function updateSortHeaders(targetId) {

    const tbody = $m(targetId);

    if (!tbody) return;

    const table = tbody.closest('table');

    if (!table) return;

    const config = tableSort[targetId];

    table.querySelectorAll(
      'th[data-sort]'
    ).forEach(th => {

      const key = th.dataset.sort;

      const active = key === config.key;

      const button = th.querySelector(
        '.hoist-sort-button'
      );

      const arrow = th.querySelector(
        '.hoist-sort-arrow'
      );

      th.classList.toggle(
        'hoist-sort-active',
        active
      );

      th.setAttribute(
        'aria-sort',
        active
          ? config.direction === 'desc'
            ? 'descending'
            : 'ascending'
          : 'none'
      );

      if (button) {
        button.setAttribute(
          'aria-label',
          `Sort by ${button.dataset.label || key}, ${
            active && config.direction === 'desc'
              ? 'ascending'
              : 'descending'
          }`
        );
      }

      if (arrow) {

        arrow.textContent = active
          ? config.direction === 'desc'
            ? '▼'
            : '▲'
          : '';

      }

    });
  }

  /* ==========================================
     MATCHUP LEADERBOARD
     ========================================== */

  function leaderboard(
    payload,
    opponent,
    targetId,
    club
  ) {

    const minGames = Number(
      $m('mi-min-games')?.value ?? 1
    );

    const rows = payload.players.map(player => {

      const games = (player.games || []).filter(
        game => game.opponent === opponent
      );

      const gp = games.length;

      const pts = sum(games, 'points');

      return {
        player,
        gp,
        g: sum(games, 'goals'),
        a: sum(games, 'assists'),
        pts,
        ppg: gp ? pts / gp : 0
      };

    }).filter(
      row => row.gp >= minGames
    );

    sortRows(rows, targetId);

    rows.splice(12);

    $m(targetId).innerHTML = rows.length
      ? rows.map(row => `
          <tr>

            <td>
              <span class="mi-person">

                ${avatar(row.player, club)}

                <span>

                  <strong>
                    ${escape(row.player.name)}
                  </strong>

                  <small>
                    #${escape(row.player.number ?? '—')}
                    · ${escape(row.player.position)}
                  </small>

                </span>

              </span>
            </td>

            <td>${row.gp}</td>

            <td>${row.g}</td>

            <td>${row.a}</td>

            <td>
              <strong>${row.pts}</strong>
            </td>

            <td>
              ${row.ppg.toFixed(2)}
            </td>

          </tr>
        `).join('')
      : `
        <tr>
          <td colspan="6">
            No completed games against this opponent
            with the selected minimum GP.
          </td>
        </tr>
      `;

    updateSortHeaders(targetId);

    return rows.length;
  }

  /* ==========================================
     HOT PLAYERS — LAST 5 GAMES
     ========================================== */

  function hotPlayers(payload, club) {

    const rows = payload.players.map(player => {

      const recent = (player.games || [])
        .filter(
          game =>
            String(game.season) === '20262027'
        )
        .slice(-5);

      const pts = sum(recent, 'points');

      let streak = 0;

      for (
        let i = recent.length - 1;
        i >= 0 &&
        Number(recent[i].points) > 0;
        i--
      ) {
        streak++;
      }

      return {
        player,
        recent,
        gp: recent.length,
        pts,
        g: sum(recent, 'goals'),
        a: sum(recent, 'assists'),
        streak
      };

    })
    .filter(row => row.gp)
    .sort(
      (a, b) =>
        b.pts - a.pts ||
        b.streak - a.streak ||
        b.g - a.g
    )
    .slice(0, 8);

    $m('mi-hot').innerHTML = rows.length
      ? rows.map(row => {

          const isStreak = row.streak >= 3;

          const performance = isStreak
            ? `${row.streak}-game point streak`
            : `${row.pts} ${row.pts === 1 ? 'point' : 'points'} in last ${row.gp} ${row.gp === 1 ? 'game' : 'games'}`;

          return `
            <tr class="hoist-hot-player-row">

              <td class="hoist-hot-player-name">

                <span class="mi-person">

                  ${avatar(row.player, club)}

                  <span>

                    <strong>
                      ${escape(row.player.name)}
                    </strong>

                    <small>
                      ${lastFiveBoxes(row.recent)}
                    </small>

                  </span>

                </span>

              </td>

              <td class="hoist-hot-stat">
                ${row.g}
              </td>

              <td class="hoist-hot-stat">
                ${row.a}
              </td>

              <td class="hoist-hot-stat">

                <strong>
                  ${row.pts}
                </strong>

                <span
                  class="hoist-hot-performance${isStreak ? ' is-streak' : ''}"
                >
                  ${escape(performance)}
                </span>

              </td>

            </tr>
          `;

        }).join('')
      : `
        <tr>
          <td colspan="4">
            No completed games available this season.
          </td>
        </tr>
      `;
  }

  /* ==========================================
     UPDATE MATCHUP INTELLIGENCE
     ========================================== */

  async function update() {

    const token = ++generation;

    const selected = state.team;

    const next = [...state.schedule]
      .filter(
        game =>
          game.gameType === 2 &&
          !isFinal(game)
      )
      .sort(
        (a, b) =>
          a.gameDate.localeCompare(
            b.gameDate
          )
      )[0];

    const opp = next && (
      next.homeTeam?.abbrev === selected
        ? next.awayTeam?.abbrev
        : next.homeTeam?.abbrev
    );

    /* Titles */

    $m('mi-title').textContent =
      'Player Statistics';

    $m('mi-left-title').textContent = opp
      ? `${selected} players vs ${opp}`
      : `${selected} players`;

    $m('mi-right-title').textContent = opp
      ? `${opp} players vs ${selected}`
      : 'Opponent players';

    /* Loading */

    for (
      const id of [
        'mi-left',
        'mi-right',
        'mi-hot'
      ]
    ) {

      $m(id).innerHTML = `
        <tr>
          <td colspan="${
            id === 'mi-hot' ? 4 : 6
          }">
            Loading cached player statistics…
          </td>
        </tr>
      `;
    }

    $m('mi-note').textContent =
      'Loading historical matchup data…';

    try {

      const [ours, theirs] =
        await Promise.allSettled([
          load(selected),
          opp
            ? load(opp)
            : Promise.resolve(null)
        ]);

      if (token !== generation) {
        return;
      }

      /* Hot Players */

      if (ours.status === 'fulfilled') {

        hotPlayers(
          ours.value,
          selected
        );

      } else {

        $m('mi-hot').innerHTML = `
          <tr>
            <td colspan="4">
              Player data unavailable.
              Run the matchup data workflow.
            </td>
          </tr>
        `;
      }

      /* Matchup tables */

      if (!opp) {

        $m('mi-left').innerHTML =
          $m('mi-right').innerHTML = `
            <tr>
              <td colspan="6">
                No upcoming regular-season
                opponent found.
              </td>
            </tr>
          `;

      } else {

        if (ours.status === 'fulfilled') {

          leaderboard(
            ours.value,
            opp,
            'mi-left',
            selected
          );

        } else {

          $m('mi-left').innerHTML = `
            <tr>
              <td colspan="6">
                Matchup data unavailable.
              </td>
            </tr>
          `;
        }

        if (theirs.status === 'fulfilled') {

          leaderboard(
            theirs.value,
            selected,
            'mi-right',
            opp
          );

        } else {

          $m('mi-right').innerHTML = `
            <tr>
              <td colspan="6">
                Opponent data unavailable.
              </td>
            </tr>
          `;
        }
      }

      updateSortHeaders('mi-left');
      updateSortHeaders('mi-right');

      /* Data status */

      const partial = [
        ours,
        theirs
      ].some(
        x =>
          x.status === 'fulfilled' &&
          x.value &&
          !x.value.complete
      );

      $m('mi-note').textContent =
        `Regular-season games, 2024–25 through 2026–27 · Active roster skaters · Click column headers to sort · ${
          partial
            ? 'Some player logs unavailable; rankings may be incomplete.'
            : 'Minimum GP filter available.'
        }`;

    } catch (error) {

      if (token === generation) {

        $m('mi-note').textContent =
          `Unable to load matchup data: ${error.message}`;

      }
    }
  }

  /* ==========================================
     INITIALIZE
     ========================================== */

  document.addEventListener(
    'DOMContentLoaded',
    () => {

      /*
        Observe successful schedule rendering
        without modifying app.js.
      */

      const original = renderGames;

      renderGames = function (...args) {

        const result = original.apply(
          this,
          args
        );

        update();

        return result;
      };

      /* GP filter */

      $m('mi-min-games').addEventListener(
        'change',
        update
      );

      /* Clickable sorting headers */

      ['mi-left', 'mi-right'].forEach(targetId => {

        const tbody = $m(targetId);

        const table = tbody?.closest('table');

        if (!table) return;

        table.querySelectorAll(
          'th[data-sort] .hoist-sort-button'
        ).forEach(button => {

          button.addEventListener('click', () => {

            const key = button.closest('th').dataset.sort;

            if (!sortColumns[key]) return;

            const config = tableSort[targetId];

            if (config.key === key) {

              config.direction =
                config.direction === 'desc'
                  ? 'asc'
                  : 'desc';

            } else {

              config.key = key;
              config.direction = 'desc';

            }

            update();

          });

        });

      });

      updateSortHeaders('mi-left');
      updateSortHeaders('mi-right');

      update();
    }
  );

})();
