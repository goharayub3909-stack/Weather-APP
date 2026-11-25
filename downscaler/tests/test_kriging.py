"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests
Expected values are worked out by hand from the kriging equations and the exponential variogram."""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kriging as K  # noqa: E402

VG = dict(nugget=0.0, psill=4.0, range_km=300.0)


class Variogram(unittest.TestCase):
    def test_exponential_model(self):
        self.assertEqual(float(K.model(0.0, 1.0, 4.0, 300.0)), 0.0)                                    # gamma(0) = 0 even with a nugget
        self.assertAlmostEqual(float(K.model(300.0, 1.0, 4.0, 300.0)), 1.0 + 4.0 * (1 - math.exp(-3)), places=12)
        self.assertAlmostEqual(float(K.model(300.0, 0.0, 1.0, 300.0)), 0.9502129, places=6)            # about 95 % of the sill at the range
        self.assertAlmostEqual(float(K.model(1e9, 1.0, 4.0, 300.0)), 5.0, places=9)                    # nugget + partial sill far away
        self.assertAlmostEqual(float(K.model(1e-9, 1.0, 4.0, 300.0)), 1.0, places=6)                   # the nugget jump right next to a point

    def test_distance(self):
        self.assertAlmostEqual(float(K.distance_km(0, 0, 1, 0)), 111.195, places=2)                    # one degree of latitude
        self.assertAlmostEqual(float(K.distance_km(35, 70, 35, 71)), 111.195 * math.cos(math.radians(35)), delta=0.1)
        d = K.pair_distances([30, 31, 32], [70, 70, 70])
        self.assertAlmostEqual(float(d[0, 2]), 2 * 111.195, places=1); self.assertEqual(float(d[1, 1]), 0.0); self.assertTrue(np.allclose(d, d.T))

    def test_empirical_variogram_of_a_ramp(self):
        # values 0, 1, 2, 3 at 100 km spacing along a meridian: pairs one step apart have semivariance 0.5, two steps 2, three steps 4.5
        lat = np.arange(4) * (100 / 111.195); lon = np.zeros(4)
        lags, gam, cnt = K.empirical_variogram(K.pair_distances(lat, lon), [0, 1, 2, 3], [0, 150, 250, 350])
        np.testing.assert_allclose(lags, [100, 200, 300], rtol=1e-3)
        np.testing.assert_allclose(gam, [0.5, 2.0, 4.5], rtol=1e-3)
        np.testing.assert_array_equal(cnt, [3, 2, 1])

    def test_fit_recovers_the_parameters_of_a_noise_free_model(self):
        lags = np.linspace(10, 500, 25)
        truth = dict(nugget=0.5, psill=3.0, range_km=200.0)
        fit = K.fit_variogram(lags, K.model(lags, **truth), np.full(25, 40))
        for k, v in truth.items():
            self.assertAlmostEqual(fit[k], v, delta=0.05 * v + 0.02, msg=k)


class Kriging(unittest.TestCase):
    pts = dict(lat=np.array([30.0, 31.0, 32.0, 31.0]), lon=np.array([70.0, 71.0, 70.0, 69.0]))

    def test_weights_sum_to_one_so_a_constant_field_stays_constant(self):
        est, var = K.ordinary_kriging(self.pts['lat'], self.pts['lon'], [7.0] * 4, [30.5, 31.5], [70.2, 70.4], VG)
        np.testing.assert_allclose(est, 7.0, atol=1e-9)
        self.assertTrue(np.all(var >= 0))

    def test_exact_at_a_data_point_without_a_nugget(self):
        z = [1.0, 5.0, -2.0, 3.0]
        est, var = K.ordinary_kriging(self.pts['lat'], self.pts['lon'], z, self.pts['lat'], self.pts['lon'], VG)
        np.testing.assert_allclose(est, z, atol=1e-6)
        np.testing.assert_allclose(var, 0.0, atol=1e-6)

    def test_a_nugget_is_a_jump_next_to_a_data_point_not_at_it(self):
        z = [1.0, 5.0, -2.0, 3.0]
        # with gamma(0) = 0 kriging stays an exact interpolator at a sample, nugget or not ...
        est, _ = K.ordinary_kriging(self.pts['lat'], self.pts['lon'], z, self.pts['lat'], self.pts['lon'], dict(VG, nugget=2.0))
        np.testing.assert_allclose(est, z, atol=1e-6)
        # ... but 5 km away the nugget has already let go of the sample: the estimate is pulled much further toward the others
        near_lat, near_lon = [30.0 + 0.045], [70.0]
        smooth = K.ordinary_kriging(self.pts['lat'], self.pts['lon'], z, near_lat, near_lon, VG)[0][0]
        jumpy = K.ordinary_kriging(self.pts['lat'], self.pts['lon'], z, near_lat, near_lon, dict(VG, nugget=2.0))[0][0]
        self.assertLess(abs(smooth - z[0]), 0.2)                                                       # gamma(5 km) is only 0.2 of a sill of 4: the sample still dominates
        self.assertGreater(abs(jumpy - z[0]), 3 * abs(smooth - z[0]))                                   # a nugget of 2 is already a jump of 2 in gamma

    def test_two_points_equally_far_get_equal_weights(self):
        # known points 1 degree east and west of the target, same distance: each weighs 1/2, the estimate is the mean
        est, var = K.ordinary_kriging([35.0, 35.0], [69.0, 71.0], [2.0, 8.0], [35.0], [70.0], VG)
        self.assertAlmostEqual(float(est[0]), 5.0, places=9)
        # the system with weights 1/2: 0.5 gamma(2h) + mu = gamma(h), so mu = gamma(h) - gamma(2h) / 2 and the variance w . gamma0 + mu = 2 gamma(h) - gamma(2h) / 2
        h = float(K.distance_km(35, 70, 35, 71)); g1, g2 = float(K.model(h, 0, 4, 300)), float(K.model(float(K.distance_km(35, 69, 35, 71)), 0, 4, 300))   # the true distance between the two points
        self.assertAlmostEqual(float(var[0]), 2 * g1 - g2 / 2, places=9)
        self.assertGreater(float(var[0]), 0.0)

    def test_the_nearer_point_counts_more(self):
        est, _ = K.ordinary_kriging([35.0, 35.0], [69.0, 74.0], [0.0, 10.0], [35.0], [69.5], VG)
        self.assertLess(float(est[0]), 5.0)

    def test_a_smooth_field_is_interpolated_better_than_by_the_mean(self):
        rng = np.random.default_rng(3)
        lat = rng.uniform(30, 36, 60); lon = rng.uniform(68, 76, 60)
        field = lambda la, lo: 2.0 * np.sin(la / 2) + 1.5 * np.cos(lo / 3)                              # a field varying over a few hundred km
        z = field(lat, lon)
        vg = K.fit_variogram(*K.empirical_variogram(K.pair_distances(lat, lon), z, np.linspace(0, 900, 19)))
        loo = K.leave_one_out(lat, lon, z, vg)
        self.assertLess(float(np.sqrt(np.mean((loo - z) ** 2))), 0.5 * float(np.std(z)))                # far better than predicting the mean

    def test_leave_one_out_matches_dropping_the_point(self):
        z = np.array([1.0, 5.0, -2.0, 3.0])
        loo = K.leave_one_out(self.pts['lat'], self.pts['lon'], z, VG)
        keep = [0, 2, 3]
        direct = K.ordinary_kriging(self.pts['lat'][keep], self.pts['lon'][keep], z[keep], self.pts['lat'][1], self.pts['lon'][1], VG)[0][0]
        self.assertAlmostEqual(float(loo[1]), float(direct), places=12)


class LeaveOneStationOut(unittest.TestCase):
    def test_ols(self):
        x = np.arange(10.0)[:, None]
        fit, pred = K.ols_fit_predict(x, 3.0 + 2.0 * x[:, 0], np.array([[20.0]]))
        np.testing.assert_allclose(fit, 3.0 + 2.0 * x[:, 0], atol=1e-9); self.assertAlmostEqual(float(pred[0]), 43.0, places=9)

    def stations(self, seed, n=90, spatial=2.0, noise=0.15):
        rng = np.random.default_rng(seed)
        lat, lon = rng.uniform(30, 36, n), rng.uniform(68, 76, n)
        height = rng.uniform(0, 3000, n)
        smooth = spatial * np.sin(lat / 1.2) * np.cos(lon / 1.7)                                   # structure over a few hundred km that height cannot explain
        y = 0.002 * height + smooth + rng.normal(0, noise, n)
        return lat, lon, height, y

    def rmse(self, a, b):
        return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))

    def test_kriging_the_leftover_beats_height_alone_when_structure_remains(self):
        lat, lon, h, y = self.stations(1)
        p = K.loso_compare(lat, lon, h, y)
        self.assertEqual(set(p), set(K.METHODS))
        r = {m: self.rmse(p[m], y) for m in K.METHODS}
        self.assertLess(r['regression'], r['mean']); self.assertLess(r['mean'], r['zero'] + 5)
        self.assertLess(r['regression+kriging'], 0.7 * r['regression'])                            # the spatial structure is real: kriging the leftover helps a lot
        self.assertLess(r['regression+kriging'], r['kriging'])                                     # and using the height as well is better than kriging alone
        self.assertEqual(float(p['zero'][0]), 0.0)
        self.assertAlmostEqual(float(p['mean'][0]), float(np.mean(y[1:])), places=12)               # the mean never sees the station it predicts

    def test_kriging_adds_nothing_when_only_height_matters(self):
        rng = np.random.default_rng(5)
        n = 90
        lat, lon, h = rng.uniform(30, 36, n), rng.uniform(68, 76, n), rng.uniform(0, 3000, n)
        y = 0.002 * h + rng.normal(0, 0.5, n)                                                       # no spatial structure beyond height
        p = K.loso_compare(lat, lon, h, y)
        r = {m: self.rmse(p[m], y) for m in K.METHODS}
        self.assertLess(r['regression'], 0.6)                                                       # close to the noise floor of 0.5
        self.assertLess(r['regression+kriging'], r['regression'] * 1.25)                            # kriging must not make it much worse
        self.assertGreater(r['regression+kriging'], r['regression'] * 0.8)                          # nor much better: nothing left to find

    def test_degenerate_data_falls_back_to_the_mean(self):
        lat = np.linspace(30, 31, 6); lon = np.full(6, 70.0); y = np.full(6, 2.0)                   # no variation at all: no variogram to fit
        p = K.loso_compare(lat, lon, np.arange(6.0), y)
        np.testing.assert_allclose(p['kriging'], 2.0, atol=1e-9); np.testing.assert_allclose(p['regression+kriging'], 2.0, atol=1e-6)


if __name__ == '__main__':
    unittest.main()
