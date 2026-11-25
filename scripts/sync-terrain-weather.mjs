// Grid of ECMWF IFS (the 9 km model, Open-Meteo "ecmwf_ifs") surface wind, precipitation and snowfall for the
// 3D terrain weather map. The grid is a 0.5 degree sample of the 9 km model, 72 hourly steps from 00 UTC today.
// Run: node scripts/sync-terrain-weather.mjs   (writes public/terrain-data/grid.json; reused when under 6 h old)
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {GRID, nodes, buildDataset, validDataset} from '../public/explorer/core.js';

const OUT = new URL('../public/terrain-data/grid.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {headers: {'User-Agent': 'WeatherWalay terrain weather map (non-commercial display)'}, signal: AbortSignal.timeout(60000)});
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw Error('HTTP ' + r.status);
    } catch (e) { if (attempt === 4) throw e; }
    await sleep(15000 * (attempt + 1));
  }
  throw Error('Open-Meteo unavailable');
}

let old = null;
try { const d = JSON.parse(await readFile(OUT, 'utf8')); if (validDataset(d)) old = d; } catch { /* none yet */ }
if (old && Date.now() - Date.parse(old.retrieved_at) < 6 * 3600000 && !process.argv.includes('--force')) { console.log('Terrain weather grid is under 6 h old: reused.'); process.exit(0); }

try {
  const pts = nodes(), rows = [];
  for (let s = 0; s < pts.length; s += 50) {
    const part = pts.slice(s, s + 50);
    const q = new URLSearchParams({latitude: part.map(p => p[0]).join(','), longitude: part.map(p => p[1]).join(','), hourly: 'wind_speed_10m,wind_direction_10m,precipitation,snowfall,cloud_cover', wind_speed_unit: 'ms', models: 'ecmwf_ifs', forecast_days: '3', timezone: 'UTC', cell_selection: 'nearest'});
    let d = await get('https://api.open-meteo.com/v1/forecast?' + q);
    if (!Array.isArray(d)) d = [d];
    if (d.length !== part.length) throw Error('Incomplete batch');
    rows.push(...d.map(p => p.hourly));
    console.log('terrain weather:', rows.length, '/', pts.length);
    await sleep(2500);
  }
  const data = buildDataset(rows, new Date().toISOString());
  if (!validDataset(data)) throw Error('Dataset failed validation');
  await mkdir(new URL('./', OUT), {recursive: true});
  const tmp = new URL('grid.tmp', OUT);
  await writeFile(tmp, JSON.stringify(data) + '\n');
  await rename(tmp, OUT);
  console.log('Published', pts.length, 'nodes,', data.times.length, 'hours,', GRID.spacing, 'degree grid.');
} catch (e) {
  console.log('Terrain weather refresh unavailable:', e.message, old ? '; the previous grid is kept.' : '');
  process.exit(old ? 0 : 1);
}
