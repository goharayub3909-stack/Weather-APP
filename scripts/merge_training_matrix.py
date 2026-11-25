"""Unified training matrix for the 1 km downscaler (v2): station daily targets + ERA5-Land + 1 km terrain + ERA5 upper-air and moisture flux.

Targets (tmax, tmin, rain = 24 h to 08:00 PKT), one value per station and day, first available in this order:
  pmd    PMD workbooks (downscaler/data/pmd_daily.parquet, from 1_prepare_and_train.py)
  ww     WeatherWalay Davis stations (downscaler/extra_stations.py: Shimshal temperature only, Murree, Nathia Gali, Chilas)
  ghcn   NOAA GHCN-Daily Pakistani stations (downscaler/data/station_history/daily, from pull_historical_stations.py): the same WMO stations
         for years the PMD workbooks lack (2010-2011, 2023 on) and stations PMD's files do not have (Astore, Bunji, Mirpur, Bhimber, ...).
         TEMPERATURE ONLY. Its tmax and tmin equal the PMD workbooks' (mean absolute difference 0.06 and 0.11 degC where both exist), but its
         rain does not: on 26 stations GHCN's mean daily rain is 1.2 to 5 times PMD's (Parachinar 27 mm against 5, Sargodha 21 against 4,
         Chaklala 19 against 6), correlation 0.4 to 0.7, and PARDIG agrees with the workbooks, not with GHCN. Period totals are stored as single
         days, so GHCN rain is never used as a target.
GHCN's day windows are checked against PMD where both exist (shift of -1, 0, +1 day); a better shift is applied and reported.
Station positions: PMD stations keep their realtime.json position; NOAA-only stations their NOAA position, kept only if the 90 m terrain height
there is within 300 m of the listed height. Hourly ISD / IEM records stay in station_history (extremes from hourly or 3-hourly reports are
biased low, so they are not turned into daily targets).

Features: the v1 columns (ERA5-Land daily via Earth Engine, terrain at the station's 1 km cell: 1_prepare_and_train.training_table) and the v2
upper-air block from the ERA5 pull (scripts/pull_era5_upper_air.py, 0.25 degree cell nearest the station, same UTC date): cape_max, q850, r850,
q700, r700 and, with the 3 km-smoothed 1 km terrain gradient, w_oro_850, MF_850, MF_700 (downscaler/features.py).

Output: downscaler/data/pmd_training.parquet (the previous file is kept as pmd_training_v1.parquet), one row per station and day.
With --upper-dir (point-series upper air) the output is pmd_training_points.parquet and nothing is replaced.

Run: .venv-terrain/Scripts/python.exe scripts/merge_training_matrix.py [--start 2010] [--ee-project calude-app]
"""
import argparse
import importlib.util
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DS = REPO / 'downscaler'
DATA = DS / 'data'
sys.path.insert(0, str(DS))
sys.path.insert(0, str(HERE))
import era5land  # noqa: E402
import extra_stations  # noqa: E402
import features as FT  # noqa: E402
import pull_era5_upper_air as UA  # noqa: E402
import terrain  # noqa: E402

VARS = ('tmax', 'tmin', 'rain')
POSITION_HEIGHT_CHECK_M = 300.0      # as in 1_prepare_and_train.py
LAG_GAIN = dict(mae=0.85, corr=0.05)  # a shift is used when it cuts the mean absolute error to 85% (temperatures) or lifts the correlation by 0.05 (rain)
GRID = 0.25                          # ERA5 upper-air grid


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def v1_module():
    spec = importlib.util.spec_from_file_location('v1', DS / '1_prepare_and_train.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ---------------------------------------------------------------- targets
def read_ghcn_daily():
    parts = sorted((DATA / 'station_history' / 'daily').glob('year=*/part.parquet'))
    if not parts:
        return pd.DataFrame(columns=['station_id', 'date'] + list(VARS))
    d = pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True)
    d['station_id'] = d.station_id.astype(str)
    return d.rename(columns={'tmax_c': 'tmax', 'tmin_c': 'tmin', 'precip_mm': 'rain'})[['station_id', 'date'] + list(VARS)]


def compare(a, b):
    """Overlap of two daily tables: n, bias (a - b), MAE, correlation per variable."""
    m = a.merge(b, on=['station_id', 'date'], suffixes=('_a', '_b'))
    out = {}
    for v in VARS:
        x = m[[f'{v}_a', f'{v}_b']].dropna()
        if len(x) > 30:
            out[v] = dict(n=len(x), bias=float((x.iloc[:, 0] - x.iloc[:, 1]).mean()), mae=float((x.iloc[:, 0] - x.iloc[:, 1]).abs().mean()),
                          corr=float(np.corrcoef(x.iloc[:, 0], x.iloc[:, 1])[0, 1]))
    return out


def align_ghcn(gh, pmd):
    """Shift GHCN dates by the lag (-1, 0, +1 day) that best matches PMD where both exist, per variable. -> (aligned table, report lines)."""
    shifted = {}
    lines = []
    for v in VARS:
        res = {}
        for lag in (-1, 0, 1):
            g = gh[['station_id', 'date', v]].copy()
            g['date'] = g.date + pd.Timedelta(days=lag)
            r = compare(g.assign(**{u: np.nan for u in VARS if u != v}), pmd[['station_id', 'date'] + list(VARS)]).get(v)
            if r:
                res[lag] = r
        if 0 not in res:
            shifted[v] = 0
            lines.append(f'   {v}: no overlap with PMD to check')
            continue
        best = 0
        if v == 'rain':
            cand = max(res, key=lambda k: res[k]['corr'])
            if res[cand]['corr'] - res[0]['corr'] >= LAG_GAIN['corr']:
                best = cand
        else:
            cand = min(res, key=lambda k: res[k]['mae'])
            if res[cand]['mae'] <= LAG_GAIN['mae'] * res[0]['mae']:
                best = cand
        shifted[v] = best
        detail = ', '.join(f'{k:+d} d: n {r["n"]:,} bias {r["bias"]:+.2f} MAE {r["mae"]:.2f} r {r["corr"]:.2f}' for k, r in sorted(res.items()))
        lines.append(f'   {v}: {detail} -> shift {best:+d} d')
    out = None
    for v in VARS:
        g = gh[['station_id', 'date', v]].copy()
        g['date'] = g.date + pd.Timedelta(days=shifted[v])
        out = g if out is None else out.merge(g, on=['station_id', 'date'], how='outer')
    return out, lines


def combine(frames):
    """frames: [(name, table)] in priority order -> wide table, one row per station and day, with src_<var> for each target."""
    rows = []
    for pr, (name, d) in enumerate(frames):
        for v in VARS:
            x = d[['station_id', 'date', v]].dropna(subset=[v]).rename(columns={v: 'value'})
            rows.append(x.assign(var=v, src=name, pr=pr))
    long = pd.concat(rows, ignore_index=True).sort_values('pr', kind='stable').drop_duplicates(['station_id', 'date', 'var'])
    val = long.pivot(index=['station_id', 'date'], columns='var', values='value')
    src = long.pivot(index=['station_id', 'date'], columns='var', values='src').add_prefix('src_')
    return val.join(src).reset_index()


# ---------------------------------------------------------------- stations
def station_positions(v1, ghcn_ids, extra_found, hist_stations):
    """-> DataFrame(station_id, station_name, lat, lon, station_elev, position_source) of every station that has targets and a trusted position."""
    parts = []
    pmd = pd.read_csv(DATA / 'pmd_stations.csv', dtype={'station_id': str})
    pmd = pmd[pmd.position_ok.astype(bool)]
    parts.append(pd.DataFrame(dict(station_id=pmd.station_id, station_name=pmd.station_name, lat=pmd.lat, lon=pmd.lon, station_elev=pmd.station_elev,
                                   position_source=pmd.coord_source)))
    if extra_found:
        e = pd.DataFrame([dict(station_id=x['station_id'], station_name=x['station_name'], lat=x['lat'], lon=x['lon'], position_source='WeatherWalay, given') for x in extra_found])
        e['station_elev'] = terrain.sample_points(list(zip(e.lat, e.lon)))      # the height at the position, as WeatherWalay asked
        parts.append(e)
    known = set(pd.concat(parts).station_id)
    new = hist_stations[hist_stations.station_id.isin(ghcn_ids) & ~hist_stations.station_id.isin(known)].copy()
    if len(new):
        new['dem90'] = terrain.sample_points(list(zip(new.lat, new.lon)))
        bad = new.elev_m.notna() & ((new.dem90 - new.elev_m).abs() > POSITION_HEIGHT_CHECK_M)
        for r in new[bad].itertuples():
            log(f'   dropped {r.station_id} {r.name}: listed {r.elev_m:.0f} m, terrain at the position {r.dem90:.0f} m')
        new = new[~bad & new.dem90.notna()]
        parts.append(pd.DataFrame(dict(station_id=new.station_id, station_name=new.name, lat=new.lat, lon=new.lon,
                                       station_elev=np.where(new.elev_m.notna(), new.elev_m, new.dem90), position_source='NOAA (GHCN/ISD)')))
    return pd.concat(parts, ignore_index=True).drop_duplicates('station_id')


# ---------------------------------------------------------------- upper air
def upper_for_stations(stns, start, end, root=None):
    """Upper-air table (date, station_id, cape_max, q850, ..., v700) at the 0.25 degree cell nearest each station."""
    cells = stns[['station_id', 'lat', 'lon']].assign(glat=lambda d: (d.lat / GRID).round() * GRID, glon=lambda d: (d.lon / GRID).round() * GRID)
    cells = cells.assign(glat=cells.glat.round(2), glon=cells.glon.round(2))
    out = []
    for p in sorted(Path(root or UA.OUT).glob('year=*/month=*/part.parquet')):
        y, m = int(p.parent.parent.name[5:]), int(p.parent.name[6:])
        if not (pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0) >= pd.Timestamp(start) and pd.Timestamp(y, m, 1) <= pd.Timestamp(end)):
            continue
        d = pd.read_parquet(p)
        d = d.assign(glat=d.lat.round(2), glon=d.lon.round(2)).drop(columns=['lat', 'lon'])
        out.append(d.merge(cells[['station_id', 'glat', 'glon']], on=['glat', 'glon']).drop(columns=['glat', 'glon']))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=['date', 'station_id'] + UA.COLUMNS[3:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', type=int, default=2010, help='first year of rows')
    ap.add_argument('--upper-dir', help='upper-air partitions to join instead of the regional pull (scripts/pull_era5_upper_points.py writes downscaler/data/era5_upper_points)')
    ap.add_argument('--ee-project', default=os.environ.get('EE_PROJECT', 'calude-app'))
    a = ap.parse_args()
    os.environ['EE_PROJECT'] = a.ee_project
    t0 = time.time()
    v1 = v1_module()
    start, end = pd.Timestamp(a.start, 1, 1), pd.Timestamp.now().normalize()

    log('1. targets')
    pmd = pd.read_parquet(DATA / 'pmd_daily.parquet')
    pmd['station_id'] = pmd.station_id.astype(str)
    ww, ww_found = extra_stations.load_daily()
    ww['station_id'] = ww.station_id.astype(str)
    gh = read_ghcn_daily()
    gh['rain'] = np.nan                                    # see the docstring: GHCN rain is not trustworthy
    log(f'   PMD workbooks {len(pmd):,} station-days, WeatherWalay {len(ww):,}, GHCN-Daily {len(gh):,} ({gh.station_id.nunique()} stations)')
    gh, lines = align_ghcn(gh, pmd)
    log('   GHCN-Daily against the PMD workbooks (same station, same day):')
    for l in lines:
        print(l, flush=True)
    t = combine([('pmd', pmd), ('ww', ww), ('ghcn', gh)])
    t = t[t.date >= start]
    names = pd.concat([pmd[['station_id', 'station_name']], ww[['station_id', 'station_name']]]).drop_duplicates('station_id').set_index('station_id').station_name
    log(f'   combined {len(t):,} station-days from {t.date.min():%Y-%m-%d} to {t.date.max():%Y-%m-%d}; '
        + ', '.join(f'{v} {t[v].notna().sum():,}' for v in VARS))

    log('2. station positions')
    hist = pd.read_parquet(DATA / 'station_history' / 'stations.parquet')
    stns = station_positions(v1, set(gh.station_id), ww_found, hist)
    stns['station_name'] = stns.station_id.map(names).fillna(stns.station_name)
    t = t[t.station_id.isin(stns.station_id)]
    log(f'   {stns.station_id.nunique()} stations with a trusted position; {t.station_id.nunique()} with targets')

    log('3. terrain and ERA5-Land (Earth Engine)')
    if not era5land.gee_available():
        sys.exit('Earth Engine is not ready: run `.venv-terrain/Scripts/earthengine authenticate` and pass --ee-project')
    feats = v1.terrain_features(False)
    span = t.groupby('station_id').date.agg(['min', 'max'])
    used = stns[stns.station_id.isin(span.index)].copy()
    used['start'] = used.station_id.map(span['min'] - pd.Timedelta(days=1)).dt.strftime('%Y-%m-%d')
    used['end'] = used.station_id.map(span['max'] + pd.Timedelta(days=1)).dt.strftime('%Y-%m-%d')
    era, source = era5land.fetch(used[['station_id', 'lat', 'lon', 'start', 'end']], used.start.min(), used.end.max(), 'gee', DATA / 'cache', log)
    era['station_id'] = era.station_id.astype(str)
    t = t.assign(station_name=t.station_id.map(stns.set_index('station_id').station_name))
    df = v1.training_table(t, used.reset_index(drop=True), feats, era, source)
    log(f'   {len(df):,} rows with ERA5-Land and terrain features')

    log('4. ERA5 upper air and orographic moisture flux')
    up = upper_for_stations(used, df.date.min(), df.date.max(), a.upper_dir)
    up['date'] = pd.to_datetime(up.date)
    df = df.merge(up, on=['station_id', 'date'], how='left')
    for c in ('cape_max', 'q850', 'r850', 'q700', 'r700', 'u850', 'v850', 'u700', 'v700'):       # empty or partial upper-air data: NaN floats, never objects
        if c not in df:
            df[c] = np.nan
        df[c] = pd.to_numeric(df[c], errors='coerce').astype(float)
    dem = np.load(DATA / 'terrain_1km.npz')['elevation']
    gx, gy = FT.smoothed_gradients(dem)
    cell = {r.station_id: terrain.cell_of(r.lat, r.lon) for r in used.itertuples()}
    df['dzdx_s3'] = df.station_id.map(lambda s: float(gx[cell[s]]) if cell[s] else np.nan)
    df['dzdy_s3'] = df.station_id.map(lambda s: float(gy[cell[s]]) if cell[s] else np.nan)
    f = FT.upper_air_features(df.cape_max, df.q850, df.r850, df.q700, df.r700, df.u850, df.v850, df.u700, df.v700, df.dzdx_s3, df.dzdy_s3, df.elevation)
    for k, v in f.items():
        df[k] = np.where(np.isfinite(df[k]) if k in ('cape_max', 'q850', 'r850', 'q700', 'r700') else np.isfinite(df.q850) & np.isfinite(df.u850), v, np.nan)
    have = df[FT.UPPER_COLS].notna().all(axis=1)
    yrs = sorted(set(df.date[have].dt.year))
    log(f'   upper-air features on {have.mean():.0%} of rows ({int(have.sum()):,}); years with them: {yrs if len(yrs) <= 8 else str(yrs[:3]) + " ... " + str(yrs[-1:])}')

    out = DATA / ('pmd_training.parquet' if not a.upper_dir else 'pmd_training_points.parquet')       # point-series upper air never replaces the regional matrix
    if not a.upper_dir and out.exists() and not (DATA / 'pmd_training_v1.parquet').exists():
        out.replace(DATA / 'pmd_training_v1.parquet')
    src = df.merge(stns[['station_id', 'position_source']], on='station_id', how='left')
    src.to_parquet(out, index=False)
    log(f'wrote {out}: {len(src):,} rows, {src.station_id.nunique()} stations, {src.date.min():%Y-%m-%d} to {src.date.max():%Y-%m-%d}, {len(src.columns)} columns')
    for v in VARS:
        print(f'   {v}: ' + ', '.join(f'{k} {n:,}' for k, n in src[f"src_{v}"].value_counts().items()), flush=True)
    by_year = src.groupby(src.date.dt.year).agg(rows=('date', 'size'), stations=('station_id', 'nunique'))
    print('   rows / stations by year: ' + '; '.join(f'{y}: {r.rows:,}/{r.stations}' for y, r in by_year.iterrows()), flush=True)
    log(f'done in {(time.time() - t0) / 60:.1f} min')
    return 0


if __name__ == '__main__':
    sys.exit(main())
