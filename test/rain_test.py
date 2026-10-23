import unittest,importlib.util,json,copy,tempfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('rain_sync',Path(__file__).resolve().parents[1]/'scripts/sync-studio-rain.py')
rain=importlib.util.module_from_spec(spec);spec.loader.exec_module(rain)
class RainSnapshot(unittest.TestCase):
 def test_rejects_missing_units_and_invalid_times_or_cells(self):
  actual=json.loads((Path(__file__).resolve().parents[1]/'public/studio-data/rain.json').read_text());self.assertTrue(rain.valid(actual))
  for key,value in [('units','in'),('times',actual['times'][:-1]),('rain',[[None]])]:
   data=copy.deepcopy(actual);data[key]=value;self.assertFalse(rain.valid(data))
 def test_network_failure_keeps_actual_previous_file(self):
  actual=json.loads((Path(__file__).resolve().parents[1]/'public/studio-data/rain.json').read_text());actual['retrieved_at']='2020-01-01T00:00:00+00:00'
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'rain.json';path.write_text(json.dumps(actual))
   with patch.object(rain,'get',side_effect=OSError('offline')),patch.dict(rain.os.environ,{'PREVIOUS_RAIN_URL':''}):self.assertFalse(rain.sync(path))
   self.assertEqual(json.loads(path.read_text()),actual)
