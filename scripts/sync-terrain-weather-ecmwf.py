"""ECMWF IFS 0.1 degree (about 9 km) open data for the 3D terrain weather map.

Reads ECMWF's own free real-time open data (CC BY 4.0, no key, no API limit) from public mirrors. Each step has an .index sidecar that gives the byte
range of every field, so only the fields listed below are downloaded (HTTP Range requests, never the global files), all of them in parallel, and each
is decoded with ECMWF's eccodes, cropped to Pakistan and cached on disk as a small array. A run that was interrupted resumes from the cache, and
running again for the same forecast run reads everything from the cache. Writes public/terrain-data/grid-hires.json.

Fields (surface): 10u, 10v (m/s), 2t (K, stored as degC), tp and sf (accumulated since the run start, m of water), tcc, lcc, mcc, hcc (total, low, medium
and high cloud cover, fraction, stored as %), msl (mean sea-level pressure, Pa, stored as hPa), mucape (most unstable CAPE, J/kg) and sp (surface pressure,
only used to mask winds below ground). Fields (pressure levels): u and v at 850 and 700 hPa. Rain and snow rates are the difference between two steps divided
by the hours between them. The result is 3-hourly for 72 hours; the page interpolates in time.

For the 1 km downscaler only (not written to grid-hires.json): mx2t3 and mn2t3 (maximum and minimum 2 m temperature in the last 3 hours, K) and ssrd
(surface solar radiation downwards, accumulated, J/m2) and 2d (2 m dew point, K; with 2t it gives the relative humidity the rain / snow split needs). After publishing, downscaler/2_apply_1km_forecast.py is run on the cached fields and writes
public/terrain-data/grid-1km/ (skip with --no-downscale).

Needs: eccodes and numpy (the project's .venv-terrain has them).
Run:   .venv-terrain/Scripts/python.exe scripts/sync-terrain-weather-ecmwf.py [--force] [--workers N] [--no-downscale] [--hours 144]

Speed: the data is about 800 MB per run because every 0.1 degree field is a global message and the open data cannot be subset by area. How long a run
takes is therefore set by the connection to the mirror (about 1.4 MB/s on the machine this was written on, however many connections), not by the code.
"""
import base64, json, os, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import numpy as np
import eccodes as ec

OUT = Path(__file__).resolve().parents[1] / 'public/terrain-data/grid-hires.json'
CACHE_ROOT = Path(tempfile.gettempdir()) / 'weatherwalay-ecmwf-cache'      # decoded fields; safe to delete, it is only a cache
MIRRORS = ['https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.amazonaws.com', 'https://data.ecmwf.int/forecasts']
WEST, EAST, SOUTH, NORTH, SPACING = 60.0, 78.0, 23.0, 38.0, 0.1
COLS, ROWS = round((EAST - WEST) / SPACING) + 1, round((NORTH - SOUTH) / SPACING) + 1
HOURS = int(sys.argv[sys.argv.index('--hours') + 1]) if '--hours' in sys.argv else 144      # forecast length: the open data is 3-hourly to 144 h (6 days)
STEPS = list(range(0, HOURS + 1, 3))
PARAMS = ('10u', '10v', '2t', 'tp', 'sf', 'tcc', 'lcc', 'mcc', 'hcc', 'msl', 'mucape', 'sp', '10fg')     # surface file ("sfc"); 10fg is the 10 m gust of the last 3 h, published to 90 h only: later steps are missing (NaN)
OPTIONAL_PARAMS = ('10fg',)
DOWNSCALE_PARAMS = ('mx2t3', 'mn2t3', 'ssrd', '2d')      # surface, read only by the 1 km downscaler; 2d (2 m dew point) gives the humidity for the rain / snow split
DOWNSCALER = Path(__file__).resolve().parents[1] / 'downscaler/2_apply_1km_forecast.py'
GRID_1KM = Path(__file__).resolve().parents[1] / 'public/terrain-data/grid-1km/manifest.json'
LEVELS = (1000, 925, 850, 700, 600, 500, 400, 300, 250)     # hPa; u, v, temperature and geopotential height at each, from the pressure-level file ("pl")
PL_PARAMS = ('u', 'v', 't', 'gh')
GRID_LEVELS = (850, 700)              # these two keep their winds in grid-hires.json as before; every level has its own file in public/terrain-data/levels/
LEVELS_DIR = OUT.parent / 'levels'
# Approximate height of each level in the ICAO standard atmosphere, used only to place the trails in the 3D view.
LEVEL_HEIGHT_M = {1000: 111, 925: 762, 850: 1457, 700: 3012, 600: 4206, 500: 5574, 400: 7185, 300: 9164, 250: 10363}      # ICAO standard atmosphere, m
LEVEL_MASK_MARGIN_PA = 1000           # a level counts as below ground when the surface pressure is within 10 hPa of it or lower
MISSING = -32768
SNOW_WATER_MM_PER_CM = 0.7            # same convention as the page (forecast-periods.js)
NEW_FIELDS = ('gust', 't2m', 'cape', 'u850', 'v850', 'u700', 'v700', 'lcc', 'mcc', 'hcc', 'msl')   # a file without these is rebuilt
DECODE_LOCK = threading.Lock()        # eccodes is not guaranteed thread-safe; decoding (0.3 s a message) is far faster than the network, so one at a time is fine


def fetch(url, headers=None, tries=6):
    last = None
    for attempt in range(tries):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'WeatherWalay terrain weather map', **(headers or {})}), timeout=120) as r:
                return r.read()
        except Exception as e:                       # rate limits and resets are retried
            last = e
            time.sleep(min(2 * (attempt + 1), 10))
    raise last


def first_mirror(path):
    for base in MIRRORS:
        try:
            return base, fetch(f'{base}/{path}', tries=2)
        except Exception:
            continue
    raise RuntimeError('no mirror has ' + path)


def exists(path):
    """Is this file on the mirrors? True, False (a mirror answered "not there": the run is not out yet, no retries) or None (nothing reachable)."""
    for base in MIRRORS:
        try:
            with urlopen(Request(f'{base}/{path}', method='HEAD', headers={'User-Agent': 'WeatherWalay terrain weather map'}), timeout=20):
                return True
        except HTTPError as e:
            if e.code in (403, 404):
                return False
        except Exception:
            continue                                      # unreachable or erroring: try the next mirror
    return None


def latest_run():
    now = datetime.now(timezone.utc)
    for back in range(0, 4):
        day = now - timedelta(days=back // 2)
        for hour in ((12, 0) if back % 2 == 0 else (0, 12)):
            run = day.replace(hour=hour, minute=0, second=0, microsecond=0)
            if run > now:
                continue
            tag = run.strftime('%Y%m%d') + f'/{hour:02d}z'
            # a run is complete when its last step is published (a missing file means the run is still being produced)
            if exists(f'{tag}/ifs/0p1/oper/{run:%Y%m%d%H%M%S}-{STEPS[-1]}h-oper-fc-sfc.index') is True:
                return run
    raise RuntimeError('no complete 0.1 degree run found')


def decode(blob):
    with DECODE_LOCK:
        gid = ec.codes_new_from_message(blob)
        try:
            ni, nj = ec.codes_get(gid, 'Ni'), ec.codes_get(gid, 'Nj')
            vals = ec.codes_get_values(gid).reshape(nj, ni).astype('float64')
            miss = ec.codes_get(gid, 'missingValue')
            vals[vals == miss] = np.nan
            lat0, lon0 = ec.codes_get(gid, 'latitudeOfFirstGridPointInDegrees'), ec.codes_get(gid, 'longitudeOfFirstGridPointInDegrees')
            dlat, dlon = ec.codes_get(gid, 'jDirectionIncrementInDegrees'), ec.codes_get(gid, 'iDirectionIncrementInDegrees')
            north_first = not ec.codes_get(gid, 'jScansPositively')
        finally:
            ec.codes_release(gid)
    lats = SOUTH + np.arange(ROWS) * SPACING
    lons = WEST + np.arange(COLS) * SPACING
    rows = np.rint((lat0 - lats) / dlat).astype(int) if north_first else np.rint((lats - lat0) / dlat).astype(int)
    cols = np.rint(((lons - lon0) % 360) / dlon).astype(int) % ni
    return vals[np.ix_(rows, cols)]                      # row 0 = south, column 0 = west


# ---- the download plan: one job per (step, field) ----
def run_path(run, step, stream):
    return f'{run:%Y%m%d}/{run:%H}z/ifs/0p1/oper/{run:%Y%m%d%H%M%S}-{step}h-oper-fc-{stream}'


def field_keys():
    """(cache key, stream, param, level) for every field of one step."""
    return ([(p, 'sfc', p, None) for p in PARAMS + DOWNSCALE_PARAMS]
            + [(f'{p}{level}', 'pl', p, str(level)) for level in LEVELS for p in PL_PARAMS])


def read_index(run, step, stream):
    path = run_path(run, step, stream)
    base, idx = first_mirror(path + '.index')
    return base, path, [json.loads(line) for line in idx.decode().splitlines() if line.strip()]


def cache_file(cache, step, key):
    return cache / f'{step:03d}-{key}.npy'


def download_field(run, step, key, stream, param, level, index, cache):
    """Fetch one field by byte range, decode, crop and cache it. Returns the number of bytes downloaded."""
    base, path, rows = index[(step, stream)]
    r = next((x for x in rows if x['param'] == param and (x.get('levelist') == level if level else 'levelist' not in x)), None)
    if r is None and param in OPTIONAL_PARAMS:                    # not published for this step: stored as missing
        np.save(cache_file(cache, step, key), np.full((ROWS, COLS), np.nan, dtype='float32'))
        return 0
    blob = fetch(f"{base}/{path}.grib2", {'Range': f"bytes={r['_offset']}-{r['_offset'] + r['_length'] - 1}"})
    arr = decode(blob).astype('float32')
    tmp = cache_file(cache, step, key).with_suffix('.tmp.npy')
    np.save(tmp, arr)
    tmp.replace(cache_file(cache, step, key))                # complete files only, so an interrupted run never leaves a half-written field
    return len(blob)


def fetch_all(run, workers):
    """All fields of all steps into the cache, in parallel. Returns (cache dir, bytes downloaded, fields taken from the cache)."""
    cache = CACHE_ROOT / f'{run:%Y%m%d%H}'
    cache.mkdir(parents=True, exist_ok=True)
    for old in CACHE_ROOT.iterdir():                          # keep only this run's cache
        if old.is_dir() and old != cache:
            shutil.rmtree(old, ignore_errors=True)
    keys = field_keys()
    todo = [(s, k) for s in STEPS for k in keys if not cache_file(cache, s, k[0]).exists()]
    cached = len(STEPS) * len(keys) - len(todo)
    if not todo:
        return cache, 0, cached
    # one index per (step, stream) for the steps that still have something to fetch
    need = sorted({(s, k[1]) for s, k in todo})
    index = {}
    with ThreadPoolExecutor(workers) as ex:
        for (s, stream), res in zip(need, ex.map(lambda sk: read_index(run, sk[0], sk[1]), need)):
            index[(s, stream)] = res
    done, total_bytes, started, failed = 0, 0, time.time(), []
    with ThreadPoolExecutor(workers) as ex:
        futures = {ex.submit(download_field, run, s, k[0], k[1], k[2], k[3], index, cache): (s, k[0]) for s, k in todo}
        for fut in as_completed(futures):
            try:
                total_bytes += fut.result()
            except Exception as e:
                failed.append((futures[fut], type(e).__name__))
            done += 1
            if done % 25 == 0 or done == len(todo):
                dt = max(time.time() - started, 1e-6)
                print(f'  {done}/{len(todo)} fields, {total_bytes / 1e6:.0f} MB, {total_bytes / 1e6 / dt:.1f} MB/s, {dt:.0f} s', flush=True)
    if failed:
        raise RuntimeError(f'{len(failed)} of {len(todo)} fields failed ({failed[:3]}); the others are cached, run again to resume')
    return cache, total_bytes, cached


def pack(a, scale):
    q = np.clip(np.rint(a * scale), -32767, 32767)      # clip first: -32768 is reserved for "missing" and must not be produced by a value
    q[~np.isfinite(a)] = MISSING
    return base64.b64encode(q.astype('<i2').tobytes()).decode()


def levels_current(run_iso):
    """Are the per-level files there for this run and this forecast length?"""
    try:
        idx = json.loads((LEVELS_DIR / 'index.json').read_text())
        return idx['run'] == run_iso and idx['hours'] == STEPS and all((LEVELS_DIR / f'p{l}.json').exists() for l in LEVELS)
    except Exception:
        return False


def write_levels(run, cache):
    """One file per pressure level: u, v, temperature (degC) and geopotential height (m) for every step, packed like the main grid. A level is set to missing
    where the model's own surface pressure says it is underground; the page also hides it wherever the 1 km terrain is above the level's height."""
    LEVELS_DIR.mkdir(parents=True, exist_ok=True)
    run_iso = run.isoformat().replace('+00:00', 'Z')
    times = [(run + timedelta(hours=s)).strftime('%Y-%m-%dT%H:%M:%SZ') for s in STEPS]
    scales = {'u': 10, 'v': 10, 't': 10, 'gh': 1}
    sp = [np.load(cache_file(cache, s, 'sp')).astype('float32') for s in STEPS]
    sizes = {}
    for level in LEVELS:
        cols = {p: [] for p in PL_PARAMS}
        for k, s in enumerate(STEPS):
            under = sp[k] <= level * 100 + LEVEL_MASK_MARGIN_PA
            for p in PL_PARAMS:
                a = np.load(cache_file(cache, s, f'{p}{level}')).astype('float64')
                if p == 't':
                    a = a - 273.15
                a[under] = np.nan
                cols[p].append(a)
        d = {'schema_version': 1, 'kind': 'pressure_level', 'model': 'ecmwf_ifs_0p1', 'level': level, 'height_m': LEVEL_HEIGHT_M[level], 'run': run_iso,
             'grid': {'west': WEST, 'east': EAST, 'south': SOUTH, 'north': NORTH, 'spacing': SPACING, 'columns': COLS, 'rows': ROWS},
             'times': times, 'hours': STEPS, 'scales': scales, 'units': {'wind': 'm/s', 't': 'degC', 'gh': 'gpm'},
             **{p: [pack(a, scales[p]) for a in cols[p]] for p in PL_PARAMS}}
        path = LEVELS_DIR / f'p{level}.json'
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(d, separators=(',', ':')) + chr(10))
        tmp.replace(path)
        sizes[level] = path.stat().st_size
    idx = {'run': run_iso, 'hours': STEPS, 'levels': {str(l): {'height_m': LEVEL_HEIGHT_M[l], 'bytes': sizes[l]} for l in LEVELS}}
    (LEVELS_DIR / 'index.json').write_text(json.dumps(idx, separators=(',', ':')) + chr(10))
    print('Published', len(LEVELS), 'pressure levels,', round(sum(sizes.values()) / 1e6, 1), 'MB in', LEVELS_DIR)


def valid(d):
    try:
        return (d['schema_version'] == 2 and d['model'] == 'ecmwf_ifs_0p1' and d['grid']['columns'] == COLS and d['grid']['rows'] == ROWS and len(d['times']) == len(STEPS)
                and all(k in d for k in NEW_FIELDS))
    except (KeyError, TypeError):
        return False


def main():
    t0 = time.time()
    workers = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 16
    old = None
    try:
        d = json.loads(OUT.read_text())
        if valid(d):
            old = d
    except Exception:
        pass
    run = latest_run()
    if old and old['run'] == run.isoformat().replace('+00:00', 'Z') and '--force' not in sys.argv:
        print('0.1 degree grid is already the latest run:', old['run'])
        need_levels = not levels_current(old['run'])
        if need_levels or downscale_wanted(run):
            cache, got, _ = fetch_all(run, workers)          # only the fields the cache lacks (the pressure levels and the downscaler's, on a first run)
            print(f'downloaded {got / 1e6:.0f} MB more')
            if need_levels:
                write_levels(run, cache)
            return downscale(run, cache) if downscale_wanted(run) else 0
        return 0
    n_fields = len(STEPS) * len(field_keys())
    print('run', run.isoformat(), '-', len(STEPS), 'steps,', n_fields, 'fields,', workers, 'parallel downloads')
    cache, got, cached = fetch_all(run, workers)
    print(f'downloaded {got / 1e6:.0f} MB, {cached} of {n_fields} fields came from the cache, {time.time() - t0:.0f} s so far')
    steps = [{k[0]: np.load(cache_file(cache, s, k[0])).astype('float64') for k in field_keys()} for s in STEPS]
    fields, prev = [], None
    for step, f in zip(STEPS, steps):
        hours = step - (prev[0] if prev else step)
        if prev and hours > 0:
            rain = np.maximum(f['tp'] - prev[1]['tp'], 0) * 1000 / hours                      # total precipitation, mm per hour (snow water included)
            swe = np.minimum(np.maximum(f['sf'] - prev[1]['sf'], 0) * 1000 / hours, rain)     # snow water, mm per hour, never more than the total
        else:
            rain = np.zeros((ROWS, COLS)); swe = np.zeros((ROWS, COLS))
        # A pressure level below the ground is extrapolated by the model: mask it where the surface pressure says the level is underground.
        winds = {}
        for level in GRID_LEVELS:
            under = f['sp'] <= level * 100 + LEVEL_MASK_MARGIN_PA
            for p in ('u', 'v'):
                w = f[f'{p}{level}'].copy(); w[under] = np.nan; winds[f'{p}{level}'] = w
        fields.append({'u': f['10u'], 'v': f['10v'], 'cloud': f['tcc'] * 100, 'rain': rain, 'snow': swe / SNOW_WATER_MM_PER_CM,
                       't2m': f['2t'] - 273.15, 'cape': np.minimum(f['mucape'], 32000),
                       'lcc': f['lcc'] * 100, 'mcc': f['mcc'] * 100, 'hcc': f['hcc'] * 100, 'msl': f['msl'] / 100, 'gust': f['10fg'], **winds})
        prev = (step, f)
    # The first step has no interval: give it the second step's rates so the map is not blank at the run time.
    for k in ('rain', 'snow'):
        fields[0][k] = fields[1][k].copy()
    d = {'schema_version': 2, 'model': 'ecmwf_ifs_0p1', 'source': 'ECMWF IFS 0.1 degree (9 km) open data, CC BY 4.0',
         'run': run.isoformat().replace('+00:00', 'Z'),
         'grid': {'west': WEST, 'east': EAST, 'south': SOUTH, 'north': NORTH, 'spacing': SPACING, 'columns': COLS, 'rows': ROWS},
         'times': [(run + timedelta(hours=s)).strftime('%Y-%m-%dT%H:%M:%SZ') for s in STEPS], 'hours': STEPS,
         'scales': {'u': 10, 'v': 10, 'precip': 100, 'snow': 10, 'cloud': 1, 't2m': 10, 'cape': 1, 'u850': 10, 'v850': 10, 'u700': 10, 'v700': 10,
                    'lcc': 1, 'mcc': 1, 'hcc': 1, 'msl': 10, 'gust': 10},
         'levels': {str(l): {'u': f'u{l}', 'v': f'v{l}', 'approx_height_m': LEVEL_HEIGHT_M[l], 'masked_below_ground': True} for l in GRID_LEVELS},
         'units': {'wind': 'm/s', 'precip': 'mm', 'snow': 'cm', 'cloud': '%', 't2m': 'degC', 'cape': 'J/kg', 'lcc': '%', 'mcc': '%', 'hcc': '%', 'msl': 'hPa', 'gust': 'm/s'},
         'u': [pack(f['u'], 10) for f in fields], 'v': [pack(f['v'], 10) for f in fields],
         'precip': [pack(f['rain'], 100) for f in fields],
         'snow': [pack(f['snow'], 10) for f in fields], 'cloud': [pack(f['cloud'], 1) for f in fields],
         't2m': [pack(f['t2m'], 10) for f in fields], 'cape': [pack(f['cape'], 1) for f in fields],
         **{k: [pack(f[k], 10) for f in fields] for k in ('u850', 'v850', 'u700', 'v700')},
         **{k: [pack(f[k], 1) for f in fields] for k in ('lcc', 'mcc', 'hcc')}, 'msl': [pack(f['msl'], 10) for f in fields], 'gust': [pack(f['gust'], 10) for f in fields],
         'retrieved_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
    OUT.parent.mkdir(exist_ok=True)
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, separators=(',', ':')) + '\n')
    tmp.replace(OUT)
    print('Published', COLS * ROWS, 'nodes,', len(STEPS), 'steps,', round(OUT.stat().st_size / 1e6, 1), 'MB in', round(time.time() - t0), 's')
    write_levels(run, cache)
    return downscale(run, cache) if downscale_wanted(run, always=True) else 0


def downscale_wanted(run, always=False):
    """Run the 1 km step unless --no-downscale, the models are missing, or (when the 0.1 degree grid did not change) it is already done."""
    if '--no-downscale' in sys.argv or not (DOWNSCALER.parent / 'models/feature_metadata.json').exists():
        return False
    if always or '--force' in sys.argv:
        return True
    try:
        return json.loads(GRID_1KM.read_text())['run'] != run.isoformat().replace('+00:00', 'Z')
    except Exception:
        return True


def downscale(run, cache):
    """The 1 km step in its own process (it needs lightgbm, catboost and scipy); a failure leaves the 0.1 degree grid published."""
    print('1 km downscaling:', DOWNSCALER.name)
    r = subprocess.run([sys.executable, '-u', str(DOWNSCALER), '--cache', str(cache), '--grid', str(OUT)])
    if r.returncode:
        print('1 km downscaling failed (exit', r.returncode, '); the 0.1 degree grid is still published')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('0.1 degree refresh unavailable:', type(e).__name__, e)
        sys.exit(0 if OUT.exists() else 1)
