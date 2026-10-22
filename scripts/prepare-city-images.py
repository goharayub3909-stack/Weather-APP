#!/usr/bin/env python3
"""Prepare freely licensed, geographically checked city images with credit metadata."""
import concurrent.futures
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
UA = 'MonsoonWeather/1.0 (https://github.com/goharayub3909-stack/Weather-APP)'
OVERRIDES = {'hyderabad': 'Hyderabad, Sindh', 'gujrat': 'Gujrat, Pakistan', 'mirpur': 'Mirpur, Azad Kashmir', 'bagh': 'Bagh, Azad Kashmir', 'dadu': 'Dadu, Pakistan', 'wah': 'Wah Cantonment'}

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, text):
        self.parts.append(text)

def plain(value):
    parser = PlainText(); parser.feed(value or ''); return ' '.join(''.join(parser.parts).split())[:350]

def get(url):
    req = Request(url, headers={'User-Agent': UA})
    with urlopen(req, timeout=25) as response:
        raw = response.read(2_500_001)
        content_type = response.headers.get('Content-Type', '').split(';')[0]
    if len(raw) > 2_500_000:
        raise ValueError('Image or API response exceeds size limit')
    return raw, content_type

def query(host, **params):
    raw, _ = get('https://' + host + '/w/api.php?' + urlencode({'action': 'query', 'format': 'json', **params}))
    return json.loads(raw).get('query', {})

def distance(a, b, c, d):
    lat1, lat2 = math.radians(a), math.radians(c)
    x = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(d-b)/2)**2
    return 6371*2*math.asin(min(1, math.sqrt(x)))

def main():
    cities = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import {cities} from './public/cities.js';console.log(JSON.stringify(cities))"], cwd=ROOT, text=True))
    aliases = {}; pages = {}; ids = list(cities)
    titles = {id: OVERRIDES.get(id, cities[id][0].split(' / ')[0]) for id in ids}
    for offset in range(0, len(ids), 35):
        batch = ids[offset:offset+35]
        data = query('en.wikipedia.org', titles='|'.join(titles[id] for id in batch), redirects=1, prop='pageimages|coordinates', piprop='thumbnail|name', pithumbsize=1000, pilicense='free')
        for pair in data.get('normalized', []) + data.get('redirects', []):
            aliases[pair['from']] = pair['to']
        for page in data.get('pages', {}).values():
            pages[page.get('title', '')] = page
    candidates = {}
    for id in ids:
        title = titles[id]
        for _ in range(10):
            if title not in aliases:
                break
            title = aliases[title]
        page = pages.get(title, {}); coord = (page.get('coordinates') or [{}])[0]
        name = page.get('pageimage', '')
        if not page.get('thumbnail') or 'lat' not in coord or not name:
            continue
        if any(term in name.lower() for term in ['flag', 'coat_of_arms', 'logo', 'location', 'locator', 'seal_of', 'emblem']):
            continue
        if distance(cities[id][1], cities[id][2], coord['lat'], coord['lon']) > 80:
            continue
        candidates[id] = {'page': page, 'file_title': 'File:' + name}
    metadata = {}
    file_titles = sorted(set(item['file_title'] for item in candidates.values()))
    for offset in range(0, len(file_titles), 35):
        data = query('commons.wikimedia.org', titles='|'.join(file_titles[offset:offset+35]), prop='imageinfo', iiprop='extmetadata|url')
        for page in data.get('pages', {}).values():
            if page.get('imageinfo'):
                metadata[page['title'].replace('_', ' ')] = page['imageinfo'][0]
    output = ROOT / 'public/city-data'; (output/'photos').mkdir(parents=True, exist_ok=True)
    result = {}
    def photo(item):
        id, candidate = item
        info = metadata.get(candidate['file_title'].replace('_', ' '), {}); extra = info.get('extmetadata', {})
        license_name = plain(extra.get('LicenseShortName', {}).get('value', ''))
        license_url = extra.get('LicenseUrl', {}).get('value', '')
        if license_url.startswith('//'):
            license_url = 'https:' + license_url
        public_domain = 'public domain' in license_name.lower() or 'cc0' in license_name.lower()
        if not public_domain and not license_url.startswith('https://creativecommons.org/'):
            return None
        source = candidate['page']['thumbnail']['source']
        if urlsplit(source).hostname not in ('upload.wikimedia.org', 'thumb.wikimedia.org'):
            return None
        try:
            raw, content_type = get(source)
            extensions = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
            if content_type not in extensions:
                return None
            filename = id + '.' + extensions[content_type]; (output/'photos'/filename).write_bytes(raw)
            return id, {'file': 'photos/' + filename, 'city': cities[id][0], 'artist': plain(extra.get('Artist', {}).get('value', 'Wikimedia Commons contributor')), 'license': license_name, 'license_url': license_url if license_url.startswith('https://creativecommons.org/') else 'https://creativecommons.org/publicdomain/mark/1.0/', 'source_url': info.get('descriptionurl', ''), 'description': plain(extra.get('ImageDescription', {}).get('value', cities[id][0]))}
        except Exception as exc:
            print(id + ': image unavailable (' + type(exc).__name__ + ')')
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for item in executor.map(photo, candidates.items()):
            if item:
                result[item[0]] = item[1]
    (output/'catalog.json').write_text(json.dumps({'source': 'Wikimedia Commons', 'images': result}, ensure_ascii=False, separators=(',', ':'))+'\n')
    print('Prepared credited city photos:', len(result), 'of', len(cities), '; others use original illustrations.')

if __name__ == '__main__':
    main()
