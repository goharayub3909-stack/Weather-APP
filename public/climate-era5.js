// ERA5 reanalysis (via the free Open-Meteo historical API), ECMWF forecast and station reads.
// Missing values stay null; nothing is zero-filled.
import {gridPoints, daysInMonth} from './climate-hazards.js';
import {fetchFeed} from './observation-feed.js';
import {fetchStationFeed} from './station-feed.js';
const finite = v => typeof v === 'number' && Number.isFinite(v);

export const ERA5 = {first: 1940, delayDays: 6, historyFrom: 1991};
const DAILY = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum';
const pad = n => String(n).padStart(2, '0');
export const pktDate = (time = Date.now()) => new Date(time + 5 * 3600000).toISOString().slice(0, 10);
const shiftDate = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
// ERA5 reaches about five days behind today; later dates come back empty, so selection stops here.
export const latestERA5Date = (now = Date.now()) => shiftDate(pktDate(now), -ERA5.delayDays);

export function era5URL(lat, lon, start, end) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({latitude: lat, longitude: lon, start_date: start, end_date: end, models: 'era5', daily: DAILY, timezone: 'Asia/Karachi'});
  return url;
}
export function forecastDailyURL(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude: lat, longitude: lon, models: 'ecmwf_ifs025', daily: DAILY, past_days: 2, forecast_days: 7, timezone: 'Asia/Karachi'});
  return url;
}
export function parseDaily(json) {
  const d = json?.daily;
  if (!d || !Array.isArray(d.time)) throw Error('Climate data response had no daily values.');
  const pick = key => (d[key] || []).map(v => finite(v) ? v : null);
  return {time: d.time, tmax: pick('temperature_2m_max'), tmin: pick('temperature_2m_min'), tmean: pick('temperature_2m_mean'), precip: pick('precipitation_sum'), elevation: finite(json.elevation) ? json.elevation : null};
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, {once: true});
});
// The free service rate-limits bursts with HTTP 429; wait and retry a few times before giving up.
export const RETRY_WAITS_MS = [2500, 6000, 12000, 20000];
export async function getJSON(url, signal) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)});
    if (r.ok) return r.json();
    if (r.status === 429 && attempt < RETRY_WAITS_MS.length) { await sleep(RETRY_WAITS_MS[attempt], signal); continue; }
    throw Error(r.status === 429 ? 'The climate data service is busy (HTTP 429). Try again in a minute.' : 'Climate data service returned HTTP ' + r.status + '.');
  }
}

// One request returns 1991 to the latest ERA5 day: the normals, the hazard record and the chosen date all come from it.
// The shared request never carries one caller's abort signal (that would fail every later caller);
// each caller instead stops waiting when its own signal aborts. Results are also kept in the browser
// (IndexedDB) until the next ERA5 day, so reopening a place costs no request at all.
const historyCache = new Map();
export function withSignal(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()), {once: true});
    promise.then(resolve, reject);
  });
}
const abortError = () => Object.assign(Error('Request cancelled.'), {name: 'AbortError'});
const store = {
  db: null,
  open() {
    this.db ??= new Promise(resolve => {
      try {
        const req = indexedDB.open('weatherwalay-climate', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('history');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return this.db;
  },
  async get(key) {
    const db = await this.open();
    return db ? new Promise(resolve => { const r = db.transaction('history').objectStore('history').get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); }) : null;
  },
  async set(key, value) {
    const db = await this.open();
    if (!db) return;
    try { const tx = db.transaction('history', 'readwrite'); tx.objectStore('history').clear(); tx.objectStore('history').put(value, key); } catch { /* storage full or blocked: carry on without it */ }
  },
};
export function fetchHistory(lat, lon, signal, now = Date.now()) {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2) + '|' + latestERA5Date(now);
  if (!historyCache.has(key)) {
    const pending = (async () => {
      const saved = await store.get(key);
      if (saved?.time?.length) return saved;
      const daily = parseDaily(await getJSON(era5URL(lat, lon, ERA5.historyFrom + '-01-01', latestERA5Date(now))));
      store.set(key, daily);
      return daily;
    })();
    historyCache.set(key, pending);
    pending.catch(() => historyCache.delete(key));
  }
  return withSignal(historyCache.get(key), signal);
}
// A date before the base period (1940 to 1990) is fetched on its own.
export async function fetchRange(lat, lon, start, end, signal) {
  return parseDaily(await getJSON(era5URL(lat, lon, start, end), signal));
}
export async function fetchForecast(lat, lon, signal) {
  return parseDaily(await getJSON(forecastDailyURL(lat, lon), signal));
}

// ---- map grid ----
export const GRID_STEP = {day: 1, month: 1, year: 2};
export function periodRange(mode, year, month, day) {
  if (mode === 'day') { const d = `${year}-${pad(month)}-${pad(day)}`; return [d, d]; }
  if (mode === 'month') return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`];
  return [`${year}-01-01`, `${year}-12-31`];
}
const mean = a => { const v = a.filter(finite); return v.length >= 0.8 * a.length && v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const sum = a => { const v = a.filter(finite); return v.length >= 0.8 * a.length && v.length ? v.reduce((x, y) => x + y, 0) : null; };
export function aggregateCell(daily) {
  return {tmax: mean(daily.tmax), tmin: mean(daily.tmin), tmean: mean(daily.tmean), precip: sum(daily.precip), days: daily.time.length};
}
const gridCache = new Map();
export async function fetchGrid(mode, year, month, day, signal, onProgress = () => {}) {
  const cacheKey = [mode, ...periodRange(mode, year, month, day)].join('|');
  if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);
  const result = await fetchGridUncached(mode, year, month, day, signal, onProgress);
  gridCache.set(cacheKey, result);
  return result;
}
async function fetchGridUncached(mode, year, month, day, signal, onProgress) {
  const points = gridPoints(GRID_STEP[mode]), [start, end] = periodRange(mode, year, month, day), size = 40, cells = [];
  for (let i = 0; i < points.length; i += size) {
    const chunk = points.slice(i, i + size);
    const url = era5URL(chunk.map(p => p[0]).join(','), chunk.map(p => p[1]).join(','), start, end);
    const json = await getJSON(url, signal), list = Array.isArray(json) ? json : [json];
    list.forEach((item, k) => { const daily = parseDaily(item); cells.push({lat: chunk[k][0], lon: chunk[k][1], elevation: daily.elevation, ...aggregateCell(daily)}); });
    onProgress(Math.min(points.length, i + size), points.length);
    await sleep(400, signal);
  }
  return {cells, step: GRID_STEP[mode], start, end};
}

// ---- stations ----
export async function fetchObservations(signal) {
  const [stations, metars] = await Promise.all([fetchStationFeed({signal}).catch(() => null), fetchFeed('metar', {signal}).catch(() => null)]);
  return {stations, metars};
}
