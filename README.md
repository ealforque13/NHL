# NHL Central — GitHub Pages CORS Fix

This version uses a GitHub Actions job to download NHL data into `data/` JSON files. The browser reads those files from GitHub Pages instead of calling the NHL API directly, avoiding CORS errors.

## Install into your existing `ealforque13/NHL` repository

1. Extract the ZIP.
2. Open https://github.com/ealforque13/NHL and choose **Add file → Upload files**.
3. Upload `index.html`, `styles.css`, `app.js`, `README.md`, **the `scripts` folder**, and **the `.github` folder** into the repository root. GitHub's browser uploader may not reliably preserve hidden `.github` folders on some systems; if it doesn't, use the manual workflow instructions below.
4. When prompted, overwrite the existing website files by committing the changes. If GitHub's uploader refuses duplicates, edit or delete the old files first, or use GitHub Desktop to replace them.
5. Check that `.github/workflows/update-nhl-data.yml` and `scripts/update_data.py` exist in the repository.
6. Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**; save. This allows the workflow to commit cached JSON files. Repository or organization policies may override this setting.
7. Go to **Actions → Update NHL data → Run workflow → Run workflow**. Wait for the job to complete (first run can take a few minutes).
8. Check that `data/standings.json`, `data/schedules/MTL.json`, and `data/rosters/MTL.json` exist. Then visit https://ealforque13.github.io/NHL/ and hard-refresh (Ctrl+Shift+R).

**Note:** A new GitHub Pages deployment may take a few minutes after the data commit. GitHub Actions schedules are best-effort and can be delayed; the website shows the latest cached data, not true live play-by-play.

## If `.github` folder did not upload

On the GitHub repository homepage choose **Add file → Create new file**. Enter this exact filename:

`.github/workflows/update-nhl-data.yml`

Paste the contents of the included file with that name and commit it. Repeat for `scripts/update_data.py` if necessary.

## Test the data

- https://ealforque13.github.io/NHL/data/standings.json
- https://ealforque13.github.io/NHL/data/schedules/MTL.json

Both should show JSON after the workflow commits data and Pages deploys it.

## How it works

- `scripts/update_data.py` fetches standings plus a season schedule and current roster for all 32 teams (65 requests total).
- `.github/workflows/update-nhl-data.yml` runs on demand and requests refreshes every 15 minutes.
- `app.js` loads same-origin `./data/...` files, so the NHL API's missing CORS headers do not affect visitors.
- A failed API request preserves an existing file rather than replacing it with invalid JSON.

If the workflow is green but there are missing files, check the workflow log for API errors. This project is unofficial and subject to NHL endpoint changes and usage terms.
