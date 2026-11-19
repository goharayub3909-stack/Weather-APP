import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCurrentSource, currentValue, mainReading} from '../public/current-weather.js';

const now = Date.parse('2026-10-29T06:00:00Z');
const ago = minutes => new Date(now - minutes * 60000).toISOString();
const station = (over = {}) => ({name: 'S', lat: 33.7, lon: 73.05, observed_at: ago(10), temperature: 24, ...over});
const metar = (over = {}) => ({icaoId: 'OPIS', lat: 33.55, lon: 72.82, obsTime: (now - 20 * 60000) / 1000, temp: 23, dewp: 10, altim: 1019, ...over});

test('nowcast order: complete station, then METAR, then ECMWF', () => {
  const full = station({name: 'Full', humidity: 40, wind_speed: 5, rain_daily: 0, pressure: 1018, solar_radiation: 300, dew_point: 9, visibility: 8000, uv_index: 3});
  const thin = station({name: 'Thin', lat: 33.69});                                   // nearer, but only a temperature
  assert.equal(chooseCurrentSource(33.69, 73.05, {stations: [thin, full]}, {stations: [metar()]}, now).name, 'Full');   // completeness beats distance
  assert.equal(chooseCurrentSource(33.69, 73.05, {stations: [station({observed_at: ago(181)})]}, {stations: [metar()]}, now).kind, 'metar');   // station older than 3 h
  assert.equal(chooseCurrentSource(33.69, 73.05, {stations: []}, {stations: [metar({obsTime: (now - 121 * 60000) / 1000})]}, now).kind, 'forecast');   // airport older than 2 h
  assert.equal(chooseCurrentSource(33.69, 73.05, {stations: [station({lat: 34.5})]}, {stations: []}, now).kind, 'forecast');   // station beyond 50 km
  const chosen = chooseCurrentSource(33.69, 73.05, {stations: [full]}, {stations: [metar()]}, now);
  assert.deepEqual(chosen.fallbacks.map(f => f.kind), ['metar', 'forecast']);
});

test('station pressure feeds the sea-level tile, with METAR then ECMWF behind it', () => {
  const full = station({pressure: 1018.2, humidity: 40});
  const source = chooseCurrentSource(33.69, 73.05, {stations: [full]}, {stations: [metar()]}, now);
  assert.equal(mainReading(source, 'pressure_msl', 1015).value, 1018.2);
  assert.equal(mainReading(source, 'pressure_msl', 1015).source.kind, 'station');
  const station_level = chooseCurrentSource(33.69, 73.05, {stations: [station({pressure: 959, humidity: 40})]}, {stations: [metar()]}, now);
  assert.equal(mainReading(station_level, 'pressure_msl', 1015).source.kind, 'metar');   // 959 is not a sea-level value
  assert.equal(mainReading(station_level, 'pressure_msl', 1015).value, 1019);
  assert.equal(currentValue({kind: 'station', report: {pressure: 960}}, 'pressure_msl'), 960);
  assert.equal(currentValue({kind: 'station', report: {pressure: 1060}}, 'pressure_msl'), 1060);
  assert.equal(currentValue({kind: 'station', report: {pressure: 1060.1}}, 'pressure_msl'), null);
  assert.equal(currentValue({kind: 'station', report: {pressure: 1018}}, 'surface_pressure'), null);   // never used as surface pressure
});

test('station rain rate feeds the rain tiles and a zero rate is a real reading', () => {
  assert.equal(currentValue({kind: 'station', report: {rain_rate: 1.2}}, 'precipitation'), 1.2);
  assert.equal(currentValue({kind: 'station', report: {rain_rate: 0}}, 'rain'), 0);
  assert.equal(currentValue({kind: 'station', report: {rain_rate: null}}, 'rain', 3), null);   // station gap: the caller falls back
  const source = chooseCurrentSource(33.69, 73.05, {stations: [station({rain_rate: 0, humidity: 40})]}, {stations: []}, now);
  assert.equal(mainReading(source, 'rain', 2.5).value, 0);                                      // not replaced by the ECMWF 2.5
  assert.equal(mainReading(source, 'rain', 2.5).source.kind, 'station');
});

test('METAR visibility converts statute miles to metres', () => {
  const v = currentValue({kind: 'metar', report: {visib: 4.35}}, 'visibility');
  assert.ok(Math.abs(v - 7000.6) < 0.1, String(v));                          // 4.35 mi is the 7 km airport report
  assert.equal(currentValue({kind: 'metar', report: {visib: '10+'}}, 'visibility'), null);   // "10+" is not a number
  assert.equal(currentValue({kind: 'metar', report: {visib: 0}}, 'visibility'), 0);
  const source = chooseCurrentSource(33.69, 73.05, {stations: [station({humidity: 40})]}, {stations: [metar({visib: 3})]}, now);
  assert.ok(Math.abs(mainReading(source, 'visibility', 15000).value - 4828.032) < 0.01);   // station has none: METAR before ECMWF
  assert.equal(mainReading(source, 'visibility', 15000).source.kind, 'metar');
});
