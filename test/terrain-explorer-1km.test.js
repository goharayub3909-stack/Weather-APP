import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTempRain, decodeWind, validManifest, tileOf, tileSeries, with1km, temperatureLut, rainLut, snowLut, LUT, temperatureColour, rainColour, snowColour, decodePhase, phaseSeries, hasPhase,
  SNOW_WATER_MM_PER_CM} from '../public/explorer/core.js';

// Packing as written by downscaler/forecast1km.py (pack_temp_rain, pack_wind)
const packTR = (t, r) => { const v = ((t === null ? 2047 : Math.round((t + 60) * 10)) << 13) | Math.round(r * 10); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
const packW = (u, v) => { const x = ((u === null ? 4095 : Math.round(u * 50) + 2048) << 12) | (v === null ? 4095 : Math.round(v * 50) + 2048); return [x >> 16 & 255, x >> 8 & 255, x & 255]; };

test('1 km temperature + rain pixels decode as the Python side packs them', () => {
  for (const [t, r] of [[-60, 0], [-12.3, 0.1], [0, 0], [25.1, 3.2], [54.9, 819.1]]) {
    const d = decodeTempRain(...packTR(t, r));
    assert.ok(Math.abs(d.temp - t) < 1e-9 && Math.abs(d.rain - r) < 1e-9, `${t} ${r} -> ${d.temp} ${d.rain}`);
  }
  assert.equal(decodeTempRain(...packTR(null, 2)).temp, null);
  assert.equal(decodeTempRain(...packTR(null, 2)).rain, 2);
});

test('1 km wind pixels decode with sign, and a missing code gives no wind', () => {
  const d = decodeWind(...packW(-3.2, 7.76));
  assert.ok(Math.abs(d.u + 3.2) < 1e-9 && Math.abs(d.v - 7.76) < 1e-9);
  assert.deepEqual(decodeWind(...packW(0, 0)), {u: 0, v: 0});
  assert.equal(decodeWind(...packW(null, 1)), null);
  assert.equal(decodeWind(...packW(1, null)), null);
});

const manifest = {schema: 1, run: '2026-11-16T00:00:00Z', steps: new Array(25).fill({}), grid: {west: 60, south: 23, east: 78, north: 38, res: 0.01, row0: 'north'},
  hours: Array.from({length: 25}, (_, k) => 3 * k), times: ['2026-11-16T00:00:00Z'], tiles: {cells: 100, steps: 25, path: 'tiles/{lat}_{lon}.png', available: ['35_75', '33_73']}};

test('the 1 km set is used only with the same ECMWF run and step count', () => {
  assert.ok(validManifest(manifest, '2026-11-16T00:00:00Z', 25));
  assert.ok(!validManifest(manifest, '2026-11-15T12:00:00Z', 25));
  assert.ok(!validManifest(manifest, '2026-11-16T00:00:00Z', 24));                      // more steps than the grid has
  assert.ok(!validManifest(null, '2026-11-16T00:00:00Z', 25));
  assert.ok(!validManifest({...manifest, grid: {...manifest.grid, row0: 'south'}}, '2026-11-16T00:00:00Z', 25));
});

test('a point finds its 1 x 1 degree tile and cell (row 0 north)', () => {
  assert.deepEqual(tileOf(manifest, 75.532, 35.3254), {key: '35_75', x: 53, y: 67});        // Skardu
  assert.deepEqual(tileOf(manifest, 73.0, 33.9999), {key: '33_73', x: 0, y: 0});            // just inside the north-west corner
  assert.equal(tileOf(manifest, 74.3, 31.5), null);                                        // tile not written
  assert.equal(tileOf(manifest, 80, 31.5), null);                                          // outside the grid
});

test('a tile gives every step of one cell', () => {
  const cells = 2, steps = 3, rgba = new Uint8ClampedArray(cells * cells * steps * 4);
  for (let k = 0; k < steps; k++) { const o = ((k * cells + 1) * cells + 0) * 4; rgba.set([...packTR(10 + k, k / 10), 255], o); }
  assert.deepEqual(tileSeries(rgba, cells, steps, 0, 1), {temp: [10, 11, 12], rain: [0, 0.1, 0.2]});
});

test('hourly point rows take the 1 km values, linear between steps, and snow stays within the new total', () => {
  const t0 = Date.parse('2026-11-16T00:00:00Z');
  const rows = [0, 1, 2, 3, 4].map(h => ({t: t0 + h * 3600000, temp: 0, precip: 9, snow: 10, wind: 3}));
  const out = with1km(rows, [0, 3, 6], {temp: [-3, 3, 9], rain: [0, 3, 6]}, t0);
  assert.deepEqual(out.map(r => r.temp), [-3, -1, 1, 3, 5]);
  assert.deepEqual(out.map(r => r.precip), [0, 1, 2, 3, 4]);
  assert.ok(out.every(r => r.km1 && r.wind === 3));
  assert.ok(out.every(r => r.snow * SNOW_WATER_MM_PER_CM <= r.precip + 1e-9));
  const missing = with1km(rows, [0, 3, 6], {temp: [null, null, null], rain: [0, 0, 0]}, t0);
  assert.ok(missing.every(r => r.temp === 0 && !r.km1));
});

test('the GPU look-up tables match the CPU colour ramps', () => {
  const t = temperatureLut(), r = rainLut();
  assert.equal(t.length, 1024); assert.equal(r.length, 1024);
  assert.deepEqual([...t.slice(0, 4)], temperatureColour(LUT.tempMin));
  assert.deepEqual([...t.slice(1020)], temperatureColour(LUT.tempMax));
  assert.deepEqual([...r.slice(1020)], rainColour(LUT.rainMax));
  assert.equal(r[3], 0);                                                                     // no rain: transparent
});

test('the 1 km set may cover only the first steps of a longer grid, hour for hour', () => {
  const grid = Array.from({length: 49}, (_, k) => 3 * k);
  assert.ok(validManifest(manifest, '2026-11-16T00:00:00Z', 49, grid));                  // 25 steps of a 49-step grid: the first three days of six
  assert.ok(!validManifest(manifest, '2026-11-16T00:00:00Z', 49, grid.map(h => h + 1)));    // different hours: not the same steps
  assert.ok(!validManifest({...manifest, hours: manifest.hours.slice(1)}, '2026-11-16T00:00:00Z', 49, grid));
  assert.ok(!validManifest({...manifest, steps: [{}]}, '2026-11-16T00:00:00Z', 49, grid));  // one step is not a forecast
});
test('hourly rows beyond the last 1 km step keep their 9 km values', () => {
  const t0 = Date.parse('2026-11-16T00:00:00Z');
  const rows = [0, 3, 6, 9, 12].map(h => ({t: t0 + h * 3600000, temp: -1, precip: 5, snow: 0, wind: 2}));
  const out = with1km(rows, [0, 3, 6], {temp: [10, 11, 12], rain: [0, 1, 2]}, t0);
  assert.deepEqual(out.map(r => r.temp), [10, 11, 12, -1, -1]);
  assert.deepEqual(out.map(r => r.km1), [true, true, true, false, false]);
  assert.deepEqual(out.map(r => r.precip), [0, 1, 2, 5, 5]);
});

// Phase pixels as written by downscaler/phase.py (pack_phase): red = round(255 x snow share of the water)
const packPhase = share => [Math.round(share * 255), 0, 0];
test('phase pixels decode to the snow share: 255 snow, 128 sleet, 0 rain', () => {
  assert.equal(decodePhase(0), 0); assert.equal(decodePhase(255), 1);
  assert.ok(Math.abs(decodePhase(packPhase(0.5)[0]) - 0.5) < 0.003);                          // sleet 128 / 255
  const cells = 2, steps = 3, rgba = new Uint8ClampedArray(cells * cells * steps * 4);
  for (let k = 0; k < steps; k++) rgba.set([...packPhase([0, 0.5, 1][k]), 255], ((k * cells + 1) * cells + 1) * 4);
  assert.deepEqual(phaseSeries(rgba, cells, steps, 1, 1).map(p => +p.toFixed(3)), [0, 0.502, 1]);
});

test('a manifest has the phase split only when every step and the tiles carry it', () => {
  const steps = [{phase: 'steps/ph-000.png'}, {phase: 'steps/ph-001.png'}];
  assert.equal(hasPhase({phase: {}, steps, tiles: {phase_path: 'tiles/ph_{lat}_{lon}.png'}}), true);
  assert.equal(hasPhase({phase: {}, steps: [steps[0], {}], tiles: {phase_path: 'x'}}), false);
  assert.equal(hasPhase({phase: null, steps, tiles: {phase_path: 'x'}}), false);
  assert.equal(hasPhase({phase: {}, steps, tiles: {phase_path: null}}), false);
  assert.equal(hasPhase({steps, tiles: {}}), false);                                          // a manifest from before the split
  assert.equal(hasPhase(null), false);
});

test('with the phase series the 1 km water is split by the snow share, linear in time, and water is conserved', () => {
  const t0 = Date.parse('2026-11-16T00:00:00Z');
  const rows = [0, 1, 2, 3, 4, 5, 6].map(h => ({t: t0 + h * 3600000, temp: 0, precip: 9, snow: 10, wind: 3}));
  const out = with1km(rows, [0, 3, 6], {temp: [-3, 0, 3], rain: [3, 3, 3]}, t0, [1, 0.5, 0]);
  // snow share by hour: 1, 0.833, 0.667, 0.5, 0.333, 0.167, 0
  const snowWater = out.map(r => r.snow * SNOW_WATER_MM_PER_CM);
  [3, 2.5, 2, 1.5, 1, 0.5, 0].forEach((want, i) => assert.ok(Math.abs(snowWater[i] - want) < 1e-9, `hour ${i}: ${snowWater[i]} vs ${want}`));
  assert.ok(out.every(r => r.precip === 3 && snowWater.every(w => w <= 3 + 1e-9) && r.phase1km === true));
  const dry = with1km(rows, [0, 3, 6], {temp: [1, 1, 1], rain: [0, 0, 0]}, t0, [1, 1, 1]);
  assert.ok(dry.every(r => r.snow === 0));
  const rain = with1km(rows, [0, 3, 6], {temp: [5, 5, 5], rain: [2, 2, 2]}, t0, [0, 0, 0]);
  assert.ok(rain.every(r => r.snow === 0 && r.precip === 2));
  const noPhase = with1km(rows, [0, 3, 6], {temp: [-3, 0, 3], rain: [3, 3, 3]}, t0);                    // without phase: ECMWF's snow, capped
  assert.ok(noPhase.every(r => r.phase1km === false && r.snow * SNOW_WATER_MM_PER_CM <= r.precip + 1e-9));
  const gap = with1km(rows, [0, 3, 6], {temp: [-3, 0, 3], rain: [3, 3, 3]}, t0, [1, null, 0]);            // a missing step: no phase there, ECMWF's snow stays
  assert.ok(gap.every(r => r.phase1km === false));
});

test('the snow look-up table matches the CPU snow ramp', () => {
  const s = snowLut();
  assert.equal(s.length, 1024);
  assert.deepEqual([...s.slice(1020)], snowColour(LUT.rainMax));
  assert.equal(s[3], 0);                                                                     // no snow: transparent
  assert.ok(s[4 * 128 + 3] > 0);                                                             // moderate snow is drawn
});
