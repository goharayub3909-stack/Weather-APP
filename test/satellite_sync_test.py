import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('sync_satellite',Path(__file__).parents[1]/'scripts/sync-satellite.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
XML=b'''<WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0"><Capability><Layer><CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS><EX_GeographicBoundingBox><westBoundLongitude>-35</westBoundLongitude><eastBoundLongitude>118</eastBoundLongitude><southBoundLatitude>-77</southBoundLatitude><northBoundLatitude>77</northBoundLatitude></EX_GeographicBoundingBox><Dimension name="time" default="2026-10-22T08:00:00Z">2026-10-22T07:00:00Z/2026-10-22T08:00:00Z/PT15M</Dimension><Layer><Name>msg_iodc:rgb_natural</Name><Title>Natural Colour RGB - Indian Ocean</Title></Layer><Layer><Name>backgrounds:naturalearth</Name><Title>NaturalEarth Background</Title></Layer><Layer><Name>elsewhere:rgb_natural</Name><Title>Natural Colour RGB - elsewhere</Title><EX_GeographicBoundingBox><westBoundLongitude>-100</westBoundLongitude><eastBoundLongitude>-30</eastBoundLongitude><southBoundLatitude>0</southBoundLatitude><northBoundLatitude>70</northBoundLatitude></EX_GeographicBoundingBox></Layer></Layer></Capability></WMS_Capabilities>'''

class SatelliteTests(unittest.TestCase):
 def test_inherits_geometry_time_and_crs_and_excludes_backgrounds(self):
  layers=module.parse_capabilities(XML)
  self.assertEqual(len(layers),1);self.assertEqual(layers[0]['name'],'msg_iodc:rgb_natural');self.assertEqual(layers[0]['crs'],'EPSG:3857');self.assertEqual(len(layers[0]['times']),5);self.assertEqual(layers[0]['times'][-1],'2026-10-22T08:00:00Z')
 def test_interval_alignment_and_invalid_times(self):
  self.assertEqual(module.recent_times('2026-10-22T07:00:00Z/2026-10-22T07:37:00Z/PT15M')[-1],'2026-10-22T07:30:00Z')
  self.assertEqual(module.recent_times('2026-10-22T07:00:00Z/2026-10-22T08:00:00Z/PT0M'),[])
  self.assertEqual(module.recent_times('current'),[])
  self.assertEqual(module.recent_times('2026-10-22T07:00:00'),[])
 def test_retained_discovered_layers_on_failure(self):
  import tempfile,json
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/'catalog.json';self.assertTrue(module.sync(p,XML));self.assertFalse(module.sync(p,b'<invalid/>'));self.assertEqual(json.loads(p.read_text())['layers'][0]['name'],'msg_iodc:rgb_natural');self.assertEqual(json.loads(p.read_text())['status'],'cached')
