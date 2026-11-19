"""ERA5 upper-air daily predictors for the 1 km downscaler (v2), from the Copernicus Climate Data Store.

Datasets (ERA5 hourly, 0.25 degree; Copernicus licence: free for any use, commercial included, with attribution
"Contains modified Copernicus Climate Change Service information"):
  reanalysis-era5-pressure-levels   specific humidity q (kg/kg), relative humidity r (%), u and v wind (m/s) at 850 and 700 hPa
  reanalysis-era5-single-levels     convective available potential energy (J/kg)
Box 23-37 N, 60-78 E. One CAPE request per year and one pressure-level request per quarter (CDS cost limits, found by trial on 2026-11-17: a year
or a half-year of the eight variable-levels is refused, a quarter accepted), at 3-hourly times (00, 03, ... 21 UTC): the same 3-hourly sampling the forecast step
has from ECMWF's open data, so training and runtime features are computed the same way. Daily values per UTC day, from the eight samples:
mean of q, r, u, v; maximum of CAPE (cape_max).

Why not CDS's "daily statistics" datasets: on 2026-11-17 their jobs sat in the queue for hours without starting (pressure-level requests are also limited
to about 12 variable-level-months each), and the point time-series datasets do not carry CAPE. The classic hourly datasets answered in about two minutes.

Output, one partition per month:
  downscaler/data/era5_upper/year=YYYY/month=MM/part.parquet   columns date, lat, lon, cape_max, q850, r850, q700, r700, u850, v850, u700, v700
Downloads are kept in downscaler/data/era5_upper/raw/ and months already written are skipped, so an interrupted run resumes.
Years are fetched in the --priority order first (2022 and 2010, the held-out years of the v2 validation, then its early-stopping years 2019 and 2015).

Needs ~/.cdsapirc (CDS key) and the ERA5 licence accepted on the CDS website.

Run: .venv-terrain/Scripts/python.exe scripts/pull_era5_upper_air.py [--start 2010-01] [--end 2026-10] [--workers 6] [--priority 2022,2010,2019,2015]
"""
import argparse
import datetime as dt
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / 'downscaler' / 'data' / 'era5_upper'
RAW = OUT / 'raw'
AREA = [37, 60, 23, 78]                 # north, west, south, east (CDS order)
LEVELS = ['850', '700']
PL_VARS = ['specific_humidity', 'relative_humidity', 'u_component_of_wind', 'v_component_of_wind']
TIMES = [f'{h:02d}:00' for h in range(0, 24, 3)]
SAMPLES_PER_DAY = len(TIMES)
COLUMNS = ['date', 'lat', 'lon', 'cape_max', 'q850', 'r850', 'q700', 'r700', 'u850', 'v850', 'u700', 'v700']
PL_DATASET = 'reanalysis-era5-pressure-levels'
SL_DATASET = 'reanalysis-era5-single-levels'


def partition(year, month):
    return OUT / f'year={year}' / f'month={month:02d}' / 'part.parquet'


def raw_file(kind, year, quarter=None):
    return RAW / (f'sl_{year}.nc' if kind == 'sl' else f'pl_{year}_q{quarter + 1}.nc')


def months_in(year, first, last):
    return [m for m in range(1, 13) if first <= pd.Period(f'{year}-{m:02d}') <= last]


def request(kind, year, months):
    common = dict(product_type=['reanalysis'], year=[str(year)], month=[f'{m:02d}' for m in months], day=[f'{d:02d}' for d in range(1, 32)],
                  time=TIMES, data_format='netcdf', download_format='unarchived', area=AREA)
    if kind == 'pl':
        return PL_DATASET, dict(common, variable=PL_VARS, pressure_level=LEVELS)
    return SL_DATASET, dict(common, variable=['convective_available_potential_energy'])


def tasks(years, first, last, only=None):
    """[(kind, year, quarter or None, months)] still to download, in the order of `years`."""
    out = []
    for y in years:
        ms = months_in(y, first, last)
        if not ms or all(partition(y, m).exists() for m in ms):
            continue
        if only in (None, 'sl'):
            out.append(('sl', y, None, ms))
        if only in (None, 'pl'):
            for q in range(4):
                mq = [m for m in ms if (m - 1) // 3 == q and not partition(y, m).exists()]
                if mq:
                    out.append(('pl', y, q, mq))
    return out


def download(task, log=print, tries=4):
    import cdsapi
    kind, year, quarter, months = task
    target = raw_file(kind, year, quarter)
    if target.exists():
        return 'cached'
    client = cdsapi.Client(quiet=True, progress=False)
    name, req = request(kind, year, months)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.part')
    for k in range(tries):
        try:
            client.retrieve(name, req, str(tmp))
            tmp.replace(target)
            return f'{target.name} ({target.stat().st_size / 1e6:.0f} MB)'
        except Exception as e:                                    # queue limits, transient errors: back off and retry; a licence or size error is final
            if k == tries - 1 or any(w in str(e).lower() for w in ('licence', 'too large')):
                raise
            log(f'  {target.name}: {type(e).__name__}, retrying')
            time.sleep(30 * (k + 1))


# ---------------------------------------------------------------- aggregation (pure; tested)
def daily(values, times, how):
    """values: (nt, ...) hourly-or-3-hourly samples, times: nt timestamps. -> (dates, (nd, ...)) per UTC day: how = 'mean' or 'max'.
    A day with fewer than SAMPLES_PER_DAY samples is dropped (never averaged from a partial day)."""
    t = pd.DatetimeIndex(times)
    days = t.normalize()
    uniq, inverse, counts = np.unique(days.values, return_inverse=True, return_counts=True)
    keep = counts == SAMPLES_PER_DAY
    out = np.full((len(uniq),) + values.shape[1:], np.nan, dtype=np.float64)
    f = np.nanmean if how == 'mean' else np.nanmax
    for i in np.flatnonzero(keep):
        out[i] = f(values[inverse == i], axis=0)
    return pd.DatetimeIndex(uniq)[keep], out[keep]


def _dim(ds, names):
    return next(d for d in names if d in ds.dims)


def month_frame(year, month):
    """One month's long table from the quarter's pressure-level download and the year's CAPE download."""
    import xarray as xr
    first, last = pd.Timestamp(year, month, 1), pd.Timestamp(year, month, 1) + pd.offsets.MonthEnd(0)
    cols, dates, lat, lon = {}, None, None, None
    ds = xr.open_dataset(raw_file('pl', year, (month - 1) // 3))
    t = _dim(ds, ('valid_time', 'time')); lev = _dim(ds, ('pressure_level', 'level', 'isobaricInhPa'))
    times = pd.to_datetime(ds[t].values)
    for var in ('q', 'r', 'u', 'v'):
        for L in LEVELS:
            a = ds[var].sel({lev: float(L)}).transpose(t, 'latitude', 'longitude').values
            d, m = daily(a, times, 'mean')
            cols[f'{var}{L}'] = m
            dates = d
    lat, lon = ds['latitude'].values, ds['longitude'].values
    ds.close()
    ds = xr.open_dataset(raw_file('sl', year))
    t = _dim(ds, ('valid_time', 'time'))
    cape_d, cape = daily(ds['cape'].transpose(t, 'latitude', 'longitude').values, pd.to_datetime(ds[t].values), 'max')
    ds.close()
    keep = (dates >= first) & (dates <= last)             # this month in the quarter's file ...
    keep_c = (cape_d >= first) & (cape_d <= last)         # ... and in the year's CAPE file
    if not keep.any():
        return pd.DataFrame(columns=COLUMNS)
    if not cape_d[keep_c].equals(dates[keep]):
        raise RuntimeError(f'{year}-{month:02d}: CAPE and pressure-level days differ')
    nt, ny, nx = int(keep.sum()), len(lat), len(lon)
    frame = pd.DataFrame({'date': np.repeat(dates[keep], ny * nx), 'lat': np.tile(np.repeat(lat, nx), nt).round(2), 'lon': np.tile(lon, nt * ny).round(2),
                          'cape_max': cape[keep_c].reshape(-1).astype(np.float32)})
    for k in ('q850', 'r850', 'q700', 'r700', 'u850', 'v850', 'u700', 'v700'):
        frame[k] = cols[k][keep].reshape(-1).astype(np.float32)
    return frame[COLUMNS]


def assemble(year, first, last):
    """Write the month partitions of a year whose raw files have arrived. -> number written."""
    if not raw_file('sl', year).exists():
        return 0
    n = 0
    for m in months_in(year, first, last):
        target = partition(year, m)
        if target.exists() or not raw_file('pl', year, (m - 1) // 3).exists():
            continue
        f = month_frame(year, m)
        if f.empty:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix('.tmp')
        f.to_parquet(tmp, index=False)
        tmp.replace(target)
        n += 1
    return n


def load(start=None, end=None):
    """All partitions (optionally limited to dates) as one table."""
    parts = sorted(OUT.glob('year=*/month=*/part.parquet'))
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    d = pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True)
    if start is not None:
        d = d[d.date >= pd.Timestamp(start)]
    if end is not None:
        d = d[d.date <= pd.Timestamp(end)]
    return d


def main():
    last_default = (pd.Timestamp(dt.date.today()).to_period('M') - 1).strftime('%Y-%m')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', default='2010-01')
    ap.add_argument('--end', default=last_default, help='last month (default: the last complete month)')
    ap.add_argument('--workers', type=int, default=6, help='requests in flight at CDS')
    ap.add_argument('--priority', default='2022,2010,2019,2015', help='years fetched first, comma separated')
    ap.add_argument('--only', choices=['pl', 'sl'], help='request only the pressure-level or only the CAPE downloads')
    a = ap.parse_args()
    first, last = pd.Period(a.start, 'M'), pd.Period(a.end, 'M')
    years = list(range(first.year, last.year + 1))
    pri = [int(y) for y in a.priority.split(',') if y and first.year <= int(y) <= last.year]
    years = pri + [y for y in years if y not in pri]
    todo = tasks(years, first, last, a.only)
    print(f'ERA5 upper air {a.start} to {a.end}: {len(todo)} requests ({sum(t[0] == "sl" for t in todo)} CAPE, {sum(t[0] == "pl" for t in todo)} pressure-level), '
          f'{a.workers} at a time, year order {years[:6]}...', flush=True)
    t0, failed, done = time.time(), [], 0
    with ThreadPoolExecutor(a.workers) as ex:
        jobs = {ex.submit(download, t): t for t in todo}
        for f in as_completed(jobs):
            t = jobs[f]
            try:
                r = f.result(); done += 1
                w = assemble(t[1], first, last)
                print(f'  {t[0]} {t[1]}{"" if t[2] is None else " Q" + str(t[2] + 1)}: {r}; {done}/{len(todo)}, {w} month(s) written, {(time.time() - t0) / 60:.0f} min', flush=True)
            except Exception as e:
                failed.append(t[:3]); print(f'  {t[:3]}: FAILED {type(e).__name__}: {str(e)[:200]}', flush=True)
    for y in years:
        assemble(y, first, last)
    n = len(list(OUT.glob('year=*/month=*/part.parquet')))
    print(f'done in {(time.time() - t0) / 60:.1f} min; {n} month partitions; {len(failed)} requests failed' + (f': {failed[:6]}' if failed else ''))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
