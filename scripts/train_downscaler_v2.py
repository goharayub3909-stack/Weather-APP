"""Downscaler v2: LightGBM + CatBoost with the upper-air and orographic moisture-flux features, scored against the v1 features.

Input: downscaler/data/pmd_training.parquet (scripts/merge_training_matrix.py). Only rows that have every v2 feature are used, so the v1 and v2
feature sets are always compared on the same rows and folds.

Validation (three folds, each trained on everything else):
  year 2010 and year 2022  held-out years: 2010 the earliest year of the record and 2022 the year of the Pakistan monsoon floods
  north mountains 20%      a random fifth of the northern mountain stations (latitude >= 34 N and height >= 1000 m), all years
Early stopping: inside each training set the years 2015 and 2019 are the validation set (50 rounds patience); the fold's models are the
early-stopped ones. The saved models are refitted on all rows with 1.1 x the mean best iteration count of the folds.
Targets: tmax and tmin as a correction to ERA5-Land; rain as P(wet day >= 1 mm) x wet-day amount (as v1).
Scores: RMSE against the raw ERA5-Land value, the v1 features and the v2 features; rain also POD, FAR and CSI for >= 1 mm (a wet day is
P(wet) >= 0.5) and >= 10 mm (P(wet) >= 0.5 and the wet-day amount >= 10 mm), against ERA5-Land's own rain over the same event thresholds.

Output in downscaler/models/ (v1 files are left alone): v2_<target>_{lgbm.txt,catboost.cbm}, v2_rain_{occurrence,amount}_..., v2_cv_metrics.csv,
v2_feature_importance.csv, feature_metadata_v2.json.

Run: .venv-terrain/Scripts/python.exe scripts/train_downscaler_v2.py [--max-rounds 1500] [--quick]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DS = HERE.parent / 'downscaler'
sys.path.insert(0, str(DS))
import features as FT  # noqa: E402
import forecast1km  # noqa: E402

DATA, MODELS = DS / 'data', DS / 'models'
V1, V2 = FT.V1_COLS, FT.FEATURE_COLS
VALID_YEARS = (2015, 2019)
TEST_YEARS = (2010, 2022)
NORTH = dict(lat=34.0, elev=1000.0)
SPATIAL_FRACTION = 0.2
WET_MM, HEAVY_MM = 1.0, 10.0
BANDS = [('Plains (<500 m)', -1e9, 500), ('Foothills (500-1500 m)', 500, 1500), ('Mountains (>1500 m)', 1500, 1e9)]
PATIENCE = 50
SPATIAL_FOLD = 'north mountains 20% of stations'


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- folds and scores (pure; tested)
def make_folds(df, seed=0, hold=()):
    """-> ({fold name: boolean mask of its test rows}, set of held-out stations). hold: station-name fragments; their stations form one more fold (e.g. 'Murree')."""
    folds = {f'year {y}': (df.date.dt.year == y).values for y in TEST_YEARS}
    s = df.drop_duplicates('station_id')
    north = sorted(s[(s.lat >= NORTH['lat']) & (s.station_elev >= NORTH['elev'])].station_id)
    held = set()
    if north:
        k = max(1, int(round(SPATIAL_FRACTION * len(north))))
        held = set(np.random.default_rng(seed).choice(north, k, replace=False))
    folds[SPATIAL_FOLD] = df.station_id.isin(held).values
    if hold:
        named = df.station_name.fillna('').str.contains('|'.join(hold), case=False, regex=True)
        if named.any():
            folds['held-out stations: ' + ', '.join(hold)] = named.values
    return folds, held


def split_fold(df, test_mask):
    """Train / validation / test index masks for one fold: validation = the validation years of the training rows. A held-out station
    is out of training entirely; a held-out year is out of training for every station."""
    test = np.asarray(test_mask)
    train_all = ~test
    val = train_all & df.date.dt.year.isin(VALID_YEARS).values
    return train_all & ~val, val, test


def rmse(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.sqrt(np.mean((a - b) ** 2))) if len(a) else float('nan')


def event_scores(obs_event, pred_event):
    """POD, FAR, CSI of boolean event arrays."""
    o, p = np.asarray(obs_event, bool), np.asarray(pred_event, bool)
    h, m, f = int((o & p).sum()), int((o & ~p).sum()), int((~o & p).sum())
    return dict(pod=h / max(h + m, 1), far=f / max(h + f, 1), csi=h / max(h + m + f, 1), hits=h, misses=m, false_alarms=f)


# ---------------------------------------------------------------- models
def _lgb(kind, max_rounds, **kw):
    import lightgbm as lgb
    p = dict(n_estimators=max_rounds, learning_rate=0.08, num_leaves=63, min_child_samples=40, subsample=0.8, subsample_freq=1,
             colsample_bytree=0.8, reg_lambda=1.0, random_state=0, verbose=-1, n_jobs=-1)
    p.update(kw)
    return lgb.LGBMClassifier(**p) if kind == 'clf' else lgb.LGBMRegressor(**p)


def _cat(kind, max_rounds, **kw):
    import catboost as cb
    p = dict(iterations=max_rounds, depth=6, learning_rate=0.1, random_seed=0, verbose=0, thread_count=-1, allow_writing_files=False,
             early_stopping_rounds=PATIENCE)
    p.update(kw)
    return cb.CatBoostClassifier(**p) if kind == 'clf' else cb.CatBoostRegressor(**p)


def fit_pair(kind, X, y, Xv, yv, max_rounds, lgb_kw=None, cat_kw=None, refit=None):
    """LightGBM and CatBoost, early-stopped on (Xv, yv); with refit = (iterations lgbm, iterations catboost) both are fitted on (X, y) for exactly that many.
    -> (lgbm, catboost, best iterations)."""
    import lightgbm as lgb
    if refit:
        a = _lgb(kind, refit[0], **(lgb_kw or {})).fit(X, y)
        c = _cat(kind, refit[1], early_stopping_rounds=None, **(cat_kw or {})).fit(X, y)
        return a, c, refit
    a = _lgb(kind, max_rounds, **(lgb_kw or {})).fit(X, y, eval_X=Xv, eval_y=yv, callbacks=[lgb.early_stopping(PATIENCE, verbose=False)])
    c = _cat(kind, max_rounds, **(cat_kw or {})).fit(X, y, eval_set=(Xv, yv), use_best_model=True)
    return a, c, (int(a.best_iteration_ or max_rounds), int(c.get_best_iteration() + 1))


class Predictor:
    """tmax, tmin (ERA5-Land + mean correction) and rain (P(wet) x amount) from one feature list."""
    def __init__(self, feats):
        """feats: one list for every model, or a dict {'tmax': [...], 'tmin': [...], 'occ': [...], 'amt': [...]} (decoupled targets)."""
        self.by = feats if isinstance(feats, dict) else {k: list(feats) for k in ('tmax', 'tmin', 'occ', 'amt')}
        self.feats = list(dict.fromkeys(f for v in self.by.values() for f in v))            # every column used by any model
        self.models, self.iters = {}, {}

    def fit(self, df, train, val, max_rounds, refit=None):
        d = df.loc[train | val] if refit else df.loc[train]
        v = df.loc[val]
        for t in ('tmax', 'tmin'):
            ok, okv = d[t].notna() & d[f'era_{t}'].notna(), v[t].notna() & v[f'era_{t}'].notna()
            a, c, it = fit_pair('reg', d.loc[ok, self.by[t]], d.loc[ok, t] - d.loc[ok, f'era_{t}'], v.loc[okv, self.by[t]], v.loc[okv, t] - v.loc[okv, f'era_{t}'],
                                max_rounds, refit=refit and refit[t])
            self.models[t], self.iters[t] = (a, c), it
        ok, okv = d.rain.notna(), v.rain.notna()
        a, c, it = fit_pair('clf', d.loc[ok, self.by['occ']], (d.loc[ok, 'rain'] >= WET_MM).astype(int), v.loc[okv, self.by['occ']], (v.loc[okv, 'rain'] >= WET_MM).astype(int), max_rounds,
                            refit=refit and refit['occ'])
        self.models['occ'], self.iters['occ'] = (a, c), it
        wet, wetv = ok & (d.rain >= WET_MM), okv & (v.rain >= WET_MM)
        a, c, it = fit_pair('reg', d.loc[wet, self.by['amt']], d.loc[wet, 'rain'], v.loc[wetv, self.by['amt']], v.loc[wetv, 'rain'], max_rounds,
                            lgb_kw=dict(objective='gamma'), cat_kw=dict(loss_function='Tweedie:variance_power=1.9'), refit=refit and refit['amt'])
        self.models['amt'], self.iters['amt'] = (a, c), it
        return self

    def predict(self, df):
        out = {}
        for t in ('tmax', 'tmin'):
            a, c = self.models[t]
            X = df[self.by[t]]
            out[t] = df[f'era_{t}'].values + 0.5 * (a.predict(X) + c.predict(X))
        a, c = self.models['occ']
        X = df[self.by['occ']]
        out['p_wet'] = 0.5 * (a.predict_proba(X)[:, 1] + c.predict_proba(X)[:, 1])
        a, c = self.models['amt']
        X = df[self.by['amt']]
        out['amount'] = 0.5 * (a.predict(X) + c.predict(X, prediction_type='Exponent'))
        out['rain'] = out['p_wet'] * out['amount']
        return out


def evaluate(df, pred, fold, variant, band_of):
    """Rows of the metrics table for one fold and variant ('raw' is ERA5-Land itself)."""
    rows = []
    for band, mask in band_of.items():
        d = df.loc[mask]
        p = {k: v[mask] for k, v in pred.items()} if pred is not None else None
        for t in ('tmax', 'tmin'):
            ok = d[t].notna().values & d[f'era_{t}'].notna().values
            if ok.any():
                est = d[f'era_{t}'].values if p is None else p[t]
                rows.append(dict(fold=fold, band=band, variant=variant, target=t, n=int(ok.sum()), rmse=rmse(d[t].values[ok], est[ok])))
        ok = d.rain.notna().values & d.era_rain_window.notna().values
        if ok.any():
            obs = d.rain.values[ok]
            est = d.era_rain_window.values[ok] if p is None else p['rain'][ok]
            r = dict(fold=fold, band=band, variant=variant, target='rain', n=int(ok.sum()), rmse=rmse(obs, est))
            for name, thr in (('1mm', WET_MM), ('10mm', HEAVY_MM)):
                if p is None:
                    pe = d.era_rain_window.values[ok] >= thr
                else:
                    pe = (p['p_wet'][ok] >= 0.5) & ((p['amount'][ok] >= thr) if thr > WET_MM else True)
                s = event_scores(obs >= thr, pe)
                r.update({f'pod_{name}': s['pod'], f'far_{name}': s['far'], f'csi_{name}': s['csi']})
            rows.append(r)
    return rows


# ---------------------------------------------------------------- importance
def station_errors(d, pred, variant):
    """Rows (variant, station, target, n, bias, rmse) of the estimate minus the observation for tmax and tmin, per station name."""
    rows = []
    for t in ('tmax', 'tmin'):
        ok = d[t].notna().values
        e = pd.Series(np.asarray(pred[t])[ok] - d[t].values[ok])
        for name, g in e.groupby(d.station_name.values[ok]):
            rows.append(dict(variant=variant, station=name, target=t, n=len(g), bias=float(g.mean()), rmse=float(np.sqrt((g ** 2).mean()))))
    return rows


def importance_table(pred, target_names=('tmax', 'tmin', 'occ', 'amt')):
    """Per model and library: gain share (%) and split count of each v2 feature."""
    rows = []
    for t in target_names:
        a, c = pred.models[t]
        booster = a.booster_
        gain = booster.feature_importance('gain'); splits = booster.feature_importance('split')
        cat = c.get_feature_importance()
        for i, f in enumerate(pred.by[t]):
            rows.append(dict(model=t, feature=f, lgbm_gain_pct=100 * gain[i] / max(gain.sum(), 1e-12), lgbm_splits=int(splits[i]), catboost_pct=float(cat[i])))
    return pd.DataFrame(rows)


def verify_saved(pred, df, n=2000):
    """Reload every saved model and compare its predictions with the in-memory ones (max absolute difference, same output type on both sides)."""
    import catboost as cb
    import lightgbm as lgb
    Xall = df.dropna(subset=pred.feats).sample(min(n, len(df)), random_state=0)
    worst = 0.0
    for t, stem in {'tmax': 'v2_tmax', 'tmin': 'v2_tmin', 'occ': 'v2_rain_occurrence', 'amt': 'v2_rain_amount'}.items():
        a, c = pred.models[t]
        X = Xall[pred.by[t]]
        booster = lgb.Booster(model_file=str(MODELS / f'{stem}_lgbm.txt'))
        if t == 'occ':
            worst = max(worst, float(np.abs(booster.predict(X) - a.predict_proba(X)[:, 1]).max()))
            m = cb.CatBoostClassifier().load_model(str(MODELS / f'{stem}_catboost.cbm'))
            worst = max(worst, float(np.abs(m.predict_proba(X)[:, 1] - c.predict_proba(X)[:, 1]).max()))
        else:
            worst = max(worst, float(np.abs(booster.predict(X) - a.predict(X)).max()))
            m = cb.CatBoostRegressor().load_model(str(MODELS / f'{stem}_catboost.cbm'))
            worst = max(worst, float(np.abs(m.predict(X) - c.predict(X)).max()))
    return worst


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--matrix', default=str(DATA / 'pmd_training.parquet'))
    ap.add_argument('--max-rounds', type=int, default=1500)
    ap.add_argument('--quick', action='store_true', help='300 rounds, for a trial run')
    ap.add_argument('--ablation', choices=['cape', 'topo'], help='cross-validation only, saves no models. cape: v1 features against v1 + cape_max. topo: the v2 features against '
                    'the v2 features + the multi-scale topographic features, chosen per target (tmax: sun on the slope, shading, convexity; tmin: cold-air pooling and drainage); '
                    'needs a matrix from scripts/add_topo_features.py')
    ap.add_argument('--hold', help='comma-separated station-name fragments held out as one more fold (e.g. Murree); reports their bias and RMSE per variant')
    a = ap.parse_args()
    max_rounds = 300 if a.quick else a.max_rounds
    BASE, V2 = V1, FT.FEATURE_COLS                                          # the 'v1' and 'v2' columns of the report
    if a.ablation == 'cape':
        V2 = V1 + ['cape_max']
    elif a.ablation == 'topo':
        BASE, V2 = FT.FEATURE_COLS, FT.with_topo(FT.FEATURE_COLS)
    flat = lambda f: list(dict.fromkeys(c for v in (f.values() if isinstance(f, dict) else [f]) for c in v))
    t0 = time.time()
    MODELS.mkdir(exist_ok=True)

    df = pd.read_parquet(a.matrix)
    df['date'] = pd.to_datetime(df.date)
    n0 = len(df)
    df = df[df[flat(V2)].notna().all(axis=1)].reset_index(drop=True)
    log(f'matrix: {n0:,} rows; {len(df):,} with every v2 feature, {df.station_id.nunique()} stations, {df.date.min():%Y-%m-%d} to {df.date.max():%Y-%m-%d}')
    folds, held = make_folds(df, hold=[h.strip() for h in a.hold.split(',') if h.strip()] if a.hold else ())
    log(f'folds: ' + '; '.join(f'{k}: {int(m.sum()):,} test rows' for k, m in folds.items()))
    log(f'held-out northern mountain stations ({len(held)}): {sorted(held)}')
    bands = lambda d: {'all': np.ones(len(d), bool), **{b: ((d.station_elev >= lo) & (d.station_elev < hi)).values for b, lo, hi in BANDS}}

    metrics, iters, held_rows = [], {'v1': [], 'v2': []}, []
    for fold, test_mask in folds.items():
        train, val, test = split_fold(df, test_mask)
        if test.sum() == 0 or train.sum() == 0:
            log(f'fold "{fold}": no rows, skipped'); continue
        dt_ = df.loc[test]
        metrics += evaluate(dt_, None, fold, 'raw ERA5-Land', bands(dt_))
        is_held = fold.startswith('held-out stations')
        if is_held:
            held_rows += station_errors(dt_, {t: dt_[f'era_{t}'].values for t in ('tmax', 'tmin')}, 'raw ERA5-Land')
        for name, feats in (('v1', BASE), ('v2', V2)):
            t1 = time.time()
            p = Predictor(feats).fit(df, train, val, max_rounds)
            iters[name].append(p.iters)
            pred = p.predict(dt_)
            metrics += evaluate(dt_, pred, fold, f'{name} features', bands(dt_))
            if is_held:
                held_rows += station_errors(dt_, pred, f'{name} features')
            log(f'  {fold} / {name}: trained and scored in {time.time() - t1:.0f} s; best iterations ' + ', '.join(f'{k} {v[0]}/{v[1]}' for k, v in p.iters.items()))
    m = pd.DataFrame(metrics)
    m.to_csv(MODELS / ('v2_cv_metrics.csv' if not a.ablation else f'ablation_{a.ablation}_cv_metrics.csv'), index=False)

    # ---- report
    pd.set_option('display.width', 220)
    print('\nRMSE (degC for tmax and tmin, mm for rain) on the held-out part of each fold:')
    for fold in m.fold.unique():
        sub = m[(m.fold == fold) & (m.band == 'all')].pivot(index='target', columns='variant', values='rmse')
        n = m[(m.fold == fold) & (m.band == 'all')].groupby('target').n.first()
        sub = sub[['raw ERA5-Land', 'v1 features', 'v2 features']].assign(n=n)
        print(f'\n  {fold}'); print('  ' + sub.round(2).to_string().replace('\n', '\n  '))
    print('\nRain events (all stations of each fold): POD / FAR / CSI')
    for fold in m.fold.unique():
        sub = m[(m.fold == fold) & (m.band == 'all') & (m.target == 'rain')].set_index('variant')
        print(f'  {fold}')
        for v in ('raw ERA5-Land', 'v1 features', 'v2 features'):
            if v not in sub.index:                                  # a fold with no rain observations (2010 has none): nothing to score
                print(f'    {v:14} no rain observations in this fold'); continue
            r = sub.loc[v]
            print(f'    {v:14} >=1 mm: POD {r.pod_1mm:.2f} FAR {r.far_1mm:.2f} CSI {r.csi_1mm:.2f}   >=10 mm: POD {r.pod_10mm:.2f} FAR {r.far_10mm:.2f} CSI {r.csi_10mm:.2f}')
    print('\nBy elevation band, all folds pooled (RMSE: raw / v1 / v2):')
    pool = m[m.band != 'all'].groupby(['band', 'target', 'variant']).apply(lambda g: np.sqrt(np.average(g.rmse ** 2, weights=g.n)), include_groups=False).unstack('variant')
    for (band, target), r in pool.iterrows():
        print(f'  {band:24} {target:5} {r["raw ERA5-Land"]:6.2f} / {r["v1 features"]:6.2f} / {r["v2 features"]:6.2f}')

    if held_rows:
        hr = pd.DataFrame(held_rows)
        print('\nHeld-out stations: mean error (estimate - observation, degC) and RMSE per station and variant:')
        for t in ('tmax', 'tmin'):
            g = hr[hr.target == t].pivot_table(index='station', columns='variant', values=['bias', 'rmse', 'n'], aggfunc='first')
            cols = [(k, v) for v in ('raw ERA5-Land', 'v1 features', 'v2 features') for k in ('bias', 'rmse') if (k, v) in g.columns]
            print(f'  {t}\n  ' + g[cols].round(2).to_string().replace('\n', '\n  '))
    if a.ablation:
        what = {'cape': 'v1 column = v1 features, v2 column = v1 features + cape_max', 'topo': 'v1 column = the v2 features (upper air), v2 column = + topographic features per target'}[a.ablation]
        log(f'ablation "{a.ablation}": {what}; no models saved. done in {(time.time() - t0) / 60:.1f} min')
        return 0

    # ---- final models (v2 features, all rows)
    mean_it = lambda key, j: int(round(1.1 * np.mean([it[key][j] for it in iters['v2']])))
    refit = {k: (mean_it(k, 0), mean_it(k, 1)) for k in ('tmax', 'tmin', 'occ', 'amt')}
    log(f'final models on all {len(df):,} rows; iterations (lgbm, catboost): {refit}')
    allrows = np.ones(len(df), bool)
    final = Predictor(V2).fit(df, allrows & ~df.date.dt.year.isin(VALID_YEARS).values, allrows & df.date.dt.year.isin(VALID_YEARS).values, max_rounds, refit=refit)
    for t, stem in (('tmax', 'v2_tmax'), ('tmin', 'v2_tmin'), ('occ', 'v2_rain_occurrence'), ('amt', 'v2_rain_amount')):
        a, c = final.models[t]
        a.booster_.save_model(str(MODELS / f'{stem}_lgbm.txt'))
        c.save_model(str(MODELS / f'{stem}_catboost.cbm'))
    worst = verify_saved(final, df)
    log(f'saved models reload and agree with the in-memory ones (max difference {worst:.2e})')

    imp = importance_table(final)
    imp.to_csv(MODELS / 'v2_feature_importance.csv', index=False)
    print('\nFeature importance of the saved v2 models (LightGBM gain share %, split count; CatBoost %):')
    for t in ('tmax', 'tmin', 'occ', 'amt'):
        s = imp[imp.model == t].sort_values('lgbm_gain_pct', ascending=False).reset_index(drop=True)
        top = ', '.join(f'{r.feature} {r.lgbm_gain_pct:.1f}%' for r in s.head(6).itertuples())
        print(f'  {t}: top: {top}')
        for f in ('MF_850', 'MF_700', 'cape_max', 'w_oro_850', 'q850', 'r850', 'q700', 'r700'):
            r = s[s.feature == f].iloc[0]
            print(f'      {f:10} rank {int(s.index[s.feature == f][0]) + 1:2d}/{len(s)}  gain {r.lgbm_gain_pct:5.2f}%  splits {r.lgbm_splits:5d}  catboost {r.catboost_pct:5.2f}%')

    meta = json.loads((MODELS / 'feature_metadata.json').read_text()) if (MODELS / 'feature_metadata.json').exists() else {}
    out = dict(created=time.strftime('%Y-%m-%dT%H:%M:%S'), version=2, features=V2, v1_features=V1, upper_air_features=FT.UPPER_COLS, iterations=refit,
               rows=len(df), stations=int(df.station_id.nunique()), period=[str(df.date.min().date()), str(df.date.max().date())],
               folds=list(folds), held_out_stations=sorted(held), valid_years=VALID_YEARS, patience=PATIENCE, wet_day_mm=WET_MM,
               data_license=meta.get('data_license', 'CC BY 4.0 (Copernicus ERA5, ERA5-Land)'),
               training_fetch_channel='ERA5-Land via GEE non-commercial; ERA5 upper air via Copernicus CDS (swap GEE to CDS before commercial retrain)',
               runtime_inference_commercial_safe=True, metrics=m.to_dict('records'),
               files={'tmax': ['v2_tmax_lgbm.txt', 'v2_tmax_catboost.cbm'], 'tmin': ['v2_tmin_lgbm.txt', 'v2_tmin_catboost.cbm'],
                      'rain_occurrence': ['v2_rain_occurrence_lgbm.txt', 'v2_rain_occurrence_catboost.cbm'],
                      'rain_amount': ['v2_rain_amount_lgbm.txt', 'v2_rain_amount_catboost.cbm (predict with prediction_type="Exponent")']},
               note='The forecast step (2_apply_1km_forecast.py) still uses the v1 models: v2 needs ECMWF q and r at 850 and 700 hPa and CAPE in the sync script.')
    (MODELS / 'feature_metadata_v2.json').write_text(json.dumps(forecast1km.json_safe(out), indent=2, default=str, allow_nan=False))
    log(f'done in {(time.time() - t0) / 60:.1f} min; models and metadata in {MODELS}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
