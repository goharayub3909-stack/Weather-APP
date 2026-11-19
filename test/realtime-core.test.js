import test from 'node:test';
import assert from 'node:assert/strict';
import {PARAMS, NETWORKS, COLUMN_COUNT, columnTable, unpermute, parseLabel, isActive, validStamp, stationFeatures, stationReadings, stationsCsv, fmtValue, compass, getTextColor, catUnit} from '../public/realtime/core.js';

const PKT = 5 * 3600000, at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - PKT;          // a PKT wall-clock time as epoch ms
const now = at(2026, 11, 16, 10, 40);

test('time labels are PKT, 12 or 24 hour, and pick the year closest to now', () => {
  assert.equal(parseLabel('11:53 am, 13 November', now), at(2026, 11, 13, 11, 53));
  assert.equal(parseLabel('05:00 PM, 12 November', now), at(2026, 11, 12, 17, 0));
  assert.equal(parseLabel('12:05 AM, 16 November', now), at(2026, 11, 16, 0, 5));
  assert.equal(parseLabel('12:05 PM, 16 November', now), at(2026, 11, 16, 12, 5));
  assert.equal(parseLabel('09:10, 16 November', now), at(2026, 11, 16, 9, 10));                  // no am/pm: 24 hour
  assert.equal(parseLabel('11:00 pm, 31 December', at(2026, 1, 2, 9, 0)), at(2025, 12, 31, 23, 0));   // late December read in early January
  assert.equal(parseLabel('02:30 PM, 16 May', now), at(2026, 5, 16, 14, 30));                    // this May, not the nearer-looking next one
  assert.equal(parseLabel('11:30 am, 16 November', now), at(2026, 11, 16, 11, 30));              // 50 minutes ahead: clock skew, still today
  assert.equal(parseLabel('03:00 pm, 16 November', now), at(2025, 11, 16, 15, 0));               // hours ahead cannot be today, so last year
  assert.equal(parseLabel('29 February', now), null);
  assert.equal(parseLabel('01:00 am, 31 February', now), null);
  assert.equal(parseLabel('13:00 pm, 3 May', now), null);
  assert.equal(parseLabel('not a time', now), null);
  assert.equal(parseLabel(null, now), null);
});
test('a station is active when its sync is at most 30 minutes old', () => {
  assert.equal(isActive('10:20 am, 16 November', now), true);            // 20 min
  assert.equal(isActive('10:10 am, 16 November', now), true);            // exactly 30 min
  assert.equal(isActive('10:09 am, 16 November', now), false);           // 31 min
  assert.equal(isActive('11:30 am, 16 November', now), true);            // 50 min ahead (clock skew) is tolerated
  assert.equal(isActive('11:41 am, 16 November', now), false);           // 61 min ahead is not
  assert.equal(isActive(null, now), false);
});
test('PMD and IMD daily extremes must carry the expected hour; other networks are not checked', () => {
  assert.equal(validStamp('PMD', 'temperature', 'Maximum', '05:00 PM, 15 November', now), true);          // 10:40 is before 17:00 PKT, so the last 17:00 is yesterday
  assert.equal(validStamp('PMD', 'temperature', 'Maximum', '05:00 PM, 16 November', now), false);         // that 17:00 has not happened yet
  assert.equal(validStamp('IMD', 'temperature', 'Minimum', '08:00 AM, 16 November', now), true);          // after 08:00 it is the 08:00 of today
  assert.equal(validStamp('IMD', 'temperature', 'Minimum', '08:00 AM, 15 November', now), false);
  assert.equal(validStamp('PMD', 'temperature', 'Maximum', null, now), false);
  assert.equal(validStamp('Davis', 'temperature', 'Maximum', null, now), true);
  assert.equal(validStamp('PMD', 'humidity', 'Maximum', null, now), true);                                // not a checked quantity
  assert.equal(validStamp('PMD', 'rainfall', 'Last 24 Hours', '08:00 AM, 16 November', now), true);
});
test('every category points at a real column and no value column is used twice', () => {
  const seen = new Map();
  for (const [key, p] of Object.entries(PARAMS)) for (const [cat, d] of Object.entries(p.cats)) {
    for (const col of [d.v, d.at, d.dir, d.sync]) if (col !== undefined) assert.ok(col >= 0 && col < COLUMN_COUNT, `${key}/${cat} column ${col}`);
    const id = `${key}/${cat}`;
    if (key === 'rain_rate' && cat === 'Current') { assert.equal(d.v, 121); continue; }                // rain rate current is also the rain marker column
    assert.ok(!seen.has(d.v), `${id} shares column ${d.v} with ${seen.get(d.v)}`); seen.set(d.v, id);
  }
  assert.equal(PARAMS.rainfall.cats['Last 24 Hours'].v, 105);
  assert.equal(PARAMS.wind_speed.cats['10 mins Gust'].v, 95);
  assert.equal(catUnit('departures', 'Monthly Rain'), '%'); assert.equal(catUnit('departures', 'Monthly Max Temp'), '°C'); assert.equal(catUnit('wind_speed', 'Current'), 'km/h');
  assert.ok(!('pollutants' in PARAMS) && !('air_quality' in PARAMS));
});
test('column table labels value, time and direction columns and leaves the rest unlabelled', () => {
  const c = columnTable();
  assert.equal(c.length, COLUMN_COUNT);
  assert.equal(c[1].label, 'Station name'); assert.equal(c[5].label, 'Temperature · Current'); assert.equal(c[7].label, 'Temperature · Maximum recorded at');
  assert.equal(c[7].kind, 'time'); assert.equal(c[92].label, 'Wind Speed · Current direction'); assert.equal(c[92].unit, '°');
  assert.equal(c[161].kind, 'time'); assert.equal(c[24].kind, 'time'); assert.equal(c[5].unit, '°C'); assert.equal(c[121].label, 'Rain Rate · Current');
  assert.equal(c[23].named, false); assert.match(c[23].label, /unlabelled/);
});
test('un-permuting restores the natural column order and keeps nulls', () => {
  const perm = [2, 0, 3, 1], wire = ['c', 'a', null, 'b'];
  assert.deepEqual(unpermute(wire, perm), ['a', 'b', 'c', null]);
});
function row(over) { const r = Array(COLUMN_COUNT).fill(null); r[0] = 1; r[1] = 'Test'; r[2] = 33; r[3] = 73; r[4] = 'Davis'; for (const [k, v] of Object.entries(over)) r[k] = v; return r; }
test('features carry value, colour, time stamps, direction and the active flag', () => {
  const rows = [
    row({5: 35, 161: '10:35 am, 16 November', 91: 20, 92: 270, 121: 2, 128: -3.2, 127: 1010}),
    row({0: 2, 1: 'Old', 4: 'WU', 5: 12, 161: '09:00 am, 16 November'}),
    row({0: 3, 1: 'None', 4: 'WU'}),
    row({0: 4, 1: 'Hidden', 4: 'GLOF', 5: 20, 161: '10:30 am, 16 November'}),
  ];
  const temp = stationFeatures(rows, 'temperature', 'Current', {now});
  assert.equal(temp.length, 3);                                           // the empty one is skipped
  assert.equal(temp[0].color, getTextColor(35, 'temperature', 'Current')); assert.equal(temp[0].active, true); assert.equal(temp[1].active, false);
  assert.equal(stationFeatures(rows, 'temperature', 'Current', {now, networks: new Set(['Davis'])}).length, 1);
  assert.equal(stationFeatures(rows, 'temperature', 'Current', {now, inactive: false}).map(f => f.name).join(), 'Test,Hidden');
  assert.equal(stationFeatures(rows, 'temperature', 'Current', {now, active: false}).map(f => f.name).join(), 'Old');
  const wind = stationFeatures(rows, 'wind_speed', 'Current', {now})[0];
  assert.deepEqual([wind.value, wind.dir, wind.unit], [20, 270, 'km/h']); assert.equal(compass(wind.dir), 'W');
  assert.equal(stationFeatures(rows, 'rain_rate', 'Current', {now})[0].raining, true);
});
test('pressure ring needs a trend of 3 hPa or more, and the extreme times come from the right column', () => {
  const rows = [row({127: 1010, 128: -3.2, 162: '10:35 am, 16 November'}), row({0: 2, 127: 1010, 128: 1.0, 162: '10:35 am, 16 November'}), row({0: 3, 127: 1012, 128: 3, 129: 1015, 130: '03:00 am, 16 November', 135: '10:35 am, 16 November', 162: '10:35 am, 16 November'})];
  const f = stationFeatures(rows, 'pressure', 'Current', {now});
  assert.deepEqual(f.map(x => x.ring), [true, false, true]);
  assert.equal(f[0].active, true);
  const max = stationFeatures(rows, 'pressure', 'Maximum', {now});
  assert.equal(max.length, 1); assert.equal(max[0].at, '03:00 am, 16 November'); assert.equal(max[0].ring, false);
});
test('24 hour rain time comes from the minimum-temperature time for PMD and IMD only', () => {
  const r = row({4: 'PMD', 105: 12, 13: '08:00 AM, 16 November', 161: '10:35 am, 16 November'});
  assert.equal(stationFeatures([r], 'rainfall', 'Last 24 Hours', {now})[0].at, '08:00 AM, 16 November');
  const aws = row({4: 'Davis', 105: 12, 13: '08:00 AM, 16 November', 161: '10:35 am, 16 November'});
  assert.equal(stationFeatures([aws], 'rainfall', 'Last 24 Hours', {now})[0].at, null);
  const stale = row({4: 'PMD', 105: 12, 13: '08:00 AM, 15 November', 161: '10:35 am, 16 November'});
  assert.equal(stationFeatures([stale], 'rainfall', 'Last 24 Hours', {now}).length, 0);
});
test('stationReadings lists every parameter and category with value, unit, time and sync', () => {
  const r = row({5: 21.5, 6: 30, 7: '05:00 PM, 15 November', 24: '10:35 am, 16 November', 161: '10:35 am, 16 November', 91: 12, 92: 90, 105: 4, 4: 'PMD', 13: '08:00 AM, 16 November'});
  const all = stationReadings(r), by = k => all.find(p => p.param === k);
  assert.equal(all.length, Object.keys(PARAMS).length);
  const t = by('temperature').categories;
  assert.deepEqual(t.map(c => c.category), ['Current', 'Maximum', 'Minimum', 'Average']);
  assert.deepEqual([t[0].value, t[0].unit, t[0].lastSync], [21.5, '°C', '10:35 am, 16 November']);
  assert.deepEqual([t[1].value, t[1].recordedAt, t[1].lastSync], [30, '05:00 PM, 15 November', '10:35 am, 16 November']);
  assert.equal(t[2].value, null);                                          // missing stays null, never zero
  assert.deepEqual([by('wind_speed').categories[0].value, by('wind_speed').categories[0].direction], [12, 90]);
  assert.equal(by('rainfall').categories.find(c => c.category === 'Last 24 Hours').recordedAt, '08:00 AM, 16 November');
  assert.equal(by('departures').categories[0].unit, '%');
  assert.deepEqual(['basic', 'derived', 'climate'].map(g => all.some(p => p.group === g)), [true, true, true]);
});
test('CSV has station metadata first, one labelled column per feed column, and quotes text that needs it', () => {
  const cols = columnTable(), v = Array(COLUMN_COUNT).fill(null); v[5] = 21.5; v[7] = '05:00 PM, 15 November'; v[1] = 'A, "B"';
  const csv = stationsCsv([{id: 7, name: 'A, "B"', network: 'PMD', lat: 33.5, lon: 73.1, elevation: 540, elevation_source: 'terrain model', v}], cols).split('\n');
  assert.match(csv[0], /^id,name,network,latitude,longitude,elevation_m,elevation_source,position_note,Temperature · Current \(°C\),/);
  assert.equal(csv[0].split(',').length, 8 + COLUMN_COUNT - 5);
  assert.ok(csv[1].startsWith('7,"A, ""B""",PMD,33.5,73.1,540,terrain model,,21.5,'));
  assert.ok(csv[1].includes('"05:00 PM, 15 November"'));                    // a time label has a comma, so it is quoted
  assert.equal(csv[2], '');
  const none = stationsCsv([{id: 1, name: 'x', network: 'WU', lat: 1, lon: 2, elevation: null, v}], cols).split('\n')[1];
  assert.ok(none.startsWith('1,x,WU,1,2,,,,21.5'));                          // no elevation: empty cell and empty source
});
test('normals and departures carry the station sync time, so their stations count as active', () => {
  const r = row({111: 36.5, 115: -12, 8: 31.2, 10: 1.4, 161: '10:35 am, 16 November'});
  const normal = stationFeatures([r], 'normals', 'Monthly Rain', {now})[0], dep = stationFeatures([r], 'departures', 'Monthly Rain', {now})[0];
  assert.deepEqual([normal.value, normal.unit, normal.active, normal.sync], [36.5, 'mm', true, '10:35 am, 16 November']);
  assert.deepEqual([dep.value, dep.unit, dep.active], [-12, '%', true]);
  assert.deepEqual([stationFeatures([r], 'normals', 'Monthly Max Temp', {now})[0].value, stationFeatures([r], 'departures', 'Monthly Max Temp', {now})[0].unit], [31.2, '°C']);
  assert.equal(stationReadings(r).find(p => p.param === 'normals').categories[0].lastSync, '10:35 am, 16 November');
});
test('formatting and wind direction', () => {
  assert.equal(getTextColor(35, 'temperature'), '#f0653e'); assert.equal(getTextColor(-7, 'temperature'), '#1800FF');
  assert.equal(getTextColor(65, 'wind_speed', 'Current'), '#ff0000'); assert.equal(getTextColor(65, 'wind_speed', '10 mins Average'), '#fedffd');
  assert.equal(fmtValue(21.04, 'temperature'), '21.0'); assert.equal(fmtValue(9000, 'visibility'), '9000');
  assert.equal(compass(0), 'N'); assert.equal(compass(359), 'N'); assert.equal(compass(135), 'SE'); assert.equal(compass(null), '');
  assert.deepEqual(NETWORKS.slice(0, 3), ['PMD', 'IMD', 'Davis']);
});
