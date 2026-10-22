import copy
import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('studio',Path(__file__).resolve().parents[1]/'scripts/sync-studio.py')
studio=importlib.util.module_from_spec(spec);spec.loader.exec_module(studio)
class StudioTests(unittest.TestCase):
    def fixtures(self):
        grid={'west':69,'east':70,'south':30,'north':31,'columns':2,'rows':2}
        times=[f'2026-10-22T{i:02}:00' for i in range(24)]
        hourly={field:[270 if field.startswith('wind_direction') else 10 if field.startswith('wind_speed') else 800 if field=='surface_pressure' else 50]*24 for field in studio.FIELDS}
        hourly['time']=times
        units={field:'°' if field.startswith('wind_direction') else 'm/s' if field.startswith('wind_speed') else '°C' if field.startswith('temperature') else 'hPa' if field=='surface_pressure' else 'mm' if field=='rain' else '%' for field in studio.FIELDS}
        coords=studio.coordinates(grid)
        points=[{'latitude':lat,'longitude':lon,'utc_offset_seconds':0,'hourly':copy.deepcopy(hourly),'hourly_units':units.copy()} for lat,lon in coords]
        points[-1]['hourly']['surface_pressure']=[950]*24
        return grid,coords,points
    def test_real_field_conversion_and_below_ground_mask(self):
        grid,coords,points=self.fixtures();result=studio.build(points,coords,grid)
        self.assertEqual(result['model'],'ecmwf_ifs025');self.assertEqual(result['levels']['surface']['u'][0][0],10);self.assertEqual(result['levels']['surface']['v'][0][0],0)
        self.assertIsNone(result['levels']['850']['u'][0][0]);self.assertEqual(result['levels']['500']['u'][0][0],10);self.assertTrue(result['times'][0].endswith('Z'));self.assertEqual(result['rain'][0][0],50);self.assertEqual(result['units']['rain'],'mm')
    def test_bad_units_or_mismatched_hours_cannot_be_published(self):
        grid,coords,points=self.fixtures();points[0]['hourly_units']['wind_speed_10m']='km/h'
        with self.assertRaises(ValueError):studio.build(points,coords,grid)
        grid,coords,points=self.fixtures();points[1]['hourly']['time'][1]='2026-10-22T03:00'
        with self.assertRaises(ValueError):studio.build(points,coords,grid)
    def test_recent_shared_snapshot_skips_upstream_grid_requests(self):
        import json,tempfile
        from datetime import datetime,timedelta,timezone
        from unittest.mock import patch
        actual=json.loads((Path(__file__).resolve().parents[1]/'public/studio-data/forecast.json').read_text());now=datetime.now(timezone.utc)
        actual['retrieved_at']=now.isoformat();actual['times']=[(now+timedelta(hours=i)).isoformat().replace('+00:00','Z') for i in range(48)]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'forecast.json';path.write_text(json.dumps(actual))
            with patch.dict(studio.os.environ,{'PREVIOUS_STUDIO_URL':''}),patch.object(studio,'get') as upstream:
                self.assertTrue(studio.sync(path));upstream.assert_not_called()
    def test_failed_refresh_preserves_only_previous_real_fields(self):
        import json,tempfile
        from datetime import datetime,timedelta,timezone
        from unittest.mock import patch
        actual=json.loads((Path(__file__).resolve().parents[1]/'public/studio-data/forecast.json').read_text());now=datetime.now(timezone.utc)
        actual['retrieved_at']=(now-timedelta(hours=7)).isoformat();actual['times']=[(now+timedelta(hours=i)).isoformat().replace('+00:00','Z') for i in range(48)]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'forecast.json';path.write_text(json.dumps(actual))
            with patch.dict(studio.os.environ,{'PREVIOUS_STUDIO_URL':''}),patch.object(studio,'get',side_effect=OSError('offline')):
                self.assertFalse(studio.sync(path))
            result=json.loads(path.read_text());self.assertEqual(result['status'],'cached');self.assertEqual(result['levels'],actual['levels']);self.assertEqual(result['retrieved_at'],actual['retrieved_at'])
