import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLDCOVER, modeDownsample, coverClasses, fillMissingClass, byteToDb, otsu, addHistogram, waterMask, waterFrequency, channelFrom, bankCells, burnChannel,
  slopeDeg, majorityFilter, maskSteep, observedFlood, blockFraction, compareMasks, cropAreaKm2, peopleEstimate, buildingHeight, RESIDENTIAL_BUILDINGS, pickMonthlyScenes, HOUSEHOLD_SIZE,
} from '../public/flood-eo.js';
import {LAND_COVER, curveNumber} from '../public/flood-logic.js';
import {createSimulation} from '../public/flood-model.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('every WorldCover class maps to a land cover the runoff tables know', () => {
  for (const [code, info] of Object.entries(WORLDCOVER)) assert.ok(LAND_COVER[info.key], `code ${code} -> ${info.key}`);
  assert.equal(curveNumber('water', 'D'), 100);
  assert.equal(WORLDCOVER[40].key, 'cropland'); assert.equal(WORLDCOVER[50].key, 'builtup'); assert.equal(WORLDCOVER[80].key, 'water');
});
test('land cover blocks take the most common class and ignore missing data', () => {
  const codes = Uint8Array.from([40, 40, 10, 0, 40, 10, 10, 10, 0, 0, 50, 50, 0, 0, 50, 80]);
  const m = modeDownsample(codes, 4, 2);
  assert.deepEqual([...m], [40, 10, 0, 50]);          // block 3 has no data
  const c = coverClasses(m);
  assert.deepEqual(c.keys, ['cropland', 'woodland', 'builtup']);
  close(c.share.reduce((a, b) => a + b, 0), 1, 1e-12);
  assert.equal(c.classOf[2], 255);
  const filled = fillMissingClass(c.classOf, c.keys, c.share);
  assert.ok(filled.every(v => v < c.keys.length));
  const inMask = coverClasses(m, Uint8Array.from([1, 0, 0, 0]));
  assert.deepEqual(inMask.share, [1, 0, 0]);
});
test('backscatter bytes convert to dB and Otsu splits two populations', () => {
  close(byteToDb(0), -30, 1e-9); close(byteToDb(255), 5, 1e-9);
  const hist = new Array(256).fill(0);
  for (let b = 20; b <= 40; b++) hist[b] = 100;       // water: dark
  for (let b = 150; b <= 190; b++) hist[b] = 300;     // land: bright
  const t = otsu(hist);
  assert.ok(t >= 40 && t < 150, 'threshold sits between the two groups: ' + t);
  assert.equal(otsu(new Array(256).fill(0)), null);
  const h2 = new Array(256).fill(0); addHistogram(h2, Uint8Array.from([5, 5, 9]), Uint8Array.from([1, 0, 1]));
  assert.equal(h2[5], 1); assert.equal(h2[9], 1);
});
test('water masks, frequency and the connected channel', () => {
  const bytes = Uint8Array.from([10, 200, 10, 200]), alpha = Uint8Array.from([1, 1, 1, 0]);
  assert.deepEqual([...waterMask(bytes, alpha, 100)], [1, 0, 1, 255]);
  const f = waterFrequency([Uint8Array.from([1, 0, 255]), Uint8Array.from([1, 0, 1]), Uint8Array.from([0, 0, 1])]);
  close(f.freq[0], 2 / 3, 1e-6); assert.equal(f.freq[1], 0); assert.equal(f.freq[2], 1);
  // a 7 x 7 map with a wet column (the river) and one separate wet pixel (a pond)
  const size = 7, freq = new Float32Array(size * size).fill(0);
  for (let j = 0; j < size; j++) freq[j * size + 3] = 0.9;
  freq[6 * size + 6] = 1;
  const ch = channelFrom(freq, size, 2, 3, {radius: 3});
  assert.equal(ch.cells, 7); assert.equal(ch.mask[6 * size + 6], 0);
  assert.equal(channelFrom(freq, size, 0, 0, {radius: 1}).cells, 0);
  const banks = bankCells(ch.mask, size);
  assert.equal(banks.reduce((a, b) => a + b, 0), 7);      // a one-pixel-wide river is all bank
});
test('burning lowers only the channel and leaves the rest', () => {
  const z = Float32Array.from([10, 10, 10, 10]), out = burnChannel(z, Uint8Array.from([0, 1, 0, 1]), 2);
  assert.deepEqual([...out], [10, 8, 10, 8]); assert.deepEqual([...z], [10, 10, 10, 10]);
  assert.equal(burnChannel(z, Uint8Array.from([1, 1, 1, 1]), 0), z);
});
test('slope and the observed-flood mask', () => {
  const size = 5, z = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) z[j * size + i] = i * 10;       // 10 m rise per 10 m cell: 45 degrees
  close(slopeDeg(z, size, 10)[2 * size + 2], 45, 1e-6);
  assert.equal(slopeDeg(new Float32Array(size * size), size, 10)[2 * size + 2], 0);
  const water = Uint8Array.from([1, 1, 1, 1, 0, 255]), freq = Float32Array.from([0.9, 0.1, 0.1, 0.1, 0, 0]), slope = Float32Array.from([0, 0, 20, 0, 0, 0]);
  assert.deepEqual([...observedFlood(water, freq, slope)], [0, 1, 0, 1, 0, 255]);   // permanent water, steep ground and land excluded
});
test('model against satellite skill scores', () => {
  const model = Uint8Array.from([1, 1, 0, 0, 1]), observed = Float32Array.from([1, 0, 1, 0, NaN]);
  const s = compareMasks(model, observed);
  assert.deepEqual([s.hits, s.misses, s.falseAlarms, s.correctNegatives, s.compared], [1, 1, 1, 1, 4]);
  close(s.pod, 0.5, 1e-12); close(s.far, 0.5, 1e-12); close(s.csi, 1 / 3, 1e-12);
  assert.equal(compareMasks(Uint8Array.from([0]), Float32Array.from([0])).pod, null);
  const bf = blockFraction(Uint8Array.from([1, 0, 255, 255, 1, 1, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255]), 4, 2);
  assert.equal(bf[0], 0.75); assert.ok(Number.isNaN(bf[1])); assert.equal(bf[2], 0); assert.equal(bf[3], 0);
});
test('flooded cropland and the people estimate', () => {
  const crop = cropAreaKm2(Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([40, 10, 40, 40]), 1000);
  close(crop.floodedKm2, 1, 1e-12); close(crop.totalKm2, 3, 1e-12);
  assert.equal(peopleEstimate(10, 6.3), 63); assert.equal(HOUSEHOLD_SIZE, 6.3);
  assert.ok(RESIDENTIAL_BUILDINGS.has('house') && !RESIDENTIAL_BUILDINGS.has('yes') && !RESIDENTIAL_BUILDINGS.has('commercial'));
  assert.equal(buildingHeight({height: '12.5'}), 12.5); assert.equal(buildingHeight({'building:levels': '3'}), 9); assert.equal(buildingHeight({}), 6); assert.equal(buildingHeight(undefined), 6);
});
test('monthly scene picking keeps one orbit and one scene per month', () => {
  const frame = {west: 72, south: 33, east: 73, north: 34};
  const item = (id, date, orbit, covers = true) => ({id, bbox: covers ? [71, 32, 74, 35] : [72.5, 32, 74, 35], properties: {datetime: date + 'T01:00:00Z', 'sar:polarizations': ['VV', 'VH'], 'sat:relative_orbit': orbit, 'sat:orbit_state': 'ascending'}});
  const picks = pickMonthlyScenes([item('a', '2026-01-03', 1), item('b', '2026-01-15', 1), item('c', '2026-02-02', 1), item('d', '2026-02-03', 2), item('e', '2026-03-01', 2), item('f', '2026-03-05', 1, false)], frame);
  assert.deepEqual(picks.map(p => p.id), ['a', 'c']);       // orbit 1: two full-coverage months; orbit 2: two, but the partial scene is dropped first
});
test('per-class rain adds the right volume to the solver', () => {
  const n = 10, z = new Float32Array(n * n), classOf = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { z[j * n + i] = 50 - i * 0.2; classOf[j * n + i] = i < 5 ? 0 : 1; }
  const sim = createSimulation({z, n, cellM: 100, manning: 0.03, effectiveByClass: [[10, 0], [2, 0]], classOf, hours: 2}).runAll();
  const expected = (0.010 * 50 + 0.002 * 50) * 1e4;
  close(sim.volumes.rain, expected, expected * 1e-4);
  close(sim.volumes.rain - sim.volumes.out - sim.storage(), 0, expected * 0.01);
});
test('the majority filter removes speckle and keeps solid water', () => {
  const size = 5, m = new Uint8Array(size * size);
  m[2 * size + 2] = 1;                                               // an isolated water pixel
  assert.equal(majorityFilter(m, size)[2 * size + 2], 0);
  const block = new Uint8Array(size * size);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) block[j * size + i] = 1;
  assert.equal(majorityFilter(block, size)[1 * size + 1], 1);
  const nodata = Uint8Array.from(block); nodata[0] = 255;
  assert.equal(majorityFilter(nodata, size)[0], 255);
  assert.deepEqual([...maskSteep(Uint8Array.from([1, 1, 0]), Float32Array.from([0, 9, 3]))], [1, 255, 0]);
});
