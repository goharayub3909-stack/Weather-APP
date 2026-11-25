import test from 'node:test';
import assert from 'node:assert/strict';
import {GridSampler, unpackDataset, validPacked, validDataset, temperatureColour, WIND_LEVELS, encodeView, decodeView, pointRows, maxTierFor, labelIndex, labelsNear,
  LOD_LEVELS, LOD_TILES, FADE_FRACTION, lodAlpha, lodHeightWeight, blendHeight, lodWanted, SNOW_WATER_MM_PER_CM} from '../public/explorer/core.js';

const b64 = arr => Buffer.from(new Int16Array(arr).buffer).toString('base64');
// 3 x 3 grid, steps at 0, 3 and 6 h, with the extra fields.
function grid(extra = {}) {
  const step = fn => b64(Array.from({length: 9}, (_, i) => fn(i))), same = v => [step(() => v), step(() => v), step(() => v)];
  return {schema_version: 2, model: 'ecmwf_ifs_0p1', grid: {west: 60, east: 62, south: 23, north: 25, spacing: 1, columns: 3, rows: 3},
    times: ['2026-11-13T00:00:00Z', '2026-11-13T03:00:00Z', '2026-11-13T06:00:00Z'], hours: [0, 3, 6],
    scales: {u: 10, v: 10, precip: 100, snow: 10, cloud: 1, t2m: 10, cape: 1, u850: 10, v850: 10, u700: 10, v700: 10},
    units: {wind: 'm/s', precip: 'mm', snow: 'cm', cloud: '%', t2m: 'degC', cape: 'J/kg'}, retrieved_at: '2026-11-13T09:00:00Z', run: '2026-11-13T00:00:00Z',
    u: same(30), v: same(0), precip: [step(() => 0), step(() => 200), step(() => 0)], snow: [step(() => 0), step(() => 10), step(() => 0)], cloud: same(50),
    t2m: [step(() => 100), step(() => 200), step(() => 300)],                                 // 10, 20, 30 degC
    cape: [step(() => 0), step(() => 800), step(() => 0)],
    u850: same(100), v850: same(-50),                                                          // 10 and -5 m/s
    u700: [step(i => i === 0 ? -32768 : 200), step(i => i === 0 ? -32768 : 200), step(i => i === 0 ? -32768 : 200)], v700: same(0),   // node 0 is below ground at 700 hPa
    ...extra};
}

test('a grid with the new fields validates, and one built before them still does', () => {
  assert.equal(validPacked(grid()), true);
  const old = grid(); for (const k of ['t2m', 'cape', 'u850', 'v850', 'u700', 'v700']) delete old[k];
  assert.equal(validPacked(old), true); assert.equal(validDataset(old), true);
  assert.equal(validPacked(grid({t2m: grid().t2m.slice(1)})), false);                        // a present field must be complete
  assert.equal(validPacked(grid({u850: grid().u850.map(s => s.slice(4))})), false);
  assert.equal(validPacked(grid({scales: {u: 10, v: 10, precip: 100, snow: 10, cloud: 1}})), false);   // present but no scale
});
test('unpacking applies the scales to temperature, CAPE and level winds, and keeps the below-ground marker as NaN', () => {
  const d = unpackDataset(grid());
  assert.equal(d.t2m[1][0], 20); assert.equal(d.cape[1][4], 800); assert.equal(d.u850[0][0], 10); assert.equal(d.v850[0][0], -5);
  assert.ok(Number.isNaN(d.u700[0][0])); assert.equal(d.u700[0][1], 20);
});
test('level winds are sampled like the surface wind, and below-ground nodes give no wind', () => {
  const s = new GridSampler(unpackDataset(grid()));
  assert.deepEqual(s.wind(3, 61, 24), {u: 3, v: 0, speed: 3});
  assert.equal(s.wind(3, 61, 24, '850').speed, Math.hypot(10, 5));
  assert.equal(s.wind(3, 60, 23, '700'), null);                                             // the corner node is below ground: missing, not extrapolated
  assert.equal(s.wind(3, 61.5, 24.5, '700').u, 20);
  const old = grid(); delete old.u850; delete old.v850;
  assert.equal(new GridSampler(unpackDataset(old)).wind(3, 61, 24, '850'), null);           // a grid without the level has no such wind
  assert.equal(new GridSampler(unpackDataset(old)).has('t2m'), true); assert.equal(new GridSampler(unpackDataset(old)).has('u850'), false);
  assert.deepEqual(Object.keys(WIND_LEVELS).sort(), ['1000', '250', '300', '400', '500', '600', '700', '850', '925', 'sfc']);
  assert.ok(WIND_LEVELS['700'].heightKm > WIND_LEVELS['850'].heightKm && WIND_LEVELS.sfc.heightKm === 0);
});
test('temperature colours run cold to hot and stay translucent', () => {
  const cold = temperatureColour(-20), mild = temperatureColour(12), hot = temperatureColour(45);
  assert.ok(cold[2] > cold[0]); assert.ok(hot[0] > hot[2]); assert.ok(mild[1] > mild[0] && mild[1] > mild[2]);
  assert.ok([cold, mild, hot].every(c => c[3] > 0 && c[3] < 200));
  assert.deepEqual(temperatureColour(-99), temperatureColour(-30)); assert.deepEqual(temperatureColour(99), temperatureColour(50));
  const a = temperatureColour(8), lo = temperatureColour(5), hi = temperatureColour(12);
  assert.ok(a[0] >= Math.min(lo[0], hi[0]) && a[0] <= Math.max(lo[0], hi[0]));             // between its neighbours
});
test('the view link carries the temperature and wind-level choices', () => {
  const v = {lon: 73.4, lat: 33.95, dist: 150, tilt: 58, heading: 0, exag: 3, hour: 12, layers: ['w', 't'], level: '850'};
  assert.equal(encodeView(v), '#v=73.400,33.950,150,58,0,3.0,12,wt,850');
  assert.deepEqual(decodeView(encodeView(v)), v);
  assert.equal(encodeView({...v, level: 'sfc'}), '#v=73.400,33.950,150,58,0,3.0,12,wt');
  assert.equal(decodeView('#v=73.400,33.950,150,58,0,3.0,12,wt,123'), null);                // not one of the levels
  assert.equal(decodeView('#v=73.400,33.950,150,58,0,3.0,12,wt,500').level, '500');          // every pressure level from 1000 to 250 hPa is valid
  assert.equal(decodeView('#v=73.400,33.950,150,58,0,3.0,241,w'), null);                    // beyond the 240 hours
});
test('a point forecast comes from the grid: hourly rows, snow in cm, missing stays null', () => {
  const s = new GridSampler(unpackDataset(grid())), rows = pointRows(s, 61, 24);
  assert.equal(rows.length, 7);                                                              // hours 0 to 6
  assert.equal(rows[0].t, Date.UTC(2026, 10, 13)); assert.equal(rows[3].t, Date.UTC(2026, 10, 13, 3));
  assert.deepEqual([rows[0].temp, rows[3].temp, rows[6].temp], [10, 20, 30]);
  assert.equal(rows[3].precip, 2); assert.ok(Math.abs(rows[3].snow - 1) < 1e-9);           // 1 cm of snow is 0.7 mm of water out of the 2 mm; the sampler returns it as cm again
  assert.ok(SNOW_WATER_MM_PER_CM === 0.7);
  assert.equal(rows[3].cape, 800); assert.equal(rows[3].cloud, 50);
  assert.ok(Math.abs(rows[1].temp - (10 + 10 / 3)) < 1e-9);                                  // linear in time between steps
  assert.equal(rows[3].wind, 3);
  const noTemp = grid(); delete noTemp.t2m; delete noTemp.cape;
  const r2 = pointRows(new GridSampler(unpackDataset(noTemp)), 61, 24);
  assert.deepEqual([r2[0].temp, r2[0].cape], [null, null]);
  assert.equal(pointRows(s, 80, 24)[0].precip, null);                                        // outside the grid
});

const labels = [['Karachi', 24.86, 67.01, 0, 'c', null], ['Sargodha', 32.08, 72.67, 1, 'c', null], ['Murree', 33.9, 73.39, 3, 't', null], ['K2', 35.88, 76.51, 1, 'p', 8611], ['Tiny', 33.91, 73.4, 5, 'v', null], ['Gilgit', 35.92, 74.31, 0, 'c', null]];
test('labels appear by camera distance: a few big names far away, small ones only up close', () => {
  const max = [6000, 2600, 1300, 650, 260, 90];
  assert.equal(maxTierFor(3000, max), 0); assert.equal(maxTierFor(2000, max), 1); assert.equal(maxTierFor(100, max), 4); assert.equal(maxTierFor(50, max), 5);
  assert.equal(maxTierFor(7000, max), -1);
});
test('only labels near the view and at or above the allowed tier are picked, most important first', () => {
  const cells = labelIndex(labels);
  const near = labelsNear(labels, cells, 73.4, 33.9, 60, 5).map(i => labels[i][0]);
  assert.deepEqual(near, ['Murree', 'Tiny']);                                                 // tier 3 before tier 5; far cities are out of range
  assert.deepEqual(labelsNear(labels, cells, 73.4, 33.9, 60, 3).map(i => labels[i][0]), ['Murree']);
  assert.deepEqual(labelsNear(labels, cells, 70, 30, 3000, 0).map(i => labels[i][0]), ['Karachi', 'Gilgit']);
  assert.deepEqual(labelsNear(labels, cells, 70, 30, 3000, 1).map(i => labels[i][0]), ['Karachi', 'Gilgit', 'Sargodha', 'K2']);
  assert.deepEqual(labelsNear(labels, cells, 73.4, 33.9, 60, -1), []);
});
test('detail levels are nested, ask for finer data only when close, and blend without a seam', () => {
  assert.deepEqual(LOD_LEVELS.map(l => l.z), [9, 10, 11]);
  assert.ok(LOD_LEVELS.every((l, i) => i === 0 || l.maxDist < LOD_LEVELS[i - 1].maxDist));
  assert.deepEqual(lodWanted(1500), []); assert.deepEqual(lodWanted(600), [9]); assert.deepEqual(lodWanted(200), [9, 10]); assert.deepEqual(lodWanted(50), [9, 10, 11]);
  assert.equal(LOD_TILES, 5);
  // at the very edge the patch is invisible and has the lower level's height; a full border in it is opaque; two borders in it is all its own height
  assert.equal(lodAlpha(0), 0); assert.equal(lodAlpha(FADE_FRACTION), 1); assert.equal(lodAlpha(0.5), 1);
  assert.equal(lodHeightWeight(0), 0); assert.equal(lodHeightWeight(FADE_FRACTION), 0); assert.equal(lodHeightWeight(2 * FADE_FRACTION), 1);
  assert.equal(blendHeight(1000, 1400, 0), 1000); assert.equal(blendHeight(1000, 1400, 0.3), 1400);
  const mid = blendHeight(1000, 1400, 1.5 * FADE_FRACTION); assert.ok(mid > 1000 && mid < 1400);
  // alpha and weight only ever increase going inwards, so there is no step
  let a = -1, w = -1; for (let e = 0; e <= 0.3; e += 0.005) { assert.ok(lodAlpha(e) >= a && lodHeightWeight(e) >= w); a = lodAlpha(e); w = lodHeightWeight(e); }
  // the colour is fully faded in before the heights start moving, so the heights always blend while the patch is opaque
  assert.ok(lodAlpha(FADE_FRACTION) === 1 && lodHeightWeight(FADE_FRACTION) === 0);
});
