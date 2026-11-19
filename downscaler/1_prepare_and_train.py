"""Prepare PMD + ERA5-Land + 1 km terrain training data and train the 1 km downscaler (tmax, tmin, rain_24h).

Run from the repository root with the permanent environment:
    .venv-terrain/Scripts/python.exe downscaler/1_prepare_and_train.py [--source auto|gee|openmeteo] [--start ...] [--end ...]

Steps (each cached in downscaler/data/, delete a file or pass --rebuild to redo it):
  1. PMD FFD workbooks (.xlsx, rain and temperature are separate files) -> pmd_daily.csv / .parquet, plus the 1-minute WeatherWalay
     station files of extra_stations.py turned into PMD-style days -> extra_daily.csv
  2. Station positions from realtime.json (station-meta.csv), checked against PMD's surveyed heights -> pmd_stations.csv
  3. 1 km Copernicus GLO-90 terrain predictors over 60-78 E, 23-38 N -> terrain_1km.npz
  4. Daily ERA5-Land predictors at the stations (era5land.py) joined to PMD -> pmd_training.parquet
  5. LightGBM + CatBoost ensembles, station-grouped K-fold CV, final models -> downscaler/models/

Temperatures are modelled as a correction to the coarse value (target = PMD - ERA5-Land), rain in two stages (wet-day
probability x wet-day amount). The output is a statistical estimate for screening, not an official PMD observation or
forecast.
"""
import argparse
import datetime as dt
import glob
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import era5land  # noqa: E402
import extra_stations  # noqa: E402
import forecast1km  # noqa: E402
import pmd_xlsx  # noqa: E402
import stations as st  # noqa: E402
import terrain  # noqa: E402

DATA = HERE / 'data'
MODELS = HERE / 'models'
REPO = HERE.parent
META_CSV = REPO / 'public' / 'observation-data' / 'station-meta.csv'
PMD_PAGE = 'https://www.pmd.gov.pk/Observatories/'

# Plausibility bounds used to drop typing errors. Screening conventions set just outside Pakistan's records (53.7 degC at
# Mohenjo-daro, 26 May 2010; about 620 mm in a day at Islamabad, 23 July 2001), not climatological limits.
QC = dict(tmax=(-40.0, 55.0), tmin=(-45.0, 45.0), rain=(0.0, 700.0))
# Wet day: daily precipitation >= 1 mm (ETCCDI definition, used for R10mm/CWD/SDII; Zhang et al. 2011, WIREs Clim Change).
WET_DAY_MM = 1.0
# Lapse-rate baseline for the report: ERA5-Land moved from its cell's mean height to the station's height at the ICAO standard
# atmosphere's 6.5 degC per km (ICAO Doc 7488). Shows how much of the 1 km gain a plain height correction would give.
LAPSE_C_PER_M = 0.0065
# Elevation bands for the report (as requested): plains < 500 m, foothills 500-1500 m, mountains > 1500 m.
BANDS = [('Plains (<500 m)', -1e9, 500), ('Foothills (500-1500 m)', 500, 1500), ('Mountains (>1500 m)', 1500, 1e9)]
# A realtime.json position is replaced by the PMD page's only when the 90 m DEM there is this far from the surveyed height
# and the page's position fits at least twice as well. Screening convention.
POSITION_HEIGHT_CHECK_M = 300.0

STATIC = ['elevation', 'delta_z', 'slope_x', 'slope_y', 'tpi', 'aspect_sin', 'aspect_cos', 'coast_dist', 'lat', 'lon']
DYNAMIC = ['era_tmax', 'era_tmin', 'era_dtr', 'era_precip_m1', 'era_precip', 'era_precip_p1', 'era_ssrd', 'era_u10',
           'era_v10', 'upslope_wind', 'sin_doy', 'cos_doy']
FEATURES = STATIC + DYNAMIC


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- 1. PMD workbooks
def convert_pmd(rain_files, temp_files, meta, rebuild):
    out_csv, out_pq = DATA / 'pmd_daily.csv', DATA / 'pmd_daily.parquet'
    if out_pq.exists() and not rebuild:
        log('PMD table cached:', out_pq)
        return pd.read_parquet(out_pq)
    rows = []
    for p in rain_files:
        log('  reading', Path(p).name)
        rows += pmd_xlsx.read_rain_workbook(p)
    for p in temp_files:
        log('  reading', Path(p).name)
        rows += pmd_xlsx.read_temperature_workbook(p)
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(dict(year=df.year, month=df.month, day=df.day))
    resolve = st.resolver(meta)
    names = {}
    for raw, d in df[['name', 'date']].drop_duplicates().itertuples(index=False):
        names[(raw, d)] = resolve(raw, d.date())
    df['station_name'] = [names[k] for k in zip(df['name'], df['date'])]
    un = df[df.station_name.isna()].groupby(['name', 'variable']).size().unstack(fill_value=0)
    un.to_csv(DATA / 'pmd_unmatched.csv')
    df = df.dropna(subset=['station_name'])
    df['station_id'] = df.station_name.map(lambda n: meta[n]['station_id'])
    df.drop(columns=['year', 'month', 'day']).to_parquet(DATA / 'pmd_long.parquet', index=False)

    # one value per station, day and variable: the first sheet wins (later duplicates are re-listings, e.g. 'AWS + PMD')
    dup = df.duplicated(['station_id', 'date', 'variable'], keep=False)
    conflicts = df[dup].groupby(['station_id', 'date', 'variable'])['value'].nunique().gt(1).sum()
    df = df.drop_duplicates(['station_id', 'date', 'variable'], keep='first')
    wide = df.pivot_table(index=['station_id', 'station_name', 'date'], columns='variable', values='value', aggfunc='first').reset_index()
    for c in ('tmax', 'tmin', 'rain'):
        if c not in wide:
            wide[c] = np.nan
    qc = {}
    for c, (lo, hi) in QC.items():
        bad = wide[c].notna() & ((wide[c] < lo) | (wide[c] > hi))
        qc[c] = int(bad.sum())
        wide.loc[bad, c] = np.nan
    swap = wide.tmax.notna() & wide.tmin.notna() & (wide.tmax < wide.tmin)
    qc['tmax_below_tmin'] = int(swap.sum())
    wide.loc[swap, ['tmax', 'tmin']] = np.nan
    wide = wide[['station_id', 'station_name', 'date', 'tmax', 'tmin', 'rain']].sort_values(['station_id', 'date'])
    wide = wide.dropna(subset=['tmax', 'tmin', 'rain'], how='all').reset_index(drop=True)
    wide.to_parquet(out_pq, index=False)
    wide.to_csv(out_csv, index=False, date_format='%Y-%m-%d', float_format='%.2f')
    log(f'PMD: {len(df):,} values kept, {int(dup.sum()):,} duplicate listings ({conflicts:,} with different values, first kept), '
        f'QC removed {qc}; {un.sum().sum():,} values from {len(un)} unmatched names -> data/pmd_unmatched.csv')
    return wide


# ---------------------------------------------------------------- 2. station positions
def station_table(daily, meta, rebuild):
    out = DATA / 'pmd_stations.csv'
    if out.exists() and not rebuild:
        s = pd.read_csv(out, dtype={'station_id': str})
        if set(s.station_id) >= set(daily.station_id.astype(str)):
            log('stations cached:', out)
            return s
    page_file = DATA / 'pmd_observatories.html'
    if not page_file.exists():
        try:
            req = urllib.request.Request(PMD_PAGE, headers={'User-Agent': 'Mozilla/5.0 (WeatherWalay downscaler)'})
            page_file.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            log('  PMD Observatories page not available:', e)
    page = st.parse_pmd_page(page_file.read_text('utf-8', 'replace')) if page_file.exists() else {}
    rows = []
    for name in sorted(daily.station_name.unique()):
        m = meta[name]
        e = st.page_entry(page, m['station_id'], name)
        rows.append(dict(station_id=m['station_id'], station_name=name, lat=m['lat'], lon=m['lon'], elev_meta=m['elev_meta'],
                         elev_pmd=e['elev_pmd'] if e else np.nan, page_lat=e['lat'] if e else np.nan,
                         page_lon=e['lon'] if e else np.nan))
    s = pd.DataFrame(rows)
    log(f'  sampling the 90 m DEM at {len(s)} stations')
    s['dem90'] = terrain.sample_points(list(zip(s.lat, s.lon)))
    has_page = s.page_lat.notna() & s.page_lon.notna()
    s['dem90_page'] = np.nan
    s.loc[has_page, 'dem90_page'] = terrain.sample_points(list(zip(s.loc[has_page, 'page_lat'], s.loc[has_page, 'page_lon'])))
    s['coord_source'] = 'realtime.json'
    s['confirmed'] = False
    off = (s.elev_pmd.notna() & ((s.dem90 - s.elev_pmd).abs() > POSITION_HEIGHT_CHECK_M)
           & ((s.dem90_page - s.elev_pmd).abs() * 2 <= (s.dem90 - s.elev_pmd).abs()))
    for i in s.index[off]:
        log(f'  {s.station_name[i]}: realtime.json position is {s.dem90[i]:.0f} m on the DEM, surveyed {s.elev_pmd[i]:.0f} m; '
            f'using the PMD page position ({s.dem90_page[i]:.0f} m)')
        s.loc[i, ['lat', 'lon', 'dem90']] = s.loc[i, 'page_lat'], s.loc[i, 'page_lon'], s.loc[i, 'dem90_page']
        s.loc[i, 'coord_source'] = 'pmd.gov.pk Observatories'
    # positions confirmed by WeatherWalay win over both sources (stations.POSITION_OVERRIDES)
    for name, (lat, lon, elev) in st.POSITION_OVERRIDES.items():
        hit = s.index[s.station_name == name]
        if len(hit):
            i = hit[0]
            s.loc[i, ['lat', 'lon', 'elev_pmd']] = lat, lon, elev
            s.loc[i, 'dem90'] = terrain.sample_points([(lat, lon)])[0]
            s.loc[i, 'coord_source'] = 'confirmed by WeatherWalay'
            s.loc[i, 'confirmed'] = True
            log(f'  {name}: confirmed position {lat}, {lon} ({elev:.0f} m surveyed, {s.dem90[i]:.0f} m on the DEM)')
    # height for the elevation bands: surveyed where the page gives one that agrees with the DEM, else the 90 m DEM
    # (a confirmed position is trusted even where the DEM disagrees with its surveyed height)
    agree = s.elev_pmd.notna() & (((s.dem90 - s.elev_pmd).abs() <= POSITION_HEIGHT_CHECK_M) | s.confirmed)
    s['station_elev'] = np.where(agree, s.elev_pmd, s.dem90)
    s['station_elev_source'] = np.where(agree, 'PMD surveyed', 'GLO-90 at position')
    # a position still off its surveyed height, or with no DEM value, is not trusted: its terrain predictors would describe
    # another place, so the station is left out of training (listed here and in pmd_stations.csv)
    s['position_ok'] = s.dem90.notna() & ~(s.elev_pmd.notna() & ~agree)
    for r in s[~s.position_ok].itertuples():
        log(f'  left out: {r.station_name} (DEM {r.dem90:.0f} m at {r.lat:.4f}, {r.lon:.4f}; surveyed {r.elev_pmd} m)')
    s.to_csv(out, index=False)
    log(f'stations: {len(s)} ({int(off.sum())} positions replaced; {int(agree.sum())} surveyed heights used; '
        f'{int((~s.position_ok).sum())} left out)')
    return s


# ---------------------------------------------------------------- 3. terrain
def terrain_features(rebuild):
    out = DATA / 'terrain_1km.npz'
    if out.exists() and not rebuild:
        log('terrain cached:', out)
        z = np.load(out)
        return {k: z[k] for k in terrain.FEATURES}
    log('building the 1 km GLO-90 DEM (270 tiles)')
    dem = terrain.build_dem(log=log)
    feats = terrain.features(dem)
    np.savez_compressed(out, **feats, box=np.array([terrain.BOX[k] for k in ('west', 'south', 'east', 'north')]), res=terrain.RES)
    log(f'terrain: {terrain.NY} x {terrain.NX} cells, land {np.isfinite(dem).mean():.0%}, max {np.nanmax(dem):.0f} m')
    return feats


# ---------------------------------------------------------------- 4. join
def rain_window_weight(source):
    """Share of PMD's 24 h rain window (08:00 PKT day D-1 to 08:00 PKT day D) that falls in day D-1 of the ERA5 series:
    16 h of a PKT day (Open-Meteo, local days) or 21 h of a UTC day (Earth Engine DAILY_AGGR, UTC days)."""
    return 21 / 24 if source == 'gee' else 16 / 24


def training_table(daily, stns, feats, era, source):
    era = era.sort_values(['station_id', 'date']).copy()
    g = era.groupby('station_id')['era_precip']
    era['era_precip_m1'] = g.shift(1)
    era['era_precip_p1'] = g.shift(-1)
    df = daily.merge(era, on=['station_id', 'date'], how='inner')
    pts = list(zip(stns.lat, stns.lon))
    at = pd.DataFrame(terrain.at_points(feats, pts))
    at['station_id'] = stns.station_id.astype(str).values
    at['lat'], at['lon'] = stns.lat.values, stns.lon.values
    at['station_elev'] = stns.station_elev.values
    df = df.merge(at, on='station_id', how='left')
    df['aspect_sin'] = np.sin(np.radians(df.aspect))
    df['aspect_cos'] = np.cos(np.radians(df.aspect))
    df['era_dtr'] = df.era_tmax - df.era_tmin
    df['upslope_wind'] = df.era_u10 * df.slope_x + df.era_v10 * df.slope_y      # m/s of rise: > 0 where the wind blows uphill
    doy = df.date.dt.dayofyear
    df['sin_doy'] = np.sin(2 * np.pi * doy / 365.25)
    df['cos_doy'] = np.cos(2 * np.pi * doy / 365.25)
    w = rain_window_weight(source)
    df['era_rain_window'] = w * df.era_precip_m1 + (1 - w) * df.era_precip     # raw ERA5 over PMD's 08-08 window
    return df


# ---------------------------------------------------------------- 5. models
def lgbm(kind, **kw):
    import lightgbm as lgb
    p = dict(n_estimators=600, learning_rate=0.05, num_leaves=63, min_child_samples=40, subsample=0.8, subsample_freq=1,
             colsample_bytree=0.8, reg_lambda=1.0, random_state=0, verbose=-1, n_jobs=-1)
    p.update(kw)
    return lgb.LGBMClassifier(**p) if kind == 'clf' else lgb.LGBMRegressor(**p)


def catb(kind, **kw):
    import catboost as cb
    p = dict(iterations=700, depth=6, learning_rate=0.08, random_seed=0, verbose=0, thread_count=-1, allow_writing_files=False)
    p.update(kw)
    return cb.CatBoostClassifier(**p) if kind == 'clf' else cb.CatBoostRegressor(**p)


class TempModel:
    """Correction model: predicts PMD - ERA5-Land; the 1 km value is ERA5-Land + the mean of LightGBM and CatBoost."""
    def __init__(self, base):
        self.base = base

    def fit(self, X, y_obs):
        r = y_obs - X[self.base].values
        self.m = [lgbm('reg').fit(X, r), catb('reg').fit(X, r)]
        return self

    def predict(self, X):
        return X[self.base].values + np.mean([m.predict(X) for m in self.m], axis=0)


class RainModel:
    """Two stages: P(wet day, >= 1 mm) x mean wet-day amount (LightGBM gamma + CatBoost Tweedie 1.9, near gamma)."""
    def fit(self, X, y):
        wet = y >= WET_DAY_MM
        self.occ = [lgbm('clf').fit(X, wet), catb('clf').fit(X, wet)]
        self.amt = [lgbm('reg', objective='gamma').fit(X[wet], y[wet]),
                    catb('reg', loss_function='Tweedie:variance_power=1.9').fit(X[wet], y[wet])]
        return self

    def prob(self, X):
        return np.mean([m.predict_proba(X)[:, 1] for m in self.occ], axis=0)

    def amount(self, X):
        return np.mean([self.amt[0].predict(X), self.amt[1].predict(X, prediction_type='Exponent')], axis=0)

    def predict(self, X):
        return self.prob(X) * self.amount(X)


def rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2))) if len(a) else float('nan')


def cross_validate(df, folds):
    from sklearn.model_selection import GroupKFold
    targets = dict(tmax=('tmax', 'era_tmax', lambda: TempModel('era_tmax')),
                   tmin=('tmin', 'era_tmin', lambda: TempModel('era_tmin')),
                   rain_24h=('rain', 'era_rain_window', RainModel))
    oof = []
    for name, (obs, raw, make) in targets.items():
        d = df.dropna(subset=[obs, raw] + FEATURES).reset_index(drop=True)
        k = min(folds, d.station_id.nunique())
        pred = np.full(len(d), np.nan)
        for f, (tr, va) in enumerate(GroupKFold(n_splits=k).split(d, groups=d.station_id), 1):
            t0 = time.time()
            m = make().fit(d.loc[tr, FEATURES], d.loc[tr, obs].values)
            pred[va] = m.predict(d.loc[va, FEATURES])
            log(f'  {name} fold {f}/{k}: {d.loc[va, "station_id"].nunique()} unseen stations, '
                f'RMSE raw {rmse(d.loc[va, obs], d.loc[va, raw]):.2f} -> {rmse(d.loc[va, obs], pred[va]):.2f} ({time.time() - t0:.0f} s)')
        cell_z = d.elevation - d.delta_z                       # mean height of the ERA5-Land cell (1 km DEM average)
        lapse = d[raw] - LAPSE_C_PER_M * (d.station_elev - cell_z) if name != 'rain_24h' else d[raw]
        oof.append(pd.DataFrame(dict(target=name, station_id=d.station_id, date=d.date, station_elev=d.station_elev,
                                     obs=d[obs], raw=d[raw], lapse=lapse, pred=pred)))
    return pd.concat(oof, ignore_index=True)


def metrics_table(oof):
    rows = []
    for t, g in oof.groupby('target', sort=False):
        for band, lo, hi in BANDS + [('All stations', -1e9, 1e9)]:
            b = g[(g.station_elev >= lo) & (g.station_elev < hi)]
            if b.empty:
                continue
            r0, r1 = rmse(b.obs, b.raw), rmse(b.obs, b.pred)
            rl = rmse(b.obs, b.lapse) if t != 'rain_24h' else np.nan
            rows.append(dict(target=t, band=band, stations=b.station_id.nunique(), days=len(b), rmse_raw=r0, rmse_lapse=rl, rmse_1km=r1,
                             gain_pct=100 * (r0 - r1) / r0 if r0 else np.nan, bias_raw=float((b.raw - b.obs).mean()),
                             bias_1km=float((b.pred - b.obs).mean())))
    return pd.DataFrame(rows)


def print_table(m, source):
    unit = dict(tmax='degC', tmin='degC', rain_24h='mm')
    print()
    print(f'Station-grouped cross-validation (stations unseen in training). Raw = ERA5-Land {"(+ERA5 for rain/wind/radiation, DEV) " if source == "openmeteo" else ""}grid value; '
          f'lapse = raw moved to the station height at {LAPSE_C_PER_M * 1000:.1f} degC/km.')
    print(f'{"target":9} {"elevation band":24} {"stations":>8} {"days":>8} {"RMSE raw":>9} {"RMSE lapse":>10} {"RMSE 1km":>9} {"gain":>7} {"bias raw":>9} {"bias 1km":>9}')
    print('-' * 111)
    for r in m.itertuples(index=False):
        lapse = f'{r.rmse_lapse:10.2f}' if np.isfinite(r.rmse_lapse) else f'{"-":>10}'
        print(f'{r.target:9} {r.band:24} {r.stations:8d} {r.days:8,d} {r.rmse_raw:9.2f} {lapse} {r.rmse_1km:9.2f} {r.gain_pct:6.1f}% '
              f'{r.bias_raw:9.2f} {r.bias_1km:9.2f}  {unit[r.target]}')
    print()


def train_final(df):
    MODELS.mkdir(exist_ok=True)
    out = {}
    for name, obs, base in (('tmax', 'tmax', 'era_tmax'), ('tmin', 'tmin', 'era_tmin')):
        d = df.dropna(subset=[obs] + FEATURES)
        m = TempModel(base).fit(d[FEATURES], d[obs].values)
        m.m[0].booster_.save_model(str(MODELS / f'{name}_lgbm.txt'))
        m.m[1].save_model(str(MODELS / f'{name}_catboost.cbm'))
        out[name] = len(d)
    d = df.dropna(subset=['rain'] + FEATURES)
    m = RainModel().fit(d[FEATURES], d['rain'].values)
    m.occ[0].booster_.save_model(str(MODELS / 'rain_occurrence_lgbm.txt'))
    m.occ[1].save_model(str(MODELS / 'rain_occurrence_catboost.cbm'))
    m.amt[0].booster_.save_model(str(MODELS / 'rain_amount_lgbm.txt'))
    m.amt[1].save_model(str(MODELS / 'rain_amount_catboost.cbm'))
    out['rain_24h'] = len(d)
    return out


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rain-xlsx', default=r'C:\Users\Dell-5580\Desktop\FFD-Monthly Rainfall Statement (*).xlsx',
                    help='glob of the PMD rain workbooks')
    ap.add_argument('--temp-xlsx', default=r'C:\Users\Dell-5580\Desktop\rainfall  2018\FFd Monthly Temperature (2016-2022).xlsx',
                    help='glob of the PMD temperature workbooks')
    ap.add_argument('--source', choices=['auto', 'gee', 'openmeteo'], default='auto',
                    help='ERA5-Land source; auto = Earth Engine when authenticated, else Open-Meteo (development only)')
    ap.add_argument('--start', help='first day of predictors (default: Earth Engine all PMD days; Open-Meteo 2021-01-01)')
    ap.add_argument('--end', help='last day (default: Earth Engine all PMD days; Open-Meteo 2022-12-31)')
    ap.add_argument('--ee-project', help='Google Cloud project registered for Earth Engine (or set EE_PROJECT)')
    ap.add_argument('--folds', type=int, default=5)
    ap.add_argument('--rebuild', action='store_true', help='redo every cached step')
    a = ap.parse_args()
    if a.ee_project:
        import os
        os.environ['EE_PROJECT'] = a.ee_project
    if a.source == 'gee' and not era5land.gee_available():
        sys.exit('Earth Engine is not ready: run `.venv-terrain/Scripts/earthengine authenticate` and pass --ee-project')
    DATA.mkdir(exist_ok=True)
    t0 = time.time()

    meta = st.load_pmd_meta(META_CSV)
    rain_files, temp_files = sorted(glob.glob(a.rain_xlsx)), sorted(glob.glob(a.temp_xlsx))
    log(f'1. PMD workbooks: {len(rain_files)} rain, {len(temp_files)} temperature')
    daily = convert_pmd(rain_files, temp_files, meta, a.rebuild)
    daily['station_id'] = daily.station_id.astype(str)
    for c in ('tmax', 'tmin', 'rain'):
        d = daily.dropna(subset=[c])
        log(f'   {c}: {len(d):,} station-days, {d.station_id.nunique()} stations, {d.date.min():%Y-%m-%d} to {d.date.max():%Y-%m-%d}')

    extra, extra_st = extra_stations.load_daily()
    if len(extra):
        extra['station_id'] = extra.station_id.astype(str)
        for c, (lo, hi) in QC.items():
            extra.loc[extra[c].notna() & ((extra[c] < lo) | (extra[c] > hi)), c] = np.nan
        extra.to_csv(DATA / 'extra_daily.csv', index=False, date_format='%Y-%m-%d', float_format='%.2f')
        for s_ in extra_st:
            e = extra[extra.station_id == s_['station_id']]
            log(f'   + {s_["station_name"]}: tmax {e.tmax.notna().sum()}, tmin {e.tmin.notna().sum()}, rain {e.rain.notna().sum()} days, '
                f'{e.date.min():%Y-%m-%d} to {e.date.max():%Y-%m-%d}')

    log('2. station positions')
    stns = station_table(daily, meta, a.rebuild)
    stns['station_id'] = stns.station_id.astype(str)
    if extra_st:                                     # extra stations: their own surveyed position and height
        ext = pd.DataFrame([dict(station_id=x['station_id'], station_name=x['station_name'], lat=x['lat'], lon=x['lon'], elev_pmd=x['elev'],
                                 coord_source=f'{x["network"]} station file', confirmed=True) for x in extra_st])
        ext['dem90'] = terrain.sample_points(list(zip(ext.lat, ext.lon)))
        ext['elev_pmd'] = ext.elev_pmd.astype(float).fillna(ext.dem90)          # no height given: the 90 m DEM at the position
        ext['station_elev'] = ext.elev_pmd
        ext['station_elev_source'] = [x['elev_source'] for x in extra_st]; ext['position_ok'] = ext.dem90.notna()
        for r in ext.itertuples():
            title = next((x['title_elev'] for x in extra_st if x['station_id'] == r.station_id), None)
            log(f'   + {r.station_name}: {r.lat}, {r.lon}, {r.elev_pmd:.0f} m ({r.station_elev_source})'
                + (f'; export title says {title:.0f} m' if title else ''))
        stns = pd.concat([stns[~stns.station_id.isin(ext.station_id)], ext], ignore_index=True)
    stns = stns[stns.position_ok.astype(bool)].reset_index(drop=True)

    log('3. terrain')
    feats = terrain_features(a.rebuild)

    source = a.source if a.source != 'auto' else ('gee' if era5land.gee_available() else 'openmeteo')
    if source == 'openmeteo':
        start, end = a.start or '2021-01-01', a.end or '2022-12-31'
        log('4. ERA5 predictors from Open-Meteo: DEVELOPMENT ONLY (non-commercial API; ERA5 for rain, wind, radiation). '
            'Authenticate Earth Engine and re-run with --source gee for commercially clean models.')
    else:
        start = a.start or f'{daily.date.min():%Y-%m-%d}'
        end = a.end or f'{daily.date.max():%Y-%m-%d}'
        log('4. ERA5-Land predictors from Google Earth Engine (ECMWF/ERA5_LAND/DAILY_AGGR)')
    # one extra day each side for the rain-window lags
    s_ext = (pd.Timestamp(start) - pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    e_ext = (pd.Timestamp(end) + pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    pmd_days = daily[(daily.date >= start) & (daily.date <= end)]
    used = stns[stns.station_id.isin(pmd_days.station_id)].assign(start=s_ext, end=e_ext)
    if len(extra) and source == 'gee':               # extra stations: their own period (the PMD period's cached fetches stay valid)
        for sid, e in extra.groupby('station_id'):
            row = stns[stns.station_id == sid]
            if len(row):
                used = pd.concat([used, row.assign(start=(e.date.min() - pd.Timedelta(days=1)).strftime('%Y-%m-%d'),
                                                   end=(e.date.max() + pd.Timedelta(days=1)).strftime('%Y-%m-%d'))], ignore_index=True)
        pmd_days = pd.concat([pmd_days, extra], ignore_index=True)
    era, source = era5land.fetch(used[['station_id', 'lat', 'lon', 'start', 'end']], s_ext, e_ext, source, DATA / 'cache', log)
    era['station_id'] = era.station_id.astype(str)
    df = training_table(pmd_days, stns, feats, era, source)
    df.to_parquet(DATA / 'pmd_training.parquet', index=False)
    log(f'   training table: {len(df):,} rows, {df.station_id.nunique()} stations -> data/pmd_training.parquet')

    log(f'5. cross-validation ({a.folds} station-grouped folds)')
    oof = cross_validate(df, a.folds)
    oof.to_parquet(DATA / 'cv_predictions.parquet', index=False)
    m = metrics_table(oof)
    MODELS.mkdir(exist_ok=True)
    m.to_csv(MODELS / 'cv_metrics.csv', index=False)
    print_table(m, source)

    log('   training final models on all stations')
    counts = train_final(df)
    meta_out = dict(
        created=dt.datetime.now().isoformat(timespec='seconds'),
        features=FEATURES, static_features=STATIC, dynamic_features=DYNAMIC,
        units=dict(era5land.UNITS, elevation='m', delta_z='m', slope_x='m/m east', slope_y='m/m north', tpi='m',
                   aspect_sin='-', aspect_cos='-', coast_dist='km', lat='deg', lon='deg', era_dtr='degC',
                   era_precip_m1='mm/day', era_precip_p1='mm/day', upslope_wind='m/s', sin_doy='-', cos_doy='-'),
        targets=dict(tmax='PMD daily maximum (degC) = era_tmax + mean(lgbm, catboost)',
                     tmin='PMD daily minimum (degC) = era_tmin + mean(lgbm, catboost)',
                     rain_24h=f'PMD 24 h rain to 08:00 PKT (mm) = P(>= {WET_DAY_MM} mm) x wet-day amount'),
        files=dict(tmax=['tmax_lgbm.txt', 'tmax_catboost.cbm'], tmin=['tmin_lgbm.txt', 'tmin_catboost.cbm'],
                   rain_24h=['rain_occurrence_lgbm.txt', 'rain_occurrence_catboost.cbm', 'rain_amount_lgbm.txt',
                             'rain_amount_catboost.cbm (predict with prediction_type="Exponent")']),
        era5_source=source, period=[start, end],
        data_license='CC BY 4.0 (Copernicus ERA5-Land)' if source == 'gee' else 'ERA5 / ERA5-Land via Open-Meteo (non-commercial API)',
        training_fetch_channel=('GEE non-commercial (swap to Copernicus CDS cdsapi before commercial retrain)' if source == 'gee'
                                else 'Open-Meteo free API, development only'),
        runtime_inference_commercial_safe=source == 'gee',
        runtime_inference_note='Forecasts apply these models to ECMWF open data (CC BY 4.0); no Earth Engine call is made at runtime.',
        era_day=('UTC days' if source == 'gee' else 'PKT days'), rain_window_weight_prev_day=rain_window_weight(source),
        training_rows=counts, stations=int(df.station_id.nunique()),
        # 1 km cell height and delta_z of the training stations: outside this the forecast step fades the ML correction (forecast1km.ml_weight)
        training_ranges={k: [float(df.drop_duplicates('station_id')[k].min()), float(df.drop_duplicates('station_id')[k].max())]
                         for k in ('elevation', 'delta_z')},
        terrain=dict(dem='Copernicus DEM GLO-90 (AWS copernicus-dem-90m), mean over 0.01 degree cells', box=terrain.BOX,
                     res_deg=terrain.RES, tpi_window_cells=terrain.TPI_WINDOW,
                     delta_z='elevation minus mean DEM height of the ERA5-Land 0.1 degree cell',
                     coast_dist='km to the nearest Arabian Sea cell'),
        qc_bounds=QC, wet_day_mm=WET_DAY_MM, elevation_bands=[b[0] for b in BANDS],
        cv=dict(folds=a.folds, grouping='station_id (GroupKFold)', metrics=m.to_dict('records')),
        attribution=['Pakistan Meteorological Department (FFD daily statements)',
                     'Contains modified Copernicus Climate Change Service information (ERA5-Land)',
                     'Copernicus DEM GLO-90 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, '
                     'provided under COPERNICUS by the European Union and ESA'],
        note='Statistical screening estimate, not an official PMD observation or forecast.')
    (MODELS / 'feature_metadata.json').write_text(json.dumps(forecast1km.json_safe(meta_out), indent=2, default=str, allow_nan=False))
    log(f'done in {(time.time() - t0) / 60:.1f} min; models and metadata in {MODELS}')


if __name__ == '__main__':
    main()
