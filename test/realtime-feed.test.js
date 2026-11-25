import test from 'node:test';
import assert from 'node:assert/strict';
import {realtimeFromFeed, mapPosition, stationKey} from '../scripts/observation-sync.mjs';
import {fillElevations} from '../scripts/station-elevation.mjs';
import {COLUMN_COUNT} from '../public/realtime/core.js';

// A tiny feed in the provider's wire order: perm[k] is the natural column of wire position k (here a simple reversal).
const perm = Array.from({length: COLUMN_COUNT}, (_, k) => COLUMN_COUNT - 1 - k);
const wire = natural => perm.map(col => natural[col] ?? null);
const natural = (over) => { const r = Array(COLUMN_COUNT).fill(null); for (const [k, v] of Object.entries(over)) r[k] = v; return r; };
const feed = rows => ({perm, payload: {rows: rows.map(wire), lastUpdateTime: '2026-11-16T05:54:08.699Z'}});

test('every station and every column is kept in natural order, with the feed time', () => {
  const d = realtimeFromFeed(feed([natural({0: 41678, 1: 'Bahawalnagar', 2: 29.98452, 3: 73.249848, 4: 'PMD', 5: 21.5, 7: '05:00 PM, 12 November', 161: '10:35 am, 16 November'})]));
  assert.equal(d.stations.length, 1);
  const s = d.stations[0];
  assert.deepEqual([s.id, s.name, s.network, s.lat, s.lon], [41678, 'Bahawalnagar', 'PMD', 29.98452, 73.249848]);
  assert.equal(s.v.length, COLUMN_COUNT); assert.equal(s.v[5], 21.5); assert.equal(s.v[7], '05:00 PM, 12 November'); assert.equal(s.v[161], '10:35 am, 16 November');
  assert.equal(s.v[6], null);                                                       // missing stays null
  assert.equal(d.columns.length, COLUMN_COUNT); assert.equal(d.last_update, '2026-11-16T05:54:08.699Z');
  assert.equal(s.elevation, null); assert.equal(s.elevation_source, null);          // no elevation until one is looked up
});
test('IMD and id-less stations are kept, and names are not altered', () => {
  const d = realtimeFromFeed(feed([natural({0: null, 1: 'Srinagar Airport', 2: 34.1497, 3: 74.8822, 4: 'IMD'}), natural({0: null, 1: 'DHA , Islamabad ', 2: 33.53, 3: 73.14, 4: 'Others'})]));
  assert.equal(d.stations.length, 2);
  assert.equal(d.stations[1].name, 'DHA , Islamabad ');                              // exactly as given, trailing space included
  assert.notEqual(d.stations[0].key, d.stations[1].key);                           // no id: the key is name and position
  assert.equal(stationKey([null, 'A', 1, 2]), 'A|1|2'); assert.equal(stationKey([55, 'A', 1, 2]), '55');
});
test('swapped latitude and longitude are flagged and fixed only for the map, never in the data', () => {
  assert.deepEqual(mapPosition(72.87792, 33.40371), {lat: 33.40371, lon: 72.87792, note: 'Latitude and longitude look swapped in the feed; the map uses them the other way round'});
  assert.equal(mapPosition(33.4, 72.9).note, null); assert.equal(mapPosition(22.4667, 70.05).note, null);      // Jamnagar is a real station outside Pakistan
  const s = realtimeFromFeed(feed([natural({0: null, 1: 'Chakri Road, Ladian', 2: 72.87792, 3: 33.40371, 4: 'Davis'})])).stations[0];
  assert.deepEqual([s.lat, s.lon, s.map_lat, s.map_lon], [72.87792, 33.40371, 33.40371, 72.87792]);
  assert.match(s.position_note, /swapped/);
});
test('elevations use the stable key and the map position, only for stations not already known', async () => {
  const stations = [{key: 'a', lat: 30, lon: 70}, {key: 'b|1|2', lat: 31, lon: 71}, {key: 'c', lat: 32, lon: 72}], cache = new Map([['c', 400]]), urls = [];
  const fetcher = async url => { urls.push(String(url)); return {ok: true, status: 200, json: async () => ({elevation: [100.04, 250]})}; };
  const found = await fillElevations(stations, cache, {fetcher, pause: 0});
  assert.equal(found, 2); assert.equal(urls.length, 1);
  assert.match(urls[0], /latitude=30\.00000%2C31\.00000/); assert.match(urls[0], /longitude=70\.00000%2C71\.00000/);
  assert.deepEqual([cache.get('a'), cache.get('b|1|2'), cache.get('c')], [100, 250, 400]);
  const none = await fillElevations(stations, cache, {fetcher, pause: 0});         // all known: no request
  assert.equal(none, 0); assert.equal(urls.length, 1);
});
test('a failed elevation batch leaves those stations without a height instead of guessing', async () => {
  const cache = new Map(), fetcher = async () => ({ok: false, status: 400, json: async () => ({})});
  assert.equal(await fillElevations([{key: 'x', lat: 1, lon: 2}], cache, {fetcher, pause: 0}), 0);
  assert.equal(cache.has('x'), false);
  const short = async () => ({ok: true, status: 200, json: async () => ({elevation: [1]})});            // wrong length: not trusted
  assert.equal(await fillElevations([{key: 'x', lat: 1, lon: 2}, {key: 'y', lat: 3, lon: 4}], cache, {fetcher: short, pause: 0}), 0);
});
