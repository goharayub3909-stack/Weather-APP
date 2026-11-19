"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import era5land  # noqa: E402
import pmd_xlsx as P  # noqa: E402
import stations as st  # noqa: E402
import terrain as T  # noqa: E402


class FakeSheet:
    def __init__(self, title, rows):
        self.title, self.rows = title, rows

    def iter_rows(self, values_only=True):
        return iter(self.rows)


def day_header(first, offset=1):
    return [first] + [None] * (offset - 1) + list(range(1, 32)) + ['Total']


class PmdXlsx(unittest.TestCase):
    def test_values(self):
        self.assertEqual(P.parse_value('27.0 \xa0'), (27.0, 'ok'))
        self.assertEqual(P.parse_value('-3.5'), (-3.5, 'ok'))
        self.assertEqual(P.parse_value('**'), (None, 'missing'))
        self.assertEqual(P.parse_value('TR'), (0.0, 'trace'))
        self.assertEqual(P.parse_value(0), (0.0, 'ok'))

    def test_names_and_months(self):
        self.assertEqual(P.norm_name('BAHAWALPURA/P'), 'BAHAWALPUR AIRPORT')
        self.assertEqual(P.norm_name('ISLAMABAD,ZEROPOINT'), 'ISLAMABAD ZEROPOINT')
        self.assertEqual(P.month_from_text('Daily Rainfall (MM),January-2022'), (2022, 1))
        self.assertEqual(P.month_from_text('MINIMUM TEMPERATURES ( C ) FOR THE MONTH MAY -2020-'), (2020, 5))
        self.assertEqual(P.month_from_text('March 2016'), (2016, 3))
        self.assertIsNone(P.month_from_text('AWS + PMD'))
        # typos seen in real titles
        self.assertEqual(P.month_from_text('Maximum Temperature ( C ) for the Month ofJune -2021'), (2021, 6))
        self.assertEqual(P.month_from_text('Maximum Temperature ( C ) for the Month of Octoberr -2021'), (2021, 10))
        self.assertEqual(P.month_from_text('MINIMUM TEMPERATURES ( C ) FOR THE MONTHJANUARY-2017'), (2017, 1))
        self.assertEqual(P.block_kind([None, 'Maximum Temperature ( C ) for the Month ofJune -2021']), 'tmax')
        self.assertIsNone(P.block_kind([None, 'Daily Highest Maximum', None, 'Highest of Max temps (C)']))

    def test_header_needs_consecutive_days(self):
        self.assertEqual(P.day_columns(day_header('PUNJAB'))[31], 31)
        self.assertEqual(P.day_columns(day_header('PUNJAB', 2))[1], 2)
        # a station row of whole-number winter minima is not a header
        self.assertIsNone(P.day_columns(['MURREE', 1, 2, 3, 2, 1, 0] + [1] * 25))

    def test_temperature_blocks_in_either_order(self):
        rows = [['PUNJAB', 'Minimum Temperature ( C ) for the Month of December -2022'],
                day_header(None), ['MURREE'] + [1, 2, 3] + [0.5] * 28,
                [None, '   Maximum Temperature ( C ) for the Month of December -2022'],
                day_header(None), ['MURREE'] + [9.5] * 31,
                ['', 'indicates Daily Highest Maximum Temperature']]
        out = list(P.read_sheet(FakeSheet('December-2022', rows), None, (2022, 12)))
        tmin = [r for r in out if r['variable'] == 'tmin']
        tmax = [r for r in out if r['variable'] == 'tmax']
        self.assertEqual(len(tmin), 31)
        self.assertEqual(len(tmax), 31)
        self.assertEqual([r['value'] for r in tmin[:3]], [1.0, 2.0, 3.0])

    def test_sheet_month_wins_over_title_typo(self):
        rows = [['MINIMUM TEMPERATURES FOR THE MONTH JULY-2016'], day_header('PUNJAB'), ['CHAKWAL'] + [25] * 31]
        out = list(P.read_sheet(FakeSheet('July 2017', rows), None, (2017, 7)))
        self.assertEqual({(r['year'], r['month']) for r in out}, {(2017, 7)})

    def test_rain_rows_with_serial_numbers_and_short_months(self):
        rows = [['RAINFALL (MM) STATEMENT FOR THE MONTH OF FEBRUARY-2012'], day_header('PUNJAB', 2),
                [1, "BAHAWALNAGAR"] + [0] * 28 + [12.5] + [99, 99]]
        out = list(P.read_sheet(FakeSheet('February', rows), 'rain', (2012, 2)))
        self.assertEqual(len(out), 29)                       # 2012 is a leap year; columns 30, 31 are ignored
        self.assertEqual(out[-1]['value'], 12.5)
        self.assertEqual(out[0]['name'], 'BAHAWALNAGAR')


class Stations(unittest.TestCase):
    meta = {n: dict(station_id=i, name=n, lat=0, lon=0, elev_meta=0) for i, n in [
        ('41571', 'Chaklala Airbase'), ('41572', 'Islamabad Airport'), ('41652', 'Dera Ghazi Khan'), ('41504', 'Gupis'),
        ('41505', 'Hunza')]}

    def test_aliases_and_islamabad_airport(self):
        import datetime as dt
        r = st.resolver(self.meta)
        self.assertEqual(r('D.G.KHAN', dt.date(2020, 1, 1)), 'Dera Ghazi Khan')
        self.assertEqual(r('ISLAMABAD A/P', dt.date(2017, 1, 1)), 'Chaklala Airbase')
        self.assertEqual(r('ISLAMABAD, AIRPORT', dt.date(2021, 1, 1)), 'Islamabad Airport')
        self.assertIsNone(r('GULBERG', dt.date(2021, 1, 1)))

    def test_pmd_page(self):
        html = ('<table><tr><td>01.</td><td>41504</td><td>Gupis</td><td>36o 10\'</td><td>73o 24\'</td><td>2156.0 meter</td></tr>'
                '<tr><td>02.</td><td>41504</td><td>Hunza</td><td>36o 19\'</td><td>74o 39\'</td><td>2156.0 meter</td></tr>'
                '<tr><td>03.</td><td>41625(AP)</td><td>Bhakkar</td><td>31o 37\'</td><td>71o 04\'</td><td>162 meter</td></tr>'
                '<tr><td>41661</td><td>P.B.O. , Sheikhmanda (Quetta)</td><td>30o-11\' N</td><td>66o-57\' E</td><td>1626m</td><td>x</td></tr></table>')
        page = st.parse_pmd_page(html)
        self.assertNotIn('41625', page)
        self.assertAlmostEqual(page['41504'][0]['lat'], 36 + 10 / 60)
        self.assertEqual(page['41661'][0]['elev_pmd'], 1626.0)
        self.assertEqual(st.page_entry(page, '41504', 'Gupis')['name'], 'Gupis')
        self.assertEqual(st.page_entry(page, '41505', 'Hunza')['lon'], 74 + 39 / 60)   # id not on the page: found by name
        self.assertIsNone(st.page_entry(page, '41999', 'Nowhere'))


class Terrain(unittest.TestCase):
    def test_grid(self):
        self.assertEqual((T.NY, T.NX), (1500, 1800))
        self.assertEqual(T.cell_of(37.995, 60.005), (0, 0))
        self.assertEqual(T.cell_of(23.0001, 77.9999), (1499, 1799))
        self.assertIsNone(T.cell_of(40, 70))
        self.assertTrue(T.tile_url(33, 73).endswith('Copernicus_DSM_COG_30_N33_00_E073_00_DEM.tif'))

    def test_slopes_and_aspect(self):
        lat = T.lat_centres()[:, None]
        lon = T.lon_centres()[None, :]
        dy = T.RES * T.M_PER_DEG
        # a plane rising 1 m per cell to the north: slope_y = 1/dy, slope_x = 0, faces south (180 degrees)
        z = (T.NY - np.arange(T.NY))[:, None] * np.ones((1, T.NX))
        sx, sy = T.slopes(z)
        self.assertAlmostEqual(float(sy[700, 900]), 1 / dy, places=9)
        self.assertAlmostEqual(float(sx[700, 900]), 0.0, places=12)
        self.assertAlmostEqual(float(T.aspect_deg(sx, sy)[700, 900]), 180.0, places=4)
        # rising to the east: faces west (270)
        z = np.ones((T.NY, 1)) * np.arange(T.NX)[None, :]
        sx, sy = T.slopes(z)
        self.assertAlmostEqual(float(sx[700, 900]), 1 / (dy * math.cos(math.radians(lat[700, 0]))), places=9)
        self.assertAlmostEqual(float(T.aspect_deg(sx, sy)[700, 900]), 270.0, places=4)
        del lon

    def test_tpi(self):
        z = np.zeros((11, 11))
        z[5, 5] = 25.0
        t = T.tpi(z)
        self.assertAlmostEqual(float(t[5, 5]), 24.0)            # 25 - 25/25
        self.assertAlmostEqual(float(t[5, 6]), -1.0)

    def test_coarse_elevation_and_delta_z(self):
        dem = np.full((T.NY, T.NX), 100.0, np.float32)
        dem[0:5, 0:5] = 200.0                                    # the NW ERA5-Land cell (centre 38 N, 60 E) covers 5 x 5 cells here
        c = T.coarse_elevation(dem)
        self.assertAlmostEqual(float(c[0, 0]), 200.0)
        self.assertAlmostEqual(float(c[0, 5]), 100.0)
        dem[100:110, 100:110] = 1100.0                           # one full ERA5-Land cell (0.1 degree, offset by half a cell)
        c = T.coarse_elevation(dem)
        self.assertAlmostEqual(float(c[105, 105]), (1100 * 25 + 100 * 75) / 100)

    def test_coast_distance(self):
        dem = np.full((T.NY, T.NX), 50.0, np.float32)
        dem[-200:, :] = np.nan                                   # sea south of 25.0 N
        dem[700, 900] = -5                                       # an inland depression is not sea
        sea = T.sea_mask(dem)
        self.assertTrue(sea[-1, 0])
        self.assertFalse(sea[700, 900])
        d = T.coast_distance_km(sea)
        j = T.NY - 201                                           # first land row, centre 25.005 N
        self.assertLess(float(d[j, 900]), 1.2)
        self.assertAlmostEqual(float(d[j - 100, 900]), T.haversine_km(25.005 + 1.0, 70, 24.995, 70), delta=0.05)


class Era5(unittest.TestCase):
    def test_wind_components(self):
        u, v = era5land.wind_uv(np.array([10.0, 10.0]), np.array([270.0, 0.0]))   # from the west, from the north
        np.testing.assert_allclose(u, [10.0, 0.0], atol=1e-9)
        np.testing.assert_allclose(v, [0.0, -10.0], atol=1e-9)


if __name__ == '__main__':
    unittest.main()


class ExtraStations(unittest.TestCase):
    def minutes(self, days=3):
        import pandas as pd
        t = pd.date_range('2025-01-01', periods=days * 1440, freq='min')
        hour = t.hour + t.minute / 60
        temp = 10 * np.sin((hour - 9) / 24 * 2 * np.pi)                     # peaks 15:00, lowest 03:00
        return pd.DataFrame(dict(time=t, temp=temp, thigh=temp + 0.1, tlow=temp - 0.1, rain=0.0))

    def test_pmd_windows(self):
        import extra_stations as X
        d = X.daily_from_minutes(self.minutes()).set_index('date')
        import pandas as pd
        day = pd.Timestamp('2025-01-02')
        self.assertAlmostEqual(d.loc[day, 'tmax'], 10.1, places=3)           # the calendar day's highest
        self.assertAlmostEqual(d.loc[day, 'tmin'], -10.1, places=3)          # the night before 08:00
        self.assertTrue(np.isnan(d.loc[day, 'rain']))                       # the window froze: an unheated gauge misses snow
        self.assertNotIn(pd.Timestamp('2025-01-01'), d.index)                # first day: window starts before the data

    def test_gap_in_the_critical_hours_drops_the_day_and_frost_drops_rain(self):
        import extra_stations as X
        import pandas as pd
        m = self.minutes()
        gap = (m.time >= '2025-01-02 13:00') & (m.time < '2025-01-02 14:30')   # 90 min inside 10:00-18:00
        d = X.daily_from_minutes(m[~gap]).set_index('date')
        self.assertTrue(np.isnan(d.loc[pd.Timestamp('2025-01-02'), 'tmax']))
        self.assertFalse(np.isnan(d.loc[pd.Timestamp('2025-01-02'), 'tmin']))
        warm = self.minutes(); warm[['temp', 'thigh', 'tlow']] += 20; warm['rain'] = 0.01
        d = X.daily_from_minutes(warm).set_index('date')
        self.assertAlmostEqual(d.loc[pd.Timestamp('2025-01-02'), 'rain'], 14.4, places=6)    # 1440 x 0.01 mm, no frost
