"""Run: .venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests
The vectors in test/fixtures/qc-vectors.json are the same ones test/obs-qc.test.js runs against scripts/obs-qc.mjs: the two implementations must agree."""
import copy
import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts'))
import obs_qc as Q  # noqa: E402

VECTORS = json.loads((REPO / 'test' / 'fixtures' / 'qc-vectors.json').read_text(encoding='utf-8'))


def flat(flags):
    return {f'{k}|{p}': sorted(f['rule'] for f in items) for k, ps in flags.items() for p, items in ps.items()}


class SharedVectors(unittest.TestCase):
    def test_every_vector(self):
        for c in VECTORS['cases']:
            with self.subTest(c['name']):
                flags, state, _ = Q.qc_check(c['readings'], state=copy.deepcopy(c['state']))
                self.assertEqual(flat(flags), c['expect']['flags'])
                for k, want in c['expect'].get('state', {}).items():
                    key, param = k.split('|')
                    self.assertEqual(state.get(key, {}).get(param, {}).get('v'), want['v'], k + ' reference value')
                    self.assertEqual(state.get(key, {}).get(param, {}).get('run'), want['run'], k + ' run count')
                for k in c['expect'].get('no_state', []):
                    key, param = k.split('|')
                    self.assertNotIn(param, state.get(key, {}), k + ' must not enter the state')

    def test_rules_file_is_the_one_the_js_reads(self):
        rules = json.loads((REPO / 'scripts' / 'qc-rules.json').read_text(encoding='utf-8'))
        self.assertEqual(Q.RULES, rules)
        self.assertEqual(rules['params']['temperature']['range'], [-89.2, 56.7])


class Spatial(unittest.TestCase):
    def test_lapse_corrected_expectation(self):
        spec, t0 = Q.RULES['params']['temperature']['spatial'], 1700000000000
        at = lambda key, value, z, lat: dict(key=key, param='temperature', value=value, time=t0, lat=lat, lon=73.0, z=z)
        me = at('me', 10, 600, 34.0)
        e = Q.spatial_expectation(me, [at('a', 20, 0, 34.05), at('b', 21, 0, 34.1), at('c', 19, 0, 33.95)], spec)
        self.assertEqual(e['n'], 3)
        self.assertAlmostEqual(e['expected'], 20 - 6.5 * 0.6, places=12)                  # 16.1 at 600 m
        self.assertAlmostEqual(e['residual'], 10 - 16.1, places=12)
        self.assertAlmostEqual(e['scale'], 1.4826, places=9)
        self.assertIsNone(Q.spatial_expectation(me, [at('me', 20, 0, 34.05), at('a', 20, 0, 34.05)], spec))
        self.assertIsNone(Q.spatial_expectation(dict(me, z=None), [at('a', 20, 0, 34.05)], spec))

    def test_helpers(self):
        self.assertAlmostEqual(Q.haversine_km(34, 73, 35, 73), 111.19, delta=0.1)
        self.assertEqual(Q.median([3, 1, 2]), 2)
        self.assertEqual(Q.median([4, 1, 3, 2]), 2.5)
        self.assertTrue(Q.is_flagged({'qc': {'temperature': ['spatial']}}, 'temperature'))
        self.assertFalse(Q.is_flagged({'qc': {'temperature': ['spatial']}}, 'wind'))
        self.assertFalse(Q.is_flagged({}, 'temperature'))


class Metar(unittest.TestCase):
    T0 = 1700000000                                                                      # obsTime is in seconds
    row = lambda self, code, temp, lat, lon, elev=100, **kw: {**dict(icaoId=code, obsTime=self.T0, temp=temp, dewp=temp - 5, wdir=270, wspd=10, altim=1015, lat=lat, lon=lon, elev=elev), **kw}

    def test_readings_use_metric_units_and_skip_non_numbers(self):
        rs = Q.metar_readings([self.row('OPXX', 20, 34.0, 73.0, 250, wdir='VRB')])
        by = {r['param']: r for r in rs}
        self.assertEqual(set(by), {'temperature', 'dew_point', 'pressure', 'wind_speed'})        # 'VRB' is not a direction
        self.assertAlmostEqual(by['wind_speed']['value'], 18.52)                                  # 10 kt in km/h
        self.assertEqual(by['temperature']['time'], self.T0 * 1000); self.assertEqual(by['temperature']['z'], 250)
        self.assertIsNone(Q.metar_readings([self.row('OPXX', 20, 34.0, 73.0, None)])[0]['z'])

    def test_pkt_label(self):
        now = 1794918600000                                                                   # 2026-11-17 12:30 UTC
        self.assertEqual(Q.parse_pkt_label('05:20 pm, 17 November', now), 1794918000000)      # 17:20 PKT is 12:20 UTC
        self.assertEqual(Q.parse_pkt_label('05:20 pm, 18 November', now), 1763468400000)      # a date still in the future is last year's
        self.assertEqual(Q.parse_pkt_label('12:05 am, 9 November', now), 1794164700000)       # 00:05 PKT is 19:05 UTC the evening before
        self.assertIsNone(Q.parse_pkt_label('soon', now)); self.assertIsNone(Q.parse_pkt_label(None, now))

    def test_neighbours_skip_flagged_and_unlocated_stations(self):
        v = lambda t: [None] * 5 + [t] + [None] * 18 + ['05:20 pm, 17 November']
        data = dict(stations=[dict(key='a', lat=34, lon=73, elevation=500, v=v(20.0)), dict(key='b', lat=34, lon=73, elevation=500, v=v(21.0), qc={'temperature': ['spatial']}),
                              dict(key='c', lat=34, lon=73, elevation=None, v=v(22.0)), dict(key='d', lat=34, lon=73, elevation=500, v=v(None))])
        got = Q.realtime_temperature_neighbours(data, 1794918600000)
        self.assertEqual([g['key'] for g in got], ['rt:a'])
        self.assertEqual(got[0]['time'], 1794918000000)

    def test_qc_metar_marks_rows_keeps_values_and_drops_neighbour_state(self):
        t0 = self.T0 * 1000
        rows = [self.row('OPAA', 5, 34.0, 73.0, 100), self.row('OPBB', 21, 34.6, 73.0, 100)]
        before = copy.deepcopy(rows)
        nb = [dict(key=f'rt:{i}', param='temperature', value=21.0, time=t0, lat=34.0 + 0.05 * (i - 2), lon=73.05, z=100) for i in range(5)]
        report, state = Q.qc_metar(rows, {}, nb)
        self.assertEqual(rows[0]['qc'], {'temperature': ['spatial']})                              # 16 degC under five stations at the same height
        self.assertNotIn('qc', rows[1])                                                           # 60 km from every neighbour: no judgement
        for r0, r1 in zip(before, rows):
            self.assertEqual({k: r1[k] for k in r0}, r0)                                          # readings are retained
        self.assertEqual(report['summary']['flagged'], 1)
        self.assertEqual(report['flags'][0]['station'], 'OPAA'); self.assertEqual(report['flags'][0]['neighbours'], 5)
        self.assertTrue(all(not k.startswith('rt:') for k in state))                              # neighbours never enter the METAR state
        self.assertNotIn('temperature', state.get('OPAA', {}))                                    # and a flagged first reading is no reference
        self.assertEqual(state['OPBB']['temperature']['v'], 21)
        again, _ = Q.qc_metar(rows, state, nb)                                                    # a second run on the same report: marks are rebuilt, not doubled
        self.assertEqual(len(rows[0]['qc']['temperature']), 1)


class ApplyExclusion(unittest.TestCase):
    """The 1 km apply step sets flagged readings to missing, so the live bias (needs t2m) and the Barnes analysis (skips non-finite values) never see them."""
    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location('apply1km', REPO / 'downscaler' / '2_apply_1km_forecast.py')
        cls.A = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.A)

    def obs(self):
        import numpy as np
        return dict(t2m=12.0, u=1.0, v=-2.0, rain=0.4, z=500.0, time=0)

    def test_flagged_parameters_become_missing(self):
        import numpy as np
        o = self.A.drop_flagged(self.obs(), {'qc': {'temperature': ['spatial']}})
        self.assertTrue(np.isnan(o['t2m'])); self.assertEqual((o['u'], o['v'], o['rain']), (1.0, -2.0, 0.4))
        self.assertEqual(o['qc_dropped'], ['temperature'])

    def test_wind_is_dropped_when_either_speed_or_direction_is_flagged(self):
        import numpy as np
        for param in ('wind_speed', 'wind_direction'):
            o = self.A.drop_flagged(self.obs(), {'qc': {param: ['range']}})
            self.assertTrue(np.isnan(o['u']) and np.isnan(o['v'])); self.assertEqual(o['t2m'], 12.0)
            self.assertEqual(o['qc_dropped'], ['wind'])

    def test_rain_and_unflagged_rows(self):
        import numpy as np
        o = self.A.drop_flagged(self.obs(), {'qc': {'rain_rate': ['range']}})
        self.assertTrue(np.isnan(o['rain'])); self.assertEqual(o['t2m'], 12.0)
        clean = self.A.drop_flagged(self.obs(), {'name': 'no marks'})
        self.assertEqual((clean['t2m'], clean['u'], clean['rain']), (12.0, 1.0, 0.4)); self.assertNotIn('qc_dropped', clean)
        other = self.A.drop_flagged(self.obs(), {'qc': {'humidity': ['range'], 'pressure': ['range']}})       # parameters the downscaler does not use
        self.assertNotIn('qc_dropped', other)

    def test_a_flag_on_a_value_that_is_already_missing_is_not_counted(self):
        import numpy as np
        o = self.obs(); o['rain'] = np.nan
        self.assertNotIn('qc_dropped', self.A.drop_flagged(o, {'qc': {'rain_rate': ['range']}}))


if __name__ == '__main__':
    unittest.main()
