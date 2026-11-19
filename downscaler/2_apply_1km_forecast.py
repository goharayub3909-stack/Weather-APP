"""Apply the trained 1 km downscaler to the latest ECMWF forecast and write browser grids for the Terrain Explorer.

Run by scripts/sync-terrain-weather-ecmwf.py after it publishes grid-hires.json, or by hand:
    .venv-terrain/Scripts/python.exe downscaler/2_apply_1km_forecast.py --cache <ECMWF cache dir> [--grid public/terrain-data/grid-hires.json]

Steps:
  1. ECMWF 0.1 degree fields (from the sync script's cache) -> UTC daily maximum / minimum temperature (mx2t3 / mn2t3), rain, solar
     radiation (ssrd) and mean 10 m wind, the same predictors the models were trained on (ERA5-Land daily aggregates).
  2. LightGBM + CatBoost (downscaler/models) on every land cell of the 1 km GLO-90 grid: daily 1 km maximum and minimum temperature and
     24 h rain. Partial days (the ends of the run) borrow the nearest complete day's temperature corrections. Outside the training
     stations' range of height and delta_z the temperature correction fades to the plain lapse rate (forecast1km.ml_weight).
  3. Every 3-hourly step: ECMWF 2 m temperature moved onto the 1 km daily extremes (forecast1km.diurnal); ECMWF rain spread over each
     0.1 degree cell by the 1 km rain pattern with the cell's water kept exactly (conserve_rain).
  4. Live elevation bias: the models were trained on ERA5-Land, whose cold bias in the high valleys is about twice ECMWF IFS's, so they
     over-correct IFS there. The remaining error at fresh stations (all networks) is fitted as a smooth curve of height, pooled over the
     last 7 days with recency weights (data/live_bias_history.csv), and removed at every step. A held-out check (fit on half the
     stations, score the other half) is printed and stored in the manifest.
  5. Live stations (every station of realtime.json, all networks, and METARs) nudge temperature, 10 m wind and rain at the analysis time
     (elevation-aware Barnes, two passes), fading linearly to nothing 12 hours either side.
  6. 10 m wind made mass-consistent over the 1 km terrain (forecast1km.MassConsistentWind).
  7. Rain / snow split (phase.py, Ding et al. 2014: wet-bulb temperature, humidity and height): RH from ECMWF 2 m temperature and dew
     point, held constant in each 0.1 degree cell; Tw from the final 1 km temperature; snow, sleet (half and half) or rain. Skipped when the cache
     has no 2d.
  8. RGB PNGs in public/terrain-data/grid-1km/ (manifest.json describes the packing): one temperature + rain, one phase (snow share) and one wind
     image per step, daily extremes, and 1 x 1 degree tiles holding every step for the click forecast (temperature + rain, and phase).

The models were trained on ERA5-Land; here they read ECMWF IFS 0.1 degree forecasts, whose biases differ, so the live-station check at the end
is the real measure. Screening estimate, not an official PMD forecast.
"""
import argparse
import datetime as dt
import json
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import forecast1km as F  # noqa: E402
import phase as PH  # noqa: E402
import stations as st  # noqa: E402
import terrain  # noqa: E402

REPO = HERE.parent
sys.path.insert(0, str(REPO / 'scripts'))
import obs_qc as QC  # noqa: E402
MODELS = HERE / 'models'
OUT = REPO / 'public' / 'terrain-data' / 'grid-1km'
REALTIME = REPO / 'public' / 'observation-data' / 'realtime.json'
METAR = REPO / 'public' / 'observation-data' / 'metar.json'
LAPSE_C_PER_M = 0.0065            # ICAO standard atmosphere, used to bring a station reading to its 1 km cell's height
OBS_WINDOW_MIN = 60               # readings within this many minutes of the newest one form the analysis (screening convention)
MAX_ANALYSIS_AGE_H = 3            # no analysis when the newest reading is older than this (the portal's station freshness window)
BIAS_HISTORY = HERE / 'data' / 'live_bias_history.csv'
RAIN_LENGTH_KM = 20.0             # rain increments: one pass, no height term (screening convention)
PKT = dt.timezone(dt.timedelta(hours=5))
MONTHS = {m: i for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
                                      'november', 'december'], 1)}
# realtime.json columns (public/realtime/core.js PARAMS): temperature current, wind speed current (km/h) and direction, rain rate (mm/h),
# last sync of the readings (PKT label without a year)
COL_T, COL_WS, COL_WD, COL_RR, COL_SYNC = 5, 91, 92, 121, 161


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- ECMWF
MAX_1KM_HOURS = 72               # the 1 km set covers the first three days; later steps of the (144 h) 9 km grid keep ECMWF's own values


def load_ecmwf(cache, grid):
    meta = json.loads(Path(grid).read_text())
    keep = [i for i, h in enumerate(meta['hours']) if h <= MAX_1KM_HOURS]
    meta['times'] = [meta['times'][i] for i in keep]; meta['hours'] = [meta['hours'][i] for i in keep]
    times = [dt.datetime.fromisoformat(t.replace('Z', '+00:00')) for t in meta['times']]
    steps = meta['hours']
    keys = ('2t', 'mx2t3', 'mn2t3', 'tp', 'ssrd', '10u', '10v')
    f = {k: [np.load(Path(cache) / f'{s:03d}-{k}.npy').astype(np.float64) for s in steps] for k in keys}
    # 2 m dew point, snowfall and total cloud cover are optional: a cache written before the rain / snow split lacks 2d (no split), one without tcc has no weather regimes
    for k in ('2d', 'sf', 'tcc'):
        files = [Path(cache) / f'{s:03d}-{k}.npy' for s in steps]
        if all(x.exists() for x in files):
            f[k] = [np.load(x).astype(np.float64) for x in files]
    return meta, times, f


def rain_rates(f, times, key='tp'):
    """mm per hour over the 3 h before each step (the first step takes the second's, as grid-hires.json does); key 'sf' gives the snow water."""
    out = [None] * len(times)
    for k in range(1, len(times)):
        h = (times[k] - times[k - 1]).total_seconds() / 3600
        out[k] = np.maximum(f[key][k] - f[key][k - 1], 0) * 1000 / h
    out[0] = out[1].copy()
    return out


# ---------------------------------------------------------------- models
class Ensemble:
    def __init__(self):
        import catboost as cb
        import lightgbm as lgb
        self.meta = json.loads((MODELS / 'feature_metadata.json').read_text())
        self.features = self.meta['features']
        L = lambda n: lgb.Booster(model_file=str(MODELS / n))
        self.tmax = (L('tmax_lgbm.txt'), cb.CatBoostRegressor().load_model(str(MODELS / 'tmax_catboost.cbm')))
        self.tmin = (L('tmin_lgbm.txt'), cb.CatBoostRegressor().load_model(str(MODELS / 'tmin_catboost.cbm')))
        self.occ = (L('rain_occurrence_lgbm.txt'), cb.CatBoostClassifier().load_model(str(MODELS / 'rain_occurrence_catboost.cbm')))
        self.amt = (L('rain_amount_lgbm.txt'), cb.CatBoostRegressor().load_model(str(MODELS / 'rain_amount_catboost.cbm')))

    @staticmethod
    def _chunks(fn, X, size=500_000):
        return np.concatenate([fn(X[i:i + size]) for i in range(0, len(X), size)])

    def correction(self, pair, X):
        return 0.5 * (self._chunks(pair[0].predict, X) + self._chunks(pair[1].predict, X))

    def rain(self, X):
        p = 0.5 * (self._chunks(self.occ[0].predict, X) + self._chunks(lambda x: self.occ[1].predict_proba(x)[:, 1], X))
        a = 0.5 * (self._chunks(self.amt[0].predict, X) + self._chunks(lambda x: self.amt[1].predict(x, prediction_type='Exponent'), X))
        return p * a


def day_features(ens, static, land, day, prev, nxt):
    """Feature matrix (land cells x features) for one UTC day, in the trained order."""
    g = lambda a: F.to_1km(a)[land]
    d = dict(static)
    d.update(era_tmax=g(day['tmax']), era_tmin=g(day['tmin']), era_precip=g(day['precip']), era_precip_m1=g(prev['precip']),
             era_precip_p1=g(nxt['precip']), era_ssrd=g(day['ssrd']), era_u10=g(day['u10']), era_v10=g(day['v10']))
    d['era_dtr'] = d['era_tmax'] - d['era_tmin']
    d['upslope_wind'] = d['era_u10'] * d['slope_x'] + d['era_v10'] * d['slope_y']
    doy = day['date'].timetuple().tm_yday
    d['sin_doy'] = np.full(land.sum(), np.sin(2 * np.pi * doy / 365.25), np.float32)
    d['cos_doy'] = np.full(land.sum(), np.cos(2 * np.pi * doy / 365.25), np.float32)
    return np.column_stack([np.asarray(d[k], np.float32) for k in ens.features])


# ---------------------------------------------------------------- observations
def parse_pkt_label(s, now):
    """'11:53 am, 13 November' (PKT, no year) -> UTC datetime, taking the most recent year that is not in the future (as core.js)."""
    m = re.match(r'\s*(\d{1,2}):(\d{2})\s*([ap]m)\s*,\s*(\d{1,2})\s+([A-Za-z]+)', str(s or ''), re.I)
    if not m or m.group(5).lower() not in MONTHS:
        return None
    hh = int(m.group(1)) % 12 + (12 if m.group(3).lower() == 'pm' else 0)
    for y in (now.year, now.year - 1):
        try:
            t = dt.datetime(y, MONTHS[m.group(5).lower()], int(m.group(4)), hh, int(m.group(2)), tzinfo=PKT).astimezone(dt.timezone.utc)
        except ValueError:
            continue
        if t <= now + dt.timedelta(minutes=60):
            return t
    return None


def drop_flagged(o, row):
    """Quality control (scripts/obs_qc.py): a reading the sync flagged (`qc` on the realtime.json station or METAR row) stays in the data files but is set to
    missing here, so it enters neither the live elevation bias (which needs t2m) nor the Barnes analysis. Wind needs both speed and direction."""
    for field, params, keys in (('temperature', ('temperature',), ('t2m',)), ('wind', ('wind_speed', 'wind_direction'), ('u', 'v')), ('rain', ('rain_rate',), ('rain',))):
        if any(QC.is_flagged(row, p) for p in params) and any(np.isfinite(o[k]) for k in keys):
            for k in keys:
                o[k] = np.nan
            o.setdefault('qc_dropped', []).append(field)
    return o


def load_observations(elev_1km, now):
    """All realtime.json stations (every network) and METARs -> list of dict(source, name, time, lat, lon, z, t2m, u, v, rain)."""
    obs = []
    overrides = st.POSITION_OVERRIDES
    try:
        rt = json.loads(REALTIME.read_text(encoding='utf-8'))
        for s in rt['stations']:
            v = s['v']
            t = parse_pkt_label(v[COL_SYNC] if len(v) > COL_SYNC else None, now)
            lat, lon = s.get('map_lat', s.get('lat')), s.get('map_lon', s.get('lon'))
            z = s.get('elevation')
            if s.get('network') == 'PMD' and s.get('name') in overrides:
                lat, lon, z = overrides[s['name']]
            if t is None or lat is None or lon is None:
                continue
            num = lambda i: float(v[i]) if len(v) > i and isinstance(v[i], (int, float)) else np.nan
            ws, wd = num(COL_WS) / 3.6, num(COL_WD)
            u, vv = (-ws * np.sin(np.radians(wd)), -ws * np.cos(np.radians(wd))) if np.isfinite(ws) and np.isfinite(wd) else (np.nan, np.nan)
            o = dict(source='weatherwalay', network=s.get('network'), name=s.get('name'), time=t, lat=float(lat), lon=float(lon),
                     z=float(z) if z is not None else np.nan, t2m=num(COL_T), u=u, v=vv, rain=num(COL_RR))
            obs.append(drop_flagged(o, s))
    except FileNotFoundError:
        log('  realtime.json not found')
    try:
        mt = json.loads(METAR.read_text(encoding='utf-8'))
        for s in mt.get('stations', []):
            if s.get('obsTime') is None or s.get('lat') is None:
                continue
            t = dt.datetime.fromtimestamp(s['obsTime'], dt.timezone.utc)
            ws = s['wspd'] * 0.514444 if isinstance(s.get('wspd'), (int, float)) else np.nan
            wd = s['wdir'] if isinstance(s.get('wdir'), (int, float)) else np.nan
            u, vv = (-ws * np.sin(np.radians(wd)), -ws * np.cos(np.radians(wd))) if np.isfinite(ws) and np.isfinite(wd) else (np.nan, np.nan)
            o = dict(source='metar', network='METAR', name=s.get('icaoId'), time=t, lat=float(s['lat']), lon=float(s['lon']), z=float(s['elev']) if isinstance(s.get('elev'), (int, float)) else np.nan,
                     t2m=float(s['temp']) if isinstance(s.get('temp'), (int, float)) else np.nan, u=u, v=vv, rain=np.nan)
            obs.append(drop_flagged(o, s))
    except FileNotFoundError:
        log('  metar.json not found')
    for o in obs:                                                     # METARs (and stations without a height): the 1 km cell's
        if not np.isfinite(o['z']):
            c = terrain.cell_of(o['lat'], o['lon'])
            o['z'] = float(elev_1km[c]) if c and np.isfinite(elev_1km[c]) else 0.0
    return [o for o in obs if terrain.cell_of(o['lat'], o['lon'])]


def select_fresh(obs, now):
    """Readings within OBS_WINDOW_MIN of the newest (not in the future); None when the newest is older than MAX_ANALYSIS_AGE_H."""
    obs = [o for o in obs if o['time'] <= now + dt.timedelta(minutes=10)]
    if not obs:
        return None, []
    newest = max(o['time'] for o in obs)
    if now - newest > dt.timedelta(hours=MAX_ANALYSIS_AGE_H):
        return None, []
    return newest, [o for o in obs if newest - o['time'] <= dt.timedelta(minutes=OBS_WINDOW_MIN)]


# ---------------------------------------------------------------- export
def save_png(path, rgb):
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, 'RGB').save(path, compress_level=6)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', required=True, help='ECMWF cache directory of sync-terrain-weather-ecmwf.py (one run)')
    ap.add_argument('--grid', default=str(REPO / 'public' / 'terrain-data' / 'grid-hires.json'))
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--no-assim', action='store_true', help='skip the short-term station nudging')
    ap.add_argument('--no-live-bias', action='store_true', help='skip the live elevation bias correction')
    ap.add_argument('--regime-bias', action='store_true', help='remove the live bias with a curve per weather regime (clear calm / windy) where the history has enough readings; '
                    'without it the regime curves are only fitted and reported (shadow mode) and the pooled curve is applied as before')
    a = ap.parse_args()
    t0 = time.time()
    now = dt.datetime.now(dt.timezone.utc)

    meta, times, f = load_ecmwf(a.cache, a.grid)
    log(f'ECMWF run {meta["run"]}: {len(times)} steps')
    days = F.daily_from_steps(times, f)
    log('  days (UTC): ' + ', '.join(f'{d["date"]} ({d["windows"]} x 3 h{"" if d["full"] else ", partial"})' for d in days))

    z = np.load(HERE / 'data' / 'terrain_1km.npz')
    elev = z['elevation']
    land = np.isfinite(elev)
    lat2 = np.repeat(terrain.lat_centres()[:, None], terrain.NX, 1)
    lon2 = np.repeat(terrain.lon_centres()[None, :], terrain.NY, 0)
    static = dict(elevation=elev[land], delta_z=z['delta_z'][land], slope_x=z['slope_x'][land], slope_y=z['slope_y'][land],
                  tpi=z['tpi'][land], aspect_sin=np.sin(np.radians(z['aspect'][land])), aspect_cos=np.cos(np.radians(z['aspect'][land])),
                  coast_dist=z['coast_dist'][land], lat=lat2[land], lon=lon2[land])
    nj, ni = F.node_index()

    # ---- daily 1 km values
    ens = Ensemble()
    tmax1k, tmin1k, rain1k = {}, {}, {}
    ranges = ens.meta.get('training_ranges')
    w_ml = F.ml_weight(static['elevation'], static['delta_z'], ranges) if ranges else np.ones(land.sum(), np.float32)
    lapse = -LAPSE_C_PER_M * static['delta_z']                   # the plain height correction used outside the training range
    log(f'  ML correction fully trusted on {np.mean(w_ml == 1):.0%} of land cells, partly on {np.mean((w_ml > 0) & (w_ml < 1)):.0%}')
    for k, d in enumerate(days):
        prev, nxt = days[max(k - 1, 0)], days[min(k + 1, len(days) - 1)]
        X = day_features(ens, static, land, d, prev, nxt)
        r = np.full(elev.shape, np.nan, np.float32); r[land] = ens.rain(X); rain1k[k] = r
        if d['full']:
            for store, pair, base in ((tmax1k, ens.tmax, d['tmax']), (tmin1k, ens.tmin, d['tmin'])):
                b = F.to_1km(base)
                out = b.copy(); out[land] = b[land] + w_ml * ens.correction(pair, X) + (1 - w_ml) * lapse
                store[k] = out
        log(f'  {d["date"]}: 1 km {"temperature and " if d["full"] else ""}rain pattern done ({time.time() - t0:.0f} s)')
    if not tmax1k:                                    # no complete day in the run: temperatures stay ECMWF's
        log('  no complete UTC day: temperatures are not downscaled')

    # ---- 3-hourly fields
    rates = rain_rates(f, times)
    day_of = lambda t: t.date() if t.hour or t.minute else (t - dt.timedelta(hours=1)).date()   # 00 UTC closes the day before
    T, P, U, V = [], [], [], []
    for k, t in enumerate(times):
        d_idx = next((i for i, d in enumerate(days) if d['date'] == day_of(t)), None)
        d_idx = F.anchor_day(days, day_of(t)) if d_idx is None or not days[d_idx]['full'] else d_idx
        t_ec = F.to_1km(f['2t'][k] - 273.15)
        if d_idx in tmax1k:
            day = days[d_idx]
            T.append(F.diurnal(t_ec, F.to_1km(day['tmin']), F.to_1km(day['tmax']), tmin1k[d_idx], tmax1k[d_idx]).astype(np.float32))
        else:
            T.append(t_ec)
        r_idx = next((i for i, d in enumerate(days) if d['date'] == day_of(t)), F.anchor_day(days, day_of(t)))
        w = rain1k[r_idx] + 0.1                       # +0.1 mm keeps the weights finite and mild where the model expects no rain
        P.append(F.conserve_rain(F.to_1km(rates[k]), w / np.nanmean(w), rates[k], nj, ni))
        U.append(F.to_1km(f['10u'][k])); V.append(F.to_1km(f['10v'][k]))
    hours = np.array([(t - times[0]).total_seconds() / 3600 for t in times])
    log(f'  3-hourly 1 km temperature, rain and wind first guess ({time.time() - t0:.0f} s)')

    # ---- live readings at the analysis time
    assim, live, check = dict(used=False), dict(used=False), []
    tA, fresh = (None, []) if (a.no_assim and a.no_live_bias) else select_fresh(load_observations(elev, now), now)
    hA = (tA - times[0]).total_seconds() / 3600 if tA else None
    have_obs = tA is not None and hours[0] <= hA <= hours[-1]
    if not have_obs and not (a.no_assim and a.no_live_bias):
        log('  no fresh station readings inside the forecast: no live correction or analysis')
    if have_obs:
        k0 = int(np.clip(np.searchsorted(hours, hA) - 1, 0, len(hours) - 2)); wt = (hA - hours[k0]) / (hours[k0 + 1] - hours[k0])
        at_tA = lambda L: (1 - wt) * L[k0] + wt * L[k0 + 1]
        arr = lambda key: np.array([o[key] for o in fresh], np.float64)
        lat, lon, zz = arr('lat'), arr('lon'), arr('z')
        cell_z = F.sample_1km(np.nan_to_num(elev, nan=0.0), lat, lon)
        t_cell = arr('t2m') + LAPSE_C_PER_M * (zz - cell_z)           # each reading brought to its 1 km cell's height
        bg = F.sample_1km(at_tA(T), lat, lon)
        ec_A = F.sample_1km((1 - wt) * F.to_1km(f['2t'][k0] - 273.15) + wt * F.to_1km(f['2t'][k0 + 1] - 273.15), lat, lon)
        ok_t = np.isfinite(t_cell) & np.isfinite(bg)
        qc_excluded = {f: sum(f in o.get('qc_dropped', ()) for o in fresh) for f in ('temperature', 'wind', 'rain')}     # flagged by the sync's quality control, left out
        if any(qc_excluded.values()):
            log(f'  quality control: readings left out of the live bias and analysis: {qc_excluded}')

    # ---- live elevation bias (persistent: applied at every step)
    if have_obs and not a.no_live_bias and ok_t.any():
        resid = bg - t_cell
        # held-out check: fit on one half of the stations, score the other half, and the other way round
        half = np.array([sum(map(ord, o['name'] or '')) % 2 for o in fresh])      # a fixed split (Python's hash() changes per run)
        held = np.full(len(fresh), np.nan)
        for hpart in (0, 1):
            fit = ok_t & (half != hpart)
            held[half == hpart] = (bg - F.elevation_bias(F.fit_elevation_bias(cell_z[fit], resid[fit]), cell_z))[half == hpart]
        for name, lo, hi in (('plains < 500 m', -1e9, 500), ('foothills 500-1500 m', 500, 1500), ('mountains > 1500 m', 1500, 1e9), ('all', -1e9, 1e9)):
            sel = ok_t & (zz >= lo) & (zz < hi) & (np.array([o['network'] for o in fresh]) != 'METAR')
            if sel.any():
                check.append(dict(band=name, stations=int(sel.sum()), ecmwf_bias=float(np.mean(ec_A[sel] - t_cell[sel])),
                                  ecmwf_mae=float(np.mean(np.abs(ec_A[sel] - t_cell[sel]))),
                                  km1_bias=float(np.mean(bg[sel] - t_cell[sel])), km1_mae=float(np.mean(np.abs(bg[sel] - t_cell[sel]))),
                                  km1_live_bias=float(np.mean(held[sel] - t_cell[sel])), km1_live_mae=float(np.mean(np.abs(held[sel] - t_cell[sel])))))
        # pooled fit over the last days (this run's residuals appended), recency-weighted
        import pandas as pd
        # weather regime of each station at the analysis time, from ECMWF's own cloud cover and 10 m wind (forecast1km.classify_regime); NaN when the cache has no cloud
        cloud_st = wind_st = regime_st = np.full(len(fresh), np.nan)
        if 'tcc' in f:
            cloud_1km = (1 - wt) * F.to_1km(f['tcc'][k0] * 100) + wt * F.to_1km(f['tcc'][k0 + 1] * 100)
            cloud_st, wind_st = F.sample_1km(cloud_1km, lat, lon), F.sample_1km(np.hypot(at_tA(U), at_tA(V)), lat, lon)
            regime_st = F.classify_regime(cloud_st, wind_st).astype(float)
        rows = pd.DataFrame(dict(time=tA.strftime('%Y-%m-%dT%H:%M:%SZ'), name=[o['name'] for o in fresh], network=[o['network'] for o in fresh],
                                 cell_z=cell_z, resid=resid, regime=regime_st, cloud=cloud_st, wind=wind_st, model=ens.meta.get('created')))[ok_t]
        hist = pd.read_csv(BIAS_HISTORY) if BIAS_HISTORY.exists() else rows.iloc[:0]
        hist = pd.concat([hist[(hist.model == ens.meta.get('created')) & (hist.time != rows.time.iloc[0])], rows], ignore_index=True)
        age = (pd.Timestamp(tA) - pd.to_datetime(hist.time, utc=True)).dt.total_seconds() / 86400
        hist = hist[age <= F.BIAS['keep_days']].reset_index(drop=True); age = age[age <= F.BIAS['keep_days']].values
        hist.to_csv(BIAS_HISTORY, index=False)
        curve = F.fit_elevation_bias(hist.cell_z, hist.resid, 0.5 ** (age / F.BIAS['half_life_days']))
        corr = F.elevation_bias(curve, elev)
        for col in ('regime', 'cloud', 'wind'):                                                   # history written before regimes were recorded has no such columns
            if col not in hist:
                hist[col] = np.nan
        rfit = F.fit_regime_bias(hist.cell_z, hist.resid, hist.regime, 0.5 ** (age / F.BIAS['half_life_days']), hist.time)
        use_regime = bool(a.regime_bias and rfit['curves'] and 'tcc' in f)
        for k in range(len(times)):
            if use_regime:                                                                         # each cell takes the curve of its own regime at this step
                reg_k = F.classify_regime(F.to_1km(f['tcc'][k] * 100), np.hypot(U[k], V[k]))
                T[k] = T[k] - F.regime_bias(rfit, elev, reg_k)
            else:
                T[k] = T[k] - corr
        for store in (tmax1k, tmin1k):
            for k in store:
                store[k] = store[k] - corr
        reg0 = F.classify_regime(F.to_1km(f['tcc'][0] * 100), np.hypot(U[0], V[0])) if 'tcc' in f else None
        regime = dict(mode='applied' if use_regime else 'shadow', constants=F.REGIME, counts=rfit['counts'],
                      curves={F.REGIME_NAMES[c]: v for c, v in rfit['curves'].items()},
                      land_share_first_step=None if reg0 is None else {F.REGIME_NAMES[c]: float(np.mean(reg0[land] == c)) for c in F.REGIME_NAMES},
                      note='Screening conventions for the regimes; the curves need min_readings residuals from min_analyses analysis times each. Not validated: the history had no regimes before this run.')
        log('  weather regimes (' + regime['mode'] + '): ' + ', '.join(f'{n} {c["readings"]} readings / {c["analyses"]} analyses' + (' (own curve)' if c['curve'] else ' (pooled curve)') for n, c in rfit['counts'].items()))
        live = dict(used=True, qc_excluded=qc_excluded, regime=regime, curve=curve, analyses=int(hist.time.nunique()), readings=int(len(hist)),
                    first=str(hist.time.min()), last=str(hist.time.max()))
        log(f'  live elevation bias from {live["readings"]} readings in {live["analyses"]} analyses: '
            + ', '.join(f'{int(k)} m {v:+.1f}' for k, v in zip(curve['knots'], curve['values'])) + ' degC removed')

    # ---- short-term station analysis
    if have_obs and not a.no_assim:
        T_A, P_A, U_A, V_A = at_tA(T), at_tA(P), at_tA(U), at_tA(V)
        incs, counts = {}, {}
        t_obs = dict(lat=lat, lon=lon, z=zz, value=t_cell)
        incs['t2m'], counts['t2m'] = F.analyse(lambda inc: F.sample_1km(T_A + inc, lat, lon), t_obs, 't2m', elev)
        for key, field in (('u', U_A), ('v', V_A)):
            incs[key], counts[key] = F.analyse(lambda inc, fl=field: F.sample_1km(fl + inc, lat, lon),
                                               dict(lat=lat, lon=lon, z=zz, value=arr(key)), key, elev)
        r_val = arr('rain')
        ok = np.isfinite(r_val) & (np.abs(r_val - F.sample_1km(P_A, lat, lon)) <= F.ANALYSIS['gross']['rain'])
        incs['rain'] = F.barnes(lat[ok], lon[ok], zz[ok], (r_val - F.sample_1km(P_A, lat, lon))[ok], elev, RAIN_LENGTH_KM)
        counts['rain'] = int(ok.sum())
        for k in range(len(times)):
            w = F.time_weight(hours[k] - hA)
            if w > 0:
                T[k] = T[k] + w * incs['t2m']; U[k] = U[k] + w * incs['u']; V[k] = V[k] + w * incs['v']
                P[k] = np.maximum(P[k] + w * incs['rain'], 0)
        used = [o for o, good in zip(fresh, np.isfinite(t_cell) | np.isfinite(arr('u')) | ok) if good]
        assim = dict(used=True, analysis_time=tA.strftime('%Y-%m-%dT%H:%M:%SZ'), decay_hours=F.ANALYSIS['decay_hours'], qc_excluded=qc_excluded,
                     window_minutes=OBS_WINDOW_MIN, counts=counts, stations=len(used),
                     by_source={s: sum(o['source'] == s for o in used) for s in ('weatherwalay', 'metar')},
                     by_network={n: sum(o['network'] == n for o in used) for n in sorted({o['network'] or '?' for o in used})})
        log(f'  analysis at {assim["analysis_time"]}: {len(used)} stations ({assim["by_source"]}), used per field {counts}')

    # ---- rain / snow split (phase.py, Ding et al. 2014): the snow share of the water from the final 1 km temperature, ECMWF's humidity and the cell's height
    PS, phase_info = None, None
    if '2d' in f:
        PS, counts = [], dict(wet=0, agree=0, ours=0.0, ecmwf=0.0, water=0.0, jennings_agree=0)
        sf_rates = rain_rates(f, times, 'sf') if 'sf' in f else None
        for k in range(len(times)):
            rh = F.to_1km(PH.relative_humidity(f['2t'][k] - 273.15, f['2d'][k] - 273.15))
            share = PH.snow_share(T[k], rh, elev).astype(np.float32)               # elev is NaN at sea: no share there
            PS.append(share)
            if sf_rates is not None:
                with np.errstate(invalid='ignore', divide='ignore'):
                    ecmwf_share = np.where(rates[k] > 0, np.minimum(sf_rates[k] / rates[k], 1.0), 0.0)
                for key, v in PH.agreement_counts(P[k], share, F.to_1km(ecmwf_share), PH.jennings_probability(T[k], rh)).items():
                    counts[key] += v
        phase_info = PH.summary(counts, sf_rates is not None, True)
        log(f'  rain / snow split for {len(times)} steps: ' + (f'{phase_info["wet_cells"]} wet cell-steps, snow share of the water '
            f'{phase_info["snow_water_share"]:.1%} (ECMWF {phase_info["ecmwf_snow_water_share"]:.1%}), same class as ECMWF on {phase_info["class_agreement"]:.1%}, '
            f'same call as Jennings et al. on {phase_info["jennings_agreement"]:.1%}'
            if sf_rates is not None else 'no ECMWF snowfall to compare with'))
    else:
        log('  no 2 m dew point in the ECMWF cache: no rain / snow split (rerun the ECMWF sync)')

    # ---- mass-consistent wind
    zc = F.to_1km(np.nan_to_num(F.block_mean(np.nan_to_num(elev, nan=0.0), nj, ni)))
    mcw = F.MassConsistentWind(elev, zc)
    for k in range(len(times)):
        U[k], V[k] = mcw.adjust(U[k], V[k])
    log(f'  mass-consistent 10 m wind for {len(times)} steps ({time.time() - t0:.0f} s)')

    # ---- export
    out = Path(a.out)
    tmp = out.with_name(out.name + '.tmp')
    shutil.rmtree(tmp, ignore_errors=True)
    steps = []
    for k, t in enumerate(times):
        save_png(tmp / 'steps' / f'tr-{k:03d}.png', F.pack_temp_rain(T[k], P[k]))
        save_png(tmp / 'steps' / f'w-{k:03d}.png', F.pack_wind(U[k], V[k]))
        entry = dict(hour=float(hours[k]), time=t.strftime('%Y-%m-%dT%H:%M:%SZ'), tr=f'steps/tr-{k:03d}.png', wind=f'steps/w-{k:03d}.png')
        if PS is not None:
            save_png(tmp / 'steps' / f'ph-{k:03d}.png', PH.pack_phase(PS[k]))
            entry['phase'] = f'steps/ph-{k:03d}.png'
        steps.append(entry)
    daily = []
    for k, d in enumerate(days):
        e = dict(date=str(d['date']), full=d['full'])
        if k in tmax1k:
            save_png(tmp / 'daily' / f'{d["date"]}-tmax.png', F.pack_temp_rain(tmax1k[k], np.zeros_like(tmax1k[k])))
            save_png(tmp / 'daily' / f'{d["date"]}-tmin.png', F.pack_temp_rain(tmin1k[k], np.zeros_like(tmin1k[k])))
            e.update(tmax=f'daily/{d["date"]}-tmax.png', tmin=f'daily/{d["date"]}-tmin.png')
        daily.append(e)
    tiles = []
    stackT, stackP = np.stack(T), np.stack(P)
    stackS = np.stack(PS) if PS is not None else None
    for la in range(int(terrain.BOX['south']), int(terrain.BOX['north'])):
        for lo in range(int(terrain.BOX['west']), int(terrain.BOX['east'])):
            j0 = round((terrain.BOX['north'] - (la + 1)) / terrain.RES); i0 = round((lo - terrain.BOX['west']) / terrain.RES)
            if not land[j0:j0 + 100, i0:i0 + 100].any():
                continue
            rgb = F.pack_temp_rain(stackT[:, j0:j0 + 100, i0:i0 + 100], stackP[:, j0:j0 + 100, i0:i0 + 100]).reshape(-1, 100, 3)
            save_png(tmp / 'tiles' / f'{la}_{lo}.png', rgb)
            if stackS is not None:
                save_png(tmp / 'tiles' / f'ph_{la}_{lo}.png', PH.pack_phase(stackS[:, j0:j0 + 100, i0:i0 + 100]).reshape(-1, 100, 3))
            tiles.append(f'{la}_{lo}')
    cv = [r for r in ens.meta.get('cv', {}).get('metrics', []) if r.get('band') == 'All stations']
    manifest = dict(
        schema=1, run=meta['run'], created=now.strftime('%Y-%m-%dT%H:%M:%SZ'), times=meta['times'], hours=[float(h) for h in hours],
        grid=dict(west=terrain.BOX['west'], south=terrain.BOX['south'], east=terrain.BOX['east'], north=terrain.BOX['north'],
                  res=terrain.RES, nx=terrain.NX, ny=terrain.NY, row0='north'),
        encoding=dict(
            temp_rain=dict(bits='value = R*65536 + G*256 + B; temp_code = value >> 13; rain_code = value & 8191',
                           temp='degC = temp_code / 10 - 60 (2047 = no value)', rain='mm per hour = rain_code / 10 (3 h mean)'),
            wind=dict(bits='value = R*65536 + G*256 + B; u_code = value >> 12; v_code = value & 4095',
                      wind='m/s = (code - 2048) / 50 (4095 = no value); u east, v north, 10 m')),
        steps=steps, daily=daily,
        tiles=dict(size_deg=1, cells=100, steps=len(times), path='tiles/{lat}_{lon}.png', layout='step k = rows 100k..100k+99, row 0 north',
                   phase_path='tiles/ph_{lat}_{lon}.png' if PS is not None else None, available=tiles),
        phase=None if PS is None else dict(
            method='rain / snow / sleet from wet-bulb temperature, relative humidity and height: snow if Tw <= Tmin, sleet between Tmin and Tmax, rain if Tw >= Tmax',
            source=PH.DING['source'],
            equations='dT = 0.215 - 0.099 RH + 1.018 RH^2; dS = 2.374 - 1.634 RH; T0 = -5.87 - 0.1042 Z + 0.0885 Z^2 + 16.06 RH - 9.614 RH^2 (Z km, RH 0..1); '
                      'Tmin = T0 - dS ln[exp(dT/dS) - 2 exp(-dT/dS)], Tmax = 2 T0 - Tmin when dT/dS > ln 2, else Tmin = Tmax = T0; '
                      'Tw = Ta - esat(Ta)(1 - RH) / (0.000643 ps + d esat/dTa), esat = 6.1078 exp(17.27 Ta / (Ta + 237.3)) hPa',
            encoding='red = round(255 x snow share of the water), green and blue 0: 255 snow, 128 sleet (half snow, half rain: our convention), 0 rain',
            humidity='ECMWF 2 m temperature and dew point at 0.1 degree, relative humidity held constant in each 0.1 degree cell; the 1 km temperature moves Tw; '
                     'ps is the ICAO standard-atmosphere pressure at the 1 km cell height, Z is the cell height',
            agreement=phase_info, cross_check=PH.JENNINGS['source'],
            limits='The scheme was fitted to DAILY mean data at Chinese stations (about 88 % accurate for air temperature between -10 and 10 degC; not evaluated outside China); '
                   'its authors expect thresholds for hourly precipitation to be lower, and it is applied here to 3-hourly values. '
                   'Not validated here: no solid-precipitation observations; unheated tipping-bucket gauges (Davis stations, Shimshal included) do not record snow when it falls. '
                   'Screening only, not an official forecast.'),
        assimilation=assim, live_bias=live, ml_ranges=ranges, ml_ramp=F.ML_RAMP, bias_constants=F.BIAS,
        model=dict(name='1 km ML downscaling (PMD + ECMWF)', trained_on=f'PMD daily stations x ERA5-Land {ens.meta.get("period")}',
                   stations=ens.meta.get('stations'), cv_all_stations=cv, runtime_inputs='ECMWF IFS 0.1 degree open data (CC BY 4.0)',
                   note='Models trained on ERA5-Land, applied to ECMWF IFS forecasts; cells far above the highest training station are extrapolated.'),
        wind=dict(method='first guess = ECMWF 10 m wind (bilinear); station increments; mass-consistent over the 1 km terrain', constants=F.WIND),
        analysis_constants=F.ANALYSIS,
        check=check,
        attribution=['Pakistan Meteorological Department (training data)', 'ECMWF Open Data (CC BY 4.0)',
                     'Contains modified Copernicus Climate Change Service information (ERA5-Land, training)',
                     'Copernicus DEM GLO-90 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018',
                     'WeatherWalay stations', 'NOAA Aviation Weather Center (METAR)'],
        note='Screening estimate, not an official PMD forecast or warning.')
    (tmp / 'manifest.json').write_text(json.dumps(F.json_safe(manifest), indent=1, default=str, allow_nan=False))
    old = out.with_name(out.name + '.old')
    shutil.rmtree(old, ignore_errors=True)
    if out.exists():
        out.rename(old)
    tmp.rename(out)
    shutil.rmtree(old, ignore_errors=True)
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
    log(f'wrote {out} ({size / 1e6:.0f} MB, {len(steps)} steps, {len(tiles)} tiles) in {time.time() - t0:.0f} s')
    if check:
        print(f'\nTemperature check at {tA:%Y-%m-%d %H:%M} UTC against fresh stations (degC, before the short-term nudging).')
        print('"1 km + live bias" is held out: the bias curve is fitted on the other half of the stations.')
        print(f'{"band":22} {"stations":>8}  {"ECMWF bias / MAE":>17}  {"1 km bias / MAE":>16}  {"1 km + live bias":>17}')
        for c in check:
            print(f'{c["band"]:22} {c["stations"]:8d}  {c["ecmwf_bias"]:+7.2f} / {c["ecmwf_mae"]:5.2f}  {c["km1_bias"]:+7.2f} / {c["km1_mae"]:5.2f}'
                  f'  {c["km1_live_bias"]:+7.2f} / {c["km1_live_mae"]:5.2f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
