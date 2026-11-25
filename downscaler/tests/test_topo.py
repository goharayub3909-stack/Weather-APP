"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests
Expected values are worked out from the definitions (ramps, a trench, the equinox sun path), not read back from the code."""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import terrain  # noqa: E402
import topo as T  # noqa: E402

DY = terrain.RES * terrain.M_PER_DEG                      # metres between rows (and between columns at the equator)


class WindowStatistics(unittest.TestCase):
    ramp = staticmethod(lambda s=10.0, n=41: np.tile(s * np.arange(n, dtype=float), (n, 1)))      # height rises s metres per column

    def test_roughness_of_a_ramp(self):
        # the heights in a w-wide window of a ramp are s * (i - h) .. s * (i + h): variance s^2 (w^2 - 1) / 12
        r = T.roughness(self.ramp(10.0), 5)
        self.assertAlmostEqual(float(r[20, 20]), 10.0 * math.sqrt(24 / 12), places=4)
        r = T.roughness(self.ramp(10.0), 3)
        self.assertAlmostEqual(float(r[20, 20]), 10.0 * math.sqrt(8 / 12), places=4)
        self.assertEqual(float(T.roughness(np.full((9, 9), 500.0), 5)[4, 4]), 0.0)

    def test_relative_position_and_valley_depth_of_a_ramp(self):
        z = self.ramp(10.0)
        self.assertAlmostEqual(float(T.relative_position(z, 9)[20, 20]), 0.5, places=6)               # mid-slope
        self.assertAlmostEqual(float(T.valley_depth(z, 9)[20, 20]), 40.0, places=6)                   # 4 cells to the top at 10 m each
        self.assertEqual(float(T.relative_position(np.full((9, 9), 100.0), 5)[4, 4]), 0.5)           # flat ground
        bowl = np.full((21, 21), 1000.0); bowl[10, 10] = 700.0
        self.assertEqual(float(T.relative_position(bowl, 9)[10, 10]), 0.0)                           # the bottom
        self.assertEqual(float(T.valley_depth(bowl, 9)[10, 10]), 300.0)
        peak = np.full((21, 21), 1000.0); peak[10, 10] = 1400.0
        self.assertEqual(float(T.relative_position(peak, 9)[10, 10]), 1.0)                           # the top
        self.assertEqual(float(T.valley_depth(peak, 9)[10, 10]), 0.0)

    def test_tpi_scales(self):
        z = np.full((41, 41), 1000.0); z[20, 20] = 1090.0
        f = T.static_features(z, lat_deg=np.zeros(41))
        self.assertAlmostEqual(float(f['tpi_3'][20, 20]), 90.0 * 8 / 9, places=4)                    # height minus the mean of the 3 x 3 cells
        self.assertAlmostEqual(float(f['tpi_9'][20, 20]), 90.0 * 80 / 81, places=4)
        self.assertAlmostEqual(float(f['tpi_25'][20, 20]), 90.0 * 624 / 625, places=4)
        self.assertEqual(set(f), set(T.STATIC))


class SkyView(unittest.TestCase):
    def test_flat_ground_sees_the_whole_sky(self):
        np.testing.assert_allclose(T.sky_view_factor(np.full((61, 61), 300.0), lat_deg=np.zeros(61)), 1.0)

    def test_trench_with_45_degree_walls(self):
        # walls rise one cell height per row (45 degrees at the equator, where a cell is as wide as it is tall): N and S horizons 45 deg,
        # the four diagonals see tan = 1 / sqrt(2), east and west see level ground: SVF = 1 - (2 sin 45 + 4 sin atan(1/sqrt 2)) / 8
        j = np.abs(np.arange(61) - 30)[:, None] * DY
        z = np.tile(j, (1, 61))
        svf = T.sky_view_factor(z, lat_deg=np.zeros(61))
        want = 1 - (2 * math.sin(math.radians(45)) + 4 * math.sin(math.atan(1 / math.sqrt(2)))) / 8
        self.assertAlmostEqual(float(svf[30, 30]), want, places=6)
        self.assertAlmostEqual(want, 0.5345, places=4)
        self.assertGreater(float(svf[30, 30]), 0.0)
        self.assertLess(float(svf[30, 30]), float(svf[0, 30]))                                # the trench floor sees less sky than the plateau rim row

    def test_a_peak_sees_all_sky_and_a_pit_does_not(self):
        z = np.full((61, 61), 1000.0); z[30, 30] = 1500.0
        self.assertAlmostEqual(float(T.sky_view_factor(z, lat_deg=np.zeros(61))[30, 30]), 1.0, places=6)     # nothing above it
        z = np.full((61, 61), 1000.0); z[30, 30] = 400.0
        self.assertLess(float(T.sky_view_factor(z, lat_deg=np.zeros(61))[30, 30]), 0.9)
        self.assertTrue(np.all(T.sky_view_factor(z, lat_deg=np.zeros(61)) <= 1.0))


class SolarGeometry(unittest.TestCase):
    def test_declination(self):
        self.assertAlmostEqual(float(T.declination_deg(81)), 0.0, places=6)                       # equinox: sin 360 deg
        self.assertAlmostEqual(float(T.declination_deg(172)), 23.45 * math.sin(math.radians(360 * 456 / 365)), places=9)
        self.assertGreater(float(T.declination_deg(172)), 23.4)                                   # June solstice
        self.assertLess(float(T.declination_deg(355)), -23.3)                                     # December solstice

    def test_flat_ground_is_one(self):
        for doy in (10, 81, 172, 300):
            self.assertAlmostEqual(float(T.pot_rad_ratio(33.0, 0.0, 0.0, doy)), 1.0, places=12)

    def test_equinox_slope_equals_flat_ground_at_a_shifted_latitude(self):
        # at the equinox a slope tilted by beta toward the equator receives what flat ground at latitude (phi - beta) would: ratio = cos(phi - beta) / cos(phi)
        phi, slope = 35.0, 0.3
        beta = math.degrees(math.atan(slope))
        want = math.cos(math.radians(phi - beta)) / math.cos(math.radians(phi))
        self.assertAlmostEqual(float(T.pot_rad_ratio(phi, 0.0, slope, 81)), want, places=3)           # south-facing: dz/dy > 0
        self.assertAlmostEqual(want, 1.159, places=3)
        away = math.cos(math.radians(phi + beta)) / math.cos(math.radians(phi))
        self.assertAlmostEqual(float(T.pot_rad_ratio(phi, 0.0, -slope, 81)), away, places=3)         # north-facing
        self.assertLess(away, 1.0)

    def test_east_and_west_slopes_receive_the_same_over_a_day(self):
        a, b = T.pot_rad_ratio(30.0, 0.3, 0.0, 80), T.pot_rad_ratio(30.0, -0.3, 0.0, 80)
        self.assertAlmostEqual(float(a), float(b), places=9)
        self.assertLess(float(a), 1.0)

    def test_winter_sun_favours_south_slopes_more_than_summer_does(self):
        winter = float(T.pot_rad_ratio(35.0, 0.0, 0.3, 355)); summer = float(T.pot_rad_ratio(35.0, 0.0, 0.3, 172))
        self.assertGreater(winter, 1.2); self.assertLess(summer, winter)
        self.assertGreater(float(T.pot_rad_ratio(35.0, 0.0, -0.3, 172)), float(T.pot_rad_ratio(35.0, 0.0, -0.3, 355)))   # and north slopes lose less in summer

    def test_arrays_broadcast(self):
        r = T.pot_rad_ratio(np.array([30.0, 35.0]), np.array([0.0, 0.1]), np.array([0.2, -0.2]), np.array([100, 200]))
        self.assertEqual(r.shape, (2,))
        self.assertAlmostEqual(float(r[0]), float(T.pot_rad_ratio(30.0, 0.0, 0.2, 100)), places=12)
        self.assertAlmostEqual(float(r[1]), float(T.pot_rad_ratio(35.0, 0.1, -0.2, 200)), places=12)


if __name__ == '__main__':
    unittest.main()
