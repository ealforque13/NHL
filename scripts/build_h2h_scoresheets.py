
"""Build season-sharded NHL head-to-head scoresheet caches.

Prioritizes the 10 most recent completed regular-season
meetings for every NHL team pairing.

Features:
- Preserves valid cached scoresheets
- Migrates the old combined cache if present
- Detects incomplete cached scoresheets
- Retries failed NHL API requests
- Prioritizes missing games across team pairings
- Saves one JSON file per NHL season
- Keeps files below GitHub's 100 MB limit
- Reports missing and failed game IDs

Run after scripts/build_h2h.py.
"""

import json
import os
import time
import urllib.error
import urllib.request

from collections import Counter
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path


GAMES_FILE = Path("data/head-to-head.json")

OLD_CACHE = Path(
    "data/head-to-head-scoresheets.json"
)

CACHE_DIR = Path(
    "data/head-to-head-scoresheets"
)

MAX_NEW = max(
    0,
    int(os.environ.get("H2H_MAX_NEW", "800"))
)

WORKERS = max(
    1,
    min(
        8,
        int(os.environ.get("H2H_WORKERS", "5"))
    )
)

MAX_SHARD_BYTES = 90 * 1024 * 1024

API_BASE = (
    "https://api-web.nhle.com/v1/gamecenter"
)


# ------------------------------------------
# NHL API
# ------------------------------------------

def get(url):
    last_error = None

    for attempt in range(5):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "HoistOfficial/1.0",
                    "Accept": "application/json",
                }
            )

            with urllib.request.urlopen(
                request,
                timeout=30
            ) as response:
                return json.load(response)

        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
        ) as exc:
            last_error = exc

            if attempt == 4:
                break

            delay = min(16, 2 ** attempt)

            if isinstance(
                exc,
                urllib.error.HTTPError
            ):
                if exc.code in (400, 401, 403, 404):
                    break

                retry_after = exc.headers.get(
                    "Retry-After"
                )

                if retry_after:
                    try:
                        delay = min(
                            60,
                            max(1, int(retry_after))
                        )
                    except ValueError:
                        pass

            time.sleep(delay)

    raise RuntimeError(
        f"Request failed: {url}: {last_error}"
    )


def fetch_game(gid):
    base = f"{API_BASE}/{gid}"

    landing = get(base + "/landing")
    boxscore = get(base + "/boxscore")

    payload = {
        "landing": {
            "summary": landing.get(
                "summary", {}
            ),
            "periodDescriptor": landing.get(
                "periodDescriptor", {}
            ),
            "homeTeam": landing.get(
                "homeTeam", {}
            ),
            "awayTeam": landing.get(
                "awayTeam", {}
            ),
        },
        "boxscore": {
            "playerByGameStats": boxscore.get(
                "playerByGameStats", {}
            ),
            "homeTeam": boxscore.get(
                "homeTeam", {}
            ),
            "awayTeam": boxscore.get(
                "awayTeam", {}
            ),
        },
    }

    if not valid_scoresheet(payload):
        raise RuntimeError(
            f"Incomplete NHL API scoresheet: {gid}"
        )

    return gid, payload


# ------------------------------------------
# VALIDATION
# ------------------------------------------

def season_of(gid):
    gid = str(gid)

    if len(gid) != 10 or not gid.isdigit():
        raise ValueError(
            f"Invalid NHL game ID: {gid}"
        )

    return gid[:4]


def valid_scoresheet(payload):
    """Require usable scoring and player stats."""

    if not isinstance(payload, dict):
        return False

    landing = payload.get("landing")
    boxscore = payload.get("boxscore")

    if not isinstance(landing, dict):
        return False

    if not isinstance(boxscore, dict):
        return False

    summary = landing.get("summary")

    if not isinstance(summary, dict):
        return False

    scoring = summary.get("scoring")

    if not isinstance(scoring, list):
        return False

    player_stats = boxscore.get(
        "playerByGameStats"
    )

    if not isinstance(player_stats, dict):
        return False

    away = player_stats.get("awayTeam")
    home = player_stats.get("homeTeam")

    if not isinstance(away, dict):
        return False

    if not isinstance(home, dict):
        return False

    return True


def completed_regular_season(game):
    try:
        game_type = int(
            game.get("gameType", 0)
        )
    except (TypeError, ValueError):
        return False

    if game_type != 2:
        return False

    state = str(
        game.get("gameState", "")
    ).upper()

    if state not in ("FINAL", "OFF"):
        return False

    home = game.get("homeTeam") or {}
    away = game.get("awayTeam") or {}

    if home.get("score") is None:
        return False

    if away.get("score") is None:
        return False

    return True


# ------------------------------------------
# READ EXISTING CACHES
# ------------------------------------------

def read_games(path):
    payload = json.loads(
        path.read_text(encoding="utf-8")
    )

    if not isinstance(payload, dict):
        raise ValueError(
            f"Invalid cache object: {path}"
        )

    games = payload.get("games")

    if not isinstance(games, dict):
        raise ValueError(
            f"Invalid games structure: {path}"
        )

    return games


def load_existing():
    existing = {}

    sources = []

    if OLD_CACHE.exists():
        sources.append(OLD_CACHE)

    if CACHE_DIR.exists():
        sources.extend(
            sorted(CACHE_DIR.glob("*.json"))
        )

    for path in sources:
        print(
            f"Reading {path}...",
            flush=True
        )

        games = read_games(path)

        for gid, payload in games.items():
            gid = str(gid)

            try:
                season_of(gid)
            except ValueError:
                continue

            # Never replace a valid entry with
            # an incomplete entry.
            if valid_scoresheet(payload):
                existing[gid] = payload

            elif gid not in existing:
                existing[gid] = payload

    valid_count = sum(
        valid_scoresheet(payload)
        for payload in existing.values()
    )

    print(
        f"Existing cache: {len(existing)} entries; "
        f"{valid_count} valid; "
        f"{len(existing) - valid_count} incomplete",
        flush=True
    )

    return existing


# ------------------------------------------
# SAVE SEASON FILES
# ------------------------------------------

def write_shards(existing):
    CACHE_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    seasons = {}

    for gid, payload in existing.items():
        year = season_of(gid)

        seasons.setdefault(
            year, {}
        )[gid] = payload

    # Prepare and size-check all files before
    # replacing any existing season files.
    prepared = []

    try:
        for year, games in sorted(
            seasons.items()
        ):
            destination = (
                CACHE_DIR / f"{year}.json"
            )

            temporary = (
                CACHE_DIR / f"{year}.json.tmp"
            )

            data = json.dumps(
                {
                    "format": 1,
                    "season": year,
                    "games": games,
                },
                separators=(",", ":"),
                ensure_ascii=False,
            )

            temporary.write_text(
                data,
                encoding="utf-8"
            )

            size = temporary.stat().st_size

            if size > MAX_SHARD_BYTES:
                raise RuntimeError(
                    f"{year}.json exceeds 90 MiB. "
                    "Smaller shards are required."
                )

            prepared.append(
                (
                    temporary,
                    destination,
                    year,
                    len(games),
                    size,
                )
            )

        for (
            temporary,
            destination,
            year,
            count,
            size,
        ) in prepared:
            temporary.replace(destination)

            print(
                f"Saved {year}.json: "
                f"{count} games, "
                f"{size / 1048576:.2f} MiB",
                flush=True
            )

    finally:
        for temporary in CACHE_DIR.glob(
            "*.json.tmp"
        ):
            if temporary.exists():
                temporary.unlink()


# ------------------------------------------
# BUILD PRIORITY LIST
# ------------------------------------------

def build_priority(games):
    pairs = {}

    for game in games:
        if not isinstance(game, dict):
            continue

        if not completed_regular_season(game):
            continue

        away = (
            game.get("awayTeam") or {}
        ).get("abbrev")

        home = (
            game.get("homeTeam") or {}
        ).get("abbrev")

        gid = str(game.get("id", ""))

        if not away or not home:
            continue

        try:
            season_of(gid)
        except ValueError:
            continue

        pair = tuple(sorted((away, home)))

        pairs.setdefault(
            pair, []
        ).append(game)

    pair_games = {}

    for pair, items in pairs.items():
        recent = sorted(
            items,
            key=lambda game: (
                str(game.get("gameDate") or ""),
                int(game["id"]),
            ),
            reverse=True,
        )

        # Deduplicate games before selecting 10.
        unique = []
        seen = set()

        for game in recent:
            gid = str(game["id"])

            if gid in seen:
                continue

            seen.add(gid)
            unique.append(gid)

            if len(unique) == 10:
                break

        pair_games[pair] = unique

    # Round-robin selection:
    # First game from each pairing, then
    # second game, and so on.
    priority = []
    seen = set()

    max_depth = max(
        (
            len(ids)
            for ids in pair_games.values()
        ),
        default=0,
    )

    for depth in range(max_depth):
        for pair in sorted(pair_games):
            ids = pair_games[pair]

            if depth >= len(ids):
                continue

            gid = ids[depth]

            if gid not in seen:
                seen.add(gid)
                priority.append(gid)

    return pairs, priority


# ------------------------------------------
# MAIN
# ------------------------------------------

def main():
    if not GAMES_FILE.exists():
        raise SystemExit(
            "Missing data/head-to-head.json. "
            "Run scripts/build_h2h.py first."
        )

    raw = json.loads(
        GAMES_FILE.read_text(
            encoding="utf-8"
        )
    )

    game_data = raw.get("games", {})

    if isinstance(game_data, dict):
        games = list(game_data.values())
    elif isinstance(game_data, list):
        games = game_data
    else:
        raise SystemExit(
            "Invalid head-to-head history format."
        )

    if not games:
        raise SystemExit(
            "Head-to-head history is empty."
        )

    existing = load_existing()

    pairs, priority = build_priority(games)

    missing = [
        gid
        for gid in priority
        if not valid_scoresheet(
            existing.get(gid)
        )
    ]

    selected = missing[:MAX_NEW]

    print(
        "\nHEAD-TO-HEAD CACHE STATUS",
        flush=True
    )

    print(
        f"Team pairings: {len(pairs)}",
        flush=True
    )

    print(
        f"Required unique games: {len(priority)}",
        flush=True
    )

    print(
        f"Missing or incomplete: {len(missing)}",
        flush=True
    )

    print(
        f"Downloading this run: {len(selected)}",
        flush=True
    )

    print(
        f"Remaining after selection: "
        f"{max(0, len(missing) - len(selected))}",
        flush=True
    )

    failures = []
    fetched = 0

    if selected:
        with ThreadPoolExecutor(
            max_workers=WORKERS
        ) as pool:
            futures = {
                pool.submit(fetch_game, gid): gid
                for gid in selected
            }

            for future in as_completed(futures):
                gid = futures[future]

                try:
                    _, payload = future.result()

                    existing[gid] = payload
                    fetched += 1

                    if fetched % 50 == 0:
                        print(
                            f"Downloaded {fetched} "
                            f"valid scoresheets...",
                            flush=True
                        )

                except Exception as exc:
                    failures.append(
                        (gid, str(exc))
                    )

    # Write existing and newly fetched games.
    write_shards(existing)

    remaining = [
        gid
        for gid in priority
        if not valid_scoresheet(
            existing.get(gid)
        )
    ]

    years = Counter(
        season_of(gid)
        for gid, payload in existing.items()
        if valid_scoresheet(payload)
    )

    print(
        "\nFINAL CACHE REPORT",
        flush=True
    )

    print(
        f"Successfully downloaded: {fetched}",
        flush=True
    )

    print(
        f"Failed downloads: {len(failures)}",
        flush=True
    )

    print(
        f"Required games still missing: "
        f"{len(remaining)}",
        flush=True
    )

    print(
        "Valid cached games by season:",
        dict(sorted(years.items())),
        flush=True
    )

    if remaining:
        print(
            "First 30 missing game IDs:",
            remaining[:30],
            flush=True
        )

    for gid, error in failures[:20]:
        print(
            f"WARN game {gid}: {error}",
            flush=True
        )

    if selected and fetched == 0:
        raise SystemExit(
            "All selected scoresheet requests failed."
        )


if __name__ == "__main__":
    main()
