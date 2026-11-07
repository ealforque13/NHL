# NHL Central — Version 2

This release preserves the existing static GitHub Pages site and GitHub Actions cache, while adding analytics, a month calendar, NHL scoring leaders, and a 32-team fantasy off-night schedule analyzer.

## Install over the existing repository

1. Extract the ZIP locally. Copy **the contents** (including `.github`, `scripts`, `app.js`, `index.html`, `styles.css`, `v2.js`, `v2.css`) into your existing cloned `ealforque13/NHL` repository. Do not place them in a nested folder. Replace existing files when asked. **Keep the existing `data/` directory**: the update doesn't include it and should not delete it.
2. In GitHub Desktop, commit the changes and click **Push origin**.
3. In GitHub > Actions > **Update NHL data**, click **Run workflow** on `main`. The workflow will refresh standings, schedules and rosters and fetch new `data/club-stats/*.json` and `data/leaders.json` files.
4. Wait for the workflow and subsequent GitHub Pages deployment. Hard refresh https://ealforque13.github.io/NHL/ with Ctrl+Shift+R.
5. Open **Analytics**, **Calendar**, and **Fantasy Planner** in the sidebar.

## Data sources and refresh

`python scripts/update_data.py` downloads the NHL public JSON endpoints on the GitHub Actions runner. Browser requests use same-origin `/data/*.json` only (no CORS dependency). The existing GitHub Actions workflow runs every 15 minutes, though GitHub may delay scheduled runs. Refreshing the website does not itself download fresh NHL data. All NHL API endpoints are unofficial/undocumented and can change.

New endpoints:
- `club-stats/{TEAM}/20262027/2` for each team's skater stats
- `skater-stats-leaders/current?categories=points,goals,assists&limit=20` for league leaders

The Python script retains old JSON on partial endpoint failures and reports failures in `data/metadata.json`. A green workflow check means the job ran, **not** necessarily that every endpoint succeeded. Inspect `data/metadata.json` and workflow logs if a section shows unavailable data.

## Definitions

- Team charts use the latest 10 completed games in the selected team's cached schedule.
- Home/away splits count completed games, and the displayed win rate is wins divided by games (OT losses count as non-wins).
- Fantasy analyzer counts **regular-season games** (gameType 2) on dates the reference team does **not** play, with an optional remaining-games filter. It compares calendar dates in the NHL schedule, not exact start times. It is not a prediction or optimization for a particular fantasy scoring system.
- Calendar shows games on their official `gameDate`; puck-drop details are formatted in the visitor's timezone.
- League scoring leaders are NHL API-provided leader lists, not necessarily the entire league ranking.

## Troubleshooting

- If new features show no data, check the `data/club-stats/` folder and `data/leaders.json` on GitHub after running the workflow.
- If a new endpoint fails, inspect the Actions `Fetch and cache NHL data` step; old schedules/standings should still work.
- Open Chrome F12 > Console and Network to inspect 404s or JavaScript errors.
- This project is not affiliated with the NHL.
