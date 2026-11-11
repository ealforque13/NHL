
#!/usr/bin/env python3
"""
HOIST OFFICIAL — AUTOMATIC NHL INJURY UPDATER

Fetches NHL injuries from Realtime Sports API,
matches players to NHL IDs using cached matchup data,
and updates data/injuries.json automatically.

Requires the GitHub Actions secret:
RSA_API_KEY
"""

import json
import os
import re
import sys
import unicodedata
import urllib.request

from datetime import datetime, timezone
from pathlib import Path


# --------------------------------------------------
# FILE LOCATIONS
# --------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]

MATCHUPS = ROOT / "data" / "matchups"

OUTPUT = ROOT / "data" / "injuries.json"

URL = (
    "https://www.realtimesportsapi.com/api/v1/"
    "sports/hockey/leagues/nhl/injuries"
)


# --------------------------------------------------
# NORMALIZE PLAYER AND TEAM NAMES
# --------------------------------------------------

def norm(value):

    value = unicodedata.normalize(
        "NFKD",
        str(value or "")
    )

    value = "".join(
        c for c in value
        if not unicodedata.combining(c)
    )

    return re.sub(
        r"[^a-z0-9]",
        "",
        value.casefold()
    )


def name_of(player):

    name = (
        player.get("name")
        or player.get("fullName")
    )

    if isinstance(name, dict):
        name = (
            name.get("default")
            or name.get("en")
        )

    if not name:
        name = " ".join(
            str(player.get(k) or "")
            for k in ("firstName", "lastName")
        )

    return str(name or "").strip()


# --------------------------------------------------
# BUILD NHL PLAYER ID LOOKUP
# --------------------------------------------------

def roster_index():

    if not MATCHUPS.is_dir():
        raise RuntimeError(
            "Missing data/matchups. "
            "Run the existing matchup updater first."
        )

    index = {}

    for path in sorted(MATCHUPS.glob("*.json")):

        code = path.stem.upper()

        payload = json.loads(
            path.read_text(encoding="utf-8")
        )

        for player in payload.get("players", []):

            player_id = player.get("id")

            key = (
                code,
                norm(name_of(player))
            )

            if player_id and key[1]:

                index.setdefault(
                    key,
                    set()
                ).add(str(player_id))

    if not index:
        raise RuntimeError(
            "No NHL player IDs found in cached matchup data."
        )

    return index


# --------------------------------------------------
# NHL TEAM NAME MAPPING
# --------------------------------------------------

TEAMS = {

    "anaheimducks": "ANA",
    "bostonbruins": "BOS",
    "buffalosabres": "BUF",
    "calgaryflames": "CGY",
    "carolinahurricanes": "CAR",
    "chicagoblackhawks": "CHI",
    "coloradoavalanche": "COL",
    "columbusbluejackets": "CBJ",
    "dallasstars": "DAL",
    "detroitredwings": "DET",
    "edmontonoilers": "EDM",
    "floridapanthers": "FLA",
    "losangeleskings": "LAK",
    "lakings": "LAK",
    "minnesotawild": "MIN",
    "montrealcanadiens": "MTL",
    "nashvillepredators": "NSH",
    "newjerseydevils": "NJD",
    "newyorkislanders": "NYI",
    "newyorkrangers": "NYR",
    "ottawasenators": "OTT",
    "philadelphiaflyers": "PHI",
    "pittsburghpenguins": "PIT",
    "sanjosesharks": "SJS",
    "seattlekraken": "SEA",
    "stlouisblues": "STL",
    "tampabaylightning": "TBL",
    "torontomapleleafs": "TOR",
    "utahmammoth": "UTA",
    "utahhockeyclub": "UTA",
    "vancouvercanucks": "VAN",
    "vegasgoldenknights": "VGK",
    "washingtoncapitals": "WSH",
    "winnipegjets": "WPG"

}


# --------------------------------------------------
# FETCH AND PROCESS NHL INJURIES
# --------------------------------------------------

def main():

    key = os.environ.get(
        "RSA_API_KEY",
        ""
    ).strip()

    if not key:
        raise RuntimeError(
            "Missing GitHub Actions secret RSA_API_KEY."
        )

    index = roster_index()

    # Request the latest injury report.

    req = urllib.request.Request(
        URL,
        headers={
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "User-Agent": "HoistOfficial-InjuryUpdater/1.0"
        }
    )

    with urllib.request.urlopen(
        req,
        timeout=30
    ) as response:

        body = json.load(response)

    # Validate the response before changing
    # the existing injury file.

    if (
        not isinstance(body, dict)
        or body.get("success") is not True
        or not isinstance(body.get("data"), dict)
    ):
        raise RuntimeError(
            "Unexpected injury API response. "
            "Existing injury data will not be overwritten."
        )

    entries = body["data"].get("injuries")

    if not isinstance(entries, list):
        raise RuntimeError(
            "Missing injuries list. "
            "Existing injury data will not be overwritten."
        )

    players = {}

    unmatched = []

    # Process every injury report.

    for record in entries:

        if not isinstance(record, dict):
            continue

        athlete = record.get("athlete") or {}

        team = record.get("team") or {}

        if not isinstance(athlete, dict):
            continue

        if not isinstance(team, dict):
            continue

        name = (
            athlete.get("displayName")
            or athlete.get("fullName")
            or ""
        )

        club = TEAMS.get(
            norm(team.get("displayName"))
        )

        status = str(
            record.get("status") or ""
        )

        fantasy = str(
            record.get("fantasyStatus") or ""
        )

        if not club or not name:
            continue

        combined = (
            f"{status} {fantasy}"
        ).lower()

        # Exclude players reported as healthy,
        # available, cleared, or probable.

        if any(
            x in combined
            for x in (
                "active",
                "available",
                "healthy",
                "cleared",
                "probable"
            )
        ):
            continue

        if (
            not combined.strip()
            or combined.strip() in (
                "unknown",
                "none"
            )
        ):
            continue

        # Match the injury report to an NHL ID.

        matches = index.get(
            (club, norm(name)),
            set()
        )

        if len(matches) != 1:

            unmatched.append(
                f"{club}: {name} "
                f"({len(matches)} matches)"
            )

            continue

        player_id = next(iter(matches))

        description = (
            record.get("shortComment")
            or record.get("bodyPart")
            or status
            or "Injured"
        )

        # This is the data matchup.js uses
        # to display the red + indicator.

        players[player_id] = {

            "injured": True,

            "description": str(
                description
            )[:240],

            "status": status,

            "team": club

        }

    # Protect against accidentally erasing
    # all injuries because of a mapping failure.

    if entries and not players and unmatched:

        raise RuntimeError(
            "No injury records matched NHL IDs. "
            "Previous injury report was preserved."
        )

    # Generate the injury JSON file.

    output = {

        "updatedAt": datetime.now(
            timezone.utc
        ).isoformat(),

        "source": "Realtime Sports API",

        "players": dict(
            sorted(players.items())
        )

    }

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    OUTPUT.write_text(
        json.dumps(
            output,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )

    print(
        f"Wrote {len(players)} injured NHL players "
        f"to {OUTPUT.relative_to(ROOT)}"
    )

    if unmatched:

        print(
            f"Unmatched records ({len(unmatched)}): "
            + "; ".join(unmatched[:15]),
            file=sys.stderr
        )


# --------------------------------------------------
# RUN SCRIPT
# --------------------------------------------------

if __name__ == "__main__":

    try:
        main()

    except Exception as exc:

        print(
            f"Injury update failed: {exc}",
            file=sys.stderr
        )

        sys.exit(1)
