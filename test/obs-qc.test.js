import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qcCheck, qcRealtime, readingsFromRealtime, spatialExpectation, haversineKm, median, RULES, REALTIME_COLUMNS} from '../scripts/obs-qc.mjs';
import {parseLabel} from '../public/realtime/core.js';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/qc-vectors.json', import.meta.url), 'utf8'));
const flat = flags => Object.fromEntries(Object.entries(flags).flatMap(([k, ps]) => Object.entries(ps).map(([p, l]) => [`${k}|${p}`, l.map(f => f.rule).sort()])));

// The same vectors run in downscaler/tests/test_obs_qc.py: the JS and Python implementations must agree.
for (const c of vectors.cases) {
  test('qc vector: ' + c.name, () => {
    const {flags, state} = qcCheck(c.readings, {state: structuredClone(c.state)});
    assert.deepEqual(flat(flags), c.expect.flags);
    for (const [k, want] of Object.entries(c.expect.state || {})) {
      const [key, param] = k.split('|');
      assert.equal(state[key]?.[param]?.v, want.v, k + ' reference value');
      assert.equal(state[key]?.[param]?.run, want.run, k + ' run count');
    }
    for (const k of c.expect.no_state || []) { const [key, param] = k.split('|'); assert.equal(state[key]?.[param], undefined, k + ' must not enter the state'); }
  });
}

test('spatial expectation: neighbours are brought to the station height with the 6.5 degC/km lapse rate', () => {
  const spec = RULES.params.temperature.spatial, T0 = 1700000000000;
  const at = (key, value, z, lat) => ({key, param: 'temperature', value, time: T0, lat, lon: 73, z});
  const me = at('me', 10, 600, 34.0);
  const e = spatialExpectation(me, [at('a', 20, 0, 34.05), at('b', 21, 0, 34.1), at('c', 19, 0, 33.95)], spec);
  assert.equal(e.n, 3);
  assert.ok(Math.abs(e.expected - (20 - 6.5 * 0.6)) < 1e-12);                           // median 20 at sea level is 16.1 at 600 m
  assert.ok(Math.abs(e.residual - (10 - 16.1)) < 1e-12);
  assert.ok(Math.abs(e.scale - 1.4826) < 1e-9);                                          // MAD of 16.1, 17.1, 15.1 is 1 degC
  assert.equal(spatialExpectation(me, [at('me', 20, 0, 34.05), at('a', 20, 0, 34.05)], spec), null);   // itself does not count, one neighbour is too few
  assert.equal(spatialExpectation({...me, z: null}, [at('a', 20, 0, 34.05)], spec), null);             // no height, no judgement
});

test('helpers: distance and median', () => {
  assert.ok(Math.abs(haversineKm(34, 73, 35, 73) - 111.19) < 0.1);
  assert.equal(haversineKm(34, 73, 34, 73), 0);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 3, 2]), 2.5);
});

// ---- realtime.json wrapper ----
const NOW = Date.parse('2026-11-17T12:30:00Z');                                           // 17:30 PKT
const LABEL = '05:20 pm, 17 November';
const row = (key, name, lat, lon, elevation, temp, patch = {}) => {
  const v = Array(178).fill(null);
  v[5] = temp; v[24] = LABEL; v[25] = temp - 5; v[32] = LABEL; v[73] = 50; v[80] = LABEL; v[127] = 900; v[162] = LABEL; v[91] = 5; v[92] = 90; v[161] = LABEL; v[121] = 0;
  return {key, id: key, name, network: 'Davis', lat, lon, elevation, v: Object.assign(v, patch)};
};
const doc = () => ({last_update: 'x', columns: [], stations: [
  row('s1', 'Plains one', 34.0, 73.0, 500, 22.4), row('s2', 'Plains two', 34.05, 73.0, 500, 22.6), row('s3', 'Plains three', 34.1, 73.0, 500, 22.5),
  row('s4', 'Plains four', 33.95, 73.0, 500, 22.7), row('bad', 'Cold sensor', 34.0, 73.05, 500, 9.0, {25: 4.0}),
  row('s6', 'Far away', 30.0, 70.0, 100, 31.0, {91: 999, 127: 81.6}),
]});

test('readings of realtime.json use each parameter\'s own column and sync label', () => {
  assert.deepEqual(Object.keys(REALTIME_COLUMNS), ['temperature', 'dew_point', 'humidity', 'pressure', 'wind_speed', 'wind_direction', 'rain_rate', 'rain_24h']);
  const rs = readingsFromRealtime(doc(), parseLabel, NOW);
  const t = rs.find(r => r.key === 's1' && r.param === 'temperature');
  assert.equal(t.value, 22.4); assert.equal(t.z, 500); assert.equal(t.time, Date.parse('2026-11-17T12:20:00Z'));
  assert.equal(rs.filter(r => r.key === 's1').length, 7);                       // the test rows have no 24 h rain
  assert.equal(readingsFromRealtime({stations: [{key: 'x', lat: null, lon: 73, v: Array(178).fill(1)}]}, parseLabel, NOW).length, 0);   // no position: nothing to judge
});

test('qcRealtime marks flagged stations, keeps every value, and reports each flag', () => {
  const data = doc(), before = JSON.stringify(data.stations.map(s => s.v));
  const {report, state} = qcRealtime(data, {parseLabel, now: NOW});
  assert.equal(JSON.stringify(data.stations.map(s => s.v)), before);                    // flagged readings are retained, not removed
  const bad = data.stations.find(s => s.key === 'bad'), far = data.stations.find(s => s.key === 's6');
  assert.deepEqual(bad.qc, {temperature: ['spatial']});                                  // 13.6 degC under four neighbours at the same height
  assert.deepEqual(far.qc, {pressure: ['range'], wind_speed: ['range']});
  assert.equal(data.stations.find(s => s.key === 's1').qc, undefined);
  assert.equal(data.qc.flagged, 3); assert.equal(data.qc.by_rule.range, 2); assert.equal(data.qc.by_rule.spatial, 1);
  assert.equal(data.qc.dew_flags, undefined);
  const f = report.flags.find(x => x.key === 'bad');
  assert.equal(f.station, 'Cold sensor'); assert.equal(f.parameter, 'temperature'); assert.equal(f.rule, 'spatial'); assert.equal(f.neighbours, 4);
  assert.ok(Math.abs(f.expected - 22.55) < 0.01 && Math.abs(f.residual + 13.55) < 0.01);
  assert.equal(state.s1.temperature.v, 22.4); assert.equal(state.bad.temperature, undefined);       // the flagged temperature never became a reference
  // a second run on the same data: nothing new to compare, same flags, no duplicates
  const again = qcRealtime(data, {parseLabel, now: NOW, state});
  assert.equal(again.report.flags.length, 3); assert.deepEqual(again.state.s1, state.s1);
  assert.equal(data.stations.find(s => s.key === 'bad').qc.temperature.length, 1);
});
