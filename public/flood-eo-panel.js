// FloodAI Earth-observation features: per-pixel land cover, Sentinel-1 river mapping, observed floods,
// flooded cropland, people estimate and the 3D view. Works on the shared panel state from flood-panel.js.
import {
  WORLDCOVER, CROPLAND_CODE, modeDownsample, coverClasses, fillMissingClass, otsu, addHistogram, waterMask, majorityFilter, maskSteep, waterFrequency, channelFrom, bankCells, burnChannel,
  slopeDeg, observedFlood, blockFraction, compareMasks, cropAreaKm2, peopleEstimate, buildingHeight, RESIDENTIAL_BUILDINGS, HOUSEHOLD_SIZE, byteToDb, DB_RANGE,
  searchMonthlyS1, searchEventS1, fetchS1, fetchWorldCover, SLOPE_MAX_DEG, CHANNEL_MIN_FREQ,
} from './flood-eo.js';
import {LAND_COVER, curveNumber} from './flood-logic.js';
import {metresPerPixel, downstream, latLonOfPixel} from './flood-terrain.js';
import {depthColor} from './flood-model.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 1, unit = '') => finite(v) ? v.toFixed(d) + unit : '–';
export const MIN_SCENES = 6;   // fewer scenes than this cannot give a meaningful water frequency (a safeguard)
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function initEoPanel(api) {
  const {state, el, btn, sel, drawChart, canvasURL, setOverlay, syncLayers, rebuild, render, getMap, mapBox, mapBox3d} = api;
  Object.assign(state, {lcCodes: null, lcError: '', river: null, burn: 0, household: HOUSEHOLD_SIZE, events: {date: '', list: [], pick: ''}, obs: null, eoStatus: '', eoError: '', eoBusy: false, view3d: false, exag: 1.5});
  let riverCtl, map3 = null, skillCache = null;
  const mpp = () => metresPerPixel(state.terrain.frame.centreLat, state.terrain.frame.z);
  const busy = text => { state.eoStatus = text; state.eoError = ''; state.eoBusy = !!text; api.renderEo(); };
  const fail = e => { if (e?.name === 'AbortError') return; state.eoStatus = ''; state.eoBusy = false; state.eoError = e?.message || String(e); api.renderEo(); };

  // ---------- land cover ----------
  async function loadLandCover(frame, signal) {
    state.lcCodes = null; state.lcError = '';
    try { state.lcCodes = await fetchWorldCover(frame, signal); } catch (e) { if (e?.name === 'AbortError') throw e; state.lcError = e.message; }
  }
  function drawLandCover() {
    if (!state.lcCodes || !state.terrain) return;
    const size = state.terrain.frame.size;
    setOverlay('landcover', canvasURL(size, i => { const c = WORLDCOVER[state.lcCodes[i]]?.color; return c ? [...c, 150] : [0, 0, 0, 0]; }), 0);
  }
  // Called by buildWork: per-cell land cover on the model grid, the burnt channel and the thalweg.
  function workExtras({z, n, factor, filled, dir, catchment}) {
    const out = {lc: null, zSim: z, channelWork: null, thalweg: null};
    const size = state.terrain.frame.size;
    if (state.lcCodes) {
      const codes = modeDownsample(state.lcCodes, size, factor), all = coverClasses(codes);
      if (all.keys.length) out.lc = {codes, keys: all.keys, classOf: fillMissingClass(all.classOf, all.keys, all.share), share: all.share, catchShare: catchment ? coverClasses(codes, catchment.mask).share : all.share};
    }
    if (state.river?.channel) {
      const frac = blockFraction(state.river.channel, size, factor), mask = new Uint8Array(n * n);
      for (let c = 0; c < mask.length; c++) mask[c] = frac[c] >= 0.5 ? 1 : 0;
      out.channelWork = mask; out.zSim = burnChannel(z, mask, state.burn);
      // Thalweg: from the highest channel cell, follow the steepest-descent path while it stays in the channel.
      let start = -1;
      for (let c = 0; c < mask.length; c++) if (mask[c] && (start < 0 || filled[c] > filled[start])) start = c;
      const path = [];
      for (let c = start, guard = 0; c >= 0 && mask[c] && guard < n * n; c = downstream(dir, c, n), guard++) path.push(c);
      out.thalweg = path;
    }
    return out;
  }
  function drawWorkOverlays(w) {
    if (!w?.thalweg) return;
    const on = new Set(w.thalweg);
    setOverlay('thalweg', canvasURL(w.n, i => on.has(i) ? [244, 114, 182, 255] : [0, 0, 0, 0]), 3);
  }

  // ---------- river mapping ----------
  async function mapRiver() {
    const t = state.terrain;
    if (!t) return fail(Error('The terrain has not loaded yet.'));
    riverCtl?.abort(); riverCtl = new AbortController();
    const signal = riverCtl.signal, frame = t.frame;
    try {
      busy('Searching Sentinel-1 scenes for the last 12 months…');
      const end = new Date(), start = new Date(end.getTime() - 365 * 86400000);
      const scenes = await searchMonthlyS1(frame, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), signal);
      if (scenes.length < MIN_SCENES) throw Error(`Only ${scenes.length} full-coverage Sentinel-1 scenes were found for this place in 12 months (at least ${MIN_SCENES} are needed).`);
      const hist = new Array(256).fill(0), kept = [];
      for (let k = 0; k < scenes.length; k++) {
        busy(`Reading Sentinel-1 scene ${k + 1} of ${scenes.length} (${scenes[k].date})…`);
        const r = await fetchS1(frame, scenes[k].id, signal);
        if (r.covered < 0.5) continue;
        addHistogram(hist, r.bytes, r.alpha); kept.push({...scenes[k], bytes: r.bytes, alpha: r.alpha});
      }
      if (kept.length < MIN_SCENES) throw Error(`Only ${kept.length} usable scenes were read (at least ${MIN_SCENES} are needed).`);
      const thr = otsu(hist), slope = slopeDeg(t.elev, frame.size, mpp()), masks = kept.map(s => majorityFilter(maskSteep(waterMask(s.bytes, s.alpha, thr), slope, SLOPE_MAX_DEG), frame.size)), {freq} = waterFrequency(masks);
      const [px, py] = (await import('./flood-terrain.js')).pixelOfLatLon(frame, state.place.lat, state.place.lon), ch = channelFrom(freq, frame.size, px, py, {radius: 150});
      state.river = {freq, channel: ch.mask, banks: bankCells(ch.mask, frame.size), cells: ch.cells, thr, thrDb: byteToDb(thr), hist, scenes: kept.map(({id, date, orbit}) => ({id, date, orbit})), areaKm2: ch.cells * mpp() ** 2 / 1e6};
      drawRiver(); rebuild();
      state.eoStatus = ''; state.eoBusy = false; api.renderEo();
    } catch (e) { fail(e); }
  }
  function drawRiver() {
    const r = state.river;
    if (!r) return;
    setOverlay('river', canvasURL(state.terrain.frame.size, i => r.banks[i] ? [250, 204, 21, 255] : r.channel[i] ? [56, 189, 248, 230] : r.freq[i] >= CHANNEL_MIN_FREQ ? [125, 211, 252, 110] : [0, 0, 0, 0]), 2);
    syncLayers();
  }

  // ---------- observed flood ----------
  async function findScenes() {
    const t = state.terrain, d = state.events.date;
    if (!t || !d) return fail(Error('Choose the flood date first.'));
    riverCtl?.abort(); riverCtl = new AbortController();
    try {
      busy('Searching Sentinel-1 scenes after that date…');
      const end = new Date(Date.parse(d) + 12 * 86400000).toISOString().slice(0, 10);
      const list = await searchEventS1(t.frame, `${d}T00:00:00Z`, `${end}T23:59:59Z`, riverCtl.signal);
      state.events.list = list; state.events.pick = list[0]?.id || '';
      state.eoStatus = list.length ? '' : 'No full-coverage Sentinel-1 scene in the 12 days from that date. Try another date.'; state.eoBusy = false; api.renderEo();
    } catch (e) { fail(e); }
  }
  async function compareObserved() {
    const t = state.terrain, pick = state.events.list.find(s => s.id === state.events.pick);
    if (!t || !pick) return fail(Error('Find and choose a Sentinel-1 scene first.'));
    try {
      if (!state.river) { await mapRiver(); if (!state.river) return; }
      busy(`Reading the Sentinel-1 scene of ${pick.date}…`);
      riverCtl = new AbortController();
      const r = await fetchS1(t.frame, pick.id, riverCtl.signal);
      if (r.covered < 0.5) throw Error('That scene covers less than half of the map.');
      const slope = slopeDeg(t.elev, t.frame.size, mpp()), water = majorityFilter(waterMask(r.bytes, r.alpha, state.river.thr), t.frame.size), flood = observedFlood(water, state.river.freq, slope);
      let cells = 0;
      for (const v of flood) if (v === 1) cells++;
      const flag = Uint8Array.from(flood, v => v === 1 ? 1 : 0);
      state.obs = {scene: pick, flood, areaKm2: cells * mpp() ** 2 / 1e6, covered: r.covered, crop: state.lcCodes ? cropAreaKm2(flag, state.lcCodes, mpp()) : null};
      skillCache = null;
      setOverlay('observed', canvasURL(t.frame.size, i => flood[i] === 1 ? [251, 146, 60, 200] : [0, 0, 0, 0]), 4);
      syncLayers(); state.eoStatus = ''; state.eoBusy = false; render();
    } catch (e) { fail(e); }
  }
  // Model flood (maximum depth above the display filter) against the satellite flood, cell by cell on the model grid.
  function skill() {
    const s = state.sim, w = state.work;
    if (!state.obs || !s?.done || !w) return null;
    const key = s.maxDepth + ':' + state.hide;
    if (skillCache?.key === key) return skillCache.value;
    const model = new Uint8Array(s.maxDepth.length), observed = blockFraction(state.obs.flood, state.terrain.frame.size, w.factor);
    for (let c = 0; c < model.length; c++) {
      const river = w.channelWork?.[c];
      model[c] = !river && s.maxDepth[c] > state.hide ? 1 : 0;
      if (river) observed[c] = NaN;      // permanent river cells are left out of both
    }
    const value = compareMasks(model, observed);
    skillCache = {key, value};
    return value;
  }

  // ---------- exposure tiles ----------
  function exposureTiles(tile) {
    const out = [], s = state.sim, w = state.work;
    if (s?.done && w?.lc) {
      const flag = Uint8Array.from(s.maxDepth, d => d > state.hide ? 1 : 0), crop = cropAreaKm2(flag, w.lc.codes, w.cellM);
      out.push(tile('Flooded cropland', crop.totalKm2 ? fmt(crop.floodedKm2, 1, ' km²') : '–', crop.totalKm2 ? `of ${fmt(crop.totalKm2, 0)} km² cropland on the map` : 'no cropland on the map'));
    }
    if (state.buildings) out.push(tile('People (lower bound)', state.buildings.people.toLocaleString('en'), `${state.buildings.residential} flooded homes × ${state.household}`));
    if (state.obs) out.push(tile('Observed flood (S1)', fmt(state.obs.areaKm2, 1, ' km²'), state.obs.crop ? `${fmt(state.obs.crop.floodedKm2, 1)} km² cropland` : state.obs.scene.date));
    const k = skill();
    if (k) out.push(tile('Model vs satellite', k.csi === null ? '–' : 'CSI ' + k.csi.toFixed(2), k.pod === null ? '' : `POD ${k.pod.toFixed(2)} · FAR ${k.far === null ? '–' : k.far.toFixed(2)}`));
    return out;
  }
  function buildingStats(buildings, maxDepth, cellOf) {
    let flooded = 0, residential = 0;
    const items = buildings.map(b => {
      const c = cellOf(b), depth = c >= 0 ? maxDepth[c] : 0, wet = depth > state.hide;
      if (wet) { flooded++; if (RESIDENTIAL_BUILDINGS.has(b.tags.building)) residential++; }
      return {ring: b.ring, lat: b.lat, lon: b.lon, wet, depth, height: buildingHeight(b.tags)};
    });
    return {total: buildings.length, flooded, residential, people: peopleEstimate(residential, state.household), items};
  }

  // ---------- cards ----------
  function renderEo(box) {
    box.replaceChildren();
    const r = state.river, w = state.work;
    const lcBox = el('div', {class: 'rounded-xl border border-slate-600 bg-slate-900 p-3'});
    lcBox.append(el('p', {class: 'm-0 text-xs font-bold text-slate-300', text: 'Land cover (ESA WorldCover 2021, 10 m) on the model grid'}));
    if (w?.lc) {
      const bar = el('div', {class: 'mt-2 flex h-4 overflow-hidden rounded'}), list = el('div', {class: 'mt-2 grid gap-1 text-xs text-slate-200 sm:grid-cols-2'});
      const colorOf = key => Object.values(WORLDCOVER).find(v => v.key === key)?.color || [120, 120, 120];
      w.lc.keys.forEach((k, i) => {
        const pct = w.lc.share[i] * 100, [cr, cg, cb] = colorOf(k);
        bar.append(el('div', {style: `width:${pct}%;background:rgb(${cr},${cg},${cb})`, title: `${LAND_COVER[k].label}: ${pct.toFixed(1)} %`}));
        list.append(el('div', {}, el('span', {class: 'mr-2 inline-block h-2.5 w-2.5 rounded-sm', style: `background:rgb(${cr},${cg},${cb})`}), `${LAND_COVER[k].label} ${pct.toFixed(1)} % · CN ${curveNumber(k, state.soil)} · n ${LAND_COVER[k].n}`));
      });
      lcBox.append(bar, list, el('p', {class: 'm-0 mt-2 text-[11px] text-slate-400', text: 'Curve numbers use AMC II and the soil group you chose for the whole map (no soil map yet). WorldCover classes without a published crosswalk (bare, snow, wetland, moss) are this tool’s mapping.'}));
    } else lcBox.append(el('p', {class: 'm-0 mt-1 text-sm text-slate-300', text: state.lcError ? 'Land cover unavailable (' + state.lcError + '): one cover is used for the whole map.' : state.terrain ? 'Loading land cover…' : 'Waiting for the terrain…'}));
    const mapBtn = btn(state.eoBusy ? 'Working…' : r ? 'Re-map the river' : 'Map the river from 12 months of Sentinel-1', mapRiver, 'bg-sky-500 text-slate-950 hover:bg-sky-400 border-sky-300');
    mapBtn.disabled = state.eoBusy || !state.terrain;
    const burn = sel('Channel burn depth', [[0, 'Channel burn: off'], [1, 'Burn 1 m'], [2, 'Burn 2 m'], [3, 'Burn 3 m'], [5, 'Burn 5 m']], 'burn', rebuild);
    const riverBox = el('div', {class: 'rounded-xl border border-slate-600 bg-slate-900 p-3'}, el('p', {class: 'm-0 text-xs font-bold text-slate-300', text: 'River channel from Sentinel-1 radar (VV backscatter)'}),
      el('div', {class: 'mt-2 flex flex-wrap items-center gap-2'}, mapBtn, burn));
    if (state.eoStatus) riverBox.append(el('p', {class: 'm-0 mt-2 text-sm text-sky-200', role: 'status', text: state.eoStatus}));
    if (state.eoError) riverBox.append(el('p', {class: 'm-0 mt-2 text-sm text-amber-200', role: 'status', text: state.eoError}));
    if (r) {
      const hist = r.hist.map((c, b) => [byteToDb(b + 0.5), c]);
      riverBox.append(el('p', {class: 'm-0 mt-2 text-sm text-slate-200', text: r.cells ? `Channel found: ${fmt(r.areaKm2, 2)} km² of water in at least ${CHANNEL_MIN_FREQ * 100} % of ${r.scenes.length} monthly scenes (${r.scenes[0].date} to ${r.scenes[r.scenes.length - 1].date}, orbit ${r.scenes[0].orbit}).` : 'No river channel was found within about 5 km of this point: no connected body of water was wet in half of the scenes.'}),
        el('p', {class: 'm-0 mb-1 mt-2 text-xs font-bold text-slate-300', text: 'Backscatter of all scenes and the automatic water threshold (Otsu)'}),
        drawChart({height: 170, xDomain: [DB_RANGE[0], DB_RANGE[1]], yDomain: [0, Math.max(...hist.map(h => h[1])) * 1.05], xFmt: v => v + ' dB', hoverX: v => v.toFixed(1) + ' dB', yFmt: v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : v, yTitle: 'pixels', vlines: [{x: r.thrDb, label: `water ≤ ${r.thrDb.toFixed(1)} dB`, color: '#38bdf8'}], label: 'Sentinel-1 backscatter histogram',
          series: [{name: 'Pixels', color: '#94a3b8', type: 'bar', data: hist, barWidth: 35 / 256, fmt: v => Math.round(v).toLocaleString('en')}]}),
        el('p', {class: 'm-0 mt-1 text-xs text-slate-400', text: 'Map legend: pale blue = water in at least half the scenes but not connected to the river, blue = river channel, yellow = banks, pink line = thalweg (steepest-descent path along the channel). The burn lowers the channel in the flood model by the depth chosen; no bathymetry is available, so that depth is your assumption.'}));
    }
    box.append(el('div', {class: 'grid gap-3 lg:grid-cols-2'}, lcBox, riverBox));
  }
  function renderObs(box) {
    box.replaceChildren();
    const ev = state.events, date = el('input', {type: 'date', value: ev.date, max: new Date().toISOString().slice(0, 10), 'aria-label': 'Flood date', class: 'min-h-[40px] rounded-xl border border-slate-600 bg-slate-900 px-2 text-sm text-white'});
    date.addEventListener('change', () => { ev.date = date.value; });
    const find = btn('Find Sentinel-1 scenes', findScenes); find.disabled = state.eoBusy || !state.terrain;
    const row = el('div', {class: 'flex flex-wrap items-center gap-2'}, el('label', {class: 'text-sm text-slate-200'}, 'Flood date ', date), find);
    if (ev.list.length) {
      const pick = el('select', {'aria-label': 'Sentinel-1 scene', class: 'min-h-[40px] rounded-xl border border-slate-600 bg-slate-900 px-2 text-sm text-white'});
      for (const s of ev.list) pick.append(new Option(`${s.date} UTC · orbit ${s.orbit}`, s.id));
      pick.value = ev.pick; pick.addEventListener('change', () => { ev.pick = pick.value; });
      const go = btn('Map the observed flood', compareObserved, 'bg-sky-500 text-slate-950 hover:bg-sky-400 border-sky-300'); go.disabled = state.eoBusy;
      row.append(pick, go);
    }
    box.append(row, el('p', {class: 'm-0 mt-2 text-xs text-slate-400', text: `Water in the scene (same threshold and 3×3 despeckle as the river map) minus permanent water and ground steeper than ${SLOPE_MAX_DEG}° (radar shadow). The first river map runs automatically if needed. Run the simulation for the same rain to compare.`}));
    if (state.eoStatus) box.append(el('p', {class: 'm-0 mt-2 text-sm text-sky-200', role: 'status', text: state.eoStatus}));
    if (state.eoError) box.append(el('p', {class: 'm-0 mt-2 text-sm text-amber-200', role: 'status', text: state.eoError}));
    const o = state.obs, k = skill();
    if (o) {
      box.append(el('p', {class: 'm-0 mt-2 text-sm text-slate-200', text: `Sentinel-1 ${o.scene.date}: ${fmt(o.areaKm2, 2)} km² of flood water outside the permanent river${o.crop ? `, of which ${fmt(o.crop.floodedKm2, 2)} km² is cropland` : ''}. Orange on the map. Scene covers ${Math.round(o.covered * 100)} % of the map.`}));
      if (k) {
        const cell = (label, value, hint) => el('div', {class: 'rounded-lg border border-slate-600 bg-slate-950 p-2', title: hint}, el('p', {class: 'm-0 text-[11px] text-slate-300', text: label}), el('p', {class: 'm-0 text-base font-bold text-white', text: value}));
        box.append(el('div', {class: 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4'}, cell('Hit rate (POD)', k.pod === null ? '–' : k.pod.toFixed(2), 'share of observed flooded cells the model also flooded'), cell('False alarms (FAR)', k.far === null ? '–' : k.far.toFixed(2), 'share of modelled flooded cells the satellite did not see'),
          cell('Critical success (CSI)', k.csi === null ? '–' : k.csi.toFixed(2), 'hits / (hits + misses + false alarms); 1 is perfect'), cell('Cells compared', k.compared.toLocaleString('en'), `${k.hits} hits · ${k.misses} misses · ${k.falseAlarms} false alarms`)));
        box.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-400', text: 'Skill is only meaningful if the simulation used the rain of that flood: pick a scenario that matches it (for example your bulletin rainfall) and run it.'}));
      } else box.append(el('p', {class: 'm-0 mt-1 text-xs text-slate-400', text: 'Run a flood simulation to score the model against this scene.'}));
    }
  }

  // ---------- 3D ----------
  async function loadMapLibre() {
    if (window.maplibregl) return;
    await new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/maplibre-gl.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = 'vendor/maplibre-gl.js'; js.onload = resolve; js.onerror = () => reject(Error('The 3D library could not be loaded.')); document.head.append(js);
    });
  }
  async function show3D() {
    try {
      await loadMapLibre();
      state.view3d = true; mapBox.hidden = true; mapBox3d.hidden = false;
      const f = state.terrain?.frame, centre = [state.place.lon, state.place.lat];
      if (!map3) {
        map3 = new maplibregl.Map({container: mapBox3d, center: centre, zoom: 11.5, pitch: 62, bearing: 15, maxPitch: 82, attributionControl: {compact: true}, canvasContextAttributes: {preserveDrawingBuffer: true},
          style: {version: 8, sources: {sat: {type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri'}, dem: {type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Terrain: AWS Terrain Tiles'}}, layers: [{id: 'sat', type: 'raster', source: 'sat'}]}});
        mapBox3d._map3 = map3;   // handle for browser tests
        map3.addControl(new maplibregl.NavigationControl());
        map3.on('load', () => { map3.setTerrain({source: 'dem', exaggeration: state.exag}); update3D(true); });
      } else { map3.resize(); map3.setTerrain({source: 'dem', exaggeration: state.exag}); update3D(true); }
      if (f) map3.fitBounds([[f.west, f.south], [f.east, f.north]], {pitch: 62, bearing: 15, padding: 30, duration: 0});
      api.renderMapTools();
    } catch (e) { state.view3d = false; mapBox.hidden = false; mapBox3d.hidden = true; state.eoError = e.message; api.renderEo(); }
  }
  function hide3D() { state.view3d = false; mapBox.hidden = false; mapBox3d.hidden = true; getMap()?.invalidateSize(); api.renderMapTools(); }
  function set3DExaggeration() { if (map3?.getTerrain?.()) map3.setTerrain({source: 'dem', exaggeration: state.exag}); }
  // Flood depth and observed flood go into the 3D map as GeoJSON cell polygons (draped on the terrain), and
  // buildings as extruded footprints. Image sources are avoided: they render black over terrain in MapLibre here.
  const cornerCache = new WeakMap();
  function corners(w) {
    if (!cornerCache.has(w)) {
      const f = state.terrain.frame;
      cornerCache.set(w, Array.from({length: w.n + 1}, (_, j) => Array.from({length: w.n + 1}, (_, i) => { const [la, lo] = latLonOfPixel(f, i * w.factor, j * w.factor); return [lo, la]; })));
    }
    return cornerCache.get(w);
  }
  function cellCollection(w, valueOf) {
    const g = corners(w), features = [];
    for (let j = 0; j < w.n; j++) for (let i = 0; i < w.n; i++) {
      const v = valueOf(j * w.n + i);
      if (v !== null) features.push({type: 'Feature', properties: {d: v}, geometry: {type: 'Polygon', coordinates: [[g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i], g[j][i]]]}});
    }
    return {type: 'FeatureCollection', features};
  }
  const DEPTH_COLOR = ['interpolate', ['linear'], ['get', 'd'], 0.05, '#9bd3ff', 0.5, '#3b9cf2', 1.5, '#1d4ed8', 3, '#312e81'];
  function setGeo(id, data, layer) {
    if (map3.getSource(id)) { map3.getSource(id).setData(data); return; }
    map3.addSource(id, {type: 'geojson', data});
    map3.addLayer({id, source: id, ...layer}, map3.getLayer('bld') ? 'bld' : undefined);
  }
  function update3D(rebuildAll = false) {
    if (!map3 || !state.view3d) return;
    if (!map3.isStyleLoaded()) { map3.once('idle', () => update3D(true)); return; }
    const w = state.work, depth = api.currentDepth(), empty = {type: 'FeatureCollection', features: []};
    if (!w || !state.terrain) return;
    setGeo('flood3d', depth ? cellCollection(w, c => depth[c] > state.hide ? depth[c] : null) : empty, {type: 'fill', paint: {'fill-color': DEPTH_COLOR, 'fill-opacity': 0.8}});
    if (rebuildAll || !map3.getSource('observed3d')) {
      let obsData = empty;
      if (state.obs) {
        const frac = blockFraction(state.obs.flood, state.terrain.frame.size, w.factor);
        obsData = cellCollection(w, c => frac[c] >= 0.5 && !w.channelWork?.[c] ? 1 : null);
      }
      setGeo('observed3d', obsData, {type: 'fill', paint: {'fill-color': '#fb923c', 'fill-opacity': 0.75}});
    }
    if (rebuildAll || !map3.getSource('bld')) {
      const data = {type: 'FeatureCollection', features: (state.buildings?.items || []).map(b => ({type: 'Feature', properties: {height: b.height, wet: b.wet ? 1 : 0}, geometry: {type: 'Polygon', coordinates: [b.ring.concat([b.ring[0]])]}}))};
      if (map3.getSource('bld')) map3.getSource('bld').setData(data);
      else { map3.addSource('bld', {type: 'geojson', data}); map3.addLayer({id: 'bld', type: 'fill-extrusion', source: 'bld', paint: {'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-color': ['case', ['==', ['get', 'wet'], 1], '#ef4444', '#cbd5e1'], 'fill-extrusion-opacity': 0.85}}); }
    }
  }
  return {loadLandCover, drawLandCover, workExtras, drawWorkOverlays, drawRiver, mapRiver, renderEo, renderObs, exposureTiles, buildingStats, show3D, hide3D, update3D, set3DExaggeration,
    reset() { riverCtl?.abort(); state.river = null; state.obs = null; state.events.list = []; state.events.pick = ''; state.eoStatus = ''; state.eoError = ''; state.eoBusy = false; state.lcCodes = null; state.lcError = ''; skillCache = null; if (map3) update3D(true); }};
}
