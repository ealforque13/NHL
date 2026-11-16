#!/usr/bin/env python3
"""Enrich a Hoist Official team player-history JSON using cached NHL game box scores.
Usage: python merge_h2h_shots.py TEAM.json game_archive.json -o TEAM_with_shots.json
Matches on (gameId, playerId). Missing box scores remain missing (not zero).
"""
import argparse, json
from pathlib import Path


def enrich(team_data, archive):
    games = archive.get('games', {})
    matched = records = 0
    for player in team_data.get('players', []):
        pid = str(player.get('id', ''))
        for game in player.get('games', []):
            game_id = str(game.get('gameId', ''))
            item = games.get(game_id, {})
            by_team = item.get('boxscore', {}).get('playerByGameStats', {})
            found = None
            for side in ('awayTeam', 'homeTeam'):
                roster = by_team.get(side, {})
                for group in ('forwards', 'defense'):
                    for entry in roster.get(group, []):
                        if str(entry.get('playerId', '')) == pid:
                            found = entry
                            break
                    if found is not None: break
                if found is not None: break
            if found is not None and found.get('sog') is not None:
                game['shots'] = int(found['sog'])
                matched += 1
            records += 1
    return matched, records


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('team_json', type=Path)
    p.add_argument('archive_json', type=Path)
    p.add_argument('-o', '--output', type=Path, required=True)
    a = p.parse_args()
    with a.team_json.open(encoding='utf-8') as f: team = json.load(f)
    with a.archive_json.open(encoding='utf-8') as f: archive = json.load(f)
    matched, total = enrich(team, archive)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.output.open('w', encoding='utf-8') as f: json.dump(team, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Added shots to {matched:,} of {total:,} player-game records; {total-matched:,} lack a matching archived box score.')
    print(f'Output: {a.output}')

if __name__ == '__main__': main()
