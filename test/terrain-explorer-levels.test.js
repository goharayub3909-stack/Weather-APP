import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESSURE_LEVELS, WIND_LEVELS, levelAltitude, levelFile, levelFields, levelReady, unpackLevelFile, mergeLevel, levelUnderground, UNDERGROUND_MARGIN_M,
  LEVEL_TEMP_RANGE, temperatureRange, levelTemperatureColour, temperatureTicksFor, temperatureColour, sunElevationDeg, weatherIcon, windClass, forecastTable,
  pointRows, GridSampler, CLOUD_OKTAS} from '../public/explorer/core.js';

// ---- the levels ----
test('nine pressure levels from 1000 to 250 hPa plus the surface, each with its height in metres and feet', () => {
  assert.deepEqual(PRESSURE_LEVELS, [1000, 925, 850, 700, 600, 500, 400, 300, 250]);
  assert.deepEqual(Object.keys(WIND_LEVELS).sort(), ['1000', '250', '300', '400', '500', '600', '700', '850', '925', 'sfc']);
  const heights = PRESSURE_LEVELS.map(l => WIND_LEVELS[l].heightM);
  assert.ok(heights.every((h, i) => i === 0 || h > heights[i - 1]), 'lower pressure is higher up');
  const a = levelAltitude('850');
  assert.deepEqual([a.top, a.unit, a.m, a.ft], ['850', 'hPa', '1.5 km', '4,780 ft']);
  assert.deepEqual([levelAltitude('1000').m, levelAltitude('925').m], ['111 m', '762 m']);                 // under a kilometre: metres
  assert.deepEqual([levelAltitude('250').m, levelAltitude('250').ft], ['10.4 km', '34,000 ft']);
  assert.deepEqual([levelAltitude('sfc').top, levelAltitude('sfc').m, levelAltitude('sfc').ft], ['Surface', '10 m', '30 ft']);
  assert.equal(levelAltitude('nope'), null);
  assert.equal(WIND_LEVELS.sfc.heightKm, 0);                                                                // the surface wind is drawn on the ground
  assert.equal(levelFile(500), 'levels/p500.json');
  assert.deepEqual(levelFields(300), ['u300', 'v300', 't300', 'gh300']);
});

// ---- the per-level file loader ----
const GRID = {west: 60, east: 60.2, south: 23, north: 23.2, spacing: 0.1, columns: 3, rows: 3};
const pack = (vals, scale) => Buffer.from(Int16Array.from(vals.map(v => v === null ? -32768 : Math.round(v * scale))).buffer).toString('base64');
const dataset = () => ({run: '2026-11-17T00:00:00Z', grid: GRID, hours: [0, 3, 6], times: ['2026-11-17T00:00:00Z', '2026-11-17T03:00:00Z', '2026-11-17T06:00:00Z']});
function levelFile9(level, over = {}) {
  const f = (a) => [pack(a, 10), pack(a, 10), pack(a, 10)];
  return {schema_version: 1, kind: 'pressure_level', model: 'ecmwf_ifs_0p1', level, run: '2026-11-17T00:00:00Z', grid: GRID, hours: [0, 3, 6], scales: {u: 10, v: 10, t: 10, gh: 1},
    u: f([1.5, -2.5, 0, 3, null, 4, 5, 6, 7]), v: f([0, 0, 0, 0, 0, 0, 0, 0, 0]), t: f([-20.5, -20, -19, -18, -17, -16, -15, -14, -13]),
    gh: [pack([1500, 1510, 1520, 1530, 1540, 1550, 1560, 1570, 1580], 1), pack([1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500], 1), pack([0, 0, 0, 0, 0, 0, 0, 0, 0], 1)], ...over};
}
test('a level file of the same run, grid and steps unpacks to named fields, with missing values as NaN', () => {
  const r = unpackLevelFile(levelFile9(500), dataset());
  assert.equal(r.level, 500);
  assert.deepEqual(Object.keys(r.fields), ['u500', 'v500', 't500', 'gh500']);
  assert.equal(r.fields.u500.length, 3);
  assert.ok(r.fields.u500[0] instanceof Float32Array);
  assert.deepEqual([...r.fields.u500[0].slice(0, 3)], [1.5, -2.5, 0]);
  assert.ok(Number.isNaN(r.fields.u500[0][4]));                                                            // the missing marker
  assert.equal(r.fields.t500[0][0].toFixed(1), '-20.5');
  assert.equal(r.fields.gh500[0][8], 1580);
});
test('a level file of another run, grid or step list, or with a damaged field, is refused', () => {
  const d = dataset();
  assert.equal(unpackLevelFile(levelFile9(500, {run: '2026-11-16T12:00:00Z'}), d), null);
  assert.equal(unpackLevelFile(levelFile9(500, {grid: {...GRID, spacing: 0.25}}), d), null);
  assert.equal(unpackLevelFile(levelFile9(500, {hours: [0, 3]}), d), null);
  assert.equal(unpackLevelFile(levelFile9(500, {hours: [0, 3, 9]}), d), null);
  assert.equal(unpackLevelFile(levelFile9(123), d), null);                                                // not one of the levels
  assert.equal(unpackLevelFile(levelFile9(500, {kind: 'surface'}), d), null);
  const bad = levelFile9(500); bad.t = bad.t.slice(0, 2); assert.equal(unpackLevelFile(bad, d), null);   // a step missing
  const short = levelFile9(500); short.gh[1] = 'AAAA'; assert.equal(unpackLevelFile(short, d), null);    // wrong size
  assert.equal(unpackLevelFile(null, d), null); assert.equal(unpackLevelFile({}, d), null);
});
test('merging a level into the dataset keeps fields that are already there, and levelReady needs all four', () => {
  const d = {...dataset(), u850: ['kept'], v850: ['kept']};
  const sampler = new GridSampler(d);
  assert.equal(levelReady(sampler, 'sfc'), true);
  assert.equal(levelReady(sampler, '850'), false);                                                         // the main grid has the 850 winds but not t and gh
  mergeLevel(d, unpackLevelFile(levelFile9(850), dataset()).fields);
  assert.deepEqual(d.u850, ['kept']);                                                                      // the main grid's own winds stay
  assert.ok(d.t850 && d.gh850);
  assert.equal(levelReady(sampler, '850'), true);
  assert.equal(levelReady(sampler, '500'), false);
});

// ---- underground ----
test('a level is underground where the 1 km terrain is above it, with a margin, and where it has no height', () => {
  assert.equal(UNDERGROUND_MARGIN_M, 50);
  assert.equal(levelUnderground(1000, 1457), false);                                                       // Gilgit valley floor, 850 hPa
  assert.equal(levelUnderground(2600, 1457), true);                                                        // a Karakoram ridge under 850 hPa
  assert.equal(levelUnderground(1400, 1457), false);                                                       // 1457 - 50 = 1407 is still above 1400 m
  assert.equal(levelUnderground(1420, 1457), true);                                                        // within the margin: hidden
  assert.equal(levelUnderground(1420, 1457, 0), false);
  assert.equal(levelUnderground(0, NaN), true);                                                            // the model had nothing there
  assert.equal(levelUnderground(8000, 5574), true);                                                        // K2 is above 500 hPa
});

// ---- temperature colours per level ----
test('each level colours temperature over its own range, so the upper air is not blue everywhere', () => {
  for (const l of PRESSURE_LEVELS) { const [lo, hi] = LEVEL_TEMP_RANGE[l]; assert.ok(hi > lo); assert.deepEqual(levelTemperatureColour(lo, l), temperatureColour(-30)); assert.deepEqual(levelTemperatureColour(hi, l), temperatureColour(50)); }
  assert.deepEqual(levelTemperatureColour(-50, 250), temperatureColour(-30 + (-50 + 70) / 40 * 80));        // mid-range at 250 hPa
  assert.notDeepEqual(levelTemperatureColour(-50, 250), levelTemperatureColour(-50, 850));
  assert.deepEqual(temperatureRange('sfc'), [-30, 50]);
  assert.deepEqual(temperatureTicksFor('sfc'), [-30, -10, 10, 30, 50]);
  assert.deepEqual(temperatureTicksFor('500'), [-45, -34, -22, -11, 0]);
  const ranges = PRESSURE_LEVELS.map(l => LEVEL_TEMP_RANGE[l]);
  assert.ok(ranges.every((r, i) => i === 0 || (r[0] <= ranges[i - 1][0] && r[1] <= ranges[i - 1][1])));      // colder with height
});

// ---- the sun and the icons ----
const T = (s) => Date.parse(s);
test('the sun is up at local noon and down at local midnight, at the right height for the season', () => {
  const noon = sunElevationDeg(33.7, 73.1, T('2026-11-17T07:00:00Z')), midnight = sunElevationDeg(33.7, 73.1, T('2026-11-16T19:00:00Z'));
  assert.ok(noon > 33 && noon < 40, `Islamabad noon in mid-November: ${noon.toFixed(1)}`);                // 90 - 33.7 - 19 = 37 degrees
  assert.ok(midnight < -50);
  const june = sunElevationDeg(33.7, 73.1, T('2026-06-21T07:10:00Z'));
  assert.ok(june > 77 && june < 81, `Islamabad noon at the June solstice: ${june.toFixed(1)}`);            // 90 - 33.7 + 23.4 = 79.7
  assert.ok(sunElevationDeg(35.9, 74.3, T('2026-12-21T07:00:00Z')) < 33);                                  // Gilgit at the December solstice
  assert.ok(sunElevationDeg(33.7, 73.1, T('2026-11-17T01:30:00Z')) < 0 && sunElevationDeg(33.7, 73.1, T('2026-11-17T02:00:00Z')) > 0);   // sunrise between 06:30 and 07:00 local
  assert.ok(sunElevationDeg(33.7, 73.1, T('2026-11-17T11:30:00Z')) > 0 && sunElevationDeg(33.7, 73.1, T('2026-11-17T12:30:00Z')) < 0);   // sunset between 16:30 and 17:30
});
test('icons: snow, thunder, rain by rate, then cloud classes by oktas, with day and night', () => {
  assert.equal(weatherIcon({precip: 2, snow: 2, cloud: 100, cape: 0}, true), 'snow');                     // 2 cm of snow is 1.4 mm of the 2 mm: more than half
  assert.equal(weatherIcon({precip: 2, snow: 0.2, cloud: 100, cape: 0}, true), 'rain');
  assert.equal(weatherIcon({precip: 2, snow: 0, cloud: 100, cape: 800}, true), 'thunder');                // CAPE >= 500 and rain >= 0.5
  assert.equal(weatherIcon({precip: 0.3, snow: 0, cloud: 100, cape: 800}, true), 'rain-light');           // too little rain for the convective rule
  assert.equal(weatherIcon({precip: 0.5, snow: 0, cloud: 90, cape: null}, true), 'rain-light');
  assert.equal(weatherIcon({precip: 5, snow: 0, cloud: 90, cape: 0}, true), 'rain-heavy');
  assert.equal(weatherIcon({precip: 0.05, snow: 0, cloud: 10, cape: 0}, true), 'clear-day');              // below the drizzle limit: dry
  assert.equal(weatherIcon({precip: 0, cloud: 10}, false), 'clear-night');
  assert.equal(weatherIcon({precip: 0, cloud: CLOUD_OKTAS.clear}, true), 'partly-day');
  assert.equal(weatherIcon({precip: 0, cloud: CLOUD_OKTAS.scattered}, false), 'cloudy');
  assert.equal(weatherIcon({precip: 0, cloud: CLOUD_OKTAS.broken}, true), 'overcast');
  assert.equal(weatherIcon({precip: null, cloud: null}, true), 'clear-day');                              // no data: the quiet default
});
test('wind classes follow the Beaufort steps in km/h', () => {
  assert.deepEqual([0, 11.9, 12, 38.9, 39, 61.9, 62, 88.9, 89, 150].map(windClass), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(windClass(NaN), 0);
});

// ---- the forecast table ----
function rows(n, extra = () => ({})) {
  const t0 = T('2026-11-17T00:00:00Z'), out = [];
  for (let h = 0; h < n; h++) out.push({t: t0 + h * 3600000, temp: 10 + h * 0.1, precip: 0, snow: 0, wind: 5, dir: 270, gust: null, cape: 0, cloud: 20, ...extra(h)});
  return out;
}
test('the table has a column every three local hours (00, 03, ... 21 PKT), grouped by local day', () => {
  const t = forecastTable(rows(145), {lat: 33.7, lon: 73.1});
  assert.equal(t.columns[0].hour, '06:00');                                                                // the run starts at 05:00 local: the first aligned column is 06:00
  assert.ok(t.columns.every(c => Number(c.hour.slice(0, 2)) % 3 === 0));
  assert.ok(t.columns.every((c, i) => i === 0 || c.t - t.columns[i - 1].t === 3 * 3600000));
  assert.equal(t.columns.length, 48);                                                                      // 06:00 on the 17th to 03:00 on the 23rd: six days
  assert.equal(t.days[0].label, 'Tue 17 Nov'); assert.equal(t.days[0].span, 6);                              // 06, 09, 12, 15, 18, 21
  assert.equal(t.days.at(-1).span, 2);                                                                     // 00:00 and 03:00 on the 23rd
  assert.equal(t.days[1].label, 'Wed 18 Nov'); assert.equal(t.days[1].span, 8);
  assert.equal(t.days.reduce((s, d) => s + d.span, 0), t.columns.length);
  assert.equal(t.speedUnit, 'km/h');
});
test('rain is the sum of the column\'s three hours, wind in the chosen unit, arrows point where the wind goes', () => {
  const r = rows(24, h => ({precip: h >= 1 && h <= 3 ? 1.5 : 0, wind: 10, dir: 270}));
  const c = forecastTable(r, {lat: 33.7, lon: 73.1}).columns[0];                                          // hours 1, 2, 3 after the run start
  assert.equal(c.rain, 4.5);
  assert.equal(c.wind, 36); assert.equal(c.arrow, 90);                                                     // from the west (270), blowing towards the east (90)
  assert.equal(forecastTable(r, {speedUnit: 'kt'}).columns[0].wind, 19);
  assert.equal(forecastTable(r, {speedUnit: 'kt'}).speedUnit, 'kt');
  assert.equal(c.icon, 'rain');
});
test('gusts colour the arrows where ECMWF gives them, plain speed elsewhere, and missing data stays missing', () => {
  const r = rows(80, h => ({wind: 5, gust: h < 60 ? 20 : null}));
  const t = forecastTable(r, {lat: 33.7, lon: 73.1});
  const early = t.columns[0], late = t.columns.at(-1);
  assert.deepEqual([early.hasGust, early.gust, early.strength], [true, 72, 3]);                            // 20 m/s = 72 km/h: a gale
  assert.deepEqual([late.hasGust, late.gust, late.strength], [false, null, 1]);                            // 5 m/s = 18 km/h, no gust data
  const hole = forecastTable(rows(30, h => ({temp: h === 1 ? null : 10, precip: h === 2 ? null : 0, wind: null, dir: null})), {});
  assert.equal(hole.columns[0].temp, null); assert.equal(hole.columns[0].rain, null); assert.equal(hole.columns[0].wind, null); assert.equal(hole.columns[0].arrow, null);
  assert.equal(forecastTable([], {}).columns.length, 0);
});
test('a column is marked 1 km only when all three of its hours are, and the day flag follows the sun', () => {
  const r = rows(48, h => ({km1: h < 25}));
  const t = forecastTable(r, {lat: 33.7, lon: 73.1});
  assert.equal(t.columns.filter(c => c.km1).length, t.columns.filter(c => c.t < r[0].t + 23 * 3600000).length);
  assert.ok(t.columns.slice(0, 7).every(c => c.km1));
  assert.ok(t.columns.at(-1).km1 === false);
  const byHour = Object.fromEntries(t.columns.slice(0, 8).map(c => [c.hour, c.day]));
  assert.equal(byHour['12:00'], true); assert.equal(byHour['00:00'], false); assert.equal(byHour['21:00'], false);
});

// ---- point rows now carry direction and gust ----
test('point rows give the direction the wind comes from, and gust only while the grid has it', () => {
  const n = 9, f = v => Float32Array.from({length: n}, () => v), nan = Float32Array.from({length: n}, () => NaN);
  const d = {grid: GRID, hours: [0, 3], times: ['2026-11-17T00:00:00Z', '2026-11-17T03:00:00Z'], u: [f(-5), f(-5)], v: [f(0), f(0)], precip: [f(0), f(0)], snow: [f(0), f(0)], cloud: [f(50), f(50)], gust: [f(12), nan]};
  const r = pointRows(new GridSampler(d), 60.1, 23.1);
  assert.equal(r.length, 4);
  assert.ok(Math.abs(r[0].dir - 90) < 1e-6, `wind blowing towards the west comes from the east: ${r[0].dir}`);        // u = -5: blowing towards the west
  assert.equal(r[0].gust, 12);
  assert.equal(r[3].gust, null);                                                                           // the second step has no gust: the end of the interpolation is missing
  const d2 = {...d, u: [f(0), f(0)], v: [f(-5), f(-5)]};
  assert.ok(Math.abs(pointRows(new GridSampler(d2), 60.1, 23.1)[0].dir - 0) < 1e-6 || Math.abs(pointRows(new GridSampler(d2), 60.1, 23.1)[0].dir - 360) < 1e-6);   // v = -5: from the north
});
