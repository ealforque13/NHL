#!/usr/bin/env python3
"""Bump Hoist Official static asset cache keys before a GitHub Pages release.
Usage: python scripts/bump_version.py [release-id]
Run from repository root. Without an ID uses current UTC time.
"""
from datetime import datetime, timezone
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
index = root / 'index.html'
if not index.exists():
    raise SystemExit('Missing index.html in repository root')
version = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', version):
    raise SystemExit('Release ID may contain only letters, digits, _ and -')
html = index.read_text(encoding='utf-8')
pattern = re.compile(r'(?P<start>\b(?:src|href)=["\'])(?P<file>[^"\'?]+\.(?:js|css))(?P<query>\?[^"\']*)?(?P<end>["\'])', re.I)
count = 0
def bump(match):
    global count
    path = match.group('file')
    if path.startswith(('http:', 'https:', '//')):
        return match.group(0)
    count += 1
    return f'{match.group("start")}{path}?v={version}{match.group("end")}'
html = pattern.sub(bump, html)
html = re.sub(r'<meta name="hoist-build" content="[^"]*">', '', html)
html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="hoist-build" content="{version}">', 1)
index.write_text(html, encoding='utf-8')
print(f'Updated {count} local JS/CSS references; build {version}')
