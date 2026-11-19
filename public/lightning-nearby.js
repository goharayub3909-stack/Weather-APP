// Observed lightning near a place, from the same live strike buffer as the Lightning map. A strike is a
// measurement, so unlike the ECMWF thunder signal it says a storm is active now. It supports only the
// immediate outlook: it is not a forecast. The radius and window are screening conventions (thunder is
// usually heard within about 15 km of a strike, so 25 km means "a storm close enough to matter").
import {cleanStrikes, BUFFER_URL} from './lightning.js';
import {distanceKm} from './current-weather.js';
export const NEARBY = {radiusKm: 25, windowMin: 60, keepMin: 180};

export async function fetchStrikes({signal, fetcher = fetch, now = Date.now()} = {}) {
  const r = await fetcher(BUFFER_URL, {cache: 'no-store', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)])});
  if (!r.ok) throw Error('Lightning feed HTTP ' + r.status);
  const d = await r.json();
  if (!Array.isArray(d.strikes)) throw Error('Lightning feed malformed');
  return cleanStrikes(d.strikes).filter(s => now - s.time <= NEARBY.keepMin * 60000 && s.time - now <= 300000);
}
export function nearbyStrikes(strikes, lat, lon, now = Date.now(), {radiusKm = NEARBY.radiusKm, windowMin = NEARBY.windowMin} = {}) {
  let count = 0, nearest = null, latest = null;
  for (const s of strikes || []) {
    const age = now - s.time;
    if (age < -300000 || age > windowMin * 60000) continue;
    const d = distanceKm(lat, lon, s);
    if (d > radiusKm) continue;
    count++;
    if (nearest === null || d < nearest) nearest = d;
    if (latest === null || s.time > latest) latest = s.time;
  }
  return {count, nearest, latest, radiusKm, windowMin};
}
