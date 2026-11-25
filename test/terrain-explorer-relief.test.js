import test from 'node:test';
import assert from 'node:assert/strict';
import {normalMapJob, resetQuality, newQuality, qualityStep, QUALITY, QUALITY_STEPS, LOD_ASK, LOD_LEVELS, lodWanted} from '../public/explorer/core.js';

// Run the generator to the end and return the texel at (px, py) of the picture (py = 0 is the north row) as [r, g, b, a].
function build(w, h, height, {pixelKm = 0.1, step = 4, exag = 1} = {}) {
  const hts = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hts[y * w + x] = height(x, y);
  const out = new Uint8Array(w * h * 4);
  const it = normalMapJob(hts, w, h, pixelKm, step, exag, out);
  let yields = 0; while (!it.next().done) yields++;
  // a DataTexture is uploaded bottom row first, so picture row py is stored at row h - 1 - py
  return {out, yields, at: (px, py) => [...out.subarray(((h - 1 - py) * w + px) * 4, ((h - 1 - py) * w + px) * 4 + 4)]};
}
const near = (got, want, tol = 1) => want.every((v, i) => Math.abs(got[i] - v) <= tol);          // the alpha channel is always 255 and is not compared

test('flat ground is the flat normal everywhere, and the work is handed back in slices', () => {
  const m = build(33, 33, () => 500);
  for (const [x, y] of [[0, 0], [16, 16], [32, 32], [5, 27], [0, 32]]) assert.deepEqual(m.at(x, y), [128, 128, 255, 255]);
  assert.equal(m.yields, 0);                                                                     // too small to need slicing
  const big = build(1280, 64, () => 0, {step: 2});
  assert.equal(big.yields, 4);                                                                   // every 16 rows of 1,280 texels (about 20,000 texels)
  assert.equal(big.out.length, 1280 * 64 * 4);
});

test('a smooth slope the mesh already shows is flat in the map, whatever the exaggeration (the slope is not counted twice)', () => {
  for (const exag of [1, 3]) {
    const east = build(41, 41, x => 30 * x, {exag});                       // 30 m per 100 m pixel: slope 0.3
    const south = build(41, 41, (x, y) => 25 * y, {exag, step: 2});
    for (const [x, y] of [[12, 12], [20, 20], [28, 9], [9, 30]]) {
      assert.ok(near(east.at(x, y), [128, 128, 255]), `east ramp, exag ${exag}, (${x}, ${y}): ${east.at(x, y)}`);
      assert.ok(near(south.at(x, y), [128, 128, 255]), `south ramp, exag ${exag}, (${x}, ${y}): ${south.at(x, y)}`);
    }
  }
});

test('detail smaller than the mesh spacing tilts the texel away from the way the ground rises, with the right numbers', () => {
  // a 100 m spike at pixel (6, 16): the lattice (every 4th pixel, at 4 and 8) never sees it, so the mesh normal is straight up and the map holds the full slope
  const spike = build(33, 33, (x, y) => (x === 6 && y === 16 ? 100 : 0));
  // pixel 5: ground rises to the east, slope (0.1 km - 0) / (2 x 0.1 km) = 0.5, normal (-0.5, 1, 0) / 1.118 = (-0.447, 0.894, 0): west-leaning
  assert.ok(near(spike.at(5, 16), [70, 128, 242]), 'west flank: ' + spike.at(5, 16));          // 127.5 + 127.5 x -0.447 = 70.5, 127.5 + 127.5 x 0.894 = 241.5
  assert.ok(near(spike.at(7, 16), [185, 128, 242]), 'east flank: ' + spike.at(7, 16));         // leans east: 127.5 + 57.0 = 184.5
  assert.deepEqual(spike.at(6, 16).slice(0, 2), [128, 128]);                                    // the top is level
  assert.ok(spike.at(6, 16)[2] >= 254);
  assert.deepEqual(spike.at(20, 20), [128, 128, 255, 255]);                                    // far from it nothing changes
  // exaggeration 2 doubles the slope in the normal: (-1, 1, 0) / 1.414 = (-0.707, 0.707, 0)
  const spike2 = build(33, 33, (x, y) => (x === 6 && y === 16 ? 100 : 0), {exag: 2});
  assert.ok(near(spike2.at(5, 16), [37, 128, 218]), 'exag 2: ' + spike2.at(5, 16));            // 127.5 - 90.2 = 37.3, 127.5 + 90.2 = 217.7
});

test('rows run north to south in the picture, and the green channel leans toward north (the texture\'s +v)', () => {
  // a spike at pixel (16, 6): the pixel just north of it (py 5) sees ground rising toward the south, so its normal leans north: green above 128
  const spike = build(33, 33, (x, y) => (x === 16 && y === 6 ? 100 : 0));
  assert.ok(near(spike.at(16, 5), [128, 185, 242]), 'north of the spike: ' + spike.at(16, 5));
  assert.ok(near(spike.at(16, 7), [128, 70, 242]), 'south of the spike: ' + spike.at(16, 7));
  const stored = (px, py) => (((33 - 1 - py) * 33) + px) * 4;                                    // picture row py is stored at row h - 1 - py
  assert.equal(spike.out[stored(16, 5) + 1], 185);
});

// The shader's side of the bargain, written independently: normalize(T mx + B my + N mz) with T and B the east and north directions projected at right angles to N and scaled
// together. Given the texel and the mesh normal it must give back the full-resolution normal.
function shade([r, g, b], N) {
  const m = [r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const proj = d => { const k = dot(d, N); return [d[0] - k * N[0], d[1] - k * N[1], d[2] - k * N[2]]; };
  const T = proj([1, 0, 0]), B = proj([0, 0, -1]), s = 1 / Math.sqrt(Math.max(dot(T, T), dot(B, B)));
  const v = [0, 1, 2].map(i => T[i] * s * m[0] + B[i] * s * m[1] + N[i] * m[2]), l = Math.hypot(...v);
  return v.map(x => x / l);
}
test('on a steep tilted slope with a sub-mesh bump the texel plus the mesh normal give back the full-resolution normal', () => {
  const exag = 2, slope = 0.8, pixelKm = 0.1;                                                    // 80 m per 100 m pixel, drawn twice as steep
  const m = build(41, 41, (x, y) => 80 * x + (x === 21 && y === 20 ? 60 : 0), {exag, pixelKm});
  // the mesh normal on the plane: (-slope, 1, 0) with the y axis scaled by 1 / exag
  const N = (() => { const v = [-slope, 1 / exag, 0], l = Math.hypot(...v); return v.map(x => x / l); })();
  for (const [x, y] of [[20, 20], [22, 20], [21, 19], [21, 21], [21, 20]]) {
    const hx = (px, py) => 80 * px + (px === 21 && py === 20 ? 60 : 0);
    const gx = (hx(x + 1, y) - hx(x - 1, y)) / 1000 / (2 * pixelKm), gz = (hx(x, y + 1) - hx(x, y - 1)) / 1000 / (2 * pixelKm);
    const l = Math.hypot(exag * gx, 1, exag * gz), want = [-exag * gx / l, 1 / l, -exag * gz / l];
    const got = shade(m.at(x, y), N);
    assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 0.02), `(${x}, ${y}): got ${got.map(v => v.toFixed(3))} want ${want.map(v => v.toFixed(3))}`);
  }
  // away from the bump the texel is flat: the plane is exactly what the mesh shows
  assert.ok(near(m.at(10, 30), [128, 128, 255]), 'plane: ' + m.at(10, 30));
});

test('the quality governor can be reset to the top, with a hold, and a hitch before it counts for nothing', () => {
  const q = newQuality(); let t = 10000;
  for (let i = 0; i < 400; i++) { t += 40; qualityStep(q, t, 40); }
  assert.ok(q.level >= 2 && q.ema > 28);
  assert.equal(resetQuality(q, t), true);
  assert.deepEqual({level: q.level, ema: q.ema, changed: q.changed, fastSince: q.fastSince}, {level: 0, ema: 16, changed: t, fastSince: 0});
  assert.equal(resetQuality(q, t + 1), false);                                                   // already at the top: nothing to apply
  for (let i = 0; i < 20; i++) { t += 40; assert.equal(qualityStep(q, t, 40), false); }          // the hold: 0.8 s of slow frames cannot lower it at once
  assert.equal(q.level, 0);
});

test('detail levels are requested at 1.3 times their distance, and the governor numbers are the agreed ones', () => {
  assert.equal(LOD_ASK, 1.3);
  assert.deepEqual(QUALITY, {slowMs: 28, fastMs: 19, holdMs: 2500, recoverMs: 2500});
  assert.deepEqual(QUALITY_STEPS, [{dpr: 1, trails: 1}, {dpr: 0.85, trails: 1}, {dpr: 0.75, trails: 1}, {dpr: 0.75, trails: 0.7}, {dpr: 0.75, trails: 0.5}, {dpr: 0.75, trails: 0.35}]);
  assert.ok(QUALITY_STEPS.every(s => s.dpr >= 0.75));
  assert.ok(QUALITY.fastMs > 1000 / 60);                                                         // above a 60 Hz frame, so a screen that keeps up can recover
  const [a, b, c] = LOD_LEVELS.map(l => l.maxDist);                                              // 900, 320, 110
  assert.deepEqual(lodWanted(a * 1.3), [9]); assert.deepEqual(lodWanted(a * 1.3 + 1), []);
  assert.deepEqual(lodWanted(b * 1.3), [9, 10]); assert.deepEqual(lodWanted(b * 1.3 + 1), [9]);
  assert.deepEqual(lodWanted(c * 1.3), [9, 10, 11]); assert.deepEqual(lodWanted(c * 1.3 + 1), [9, 10]);
});

test('a 60 Hz screen that was lowered recovers: its 16.7 ms frames are under the fast limit', () => {
  const q = newQuality(); let t = 10000;
  for (let i = 0; i < 300; i++) { t += 40; qualityStep(q, t, 40); }
  assert.ok(q.level >= 2);
  for (let i = 0; i < 60 * 40; i++) { t += 16.7; qualityStep(q, t, 16.7); }                       // 40 s at 60 Hz
  assert.equal(q.level, 0);
  const slow = newQuality(); t = 10000;
  for (let i = 0; i < 2000; i++) { t += 24; qualityStep(slow, t, 24); }                           // 24 ms (41 fps) is no longer "slow"
  assert.equal(slow.level, 0);
  const slower = newQuality(); t = 10000;
  for (let i = 0; i < 300; i++) { t += 33; qualityStep(slower, t, 33); }                          // 33 ms (30 fps) is
  assert.ok(slower.level >= 1);
});
