
"""Incrementally cache NHL gamecenter scoresheets for the last
10 regular-season meetings of every NHL team pairing.

Scoresheets are stored in separate JSON files by season start year.
Existing combined caches are supported for migration.

Run after scripts/build_h2h.py.
"""

import json
import os
import time
import urllib.request

from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


GAMES_FILE = Path("data/head-to-head.json")

OLD_CACHE = Path("data/head-to-head-scoresheets.json")

CACHE_DIR = Path("data/head-to-head-scoresheets")

MAX_NEW = max(
    0,
    int(os.environ.get("H2H_MAX_NEW", "800"))
)

WORKERS = max(
    1,
    min(8, int(os.environ.get("H2H_WORKERS", "5")))
)


def get(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "HoistOfficial/1.0",
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(
                request,
                timeout=25
            ) as response:
                return json.load(response)

        except Exception:
            if attempt == 2:
                raise

            time.sleep(2 ** attempt)


def fetch_game(gid):
    base = (
        f"https://api-web.nhle.com/v1/gamecenter/{gid}"
    )

    landing = get(base + "/landing")
    boxscore = get(base + "/boxscore")

    return gid, {
        "landing": {
            "summary": landing.get("summary", {}),
            "periodDescriptor": landing.get(
                "periodDescriptor", {}
            ),
            "homeTeam": landing.get("homeTeam", {}),
            "awayTeam": landing.get("awayTeam", {})
        },
        "boxscore": {
            "playerByGameStats": boxscore.get(
                "playerByGameStats", {}
            ),
            "homeTeam": boxscore.get("homeTeam", {}),
            "awayTeam": boxscore.get("awayTeam", {})
        }
    }


def season_of(gid):
    """NHL game IDs begin with the season start year."""
    gid = str(gid)

    if len(gid) < 8 or not gid.isdigit():
        raise ValueError(
            f"Invalid NHL game ID: {gid}"
        )

    return gid[:4]


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

    # Read the old combined file first.
    # Sharded files take precedence if IDs overlap.
    if OLD_CACHE.exists():
        print(
            "Reading existing combined cache...",
            flush=True
        )

        existing.update(
            read_games(OLD_CACHE)
        )

    # Read any previously generated season files.
    if CACHE_DIR.exists():
        for path in sorted(
            CACHE_DIR.glob("*.json")
        ):
            existing.update(
                read_games(path)
            )

    return existing


def write_shards(existing):
    """Write one cache per season, atomically."""

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
                "games": games
            },
            separators=(",", ":"),
            ensure_ascii=False
        )

        temporary.write_text(
            data,
            encoding="utf-8"
        )

        size = temporary.stat().st_size

        # Stay comfortably below GitHub's 100 MB limit.
        if size > 90 * 1024 * 1024:
            temporary.unlink()

            raise RuntimeError(
                f"{year}.json exceeds 90 MiB. "
                "This season requires smaller shards."
            )

        temporary.replace(
            destination
        )

        print(
            f"Saved {destination}: "
            f"{len(games)} games, "
            f"{size / 1048576:.2f} MiB",
            flush=True
        )


def main():
    if not GAMES_FILE.exists():
        raise SystemExit(
            "Missing data/head-to-head.json. "
            "Run history collector first."
        )

    raw = json.loads(
        GAMES_FILE.read_text(
            encoding="utf-8"
        )
    )

    game_data = raw.get("games", {})

    games = (
        list(game_data.values())
        if isinstance(game_data, dict)
        else list(game_data)
    )

    if not games:
        raise SystemExit(
            "Head-to-head history is empty."
        )

    existing = load_existing()

    # Group games by their team pairing.
    pairs = {}

    for game in games:
        away = (
            game.get("awayTeam") or {}
        ).get("abbrev")

        home = (
            game.get("homeTeam") or {}
        ).get("abbrev")

        gid = str(
            game.get("id", "")
        )

        if (
            not away
            or not home
            or not gid.isdigit()
            or game.get("gameType") != 2
        ):
            continue

        pair = tuple(
            sorted((away, home))
        )

        pairs.setdefault(
            pair, []
        ).append(game)

    # Find 10 most recent games per pairing.
    pair_games = {}

    for pair, items in pairs.items():
        recent = sorted(
            items,
            key=lambda g: (
                g.get("gameDate") or "",
                int(g["id"])
            ),
            reverse=True
        )[:10]

        pair_games[pair] = [
            str(g["id"])
            for g in recent
        ]

    wanted = set()

    for ids in pair_games.values():
        wanted.update(ids)

    missing = []
    seen = set()

    # Preserve round-robin downloading.
    max_depth = max(
        (
            len(ids)
            for ids in pair_games.values()
        ),
        default=0
    )

    for depth in range(max_depth):
        for pair in sorted(pair_games):
            ids = pair_games[pair]

            if depth >= len(ids):
                continue

            gid = ids[depth]

            if (
                gid not in existing
                and gid not in seen
            ):
                seen.add(gid)
                missing.append(gid)

    selected = missing[:MAX_NEW]

    print(
        f"{len(pairs)} pairs; "
        f"{len(wanted)} unique games needed; "
        f"{len(existing)} cached; "
        f"{len(missing)} missing; "
        f"fetching {len(selected)}",
        flush=True
    )

    failures = []
    fetched = 0

    with ThreadPoolExecutor(
        max_workers=WORKERS
    ) as pool:
        futures = {
            pool.submit(
                fetch_game, gid
            ): gid
            for gid in selected
        }

        for future in as_completed(
            futures
        ):
            gid = futures[future]

            try:
                _, payload = future.result()

                existing[gid] = payload
                fetched += 1

            except Exception as exc:
                failures.append(
                    (gid, str(exc))
                )

    # Save all downloaded games by season.
    write_shards(existing)

    remaining = sum(
        gid not in existing
        for gid in wanted
    )

    years = Counter(
        season_of(gid)
        for gid in existing
    )

    print(
        f"Fetched {fetched}; "
        f"failed {len(failures)}; "
        f"cached total {len(existing)}; "
        f"remaining {remaining}",
        flush=True
    )

    print(
        "Cached game IDs by season:",
        dict(sorted(years.items())),
        flush=True
    )

    for gid, error in failures[:20]:
        print(
            f"WARN game {gid}: {error}",
            flush=True
        )

    if selected and not fetched:
        raise SystemExit(
            "All selected scoresheet requests failed."
        )


if __name__ == "__main__":
    main()
