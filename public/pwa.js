// Registers the service worker (sw.js) so the site and the 3D explorer can open offline, and says so when the network is gone.
// Only on https: on localhost a worker would serve stale scripts while the code is being edited. `?pwa=1` or localStorage ww-pwa=1 turns it on there for testing.
export function pwaEnabled(loc, storage) {
  if (loc.protocol === 'https:') return true;
  let stored = null;
  try { stored = storage?.getItem('ww-pwa'); } catch { /* storage blocked */ }
  return /[?&]pwa=1(&|$)/.test(loc.search || '') || stored === '1';
}
export const OFFLINE_TEXT = 'No connection. Showing what was saved on this device; forecasts and station readings may be old.';

export function offlineBanner(doc, online) {
  let bar = doc.getElementById('ww-offline');
  if (online) { if (bar) bar.hidden = true; return null; }
  if (!bar) {
    bar = doc.createElement('div');
    bar.id = 'ww-offline'; bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;padding:8px 16px;background:#7c2d12;color:#fff;font:14px/1.3 system-ui,sans-serif;text-align:center';
    bar.textContent = OFFLINE_TEXT;
    doc.body.appendChild(bar);
  }
  bar.hidden = false;
  return bar;
}

export async function startPwa(win = globalThis.window) {
  if (!win || !('serviceWorker' in win.navigator)) return null;
  let stored = false;                                                          // the worker last answered from its store: no usable connection, whatever navigator.onLine says
  const update = () => offlineBanner(win.document, win.navigator.onLine !== false && !stored);
  win.addEventListener('online', update); win.addEventListener('offline', update); update();
  win.navigator.serviceWorker.addEventListener?.('message', e => {
    if (e.data?.type === 'ww-stored') stored = true; else if (e.data?.type === 'ww-live') stored = false; else return;
    update();
  });
  if (!pwaEnabled(win.location, win.localStorage)) return null;
  try { return await win.navigator.serviceWorker.register('sw.js'); } catch { return null; }     // a failed registration only means no offline copy
}
if (typeof window !== 'undefined' && !globalThis.__WW_TEST__) startPwa();
