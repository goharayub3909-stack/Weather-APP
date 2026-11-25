// Station readings, the 1 km model and the difference at every pin in the 3D explorer (pure logic of public/explorer/core.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {PIN_MODES, decodeTempPixel, sampleGrid, stepsAround, modelTemperature, stepsNeeded, fmtBias, biasColour, obsPins} from '../public/explorer/core.js';
import {parseLabel} from '../public/realtime/core.js';

test('a 1 km temperature pixel decodes to degC, and 2047 is no value', () => {
  const px = (temp, rain = 0) => { const v = (Math.round((temp + 60) * 10) << 13) | rain; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(decodeTempPixel(...px(25.3)), 25.3); near(decodeTempPixel(...px(-12.4, 37)), -12.4); near(decodeTempPixel(...px(-60)), -60);
  assert.ok(Number.isNaN(decodeTempPixel((2047 << 13) >> 16 & 255, (2047 << 13) >> 8 & 255, (2047 << 13) & 255)));
});

test('sampleGrid is bilinear, leaves missing cells out, and gives null outside the grid', () => {
  const box = {west: 60, north: 38, res: 1}, g = new Float32Array([0, 10, 20, 30]);                // 2 x 2 cells, row 0 north
  assert.equal(sampleGrid(g, 2, 2, box, 60.5, 37.5), 0); assert.equal(sampleGrid(g, 2, 2, box, 61.5, 36.5), 30);
  assert.equal(sampleGrid(g, 2, 2, box, 61, 37), 15); assert.equal(sampleGrid(g, 2, 2, box, 61, 37.5), 5);
  assert.equal(sampleGrid(g, 2, 2, box, 59, 37), null); assert.equal(sampleGrid(g, 2, 2, box, 61, 39), null);
  assert.equal(sampleGrid(new Float32Array([NaN, 10, 20, 30]), 2, 2, box, 61, 37), 20);            // the missing cell is left out: the mean of 10, 20, 30
  assert.equal(sampleGrid(new Float32Array([NaN, NaN, NaN, NaN]), 2, 2, box, 61, 37), null);
});

test('the steps around a time, and the model temperature at a place and time from loaded steps', () => {
  const hours = [0, 3, 6];
  assert.deepEqual(stepsAround(hours, 1.5), {i0: 0, i1: 1, w: 0.5}); assert.deepEqual(stepsAround(hours, 6), {i0: 1, i1: 2, w: 1});
  assert.equal(stepsAround(hours, -2), null); assert.equal(stepsAround(hours, 8), null); assert.deepEqual(stepsAround(hours, -1), {i0: 0, i1: 1, w: 0});
  const man = {times: ['2026-11-23T00:00:00Z'], hours, grid: {west: 60, north: 38, res: 1}};
  const steps = new Map([[0, {grid: new Float32Array([10, 10, 10, 10]), nx: 2, ny: 2}], [1, {grid: new Float32Array([20, 20, 20, 20]), nx: 2, ny: 2}]]);
  const t = h => Date.parse('2026-11-23T00:00:00Z') + h * 3600000;
  assert.equal(modelTemperature(man, steps, 61, 37, t(0)), 10); assert.equal(modelTemperature(man, steps, 61, 37, t(1.5)), 15); assert.equal(modelTemperature(man, steps, 61, 37, t(3)), 20);
  assert.equal(modelTemperature(man, steps, 61, 37, t(5)), null);                                  // step 2 is not loaded yet
  assert.equal(modelTemperature(man, steps, 90, 37, t(1)), null);                                  // outside the grid
  assert.deepEqual([...stepsNeeded(man, [t(1), t(4)])].sort(), [0, 1, 2]); assert.deepEqual([...stepsNeeded(man, [t(3)])], [1]);      // exactly on a step: only that step
});

test('the bias is signed with one decimal, blue below the model, red above and green within half a degree', () => {
  assert.equal(fmtBias(1.234), '+1.2'); assert.equal(fmtBias(-0.06), '-0.1'); assert.equal(fmtBias(0), '0.0'); assert.equal(fmtBias(null), ''); assert.equal(fmtBias(NaN), '');
  assert.equal(biasColour(0.2), '#8ee66e'); assert.equal(biasColour(-0.49), '#8ee66e');
  assert.notEqual(biasColour(-2), biasColour(-4)); assert.notEqual(biasColour(2), biasColour(4)); assert.notEqual(biasColour(-2), biasColour(2)); assert.equal(biasColour(null), '#888888');
  assert.deepEqual(PIN_MODES.map(m => m[0]), ['obs', 'fcst', 'bias']);
});

test('pins come from stations, PMD and METAR with a recent temperature; active ones first; old, future and incomplete reports are left out', () => {
  const PKT = 5 * 3600000, now = Date.UTC(2026, 10, 23, 7, 0) ;                                      // 12:00 PKT on 23 Nov
  const row = (name, network, temp, label, extra = {}) => { const v = Array(178).fill(null); v[5] = temp; v[161] = label; return {name, network, lat: 33, lon: 73, map_lat: 33.1, map_lon: 73.1, v, ...extra}; };
  const rt = {stations: [row('Fresh', 'Davis', 20.5, '11:50 am, 23 November'), row('Hourly PMD', 'PMD', 18, '10:00 am, 23 November'), row('Old', 'WU', 15, '07:00 am, 23 November'),
    row('No temperature', 'Davis', null, '11:50 am, 23 November'), row('No time', 'Davis', 20, null), row(' Bad position ', 'Davis', 20, '11:55 am, 23 November', {map_lat: null, map_lon: null, lat: null, lon: null})]};
  const metar = {stations: [{icaoId: 'OPIS', temp: 21, obsTime: now / 1000 - 1800, lat: 33.6, lon: 73.1}, {icaoId: 'OPKC', temp: 28, obsTime: now / 1000 - 5 * 3600, lat: 24.9, lon: 67.1}, {icaoId: 'OPXX', temp: null, obsTime: now / 1000, lat: 30, lon: 70}]};
  const pins = obsPins(rt, metar, parseLabel, now);
  assert.deepEqual(pins.map(p => p.name), ['Fresh', 'OPIS', 'Hourly PMD']);                         // active first (by name), then the older readings
  assert.deepEqual(pins.map(p => p.active), [true, true, false]);
  assert.equal(pins[0].lat, 33.1); assert.equal(pins[0].value, 20.5); assert.equal(pins[0].network, 'Davis'); assert.equal(pins[1].network, 'METAR'); assert.equal(pins[1].tMs, now - 1800000);
  assert.deepEqual(obsPins(null, null, parseLabel, now), []);
});
