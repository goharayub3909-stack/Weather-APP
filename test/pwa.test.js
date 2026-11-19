import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {pwaEnabled, offlineBanner, startPwa, OFFLINE_TEXT} from '../public/pwa.js';
import {createServer} from '../server.js';

const pub = f => new URL('../public/' + f, import.meta.url);
const text = f => readFileSync(pub(f), 'utf8');
const pngSize = f => { const b = readFileSync(pub(f)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the manifest is valid and its icons exist at the sizes it states', () => {
  const m = JSON.parse(text('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color']) assert.ok(m[k], k);
  assert.equal(m.display, 'standalone');
  assert.match(m.description, /not an official forecast/i);
  assert.ok(m.icons.some(i => i.purpose === 'maskable') && m.icons.some(i => i.purpose === 'any' && i.sizes === '192x192') && m.icons.some(i => i.purpose === 'any' && i.sizes === '512x512'));
  for (const i of m.icons) { const [w, h] = i.sizes.split('x').map(Number); assert.deepEqual(pngSize(i.src), [w, h], i.src); assert.equal(i.type, 'image/png'); }
});

test('the page links the manifest and icons and loads the registration module', () => {
  const html = text('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/icon-192\.png">/);
  assert.match(html, /<script type="module" src="pwa\.js"><\/script>/);
  assert.match(html, /<meta name="theme-color" content="#0b1220">/);
});

test('the worker is registered on https, and on http only when asked for', () => {
  const store = v => ({getItem: () => v});
  assert.equal(pwaEnabled({protocol: 'https:', search: ''}, store(null)), true);
  assert.equal(pwaEnabled({protocol: 'http:', search: ''}, store(null)), false);                       // localhost: no stale scripts while editing
  assert.equal(pwaEnabled({protocol: 'http:', search: '?a=1&pwa=1'}, store(null)), true);
  assert.equal(pwaEnabled({protocol: 'http:', search: '?pwa=10'}, store(null)), false);
  assert.equal(pwaEnabled({protocol: 'http:', search: ''}, store('1')), true);
  assert.equal(pwaEnabled({protocol: 'http:', search: ''}, {getItem() { throw Error('blocked'); }}), false);
  assert.equal(pwaEnabled({protocol: 'http:', search: ''}, undefined), false);
});

const fakeDoc = () => {
  const els = new Map();
  return {body: {appendChild: e => els.set(e.id, e)}, getElementById: id => els.get(id) || null, els,
    createElement: () => ({style: {}, setAttribute() {}, set id(v) { this._id = v; }, get id() { return this._id; }, hidden: false, textContent: ''})};
};
test('the offline banner appears once, says the data may be old, and hides when the network returns', () => {
  const doc = fakeDoc();
  assert.equal(offlineBanner(doc, true), null);                                                         // online and no banner yet: nothing
  const bar = offlineBanner(doc, false);
  assert.equal(bar.textContent, OFFLINE_TEXT); assert.match(OFFLINE_TEXT, /may be old/); assert.equal(bar.hidden, false);
  assert.equal(offlineBanner(doc, false), bar); assert.equal(doc.els.size, 1);                          // not added twice
  offlineBanner(doc, true); assert.equal(bar.hidden, true);
  offlineBanner(doc, false); assert.equal(bar.hidden, false);
});

test('startPwa registers sw.js on https, shows the banner when offline, and never throws', async () => {
  const listeners = {}, calls = [], swListeners = {};
  const win = (protocol, online, register) => ({navigator: {onLine: online, serviceWorker: {addEventListener: (t, f) => { swListeners[t] = f; }, register: async u => { calls.push(u); return register ? {scope: 'x'} : Promise.reject(Error('no')); }}},
    location: {protocol, search: ''}, localStorage: {getItem: () => null}, document: fakeDoc(), addEventListener: (t, f) => { listeners[t] = f; }});
  assert.deepEqual(await startPwa(win('https:', true, true)), {scope: 'x'}); assert.deepEqual(calls, ['sw.js']);
  assert.equal(await startPwa(win('http:', true, true)), null); assert.equal(calls.length, 1);                  // no worker on plain http
  assert.equal(await startPwa(win('https:', true, false)), null);                                               // failed registration
  const w = win('https:', false, true); await startPwa(w);
  assert.equal(w.document.getElementById('ww-offline').hidden, false);                                          // offline at start
  w.navigator.onLine = true; listeners.online(); assert.equal(w.document.getElementById('ww-offline').hidden, true);
  // the worker says it served a stored copy although the device reports it is online (weak or captive connection)
  const c = win('https:', true, true); await startPwa(c);
  assert.equal(c.document.getElementById('ww-offline'), null);
  swListeners.message({data: {type: 'ww-stored'}}); assert.equal(c.document.getElementById('ww-offline').hidden, false);
  swListeners.message({data: {type: 'something-else'}}); assert.equal(c.document.getElementById('ww-offline').hidden, false);
  swListeners.message({data: {type: 'ww-live'}}); assert.equal(c.document.getElementById('ww-offline').hidden, true);
  swListeners.message({data: null}); assert.equal(c.document.getElementById('ww-offline').hidden, true);
  assert.equal(await startPwa({navigator: {}}), null);                                                          // no service worker support
  assert.equal(await startPwa(undefined), null);
});

// ---- the worker itself, run in a sandbox with a mock cache store and a mock network ----
class CacheMock {
  constructor() { this.m = new Map(); }
  async match(req) { const r = this.m.get(req.url ?? req); return r ? r.clone() : undefined; }
  async put(req, res) { this.m.delete(req.url); this.m.set(req.url, res); }
  async add(req) { this.m.set(req.url, await sandbox.fetch(req)); }
  async keys() { return [...this.m.keys()].map(url => ({url})); }
  async delete(req) { return this.m.delete(req.url); }
}
let sandbox, listeners, stores, net;
const sent = [];                                                                                          // messages the worker posted to its pages
function boot() {
  stores = new Map(); listeners = {}; net = {online: true, delay: 0, calls: [], status: 200, type: 'basic', body: 'live'};
  const realSet = setTimeout;
  sandbox = {URL, Request, Response, Headers, Promise, Map, Set, Array, Object, Error, console, __WW_TEST__: true, clearTimeout,
    setTimeout: (fn, ms) => realSet(fn, Math.min(ms, 25)),                                                       // the 8 s network limit becomes 25 ms
    caches: {open: async n => stores.get(n) || stores.set(n, new CacheMock()).get(n), keys: async () => [...stores.keys()], delete: async n => stores.delete(n)},
    fetch: async req => {
      net.calls.push(req.url ?? req);
      if (!net.online) throw new TypeError('offline');
      if (net.delay) await new Promise(r => realSet(r, net.delay));
      const res = new Response(net.body, {status: net.status}); if (net.type !== 'basic') Object.defineProperty(res, 'type', {value: net.type}); return res;
    }};
  sandbox.self = sandbox;
  Object.assign(sandbox, {registration: {scope: 'https://site.test/app/'}, skipWaiting: async () => {}, clients: {claim: async () => {}},
    addEventListener: (t, f) => { listeners[t] = f; }});
  sent.length = 0; sandbox.clients.matchAll = async () => [{postMessage: m => sent.push(m.type)}];
  vm.runInNewContext(readFileSync(pub('sw.js'), 'utf8'), sandbox);
  return sandbox.__WW_SW__;
}
const req = (url, extra = {}) => ({url, method: 'GET', mode: 'cors', headers: new Headers(), ...extra});
const BASE = new URL('https://site.test/app/');

test('worker: which requests it handles and how', () => {
  const sw = boot(), s = (u, e) => sw.strategyFor(req(u, e), BASE);
  assert.deepEqual({...s('https://site.test/app/', {mode: 'navigate'})}, {strategy: 'network-first', cache: 'shell'});
  assert.deepEqual({...s('https://site.test/app/explorer/index.html')}, {strategy: 'network-first', cache: 'shell'});
  assert.deepEqual({...s('https://site.test/app/observation-data/realtime.json')}, {strategy: 'network-first', cache: 'data'});
  assert.deepEqual({...s('https://site.test/app/terrain-data/grid-hires.json')}, {strategy: 'network-first', cache: 'data'});
  assert.deepEqual({...s('https://site.test/app/terrain-data/grid-1km/steps/tr-000.png')}, {strategy: 'network-first', cache: 'data'});
  assert.deepEqual({...s('https://site.test/app/vendor/three/three.module.js')}, {strategy: 'stale-while-revalidate', cache: 'shell'});
  assert.deepEqual({...s('https://site.test/app/app.js')}, {strategy: 'stale-while-revalidate', cache: 'shell'});
  assert.deepEqual({...s('https://site.test/app/manifest.webmanifest')}, {strategy: 'network-first', cache: 'shell'});
  assert.deepEqual({...s('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/90/50.png')}, {strategy: 'cache-first', cache: 'tiles'});
  assert.deepEqual({...s('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/200/300')}, {strategy: 'cache-first', cache: 'tiles'});
  assert.deepEqual({...s('https://tile.openstreetmap.org/5/20/12.png')}, {strategy: 'cache-first', cache: 'tiles'});
  // never touched
  assert.equal(s('https://tile.googleapis.com/v1/2dtiles/1/2/3?key=x').strategy, 'bypass');                      // Google Map Tiles terms: never stored
  assert.equal(s('https://api.open-meteo.com/v1/forecast?x=1').strategy, 'bypass');                               // forecasts are not replayed from the store
  assert.equal(s('https://s3.amazonaws.com/other-bucket/file.png').strategy, 'bypass');
  assert.equal(s('https://site.test/app/api/forecast?lat=1&lon=2').strategy, 'bypass');
  assert.equal(s('https://site.test/app/app.js', {method: 'POST'}).strategy, 'bypass');
  assert.equal(s('https://site.test/app/terrain-data/levels/p850.json', {headers: new Headers({range: 'bytes=0-9'})}).strategy, 'bypass');
  assert.equal(s('chrome-extension://abc/x.js').strategy, 'bypass');
  assert.equal(sw.localPath(new URL('https://site.test/app/a/b.js'), BASE), 'a/b.js');
  assert.equal(sw.localPath(new URL('https://other.test/app/a/b.js'), BASE), null);
});

test('worker: only complete, readable answers are stored', () => {
  const sw = boot();
  assert.equal(sw.storable({status: 200, type: 'basic'}), true); assert.equal(sw.storable({status: 200, type: 'cors'}), true);
  for (const r of [{status: 200, type: 'opaque'}, {status: 404, type: 'basic'}, {status: 500, type: 'basic'}, {status: 206, type: 'basic'}, {status: 200, type: 'error'}, null]) assert.equal(sw.storable(r), false);
});

test('worker: network first keeps the newest copy and falls back to it offline or when the network is too slow', async () => {
  const sw = boot(), r = req('https://site.test/app/observation-data/realtime.json');
  net.body = 'v1';
  assert.equal(await (await sw.handle(r, BASE)).text(), 'v1');                                                    // online: the live answer, and it is stored
  net.body = 'v2';
  assert.equal(await (await sw.handle(r, BASE)).text(), 'v2');                                                    // online again: never the old copy
  assert.equal(await (await stores.get(sw.CACHES.data).match(r)).text(), 'v2');
  assert.deepEqual([...new Set(sent)], ['ww-live']); sent.length = 0;                                             // online: the pages are told the data is live
  net.online = false;
  assert.equal(await (await sw.handle(r, BASE)).text(), 'v2');                                                    // offline: the stored copy
  assert.deepEqual(sent, ['ww-stored']); sent.length = 0;                                                         // and told it is a stored one
  net.online = true; net.delay = 200; net.body = 'v3';
  assert.equal(await (await sw.handle(r, BASE)).text(), 'v2');                                                    // far too slow: the stored copy
  await new Promise(res => setTimeout(res, 300));
  assert.equal(await (await stores.get(sw.CACHES.data).match(r)).text(), 'v3');                                   // and the slow answer refreshed the store when it arrived
  net.delay = 0; net.status = 500; sent.length = 0;
  assert.equal((await sw.handle(r, BASE)).status, 500);                                                           // an error answer is passed on, not stored
  assert.deepEqual(sent, []);                                                                                     // and is not announced as live
  assert.equal(await (await stores.get(sw.CACHES.data).match(r)).text(), 'v3');
  const never = req('https://site.test/app/observation-data/never-seen.json'); net.online = false;
  await assert.rejects(sw.handle(never, BASE), /offline/);                                                        // nothing stored, no network: the failure shows
});

test('worker: slow network with nothing stored keeps waiting for the network', async () => {
  const sw = boot(); net.delay = 120; net.body = 'late';
  assert.equal(await (await sw.handle(req('https://site.test/app/observation-data/new.json'), BASE)).text(), 'late');
});

test('worker: scripts and styles come from the store at once and are refreshed in the background', async () => {
  const sw = boot(), r = req('https://site.test/app/farmers.js');
  net.body = 'code v1';
  assert.equal(await (await sw.handle(r, BASE)).text(), 'code v1');                                               // first visit: network
  net.body = 'code v2'; net.calls.length = 0;
  assert.equal(await (await sw.handle(r, BASE)).text(), 'code v1');                                               // second: the stored copy at once
  await new Promise(res => setTimeout(res, 20));
  assert.equal(net.calls.length, 1);                                                                              // while the network is asked
  assert.equal(await (await sw.handle(r, BASE)).text(), 'code v2');                                               // third: the refreshed copy
  net.online = false;
  assert.equal(await (await sw.handle(r, BASE)).text(), 'code v2');                                               // offline: still there
  await assert.rejects(sw.handle(req('https://site.test/app/not-stored.js'), BASE), /offline/);
});

test('worker: map tiles are fetched once, and an opaque or failed tile is not kept', async () => {
  const sw = boot(), tile = req('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/90/50.png');
  net.body = 'png';
  await sw.handle(tile, BASE); await sw.handle(tile, BASE); await sw.handle(tile, BASE);
  assert.equal(net.calls.length, 1);                                                                              // cache first
  net.online = false; assert.equal(await (await sw.handle(tile, BASE)).text(), 'png');                            // and it works offline
  net.online = true; net.calls.length = 0;
  const odd = req('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/1/1');
  net.type = 'opaque'; await sw.handle(odd, BASE); await sw.handle(odd, BASE);
  assert.equal(net.calls.length, 2);                                                                              // not stored: asked again
  net.type = 'basic'; net.status = 404; net.calls.length = 0; await sw.handle(odd, BASE); await sw.handle(odd, BASE);
  assert.equal(net.calls.length, 2);
});

test('worker: the oldest entries go when a store is full', async () => {
  const sw = boot(), c = await sandbox.caches.open('ww-test');
  for (const n of [1, 2, 3, 4, 5]) await c.put({url: 'https://site.test/' + n}, new Response(String(n)));
  await sw.trim('ww-test', 3);
  assert.deepEqual((await c.keys()).map(k => k.url.slice(-1)), ['3', '4', '5']);
  await sw.trim('ww-test', 10);
  assert.equal((await c.keys()).length, 3);
  assert.ok(sw.MAX_ENTRIES.tiles >= 500 && sw.MAX_ENTRIES.data >= 100);
});

test('worker: a page that is still opening is told, alone, once it exists as a client', async () => {
  const sw = boot();
  const toPage = [], toOthers = [];
  let calls = 0;
  sandbox.clients.get = async id => (id === 'new-page' && ++calls >= 3 ? {postMessage: m => toPage.push(m.type)} : undefined);     // the client appears on the third look
  sandbox.clients.matchAll = async () => [{postMessage: m => toOthers.push(m.type)}];
  const page = req('https://site.test/app/', {mode: 'navigate'});
  net.body = '<html>page</html>';
  const waits = [];
  const fire = async (request, resultingClientId) => {
    listeners.fetch({request, resultingClientId, waitUntil: p => waits.push(p), respondWith: p => { waits.push(p); }});
    while (waits.length) await Promise.all(waits.splice(0));                                                  // the answer, then the messages it triggered
  };
  await fire(page, 'new-page');
  assert.deepEqual(toPage, ['ww-live']); assert.deepEqual(toOthers, []);                                                    // live answer: only the new page hears it
  toPage.length = 0; calls = 0; net.online = false;
  await fire(page, 'new-page');
  assert.deepEqual(toPage, ['ww-stored']);                                                                                 // offline: the stored page, and it is told so
  const data = req('https://site.test/app/observation-data/realtime.json'); net.online = true; net.body = '{}'; await fire(data); net.online = false; toOthers.length = 0;
  await fire(data);
  assert.deepEqual(toOthers, ['ww-stored']);                                                                               // an ordinary request tells every open page
  assert.equal(await sw.tellNavigation({}, 'ww-stored'), undefined); assert.deepEqual(toOthers, ['ww-stored', 'ww-stored']);   // without a client id it falls back to everyone
});

test('worker events: requests it does not handle are left to the browser; activation removes only its own old stores', async () => {
  const sw = boot();
  let responded = null;
  const fire = request => { responded = null; listeners.fetch({request, respondWith: p => { responded = p; }}); return responded; };
  assert.equal(fire(req('https://api.open-meteo.com/v1/forecast')), null);
  assert.equal(fire(req('https://site.test/app/app.js', {method: 'POST'})), null);
  assert.equal(fire(req('https://tile.googleapis.com/v1/2dtiles/1/2/3')), null);
  net.body = 'x'; const p = fire(req('https://site.test/app/app.js')); assert.ok(p); assert.equal(await (await p).text(), 'x');
  for (const n of ['ww-shell-v0', 'ww-data-v0', 'unrelated-cache', sw.CACHES.shell]) await sandbox.caches.open(n);
  let done; listeners.activate({waitUntil: p => { done = p; }}); await done;
  assert.deepEqual([...stores.keys()].sort(), ['unrelated-cache', sw.CACHES.shell].sort());
  net.body = 'page';
  let installed; listeners.install({waitUntil: p => { installed = p; }}); await installed;
  const shell = await (await sandbox.caches.open(sw.CACHES.shell)).keys();
  assert.ok(shell.some(k => k.url === 'https://site.test/app/') && shell.some(k => k.url === 'https://site.test/app/index.html'));
});

test('the dev server serves the worker, the manifest and the icons with the right types', async () => {
  const server = createServer(async () => { throw Error('no network'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sw = await fetch(base + '/sw.js'); assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/); assert.match(await sw.text(), /ww-shell-/);
    const pwa = await fetch(base + '/pwa.js'); assert.equal(pwa.status, 200); assert.match(pwa.headers.get('content-type'), /javascript/);
    const man = await fetch(base + '/manifest.webmanifest'); assert.equal(man.status, 200); assert.match(man.headers.get('content-type'), /application\/manifest\+json/);
    assert.equal(JSON.parse(await man.text()).short_name, 'WeatherWalay');
    const icon = await fetch(base + '/icons/icon-192.png'); assert.equal(icon.status, 200); assert.match(icon.headers.get('content-type'), /image\/png/);
    assert.equal((await fetch(base + '/icons/nothing.png')).status, 500);
  } finally { await new Promise(r => server.close(r)); }
});
