// Pure logic for the 3D terrain weather map (no DOM, no three.js), so every formula can be tested with numbers.
// Data: ECMWF IFS (9 km, Open-Meteo "ecmwf_ifs") sampled on a 0.5 degree grid by scripts/sync-terrain-weather.mjs.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export const GRID = {west: 60, east: 78, south: 23, north: 38, spacing: 0.5, columns: 37, rows: 31};
export const HOURS = 72;
export const SNOW_WATER_MM_PER_CM = 0.7;       // water in snow, about 0.7 mm per cm (Open-Meteo convention, as in forecast-periods.js)
export const CONVECTIVE_CAPE = 500;            // J/kg; screening convention shared with storms.js thunderEvidence
export const CONVECTIVE_RAIN_MM = 0.5;         // mm in the hour, same rule

// ---- grid ----
export const nodes = (g = GRID) => { const out = []; for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.columns; x++) out.push([+(g.south + y * g.spacing).toFixed(2), +(g.west + x * g.spacing).toFixed(2)]); return out; };
const r1 = v => finite(v) ? Math.round(v * 10) / 10 + 0 : null;      // + 0 turns -0 into 0
// rows: one Open-Meteo hourly object per node, in nodes() order.
export function buildDataset(rows, retrievedAt) {
  const times = rows[0].time.map(t => t.length === 16 ? t + ':00Z' : t);
  const u = times.map(() => []), v = times.map(() => []), precip = times.map(() => []), snow = times.map(() => []), cloud = times.map(() => []);
  for (const h of rows) {
    if (h.time.length !== times.length) throw Error('Mismatched hour axis');
    times.forEach((_, t) => {
      const s = h.wind_speed_10m[t], d = h.wind_direction_10m[t] * Math.PI / 180;      // direction the wind comes FROM
      u[t].push(finite(s) && finite(d) ? r1(-s * Math.sin(d)) : null);
      v[t].push(finite(s) && finite(d) ? r1(-s * Math.cos(d)) : null);
      precip[t].push(finite(h.precipitation[t]) && h.precipitation[t] >= 0 ? r1(h.precipitation[t]) : null);
      snow[t].push(finite(h.snowfall[t]) && h.snowfall[t] >= 0 ? r1(h.snowfall[t]) : null);
      cloud[t].push(finite(h.cloud_cover[t]) && h.cloud_cover[t] >= 0 && h.cloud_cover[t] <= 100 ? Math.round(h.cloud_cover[t]) : null);
    });
  }
  return {schema_version: 1, model: 'ecmwf_ifs', source: 'ECMWF IFS (9 km) via Open-Meteo', grid: GRID, times, u, v, precip, snow, cloud,
    units: {wind: 'm/s', precip: 'mm', snow: 'cm', cloud: '%'}, retrieved_at: retrievedAt};
}
export function validDataset(d) {
  if (d?.schema_version === 2) return validPacked(d);
  try {
    const n = GRID.columns * GRID.rows;
    if (d.schema_version !== 1 || d.model !== 'ecmwf_ifs' || JSON.stringify(d.grid) !== JSON.stringify(GRID)) return false;
    if (d.units?.wind !== 'm/s' || d.units?.precip !== 'mm' || d.units?.snow !== 'cm' || d.units?.cloud !== '%') return false;
    if (d.times.length !== HOURS || !Number.isFinite(Date.parse(d.retrieved_at))) return false;
    const axis = d.times.map(Date.parse);
    if (!axis.every((t, i) => Number.isFinite(t) && (i === 0 || t - axis[i - 1] === 3600000))) return false;
    return ['u', 'v', 'precip', 'snow', 'cloud'].every(k => d[k].length === HOURS && d[k].every(f => f.length === n));
  } catch { return false; }
}

// ---- 0.1 degree (9 km) dataset, schema 2: Int16 fields packed as base64, 3-hourly ----
const MISSING16 = -32768;
export const PACKED_REQUIRED = ['u', 'v', 'precip', 'snow', 'cloud'];
// Added later: 2 m temperature, CAPE and the winds at 850 and 700 hPa. A grid built before they existed is still valid without them.
export const PACKED_OPTIONAL = ['t2m', 'cape', 'u850', 'v850', 'u700', 'v700', 'gust'];
const packedLength = n => 4 * Math.ceil(n * 2 / 3);
export function validPacked(d) {
  try {
    const g = d.grid, cols = Math.round((g.east - g.west) / g.spacing) + 1, rows = Math.round((g.north - g.south) / g.spacing) + 1, n = cols * rows;
    if (d.model !== 'ecmwf_ifs_0p1' || g.columns !== cols || g.rows !== rows || !(g.spacing > 0)) return false;
    if (d.units?.wind !== 'm/s' || d.units?.precip !== 'mm' || d.units?.snow !== 'cm' || d.units?.cloud !== '%') return false;
    const T = d.times.length, axis = d.times.map(Date.parse);
    if (T < 2 || d.hours.length !== T || !Number.isFinite(Date.parse(d.retrieved_at))) return false;
    if (!axis.every((t, i) => Number.isFinite(t) && (i === 0 || t > axis[i - 1])) || !d.hours.every((h, i) => h === (axis[i] - axis[0]) / 3600000)) return false;
    const ok = k => d.scales?.[k] > 0 && Array.isArray(d[k]) && d[k].length === T && d[k].every(s => typeof s === 'string' && s.length === packedLength(n));
    return PACKED_REQUIRED.every(ok) && PACKED_OPTIONAL.every(k => !(k in d) || ok(k));
  } catch { return false; }
}
// Turns the packed fields into one Float32Array per step (NaN where the model gave nothing) so the sampler treats both datasets alike.
export function unpackDataset(d) {
  if (d.schema_version !== 2) return d;
  const out = {...d};
  for (const k of [...PACKED_REQUIRED, ...PACKED_OPTIONAL.filter(k => k in d)]) out[k] = d[k].map(s => decodePacked(s, d.scales[k]));
  return out;
}
// One base64 string of little-endian Int16 values to a Float32Array (value / scale, NaN for the missing marker).
function decodePacked(s, scale) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const q = new Int16Array(u8.buffer, 0, u8.length >> 1), f = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) f[i] = q[i] === MISSING16 ? NaN : q[i] / scale;
  return f;
}

// Bilinear in space, linear in time. A missing corner makes the sample missing: it is never filled with zero.
export class GridSampler {
  constructor(data) { this.d = data; }
  cell(field, t, lon, lat) {
    const g = this.d.grid, fx = (lon - g.west) / g.spacing, fy = (lat - g.south) / g.spacing;
    if (!(fx >= 0 && fy >= 0 && fx <= g.columns - 1 && fy <= g.rows - 1)) return null;
    const x0 = Math.min(Math.floor(fx), g.columns - 2), y0 = Math.min(Math.floor(fy), g.rows - 2), tx = fx - x0, ty = fy - y0, f = this.d[field][t];
    const at = (x, y) => f[y * g.columns + x];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), e = at(x0 + 1, y0 + 1);
    if (![a, b, c, e].every(finite)) return null;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }
  get hours() { return this.d.hours || this.d.times.map((_, i) => i); }      // hours after the first step (the 0.5 degree set is hourly, the 0.1 degree set 3-hourly)
  get lastHour() { return this.hours.at(-1); }
  // The two steps around an hour and the weight of the second.
  segment(hour) {
    const hs = this.hours, h = Math.min(Math.max(hour, 0), hs.at(-1));
    let i = 0; while (i < hs.length - 2 && h >= hs[i + 1]) i++;
    return {i0: i, i1: i + 1, w: Math.min(1, Math.max(0, (h - hs[i]) / (hs[i + 1] - hs[i])))};
  }
  sample(field, hour, lon, lat) {
    const {i0: t0, i1: t1, w} = this.segment(hour);
    const a = this.cell(field, t0, lon, lat);
    if (a === null || w === 0) return a;
    const b = this.cell(field, t1, lon, lat);
    return b === null ? null : a * (1 - w) + b * w;
  }
  has(field) { return Array.isArray(this.d[field]); }
  // level: 'sfc' (10 m), '850' or '700' (hPa). A level that is below the ground at the place is missing there, never extrapolated.
  wind(hour, lon, lat, level = 'sfc') {
    const ku = level === 'sfc' ? 'u' : 'u' + level, kv = level === 'sfc' ? 'v' : 'v' + level;
    if (!this.has(ku) || !this.has(kv)) return null;
    const u = this.sample(ku, hour, lon, lat), v = this.sample(kv, hour, lon, lat);
    return u === null || v === null ? null : {u, v, speed: Math.hypot(u, v)};
  }
  // Snow is the water in the reported snowfall, capped by the precipitation; the rest is rain.
  precip(hour, lon, lat) {
    const p = this.sample('precip', hour, lon, lat), s = this.sample('snow', hour, lon, lat);
    if (p === null) return null;
    const snowWater = s === null ? 0 : Math.min(p, s * SNOW_WATER_MM_PER_CM);
    return {total: p, snowWater, rain: p - snowWater};
  }
  // Hour index nearest to a timestamp, or null when outside the data.
  hourOf(ms) { const t0 = Date.parse(this.d.times[0]), h = (ms - t0) / 3600000, last = this.lastHour; return h >= -0.5 && h <= last + 0.5 ? Math.min(Math.max(h, 0), last) : null; }
}

// ---- Web Mercator ----
const MAX_LAT = 85.0511287798;
export const mercX = lon => lon / 360 + 0.5;                                                       // 0..1 across the world
export const mercY = lat => { const s = Math.sin(Math.min(Math.max(lat, -MAX_LAT), MAX_LAT) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
export const lonOfX = x => (x - 0.5) * 360;
export const latOfY = y => { const n = Math.PI - 2 * Math.PI * y; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
// Terrarium PNG (AWS Terrain Tiles): metres = R*256 + G + B/256 - 32768.
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
export const WORLD_KM = 40075.017;                                                                  // equator circumference: one world width at scale 1

// ---- colour ramps (RGBA 0..255) ----
const ramp = (stops, v) => {
  if (v <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ...ca] = stops[i - 1], [b, ...cb] = stops[i], t = (v - a) / (b - a); return ca.map((c, k) => Math.round(c + (cb[k] - c) * t)); }
  return stops.at(-1).slice(1);
};
// Rain in mm per hour. Transparent below 0.1 so dry land stays visible.
const RAIN = [[0.1, 74, 160, 255, 0], [0.5, 74, 160, 255, 150], [2, 40, 200, 160, 190], [5, 255, 214, 66, 215], [10, 255, 120, 40, 230], [25, 230, 40, 60, 240], [50, 200, 40, 190, 250]];
// Snow (water equivalent, mm per hour), purple as in the reference.
const SNOW = [[0.1, 190, 150, 255, 0], [0.5, 190, 150, 255, 150], [2, 160, 100, 240, 195], [5, 130, 60, 220, 220], [10, 100, 30, 190, 240]];
export const rainColour = mm => ramp(RAIN, mm);
export const snowColour = mm => ramp(SNOW, mm);
// Wind speed m/s to a trail colour: near-white cyan in calm air, then cyan, green, yellow, amber, red and magenta. High contrast against satellite
// imagery, dark terrain and snow (the trails also carry a dark halo, see RIBBON). The shader's ramp is generated from this table (windRampGlsl).
export const WIND = [[0, 235, 250, 255], [3, 120, 235, 255], [6, 110, 240, 160], [10, 255, 235, 90], [15, 255, 170, 40], [22, 255, 90, 50], [30, 255, 60, 150], [40, 230, 80, 255]];
export const windColour = ms => ramp(WIND, ms);
export const WIND_MAX = WIND.at(-1)[0];
export function windRampGlsl(name = 'windRamp') {
  const c = i => 'vec3(' + WIND[i].slice(1).map(v => v.toFixed(1)).join(', ') + ') / 255.';
  let body = 'vec3 ' + name + '(float s) {\n';
  for (let i = 1; i < WIND.length; i++) body += '  if (s < ' + WIND[i][0].toFixed(1) + ') return mix(' + c(i - 1) + ', ' + c(i) + ', (s - ' + WIND[i - 1][0].toFixed(1) + ') / ' + (WIND[i][0] - WIND[i - 1][0]).toFixed(1) + ');\n';
  return body + '  return ' + c(WIND.length - 1) + ';\n}';
}
// Wind trails are ribbons of triangles: the coloured core is the width of trailWidthPx, the quad is OUTLINE times wider and its outer part is a dark halo.
export const RIBBON = {outline: 1.45, core: 1 / 1.45};

// ---- rain split ----
// ECMWF through Open-Meteo has no convective rain field (showers is always 0), so convective rain is inferred:
// rain in an hour with CAPE at or above the threshold is counted as convective. A screening convention.
export function splitPrecip(mm, cape) {
  if (!finite(mm)) return {convective: null, other: null};
  const convective = finite(cape) && cape >= CONVECTIVE_CAPE && mm >= CONVECTIVE_RAIN_MM;
  return convective ? {convective: mm, other: 0} : {convective: 0, other: mm};
}

// ---- shareable view ----
// Hash: lon, lat, distance (km), tilt and heading (degrees), exaggeration, hour offset from the data start and layer letters.
export function encodeView(v) {
  const n = (x, d) => (+x).toFixed(d);
  return `#v=${n(v.lon, 3)},${n(v.lat, 3)},${Math.round(v.dist)},${Math.round(v.tilt)},${Math.round(v.heading)},${n(v.exag, 1)},${Math.round(v.hour)},${v.layers.join('')}${v.level && v.level !== 'sfc' ? ',' + v.level : ''}`;
}
export function decodeView(hash) {
  const m = /^#?v=(-?[\d.]+),(-?[\d.]+),(\d+),(\d+),(-?\d+),([\d.]+),(\d+),([wrscktv]*)(?:,(1000|925|850|700|600|500|400|300|250))?$/.exec(hash || '');
  if (!m) return null;
  const [lon, lat, dist, tilt, heading, exag, hour] = m.slice(1, 8).map(Number);
  if (lon < GRID.west - 5 || lon > GRID.east + 5 || lat < GRID.south - 5 || lat > GRID.north + 5 || dist < 5 || dist > 6000 || tilt < 0 || tilt > 90 || exag < 1 || exag > 10 || hour < 0 || hour > 240) return null;
  return {lon, lat, dist, tilt, heading, exag, hour, layers: [...new Set(m[8].split(''))], level: m[9] || 'sfc'};
}
export const PRESETS = [
  {name: 'Pakistan', lon: 69.5, lat: 30.2, dist: 2300, tilt: 52, heading: 0},
  {name: 'Karakoram & Himalaya', lon: 74.6, lat: 35.6, dist: 650, tilt: 55, heading: 0},
  {name: 'Murree & Galiyat', lon: 73.4, lat: 33.95, dist: 150, tilt: 58, heading: 0},
  {name: 'Punjab', lon: 72.8, lat: 31.4, dist: 900, tilt: 50, heading: 0},
  {name: 'Sindh & Karachi', lon: 68.2, lat: 25.9, dist: 900, tilt: 50, heading: 0},
  {name: 'Balochistan', lon: 65.5, lat: 28.6, dist: 1100, tilt: 50, heading: 0},
];

// ---- point forecast text ----
// hours: [{t: ms, temp, precip, snow(cm), wind(m/s), cape}] for the next day or more. Plain facts, no advice.
export function summariseHours(hours) {
  const rows = hours.filter(h => finite(h.temp) || finite(h.precip) || finite(h.wind)), n = rows.length;
  if (!n) return 'No forecast data for this point.';
  const sum = (a, f) => a.reduce((s, h) => s + (finite(f(h)) ? f(h) : 0), 0);
  const temps = rows.map(h => h.temp).filter(finite), hi = Math.max(...temps), lo = Math.min(...temps);
  const rainMm = sum(rows, h => splitPrecip(h.precip, h.cape).other), stormMm = sum(rows, h => splitPrecip(h.precip, h.cape).convective);
  const snowCm = sum(rows, h => h.snow), wind = Math.max(...rows.map(h => (finite(h.wind) ? h.wind : 0) * 3.6));
  const parts = temps.length ? [`Temperature ${Math.round(lo)} to ${Math.round(hi)}°C.`] : [];     // a grid without temperature still reports rain and wind
  const wet = rainMm + stormMm;
  if (snowCm >= 0.1) parts.push(`Snow ${snowCm.toFixed(1)} cm.`);
  if (stormMm >= 0.1) parts.push(`${stormMm.toFixed(1)} mm of rain in hours with high CAPE (thunderstorm-capable).`);
  if (rainMm >= 0.1) parts.push(`${rainMm.toFixed(1)} mm of other rain.`);
  if (wet < 0.1 && snowCm < 0.1) parts.push('No precipitation expected.');
  parts.push(`Strongest wind ${Math.round(wind)} km/h.`);
  return parts.join(' ');
}

// ---- terrain colour ----
// Metres above sea level to a land or sea colour. Negative values are the sea floor (darker with depth).
const LAND = [[0, 84, 107, 61], [550, 102, 117, 69], [900, 115, 102, 69],
  [1500, 128, 97, 71], [2400, 140, 120, 102], [3400, 175, 165, 155],
  [4500, 217, 217, 217], [5500, 242, 244, 246], [7000, 255, 255, 255]];
export const elevationColour = m => m <= 0 ? ramp([[-4000, 6, 18, 36], [0, 20, 52, 82]], m) : ramp(LAND, m);

// ---- terrain-following wind ----
// ECMWF's 10 m wind is smooth on a 9 km grid, so it cannot bend around a ridge a few km wide. This adjusts it with the height field:
// flow that runs uphill into a steep slope loses most of that uphill part and keeps its along-the-contour part, v - (v . n) n (it slides
// along the slope instead of being pushed into the crest, which made particles pile up on ridge lines), and speed
// rises over crests and falls in valleys. A diagnostic screening of the flow, not a weather model; the constants are conventions.
export const FLOW = {
  slopeFull: 0.12,      // slope (rise over run, about 7 degrees) at which the blocking is complete
  deflect: 0.85,        // share of the uphill wind component removed on a full-blocking slope
  tpiScaleM: 250,       // height above or below the surroundings (m) that gives the full speed change
  speedGain: 0.35,      // speed change at that height: +35 % on a crest, -35 % in a valley
};
// gx, gn: height gradient towards east and north (m per m). tpi: height minus the height of the surroundings (m). Writes [u, v] into out.
export function terrainWind(u, v, gx, gn, tpi, out = [0, 0]) {
  let U = u, V = v;
  const s = Math.hypot(gx, gn);
  if (s > 1e-4) {
    const nx = gx / s, ny = gn / s, up = u * nx + v * ny;                       // up: wind component towards higher ground
    if (up > 0) {
      const rem = Math.min(1, s / FLOW.slopeFull) * FLOW.deflect * up;
      U -= rem * nx; V -= rem * ny;
    }
  }
  const k = 1 + FLOW.speedGain * Math.min(1, Math.max(-1, (Number.isFinite(tpi) ? tpi : 0) / FLOW.tpiScaleM));
  out[0] = U * k; out[1] = V * k; return out;
}
// Running-mean blur of radius r cells (edges repeat), separable.
export function boxBlur(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let j = 0; j < h; j++) { let sum = 0; for (let k = -r; k <= r; k++) sum += src[j * w + Math.min(w - 1, Math.max(0, k))];
    for (let i = 0; i < w; i++) { tmp[j * w + i] = sum / n; sum += src[j * w + Math.min(w - 1, i + r + 1)] - src[j * w + Math.max(0, i - r)]; } }
  for (let i = 0; i < w; i++) { let sum = 0; for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + i];
    for (let j = 0; j < h; j++) { out[j * w + i] = sum / n; sum += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i]; } }
  return out;
}
// Height grid (row 0 = north, metres) to gradient and relief grids at 1/factor resolution. cellMetres is the size of one output cell.
// flowGridJob is the same computation as a generator that yields every few rows of its longest loop, so the page can run it in slices (see runSliced in app.js);
// flowGrid runs it to the end at once.
export function* flowGridJob(hts, w, h, factor, smoothR, tpiR, cellMetres) {
  const cw = Math.floor(w / factor), ch = Math.floor(h / factor), a = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      let sum = 0; for (let y = 0; y < factor; y++) for (let x = 0; x < factor; x++) sum += Math.max(0, hts[(j * factor + y) * w + i * factor + x]);
      a[j * cw + i] = sum / (factor * factor);
    }
    if (j % 16 === 15) yield;
  }
  const hs = boxBlur(a, cw, ch, smoothR), hb = boxBlur(a, cw, ch, tpiR), gx = new Float32Array(cw * ch), gn = new Float32Array(cw * ch), tpi = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i, i0 = Math.max(0, i - 1), i1 = Math.min(cw - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ch - 1, j + 1);
    gx[k] = (hs[j * cw + i1] - hs[j * cw + i0]) / ((i1 - i0) * cellMetres);
    gn[k] = -(hs[j1 * cw + i] - hs[j0 * cw + i]) / ((j1 - j0) * cellMetres);          // rows run southwards, so north is the other way
    tpi[k] = hs[k] - hb[k];
  }
  return {cw, ch, gx, gn, tpi};
}
export function flowGrid(...args) { const it = flowGridJob(...args); let r; while (!(r = it.next()).done); return r.value; }

// ---- temperature colours ----
// 2 m air temperature in degC to RGBA for the drape on the terrain. Cold blue to hot red; fairly transparent so the imagery shows through.
const TEMP = [[-30, 150, 90, 220, 150], [-15, 70, 90, 235, 150], [-5, 70, 170, 255, 150], [5, 90, 220, 220, 150], [12, 120, 225, 120, 150], [20, 245, 235, 90, 150], [28, 250, 170, 60, 155], [35, 240, 90, 50, 160], [42, 190, 30, 60, 165], [50, 120, 20, 80, 170]];
export const temperatureColour = c => ramp(TEMP, c);
export const TEMPERATURE_TICKS = [-30, -15, -5, 5, 12, 20, 28, 35, 42, 50];

// ---- pressure levels (surface to 250 hPa) ----
// Each level has its own file (public/terrain-data/levels/p<hPa>.json: u, v, temperature, geopotential height for every step), loaded when the level is first
// chosen. Heights below are the ICAO standard atmosphere, used for labels and to place the trails; the real height of the level (gh) comes with the data.
export const PRESSURE_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250];
const LEVEL_STD_M = {1000: 111, 925: 762, 850: 1457, 700: 3012, 600: 4206, 500: 5574, 400: 7185, 300: 9164, 250: 10363};
const LEVEL_ROLE = {1000: 'near the ground', 925: 'boundary layer', 850: 'boundary layer top, low-level jet', 700: 'mid-level steering, western disturbances', 600: 'mid troposphere',
  500: 'troughs and ridges of the large-scale flow', 400: 'upper troposphere', 300: 'subtropical jet stream', 250: 'subtropical and polar jet streams'};
export const FT_PER_M = 3.28084;
export const WIND_LEVELS = {sfc: {label: 'Surface (10 m)', hPa: null, heightM: 10, heightKm: 0, role: 'wind 10 m above the ground'},
  ...Object.fromEntries(PRESSURE_LEVELS.map(l => [String(l), {label: `${l} hPa (about ${(LEVEL_STD_M[l] / 1000).toFixed(1)} km)`, hPa: l, heightM: LEVEL_STD_M[l], heightKm: LEVEL_STD_M[l] / 1000, role: LEVEL_ROLE[l]}]))};
// Short texts for the altitude bar: the level, and its height in metres and feet.
export function levelAltitude(id) {
  const L = WIND_LEVELS[id];
  if (!L) return null;
  const m = L.heightM, ft = Math.round(m * FT_PER_M / 10) * 10, big = m >= 1000;
  return {id, hPa: L.hPa, top: L.hPa === null ? 'Surface' : String(L.hPa), unit: L.hPa === null ? '10 m' : 'hPa', metres: m, feet: ft,
    m: big ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`, ft: `${ft.toLocaleString('en-US')} ft`, role: L.role};
}
export const levelFile = level => `levels/p${level}.json`;
export const levelFields = level => ['u', 'v', 't', 'gh'].map(p => p + level);
export const levelReady = (sampler, level) => level === 'sfc' || levelFields(level).every(k => sampler.has(k));
// A per-level file belongs to the loaded dataset when it is the same run on the same grid and the same steps. Returns {level, fields} (Float32Arrays, NaN where
// missing, named u850, v850, t850, gh850) or null.
export function unpackLevelFile(d, data) {
  try {
    if (d?.schema_version !== 1 || d.kind !== 'pressure_level' || !PRESSURE_LEVELS.includes(d.level) || d.run !== data.run) return null;
    const g = d.grid, h = data.grid, n = h.columns * h.rows;
    if (g.columns !== h.columns || g.rows !== h.rows || g.west !== h.west || g.south !== h.south || g.spacing !== h.spacing) return null;
    if (d.hours.length !== data.hours.length || !d.hours.every((x, i) => x === data.hours[i])) return null;
    const fields = {};
    for (const p of ['u', 'v', 't', 'gh']) {
      if (!(d.scales?.[p] > 0) || !Array.isArray(d[p]) || d[p].length !== data.hours.length || !d[p].every(s => typeof s === 'string' && s.length === packedLength(n))) return null;
      fields[p + d.level] = d[p].map(s => decodePacked(s, d.scales[p]));
    }
    return {level: d.level, fields};
  } catch { return null; }
}
// Adds a loaded level to the dataset (a field that is already there, such as the 850 and 700 hPa winds of the main grid, is kept).
export function mergeLevel(data, fields) { for (const [k, v] of Object.entries(fields)) if (!Array.isArray(data[k])) data[k] = v; return data; }
// A level is underground where the 1 km terrain is higher than the level (less a margin): no wind there, so the trails are not drawn through mountains.
// A missing level height counts as underground (the model had nothing there).
export const UNDERGROUND_MARGIN_M = 50;
export const levelUnderground = (groundM, levelM, margin = UNDERGROUND_MARGIN_M) => !(levelM - margin > groundM);
// Temperature at a level has its own colour range (the surface ramp would be blue everywhere above 700 hPa): the same ramp stretched over the level's usual range.
export const LEVEL_TEMP_RANGE = {1000: [-10, 45], 925: [-10, 40], 850: [-15, 35], 700: [-25, 20], 600: [-35, 10], 500: [-45, 0], 400: [-55, -10], 300: [-65, -20], 250: [-70, -30]};
export const temperatureRange = level => level === 'sfc' || !LEVEL_TEMP_RANGE[level] ? [-30, 50] : LEVEL_TEMP_RANGE[level];
export function levelTemperatureColour(t, level) { const [lo, hi] = temperatureRange(level); return temperatureColour(-30 + (t - lo) / (hi - lo) * 80); }
export const temperatureTicksFor = level => { const [lo, hi] = temperatureRange(level); return [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(lo + f * (hi - lo))); };

// ---- location forecast table (the drawer) ----
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const LOCAL_UTC_OFFSET_H = 5;                       // Pakistan Standard Time
export const CLOUD_OKTAS = {clear: 25, scattered: 56, broken: 87};   // cloud cover (%) at the edges of the WMO oktas classes 0-2, 3-4, 5-7 and 8
export const RAIN_RATE_MM_H = {drizzle: 0.1, rain: 1, heavy: 4};     // screening conventions for the icon, mm per hour (a 3-hour mean)
// Sun height above the horizon in degrees (NOAA's general solar position formulas, no refraction). Positive in daylight (the horizon is at -0.83).
export function sunElevationDeg(lat, lon, tMs) {
  const d = new Date(tMs), doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const g = 2 * Math.PI / 365 * (doy - 1 + (d.getUTCHours() - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60, tst = (((minutes + eq + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * Math.PI / 180, la = lat * Math.PI / 180;
  const cosz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosz))) * 180 / Math.PI;
}
// Icon key from the weather of a period: precip in mm per hour (rate), snow in cm per hour, cloud in %, CAPE in J/kg. Snow when at least half the water falls as snow;
// thunder is rain in the hours of the convective rule of splitPrecip (CAPE and rain); otherwise rain by rate; dry periods by cloud cover (oktas classes).
export function weatherIcon({precip, snow, cloud, cape}, day) {
  if (finite(precip) && precip >= RAIN_RATE_MM_H.drizzle) {
    if ((snow || 0) * SNOW_WATER_MM_PER_CM / precip >= 0.5) return 'snow';
    if (splitPrecip(precip, cape).convective > 0) return 'thunder';
    return precip >= RAIN_RATE_MM_H.heavy ? 'rain-heavy' : precip >= RAIN_RATE_MM_H.rain ? 'rain' : 'rain-light';
  }
  const c = finite(cloud) ? cloud : 0;
  if (c >= CLOUD_OKTAS.broken) return 'overcast';
  if (c >= CLOUD_OKTAS.scattered) return 'cloudy';
  if (c >= CLOUD_OKTAS.clear) return day ? 'partly-day' : 'partly-night';
  return day ? 'clear-day' : 'clear-night';
}
export const windSpeedUnit = {kmh: {label: 'km/h', factor: 3.6}, kt: {label: 'kt', factor: 1.943844}};
// Wind strength class by speed in km/h (Beaufort 6 starts at 39, 8 at 62, 10 at 89): 0 light, 1 moderate, 2 strong, 3 gale, 4 storm. Used to colour the arrows.
export const windClass = kmh => !(kmh >= 12) ? 0 : kmh < 39 ? 1 : kmh < 62 ? 2 : kmh < 89 ? 3 : 4;
// Hourly point rows (from pointRows, with the 1 km values when loaded) to 3-hourly columns at local clock hours 00, 03, ... 21: the period starting at the column time
// (rain is the sum of its three hours, in mm), temperature and wind at its start. Days group the columns; an incomplete last period is left out.
export function forecastTable(rows, {lat = 30, lon = 70, stepH = 3, offsetH = LOCAL_UTC_OFFSET_H, speedUnit = 'kmh'} = {}) {
  const unit = windSpeedUnit[speedUnit] || windSpeedUnit.kmh, columns = [], days = [], num = v => finite(v) ? v : null;
  for (let i = 0; i + stepH <= rows.length; i++) {
    const t = rows[i].t, local = new Date(t + offsetH * 3600000);
    if (local.getUTCHours() % stepH !== 0 || local.getUTCMinutes() !== 0) continue;
    const win = rows.slice(i, i + stepH), vals = f => win.map(f).filter(finite), sum = a => a.reduce((s, v) => s + v, 0), mean = a => a.length ? sum(a) / a.length : null;
    const rain = vals(r => r.precip), snow = vals(r => r.snow), gusts = vals(r => r.gust), caps = vals(r => r.cape), clouds = vals(r => r.cloud);
    const rate = rain.length ? mean(rain) : null, speed = rows[i].wind, kmh = finite(speed) ? speed * 3.6 : null, gustKmh = gusts.length ? Math.max(...gusts) * 3.6 : null;
    const day = sunElevationDeg(lat, lon, t + stepH * 1800000) > -0.833;
    const dayKey = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
    columns.push({t, dayKey, hour: `${String(local.getUTCHours()).padStart(2, '0')}:00`, day,
      icon: weatherIcon({precip: rate, snow: snow.length ? mean(snow) : null, cloud: clouds.length ? mean(clouds) : null, cape: caps.length ? Math.max(...caps) : null}, day),
      temp: num(rows[i].temp), rain: rain.length === stepH ? +sum(rain).toFixed(1) : null, wind: finite(speed) ? Math.round(speed * unit.factor) : null,
      dir: num(rows[i].dir), arrow: finite(rows[i].dir) ? (rows[i].dir + 180) % 360 : null, gust: gustKmh === null ? null : Math.round(gustKmh / 3.6 * unit.factor),
      strength: windClass(gustKmh ?? kmh), hasGust: gustKmh !== null, km1: win.every(r => r.km1 === true)});
    const last = days.at(-1);
    if (last?.key === dayKey) last.span++; else days.push({key: dayKey, label: `${DAY_NAMES[local.getUTCDay()]} ${local.getUTCDate()} ${MONTH_NAMES[local.getUTCMonth()]}`, span: 1});
  }
  return {columns, days, speedUnit: unit.label};
}

// ---- point forecast from the loaded grid ----
// Hourly rows from the grid, so a click needs no request. The 0.1 degree grid is 3-hourly: precipitation is a 3-hour mean rate and everything is
// interpolated linearly in time and space by the sampler. Missing values stay null.
export function pointRows(sampler, lon, lat) {
  const t0 = Date.parse(sampler.d.times[0]), rows = [];
  for (let h = 0; h <= sampler.lastHour; h++) {
    const w = sampler.wind(h, lon, lat), p = sampler.precip(h, lon, lat);
    rows.push({t: t0 + h * 3600000, temp: sampler.has('t2m') ? sampler.sample('t2m', h, lon, lat) : null, precip: p ? p.total : null,
      snow: p ? p.snowWater / SNOW_WATER_MM_PER_CM : null, wind: w ? w.speed : null,
      dir: w ? (Math.atan2(-w.u, -w.v) * 180 / Math.PI + 360) % 360 : null,                       // the direction the wind comes FROM, degrees
      gust: sampler.has('gust') ? sampler.sample('gust', h, lon, lat) : null,                    // null past 90 h, where ECMWF publishes no gust
      cape: sampler.has('cape') ? sampler.sample('cape', h, lon, lat) : null,
      cloud: sampler.sample('cloud', h, lon, lat)});
  }
  return rows;
}

// ---- 1 km downscaled grids (downscaler/2_apply_1km_forecast.py, public/terrain-data/grid-1km/manifest.json) ----
// RGB PNGs, 24 bits per pixel. Temperature + rain: temp code (11 bits, 0.1 degC from -60, 2047 = none) << 13 | rain code (13 bits, 0.1 mm/h).
// Wind: u code << 12 | v code (12 bits each, (code - 2048) / 50 m/s, 4095 = none).
export const ONE_KM = {tempOffset: 60, tempScale: 10, tempMissing: 2047, rainScale: 10, windScale: 50, windZero: 2048, windMissing: 4095};
export function decodeTempRain(r, g, b) {
  const v = r * 65536 + g * 256 + b, tc = v >> 13;
  return {temp: tc === ONE_KM.tempMissing ? null : tc / ONE_KM.tempScale - ONE_KM.tempOffset, rain: (v & 8191) / ONE_KM.rainScale};
}
export function decodeWind(r, g, b) {
  const v = r * 65536 + g * 256 + b, uc = v >> 12, vc = v & 4095;
  return uc === ONE_KM.windMissing || vc === ONE_KM.windMissing ? null : {u: (uc - ONE_KM.windZero) / ONE_KM.windScale, v: (vc - ONE_KM.windZero) / ONE_KM.windScale};
}
// The 1 km set is used only with the 0.1 degree grid of the same ECMWF run, and covers the first steps of it (the grid runs to 144 h, the 1 km set to 72 h):
// its steps must be the grid's first steps, hour for hour.
export function validManifest(m, run, steps, hours = null) {
  if (!m || m.schema !== 1 || m.run !== run || !Array.isArray(m.steps) || m.steps.length < 2 || m.steps.length > steps) return false;
  if (hours && !(Array.isArray(m.hours) && m.hours.length === m.steps.length && m.hours.every((h, i) => h === hours[i]))) return false;
  return m.grid?.row0 === 'north' && Array.isArray(m.tiles?.available);
}
// Rain / snow phase of the 1 km set (downscaler/phase.py, Ding et al. 2014): the red byte is round(255 x the snow share of the water): 255 snow, 128 sleet
// (half snow, half rain: a convention of ours), 0 rain. Manifests written before the split have no `phase` block.
export const decodePhase = r => r / 255;
export const hasPhase = m => !!(m?.phase && m.steps?.length && m.steps.every(s => s.phase) && m.tiles?.phase_path);
// The 1 x 1 degree tile holding a point and the point's cell in it (row 0 north), or null.
export function tileOf(m, lon, lat) {
  const g = m.grid;
  if (!(lon >= g.west && lon < g.east && lat >= g.south && lat < g.north)) return null;
  const la = Math.floor(lat), lo = Math.floor(lon), key = `${la}_${lo}`, n = m.tiles.cells;
  if (!m.tiles.available.includes(key)) return null;
  return {key, x: Math.min(n - 1, Math.floor((lon - lo) / g.res)), y: Math.min(n - 1, Math.floor((la + 1 - lat) / g.res))};
}
// Temperature and rain of one cell for every step, from a tile's RGBA bytes (step k = rows k * cells .. k * cells + cells - 1).
export function tileSeries(rgba, cells, steps, x, y) {
  const temp = [], rain = [];
  for (let k = 0; k < steps; k++) {
    const o = ((k * cells + y) * cells + x) * 4, d = decodeTempRain(rgba[o], rgba[o + 1], rgba[o + 2]);
    temp.push(d.temp); rain.push(d.rain);
  }
  return {temp, rain};
}
// Snow share of one cell for every step, from a phase tile's RGBA bytes (same layout as tileSeries).
export function phaseSeries(rgba, cells, steps, x, y) {
  const p = [];
  for (let k = 0; k < steps; k++) p.push(decodePhase(rgba[((k * cells + y) * cells + x) * 4]));
  return p;
}
// Hourly point rows (pointRows) with the 1 km temperature and rain in place of the 9 km values, linear between the 3-hourly steps.
// With the phase series (snow share per step, interpolated linearly in time) the snow water is the new total times the share and the rest is rain; without it snow
// stays ECMWF's, capped by the new total.
export function with1km(rows, stepHours, series, t0, phase = null) {
  const lerp = (a, b, w) => a === null || b === null ? null : a + (b - a) * w;
  return rows.map(r => {
    const hr = (r.t - t0) / 3600000;
    if (hr < -1e-9 || hr > stepHours.at(-1) + 1e-9) return {...r, km1: false};         // beyond the 1 km steps: the 9 km values stay
    const h = Math.min(Math.max(hr, 0), stepHours.at(-1));
    let i = 0; while (i < stepHours.length - 2 && h >= stepHours[i + 1]) i++;
    const w = (h - stepHours[i]) / (stepHours[i + 1] - stepHours[i]);
    const temp = lerp(series.temp[i], series.temp[i + 1], w), precip = lerp(series.rain[i], series.rain[i + 1], w);
    const share = phase ? lerp(phase[i], phase[i + 1], w) : null;
    const snowWater = share !== null ? (precip ?? 0) * share : Math.min((r.snow ?? 0) * SNOW_WATER_MM_PER_CM, precip ?? 0);
    return {...r, temp: temp ?? r.temp, precip: precip ?? r.precip, snow: precip === null ? r.snow : snowWater / SNOW_WATER_MM_PER_CM, km1: temp !== null, phase1km: share !== null};
  });
}
// Look-up tables for the GPU drape, 256 RGBA texels each: temperature over -30..50 degC, rain over 0..50 mm/h on log(1 + mm).
export const LUT = {tempMin: -30, tempMax: 50, rainMax: 50};
export function temperatureLut() {
  const d = new Uint8Array(256 * 4);
  for (let k = 0; k < 256; k++) d.set(temperatureColour(LUT.tempMin + k / 255 * (LUT.tempMax - LUT.tempMin)), k * 4);
  return d;
}
export function snowLut() {
  const d = new Uint8Array(256 * 4);
  for (let k = 0; k < 256; k++) d.set(snowColour(Math.exp(k / 255 * Math.log(1 + LUT.rainMax)) - 1), k * 4);
  return d;
}
export function rainLut() {
  const d = new Uint8Array(256 * 4);
  for (let k = 0; k < 256; k++) d.set(rainColour(Math.exp(k / 255 * Math.log(1 + LUT.rainMax)) - 1), k * 4);
  return d;
}

// ---- labels (GeoNames, tiered by scripts/sync-terrain-labels.py) ----
// Tier t is shown while the camera is closer than maxDistKm[t]. Labels are bucketed in 1 degree cells so a frame only looks at the ones near the view.
export const maxTierFor = (distKm, maxDistKm) => { let t = -1; for (let i = 0; i < maxDistKm.length; i++) if (distKm <= maxDistKm[i]) t = i; return t; };
export function labelIndex(labels) {
  const cells = new Map();
  labels.forEach((l, i) => { const k = Math.floor(l[1]) + ',' + Math.floor(l[2]); (cells.get(k) || cells.set(k, []).get(k)).push(i); });
  return cells;
}
// Indices of labels within about radiusKm of a point whose tier is at most maxTier, most important (lowest tier, then file order) first.
export function labelsNear(labels, cells, lon, lat, radiusKm, maxTier) {
  if (maxTier < 0) return [];
  const dLat = radiusKm / 111.19, dLon = radiusKm / (111.19 * Math.max(0.2, Math.cos(lat * Math.PI / 180))), out = [];
  for (let la = Math.floor(lat - dLat); la <= Math.floor(lat + dLat); la++) for (let lo = Math.floor(lon - dLon); lo <= Math.floor(lon + dLon); lo++)
    for (const i of cells.get(la + ',' + lo) || []) if (labels[i][3] <= maxTier) out.push(i);
  return out.sort((a, b) => labels[a][3] - labels[b][3] || a - b);
}

// ---- terrain detail levels ----
// Three nested patches of 5 x 5 tiles around the view (tile zoom 9, 10, 11: about 250, 130 and 65 m per pixel) over the 1.2 km base. Each patch
// blends into the level below it over a border of FADE_FRACTION of its width: the colours fade in (alpha) while the outer part of the border
// follows the lower level's heights exactly, then the heights move to the patch's own, so there is neither a crack nor a sharpness seam.
export const LOD_LEVELS = [{z: 9, maxDist: 900}, {z: 10, maxDist: 320}, {z: 11, maxDist: 110}];
export const LOD_TILES = 5, FADE_FRACTION = 0.08;
const smooth = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
// edge: distance from the patch edge as a share of the patch width (0 at the edge, 0.5 at the centre).
export const lodAlpha = edge => smooth(edge / FADE_FRACTION);                       // 0 at the edge, 1 once a full border inside
export const lodHeightWeight = edge => smooth((edge - FADE_FRACTION) / FADE_FRACTION);   // 0 over the outer border, 1 after the next one
export const lodHole = FADE_FRACTION;                                               // the level below is cut away inside this inset
export function blendHeight(lower, own, edge) { const w = lodHeightWeight(edge); return lower * (1 - w) + own * w; }
// Which levels the camera distance asks for, lowest first. A level is requested once the camera is within LOD_ASK times its distance, so it is on screen by the
// time the camera arrives; it is dropped again beyond LOD_KEEP times that distance (app.js), so there is no flicker at the boundary.
export const LOD_ASK = 1.3;
export const lodWanted = distKm => LOD_LEVELS.filter(l => distKm <= l.maxDist * LOD_ASK).map(l => l.z);

// ---- quality governor ----
// Slow frames (a smoothed frame time over 28 ms) step the quality down, one notch at most every 2.5 s; fast frames (under 19 ms for 2.5 s) step it back up. The fast limit
// must sit above one frame of a 60 Hz display (16.7 ms), or a screen that keeps up could never recover what it gave up. A notch lowers the pixel ratio first (the terrain
// fragment shader is the biggest cost when the view is tilted), never below 0.75, then the number of wind trails drawn.
export const QUALITY_STEPS = [{dpr: 1, trails: 1}, {dpr: 0.85, trails: 1}, {dpr: 0.75, trails: 1}, {dpr: 0.75, trails: 0.7}, {dpr: 0.75, trails: 0.5}, {dpr: 0.75, trails: 0.35}];
export const QUALITY = {slowMs: 28, fastMs: 19, holdMs: 2500, recoverMs: 2500};
export const newQuality = () => ({level: 0, ema: 16, changed: 0, fastSince: 0});
// Updates q in place with one frame (now and frameMs in milliseconds); returns true when the level changed.
export function qualityStep(q, now, frameMs) {
  q.ema += (Math.min(frameMs, 60) - q.ema) * 0.08;      // one long frame (a level reaching the GPU) counts as at most 60 ms: a hitch must not cost quality
  if (now - q.changed < QUALITY.holdMs) return false;
  let next = q.level;
  if (q.ema > QUALITY.slowMs) { if (next < QUALITY_STEPS.length - 1) next++; q.fastSince = 0; }
  else if (q.ema < QUALITY.fastMs) { if (!q.fastSince) q.fastSince = now; if (now - q.fastSince > QUALITY.recoverMs && next > 0) next--; }
  else q.fastSince = 0;
  if (next === q.level) return false;
  q.level = next; q.changed = now; q.fastSince = 0; return true;
}

// Back to the top level (called when a detail level has finished loading: the frames of the load itself must not cost quality afterwards). The smoothed frame time
// restarts from a neutral 16 ms and the hold time starts now, so the governor judges only what comes next. Returns true when the level changed.
export function resetQuality(q, now) {
  const was = q.level;
  q.level = 0; q.ema = 16; q.changed = now; q.fastSince = 0;
  return was !== 0;
}

// ---- terrain normal maps ----
// The mesh has a vertex every `step` pixels of the height data (4 on the base, 2 on a detail level), so the light, which reads the interpolated vertex normals, shows the relief
// at that resolution only. A tangent-space normal map from the full-resolution heights puts the rest back. three.js builds its tangent frame around the INTERPOLATED VERTEX
// NORMAL, so a plain "slope of the heights" map would count the slope the mesh already has twice. Each texel therefore stores the full-resolution normal expressed in the frame
// of the mesh's own normal at that texel: on a smooth slope the two agree and the texel is flat (128, 128, 255), and only the detail the mesh cannot show is left.
//
// Geometry as in gridGeometryJob (app.js): x east and z south in km (pixelKm per height pixel), y = height / 1000 (negative heights are 0), the mesh is scaled in y by the
// exaggeration `exag`. The vertex normal there is (-dy/dx, 1, -dy/dz) on the un-exaggerated surface; the world normal of the exaggerated mesh is (nx, ny / exag, nz).
// The frame is the one three.js derives from the texture coordinates: T along +u (east), B along +v (north), both projected onto the plane at right angles to the normal and
// scaled together by 1 / sqrt(max(|T|^2, |B|^2)); the shader computes normalize(T mx + B my + N mz) from the texel (mx, my, mz). Texel rows are stored bottom row first
// (v = 0 at row 0), as a DataTexture is uploaded without flipping. out: Uint8Array w * h * 4. Yields every ~20,000 texels so the caller can slice the work.
export function* normalMapJob(hts, w, h, pixelKm, step, exag, out) {
  const cols = Math.floor((w - 1) / step) + 1, rows = Math.floor((h - 1) / step) + 1;
  const hk = (x, y) => Math.max(0, hts[y * w + x]) / 1000;
  const NX = new Float32Array(cols * rows), NY = new Float32Array(cols * rows), NZ = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const py = Math.min(j * step, h - 1), pn = Math.min(Math.max(j - 1, 0) * step, h - 1), ps = Math.min(Math.min(j + 1, rows - 1) * step, h - 1);
    for (let i = 0; i < cols; i++) {
      const px = Math.min(i * step, w - 1), pw = Math.min(Math.max(i - 1, 0) * step, w - 1), pe = Math.min(Math.min(i + 1, cols - 1) * step, w - 1), k = j * cols + i;
      const dx = (pe - pw) * pixelKm, dz = (ps - pn) * pixelKm;
      const nx = dx > 0 ? -(hk(pe, py) - hk(pw, py)) / dx : 0, nz = dz > 0 ? -(hk(px, ps) - hk(px, pn)) / dz : 0, inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      NX[k] = nx * inv; NY[k] = inv; NZ[k] = nz * inv;
    }
  }
  const rowsPerYield = Math.max(1, Math.round(20000 / w));
  for (let py = 0; py < h; py++) {
    const y0 = Math.max(py - 1, 0), y1 = Math.min(py + 1, h - 1), fy = Math.min(py / step, rows - 1), j0 = Math.min(Math.floor(fy), Math.max(rows - 2, 0)), ty = Math.min(1, fy - j0), j1 = Math.min(j0 + 1, rows - 1);
    const rowOut = (h - 1 - py) * w;
    for (let px = 0; px < w; px++) {
      // the full-resolution normal of the exaggerated surface
      const x0 = Math.max(px - 1, 0), x1 = Math.min(px + 1, w - 1);
      const gx = (hk(x1, py) - hk(x0, py)) / ((x1 - x0) * pixelKm), gz = (hk(px, y1) - hk(px, y0)) / ((y1 - y0) * pixelKm);
      const fl = 1 / Math.sqrt(exag * exag * (gx * gx + gz * gz) + 1), Fx = -exag * gx * fl, Fy = fl, Fz = -exag * gz * fl;
      // the mesh normal at this texel: the vertex normals of the surrounding lattice, interpolated, then taken to the exaggerated mesh
      const fx = Math.min(px / step, cols - 1), i0 = Math.min(Math.floor(fx), Math.max(cols - 2, 0)), tx = Math.min(1, fx - i0), i1 = Math.min(i0 + 1, cols - 1);
      const a = j0 * cols + i0, b = j0 * cols + i1, c = j1 * cols + i0, d = j1 * cols + i1;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      let Nx = NX[a] * w00 + NX[b] * w10 + NX[c] * w01 + NX[d] * w11, Ny = (NY[a] * w00 + NY[b] * w10 + NY[c] * w01 + NY[d] * w11) / exag, Nz = NZ[a] * w00 + NZ[b] * w10 + NZ[c] * w01 + NZ[d] * w11;
      const nl = 1 / Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz); Nx *= nl; Ny *= nl; Nz *= nl;
      // the tangent frame around that normal (see above) and the texel that makes normalize(T mx + B my + N mz) equal the full-resolution normal
      const tt = 1 - Nx * Nx, bb = 1 - Nz * Nz, top = Math.max(tt, bb);
      let mx = 0, my = 0, mz = 1;
      if (top > 1e-9) {
        const s2 = 1 / top, G11 = tt * s2, G22 = bb * s2, G12 = Nx * Nz * s2, det = G11 * G22 - G12 * G12;
        const cN = Fx * Nx + Fy * Ny + Fz * Nz, sc = Math.sqrt(s2), r1 = sc * (Fx - Nx * cN), r2 = sc * (-Fz + Nz * cN);
        if (det > 1e-9 && cN > 0) { mx = (G22 * r1 - G12 * r2) / det; my = (G11 * r2 - G12 * r1) / det; mz = cN; }
      }
      const il = 1 / Math.sqrt(mx * mx + my * my + mz * mz), o = (rowOut + px) * 4;
      out[o] = Math.round(127.5 + 127.5 * mx * il); out[o + 1] = Math.round(127.5 + 127.5 * my * il); out[o + 2] = Math.round(127.5 + 127.5 * mz * il); out[o + 3] = 255;
    }
    if (py % rowsPerYield === rowsPerYield - 1) yield;
  }
}

// ---- wind particles ----
// The simulation itself runs on the GPU (app.js); these are its rules, written once here so they can be tested with numbers. The shader uses the
// same constants and the same formulas (advect, withMinimumSpeed, respawnBox, outsideView).
export const WIND_SIM = {
  life: [50, 150],          // lifespan of a particle in frames (at 60 per second); a new random lifespan at every respawn
  simSeconds: 12000,        // seconds of wind shown per real second at 1x when the view is refDistKm away: about 11 pixels a second for every m/s of wind on a 1000 pixel high window
  refDistKm: 1500,
  minScale: 0.02, maxScale: 3,
  minSpeed: 0.25,           // m/s: slower than this a particle drifts at exactly this speed in a steady direction (withMinimumSpeed), so it never sits still or clumps
  calmBlend: [0.02, 0.2],   // m/s: the direction goes from the particle's own heading (still air) to the wind's own (this fast) smoothly, so it never jumps
  trailPoints: 14,          // a trail is the live head plus 13 recorded positions (a ring buffer on the GPU)
  slotSeconds: 6 / 60,      // at 1x a position is recorded this often (1.3 s for 13 segments); at other speeds as often as the same amount of WIND time passes
  defaultCount: 16000,      // trails drawn by default (up to maxParticles)
  trailSegments: {min: 4, max: 13, default: 13},   // segments drawn per trail: the Trail length control (13 is the whole ring buffer)
  outsideFactor: 1.6,       // a particle further than this many view radii from the view centre is recycled
  maxParticles: 24576,      // 256 x 96 state texture
};
// The wind is drawn at a speed that looks the same on screen at every zoom: one pixel is distKm times smaller when zoomed in, so time runs
// proportionally slower. At refDistKm the scale is 1.
export const zoomScale = distKm => Math.min(WIND_SIM.maxScale, Math.max(WIND_SIM.minScale, distKm / WIND_SIM.refDistKm));
// Kilometres on the ground that one pixel of the 3D view covers at the given camera distance (40 degree field of view, 1000 pixel high window).
export const kmPerPixel = distKm => distKm * 2 * Math.tan(20 * Math.PI / 180) / 1000;
// Animation speed steps of the Speed control.
export const SPEED_STEPS = [0.5, 1, 2, 4, 6];
export const speedFromStep = i => SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, Math.round(i)))];
// Positions are recorded every slotSeconds of 1x time, i.e. as often as the same amount of wind time passes: a trail then covers the same stretch of
// wind (the same length on screen) at every speed, instead of growing six times longer at 6x. Time is real seconds of the clamped frame time.
export const slotInterval = speed => WIND_SIM.slotSeconds / Math.max(0.01, speed);
// Trail length control: point j of a trail drawn with segs segments. Points beyond segs are not drawn (they collapse onto the last visible point, so
// nothing is reallocated) and the fade and the taper run over the visible length: t = 0 at the head, 1 at the last visible point.
export function trailPoint(j, segs) {
  const n = Math.min(WIND_SIM.trailSegments.max, Math.max(WIND_SIM.trailSegments.min, Math.round(segs)));
  return {index: Math.min(j, n), visible: j <= n, t: Math.min(j, n) / n};
}
export const trailLabel = n => `${n} segments · ${n <= 6 ? 'short' : n <= 9 ? 'medium' : 'long'}`;
// Ring buffer of recorded positions: slot of the k-th most recent position (k = 1 is the newest) when the newest was written to slot head.
export const ringSlot = (head, k, n = WIND_SIM.trailPoints - 1) => ((head - (k - 1)) % n + n) % n;
// A recorded position belongs to the particle's current life only if it carries the same lifespan tag and was recorded at an age not after now.
export const sameLife = (slotLife, slotAge, life, age) => slotLife === life && slotAge <= age + 1e-3;
// Along a trail, t = 0 at the head and 1 at the tail: bright head fading smoothly to nothing, and a ribbon that narrows towards the tail. Faster wind is
// a little wider and more opaque. Pixels are CSS pixels (times the device pixel ratio in the shader).
export const trailAlpha = (t, speed) => 0.95 * Math.pow(1 - Math.min(1, Math.max(0, t)), 1.4) * (0.45 + 0.55 * Math.min(1, speed / 8));
export const trailWidthPx = (t, speed) => (1.9 + 1.7 * Math.min(1, speed / 12)) * (1 - 0.5 * Math.min(1, Math.max(0, t)));
export const lifespan = r => WIND_SIM.life[0] + Math.min(1, Math.max(0, r)) * (WIND_SIM.life[1] - WIND_SIM.life[0]);
// Move a point by a wind (u east, v north, m/s) for some seconds. Writes into out so the caller can avoid allocating.
export function advect(lon, lat, u, v, seconds, out = [0, 0]) {
  out[0] = lon + u * seconds / (111320 * Math.cos(lat * Math.PI / 180)); out[1] = lat + v * seconds / 111320; return out;
}
const smoothstep01 = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// Below minSpeed the wind is replaced by a speed of exactly minSpeed. The direction is the particle's own steady heading where the air is still and the wind's
// own where it has one, blended smoothly in between (calmBlend, along the shortest arc), so a calm or converging spot never pins particles and never makes them scribble. heading is an
// angle in radians that stays the same for the whole life of the particle (the shader derives it from the particle and its lifespan). The old rule drew a new
// random angle every frame: in calm air that is a random walk, which the trail recorded as a tangle of loops. At or above minSpeed the wind is returned unchanged.
export function withMinimumSpeed(u, v, heading, min = WIND_SIM.minSpeed, out = [0, 0]) {
  const sp = Math.hypot(u, v);
  if (sp >= min) { out[0] = u; out[1] = v; return out; }
  // blend the ANGLES along the shortest arc: mixing two nearly opposite direction vectors passes through zero and the direction would flip sharply
  const k = smoothstep01(WIND_SIM.calmBlend[0], WIND_SIM.calmBlend[1], sp);
  let angle = heading;
  if (sp > 1e-6) { const d = Math.atan2(v, u) - heading; angle = heading + Math.atan2(Math.sin(d), Math.cos(d)) * k; }
  out[0] = Math.cos(angle) * min; out[1] = Math.sin(angle) * min; return out;
}
// Where new particles are born: the part of the data area that is on screen (a box around the view centre), so a zoomed-in view is as dense as the
// whole-country view; the box is clipped to the data area (the Pakistan bounding box) and is the whole area when the view is outside it.
export function respawnBox(lon, lat, radiusKm, grid = GRID, out = {}) {
  const dLat = radiusKm / 111.19, dLon = radiusKm / (111.19 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const west = Math.max(grid.west, lon - dLon), east = Math.min(grid.east, lon + dLon), south = Math.max(grid.south, lat - dLat), north = Math.min(grid.north, lat + dLat);
  if (!(east > west && north > south)) { out.west = grid.west; out.east = grid.east; out.south = grid.south; out.north = grid.north; return out; }
  out.west = west; out.east = east; out.south = south; out.north = north; return out;
}
export const outsideBox = (lon, lat, grid = GRID) => lon < grid.west || lon > grid.east || lat < grid.south || lat > grid.north;
export function outsideView(lon, lat, cLon, cLat, radiusKm) {
  const dx = (lon - cLon) * 111.19 * Math.cos(cLat * Math.PI / 180), dy = (lat - cLat) * 111.19;
  return Math.hypot(dx, dy) > radiusKm * WIND_SIM.outsideFactor;
}
