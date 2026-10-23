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
    def test_rainfall_periods_rates_and_zero_values_are_preserved(self):
        row=[None]*178;row[0]=1;row[1]='Rain gauge';row[2]=33.7;row[3]=73;row[4]='PMD';row[105]=5.2;row[106]=0;row[107]=18;row[108]=210;row[109]=100;row[121]=0;row[122]=1.2;row[123]=30;row[124]='09:00 AM, 23 October';row[13]='08:00 AM, 23 October';row[161]='10:30 AM, 23 October'
        p=stations.sanitize([row],list(range(178)),'2026-10-23T05:36:00Z')[0]
        self.assertEqual(p['rain_daily'],0);self.assertEqual(p['rain_24h'],5.2);self.assertEqual(p['rain_monthly'],18);self.assertEqual(p['rain_rate'],0);self.assertEqual(p['rain_rate_instant'],1.2);self.assertNotIn('rain_weekly',p);self.assertIn('02:00',p['rain_daily_period']);self.assertEqual(p['observed_at'],'2026-10-23T10:30:00+05:00')
        row[107]=-999;p=stations.sanitize([row],list(range(178)))[0];self.assertIsNone(p['rain_monthly'])
    def test_yearless_labels_require_a_feed_anchor_and_cannot_make_old_reports_fresh(self):
        self.assertEqual(stations.observation_time('10:30 AM, 23 October')[0],None)
        self.assertEqual(stations.observation_time('10:30 AM, 17 October','2026-10-23T05:36:00Z')[0],None)
        self.assertEqual(stations.observation_time('11:30 PM, 31 December','2027-01-01T00:00:00Z')[0],'2026-12-31T23:30:00+05:00')
        self.assertEqual(stations.observation_time('11:30 AM, 23 October','2026-10-23T05:36:00Z')[0],None)
