#!/usr/bin/env python3
"""Discover time-aware natural-colour WMS layers from EUMETView capabilities."""
import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ENDPOINT = 'https://view.eumetsat.int/geoserver/wms'
CAPABILITIES = ENDPOINT + '?service=WMS&request=GetCapabilities&version=1.3.0'
NS = {'w': 'http://www.opengis.net/wms'}

def element_text(element, name, default=''):
    child = element.find('w:' + name, NS)
    return child.text.strip() if child is not None and child.text else default

def iso_time(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('WMS time has no timezone')
    return parsed.astimezone(timezone.utc)

def format_time(value):
    return value.isoformat(timespec='seconds').replace('+00:00', 'Z')

def recent_times(raw, default='', limit=48):
    result = set()
    for part in (raw or '').split(','):
        part = part.strip()
        if not part:
            continue
        try:
            if '/' not in part:
                result.add(format_time(iso_time(part)))
                continue
            start, end, period = part.split('/')
            begin, finish = iso_time(start), iso_time(end)
            match = re.fullmatch(r'P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?', period)
            if not match:
                continue
            days, hours, minutes, seconds = [float(x or 0) for x in match.groups()]
            step = timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
            if step.total_seconds() <= 0 or finish < begin:
                continue
            # Align to the advertised start/step. Never invent an extra frame at an unaligned end.
            current = begin + int((finish - begin) / step) * step
            for _ in range(limit):
                if current < begin:
                    break
                result.add(format_time(current))
                current -= step
        except (ValueError, OverflowError):
            continue
    if not result and default and default.lower() not in ('current', 'latest'):
        try:
            result.add(format_time(iso_time(default)))
        except ValueError:
            pass
    return sorted(result)[-limit:]

def parse_capabilities(raw):
    root = ET.fromstring(raw)
    layers = []
    def visit(node, inherited_bounds=None, inherited_time=None, inherited_crs=()):
        crs = set(inherited_crs)
        crs.update(c.text.strip() for c in node.findall('w:CRS', NS) if c.text)
        bounds = inherited_bounds
        geographic = node.find('w:EX_GeographicBoundingBox', NS)
        if geographic is not None:
            try:
                bounds = [float(element_text(geographic, key)) for key in ('westBoundLongitude', 'southBoundLatitude', 'eastBoundLongitude', 'northBoundLatitude')]
            except ValueError:
                bounds = None
        dimension = inherited_time
        for item in node.findall('w:Dimension', NS):
            if item.get('name', '').lower() == 'time':
                dimension = {'values': (item.text or '').strip(), 'default': item.get('default', '')}
        name, title = element_text(node, 'Name'), element_text(node, 'Title')
        abstract = element_text(node, 'Abstract')
        description = ' '.join((name, title, abstract)).lower()
        natural = bool(re.search(r'natural[\s_:-]+colou?r|true[\s_:-]*colou?r|rgb[_:-]natural(?:$|[_:-]|enhncd)', ' '.join((name, title)).lower()))
        # A layer must intersect Pakistan and have a supported geographic CRS.
        intersects = bounds and bounds[0] <= 77.5 and bounds[2] >= 60.5 and bounds[1] <= 37.5 and bounds[3] >= 23.5
        if name and (natural or name == 'msg_iodc:rgb_eview') and intersects and any(c in crs for c in ('EPSG:3857', 'EPSG:4326', 'CRS:84')):
            times = recent_times((dimension or {}).get('values', ''), (dimension or {}).get('default', ''))
            # Prefer Indian Ocean coverage for Pakistan, then layers covering all of Pakistan.
            full = bounds[0] <= 60.5 and bounds[2] >= 77.5 and bounds[1] <= 23.5 and bounds[3] >= 37.5
            score = (100 if any(x in description for x in ('iodc', 'indian ocean', '45.5', '45 degree')) else 0) + (30 if full else 0) + (10 if times else 0) + (5 if 'natural colour rgb' in title.lower() or 'natural color rgb' in title.lower() else 0)
            if name == 'msg_iodc:rgb_eview': title = 'High-resolution visible RGB · IODC (coverage gaps possible)'
            layers.append({'name': name, 'title': title or name, 'abstract': abstract[:1200], 'bounds': bounds, 'crs': next(c for c in ('EPSG:3857', 'EPSG:4326', 'CRS:84') if c in crs), 'times': times, 'default_time': (dimension or {}).get('default', ''), 'time_advertised': bool(dimension), 'score': score})
        for child in node.findall('w:Layer', NS):
            visit(child, bounds, dimension, crs)
    capability = root.find('w:Capability/w:Layer', NS)
    if capability is None:
        raise ValueError('WMS capabilities have no root layer')
    visit(capability)
    return sorted(layers, key=lambda layer: (-layer['score'], layer['title']))

def sync(path, raw=None):
    now = datetime.now(timezone.utc).isoformat()
    old = json.loads(path.read_text()) if path.exists() else {'schema_version': 1, 'endpoint': ENDPOINT, 'layers': [], 'synced_at': None}
    try:
        if raw is None:
            req = Request(CAPABILITIES, headers={'User-Agent': 'MonsoonWeather/1.0 (EUMETView WMS integration)', 'Accept': 'application/xml,text/xml'})
            with urlopen(req, timeout=35) as response:
                raw = response.read(12_000_001)
            if len(raw) > 12_000_000:
                raise ValueError('Capabilities exceed size limit')
        layers = parse_capabilities(raw)
        if not layers:
            raise ValueError('No advertised natural-colour layers intersect Pakistan')
        result = {'schema_version': 1, 'endpoint': ENDPOINT, 'layers': layers, 'synced_at': now, 'attempted_at': now, 'status': 'updated'}
        print('EUMETView: discovered ' + str(len(layers)) + ' natural-colour layers for Pakistan')
        success = True
    except Exception as exc:
        result = {**old, 'attempted_at': now, 'status': 'cached' if old.get('layers') else 'unavailable', 'message': 'Capabilities refresh unavailable; retained advertised layers only. ' + type(exc).__name__}
        print('EUMETView capabilities unavailable (' + type(exc).__name__ + ')')
        success = False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    temporary.replace(path)
    return success

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('public/satellite-data/catalog.json'))
    args = parser.parse_args()
    sync(args.output)
