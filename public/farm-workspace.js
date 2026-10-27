// Immersive Farmers workspace: full-screen map, weather ticker, layer card, action sidebar and
// a bottom sheet that holds the detailed panels. Existing panels are MOVED, not rebuilt, so every
// element id, listener and stored setting keeps working. Styling uses Tailwind utilities scoped to #fw-root.
import { sprayStatusByHour, operationWindows } from './field-operations.js';
import { farmInstant } from './farm-advice.js';

const $ = (id) => document.getElementById(id);
const finite = Number.isFinite;
const HOUR = 3600000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonStore = (name) => ({
  all() { try { return JSON.parse(localStorage.getItem(name)) || {}; } catch { return {}; } },
  set(key, value) {
    const all = this.all();
    if (value === undefined || value === null || value === '') delete all[key]; else all[key] = value;
    const keys = Object.keys(all);
    while (keys.length > 40) delete all[keys.shift()];
    try { localStorage.setItem(name, JSON.stringify(all)); } catch { /* storage full or blocked */ }
  },
});
const triageStore = jsonStore('weatherwalay-triage-v1');
const decisionStore = jsonStore('weatherwalay-decisions-v1');
const photoStore = jsonStore('weatherwalay-scout-photos-v1');
const prefStore = jsonStore('weatherwalay-workspace-v1');

/* ------------------------------------------------------------------ pure helpers (unit tested) */
export const SEVERITY = { high: { rank: 0, label: 'High' }, moderate: { rank: 1, label: 'Watch' } };

/** Split pest / disease results into active alerts (high, moderate), low-risk and not-assessable. */
export function triageItems(items, statuses = {}, placeKey = '') {
  const open = [], low = [], unknown = [];
  for (const it of items || []) {
    const level = it.outlook?.level, key = placeKey + '|' + it.id;
    if (level === 'high' || level === 'moderate') open.push({ ...it, level, status: statuses[key] || 'new', key });
    else if (level === 'low' || level === 'none') low.push(it);
    else unknown.push(it);
  }
  open.sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || SEVERITY[a.level].rank - SEVERITY[b.level].rank || (b.outlook.hits || 0) - (a.outlook.hits || 0));
  return { open, low, unknown };
}

/** Group consecutive hours with the given state into [{start,end}] ranges (end exclusive, ms). */
export function groupRuns(hours, state = 'ok') {
  const runs = []; let cur = null;
  for (const h of hours) {
    if (h.state === state) {
      if (cur && h.time === cur.end) cur.end += HOUR; else { if (cur) runs.push(cur); cur = { start: h.time, end: h.time + HOUR }; }
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}

const pkDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
const pkHour = (t) => Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }));
const pad = (n) => String(n).padStart(2, '0');
export function dayWord(t, now = Date.now()) {
  const d = (Date.parse(pkDate(t) + 'T00:00:00+05:00') - Date.parse(pkDate(now) + 'T00:00:00+05:00')) / 86400000;
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(t).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short' });
}
export function fmtRange(start, end, now = Date.now()) { return `${dayWord(start, now)} ${pad(pkHour(start))}:00–${pad(pkHour(end))}:00`; }

/** Everything the weather ticker shows, from the hourly forecast. Returns null without usable data. */
export function tickerData(hourly, now = Date.now()) {
  if (!hourly?.time?.length) return null;
  const anchor = Math.floor(now / HOUR) * HOUR;
  const rows = hourly.time.map((t, i) => ({ time: farmInstant(t), t: hourly.temperature_2m?.[i], wind: hourly.wind_speed_10m?.[i], gust: hourly.wind_gusts_10m?.[i], rain: hourly.precipitation?.[i] }))
    .filter((r) => finite(r.time) && r.time >= anchor).sort((a, b) => a.time - b.time);
  if (!rows.length) return null;
  const next24 = rows.slice(0, 24), next72 = rows.slice(0, 72), temps = next24.map((r) => r.t).filter(finite), t72 = next72.map((r) => r.t).filter(finite);
  let rainEvent = null;
  for (let i = 0; i < next72.length && !rainEvent; i++) {
    if (finite(next72[i].rain) && next72[i].rain >= 0.2) {
      let j = i, mm = 0;
      while (j < next72.length && finite(next72[j].rain) && next72[j].rain >= 0.2) { mm += next72[j].rain; j++; }
      rainEvent = { start: next72[i].time, end: next72[j - 1].time + HOUR, mm };
    }
  }
  const hours = sprayStatusByHour(hourly, now, 48), daylight = hours.filter((h) => h.hour >= 6 && h.hour < 18);
  const first = daylight[0], chips = first ? daylight.filter((h) => pkDate(h.time) === pkDate(first.time)) : [];
  return {
    now: rows[0], temps24: temps, hi: temps.length ? Math.max(...temps) : null, lo: temps.length ? Math.min(...temps) : null,
    rain24: next24.reduce((a, r) => a + (finite(r.rain) ? r.rain : 0), 0), rainBars: next24.map((r) => (finite(r.rain) ? r.rain : 0)), rainEvent,
    min72: t72.length ? Math.min(...t72) : null, max72: t72.length ? Math.max(...t72) : null,
    spray: { chips, runs: groupRuns(hours, 'ok'), dayWord: first ? dayWord(first.time, now).toLowerCase() : '' },
  };
}

/* ------------------------------------------------------------------ layers offered on the map */
const PRIMARY_LAYERS = [['rgb', 'True colour'], ['fcc', 'False colour'], ['ndvi', 'NDVI'], ['evi', 'EVI'], ['evi2', 'EVI2'], ['ndwi', 'NDWI'], ['nri', 'NRI'], ['dswi', 'DSWI']];
const MORE_LAYERS = [['ndre', 'NDRE'], ['savi', 'SAVI'], ['msavi', 'MSAVI'], ['ndmi', 'NDMI'], ['lst', 'LST'], ['smi', 'SMI']];
const LAYER_HINT = { rgb: 'Natural colour', fcc: 'Healthy crops show red', ndvi: 'Greenness', evi: 'Greenness, dense crops', evi2: 'EVI without blue band', ndwi: 'Surface water', nri: 'Nitrogen status', dswi: 'Water / disease stress' };

/* ------------------------------------------------------------------ DOM */
const TEMPLATE = `
<div id="fw-map-layer" class="absolute inset-0"></div>

<div id="fw-ticker" role="region" aria-label="Weather ticker" class="absolute inset-x-0 top-0 z-30 border-b border-slate-600 bg-slate-950/95 backdrop-blur">
  <div class="flex items-stretch gap-2 overflow-x-auto px-3 py-1.5" id="fw-ticker-row">
    <button id="fw-menu-btn" type="button" aria-expanded="false" aria-controls="fw-menu" aria-label="Open menu" class="grid h-auto min-h-[56px] w-12 shrink-0 place-items-center rounded-xl border border-slate-600 bg-slate-900 text-xl text-white hover:bg-slate-800">☰</button>
    <button id="fw-setup-btn" type="button" aria-expanded="false" aria-controls="fw-setup" class="flex min-w-[10rem] shrink-0 flex-col justify-center rounded-xl border border-slate-600 bg-slate-900 px-3 py-1 text-left hover:bg-slate-800">
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-300">Field setup ▾</span>
      <span id="fw-setup-label" class="text-base font-bold text-white">Choose crop</span>
    </button>
    <div id="fw-ticker-widgets" class="flex items-stretch gap-2"></div>
  </div>
</div>

<nav id="fw-menu" hidden aria-label="Site menu" class="absolute left-3 z-40 w-56 rounded-2xl border border-slate-500 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl" style="top:calc(var(--fw-ticker) + .5rem)"></nav>

<div id="fw-setup" hidden role="dialog" aria-label="Field setup" class="absolute left-3 z-40 max-h-[calc(100%-var(--fw-ticker)-1.5rem)] w-[min(34rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-slate-500 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl" style="top:calc(var(--fw-ticker) + .5rem)">
  <div class="mb-3 flex items-center justify-between"><h2 class="text-base font-bold text-white">Field setup</h2><button id="fw-setup-close" type="button" class="min-h-[44px] rounded-lg border border-slate-500 px-3 text-sm font-semibold text-white hover:bg-slate-800">Done</button></div>
  <div id="fw-setup-body" class="space-y-3"></div>
</div>

<section id="fw-layer-card" aria-label="Raster layers" class="absolute left-3 z-20 flex w-[min(22rem,calc(100%-1.5rem))] flex-col rounded-2xl border border-slate-500/60 bg-slate-950/75 shadow-2xl shadow-black/60 backdrop-blur-xl" style="top:calc(var(--fw-ticker) + .75rem);max-height:calc(100% - var(--fw-ticker) - var(--fw-sheet) - 1.5rem)">
  <button id="fw-card-toggle" type="button" aria-expanded="true" aria-controls="fw-card-body" class="flex min-h-[56px] w-full items-center gap-3 px-4 text-left">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-400/15 text-lg text-emerald-300" aria-hidden="true">◈</span>
    <span class="min-w-0 flex-1"><span class="block text-[11px] font-bold uppercase tracking-wider text-slate-300">Raster layers</span><span id="fw-card-title" class="block truncate text-base font-semibold text-white">Choose a layer</span></span>
    <span id="fw-card-chevron" class="text-slate-200 transition-transform" aria-hidden="true">⌄</span>
  </button>
  <div id="fw-card-body" class="space-y-3 overflow-y-auto px-4 pb-4">
    <div id="fw-layer-buttons" role="group" aria-label="Raster layer" class="grid grid-cols-2 gap-2"></div>
    <details id="fw-more-layers" class="rounded-xl border border-slate-600 bg-slate-900/70"><summary class="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-semibold text-white">More indices</summary><div id="fw-more-buttons" role="group" aria-label="More indices" class="grid grid-cols-3 gap-2 p-2"></div></details>
    <div id="fw-legend-slot"></div>
    <div id="fw-actions-slot"></div>
    <p id="fw-status-slot" class="text-xs leading-snug text-slate-200"></p>
    <button id="fw-report-btn" type="button" class="min-h-[44px] w-full rounded-xl border border-slate-500 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800">Field report, trend &amp; timeline ↓</button>
    <details id="fw-imagery" class="rounded-xl border border-slate-600 bg-slate-900/70"><summary class="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-semibold text-white">Satellite, date &amp; display</summary><div id="fw-imagery-body" class="space-y-3 p-3"></div></details>
  </div>
</section>

<div id="fw-point-slot" class="absolute z-10 w-[min(22rem,calc(100%-1.5rem))]" style="right:calc(var(--fw-sidebar) + .75rem);bottom:calc(var(--fw-sheet) + 6.25rem)"></div>

<aside id="fw-sidebar" aria-label="Actions" class="absolute bottom-0 right-0 z-20 transition-transform duration-300 ease-out motion-reduce:transition-none" style="top:var(--fw-ticker);width:var(--fw-sidebar-w)">
  <button id="fw-sidebar-toggle" type="button" aria-expanded="true" aria-controls="fw-sidebar-body" aria-label="Hide actions panel" class="absolute left-[-3rem] top-4 flex h-14 w-12 items-center justify-center rounded-l-xl border border-r-0 border-slate-500/70 bg-slate-950/95 text-xl text-white shadow-xl backdrop-blur"><span id="fw-toggle-icon">›</span><span id="fw-toggle-badge" class="absolute -left-2 -top-2 grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-red-500 px-1 text-xs font-bold text-white"></span></button>
  <div id="fw-sidebar-body" class="grid h-full grid-rows-2 border-l border-slate-500/60 bg-slate-950/90 backdrop-blur-xl">
    <section aria-labelledby="fw-triage-h" class="flex min-h-0 flex-col border-b border-slate-600">
      <div class="flex items-start justify-between gap-2 px-4 pb-2 pt-3"><div><h2 id="fw-triage-h" class="text-base font-bold text-white">Pest &amp; disease triage</h2><p id="fw-triage-sub" class="text-xs text-slate-300"></p></div><button id="fw-guide-btn" type="button" class="min-h-[40px] shrink-0 rounded-lg border border-slate-500 px-3 text-xs font-semibold text-white hover:bg-slate-800">Full guide</button></div>
      <div id="fw-triage-feed" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4" role="feed" aria-busy="true"></div>
    </section>
    <section aria-labelledby="fw-decisions-h" class="flex min-h-0 flex-col">
      <div class="flex items-start justify-between gap-2 px-4 pb-2 pt-3"><div><h2 id="fw-decisions-h" class="text-base font-bold text-white">Field decisions</h2><p id="fw-decisions-sub" class="text-xs text-slate-300">Current stage only</p></div><button id="fw-calendar-btn" type="button" class="min-h-[40px] shrink-0 rounded-lg border border-slate-500 px-3 text-xs font-semibold text-white hover:bg-slate-800">Calendar &amp; soil</button></div>
      <div id="fw-decisions" class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4"></div>
    </section>
  </div>
</aside>

<section id="fw-sheet" aria-label="Detailed panels" class="absolute bottom-0 left-0 z-20 flex flex-col rounded-t-2xl border border-b-0 border-slate-500/70 bg-slate-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl transition-[height] duration-300 ease-out motion-reduce:transition-none" style="height:var(--fw-sheet);right:var(--fw-sheet-right)">
  <div class="flex shrink-0 items-center gap-2 px-2">
    <button id="fw-sheet-toggle" type="button" aria-expanded="false" aria-controls="fw-sheet-body" aria-label="Expand detailed panels" class="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xl text-white hover:bg-slate-800"><span id="fw-sheet-icon">⌃</span></button>
    <div id="fw-tabs-slot" class="min-w-0 flex-1 overflow-x-auto"></div>
  </div>
  <div id="fw-sheet-body" class="min-h-0 flex-1 overflow-y-auto px-3 pb-6 sm:px-5"></div>
</section>`;

const state = { ctx: null, sheet: 'peek', sidebar: true, cardOpen: true, pest: { items: [], loading: true, error: false }, filter: 'open', restore: [] };
let root, started = false;

// Move a node and remember where it came from, so the Weather page gets it back.
function relocate(node, target, { keepHome = false } = {}) {
  if (!node || !target) return;
  if (keepHome) { const marker = document.createComment('fw-home'); node.parentNode.insertBefore(marker, node); state.restore.push([node, marker]); }
  target.append(node);
}
function restoreHomes() { for (const [node, marker] of state.restore.splice(0)) marker.parentNode?.insertBefore(node, marker); }

// Each ticker widget opens the matching detail section in the bottom sheet.
const WIDGET_TARGET = { 'Temperature · 24 h': 'overview|#agri-charts', 'Rain · next 24 h': 'overview|#agri-charts', Wind: 'operations|#field-calendar' };
function widget(label, body, extra = '') {
  const open = WIDGET_TARGET[label] || (/^(Spraying|Best spray)/.test(label) ? 'operations|#field-calendar' : '');
  const inner = `<span class="text-[11px] font-bold uppercase tracking-wider text-slate-300">${label}</span>${body}`, cls = `flex shrink-0 flex-col justify-center rounded-xl border border-slate-600 bg-slate-900 px-3 py-1 ${extra}`;
  return open ? `<button type="button" data-open="${open}" aria-label="Show details: ${label}" class="${cls} text-left hover:bg-slate-800">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
}

function renderTicker() {
  const host = $('fw-ticker-widgets');
  if (!host) return;
  const d = tickerData(state.ctx?.forecast?.hourly);
  if (!d) { host.innerHTML = widget('Weather', '<span class="text-sm text-slate-200">Forecast loading…</span>'); return; }
  const w = d.now, lo = d.lo ?? 0, hi = d.hi ?? 1, span = hi - lo || 1;
  const pts = d.temps24.map((t, k) => `${(k / Math.max(1, d.temps24.length - 1)) * 92 + 2},${26 - ((t - lo) / span) * 22}`).join(' ');
  const bars = d.rainBars.map((r) => `<i class="block w-[5px] rounded-sm ${r > 0 ? 'bg-sky-400' : 'bg-slate-600'}" style="height:${r > 0 ? Math.min(26, 6 + r * 5) : 3}px"></i>`).join('');
  const windOk = finite(w.wind) && w.wind >= 3 && w.wind <= 15;
  const chips = d.spray.chips.map((h) => {
    const cls = h.state === 'ok' ? 'bg-emerald-400 text-slate-950' : h.state === 'check' ? 'bg-amber-300 text-slate-950' : 'bg-red-500 text-white';
    const glyph = h.state === 'ok' ? '✓' : h.state === 'check' ? '!' : '✕';
    const word = h.state === 'ok' ? 'Spray window open' : (h.state === 'check' ? 'Check: ' : 'No spray: ') + h.fails.join(', ');
    return `<span class="flex h-[38px] w-[26px] flex-col items-center justify-center rounded-md ${cls}" title="${pad(h.hour)}:00 · ${esc(word)}" aria-label="${pad(h.hour)}:00 ${esc(word)}"><span class="text-[10px] font-bold leading-none tabular-nums">${pad(h.hour)}</span><span class="text-sm font-black leading-none">${glyph}</span></span>`;
  }).join('');
  const best = d.spray.runs[0];
  const climate = d.min72 !== null && d.min72 <= 2 ? ['Frost risk', 'text-red-300'] : d.max72 !== null && d.max72 >= 35 ? ['Heat stress', 'text-red-300'] : ['No frost or heat trigger', 'text-emerald-300'];
  const rainNote = d.rainEvent ? `${d.rainEvent.mm.toFixed(0)} mm ${fmtRange(d.rainEvent.start, d.rainEvent.end).toLowerCase()}` : 'Dry for 72 h';
  host.innerHTML = [
    widget('Temperature · 24 h', `<span class="flex items-center gap-3"><span class="text-2xl font-bold leading-none tabular-nums text-white">${finite(w.t) ? w.t.toFixed(0) : '–'}°C</span><svg viewBox="0 0 96 28" class="h-7 w-24" role="img" aria-label="Temperature trend, ${lo.toFixed(0)} to ${hi.toFixed(0)} degrees"><polyline points="${pts}" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="text-xs leading-tight text-slate-200 tabular-nums">H ${hi.toFixed(0)}°<br>L ${lo.toFixed(0)}°</span></span>`),
    widget('Rain · next 24 h', `<span class="flex items-center gap-3"><span class="text-2xl font-bold leading-none tabular-nums text-white">${d.rain24.toFixed(d.rain24 ? 1 : 0)}<span class="text-sm font-semibold"> mm</span></span><span class="flex h-7 items-end gap-[2px]" aria-hidden="true">${bars}</span></span><span class="text-xs text-slate-200">${esc(rainNote)}</span>`),
    widget('Wind', `<span class="flex items-center gap-2"><span class="text-2xl font-bold leading-none tabular-nums ${windOk ? 'text-emerald-300' : 'text-amber-300'}">${finite(w.wind) ? w.wind.toFixed(0) : '–'}</span><span class="text-xs leading-tight text-slate-200">km/h<br>gust ${finite(w.gust) ? w.gust.toFixed(0) : '–'}</span></span><span class="text-xs ${windOk ? 'text-emerald-300' : 'text-amber-300'}">${windOk ? 'In spray range (3–15)' : 'Outside spray range'}</span>`),
    widget('Spraying · ' + (d.spray.dayWord || 'next daylight'), `<span class="flex items-center gap-[2px]">${chips || '<span class="text-xs text-slate-200">No daylight hours</span>'}</span>`),
    widget('Best spray window', `<span class="text-base font-bold ${best ? 'text-emerald-300' : 'text-amber-300'}">${best ? esc(fmtRange(best.start, best.end)) : 'No complete window'}</span><span class="text-xs ${climate[1]}">${climate[0]}${d.min72 !== null ? ` · ${d.min72.toFixed(0)}–${d.max72.toFixed(0)}°C` : ''}</span>`, 'min-w-[11rem]'),
  ].join('');
}

/* ------------------------------------------------------------------ layer card */
function layerButton(id, label, large) {
  const select = $('agri-satellite-mode'), option = select ? [...select.options].find((o) => o.value === id) : null;
  const on = select?.value === id, off = !option || option.disabled, b = document.createElement('button');
  b.type = 'button'; b.dataset.layer = id; b.setAttribute('aria-pressed', String(on)); b.disabled = off;
  b.className = `${large ? 'min-h-[52px]' : 'min-h-[44px]'} rounded-xl border px-2 text-left text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-emerald-300 bg-emerald-400 text-slate-950' : 'border-slate-500 bg-slate-900 text-white hover:bg-slate-800'}`;
  b.innerHTML = large ? `<span class="block">${esc(label)}</span><span class="block text-[11px] font-medium ${on ? 'text-slate-800' : 'text-slate-300'}">${esc(LAYER_HINT[id] || '')}</span>` : esc(label);
  b.title = option?.textContent || label;
  b.addEventListener('click', () => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); renderLayerButtons(); });
  return b;
}
function renderLayerButtons() {
  const a = $('fw-layer-buttons'), b = $('fw-more-buttons'), select = $('agri-satellite-mode');
  if (!a || !select) return;
  a.replaceChildren(...PRIMARY_LAYERS.map(([id, l]) => layerButton(id, l, true)));
  b.replaceChildren(...MORE_LAYERS.map(([id, l]) => layerButton(id, l, false)));
  const cur = select.selectedOptions[0]?.textContent || 'Choose a layer', area = ($('agri-field-area')?.textContent || '').match(/[\d.,]+ ha/)?.[0];
  $('fw-card-title').textContent = cur.split(' · ')[0] + (area ? ' · ' + area : '');
}

/* ------------------------------------------------------------------ triage feed */
const placeKey = () => (state.ctx?.place ? state.ctx.place.slice(1).join(',') : '');
const photoKey = (id) => placeKey() + '|' + id;
async function compressPhoto(file) {
  const bmp = await createImageBitmap(file), s = Math.min(1, 640 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c.toDataURL('image/jpeg', 0.72);
}
function renderTriage() {
  const feed = $('fw-triage-feed'), p = state.pest;
  if (!feed) return;
  feed.setAttribute('aria-busy', String(!!p.loading));
  const { open, low, unknown } = triageItems(p.items, triageStore.all(), placeKey()), active = open.filter((i) => i.status !== 'resolved').length;
  $('fw-triage-sub').textContent = p.loading && !p.items.length ? 'Loading weather signals…' : `${active} active · ${low.length} low risk${unknown.length ? ` · ${unknown.length} need data` : ''}`;
  const badge = $('fw-toggle-badge'); badge.textContent = String(active); badge.hidden = active === 0;
  if (!open.length) {
    feed.innerHTML = `<p class="rounded-xl border border-slate-600 bg-slate-900 p-4 text-sm leading-snug text-slate-100">${p.pending || p.loading ? 'Loading pest and disease criteria…' : p.error ? 'Pest weather data could not be loaded. No risk is inferred; try again from the full guide.' : p.none ? 'No supplied pest or disease criteria for this crop. Choose a supported crop in Field setup.' : low.length ? 'No active alerts. Weather conditions do not currently match any pest or disease screen for this crop.' : 'Choose your crop in Field setup to see pest and disease alerts.'}</p>`;
    return;
  }
  feed.innerHTML = open.map((it) => {
    const high = it.level === 'high', done = it.status === 'resolved', photo = photoStore.all()[photoKey(it.id)], o = it.outlook;
    const tone = high ? 'border-red-400 bg-red-950/60' : 'border-amber-300 bg-amber-950/40', bar = high ? 'bg-red-500' : 'bg-amber-300', pill = high ? 'bg-red-500 text-white' : 'bg-amber-300 text-slate-950';
    const ref = it.image ? `<figure class="m-0"><img src="${esc(it.image.src)}" alt="${esc(it.image.caption)}" loading="lazy" class="aspect-video w-full rounded-lg border border-slate-500 object-cover"><figcaption class="mt-1 text-[10px] leading-tight text-slate-300">Reference · <a class="underline" target="_blank" rel="noopener noreferrer" href="${esc(it.image.page)}">${esc(it.image.author)}</a></figcaption></figure>` : `<div class="grid aspect-video place-items-center rounded-lg border border-slate-500 bg-slate-900 text-xs text-slate-300">No reference photo</div>`;
    const mine = photo ? `<div class="relative"><img src="${photo}" alt="Your scouting photo of ${esc(it.name)}" class="aspect-video w-full rounded-lg border border-slate-300 object-cover"><button type="button" data-photo-remove="${esc(it.id)}" aria-label="Remove photo" class="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-slate-950/90 text-lg text-white">×</button></div>` : `<label class="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-400 bg-slate-950/50 px-1 text-center text-slate-100 hover:bg-slate-900"><span class="text-xl" aria-hidden="true">📷</span><span class="text-xs font-bold">Add your photo</span><input type="file" accept="image/*" capture="environment" data-photo-for="${esc(it.id)}" class="sr-only"></label>`;
    return `<article aria-label="${esc((high ? 'High: ' : 'Watch: ') + it.name)}" class="relative overflow-hidden rounded-xl border ${tone} ${done ? 'opacity-60' : ''}"><span class="absolute inset-y-0 left-0 w-1.5 ${bar}"></span><div class="space-y-2 py-3 pl-5 pr-3">
      <div><p class="flex flex-wrap items-center gap-2"><span class="rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${pill}">${high ? 'High' : 'Watch'}</span><span class="text-[11px] font-bold uppercase tracking-wider text-slate-200">${esc(it.crop)}</span>${it.status === 'scouting' ? '<span class="text-[11px] font-bold uppercase text-sky-300">Scouting</span>' : done ? '<span class="text-[11px] font-bold uppercase text-emerald-300">Resolved</span>' : ''}</p><h3 class="mt-1 text-base font-bold leading-snug text-white">${esc(it.name)}</h3>${it.pathogen ? `<p class="text-xs italic text-slate-300">${esc(it.pathogen)}</p>` : ''}</div>
      <p class="text-sm leading-snug text-slate-100">Next 7 days: <strong>${esc(o.label)}</strong>. ${o.hits} matching hours, longest run ${o.longest} h. Past 72 h: ${esc(it.past.label)}.</p>
      <p class="text-xs leading-snug text-slate-300">Weather screen only. Check the field before treating; stage match: ${esc(it.stage || 'not specified')}.</p>
      <div class="grid grid-cols-2 gap-2">${ref}${mine}</div>
      <div class="flex gap-2"><button type="button" data-triage="${esc(it.key)}|scouting" aria-pressed="${it.status === 'scouting'}" class="min-h-[44px] flex-1 rounded-lg border px-2 text-sm font-bold ${it.status === 'scouting' ? 'border-white bg-white text-slate-950' : 'border-slate-300 bg-slate-950/60 text-white hover:bg-slate-900'}">${it.status === 'scouting' ? 'Scouting ✓' : 'Start scouting'}</button><button type="button" data-triage="${esc(it.key)}|resolved" aria-pressed="${done}" class="min-h-[44px] flex-1 rounded-lg border px-2 text-sm font-bold ${done ? 'border-white bg-white text-slate-950' : 'border-slate-300 bg-slate-950/60 text-white hover:bg-slate-900'}">${done ? 'Resolved ✓' : 'Mark resolved'}</button></div><button type="button" data-detail="${esc(it.id)}" class="min-h-[40px] w-full rounded-lg border border-slate-500 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-900">Weather timeline &amp; criteria in the guide ↓</button></div></article>`;
  }).join('');
}

/* ------------------------------------------------------------------ field decisions */
function renderDecisions() {
  const host = $('fw-decisions');
  if (!host) return;
  const wrap = document.createDocumentFragment(), day = pkDate(Date.now());
  const warn = $('field-warning'); if (warn) wrap.append(warn);
  const windows = state.ctx?.forecast?.hourly ? operationWindows(state.ctx.forecast.hourly, Date.now(), { limit: 1 }) : null;
  const card = document.createElement('div');
  card.className = 'space-y-2';
  const ITEMS = [['spray', 'Spraying', 'No complete window in the next 7 days. Conditions or data gaps prevent one.'], ['fertilize', 'Fertilising', 'No complete window. Heavy rain, wind or gaps in the forecast prevent one.'], ['harvest', 'Harvest / drying', 'No complete dry window in the next 7 days.']];
  card.innerHTML = ITEMS.map(([key, title, none]) => {
    const w = windows?.[key]?.[0], id = day + '|' + key, done = !!decisionStore.all()[id];
    return `<div class="flex items-start gap-3 rounded-xl border border-slate-600 bg-slate-900 p-3 ${done ? 'opacity-60' : ''}"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="text-base font-bold text-white ${done ? 'line-through' : ''}">${title}</h3><span class="rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${w ? 'bg-emerald-400 text-slate-950' : 'bg-amber-300 text-slate-950'}">${w ? 'Window open' : 'No window'}</span></div><p class="mt-1 text-sm leading-snug text-slate-100">${w ? esc(fmtRange(w.start, w.end)) + '. Weather screen only; confirm the product label and field conditions.' : none}</p></div><button type="button" role="checkbox" aria-checked="${done}" data-decision="${esc(id)}" aria-label="Mark ${title} done" class="grid h-11 w-11 shrink-0 place-items-center rounded-lg border-2 text-xl font-black ${done ? 'border-emerald-300 bg-emerald-400 text-slate-950' : 'border-slate-400 text-transparent hover:border-white'}">✓</button></div>`;
  }).join('');
  wrap.append(card);
  const manual = $('field-crop-manual'); if (manual) wrap.append(manual);
  host.replaceChildren(wrap);
}

/* ------------------------------------------------------------------ sheet, sidebar, popovers */
function setVars() {
  const w = innerWidth, sheetPx = { peek: 56, half: Math.round(innerHeight * 0.46), full: Math.round(innerHeight - ($('fw-ticker')?.offsetHeight || 84) - 8) }[state.sheet];
  const wide = w >= 1000, sideW = state.sidebar ? Math.min(384, Math.round(w * (wide ? 0.34 : 0.92))) : 0;
  root.style.setProperty('--fw-ticker', ($('fw-ticker')?.offsetHeight || 84) + 'px');
  root.style.setProperty('--fw-sheet', sheetPx + 'px');
  root.style.setProperty('--fw-sidebar-w', Math.min(384, Math.round(w * (wide ? 0.34 : 0.92))) + 'px');
  root.style.setProperty('--fw-sidebar', (wide ? sideW : 0) + 'px');
  root.style.setProperty('--fw-sheet-right', (wide ? sideW : 0) + 'px');
}
function setSheet(next) {
  state.sheet = next; setVars();
  const open = next !== 'peek';
  $('fw-sheet-toggle').setAttribute('aria-expanded', String(open)); $('fw-sheet-toggle').setAttribute('aria-label', open ? 'Collapse detailed panels' : 'Expand detailed panels');
  $('fw-sheet-icon').textContent = next === 'half' ? '⌃' : next === 'full' ? '⌄' : '⌃';
  $('fw-sheet-body').hidden = !open;
  window.dispatchEvent(new Event('resize'));
}
function setSidebar(open) {
  state.sidebar = open; const a = $('fw-sidebar');
  a.classList.toggle('translate-x-full', !open); $('fw-sidebar-toggle').setAttribute('aria-expanded', String(open));
  $('fw-sidebar-toggle').setAttribute('aria-label', open ? 'Hide actions panel' : 'Show actions panel'); $('fw-toggle-icon').textContent = open ? '›' : '‹';
  $('fw-sidebar-body').inert = !open; prefStore.set('sidebar', open ? 1 : 0); setVars(); refit();
}
function openTab(name, target) {
  document.querySelector(`[data-agri-tab="${name}"]`)?.click();
  if (state.sheet === 'peek') setSheet('half');
  if (!target) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector(target);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.classList.add('fw-flash'); setTimeout(() => el.classList.remove('fw-flash'), 1800);
  }));
}
function refit() {
  // Re-centre the field after panels open or close.
  requestAnimationFrame(() => document.getElementById('agri-field-fit')?.click?.());
}
function popover(btnId, panelId, other) {
  const btn = $(btnId), panel = $(panelId);
  const set = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { $(other[0]).hidden = true; $(other[1]).setAttribute('aria-expanded', 'false'); } };
  btn.addEventListener('click', () => set(panel.hidden));
  return set;
}

function buildMenu() {
  const nav = $('fw-menu'), links = [...document.querySelectorAll('.rail nav a')];
  nav.innerHTML = links.map((a) => { const label = (a.querySelector('small')?.textContent || a.textContent).trim(), current = a.hash === '#farmers'; return `<a href="${esc(a.getAttribute('href'))}" ${current ? 'aria-current="page"' : ''} class="flex min-h-[48px] items-center rounded-xl px-3 text-base font-semibold ${current ? 'bg-emerald-400/20 text-emerald-200' : 'text-white hover:bg-slate-800'}">${esc(label)}</a>`; }).join('');
  nav.addEventListener('click', () => { nav.hidden = true; $('fw-menu-btn').setAttribute('aria-expanded', 'false'); });
}

function enterView(active) {
  // The location bar and status line live on the Weather page; borrow them while the workspace is open.
  restoreHomes();
  if (active) {
    const body = $('fw-setup-body');
    relocate(document.querySelector('.location-bar'), body, { keepHome: true });
    relocate($('status'), body, { keepHome: true });
    setVars(); renderLayerButtons(); renderTicker(); renderTriage(); renderDecisions();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
}

export function initFarmWorkspace() {
  const api = { update(ctx) { state.ctx = ctx; if (!started) return; $('fw-setup-label').textContent = [ctx.place?.[0], ctx.crop?.name || 'Choose crop'].filter(Boolean).join(' · '); renderTicker(); renderDecisions(); renderTriage(); } };
  try {
    const view = $('farmers-view'), map = $('agri-satellite-map')?.closest('.farm-map-frame'), dash = document.querySelector('.agri-dashboard');
    if (!view || !map || !dash) return api;
    root = document.createElement('div'); root.id = 'fw-root'; root.innerHTML = TEMPLATE; view.prepend(root);
    state.sidebar = prefStore.all().sidebar === undefined ? innerWidth >= 1000 : !!prefStore.all().sidebar;
    state.cardOpen = true;

    // 1 · the map becomes the background
    $('fw-map-layer').append(map);
    // 2 · layer card: legend, status line, scene/date controls and display settings come with it
    relocate($('agri-index-legend'), $('fw-legend-slot'));
    relocate($('agri-satellite-status'), $('fw-status-slot'));
    const imagery = $('fw-imagery-body'), toolbar = document.querySelector('.crop-toolbar'), display = document.querySelector('.satellite-display-settings');
    relocate(toolbar, imagery); relocate(display, imagery);
    relocate(document.querySelector('.satellite-primary-actions'), $('fw-actions-slot'));
    relocate($('agri-point-panel'), $('fw-point-slot'));
    {
      const slot = $('fw-point-slot'), panel = $('agri-point-panel');
      slot.insertAdjacentHTML('afterbegin', `<div id="fw-point-head" hidden class="flex items-center gap-1 rounded-t-xl border border-slate-500 bg-slate-950/95 px-2 backdrop-blur"><span class="flex-1 px-1 text-xs font-bold uppercase tracking-wider text-slate-200">Point readings</span><button id="fw-point-collapse" type="button" aria-expanded="true" aria-controls="agri-point-panel" aria-label="Collapse point readings" class="grid h-10 w-10 place-items-center rounded-lg text-lg text-white hover:bg-slate-800">⌄</button><button id="fw-point-close" type="button" aria-label="Close point readings" class="grid h-10 w-10 place-items-center rounded-lg text-lg text-white hover:bg-slate-800">×</button></div>`);
      let wasHidden = panel.hidden;
      const sync = () => {
        $('fw-point-head').hidden = panel.hidden;
        if (wasHidden && !panel.hidden) { slot.classList.remove('fw-point-collapsed'); $('fw-point-collapse').setAttribute('aria-expanded', 'true'); $('fw-point-collapse').style.transform = ''; }
        wasHidden = panel.hidden;
      };
      new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] }); sync();
      $('fw-point-collapse').addEventListener('click', () => { const c = slot.classList.toggle('fw-point-collapsed'); $('fw-point-collapse').setAttribute('aria-expanded', String(!c)); $('fw-point-collapse').setAttribute('aria-label', c ? 'Expand point readings' : 'Collapse point readings'); $('fw-point-collapse').style.transform = c ? 'rotate(180deg)' : ''; });
      $('fw-point-close').addEventListener('click', () => { panel.hidden = true; });
    }
    // Rename sheet headings that repeated the main screen (the summary lives there; the sheet holds the detail).
    const renames = { 'Field decisions': 'Calendar, windows & soil', 'Frost & heat warnings': 'Frost & heat alert settings' };
    for (const h of document.querySelectorAll('[data-agri-pane="operations"] h3')) { const t = h.textContent.trim(); if (renames[t]) h.textContent = renames[t]; }
    $('crop-step-2')?.setAttribute('hidden', '');
    // 3 · detailed panels live in the bottom sheet, with renamed tabs
    const tabs = dash.querySelector('[role="tablist"]') || dash.querySelector('.agri-tabs');
    const names = { satellite: 'Field report', operations: 'Field decisions', intelligence: 'Pest & disease', overview: 'Outlook & charts' };
    for (const key of ['satellite', 'operations', 'intelligence', 'overview']) { const b = document.querySelector(`[data-agri-tab="${key}"]`); if (b) { b.textContent = names[key]; tabs.append(b); } }
    $('fw-tabs-slot').append(tabs);
    $('fw-sheet-body').append(dash);
    // 4 · setup popover: crop / stage / zone controls and field context
    relocate($('farm-controls'), $('fw-setup-body')); relocate(document.querySelector('.farm-context-details'), $('fw-setup-body')); relocate($('farm-crop-context'), $('fw-setup-body'));

    buildMenu();
    const closeMenu = popover('fw-menu-btn', 'fw-menu', ['fw-setup', 'fw-setup-btn']), closeSetup = popover('fw-setup-btn', 'fw-setup', ['fw-menu', 'fw-menu-btn']);
    $('fw-setup-close').addEventListener('click', () => closeSetup(false));
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(false); closeSetup(false); } });

    $('fw-card-toggle').addEventListener('click', () => { state.cardOpen = !state.cardOpen; $('fw-card-body').hidden = !state.cardOpen; $('fw-card-toggle').setAttribute('aria-expanded', String(state.cardOpen)); $('fw-card-chevron').style.transform = state.cardOpen ? '' : 'rotate(180deg)'; });
    if (innerWidth < 600) $('fw-card-toggle').click(); // start collapsed on phones
    $('fw-sidebar-toggle').addEventListener('click', () => setSidebar(!state.sidebar));
    $('fw-sheet-toggle').addEventListener('click', () => setSheet(state.sheet === 'peek' ? 'half' : state.sheet === 'half' ? 'full' : 'peek'));
    for (const b of document.querySelectorAll('[data-agri-tab]')) b.addEventListener('click', () => { if (state.sheet === 'peek') setSheet('half'); });
    $('fw-guide-btn').addEventListener('click', () => openTab('intelligence'));
    $('fw-calendar-btn').addEventListener('click', () => openTab('operations', '#field-calendar'));
    $('fw-report-btn').addEventListener('click', () => openTab('satellite', '#agri-field-history-panel'));
    $('fw-ticker-widgets').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { const [tab, target] = b.dataset.open.split('|'); openTab(tab, target); } });
    $('fw-triage-feed').addEventListener('click', (e) => { const d = e.target.closest('[data-detail]'); if (d) openTab('intelligence', `[data-disease="${d.dataset.detail.replace(/"/g, '')}"]`); });
    // stepper: "Satellite data" now lives in the layer card
    document.querySelector('#crop-stepper [data-step="2"] button')?.addEventListener('click', () => { if (!state.cardOpen) $('fw-card-toggle').click(); $('fw-imagery').open = true; $('fw-layer-card').scrollIntoView?.({ block: 'nearest' }); });
    for (const b of document.querySelectorAll('#crop-stepper [data-scroll]')) b.addEventListener('click', () => { if (b.dataset.scroll !== 'crop-step-2' && state.sheet === 'peek') setSheet('half'); }, true);

    // triage actions (delegated)
    $('fw-triage-feed').addEventListener('click', (e) => {
      const t = e.target.closest('[data-triage]'), r = e.target.closest('[data-photo-remove]');
      if (t) { const at = t.dataset.triage.lastIndexOf('|'), key = t.dataset.triage.slice(0, at), status = t.dataset.triage.slice(at + 1); triageStore.set(key, triageStore.all()[key] === status ? '' : status); renderTriage(); }
      if (r) { photoStore.set(photoKey(r.dataset.photoRemove), ''); renderTriage(); }
    });
    $('fw-triage-feed').addEventListener('change', async (e) => {
      const input = e.target.closest('[data-photo-for]'), file = input?.files?.[0];
      if (!file) return;
      try { photoStore.set(photoKey(input.dataset.photoFor), await compressPhoto(file)); } catch { /* unreadable image */ }
      renderTriage();
    });
    $('fw-decisions').addEventListener('click', (e) => { const c = e.target.closest('[data-decision]'); if (c) { decisionStore.set(c.dataset.decision, decisionStore.all()[c.dataset.decision] ? '' : 1); renderDecisions(); } });
    window.addEventListener('farm-disease-results', (e) => { state.pest = e.detail; renderTriage(); });
    // keep layer buttons in step with the real selects
    for (const id of ['agri-satellite-mode', 'agri-satellite-source', 'agri-field-area']) $(id)?.addEventListener('change', renderLayerButtons);
    new MutationObserver(renderLayerButtons).observe($('agri-satellite-mode'), { attributes: true, subtree: true, attributeFilter: ['disabled'] });
    new MutationObserver(renderLayerButtons).observe($('agri-field-area'), { childList: true, characterData: true, subtree: true });
    new ResizeObserver(() => { setVars(); }).observe($('fw-ticker'));
    window.addEventListener('resize', () => { setVars(); });
    setInterval(() => { if (!view.hidden) renderTicker(); }, 300000);
    document.addEventListener('farmviewchange', (e) => enterView(!!e.detail));

    // The satellite map keeps the field clear of the floating panels when it fits bounds.
    window.farmMapAnchor = () => {
      const wide = innerWidth >= 1000, box = $('fw-map-layer').getBoundingClientRect(), card = $('fw-layer-card').getBoundingClientRect();
      const left = wide ? card.right : box.left, right = state.sidebar && wide ? $('fw-sidebar').getBoundingClientRect().left : box.right;
      const top = $('fw-ticker').offsetHeight, bottom = innerHeight - (parseFloat(getComputedStyle(root).getPropertyValue('--fw-sheet')) || 56);
      return L.point((left + right) / 2 - box.left, (top + bottom) / 2 - box.top);
    };
    window.farmMapPadding = (n) => {
      const wide = innerWidth >= 1000, card = $('fw-layer-card').getBoundingClientRect(), side = state.sidebar && wide ? $('fw-sidebar').getBoundingClientRect().width : 0;
      const top = $('fw-ticker').offsetHeight + (wide ? n : (state.cardOpen ? card.height : 56) + n);
      return { paddingTopLeft: [(wide ? Math.round(card.right) : 0) + n, Math.round(top)], paddingBottomRight: [side + n, Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--fw-sheet')) || 56) + n] };
    };

    started = true; setVars(); setSidebar(state.sidebar); setSheet('peek'); renderLayerButtons(); renderTicker(); renderTriage(); renderDecisions();
    document.querySelector('[data-agri-tab="satellite"]')?.click(); setSheet('peek');
    if (location.hash === '#farmers') enterView(true);
    if (state.ctx) api.update(state.ctx);
  } catch (error) {
    console.error('Farm workspace could not start; the standard layout stays in use.', error);
  }
  return api;
}
