import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {healthURLs, buildReadings, runHealth} from '../public/health-panel.js';

// 7 days of hourly data starting 3 days before "now", like past_days=3, forecast_days=4.
function fixture({rainAt = [], pm = true} = {}) {
  const time = [], start = Date.parse('2026-10-23T00:00:00+05:00');
  for (let i = 0; i < 168; i++) time.push(new Date(start + i * 3600000 + 5 * 3600000).toISOString().slice(0, 16));
  const n = time.length, fill = f => Array.from({length: n}, (_, i) => f(i));
  const forecast = {hourly: {time,
    temperature_2m: fill(i => 22 + 6 * Math.sin(i / 24 * 2 * Math.PI)), relative_humidity_2m: fill(() => 60),
    surface_pressure: fill(() => 995), wind_speed_10m: fill(() => 1.2),
    precipitation: fill(i => rainAt.includes(i) ? 2.5 : 0),
    soil_moisture_0_to_1cm: fill(() => 0.21), soil_temperature_0cm: fill(() => 24)}};
  const air = pm ? {hourly: {time, pm2_5: fill(() => 180), pm10: fill(() => 260)}} : null;
  return {forecast, air};
}
const NOW = new Date('2026-10-26T15:20:00+05:00');

test('URLs request history, forecast and m/s wind for the engine', () => {
  const {forecast, air} = healthURLs(31.55, 74.34);
  assert.equal(forecast.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(forecast.searchParams.get('past_days'), '3');
  assert.match(forecast.searchParams.get('hourly'), /soil_moisture_0_to_1cm/);
  assert.equal(air.searchParams.get('hourly'), 'pm2_5,pm10');
  assert.throws(() => healthURLs(NaN, 74));
});

test('current hour, PKT offsets and 72 h windows', () => {
  const {forecast, air} = fixture();
  const b = buildReadings(forecast, air, NOW);
  assert.equal(b.current.timestamp, '2026-10-26T15:00:00+05:00');
  assert.equal(b.history.length, 72);
  assert.equal(b.forecast.length, 72);
  assert.equal(b.current.soil_moisture, 21);
  assert.equal(b.current.pm25, 180);
  assert.equal(b.current.pm25_source, 'model');
});

test('rain accumulation sums the trailing window and stays null without full history', () => {
  const {forecast, air} = fixture({rainAt: [72 + 10, 72 + 14]});
  const b = buildReadings(forecast, air, NOW);
  assert.equal(b.current.rain_acc_48h, 5);
  assert.equal(b.current.rain_acc_72h, 5);
  const early = buildReadings(forecast, air, new Date('2026-10-23T05:10:00+05:00'));
  assert.equal(early.current.rain_acc_48h, null);
});

test('missing air quality leaves PM2.5 null, not zero', () => {
  const {forecast} = fixture({pm: false});
  const b = buildReadings(forecast, null, NOW);
  assert.equal(b.current.pm25, null);
  assert.equal(b.current.pm25_source, undefined);
  const {result} = runHealth(b);
  assert.notEqual(result.modules.smog.level, 'LOW');
});

test('engine runs end to end: smog flagged, 24 outlook steps', () => {
  const {forecast, air} = fixture();
  const {result, outlook} = runHealth(buildReadings(forecast, air, NOW));
  assert.equal(Object.keys(result.modules).length, 11);
  assert.ok(['HIGH', 'CRITICAL'].includes(result.modules.smog.level));
  assert.ok(result.alerts.some(a => a.module === 'smog'));
  assert.equal(outlook.steps.length, 24);
});

test('throws when the current hour is not in the response', () => {
  const {forecast, air} = fixture();
  assert.throws(() => buildReadings(forecast, air, new Date('2027-01-01T00:00:00+05:00')), /current Pakistan hour/);
  assert.throws(() => buildReadings({}, air, NOW));
});

test('page wires the panel', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="health"/);
  assert.match(html, /href="#health"/);
  assert.match(app, /initHealthPanel\(/);
});
