// Coordinates typed in the explorer's search box (parseLatLon, inForecastArea in public/explorer/core.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLatLon, inForecastArea} from '../public/explorer/core.js';

const is = (text, lat, lon) => { const r = parseLatLon(text); assert.ok(r, `"${text}" should parse`); assert.ok(Math.abs(r.lat - lat) < 1e-9 && Math.abs(r.lon - lon) < 1e-9, `"${text}" gave ${JSON.stringify(r)}`); };

test('plain decimal degrees, latitude first', () => {
  is('35.3254, 75.5322', 35.3254, 75.5322); is('35.3254 75.5322', 35.3254, 75.5322); is('  35.3254,75.5322  ', 35.3254, 75.5322); is('35.3254; 75.5322', 35.3254, 75.5322);
  is('-33.9 18.4', -33.9, 18.4); is('35 75', 35, 75);
});
test('N/S/E/W letters fix which number is which and the sign', () => {
  is('35.3254N 75.5322E', 35.3254, 75.5322); is('35.3254°N, 75.5322°E', 35.3254, 75.5322); is('N35.3254 E75.5322', 35.3254, 75.5322);
  is('75.5322E, 35.3254N', 35.3254, 75.5322); is('E75.5322 N35.3254', 35.3254, 75.5322); is('33.9 S 18.4 E', -33.9, 18.4); is('40.7N 74.0W', 40.7, -74);
});
test('longitude typed first is recognised only where it cannot be a latitude of the area', () => {
  is('75.5322, 35.3254', 35.3254, 75.5322);        // 75.5 is not a latitude of the forecast area, 35.3 is no longitude of it: swapped
  is('120.5, 30', 30, 120.5);                        // above 90 cannot be a latitude
  is('30, 70', 30, 70);                              // a valid pair in the usual order stays
  is('35.3254, 75.5322', 35.3254, 75.5322);
});
test('text that is not a coordinate pair is not parsed', () => {
  for (const t of ['Skardu', '', '35.3254', '35.3 75.5 12', 'N35.3 N75.5', '35.3N 75.5', 'Skardu 35 75', '95, 200', '35.3 E 75.5 E', null, undefined, 42]) assert.equal(parseLatLon(t), null, String(t));
});
test('forecast area is 60 to 78 E and 23 to 38 N', () => {
  assert.ok(inForecastArea(35.3254, 75.5322)); assert.ok(inForecastArea(23, 60)); assert.ok(inForecastArea(38, 78));
  assert.ok(!inForecastArea(34.15, 78.6)); assert.ok(!inForecastArea(39, 70)); assert.ok(!inForecastArea(30, 59.9));
});
