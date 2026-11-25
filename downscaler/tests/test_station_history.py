"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests"""
import gzip
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'downscaler'))
import features as FT  # noqa: E402
import pull_era5_upper_air as UA  # noqa: E402
import pull_historical_stations as H  # noqa: E402
import terrain as T  # noqa: E402


class Parsers(unittest.TestCase):
    def test_isd_lite_units_missing_and_trace(self):
        text = ('2022 01 01 00    50    14 10247   360     0     4 -9999 -9999\n'
                '2022 01 01 03 -9999    13 10255   270    25     7    -1     3\n'
                '2022 01 01 06   115  -300 10247 -9999 -9999     7    12    30\n')
        d = H.parse_isd_lite(gzip.compress(text.encode()))
        self.assertEqual(d.temp_c.tolist()[0], 5.0)
        self.assertTrue(np.isnan(d.temp_c[1]))                       # -9999 is missing
        self.assertAlmostEqual(d.slp_hpa[0], 1024.7)
        self.assertAlmostEqual(d.wind_ms[1], 2.5)
        self.assertTrue(np.isnan(d.wind_dir[0]))                     # calm: no direction
        self.assertEqual(d.precip_1h_mm[1], 0.0)                     # -1 is a trace
        self.assertAlmostEqual(d.precip_1h_mm[2], 1.2)
        self.assertAlmostEqual(d.precip_6h_mm[2], 3.0)
        self.assertTrue(np.isnan(d.dewpt_c[2]) is False or d.dewpt_c[2] <= d.temp_c[2] + 1)   # -30 degC dew point is below the temperature: kept
        self.assertEqual(d.time[0], pd.Timestamp('2022-01-01 00:00'))

    def test_isd_lite_drops_impossible_values(self):
        text = '2022 01 01 00   700    14 10247   360    30     4 -9999 -9999\n'      # 70 degC
        self.assertTrue(np.isnan(H.parse_isd_lite(gzip.compress(text.encode())).temp_c[0]))

    def test_iem_nearest_report_per_hour_and_units(self):
        csv = '\n'.join(['station,valid,tmpf,dwpf,sknt,drct,p01m,mslp',
                         'OPIS,2024-01-01 00:50,41.00,39.20,10.00,130.00,0.0001,1020.5',
                         'OPIS,2024-01-01 01:05,50.00,40.00,20.00,90.00,2.0,',            # nearer to 01:00 than 00:50 is
                         'OPIS,2024-01-01 01:55,59.00,41.00,0.00,0.00,0.0,1019.0']) + '\n'
        d = H.parse_iem(csv)
        self.assertEqual(d.time.tolist(), [pd.Timestamp('2024-01-01 01:00'), pd.Timestamp('2024-01-01 02:00')])
        self.assertAlmostEqual(d.iloc[0].temp_c, 10.0)                       # 50 F, the 01:05 report
        self.assertAlmostEqual(d.iloc[0].wind_ms, 20 * 0.514444, places=4)   # knots to m/s
        self.assertAlmostEqual(d.iloc[1].temp_c, 15.0)
        self.assertTrue(np.isnan(d.iloc[1].wind_dir))                        # calm: no direction
        self.assertTrue(H.parse_iem('station,valid,tmpf,dwpf,sknt,drct,p01m,mslp\n').empty)

    def test_ghcn_drops_flagged_values_and_converts_tenths(self):
        csv = ('ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME\n'
               'PK000041640,19991231,TMAX,300,,,I,\n'
               'PK000041640,20000101,TMAX,215,,,I,\n'
               'PK000041640,20000101,TMIN,38,,,I,\n'
               'PK000041640,20000101,PRCP,125,,,I,\n'
               'PK000041640,20000102,TMAX,999,,G,I,\n'          # failed a quality check
               'PK000041640,20000102,PRCP,0,,,I,\n'
               'PK000041640,20000102,TAVG,200,H,,2,\n')
        d = H.parse_ghcn(csv, 2000).set_index('date')
        self.assertNotIn(pd.Timestamp('1999-12-31'), d.index)
        r = d.loc[pd.Timestamp('2000-01-01')]
        self.assertEqual((r.tmax_c, r.tmin_c, r.precip_mm), (21.5, 3.8, 12.5))
        self.assertTrue(np.isnan(d.loc[pd.Timestamp('2000-01-02')].tmax_c))
        self.assertEqual(d.loc[pd.Timestamp('2000-01-02')].precip_mm, 0.0)

    def test_hourly_merge_isd_wins_and_iem_fills(self):
        t = [pd.Timestamp('2024-01-01 00:00'), pd.Timestamp('2024-01-01 01:00')]
        cols = ['temp_c', 'dewpt_c', 'wind_ms', 'wind_dir', 'slp_hpa', 'precip_1h_mm', 'precip_6h_mm']
        isd = pd.DataFrame(dict(station_id='41571', time=t[:1], temp_c=5.0, dewpt_c=np.nan, wind_ms=2.0, wind_dir=90.0, slp_hpa=np.nan, precip_1h_mm=np.nan, precip_6h_mm=np.nan))
        iem = pd.DataFrame(dict(station_id='41571', time=t, temp_c=[9.0, 7.0], dewpt_c=[3.0, 2.0], wind_ms=[1.0, 1.0], wind_dir=[10.0, 10.0], slp_hpa=[1010.0, 1011.0], precip_1h_mm=[0.0, 0.0], precip_6h_mm=np.nan))
        m = H.merge_hourly(isd, iem).set_index('time')
        self.assertEqual(m.loc[t[0], 'temp_c'], 5.0)                  # ISD wins
        self.assertEqual(m.loc[t[0], 'dewpt_c'], 3.0)                 # IEM fills a field ISD lacks
        self.assertEqual(m.loc[t[0], 'source'], 'isd+iem')
        self.assertEqual(m.loc[t[1], 'temp_c'], 7.0)
        self.assertEqual(m.loc[t[1], 'source'], 'iem')


class Identity(unittest.TestCase):
    def test_nan_icao_does_not_blank_the_station_id(self):
        isd = pd.DataFrame(dict(USAF=['415170'], WBAN=['99999'], NAME=['SKARDU'], CTRY=['PK'], ICAO=['OPSD'], LAT=[35.336], LON=[75.536],
                                ELEV=[2316.5], BEGIN=['19730101'], END=['20250101'], wmo=['41517']))
        ghcn = pd.DataFrame(dict(id=['PK008020100', 'PK008100200'], lat=[35.30, 33.2], lon=[75.683, 73.8], elev=[2181.0, 336.0],
                                 name=['SKARDU', 'MIRPUR'], wmo=[None, None]))
        iem = pd.DataFrame(columns=['icao', 'name', 'lat', 'lon', 'elev', 'wmo'])
        st = H.build_stations(isd, ghcn, iem).set_index('src_id')
        self.assertEqual(st.loc['PK008020100', 'station_id'], '41517')       # 13 km off in NOAA's list, joined by name
        self.assertEqual(st.loc['PK008100200', 'station_id'], 'PK008100200')  # nothing near: its own id, never blank
        self.assertFalse(st.station_id.isna().any())


class UpperAirDaily(unittest.TestCase):
    def test_daily_mean_and_max_from_eight_samples_and_partial_days_dropped(self):
        times = list(pd.date_range('2022-08-01 00:00', periods=8, freq='3h')) + list(pd.date_range('2022-08-02 00:00', periods=8, freq='3h'))             + list(pd.date_range('2022-08-03 00:00', periods=3, freq='3h'))
        v = np.array([[1.0, 10.0]] * 8 + [[2.0, 20.0]] * 8 + [[99.0, 99.0]] * 3)
        v[3] = [9.0, 90.0]                                                       # one sample of day 1 differs: mean and max see it
        d, mean = UA.daily(v, times, 'mean')
        self.assertEqual([x.strftime('%Y-%m-%d') for x in d], ['2022-08-01', '2022-08-02'])   # 3 samples of 3 Aug: not a day
        np.testing.assert_allclose(mean[0], [2.0, 20.0]); np.testing.assert_allclose(mean[1], [2.0, 20.0])
        _, mx = UA.daily(v, times, 'max')
        np.testing.assert_allclose(mx[0], [9.0, 90.0]); np.testing.assert_allclose(mx[1], [2.0, 20.0])

    def test_days_do_not_straddle_midnight(self):
        times = pd.date_range('2022-08-01 03:00', periods=16, freq='3h')       # starts at 03 UTC: day 1 has only 7 samples, day 2 has 8, day 3 one
        d, _ = UA.daily(np.arange(16.0), times, 'mean')
        self.assertEqual([x.strftime('%Y-%m-%d') for x in d], ['2022-08-02'])

    def test_request_shape(self):
        name, req = UA.request('pl', 2022, [1, 2, 3])
        self.assertEqual(name, 'reanalysis-era5-pressure-levels')
        self.assertEqual(req['pressure_level'], ['850', '700']); self.assertEqual(len(req['time']), 8)
        self.assertEqual(req['month'], ['01', '02', '03'])
        fields = len(req['variable']) * len(req['pressure_level']) * len(req['time']) * 31 * 3
        self.assertLessEqual(fields, 5952)                                         # a quarter is the largest block CDS accepted; half a year was refused
        self.assertEqual(UA.request('sl', 2022, [1])[1]['variable'], ['convective_available_potential_energy'])


class UpperAirTasks(unittest.TestCase):
    def test_quarters_and_years(self):
        first, last = pd.Period('2010-01'), pd.Period('2026-10')
        t = UA.tasks([2026], first, last)
        self.assertEqual([(k, y, q, m) for k, y, q, m in t], [('sl', 2026, None, list(range(1, 11))), ('pl', 2026, 0, [1, 2, 3]), ('pl', 2026, 1, [4, 5, 6]),
                                                                ('pl', 2026, 2, [7, 8, 9]), ('pl', 2026, 3, [10])])           # the last quarter only has October
        self.assertEqual([x[0] for x in UA.tasks([2010], first, last, only='pl')], ['pl'] * 4)
        self.assertEqual([x[0] for x in UA.tasks([2010], first, last, only='sl')], ['sl'])
        self.assertEqual(UA.tasks([2008], first, last), [])                         # outside the range


class Features(unittest.TestCase):
    def test_feature_list(self):
        self.assertEqual(len(FT.FEATURE_COLS), len(set(FT.FEATURE_COLS)))
        for name in ('cape_max', 'q850', 'r850', 'q700', 'r700', 'w_oro_850', 'MF_850', 'MF_700'):
            self.assertIn(name, FT.FEATURE_COLS)
        self.assertEqual(FT.FEATURE_COLS[:len(FT.V1_COLS)], FT.V1_COLS)

    def test_smoothed_gradient_of_a_plane(self):
        dy = T.RES * T.M_PER_DEG
        z = np.repeat(np.arange(T.NY)[::-1, None] * 10.0, T.NX, 1)            # rises 10 m per cell to the north
        gx, gy = FT.smoothed_gradients(z)
        self.assertAlmostEqual(float(gy[750, 900]), 10.0 / dy, places=7)
        self.assertAlmostEqual(float(gx[750, 900]), 0.0, places=9)

    def test_orographic_vertical_velocity_and_flux(self):
        dzdx, dzdy = 0.1, 0.0                                                  # ground rises 100 m per km to the east
        self.assertAlmostEqual(float(FT.w_oro(10.0, 3.0, dzdx, dzdy)), 1.0)    # a 10 m/s westerly climbs at 1 m/s
        self.assertAlmostEqual(float(FT.w_oro(-10.0, 0.0, dzdx, dzdy)), -1.0)  # an easterly descends
        self.assertAlmostEqual(float(FT.moisture_flux(0.008, 1.0)), 8.0)       # 1000 * q * w
        f = FT.upper_air_features(1200, 0.008, 60, 0.004, 40, 10, 0, 10, 0, dzdx, dzdy, elevation=np.array([800.0, 2500.0]))
        np.testing.assert_allclose(f['MF_850'], 8.0)
        np.testing.assert_allclose(f['MF_700'], [0.0, 4.0])                     # only above 1,500 m
        np.testing.assert_allclose(f['cape_max'], 1200)


if __name__ == '__main__':
    unittest.main()
