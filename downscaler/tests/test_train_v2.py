"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'downscaler'))
import train_downscaler_v2 as TR  # noqa: E402


def frame():
    """Ten northern mountain stations, six plains stations, 2010 to 2022 (a day in each year)."""
    rows = []
    for i in range(16):
        north = i < 10
        for y in range(2010, 2023):
            rows.append(dict(station_id=f's{i}', date=pd.Timestamp(y, 7, 1), lat=35.5 if north else 31.0, station_elev=2500.0 if north else 200.0))
    return pd.DataFrame(rows)


class Folds(unittest.TestCase):
    def test_fold_definitions(self):
        df = frame()
        folds, held = TR.make_folds(df)
        self.assertEqual(set(folds), {'year 2010', 'year 2022', TR.SPATIAL_FOLD})
        self.assertEqual(int(folds['year 2010'].sum()), 16)
        self.assertEqual(len(held), 2)                                             # 20% of 10 northern mountain stations
        self.assertTrue(all(int(s[1:]) < 10 for s in held))                        # only mountain stations are held out
        self.assertEqual(int(folds[TR.SPATIAL_FOLD].sum()), 2 * 13)                # all years of each held-out station
        self.assertEqual(held, TR.make_folds(df)[1])                               # reproducible

    def test_no_leakage_between_train_validation_and_test(self):
        df = frame()
        folds, held = TR.make_folds(df)
        for name, test_mask in folds.items():
            train, val, test = TR.split_fold(df, test_mask)
            self.assertFalse((train & test).any() or (val & test).any() or (train & val).any(), name)
            self.assertEqual(int((train | val | test).sum()), len(df))
            self.assertTrue(set(df.date[val].dt.year) <= set(TR.VALID_YEARS))
            self.assertTrue(set(df.date[train].dt.year).isdisjoint(TR.VALID_YEARS))
        train, val, test = TR.split_fold(df, folds['year 2022'])
        self.assertNotIn(2022, set(df.date[train | val].dt.year))                   # a held-out year is out of training for every station
        train, val, test = TR.split_fold(df, folds[TR.SPATIAL_FOLD])
        self.assertTrue(held.isdisjoint(set(df.station_id[train | val])))           # a held-out station is out of training in every year


class Scores(unittest.TestCase):
    def test_event_scores(self):
        obs = np.array([1, 1, 1, 0, 0, 0, 1, 0], bool)
        pred = np.array([1, 1, 0, 1, 0, 0, 0, 0], bool)
        s = TR.event_scores(obs, pred)
        self.assertEqual((s['hits'], s['misses'], s['false_alarms']), (2, 2, 1))
        self.assertAlmostEqual(s['pod'], 0.5); self.assertAlmostEqual(s['far'], 1 / 3); self.assertAlmostEqual(s['csi'], 0.4)
        self.assertEqual(TR.event_scores(np.zeros(4, bool), np.zeros(4, bool))['csi'], 0.0)     # no events at all: no division by zero

    def test_rmse(self):
        self.assertAlmostEqual(TR.rmse([0, 0], [3, 4]), np.sqrt(12.5))

    def test_evaluate_rain_events(self):
        d = pd.DataFrame(dict(tmax=[20.0, 21.0], tmin=[10.0, 11.0], era_tmax=[19.0, 22.0], era_tmin=[10.0, 10.0], rain=[0.0, 12.0], era_rain_window=[0.5, 2.0]))
        pred = dict(tmax=np.array([20.0, 21.0]), tmin=np.array([10.0, 11.0]), p_wet=np.array([0.1, 0.9]), amount=np.array([3.0, 11.0]), rain=np.array([0.3, 9.9]))
        rows = TR.evaluate(d, pred, 'f', 'v2 features', {'all': np.ones(2, bool)})
        r = {x['target']: x for x in rows}
        self.assertAlmostEqual(r['tmax']['rmse'], 0.0)
        self.assertEqual(r['rain']['csi_1mm'], 1.0)                                  # the wet day found, the dry day left alone
        self.assertEqual(r['rain']['csi_10mm'], 1.0)                                 # P(wet) 0.9 and amount 11 mm >= 10
        raw = {x['target']: x for x in TR.evaluate(d, None, 'f', 'raw ERA5-Land', {'all': np.ones(2, bool)})}
        self.assertAlmostEqual(raw['tmax']['rmse'], 1.0)
        self.assertEqual(raw['rain']['csi_10mm'], 0.0)                              # ERA5-Land's 2 mm misses the 12 mm day


class Models(unittest.TestCase):
    def test_predictor_learns_a_signal_and_saves_importance(self):
        rng = np.random.default_rng(0)
        n = 4000
        df = pd.DataFrame({c: rng.normal(size=n) for c in ('f1', 'f2', 'noise')})
        df['date'] = pd.Timestamp('2012-01-01') + pd.to_timedelta(rng.integers(0, 3000, n), unit='D')
        df['era_tmax'] = rng.normal(20, 5, n); df['era_tmin'] = df.era_tmax - 8
        df['tmax'] = df.era_tmax + 3 * df.f1 + rng.normal(0, .3, n); df['tmin'] = df.era_tmin - 2 * df.f2 + rng.normal(0, .3, n)
        wet = rng.random(n) < 1 / (1 + np.exp(-2 * df.f1))
        df['rain'] = np.where(wet, rng.gamma(2.0, 3.0, n) + 1, 0.0); df['era_rain_window'] = df.rain * 0.5
        feats = ['f1', 'f2', 'noise']
        yrs = df.date.dt.year
        train, val = (~yrs.isin(TR.VALID_YEARS)).values, yrs.isin(TR.VALID_YEARS).values
        p = TR.Predictor(feats).fit(df, train, val, max_rounds=60)
        out = p.predict(df)
        self.assertLess(TR.rmse(df.tmax, out['tmax']), TR.rmse(df.tmax, df.era_tmax) * 0.5)
        self.assertLess(TR.rmse(df.tmin, out['tmin']), TR.rmse(df.tmin, df.era_tmin) * 0.5)
        self.assertGreater(np.corrcoef(out['p_wet'], wet)[0, 1], 0.3)
        imp = TR.importance_table(p)
        top = imp[imp.model == 'tmax'].sort_values('lgbm_gain_pct', ascending=False).feature.iloc[0]
        self.assertEqual(top, 'f1')                                                   # the signal is the feature that splits the trees
        self.assertGreater(int(imp[(imp.model == 'tmax') & (imp.feature == 'f1')].lgbm_splits.iloc[0]), 0)


class DecoupledTargets(unittest.TestCase):
    def test_with_topo_gives_each_temperature_target_its_own_set(self):
        import features as FT
        d = FT.with_topo(['a', 'b'])
        self.assertEqual(set(d), {'tmax', 'tmin', 'occ', 'amt'})
        self.assertEqual(d['occ'], ['a', 'b']); self.assertEqual(d['amt'], ['a', 'b'])             # rain keeps the base list
        self.assertEqual(d['tmax'], ['a', 'b'] + FT.TOPO_BY_TARGET['tmax'])
        self.assertEqual(d['tmin'], ['a', 'b'] + FT.TOPO_BY_TARGET['tmin'])
        self.assertIn('pot_rad_ratio', d['tmax']); self.assertNotIn('pot_rad_ratio', d['tmin'])      # the sun on the slope is a daytime predictor
        self.assertIn('valley_depth_25', d['tmin']); self.assertNotIn('valley_depth_25', d['tmax'])  # cold-air pooling is a night-time one
        self.assertTrue(set(FT.TOPO_BY_TARGET['tmax'] + FT.TOPO_BY_TARGET['tmin']) <= set(FT.TOPO_COLS))

    def test_predictor_uses_only_the_columns_of_each_model(self):
        rng = np.random.default_rng(1)
        n = 3000
        df = pd.DataFrame({c: rng.normal(size=n) for c in ('hot', 'cold', 'wetter')})
        df['date'] = pd.Timestamp('2012-01-01') + pd.to_timedelta(rng.integers(0, 3000, n), unit='D')
        df['era_tmax'] = rng.normal(20, 5, n); df['era_tmin'] = df.era_tmax - 8
        df['tmax'] = df.era_tmax + 3 * df.hot + rng.normal(0, .3, n); df['tmin'] = df.era_tmin - 2 * df.cold + rng.normal(0, .3, n)
        wet = rng.random(n) < 1 / (1 + np.exp(-2 * df.wetter))
        df['rain'] = np.where(wet, rng.gamma(2.0, 3.0, n) + 1, 0.0)
        by = dict(tmax=['hot'], tmin=['cold'], occ=['wetter'], amt=['wetter'])
        yrs = df.date.dt.year
        p = TR.Predictor(by).fit(df, (~yrs.isin(TR.VALID_YEARS)).values, yrs.isin(TR.VALID_YEARS).values, max_rounds=60)
        self.assertEqual(sorted(p.feats), ['cold', 'hot', 'wetter'])
        out = p.predict(df[['hot', 'cold', 'wetter', 'era_tmax', 'era_tmin']])                       # no other column is needed
        self.assertLess(TR.rmse(df.tmax, out['tmax']), TR.rmse(df.tmax, df.era_tmax) * 0.5)
        self.assertLess(TR.rmse(df.tmin, out['tmin']), TR.rmse(df.tmin, df.era_tmin) * 0.5)
        imp = TR.importance_table(p)
        self.assertEqual(list(imp[imp.model == 'tmax'].feature), ['hot']); self.assertEqual(list(imp[imp.model == 'tmin'].feature), ['cold'])
        self.assertEqual(list(imp[imp.model == 'occ'].feature), ['wetter'])


class HeldStations(unittest.TestCase):
    def test_named_stations_form_one_more_fold(self):
        df = frame()
        df['station_name'] = np.where(df.station_id.isin(['s11', 's12']), 'Murree (WeatherWalay)', 'Station ' + df.station_id)
        df.loc[df.station_id == 's3', 'station_name'] = 'Murree'
        folds, held = TR.make_folds(df, hold=['Murree'])
        name = 'held-out stations: Murree'
        self.assertIn(name, folds)
        self.assertEqual(int(folds[name].sum()), 3 * 13)                                              # all years of s3, s11 and s12
        self.assertEqual(set(df.station_id[folds[name]]), {'s3', 's11', 's12'})
        self.assertEqual(set(TR.make_folds(df)[0]), {'year 2010', 'year 2022', TR.SPATIAL_FOLD})      # no hold, no extra fold
        self.assertEqual(set(TR.make_folds(df, hold=['Nowhere'])[0]), {'year 2010', 'year 2022', TR.SPATIAL_FOLD})
        train, val, test = TR.split_fold(df, folds[name])
        self.assertFalse(set(df.station_id[train | val]) & {'s3', 's11', 's12'})                       # held-out stations are out of training entirely

    def test_station_errors_are_estimate_minus_observation(self):
        d = pd.DataFrame(dict(station_name=['Murree', 'Murree', 'Murree', 'Kakul'], tmax=[20.0, 22.0, np.nan, 25.0], tmin=[5.0, 6.0, 7.0, 8.0]))
        pred = dict(tmax=np.array([23.0, 23.0, 99.0, 24.0]), tmin=np.array([6.0, 8.0, 7.0, 8.0]))
        rows = {(r['station'], r['target']): r for r in TR.station_errors(d, pred, 'v')}
        m = rows[('Murree', 'tmax')]                                                                  # errors +3 and +1 (the missing observation is skipped)
        self.assertEqual(m['n'], 2); self.assertAlmostEqual(m['bias'], 2.0); self.assertAlmostEqual(m['rmse'], math.sqrt((9 + 1) / 2))
        m = rows[('Murree', 'tmin')]                                                                  # errors +1, +2, 0
        self.assertEqual(m['n'], 3); self.assertAlmostEqual(m['bias'], 1.0); self.assertAlmostEqual(m['rmse'], math.sqrt(5 / 3))
        self.assertAlmostEqual(rows[('Kakul', 'tmax')]['bias'], -1.0)
        self.assertEqual(rows[('Kakul', 'tmin')]['rmse'], 0.0)


if __name__ == '__main__':
    unittest.main()
