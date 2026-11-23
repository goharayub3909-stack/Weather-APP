"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests"""
import datetime as dt
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import forecast1km as F  # noqa: E402
import terrain as T  # noqa: E402

UTC = dt.timezone.utc


class NightBias(unittest.TestCase):
    def test_position_between_the_daily_minimum_and_maximum(self):
        np.testing.assert_allclose(F.diurnal_position(np.array([5.0, 10.0, 15.0, 2.0, 30.0]), 5.0, 15.0), [0.0, 0.5, 1.0, 0.0, 1.0])     # clipped at both ends
        self.assertAlmostEqual(float(F.diurnal_position(10.1, 10.0, 10.0)), 0.1 / 0.5)                                                  # a flat day uses min_range, never divides by zero
        # diurnal() is unchanged by the refactor: at the ECMWF extremes it returns the 1 km extremes
        self.assertAlmostEqual(float(F.diurnal(5.0, 5.0, 15.0, 3.0, 17.0)), 3.0); self.assertAlmostEqual(float(F.diurnal(15.0, 5.0, 15.0, 3.0, 17.0)), 17.0)

    def test_night_limited_bias_never_cools_but_keeps_the_warming(self):
        corr = np.array([-1.7, -0.2, 0.0, 3.5, 9.2, 1.2])                      # a live bias curve: negative on the plains, positive in the mountains
        np.testing.assert_allclose(F.night_limited(corr), [-1.7, -0.2, 0.0, 0.0, 0.0, 0.0])

    def test_step_bias_is_the_whole_bias_by_day_the_limited_bias_at_night_and_a_blend_between(self):
        corr = np.array([-1.7, 0.0, 3.5, 9.2])
        np.testing.assert_allclose(F.step_bias(corr, np.ones(4)), corr)                                  # the warm end (and so the daily maximum): exactly the old behaviour
        np.testing.assert_allclose(F.step_bias(corr, np.zeros(4)), [-1.7, 0.0, 0.0, 0.0])                # the cold end: the bias may only warm
        np.testing.assert_allclose(F.step_bias(corr, np.full(4, 0.5)), [-1.7, 0.0, 1.75, 4.6])           # half way: half of the whole bias where it would cool
        for s in (0.0, 0.3, 1.0):                                                                          # plains and foothills: a negative bias is identical at every hour
            self.assertAlmostEqual(float(F.step_bias(np.array([-1.7]), np.array([s]))[0]), -1.7)

    def test_the_warm_weight_ramps_between_the_window_ends(self):
        s = np.array([0.0, 0.1, 0.35, 0.5, 1.0])
        np.testing.assert_allclose(F.warm_weight(s, (0.0, 1.0)), s)                                       # the default window: linear in the diurnal position
        np.testing.assert_allclose(F.warm_weight(s, (0.0, 0.35)), [0.0, 0.1 / 0.35, 1.0, 1.0, 1.0])       # a narrow window: only the coldest hours are limited
        np.testing.assert_allclose(F.warm_weight(s, (0.2, 0.4)), [0.0, 0.0, 0.75, 1.0, 1.0])
        corr = np.array([8.0]); np.testing.assert_allclose(F.step_bias(corr, np.array([0.2]), (0.0, 0.35)), corr * 0.2 / 0.35)
        np.testing.assert_allclose(F.step_bias(np.array([-1.5]), np.array([0.2]), (0.0, 0.35)), [-1.5])    # a negative bias is untouched by any window

    def test_the_mountain_minimum_is_no_longer_cooled_by_the_daytime_bias(self):
        # a cell at 3,000 m: the daytime bias removes 9.2 degC; before, the minimum lost it too, now it keeps the model's own minimum
        corr = np.array([9.2]); tmin_model = 2.0
        self.assertAlmostEqual(tmin_model - float(F.night_limited(corr)[0]), 2.0)
        self.assertAlmostEqual(tmin_model - float(corr[0]), -7.2)                                          # the old result
        # the maximum is unchanged
        self.assertAlmostEqual(18.0 - float(corr[0]), 8.8)


class Packing(unittest.TestCase):
    def test_temperature_and_rain_round_trip(self):
        t = np.array([[-60.0, -12.34, 0.0, 25.06, 54.9, np.nan]])
        r = np.array([[0.0, 0.04, 0.06, 3.21, 819.1, 2.0]])
        tt, rr = F.unpack_temp_rain(F.pack_temp_rain(t, r))
        np.testing.assert_allclose(tt[0, :5], [-60.0, -12.3, 0.0, 25.1, 54.9], atol=1e-9)
        self.assertTrue(np.isnan(tt[0, 5]))
        np.testing.assert_allclose(rr[0], [0.0, 0.0, 0.1, 3.2, 819.1, 2.0], atol=1e-9)
        self.assertEqual(F.pack_temp_rain(t, r).dtype, np.uint8)

    def test_wind_round_trip(self):
        u = np.array([0.0, -3.21, 40.9, -50.0, np.nan]); v = np.array([1.0, 7.77, -40.9, 0.0, 2.0])
        uu, vv = F.unpack_wind(F.pack_wind(u, v))
        np.testing.assert_allclose(uu[:3], u[:3], atol=0.0101)                  # 0.02 m/s steps
        self.assertAlmostEqual(float(uu[3]), -40.96, places=6)                 # clipped to the lowest code
        np.testing.assert_allclose(vv[:4], v[:4], atol=0.0101)
        self.assertTrue(np.isnan(uu[4]) and np.isnan(vv[4]))


class Grids(unittest.TestCase):
    def test_bilinear_is_exact_for_a_plane(self):
        lat = F.NODE_S + F.NODE_D * np.arange(F.NODE_NY)
        lon = F.NODE_W + F.NODE_D * np.arange(F.NODE_NX)
        plane = 2 * lat[:, None] + 3 * lon[None, :]
        out = F.to_1km(plane)
        exp = 2 * T.lat_centres()[:, None] + 3 * T.lon_centres()[None, :]
        inside = (T.lat_centres() < 37.99)[:, None] & np.ones((1, T.NX), bool)
        np.testing.assert_allclose(out[inside], exp[inside], atol=1e-3)

    def test_node_cells(self):
        nj, ni = F.node_index()
        # the cell centred 37.995 N, 60.005 E belongs to the node at 38.0 N, 60.0 E (row 150, column 0)
        self.assertEqual((nj[0], ni[0]), (150, 0))
        self.assertEqual(int((ni == 5).sum()), 10)                             # 10 x 1 km columns per node (59.95..60.05 holds 5 at the edge)
        a = np.zeros((T.NY, T.NX)); a[:, ni == 5] = 7.0
        self.assertAlmostEqual(float(F.block_mean(a, nj, ni)[100, 5]), 7.0)

    def test_rain_is_conserved_per_cell(self):
        nj, ni = F.node_index()
        rng = np.random.default_rng(0)
        nodes = np.maximum(rng.normal(1, 2, (F.NODE_NY, F.NODE_NX)), 0)
        w = rng.uniform(0.1, 5, (T.NY, T.NX))
        out = F.conserve_rain(F.to_1km(nodes), w, nodes, nj, ni)
        m = F.block_mean(out.astype(float), nj, ni)
        np.testing.assert_allclose(m, nodes, rtol=1e-4, atol=1e-5)
        self.assertGreaterEqual(float(out.min()), 0.0)


class Days(unittest.TestCase):
    def test_daily_windows(self):
        times = [dt.datetime(2026, 11, 16, 0, tzinfo=UTC) + dt.timedelta(hours=3 * k) for k in range(25)]
        n = lambda v: np.full((F.NODE_NY, F.NODE_NX), float(v))
        f = dict(mx2t3=[n(280 + k % 8) for k in range(25)], mn2t3=[n(270 - k % 8) for k in range(25)],
                 tp=[n(0.001 * k) for k in range(25)], ssrd=[n(1e6 * k) for k in range(25)], **{'10u': [n(2)] * 25, '10v': [n(-1)] * 25})
        days = F.daily_from_steps(times, f)
        self.assertEqual([d['date'] for d in days], [dt.date(2026, 11, 16), dt.date(2026, 11, 17), dt.date(2026, 11, 18)])
        self.assertTrue(all(d['full'] and d['windows'] == 8 for d in days))
        self.assertAlmostEqual(float(days[0]['tmax'][0, 0]), 287 - 273.15)     # windows k = 1..8: k % 8 up to 7
        self.assertAlmostEqual(float(days[0]['precip'][0, 0]), 8.0)              # 8 windows x 1 mm
        self.assertAlmostEqual(float(days[0]['ssrd'][0, 0]), 8.0)
        self.assertEqual(F.anchor_day(days, dt.date(2026, 11, 19)), 2)

    def test_partial_day_is_scaled_and_borrows_anchors(self):
        times = [dt.datetime(2026, 11, 15, 12, tzinfo=UTC) + dt.timedelta(hours=3 * k) for k in range(25)]
        n = lambda v: np.full((F.NODE_NY, F.NODE_NX), float(v))
        f = dict(mx2t3=[n(290)] * 25, mn2t3=[n(280)] * 25, tp=[n(0.001 * k) for k in range(25)], ssrd=[n(0)] * 25,
                 **{'10u': [n(0)] * 25, '10v': [n(0)] * 25})
        days = F.daily_from_steps(times, f)
        self.assertEqual([d['windows'] for d in days], [4, 8, 8, 4])
        self.assertFalse(days[0]['full'])
        self.assertAlmostEqual(float(days[0]['precip'][0, 0]), 8.0)              # 4 mm in 12 h, scaled to 24 h
        self.assertEqual(F.anchor_day(days, days[0]['date']), 1)
        self.assertEqual(F.anchor_day(days, days[3]['date']), 2)

    def test_diurnal_hits_the_1km_extremes(self):
        tmin_ec, tmax_ec, tmin_1k, tmax_1k = 5.0, 15.0, -2.0, 9.0
        self.assertAlmostEqual(F.diurnal(5.0, tmin_ec, tmax_ec, tmin_1k, tmax_1k), -2.0)
        self.assertAlmostEqual(F.diurnal(15.0, tmin_ec, tmax_ec, tmin_1k, tmax_1k), 9.0)
        self.assertAlmostEqual(F.diurnal(10.0, tmin_ec, tmax_ec, tmin_1k, tmax_1k), 3.5)   # half way
        self.assertAlmostEqual(F.diurnal(20.0, tmin_ec, tmax_ec, tmin_1k, tmax_1k), 14.0)  # above the max: shifted by the max correction


class Analysis(unittest.TestCase):
    def test_barnes_single_station(self):
        z = np.zeros((T.NY, T.NX))
        inc = F.barnes([31.55], [74.34], [0.0], [2.0], z, 15.0)
        j, i = T.cell_of(31.55, 74.34)
        self.assertAlmostEqual(float(inc[j, i]), 2.0 * 1 / (1 + F.ANALYSIS['kappa']), delta=0.05)
        self.assertAlmostEqual(float(inc[j, i + 60]), 0.0, places=6)          # 57 km east: beyond 2.5 length scales
        self.assertLess(float(inc[j + 15, i]), float(inc[j + 5, i]))

    def test_height_term(self):
        z = np.zeros((T.NY, T.NX)); j, i = T.cell_of(35.3, 75.6)
        z[j, i + 3] = 900.0                                                    # a cell 900 m above the station
        inc = F.barnes([35.3], [75.6], [0.0], [3.0], z, 15.0, height_m=300.0)
        self.assertLess(float(inc[j, i + 3]), 0.01 * float(inc[j, i + 2]))

    def test_time_weight(self):
        self.assertEqual(F.time_weight(0), 1.0)
        self.assertEqual(F.time_weight(-6), 0.5)
        self.assertEqual(F.time_weight(12), 0.0)


class LiveCorrection(unittest.TestCase):
    def test_ml_weight_fades_outside_the_training_range(self):
        r = dict(elevation=[0, 3288], delta_z=[-1058, 433])
        w = F.ml_weight(np.array([1000, 3288, 3638, 3988, 5000, 1000, 1000]), np.array([0, 0, 0, 0, 0, 583, -1400]), r)
        np.testing.assert_allclose(w, [1, 1, 0.5, 0, 0, 0.5, 0], atol=1e-6)
        self.assertEqual(float(F.ml_weight(np.array([np.nan]), np.array([0.0]), r)[0]), 0.0)

    def test_bias_curve_recovers_a_height_trend_and_shrinks_thin_data(self):
        rng = np.random.default_rng(1)
        e = rng.uniform(0, 4500, 400); r = np.interp(e, [0, 1000, 4000], [0, 0, 12]) + rng.normal(0, 1.5, 400)
        c = F.fit_elevation_bias(e, r)
        got = F.elevation_bias(c, np.array([500, 2500, 4000]))
        np.testing.assert_allclose(got, [0, 6, 12], atol=1.2)
        one = F.fit_elevation_bias([3000], [9.0])
        self.assertLess(max(abs(v) for v in one['values']), 1.5)                 # a single station moves the curve little
        self.assertEqual(F.fit_elevation_bias([1000, 2000], [100, 3])['n'], 1)    # gross residual rejected
        self.assertAlmostEqual(float(F.elevation_bias(c, np.array([9000]))[0]), c['values'][-1], places=4)   # flat beyond the last knot


class MassConsistent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lat = T.lat_centres()[:, None]; lon = T.lon_centres()[None, :]
        # a 2000 m ridge running north-south near 70 E, unresolved by the coarse terrain (flat)
        cls.z = (2000 * np.exp(-((lon - 70) / 0.05) ** 2) * np.ones_like(lat)).astype(np.float32)
        cls.m = F.MassConsistentWind(cls.z, np.zeros_like(cls.z))

    def test_flat_terrain_changes_nothing(self):
        m = F.MassConsistentWind(np.zeros((T.NY, T.NX), np.float32), np.zeros((T.NY, T.NX), np.float32))
        u, v = m.adjust(np.full((T.NY, T.NX), 4.0), np.full((T.NY, T.NX), -2.0))
        np.testing.assert_allclose(u, 4.0, atol=1e-4); np.testing.assert_allclose(v, -2.0, atol=1e-4)

    def test_mass_is_consistent_and_flow_speeds_over_the_ridge(self):
        u0 = np.full(self.z.shape, 5.0); v0 = np.zeros_like(u0)
        ux, vy = self.m.adjust(u0, v0, return_faces=True)
        ux0, _ = self.m.faces(u0); _, vy0 = self.m.faces(v0)
        target = self.m.divergence(self.m.hcx * ux0, self.m.hcy * vy0)
        before = np.abs(self.m.divergence(self.m.hx * ux0, self.m.hy * vy0) - target).mean()
        after = np.abs(self.m.divergence(self.m.hx * ux, self.m.hy * vy) - target).mean()
        self.assertLess(after, 1e-4 * before)
        u, v = self.m.adjust(u0, v0)
        j = 750; i = T.cell_of(float(T.lat_centres()[j]), 70.0)[1]
        self.assertGreater(float(u[j, i]), 6.0)                                # a 2-D ridge cannot be passed round: the flow speeds up over it
        self.assertLessEqual(float(np.hypot(u, v).max()), F.WIND['max_speedup'] * 5 + 1e-3)


class RegimeBias(unittest.TestCase):
    def test_classification(self):
        cases = [(10, 1, 1), (10, 4, 0), (50, 1, 0), (10, 8, 2), (90, 7, 2), (10, 7.0, 2), (29.9, 2.99, 1), (30, 2, 0), (10, 3.0, 0), (np.nan, 2, 0), (10, np.nan, 0)]
        for cloud, wind, want in cases:
            self.assertEqual(int(F.classify_regime(cloud, wind)), want, f'cloud {cloud}, wind {wind}')
        got = F.classify_regime(np.array([[10, 90], [10, 10]]), np.array([[1, 1], [8, 4]]))
        np.testing.assert_array_equal(got, [[1, 0], [2, 0]])
        self.assertEqual(got.dtype, np.int8)

    def history(self, n_inv=300, n_wind=300, analyses=5, seed=0):
        rng = np.random.default_rng(seed)
        z = rng.uniform(0, 3500, n_inv + n_wind + 100)
        regime = np.array([1] * n_inv + [2] * n_wind + [np.nan] * 100, float)           # the last 100 residuals predate regimes
        resid = np.where(regime == 1, 4.0 * z / 3000, np.where(regime == 2, 0.5, 1.0)) + rng.normal(0, 0.2, len(z))
        return z, resid, regime, rng.integers(0, analyses, len(z))

    def test_each_regime_gets_its_own_curve_when_there_is_history(self):
        z, resid, regime, an = self.history()
        fit = F.fit_regime_bias(z, resid, regime, analysis=an)
        self.assertEqual(set(fit['curves']), {1, 2})
        self.assertEqual(fit['counts']['inversion'], dict(readings=300, analyses=5, curve=True))
        inv, wind, pooled = (F.elevation_bias(c, np.array([3000.0]))[0] for c in (fit['curves'][1], fit['curves'][2], fit['pooled']))
        self.assertAlmostEqual(float(inv), 4.0, delta=0.4)                               # clear calm: the cold-valley bias grows with height
        self.assertAlmostEqual(float(wind), 0.5, delta=0.3)                              # windy: nearly none
        self.assertTrue(wind < pooled < inv)                                             # the pooled curve sits between
        field = F.regime_bias(fit, np.full(4, 3000.0), np.array([1, 2, 0, 1], np.int8))
        np.testing.assert_allclose(field, [inv, wind, pooled, inv], atol=1e-5)           # each cell takes its regime's curve, others the pooled one
        self.assertEqual(field.dtype, np.float32)

    def test_a_regime_without_enough_history_uses_the_pooled_curve(self):
        z, resid, regime, an = self.history(n_inv=40)                                    # 40 readings: below the minimum of 150
        fit = F.fit_regime_bias(z, resid, regime, analysis=an)
        self.assertNotIn(1, fit['curves']); self.assertIn(2, fit['curves'])
        self.assertEqual(fit['counts']['inversion'], dict(readings=40, analyses=5, curve=False))
        field = F.regime_bias(fit, np.array([3000.0]), np.array([1], np.int8))
        self.assertAlmostEqual(float(field[0]), float(F.elevation_bias(fit['pooled'], np.array([3000.0]))[0]), places=5)
        z, resid, regime, an = self.history(analyses=2)                                  # plenty of readings but only 2 analysis times: below 3
        fit = F.fit_regime_bias(z, resid, regime, analysis=an)
        self.assertEqual(fit['curves'], {}); self.assertEqual(fit['counts']['windy']['analyses'], 2)

    def test_old_residuals_without_a_regime_count_for_the_pooled_curve_only(self):
        z, resid, regime, an = self.history()
        no_regime = np.full_like(regime, np.nan)
        fit = F.fit_regime_bias(z, resid, no_regime, analysis=an)
        self.assertEqual(fit['curves'], {}); self.assertEqual(fit['counts']['inversion']['readings'], 0)
        plain = F.fit_elevation_bias(z, resid)
        np.testing.assert_allclose(fit['pooled']['values'], plain['values'])             # the pooled curve is the existing one, unchanged
        np.testing.assert_allclose(F.regime_bias(fit, np.array([500.0, 2500.0]), np.array([1, 2], np.int8)), F.elevation_bias(plain, np.array([500.0, 2500.0])), atol=1e-6)

    def test_recency_weights_and_gross_residuals_are_honoured(self):
        z, resid, regime, an = self.history()
        resid = resid.copy(); resid[0] = 99.0; regime[0] = 1                             # a gross residual is rejected, as in the pooled fit
        w = np.where(regime == 2, 0.0, 1.0)                                              # zero weight for the windy residuals
        fit = F.fit_regime_bias(z, resid, regime, weights=w, analysis=an)
        self.assertLess(abs(fit['pooled']['values'][-1]), 6.0)
        self.assertEqual(fit['counts']['inversion']['readings'], 299)


if __name__ == '__main__':
    unittest.main()
