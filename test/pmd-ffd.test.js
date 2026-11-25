import test from 'node:test';
import assert from 'node:assert/strict';
import {withPmdCache} from '../scripts/observation-sync.mjs';
import {parseStationPage, parseCities, pktIso, labelPkt, compassDegrees, applyPmdFfd, freshPmdFfd} from '../scripts/pmd-ffd.mjs';
import {parseLabel} from '../public/realtime/core.js';

// The structure of ffd.pmd.gov.pk/staff/weather-display?city=..., reduced: the station block, the FORECAST block (must be ignored) and the footer.
const page = ({name = 'LAHORE', sub = 'Punjab, Pakistan &bull; 31.5&deg;N &nbsp;74.3&deg;E', wmo = 'WMO &nbsp;41640 / 41641', temp = '25.0', source = 'SYNOP', time = '17:00 PKT', max = '28.0', min = '13.8',
  hum = '35%', wind = '0 km/h', dir = 'N direction', pres = '1,014.1', vis = '—', dew = '8.4', rain = 'NIL', observed = 'Observed 17:00 PKT 17 Nov 2026'} = {}) => `<html><body>
<select name="city"><optgroup label="Punjab"><option value="lahore" selected>Lahore</option><option value="tt-singh" >T.T. Singh</option></optgroup></select>
<div class="city-hdr"><div><div class="city-name" style="font-size:30px;">${name}</div><div class="city-sub">${sub}</div></div><div class="city-badge">${wmo}</div></div>
<div class="icon-temp-hero"><div class="wx-condition">PARTLY CLOUDY</div><div class="temp-col">
  <div class="temp-val">${temp}<span class="temp-unit">&deg;C</span></div><div class="temp-source">${source}
   &bull; ${time}
   &bull; 29 minutes ago</div></div></div>
<div class="minmax-row" style="x"><div class="mm-cell mm-max"><div class="mm-label">Max Today </div><div class="mm-vals"><div class="mm-val hot">${max}°C</div>
 <div class="mm-yda"><div class="mm-yda-label">Yesterday</div><div class="mm-yda-val hot">27.5°C</div></div></div></div>
<div class="mm-cell mm-min"><div class="mm-label">Min Today</div><div class="mm-vals"><div class="mm-val cool">${min}°C</div>
 <div class="mm-yda"><div class="mm-yda-label">Yesterday</div><div class="mm-yda-val cool">14.4°C</div></div></div></div></div>
<div class="metrics-grid">
 <div class="m-card"><div class="m-label">Humidity</div><div class="m-val">${hum}</div><div class="m-sub">Relative</div></div>
 <div class="m-card"><div class="m-label">Wind</div><div class="m-val">${wind}</div><div class="m-sub">${dir}</div></div>
 <div class="m-card"><div class="m-label">Pressure</div><div class="m-val">${pres}</div><div class="m-sub">hPa</div></div>
 <div class="m-card"><div class="m-label">Visibility</div><div class="m-val">${vis}</div><div class="m-sub">Horizontal</div></div>
 <div class="m-card"><div class="m-label">Dew Pt</div><div class="m-val">${dew}°C</div><div class="m-sub">Condensation</div></div>
 <div class="m-card"><div class="m-label">Rainfall</div><div class="m-val">${rain}</div><div class="m-sub">Since 08:00 PKT</div></div></div>
<div>ICON Model Next 4 Days FORECAST TOMORROW CLEAR 27 14 WNW 10 km/h</div>
<div class="footer">LIVE Data via SYNOP &middot; LAHORE,CITY &middot; ${observed} &middot; WMO 41640 / 41641 &middot; ICAO OPLA</div></body></html>`;

test('a station page gives the observed values, the time stamp and the extremes, and nothing of the forecast', () => {
  const r = parseStationPage(page());
  assert.equal(r.name, 'LAHORE'); assert.deepEqual(r.wmo, [41640, 41641]); assert.equal(r.icao, 'OPLA'); assert.equal(r.source, 'SYNOP');
  assert.equal(r.observed_at, '2026-11-17T17:00:00+05:00'); assert.equal(r.observed_label, '17:00 PKT');
  assert.equal(r.temperature, 25); assert.equal(r.max_today, 28); assert.equal(r.min_today, 13.8); assert.equal(r.max_yesterday, 27.5); assert.equal(r.min_yesterday, 14.4);
  assert.equal(r.humidity, 35); assert.equal(r.wind_kmh, 0); assert.equal(r.wind_direction, 'N'); assert.equal(r.wind_direction_deg, 0);
  assert.equal(r.pressure_hpa, 1014.1); assert.equal(r.dew_point, 8.4); assert.equal(r.rain_mm, 0); assert.equal(r.rain_since, '08:00 PKT');
  assert.equal(r.visibility_km, null);                                                  // a dash is "not given", not zero
  assert.ok(!/CLEAR|FORECAST|ICON|WNW/.test(JSON.stringify(r)));
  assert.equal(r.lat, 31.5); assert.equal(r.lon, 74.3);
});
test('units and gaps: visibility in km or m, rain in mm, a missing station page and a station without an observation', () => {
  assert.equal(parseStationPage(page({vis: '10.0 km'})).visibility_km, 10);
  assert.equal(parseStationPage(page({vis: '800 m'})).visibility_km, 0.8);
  assert.equal(parseStationPage(page({rain: '3.4 mm'})).rain_mm, 3.4);
  assert.equal(parseStationPage(page({wind: '12 km/h', dir: 'WSW direction'})).wind_direction_deg, 247.5);
  assert.equal(parseStationPage(page({temp: '-3.5'})).temperature, -3.5);
  assert.equal(parseStationPage('<html>nothing here</html>'), null);
  const none = parseStationPage(page({temp: '—', source: '—', time: '', observed: '', hum: '—', dew: '—'}));
  assert.equal(none.temperature, null); assert.equal(none.observed_at, null); assert.equal(none.humidity, null);
});
test('station list, PKT time labels and compass points', () => {
  assert.deepEqual(parseCities(page()).map(c => c.slug), ['lahore', 'tt-singh']);
  assert.equal(pktIso('17:00 PKT', '17 Nov 2026'), '2026-11-17T17:00:00+05:00'); assert.equal(pktIso('', '17 Nov 2026'), null); assert.equal(pktIso('17:00 PKT', 'soon'), null);
  assert.equal(labelPkt('2026-11-17T17:00:00+05:00'), '05:00 pm, 17 November'); assert.equal(labelPkt('2026-11-09T00:05:00+05:00'), '12:05 am, 9 November');
  assert.equal(labelPkt('2026-11-09T12:30:00+05:00'), '12:30 pm, 9 November');
  assert.equal(parseLabel(labelPkt('2026-11-17T17:00:00+05:00'), Date.parse('2026-11-17T12:30:00Z')), Date.parse('2026-11-17T12:00:00Z'));   // realtime.json's own reader agrees
  assert.equal(compassDegrees('NNW'), 337.5); assert.equal(compassDegrees('x'), null); assert.equal(compassDegrees(null), null);
});

const NOW = Date.parse('2026-11-17T12:30:00Z');                                         // 17:30 PKT
const row = (id, name, patch = {}) => { const v = Array(178).fill(null); v[0] = id; v[1] = name; v[4] = 'PMD'; v[5] = 1; v[161] = '11:53 am, 13 November'; v[91] = 9; v[106] = 7; v[8] = 20; return {key: String(id), id, name, network: 'PMD', v: Object.assign(v, patch)}; };
const ffd = stations => ({source: 'test', fetched_at: '2026-11-17T12:30:00Z', failed: [], stations});
const rec = (extra = {}) => ({slug: 'lahore', label: 'Lahore', name: 'LAHORE', wmo: [41640, 41641], source: 'SYNOP', observed_at: '2026-11-17T17:00:00+05:00', observed_label: '17:00 PKT', temperature: 25, max_today: 28, min_today: 13.8,
  max_yesterday: 27.5, min_yesterday: 14.4, humidity: 35, wind_kmh: null, wind_direction: null, wind_direction_deg: null, pressure_hpa: 1014.1, visibility_km: 10, dew_point: 8.4, rain_mm: 0, rain_since: '08:00 PKT', lat: 31.5, lon: 74.3, icao: 'OPLA', ...extra});
test('the page values go into the PMD row with their own time stamps, and stale values that share the sync stamp are cleared', () => {
  const data = {stations: [row(41641, 'Lahore Airport'), row(41640, 'Lahore City'), {...row(1, 'Davis one'), network: 'Davis'}]};
  const sum = applyPmdFfd(data, ffd([rec()]), parseLabel, NOW);
  assert.equal(sum.updated, 1);
  assert.equal(data.stations[0].v[5], 1);                                               // the first WMO number of the page that has a row is 41640 (Lahore City): the airport is not touched
  const c = data.stations[1].v;
  assert.equal(c[5], 25); assert.equal(c[24], '05:00 pm, 17 November'); assert.equal(c[25], 8.4); assert.equal(c[32], '05:00 pm, 17 November');
  assert.equal(c[73], 35); assert.equal(c[80], '05:00 pm, 17 November'); assert.equal(c[127], 1014.1); assert.equal(c[162], '05:00 pm, 17 November');
  assert.equal(c[164], 10000); assert.equal(c[170], '05:00 pm, 17 November');          // km to the metres of realtime.json
  assert.equal(c[105], 0); assert.equal(c[161], '05:00 pm, 17 November');
  assert.equal(c[91], null); assert.equal(c[106], null);                                // wind is not on the page: the old 13 November value is not left under the new stamp
  assert.equal(c[8], 20);                                                               // a normal is not an observation: kept
  assert.equal(data.stations[0].v[161], '11:53 am, 13 November');
  assert.equal(data.stations[1].pmd_ffd.max_today, 28); assert.equal(data.stations[1].pmd_ffd.observed_at, '2026-11-17T17:00:00+05:00');
  assert.equal(data.stations[2].v[5], 1);                                               // other networks are never touched
  assert.equal(data.pmd_ffd.updated, 1);
});
test('matching by name, newer rows kept, no-observation pages skipped, unmatched pages reported', () => {
  const newer = row(41599, 'Sialkot Airport', {161: '05:10 pm, 17 November', 5: 24.1});
  const data = {stations: [row('41SKP', 'Sheikhupura'), newer, row(41640, 'Lahore')]};
  const sum = applyPmdFfd(data, ffd([rec({slug: 'sheikhupura', label: 'Sheikhupura', name: 'SHEIKHUPURA', wmo: []}), rec({slug: 'sialkot', label: 'Sialkot', name: 'SIALKOT', wmo: [41599]}),
    rec({slug: 'kamra', observed_at: null, wmo: [41640]}), rec({slug: 'nowhere', label: 'Nowhere', name: 'NOWHERE', wmo: [99999]})]), parseLabel, NOW);
  assert.deepEqual({u: sum.updated, k: sum.kept_newer, n: sum.no_observation, m: sum.unmatched}, {u: 1, k: 1, n: 1, m: ['nowhere']});
  assert.equal(data.stations[0].v[5], 25);                                              // Sheikhupura by name
  assert.equal(newer.v[5], 24.1);                                                       // its own sync (05:10 pm) is newer than the page's 05:00 pm
  assert.equal(data.stations[2].v[5], 1);
});

// ---- the PMD pages with a short memory (a local server refreshes the stations every 10 minutes but reads PMD's site at most every 30) ----
function memory(initial) {
  const io = {file: initial, reads: 0, writes: 0, fetches: 0};
  io.read = async () => { io.reads++; if (io.file === undefined) throw Error('ENOENT'); return io.file; };
  io.write = async (f, text) => { io.writes++; io.file = text; };
  io.fetchPages = async () => { io.fetches++; return {source: 'pages', fetched_at: new Date(io.now).toISOString(), stations: [{slug: 'lahore'}], failed: []}; };
  io.now = Date.parse('2026-11-19T10:00:00Z');
  return io;
}
const opts = (io, maxAgeMin) => ({cacheFile: 'cache.json', maxAgeMin, now: io.now, fetchPages: io.fetchPages, read: io.read, write: io.write});
const cachedAt = (iso, stations = [{slug: 'lahore'}]) => JSON.stringify({source: 'pages', fetched_at: iso, stations, failed: []});

test('PMD cache: with no age limit (CI) the pages are always read, and no copy is read or written', async () => {
  const io = memory(cachedAt('2026-11-19T09:59:00Z'));
  const r = await freshPmdFfd(opts(io, 0));
  assert.equal(io.fetches, 1); assert.equal(io.reads, 0); assert.equal(io.writes, 0); assert.equal(r.from_cache, undefined);
});
test('PMD cache: a copy younger than the limit is reused, an older one is replaced', async () => {
  const young = memory(cachedAt('2026-11-19T09:40:00Z'));                                              // 20 minutes old, limit 30
  const a = await freshPmdFfd(opts(young, 30));
  assert.equal(young.fetches, 0); assert.equal(a.from_cache, true); assert.equal(a.stations.length, 1);
  const old = memory(cachedAt('2026-11-19T09:29:00Z'));                                                // 31 minutes old
  const b = await freshPmdFfd(opts(old, 30));
  assert.equal(old.fetches, 1); assert.equal(old.writes, 1); assert.equal(b.from_cache, undefined);
  assert.equal(JSON.parse(old.file).fetched_at, '2026-11-19T10:00:00.000Z');                            // the new read is what is kept
});
test('PMD cache: no copy, a broken copy, an empty copy or a copy from the future all lead to a fresh read', async () => {
  for (const initial of [undefined, 'not json', cachedAt('2026-11-19T09:55:00Z', []), cachedAt('2026-11-19T11:00:00Z'), JSON.stringify({stations: [{slug: 'x'}]})]) {
    const io = memory(initial);
    await freshPmdFfd(opts(io, 30));
    assert.equal(io.fetches, 1, String(initial).slice(0, 40)); assert.equal(io.writes, 1);
  }
});
test('PMD cache: a copy that cannot be written does not stop the refresh, and a failed read of the pages is passed on', async () => {
  const io = memory(undefined); io.write = async () => { throw Error('read-only'); };
  const r = await freshPmdFfd(opts(io, 30));
  assert.equal(r.stations.length, 1);
  const bad = memory(undefined); bad.fetchPages = async () => { throw Error('PMD unavailable'); };
  await assert.rejects(freshPmdFfd(opts(bad, 30)), /PMD unavailable/);
  assert.equal(bad.writes, 0);
});

test('daily extremes: the last completed PMD report is used and stamped with its hour (maximum 17:00, minimum and 24 h rain 08:00), so the Live stations page shows PMD', async () => {
  const {stationFeatures} = await import('../public/realtime/core.js');
  const rows = d => d.stations.map(s => s.v);
  // 17:30 PKT: both reports of the day are done, today's values
  const d1 = {stations: [row(41640, 'Lahore City')]}; applyPmdFfd(d1, ffd([rec()]), parseLabel, NOW);
  const v = d1.stations[0].v;
  assert.equal(v[6], 28); assert.equal(v[7], '05:00 pm, 17 November'); assert.equal(v[12], 13.8); assert.equal(v[13], '08:00 am, 17 November');
  const only = new Set(['PMD']);
  assert.equal(stationFeatures(rows(d1), 'temperature', 'Maximum', {networks: only, now: NOW}).length, 1);
  assert.equal(stationFeatures(rows(d1), 'temperature', 'Minimum', {networks: only, now: NOW}).length, 1);
  assert.equal(stationFeatures(rows(d1), 'rainfall', 'Last 24 Hours', {networks: only, now: NOW}).length, 1);
  // 12:00 PKT: the maximum of today is not reported yet: yesterday's, stamped yesterday 17:00; the minimum is today's
  const noon = Date.parse('2026-11-17T07:00:00Z'), d2 = {stations: [row(41640, 'Lahore City')]};
  applyPmdFfd(d2, ffd([rec({observed_at: '2026-11-17T12:00:00+05:00'})]), parseLabel, noon);
  assert.equal(d2.stations[0].v[6], 27.5); assert.equal(d2.stations[0].v[7], '05:00 pm, 16 November'); assert.equal(d2.stations[0].v[12], 13.8); assert.equal(d2.stations[0].v[13], '08:00 am, 17 November');
  assert.equal(stationFeatures(rows(d2), 'temperature', 'Maximum', {networks: only, now: noon}).length, 1);
  // 05:00 PKT: neither report of today yet: both yesterday's
  const early = Date.parse('2026-11-17T00:00:00Z'), d3 = {stations: [row(41640, 'Lahore City')]};
  applyPmdFfd(d3, ffd([rec({observed_at: '2026-11-17T04:00:00+05:00'})]), parseLabel, early);
  assert.equal(d3.stations[0].v[12], 14.4); assert.equal(d3.stations[0].v[13], '08:00 am, 16 November'); assert.equal(d3.stations[0].v[6], 27.5);
  assert.equal(stationFeatures(rows(d3), 'temperature', 'Minimum', {networks: only, now: early}).length, 1);
  // a page with no extremes leaves the columns empty (no invented value)
  const d4 = {stations: [row(41640, 'Lahore City')]}; applyPmdFfd(d4, ffd([rec({max_today: null, min_today: null, max_yesterday: null, min_yesterday: null})]), parseLabel, NOW);
  assert.equal(d4.stations[0].v[6], null); assert.equal(d4.stations[0].v[12], null);
});

test('the live realtime data of the dev server gets the cached PMD page readings, only while the copy is fresh and not when PMD_FFD=0', async () => {
  const cache = {...ffd([rec()]), fetched_at: '2026-11-17T12:00:00Z'}, read = async () => JSON.stringify(cache);
  const fresh = () => ({stations: [row(41640, 'Lahore City')]});
  const a = await withPmdCache(fresh(), {file: 'x', now: NOW, env: {}, read}); assert.equal(a.stations[0].v[5], 25); assert.equal(a.stations[0].v[6], 28);
  const old = await withPmdCache(fresh(), {file: 'x', now: NOW + 4 * 3600000, env: {}, read}); assert.equal(old.stations[0].v[5], 1);          // 4.5 h old: not used
  const off = await withPmdCache(fresh(), {file: 'x', now: NOW, env: {PMD_FFD: '0'}, read}); assert.equal(off.stations[0].v[5], 1);
  const none = await withPmdCache(fresh(), {file: 'x', now: NOW, env: {}, read: async () => { throw Error('no file'); }}); assert.equal(none.stations[0].v[5], 1);   // no copy: untouched, no error
});
