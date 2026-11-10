#!/usr/bin/env python3
"""Fetch current NHL team rosters and headshots into GitHub Pages JSON.
No paid API key required. NHL web endpoints are unofficial and may change.
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TEAMS = "ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LAK MIN MTL NSH NJD NYI NYR OTT PHI PIT SJS SEA STL TBL TOR UTA VAN VGK WSH WPG".split()
OUT = Path(__file__).resolve().parents[1] / "data" / "lineups"
OUT.mkdir(parents=True, exist_ok=True)

def player(p):
    def name_part(field):
        value = p.get(field) or {}
        return value.get("default", "") if isinstance(value, dict) else str(value)
    return {
        "id": p.get("id"),
        "name": " ".join(filter(None, [name_part("firstName"), name_part("lastName")])),
        "position": p.get("positionCode") or "",
        "number": p.get("sweaterNumber"),
        "headshot": p.get("headshot") or "",
    }

def fetch(team):
    url = f"https://api-web.nhle.com/v1/roster/{team}/current"
    req = Request(url, headers={"User-Agent": "HoistOfficialRosterUpdater/1.0", "Accept": "application/json"})
    with urlopen(req, timeout=25) as response:
        return json.load(response)

def main():
    errors = []
    for team in TEAMS:
        try:
            data = fetch(team)
            if not isinstance(data, dict) or not all(isinstance(data.get(k), list) for k in ("forwards", "defensemen", "goalies")):
                raise ValueError("Unexpected roster response")
            roster = {
                "team": team,
                "type": "roster",
                "status": "roster",
                "source": "NHL Web API",
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "forwards": [player(p) for p in data["forwards"]],
                "defense": [player(p) for p in data["defensemen"]],
                "goalies": [player(p) for p in data["goalies"]],
            }
            if not any(roster[k] for k in ("forwards", "defense", "goalies")):
                raise ValueError("Empty roster; refusing to overwrite")
            path = OUT / f"{team}.json"
            path.write_text(json.dumps(roster, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{team}: {sum(len(roster[k]) for k in ('forwards','defense','goalies'))} players")
        except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
            print(f"WARNING {team}: {exc}")
            errors.append(team)
        time.sleep(0.2)
    if errors:
        print("Failed teams (previous cached files preserved):", ", ".join(errors))
        if len(errors) == len(TEAMS):
            raise SystemExit("No teams updated; check API availability")

if __name__ == "__main__":
    main()
