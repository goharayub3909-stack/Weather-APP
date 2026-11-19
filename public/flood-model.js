// FloodAI 2D rain-on-grid solver: the local inertial form of the shallow-water equations
// (Bates, Horritt and Fewtrell 2010, J. Hydrol. 387) with Manning friction, on a square grid.
// Rain enters every wet-able cell after SCS losses (computed by the caller); cells with no elevation are walls.
// Edges are open: water leaves at normal depth with slope max(local slope, EDGE_SLOPE_FLOOR) (an assumption).
// It models only the rain that falls inside the grid; inflow from upstream of the grid is not included.
export const G = 9.81, MIN_DEPTH = 1e-3, EDGE_SLOPE_FLOOR = 5e-4, MAX_DT = 60, CFL = 0.7;

// Rain is either one hourly series for every cell (`effectiveMm`) or one series per land-cover class
// (`effectiveByClass[k][hour]`, with `classOf[cell]` = k), so each pixel can have its own curve number.
export function createSimulation({z, n, cellM, manning, effectiveMm = [], effectiveByClass = null, classOf = null, hours, frameEveryHours = 1}) {
  const cells = n * n, h = new Float32Array(cells), qx = new Float32Array(cells), qy = new Float32Array(cells);
  const outflow = new Float32Array(cells), valid = new Uint8Array(cells), maxDepth = new Float32Array(cells), peakHour = new Float32Array(cells);
  const nm = typeof manning === 'number' ? new Float32Array(cells).fill(manning) : manning;
  let wetCells = 0;
  for (let c = 0; c < cells; c++) { valid[c] = Number.isNaN(z[c]) ? 0 : 1; wetCells += valid[c]; }
  const sim = {
    n, cellM, hours, h, maxDepth, peakHour, frames: [], time: 0, done: false, wetCells,
    volumes: {rain: 0, out: 0},       // m3 added by rain, m3 left through the edges
    storage: () => { let s = 0; for (let c = 0; c < cells; c++) s += h[c]; return s * cellM * cellM; },
    meta: {dt: 0, steps: 0},
  };
  const total = hours * 3600;
  let nextFrame = 0;
  const frame = () => { sim.frames.push({hour: sim.time / 3600, depth: Float32Array.from(h)}); nextFrame += frameEveryHours * 3600; };
  frame();
  const scaleOf = new Float32Array(cells);
  let hmax = 0;
  function step() {
    const dt = Math.min(MAX_DT, total - sim.time, CFL * cellM / Math.sqrt(G * Math.max(hmax, 0.05))), k = dt / cellM;
    // 1. face fluxes (qx[c] joins c and c+1, qy[c] joins c and c+n) and what each cell gives away. Faces between
    //    two dry cells carry nothing, so they are skipped.
    outflow.fill(0);
    for (let j = 0; j < n; j++) for (let i = 0, c = j * n; i < n; i++, c++) {
      if (i < n - 1) {
        const b = c + 1; let q = 0;
        if (valid[c] && valid[b] && (h[c] > MIN_DEPTH || h[b] > MIN_DEPTH)) q = flux(qx[c], c, b, dt);
        qx[c] = q; if (q > 0) outflow[c] += q * k; else if (q < 0) outflow[b] -= q * k;
      }
      if (j < n - 1) {
        const b = c + n; let q = 0;
        if (valid[c] && valid[b] && (h[c] > MIN_DEPTH || h[b] > MIN_DEPTH)) q = flux(qy[c], c, b, dt);
        qy[c] = q; if (q > 0) outflow[c] += q * k; else if (q < 0) outflow[b] -= q * k;
      }
    }
    // 2. positivity: a cell cannot give away more than it holds (factor fixed before any face is applied)
    for (let c = 0; c < cells; c++) scaleOf[c] = outflow[c] > h[c] && outflow[c] > 0 ? h[c] / outflow[c] : 1;
    for (let j = 0; j < n; j++) for (let i = 0, c = j * n; i < n; i++, c++) {
      if (i < n - 1) { const q = qx[c]; if (q !== 0) { const f = q > 0 ? scaleOf[c] : scaleOf[c + 1], dq = q * f * k; qx[c] = q * f; h[c] -= dq; h[c + 1] += dq; } }
      if (j < n - 1) { const q = qy[c]; if (q !== 0) { const f = q > 0 ? scaleOf[c] : scaleOf[c + n], dq = q * f * k; qy[c] = q * f; h[c] -= dq; h[c + n] += dq; } }
    }
    // 3. open edges
    for (let j = 0; j < n; j++) {
      if (j === 0 || j === n - 1) for (let i = 0; i < n; i++) edge(i, j, k);
      else { edge(0, j, k); edge(n - 1, j, k); }
    }
    // 4. rain for this step (mm of effective rain per hour -> m per second), then peak tracking
    const hourIndex = Math.floor(sim.time / 3600), perStep = e => hourIndex < e.length && e[hourIndex] > 0 ? e[hourIndex] / 1000 / 3600 * dt : 0;
    const add = effectiveByClass ? 0 : perStep(effectiveMm), adds = effectiveByClass ? effectiveByClass.map(perStep) : null;
    let rained = 0;
    sim.time += dt; sim.meta.dt = dt; sim.meta.steps++;
    const hr = sim.time / 3600;
    let hm = 0;
    for (let c = 0; c < cells; c++) {
      if (!valid[c]) continue;
      const a = adds ? adds[classOf[c]] : add, v = h[c] + a;
      rained += a;
      h[c] = v;
      if (v > maxDepth[c]) { maxDepth[c] = v; peakHour[c] = hr; }
      if (v > hm) hm = v;
    }
    hmax = hm;
    sim.volumes.rain += rained * cellM * cellM;
    if (sim.time + 1e-6 >= nextFrame) frame();
  }
  function edge(i, j, k) {
    const c = j * n + i;
    if (!valid[c] || h[c] <= MIN_DEPTH) return;
    const sides = (i === 0) + (i === n - 1) + (j === 0) + (j === n - 1);
    let slope = EDGE_SLOPE_FLOOR;
    for (const x of [i === 0 ? c + 1 : i === n - 1 ? c - 1 : -1, j === 0 ? c + n : j === n - 1 ? c - n : -1]) if (x >= 0 && valid[x]) slope = Math.max(slope, (z[c] - z[x]) / cellM);
    const q = h[c] ** (5 / 3) / nm[c] * Math.sqrt(slope), lost = Math.min(h[c], sides * q * k);
    h[c] -= lost; sim.volumes.out += lost * cellM * cellM;
  }
  function flux(q, a, b, dt) {
    const ea = z[a] + h[a], eb = z[b] + h[b], hf = Math.max(ea, eb) - Math.max(z[a], z[b]);
    if (hf <= MIN_DEPTH) return 0;
    const nn = 0.5 * (nm[a] + nm[b]);
    return (q - G * hf * dt * (eb - ea) / cellM) / (1 + G * dt * nn * nn * Math.abs(q) / (hf * hf * Math.cbrt(hf)));
  }
  // Run for at most `budgetMs`, so the page stays responsive; returns progress 0..1.
  sim.advance = (budgetMs = 30) => {
    const t0 = performance.now();
    while (!sim.done && performance.now() - t0 < budgetMs) { step(); if (sim.time >= total - 1e-6) { sim.done = true; if (sim.frames[sim.frames.length - 1].hour < hours - 1e-6) frame(); } }
    return Math.min(1, sim.time / total);
  };
  sim.runAll = () => { while (!sim.done) sim.advance(1e6); return sim; };
  return sim;
}

// Cells deeper than `threshold` (m): a display / counting filter chosen by the user.
export function floodedStats(depth, cellM, threshold = 0.05) {
  let cells = 0, max = 0, sum = 0;
  for (let c = 0; c < depth.length; c++) { const d = depth[c]; if (d > max) max = d; if (d > threshold) { cells++; sum += d; } }
  return {areaKm2: cells * cellM * cellM / 1e6, maxDepth: max, meanDepth: cells ? sum / cells : 0, cells};
}
// Map a depth (m) to an RGBA colour; transparent below the threshold.
export function depthColor(d, threshold = 0.05) {
  if (!(d > threshold)) return [0, 0, 0, 0];
  const t = Math.min(1, Math.log1p(d) / Math.log1p(3));   // saturates at 3 m
  return [Math.round(150 - 130 * t), Math.round(210 - 150 * t), Math.round(255 - 60 * t * 0.5), Math.round(130 + 110 * t)];
}
