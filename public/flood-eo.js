// FloodAI Earth-observation logic: ESA WorldCover land cover, Sentinel-1 water mapping (12-month water
// frequency, river channel, banks), observed-flood masks and model-versus-satellite skill scores.
// Pure functions first (tested), then the Planetary Computer fetchers.
const finite = v => typeof v === 'number' && Number.isFinite(v);

// ---- land cover ----
// ESA WorldCover 2021 v200 class codes mapped onto the TR-55 / Chow classes in flood-logic.js.
// `assumed` marks mappings that are this tool's judgement, not a published crosswalk.
export const WORLDCOVER = {
  10: {key: 'woodland', label: 'Tree cover', color: [0, 100, 0]}, 20: {key: 'shrub', label: 'Shrubland', color: [255, 187, 34]},
  30: {key: 'pasture', label: 'Grassland', color: [255, 255, 76]}, 40: {key: 'cropland', label: 'Cropland', color: [240, 150, 255]},
  50: {key: 'builtup', label: 'Built-up', color: [250, 0, 0]}, 60: {key: 'bare', label: 'Bare / sparse vegetation', color: [180, 180, 180], assumed: true},
  70: {key: 'bare', label: 'Snow and ice', color: [240, 240, 240], assumed: true}, 80: {key: 'water', label: 'Open water', color: [0, 100, 200]},
  90: {key: 'water', label: 'Wetland', color: [0, 150, 160], assumed: true}, 95: {key: 'woodland', label: 'Mangroves', color: [0, 207, 117]},
  100: {key: 'pasture', label: 'Moss and lichen', color: [250, 230, 160], assumed: true},
};
export const CROPLAND_CODE = 40;
// Most common class in each factor x factor block (0 = no data is ignored).
export function modeDownsample(codes, size, factor) {
  const n = Math.floor(size / factor), out = new Uint8Array(n * n), counts = new Map();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    counts.clear();
    for (let b = 0; b < factor; b++) for (let a = 0; a < factor; a++) { const v = codes[(j * factor + b) * size + i * factor + a]; if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    let best = 0, bc = 0;
    for (const [v, c] of counts) if (c > bc) { bc = c; best = v; }
    out[j * n + i] = best;
  }
  return out;
}
// Cover keys present on the grid, a per-cell index into them, and the share of cells (optionally inside a mask).
export function coverClasses(codes, mask = null) {
  const keys = [], index = new Map(), classOf = new Uint8Array(codes.length), counts = [];
  let valid = 0;
  for (let c = 0; c < codes.length; c++) {
    const info = WORLDCOVER[codes[c]];
    if (!info) { classOf[c] = 255; continue; }
    if (!index.has(info.key)) { index.set(info.key, keys.length); keys.push(info.key); counts.push(0); }
    classOf[c] = index.get(info.key);
    if (!mask || mask[c]) { counts[classOf[c]]++; valid++; }
  }
  return {keys, classOf, share: counts.map(x => valid ? x / valid : 0), valid};
}
// Cells with no class (255) use the most common class so the model has a value everywhere.
export function fillMissingClass(classOf, keys, share) {
  const fallback = share.indexOf(Math.max(...share)), out = Uint8Array.from(classOf);
  for (let c = 0; c < out.length; c++) if (out[c] === 255) out[c] = Math.max(0, fallback);
  return out;
}

// ---- Sentinel-1 ----
// Tiles are requested as 8-bit PNG of 10*log10(VV) rescaled to DB_RANGE, so byte b is b/255*35 - 30 dB.
export const DB_RANGE = [-30, 5];
export const byteToDb = b => DB_RANGE[0] + b / 255 * (DB_RANGE[1] - DB_RANGE[0]);
// Otsu's method: the threshold that best separates two populations in a histogram of bytes.
export function otsu(hist) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let sumAll = 0;
  hist.forEach((c, i) => { sumAll += i * c; });
  let wB = 0, sumB = 0, best = -1, thr = null;
  for (let t = 0; t < hist.length; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}
export function addHistogram(hist, bytes, alpha) { for (let i = 0; i < bytes.length; i++) if (alpha[i]) hist[bytes[i]]++; }
// 1 = water (backscatter at or below the threshold), 0 = land, 255 = no data.
export function waterMask(bytes, alpha, thr) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < out.length; i++) out[i] = !alpha[i] ? 255 : bytes[i] <= thr ? 1 : 0;
  return out;
}
// 3 x 3 majority filter: a pixel is water only if most of its valid neighbours are (removes radar speckle).
export function majorityFilter(mask, size) {
  const out = Uint8Array.from(mask);
  for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) {
    const c = j * size + i;
    if (mask[c] === 255) continue;
    let water = 0, valid = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = mask[c + dj * size + di]; if (v !== 255) { valid++; if (v === 1) water++; } }
    out[c] = water * 2 > valid ? 1 : 0;
  }
  return out;
}
// Mark pixels on steep ground as no data (radar shadow reads as water).
export function maskSteep(mask, slope, slopeMax = 5) {
  const out = Uint8Array.from(mask);
  for (let i = 0; i < out.length; i++) if (slope[i] > slopeMax) out[i] = 255;
  return out;
}
// Fraction of valid scenes in which each pixel was water.
export function waterFrequency(masks) {
  const size = masks[0].length, freq = new Float32Array(size), obs = new Uint16Array(size);
  for (const m of masks) for (let i = 0; i < size; i++) if (m[i] !== 255) { obs[i]++; if (m[i] === 1) freq[i]++; }
  for (let i = 0; i < size; i++) freq[i] = obs[i] ? freq[i] / obs[i] : NaN;
  return {freq, obs};
}
// River channel: of the 8-connected bodies of water (frequency >= minFreq) that reach within `radius` pixels of the
// chosen point, the largest one. (The nearest water can be a canal; the river is the biggest connected body.)
export const CHANNEL_MIN_FREQ = 0.5;   // convention of this tool: wet in at least half of the scenes
export function channelFrom(freq, size, px, py, {minFreq = CHANNEL_MIN_FREQ, radius = 150} = {}) {
  const wet = i => freq[i] >= minFreq, seen = new Uint8Array(size * size);
  let best = null;
  const x0 = Math.max(0, Math.floor(px) - radius), x1 = Math.min(size - 1, Math.floor(px) + radius), y0 = Math.max(0, Math.floor(py) - radius), y1 = Math.min(size - 1, Math.floor(py) + radius);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const c = j * size + i;
    if (seen[c] || !wet(c) || (i - px) ** 2 + (j - py) ** 2 > radius * radius) continue;
    const members = [], stack = [c];
    seen[c] = 1;
    while (stack.length) {
      const m = stack.pop(); members.push(m);
      const mi = m % size, mj = (m - mi) / size;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = mi + di, b = mj + dj;
        if (a < 0 || b < 0 || a >= size || b >= size) continue;
        const n = b * size + a;
        if (!seen[n] && wet(n)) { seen[n] = 1; stack.push(n); }
      }
    }
    if (!best || members.length > best.length) best = members;
  }
  const mask = new Uint8Array(size * size);
  if (!best) return {mask, cells: 0, seed: -1};
  for (const m of best) mask[m] = 1;
  return {mask, cells: best.length, seed: best[0]};
}
// Bank cells: channel cells with at least one non-channel 4-neighbour.
export function bankCells(mask, size) {
  const out = new Uint8Array(mask.length);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const c = j * size + i;
    if (!mask[c]) continue;
    if (i === 0 || j === 0 || i === size - 1 || j === size - 1 || !mask[c - 1] || !mask[c + 1] || !mask[c - size] || !mask[c + size]) out[c] = 1;
  }
  return out;
}
// Lower the DEM by `depth` metres inside the channel (a stated assumption: no bathymetry is available).
export function burnChannel(z, mask, depth) {
  if (!(depth > 0)) return z;
  const out = Float32Array.from(z);
  for (let c = 0; c < out.length; c++) if (mask[c] && !Number.isNaN(out[c])) out[c] -= depth;
  return out;
}
// Terrain slope in degrees (central differences) on a square grid.
export function slopeDeg(z, size, cellM) {
  const out = new Float32Array(size * size).fill(NaN);
  for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) {
    const c = j * size + i, dx = (z[c + 1] - z[c - 1]) / (2 * cellM), dy = (z[c + size] - z[c - size]) / (2 * cellM);
    out[c] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  }
  return out;
}
// Radar shadow on steep ground also reads as low backscatter, so steep cells are not counted as flood.
// 5 degrees is common practice in SAR flood mapping; it is a convention here, not a derived value.
export const SLOPE_MAX_DEG = 5;
export function observedFlood(eventWater, freq, slope, {permanentFreq = CHANNEL_MIN_FREQ, slopeMax = SLOPE_MAX_DEG} = {}) {
  const out = new Uint8Array(eventWater.length);
  for (let i = 0; i < out.length; i++) {
    if (eventWater[i] === 255) { out[i] = 255; continue; }
    const permanent = freq[i] >= permanentFreq, steep = slope[i] > slopeMax;
    out[i] = eventWater[i] === 1 && !permanent && !steep ? 1 : 0;
  }
  return out;
}
// Share of each block that is flagged (nodata counts as not flagged, and blocks with no data are 255).
export function blockFraction(mask, size, factor) {
  const n = Math.floor(size / factor), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let hit = 0, valid = 0;
    for (let b = 0; b < factor; b++) for (let a = 0; a < factor; a++) { const v = mask[(j * factor + b) * size + i * factor + a]; if (v !== 255) { valid++; if (v === 1) hit++; } }
    out[j * n + i] = valid ? hit / valid : NaN;
  }
  return out;
}
// Skill of a modelled flood against an observed one, cell by cell (cells with no observation are skipped).
export function compareMasks(model, observed) {
  let hits = 0, misses = 0, falseAlarms = 0, correctNegatives = 0;
  for (let i = 0; i < model.length; i++) {
    if (!finite(observed[i])) continue;
    const o = observed[i] >= 0.5, m = !!model[i];
    if (o && m) hits++; else if (o) misses++; else if (m) falseAlarms++; else correctNegatives++;
  }
  const div = (a, b) => b ? a / b : null;
  return {hits, misses, falseAlarms, correctNegatives, pod: div(hits, hits + misses), far: div(falseAlarms, hits + falseAlarms), csi: div(hits, hits + misses + falseAlarms), compared: hits + misses + falseAlarms + correctNegatives};
}
// Observed-flood cells that fall on cropland / total, in km2.
export function cropAreaKm2(cellFlag, cropCodes, cellM, codeValue = CROPLAND_CODE) {
  let flooded = 0, total = 0;
  for (let c = 0; c < cropCodes.length; c++) if (cropCodes[c] === codeValue) { total++; if (cellFlag[c]) flooded++; }
  return {floodedKm2: flooded * cellM * cellM / 1e6, totalKm2: total * cellM * cellM / 1e6};
}

// ---- OSM buildings -> people (a stated lower-bound estimate) ----
// Only buildings explicitly tagged as homes count; untagged building=yes is excluded because it includes sheds and shops.
export const RESIDENTIAL_BUILDINGS = new Set(['house', 'residential', 'apartments', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'dormitory']);
export const HOUSEHOLD_SIZE = 6.3;   // average Pakistan household (Census 2023, about 6.3); editable in the panel
export const peopleEstimate = (residentialFlooded, household = HOUSEHOLD_SIZE) => Math.round(residentialFlooded * household);
export const buildingHeight = tags => {
  const h = parseFloat(tags?.height), lv = parseFloat(tags?.['building:levels']);
  return finite(h) && h > 0 ? h : finite(lv) && lv > 0 ? lv * 3 : 6;   // 3 m per level and 6 m when untagged are assumptions
};

// ---- Planetary Computer ----
const PC = 'https://planetarycomputer.microsoft.com/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WAITS = [2000, 5000, 10000, 20000];
async function fetchRetry(url, init = {}, signal) {
  for (let attempt = 0; ; attempt++) {
    let r = null;
    try { r = await fetch(url, {...init, signal}); } catch (e) { if (signal?.aborted) throw e; if (attempt >= WAITS.length) throw e; }
    if (r && (r.ok || (r.status !== 429 && r.status < 500) || attempt >= WAITS.length)) return r;
    await sleep(WAITS[Math.min(attempt, WAITS.length - 1)]);
  }
}
export async function stacSearch(body, signal) {
  const r = await fetchRetry(PC + '/stac/v1/search', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}, signal);
  if (!r.ok) throw Error('Imagery catalogue returned HTTP ' + r.status);
  return (await r.json()).features || [];
}
export const frameBBox = f => [f.west, f.south, f.east, f.north];
const coversFrame = (item, f) => item.bbox && item.bbox[0] <= f.west && item.bbox[1] <= f.south && item.bbox[2] >= f.east && item.bbox[3] >= f.north;
// 12 months of Sentinel-1 scenes from one relative orbit (same viewing geometry), one per calendar month.
export function pickMonthlyScenes(items, frame) {
  const full = items.filter(i => coversFrame(i, frame) && (i.properties['sar:polarizations'] || []).includes('VV'));
  const byOrbit = new Map();
  for (const i of full) { const k = i.properties['sat:relative_orbit'] + '/' + i.properties['sat:orbit_state']; (byOrbit.get(k) || byOrbit.set(k, []).get(k)).push(i); }
  let best = [];
  for (const list of byOrbit.values()) { const months = new Set(list.map(i => i.properties.datetime.slice(0, 7))); if (months.size > new Set(best.map(i => i.properties.datetime.slice(0, 7))).size) best = list; }
  const perMonth = new Map();
  for (const i of best.sort((a, b) => a.properties.datetime.localeCompare(b.properties.datetime))) { const m = i.properties.datetime.slice(0, 7); if (!perMonth.has(m)) perMonth.set(m, i); }
  return [...perMonth.values()].map(i => ({id: i.id, date: i.properties.datetime.slice(0, 10), orbit: i.properties['sat:relative_orbit'] + ' ' + i.properties['sat:orbit_state']}));
}
export async function searchMonthlyS1(frame, startIso, endIso, signal) {
  const items = await stacSearch({collections: ['sentinel-1-rtc'], bbox: frameBBox(frame), datetime: `${startIso}/${endIso}`, limit: 200}, signal);
  return pickMonthlyScenes(items, frame);
}
export async function searchEventS1(frame, startIso, endIso, signal) {
  const items = await stacSearch({collections: ['sentinel-1-rtc'], bbox: frameBBox(frame), datetime: `${startIso}/${endIso}`, limit: 50}, signal);
  return items.filter(i => coversFrame(i, frame) && (i.properties['sar:polarizations'] || []).includes('VV')).map(i => ({id: i.id, date: i.properties.datetime.slice(0, 16).replace('T', ' '), orbit: i.properties['sat:relative_orbit'] + ' ' + i.properties['sat:orbit_state']}))
    .sort((a, b) => a.date.localeCompare(b.date));
}
// Fetch the frame's tiles as one size x size raster of bytes plus an alpha mask.
async function tileMosaic(frame, tileURL, signal, concurrency = 3) {
  const size = frame.size, T = size / 256, bytes = new Uint8Array(size * size), alpha = new Uint8Array(size * size);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const jobs = Array.from({length: T * T}, (_, k) => k);
  let covered = 0;
  const worker = async () => {
    while (jobs.length) {
      const k = jobs.shift(), tx = k % T, ty = Math.floor(k / T);
      const url = tileURL(frame.z, frame.x0 + tx, frame.y0 + ty);
      if (!url) continue;
      const r = await fetchRetry(url, {}, signal);
      if (!r.ok) continue;
      const bitmap = await createImageBitmap(await r.blob(), {colorSpaceConversion: 'none'});
      ctx.clearRect(0, 0, 256, 256); ctx.drawImage(bitmap, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
        const o = (j * 256 + i) * 4, at = (ty * 256 + j) * size + tx * 256 + i;
        bytes[at] = px[o]; alpha[at] = px[o + 3] ? 1 : 0; if (px[o + 3]) covered++;
      }
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
  return {bytes, alpha, covered: covered / (size * size)};
}
export const s1TileURL = item => (z, x, y) => `${PC}/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}.png?collection=sentinel-1-rtc&item=${encodeURIComponent(item)}&assets=vv&expression=${encodeURIComponent('10*log10(vv_b1)')}&rescale=${DB_RANGE[0]},${DB_RANGE[1]}&format=png`;
export const fetchS1 = (frame, itemId, signal) => tileMosaic(frame, s1TileURL(itemId), signal);
// WorldCover 2021 v200: one STAC item per 3-degree block, so try every block that touches the frame.
export async function fetchWorldCover(frame, signal) {
  const items = (await stacSearch({collections: ['esa-worldcover'], bbox: frameBBox(frame), limit: 10}, signal)).filter(i => /2021_v200/.test(i.id)).map(i => i.id);
  if (!items.length) throw Error('No WorldCover tile covers this place.');
  const size = frame.size, codes = new Uint8Array(size * size), T = size / 256;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const jobs = Array.from({length: T * T}, (_, k) => k);
  const worker = async () => {
    while (jobs.length) {
      const k = jobs.shift(), tx = k % T, ty = Math.floor(k / T);
      for (const item of items) {
        const r = await fetchRetry(`${PC}/data/v1/item/tiles/WebMercatorQuad/${frame.z}/${frame.x0 + tx}/${frame.y0 + ty}.png?collection=esa-worldcover&item=${item}&assets=map&rescale=0,255&format=png`, {}, signal);
        if (!r.ok) continue;
        const bitmap = await createImageBitmap(await r.blob(), {colorSpaceConversion: 'none'});
        ctx.clearRect(0, 0, 256, 256); ctx.drawImage(bitmap, 0, 0);
        const px = ctx.getImageData(0, 0, 256, 256).data;
        for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const o = (j * 256 + i) * 4; if (px[o + 3]) codes[(ty * 256 + j) * size + tx * 256 + i] = px[o]; }
        break;
      }
    }
  };
  await Promise.all(Array.from({length: 3}, worker));
  if (!codes.some(v => WORLDCOVER[v])) throw Error('WorldCover returned no land cover for this place.');
  return codes;
}
