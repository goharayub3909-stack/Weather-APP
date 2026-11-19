"""Daily precipitation baselines for Pakistan from Earth Engine: PARDIG (default) and CHIRPS.

PARDIG (Precipitation AI Reanalysis - Densely Inferred GPM; Google DeepMind / Google Research, experimental; CC BY 4.0;
arXiv 2611.13941): AI estimates trained on the GPM Core Observatory's combined radar-radiometer retrievals, 0.1 degree, every 15 minutes,
band `precipitation` = instantaneous rate in m/h.
  projects/gcp-public-data-weathernext/assets/PARDIG_1_LR   long record 1999-2023 (inputs ERA5, GridSat-B1, microwave sounders)
  projects/gcp-public-data-weathernext/assets/PARDIG_1_NRT  near-real-time 2016 onward (inputs ECMWF HRES, SatWeave)
LR is used through the window ending 2024-01-01 03 UTC, NRT after it.
Daily value: the 24 h ending 03 UTC (08:00 PKT), the window of PMD's rain reports: sum of the 96 rates x 0.25 h x 1000 = mm.
Grid: PARDIG's own 0.1 degree cells, centres on multiples of 0.1 degree (the ECMWF / ERA5-Land nodes), 60-78 E, 23-37 N.

CHIRPS (UCSB-CHG/CHIRPS/DAILY, Climate Hazards Center; public domain-like, cite Funk et al. 2015): 0.05 degree, land only, mm/day for its
own day (not the PMD window), averaged onto the same 0.1 degree grid.

Output: downscaler/data/precip_baseline/source=<pardig|chirps>/year=YYYY/month=MM/part.parquet   columns date, lat, lon, precip_mm
Months already written are skipped. Needs Earth Engine authentication and a Cloud project (--ee-project or EE_PROJECT).

Run: .venv-terrain/Scripts/python.exe scripts/pull_pardig.py [--source pardig|chirps] [--start 2010-01] [--end 2026-10] [--workers 4]
"""
import argparse
import datetime as dt
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / 'downscaler' / 'data' / 'precip_baseline'
LR = 'projects/gcp-public-data-weathernext/assets/PARDIG_1_LR'
NRT = 'projects/gcp-public-data-weathernext/assets/PARDIG_1_NRT'
CHIRPS = 'UCSB-CHG/CHIRPS/DAILY'
LR_LAST_WINDOW_END = pd.Timestamp('2024-01-01 03:00')     # LR covers 1999-2023; windows ending later come from NRT
WEST, NORTH, RES, NX, NY = 60.0, 37.0, 0.1, 181, 141       # cell centres 60.0..78.0 E, 37.0..23.0 N
GRID = {'dimensions': {'width': NX, 'height': NY}, 'crsCode': 'EPSG:4326',
        'affineTransform': {'scaleX': RES, 'shearX': 0, 'translateX': WEST - RES / 2, 'shearY': 0, 'scaleY': -RES, 'translateY': NORTH + RES / 2}}
WINDOW_END_UTC_HOUR = 3                                     # 08:00 PKT


REFRESH_DAYS = 45                 # months this recent are fetched again (the archives grow: NRT lags a few hours, CHIRPS weeks)
_LAST = {}


def last_available(ee, source):
    """Newest data time (naive UTC) of the source's archive: PARDIG NRT's last 15-minute image start, CHIRPS's last day."""
    if source not in _LAST:
        col = ee.ImageCollection(NRT if source == 'pardig' else CHIRPS)
        t = col.sort('system:time_start', False).first().get('system:time_start').getInfo()
        _LAST[source] = pd.Timestamp(t, unit='ms') + pd.Timedelta(minutes=15 if source == 'pardig' else 1440)
    return _LAST[source]


def partition(source, year, month):
    return OUT / f'source={source}' / f'year={year}' / f'month={month:02d}' / 'part.parquet'


def pardig_day(ee, date):
    """24 h total (mm) ending 03 UTC on `date`."""
    end = pd.Timestamp(date) + pd.Timedelta(hours=WINDOW_END_UTC_HOUR)
    start = end - pd.Timedelta(days=1)
    cid = LR if end <= LR_LAST_WINDOW_END else NRT
    col = ee.ImageCollection(cid).filterDate(start.strftime('%Y-%m-%dT%H:%M'), end.strftime('%Y-%m-%dT%H:%M')).select('precipitation')
    # each 15-min rate (m/h) stands for a quarter of an hour; the count is kept to flag gaps
    return col.sum().multiply(0.25 * 1000).rename('p').addBands(col.count().rename('n')), cid


def chirps_day(ee, date):
    d = pd.Timestamp(date)
    img = ee.ImageCollection(CHIRPS).filterDate(d.strftime('%Y-%m-%d'), (d + pd.Timedelta(days=1)).strftime('%Y-%m-%d')).first()
    # the mean of the 0.05 degree cells inside each 0.1 degree cell (sea stays empty)
    p = img.select('precipitation').reduceResolution(ee.Reducer.mean(), maxPixels=16).reproject(
        crs='EPSG:4326', crsTransform=[RES, 0, WEST - RES / 2, 0, -RES, NORTH + RES / 2])
    return p.rename('p').addBands(ee.Image.constant(1).rename('n')), CHIRPS


def fetch_month(source, year, month, tries=4, log=print):
    import ee
    target = partition(source, year, month)
    recent = pd.Period(f'{year}-{month:02d}').end_time > pd.Timestamp.now() - pd.Timedelta(days=REFRESH_DAYS)
    if target.exists() and not recent:
        return 'cached'
    limit = last_available(ee, source)
    days = pd.date_range(f'{year}-{month:02d}-01', periods=pd.Period(f'{year}-{month:02d}').days_in_month, freq='D')
    # PARDIG: the whole 24 h window must be in the archive; CHIRPS: the day must be
    days = [d for d in days if (d + pd.Timedelta(hours=WINDOW_END_UTC_HOUR) <= limit if source == 'pardig' else d + pd.Timedelta(days=1) <= limit)]
    if not days:
        return 'no complete days yet'
    frames, used = [], set()
    for chunk in (days[:16], days[16:]):                      # two requests a month keep each computation small
        if not chunk:
            continue
        imgs = []
        for d in chunk:
            img, cid = (pardig_day if source == 'pardig' else chirps_day)(ee, d)
            used.add(cid.split('/')[-1]); imgs.append(img.rename([f'p_{d:%Y%m%d}', f'n_{d:%Y%m%d}']))
        stack = ee.Image.cat(imgs)
        for k in range(tries):
            try:
                arr = ee.data.computePixels({'expression': stack, 'fileFormat': 'NUMPY_NDARRAY', 'grid': GRID})
                break
            except Exception as e:                               # quota or transient: back off
                if k == tries - 1:
                    raise
                log(f'  {source} {year}-{month:02d}: {type(e).__name__} {str(e)[:120]}; retrying')
                time.sleep(20 * (k + 1))
        lat = NORTH - RES * np.arange(NY)
        lon = WEST + RES * np.arange(NX)
        for d in chunk:
            p = np.asarray(arr[f'p_{d:%Y%m%d}'], np.float32)
            n = np.asarray(arr[f'n_{d:%Y%m%d}'], np.float32)
            if source == 'pardig':
                p = np.where(n >= 90, p, np.nan)                 # fewer than 90 of 96 quarter-hours: the day is not complete
            frames.append(pd.DataFrame({'date': d, 'lat': np.repeat(lat, NX).round(2), 'lon': np.tile(lon, NY).round(2), 'precip_mm': p.reshape(-1)}))
    frame = pd.concat(frames, ignore_index=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.tmp')
    frame.to_parquet(tmp, index=False)
    tmp.replace(target)
    return f'{len(days)} days from {", ".join(sorted(used))}, mean {np.nanmean(frame.precip_mm):.2f} mm/day'


def load(source='pardig', start=None, end=None):
    parts = sorted((OUT / f'source={source}').glob('year=*/month=*/part.parquet'))
    if not parts:
        return pd.DataFrame(columns=['date', 'lat', 'lon', 'precip_mm'])
    d = pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True)
    if start is not None:
        d = d[d.date >= pd.Timestamp(start)]
    if end is not None:
        d = d[d.date <= pd.Timestamp(end)]
    return d


def main():
    last = (pd.Timestamp(dt.date.today()).to_period('M')).strftime('%Y-%m')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', choices=['pardig', 'chirps'], default='pardig')
    ap.add_argument('--start', default='2010-01')
    ap.add_argument('--end', default=last)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--ee-project', default=os.environ.get('EE_PROJECT', 'calude-app'))
    a = ap.parse_args()
    import ee
    ee.Initialize(project=a.ee_project)
    p, q = pd.Period(a.start, 'M'), pd.Period(a.end, 'M')
    todo = []
    while p <= q:
        todo.append((p.year, p.month)); p += 1
    print(f'{a.source}: {len(todo)} months {a.start} to {a.end} -> {OUT / ("source=" + a.source)}', flush=True)
    t0, failed = time.time(), []
    with ThreadPoolExecutor(a.workers) as ex:
        jobs = {ex.submit(fetch_month, a.source, y, m): (y, m) for y, m in todo}
        for n, f in enumerate(as_completed(jobs), 1):
            y, m = jobs[f]
            try:
                print(f'  {y}-{m:02d}: {f.result()} ({n}/{len(todo)}, {time.time() - t0:.0f} s)', flush=True)
            except Exception as e:
                failed.append((y, m)); print(f'  {y}-{m:02d}: FAILED {type(e).__name__}: {str(e)[:200]}', flush=True)
    print(f'done in {(time.time() - t0) / 60:.1f} min; {len(failed)} months failed' + (f': {failed[:6]}' if failed else ''))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
