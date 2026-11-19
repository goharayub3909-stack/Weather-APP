// PMD Flood Forecasting Division station readings from https://ffd.pmd.gov.pk/staff/weather-display (one server-rendered page per station,
// chosen with ?city=<slug>). Only the observed weather and its time stamp are read: the ICON model forecast block, the city rankings and
// the weather icon / condition word of the page are ignored. Used by sync-realtime.mjs to give the PMD stations of realtime.json current values.
//
// Fetching is polite: one request at a time with a pause, a plain descriptive User-Agent, no retry storms. The page itself refreshes every
// 5 minutes and its synoptic times are hourly or 3-hourly, so there is no point in asking more often than about every 15 minutes.
// Source of the data: Pakistan Meteorological Department (Flood Forecasting Division). The operator allowed WeatherWalay to use it for model training.
const BASE = 'https://ffd.pmd.gov.pk/staff/weather-display';
const AGENT = 'WeatherWalayPortal/1.0 (station data sync)';
const PKT = '+05:00';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const compassDegrees = text => {
  const i = COMPASS.indexOf(String(text ?? '').trim().toUpperCase());
  return i < 0 ? null : i * 22.5;
};
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&deg;/g, '°')
  .replace(/&bull;/g, '•').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&#039;|&apos;/g, "'");
const num = s => { const m = /(-?\d[\d,]*\.?\d*)/.exec(String(s ?? '').replace(/ /g, ' ')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const between = (html, open, close) => { const i = html.indexOf(open); if (i < 0) return null; const j = html.indexOf(close, i + open.length); return j < 0 ? null : html.slice(i + open.length, j); };
const clean = s => s === null ? null : text(s).replace(/\s+/g, ' ').trim();

// "17:00 PKT" and "17 Nov 2026" -> ISO time with the +05:00 offset, or null.
export function pktIso(timeLabel, dateLabel) {
  const t = /(\d{1,2}):(\d{2})/.exec(timeLabel ?? ''), d = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(dateLabel ?? '');
  if (!t || !d) return null;
  const mon = MONTHS.indexOf(d[2].toLowerCase());
  if (mon < 0) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d[3]}-${p(mon + 1)}-${p(d[1])}T${p(t[1])}:${t[2]}:00${PKT}`;
}

// One station page -> reading, or null when the page has no station block. A value the page does not give (a dash) is null.
export function parseStationPage(html) {
  const name = clean(between(html, '<div class="city-name"', '</div>')?.replace(/^[^>]*>/, '') ?? null);
  if (!name) return null;
  const sub = clean(between(html, '<div class="city-sub">', '</div>')) ?? '';
  const pos = /(-?\d+(?:\.\d+)?)\s*°?\s*N\s+(-?\d+(?:\.\d+)?)\s*°?\s*E/.exec(sub.replace(/ /g, ' ').replace(/[^\x20-\x7e°]/g, ''));
  const badge = clean(between(html, '<div class="city-badge">', '</div>')) ?? '';
  const wmo = [...(/WMO\s*([\d/\s]+)/.exec(badge)?.[1] ?? '').matchAll(/\d{4,5}/g)].map(m => Number(m[0]));
  const hero = between(html, '<div class="temp-col">', '<div class="minmax-row"') ?? '';
  const sourceLine = clean(between(hero, '<div class="temp-source">', '</div>')) ?? '';
  const source = /^([A-Za-z0-9 ./-]+?)\s*•/.exec(sourceLine)?.[1]?.trim() ?? null;
  const timeLabel = /(\d{1,2}:\d{2})\s*PKT/.exec(sourceLine)?.[0] ?? null;
  const footer = clean(html.slice(html.lastIndexOf('Observed'))) ?? '';
  const obs = /Observed\s+(\d{1,2}:\d{2}\s*PKT)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/.exec(footer);
  const icao = /ICAO\s+([A-Z]{4})/.exec(footer)?.[1] ?? null;
  const tempText = clean(between(hero, '<div class="temp-val">', '</div>'));
  const exStart = html.indexOf('<div class="minmax-row"'), exEnd = html.indexOf('<div class="metrics-grid"', exStart);
  const extremes = exStart < 0 ? '' : html.slice(exStart, exEnd < 0 ? undefined : exEnd);
  const grab = (cls, which) => {
    const i = extremes.indexOf(`mm-cell ${cls}`); if (i < 0) return null;
    const rest = extremes.slice(i, extremes.indexOf('mm-cell', i + 10) > 0 ? extremes.indexOf('mm-cell', i + 10) : undefined);
    const re = which === 'today' ? /class="mm-val(?: [^"]*)?">([^<]*)</ : /class="mm-yda-val[^"]*">([^<]*)</;
    return num(re.exec(rest)?.[1]);
  };
  const metrics = {};
  for (const m of html.matchAll(/<div class="m-label">([^<]*)<\/div>\s*<div class="m-val">([^<]*)<\/div>\s*<div class="m-sub">([^<]*)<\/div>/g)) metrics[clean(m[1]).toLowerCase()] = {value: clean(m[2]), sub: clean(m[3])};
  const wind = metrics.wind, rain = metrics.rainfall;
  const rainText = rain?.value ?? '';
  const direction = /^(\S+)\s+direction/i.exec(wind?.sub ?? '')?.[1] ?? null;
  const record = {
    name, lat: pos ? Number(pos[1]) : null, lon: pos ? Number(pos[2]) : null, wmo, icao,
    source, observed_label: obs ? obs[1] : timeLabel, observed_date: obs ? obs[2] : null,
    observed_at: pktIso(obs ? obs[1] : timeLabel, obs ? obs[2] : null),
    temperature: num(tempText),
    max_today: grab('mm-max', 'today'), max_yesterday: grab('mm-max', 'yda'), min_today: grab('mm-min', 'today'), min_yesterday: grab('mm-min', 'yda'),
    humidity: num(metrics.humidity?.value),
    wind_kmh: num(wind?.value), wind_direction: direction, wind_direction_deg: compassDegrees(direction),
    pressure_hpa: num(metrics.pressure?.value),
    visibility_km: kmFrom(metrics.visibility?.value),
    dew_point: num(metrics['dew pt']?.value),
    rain_mm: /^nil$/i.test(rainText) ? 0 : num(rainText), rain_since: /since\s+(\d{1,2}:\d{2}\s*PKT)/i.exec(rain?.sub ?? '')?.[1] ?? null,
  };
  return record;
}

// "10.0 km" -> 10, "800 m" -> 0.8, a dash -> null.
function kmFrom(t) {
  const v = num(t);
  if (v === null) return null;
  return /(^|[^a-z])km($|[^a-z])/i.test(t) ? v : /(^|[^a-z])m($|[^a-z])/i.test(t) ? v / 1000 : null;
}

export function parseCities(html) {
  return [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(m => ({slug: m[1], label: clean(m[2])}));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, signal) {
  const res = await fetch(url, {headers: {'User-Agent': AGENT, Accept: 'text/html'}, signal});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new TextDecoder('utf-8').decode(await res.arrayBuffer());
}

// ---- merge into realtime.json ----
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// ISO time with +05:00 -> the label style of realtime.json: "05:00 pm, 17 November".
export function labelPkt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const h = Number(m[4]), ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${m[5]} ${ap}, ${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]}`;
}
// Columns of realtime.json (PARAMS in public/realtime/core.js): value column -> its sync column. All of PMD's values are "current".
const COL = {temperature: [5, 24], dew_point: [25, 32], humidity: [73, 80], pressure_hpa: [127, 162], visibility_m: [164, 170], wind_kmh: [91, 161], wind_direction_deg: [92, 161], rain_mm: [105, 161]};
// Columns that share sync column 161 and are observations: when 161 is set to the PMD time they must not keep a stale WeatherWalay-feed value.
const SHARES_161 = [81, 86, 91, 92, 93, 94, 95, 96, 105, 106, 107, 108, 109, 121, 122];
const norm = n => String(n ?? '').toLowerCase().replace(/[^a-z]/g, '');

// Overlay the page readings on the PMD stations of a realtime.json object (changes it, returns a summary). A station row is found by WMO number
// (first match in the page's order), else by name. A row that already has a sync newer than the page's observation is left alone.
export function applyPmdFfd(data, ffd, parseLabel, now = Date.now()) {
  const pmd = data.stations.filter(s => s.network === 'PMD');
  const byId = new Map(pmd.map(s => [String(s.id), s])), byName = new Map(pmd.map(s => [norm(s.name), s]));
  const summary = {updated: 0, kept_newer: 0, no_observation: 0, unmatched: []};
  for (const r of ffd.stations) {
    if (!r.observed_at) { summary.no_observation++; continue; }
    const row = r.wmo.map(w => byId.get(String(w))).find(Boolean) ?? byName.get(norm(r.label)) ?? byName.get(norm(r.name));
    if (!row) { summary.unmatched.push(r.slug); continue; }
    const at = Date.parse(r.observed_at), label = labelPkt(r.observed_at);
    const have = parseLabel(row.v[161], now);
    if (have !== null && have >= at) { summary.kept_newer++; continue; }
    const vals = {temperature: r.temperature, dew_point: r.dew_point, humidity: r.humidity, pressure_hpa: r.pressure_hpa,
      visibility_m: r.visibility_km === null ? null : Math.round(r.visibility_km * 1000), wind_kmh: r.wind_kmh, wind_direction_deg: r.wind_direction_deg, rain_mm: r.rain_mm};
    for (const c of SHARES_161) row.v[c] = null;
    for (const [key, [vc, sc]] of Object.entries(COL)) if (vals[key] !== null && vals[key] !== undefined) { row.v[vc] = vals[key]; row.v[sc] = label; }
    row.pmd_ffd = {slug: r.slug, source: r.source, observed_at: r.observed_at, observed_label: r.observed_label, icao: r.icao, wmo: r.wmo,
      max_today: r.max_today, min_today: r.min_today, max_yesterday: r.max_yesterday, min_yesterday: r.min_yesterday, rain_since: r.rain_since,
      wind_direction: r.wind_direction, position_0p1deg: [r.lat, r.lon]};
    summary.updated++;
  }
  data.pmd_ffd = {source: ffd.source, fetched_at: ffd.fetched_at, ...summary, failed: ffd.failed};
  return summary;
}

// All stations, one at a time. -> {fetched_at, stations: [{slug, ...reading}], failed: [slug]}. pauseMs between requests, budgetMs overall.
export async function fetchAll({pauseMs = 700, budgetMs = 5 * 60 * 1000, onProgress = () => {}} = {}) {
  const t0 = Date.now(), signal = AbortSignal.timeout(budgetMs + 30000);
  const cities = parseCities(await get(BASE, signal));
  if (!cities.length) throw new Error('no station list on the page');
  const stations = [], failed = [];
  for (const c of cities) {
    if (Date.now() - t0 > budgetMs) { failed.push(c.slug); continue; }
    try {
      const r = parseStationPage(await get(`${BASE}?city=${encodeURIComponent(c.slug)}`, signal));
      if (r) stations.push({slug: c.slug, label: c.label, ...r}); else failed.push(c.slug);
    } catch { failed.push(c.slug); }
    onProgress(c.slug);
    await sleep(pauseMs);
  }
  return {source: 'PMD Flood Forecasting Division, ffd.pmd.gov.pk/staff/weather-display', fetched_at: new Date().toISOString(), stations, failed};
}

// node scripts/pmd-ffd.mjs --apply   patches the PMD rows of the existing public/observation-data/realtime.json (and stations.json) in place, no WeatherWalay login
import {pathToFileURL} from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--apply')) {
  const {readFile, writeFile, rename} = await import('node:fs/promises');
  const {stationsFromRealtime} = await import('./observation-sync.mjs');
  const {parseLabel} = await import('../public/realtime/core.js');
  const dir = new URL('../public/observation-data/', import.meta.url);
  const data = JSON.parse(await readFile(new URL('realtime.json', dir), 'utf8'));
  const ffd = await fetchAll({onProgress: slug => process.stdout.write('.')});
  console.log();
  const sum = applyPmdFfd(data, ffd, parseLabel);
  await writeFile(new URL('realtime.tmp', dir), JSON.stringify(data) + '\n');
  await rename(new URL('realtime.tmp', dir), new URL('realtime.json', dir));
  await writeFile(new URL('stations.json', dir), JSON.stringify(stationsFromRealtime(data)) + '\n');
  console.log(`PMD FFD page: ${sum.updated} PMD stations updated, ${sum.kept_newer} already newer, ${sum.no_observation} without an observation, unmatched: ${sum.unmatched.join(', ') || 'none'}; ${ffd.failed.length} pages failed`);
}
