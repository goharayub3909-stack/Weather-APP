import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainProfile, representative, ringPoints} from '../public/terrain-source.js';
import {chooseCurrentSource, distanceKm} from '../public/current-weather.js';

const now = Date.parse('2026-11-10T10:00:00Z');
const ago = m => new Date(now - m * 60000).toISOString();

test('terrain classes follow local relief', () => {
  assert.equal(terrainProfile(30, [25, 40, 35]).name, 'plain');
  assert.equal(terrainProfile(520, [400, 700, 560]).name, 'hilly');          // relief 300
  const murree = terrainProfile(2200, [900, 1400, 2300, 1800]);               // relief 1400
  assert.equal(murree.name, 'mountainous');
  assert.equal(murree.dz, 100);
  assert.equal(terrainProfile(null, []), null);
});

test('ring points are 10 km from the place', () => {
  const pts = ringPoints(33.9, 73.4);
  assert.equal(pts.length, 9);
  const d = ([la, lo]) => distanceKm(33.9, 73.4, {lat: la, lon: lo});
  for (const p of pts.slice(1)) assert.ok(Math.abs(d(p) - 10) < 0.1);
});

test('a report must match in height in hills, and may be close only on plains', () => {
  const murree = terrainProfile(2200, [900, 1400, 2300, 1800]);
  assert.equal(representative(murree, 'metar', 20, 508), false);               // Islamabad airport: 1.7 km lower
  assert.equal(representative(murree, 'station', 8, 2150), true);              // a Murree station 50 m lower
  assert.equal(representative(murree, 'station', 8, 2400), false);             // 200 m higher: over the 100 m limit
  assert.equal(representative(murree, 'station', 30, 2200), false);            // same height but 30 km away
  assert.equal(representative(murree, 'station', 1, 2444), true);              // Terrace Grill: 1 km away, 244 m higher on the same ridge town
  assert.equal(representative(murree, 'station', 1, 2600), false);             // still not 400 m
  assert.equal(representative(murree, 'station', 8, undefined), false);        // unknown height is not trusted in hills
  const lahore = terrainProfile(215, [210, 220, 214]);
  assert.equal(representative(lahore, 'station', 45, 190), true);
  assert.equal(representative(lahore, 'station', 45, undefined), true);
  assert.equal(representative(lahore, 'metar', 101, 215), false);
  assert.equal(representative(null, 'station', 49, undefined), true);          // no height data: older distance rule
});

test('Murree is not served from Islamabad: station and airport skipped, ECMWF used', () => {
  const place = [33.9068, 73.3943], profile = terrainProfile(2200, [900, 1400, 2300, 1800]);
  const heights = new Map([['Islamabad stn', 540], ['OPIS', 508], ['Terrace Grill', 2210]]);
  const elevationOf = p => heights.get(p.name || p.icaoId);
  const stations = {stations: [
    {name: 'Islamabad stn', lat: 33.72, lon: 73.07, observed_at: ago(5), temperature: 24, humidity: 40, wind_speed: 4, rain_daily: 0, pressure: 1010},
    {name: 'Terrace Grill', lat: 33.915, lon: 73.405, observed_at: ago(4), temperature: 12, humidity: 70},
  ]};
  const metars = {stations: [{icaoId: 'OPIS', lat: 33.55, lon: 72.82, obsTime: (now - 20 * 60000) / 1000, temp: 23, dewp: 10, altim: 1018}]};
  const hill = chooseCurrentSource(...place, stations, metars, now, {profile, elevationOf});
  assert.equal(hill.name, 'Terrace Grill');
  assert.equal(hill.report.temperature, 12);
  // without the Murree station the chain must end at ECMWF, not Islamabad
  const noLocal = chooseCurrentSource(...place, {stations: [stations.stations[0]]}, metars, now, {profile, elevationOf});
  assert.equal(noLocal.kind, 'forecast');
  assert.equal(noLocal.terrain.name, 'mountainous');
  // the old distance-only rule is unchanged when no terrain is given
  assert.notEqual(chooseCurrentSource(...place, {stations: [stations.stations[0]]}, metars, now).kind, 'forecast');
});

