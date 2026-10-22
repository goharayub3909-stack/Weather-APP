import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('metar',Path(__file__).resolve().parents[1]/'scripts/sync-metar.py')
metar=importlib.util.module_from_spec(spec);spec.loader.exec_module(metar)
class MetarTests(unittest.TestCase):
    def test_only_valid_pakistan_airports_and_latest_report_are_published(self):
        valid={'icaoId':'OPIS','lat':33.55,'lon':72.82,'obsTime':100,'temp':None,'rawOb':'METAR OPIS'}
        rows=[valid,{**valid,'obsTime':200,'temp':26,'private':'excluded'},{**valid,'icaoId':'VIDP'},{**valid,'lat':0},{**valid,'obsTime':None}]
        result=metar.sanitize(rows)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['obsTime'],200);self.assertEqual(result[0]['temp'],26);self.assertNotIn('private',result[0])

station_spec=importlib.util.spec_from_file_location('stations',Path(__file__).resolve().parents[1]/'scripts/sync-stations.py')
stations=importlib.util.module_from_spec(station_spec);station_spec.loader.exec_module(stations)
class StationTests(unittest.TestCase):
    def test_permutation_measurements_and_no_invented_dates(self):
        row=[None]*178;row[0]=1;row[1]='Islamabad';row[2]=33.68;row[3]=73.05;row[4]='AWS';row[5]=26;row[73]=60;row[91]=10;row[92]=180;row[161]='07:20 pm, 17 October'
        perm=list(reversed(range(178)));wire=[row[i] for i in perm]
        result=stations.sanitize([wire],perm)[0]
        self.assertEqual(result['temperature'],26);self.assertEqual(result['humidity'],60);self.assertIsNone(result['observed_at']);self.assertEqual(result['observed_label'],row[161]);self.assertNotIn('token',result)
        row[4]='IMD';self.assertEqual(stations.sanitize([[row[i] for i in perm]],perm),[])
