// FloodAI panel on the main dashboard (#flood): ECMWF rain -> SCS losses -> catchment hydrograph from a free DEM,
// return-period what-ifs from ERA5, and a 2D rain-on-grid depth simulation with cross-sections.
// Screening only: not an official flood forecast or warning.
import {
  LAND_COVER, SOIL_GROUPS, curveNumber, amcClass, adjustCN, effectiveRain, annualMaxima, gumbelFit, gumbelQuantile, gumbelReturnPeriod, weibullPoints,
  riskBand, maxRolling, designStorm, gaugeFactor, GAUGE, kirpichHours, unitHydrograph, routeHydrograph, hydrographStats, splitAtNow, parseCrossSection, parseGaugeRecord,
} from './flood-logic.js';
import {downsample, metresPerPixel, fillDepressions, flowDirections, networkOf, catchmentOf, longestPath, pixelOfLatLon, latLonOfPixel, profileBetween} from './flood-terrain.js';
import {createSimulation, floodedStats, depthColor} from './flood-model.js';
import {initEoPanel} from './flood-eo-panel.js';
import {mosaicFrame} from './flood-terrain.js';
import {fetchRain, fetchGaugeModels, nearbyGauges, loadTerrain, fetchBuildings} from './flood-data.js';
import {fetchHistory, fetchObservations} from './climate-era5.js';
import {rainClass} from './climate-hazards.js';
import {drawChart, extent} from './flood-chart.js';
import {darkMap} from './map-utils.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const sum = a => a.reduce((x, y) => x + (finite(y) ? y : 0), 0);
const fmt = (v, d = 1, unit = '') => finite(v) ? v.toFixed(d) + unit : '–';
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const SCENARIOS = [
  {id: 'expected', name: 'Expected (ECMWF)', color: '#38bdf8'}, {id: 'bulletin', name: 'Bulletin rainfall', color: '#34d399'},
  {id: 'rp20', name: '20-year flood rain', color: '#fbbf24'}, {id: 'rp100', name: '100-year flood rain', color: '#f87171'},
];
const BAND_CLASS = ['border-emerald-400/70 bg-emerald-500/20 text-emerald-200', 'border-amber-400/70 bg-amber-500/20 text-amber-200', 'border-orange-400/80 bg-orange-500/25 text-orange-200', 'border-red-400/80 bg-red-500/25 text-red-200'];
const PRESETS = [['Nowshera', 34.015, 71.981], ['Mingora (Swat)', 34.772, 72.36], ['Sukkur', 27.705, 68.857], ['D.G. Khan', 30.049, 70.646]];
const growingSeason = (date = new Date()) => date.getMonth() >= 3 && date.getMonth() <= 9;   // April-October (assumption)
const nowLocal = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 16);
const retArea = (T) => finite(T) ? (T > 100 ? '> 100 yr' : T < 2 ? '< 2 yr' : '~' + (T < 10 ? T.toFixed(1) : Math.round(T)) + ' yr') : '–';

export function initFloodPanel({cities, getSelected}) {
  const root = document.getElementById('flood');
  if (!root) return;
  const c0 = cities[getSelected()];
  const state = {
    place: c0 ? {name: c0[0], lat: c0[1], lon: c0[2]} : {name: 'Lahore', lat: 31.5497, lon: 74.3436},
    days: 2, cover: 'worldcover', soil: 'C', amcMode: 'auto', gaugeOn: true, scenario: 'expected', bulletin: ['', '', '', ''], hide: 0.05, fine: false, view: 'frame',
    layers: {flood: true, streams: true, catchment: false, water: false, buildings: true, river: true, landcover: false, observed: true},
    rain: null, fit: null, maxima: [], gauge: null, terrain: null, work: null, results: {}, base: null,
    sim: null, simSeries: null, frame: 0, playing: false, mode: 'location', section: null, survey: null, importedGauge: null, buildings: null, status: '', error: '', progress: null,
  };
  // A MessageChannel yields to the page without the 1 s timer throttling that background tabs get.
  const yieldTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
  let simToken = null, started = false, map, pointMarker, domainBox, overlays = {}, jrc, buildingLayer, sectionLayer, pointCtl, playTimer, buildingCtl;

  // ---------- skeleton ----------
  const sel = (aria, options, key, onChange) => {
    const s = el('select', {'aria-label': aria, class: 'min-h-[40px] rounded-xl border border-slate-600 bg-slate-900 px-2 text-sm font-semibold text-white'});
    for (const [v, t] of options) s.append(new Option(t, String(v)));
    s.value = String(state[key]);
    s.addEventListener('change', () => { state[key] = typeof state[key] === 'number' ? Number(s.value) : typeof state[key] === 'boolean' ? s.value === 'true' : s.value; onChange?.(); });
    return s;
  };
  const btn = (text, onClick, cls = '') => { const b = el('button', {type: 'button', text, class: 'min-h-[40px] rounded-xl border border-slate-500 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 ' + cls}); b.addEventListener('click', onClick); return b; };
  const card = (title, sub, ...body) => el('section', {class: 'px-4 pb-4 pt-2'}, el('div', {class: 'mb-2'}, el('h3', {class: 'm-0 text-base font-bold text-white', text: title}), sub && el('p', {class: 'm-0 text-xs text-slate-300', text: sub})), ...body);
  const box = (cls = '') => el('div', {class: 'rounded-xl border border-slate-600 bg-slate-900 p-3 ' + cls});
  const placeLine = el('p', {class: 'm-0 text-sm text-slate-200'});
  const status = el('p', {class: 'm-0 px-4 pt-3 text-sm text-amber-200', role: 'status'});
  const mapBox = el('div', {id: 'flood-map', class: 'h-[380px] w-full rounded-xl border border-slate-600 sm:h-[460px]', role: 'application', 'aria-label': 'Flood map'});
  const mapBox3d = el('div', {id: 'flood-map-3d', class: 'h-[380px] w-full rounded-xl border border-slate-600 sm:h-[460px]', hidden: true, role: 'application', 'aria-label': '3D flood view'});
  const toolsBar = el('div', {class: 'mt-2 flex flex-wrap items-center gap-2'});
  const mapNote = el('p', {class: 'm-0 mt-1 text-xs text-slate-300', role: 'status'});
  const tilesBox = el('div', {class: 'grid grid-cols-2 gap-2'});
  const riskBox = box();
  const inputsBox = box('text-sm text-slate-200');
  const scenarioBox = el('div', {class: 'overflow-x-auto'});
  const rainChart = el('div'), returnChart = el('div'), hydroChart = el('div'), simBox = el('div'), simCharts = el('div', {class: 'grid gap-3 md:grid-cols-2'}), sectionBox = el('div');
  const eoBox = el('div'), obsBox = el('div');
  const eo = initEoPanel({state, el, btn, sel, drawChart, mapBox, mapBox3d, canvasURL: (...a) => canvasURL(...a), setOverlay: (...a) => setOverlay(...a), syncLayers: () => syncLayers(), rebuild: () => rebuild(), render: () => render(), getMap: () => map,
    renderEo: () => renderEoCards(), renderMapTools: () => renderMapTools(), currentDepth: () => { const sm = state.sim; return sm ? (state.view === 'max' ? sm.maxDepth : sm.frames[Math.min(state.frame, sm.frames.length - 1)].depth) : null; }});
  const notes = el('div', {class: 'rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-300'});

  const daysSel = sel('Forecast days', [[1, '1 day'], [2, '2 days'], [3, '3 days'], [4, '4 days']], 'days', () => recompute());
  const coverSel = sel('Land cover', [['worldcover', 'Land cover: ESA WorldCover (per pixel)'], ...Object.entries(LAND_COVER).map(([k, v]) => [k, 'Land cover: ' + v.label + ' (uniform)'])], 'cover', () => recompute());
  const soilSel = sel('Hydrologic soil group', SOIL_GROUPS.map(g => [g, 'Soil group ' + g]), 'soil', () => recompute());
  const amcSel = sel('Antecedent moisture', [['auto', 'Moisture: auto (5-day rain)'], [1, 'Moisture: dry (AMC I)'], [2, 'Moisture: normal (AMC II)'], [3, 'Moisture: wet (AMC III)']], 'amcMode', () => recompute());
  const resSel = sel('Model resolution', [[false, 'Resolution: fast (~200 m)'], [true, 'Resolution: finer (~130 m, slower)']], 'fine', () => { state.sim = null; state.simSeries = null; buildWork(); recompute(); });
  const presetBar = el('div', {class: 'flex flex-wrap items-center gap-2'});
  for (const [name, lat, lon] of PRESETS) presetBar.append(btn(name, () => setPlace({name, lat, lon}), 'min-h-[36px] text-xs'));
  const cityBtn = btn('Use selected city', () => { const c = cities[getSelected()]; if (c) setPlace({name: c[0], lat: c[1], lon: c[2]}); }, 'min-h-[36px] text-xs');
  const modeBar = el('div', {class: 'flex rounded-xl border border-slate-600 bg-slate-900 p-1', role: 'group', 'aria-label': 'Map click action'});
  for (const [mode, text] of [['location', 'Click: set place'], ['section', 'Click: draw cross-section']]) { const b = el('button', {type: 'button', 'data-mode': mode, text, class: 'min-h-[36px] rounded-lg px-3 text-sm font-bold'}); b.addEventListener('click', () => { state.mode = mode; if (mode === 'section') { state.section = null; state.sectionStart = null; sectionLayer?.clearLayers(); renderSection(); } syncControls(); }); modeBar.append(b); }
  const layerBar = el('div', {class: 'flex flex-wrap items-center gap-2'});
  for (const [key, text] of [['flood', 'Flood depth'], ['streams', 'Stream network'], ['catchment', 'Catchment'], ['water', 'Surface water (JRC)'], ['river', 'River (Sentinel-1)'], ['landcover', 'Land cover'], ['observed', 'Observed flood (S1)'], ['buildings', 'Affected buildings']]) {
    const input = el('input', {type: 'checkbox', class: 'h-4 w-4 accent-emerald-400'}); input.checked = state.layers[key];
    input.addEventListener('change', () => { state.layers[key] = input.checked; syncLayers(); });
    layerBar.append(el('label', {class: 'inline-flex min-h-[36px] items-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-white'}, input, text));
  }

  const head = el('header', {class: 'flex flex-wrap items-center justify-between gap-3 border-b border-slate-600 px-4 py-3'},
    el('div', {}, el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-300', text: 'ECMWF rain · SCS runoff · free DEM · 2D flood model'}), el('h2', {class: 'm-0 text-xl font-bold text-white', text: 'FloodAI · flood screening'}), placeLine),
    el('div', {class: 'flex flex-wrap items-center gap-2'}, cityBtn, btn('Reload', () => loadPoint())));
  const controls = el('div', {class: 'flex flex-wrap items-center gap-2 border-b border-slate-700 px-4 py-3'}, daysSel, coverSel, soilSel, amcSel, resSel, modeBar);
  const presets = el('div', {class: 'flex flex-wrap items-center gap-2 border-b border-slate-700 px-4 py-2'}, el('span', {class: 'text-xs text-slate-300', text: 'Example flood-prone places:'}), presetBar);
  const mapRow = el('div', {class: 'grid gap-3 px-4 pb-4 pt-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'},
    el('div', {}, mapBox, mapBox3d, el('div', {class: 'mt-2'}, layerBar), toolsBar, mapNote), el('div', {class: 'grid content-start gap-3'}, riskBox, tilesBox, inputsBox));
  root.replaceChildren(el('div', {class: 'overflow-hidden rounded-2xl border border-slate-600 bg-slate-950 text-slate-100 shadow-2xl shadow-black/40'},
    head, controls, presets, status, mapRow,
    card('Rainfall', 'Hourly ECMWF forecast (bars), cumulative rain (line), the last 24 h and any gauge record you import. Hover for values.', rainChart),
    card('Scenarios', 'Expected forecast, your bulletin and two return-period what-ifs. Pick one to simulate.', scenarioBox),
    card('How unusual is this rain?', 'ERA5 annual-maximum daily rain at this place (dots), Gumbel fit (line) and each scenario.', returnChart),
    card('Catchment response', 'Outflow hydrograph from the DEM-derived catchment (SCS unit hydrograph).', hydroChart),
    card('Satellite river & land cover', 'Sentinel-1 radar maps the river channel; ESA WorldCover gives every pixel its own curve number and roughness.', eoBox),
    card('Flood simulation', 'Rain-on-grid 2D model: pick a scenario, run, then scrub or play the depth map.', simBox, simCharts),
    card('Observed flood (Sentinel-1)', 'Map a real flood from radar, then score the model against it.', obsBox),
    card('Cross-section', 'Choose "Click: draw cross-section", then click two points on the map.', sectionBox),
    el('div', {class: 'px-4 pb-4'}, notes)));

  // ---------- map ----------
  function ensureMap() {
    if (map) return;
    map = darkMap('flood-map');
    map.createPane('flood-overlay'); map.getPane('flood-overlay').style.zIndex = 330;
    sectionLayer = L.layerGroup().addTo(map); buildingLayer = L.layerGroup().addTo(map);
    map.on('click', e => {
      if (state.mode === 'section') return pickSectionPoint(e.latlng);
      setPlace({name: `Point ${e.latlng.lat.toFixed(3)}°N ${e.latlng.lng.toFixed(3)}°E`, lat: e.latlng.lat, lon: e.latlng.lng});
    });
    placeMarker();
  }
  function placeMarker(recentre = true) {
    if (!map) return;
    pointMarker?.remove();
    pointMarker = L.circleMarker([state.place.lat, state.place.lon], {radius: 7, color: '#fff', weight: 2, fillColor: '#38bdf8', fillOpacity: 1}).addTo(map);
    if (recentre) map.setView([state.place.lat, state.place.lon], Math.max(map.getZoom(), 9));
  }
  const canvasURL = (n, colour) => {
    const c = document.createElement('canvas'); c.width = c.height = n;
    const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const [r, g, b, a] = colour(i); img.data.set([r, g, b, a], i * 4); }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  };
  function bounds() { const f = state.terrain.frame; return [[f.south, f.west], [f.north, f.east]]; }
  function setOverlay(key, url, zIndex) {
    if (!state.terrain || !map) return;
    if (!overlays[key]) overlays[key] = L.imageOverlay(url, bounds(), {pane: 'flood-overlay', interactive: false, className: 'flood-pixel', zIndex}); else overlays[key].setUrl(url);
    overlays[key].setBounds(bounds());
  }
  function syncLayers() {
    if (!map) return;
    const want = {flood: state.layers.flood && state.sim, streams: state.layers.streams && state.work, catchment: state.layers.catchment && state.work, river: state.layers.river && state.river, thalweg: state.layers.river && state.work?.thalweg, landcover: state.layers.landcover && state.lcCodes, observed: state.layers.observed && state.obs};
    for (const [key, on] of Object.entries(want)) if (overlays[key]) { if (on && !map.hasLayer(overlays[key])) overlays[key].addTo(map); if (!on && map.hasLayer(overlays[key])) overlays[key].remove(); }
    if (state.layers.water) { jrc ??= L.tileLayer('https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png', {maxNativeZoom: 13, maxZoom: 14, opacity: 0.75, attribution: 'Surface water: EC JRC Global Surface Water (Pekel et al. 2016)'}); if (!map.hasLayer(jrc)) jrc.addTo(map); } else if (jrc && map.hasLayer(jrc)) jrc.remove();
    if (buildingLayer) { if (state.layers.buildings && !map.hasLayer(buildingLayer)) buildingLayer.addTo(map); if (!state.layers.buildings && map.hasLayer(buildingLayer)) buildingLayer.remove(); }
  }
  function drawDepth() {
    const s = state.sim;
    if (!s || !state.terrain) return;
    const depth = state.view === 'max' ? s.maxDepth : s.frames[Math.min(state.frame, s.frames.length - 1)].depth;
    setOverlay('flood', canvasURL(s.n, i => depthColor(depth[i], state.hide)), 2);
    syncLayers(); eo.update3D();
  }
  function drawNetwork() {
    const w = state.work;
    if (!w) return;
    const thr = Math.max(20, Math.round(2e6 / (w.cellM * w.cellM)));   // streams start at about 2 km2 of drainage
    setOverlay('streams', canvasURL(w.n, i => w.net.acc[i] >= thr ? [34 + 28 * Math.min(w.net.order[i], 6), 150 + 14 * Math.min(w.net.order[i], 6), 255, 120 + 18 * Math.min(w.net.order[i], 6)] : [0, 0, 0, 0]), 1);
    setOverlay('catchment', canvasURL(w.n, i => w.catchment?.mask[i] ? [251, 191, 36, 55] : [0, 0, 0, 0]), 0);
    syncLayers();
  }

  // ---------- terrain ----------
  function buildWork() {
    const t = state.terrain;
    if (!t) return;
    const factor = state.fine ? 4 : 6, {data: z, n} = downsample(t.elev, t.frame.size, factor), cellM = metresPerPixel(t.frame.centreLat, t.frame.z) * factor;
    const filled = fillDepressions(z, n), dir = flowDirections(filled, n), net = networkOf(filled, dir, n);
    const [px, py] = pixelOfLatLon(t.frame, state.place.lat, state.place.lon), ci = Math.min(n - 1, Math.max(0, Math.floor(px / factor))), cj = Math.min(n - 1, Math.max(0, Math.floor(py / factor)));
    const catchment = catchmentOf(dir, net.acc, n, ci, cj, 3), path = catchment ? longestPath(filled, dir, n, catchment, cellM) : null;
    const areaKm2 = catchment ? catchment.cells * cellM * cellM / 1e6 : null;
    // A catchment smaller than a few cells has no measurable path; fall back to a 15 minute concentration time
    // so the unit hydrograph stays defined (a safeguard, flagged in the notes).
    const tc = path && path.length > cellM ? Math.max(0.25, kirpichHours(path.length, path.slope)) : 0.25;
    state.work = {z, n, factor, cellM, filled, dir, net, catchment, path, areaKm2, tc, cell: [ci, cj]};
    Object.assign(state.work, eo.workExtras({z, n, factor, filled, dir, catchment}));
    drawNetwork(); eo.drawWorkOverlays(state.work);
  }

  // ---------- derived numbers ----------
  function recompute() {
    state.base = null; state.results = {};
    if (state.rain) {
      const {past, future} = splitAtNow(state.rain, nowLocal()), factor = state.gaugeOn && state.gauge?.applied ? state.gauge.factor : 1;
      const past5 = sum(past) * factor, amc = state.amcMode === 'auto' ? amcClass(past5, growingSeason()) : Number(state.amcMode);
      const w = state.work, useLc = state.cover === 'worldcover' && !!w?.lc, plain = state.cover === 'worldcover' ? 'cropland' : state.cover;
      const keys = useLc ? w.lc.keys : [plain], mapShare = useLc ? w.lc.share : [1], catchShare = useLc ? w.lc.catchShare : [1], cnByKey = {};
      for (const k of keys) cnByKey[k] = adjustCN(curveNumber(k, state.soil), amc);
      const cn = keys.reduce((a, k, i) => a + cnByKey[k] * mapShare[i], 0), cn2 = keys.reduce((a, k, i) => a + curveNumber(k, state.soil) * mapShare[i], 0), H = state.days * 24;
      const missing = future.slice(0, H).filter(v => v === null).length;
      state.base = {past, future, factor, past5, amc, cn2, cn, cnByKey, keys, mapShare, catchShare, useLc, plain, H, missing};
      for (const sc of SCENARIOS) state.results[sc.id] = scenarioResult(sc.id);
    }
    simToken = null; state.progress = null; state.sim = null; state.simSeries = null; state.buildings = null; buildingLayer?.clearLayers(); overlays.flood?.remove();
    stopPlay(); render();
  }
  function hourlyFor(id) {
    const b = state.base, H = b.H;
    if (id === 'expected') return b.future.slice(0, H).map(v => finite(v) ? v * b.factor : 0);
    if (id === 'bulletin') {
      if (state.bulletin.every(v => v === '')) return null;
      return Array.from({length: H}, (_, h) => { const raw = state.bulletin[Math.floor(h / 24)], v = Number(raw); return raw !== '' && finite(v) && v >= 0 ? v / 24 : 0; });
    }
    if (!state.fit) return null;
    return [...designStorm(gumbelQuantile(state.fit, id === 'rp20' ? 20 : 100), 24), ...Array(Math.max(0, H - 24)).fill(0)];
  }
  function scenarioResult(id) {
    const hourly = hourlyFor(id);
    if (!hourly) return null;
    const b = state.base, effByKey = b.keys.map(k => effectiveRain(hourly, b.cnByKey[k])), mix = shares => hourly.map((_, h) => effByKey.reduce((a, e, i) => a + e[h] * shares[i], 0)), eff = mix(b.mapShare), effCatch = mix(b.catchShare), max24 = maxRolling(hourly, 24), T = state.fit ? gumbelReturnPeriod(state.fit, max24) : null, w = state.work;
    let q = null, stats = null;
    if (w?.catchment && w.areaKm2) { q = routeHydrograph(effCatch, unitHydrograph(w.areaKm2, w.tc, 1)); stats = hydrographStats(q); }
    return {id, hourly, eff, effCatch, effByKey, total: sum(hourly), max24, T, band: riskBand(T), imd: rainClass(max24), runoff: sum(eff), q, stats};
  }

  // ---------- rendering ----------
  const chip = (text, level) => el('span', {class: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ' + (BAND_CLASS[level] || 'border-slate-600 bg-slate-800 text-slate-300'), text});
  const tile = (label, value, sub) => el('div', {class: 'rounded-xl border border-slate-600 bg-slate-900 p-3'}, el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-300', text: label}), el('p', {class: 'm-0 text-lg font-bold text-white', text: value}), sub && el('p', {class: 'm-0 text-[11px] text-slate-400', text: sub}));
  function syncControls() {
    placeLine.textContent = `${state.place.name} · ${state.place.lat.toFixed(3)}°N ${state.place.lon.toFixed(3)}°E`;
    for (const b of modeBar.children) { const on = b.dataset.mode === state.mode; b.setAttribute('aria-pressed', String(on)); b.className = 'min-h-[36px] rounded-lg px-3 text-sm font-bold ' + (on ? 'bg-sky-400 text-slate-950' : 'text-white hover:bg-slate-800'); }
    amcSel.value = state.amcMode === 'auto' ? 'auto' : String(state.amcMode);
  }
  function render() {
    syncControls();
    status.textContent = state.error || state.status;
    status.hidden = !(state.error || state.status);
    const b = state.base, sc = state.results[state.scenario] || state.results.expected, w = state.work, sim = state.simSeries;
    // headline
    riskBox.replaceChildren();
    if (!b || !sc) riskBox.append(el('p', {class: 'm-0 text-sm text-slate-300', text: state.error ? 'Forecast unavailable.' : 'Loading the ECMWF rain forecast…'}));
    else riskBox.append(el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300', text: 'Rain-based flood risk · ' + SCENARIOS.find(s => s.id === sc.id).name}),
      el('div', {class: 'mt-1 flex flex-wrap items-center gap-2'}, chip(sc.band.label, sc.band.level), el('span', {class: 'text-sm text-slate-200', text: `max 24 h rain ${fmt(sc.max24, 0)} mm · return period ${retArea(sc.T)} · IMD class: ${sc.imd.label}`})),
      el('p', {class: 'm-0 mt-2 text-xs text-slate-400', text: 'Band = how unusual the 24 h rain is against ERA5 at this place (below 2 yr low, 2–10 moderate, 10–50 high, 50+ very high). A screening convention, not an official warning level.'}));
    tilesBox.replaceChildren();
    if (b && sc) tilesBox.append(
      tile(`Rain, next ${state.days} d`, fmt(sc.total, 0, ' mm'), b.factor !== 1 && sc.id === 'expected' ? `gauge-corrected ×${b.factor.toFixed(2)}` : 'ECMWF IFS'),
      tile('Runoff (SCS)', fmt(sc.runoff, 0, ' mm'), `CN ${b.cn.toFixed(0)} · AMC ${b.amc}`),
      tile('Catchment', w?.areaKm2 ? fmt(w.areaKm2, 0, ' km²') : '–', w?.path ? `Tc ${fmt(w.tc, 1, ' h')} · L ${fmt(w.path.length / 1000, 1, ' km')}` : 'terrain loading'),
      tile('Peak outflow', sc.stats ? fmt(sc.stats.peak, 0, ' m³/s') : '–', sc.stats ? `at +${sc.stats.peakHour} h` : ''),
      tile('Flooded area', sim ? fmt(Math.max(...sim.map(s => s.areaKm2)), 1, ' km²') : '–', sim ? `depth > ${state.hide} m` : 'run the simulation'),
      tile('Deepest water', sim ? fmt(Math.max(...sim.map(s => s.maxDepth)), 2, ' m') : '–', state.buildings ? `${state.buildings.flooded} of ${state.buildings.total} buildings flooded` : ''));
    if (b && sc) tilesBox.append(...eo.exposureTiles(tile));
    renderEoCards(); renderMapTools();
    renderInputs(); renderRain(); renderScenarios(); renderReturn(); renderHydro(); renderSim(); renderSection(); renderNotes();
  }
  function renderInputs() {
    const g = state.gauge;
    const bulletin = el('div', {class: 'mt-2 flex flex-wrap items-center gap-2'});
    for (let d = 0; d < state.days; d++) { const i = el('input', {type: 'number', min: 0, step: 1, placeholder: 'mm', value: state.bulletin[d], 'aria-label': `Bulletin rain, day ${d + 1}`, class: 'w-20 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-white'}); i.addEventListener('change', () => { state.bulletin[d] = i.value; recompute(); }); bulletin.append(el('label', {class: 'text-xs text-slate-300'}, `Day ${d + 1} `, i)); }
    const gaugeToggle = el('input', {type: 'checkbox', class: 'h-4 w-4 accent-sky-400'}); gaugeToggle.checked = state.gaugeOn; gaugeToggle.addEventListener('change', () => { state.gaugeOn = gaugeToggle.checked; recompute(); });
    const file = (label, accept, onText) => { const i = el('input', {type: 'file', accept, class: 'hidden'}); i.addEventListener('change', async () => { const f = i.files[0]; if (f) onText(await f.text(), f.name); i.value = ''; }); const b = btn(label, () => i.click(), 'min-h-[34px] text-xs'); return el('span', {}, i, b); };
    inputsBox.replaceChildren(
      el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300', text: 'Rain inputs'}),
      el('label', {class: 'mt-1 flex items-center gap-2 text-xs text-slate-200'}, gaugeToggle, 'Correct ECMWF with WeatherWalay rain gauges'),
      el('p', {class: 'm-0 mt-1 text-xs text-slate-300', text: !g ? 'Checking gauges…' : g.applied ? `Factor ×${g.factor.toFixed(2)}: ${g.gauges} gauge${g.gauges === 1 ? '' : 's'} recorded ${g.gauge.toFixed(1)} mm against ${g.model.toFixed(1)} mm modelled over 24 h.` : g.gauges ? `No correction: the model had only ${g.model.toFixed(1)} mm (needs ${GAUGE.minModelMm} mm) at the ${g.gauges} gauge${g.gauges === 1 ? '' : 's'}.` : `No fresh WeatherWalay gauge within ${GAUGE.maxKm} km, so no correction.`}),
      g?.list?.length ? el('details', {class: 'mt-1 text-xs text-slate-300'}, el('summary', {class: 'cursor-pointer', text: 'Gauges used'}), ...g.list.map(x => el('div', {text: `${x.name} · ${x.km.toFixed(0)} km · gauge ${x.rain.toFixed(1)} mm · model ${fmt(x.model, 1)} mm`}))) : null,
      el('p', {class: 'm-0 mt-3 text-xs font-bold text-slate-200', text: 'Official bulletin rainfall (mm per day, optional)'}), bulletin,
      el('p', {class: 'm-0 mt-3 text-xs font-bold text-slate-200', text: 'Your own records (CSV)'}),
      el('div', {class: 'mt-1 flex flex-wrap gap-2'}, file('Import rain-gauge record', '.csv,.txt', (t, name) => { const r = parseGaugeRecord(t); state.importedGauge = r.records.length ? {...r, name} : null; state.status = r.records.length ? `Imported ${r.records.length} gauge readings from ${name}${r.dropped ? ` (${r.dropped} bad rows skipped)` : ''}.` : 'No valid "time,mm" rows found in that file.'; computeGauge().then(recompute); }), file('Import surveyed cross-section', '.csv,.txt', (t, name) => { const r = parseCrossSection(t); state.survey = r.points.length >= 2 ? {...r, name} : null; state.status = r.points.length >= 2 ? `Imported surveyed section ${name}: ${r.points.length} points${r.dropped ? ` (${r.dropped} bad rows skipped)` : ''}.` : 'No valid "chainage,elevation" rows found in that file.'; render(); })),
      el('p', {class: 'm-0 mt-1 text-[11px] text-slate-400', text: 'Gauge file: time (ISO), mm per row; the last 24 h is compared with ECMWF at this place. Section file: chainage (m) from the first clicked point, elevation (m).'}));
  }
  function renderRain() {
    rainChart.replaceChildren();
    const b = state.base, sc = state.results[state.scenario];
    if (!b || !sc) return;
    const past = b.past.slice(-24).map((v, i, a) => [i - a.length, v]), H = b.H, series = [];
    series.push({name: 'ECMWF last 24 h', color: '#64748b', type: 'bar', data: past, axis: 'y'});
    const rawFuture = b.future.slice(0, H).map((v, i) => [i, v]);
    if (state.scenario === 'expected' && b.factor !== 1) series.push({name: 'ECMWF raw', color: '#475569', type: 'bar', data: rawFuture, axis: 'y', opacity: 0.8});
    series.push({name: SCENARIOS.find(s => s.id === sc.id).name + ' · hourly', color: SCENARIOS.find(s => s.id === sc.id).color, type: 'bar', data: sc.hourly.map((v, i) => [i, v]), axis: 'y', fmt: v => v.toFixed(2) + ' mm'});
    if (state.importedGauge) { const now = Date.now(), byHour = new Map(); for (const r of state.importedGauge.records) { const h = Math.floor((r.time - now) / 3600000); if (h >= -24 && h < 0) byHour.set(h, (byHour.get(h) || 0) + r.value); } series.push({name: 'Imported gauge', color: '#34d399', type: 'bar', data: [...byHour].map(([h, v]) => [h, v]), axis: 'y', barWidth: 0.5}); }
    let cum = 0;
    series.push({name: 'Cumulative', color: '#fbbf24', type: 'line', data: sc.hourly.map((v, i) => [i, cum += v]), axis: 'y2', fmt: v => v.toFixed(1) + ' mm'});
    const yMax = Math.max(...series.filter(s => s.type === 'bar').flatMap(s => s.data.map(d => d[1]).filter(finite)), 1);
    rainChart.append(drawChart({xDomain: [-24, H], yDomain: [0, yMax * 1.15], y2Domain: [0, Math.max(cum, 1) * 1.1], xFmt: v => (v > 0 ? '+' : '') + v + ' h', hoverX: v => (v >= 0 ? 'In ' + v + ' h' : Math.abs(v) + ' h ago'), yTitle: 'mm / hour', y2Title: 'cumulative mm', series, vlines: [{x: 0, label: 'now', color: '#e2e8f0'}], label: 'Hourly rainfall chart'}));
    if (b.missing) rainChart.append(el('p', {class: 'm-0 mt-1 text-xs text-amber-200', text: `${b.missing} forecast hour${b.missing === 1 ? '' : 's'} had no value and count as zero rain.`}));
  }
  function renderScenarios() {
    scenarioBox.replaceChildren();
    if (!state.base) return;
    const head = ['Scenario', 'Rain', 'Max 24 h', 'Return period', 'Risk band', 'IMD 24 h class', 'Runoff', 'Peak outflow', ''].map(t => el('th', {class: 'px-2 py-1 text-left text-xs font-bold text-slate-300', text: t}));
    const rows = SCENARIOS.map(s => {
      const r = state.results[s.id], on = state.scenario === s.id;
      if (!r) return el('tr', {class: 'border-t border-slate-700 text-slate-400'}, el('td', {class: 'px-2 py-1 text-sm', text: s.name}), el('td', {class: 'px-2 py-1 text-xs', colspan: 8, text: s.id === 'bulletin' ? 'Enter bulletin rainfall in "Rain inputs" to use this.' : 'Needs the ERA5 record for this place.'}));
      const pick = btn(on ? 'Selected' : 'Select', () => { state.scenario = s.id; simToken = null; state.progress = null; state.sim = null; state.simSeries = null; state.buildings = null; buildingLayer?.clearLayers(); overlays.flood?.remove(); stopPlay(); render(); }, 'min-h-[32px] text-xs ' + (on ? 'bg-sky-400 text-slate-950 hover:bg-sky-300' : ''));
      return el('tr', {class: 'border-t border-slate-700 text-sm ' + (on ? 'bg-sky-500/10' : '')},
        el('td', {class: 'px-2 py-1 font-semibold'}, el('span', {class: 'mr-2 inline-block h-2.5 w-2.5 rounded-sm', style: `background:${s.color}`}), s.name),
        el('td', {class: 'px-2 py-1', text: fmt(r.total, 0, ' mm')}), el('td', {class: 'px-2 py-1', text: fmt(r.max24, 0, ' mm')}), el('td', {class: 'px-2 py-1', text: retArea(r.T)}),
        el('td', {class: 'px-2 py-1'}, chip(r.band.label, r.band.level)), el('td', {class: 'px-2 py-1', text: r.imd.label}), el('td', {class: 'px-2 py-1', text: fmt(r.runoff, 0, ' mm')}),
        el('td', {class: 'px-2 py-1', text: r.stats ? fmt(r.stats.peak, 0, ' m³/s') : '–'}), el('td', {class: 'px-2 py-1'}, pick));
    });
    scenarioBox.append(el('table', {class: 'w-full min-w-[720px] border-collapse text-slate-100'}, el('thead', {}, el('tr', {}, head)), el('tbody', {}, rows)));
  }
  function renderReturn() {
    returnChart.replaceChildren();
    if (!state.fit) { returnChart.append(el('p', {class: 'm-0 text-sm text-slate-300', text: state.error ? '' : 'Loading the ERA5 record for this place…'})); return; }
    const emp = weibullPoints(state.maxima.map(m => m.max)).map(p => [p.years, p.x]), curve = Array.from({length: 60}, (_, i) => { const T = 1.05 * (200 / 1.05) ** (i / 59); return [T, gumbelQuantile(state.fit, T)]; });
    const marks = SCENARIOS.map(s => ({s, r: state.results[s.id]})).filter(m => m.r).map(m => ({name: m.s.name, color: m.s.color, type: 'points', r: 6, data: [[Math.min(200, Math.max(1.05, m.s.id === 'rp20' ? 20 : m.s.id === 'rp100' ? 100 : m.r.T ?? 1.05)), m.r.max24]], fmt: v => v.toFixed(0) + ' mm (24 h)'}));
    const ys = [...emp.map(p => p[1]), ...curve.map(p => p[1]), ...marks.flatMap(m => m.data.map(d => d[1]))];
    returnChart.append(drawChart({xDomain: [1, 200], xLog: true, yDomain: extent(ys, 0.08, 0), xFmt: v => v + ' yr', hoverX: v => 'Return period ' + (v < 10 ? v.toFixed(1) : Math.round(v)) + ' yr', yTitle: 'max daily rain (mm)', xTitle: 'return period (years, log scale)',
      series: [{name: `ERA5 annual maxima (${emp.length} yr)`, color: '#94a3b8', type: 'points', data: emp, fmt: v => v.toFixed(0) + ' mm'}, {name: 'Gumbel fit', color: '#e2e8f0', type: 'line', data: curve, width: 1.6, fmt: v => v.toFixed(0) + ' mm'}, ...marks], label: 'Return period chart'}));
    returnChart.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-400', text: `Gumbel by moments: μ ${state.fit.mu.toFixed(1)} mm, β ${state.fit.beta.toFixed(1)} mm from ${state.fit.n} years. ${state.fit.n < 50 ? 'With under 50 years the 100-year value is an extrapolation. ' : ''}ERA5 is a ~25 km model and tends to under-state local extremes.`}));
  }
  function renderHydro() {
    hydroChart.replaceChildren();
    const w = state.work;
    if (!state.base || !w) { hydroChart.append(el('p', {class: 'm-0 text-sm text-slate-300', text: 'Loading terrain…'})); return; }
    if (!w.catchment || !w.areaKm2) { hydroChart.append(el('p', {class: 'm-0 text-sm text-slate-300', text: 'No catchment could be found at this point (open water or no terrain data).'})); return; }
    const series = SCENARIOS.map(s => ({s, r: state.results[s.id]})).filter(m => m.r?.q).map(m => ({name: m.s.name, color: m.s.color, type: 'line', data: m.r.q.map((v, h) => [h, v]), fmt: v => v.toFixed(1) + ' m³/s', width: m.s.id === state.scenario ? 2.6 : 1.4, dash: m.s.id === state.scenario ? '' : '5 3'}));
    const len = Math.max(...series.map(s => s.data.length));
    hydroChart.append(drawChart({xDomain: [0, len - 1], yDomain: [0, Math.max(1, ...series.flatMap(s => s.data.map(d => d[1]))) * 1.1], xFmt: v => '+' + v + ' h', hoverX: v => 'In ' + v + ' h', yTitle: 'outflow (m³/s)', series, label: 'Catchment hydrograph'}));
    hydroChart.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-400', text: `Catchment ${fmt(w.areaKm2, 0)} km² (rain inside the ${Math.round(w.n * w.cellM / 1000)} km map only), longest path ${fmt(w.path.length / 1000, 1)} km, slope ${fmt(w.path.slope * 100, 2)} %, Kirpich Tc ${fmt(w.tc, 1)} h. One curve number for the whole catchment.`}));
  }

  // ---------- simulation ----------
  function simControls() {
    const run = btn(state.sim && !state.sim.done ? 'Running…' : 'Run flood simulation', startSim, 'bg-sky-500 text-slate-950 hover:bg-sky-400 border-sky-300');
    const hide = sel('Hide water shallower than', [[0.02, 'Hide < 2 cm'], [0.05, 'Hide < 5 cm'], [0.1, 'Hide < 10 cm'], [0.3, 'Hide < 30 cm']], 'hide', () => { if (state.sim?.done) { seriesFromSim(); drawDepth(); render(); } });
    const view = sel('Map shows', [['frame', 'Map: time step'], ['max', 'Map: maximum depth']], 'view', () => drawDepth());
    const frames = state.sim?.frames.length || 1, slider = el('input', {type: 'range', min: 0, max: Math.max(0, frames - 1), value: Math.min(state.frame, frames - 1), 'aria-label': 'Simulation time', class: 'w-full min-w-[200px] flex-1 accent-sky-400'});
    slider.disabled = !state.sim?.done;
    slider.addEventListener('input', () => { state.frame = Number(slider.value); frameChanged(); });
    const play = btn(state.playing ? 'Pause' : 'Play', togglePlay, 'min-h-[40px]'); play.disabled = !state.sim?.done;
    const hr = state.sim?.frames[Math.min(state.frame, frames - 1)]?.hour ?? 0;
    const bld = btn(state.buildings ? 'Buildings counted' : 'Find affected buildings (OSM)', findBuildings, 'min-h-[40px]'); bld.disabled = !state.sim?.done;
    return el('div', {class: 'flex flex-wrap items-center gap-2'}, run, hide, view, play, slider, el('span', {class: 'min-w-[110px] text-sm font-semibold text-white', 'data-flood-hour': '', text: state.sim?.done ? `+${hr.toFixed(0)} h of ${state.sim.hours}` : '–'}), bld);
  }
  function renderSim() {
    simBox.replaceChildren(simControls());
    if (state.progress !== null) simBox.append(el('div', {class: 'mt-2 h-2 w-full overflow-hidden rounded bg-slate-700', role: 'progressbar', 'aria-valuenow': Math.round(state.progress * 100)}, el('div', {class: 'h-2 bg-sky-400', style: `width:${Math.round(state.progress * 100)}%`})));
    if (state.simMessage) simBox.append(el('p', {class: 'm-0 mt-2 text-sm text-amber-200', text: state.simMessage}));
    renderSimCharts();
  }
  function seriesFromSim() { state.simSeries = state.sim.frames.map(f => ({hour: f.hour, ...floodedStats(f.depth, state.sim.cellM, state.hide)})); }
  function startSim() {
    const sc = state.results[state.scenario], w = state.work;
    state.simMessage = '';
    if (!sc || !w) { state.simMessage = 'The scenario or terrain is not ready yet.'; return renderSim(); }
    if (sum(sc.eff) < 0.05) { state.simMessage = 'No runoff is expected in this scenario (the rain stays within the soil’s initial loss), so there is nothing to simulate. Try a return-period scenario or wetter moisture.'; return renderSim(); }
    simToken = null; stopPlay(); state.buildings = null; buildingLayer?.clearLayers();
    const hours = state.days * 24 + 6;
    const lc = state.base?.useLc ? w.lc : null;
    state.sim = createSimulation({z: w.zSim || w.z, n: w.n, cellM: w.cellM, manning: lc ? Float32Array.from(lc.classOf, k => LAND_COVER[lc.keys[k]].n) : LAND_COVER[state.base.plain].n, effectiveMm: sc.eff, effectiveByClass: lc ? sc.effByKey : null, classOf: lc ? lc.classOf : null, hours});
    state.simSeries = null; state.progress = 0; renderSim();
    const sim = state.sim, token = simToken = {};
    (async () => {
      while (!sim.done && simToken === token) {
        const p = sim.advance(40);
        state.progress = p;
        const bar = simBox.querySelector('[role=progressbar] div'); if (bar) bar.style.width = Math.round(p * 100) + '%';
        await yieldTask();
      }
      if (simToken !== token) return;
      state.progress = null; seriesFromSim();
      state.frame = state.simSeries.reduce((best, s, i, a) => s.areaKm2 > a[best].areaKm2 ? i : best, 0);
      state.simMessage = state.simSeries.every(s => s.areaKm2 === 0) ? `No cell reached ${state.hide} m of water in this scenario.` : 'Very deep water in a closed hollow (a lake, reservoir or quarry) is a DEM pit filling up, not river flooding.';
      drawDepth(); render();
    })();
  }
  function frameChanged() {
    drawDepth();
    const s = state.sim; if (!s?.done) return;
    const lab = simBox.querySelector('[data-flood-hour]'), sl = simBox.querySelector('input[type=range]');
    if (lab) lab.textContent = `+${s.frames[state.frame].hour.toFixed(0)} h of ${s.hours}`; if (sl) sl.value = state.frame;
    renderSimCharts(); renderSection();
  }
  function renderSimCharts() {
    const s = state.simSeries; if (!s) return;
    simCharts.replaceChildren();
    const cur = state.sim.frames[Math.min(state.frame, state.sim.frames.length - 1)].hour, sc = state.results[state.scenario];
    const pick = h => { state.frame = state.sim.frames.reduce((best, f, k) => Math.abs(f.hour - h) < Math.abs(state.sim.frames[best].hour - h) ? k : best, 0); frameChanged(); };
    simCharts.append(el('div', {}, el('p', {class: 'm-0 mb-1 text-xs font-bold text-slate-300', text: 'Flooded area and deepest water (click to jump)'}),
      drawChart({xDomain: [0, state.sim.hours], yDomain: [0, Math.max(0.1, ...s.map(x => x.areaKm2)) * 1.15], y2Domain: [0, Math.max(0.2, ...s.map(x => x.maxDepth)) * 1.15], xFmt: v => '+' + v + ' h', hoverX: v => '+' + v.toFixed(0) + ' h', yTitle: 'flooded area (km²)', y2Title: 'deepest (m)', onPick: pick, vlines: [{x: cur, color: '#f472b6'}], label: 'Flooded area over time',
        series: [{name: 'Flooded area', color: '#38bdf8', type: 'area', data: s.map(x => [x.hour, x.areaKm2]), fmt: v => v.toFixed(2) + ' km²'}, {name: 'Deepest water', color: '#fbbf24', type: 'line', axis: 'y2', data: s.map(x => [x.hour, x.maxDepth]), fmt: v => v.toFixed(2) + ' m'}]})));
    if (sc) simCharts.append(el('div', {}, el('p', {class: 'm-0 mb-1 text-xs font-bold text-slate-300', text: 'Effective rain going into the model (after SCS losses)'}),
      drawChart({xDomain: [0, state.sim.hours], yDomain: [0, Math.max(1, ...sc.eff) * 1.2], xFmt: v => '+' + v + ' h', hoverX: v => 'Hour ' + v, yTitle: 'mm / hour', vlines: [{x: cur, color: '#f472b6'}], label: 'Effective rain', series: [{name: 'Effective rain', color: '#a78bfa', type: 'bar', data: sc.eff.map((v, i) => [i, v]), fmt: v => v.toFixed(2) + ' mm'}]})));
  }
  function togglePlay() {
    if (state.playing) return stopPlay();
    const s = state.sim; if (!s?.done) return;
    if (state.frame >= s.frames.length - 1) state.frame = 0;
    state.playing = true; renderSim();
    playTimer = setInterval(() => { if (state.frame >= s.frames.length - 1) { stopPlay(); renderSim(); return; } state.frame++; frameChanged(); }, 250);
  }
  function stopPlay() { clearInterval(playTimer); state.playing = false; }

  async function findBuildings() {
    const s = state.sim, t = state.terrain; if (!s?.done || !t) return;
    const w = state.work, wet = [];
    for (let c = 0; c < s.maxDepth.length; c++) if (s.maxDepth[c] > state.hide) wet.push(c);
    if (!wet.length) { state.simMessage = 'No flooded cells, so no buildings are affected.'; return renderSim(); }
    const deepest = wet.reduce((b, c) => s.maxDepth[c] > s.maxDepth[b] ? c : b, wet[0]);
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const c of wet) { const i = c % w.n, j = (c - i) / w.n; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    const toLL = (i, j) => latLonOfPixel(t.frame, i * w.factor, j * w.factor);
    let [n1, w1] = toLL(i0, j0), [s1, e1] = toLL(i1 + 1, j1 + 1);
    if ((n1 - s1) * (e1 - w1) * 111 * 111 * Math.cos(n1 * Math.PI / 180) > 150) {   // keep the OSM query modest: 150 km2 around the deepest water
      const di = deepest % w.n, dj = (deepest - di) / w.n, [cl, co] = toLL(di + 0.5, dj + 0.5), dLat = 6 / 111, dLon = 6 / (111 * Math.cos(cl * Math.PI / 180));
      n1 = cl + dLat; s1 = cl - dLat; w1 = co - dLon; e1 = co + dLon;
    }
    state.simMessage = 'Asking OpenStreetMap for buildings…'; renderSim();
    buildingCtl?.abort(); buildingCtl = new AbortController();
    try {
      const {buildings, truncated} = await fetchBuildings({south: s1, west: w1, north: n1, east: e1}, buildingCtl.signal);
      const cellOf = b => { const [px, py] = pixelOfLatLon(t.frame, b.lat, b.lon), i = Math.floor(px / w.factor), j = Math.floor(py / w.factor); return i < 0 || j < 0 || i >= w.n || j >= w.n ? -1 : j * w.n + i; };
      const stats = eo.buildingStats(buildings, s.maxDepth, cellOf);
      buildingLayer.clearLayers();
      const renderer = L.canvas({padding: 0.3});
      for (const b of stats.items) if (b.wet) L.circleMarker([b.lat, b.lon], {radius: 3, color: '#fecaca', weight: 0.5, fillColor: '#ef4444', fillOpacity: 0.9, renderer}).bindTooltip(`Building · ${b.depth.toFixed(2)} m cell depth`).addTo(buildingLayer);
      state.buildings = {...stats, truncated};
      state.simMessage = `${stats.flooded} of ${stats.total} OSM buildings in the flooded area sit in cells deeper than ${state.hide} m${truncated ? ' (the query stopped at its 5,000-building limit)' : ''}; ${stats.residential} are tagged as homes, which gives at least ${stats.people.toLocaleString('en')} people at ${state.household} per household. Untagged buildings are not counted, OSM coverage varies, and cell depth is an average over ~${Math.round(w.cellM)} m.`;
      eo.update3D(true);
    } catch (e) { state.simMessage = e.name === 'AbortError' ? '' : 'Could not load buildings from OpenStreetMap: ' + e.message; }
    syncLayers(); render();
  }

  // ---------- cross-section ----------
  function pickSectionPoint(ll) {
    if (!state.terrain) return;
    if (!state.sectionStart) { state.sectionStart = [ll.lat, ll.lng]; sectionLayer.clearLayers(); L.circleMarker(ll, {radius: 5, color: '#fbbf24', fillColor: '#fbbf24', fillOpacity: 1}).addTo(sectionLayer); state.section = null; mapNote.textContent = 'Now click the second end of the section.'; return renderSection(); }
    const a = state.sectionStart, b = [ll.lat, ll.lng];
    state.sectionStart = null; mapNote.textContent = '';
    sectionLayer.clearLayers(); L.polyline([a, b], {color: '#fbbf24', weight: 3, dashArray: '6 4'}).addTo(sectionLayer);
    state.section = {a, b, profile: profileBetween(state.terrain.frame, state.terrain.elev, a, b, 120)};
    state.mode = 'location'; syncControls(); renderSection();
  }
  function renderSection() {
    sectionBox.replaceChildren();
    const sec = state.section;
    if (!sec) { sectionBox.append(el('p', {class: 'm-0 text-sm text-slate-300', text: state.sectionStart ? 'Click the second end of the section on the map.' : 'No section drawn yet. Press "Click: draw cross-section" above the map and click two points across a river or channel.'})); return; }
    const w = state.work, s = state.sim, pf = sec.profile, f = s?.done ? s.frames[Math.min(state.frame, s.frames.length - 1)] : null, thr = state.hide;
    const cellOf = p => { const i = Math.floor(p.px / w.factor), j = Math.floor(p.py / w.factor); return i >= 0 && j >= 0 && i < w.n && j < w.n ? j * w.n + i : -1; };
    const cells = pf.map(cellOf), ground = pf.map(p => [p.dist, finite(p.z) ? p.z : null]);
    const eta = (arr, c) => c >= 0 && arr[c] > thr ? w.z[c] + arr[c] : null;
    const series = [];
    if (f) { series.push({name: 'Water level (selected time)', color: '#38bdf8', type: 'area', data: pf.map((p, k) => [p.dist, eta(f.depth, cells[k])]), opacity: 0.85, fmt: v => v.toFixed(2) + ' m'}); }
    if (s?.done) series.push({name: 'Highest water level', color: '#f472b6', type: 'line', dash: '5 3', width: 1.6, data: pf.map((p, k) => [p.dist, eta(s.maxDepth, cells[k])]), fmt: v => v.toFixed(2) + ' m'});
    series.push({name: 'Ground (DEM)', color: '#64748b', type: 'area', opacity: 1, data: ground, width: 2, fmt: v => v.toFixed(1) + ' m'});
    let rmse = null;
    if (state.survey) {
      series.push({name: 'Surveyed section', color: '#fb923c', type: 'line', width: 2.2, data: state.survey.points, fmt: v => v.toFixed(2) + ' m'});
      const errs = state.survey.points.map(([d, z]) => { const k = pf.findIndex(p => p.dist >= d); if (k <= 0 || !finite(pf[k].z) || !finite(pf[k - 1].z)) return null; const t = (d - pf[k - 1].dist) / (pf[k].dist - pf[k - 1].dist); return z - (pf[k - 1].z + t * (pf[k].z - pf[k - 1].z)); }).filter(finite);
      if (errs.length) rmse = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
    }
    const length = pf[pf.length - 1].dist, xMax = Math.max(length, ...(state.survey ? [state.survey.points[state.survey.points.length - 1][0]] : [0]));
    const zs = series.flatMap(x => x.data.map(d => d[1]).filter(finite));
    sectionBox.append(drawChart({xDomain: [0, xMax], yDomain: extent(zs, 0.12), xFmt: v => Math.round(v) + ' m', hoverX: v => 'Chainage ' + Math.round(v) + ' m', yFmt: v => v.toFixed(0), yTitle: 'elevation (m)', xTitle: 'distance along section', series, label: 'Cross-section'}));
    if (s?.done) {
      const depthAt = arr => Math.max(0, ...cells.map(c => c >= 0 ? arr[c] : 0)), series2 = s.frames.map(fr => [fr.hour, depthAt(fr.depth)]);
      const peak = series2.reduce((b, d) => d[1] > b[1] ? d : b, series2[0]), wet = cells.filter(c => c >= 0 && s.maxDepth[c] > thr).length;
      sectionBox.append(el('p', {class: 'm-0 mb-1 mt-3 text-xs font-bold text-slate-300', text: 'Deepest water along the section over time (click to jump)'}),
        drawChart({height: 170, xDomain: [0, s.hours], yDomain: [0, Math.max(0.1, ...series2.map(d => d[1])) * 1.2], xFmt: v => '+' + v + ' h', hoverX: v => '+' + v.toFixed(0) + ' h', yTitle: 'depth (m)', vlines: [{x: f.hour, color: '#f472b6'}], label: 'Section depth over time',
          onPick: h => { state.frame = s.frames.reduce((best, fr, k) => Math.abs(fr.hour - h) < Math.abs(s.frames[best].hour - h) ? k : best, 0); frameChanged(); },
          series: [{name: 'Deepest water on the section', color: '#38bdf8', type: 'area', data: series2, fmt: v => v.toFixed(2) + ' m'}]}));
      sectionBox.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-300', text: `Peak ${peak[1].toFixed(2)} m at +${peak[0].toFixed(0)} h · wet over ${Math.round(wet / pf.length * length)} m of the ${Math.round(length)} m line (cell depth, ~${Math.round(w.cellM)} m cells). Discharge through the section is not reported: the model grid is too coarse to resolve a river channel.`}));
    }
    if (state.survey) sectionBox.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-300', text: `Surveyed section ${state.survey.name}: ${rmse === null ? 'it does not overlap the drawn line.' : `the DEM differs from your survey by ${rmse.toFixed(2)} m RMS over the overlap. The survey is shown for comparison and does not change the model.`}`}));
  }
  function renderNotes() {
    notes.replaceChildren(el('p', {class: 'm-0 font-bold text-slate-200', text: 'Method and limits'}),
      el('ul', {class: 'm-0 mt-1 list-disc pl-5'}, ...[
        'Screening only, not an official flood forecast or warning. Follow NDMA, PMD and Flood Forecasting Division (FFD) warnings.',
        'Rain is the ECMWF IFS forecast only. Gauge correction scales it by observed / modelled 24 h totals at fresh WeatherWalay gauges within 60 km (PMD gauges use a different day window and are left out), limited to ×0.5 to ×3.',
        'Losses use the SCS curve number (USDA TR-55). With ESA WorldCover (10 m, 2021) each model cell has its own cover, curve number and Manning n; the soil group you choose applies to the whole map (there is no soil map yet) and antecedent moisture comes from the previous 5 days of rain (growing season taken as April to October). WorldCover classes without a published crosswalk (bare, snow, wetland, moss) are mapped by this tool.',
        'Terrain is the free AWS Terrain Tiles surface (about 30 m, SRTM/Copernicus class), averaged to 130–200 m for the model. It is a surface model, not LiDAR. No free open LiDAR exists for Pakistan that I know of: import your own surveyed sections for comparison. The river channel comes from Sentinel-1 (Otsu water threshold, water in at least half of 12 monthly scenes) and can be burnt into the model by a depth you choose; there is no bathymetry.',
        'The 2D model is a local-inertial shallow-water solver with Manning roughness (Chow 1959). It only simulates rain falling inside the map: river inflow from upstream is not included, so it cannot reproduce a flood wave arriving from the mountains.',
        '20-year and 100-year what-ifs are ERA5 annual-maximum daily rain fitted with a Gumbel distribution, spread over 24 h as a centred triangle (an assumption). ERA5 under-states local extremes, so treat them as lower bounds.',
        'Observed floods are Sentinel-1 water minus permanent water and ground steeper than 5° (radar shadow). Radar also misreads wind-roughened water, dense vegetation and urban areas, so treat it as an indication. People are a lower bound: OSM buildings tagged as homes times the average Pakistan household (6.3, editable); untagged buildings and OSM gaps are missed. Not included: upstream river inflow, a soil map and WorldPop population (it cannot be read from a browser).',
      ].map(t => el('li', {text: t}))));
  }

  // ---------- loading ----------
  async function computeGauge() {
    const pairs = [], list = [];
    const b = state.rain && splitAtNow(state.rain, nowLocal());
    try {
      const gauges = nearbyGauges(state.stations?.stations?.stations, state.place);
      if (gauges.length) {
        const models = await fetchGaugeModels(gauges, pointCtl?.signal);
        gauges.forEach((g, i) => { const m = splitAtNow(models[i], nowLocal()).past, model = m.length >= 24 ? sum(m.slice(-24)) : null; list.push({...g, model}); pairs.push({gauge: g.rain, model}); });
      }
    } catch { /* model rain at the gauges unavailable: no correction from them */ }
    if (state.importedGauge && b && b.past.length >= 24) {
      const now = Date.now(), gauge = sum(state.importedGauge.records.filter(r => r.time >= now - 86400000 && r.time <= now).map(r => r.value));
      pairs.push({gauge, model: sum(b.past.slice(-24))}); list.push({name: 'Imported record', km: 0, rain: gauge, model: sum(b.past.slice(-24))});
    }
    state.gauge = {...gaugeFactor(pairs), list};
  }
  async function loadPoint() {
    if (!started) return;
    ensureMap();
    pointCtl?.abort(); pointCtl = new AbortController();
    const signal = pointCtl.signal, place = state.place;
    state.error = ''; state.status = 'Loading forecast, ERA5 record and terrain…';
    state.rain = null; state.fit = null; state.maxima = []; state.gauge = null; state.terrain = null; state.work = null; state.section = null; state.sectionStart = null; sectionLayer?.clearLayers();
    simToken = null; state.progress = null; state.sim = null; state.simSeries = null; state.buildings = null; buildingLayer?.clearLayers(); stopPlay();
    for (const k of Object.keys(overlays)) { overlays[k].remove(); delete overlays[k]; }
    domainBox?.remove(); eo.reset(); recompute();
    const stationsP = fetchObservations(signal).then(o => { state.stations = o; }, () => { state.stations = null; });
    const rainP = fetchRain(place.lat, place.lon, signal).then(r => { state.rain = r; });
    const histP = fetchHistory(place.lat, place.lon, signal).then(h => { state.maxima = annualMaxima(h.time, h.precip); state.fit = gumbelFit(state.maxima.map(m => m.max)); });
    const terrP = loadTerrain(place.lat, place.lon, signal).then(t => { state.terrain = t; });
    const lcP = eo.loadLandCover(mosaicFrame(place.lat, place.lon), signal);
    const errors = [];
    await Promise.all([rainP, histP, terrP, stationsP, lcP].map(p => p.catch(e => { if (e?.name !== 'AbortError') errors.push(e); })));
    if (signal.aborted) return;
    if (state.terrain) { const f = state.terrain.frame; domainBox = L.rectangle([[f.south, f.west], [f.north, f.east]], {color: '#38bdf8', weight: 1, fill: false, dashArray: '4 4', interactive: false}).addTo(map); eo.drawLandCover(); buildWork(); }
    await computeGauge();
    if (signal.aborted) return;
    state.status = ''; state.error = errors.length ? 'Some data could not be loaded: ' + [...new Set(errors.map(e => e.message))].join(' · ') : '';
    placeMarker(false); if (domainBox) map.fitBounds(domainBox.getBounds(), {padding: [20, 20]}); recompute();
    mapNote.textContent = state.terrain ? 'Dashed box = the area the model covers. Click the map to move the place.' : '';
  }
  function setPlace(p) { state.place = p; syncControls(); if (started) { placeMarker(); loadPoint(); } }

  function rebuild() { buildWork(); recompute(); }
  function renderEoCards() { eo.renderEo(eoBox); eo.renderObs(obsBox); }
  function renderMapTools() {
    const toggle = btn(state.view3d ? '2D map' : '3D view', () => state.view3d ? eo.hide3D() : eo.show3D(), 'min-h-[36px] text-xs');
    const exag = sel('Vertical exaggeration', [[1, 'Height ×1'], [1.5, 'Height ×1.5'], [2, 'Height ×2'], [3, 'Height ×3']], 'exag', () => eo.set3DExaggeration());
    exag.hidden = !state.view3d;
    toolsBar.replaceChildren(toggle, exag, el('span', {class: 'text-xs text-slate-400', text: state.view3d ? 'Drag to look around; right-drag or Ctrl-drag tilts. Red buildings are flooded.' : ''}));
  }

  // ---------- wiring ----------
  document.addEventListener('forecastlocationchange', e => { const c = e.detail || cities[getSelected()]; if (c) setPlace({name: c[0], lat: c[1], lon: c[2]}); });
  const start = () => { if (started) return; started = true; ensureMap(); loadPoint(); };
  syncControls(); render();
  const reveal = () => { if (location.hash === '#flood') start(); };
  window.addEventListener('hashchange', reveal); reveal();
  document.addEventListener('viewchange', e => { if (e.detail === 'flood-view') { start(); setTimeout(() => map?.invalidateSize(), 50); } else stopPlay(); });
}
