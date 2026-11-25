// FloodAI terrain: decode free elevation tiles and derive the stream network from the DEM.
// Terrain tiles: AWS Terrain Tiles (Terrarium encoding), which carry SRTM / Copernicus-class 30 m elevation
// at this zoom. They are a surface model (buildings and canals included), not LiDAR.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export const TILE_ZOOM = 12, TILES = 3, TILE_PX = 256;
export const terrariumHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;
export const terrainTileURL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---- Web-Mercator tile maths ----
export const tileOf = (lat, lon, z = TILE_ZOOM) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
export const tileCorner = (x, y, z = TILE_ZOOM) => {
  const n = 2 ** z;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, x / n * 360 - 180];   // [lat, lon]
};
export const metresPerPixel = (lat, z = TILE_ZOOM) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;

// A square mosaic (TILES x TILES tiles) around a point. Pixel (i, j) lies at fractional tile coordinates.
export function mosaicFrame(lat, lon, z = TILE_ZOOM) {
  const [cx, cy] = tileOf(lat, lon, z), x0 = cx - (TILES - 1) / 2, y0 = cy - (TILES - 1) / 2;
  const nw = tileCorner(x0, y0, z), se = tileCorner(x0 + TILES, y0 + TILES, z), size = TILES * TILE_PX;
  return {z, x0, y0, size, north: nw[0], west: nw[1], south: se[0], east: se[1], centreLat: (nw[0] + se[0]) / 2};
}
export function pixelOfLatLon(frame, lat, lon) {
  const n = 2 ** frame.z, r = lat * Math.PI / 180;
  const tx = (lon + 180) / 360 * n, ty = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return [(tx - frame.x0) * TILE_PX, (ty - frame.y0) * TILE_PX];   // [px x, px y]
}
export function latLonOfPixel(frame, px, py) {
  const n = 2 ** frame.z, tx = frame.x0 + px / TILE_PX, ty = frame.y0 + py / TILE_PX;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI, tx / n * 360 - 180];
}

// Reduce the mosaic by an integer factor (mean) into the working grid.
export function downsample(elev, size, factor) {
  const n = Math.floor(size / factor), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let b = 0; b < factor; b++) for (let a = 0; a < factor; a++) { const v = elev[(j * factor + b) * size + i * factor + a]; if (finite(v)) { s += v; c++; } }
    out[j * n + i] = c ? s / c : NaN;
  }
  return {data: out, n};
}
// Bilinear sample of a size x size grid at fractional pixel coordinates; NaN outside.
export function sampleGrid(data, size, px, py) {
  if (px < 0 || py < 0 || px > size - 1 || py > size - 1) return NaN;
  const i = Math.min(size - 2, Math.floor(px)), j = Math.min(size - 2, Math.floor(py)), fx = px - i, fy = py - j;
  const a = data[j * size + i], b = data[j * size + i + 1], c = data[(j + 1) * size + i], d = data[(j + 1) * size + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// ---- hydrological conditioning (D8) ----
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1], STEP = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
// Priority-flood depression filling with a tiny gradient (Barnes et al. 2014, epsilon variant) so flats drain.
export function fillDepressions(z, n, eps = 1e-3) {
  const out = Float32Array.from(z), closed = new Uint8Array(n * n), heap = [];
  const push = (i, key) => { heap.push([key, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i === 0 || j === 0 || i === n - 1 || j === n - 1 || Number.isNaN(out[j * n + i])) { const c = j * n + i; if (!Number.isNaN(out[c])) { closed[c] = 1; push(c, out[c]); } }
  while (heap.length) {
    const [key, c] = pop(), ci = c % n, cj = (c - ci) / n;
    for (let d = 0; d < 8; d++) {
      const i = ci + DX[d], j = cj + DY[d];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const m = j * n + i;
      if (closed[m] || Number.isNaN(out[m])) continue;
      closed[m] = 1;
      if (out[m] <= key + eps) out[m] = key + eps;
      push(m, out[m]);
    }
  }
  return out;
}
// Steepest-descent neighbour (D8). -1 marks an edge cell or a cell with no lower neighbour.
export function flowDirections(z, n) {
  const dir = new Int8Array(n * n).fill(-1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = j * n + i;
    if (Number.isNaN(z[c])) continue;
    let best = 0, bd = -1;
    for (let d = 0; d < 8; d++) {
      const a = i + DX[d], b = j + DY[d];
      if (a < 0 || b < 0 || a >= n || b >= n) { continue; }
      const drop = (z[c] - z[b * n + a]) / STEP[d];
      if (drop > best) { best = drop; bd = d; }
    }
    dir[c] = bd;
  }
  return dir;
}
export const downstream = (dir, c, n) => { const d = dir[c]; return d < 0 ? -1 : (Math.floor(c / n) + DY[d]) * n + (c % n) + DX[d]; };

// Flow accumulation (cells draining through each cell) and Strahler order, both in one pass over the
// cells sorted by filled elevation (high to low).
export function networkOf(zFilled, dir, n) {
  const cells = Array.from({length: n * n}, (_, i) => i).filter(i => !Number.isNaN(zFilled[i])).sort((a, b) => zFilled[b] - zFilled[a]);
  const acc = new Float32Array(n * n).fill(1), maxIn = new Uint8Array(n * n), cnt = new Uint8Array(n * n), order = new Uint8Array(n * n);
  for (const c of cells) {
    order[c] = maxIn[c] === 0 ? 1 : cnt[c] >= 2 ? maxIn[c] + 1 : maxIn[c];
    const ds = downstream(dir, c, n);
    if (ds < 0) continue;
    acc[ds] += acc[c];
    if (order[c] > maxIn[ds]) { maxIn[ds] = order[c]; cnt[ds] = 1; } else if (order[c] === maxIn[ds]) cnt[ds]++;
  }
  return {acc, order, cells};
}
// Snap a point to the highest-accumulation cell within `radius` cells, then collect everything upstream of it.
export function catchmentOf(dir, acc, n, px, py, radius = 3) {
  let best = -1, bv = -1;
  for (let j = Math.max(0, py - radius); j <= Math.min(n - 1, py + radius); j++) for (let i = Math.max(0, px - radius); i <= Math.min(n - 1, px + radius); i++) { const c = j * n + i; if (acc[c] > bv) { bv = acc[c]; best = c; } }
  if (best < 0) return null;
  const donors = Array.from({length: n * n}, () => []);
  for (let c = 0; c < n * n; c++) { const ds = downstream(dir, c, n); if (ds >= 0) donors[ds].push(c); }
  const mask = new Uint8Array(n * n), stack = [best];
  mask[best] = 1;
  let size = 0;
  while (stack.length) { const c = stack.pop(); size++; for (const u of donors[c]) if (!mask[u]) { mask[u] = 1; stack.push(u); } }
  return {outlet: best, mask, cells: size};
}
// Longest flow path to the outlet and its mean slope, from the filled surface (strictly descending along paths).
export function longestPath(zFilled, dir, n, catchment, cellM) {
  const ids = [];
  for (let c = 0; c < n * n; c++) if (catchment.mask[c]) ids.push(c);
  ids.sort((a, b) => zFilled[a] - zFilled[b]);
  const dist = new Float32Array(n * n);
  let far = catchment.outlet;
  for (const c of ids) {
    if (c === catchment.outlet) continue;
    const ds = downstream(dir, c, n);
    if (ds < 0 || !catchment.mask[ds]) continue;
    const d = dir[c];
    dist[c] = dist[ds] + STEP[d] * cellM;
    if (dist[c] > dist[far]) far = c;
  }
  const length = dist[far], drop = zFilled[far] - zFilled[catchment.outlet];
  return {length, slope: length > 0 ? Math.max(0, drop) / length : 0, farCell: far};
}
// Ground profile between two map points, sampled from the full-resolution mosaic.
export function profileBetween(frame, elev, a, b, samples = 120) {
  const [ax, ay] = pixelOfLatLon(frame, a[0], a[1]), [bx, by] = pixelOfLatLon(frame, b[0], b[1]);
  const mpp = metresPerPixel(frame.centreLat, frame.z), out = [];
  for (let k = 0; k < samples; k++) {
    const t = k / (samples - 1), px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    out.push({dist: Math.hypot(bx - ax, by - ay) * mpp * t, z: sampleGrid(elev, frame.size, px, py), px, py});
  }
  return out;
}
