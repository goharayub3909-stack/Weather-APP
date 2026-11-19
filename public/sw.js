'use strict';
// WeatherWalay service worker: keeps what the person has already opened so the site, the 3D explorer and the last forecast open without a network
// (field use, for example in Shimshal). Nothing is fetched ahead of time except the small shell below; a map tile or data file is stored when it is first used.
//   pages and our own data files   network first (8 s), the stored copy only when the network fails or is too slow: live data is never replaced by old data while online;
//                                  pages are told which it was ('ww-live' or 'ww-stored') so the offline banner does not depend on navigator.onLine
//   scripts, styles, images        stale while revalidate: shown at once from the store, refreshed in the background
//   map tiles (AWS terrain, Esri imagery, OpenStreetMap)   cache first, capped; Google Map Tiles are never stored (their terms do not allow it)
//   forecast and other APIs, uploads, range requests   not touched
// Rules live in strategyFor() and are tested in test/pwa.test.js. Bump VERSION to drop every stored copy.
const VERSION = 'v1';
const CACHES = {shell: 'ww-shell-' + VERSION, data: 'ww-data-' + VERSION, tiles: 'ww-tiles-' + VERSION};
const MAX_ENTRIES = {shell: 300, data: 200, tiles: 800};                       // oldest entries go first (screening choice, about 150 MB at the most for the tiles)
const NETWORK_TIMEOUT_MS = 8000;
const DATA_DIRS = ['observation-data', 'terrain-data', 'radar-data', 'satellite-data', 'storm-data', 'sensor-data', 'city-data', 'location-data', 'station-history'];
const TILE_HOSTS = [{host: 's3.amazonaws.com', prefix: '/elevation-tiles-prod/'}, {host: 'server.arcgisonline.com', prefix: '/ArcGIS/rest/services/World_Imagery/'},
  {host: 'tile.openstreetmap.org', prefix: '/'}];
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'explorer/index.html', 'realtime/index.html'];

// The path of a URL below the worker's own folder (the site may live in a project sub-folder), or null for another origin.
function localPath(url, base) {
  if (url.origin !== base.origin) return null;
  return url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : url.pathname.replace(/^\//, '');
}

// 'bypass', 'network-first', 'stale-while-revalidate' or 'cache-first', and the cache it belongs to.
function strategyFor(request, base) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !/^https?:$/.test(url.protocol)) return {strategy: 'bypass'};
  if (request.headers && request.headers.get && request.headers.get('range')) return {strategy: 'bypass'};
  const path = localPath(url, base);
  if (path === null) {
    const tile = TILE_HOSTS.find(t => t.host === url.hostname && url.pathname.startsWith(t.prefix));
    return tile ? {strategy: 'cache-first', cache: 'tiles'} : {strategy: 'bypass'};
  }
  if (path.startsWith('api/')) return {strategy: 'bypass'};
  if (request.mode === 'navigate' || path === '' || /\.html?$/.test(path)) return {strategy: 'network-first', cache: 'shell'};
  if (DATA_DIRS.some(d => path.startsWith(d + '/'))) return {strategy: 'network-first', cache: 'data'};
  if (path.endsWith('.webmanifest') || path === 'sw.js') return {strategy: 'network-first', cache: 'shell'};
  return {strategy: 'stale-while-revalidate', cache: 'shell'};
}

// A response worth keeping: a complete, same-origin or CORS answer (never an opaque one, an error or a partial range).
const storable = r => !!r && r.status === 200 && r.type !== 'opaque' && r.type !== 'error';

async function trim(name, max) {
  const cache = await caches.open(name), keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
async function keep(kind, request, response) {
  if (!storable(response)) return;
  const cache = await caches.open(CACHES[kind]);
  await cache.put(request, response.clone());
  await trim(CACHES[kind], MAX_ENTRIES[kind]);
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });
}

// Tell every open page whether the last network-first answer was live or a stored copy (a device can report "online" on a weak or captive connection
// where nothing loads), so pwa.js can say that what is shown may be old.
const tell = type => self.clients.matchAll({includeUncontrolled: true}).then(list => list.forEach(c => c.postMessage({type}))).catch(() => {});
// A page that is still being opened is not a client yet when its own navigation is answered: wait for it (event.resultingClientId) and tell it alone.
async function tellNavigation(event, type) {
  if (!event.resultingClientId) return tell(type);
  for (let i = 0; i < 20; i++) {
    const client = await self.clients.get(event.resultingClientId).catch(() => null);
    if (client) { client.postMessage({type}); return; }
    await new Promise(r => setTimeout(r, 150));
  }
}

async function networkFirst(request, kind, say) {
  const cache = await caches.open(CACHES[kind]);
  try {
    const live = fetch(request);
    const response = await withTimeout(live, NETWORK_TIMEOUT_MS).catch(async e => {
      const stored = await cache.match(request);
      if (!stored) return live;                                                   // nothing stored: keep waiting for the network
      live.then(r => keep(kind, request, r), () => {});                           // a slow answer still refreshes the store
      throw e;
    });
    await keep(kind, request, response);
    if (response.ok) say('ww-live');
    return response;
  } catch (e) {
    const stored = await cache.match(request);
    if (stored) { say('ww-stored'); return stored; }
    throw e;
  }
}
async function staleWhileRevalidate(request, kind) {
  const cache = await caches.open(CACHES[kind]), stored = await cache.match(request);
  const refresh = fetch(request).then(async r => { await keep(kind, request, r); return r; });
  if (stored) { refresh.catch(() => {}); return stored; }
  return refresh;
}
async function cacheFirst(request, kind) {
  const cache = await caches.open(CACHES[kind]), stored = await cache.match(request);
  if (stored) return stored;
  const response = await fetch(request);
  await keep(kind, request, response);
  return response;
}
async function handle(request, base, say = tell) {
  const {strategy, cache} = strategyFor(request, base);
  if (strategy === 'network-first') return networkFirst(request, cache, say);
  if (strategy === 'stale-while-revalidate') return staleWhileRevalidate(request, cache);
  if (strategy === 'cache-first') return cacheFirst(request, cache);
  return fetch(request);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHES.shell);
    await Promise.all(SHELL_FILES.map(f => cache.add(new Request(new URL(f, self.registration.scope).href, {cache: 'reload'})).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const live = new Set(Object.values(CACHES));
    for (const name of await caches.keys()) if (name.startsWith('ww-') && !live.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const base = new URL(self.registration.scope);
  if (strategyFor(event.request, base).strategy === 'bypass') return;              // the browser handles it as if there were no worker
  const say = type => { event.waitUntil(event.request.mode === 'navigate' ? tellNavigation(event, type) : tell(type)); };
  event.respondWith(handle(event.request, base, say));
});

if (typeof globalThis.__WW_TEST__ !== 'undefined') globalThis.__WW_SW__ = {strategyFor, handle, tellNavigation, localPath, storable, trim, CACHES, MAX_ENTRIES, VERSION, SHELL_FILES};
