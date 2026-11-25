import test from 'node:test';
import assert from 'node:assert/strict';
import {hailIndex, hailOver, hailLabel, HAIL} from '../public/hail.js';
import {periodRows, describePeriod, weekPeriods} from '../public/forecast-periods.js';

// 10 m wind 0 and 500 hPa wind 20 m/s (72 km/h) gives 20 m/s of wind change.
const storm = (over = {}) => ({time: ['2026-06-10T15:00'], weather_code: [80], cape: [1500], temperature_500hPa: [-15], wind_speed_500hPa: [72], wind_direction_500hPa: [270], wind_speed_10m: [0], wind_direction_10m: [270], showers: [1], ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, [v]]))});

test('hail index is 100 when every ingredient is at its favourable end with a full trigger', () => {
  assert.equal(hailIndex(storm(), 0).index, 100);
});
test('one missing ingredient removes the hail chance', () => {
  assert.equal(hailIndex(storm({cape: 50}), 0).index, 0);
  assert.equal(hailIndex(storm({temperature_500hPa: -3}), 0).index, 0);
  assert.equal(hailIndex(storm({wind_speed_500hPa: 20}), 0).index, 0);        // 5.6 m/s of wind change, under the 8 m/s floor
  assert.equal(hailIndex(storm({showers: 0, weather_code: 3}), 0).index, 0);  // no convective trigger
});
test('mid-range ingredients give the weighted geometric mean', () => {
  // cape 800 -> 0.5; shear 14 -> 0.5; -T500 10 -> 0.5; trigger 0.5 -> 100 * 0.5 * 0.5 = 25
  const r = hailIndex(storm({cape: 800, wind_speed_500hPa: 50.4, temperature_500hPa: -10, showers: 0.5}), 0);
  assert.ok(Math.abs(r.parts.cape - 700 / 1400) < 1e-12);
  assert.ok(Math.abs(r.shear - 14) < 1e-9);
  assert.equal(r.index, 25);
});
test('an explicit ECMWF hail code never scores below the floor, and unavailable data stays unavailable', () => {
  assert.equal(hailIndex(storm({weather_code: 96, cape: 0}), 0).index, HAIL.codeFloor);
  const none = hailIndex({weather_code: [3]}, 0);
  assert.equal(none.index, null);
  assert.equal(hailLabel(null), 'Unavailable');
  assert.deepEqual([5, 15, 30, 80].map(hailLabel), ['Very low', 'Low', 'Moderate', 'High']);
});
test('hailOver takes the strongest hour', () => {
  const h = {time: ['a', 'b'], weather_code: [3, 80], cape: [0, 1500], temperature_500hPa: [-5, -15], wind_speed_500hPa: [0, 72], wind_direction_500hPa: [0, 270], wind_speed_10m: [0, 0], wind_direction_10m: [0, 270], showers: [0, 1]};
  const r = hailOver(h, [0, 1]);
  assert.equal(r.index, 100);
  assert.equal(r.at, 1);
  assert.equal(r.label, 'High');
});

function day(over = {}) {
  const hours = Array.from({length: 48}, (_, i) => `2026-01-${i < 24 ? '10' : '11'}T${String(i % 24).padStart(2, '0')}:00`);
  const fill = v => hours.map(() => v);
  return {
    hourly: {time: hours, weather_code: fill(0), precipitation: fill(0), rain: fill(0), snowfall: fill(0), showers: fill(0), cape: fill(0), temperature_500hPa: fill(-5), wind_speed_500hPa: fill(0), wind_direction_500hPa: fill(0), wind_speed_10m: fill(0), wind_direction_10m: fill(0), temperature_2m: fill(10), ...over},
    daily: {time: ['2026-01-10', '2026-01-11'], sunrise: ['2026-01-10T07:00', '2026-01-11T07:00'], sunset: ['2026-01-10T17:30', '2026-01-11T17:30']},
  };
}
test('day is sunrise to sunset and night runs to the next sunrise', () => {
  const {hourly, daily} = day();
  const [d0, d1] = periodRows(hourly, daily);
  assert.deepEqual([d0.day[0], d0.day.at(-1)], [7, 17]);
  assert.deepEqual([d0.night[0], d0.night.at(-1)], [18, 30]);                 // 18:00 on the 10th to 06:00 on the 11th
  assert.equal(d1.night.at(-1), 47);                                          // last night: to the end of the data
});
test('clear sky is a sun by day and a moon by night; cloud has its own night icon', () => {
  const {hourly, daily} = day({weather_code: Array(48).fill(2)});
  const w = weekPeriods(hourly, daily)[0];
  assert.deepEqual([w.day.icon, w.day.label, w.night.icon], ['partly', 'Partly cloudy', 'moonpartly']);
  const clear = weekPeriods(day().hourly, day().daily)[0];
  assert.deepEqual([clear.day.icon, clear.night.icon, clear.night.label], ['sun', 'moon', 'Clear night']);
});
test('snow at night is reported for the night and not the day', () => {
  const snowfall = Array(48).fill(0), code = Array(48).fill(1), precipitation = Array(48).fill(0);
  for (let i = 20; i < 26; i++) { snowfall[i] = 1; code[i] = 73; precipitation[i] = 1; }   // 6 cm between 20:00 and 02:00
  const w = weekPeriods(...Object.values(day({snowfall, weather_code: code, precipitation})))[0];
  assert.equal(w.day.icon, 'sun');
  assert.equal(w.night.icon, 'snow');
  assert.equal(w.night.label, 'Heavy snow');
  assert.equal(w.night.snowCm, 6);
});
test('light snow and rain bands', () => {
  const snowfall = Array(48).fill(0), code = Array(48).fill(1), precipitation = Array(48).fill(0);
  snowfall[9] = 0.4; code[9] = 71; precipitation[9] = 0.5;
  let w = weekPeriods(day({snowfall, weather_code: code, precipitation}).hourly, day().daily)[0];
  assert.equal(w.day.label, 'Light snow');
  const rainP = Array(48).fill(0), c2 = Array(48).fill(1); rainP[10] = 4; c2[10] = 63;
  w = weekPeriods(day({precipitation: rainP, rain: rainP, weather_code: c2}).hourly, day().daily)[0];
  assert.equal(w.day.label, 'Scattered rain chances');
  assert.equal(w.day.rainMm, 4);
});
test('a hail-capable afternoon shows hail, and a stormy code without ingredients shows thunderstorm', () => {
  const ing = {weather_code: Array(48).fill(80), showers: Array(48).fill(1), cape: Array(48).fill(1500), temperature_500hPa: Array(48).fill(-15), wind_speed_500hPa: Array(48).fill(72), wind_direction_500hPa: Array(48).fill(270), precipitation: Array(48).fill(1)};
  const w = weekPeriods(day(ing).hourly, day().daily)[0];
  assert.equal(w.day.icon, 'hail');
  assert.equal(w.day.hail.index, 100);
  const code = Array(48).fill(1); code[12] = 95;
  const t = weekPeriods(day({weather_code: code}).hourly, day().daily)[0];
  assert.equal(t.day.icon, 'storm');
  assert.equal(describePeriod(day().hourly, [], false).label, 'No data');
});

test('ECMWF has no showers field or thunder codes: CAPE with rain is the thunder and hail trigger', () => {
  const hours = 48, fill = v => Array(hours).fill(v);
  const base = day({showers: fill(0), weather_code: fill(63), cape: fill(1500), precipitation: fill(1), temperature_500hPa: fill(-15), wind_speed_500hPa: fill(72), wind_direction_500hPa: fill(270)});
  const w = weekPeriods(base.hourly, base.daily)[0];
  assert.equal(w.day.icon, 'hail');                                          // strong ingredients plus rain
  const weak = day({showers: fill(0), weather_code: fill(63), cape: fill(600), precipitation: fill(1)});
  const t = weekPeriods(weak.hourly, weak.daily)[0];
  assert.equal(t.day.icon, 'storm');                                         // CAPE 600 and 1 mm/h: thunderstorm chances, no hail ingredients
  assert.match(t.day.label, /hunderstorm chances/);
  const dry = day({showers: fill(0), cape: fill(1500), precipitation: fill(0)});
  assert.equal(weekPeriods(dry.hourly, dry.daily)[0].day.icon, 'sun');       // CAPE alone, no rain: no signal
});

import {nearbyStrikes, fetchStrikes} from '../public/lightning-nearby.js';
test('observed lightning: only strikes inside the radius and the last hour count', () => {
  const now = Date.parse('2026-06-10T12:00:00Z'), min = m => now - m * 60000;
  const strikes = [
    {lat: 33.70, lon: 73.05, time: min(5)},          // about 1 km
    {lat: 33.80, lon: 73.05, time: min(30)},         // about 12 km
    {lat: 34.00, lon: 73.05, time: min(10)},         // 33 km: outside the radius
    {lat: 33.70, lon: 73.05, time: min(90)},         // too old
    {lat: 33.70, lon: 73.05, time: now + 3600000},   // in the future
  ];
  const r = nearbyStrikes(strikes, 33.69, 73.05, now);
  assert.equal(r.count, 2);
  assert.ok(r.nearest > 0.9 && r.nearest < 1.3);
  assert.equal(r.latest, min(5));
  assert.equal(nearbyStrikes([], 33.69, 73.05, now).count, 0);
});
test('the strike feed is cleaned and old strikes dropped', async () => {
  const now = Date.parse('2026-06-10T12:00:00Z');
  const fetcher = async () => ({ok: true, json: async () => ({strikes: [[33.7, 73.0, now - 60000], [33.7, 73.0, now - 5 * 3600000], [10, 10, now]]})});
  const rows = await fetchStrikes({fetcher, now});
  assert.equal(rows.length, 1);
  await assert.rejects(fetchStrikes({fetcher: async () => ({ok: false, status: 500}), now}));
});
