import test from 'node:test';
import assert from 'node:assert/strict';
import {GRID, HOURS, nodes, buildDataset, validDataset, GridSampler, mercX, mercY, lonOfX, latOfY, terrarium, rainColour, snowColour, windColour,
  splitPrecip, terrainWind, boxBlur, flowGrid, FLOW, validPacked, unpackDataset, encodeView, decodeView, summariseHours, elevationColour, SNOW_WATER_MM_PER_CM} from '../public/explorer/core.js';

const N = GRID.columns * GRID.rows;
const rowsFor = (f = {}) => Array.from({length: N}, (_, n) => ({
  time: Array.from({length: HOURS}, (_, h) => new Date(Date.UTC(2026, 10, 13, h)).toISOString().slice(0, 16)),
  wind_speed_10m: Array(HOURS).fill(f.speed ?? 5), wind_direction_10m: Array(HOURS).fill(f.dir ?? 270),
  cloud_cover: Array.from({length: HOURS}, (_, h) => f.cloud ? f.cloud(n, h) : 50), precipitation: Array.from({length: HOURS}, (_, h) => f.precip ? f.precip(n, h) : 0), snowfall: Array.from({length: HOURS}, (_, h) => f.snow ? f.snow(n, h) : 0)}));

test('grid nodes cover the grid in rows from the south-west', () => {
  const p = nodes();
  assert.equal(p.length, N);
  assert.deepEqual(p[0], [23, 60]);
  assert.deepEqual(p[GRID.columns - 1], [23, 78]);
  assert.deepEqual(p.at(-1), [38, 78]);
});
test('wind direction is where the wind comes from: a west wind blows east (u > 0)', () => {
  const d = buildDataset(rowsFor({speed: 10, dir: 270}), '2026-11-13T00:00:00Z');
  assert.equal(d.u[0][0], 10); assert.equal(d.v[0][0], 0);
  const north = buildDataset(rowsFor({speed: 10, dir: 0}), '2026-11-13T00:00:00Z');       // from the north: blows south (v < 0)
  assert.equal(north.v[0][0], -10); assert.equal(north.u[0][0], 0);
  const sw = buildDataset(rowsFor({speed: 10, dir: 225}), 'x');
  assert.ok(Math.abs(Math.hypot(sw.u[0][0], sw.v[0][0]) - 10) < 0.1);
});
test('dataset validation rejects wrong model, short axis, missing cells', () => {
  const d = buildDataset(rowsFor(), '2026-11-13T00:00:00Z');
  assert.equal(validDataset(d), true);
  assert.equal(validDataset({...d, model: 'gfs'}), false);
  assert.equal(validDataset({...d, times: d.times.slice(1)}), false);
  assert.equal(validDataset({...d, u: d.u.map(f => f.slice(1))}), false);
  assert.equal(validDataset({...d, units: {...d.units, wind: 'km/h'}}), false);
  assert.equal(validDataset({...d, cloud: undefined}), false);
  const skip = structuredClone(d); skip.times[5] = skip.times[4]; assert.equal(validDataset(skip), false);
});
test('sampler is bilinear in space, linear in time, and never fills a missing cell', () => {
  const d = buildDataset(rowsFor({precip: (n, h) => (n % GRID.columns) * 1 + h * 10}), '2026-11-13T00:00:00Z');
  const s = new GridSampler(d);
  assert.equal(s.sample('precip', 0, 60, 23), 0);
  assert.ok(Math.abs(s.sample('precip', 0, 60.25, 23) - 0.5) < 0.11);                      // halfway between columns 0 and 1 (values rounded to 0.1)
  assert.ok(Math.abs(s.sample('precip', 1.5, 60, 23) - 15) < 1e-9);                        // halfway between hour 1 (10) and 2 (20)
  assert.equal(s.sample('precip', 0, 59, 23), null);                                       // outside the grid
  d.precip[0][1] = null;
  assert.equal(s.sample('precip', 0, 60.25, 23), null);                                    // one corner missing
  assert.equal(s.sample('precip', 0, 61, 24), 2);                                          // other cells unaffected
});
test('rain and snow are split by the snowfall water equivalent, capped by the precipitation', () => {
  const d = buildDataset(rowsFor({precip: () => 4, snow: () => 2}), 'x'), s = new GridSampler(d);
  const p = s.precip(0, 65, 30);
  assert.equal(p.total, 4); assert.ok(Math.abs(p.snowWater - 2 * SNOW_WATER_MM_PER_CM) < 1e-9); assert.ok(Math.abs(p.rain - (4 - 1.4)) < 1e-9);
  const heavy = new GridSampler(buildDataset(rowsFor({precip: () => 1, snow: () => 10}), 'x')).precip(0, 65, 30);
  assert.equal(heavy.snowWater, 1); assert.equal(heavy.rain, 0);
});
test('hourOf maps a timestamp to the data axis and is null outside it', () => {
  const s = new GridSampler(buildDataset(rowsFor(), 'x')), t0 = Date.UTC(2026, 10, 13);
  assert.equal(s.hourOf(t0 + 5.5 * 3600000), 5.5);
  assert.equal(s.hourOf(t0 + 80 * 3600000), null);
  assert.equal(s.hourOf(t0 - 3 * 3600000), null);
});
test('Mercator and Terrarium decoding', () => {
  assert.equal(mercX(0), 0.5); assert.ok(Math.abs(mercY(0) - 0.5) < 1e-12);
  for (const [lon, lat] of [[73.05, 33.69], [67, 24.8]]) { assert.ok(Math.abs(lonOfX(mercX(lon)) - lon) < 1e-9); assert.ok(Math.abs(latOfY(mercY(lat)) - lat) < 1e-9); }
  assert.ok(mercY(35) < mercY(25));                                                          // north is smaller y
  assert.equal(terrarium(128, 0, 0), 0);                                                     // 128*256 - 32768
  assert.equal(terrarium(137, 150, 128), 137 * 256 + 150 + 0.5 - 32768);
});
test('colour ramps are transparent when dry, ordered with intensity, and snow is purple', () => {
  assert.equal(rainColour(0)[3], 0); assert.equal(rainColour(0.1)[3], 0);
  assert.ok(rainColour(2)[3] > rainColour(0.5)[3] - 1);
  assert.deepEqual(rainColour(500), rainColour(50));
  const [r, g, b] = snowColour(5); assert.ok(b > g && r > g);
  assert.ok(windColour(0.62)[1] < windColour(0.22)[1]);                                   // the wind palette (normalised speed) goes from pale to saturated
  assert.deepEqual(elevationColour(7000), [213, 220, 230]);                                  // snow: light grey-blue, below white
  assert.ok(elevationColour(-100)[2] < elevationColour(0)[2]);
});
test('land colours: the stops are exact, in between is linear, and the sea ramp is unchanged', () => {
  const stops = [[0, [84, 107, 61]], [550, [102, 117, 69]], [900, [115, 102, 69]], [1500, [128, 97, 71]], [2400, [140, 120, 102]], [3400, [175, 165, 155]],
    [4500, [217, 217, 217]], [5500, [213, 220, 230]], [7000, [213, 220, 230]]];
  for (const [m, rgb] of stops) assert.deepEqual(elevationColour(m || 0.001), rgb, `${m} m`);           // exactly 0 m is the shore and takes the sea ramp, so the first land stop is read just above it
  assert.deepEqual(elevationColour(275), [93, 112, 65]);                         // half way between 0 and 550 m: (84 + 102) / 2, (107 + 117) / 2, (61 + 69) / 2
  assert.deepEqual(elevationColour(1200), [122, 100, 70]);                       // half way between 900 and 1500 m, (115 + 128) / 2 rounded
  assert.deepEqual(elevationColour(9000), [213, 220, 230]);                      // above the last stop: the snow, a light grey-blue
  assert.equal(elevationColour(0.5).length, 3);
  assert.ok(elevationColour(100)[1] > elevationColour(100)[0]);                  // plains read green: green is the strongest channel
  assert.ok(elevationColour(1500)[0] > elevationColour(1500)[1]);                // hills read brown: red is stronger than green
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(elevationColour(4500)) > lum(elevationColour(3400)) && lum(elevationColour(3400)) > lum(elevationColour(2400)));      // snow line: brighter with height
  assert.deepEqual(elevationColour(0), [20, 52, 82]);                            // exactly 0 m is the shore
  assert.deepEqual(elevationColour(-4000), [6, 18, 36]); assert.deepEqual(elevationColour(-0.0001), [20, 52, 82]);   // sea floor and just below the shore, unchanged
});
test('convective split follows the CAPE and rain thresholds', () => {
  assert.deepEqual(splitPrecip(2, 800), {convective: 2, other: 0});
  assert.deepEqual(splitPrecip(2, 300), {convective: 0, other: 2});
  assert.deepEqual(splitPrecip(0.3, 1500), {convective: 0, other: 0.3});
  assert.deepEqual(splitPrecip(null, 1500), {convective: null, other: null});
});
test('shared view round trips and rejects nonsense', () => {
  const v = {lon: 73.4, lat: 33.95, dist: 150, tilt: 58, heading: -20, exag: 3.5, hour: 12, layers: ['w', 'r']};
  const h = encodeView(v); assert.equal(h, '#v=73.400,33.950,150,58,-20,3.5,12,wr');
  assert.deepEqual(decodeView(h), {...v, level: 'sfc'});                                    // no level in the link means the 10 m wind
  assert.equal(decodeView('#v=0,0,150,58,0,3,12,w'), null);                                 // far outside Pakistan
  assert.equal(decodeView('#v=73,33,150,58,0,30,12,w'), null);                              // exaggeration out of range
  assert.equal(decodeView('#v=73,33,150,58,0,3,999,w'), null);                              // hour outside the data (the grid runs to 144 h)
  assert.equal(decodeView('#v=73,33,150,58,0,3,99,w').hour, 99);                            // a link into the second half of a 144 h run is fine
  assert.equal(decodeView('#junk'), null);
});
test('point summary reports facts and keeps the thunder wording tied to CAPE', () => {
  const hours = Array.from({length: 24}, (_, i) => ({t: i, temp: 10 + i / 2, precip: i === 5 ? 3 : 0, snow: 0, wind: 5, cape: i === 5 ? 900 : 0}));
  const s = summariseHours(hours);
  assert.match(s, /Temperature 10 to 22°C/); assert.match(s, /3\.0 mm of rain in hours with high CAPE/); assert.match(s, /Strongest wind 18 km\/h/);
  assert.match(summariseHours(hours.map(h => ({...h, precip: 0}))), /No precipitation expected/);
  assert.match(summariseHours(hours.map(h => ({...h, precip: 0, snow: 0.5}))), /Snow 12\.0 cm/);
  assert.equal(summariseHours([]), 'No forecast data for this point.');
  const noTemp = summariseHours(hours.map(h => ({...h, temp: null})));                       // a grid without temperature: rain and wind are still reported
  assert.ok(!/Temperature/.test(noTemp)); assert.match(noTemp, /3\.0 mm of rain in hours with high CAPE/); assert.match(noTemp, /Strongest wind 18 km\/h/);
  assert.equal(summariseHours(hours.map(() => ({t: 0, temp: null, precip: null, wind: null}))), 'No forecast data for this point.');
});

test('cloud cover is kept as whole per cent, out-of-range values stay missing, and it samples like the other fields', () => {
  const rows = rowsFor({cloud: (n, h) => h === 0 ? 40 : h === 1 ? 140 : 80});
  const d = buildDataset(rows, 'x');
  assert.equal(d.cloud[0][0], 40);
  assert.equal(d.cloud[1][0], null);                                                       // 140 % is not valid: never clamped into data
  assert.equal(new GridSampler(d).sample('cloud', 0, 65, 30), 40);
  assert.equal(new GridSampler(d).sample('cloud', 0.5, 65, 30), null);                     // a missing hour next door makes the blend missing
  assert.deepEqual(decodeView('#v=73.400,33.950,150,58,0,3.5,12,wrck').layers, ['w', 'r', 'c', 'k']);
});

// ---- 0.1 degree dataset (schema 2): 3x3 grid, steps at 0, 3 and 6 h ----
const b64 = arr => Buffer.from(new Int16Array(arr).buffer).toString('base64');
function packed(over = {}) {
  const n = 9, step = fn => b64(Array.from({length: n}, (_, i) => fn(i)));
  const d = {schema_version: 2, model: 'ecmwf_ifs_0p1', grid: {west: 60, east: 62, south: 23, north: 25, spacing: 1, columns: 3, rows: 3},
    times: ['2026-11-13T00:00:00Z', '2026-11-13T03:00:00Z', '2026-11-13T06:00:00Z'], hours: [0, 3, 6], scales: {u: 10, v: 10, precip: 100, snow: 10, cloud: 1},
    units: {wind: 'm/s', precip: 'mm', snow: 'cm', cloud: '%'}, retrieved_at: '2026-11-13T09:00:00Z', run: '2026-11-13T00:00:00Z',
    u: [step(() => 0), step(() => 60), step(() => 120)], v: [step(() => 0), step(() => -30), step(() => -30)],
    precip: [step(() => 0), step(i => i === 4 ? 250 : 0), step(() => 0)], snow: [step(() => 0), step(() => 0), step(() => 0)],
    cloud: [step(() => 10), step(i => i === 0 ? -32768 : 90), step(() => 50)]};
  return {...d, ...over};
}
test('packed 0.1 degree data is validated by size, axis and units', () => {
  assert.equal(validPacked(packed()), true);
  assert.equal(validDataset(packed()), true);
  assert.equal(validPacked(packed({hours: [0, 3, 7]})), false);                              // hours must follow the timestamps
  assert.equal(validPacked(packed({model: 'ecmwf_ifs025'})), false);
  assert.equal(validPacked(packed({u: packed().u.map(s => s.slice(4))})), false);          // a field of the wrong size
  assert.equal(validPacked(packed({units: {wind: 'km/h', precip: 'mm', snow: 'cm', cloud: '%'}})), false);
});
test('unpacking applies the scales and turns the missing marker into NaN, never a number', () => {
  const d = unpackDataset(packed());
  assert.equal(d.u[1][0], 6); assert.equal(d.v[1][0], -3); assert.equal(d.precip[1][4], 2.5);
  assert.ok(Number.isNaN(d.cloud[1][0])); assert.equal(d.cloud[1][1], 90);
  assert.equal(unpackDataset(buildDataset(rowsFor(), 'x')).u.length, HOURS);                // schema 1 passes through
});
test('the sampler interpolates between 3-hourly steps by the hour offsets', () => {
  const s = new GridSampler(unpackDataset(packed()));
  assert.equal(s.lastHour, 6);
  assert.deepEqual(s.segment(1.5), {i0: 0, i1: 1, w: 0.5});
  assert.deepEqual(s.segment(4.5), {i0: 1, i1: 2, w: 0.5});
  assert.deepEqual(s.segment(99), {i0: 1, i1: 2, w: 1});                                    // clamped to the last step
  assert.ok(Math.abs(s.sample('u', 1.5, 61, 24) - 3) < 1e-9);                               // halfway between 0 and 6 m/s
  assert.ok(Math.abs(s.sample('u', 4.5, 61, 24) - 9) < 1e-9);
  assert.equal(s.wind(3, 61, 24).speed, Math.hypot(6, 3));
  assert.equal(s.sample('cloud', 3, 60, 23), null);                                         // missing corner: missing, not blended
  assert.equal(s.sample('cloud', 3, 61, 24), 90);
  assert.equal(s.sample('precip', 3, 61, 24), 2.5);
});
test('hourOf uses the real last hour of the data', () => {
  const s = new GridSampler(unpackDataset(packed())), t0 = Date.UTC(2026, 10, 13);
  assert.equal(s.hourOf(t0 + 4 * 3600000), 4);
  assert.equal(s.hourOf(t0 + 9 * 3600000), null);
});

// ---- terrain-following wind ----
test('wind running uphill into a steep slope loses its uphill part and keeps the part along the contour (no sideways push)', () => {
  const r = terrainWind(10, 0, 0.2, 0, 0);                                                  // wind to the east, ground rising to the east, past full blocking
  assert.ok(Math.abs(r[0] - 1.5) < 1e-9);                                                  // 10 - 0.85 * 10
  assert.equal(r[1], 0);                                                                   // nothing pushed sideways
  const o = terrainWind(10, 10, 0.2, 0, 0);                                                 // the along-contour part (north) survives untouched
  assert.ok(Math.abs(o[0] - 1.5) < 1e-9 && Math.abs(o[1] - 10) < 1e-9);
  const sl = terrainWind(6, 8, 0.3 * 0.6, 0.3 * 0.8, 0), n = [0.6, 0.8];                   // v . n = 10 uphill: 8.5 of it removed, the rest of v unchanged
  assert.ok(Math.abs(sl[0] - (6 - 8.5 * 0.6)) < 1e-9 && Math.abs(sl[1] - (8 - 8.5 * 0.8)) < 1e-9 && n[0] ** 2 + n[1] ** 2 === 1);
  const half = terrainWind(10, 0, 0.06, 0, 0);                                             // half the full-blocking slope: half the blocking
  assert.ok(Math.abs(half[0] - (10 - 0.5 * 8.5)) < 1e-9);
});
test('downhill wind, flat ground and unknown relief leave the wind unchanged', () => {
  assert.deepEqual(terrainWind(10, 3, -0.2, 0.1, 0), [10, 3]);                              // wind goes down the slope
  assert.deepEqual(terrainWind(4, -2, 0, 0, 0), [4, -2]);                                   // flat
  assert.deepEqual(terrainWind(4, -2, 0, 0, NaN), [4, -2]);                                 // missing relief counts as none
  assert.deepEqual(terrainWind(0, 0, 0.3, 0, 100), [0, 0]);                                 // calm stays calm
});
test('wind along a contour keeps its direction and speeds up on crests and slows in valleys', () => {
  assert.deepEqual(terrainWind(0, 10, 0.3, 0, 0), [0, 10]);                                 // slope rises east, wind blows north: no uphill part
  const crest = terrainWind(10, 0, 0, 0, FLOW.tpiScaleM), valley = terrainWind(10, 0, 0, 0, -FLOW.tpiScaleM);
  assert.ok(Math.abs(crest[0] - 13.5) < 1e-9); assert.ok(Math.abs(valley[0] - 6.5) < 1e-9);
  assert.ok(Math.abs(terrainWind(10, 0, 0, 0, 5000)[0] - 13.5) < 1e-9);                     // capped at the scale
});
test('the box blur keeps a constant, averages an impulse and conserves the total', () => {
  const c = boxBlur(new Float32Array(25).fill(7), 5, 5, 1);
  assert.ok(c.every(v => Math.abs(v - 7) < 1e-5));
  const imp = new Float32Array(81); imp[4 * 9 + 4] = 9;
  const b = boxBlur(imp, 9, 9, 1);
  assert.ok(Math.abs(b[4 * 9 + 4] - 1) < 1e-6 && Math.abs(b[3 * 9 + 3] - 1) < 1e-6 && b[2 * 9 + 2] === 0);
  assert.ok(Math.abs(b.reduce((s, v) => s + v, 0) - 9) < 1e-4);
});
test('flow grid: gradient points uphill (east and north) and relief is positive on a bump', () => {
  const w = 40, h = 40, east = new Float32Array(w * h), north = new Float32Array(w * h), bump = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { east[j * w + i] = i * 5; north[j * w + i] = (h - 1 - j) * 5; bump[j * w + i] = 500 * Math.exp(-((i - 20) ** 2 + (j - 20) ** 2) / 20); }
  const e = flowGrid(east, w, h, 1, 1, 4, 100), n = flowGrid(north, w, h, 1, 1, 4, 100), m = flowGrid(bump, w, h, 1, 1, 6, 100);
  const mid = 20 * w + 20;
  assert.ok(Math.abs(e.gx[mid] - 0.05) < 1e-4 && Math.abs(e.gn[mid]) < 1e-4);              // 5 m per 100 m eastwards
  assert.ok(Math.abs(n.gn[mid] - 0.05) < 1e-4 && Math.abs(n.gx[mid]) < 1e-4);              // rows run south, height rises north: positive northward gradient
  assert.ok(m.tpi[mid] > 100);                                                              // the summit stands above its surroundings
  assert.ok(m.gx[20 * w + 14] > 0 && m.gx[20 * w + 26] < 0);                                // rises towards the summit from either side
  const half = flowGrid(east, w, h, 2, 1, 2, 200);
  assert.equal(half.cw, 20); assert.ok(Math.abs(half.gx[10 * 20 + 10] - 0.05) < 1e-4);      // coarser grid, same slope
});
