// Pure logic for the WeatherWalay realtime station map (no DOM). The column layout and the parameter/category
// definitions come from the WeatherWalay realtime page (forecasting.weatherwalay.com/realtime); only stations
// and their basic and derived parameters are here: air quality, radar and interpolation are not part of this map.
import {getTextColor} from './palettes.js';
export {getTextColor};

export const COLUMN_COUNT = 178;
const INFO_MAX = 'PMD & IMD Stations:<br>(05:00 pm-05:00 pm)<br>AWS Stations<br>(12:00 am-12:00 am)';
const INFO_MIN = 'PMD & IMD Stations:<br>(08:00 am-08:00 am)<br>AWS Stations<br>(12:00 am-12:00 am)';
const INFO_24H = 'PMD & IMD Stations:<br>(08:00 am-08:00 am)<br>AWS Stations<br>(24 Hours Prior to Last Sync)';
const INFO_DAILY = 'PMD Stations:<br>(02:00 am-02:00 am)<br>AWS Stations<br>(12:00 am-12:00 am)';

// Current, Maximum, Minimum, Average of one quantity. v: value column, at: time it happened, sync: last update time of the group.
const stat = (cur, max, maxAt, min, minAt, avg, sync, extra = {}) => ({
  Current: {v: cur, sync: 161},
  Maximum: {v: max, at: maxAt, sync, ...(extra.maxInfo ? {info: extra.maxInfo} : {})},
  Minimum: {v: min, at: minAt, sync, ...(extra.minInfo ? {info: extra.minInfo} : {})},
  Average: {v: avg, sync: extra.avgSync ?? sync},
});
// group: 'basic' or 'derived' (computed from the basic readings) or 'climate' (against the long-term normal).
export const PARAMS = {
  temperature: {label: 'Temperature', unit: '°C', group: 'basic', cats: stat(5, 6, 7, 12, 13, 18, 24, {maxInfo: INFO_MAX, minInfo: INFO_MIN})},
  humidity: {label: 'Humidity', unit: '%', group: 'basic', cats: stat(73, 74, 75, 76, 77, 78, 80)},
  pressure: {label: 'Pressure', unit: 'hPa', group: 'basic', trend: 128, cats: {
    Current: {v: 127, sync: 162}, Maximum: {v: 129, at: 130, sync: 135}, Minimum: {v: 131, at: 132, sync: 135}, Average: {v: 133, sync: 135}}},
  wind_speed: {label: 'Wind Speed', unit: 'km/h', group: 'basic', cats: {
    Current: {v: 91, dir: 92, sync: 161}, Maximum: {v: 97, dir: 98, at: 99, sync: 104}, Average: {v: 100, dir: 101, sync: 104},
    '10 mins Average': {v: 93, dir: 94, sync: 161}, '10 mins Gust': {v: 95, dir: 96, sync: 161}}},
  rainfall: {label: 'Rainfall', unit: 'mm', group: 'basic', rate: 121, cats: {
    Daily: {v: 106, sync: 161, info: INFO_DAILY}, 'Last 24 Hours': {v: 105, sync: 161, info: INFO_24H, atForNetworks: {PMD: 13, IMD: 13}},
    Monthly: {v: 107, sync: 161}, 'Monsoon (JJAS)': {v: 109, sync: 161}, Yearly: {v: 108, sync: 161}}},
  rain_rate: {label: 'Rain Rate', unit: 'mm/hr', group: 'basic', rate: 121, cats: {
    Current: {v: 121, sync: 161}, Instantaneous: {v: 122, sync: 161}, Maximum: {v: 123, at: 124, sync: 126}}},
  solar_radiation: {label: 'Solar Radiation', unit: 'W/m²', group: 'basic', cats: {Current: {v: 86, sync: 161}, Maximum: {v: 87, at: 88, sync: 90}}},
  uv_index: {label: 'UV Index', unit: '', group: 'basic', cats: {Current: {v: 81, sync: 161}, Maximum: {v: 82, at: 83, sync: 85}}},
  visibility: {label: 'Visibility', unit: 'm', group: 'basic', cats: {
    Current: {v: 164, at: 165, sync: 170}, Maximum: {v: 166, at: 167, sync: 170}, Minimum: {v: 168, at: 169, sync: 170}}},
  dew_point: {label: 'Dew Point', unit: '°C', group: 'derived', cats: stat(25, 26, 27, 28, 29, 30, 32)},
  wet_bulb: {label: 'Wet Bulb', unit: '°C', group: 'derived', cats: stat(33, 34, 35, 36, 37, 38, 40)},
  heat_index: {label: 'Heat Index', unit: '°C', group: 'derived', cats: stat(41, 42, 43, 44, 45, 46, 48)},
  wind_chill: {label: 'Wind Chill', unit: '°C', group: 'derived', cats: stat(49, 50, 51, 52, 53, 54, 56)},
  thw_index: {label: 'THW Index', unit: '°C', group: 'derived', cats: stat(57, 58, 59, 60, 61, 62, 64)},     // the page reads column 61 as the Average's sync time, which looks like a slip: 64 is used here
  thsw_index: {label: 'THSW Index', unit: '°C', group: 'derived', cats: stat(65, 66, 67, 68, 69, 70, 72)},
  hairfrizz_index: {label: 'Hair Frizz Index', unit: '', group: 'derived', cats: stat(171, 172, 173, 174, 175, 176, 177)},
  normals: {label: 'Normals', unit: '', group: 'climate', cats: {
    'Monthly Rain': {v: 111, unit: 'mm'}, 'Yearly Rain': {v: 112, unit: 'mm'}, 'Monsoon Rain': {v: 113, unit: 'mm'},
    'Monthly Max Temp': {v: 8, unit: '°C'}, 'Monthly Mean Temp': {v: 19, unit: '°C'}, 'Monthly Min Temp': {v: 14, unit: '°C'},
    'Yearly Max Temp': {v: 9, unit: '°C'}, 'Yearly Mean Temp': {v: 20, unit: '°C'}, 'Yearly Min Temp': {v: 15, unit: '°C'}}},
  departures: {label: 'Departures', unit: '', group: 'climate', cats: {
    'Monthly Rain': {v: 115, unit: '%'}, 'Yearly Rain': {v: 116, unit: '%'}, 'Monsoon Rain': {v: 117, unit: '%'},
    'Monthly Max Temp': {v: 10, unit: '°C'}, 'Monthly Mean Temp': {v: 21, unit: '°C'}, 'Monthly Min Temp': {v: 16, unit: '°C'},
    'Yearly Max Temp': {v: 11, unit: '°C'}, 'Yearly Mean Temp': {v: 22, unit: '°C'}, 'Yearly Min Temp': {v: 17, unit: '°C'}}},
};
// Normals and departures are read from the same sync as the current values (column 161), so they share its time stamp.
for (const key of ['normals', 'departures']) for (const d of Object.values(PARAMS[key].cats)) d.sync = 161;
export const GROUPS = [['basic', 'Basic'], ['derived', 'Derived'], ['climate', 'Against normal']];
export const NETWORKS = ['PMD', 'IMD', 'Davis', 'Ecowitt', 'WU', 'Synoptic', 'Dynasys', 'Zomato', 'GLOF', 'Others'];
export const catUnit = (p, c) => PARAMS[p].cats[c].unit ?? PARAMS[p].unit;

// ---- columns ----
const BASE = {0: 'Station ID', 1: 'Station name', 2: 'Latitude', 3: 'Longitude', 4: 'Network', 118: 'Rainstorm', 128: 'Pressure trend', 161: 'Last sync (readings)', 162: 'Last sync (pressure)', 163: 'Last sync (air quality)', 170: 'Last sync (visibility)'};
// One label per column: base columns, then every value / time / direction / sync column the parameters use. Others stay "unlabelled".
export function columnTable() {
  const cols = Array.from({length: COLUMN_COUNT}, (_, i) => ({i, label: BASE[i] ?? `Column ${i} (unlabelled)`, group: BASE[i] ? 'Station' : 'Other', unit: '', kind: i < 5 ? 'text' : 'value', named: i in BASE}));
  const set = (i, label, group, unit, kind) => { if (i === undefined || cols[i].named && cols[i].group === 'Station') return; if (!cols[i].named || kind === 'value') cols[i] = {i, label, group, unit, kind, named: true}; };
  for (const [key, p] of Object.entries(PARAMS)) for (const [cat, d] of Object.entries(p.cats)) {
    const unit = d.unit ?? p.unit;
    set(d.v, `${p.label} · ${cat}`, p.label, unit, 'value');
    if (d.at !== undefined) set(d.at, `${p.label} · ${cat} recorded at`, p.label, '', 'time');
    if (d.dir !== undefined) set(d.dir, `${p.label} · ${cat} direction`, p.label, '°', 'value');
    if (d.sync !== undefined && !cols[d.sync].named) set(d.sync, `${p.label} · last sync`, p.label, '', 'time');
  }
  for (const i of [7, 13, 24, 27, 29, 32]) if (cols[i].kind === 'value') cols[i].kind = 'time';
  for (const i of [161, 162, 163, 170]) cols[i].kind = 'time';
  return cols;
}
export function unpermute(wire, perm) {
  const row = Array(perm.length).fill(null);
  perm.forEach((index, k) => { const v = wire[k]; row[index] = v === undefined ? null : v; });
  return row;
}

// ---- time labels ----
// Labels look like "11:53 am, 13 November" or "05:00 PM, 12 November" and are Pakistan Standard Time (UTC+5). The year is not given.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const PKT = 5 * 3600000;
export function parseLabel(label, now = Date.now()) {
  if (typeof label !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?,\s*(\d{1,2})\s+([A-Za-z]+)$/i.exec(label.trim().replace(/"/g, ''));
  if (!m) return null;
  let hour = Number(m[1]); const minute = Number(m[2]), day = Number(m[4]), month = MONTHS.indexOf(m[5].toLowerCase()), ap = m[3]?.toLowerCase();
  if (month < 0 || minute > 59) return null;
  if (ap) { if (hour < 1 || hour > 12) return null; if (ap === 'pm' && hour !== 12) hour += 12; if (ap === 'am' && hour === 12) hour = 0; } else if (hour > 23) return null;
  const year = new Date(now + PKT).getUTCFullYear();
  // The labels (last sync, time of a maximum) are always in the past, so take the most recent year that is not in the future. Up to two
  // hours ahead is allowed for clock skew. A label from late December read in early January belongs to last year, and "16 May" read in
  // November is this May, not next May.
  for (const y of [year, year - 1, year - 2]) {
    const t = Date.UTC(y, month, day, hour, minute) - PKT;
    if (new Date(t + PKT).getUTCMonth() !== month) return null;               // 31 February and the like
    if (t <= now + 2 * 3600000) return t;
  }
  return null;
}
// A station is active when its last sync is at most 30 minutes old (and not more than 60 minutes in the future).
export function isActive(syncLabel, now = Date.now()) {
  const t = parseLabel(syncLabel, now);
  if (t === null) return false;
  const minutes = (now - t) / 60000;
  return minutes <= 30 && minutes >= -60;
}
// PMD and IMD report daily extremes for fixed periods: the recorded time must be the expected hour of today (or yesterday before that hour).
const EXPECTED = {temperature: {Minimum: 8, Maximum: 17}, rainfall: {'Last 24 Hours': 8}};
export function validStamp(network, param, cat, recordedAt, now = Date.now()) {
  if (network !== 'IMD' && network !== 'PMD') return true;
  const hour = EXPECTED[param]?.[cat];
  if (hour === undefined) return true;
  const t = parseLabel(recordedAt, now);
  if (t === null) return false;
  const local = new Date(now + PKT), todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - PKT;
  const expected = todayStart + (local.getUTCHours() < hour ? -86400000 : 0) + hour * 3600000;
  return t === expected;
}

// ---- features for the map ----
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function stationFeatures(rows, param, cat, {networks = new Set(NETWORKS), active = true, inactive = true, now = Date.now()} = {}) {
  const p = PARAMS[param], d = p?.cats[cat];
  if (!d) return [];
  const out = [];
  for (const r of rows) {
    const network = r[4];
    if (!networks.has(network)) continue;
    const value = r[d.v];
    if (!finite(value)) continue;
    const at = d.at !== undefined ? r[d.at] : d.atForNetworks?.[network] !== undefined ? r[d.atForNetworks[network]] : null, sync = r[d.sync] ?? null, on = isActive(sync, now);
    if (on ? !active : !inactive) continue;
    if (!validStamp(network, param, cat, at, now)) continue;
    const trend = p.trend !== undefined ? r[p.trend] : null;
    out.push({id: r[0], name: r[1], lat: r[2], lon: r[3], network, value, unit: d.unit ?? p.unit, color: getTextColor(value, param, cat), at: at ?? null, sync, dir: d.dir !== undefined ? r[d.dir] : null,
      active: on, info: d.info ?? '', raining: p.rate !== undefined && finite(r[p.rate]) && r[p.rate] > 0, trend: finite(trend) ? trend : null, ring: finite(trend) && cat === 'Current' && Math.abs(trend) >= 3, row: r});
  }
  return out;
}
export const fmtValue = (v, param) => param === 'visibility' ? String(v) : v.toFixed(1);

// ---- everything one station reports ----
// Every parameter and category with its value, unit, the time it was recorded and the group's last update. Missing values stay null.
export function stationReadings(row) {
  const out = [];
  for (const [key, p] of Object.entries(PARAMS)) {
    const cats = [];
    for (const [cat, d] of Object.entries(p.cats)) {
      const v = row[d.v], atCol = d.at ?? d.atForNetworks?.[row[4]];
      cats.push({category: cat, value: finite(v) ? v : null, unit: d.unit ?? p.unit, recordedAt: atCol !== undefined ? row[atCol] ?? null : null, lastSync: d.sync !== undefined ? row[d.sync] ?? null : null,
        direction: d.dir !== undefined && finite(row[d.dir]) ? row[d.dir] : null, note: d.info ?? ''});
    }
    out.push({param: key, label: p.label, group: p.group, categories: cats});
  }
  return out;
}
// CSV with one row per station and one column per feed column (labelled), the station metadata first. Text is quoted when needed.
const csvCell = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
export function stationsCsv(stations, cols) {
  const head = ['id', 'name', 'network', 'latitude', 'longitude', 'elevation_m', 'elevation_source', 'position_note', ...cols.slice(5).map(c => c.label + (c.unit ? ` (${c.unit})` : ''))];
  const lines = [head.map(csvCell).join(',')];
  for (const s of stations) lines.push([s.id ?? '', s.name, s.network, s.lat, s.lon, s.elevation ?? '', s.elevation === null || s.elevation === undefined ? '' : s.elevation_source ?? '', s.position_note ?? '', ...s.v.slice(5)].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}
// ---- wind ----
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => finite(deg) ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] : '';
