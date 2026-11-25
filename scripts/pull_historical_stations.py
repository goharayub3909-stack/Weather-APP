"""Historical observations of every Pakistani meteorological station, 2000 to now, for the 1 km downscaler (v2).

Sources (all public, anonymous, no key):
  ISD-Lite  hourly UTC temperature, dew point, sea-level pressure, wind, 1 h and 6 h precipitation, from NOAA's Open Data Dissemination
            bucket s3://noaa-isd-pds/isd-lite/ (read over anonymous HTTPS, the same objects as an unsigned S3 request); stations with
            CTRY == 'PK' in isd-history.csv. ISD-Lite carries no quality flags, only -9999 for missing: those values are dropped.
  IEM       Iowa Environmental Mesonet METAR / special reports of the Pakistani ASOS network (airports), UTC; hourly values are the report
            nearest each hour.
  GHCN-Daily  daily Tmax, Tmin, precipitation of the PK* stations (s3://noaa-ghcn-pds/csv/by_station/); values with a quality flag
            (Q_FLAG not blank: failed a NOAA check) are dropped.
Cleaning: units become degC, m/s, hPa, mm; physically impossible values are dropped (bounds below); stations of different sources that are
the same place share one station_id (same WMO number, else within MATCH_KM and MATCH_ELEV_M of a WMO station); where ISD and IEM both report an
hour, ISD wins and IEM fills what ISD lacks.

Output under downscaler/data/station_history/ (git-ignored):
  stations.parquet                       one row per station_id: name, lat, lon, elev_m, wmo, icao, source ids, coverage
  hourly/year=YYYY/part.parquet          station_id, time (UTC), temp_c, dewpt_c, wind_ms, wind_dir, slp_hpa, precip_1h_mm, precip_6h_mm, source
  daily/year=YYYY/part.parquet           station_id, date, tmax_c, tmin_c, precip_mm
  raw/                                   downloads, so a rerun fetches only what is missing (the current year and recent files refresh daily)

Run: .venv-terrain/Scripts/python.exe scripts/pull_historical_stations.py [--start 2000] [--end 2026] [--workers 16] [--skip iem] [--force]
"""
import argparse
import datetime as dt
import gzip
import io
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / 'downscaler' / 'data' / 'station_history'
RAW = OUT / 'raw'
ISD_HISTORY = 'https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv'
ISD_LITE = 'https://noaa-isd-pds.s3.amazonaws.com/isd-lite/data/{year}/{usaf}-{wban}-{year}.gz'
GHCN_STATIONS = 'https://noaa-ghcn-pds.s3.amazonaws.com/ghcnd-stations.txt'
GHCN_FILE = 'https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/{id}.csv'
IEM_NETWORK = 'https://mesonet.agron.iastate.edu/geojson/network/PK__ASOS.geojson'
IEM_ASOS = ('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station={st}&data=tmpf&data=dwpf&data=sknt&data=drct&data=p01m'
            '&data=mslp&year1={y1}&month1=1&day1=1&year2={y2}&month2=12&day2=31&tz=Etc/UTC&format=onlycomma&missing=empty&trace=0.0001&report_type=3&report_type=4')
BOX = dict(south=23.0, north=37.5, west=60.0, east=78.0)        # Pakistan; drops IEM's Indian station VEAY
MATCH_KM, MATCH_ELEV_M = 3.0, 250.0                              # same place when this close (screening conventions)
NAME_MATCH_KM = 30.0                                             # a station with no WMO number whose first name word matches one within this distance
PMD_META = Path(__file__).resolve().parents[1] / 'public' / 'observation-data' / 'station-meta.csv'    # realtime.json's PMD stations
REFRESH_S = 86400                                                # files of the current period are refreshed when older than a day
IEM_CHUNK_YEARS = 1            # IEM cuts off long-running requests (a 5-year pull of Sukkur failed mid-transfer), so one year at a time
# Plausibility bounds: values outside are dropped (just beyond Pakistan's records; screening conventions, not climate limits)
BOUNDS = dict(temp_c=(-60, 60), dewpt_c=(-80, 40), wind_ms=(0, 90), wind_dir=(0, 360), slp_hpa=(850, 1090), precip_1h_mm=(0, 300),
              precip_6h_mm=(0, 600), tmax_c=(-60, 60), tmin_c=(-60, 60), precip_mm=(0, 1000))
HOURLY_COLS = ['temp_c', 'dewpt_c', 'wind_ms', 'wind_dir', 'slp_hpa', 'precip_1h_mm', 'precip_6h_mm']


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- downloads
def get(url, tries=5, timeout=300):
    """Bytes, or None when the server says the object does not exist (404 / 403 on S3). Other failures are retried."""
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'WeatherWalay downscaler'}), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            last = e
        except Exception as e:
            last = e
        time.sleep(3 * (k + 1))
    raise RuntimeError(f'{url}: {last}')


def cached(path, url, stale_after=None, force=False):
    """Download url to path unless it is there (and, with stale_after, younger than that many seconds). An absent object leaves an empty
    file, so it is not asked for again. Returns the path, or None for an absent object."""
    if path.exists() and not force and (stale_after is None or time.time() - path.stat().st_mtime < stale_after):
        return path if path.stat().st_size else None
    blob = get(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(blob or b'')
    tmp.replace(path)
    return path if blob else None


# ---------------------------------------------------------------- station lists
def isd_stations():
    p = cached(RAW / 'isd-history.csv', ISD_HISTORY, REFRESH_S * 7)
    d = pd.read_csv(p, dtype=str, keep_default_na=False).rename(columns={'STATION NAME': 'NAME', 'ELEV(M)': 'ELEV'})
    d = d[(d['CTRY'] == 'PK') & (d['END'] >= '20000101')].copy()
    for c in ('LAT', 'LON', 'ELEV'):
        d[c] = pd.to_numeric(d[c], errors='coerce')
    d = d.dropna(subset=['LAT', 'LON'])
    d = d[d.LAT.between(BOX['south'], BOX['north']) & d.LON.between(BOX['west'], BOX['east'])]
    d['wmo'] = np.where(d.USAF.str.startswith('41') & (d.USAF.str.len() == 6), d.USAF.str[:5], None)
    return d.reset_index(drop=True)


def ghcn_stations():
    p = cached(RAW / 'ghcnd-stations.txt', GHCN_STATIONS, REFRESH_S * 7)
    rows = []
    for line in p.read_text('latin-1').splitlines():
        if line.startswith('PK'):
            i = line[:11]
            rows.append(dict(id=i, lat=float(line[12:20]), lon=float(line[21:30]), elev=float(line[31:37]), name=line[41:71].strip(),
                             wmo=i[-5:] if i[-5:].startswith('41') else None))
    return pd.DataFrame(rows)


def iem_stations(icao_to_wmo):
    p = cached(RAW / 'iem-pk-network.json', IEM_NETWORK, REFRESH_S * 7)
    rows = []
    for f in json.loads(p.read_text())['features']:
        lon, lat = f['geometry']['coordinates'][:2]
        if BOX['south'] <= lat <= BOX['north'] and BOX['west'] <= lon <= BOX['east']:
            pr = f.get('properties', {})
            rows.append(dict(icao=f['id'], name=pr.get('sname') or f['id'], lat=lat, lon=lon, elev=pr.get('elevation'), wmo=icao_to_wmo.get(f['id'])))
    return pd.DataFrame(rows)


def km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def first_word(name):
    w = re.sub(r'[^A-Z ]', ' ', str(name).upper()).split()
    return w[0] if w else ''


def pmd_anchors():
    """PMD stations of realtime.json with a 5-digit WMO id: (id, name, lat, lon, elev). Their positions are the accurate ones."""
    if not PMD_META.exists():
        return []
    d = pd.read_csv(PMD_META, dtype=str, keep_default_na=False)
    d = d[(d.network == 'PMD') & d.id.str.fullmatch(r'\d{5}')]
    return [(r.id, r.name, float(r.latitude), float(r.longitude), float(r.elevation_m) if r.elevation_m else np.nan) for r in d.itertuples()]


def build_stations(isd, ghcn, iem):
    """All source stations with one canonical station_id each: the WMO number where there is one; else the nearest WMO or PMD station within
    MATCH_KM / MATCH_ELEV_M; else one whose first name word matches within NAME_MATCH_KM; else the station's own id (ICAO, else source id).
    -> DataFrame(source, src_id, station_id, name, lat, lon, elev, wmo, icao)."""
    rows = []
    for r in isd.itertuples():
        rows.append(dict(source='isd', src_id=f'{r.USAF}-{r.WBAN}', name=r.NAME, lat=r.LAT, lon=r.LON, elev=r.ELEV, wmo=r.wmo, icao=r.ICAO or None))
    for r in ghcn.itertuples():
        rows.append(dict(source='ghcn', src_id=r.id, name=r.name, lat=r.lat, lon=r.lon, elev=r.elev, wmo=r.wmo, icao=None))
    for r in iem.itertuples():
        rows.append(dict(source='iem', src_id=r.icao, name=r.name, lat=r.lat, lon=r.lon, elev=r.elev, wmo=r.wmo, icao=r.icao))
    d = pd.DataFrame(rows)
    d['elev'] = pd.to_numeric(d.elev, errors='coerce')
    d['station_id'] = d.wmo
    order = lambda s: s.map({'isd': 0, 'ghcn': 1, 'iem': 2})
    anchors = {}
    for r in d[d.wmo.notna()].sort_values('source', key=order).itertuples():
        anchors.setdefault(r.wmo, (r.wmo, r.name, r.lat, r.lon, r.elev))
    for a in pmd_anchors():
        anchors.setdefault(a[0], a)
    anchors = list(anchors.values())
    for i in d.index[d.station_id.isna()]:
        r = d.loc[i]
        cand = [(km(r.lat, r.lon, a[2], a[3]), a) for a in anchors]
        close = [c for c in cand if c[0] <= MATCH_KM and not (np.isfinite(r.elev) and np.isfinite(c[1][4]) and abs(r.elev - c[1][4]) > MATCH_ELEV_M)]
        named = [c for c in cand if c[0] <= NAME_MATCH_KM and first_word(r['name']) and first_word(r['name']) == first_word(c[1][1])]
        pick = min(close, key=lambda c: c[0]) if close else (min(named, key=lambda c: c[0]) if named else None)
        d.loc[i, 'station_id'] = pick[1][0] if pick else (r.icao if pd.notna(r.icao) and r.icao else r.src_id)
    # stations of two sources that kept their own ids but sit at the same place: merge into the first
    taken = set(a[0] for a in anchors)
    own = d[~d.station_id.isin(taken)].sort_values('source', key=order)
    seen = []
    for i, r in own.iterrows():
        hit = next((j for j in seen if d.loc[j, 'station_id'] != r.station_id and d.loc[j, 'source'] != r.source
                    and km(r.lat, r.lon, d.loc[j, 'lat'], d.loc[j, 'lon']) <= MATCH_KM), None)
        if hit is not None:
            d.loc[i, 'station_id'] = d.loc[hit, 'station_id']
        else:
            seen.append(i)
    return d


# ---------------------------------------------------------------- parsers (pure; tested)
def clip(d):
    for c, (lo, hi) in BOUNDS.items():
        if c in d:
            d.loc[(d[c] < lo) | (d[c] > hi), c] = np.nan
    return d


def parse_isd_lite(blob):
    """ISD-Lite text (gzip) -> time (UTC), temp_c, dewpt_c, slp_hpa, wind_dir, wind_ms, precip_1h_mm, precip_6h_mm. -9999 is missing, -1 precipitation is a trace (0)."""
    d = pd.read_csv(io.BytesIO(gzip.decompress(blob)), sep=r'\s+', header=None, na_values=['-9999'],
                    names=['y', 'm', 'd', 'h', 'temp', 'dewp', 'slp', 'wdir', 'wspd', 'sky', 'p1', 'p6'])
    out = pd.DataFrame({'time': pd.to_datetime(dict(year=d.y, month=d.m, day=d.d, hour=d.h)), 'temp_c': d.temp / 10, 'dewpt_c': d.dewp / 10,
                        'slp_hpa': d.slp / 10, 'wind_dir': d.wdir, 'wind_ms': d.wspd / 10,
                        'precip_1h_mm': d.p1.where(d.p1 != -1, 0) / 10, 'precip_6h_mm': d.p6.where(d.p6 != -1, 0) / 10})
    out.loc[out.wind_dir == 0, 'wind_dir'] = np.nan            # ISD-Lite: 0 is calm / variable only with zero speed; a direction of 0 is stored as 360
    out.loc[(out.wind_ms == 0), 'wind_dir'] = np.nan
    out.loc[out.dewpt_c > out.temp_c + 1, 'dewpt_c'] = np.nan
    return clip(out)


def parse_iem(text):
    """IEM CSV (onlycomma, UTC) -> hourly: the report nearest each hour, time (UTC, on the hour), same value columns as ISD-Lite."""
    d = pd.read_csv(io.StringIO(text), na_values=['', 'M'])
    if d.empty:
        return pd.DataFrame(columns=['time'] + HOURLY_COLS)
    d['valid'] = pd.to_datetime(d['valid'])
    d['time'] = d['valid'].dt.round('h')
    d['gap'] = (d['valid'] - d['time']).abs()
    d = d.sort_values(['time', 'gap']).drop_duplicates('time')
    out = pd.DataFrame({'time': d.time, 'temp_c': (d.tmpf - 32) * 5 / 9, 'dewpt_c': (d.dwpf - 32) * 5 / 9, 'wind_ms': d.sknt * 0.514444,
                        'wind_dir': d.drct, 'slp_hpa': d.mslp, 'precip_1h_mm': d.p01m, 'precip_6h_mm': np.nan})
    out.loc[out.wind_ms == 0, 'wind_dir'] = np.nan
    out.loc[out.dewpt_c > out.temp_c + 1, 'dewpt_c'] = np.nan
    return clip(out)


def parse_ghcn(text, start):
    """GHCN-Daily station CSV -> date, tmax_c, tmin_c, precip_mm (tenths converted); values with a quality flag are dropped."""
    d = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    d = d[d.ELEMENT.isin(['TMAX', 'TMIN', 'PRCP']) & (d.Q_FLAG == '') & (d.DATE >= f'{start}0101')]
    d = d.assign(v=pd.to_numeric(d.DATA_VALUE, errors='coerce') / 10, date=pd.to_datetime(d.DATE, format='%Y%m%d'))
    w = d.pivot_table(index='date', columns='ELEMENT', values='v', aggfunc='first').reset_index()
    for c in ('TMAX', 'TMIN', 'PRCP'):
        if c not in w:
            w[c] = np.nan
    return clip(w.rename(columns={'TMAX': 'tmax_c', 'TMIN': 'tmin_c', 'PRCP': 'precip_mm'})[['date', 'tmax_c', 'tmin_c', 'precip_mm']])


def merge_hourly(isd, iem):
    """ISD wins; IEM fills the hours ISD lacks and the fields it leaves empty. Both: station_id, time, HOURLY_COLS."""
    a = isd.drop_duplicates(['station_id', 'time']).set_index(['station_id', 'time'])
    b = iem.drop_duplicates(['station_id', 'time']).set_index(['station_id', 'time'])
    m = a.combine_first(b)
    src = pd.Series('iem', index=m.index)
    src[m.index.isin(a.index)] = 'isd'
    src[m.index.isin(a.index) & m.index.isin(b.index)] = 'isd+iem'
    m['source'] = src
    return m.reset_index().dropna(subset=HOURLY_COLS, how='all').sort_values(['station_id', 'time'])[['station_id', 'time'] + HOURLY_COLS + ['source']]


# ---------------------------------------------------------------- build
def write_partition(frame, kind, year):
    p = OUT / kind / f'year={year}' / 'part.parquet'
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    frame.to_parquet(tmp, index=False)
    tmp.replace(p)


def main():
    this_year = dt.date.today().year
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', type=int, default=2000)
    ap.add_argument('--end', type=int, default=this_year)
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--skip', action='append', default=[], choices=['isd', 'iem', 'ghcn'])
    ap.add_argument('--force', action='store_true', help='download everything again')
    a = ap.parse_args()
    t0 = time.time()
    years = list(range(a.start, a.end + 1))

    isd, ghcn = isd_stations(), ghcn_stations()
    iem = iem_stations({r.ICAO: r.wmo for r in isd.itertuples() if r.ICAO and r.wmo})
    st = build_stations(isd, ghcn, iem)
    log(f'stations: ISD {len(isd)}, GHCN-Daily {len(ghcn)}, IEM {len(iem)} -> {st.station_id.nunique()} distinct places')

    # ---- ISD-Lite: one file per station and year
    isd_ids = {f'{r.USAF}-{r.WBAN}': (r.USAF, r.WBAN) for r in isd.itertuples()}
    span = {f'{r.USAF}-{r.WBAN}': (int(r.BEGIN[:4]), int(r.END[:4])) for r in isd.itertuples()}      # a station has files only in these years
    sid = dict(zip(st.src_id[st.source == 'isd'], st.station_id[st.source == 'isd']))
    jobs = [(k, y) for k in isd_ids for y in years if span[k][0] <= y <= span[k][1]]
    isd_frames = {y: [] for y in years}
    if 'isd' not in a.skip:
        def one(job):
            k, y = job
            usaf, wban = isd_ids[k]
            p = cached(RAW / 'isd' / str(y) / f'{k}.gz', ISD_LITE.format(year=y, usaf=usaf, wban=wban), REFRESH_S if y >= this_year - 1 else None, a.force)
            return job, (parse_isd_lite(p.read_bytes()) if p else None)
        log(f'ISD-Lite: {len(jobs)} station-years')
        n_files = 0
        with ThreadPoolExecutor(a.workers) as ex:
            for (k, y), f in ex.map(one, jobs):
                if f is not None and len(f):
                    isd_frames[y].append(f.assign(station_id=sid[k])); n_files += 1
        log(f'  {n_files} files with data')

    # ---- IEM: per station, five-year chunks, converted to hourly
    iem_hourly = []
    if 'iem' not in a.skip:
        chunks = [(r.icao, y1, min(y1 + IEM_CHUNK_YEARS - 1, a.end)) for r in iem.itertuples() for y1 in range(a.start, a.end + 1, IEM_CHUNK_YEARS)]
        sid_iem = dict(zip(st.src_id[st.source == 'iem'], st.station_id[st.source == 'iem']))

        failed = []

        def one_iem(c):
            icao, y1, y2 = c
            try:
                p = cached(RAW / 'iem' / f'{icao}_{y1}_{y2}.csv', IEM_ASOS.format(st=icao, y1=y1, y2=y2), REFRESH_S if y2 >= this_year else None, a.force)
                return icao, (parse_iem(p.read_text()) if p else None)
            except Exception as e:                                         # one bad chunk must not lose the others; a rerun fetches it again
                failed.append((icao, y1, str(e)[-80:]))
                return icao, None
        log(f'IEM: {len(chunks)} station-years')
        with ThreadPoolExecutor(min(4, a.workers)) as ex:                 # IEM is a shared service: few requests at a time
            for icao, f in ex.map(one_iem, chunks):
                if f is not None and len(f):
                    iem_hourly.append(f.assign(station_id=sid_iem[icao]))
        if failed:
            log(f'  {len(failed)} IEM chunks failed (run again to retry them): {failed[:4]}')
    iem_all = pd.concat(iem_hourly, ignore_index=True) if iem_hourly else pd.DataFrame(columns=['station_id', 'time'] + HOURLY_COLS)

    # ---- hourly partitions
    rows = {}
    for y in years:
        i = pd.concat(isd_frames[y], ignore_index=True) if isd_frames[y] else pd.DataFrame(columns=['station_id', 'time'] + HOURLY_COLS)
        e = iem_all[(iem_all.time >= pd.Timestamp(y, 1, 1)) & (iem_all.time < pd.Timestamp(y + 1, 1, 1))]
        h = merge_hourly(i, e)
        if len(h):
            write_partition(h, 'hourly', y)
        rows[y] = (len(i), len(e), len(h), int((h.source == 'isd+iem').sum()) if len(h) else 0, h.station_id.nunique() if len(h) else 0)
    log('hourly partitions written (year: ISD rows, IEM rows, merged rows, hours in both, stations)')
    for y, r in rows.items():
        if r[2]:
            print(f'   {y}: {r[0]:>8,} {r[1]:>8,} {r[2]:>8,} {r[3]:>7,} {r[4]:>3}')

    # ---- GHCN-Daily
    daily_all = []
    if 'ghcn' not in a.skip:
        prio = {'PKM': 0, 'PK0': 1}
        sid_g = dict(zip(st.src_id[st.source == 'ghcn'], st.station_id[st.source == 'ghcn']))

        def one_g(i):
            p = cached(RAW / 'ghcn' / f'{i}.csv', GHCN_FILE.format(id=i), REFRESH_S, a.force)
            return i, (parse_ghcn(p.read_text(), a.start) if p else None)
        log(f'GHCN-Daily: {len(ghcn)} stations')
        with ThreadPoolExecutor(min(8, a.workers)) as ex:
            for i, f in ex.map(one_g, list(ghcn.id)):
                if f is not None and len(f):
                    daily_all.append(f.assign(station_id=sid_g[i], rank=prio.get(i[:3], 2)))
    if daily_all:
        d = pd.concat(daily_all, ignore_index=True).sort_values(['station_id', 'date', 'rank'])
        parts = [g.drop(columns='rank').set_index(['station_id', 'date']) for _, g in d.groupby('rank')]
        m = parts[0]
        for g in parts[1:]:
            m = m.combine_first(g[~g.index.duplicated()])
        d = m.reset_index().dropna(subset=['tmax_c', 'tmin_c', 'precip_mm'], how='all')
        d = d[(d.date >= pd.Timestamp(a.start, 1, 1)) & (d.date < pd.Timestamp(a.end + 1, 1, 1))]
        for y, g in d.groupby(d.date.dt.year):
            write_partition(g.reset_index(drop=True), 'daily', int(y))
        log(f'daily partitions written: {len(d):,} station-days, {d.station_id.nunique()} stations, {d.date.min():%Y-%m-%d} to {d.date.max():%Y-%m-%d}')
    else:
        d = pd.DataFrame(columns=['station_id', 'date', 'tmax_c', 'tmin_c', 'precip_mm'])

    # ---- station table with coverage
    h_cov = iem_all.groupby('station_id').time.agg(['min', 'max'])
    cov = {}
    for p in sorted((OUT / 'hourly').glob('year=*/part.parquet')):
        g = pd.read_parquet(p, columns=['station_id', 'time']).groupby('station_id').time.agg(['min', 'max', 'size'])
        for s, r in g.iterrows():
            c = cov.setdefault(s, [r['min'], r['max'], 0]); c[0] = min(c[0], r['min']); c[1] = max(c[1], r['max']); c[2] += int(r['size'])
    dd = d.groupby('station_id').date.agg(['min', 'max', 'size']) if len(d) else pd.DataFrame(columns=['min', 'max', 'size'])
    first = st.sort_values('source', key=lambda s: s.map({'isd': 0, 'ghcn': 1, 'iem': 2})).drop_duplicates('station_id')
    tab = first[['station_id', 'name', 'lat', 'lon', 'elev', 'wmo']].rename(columns={'elev': 'elev_m'})
    tab['icao'] = tab.station_id.map(st.dropna(subset=['icao']).drop_duplicates('station_id').set_index('station_id').icao)
    for s in ('isd', 'ghcn', 'iem'):
        tab[f'{s}_ids'] = tab.station_id.map(st[st.source == s].groupby('station_id').src_id.agg(','.join)).fillna('')
    tab['hourly_first'] = tab.station_id.map(lambda s: cov.get(s, [pd.NaT])[0]); tab['hourly_last'] = tab.station_id.map(lambda s: cov.get(s, [None, pd.NaT])[1])
    tab['n_hourly'] = tab.station_id.map(lambda s: cov.get(s, [0, 0, 0])[2]).astype(int)
    tab['daily_first'] = tab.station_id.map(dd['min']); tab['daily_last'] = tab.station_id.map(dd['max'])
    tab['n_daily'] = tab.station_id.map(dd['size']).fillna(0).astype(int)
    OUT.mkdir(parents=True, exist_ok=True)
    tab.to_parquet(OUT / 'stations.parquet', index=False)
    key = {'41571': 'Islamabad / Chaklala', '41572': 'Islamabad airport', '41517': 'Skardu', '41516': 'Gilgit', '41506': 'Chitral', '41530': 'Peshawar'}
    log(f'stations.parquet: {len(tab)} stations, {int((tab.n_hourly > 0).sum())} with hourly data, {int((tab.n_daily > 0).sum())} with daily data')
    print('key stations (hourly rows / daily days):')
    for w, name in key.items():
        r = tab[tab.station_id == w]
        print(f'   {w} {name:22} ' + (f'{int(r.n_hourly.iloc[0]):>8,} / {int(r.n_daily.iloc[0]):>6,}' if len(r) else 'not in the NOAA lists'))
    log(f'done in {(time.time() - t0) / 60:.1f} min -> {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
