"""ERA5 upper-air predictors at the station grid cells only, from the Copernicus CDS point time-series datasets (fast alternative to
scripts/pull_era5_upper_air.py, whose regional queue takes days).

Dataset: reanalysis-era5-pressure-levels-timeseries (ERA5, 0.25 degree, 1940 to present; Copernicus licence, free for any use incl. commercial, with
attribution "Contains modified Copernicus Climate Change Service information"). One request = one grid cell x one variable x a span of dates; the
service refuses several variables in one request and always returns all 13 levels, of which 850 and 700 hPa are kept. It samples ERA5 at 00, 06, 12
and 18 UTC (the regional pull uses 3-hourly times), so a daily value here is the mean of FOUR samples per UTC day instead of eight: close, not
identical, to scripts/pull_era5_upper_air.py. Do not mix the two sources in one training matrix.
CAPE is not in the point datasets: cape_max is taken from the regional single-level downloads (downscaler/data/era5_upper/raw/sl_<year>.nc, see
pull_era5_upper_air.py --only sl) at the same cell, and stays empty for years whose file has not arrived (rerun to fill them).

Cells: the 0.25 degree cell nearest each station of downscaler/data/pmd_training.parquet (the cell rule of merge_training_matrix.upper_for_stations).
Output (same layout and columns as the regional pull, but only the station cells):
  downscaler/data/era5_upper_points/year=YYYY/month=MM/part.parquet   date, lat, lon, cape_max, q850, r850, q700, r700, u850, v850, u700, v700
Downloads are kept per cell and variable in downscaler/data/era5_upper_points/raw/ (CSV reduced to 850 and 700 hPa); finished files are skipped, so an
interrupted run resumes. A request the service calls too large is split in half by date and retried.

Needs ~/.cdsapirc (CDS key) and the ERA5 licence accepted on the CDS website.
Run: .venv-terrain/Scripts/python.exe scripts/pull_era5_upper_points.py [--start 2010-01] [--end 2026-10] [--workers 6] [--assemble-only]
Then: merge_training_matrix.py --upper-dir downscaler/data/era5_upper_points
"""
import argparse
import datetime as dt
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pull_era5_upper_air as UA  # noqa: E402

DATA = HERE.parents[0] / 'downscaler' / 'data'
OUT = DATA / 'era5_upper_points'
RAW = OUT / 'raw'
DATASET = 'reanalysis-era5-pressure-levels-timeseries'
VARS = {'specific_humidity': 'q', 'relative_humidity': 'r', 'u_component_of_wind': 'u', 'v_component_of_wind': 'v'}
KEEP_LEVELS = (850.0, 700.0)
SAMPLES_PER_DAY = 4                                           # 00, 06, 12, 18 UTC
GRID = 0.25


def station_cells(matrix=None):
    """Sorted list of the (lat, lon) 0.25 degree cells nearest the stations: the same rounding as merge_training_matrix.upper_for_stations."""
    d = pd.read_parquet(matrix or DATA / 'pmd_training.parquet', columns=['station_id', 'lat', 'lon']).drop_duplicates('station_id')
    lat, lon = ((d.lat / GRID).round() * GRID).round(2), ((d.lon / GRID).round() * GRID).round(2)
    return sorted(set(zip(lat.tolist(), lon.tolist())))


def cell_name(lat, lon):
    return f'{lat:.2f}_{lon:.2f}'


def raw_path(lat, lon, var):
    return RAW / f'{cell_name(lat, lon)}_{VARS[var]}.parquet'


def tidy(csv_path):
    """CDS point CSV -> frame (time, level, value) with only the kept levels."""
    d = pd.read_csv(csv_path)
    val = [c for c in d.columns if c not in ('valid_time', 'pressureLevel', 'latitude', 'longitude')]
    if len(val) != 1:
        raise RuntimeError(f'{csv_path}: expected one value column, got {val}')
    d = d[d.pressureLevel.isin(KEEP_LEVELS)]
    return pd.DataFrame({'time': pd.to_datetime(d.valid_time), 'level': d.pressureLevel.astype(int), 'value': d[val[0]].astype(np.float32)})


def fetch(client, lat, lon, var, start, end, tmp_dir, log=print):
    """Frame for the dates start..end (pandas Timestamps, inclusive); splits the span in half when the service calls it too large."""
    name = f'{cell_name(lat, lon)}_{VARS[var]}_{start:%Y%m%d}_{end:%Y%m%d}.csv'
    target = tmp_dir / name
    try:
        client.retrieve(DATASET, dict(variable=[var], pressure_level=['850', '700'], location={'longitude': lon, 'latitude': lat},
                                      date=[f'{start:%Y-%m-%d}/{end:%Y-%m-%d}'], data_format='csv'), str(target))
    except Exception as e:
        if 'too large' in str(e).lower() and (end - start).days > 31:
            mid = start + (end - start) / 2
            mid = pd.Timestamp(mid).normalize()
            log(f'  {name}: too large, split at {mid:%Y-%m-%d}')
            return pd.concat([fetch(client, lat, lon, var, start, mid, tmp_dir, log), fetch(client, lat, lon, var, mid + pd.Timedelta(days=1), end, tmp_dir, log)], ignore_index=True)
        raise
    f = tidy(target)
    target.unlink()
    return f


def download(cell_var, start, end, tries=4, log=print):
    import cdsapi
    (lat, lon), var = cell_var
    target = raw_path(lat, lon, var)
    if target.exists():
        return 'cached'
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = RAW / 'tmp'
    tmp_dir.mkdir(exist_ok=True)
    client = cdsapi.Client(quiet=True, progress=False)
    for k in range(tries):
        try:
            f = fetch(client, lat, lon, var, start, end, tmp_dir, log)
            f = f.drop_duplicates(['time', 'level']).sort_values(['time', 'level']).reset_index(drop=True)
            tmp = target.with_suffix('.tmp')
            f.to_parquet(tmp, index=False)
            tmp.replace(target)
            return f'{len(f):,} rows'
        except Exception as e:
            if k == tries - 1 or any(w in str(e).lower() for w in ('licence', 'not found')):
                raise
            log(f'  {cell_name(lat, lon)} {VARS[var]}: {type(e).__name__}: {str(e)[:80]}, retrying')
            time.sleep(20 * (k + 1))


# ---------------------------------------------------------------- aggregation (pure; tested)
def daily_means(times, values):
    """Samples (any times) -> per UTC day mean, only for days with all four 6-hourly samples. -> Series indexed by date."""
    s = pd.Series(np.asarray(values, np.float64), index=pd.DatetimeIndex(times))
    g = s.groupby(s.index.normalize())
    out = g.mean()
    return out[g.count() == SAMPLES_PER_DAY]


def cell_frame(lat, lon):
    """Daily table of one cell: date, q850 ... v700 (NaN where a day is incomplete). None if a variable file is missing."""
    cols = {}
    for var, short in VARS.items():
        p = raw_path(lat, lon, var)
        if not p.exists():
            return None
        d = pd.read_parquet(p)
        for L in (850, 700):
            x = d[d.level == L]
            cols[f'{short}{L}'] = daily_means(x.time, x.value)
    f = pd.DataFrame(cols).dropna().rename_axis('date').reset_index()
    return f.assign(lat=lat, lon=lon)


def cape_for(cells, years):
    """Daily maximum of the 3-hourly regional CAPE at each cell -> frame (date, lat, lon, cape_max)."""
    import xarray as xr
    parts = []
    for y in years:
        p = UA.raw_file('sl', y)
        if not p.exists():
            continue
        ds = xr.open_dataset(p)
        t = UA._dim(ds, ('valid_time', 'time'))
        dates, cape = UA.daily(ds['cape'].transpose(t, 'latitude', 'longitude').values, pd.to_datetime(ds[t].values), 'max')
        lat, lon = ds['latitude'].values, ds['longitude'].values
        ds.close()
        for la, lo in cells:
            iy, ix = int(np.abs(lat - la).argmin()), int(np.abs(lon - lo).argmin())
            parts.append(pd.DataFrame({'date': dates, 'lat': la, 'lon': lo, 'cape_max': cape[:, iy, ix].astype(np.float32)}))
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=['date', 'lat', 'lon', 'cape_max'])


def assemble(cells, start, end):
    """Write month partitions from the finished cell files (cells with all four variables only). -> number of partitions written."""
    frames = [f for f in (cell_frame(la, lo) for la, lo in cells) if f is not None and len(f)]
    if not frames:
        return 0
    d = pd.concat(frames, ignore_index=True)
    d = d[(d.date >= start) & (d.date <= end)]
    years = sorted(d.date.dt.year.unique())
    cape = cape_for(cells, years)
    d = d.merge(cape, on=['date', 'lat', 'lon'], how='left')
    d['cape_max'] = d.cape_max.astype(np.float32)
    n = 0
    for (y, m), g in d.groupby([d.date.dt.year, d.date.dt.month]):
        target = OUT / f'year={y}' / f'month={m:02d}' / 'part.parquet'
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix('.tmp')
        g[UA.COLUMNS].to_parquet(tmp, index=False)
        tmp.replace(target)
        n += 1
    return n


def main():
    last_default = (pd.Timestamp(dt.date.today()).to_period('M') - 1).strftime('%Y-%m')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', default='2010-01')
    ap.add_argument('--end', default=last_default, help='last month (default: the last complete month)')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--assemble-only', action='store_true', help='skip the downloads, rebuild the month partitions (e.g. after more CAPE years arrived)')
    a = ap.parse_args()
    start, end = pd.Period(a.start).start_time, pd.Period(a.end).end_time.normalize()
    cells = station_cells()
    jobs = [(c, v) for c in cells for v in VARS]
    pending = [j for j in jobs if not raw_path(j[0][0], j[0][1], j[1]).exists()]
    print(f'ERA5 point series {a.start} to {a.end}: {len(cells)} cells x {len(VARS)} variables = {len(jobs)} requests, {len(pending)} still to fetch, {a.workers} at a time', flush=True)
    t0, failed = time.time(), []
    if not a.assemble_only and pending:
        with ThreadPoolExecutor(a.workers) as ex:
            futs = {ex.submit(download, j, start, end): j for j in pending}
            for i, f in enumerate(as_completed(futs), 1):
                (la, lo), v = futs[f]
                try:
                    r = f.result()
                    print(f'  {cell_name(la, lo)} {VARS[v]}: {r}; {i}/{len(pending)}, {(time.time() - t0) / 60:.0f} min', flush=True)
                except Exception as e:
                    failed.append((la, lo, v)); print(f'  {cell_name(la, lo)} {VARS[v]}: FAILED {type(e).__name__}: {str(e)[:200]}', flush=True)
    n = assemble(cells, start, end)
    print(f'done in {(time.time() - t0) / 60:.1f} min; {n} month partitions written; {len(failed)} requests failed' + (f': {failed[:6]}' if failed else ''))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
