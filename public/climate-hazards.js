// Climate hazard screening for one location, from daily ERA5 / station / ECMWF values.
// Heat-wave, warm-night and cold-wave criteria follow the India Meteorological Department (IMD)
// definitions (mausam.imd.gov.in/pdfs/heatcolduser/Definition.pdf); rainfall classes follow the IMD
// 24-hour scale; frost, tropical-night and dry-spell indices follow ETCCDI. These are Indian
// criteria applied as a screen, not Pakistan Meteorological Department warnings. IMD declares an
// event only when at least two stations in a sub-division meet it for two consecutive days; one
// location cannot test the station rule, so only the two-day persistence is applied here.
const finite = v => typeof v === 'number' && Number.isFinite(v);

export const IMD = {
  heat: {
    floor: {plains: 40, coastal: 37, hills: 30},            // Tmax must reach this before a departure counts
    departure: {wave: 4.5, severe: 6.5},                    // °C above the daily normal
    absolute: {wave: 45, severe: 47},                       // plains only, when the departure rule is not met
  },
  warmNight: {departure: {warm: 4.5, veryWarm: 6.5}},       // Tmin above normal, only on a heat-wave-level Tmax
  cold: {
    ceiling: {plains: 10, coastal: 10, hills: 0},           // Tmin must be at or below this
    departure: {wave: -4.5, severe: -6.5},                  // °C below the daily normal
    absolute: {wave: 4, severe: 2},                         // plains only
  },
  persistenceDays: 2,
  rain: [[204.5, 'Extremely heavy', 6], [115.6, 'Very heavy', 5], [64.5, 'Heavy', 4], [15.6, 'Moderate', 3], [2.5, 'Light', 2], [0.1, 'Very light', 1]],
};
// ETCCDI index definitions.
export const ETCCDI = {frostBelow: 0, tropicalNightAbove: 20, hotDayAtLeast: 40, wetDayMm: 1, r10: 10, r20: 20};
export const BASE_PERIOD = {from: 1991, to: 2020};

export const TERRAINS = ['plains', 'hills', 'coastal'];
// IMD gives no elevation limit for "hilly regions"; 1000 m is this app's assumption and is shown as one.
export const HILLS_FROM_ELEVATION_M = 1000;
export const autoTerrain = elevation => finite(elevation) && elevation >= HILLS_FROM_ELEVATION_M ? 'hills' : 'plains';

// ---- calendar helpers (dates are 'YYYY-MM-DD' strings in Pakistan local time) ----
const CUMULATIVE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]; // leap-year layout so 29 Feb has a slot
export const slotOf = date => CUMULATIVE[Number(date.slice(5, 7)) - 1] + Number(date.slice(8, 10)) - 1;
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const daysInYear = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;

// ---- daily normals: calendar-day mean over the base period, smoothed around the year ----
export function buildNormals(daily, {from = BASE_PERIOD.from, to = BASE_PERIOD.to, window = 5} = {}) {
  const sums = {tmax: Array(366).fill(0), tmin: Array(366).fill(0), tmean: Array(366).fill(0)};
  const counts = {tmax: Array(366).fill(0), tmin: Array(366).fill(0), tmean: Array(366).fill(0)};
  (daily.time || []).forEach((date, i) => {
    const year = Number(date.slice(0, 4));
    if (year < from || year > to) return;
    const slot = slotOf(date);
    for (const key of ['tmax', 'tmin', 'tmean']) if (finite(daily[key]?.[i])) { sums[key][slot] += daily[key][i]; counts[key][slot]++; }
  });
  const out = {from, to};
  for (const key of ['tmax', 'tmin', 'tmean']) {
    const raw = sums[key].map((s, i) => counts[key][i] ? {s, n: counts[key][i]} : null);
    out[key] = raw.map((_, i) => {
      let s = 0, n = 0;
      for (let d = -window; d <= window; d++) { const r = raw[(i + d + 366) % 366]; if (r) { s += r.s; n += r.n; } }
      return n ? s / n : null;
    });
  }
  const sample = counts.tmax.reduce((a, b) => Math.max(a, b), 0);
  out.years = sample;
  return out;
}
export const normalFor = (normals, date, key) => normals?.[key]?.[slotOf(date)] ?? null;

// ---- single-day criteria ----
export function heatLevel({tmax, normMax, terrain = 'plains'}) {
  if (!finite(tmax)) return {level: null, basis: null, departure: null};
  const departure = finite(normMax) ? tmax - normMax : null;
  let level = 0, basis = null;
  if (departure !== null && tmax >= IMD.heat.floor[terrain]) {
    if (departure >= IMD.heat.departure.severe) { level = 2; basis = 'departure'; }
    else if (departure >= IMD.heat.departure.wave) { level = 1; basis = 'departure'; }
  }
  if (terrain === 'plains') {
    const absolute = tmax >= IMD.heat.absolute.severe ? 2 : tmax >= IMD.heat.absolute.wave ? 1 : 0;
    if (absolute > level) { level = absolute; basis = 'absolute'; }
  }
  return {level, basis, departure};
}
export function warmNightLevel({tmax, tmin, normMin, terrain = 'plains'}) {
  if (!finite(tmax) || !finite(tmin) || !finite(normMin)) return {level: null, departure: null};
  const departure = tmin - normMin;
  if (tmax < IMD.heat.floor[terrain]) return {level: 0, departure};
  return {level: departure >= IMD.warmNight.departure.veryWarm ? 2 : departure >= IMD.warmNight.departure.warm ? 1 : 0, departure};
}
export function coldLevel({tmin, normMin, terrain = 'plains'}) {
  if (!finite(tmin)) return {level: null, basis: null, departure: null};
  const departure = finite(normMin) ? tmin - normMin : null;
  let level = 0, basis = null;
  if (departure !== null && tmin <= IMD.cold.ceiling[terrain]) {
    if (departure <= IMD.cold.departure.severe) { level = 2; basis = 'departure'; }
    else if (departure <= IMD.cold.departure.wave) { level = 1; basis = 'departure'; }
  }
  if (terrain !== 'hills') {
    const absolute = tmin <= IMD.cold.absolute.severe ? 2 : tmin <= IMD.cold.absolute.wave ? 1 : 0;
    if (absolute > level) { level = absolute; basis = 'absolute'; }
  }
  return {level, basis, departure};
}
export function rainClass(mm) {
  if (!finite(mm)) return {label: 'Unavailable', level: null};
  const hit = IMD.rain.find(([from]) => mm >= from);
  return hit ? {label: hit[1], level: hit[2]} : {label: 'No rain', level: 0};
}

// IMD declares an event on the second consecutive day that meets the criteria.
export function declare(levels, min = IMD.persistenceDays) {
  const out = [];
  let run = 0;
  for (const level of levels) {
    if (!finite(level) || level < 1) { run = 0; out.push({met: finite(level) ? 0 : null, declared: 0, run: 0}); continue; }
    run++;
    out.push({met: level, declared: run >= min ? level : 0, run});
  }
  return out;
}

// ---- a whole daily series: ERA5 history or a forecast window ----
export function evaluateDaily(daily, normals, terrain) {
  const n = daily.time?.length || 0, heat = [], cold = [], rows = [];
  for (let i = 0; i < n; i++) {
    const date = daily.time[i], tmax = daily.tmax?.[i], tmin = daily.tmin?.[i], normMax = normalFor(normals, date, 'tmax'), normMin = normalFor(normals, date, 'tmin');
    const h = heatLevel({tmax, normMax, terrain}), c = coldLevel({tmin, normMin, terrain}), w = warmNightLevel({tmax, tmin, normMin, terrain});
    heat.push(h.level); cold.push(c.level);
    rows.push({date, tmax, tmin, precip: daily.precip?.[i] ?? null, normMax, normMin, heat: h, cold: c, warmNight: w, rain: rainClass(daily.precip?.[i])});
  }
  const heatRuns = declare(heat), coldRuns = declare(cold);
  rows.forEach((r, i) => {
    r.heatMet = heatRuns[i].met; r.heatDeclared = heatRuns[i].declared;
    r.coldMet = coldRuns[i].met; r.coldDeclared = coldRuns[i].declared;
    r.warmNightDeclared = r.heatDeclared >= 1 && r.warmNight.level >= 1 ? r.warmNight.level : 0;
    r.frost = finite(r.tmin) ? r.tmin < ETCCDI.frostBelow : null;
  });
  return rows;
}

const maxRun = (rows, test) => { let best = 0, run = 0; for (const r of rows) { if (test(r)) { run++; best = Math.max(best, run); } else run = 0; } return best; };
const finiteMax = a => { const v = a.filter(finite); return v.length ? Math.max(...v) : null; };
const finiteMin = a => { const v = a.filter(finite); return v.length ? Math.min(...v) : null; };

// One row per calendar year. A year is complete only when it has every calendar day and at least 90% of them
// hold both temperatures, so a year in progress never skews means or trends.
export function yearlySummary(rows) {
  const byYear = new Map();
  for (const r of rows) { const y = Number(r.date.slice(0, 4)); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(r); }
  return [...byYear].map(([year, list]) => {
    const valid = list.filter(r => finite(r.tmax) && finite(r.tmin)).length, wet = list.filter(r => finite(r.precip)), expected = daysInYear(year);
    const count = test => list.filter(test).length;
    return {
      year, days: list.length, valid, complete: list.length === expected && valid >= 0.9 * expected,
      heatDays: count(r => r.heatDeclared >= 1), severeHeatDays: count(r => r.heatDeclared === 2), warmNights: count(r => r.warmNightDeclared >= 1),
      coldDays: count(r => r.coldDeclared >= 1), severeColdDays: count(r => r.coldDeclared === 2),
      frostDays: count(r => r.frost === true), hotDays: count(r => finite(r.tmax) && r.tmax >= ETCCDI.hotDayAtLeast),
      tropicalNights: count(r => finite(r.tmin) && r.tmin > ETCCDI.tropicalNightAbove),
      heavyRainDays: count(r => r.rain.level >= 4), r10: count(r => finite(r.precip) && r.precip >= ETCCDI.r10), r20: count(r => finite(r.precip) && r.precip >= ETCCDI.r20),
      txx: finiteMax(list.map(r => r.tmax)), tnn: finiteMin(list.map(r => r.tmin)), rx1: finiteMax(wet.map(r => r.precip)),
      cdd: maxRun(list, r => finite(r.precip) && r.precip < ETCCDI.wetDayMm),
      precipTotal: wet.length >= 0.9 * list.length ? wet.reduce((a, r) => a + r.precip, 0) : null,
    };
  });
}

// Frequency of an annual count: how many complete years had it at least once, and the mean per year.
export function frequency(years, key) {
  const done = years.filter(y => y.complete);
  if (!done.length) return {years: 0, withEvents: 0, mean: null, share: null};
  const withEvents = done.filter(y => y[key] > 0).length;
  return {years: done.length, withEvents, mean: done.reduce((a, y) => a + y[key], 0) / done.length, share: withEvents / done.length};
}
export function periodMean(years, key, from, to) {
  const v = years.filter(y => y.complete && y.year >= from && y.year <= to && finite(y[key])).map(y => y[key]);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
// Least-squares slope of the annual values, per decade. Indicative only: ERA5 is a model product.
export function trendPerDecade(years, key) {
  const pts = years.filter(y => y.complete && finite(y[key]));
  if (pts.length < 10) return null;
  const mx = pts.reduce((a, p) => a + p.year, 0) / pts.length, my = pts.reduce((a, p) => a + p[key], 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.year - mx) * (p[key] - my); den += (p.year - mx) ** 2; }
  return den ? num / den * 10 : null;
}

// ---- a month or a year at one location ----
export function periodSummary(rows, normals, prefix) {
  const list = rows.filter(r => r.date.startsWith(prefix));
  if (!list.length) return null;
  const mean = key => { const v = list.map(r => r[key]).filter(finite); return v.length >= 0.8 * list.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const normMean = key => { const v = list.map(r => r[key]).filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const wet = list.map(r => r.precip).filter(finite);
  return {
    days: list.length, tmax: mean('tmax'), tmin: mean('tmin'), normMax: normMean('normMax'), normMin: normMean('normMin'),
    precip: wet.length >= 0.8 * list.length ? wet.reduce((a, b) => a + b, 0) : null,
    heatDays: list.filter(r => r.heatDeclared >= 1).length, severeHeatDays: list.filter(r => r.heatDeclared === 2).length,
    coldDays: list.filter(r => r.coldDeclared >= 1).length, severeColdDays: list.filter(r => r.coldDeclared === 2).length,
    warmNights: list.filter(r => r.warmNightDeclared >= 1).length, frostDays: list.filter(r => r.frost === true).length,
    heavyRainDays: list.filter(r => r.rain.level >= 4).length,
    txx: finiteMax(list.map(r => r.tmax)), tnn: finiteMin(list.map(r => r.tmin)), rx1: finiteMax(wet),
  };
}

// ---- current reading ----
// The day's maximum is at least the current temperature and the day's minimum is at most it, so a
// current reading that already meets a criterion proves the day will. A cooler reading proves nothing.
export function observedScreen({temperature, date, normals, terrain}) {
  if (!finite(temperature)) return null;
  const normMax = normalFor(normals, date, 'tmax'), normMin = normalFor(normals, date, 'tmin');
  const heat = heatLevel({tmax: temperature, normMax, terrain}), cold = coldLevel({tmin: temperature, normMin, terrain});
  return {temperature, heat, cold, frost: temperature < ETCCDI.frostBelow, normMax, normMin};
}

// ---- the map grid ----
// Rough land outline used only to choose grid cells; it is not a boundary dataset.
export const PAKISTAN_OUTLINE = [[25.1, 61.6], [26.2, 62.4], [27.2, 62.7], [28.2, 62.0], [29.8, 60.9], [31.2, 61.7], [31.0, 64.5], [30.6, 66.2], [31.4, 67.8], [31.3, 69.4], [32.5, 69.5], [33.9, 70.1], [34.6, 71.1], [35.6, 71.6], [36.9, 72.7], [37.0, 74.6], [36.7, 75.9], [35.5, 76.7], [35.6, 77.8], [34.6, 76.2], [34.5, 74.4], [33.2, 74.2], [32.3, 74.7], [31.3, 74.5], [30.3, 74.0], [29.3, 71.9], [28.0, 70.2], [27.0, 70.1], [25.8, 70.1], [24.6, 71.1], [24.0, 70.0], [23.8, 68.3], [24.5, 67.2], [24.9, 66.6], [25.3, 65.5], [25.4, 63.9], [25.2, 62.6]];
export function insideOutline(lat, lon, poly = PAKISTAN_OUTLINE) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function gridPoints(step) {
  const pts = [];
  for (let lat = 23.5 + step / 2; lat < 37.2; lat += step)
    for (let lon = 60.8 + step / 2; lon < 77.9; lon += step)
      if (insideOutline(lat, lon)) pts.push([Number(lat.toFixed(3)), Number(lon.toFixed(3))]);
  return pts;
}

// Colour ramps for the map. Values outside the range are clamped.
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export function rampColor(value, stops) {
  if (!finite(value)) return null;
  if (value <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`;
  for (let i = 1; i < stops.length; i++) if (value <= stops[i][0]) {
    const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
    return `rgb(${lerp(c0, c1, (value - v0) / (v1 - v0)).join(',')})`;
  }
  return `rgb(${stops.at(-1)[1].join(',')})`;
}
export const RAMPS = {
  temperature: [[-20, [76, 29, 148]], [-5, [59, 130, 246]], [8, [125, 211, 252]], [20, [253, 224, 71]], [32, [249, 115, 22]], [42, [220, 38, 38]], [50, [127, 29, 29]]],
  precip: [[0, [30, 41, 59]], [1, [186, 230, 253]], [10, [56, 189, 248]], [50, [37, 99, 235]], [150, [124, 58, 237]], [400, [192, 38, 211]]],
};
// Hazard screen on one day using only the absolute limits (no normals are available per grid cell).
export function absoluteScreen({tmax, tmin, elevation}) {
  const terrain = autoTerrain(elevation);
  const heat = terrain === 'plains' && finite(tmax) ? (tmax >= IMD.heat.absolute.severe ? 2 : tmax >= IMD.heat.absolute.wave ? 1 : 0) : null;
  const cold = terrain !== 'hills' && finite(tmin) ? (tmin <= IMD.cold.absolute.severe ? 2 : tmin <= IMD.cold.absolute.wave ? 1 : 0) : null;
  return {heat, cold, terrain};
}
