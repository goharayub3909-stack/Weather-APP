import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAND_COVER, curveNumber, amcClass, adjustCN, scsRunoff, effectiveRain, annualMaxima, gumbelFit, gumbelQuantile, gumbelReturnPeriod, weibullPoints,
  riskBand, maxRolling, designStorm, gaugeFactor, GAUGE, kirpichHours, unitHydrograph, routeHydrograph, hydrographStats, hourlySeries, splitAtNow,
  parseCrossSection, parseGaugeRecord,
} from '../public/flood-logic.js';
import {
  terrariumHeight, tileOf, tileCorner, mosaicFrame, pixelOfLatLon, latLonOfPixel, metresPerPixel, downsample, sampleGrid, fillDepressions,
  flowDirections, networkOf, catchmentOf, longestPath, profileBetween,
} from '../public/flood-terrain.js';
import {createSimulation, floodedStats, depthColor} from '../public/flood-model.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('SCS runoff matches the TR-55 equations', () => {
  // CN 80: S = 63.5 mm, Ia = 12.7 mm, Q(100 mm) = 87.3^2 / (87.3 + 63.5) = 50.54 mm
  close(scsRunoff(100, 80), 50.54, 0.01);
  assert.equal(scsRunoff(10, 80), 0);              // below the initial abstraction
  close(scsRunoff(37, 100), 37, 1e-9);             // water surface: all rain runs off
  assert.equal(scsRunoff(-5, 80), 0);
  assert.equal(scsRunoff(null, 80), 0);
});
test('hourly effective rain adds up to the runoff of the total storm', () => {
  const rain = [0, 5, 20, 40, 15, 0, 3];
  const eff = effectiveRain(rain, 78);
  close(eff.reduce((a, b) => a + b, 0), scsRunoff(83, 78), 1e-9);
  assert.ok(eff.every(v => v >= 0));
  assert.equal(eff[0], 0);
});
test('curve numbers come from the TR-55 table and antecedent moisture adjusts them', () => {
  assert.equal(curveNumber('cropland', 'C'), 85);
  assert.equal(curveNumber('pasture', 'A'), 39);
  assert.equal(curveNumber('builtup', 'D'), 95);
  assert.throws(() => curveNumber('cropland', 'Z'));
  assert.throws(() => curveNumber('ocean', 'A'));
  close(adjustCN(75, 1), 55.75, 0.01);
  close(adjustCN(75, 3), 87.34, 0.01);
  assert.equal(adjustCN(75, 2), 75);
  assert.ok(adjustCN(100, 3) <= 100 + 1e-9);
  assert.equal(amcClass(10, true), 1); assert.equal(amcClass(40, true), 2); assert.equal(amcClass(60, true), 3);
  assert.equal(amcClass(10, false), 1); assert.equal(amcClass(20, false), 2); assert.equal(amcClass(30, false), 3);
  assert.equal(amcClass(null), 2);
  for (const row of Object.values(LAND_COVER)) assert.ok(row.cn.every((v, i, a) => i === 0 || v >= a[i - 1]), row.label + ' CN rises with soil group');
});
test('Gumbel quantiles and return periods', () => {
  close(gumbelQuantile({mu: 50, beta: 10}, 100), 96.0015, 0.001);   // 50 - 10 ln(-ln 0.99)
  const fit = {mu: 50, beta: 10};
  for (const t of [2, 10, 20, 100]) close(gumbelReturnPeriod(fit, gumbelQuantile(fit, t)), t, 1e-6, 'T=' + t);
  // a sample drawn at evenly spaced probabilities from mu=60, beta=15 is recovered closely
  const sample = Array.from({length: 60}, (_, i) => 60 - 15 * Math.log(-Math.log((i + 0.5) / 60)));
  const f = gumbelFit(sample);
  close(f.mu, 60, 3); close(f.beta, 15, 2);
  assert.equal(gumbelFit([1, 2, 3]), null);
  assert.equal(gumbelFit(Array(12).fill(5)), null);
  const pts = weibullPoints([10, 30, 20]);
  assert.deepEqual(pts.map(p => p.x), [30, 20, 10]);
  close(pts[0].years, 4, 1e-9); close(pts[2].years, 4 / 3, 1e-9);
});
test('annual maxima skip incomplete years', () => {
  const time = [], precip = [];
  for (let d = 0; d < 365; d++) { time.push(new Date(Date.UTC(2001, 0, 1 + d)).toISOString().slice(0, 10)); precip.push(d === 100 ? 80 : 1); }
  for (let d = 0; d < 100; d++) { time.push(new Date(Date.UTC(2002, 0, 1 + d)).toISOString().slice(0, 10)); precip.push(200); }
  const m = annualMaxima(time, precip);
  assert.deepEqual(m, [{year: 2001, max: 80}]);
});
test('risk bands follow the return period of the 24 h rain', () => {
  assert.equal(riskBand(1.5).label, 'Low'); assert.equal(riskBand(2).label, 'Moderate'); assert.equal(riskBand(9.9).label, 'Moderate');
  assert.equal(riskBand(10).label, 'High'); assert.equal(riskBand(49).label, 'High'); assert.equal(riskBand(50).label, 'Very high');
  assert.equal(riskBand(null).level, null);
  assert.equal(maxRolling([1, 2, 3, 4, 5], 2), 9);
  assert.equal(maxRolling([5, 0, 0, 5], 24), 10);
});
test('design storm keeps its total and peaks mid-storm', () => {
  const s = designStorm(120, 24);
  close(s.reduce((a, b) => a + b, 0), 120, 1e-9);
  assert.ok(s[11] > s[0] && s[12] > s[23]);
  close(s[11], s[12], 1e-9);
});
test('gauge correction scales model rain by observed over modelled totals', () => {
  assert.deepEqual(gaugeFactor([{gauge: 20, model: 10}]).factor, 2);
  assert.equal(gaugeFactor([{gauge: 20, model: 10}]).applied, true);
  const dry = gaugeFactor([{gauge: 3, model: GAUGE.minModelMm - 1}]);
  assert.equal(dry.factor, 1); assert.equal(dry.applied, false);
  assert.equal(gaugeFactor([{gauge: 900, model: 10}]).factor, GAUGE.limits[1]);
  assert.equal(gaugeFactor([{gauge: 1, model: 10}]).factor, GAUGE.limits[0]);
  assert.equal(gaugeFactor([]).applied, false);
  assert.equal(gaugeFactor([{gauge: null, model: 10}]).applied, false);
});
test('Kirpich time of concentration and the unit hydrograph conserve volume', () => {
  close(kirpichHours(10000, 0.01), 2.305, 0.01);
  const area = 50, uh = unitHydrograph(area, 3, 1);
  close(uh.reduce((a, b) => a + b, 0) * 3600, area * 1000, area * 1000 * 0.02);   // 1 mm over A km2 = A * 1000 m3
  const q = routeHydrograph([0, 10, 20, 5], uh);
  close(q.reduce((a, b) => a + b, 0) * 3600, 35 * area * 1000, 35 * area * 1000 * 0.02);
  const st = hydrographStats(q);
  assert.ok(st.peak > 0 && st.peakHour >= 2);
  assert.ok(q.every(v => v >= 0));
});
test('forecast parsing and the past / future split', () => {
  const s = hourlySeries({hourly: {time: ['2026-01-01T00:00', '2026-01-01T01:00', '2026-01-01T02:00'], precipitation: [1, null, 3]}});
  assert.deepEqual(s.precip, [1, null, 3]);
  assert.throws(() => hourlySeries({}));
  const split = splitAtNow(s, '2026-01-01T00:30');
  assert.deepEqual(split.past, [1]); assert.deepEqual(split.future, [null, 3]);
});
test('imported cross-sections and gauge records drop bad rows and say how many', () => {
  const cs = parseCrossSection('# chainage,elevation\ndistance,elevation\n0,100.5\n10,98\n5,99\nx,y\n20,\n30,101');
  assert.deepEqual(cs.points, [[0, 100.5], [5, 99], [10, 98], [30, 101]]);
  assert.equal(cs.dropped, 2);
  const g = parseGaugeRecord('time,mm\n2026-07-01T00:00:00+05:00,2\n2026-07-01T01:00:00+05:00,-1\n2026-07-01T02:00:00+05:00,4\nbad,3');
  assert.equal(g.records.length, 2); assert.equal(g.dropped, 2);
  assert.equal(g.records[1].value, 4);
});

// ---------- terrain ----------
test('Terrarium decoding and Web-Mercator tile maths', () => {
  assert.equal(terrariumHeight(128, 0, 0), 0);
  close(terrariumHeight(128, 10, 128), 10.5, 1e-9);
  assert.equal(terrariumHeight(127, 255, 255), -1 / 256);
  const [x, y] = tileOf(31.5, 74.3, 12), [lat, lon] = tileCorner(x, y, 12), [lat2, lon2] = tileCorner(x + 1, y + 1, 12);
  assert.ok(lat >= 31.5 && lat2 <= 31.5 && lon <= 74.3 && lon2 >= 74.3);
  const frame = mosaicFrame(31.5, 74.3);
  const [px, py] = pixelOfLatLon(frame, 31.5, 74.3);
  assert.ok(px > 0 && px < frame.size && py > 0 && py < frame.size);
  const [la, lo] = latLonOfPixel(frame, px, py);
  close(la, 31.5, 1e-9); close(lo, 74.3, 1e-9);
  assert.ok(frame.north > 31.5 && frame.south < 31.5);
  close(metresPerPixel(0, 12), 38.2185, 0.01);
});
test('downsample averages blocks and bilinear sampling interpolates', () => {
  const g = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const d = downsample(g, 4, 2);
  assert.equal(d.n, 2); assert.deepEqual([...d.data], [3.5, 5.5, 11.5, 13.5]);
  close(sampleGrid(g, 4, 0.5, 0), 1.5, 1e-9);
  close(sampleGrid(g, 4, 1.5, 1.5), 8.5, 1e-9);
  assert.ok(Number.isNaN(sampleGrid(g, 4, -1, 0)));
});
// A 5 x 5 valley: the middle row is the channel (falling east), the other rows slope towards it.
const valley = () => { const n = 5, z = new Float32Array(25); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = (4 - i) + Math.abs(j - 2) * 3; return {n, z}; };
test('depression filling removes pits and keeps the rest', () => {
  const n = 5, z = new Float32Array(25).fill(10);
  for (let i = 0; i < 25; i++) z[i] = 10 + (i % n);   // slopes up to the east
  z[12] = 2;                                          // a pit in the middle
  const f = fillDepressions(z, n);
  assert.ok(f[12] >= 10, 'pit filled to its spill level');
  assert.equal(f[0], z[0]);
  const dir = flowDirections(f, n);
  assert.ok(dir[12] >= 0, 'filled cell drains');
});
test('flow accumulation, Strahler order and catchments on a small valley', () => {
  const {n, z} = valley();
  const f = fillDepressions(z, n), dir = flowDirections(f, n), net = networkOf(f, dir, n);
  const outlet = 2 * n + 4;
  assert.equal(net.acc[outlet], 25, 'everything drains to the channel mouth');
  assert.ok(net.order[outlet] >= 2);
  const c = catchmentOf(dir, net.acc, n, 4, 2, 1);
  assert.equal(c.outlet, outlet); assert.equal(c.cells, 25);
  const lp = longestPath(f, dir, n, c, 100);
  assert.ok(lp.length >= 400 && lp.slope > 0);
});
test('profiles sample the mosaic along a line', () => {
  const frame = mosaicFrame(31.5, 74.3), size = frame.size, elev = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) elev[j * size + i] = i * 0.1;
  const [cx, cy] = [size / 2, size / 2], a = latLonOfPixel(frame, cx, cy), b = latLonOfPixel(frame, cx + 100, cy);
  const p = profileBetween(frame, elev, a, b, 11);
  assert.equal(p.length, 11);
  close(p[10].z - p[0].z, 10, 1e-6);
  close(p[10].dist, 100 * metresPerPixel(frame.centreLat, frame.z), 1e-6);
});

// ---------- solver ----------
test('the solver conserves mass on a tilted plane with open edges', () => {
  const n = 20, z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = 100 - i * 0.5;
  const sim = createSimulation({z, n, cellM: 100, manning: 0.03, effectiveMm: [10, 10], hours: 4}).runAll();
  const rain = 0.020 * n * n * 1e4;
  close(sim.volumes.rain, rain, rain * 1e-4, 'rain volume');
  close(sim.volumes.rain - sim.volumes.out - sim.storage(), 0, rain * 0.005, 'mass balance');
  assert.ok(sim.volumes.out > 0, 'water leaves downslope');
  assert.equal(sim.frames[0].hour, 0);
  assert.ok(sim.frames.length >= 5);
  const lowEdge = sim.maxDepth[10 * n + 19], highEdge = sim.maxDepth[10 * n + 0];
  assert.ok(lowEdge > highEdge, 'water concentrates downslope');
});
test('water ponds at the bottom of a closed bowl and the level is flat', () => {
  const n = 15, z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = (i === 0 || j === 0 || i === n - 1 || j === n - 1) ? NaN : ((i - 7) ** 2 + (j - 7) ** 2) * 0.05;
  const sim = createSimulation({z, n, cellM: 100, manning: 0.03, effectiveMm: [30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hours: 12}).runAll();
  assert.equal(sim.volumes.out, 0);
  close(sim.storage(), sim.volumes.rain, sim.volumes.rain * 1e-4);
  const centre = sim.h[7 * n + 7], rim = sim.h[1 * n + 1];
  assert.ok(centre > rim && centre > 0.05);
  const eta = c => z[c] + sim.h[c];
  const wet = [...sim.h.keys()].filter(c => sim.h[c] > 0.02);
  assert.ok(wet.length > 1);
  const levels = wet.map(eta);
  assert.ok(Math.max(...levels) - Math.min(...levels) < 0.05, 'a settled lake has one water level');
});
test('no rain means no water, and display helpers behave', () => {
  const n = 6, z = new Float32Array(n * n);
  const sim = createSimulation({z, n, cellM: 50, manning: 0.03, effectiveMm: [0, 0], hours: 2}).runAll();
  assert.equal(Math.max(...sim.h), 0);
  const stats = floodedStats(Float32Array.from([0, 0.02, 0.5, 2]), 100, 0.05);
  assert.equal(stats.cells, 2); close(stats.areaKm2, 0.02, 1e-12); close(stats.maxDepth, 2, 1e-9); close(stats.meanDepth, 1.25, 1e-9);
  assert.equal(depthColor(0.01)[3], 0);
  assert.ok(depthColor(2)[3] > depthColor(0.1)[3]);
});
