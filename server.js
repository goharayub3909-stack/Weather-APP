import http from 'node:http';
import {validateSoilFeed} from './public/soil-sensors.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const cache = new Map();
export { forecastURL } from './public/weather.js';
import { forecastURL } from './public/weather.js';
import { liveObservation, warmObservations } from './scripts/observation-sync.mjs';
// Local secrets (git-ignored .env) are optional: without them the dev server serves published copies.
try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch { /* no .env file */ }
export function createServer(fetcher = fetch) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if(url.pathname==='/sensor-data/config.json'&&process.env.SOIL_SENSOR_FEED_URL){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({schema_version:1,feed:'../api/soil-sensors'}));}
    if(url.pathname==='/api/soil-sensors'){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(!process.env.SOIL_SENSOR_FEED_URL)return res.end(JSON.stringify({schema_version:1,status:'not_configured',devices:[]}));
      try{const target=new URL(process.env.SOIL_SENSOR_FEED_URL);if(target.protocol!=='https:')throw Error();const headers=process.env.SOIL_SENSOR_API_KEY?{Authorization:'Bearer '+process.env.SOIL_SENSOR_API_KEY}:{};const upstream=await fetcher(target,{headers,signal:AbortSignal.timeout(10000)});if(!upstream.ok)throw Error();return res.end(JSON.stringify(validateSoilFeed(await upstream.json())));}catch{res.writeHead(502);return res.end(JSON.stringify({error:'Soil sensor bridge unavailable; no readings inferred.'}));}
    }
    if (url.pathname === '/api/forecast') {
      res.setHeader('Content-Type', 'application/json');
      let target;
      try { target = forecastURL(Number(url.searchParams.get('lat') ?? NaN), Number(url.searchParams.get('lon') ?? NaN)); }
      catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
      try {
        const key = target.href, saved = cache.get(key);
        if (saved && Date.now() - saved.time < 900000) return res.end(JSON.stringify(saved.data));
        const upstream = await fetcher(target, { signal: AbortSignal.timeout(15000) });
        if (!upstream.ok) throw new Error(`Provider returned ${upstream.status}`);
        const data = await upstream.json();
        if (!data.daily?.time?.length || !data.hourly?.time?.length) throw new Error('Incomplete provider response');
        const result = { ...data, fetched_at: new Date().toISOString(), source: 'ECMWF via Open-Meteo' };
        cache.set(key, { time: Date.now(), data: result });
        return res.end(JSON.stringify(result));
      } catch {
        res.writeHead(502);
        return res.end(JSON.stringify({ error: 'Live forecast is unavailable. Please retry shortly. Network access to api.open-meteo.com is required.' }));
      }
    }
    // Dev only: serve live airport reports (NOAA) and stations (WeatherWalay login from .env, else the newest
    // published copy) so localhost is not stuck on the snapshot committed to git. Falls through to the file.
    const feedName = /^\/observation-data\/(stations|metar|realtime)\.json$/.exec(url.pathname)?.[1];
    if (feedName && process.env.LIVE_OBSERVATIONS !== 'off') {
      const live = await liveObservation(feedName, { fetcher });
      if (live) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.end(JSON.stringify(live)); }
    }
    const files = { '/realtime/': ['realtime/index.html','text/html'], '/realtime/index.html': ['realtime/index.html','text/html'], '/explorer/': ['explorer/index.html','text/html'], '/explorer/index.html': ['explorer/index.html','text/html'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/cities.js': ['cities.js', 'text/javascript'], '/weather.js': ['weather.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/tailwind.css': ['tailwind.css', 'text/css'] };
    let file = files[url.pathname];
    if (['/sw.js','/pwa.js','/radar.js','/radar-core.js','/satellite.js','/satellite-core.js','/lightning.js','/city-images.js','/locations.js','/location-worker.js','/map-utils.js','/maps.js','/observations.js','/place-photos.js','/geolocation.js','/icons.js','/storms.js','/farmers.js','/health-engine.js','/farm-workspace.js','/health-panel.js','/observation-feed.js','/station-feed.js','/station-records.js','/terrain-source.js','/lightning-nearby.js','/hail.js','/forecast-periods.js','/views.js','/climate-hazards.js','/climate-era5.js','/climate-panel.js','/flood-logic.js','/flood-terrain.js','/flood-model.js','/flood-data.js','/flood-chart.js','/flood-panel.js','/flood-eo.js','/flood-eo-panel.js','/farm-data.js','/farm-advice.js','/current-weather.js','/agri-dss.js','/agri-models.js','/farm-satellite.js','/farm-indices.js','/farm-monitoring.js','/field-workspace.js','/tile-help.js','/virtual-sensors.js','/disease-risk.js','/disease-panel.js','/station-history.js','/field-context.js','/field-operations.js','/crop-manual.js','/crop-manual-data.js','/soil-sensors.js','/storm-outlook.js'].includes(url.pathname)) file=[url.pathname.slice(1),'text/javascript'];
    if (/^\/(vendor|radar-data|satellite-data|city-data|location-data|observation-data|studio-data|terrain-data|explorer|realtime|station-history|sensor-data|storm-data|disease-images|icons)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) {
      const relative=url.pathname.slice(1);
      const path=resolve(root,relative);
      const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain','.csv':'text/csv'};
      if(path.startsWith(root)&&types[extname(path)])file=[relative,types[extname(path)]];
    }
    if (['/pest-criteria.json','/agri-reference.json','/pakistan-guidance.json','/maps-config.json'].includes(url.pathname)) file=[url.pathname.slice(1),'application/json'];
    if (url.pathname==='/manifest.webmanifest') file=['manifest.webmanifest','application/manifest+json'];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    try { res.setHeader('Content-Type', `${file[1]}; charset=utf-8`); res.end(await readFile(root + file[0])); }
    catch { res.writeHead(500); res.end('Unable to load application'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => { console.log('WeatherWalay Kissan & Sehat Hub listening on port ' + (process.env.PORT || 3000)); if (process.env.LIVE_OBSERVATIONS !== 'off') warmObservations(); });
