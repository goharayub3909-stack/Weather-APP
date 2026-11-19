import test from 'node:test';
import assert from 'node:assert/strict';
import {
  heatLevel, warmNightLevel, coldLevel, rainClass, declare, daysInYear, buildNormals, normalFor, slotOf, evaluateDaily, yearlySummary,
  frequency, periodMean, trendPerDecade, periodSummary, observedScreen, insideOutline, gridPoints, rampColor, RAMPS, absoluteScreen, autoTerrain, daysInMonth,
} from '../public/climate-hazards.js';
import {withSignal, era5URL, forecastDailyURL, latestERA5Date, periodRange, aggregateCell, parseDaily} from '../public/climate-era5.js';

test('heat wave: departure rule needs the terrain floor, absolute rule is plains only', () => {
  assert.deepEqual(heatLevel({tmax: 42, normMax: 36}), {level: 1, basis: 'departure', departure: 6});
  assert.equal(heatLevel({tmax: 43, normMax: 36}).level, 2);                       // +7.0 is severe
  assert.equal(heatLevel({tmax: 42, normMax: 37.5}).level, 1);                     // +4.5 is the lower bound
  assert.equal(heatLevel({tmax: 41.9, normMax: 37.5}).level, 0);                   // +4.4 is not enough
  assert.equal(heatLevel({tmax: 39, normMax: 33}).level, 0);                       // under the 40 °C plains floor
  assert.equal(heatLevel({tmax: 38, normMax: 33, terrain: 'coastal'}).level, 1);   // coastal floor is 37 °C
  assert.equal(heatLevel({tmax: 33, normMax: 28, terrain: 'hills'}).level, 1);     // hills floor is 30 °C
  assert.deepEqual(heatLevel({tmax: 45.5, normMax: 44}), {level: 1, basis: 'absolute', departure: 1.5});
  assert.equal(heatLevel({tmax: 47, normMax: 46}).level, 2);
  assert.equal(heatLevel({tmax: 46, normMax: 45, terrain: 'hills'}).level, 0);     // hills: departure only, +1 is not enough
  assert.equal(heatLevel({tmax: null, normMax: 40}).level, null);
  assert.equal(heatLevel({tmax: 44}).level, 0);                                    // no normal: only the absolute rule can apply
});

test('warm night needs a heat-wave-level maximum and a +4.5 °C minimum', () => {
  assert.equal(warmNightLevel({tmax: 41, tmin: 29, normMin: 24}).level, 1);        // +5.0
  assert.equal(warmNightLevel({tmax: 41, tmin: 31, normMin: 24}).level, 2);        // +7.0
  assert.equal(warmNightLevel({tmax: 41, tmin: 28, normMin: 24}).level, 0);        // +4.0
  assert.equal(warmNightLevel({tmax: 38, tmin: 31, normMin: 24}).level, 0);        // Tmax below 40 °C
  assert.equal(warmNightLevel({tmax: 41, tmin: 31, normMin: null}).level, null);
});

test('cold wave: departure with the ceiling, absolute limits on plains only', () => {
  assert.equal(coldLevel({tmin: 5, normMin: 10}).level, 1);                        // -5.0 and below 10 °C
  assert.equal(coldLevel({tmin: 4, normMin: 11}).level, 2);                        // -7.0
  assert.equal(coldLevel({tmin: 11, normMin: 17}).level, 0);                       // above the 10 °C ceiling
  assert.deepEqual(coldLevel({tmin: 3.5, normMin: 6}), {level: 1, basis: 'absolute', departure: -2.5});
  assert.equal(coldLevel({tmin: 2, normMin: 4}).level, 2);                         // 2 °C is severe
  assert.equal(coldLevel({tmin: 4.1, normMin: 6}).level, 0);
  assert.equal(coldLevel({tmin: -2, normMin: 3, terrain: 'hills'}).level, 1);      // hills: ceiling 0 °C, -5.0
  assert.equal(coldLevel({tmin: -4, normMin: 3, terrain: 'hills'}).level, 2);      // -7.0
  assert.equal(coldLevel({tmin: 3, normMin: 3, terrain: 'hills'}).level, 0);       // no absolute rule on hills
  assert.equal(coldLevel({tmin: 1, terrain: 'hills'}).level, 0);
  assert.equal(coldLevel({tmin: undefined}).level, null);
});

test('IMD 24-hour rainfall classes', () => {
  const label = mm => rainClass(mm).label;
  assert.equal(label(0), 'No rain');
  assert.equal(label(0.1), 'Very light');
  assert.equal(label(2.4), 'Very light');
  assert.equal(label(2.5), 'Light');
  assert.equal(label(15.5), 'Light');
  assert.equal(label(15.6), 'Moderate');
  assert.equal(label(64.4), 'Moderate');
  assert.equal(label(64.5), 'Heavy');
  assert.equal(label(115.6), 'Very heavy');
  assert.equal(label(204.5), 'Extremely heavy');
  assert.equal(rainClass(NaN).level, null);
});

test('two-day persistence declares an event on the second day', () => {
  assert.deepEqual(declare([0, 1, 1, 2, 0, 1]).map(d => d.declared), [0, 0, 1, 2, 0, 0]);
  assert.deepEqual(declare([1, null, 1, 1]).map(d => d.declared), [0, 0, 0, 1]);   // a missing day breaks the run
  assert.deepEqual(declare([1, 1], 3).map(d => d.declared), [0, 0]);
});

test('calendar slots keep 29 February separate', () => {
  assert.equal(slotOf('2024-01-01'), 0);
  assert.equal(slotOf('2024-02-29'), 59);
  assert.equal(slotOf('2023-03-01'), 60);
  assert.equal(slotOf('2023-12-31'), 365);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
});

test('normals average the base period only and smooth around the year', () => {
  const time = [], tmax = [];
  for (let y = 1990; y <= 2021; y++) { time.push(`${y}-07-15`); tmax.push(y === 1990 || y === 2021 ? 99 : y <= 2005 ? 20 : 30); }   // years outside 1991-2020 are ignored
  const n = buildNormals({time, tmax, tmin: tmax, tmean: tmax});
  assert.equal(normalFor(n, '2030-07-15', 'tmax'), 25);
  assert.equal(n.years, 30);
  assert.equal(normalFor(n, '2030-01-01', 'tmax'), null);                         // a window with no samples stays null
  // Smoothing: a neighbouring day inside the +-5 day window sees the same samples.
  assert.equal(normalFor(n, '2030-07-18', 'tmax'), 25);
});

const flatNormals = {tmax: Array(366).fill(36), tmin: Array(366).fill(22)};

test('evaluateDaily applies persistence and links warm nights to declared heat', () => {
  const rows = evaluateDaily({time: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'], tmax: [42, 43, 35, 42], tmin: [28, 30, 20, 27], precip: [0, 0, 70, null]}, flatNormals, 'plains');
  assert.deepEqual(rows.map(r => r.heatMet), [1, 2, 0, 1]);
  assert.deepEqual(rows.map(r => r.heatDeclared), [0, 2, 0, 0]);
  assert.deepEqual(rows.map(r => r.warmNightDeclared), [0, 2, 0, 0]);             // 30 - 22 = +8 on the declared day
  assert.equal(rows[2].rain.label, 'Heavy');
  assert.equal(rows[3].rain.level, null);
  assert.equal(rows[0].heat.departure, 6);
});

test('yearly counts, ETCCDI indices and completeness', () => {
  const time = [], tmax = [], tmin = [], precip = [];
  for (let i = 0; i < 10; i++) { time.push(`2020-01-${String(i + 1).padStart(2, '0')}`); tmax.push(i < 4 ? 41 : 20); tmin.push(i === 8 ? -1 : 8); precip.push([0, 0.5, 25, 0, 0, 0, 12, 0, 0, 130][i]); }
  const rows = evaluateDaily({time, tmax, tmin, precip}, {tmax: Array(366).fill(35), tmin: Array(366).fill(8)}, 'plains');
  const [y] = yearlySummary(rows);
  assert.equal(y.year, 2020);
  assert.equal(y.hotDays, 4);                      // Tmax >= 40
  assert.equal(y.heatDays, 3);                     // +6 departure on days 1-4, declared from day 2
  assert.equal(y.frostDays, 1);
  assert.equal(y.heavyRainDays, 1);                // 130 mm
  assert.equal(y.r10, 3);                          // 25, 12, 130
  assert.equal(y.r20, 2);
  assert.equal(y.rx1, 130);
  assert.equal(y.txx, 41);
  assert.equal(y.tnn, -1);
  assert.equal(y.cdd, 3);                          // days 4-6 are the longest dry run (< 1 mm); day 2 is 0.5 mm so days 1-2 also count as dry
  assert.equal(y.precipTotal, 167.5);
  assert.equal(y.complete, false);                 // 10 days is a year in progress
});

test('a year is complete only with every day and 90% valid temperatures', () => {
  const make = (days, missing) => { const time = [], tmax = [], tmin = []; for (let i = 0; i < days; i++) { const d = new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10); time.push(d); tmax.push(i < missing ? null : 30); tmin.push(15); } return evaluateDaily({time, tmax, tmin, precip: tmax.map(() => 0)}, flatNormals, 'plains'); };
  assert.equal(yearlySummary(make(365, 0))[0].complete, true);
  assert.equal(yearlySummary(make(364, 0))[0].complete, false);   // a day short
  assert.equal(yearlySummary(make(365, 36))[0].complete, true);   // 329 of 365 valid = 90.1%
  assert.equal(yearlySummary(make(365, 37))[0].complete, false);  // 328 of 365 valid = 89.9%
  assert.equal(daysInYear(2024), 366);
  assert.equal(daysInYear(1900), 365);
  assert.equal(daysInYear(2000), 366);
});

test('frequency, period means and trend', () => {
  const years = Array.from({length: 12}, (_, i) => ({year: 2000 + i, complete: true, heatDays: i < 6 ? 0 : i - 5}));
  assert.deepEqual(frequency(years, 'heatDays'), {years: 12, withEvents: 6, mean: 21 / 12, share: 0.5});
  assert.equal(periodMean(years, 'heatDays', 2006, 2011), 3.5);
  assert.equal(periodMean(years, 'heatDays', 1990, 1995), null);
  const line = Array.from({length: 12}, (_, i) => ({year: 2000 + i, complete: true, v: 2 + 0.5 * i}));
  assert.ok(Math.abs(trendPerDecade(line, 'v') - 5) < 1e-9);                      // 0.5 per year = 5 per decade
  assert.equal(trendPerDecade(line.slice(0, 5), 'v'), null);                      // too few years
  assert.equal(frequency([{year: 1, complete: false, heatDays: 3}], 'heatDays').mean, null);
});

test('period summary needs 80% coverage for means', () => {
  const time = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
  const rows = evaluateDaily({time, tmax: [40, 42, 44, null, 46], tmin: [20, 22, 24, 26, 28], precip: [0, 10, null, null, 5]}, flatNormals, 'plains');
  const s = periodSummary(rows, flatNormals, '2026-06');
  assert.equal(s.tmax, 43);
  assert.equal(s.tmin, 24);
  assert.equal(s.precip, null);                    // only 3 of 5 days reported
  assert.equal(s.txx, 46);
  assert.equal(periodSummary(rows, flatNormals, '2025-06'), null);
});

test('a current reading only proves a criterion it already meets', () => {
  const normals = {tmax: Array(366).fill(36), tmin: Array(366).fill(8)};
  assert.equal(observedScreen({temperature: 43, date: '2026-06-02', normals, terrain: 'plains'}).heat.level, 2);
  assert.equal(observedScreen({temperature: 39, date: '2026-06-02', normals, terrain: 'plains'}).heat.level, 0);
  assert.equal(observedScreen({temperature: 3, date: '2026-01-02', normals, terrain: 'plains'}).cold.level, 1);
  assert.equal(observedScreen({temperature: -1, date: '2026-01-02', normals, terrain: 'plains'}).frost, true);
  assert.equal(observedScreen({temperature: null, date: '2026-06-02', normals, terrain: 'plains'}), null);
});

test('map grid covers Pakistan only', () => {
  assert.equal(insideOutline(33.69, 73.05), true);   // Islamabad
  assert.equal(insideOutline(24.86, 67.01), true);   // Karachi
  assert.equal(insideOutline(31.55, 74.35), true);   // Lahore
  assert.equal(insideOutline(28.6, 77.2), false);    // Delhi
  assert.equal(insideOutline(34.5, 69.2), false);    // Kabul
  assert.equal(insideOutline(22, 65), false);        // Arabian Sea
  const g = gridPoints(1);
  assert.ok(g.length > 60 && g.length < 200, 'cells ' + g.length);
  assert.ok(g.every(([la, lo]) => insideOutline(la, lo)));
  assert.ok(gridPoints(0.5).length > g.length * 3);
});

test('colour ramp interpolates and clamps', () => {
  assert.equal(rampColor(-50, RAMPS.temperature), 'rgb(76,29,148)');
  assert.equal(rampColor(99, RAMPS.temperature), 'rgb(127,29,29)');
  assert.equal(rampColor(20, RAMPS.temperature), 'rgb(253,224,71)');
  assert.equal(rampColor(26, RAMPS.temperature), 'rgb(251,170,47)');              // halfway from 20 to 32
  assert.equal(rampColor(null, RAMPS.temperature), null);
});

test('map hazard screen uses absolute limits and skips hills', () => {
  assert.deepEqual(absoluteScreen({tmax: 46, tmin: 3, elevation: 200}), {heat: 1, cold: 1, terrain: 'plains'});
  assert.deepEqual(absoluteScreen({tmax: 47.2, tmin: 1.5, elevation: 200}), {heat: 2, cold: 2, terrain: 'plains'});
  assert.deepEqual(absoluteScreen({tmax: 46, tmin: -3, elevation: 2500}), {heat: null, cold: null, terrain: 'hills'});
  assert.equal(autoTerrain(999), 'plains');
  assert.equal(autoTerrain(1000), 'hills');
  assert.equal(autoTerrain(null), 'plains');
});

test('ERA5 requests and aggregation', () => {
  const u = era5URL(33.69, 73.05, '1991-01-01', '2026-10-22');
  assert.equal(u.hostname, 'archive-api.open-meteo.com');
  assert.equal(u.searchParams.get('models'), 'era5');
  assert.equal(u.searchParams.get('timezone'), 'Asia/Karachi');
  assert.match(u.searchParams.get('daily'), /temperature_2m_max,temperature_2m_min/);
  const f = forecastDailyURL(33.69, 73.05);
  assert.equal(f.searchParams.get('models'), 'ecmwf_ifs025');
  assert.equal(f.searchParams.get('past_days'), '2');
  assert.equal(latestERA5Date(Date.parse('2026-10-28T06:00:00Z')), '2026-10-22');
  assert.deepEqual(periodRange('month', 2024, 2, 1), ['2024-02-01', '2024-02-29']);
  assert.deepEqual(periodRange('year', 2020, 1, 1), ['2020-01-01', '2020-12-31']);
  assert.deepEqual(periodRange('day', 2020, 3, 5), ['2020-03-05', '2020-03-05']);
  const cell = aggregateCell({time: ['a', 'b', 'c', 'd', 'e'], tmax: [30, 32, 34, 36, 38], tmin: [10, null, null, null, 12], tmean: [20, 21, 22, 23, 24], precip: [0, 5, 5, 0, 10]});
  assert.equal(cell.tmax, 34);
  assert.equal(cell.tmin, null);                    // 2 of 5 days: not enough to average
  assert.equal(cell.precip, 20);
  assert.throws(() => parseDaily({}), /no daily values/);
  assert.deepEqual(parseDaily({elevation: 540, daily: {time: ['x'], temperature_2m_max: [NaN], temperature_2m_min: [1], temperature_2m_mean: [2], precipitation_sum: [null]}}).tmax, [null]);
});

test('a caller that aborts does not break the shared request', async () => {
  const shared = new Promise(resolve => setTimeout(() => resolve('data'), 20));
  const first = new AbortController(), second = new AbortController();
  const a = withSignal(shared, first.signal), b = withSignal(shared, second.signal);
  first.abort();
  await assert.rejects(a, {name: 'AbortError'});
  assert.equal(await b, 'data');                                                  // the other caller still gets the result
  const done = new AbortController(); done.abort();
  await assert.rejects(withSignal(shared, done.signal), {name: 'AbortError'});
  assert.equal(await withSignal(shared, undefined), 'data');
});
