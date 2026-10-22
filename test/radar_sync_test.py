import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('sync_radar', Path(__file__).parents[1] / 'scripts/sync-radar.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CATALOG = json.loads((Path(__file__).parents[1] / 'public/radar-data/catalog.json').read_text())

class RadarSyncTests(unittest.TestCase):
    def test_refresh_failure_retains_catalog_and_exposes_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(CATALOG))
            def fail(station):
                raise OSError('unavailable')
            self.assertEqual(module.sync(path, fail), 0)
            result = json.loads(path.read_text())
            for station in module.STATIONS:
                self.assertEqual(result['stations'][station]['frames'], CATALOG['stations'][station]['frames'])
                self.assertEqual(result['stations'][station]['status'], 'cached')
                self.assertTrue(result['stations'][station]['attempted_at'])

    def test_valid_refresh_updates_stations_and_rejects_invalid_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            def fetch(station):
                source = CATALOG['stations'][station]
                return {'radarSites': [source['site']], 'radarImages': source['frames'] + [{'radarSiteId': station, 'radius': '450', 'url': 'https://unexpected.example/a.png', 'datetime': '2026-10-22 12:00', 'product': 'invalid'}]}
            self.assertEqual(module.sync(path, fetch), 2)
            result = json.loads(path.read_text())
            self.assertTrue(result['synced_at'])
            for station in module.STATIONS:
                self.assertEqual(result['stations'][station]['status'], 'updated')
                self.assertEqual(len(result['stations'][station]['frames']), len(CATALOG['stations'][station]['frames']))

if __name__ == '__main__':
    unittest.main()
