import unittest,importlib.util,json,tempfile,csv,io
from pathlib import Path
from datetime import datetime,timedelta,timezone
spec=importlib.util.spec_from_file_location('station_archive',Path(__file__).resolve().parents[1]/'scripts/archive-stations.py');archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime(2026,10,23,6,0,tzinfo=timezone.utc);self.station={'id':'1','name':'Farm','lat':31,'lon':73,'temperature':25,'humidity':90,'rain_daily':0,'observed_at':(self.now-timedelta(hours=1)).isoformat()}
 def test_stores_only_new_sanitized_reports_and_keeps_observation_and_capture_times(self):
  snapshot={'status':'updated','stations':[{**self.station,'password':'DO_NOT_STORE','token':'DO_NOT_STORE'}]};rows,n=archive.append_snapshot([],snapshot,self.now);self.assertEqual(n,1);self.assertNotIn('password',rows[0]['station']);self.assertNotEqual(rows[0]['captured_at'],rows[0]['station']['observed_at']);self.assertEqual(rows[0]['station']['rain_daily'],0)
  again,n=archive.append_snapshot(rows,snapshot,self.now+timedelta(minutes=30));self.assertEqual(n,0);self.assertEqual(again,rows)
  self.assertEqual(archive.append_snapshot(rows,{**snapshot,'status':'cached'},self.now)[1],0)
 def test_hourly_history_has_no_forward_fill_and_selects_latest_observation(self):
  early={**self.station,'observed_at':(self.now-timedelta(minutes=55)).isoformat(),'temperature':20};late={**self.station,'observed_at':(self.now-timedelta(minutes=5)).isoformat(),'temperature':28};unknown={**self.station,'observed_at':None,'temperature':40}
  rows=[{'captured_at':self.now.isoformat(),'station':s}for s in [early,late,unknown]]
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);m=archive.publish_recent(rows,root,self.now,'https://example.org');self.assertEqual(m['stations'][0]['hours'],1);data=json.loads((root/m['stations'][0]['file']).read_text());self.assertEqual(data['hourly']['temperature_2m'],[28]);self.assertEqual(len(data['hourly']['time']),1)
 def test_csv_preserves_unknown_time_and_protects_spreadsheet_text(self):
  s={**self.station,'name':'=DANGEROUS()','observed_at':None};r={'captured_at':self.now.isoformat(),'station':s}
  with tempfile.TemporaryDirectory() as folder:
   archive.publish_recent([r],Path(folder),self.now,'https://example.org');rows=list(csv.DictReader(io.StringIO((Path(folder)/'recent.csv').read_text())));self.assertEqual(rows[0]['name'],"'=DANGEROUS()");self.assertEqual(rows[0]['observed_at'],'')
