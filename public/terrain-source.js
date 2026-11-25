// Terrain-aware choice of the observation that serves a place. The ECMWF forecast itself is left as supplied.
//
// Temperature falls about 6.5 K per km of height (ICAO standard atmosphere), so a report from a place 500 m
// lower is wrong by more than 3 K. Distance alone is therefore not enough in hills: Murree (about 2,200 m)
// must not be served from Islamabad (about 520 m) however close it is on the map. The class limits below are
// screening conventions (no official standard): they are tuned so that the height difference allowed is worth
// roughly 0.65 to 1.3 K, and the distance shrinks as the surrounding relief grows.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export const LAPSE_K_PER_KM = 6.5;
export const TERRAIN = {
  sameLocalityKm: 3,                           // inside this distance a report is the same town, whatever the map point's height
  sameLocalityDz: 300,                          // a steep town spans this much height within a km or two (Murree: 2,002 m to 2,246 m)
  ringKm: 10,                                   // relief is measured on a ring of points this far from the place
  classes: [
    {name: 'plain', maxRelief: 150, stationKm: 50, metarKm: 100, dz: 200},
    {name: 'hilly', maxRelief: 500, stationKm: 25, metarKm: 40, dz: 150},
    {name: 'mountainous', maxRelief: Infinity, stationKm: 15, metarKm: 25, dz: 100},
  ],
};
export function ringPoints(lat, lon, km = TERRAIN.ringKm) {
  const dLat = km / 111.19, dLon = km / (111.19 * Math.cos(lat * Math.PI / 180));
  const pts = [[lat, lon]];
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; pts.push([lat + dLat * Math.cos(a), lon + dLon * Math.sin(a)]); }
  return pts;
}
export function terrainProfile(elevation, ringElevations) {
  if (!finite(elevation)) return null;
  const all = [elevation, ...(ringElevations || []).filter(finite)], relief = Math.max(...all) - Math.min(...all);
  const cls = TERRAIN.classes.find(c => relief < c.maxRelief);
  return {elevation, relief, ...cls};
}
// May this report stand in for the place? An unknown height only passes on plains.
export function representative(profile, kind, distanceKm, elevation) {
  if (!profile) return distanceKm <= (kind === 'station' ? 50 : 100);
  if (distanceKm > (kind === 'station' ? profile.stationKm : profile.metarKm)) return false;
  if (!finite(elevation)) return profile.name === 'plain';
  return Math.abs(elevation - profile.elevation) <= (distanceKm <= TERRAIN.sameLocalityKm ? Math.max(profile.dz, TERRAIN.sameLocalityDz) : profile.dz);
}

// ---- elevation lookups (Open-Meteo, 90 m DEM) ----
const key = (lat, lon) => lat.toFixed(2) + ',' + lon.toFixed(2);
// Heights never change, so they are kept in the browser as well; a rate-limited request then costs nothing next time.
const STORE = 'ww-elevations-v1';
export const elevationCache = new Map((() => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } })());
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify([...elevationCache].slice(-4000))); } catch { /* private mode: memory only */ } };
export const cachedElevation = (lat, lon) => elevationCache.get(key(lat, lon));
// A height already known from another source (the station elevations in realtime.json come from the same Open-Meteo terrain model) is used
// as it is, so those stations cost no lookup. A value already cached for the place is kept.
export function seedElevation(lat, lon, metres) {
  if (finite(lat) && finite(lon) && finite(metres) && !elevationCache.has(key(lat, lon))) elevationCache.set(key(lat, lon), metres);
}
export async function fetchElevations(points, {fetcher = fetch, signal} = {}) {
  const missing = [...new Map(points.filter(([la, lo]) => finite(la) && finite(lo) && !elevationCache.has(key(la, lo))).map(([la, lo]) => [key(la, lo), [la, lo]])).values()];
  for (let i = 0; i < missing.length; i += 100) {
    const part = missing.slice(i, i + 100);
    const url = new URL('https://api.open-meteo.com/v1/elevation');
    url.search = new URLSearchParams({latitude: part.map(p => p[0].toFixed(4)).join(','), longitude: part.map(p => p[1].toFixed(4)).join(',')});
    for (let attempt = 0; attempt < 2; attempt++) try {
      const r = await fetcher(url, {signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)])});
      if (!r.ok) { await new Promise(res => setTimeout(res, 1500)); continue; }
      const out = (await r.json()).elevation;
      if (Array.isArray(out)) part.forEach((p, j) => { if (finite(out[j])) elevationCache.set(key(p[0], p[1]), out[j]); });
      persist();
      break;
    } catch { /* leave unknown: callers treat a missing height conservatively */ }
  }
  return points.map(([la, lo]) => cachedElevation(la, lo));
}
