"""Tiered place and peak labels for the 3D terrain explorer, from GeoNames (CC BY 4.0).

Downloads https://download.geonames.org/export/dump/PK.zip (Pakistan), keeps cities, towns, villages, mountain peaks and passes, ranks them
into tiers and writes public/terrain-data/labels-pk.json. The explorer shows a tier only while the camera is closer than that tier's distance
(maxDistKm) and never lets two labels overlap, so the country view shows a few big names and a close view shows many small ones.
Attribution: GeoNames, https://www.geonames.org, Creative Commons Attribution 4.0.
Needs only the Python standard library. Run: python scripts/sync-terrain-labels.py
"""
import csv, io, json, math, tempfile, zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

URL = 'https://download.geonames.org/export/dump/PK.zip'
OUT = Path(__file__).resolve().parents[1] / 'public/terrain-data/labels-pk.json'
# Tier t is drawn while the camera is closer than MAX_DIST_KM[t] (distance from the camera to the point it looks at).
MAX_DIST_KM = [6000, 2600, 1300, 650, 260, 90]
KINDS = {'c': 'city', 't': 'town', 'v': 'village', 'p': 'peak', 's': 'pass'}
VILLAGE_CELL_DEG = 0.05               # at most one unlisted village per cell (about 5 km), so the file stays small
MIN_DISTINCT_KM = 8                   # the same name within this distance counts as one place


def download():
    req = Request(URL, headers={'User-Agent': 'WeatherWalay terrain explorer (labels, CC BY 4.0 GeoNames)'})
    with urlopen(req, timeout=120) as r:
        return r.read()


def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def place_tier(code, pop):
    """Tier of a populated place from its administrative code and population (0 biggest)."""
    if code in ('PPLC', 'PPLA') or pop >= 1_000_000: return 0, 'c'
    if code == 'PPLA2' or pop >= 200_000: return 1, 'c'
    if pop >= 50_000: return 2, 't'
    if pop >= 10_000: return 3, 't'
    if pop >= 1: return 4, 't'
    return 5, 'v'


def peak_tier(code, height):
    """Tier of a peak or pass from its height in metres, or None when it is not worth a label."""
    if code == 'PASS':
        if height >= 3000: return 3
        if height >= 2000: return 4
        return None
    if height >= 7000: return 1
    if height >= 6000: return 2
    if height >= 5000: return 3
    if height >= 4000: return 4
    if height >= 3000: return 5
    return None


def build(rows):
    labels = []
    for r in rows:
        if len(r) < 17: continue
        name, lat, lon, cls, code = r[1].strip(), float(r[4]), float(r[5]), r[6], r[7]
        if not name or not (23 <= lat <= 38 and 60 <= lon <= 78): continue
        pop = int(r[14] or 0)
        height = int(r[15] or 0) or int(r[16] or 0)
        if cls == 'P':
            tier, kind = place_tier(code, pop)
            labels.append((tier, -pop, name, lat, lon, kind, None))
        elif cls == 'T' and code in ('PK', 'MT', 'MTS', 'PASS', 'PKS'):
            tier = peak_tier('PASS' if code == 'PASS' else code, height)
            if tier is not None:
                labels.append((tier, -height, name, lat, lon, 's' if code == 'PASS' else 'p', height or None))
    labels.sort()
    kept, villages, by_name = [], set(), {}
    for tier, rank, name, lat, lon, kind, height in labels:
        if kind == 'v':                       # unlisted villages: one per cell
            cell = (round(lat / VILLAGE_CELL_DEG), round(lon / VILLAGE_CELL_DEG))
            if cell in villages: continue
            villages.add(cell)
        same = by_name.setdefault(name.lower(), [])
        if any(km(lat, lon, a, b) < MIN_DISTINCT_KM for a, b in same): continue
        same.append((lat, lon))
        kept.append([name, round(lat, 4), round(lon, 4), tier, kind, height])
    return kept


def main():
    with tempfile.TemporaryDirectory() as tmp:              # the download is untrusted data: its own empty folder, nothing is executed
        path = Path(tmp) / 'PK.zip'
        path.write_bytes(download())
        with zipfile.ZipFile(path) as z:
            rows = list(csv.reader(io.TextIOWrapper(z.open('PK.txt'), encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE))
    labels = build(rows)
    counts = {t: sum(1 for l in labels if l[3] == t) for t in range(len(MAX_DIST_KM))}
    data = {'schema_version': 1, 'source': 'GeoNames PK.zip', 'source_url': URL, 'license': 'CC BY 4.0, https://www.geonames.org',
            'retrieved_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'maxDistKm': MAX_DIST_KM, 'kinds': KINDS,
            'fields': ['name', 'lat', 'lon', 'tier', 'kind', 'elevation_m'], 'counts': counts, 'labels': labels}
    OUT.parent.mkdir(exist_ok=True)
    tmp_out = OUT.with_suffix('.tmp')
    tmp_out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    tmp_out.replace(OUT)
    print('labels:', len(labels), 'per tier', counts, '|', round(OUT.stat().st_size / 1e6, 2), 'MB')


if __name__ == '__main__':
    main()
