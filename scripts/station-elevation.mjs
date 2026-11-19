// Station elevations. The WeatherWalay realtime feed has name, latitude and longitude for every station but no height, so the
// height of the terrain at each position is looked up (Open-Meteo elevation API, a 90 m terrain model) and cached by station id.
// It is the height of the ground in the model at that point, not a surveyed station height: a station on a roof or in a valley
// can differ by tens of metres, and the label says so.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ELEVATION_SOURCE = 'Open-Meteo elevation API (90 m terrain model at the station position, not a surveyed height)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function loadElevationCache(file) {
  try { const d = JSON.parse(await readFile(file, 'utf8')); return new Map(Object.entries(d.elevations || {}).filter(([, v]) => Number.isFinite(v))); } catch { return new Map(); }
}
export async function saveElevationCache(file, cache) {
  await mkdir(dirname(file instanceof URL ? fileURLToPath(file) : file), {recursive: true});
  await writeFile(file, JSON.stringify({source: ELEVATION_SOURCE, retrieved_at: new Date().toISOString(), elevations: Object.fromEntries([...cache].sort((a, b) => Number(a[0]) - Number(b[0])))}) + '\n');
}
// Looks up only the ones missing from the cache (a Map of id to metres), 100 per request, retrying on rate limits.
// Returns the number looked up. A failed batch leaves its stations without a height; nothing is guessed.
// stations: [{key, lat, lon}] where key is the station's stable key (its id, or name and position when the feed has no id).
export async function fillElevations(stations, cache, {fetcher = fetch, pause = 700} = {}) {
  const missing = stations.filter(s => !cache.has(s.key) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  let found = 0;
  for (let i = 0; i < missing.length; i += 100) {
    const part = missing.slice(i, i + 100), q = new URLSearchParams({latitude: part.map(s => s.lat.toFixed(5)).join(','), longitude: part.map(s => s.lon.toFixed(5)).join(',')});
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetcher('https://api.open-meteo.com/v1/elevation?' + q, {signal: AbortSignal.timeout(30000)});
        if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
        if (!r.ok) break;
        const e = (await r.json()).elevation;
        if (Array.isArray(e) && e.length === part.length) part.forEach((s, k) => { if (Number.isFinite(e[k])) { cache.set(s.key, Math.round(e[k] * 10) / 10); found++; } });
        break;
      } catch { await sleep(1500 * (attempt + 1)); }
    }
    if (i + 100 < missing.length) await sleep(pause);
  }
  return found;
}
