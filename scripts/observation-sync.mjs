// Node port of scripts/sync-metar.py and scripts/sync-stations.py, used by the local dev server so
// localhost shows live observations instead of the snapshot committed to git. CI still runs the
// Python scripts; keep the two in step (the field indexes and limits below mirror sync-stations.py).
import {newerFeed} from '../public/observation-feed.js';
import {columnTable, unpermute} from '../public/realtime/core.js';
import {observationTime, slimStation, slimFromRealtime} from '../public/station-records.js';
import {ELEVATION_SOURCE, loadElevationCache, saveElevationCache, fillElevations} from './station-elevation.mjs';

const ORIGIN = 'https://forecasting.weatherwalay.com';
const PAGES_FEED = 'https://goharayub3909-stack.github.io/Weather-APP/observation-data/';
const RAW_FEED = 'https://raw.githubusercontent.com/goharayub3909-stack/Weather-APP/data/observation-data/';
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

// ---------- airports ----------
const METAR_KEYS = ['icaoId', 'obsTime', 'temp', 'dewp', 'wdir', 'wspd', 'wgst', 'altim', 'rawOb', 'lat', 'lon', 'name', 'clouds', 'wxString', 'visib'];
export function sanitizeMetar(rows) {
  const out = new Map();
  for (const row of rows || []) {
    const code = row?.icaoId || '';
    if (!code.startsWith('OP') || code.length !== 4) continue;
    if (num(row.lat, 23, 38) === null || num(row.lon, 60, 78) === null || typeof row.obsTime !== 'number') continue;
    if (row.obsTime <= (out.get(code)?.obsTime ?? 0)) continue;
    out.set(code, Object.fromEntries(METAR_KEYS.map(k => [k, row[k] ?? null])));
  }
  return [...out.values()];
}
export async function fetchMetar(fetcher = fetch) {
  const r = await fetcher('https://aviationweather.gov/api/data/metar?bbox=23,60,38,78&format=json&hours=3', {headers: {'User-Agent': 'MonsoonWeather/1.0'}, signal: AbortSignal.timeout(40000)});
  if (!r.ok) throw Error('METAR HTTP ' + r.status);
  const stations = sanitizeMetar(await r.json());
  if (!stations.length) throw Error('No valid Pakistan observations');
  return {source: 'NOAA Aviation Weather Center', retrieved_at: new Date().toISOString(), stations};
}

// ---------- WeatherWalay stations ----------
// The station field mapping and the yearless-time alignment live in public/station-records.js, shared with the browser.
export {observationTime};
export function sanitizeStations(rows, perm, feedTime) {
  if (!Array.isArray(perm) || perm.length < 162 || [...perm].sort((a, b) => a - b).some((v, i) => v !== i)) throw Error('Unsupported station schema');
  const out = [];
  for (const wire of rows || []) {
    if (!Array.isArray(wire) || wire.length !== perm.length) continue;
    const slim = slimStation(unpermute(wire, perm), feedTime);
    if (slim) out.push(slim);
  }
  return out;
}

// Minimal cookie jar: fetch has none, and the provider sets its session across redirects.
async function jarFetch(jar, url, init = {}, hops = 6) {
  for (let i = 0; i <= hops; i++) {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(url, {...init, redirect: 'manual', headers: {...init.headers, ...(cookie ? {Cookie: cookie} : {})}, signal: AbortSignal.timeout(40000)});
    for (const c of r.headers.getSetCookie?.() || []) { const [pair] = c.split(';'), at = pair.indexOf('='); if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1)); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; init = {headers: init.headers}; continue; }
    return {response: r, url};
  }
  throw Error('Too many redirects');
}
// One login gives the whole raw feed: the permuted rows, the column order and the update time. Both the slim stations.json and the full
// realtime.json are made from it. Nothing from the login or the page token is kept.
export async function fetchFeed({username, password}) {
  if (!username || !password) throw Error('Missing WeatherWalay login');
  const jar = new Map();
  await jarFetch(jar, ORIGIN + '/login');
  await jarFetch(jar, ORIGIN + '/login', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({username, password})});
  const page = await jarFetch(jar, ORIGIN + '/realtime');
  if (new URL(page.url).pathname === '/login') throw Error('Login unavailable');
  const html = (await page.response.text()).slice(0, 5_000_000), match = /(?:window\.)?__WW_BOOT__\s*=\s*(\{[^;]+\})\s*;/.exec(html);
  if (!match) throw Error('Station bootstrap unavailable');
  const boot = JSON.parse(match[1]), endpoint = new URL(boot.endpoint || '/feed/current', ORIGIN);
  if (endpoint.hostname !== 'forecasting.weatherwalay.com') throw Error('Unexpected endpoint');
  const feed = await jarFetch(jar, endpoint.href, {headers: {'X-Requested-With': 'XMLHttpRequest', 'X-WW-Token': boot.token || ''}});
  return {perm: boot.perm, payload: await feed.response.json()};
}
export function stationsFromFeed({perm, payload}) {
  const stations = sanitizeStations(payload.rows, perm, payload.lastUpdateTime);
  if (!stations.length) throw Error('No valid station observations');
  return {source: 'WeatherWalay realtime', retrieved_at: new Date().toISOString(), status: 'updated', stations};
}
// stations.json for older readers (the CI archive) is a view of realtime.json, never a separate fetch.
export const stationsFromRealtime = slimFromRealtime;
export const fetchStations = async creds => stationsFromFeed(await fetchFeed(creds));

// ---------- the full realtime record: every station, every column, as the feed gives them ----------
// Unlike stations.json this keeps all 178 columns (basic and derived parameters, their extremes with the time they happened, averages,
// normals, departures, last-sync times) and every network, including IMD. Station name, latitude and longitude are exactly as the feed
// gives them; the elevation is added from a terrain model (see station-elevation.mjs). Column labels come from public/realtime/core.js.
// About a fifth of the feed's stations (neighbouring IMD, many Islamabad, Lahore and Rawalpindi sensors) have no id, so the key falls back
// to name and position. Names, latitude and longitude are kept exactly as the feed gives them; the one pair the feed has swapped (a latitude
// of 72.9 N with a longitude of 33.4 E) is flagged and corrected only for the map position and the elevation lookup.
export const stationKey = v => v[0] !== null && v[0] !== undefined ? String(v[0]) : `${v[1]}|${v[2]}|${v[3]}`;
export function mapPosition(lat, lon) {
  if (lat >= 60 && lat <= 78 && lon >= 23 && lon <= 38) return {lat: lon, lon: lat, note: 'Latitude and longitude look swapped in the feed; the map uses them the other way round'};
  return {lat, lon, note: null};
}
export function realtimeFromFeed({perm, payload}, elevations = new Map()) {
  const stations = [];
  for (const wire of payload.rows || []) {
    if (!Array.isArray(wire) || wire.length !== perm.length) continue;
    const v = unpermute(wire, perm), lat = num(v[2], -90, 90), lon = num(v[3], -180, 180);
    if (lat === null || lon === null || typeof v[1] !== 'string') continue;
    const key = stationKey(v), pos = mapPosition(lat, lon), el = elevations.get(key);
    stations.push({key, id: v[0], name: v[1], network: v[4], lat, lon, map_lat: pos.lat, map_lon: pos.lon, position_note: pos.note, elevation: el ?? null, elevation_source: el === undefined ? null : ELEVATION_SOURCE, v});
  }
  if (!stations.length) throw Error('No valid station records');
  return {source: 'WeatherWalay realtime', retrieved_at: new Date().toISOString(), last_update: payload.lastUpdateTime ?? null, columns: columnTable(), stations};
}
const ELEVATION_FILE = new URL('../public/observation-data/station-elevations.json', import.meta.url);
let elevationCache = null;
export async function realtimeWithElevations(raw, {fetcher = fetch, file = ELEVATION_FILE} = {}) {
  elevationCache ??= await loadElevationCache(file);
  const probe = realtimeFromFeed(raw).stations.map(s => ({key: s.key, lat: s.map_lat, lon: s.map_lon}));
  if (await fillElevations(probe, elevationCache, {fetcher})) { try { await saveElevationCache(file, elevationCache); } catch { /* read-only checkout: keep it in memory */ } }
  return realtimeFromFeed(raw, elevationCache);
}

// ---------- what the dev server serves ----------
// Airports come from NOAA (no login). Stations come from WeatherWalay when WEATHERWALAY_USERNAME and
// WEATHERWALAY_PASSWORD are set (a git-ignored .env file works); otherwise the newest already-published
// copy (the data branch or the live site) is used, never older than the committed snapshot.
const TTL = {metar: 2 * 60000, stations: 60000, realtime: 60000};   // the station provider refreshes about every minute
const memo = new Map(), inflight = new Map();
// stations.json and realtime.json come from the same login, so the raw feed is fetched once and shared for a short time.
let rawFeed = {time: 0, job: null};
async function sharedFeed(creds, now) {
  if (!rawFeed.job || now - rawFeed.time > 45000) { rawFeed = {time: now, job: fetchFeed(creds)}; rawFeed.job.catch(() => { rawFeed = {time: 0, job: null}; }); }
  return rawFeed.job;
}
async function pull(name, {env, fetcher}) {
  let data = null;
  try {
    if (name === 'metar') data = await fetchMetar(fetcher);
    else if (env.WEATHERWALAY_USERNAME && env.WEATHERWALAY_PASSWORD) {
      const raw = await sharedFeed({username: env.WEATHERWALAY_USERNAME, password: env.WEATHERWALAY_PASSWORD}, Date.now());
      data = name === 'realtime' ? await realtimeWithElevations(raw, {fetcher}) : stationsFromFeed(raw);
    }
  } catch { data = null; }
  if (!data) {
    const copies = await Promise.all([RAW_FEED, PAGES_FEED].map(async base => { try { const r = await fetcher(base + name + '.json', {signal: AbortSignal.timeout(15000)}); return r.ok ? r.json() : null; } catch { return null; } }));
    data = newerFeed(copies[0], copies[1]);
  }
  return data;
}
// Stale-while-revalidate: the station login takes about 10 s, so once a copy exists it is served at once
// and refreshed in the background; only the very first request has to wait.
export async function liveObservation(name, {env = process.env, fetcher = fetch, now = Date.now()} = {}) {
  const hit = memo.get(name);
  if (hit && now - hit.time < TTL[name]) return hit.data;
  if (!inflight.has(name)) {
    const job = pull(name, {env, fetcher}).then(data => { if (data) memo.set(name, {time: now, data}); return data; }).finally(() => inflight.delete(name));
    inflight.set(name, job);
  }
  return hit ? hit.data : inflight.get(name);
}
export const warmObservations = options => Promise.all(['metar', 'stations', 'realtime'].map(name => liveObservation(name, options)));
