import http from 'node:http';
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
    const files = { '/explorer/': ['explorer/index.html','text/html'], '/explorer/index.html': ['explorer/index.html','text/html'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/cities.js': ['cities.js', 'text/javascript'], '/weather.js': ['weather.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    let file = files[url.pathname];
    if (['/radar.js','/radar-core.js','/satellite.js','/satellite-core.js','/lightning.js','/city-images.js','/locations.js','/location-worker.js','/map-utils.js','/maps.js','/observations.js','/place-photos.js','/geolocation.js','/icons.js','/storms.js','/farmers.js','/farm-data.js','/farm-advice.js','/current-weather.js','/agri-dss.js','/agri-models.js','/farm-satellite.js'].includes(url.pathname)) file=[url.pathname.slice(1),'text/javascript'];
    if (/^\/(vendor|radar-data|satellite-data|city-data|location-data|observation-data|studio-data)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) {
      const relative=url.pathname.slice(1);
      const path=resolve(root,relative);
      const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain'};
      if(path.startsWith(root)&&types[extname(path)])file=[relative,types[extname(path)]];
    }
    if (['/pest-criteria.json','/agri-reference.json'].includes(url.pathname)) file=[url.pathname.slice(1),'application/json'];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    try { res.setHeader('Content-Type', `${file[1]}; charset=utf-8`); res.end(await readFile(root + file[0])); }
    catch { res.writeHead(500); res.end('Unable to load application'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Pakistan Weather listening on port ' + (process.env.PORT || 3000)));
