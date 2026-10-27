import test from 'node:test';
import assert from 'node:assert/strict';
import {triageItems, groupRuns, dayWord, fmtRange, tickerData} from '../public/farm-workspace.js';
import {sprayStatusByHour, operationWindows} from '../public/field-operations.js';

const NOW = Date.parse('2026-10-27T10:20:00+05:00');
const HOUR = 3600000;
function hourly({rainAt = [], wind = 8} = {}) {
  const time = [], base = Date.parse('2026-10-27T00:00:00+05:00');
  for (let i = 0; i < 96; i++) time.push(new Date(base + i * HOUR + 5 * HOUR).toISOString().slice(0, 16));
  const fill = f => Array.from({length: 96}, (_, i) => f(i));
  return {time, temperature_2m: fill(() => 22), relative_humidity_2m: fill(() => 70), wind_speed_10m: fill(() => wind), wind_gusts_10m: fill(() => 12), precipitation: fill(i => rainAt.includes(i) ? 2 : 0), weather_code: fill(() => 0)};
}

test('triage separates active alerts, sorts by severity then hours, and keeps resolved last', () => {
  const mk = (id, level, hits) => ({id, name: id, outlook: {level, hits}, past: {label: ''}});
  const items = [mk('a', 'moderate', 40), mk('b', 'high', 10), mk('c', 'low', 0), mk('d', 'unknown', 0), mk('e', 'high', 90), mk('f', 'none', 0), mk('g', 'review', 0)];
  const r = triageItems(items, {'p|e': 'resolved'}, 'p');
  assert.deepEqual(r.open.map(i => i.id), ['b', 'a', 'e'], 'resolved alert sinks below the open ones');
  assert.equal(r.low.length, 2); assert.equal(r.unknown.length, 2);
  assert.equal(r.open.find(i => i.id === 'e').status, 'resolved');
  assert.equal(r.open.find(i => i.id === 'b').status, 'new');
  assert.deepEqual(triageItems(undefined).open, []);
});

test('consecutive hours of one state group into ranges; gaps and other states split them', () => {
  const h = (i, state) => ({time: i * HOUR, state});
  assert.deepEqual(groupRuns([h(0, 'ok'), h(1, 'ok'), h(2, 'no'), h(3, 'ok'), h(5, 'ok')]), [{start: 0, end: 2 * HOUR}, {start: 3 * HOUR, end: 4 * HOUR}, {start: 5 * HOUR, end: 6 * HOUR}]);
  assert.deepEqual(groupRuns([]), []);
});

test('day words and ranges use Pakistan time', () => {
  const t = Date.parse('2026-10-27T07:00:00+05:00');
  assert.equal(dayWord(t, NOW), 'Today');
  assert.equal(dayWord(t + 24 * HOUR, NOW), 'Tomorrow');
  assert.equal(fmtRange(t, t + 3 * HOUR, NOW), 'Today 07:00–10:00');
  // 23:00 UTC on the 26th is already the 27th in Pakistan
  assert.equal(dayWord(Date.parse('2026-10-26T23:00:00Z'), NOW), 'Today');
});

test('ticker data: temperatures, rain event, spray chips and windows from the hourly forecast', () => {
  const d = tickerData(hourly({rainAt: [30, 31, 32]}), NOW);
  assert.ok(d); assert.equal(d.now.time, Date.parse('2026-10-27T10:00:00+05:00'));
  assert.equal(d.temps24.length, 24); assert.equal(d.hi, 22);
  assert.ok(d.rainEvent && Math.abs(d.rainEvent.mm - 6) < 1e-9, 'three 2 mm hours form one 6 mm event');
  assert.ok(d.spray.chips.length > 0 && d.spray.chips.length <= 12);
  assert.ok(d.spray.chips.every(c => c.hour >= 6 && c.hour < 18), 'chips cover daylight hours only');
  assert.equal(new Set(d.spray.chips.map(c => new Date(c.time).toLocaleDateString('en-CA', {timeZone: 'Asia/Karachi'}))).size, 1, 'chips come from one day');
  assert.ok(d.spray.runs.length > 0);
  assert.equal(tickerData(null, NOW), null);
  assert.equal(tickerData({time: []}, NOW), null);
});

test('spray status by hour agrees with the work-calendar spray windows (one shared rule)', () => {
  const h = hourly({rainAt: [30, 31, 32]});
  const hours = sprayStatusByHour(h, NOW, 72);
  const windows = operationWindows(h, NOW, {limit: Infinity}).spray;
  assert.ok(windows.length > 0);
  for (const hr of hours.filter(x => x.state === 'ok')) assert.ok(windows.some(w => hr.time >= w.start && hr.time <= w.end), 'ok hour is inside a window');
  for (const w of windows) assert.equal(hours.find(x => x.time === w.start)?.state, 'ok', 'window starts on an ok hour');
  // too windy: nothing is ok, and the reason names the wind rule
  const windy = sprayStatusByHour(hourly({wind: 25}), NOW, 24).filter(x => x.state !== 'night' && x.state !== 'unknown');
  assert.ok(windy.length && windy.every(x => x.state !== 'ok' && x.fails.includes('Wind 3–15 km/h')));
  assert.equal(operationWindows(hourly({wind: 25}), NOW, {limit: Infinity}).spray.length, 0);
});
