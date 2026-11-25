import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMetar, sanitizeStations, observationTime, liveObservation} from '../scripts/observation-sync.mjs';

test('only valid Pakistan airports and the latest report per airport are kept', () => {
  const valid = {icaoId: 'OPIS', lat: 33.55, lon: 72.82, obsTime: 100, temp: null, rawOb: 'METAR OPIS'};
  const rows = [valid, {...valid, obsTime: 200, temp: 26, private: 'excluded'}, {...valid, icaoId: 'VIDP'}, {...valid, lat: 0}, {...valid, obsTime: null}];
  const result = sanitizeMetar(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].obsTime, 200);
  assert.equal(result[0].temp, 26);
  assert.ok(!('private' in result[0]));
});

const blank = (n = 178) => Array(n).fill(null);
test('station permutation, measurements and no invented dates', () => {
  const row = blank(); Object.assign(row, {0: 1, 1: 'Islamabad', 2: 33.68, 3: 73.05, 4: 'AWS', 5: 26, 73: 60, 91: 10, 92: 180, 161: '07:20 pm, 17 October'});
  const perm = [...row.keys()].reverse(), wire = perm.map(i => row[i]);
  const p = sanitizeStations([wire], perm)[0];
  assert.equal(p.temperature, 26);
  assert.equal(p.humidity, 60);
  assert.equal(p.observed_at, null);                       // a yearless label with no feed anchor stays undated
  assert.equal(p.observed_label, '07:20 pm, 17 October');
  row[4] = 'IMD';
  assert.deepEqual(sanitizeStations([perm.map(i => row[i])], perm), []);
  assert.throws(() => sanitizeStations([], [0, 1, 2]), /Unsupported/);
});

test('rain totals keep zero and drop impossible values', () => {
  const row = blank(); Object.assign(row, {0: 1, 1: 'Rain gauge', 2: 33.7, 3: 73, 4: 'PMD', 105: 5.2, 106: 0, 107: 18, 108: 210, 109: 100, 121: 0, 122: 1.2, 123: 30, 124: '09:00'});
  const p = sanitizeStations([row], [...row.keys()], '2026-10-23T05:36:00Z')[0];
  assert.deepEqual([p.rain_daily, p.rain_24h, p.rain_monthly, p.rain_rate, p.rain_rate_instant], [0, 5.2, 18, 0, 1.2]);
  assert.equal(p.rain_daily_period, '02:00–02:00 PKT (provider day)');
  row[107] = -999;
  assert.equal(sanitizeStations([row], [...row.keys()])[0].rain_monthly, null);
});

test('yearless labels need a feed anchor and cannot make old reports look fresh', () => {
  assert.equal(observationTime('10:30 AM, 23 October')[0], null);
  assert.equal(observationTime('10:30 AM, 17 October', '2026-10-23T05:36:00Z')[0], null);   // 6 days before the feed
  assert.equal(observationTime('11:30 PM, 31 December', '2027-01-01T00:00:00Z')[0], '2026-12-31T23:30:00+05:00');
  assert.equal(observationTime('11:30 AM, 23 October', '2026-10-23T05:36:00Z')[0], null);   // after the feed time
  assert.equal(observationTime('10:30 AM, 23 October', '2026-10-23T05:36:00Z')[0], '2026-10-23T10:30:00+05:00');
  assert.equal(observationTime('12:05 AM, 23 October', '2026-10-23T05:36:00Z')[0], '2026-10-23T00:05:00+05:00');
  assert.equal(observationTime('12:05 PM, 23 October', '2026-10-23T08:00:00Z')[0], '2026-10-23T12:05:00+05:00');
  assert.equal(observationTime('10:30 AM, 31 February', '2026-03-01T05:36:00Z')[0], null);
  assert.deepEqual(observationTime('2026-10-23T05:30:00Z'), ['2026-10-23T05:30:00.000Z', 'Explicit provider timestamp']);
  assert.deepEqual(observationTime(null, 'x'), [null, null]);
});

test('without a WeatherWalay login the newest published copy is served, and nothing is cached on failure', async () => {
  const old = {retrieved_at: '2026-10-23T05:45:00Z', stations: [{id: 'old'}]}, fresh = {retrieved_at: '2026-10-29T02:30:00Z', stations: [{id: 'new'}]};
  const fetcher = async url => String(url).includes('raw.githubusercontent.com') ? {ok: true, json: async () => old} : {ok: true, json: async () => fresh};
  const got = await liveObservation('stations', {env: {}, fetcher, now: 1});
  assert.equal(got.stations[0].id, 'new');
  const down = async () => { throw Error('offline'); };
  assert.equal(await liveObservation('metar', {env: {}, fetcher: down, now: 10 ** 9}), null);
});

test('a stale copy is served at once while the refresh runs in the background', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const fetcher = async url => {
    if (String(url).includes('aviationweather')) { calls++; if (calls > 1) await gate; return {ok: true, json: async () => [{icaoId: 'OPIS', lat: 33.5, lon: 72.8, obsTime: calls, temp: 20 + calls}]}; }
    return {ok: false, status: 500};
  };
  const first = await liveObservation('metar', {env: {}, fetcher, now: 2 * 10 ** 12});
  assert.equal(first.stations[0].temp, 21);
  const second = await liveObservation('metar', {env: {}, fetcher, now: 2 * 10 ** 12 + 3 * 60000});   // expired: returns the old copy without waiting
  assert.equal(second.stations[0].temp, 21);
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  const third = await liveObservation('metar', {env: {}, fetcher, now: 2 * 10 ** 12 + 3 * 60000 + 1000});   // refreshed copy is now cached
  assert.equal(third.stations[0].temp, 22);
  assert.equal(calls, 2);
});
