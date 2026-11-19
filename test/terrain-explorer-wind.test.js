import test from 'node:test';
import assert from 'node:assert/strict';
import {catmullRom, bicubic, bilinear, windFromBlock, centripetalCatmullRom, midpointStep, eulerStep, simRowRange, spawnPlaneHeight, meshCellHeight, QUALITY, QUALITY_STEPS, newQuality, qualityStep, WIND, WIND_MAX, RIBBON, windColour, windRampGlsl, WIND_SIM, SPEED_STEPS, speedFromStep, slotInterval, trailPoint, trailLabel, kmPerPixel, ringSlot, sameLife, trailAlpha, trailWidthPx, zoomScale, lifespan, advect, withMinimumSpeed, respawnBox, outsideBox, outsideView, GRID} from '../public/explorer/core.js';

test('a particle lives between 50 and 150 frames, a new random value each time', () => {
  assert.equal(WIND_SIM.life[0], 120); assert.equal(WIND_SIM.life[1], 300);
  assert.equal(lifespan(0), 120); assert.equal(lifespan(1), 300); assert.equal(lifespan(0.5), 210);
  assert.equal(lifespan(-3), 120); assert.equal(lifespan(7), 300);                               // never outside the range
  const seen = new Set(); for (let i = 0; i < 50; i++) seen.add(Math.round(lifespan(i / 49))); assert.ok(seen.size > 40);
});
test('the wind keeps the same speed on screen at every zoom: time runs in proportion to the view distance', () => {
  assert.equal(zoomScale(WIND_SIM.refDistKm), 1);
  assert.equal(zoomScale(3000), 2); assert.equal(zoomScale(750), 0.5);
  assert.equal(zoomScale(100000), WIND_SIM.maxScale); assert.equal(zoomScale(0.5), WIND_SIM.minScale);
  // pixels moved per second = wind * simSeconds * scale / (km per pixel), and km per pixel is proportional to the distance, so it does not depend on it
  const pxPerSecond = dist => 10 * WIND_SIM.simSeconds * zoomScale(dist) / 1000 / (dist * 0.001);          // 10 m/s, 1 pixel = dist/1000 km
  assert.ok(Math.abs(pxPerSecond(2300) - pxPerSecond(300)) < 1e-9 && Math.abs(pxPerSecond(300) - pxPerSecond(60)) / pxPerSecond(60) < 1e-9);
  for (let d = 10; d <= 4000; d += 37) assert.ok(zoomScale(d + 37) >= zoomScale(d));            // never decreases as the camera moves away
});
test('advection moves a point by wind times seconds, corrected for the length of a degree of longitude', () => {
  const [lon, lat] = advect(70, 30, 10, 0, 1000);                                               // 10 m/s east for 1000 s = 10 km
  assert.ok(Math.abs((lon - 70) * 111320 * Math.cos(30 * Math.PI / 180) - 10000) < 1e-6); assert.equal(lat, 30);
  const [lon2, lat2] = advect(70, 30, 0, -10, 1000);                                            // 10 km south
  assert.equal(lon2, 70); assert.ok(Math.abs((30 - lat2) * 111320 - 10000) < 1e-6);
  const near = advect(70, 60, 10, 0, 1000)[0] - 70, far = advect(70, 0, 10, 0, 1000)[0] - 70; assert.ok(near > 1.9 * far);   // a degree is shorter at 60 N
  const out = [0, 0]; assert.equal(advect(1, 2, 3, 4, 5, out), out);                           // writes into the array it is given: no allocation
});
test('a calm or converging spot never pins a particle: below the minimum the speed is exactly the minimum, in a changing direction', () => {
  const m = WIND_SIM.minSpeed;
  assert.deepEqual(withMinimumSpeed(3, 4, 1.2), [3, 4]);                                        // fast enough: untouched
  assert.deepEqual(withMinimumSpeed(m, 0, 0), [m, 0]);                                          // exactly the minimum is fast enough
  for (const [u, v] of [[0, 0], [0.01, 0], [0.1, -0.1], [-0.2, 0.05]]) for (let a = 0; a < 6.3; a += 0.4) {
    const [x, y] = withMinimumSpeed(u, v, a); assert.ok(Math.abs(Math.hypot(x, y) - m) < 1e-9, `speed for wind ${u},${v} angle ${a}`);
  }
  const dirs = new Set(); for (let a = 0; a < 6.3; a += 0.1) { const [x, y] = withMinimumSpeed(0, 0, a); dirs.add(Math.round(Math.atan2(y, x) * 10)); } assert.ok(dirs.size > 40);   // really different directions
  const [x, y] = withMinimumSpeed(0.2, 0, Math.PI); assert.ok(Math.abs(Math.hypot(x, y) - m) < 1e-9);       // even when the random push exactly opposes the wind
  assert.deepEqual(withMinimumSpeed(0, 0, 0.5).map(v => Math.sign(v)), [1, 1]);
});
test('new particles are born on the part of the data area that is on screen, never outside it', () => {
  const whole = respawnBox(69.5, 30.2, 2500, GRID);
  assert.deepEqual([whole.west, whole.east, whole.south, whole.north], [GRID.west, GRID.east, GRID.south, GRID.north]);      // zoomed out: the whole box
  const murree = respawnBox(73.4, 33.9, 60, GRID);
  assert.ok(murree.east - murree.west < 2 && murree.north - murree.south < 1.2 && murree.west < 73.4 && murree.east > 73.4);
  const edge = respawnBox(60.2, 23.1, 100, GRID); assert.equal(edge.west, GRID.west); assert.equal(edge.south, GRID.south); assert.ok(edge.east < 62);   // clipped to the box
  const away = respawnBox(95, 10, 50, GRID); assert.deepEqual([away.west, away.east], [GRID.west, GRID.east]);                // view outside the area: whole area, never an empty box
  const reuse = {}; assert.equal(respawnBox(70, 30, 100, GRID, reuse), reuse);
});
test('a particle is recycled when it leaves the bounding box or strays too far from the view', () => {
  assert.equal(outsideBox(70, 30), false); assert.equal(outsideBox(59.9, 30), true); assert.equal(outsideBox(70, 38.01), true); assert.equal(outsideBox(78.01, 30), true);
  assert.equal(outsideView(73.4, 33.9, 73.4, 33.9, 60), false);
  assert.equal(outsideView(73.4 + 90 / 92.5, 33.9, 73.4, 33.9, 60), false);                  // 90 km east, inside 1.6 radii (96 km)
  assert.equal(outsideView(73.4 + 100 / 92.5, 33.9, 73.4, 33.9, 60), true);                  // 100 km east: outside
  assert.equal(outsideView(73.4, 33.9 + 97 / 111.19, 73.4, 33.9, 60), true);
});

test('why particle positions are kept in local kilometres: a float32 longitude cannot hold a calm-air step at close zoom', () => {
  const stepM = 0.3;                                                                           // a 0.25 m/s wind for 1.2 s: one frame at close zoom
  const lon = 73.4, dLon = stepM / (111320 * Math.cos(33.9 * Math.PI / 180));
  assert.equal(Math.fround(lon + dLon), Math.fround(lon));                                    // as longitude the step is lost: the particle would be stuck
  const xKm = 60;                                                                              // the same particle 60 km from a local origin
  const moved = Math.fround(xKm + stepM / 1000);
  assert.ok(moved > Math.fround(xKm) && Math.abs((moved - xKm) * 1000 - stepM) / stepM < 0.05);   // as local km it moves, to within 5% of the true step
  let stuck = 0, tried = 0;                                                                    // and it keeps moving over many frames
  let x = Math.fround(60); for (let i = 0; i < 1000; i++) { const nx = Math.fround(x + stepM / 1000); tried++; if (nx === x) stuck++; x = nx; }
  assert.equal(stuck, 0); assert.ok(Math.abs((x - 60) * 1000 - 300) < 15);
});

test('a trail is the live head plus 13 recorded positions in a ring buffer, newest first', () => {
  assert.equal(WIND_SIM.trailPoints, 14); assert.equal(WIND_SIM.defaultCount, 6000); assert.equal(WIND_SIM.maxParticles, 24576);
  assert.deepEqual([1, 2, 3, 13].map(k => ringSlot(5, k)), [5, 4, 3, 6]);                    // newest at the head slot, then backwards, wrapping round
  assert.deepEqual([1, 2].map(k => ringSlot(0, k)), [0, 12]);
  const seen = new Set(); for (let k = 1; k <= 13; k++) seen.add(ringSlot(7, k)); assert.equal(seen.size, 13);   // the 13 slots, each once
  assert.ok(Math.abs(WIND_SIM.slotSeconds * 13 - 1.3) < 1e-9);                                // at 1x a trail covers 1.3 s of motion
});
test('a recorded position is used only if it belongs to the same life of the particle', () => {
  assert.equal(sameLife(93.25, 10, 93.25, 40), true);
  assert.equal(sameLife(93.25, 50, 93.25, 40), false);                                      // recorded "later" than now: it was the previous life
  assert.equal(sameLife(71.5, 10, 93.25, 40), false);                                       // a different lifespan tag: the previous life
  assert.equal(sameLife(0, 0, 93.25, 0), false);                                            // an empty slot never counts
});
test('trails are bright at the head and fade smoothly to nothing at the tail, and narrow towards it', () => {
  assert.ok(Math.abs(trailAlpha(0, 8) - 0.95) < 1e-9); assert.equal(trailAlpha(1, 8), 0);
  let prev = 2; for (let t = 0; t <= 1.0001; t += 0.05) { const a = trailAlpha(t, 5); assert.ok(a <= prev); prev = a; }    // never brighter further back
  assert.ok(trailAlpha(0.5, 1) < trailAlpha(0.5, 8));                                       // calm air is fainter
  assert.ok(trailWidthPx(0, 12) > trailWidthPx(0, 1));                                      // fast wind is wider
  assert.ok(trailWidthPx(1, 6) < trailWidthPx(0, 6) && trailWidthPx(1, 6) > 0);             // narrows towards the tail but never vanishes geometrically
  assert.ok(Math.abs(trailWidthPx(0, 0) - 1.3) < 1e-9 && Math.abs(trailWidthPx(0, 99) - 2.5) < 1e-9);
});
test('at 1x the wind moves at about 11 pixels a second for every m/s of wind, at any zoom', () => {
  for (const dist of [30, 60, 300, 1500, 2300]) {
    const pxPerSecond = 1 * WIND_SIM.simSeconds * zoomScale(dist) / 1000 / kmPerPixel(dist);
    assert.ok(pxPerSecond > 9.5 && pxPerSecond < 13, `${dist} km: ${pxPerSecond.toFixed(1)} px/s per m/s`);
  }
});

test('the speed control has five steps from 0.5x to 6x', () => {
  assert.deepEqual(SPEED_STEPS, [0.5, 1, 2, 4, 6]);
  assert.deepEqual([0, 1, 2, 3, 4].map(speedFromStep), [0.5, 1, 2, 4, 6]);
  assert.equal(speedFromStep(-3), 0.5); assert.equal(speedFromStep(9), 6); assert.equal(speedFromStep(2.4), 2);
});
test('positions are recorded per amount of wind time, so a trail is the same length on screen at every speed', () => {
  assert.equal(slotInterval(1), WIND_SIM.slotSeconds); assert.equal(slotInterval(2), WIND_SIM.slotSeconds / 2); assert.equal(slotInterval(6), WIND_SIM.slotSeconds / 6);
  for (const sp of SPEED_STEPS) assert.ok(Math.abs(slotInterval(sp) * sp - WIND_SIM.slotSeconds) < 1e-12);    // real time x speed = the same wind time
  // distance covered by 13 slots at a given wind speed, in screen pixels: speed-independent
  const trailPx = sp => 13 * slotInterval(sp) * sp * WIND_SIM.simSeconds * zoomScale(500) / 1000 / kmPerPixel(500) * 5;   // 5 m/s wind
  assert.ok(Math.abs(trailPx(0.5) - trailPx(6)) < 1e-9 && trailPx(1) > 50);
  assert.ok(slotInterval(0) > 0 && Number.isFinite(slotInterval(0)));                       // never divides by zero
});
test('trail length: points beyond the chosen length collapse onto the last visible one, and the fade runs over the visible length', () => {
  assert.deepEqual(trailPoint(0, 13), {index: 0, visible: true, t: 0});
  assert.deepEqual(trailPoint(13, 13), {index: 13, visible: true, t: 1});
  assert.deepEqual(trailPoint(4, 4), {index: 4, visible: true, t: 1});                        // the tail of a short trail is fully faded
  assert.deepEqual(trailPoint(9, 4), {index: 4, visible: false, t: 1});                       // beyond: same place as the last visible point, not drawn
  assert.equal(trailPoint(2, 8).t, 0.25);
  assert.deepEqual(trailPoint(3, 1), trailPoint(3, 4)); assert.deepEqual(trailPoint(13, 50), trailPoint(13, 13));   // clamped to 4..13
  assert.equal(trailLabel(4), '4 segments · short'); assert.equal(trailLabel(8), '8 segments · medium'); assert.equal(trailLabel(13), '13 segments · long');
  assert.equal(WIND_SIM.trailSegments.default, 8);
});

// ---- calm-air squiggles: the heading of a calm particle must be steady, never re-rolled every frame ----
test('in still air a particle drifts in a straight line: the old per-frame random angle was a random walk', () => {
  const m = WIND_SIM.minSpeed, steps = 400, dt = 1;
  const walk = angleAt => { let x = 0, y = 0, len = 0; const out = [0, 0]; for (let k = 0; k < steps; k++) { withMinimumSpeed(0, 0, angleAt(k), m, out); x += out[0] * dt; y += out[1] * dt; len += Math.hypot(out[0], out[1]) * dt; } return {len, net: Math.hypot(x, y)}; };
  const steady = walk(() => 1.1);
  assert.ok(Math.abs(steady.net / steady.len - 1) < 1e-9, 'a steady heading is a straight line');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rerolled = walk(() => rnd() * 2 * Math.PI);                                            // what the shader used to do: a new angle every frame
  assert.ok(rerolled.net / rerolled.len < 0.2, 'a new angle every frame goes nowhere: that is the tangle the trail recorded');
});
test('the calm direction changes smoothly: heading in still air, the wind own direction near the minimum, no jump anywhere in between', () => {
  const m = WIND_SIM.minSpeed, heading = 2.4, windDir = -0.6;
  let prev = null, worst = 0;
  for (let sp = 0; sp <= m; sp += 0.0025) {
    const [x, y] = withMinimumSpeed(sp * Math.cos(windDir), sp * Math.sin(windDir), heading); const a = Math.atan2(y, x);
    if (prev !== null) { let d = Math.abs(a - prev); d = Math.min(d, 2 * Math.PI - d); worst = Math.max(worst, d); }
    prev = a; assert.ok(Math.abs(Math.hypot(x, y) - m) < 1e-9);
  }
  assert.ok(worst < 0.35, `largest turn between neighbouring speeds ${worst.toFixed(3)} rad`);
  const [x0, y0] = withMinimumSpeed(0, 0, heading); assert.ok(Math.abs(Math.atan2(y0, x0) - heading) < 1e-9);         // still air: the particle's own heading
  const [x1, y1] = withMinimumSpeed(m * 0.999 * Math.cos(windDir), m * 0.999 * Math.sin(windDir), heading); assert.ok(Math.abs(Math.atan2(y1, x1) - windDir) < 0.05);   // almost the minimum: the wind's own direction
  assert.deepEqual(withMinimumSpeed(m, 0, 5), [m, 0]);                                         // at the minimum the wind is untouched: continuous with the branch above
});
test('the shader wind ramp is generated from the colour table, and the ribbon has a dark halo wider than its core', () => {
  assert.ok(windColour(0).every(v => v > 200));                                                // calm: near white
  assert.ok(windColour(WIND_MAX)[0] > 200 && windColour(WIND_MAX)[2] > 200);                   // gale: magenta
  const g = windRampGlsl('rampX');
  assert.ok(g.startsWith('vec3 rampX(float s)') && (g.match(/return mix/g) || []).length === WIND.length - 1);
  for (const [v, r, gg, b] of WIND) assert.ok(g.includes(`vec3(${r.toFixed(1)}, ${gg.toFixed(1)}, ${b.toFixed(1)}) / 255.`), `stop at ${v} m/s`);
  assert.ok(RIBBON.outline > 1.2 && Math.abs(RIBBON.core * RIBBON.outline - 1) < 1e-9);
  assert.ok(WIND.every((s, i) => i === 0 || s[0] > WIND[i - 1][0]));                          // stops increase
});

// ---- quality governor ----
test('the governor leaves a machine that keeps up alone', () => {
  const q = newQuality(); let t = 0;
  for (let i = 0; i < 2000; i++) { t += 16; assert.equal(qualityStep(q, t, 16), false); }
  assert.equal(q.level, 0);
});
test('slow frames step quality down one notch at a time, at most every 2.5 s, and stop at the lowest', () => {
  const q = newQuality(); let t = 10000; const changes = [];
  for (let i = 0; i < 2000; i++) { t += 40; if (qualityStep(q, t, 40)) changes.push(t); }
  assert.equal(q.level, QUALITY_STEPS.length - 1);
  assert.equal(changes.length, QUALITY_STEPS.length - 1);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i] - changes[i - 1] >= QUALITY.holdMs);
  assert.ok(QUALITY_STEPS.every((s, i) => i === 0 || (s.dpr <= QUALITY_STEPS[i - 1].dpr && s.trails <= QUALITY_STEPS[i - 1].trails)));    // each notch is never more demanding
  assert.ok(QUALITY_STEPS.slice(0, 3).every(s => s.trails === 1));                                                             // the pixel ratio goes first, the trails after
  assert.ok(QUALITY_STEPS.every(s => s.dpr >= 0.75));                                                                          // the picture never gets softer than 0.75 of the screen's pixels
});
test('after the frames speed up again quality comes back, slowly, and a single slow frame does not move it', () => {
  const q = newQuality(); let t = 10000;
  for (let i = 0; i < 300; i++) { t += 40; qualityStep(q, t, 40); }
  const low = q.level; assert.ok(low >= 2);
  for (let i = 0; i < 60; i++) { t += 10; qualityStep(q, t, 10); }                                                            // 0.6 s of fast frames: too soon
  assert.equal(q.level, low);
  for (let i = 0; i < 9000; i++) { t += 10; qualityStep(q, t, 10); }                                                        // 90 s of fast frames: one notch per 2.5 s
  assert.equal(q.level, 0);
  const before = q.level; t += 5000; qualityStep(q, t, 250); assert.equal(q.level, before);                                    // one hitch among good frames: nothing happens
});

// ---- Batch A: trails follow the drawn mesh ----
test('the height of the drawn mesh inside a cell follows its two triangles, not the bilinear blend', () => {
  assert.equal(meshCellHeight(10, 20, 30, 40, 0, 0), 10); assert.equal(meshCellHeight(10, 20, 30, 40, 1, 0), 20);          // the corners
  assert.equal(meshCellHeight(10, 20, 30, 40, 0, 1), 30); assert.equal(meshCellHeight(10, 20, 30, 40, 1, 1), 40);
  assert.equal(meshCellHeight(10, 20, 30, 40, 0.5, 0.5), 25);                                                                // on the diagonal b-c: halfway between 20 and 30
  // a saddle: a = d = 0, b = c = 100. Bilinear would give 50 in the middle; the mesh has a ridge along the diagonal, 100 high
  assert.equal(meshCellHeight(0, 100, 100, 0, 0.5, 0.5), 100);
  assert.equal(meshCellHeight(0, 100, 100, 0, 0.25, 0.25), 50);                                                              // inside triangle (a, c, b): 0 + 0.25 x 100 + 0.25 x 100
  assert.equal(meshCellHeight(0, 100, 100, 0, 0.75, 0.75), 50);                                                              // inside triangle (b, c, d): 0 + 0.25 x 100 + 0.25 x 100
  // a plane z = 3 + 4 tx + 5 ty is reproduced exactly on both sides of the diagonal
  for (const [tx, ty] of [[0.1, 0.2], [0.4, 0.5], [0.6, 0.7], [0.9, 0.8], [0.3, 0.9]]) assert.ok(Math.abs(meshCellHeight(3, 7, 8, 12, tx, ty) - (3 + 4 * tx + 5 * ty)) < 1e-12);
});

// ---- Batch B: drawing correctness ----
test('the spawn rays meet the ground at the surface and the drawn height of the level at a pressure level', () => {
  assert.equal(spawnPlaneHeight('sfc', 1.2, 3, 0.4), 1.2);                                                                    // surface: unchanged, the ground under the view centre
  assert.ok(Math.abs(spawnPlaneHeight('500', 1.2, 3, 0.4) - (5.574 * 3 + 0.4)) < 1e-9);                                        // 500 hPa: 5.574 km x 3 + 0.4, not the ground
  assert.ok(Math.abs(spawnPlaneHeight('850', 9.9, 1, 0.1) - (1.457 + 0.1)) < 1e-9);                                           // the ground does not matter at a level
  assert.equal(spawnPlaneHeight('nonsense', 2, 3, 0.4), 2);
});
test('a particle lives 2 to 5 seconds at 60 frames a second', () => {
  assert.ok(WIND_SIM.life[0] / 60 === 2 && WIND_SIM.life[1] / 60 === 5);
  assert.ok(WIND_SIM.life[0] > 50 && WIND_SIM.life[1] > 150);
});

// ---- Batch C: density and performance ----
test('the default is 6,000 trails of 8 segments, drawn a little thinner', () => {
  assert.equal(WIND_SIM.defaultCount, 6000); assert.equal(WIND_SIM.trailSegments.default, 8);
  assert.ok(WIND_SIM.trailSegments.default >= WIND_SIM.trailSegments.min && WIND_SIM.trailSegments.default <= WIND_SIM.trailSegments.max);
  assert.ok(Math.abs(trailWidthPx(0, 0) - 1.3) < 1e-12); assert.ok(Math.abs(trailWidthPx(0, 12) - 2.5) < 1e-12);               // 1.3 + 1.2 x min(1, speed / 12), full width at the head
  assert.ok(Math.abs(trailWidthPx(1, 12) - 1.25) < 1e-12);                                                                      // half of it at the tail
});
test('only the rows of the state texture that are drawn are simulated, and rows that become active are respawned', () => {
  assert.deepEqual(simRowRange(6000, 256, 96, 0), {rows: 24, activate: null});                                                  // 6000 / 256 = 23.4 -> 24 rows; first frame: everything is respawned anyway
  assert.deepEqual(simRowRange(256, 256, 96, 24), {rows: 1, activate: null});                                                   // fewer: nothing to do
  assert.deepEqual(simRowRange(257, 256, 96, 1), {rows: 2, activate: [1, 2]});                                                  // one particle more than a row: the new row starts afresh
  assert.deepEqual(simRowRange(24000, 256, 96, 24), {rows: 94, activate: [24, 94]});
  assert.deepEqual(simRowRange(99999, 256, 96, 94), {rows: 96, activate: [94, 96]});                                            // never more rows than the texture has
  assert.deepEqual(simRowRange(0, 256, 96, 5), {rows: 1, activate: null});                                                      // at least one row
  assert.deepEqual(simRowRange(5000, 256, 96, 20), {rows: 20, activate: null});                                                 // unchanged
});

// ---- Batch D: fluid motion (numerics only) ----
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
test('Catmull-Rom passes through its two middle points, is exact for lines and quadratics, and has a continuous slope at the joins', () => {
  assert.equal(catmullRom(3, 7, 11, 2, 0), 7); assert.equal(catmullRom(3, 7, 11, 2, 1), 11);
  for (const t of [0.1, 0.5, 0.9]) assert.ok(close(catmullRom(0, 1, 2, 3, t), 1 + t));                                           // a line
  for (const t of [0.1, 0.35, 0.8]) assert.ok(close(catmullRom(0, 1, 4, 9, t), (1 + t) ** 2));                                    // a quadratic: x^2 at x = 0, 1, 2, 3
  // the slope at t = 1 of one segment (p0..p3) is (p3 - p1) / 2, and the next segment (p1..p4) starts with the slope (p3 - p1) / 2: the same
  const h = 1e-6, p = [2, 5, 3, 8, 1], end = (catmullRom(p[0], p[1], p[2], p[3], 1) - catmullRom(p[0], p[1], p[2], p[3], 1 - h)) / h, start = (catmullRom(p[1], p[2], p[3], p[4], h) - catmullRom(p[1], p[2], p[3], p[4], 0)) / h;
  assert.ok(close(end, start, 1e-4) && close(end, (p[3] - p[1]) / 2, 1e-4), `${end} ${start}`);
});
test('the bicubic surface is exact for planes and quadratics where bilinear is not, and equals the cell values at the cell corners', () => {
  const block = f => [0, 1, 2, 3].map(j => [0, 1, 2, 3].map(i => f(i, j)));
  const plane = (i, j) => 2 + 3 * i - 4 * j, quad = (i, j) => 1 + i * i + 0.5 * j * j + i * j;
  for (const [tx, ty] of [[0.2, 0.7], [0.5, 0.5], [0.9, 0.1]]) {
    assert.ok(close(bicubic(block(plane), tx, ty), plane(1 + tx, 1 + ty)));
    assert.ok(close(bicubic(block(quad), tx, ty), quad(1 + tx, 1 + ty)));
    assert.ok(Math.abs(bilinear(quad(1, 1), quad(2, 1), quad(1, 2), quad(2, 2), tx, ty) - quad(1 + tx, 1 + ty)) > 1e-3);       // bilinear is off on a curved field
  }
  assert.equal(bicubic(block(quad), 0, 0), quad(1, 1)); assert.equal(bicubic(block(quad), 1, 1), quad(2, 2));
});
test('the wind from a 4 x 4 block: bicubic when all 16 cells are valid, bilinear when an outer one is missing, missing when an inner one is', () => {
  const cell = (i, j, ok = 1) => [(1 + i) ** 2, 3 - j * 2, ok];
  const make = bad => [0, 1, 2, 3].map(j => [0, 1, 2, 3].map(i => cell(i, j, bad && bad[0] === i && bad[1] === j ? 0 : 1)));
  const tx = 0.3, ty = 0.6;
  const full = windFromBlock(make(), tx, ty), b = make();
  assert.ok(close(full[0], (1 + (1 + tx)) ** 2) && close(full[1], 3 - (1 + ty) * 2));                                           // exact for the quadratic in u and the line in v
  const outer = windFromBlock(make([0, 0]), tx, ty);
  assert.ok(close(outer[0], bilinear(b[1][1][0], b[1][2][0], b[2][1][0], b[2][2][0], tx, ty)) && close(outer[1], bilinear(b[1][1][1], b[1][2][1], b[2][1][1], b[2][2][1], tx, ty)));
  assert.ok(Math.abs(outer[0] - full[0]) > 1e-3);                                                                               // and it is the bilinear value, not the bicubic one
  assert.equal(windFromBlock(make([1, 1]), tx, ty), null); assert.equal(windFromBlock(make([2, 1]), tx, ty), null);              // an inner cell missing: no wind
  assert.ok(windFromBlock(make([3, 3]), tx, ty) !== null);
});
test('the trail curve passes through its recorded points, is straight through evenly spaced collinear ones, and joins smoothly', () => {
  const A = [73.0, 33.0], B = [73.2, 33.1], C = [73.3, 33.3], D = [73.1, 33.5], E = [72.9, 33.4];
  const at = (p0, p1, p2, p3, s) => centripetalCatmullRom(p0, p1, p2, p3, s);
  for (const [i, pt] of [[0, B], [1, C]]) { const q = at(A, B, C, D, i); assert.ok(close(q[0], pt[0], 1e-9) && close(q[1], pt[1], 1e-9)); }
  const line = [0, 1, 2, 3].map(k => [70 + 0.1 * k, 30]);                                                                       // four points along a parallel, equal spacing
  for (const s of [0.25, 0.5, 0.75]) { const q = at(...line, s); assert.ok(close(q[1], 30, 1e-12) && close(q[0], 70.1 + 0.1 * s, 1e-9)); }
  // slope continuity at the join C: the end of segment (A, B, C, D) and the start of (B, C, D, E) point the same way
  const dir = (p, q) => { const dx = (q[0] - p[0]) * Math.cos(33.3 * Math.PI / 180), dy = q[1] - p[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const e = 1e-5, d1 = dir(at(A, B, C, D, 1 - e), at(A, B, C, D, 1)), d2 = dir(at(B, C, D, E, 0), at(B, C, D, E, e));
  assert.ok(close(d1[0], d2[0], 2e-3) && close(d1[1], d2[1], 2e-3), `${d1} ${d2}`);
  // coincident points (a particle that did not move between two records) must not give NaN
  const same = at(A, B, B, C, 0.5); assert.ok(Number.isFinite(same[0]) && Number.isFinite(same[1]));
  // centripetal: a sharp corner does not overshoot or loop; the curve between the two middle points stays near them
  const corner = [0, 1, 2, 3].map(k => k < 2 ? [60 + 0.2 * k, 30] : [60.2, 30 + 0.2 * (k - 1)]);
  for (const s of [0.1, 0.5, 0.9]) { const q = at(...corner, s); assert.ok(q[0] >= 60.1 - 0.05 && q[0] <= 60.2 + 0.05 && q[1] >= 30 - 0.05 && q[1] <= 30.2 + 0.05, `${q}`); }
});
test('the midpoint step is second order: in a rotating wind it stays on the circle far better than a single-velocity step', () => {
  const omega = 1, rot = (x, y) => [-omega * y, omega * x];
  const run = (step, n, T = 3) => { let p = [1, 0]; const dt = T / n; for (let i = 0; i < n; i++) p = step(p[0], p[1], rot, dt); return p; };
  const exact = [Math.cos(3), Math.sin(3)], err = p => Math.hypot(p[0] - exact[0], p[1] - exact[1]);
  const e1 = err(run(eulerStep, 50)), m1 = err(run(midpointStep, 50)), m2 = err(run(midpointStep, 100));
  assert.ok(m1 < e1 / 10, `midpoint ${m1} euler ${e1}`);                                                                        // far more accurate for the same number of steps
  assert.ok(m1 / m2 > 3.5 && m1 / m2 < 4.5, 'halving the step divides the error by about 4: ' + m1 / m2);                       // second order
  assert.deepEqual(midpointStep(5, 7, () => [2, -1], 3), [11, 4]);                                                              // a steady wind: the same as before
  assert.ok(Math.hypot(...run(midpointStep, 50)) > 0.99 && Math.hypot(...run(midpointStep, 50)) < 1.01);                      // the radius is kept
});
