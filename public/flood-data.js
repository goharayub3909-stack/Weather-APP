// FloodAI data access: ECMWF hourly rain (Open-Meteo), WeatherWalay rain gauges, free terrain tiles, OSM buildings.
import {getJSON} from './climate-era5.js';
import {hourlySeries} from './flood-logic.js';
import {mosaicFrame, terrainTileURL, TILES, TILE_PX, terrariumHeight} from './flood-terrain.js';
import {isStale} from './observations.js';
import {GAUGE} from './flood-logic.js';

export const RAIN_MODEL = 'ecmwf_ifs025';   // ECMWF only, by design
export function rainURL(lats, lons, {past = 5, days = 4} = {}) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude: [].concat(lats).join(','), longitude: [].concat(lons).join(','), hourly: 'precipitation', models: RAIN_MODEL, past_days: past, forecast_days: days, timezone: 'Asia/Karachi'});
  return url;
}
export const fetchRain = async (lat, lon, signal) => hourlySeries(await getJSON(rainURL(lat, lon), signal));
export async function fetchGaugeModels(points, signal) {
  if (!points.length) return [];
  const json = await getJSON(rainURL(points.map(p => p.lat), points.map(p => p.lon), {past: 1, days: 1}), signal);
  return (Array.isArray(json) ? json : [json]).map(hourlySeries);
}

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Fresh WeatherWalay gauges with a rolling 24 h total near the point. PMD stations report 08:00-08:00 rain,
// a different window from the model's last 24 h, so they are left out of the correction.
export function nearbyGauges(stations, place, now = Date.now()) {
  return (stations || []).filter(s => typeof s.rain_24h === 'number' && s.rain_24h_period === '24 hours before station sync' && !isStale(Date.parse(s.observed_at), false, now))
    .map(s => ({id: s.id, name: s.name, lat: s.lat, lon: s.lon, rain: s.rain_24h, km: km(place, s)}))
    .filter(g => g.km <= GAUGE.maxKm).sort((a, b) => a.km - b.km).slice(0, GAUGE.maxGauges);
}

export async function loadTerrain(lat, lon, signal) {
  const frame = mosaicFrame(lat, lon), elev = new Float32Array(frame.size * frame.size).fill(NaN), canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  let loaded = 0;
  await Promise.all(Array.from({length: TILES * TILES}, async (_, k) => {
    const tx = k % TILES, ty = Math.floor(k / TILES);
    try {
      const r = await fetch(terrainTileURL(frame.z, frame.x0 + tx, frame.y0 + ty), {signal});
      if (!r.ok) return;
      const bitmap = await createImageBitmap(await r.blob(), {colorSpaceConversion: 'none'});
      // one canvas is shared, so draw-and-read must not interleave
      const px = (() => { ctx.clearRect(0, 0, TILE_PX, TILE_PX); ctx.drawImage(bitmap, 0, 0); return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data; })();
      for (let j = 0; j < TILE_PX; j++) for (let i = 0; i < TILE_PX; i++) {
        const o = (j * TILE_PX + i) * 4;
        elev[(ty * TILE_PX + j) * frame.size + tx * TILE_PX + i] = px[o + 3] ? terrariumHeight(px[o], px[o + 1], px[o + 2]) : NaN;
      }
      loaded++;
    } catch (e) { if (signal?.aborted) throw e; }
  }));
  if (!loaded) throw Error('Terrain tiles could not be loaded.');
  return {frame, elev, tilesLoaded: loaded};
}

// OpenStreetMap buildings inside a box: a centre point, the footprint ring (for the 3D view) and the tags
// (type and height) for counting the flooded ones.
export async function fetchBuildings({south, west, north, east}, signal, limit = 5000) {
  const query = `[out:json][timeout:25];way["building"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});out tags geom ${limit};`;
  const json = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query), signal);
  const list = (json.elements || []).filter(e => e.geometry?.length >= 3).map(e => {
    const ring = e.geometry.map(p => [p.lon, p.lat]);
    return {lat: ring.reduce((a, p) => a + p[1], 0) / ring.length, lon: ring.reduce((a, p) => a + p[0], 0) / ring.length, ring, tags: e.tags || {}};
  });
  return {buildings: list, truncated: list.length >= limit};
}
