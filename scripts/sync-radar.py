#!/usr/bin/env python3
"""Refresh public PMD radar catalogs for static Pages hosting (no credentials)."""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ORIGIN = 'https://radar.weather.gov.pk/jbirds/'
STATIONS = ('islamabad', 'karachi')
MAX_BYTES = 2_000_000


def clean_manifest(payload, station):
    site = next((s for s in payload.get('radarSites', []) if s.get('id') == station), None)
    if not site or not isinstance(site.get('imageBounds'), dict):
        raise ValueError('Missing station coordinates')
    center = site.get('center')
    if not isinstance(center, list) or len(center) != 2:
        raise ValueError('Invalid station center')
    bounds = {}
    for radius, pairs in site['imageBounds'].items():
        if str(radius) not in ('200', '450') or not isinstance(pairs, list) or len(pairs) != 2:
            continue
        if any(not isinstance(p, list) or len(p) != 2 for p in pairs):
            raise ValueError('Invalid image bounds')
        for lat, lon in pairs:
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError('Invalid image coordinates')
        bounds[str(radius)] = pairs
    frames = []
    for frame in payload.get('radarImages', []):
        path = frame.get('url', '')
        if frame.get('radarSiteId') != station or str(frame.get('radius')) not in bounds:
            continue
        if not re.fullmatch(r'images/radar/' + station + r'/[A-Za-z0-9_./-]+\.png', path) or '..' in path:
            continue
        stamp = frame.get('datetime', '')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', stamp):
            continue
        datetime.strptime(stamp, '%Y-%m-%d %H:%M')
        product = frame.get('product')
        if not isinstance(product, str) or not product.strip():
            continue
        frames.append({'radarSiteId': station, 'radius': str(frame['radius']), 'url': path, 'product': product[:100], 'datetime': stamp})
    if not frames:
        raise ValueError('No valid radar frames')
    return {'site': {'id': station, 'name': station.title(), 'center': center, 'imageBounds': bounds, 'isMaintenance': bool(site.get('isMaintenance', False))}, 'frames': sorted(frames, key=lambda f: f['datetime'])}


def sync(path, fetch=None):
    catalog = json.loads(path.read_text()) if path.exists() else {'schema_version': 1, 'origin': ORIGIN, 'stations': {}, 'synced_at': None}
    # Keep the latest published catalog when a scheduled build cannot reach PMD.
    previous_url = os.environ.get('PREVIOUS_RADAR_URL', '')
    if previous_url.startswith('https://') and '.github.io/' in previous_url:
        try:
            req = Request(previous_url, headers={'User-Agent': 'MonsoonWeather/1.0', 'Cache-Control': 'no-cache'})
            with urlopen(req, timeout=15) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('Previous catalog exceeds size limit')
            previous = json.loads(raw)
            if previous.get('origin') == ORIGIN:
                for station in STATIONS:
                    item = previous.get('stations', {}).get(station)
                    if not item:
                        continue
                    valid = clean_manifest({'radarSites': [item['site']], 'radarImages': item['frames']}, station)
                    old = catalog['stations'].get(station, {})
                    old_times = [f['datetime'] for f in old.get('frames', [])]
                    if max(f['datetime'] for f in valid['frames']) >= max(old_times, default=''):
                        valid.update(synced_at=item.get('synced_at'), status='cached')
                        catalog['stations'][station] = valid
        except Exception:
            print('Previous published catalog unavailable; using checked-in catalog', file=sys.stderr)
    now = datetime.now(timezone.utc).isoformat()
    successes = 0
    for station in STATIONS:
        try:
            if fetch:
                payload = fetch(station)
            else:
                req = Request(ORIGIN + f'radar-images-{station}.json', headers={'User-Agent': 'MonsoonWeather/1.0 (public PMD radar catalog)', 'Accept': 'application/json'})
                with urlopen(req, timeout=25) as response:
                    raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError('Radar catalog exceeds size limit')
                payload = json.loads(raw)
            result = clean_manifest(payload, station)
            result.update(synced_at=now, attempted_at=now, status='updated', message='Catalog refreshed from PMD. Image timestamps are separate from catalog retrieval time.')
            catalog['stations'][station] = result
            successes += 1
            print(station + ': refreshed ' + str(len(result['frames'])) + ' frames')
        except Exception as exc:
            previous = catalog['stations'].get(station)
            if previous:
                previous.update(attempted_at=now, status='cached', message='PMD catalog refresh failed; retaining previous catalog. Check frame timestamps.')
            print(station + ': refresh unavailable (' + type(exc).__name__ + '); previous data preserved', file=sys.stderr)
    catalog['attempted_at'] = now
    if successes:
        catalog['synced_at'] = now
        catalog['source'] = 'PMD public radar catalogs'
    if not catalog['stations']:
        raise RuntimeError('No radar catalogs are available')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(catalog, separators=(',', ':')) + '\n')
    temporary.replace(path)
    return successes


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('public/radar-data/catalog.json'))
    args = parser.parse_args()
    sync(args.output)
