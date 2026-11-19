import test from 'node:test';
import assert from 'node:assert/strict';
import {slimStation, slimFromRealtime, observationTime} from '../public/station-records.js';
import {fetchStationFeed} from '../public/station-feed.js';
import {seedElevation, cachedElevation} from '../public/terrain-source.js';
import {realtimeFromFeed, sanitizeStations} from '../scripts/observation-sync.mjs';
import {COLUMN_COUNT} from '../public/realtime/core.js';

const natural = over => { const r = Array(COLUMN_COUNT).fill(null); for (const [k, v] of Object.entries(over)) r[k] = v; return r; };
const perm = Array.from({length: COLUMN_COUNT}, (_, k) => COLUMN_COUNT - 1 - k), wire = r => perm.map(col => r[col]);
const feedTime = '2026-11-16T06:00:00.000Z';
const davis = natural({0: 7, 1: 'Terrace Grill, Murree', 2: 33.91464, 3: 73.40499, 4: 'Davis', 5: 12, 73: 70, 91: 6, 92: 270, 105: 1.2, 106: 0.4, 121: 0.2, 127: 1011, 161: '11:00 am, 16 November'});

test('the compact station shape comes out of a realtime record with the same fields as before, plus the elevation', () => {
  const s = slimStation(davis, feedTime, null, 2246);
  assert.deepEqual([s.id, s.name, s.network, s.lat, s.lon, s.elevation], ['7', 'Terrace Grill, Murree', 'Davis', 33.91464, 73.40499, 2246]);
  assert.deepEqual([s.temperature, s.humidity, s.wind_speed, s.wind_direction, s.pressure, s.rain_24h, s.rain_daily, s.rain_rate], [12, 70, 6, 270, 1011, 1.2, 0.4, 0.2]);
  assert.equal(s.observed_at, '2026-11-16T11:00:00+05:00'); assert.equal(s.observed_label, '11:00 am, 16 November');
  assert.equal(s.dew_point, null);                                                  // missing stays null
  assert.equal(slimStation(davis, feedTime).elevation, null);                      // no elevation known: null, never zero
});
test('the realtime route and the old direct route give the same stations', () => {
  const rows = [davis, natural({0: 8, 1: 'Karachi Airport', 2: 24.9, 3: 67.17, 4: 'PMD', 5: 29, 161: '10:58 am, 16 November', 13: '08:00 AM, 16 November', 105: 0})];
  const old = sanitizeStations(rows.map(wire), perm, feedTime);
  const viaRealtime = slimFromRealtime(realtimeFromFeed({perm, payload: {rows: rows.map(wire), lastUpdateTime: feedTime}})).stations;
  assert.deepEqual(viaRealtime, old);
});
test('IMD stations of neighbouring countries and stations without a position or name are left out; id-less stations get a stable id', () => {
  const rt = {last_update: feedTime, retrieved_at: feedTime, stations: [
    {v: natural({0: null, 1: 'Srinagar Airport', 2: 34.1, 3: 74.8, 4: 'IMD', 5: 3}), lat: 34.1, lon: 74.8},
    {v: natural({0: null, 1: 'F-10/3, Islamabad', 2: 33.69, 3: 73.01, 4: 'Others', 5: 18, 161: '11:00 am, 16 November'}), lat: 33.69, lon: 73.01},
    {v: natural({0: 9, 1: null, 2: 33, 3: 73, 4: 'Davis'}), lat: 33, lon: 73},
    {v: natural({0: 10, 1: 'Nowhere', 2: 0, 3: 0, 4: 'Davis'}), lat: 0, lon: 0},
  ]};
  const out = slimFromRealtime(rt).stations;
  assert.deepEqual(out.map(s => s.name), ['F-10/3, Islamabad']);
  assert.equal(out[0].id, 'F-10/3, Islamabad|33.69|73.01');
});
test('a station with swapped latitude and longitude is used at its corrected position, not dropped', () => {
  const swapped = natural({0: null, 1: 'Chakri Road, Ladian', 2: 72.87792, 3: 33.40371, 4: 'Davis', 5: 20, 161: '11:00 am, 16 November'});
  const d = realtimeFromFeed({perm, payload: {rows: [wire(swapped)], lastUpdateTime: feedTime}});
  const s = slimFromRealtime(d).stations[0];
  assert.deepEqual([s.lat, s.lon], [33.40371, 72.87792]);
  assert.equal(d.stations[0].lat, 72.87792);                                       // the record itself keeps the feed values
  assert.equal(slimStation(swapped, feedTime), null);                              // without the corrected position it is out of the area
});
test('yearless times still align to the feed time within 48 hours only', () => {
  assert.equal(observationTime('11:00 AM, 16 November', feedTime)[0], '2026-11-16T11:00:00+05:00');          // 11:00 PKT is the feed time itself
  assert.deepEqual(observationTime('02:30 PM, 16 May', feedTime), [null, null]);
});

const realtimeDoc = {source: 'WeatherWalay realtime', retrieved_at: feedTime, last_update: feedTime, stations: [{key: '7', id: 7, name: 'Terrace Grill, Murree', network: 'Davis', lat: 33.91464, lon: 73.40499, map_lat: 33.91464, map_lon: 73.40499, elevation: 2246, v: davis}]};
const respond = (map) => async url => { const hit = Object.entries(map).find(([k]) => String(url).includes(k)); if (!hit || hit[1] === null) return {ok: false, status: 404}; return {ok: true, status: 200, json: async () => hit[1]}; };
test('the portal reads stations from realtime.json first', async () => {
  const urls = [];
  const fetcher = async (u, o) => { urls.push(String(u)); return respond({'realtime.json': realtimeDoc})(u, o); };
  const feed = await fetchStationFeed({fetcher, site: new URL('http://x/observation-data/realtime.json'), remote: 'http://r/realtime.json'});
  assert.equal(feed.stations.length, 1); assert.equal(feed.stations[0].elevation, 2246); assert.equal(feed.legacy_fallback, undefined);
  assert.ok(urls.every(u => u.includes('realtime.json')));                         // nothing else was asked for
});
test('until realtime.json is published, the compact copy of the same feed keeps the portal working, and an abort is not hidden', async () => {
  const legacy = {source: 'WeatherWalay realtime', retrieved_at: feedTime, stations: [{name: 'Old copy', lat: 33, lon: 73}]};
  const fetcher = async u => String(u).includes('realtime.json') ? {ok: false, status: 404} : {ok: true, status: 200, json: async () => legacy};
  const feed = await fetchStationFeed({fetcher});
  assert.equal(feed.legacy_fallback, true); assert.equal(feed.stations[0].name, 'Old copy');
  const none = async () => ({ok: false, status: 404});
  await assert.rejects(fetchStationFeed({fetcher: none}));
  const ac = new AbortController(); ac.abort();
  await assert.rejects(fetchStationFeed({fetcher: none, signal: ac.signal}), /./);
});
test('a station elevation is used as the place height without a lookup, and a height already known is kept', () => {
  seedElevation(33.91, 73.4, 2246); assert.equal(cachedElevation(33.91, 73.4), 2246);
  seedElevation(33.91, 73.4, 100); assert.equal(cachedElevation(33.91, 73.4), 2246);
  seedElevation(33.5, 73.1, null); assert.equal(cachedElevation(33.5, 73.1), undefined);
});
