"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests
Numbers are worked by hand from the equations of Ding et al. (2014), J. Hydrol. 513, 154-163, as printed in the accepted manuscript."""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import phase as P  # noqa: E402


def p1p2(tw, rh, z_km):
    """Eq. 2 and 3: cumulative probability of snow, and of snow or sleet, at wet-bulb temperature tw."""
    t0, dt, ds = P.ding_parameters(rh, z_km)
    return 1 / (1 + np.exp((tw - t0 + dt) / ds)), 1 / (1 + np.exp((tw - t0 - dt) / ds))


class WetBulb(unittest.TestCase):
    def test_tetens(self):
        self.assertAlmostEqual(float(P.saturation_vapour_pressure(0.0)), 6.1078, places=6)                          # A.3 at 0 degC
        self.assertAlmostEqual(float(P.saturation_vapour_pressure(20.0)), 6.1078 * math.exp(17.27 * 20 / 257.3), places=9)
        self.assertAlmostEqual(float(P.saturation_vapour_pressure(20.0)), 23.38, places=2)
        # slope = esat * 17.27 * 237.3 / (T + 237.3)^2 = 23.382 * 0.061897
        self.assertAlmostEqual(float(P.saturation_slope(20.0)), 1.4474, places=4)
        h = 1e-5
        numeric = (P.saturation_vapour_pressure(5 + h) - P.saturation_vapour_pressure(5 - h)) / (2 * h)
        self.assertAlmostEqual(float(P.saturation_slope(5.0)), float(numeric), places=6)

    def test_relative_humidity(self):
        self.assertAlmostEqual(float(P.relative_humidity(10.0, 10.0)), 1.0, places=12)
        self.assertAlmostEqual(float(P.relative_humidity(5.0, 7.0)), 1.0, places=12)                              # dew point above air: saturation
        self.assertAlmostEqual(float(P.relative_humidity(20.0, 9.3)), 0.5, delta=0.01)
        self.assertTrue(np.isnan(P.relative_humidity(np.nan, 3.0)))

    def test_wet_bulb_equation_a2(self):
        # Ta 20 degC, RH 0.5, 1013.25 hPa: 20 - 23.382 * 0.5 / (0.000643 * 1013.25 + 1.4474) = 20 - 11.691 / 2.0990 = 14.430
        self.assertAlmostEqual(float(P.wet_bulb(20.0, 0.5, 1013.25)), 14.43, places=2)
        self.assertEqual(float(P.wet_bulb(10.0, 1.0, 900.0)), 10.0)                                               # saturated air: Tw = Ta
        self.assertLess(float(P.wet_bulb(5.0, 0.4, 700.0)), 5.0)
        t = np.array([2.0, 2.0]); rh = np.array([0.5, 0.5])
        low, high = P.wet_bulb(t, rh, np.array([1013.25, 600.0]))                                                  # less pressure, less cooling per unit of dryness
        self.assertLess(high, low)

    def test_icao_pressure(self):
        np.testing.assert_allclose(P.station_pressure([0, 1000, 3000, 5000]), [1013.25, 898.75, 701.09, 540.20], atol=0.02)


class DingScheme(unittest.TestCase):
    def test_parameters_eq_7_8_9(self):
        # RH 0.7, Z 0: T0 = -5.87 + 16.06 * 0.7 - 9.614 * 0.49 = 0.6611; dT = 0.215 - 0.0693 + 0.49882 = 0.6445; dS = 2.374 - 1.1438 = 1.2302
        t0, dt, ds = P.ding_parameters(0.7, 0.0)
        self.assertAlmostEqual(float(t0), 0.6611, places=4); self.assertAlmostEqual(float(dt), 0.6445, places=4); self.assertAlmostEqual(float(ds), 1.2302, places=4)
        # the same humidity at 2 km: T0 + (-0.1042 * 2 + 0.0885 * 4) = 0.6611 + 0.1456
        self.assertAlmostEqual(float(P.ding_parameters(0.7, 2.0)[0]), 0.8067, places=4)
        self.assertAlmostEqual(float(P.ding_parameters(1.0, 0.0)[0]), 0.576, places=9)                             # -5.87 + 16.06 - 9.614
        self.assertGreater(float(P.ding_parameters(0.7, 5.0)[0]), float(P.ding_parameters(0.7, 1.0)[0]))           # a higher threshold at height

    def test_single_threshold_below_78_percent_humidity(self):
        lo, hi = P.ding_thresholds(0.7, 0.0)
        self.assertEqual(float(lo), float(hi)); self.assertAlmostEqual(float(lo), 0.6611, places=4)                # Tmin = Tmax = T0: no sleet
        t0, dt, ds = P.ding_parameters(0.77, 0.0); self.assertLess(dt / ds, math.log(2))
        t0, dt, ds = P.ding_parameters(0.80, 0.0); self.assertGreater(dt / ds, math.log(2))
        lo, hi = P.ding_thresholds(0.80, 0.0); self.assertLess(float(lo), float(hi))                              # dual threshold above the crossover

    def test_dual_thresholds_eq_13_14(self):
        # RH 1, Z 0: T0 0.576, dT 1.134, dS 0.74, dT/dS 1.5324, ln[e^1.5324 - 2 e^-1.5324] = 1.4344: Tmin = 0.576 - 1.0615, Tmax = 2 * 0.576 - Tmin
        lo, hi = P.ding_thresholds(1.0, 0.0)
        self.assertAlmostEqual(float(lo), -0.4855, places=4); self.assertAlmostEqual(float(hi), 1.6375, places=4)

    def test_thresholds_satisfy_the_definitions_eq_11_12(self):
        for rh, z in ((1.0, 0.0), (0.9, 2.5), (0.85, 4.5), (0.8, 1.0), (0.95, 0.3)):
            lo, hi = P.ding_thresholds(rh, z)
            a1, a2 = p1p2(lo, rh, z)
            self.assertAlmostEqual(float(a1 - (a2 - a1)), 0.0, places=10, msg=f'F_snow = F_sleet at Tmin (RH {rh}, Z {z})')
            b1, b2 = p1p2(hi, rh, z)
            self.assertAlmostEqual(float((1 - b2) - (b2 - b1)), 0.0, places=10, msg=f'F_rain = F_sleet at Tmax (RH {rh}, Z {z})')

    def test_share_of_snow(self):
        # RH 0.9 at 3 km: air at -3 degC is far below Tmin, 5 degC at 500 m is far above Tmax, 0 degC saturated at the coast is sleet
        self.assertEqual(float(P.snow_share(-3.0, 0.9, 3000.0)), 1.0)
        self.assertEqual(float(P.snow_share(5.0, 0.9, 500.0)), 0.0)
        self.assertEqual(float(P.snow_share(0.0, 1.0, 0.0)), P.SLEET_SNOW_SHARE)                                  # Tw 0 is between -0.49 and 1.64
        self.assertEqual(float(P.snow_share(1.0, 1.0, 0.0)), P.SLEET_SNOW_SHARE)
        self.assertTrue(np.isnan(P.snow_share(np.nan, 0.9, 100.0)) and np.isnan(P.snow_share(1.0, np.nan, 100.0)))

    def test_snow_line_rises_with_air_temperature_and_is_monotone(self):
        t = np.linspace(-10, 12, 89)
        share = P.snow_share(t, np.full_like(t, 0.9), np.full_like(t, 2000.0))
        self.assertTrue(np.all(np.diff(share) <= 0))                                                               # warmer, never more snow
        self.assertEqual(share[0], 1.0); self.assertEqual(share[-1], 0.0)

    def test_snow_line_follows_the_lapse_rate(self):
        # a 2 km climb at 6.5 degC/km from a 12 degC valley, humidity 0.7 throughout: rain low down, snow high up, never snow below rain
        z = np.arange(0, 3001, 250.0)
        share = P.snow_share(12.0 - 0.0065 * z, np.full_like(z, 0.7), z)
        self.assertEqual(share[0], 0.0); self.assertEqual(share[-1], 1.0)
        self.assertTrue(np.all(np.diff(share) >= 0))


class Split(unittest.TestCase):
    def test_water_is_conserved(self):
        precip = np.array([0.0, 0.5, 2.0, 7.5, 1.0])
        share = np.array([0.9, 0.5, 0.0, 1.0, np.nan])
        rain, snow = P.split(precip, share)
        np.testing.assert_allclose(rain + snow, precip, atol=1e-12)
        np.testing.assert_allclose(snow, [0.0, 0.25, 0.0, 7.5, 0.0])
        self.assertTrue(np.all(rain >= 0) and np.all(snow >= 0))


class Packing(unittest.TestCase):
    def test_round_trip(self):
        share = np.array([[0.0, 0.5, 1.0, 0.2, np.nan]])
        rgb = P.pack_phase(share)
        self.assertEqual(rgb.dtype, np.uint8)
        np.testing.assert_allclose(P.unpack_phase(rgb)[0, :4], [0.0, 128 / 255, 1.0, 51 / 255], atol=1e-12)
        self.assertEqual(int(rgb[0, 4, 0]), 0)                                                                    # missing is 0 = rain
        self.assertTrue(np.all(rgb[..., 1:] == 0))
        self.assertAlmostEqual(float(P.unpack_phase(P.pack_phase(np.array([1.0])))[0]), 1.0)                      # all snow stays all snow


class CrossCheck(unittest.TestCase):
    def test_jennings_logistic(self):
        # p = 1 / (1 + exp(-10.04 + 1.41 Ta + 0.09 RH)) with RH in per cent: 0 degC at 70 % -> 0.9768, 3 degC at 70 % -> 0.3800
        self.assertAlmostEqual(float(P.jennings_probability(0.0, 0.7)), 1 / (1 + np.exp(-10.04 + 6.3)), places=9)
        self.assertAlmostEqual(float(P.jennings_probability(0.0, 0.7)), 0.9768, places=4)
        self.assertAlmostEqual(float(P.jennings_probability(3.0, 0.7)), 0.3800, places=3)
        for rh in (0.3, 0.7, 1.0):
            ta = (10.04 - 0.09 * 100 * rh) / 1.41
            self.assertAlmostEqual(float(P.jennings_probability(ta, rh)), 0.5, places=12)

    def test_classes(self):
        np.testing.assert_array_equal(P.phase_class(np.array([0.0, 0.24, 0.25, 0.5, 0.75, 0.76, 1.0])), [0, 0, 1, 1, 1, 2, 2])

    def test_counts_and_summary(self):
        precip = np.array([1.0, 2.0, 4.0, 0.05, 3.0, np.nan])
        share = np.array([1.0, 1.0, 0.0, 1.0, 0.5, 1.0])
        ecmwf = np.array([1.0, 0.25, 0.0, 1.0, 0.5, 1.0])
        jen = np.array([0.9, 0.2, 0.1, 0.9, 0.9, 0.9])
        c = P.agreement_counts(precip, share, ecmwf, jen)
        self.assertEqual(c['wet'], 4)                                                                             # the 0.05 mm/h cell and the NaN are not wet
        self.assertEqual(c['agree'], 3)                                                                           # snow/snow, snow vs rain-ish (0.25 is mixed), rain/rain, mixed/mixed
        self.assertAlmostEqual(c['ours'], 1.0 + 2.0 + 0.0 + 1.5)
        self.assertAlmostEqual(c['ecmwf'], 1.0 + 0.5 + 0.0 + 1.5)
        self.assertAlmostEqual(c['water'], 10.0)
        self.assertEqual(c['jennings_agree'], 3)                                                                  # cells 0, 2 and 4: Jennings snow (>= 0.5) exactly when share >= 0.5
        s = P.summary(c, True, True)
        self.assertAlmostEqual(s['class_agreement'], 0.75); self.assertAlmostEqual(s['snow_water_share'], 0.45)
        self.assertAlmostEqual(s['ecmwf_snow_water_share'], 0.3); self.assertAlmostEqual(s['jennings_agreement'], 0.75)
        self.assertFalse(P.summary(c, False)['compared'])
        self.assertFalse(P.summary(dict(wet=0, agree=0, ours=0.0, ecmwf=0.0, water=0.0, jennings_agree=0), True)['compared'])


if __name__ == '__main__':
    unittest.main()
