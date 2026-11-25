"""Tests of scripts/pull_era5_upper_points.py: the CSV reader, the daily means, the cell rule and the split of a too-large request."""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import pull_era5_upper_points as P  # noqa: E402


def csv_text(days, value=lambda d, h, L: 1.0):
    rows = ['valid_time,pressureLevel,q,latitude,longitude']
    for d in range(days):
        for h in (0, 6, 12, 18):
            for L in (1000.0, 850.0, 700.0, 500.0):
                rows.append(f'2022-08-{d + 1:02d} {h:02d}:00:00,{L},{value(d, h, L)},33.75,73.0')
    return '\n'.join(rows) + '\n'


class Tidy(unittest.TestCase):
    def test_keeps_only_850_and_700_with_times(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'x.csv'
            p.write_text(csv_text(2, lambda d, h, L: L / 1000))
            f = P.tidy(p)
        self.assertEqual(sorted(f.level.unique()), [700, 850])
        self.assertEqual(len(f), 2 * 4 * 2)
        self.assertEqual(f[(f.level == 850)].value.iloc[0], np.float32(0.85))
        self.assertTrue(pd.api.types.is_datetime64_any_dtype(f.time))

    def test_two_value_columns_are_refused(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'x.csv'
            p.write_text('valid_time,pressureLevel,q,r,latitude,longitude\n2022-08-01 00:00:00,850.0,1,2,33.75,73.0\n')
            with self.assertRaises(RuntimeError):
                P.tidy(p)


class DailyMeans(unittest.TestCase):
    def test_mean_of_four_samples_and_partial_days_dropped(self):
        t = pd.to_datetime(['2022-08-01 00:00', '2022-08-01 06:00', '2022-08-01 12:00', '2022-08-01 18:00', '2022-08-02 00:00', '2022-08-02 06:00'])
        s = P.daily_means(t, [1, 2, 3, 6, 9, 9])
        self.assertEqual(list(s.index), [pd.Timestamp('2022-08-01')])
        self.assertAlmostEqual(s.iloc[0], 3.0)


class Cells(unittest.TestCase):
    def test_cell_rule_matches_merge(self):
        with tempfile.TemporaryDirectory() as t:
            m = Path(t) / 'm.parquet'
            pd.DataFrame({'station_id': ['a', 'a', 'b', 'c'], 'lat': [33.70, 33.70, 33.80, 33.74], 'lon': [73.10, 73.10, 73.12, 73.01]}).to_parquet(m)
            cells = P.station_cells(m)
        self.assertEqual(cells, [(33.75, 73.0)])            # 33.70, 33.80, 33.74 round to 33.75 and 73.10, 73.12, 73.01 to 73.0: one cell for all


class FakeClient:
    """Refuses spans over 400 days as too large, otherwise writes a CSV with one value per day."""
    def __init__(self):
        self.calls = []

    def retrieve(self, dataset, req, target):
        a, b = [pd.Timestamp(x) for x in req['date'][0].split('/')]
        self.calls.append((a, b))
        if (b - a).days > 400:
            raise RuntimeError('Your request is too large, please reduce your selection.')
        rows = ['valid_time,pressureLevel,q,latitude,longitude']
        for d in pd.date_range(a, b):
            for h in (0, 6, 12, 18):
                for L in (850.0, 700.0):
                    rows.append(f'{d:%Y-%m-%d} {h:02d}:00:00,{L},{d.day_of_year},{req["location"]["latitude"]},{req["location"]["longitude"]}')
        Path(target).write_text('\n'.join(rows) + '\n')


class Split(unittest.TestCase):
    def test_too_large_request_is_split_and_the_halves_join_without_gaps_or_overlap(self):
        c = FakeClient()
        with tempfile.TemporaryDirectory() as t:
            f = P.fetch(c, 33.75, 73.0, 'specific_humidity', pd.Timestamp('2020-01-01'), pd.Timestamp('2022-12-31'), Path(t), log=lambda *a: None)
        days = f.time.dt.normalize().drop_duplicates()
        self.assertEqual(len(days), (pd.Timestamp('2022-12-31') - pd.Timestamp('2020-01-01')).days + 1)
        self.assertEqual(len(f), len(days) * 4 * 2)
        self.assertFalse(f.duplicated(['time', 'level']).any())
        self.assertGreater(len(c.calls), 1)


if __name__ == '__main__':
    unittest.main()
