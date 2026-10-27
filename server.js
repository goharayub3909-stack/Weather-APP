import http from 'node:http';
import {validateSoilFeed} from './public/soil-sensors.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const cache = new Map();
export { forecastURL } from './public/weather.js';
import { forecastURL } from './public/weather.js';
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
    const files = { '/explorer/': ['explorer/index.html','text/html'], '/explorer/index.html': ['explorer/index.html','text/html'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/cities.js': ['cities.js', 'text/javascript'], '/weather.js': ['weather.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/tailwind.css': ['tailwind.css', 'text/css'] };
    let file = files[url.pathname];
    if (['/radar.js','/radar-core.js','/satellite.js','/satellite-core.js','/lightning.js','/city-images.js','/locations.js','/location-worker.js','/map-utils.js','/maps.js','/observations.js','/place-photos.js','/geolocation.js','/icons.js','/storms.js','/farmers.js','/health-engine.js','/farm-workspace.js','/health-panel.js','/farm-data.js','/farm-advice.js','/current-weather.js','/agri-dss.js','/agri-models.js','/farm-satellite.js','/farm-indices.js','/farm-monitoring.js','/field-workspace.js','/tile-help.js','/virtual-sensors.js','/disease-risk.js','/disease-panel.js','/station-history.js','/field-context.js','/field-operations.js','/crop-manual.js','/crop-manual-data.js','/soil-sensors.js','/storm-outlook.js'].includes(url.pathname)) file=[url.pathname.slice(1),'text/javascript'];
    if (/^\/(vendor|radar-data|satellite-data|city-data|location-data|observation-data|studio-data|station-history|sensor-data|storm-data|disease-images)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) {
      const relative=url.pathname.slice(1);
      const path=resolve(root,relative);
      const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain','.csv':'text/csv'};
      if(path.startsWith(root)&&types[extname(path)])file=[relative,types[extname(path)]];
    }
    if (['/pest-criteria.json','/agri-reference.json','/pakistan-guidance.json','/maps-config.json'].includes(url.pathname)) file=[url.pathname.slice(1),'application/json'];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    try { res.setHeader('Content-Type', `${file[1]}; charset=utf-8`); res.end(await readFile(root + file[0])); }
    catch { res.writeHead(500); res.end('Unable to load application'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('WeatherWalay Kissan & Sehat Hub listening on port ' + (process.env.PORT || 3000)));
