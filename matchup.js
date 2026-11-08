
'use strict';

/*
  HOIST OFFICIAL — MATCHUP INTELLIGENCE
  Cached JSON only. No direct NHL API calls.
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

    const initials = player.name
      .split(/\s+/)
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
     LAST 5 GAME POINT INDICATORS

     Red = Player recorded 1+ points
     Empty = Player recorded 0 points
     Dashed = No game data available

     Oldest game on left, newest on right.
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
     MATCHUP LEADERBOARD
     ========================================== */

  function leaderboard(
    payload,
    opponent,
    targetId,
    club
  ) {

    const rows = payload.players.map(player => {

      const games = player.games.filter(
        game => game.opponent === opponent
      );

      return {
        player,
        gp: games.length,
        g: sum(games, 'goals'),
        a: sum(games, 'assists'),
        pts: sum(games, 'points')
      };

    }).filter(
      row =>
        row.gp >= Number(
          $m('mi-min-games').value
        )
    );

    const sort = $m('mi-sort').value;

    const metric = row =>
      sort === 'ppg'
        ? row.pts / row.gp
        : sort === 'points'
          ? row.pts
          : sort === 'goals'
            ? row.g
            : row.a;

    rows.sort(
      (a, b) =>
        metric(b) - metric(a) ||
        b.pts - a.pts ||
        b.gp - a.gp
    );

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
              ${(row.pts / row.gp).toFixed(2)}
            </td>
          </tr>
        `).join('')
      : `
        <tr>
          <td colspan="6">
            No completed games against this opponent
            in the covered seasons.
          </td>
        </tr>
      `;

    return rows.length;
  }

  /* ==========================================
     HOT PLAYERS — LAST 5 GAMES

     Columns:
     PLAYER | G | A | PTS | PTS/GP

     Performance sentence appears underneath
     the four statistical columns.

     Player name, headshot, and five-game boxes
     remain unchanged.
     ========================================== */

  function performanceText(row) {

    if (row.streak >= 3) {
      return `${row.streak}-game point streak`;
    }

    return `${row.pts} ${
      row.pts === 1 ? 'point' : 'points'
    } in last ${row.gp} ${
      row.gp === 1 ? 'game' : 'games'
    }`;
  }

  function hotPlayers(payload, club) {

    const rows = payload.players.map(player => {

      const recent = player.games
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
      ? rows.map(row => `

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
              <strong>${row.pts}</strong>
            </td>

            <td class="hoist-hot-stat">
              ${
                row.gp
                  ? (row.pts / row.gp).toFixed(2)
                  : '—'
              }
            </td>

          </tr>

        `).join('')
      : `
        <tr>
          <td colspan="5">
            No completed games available this season.
          </td>
        </tr>
      `;

    /*
      Add a performance sentence to each row
      without adding extra table columns.

      The sentence is absolutely positioned
      within the existing player row.
    */

    const tableRows = $m('mi-hot')
      .querySelectorAll('.hoist-hot-player-row');

    tableRows.forEach((tr, index) => {

      const row = rows[index];

      if (!row) {
        return;
      }

      const summary = document.createElement('span');

      summary.className =
        'hoist-hot-performance' +
        (row.streak >= 3 ? ' is-streak' : '');

      summary.textContent = performanceText(row);

      /*
        Attach to the last statistics cell.
        CSS positions it beneath the entire
        statistics area.
      */

      const statCell = tr.lastElementChild;

      if (statCell) {
        statCell.appendChild(summary);
      }

    });
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

    $m('mi-title').textContent = opp
      ? `${team(selected).name} vs. ${team(opp).name}`
      : 'No upcoming regular-season matchup';

    $m('mi-left-title').textContent =
      `${team(selected).name} vs. opponent`;

    $m('mi-right-title').textContent = opp
      ? `${team(opp).name} vs. ${team(selected).name}`
      : 'Opponent production';

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
            id === 'mi-hot' ? 5 : 6
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
            <td colspan="5">
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
        `Regular-season games, 2024–25 through 2026–27 · Active roster skaters · Sortable matchup rankings · ${
          partial
            ? 'Some player logs unavailable; rankings may be incomplete.'
            : 'Minimum 1 matchup game.'
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
        Observe the original team's successful
        schedule render without modifying app.js.
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

      $m('mi-sort').addEventListener(
        'change',
        update
      );

      $m('mi-min-games').addEventListener(
        'change',
        update
      );

      update();
    }
  );

})();
