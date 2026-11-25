// Climate & hazard risk panel on the main dashboard: ERA5 map by day / month / year, IMD-criteria
// hazard screening for one place from ERA5 history, the nearest live station and the ECMWF forecast.
import {
  IMD, ETCCDI, HILLS_FROM_ELEVATION_M, autoTerrain, buildNormals, evaluateDaily, yearlySummary, frequency, periodMean, trendPerDecade, periodSummary,
  observedScreen, rampColor, RAMPS, absoluteScreen, rainClass, daysInMonth,
} from './climate-hazards.js';
import {ERA5, latestERA5Date, pktDate, fetchHistory, fetchRange, fetchForecast, fetchGrid, fetchObservations, periodRange, GRID_STEP} from './climate-era5.js';
import {chooseCurrentSource, currentValue} from './current-weather.js';
import {darkMap} from './map-utils.js';
import {observationPopup, isStale} from './observations.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (v, d = 1, unit = '') => finite(v) ? v.toFixed(d) + unit : '–';
const signed = (v, d = 1) => finite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '–';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// Chip colours by severity. Heat and cold use different hues so a map or card reads at a glance.
const CHIP = {
  none: 'border-slate-600 bg-slate-800 text-slate-300',
  unknown: 'border-slate-600 bg-slate-900 text-slate-400',
  heat1: 'border-amber-400/70 bg-amber-500/20 text-amber-200', heat2: 'border-red-400/80 bg-red-500/25 text-red-200',
  cold1: 'border-sky-400/70 bg-sky-500/20 text-sky-200', cold2: 'border-indigo-400/80 bg-indigo-500/25 text-indigo-200',
  rain1: 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200', rain2: 'border-violet-400/80 bg-violet-500/25 text-violet-200',
};
const chip = (text, kind) => el('span', {class: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ' + (CHIP[kind] || CHIP.none), text});
const label = text => el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300', text});

// The hazards shown as cards. `level` readers return 0 (none), 1, 2 or null (unknown).
const HAZARDS = [
  {id: 'heat', title: 'Heat wave', hue: 'heat', key: 'heatDays', severeKey: 'severeHeatDays', fc: r => r.heatMet, fcDeclared: r => r.heatDeclared, obs: o => o.heat.level,
    words: ['No heat wave', 'Heat wave', 'Severe heat wave'], rule: () => `Tmax ≥ ${IMD.heat.floor.plains} °C (plains) and ${IMD.heat.departure.wave} °C above normal; ${IMD.heat.departure.severe}+ is severe. Or Tmax ≥ ${IMD.heat.absolute.wave} / ${IMD.heat.absolute.severe} °C. Two days running.`},
  {id: 'warm', title: 'Warm night', hue: 'heat', key: 'warmNights', fc: r => r.warmNight.level, fcDeclared: r => r.warmNightDeclared, obs: null,
    words: ['No warm night', 'Warm night', 'Very warm night'], rule: () => `Tmin ${IMD.warmNight.departure.warm} °C above normal ( ${IMD.warmNight.departure.veryWarm}+ is very warm) while a heat wave is declared.`},
  {id: 'cold', title: 'Cold wave', hue: 'cold', key: 'coldDays', severeKey: 'severeColdDays', fc: r => r.coldMet, fcDeclared: r => r.coldDeclared, obs: o => o.cold.level,
    words: ['No cold wave', 'Cold wave', 'Severe cold wave'], rule: () => `Tmin ≤ ${IMD.cold.ceiling.plains} °C (plains) and ${Math.abs(IMD.cold.departure.wave)} °C below normal; ${Math.abs(IMD.cold.departure.severe)}+ is severe. Or Tmin ≤ ${IMD.cold.absolute.wave} / ${IMD.cold.absolute.severe} °C. Two days running.`},
  {id: 'frost', title: 'Frost day', hue: 'cold', key: 'frostDays', fc: r => r.frost === null ? null : r.frost ? 1 : 0, fcDeclared: null, obs: o => o.frost ? 1 : 0,
    words: ['No frost', 'Frost', 'Frost'], rule: () => `Tmin below ${ETCCDI.frostBelow} °C (ETCCDI frost day, not an IMD category).`},
  {id: 'rain', title: 'Heavy rain', hue: 'rain', key: 'heavyRainDays', fc: r => r.rain.level === null ? null : r.rain.level >= 5 ? 2 : r.rain.level >= 4 ? 1 : 0, fcDeclared: null, obs: null,
    words: ['Below heavy', 'Heavy rain', 'Very heavy or more'], rule: () => 'IMD 24-hour classes: heavy ≥ 64.5 mm, very heavy ≥ 115.6 mm, extremely heavy ≥ 204.5 mm. ERA5 tends to under-state local extremes.'},
];
const kindOf = (hue, level) => level === null || level === undefined ? 'unknown' : level <= 0 ? 'none' : hue + Math.min(2, level);

export function initClimatePanel({cities, getSelected}) {
  const root = document.getElementById('climate');
  if (!root) return;
  const latest = latestERA5Date(), [ly, lm, ld] = latest.split('-').map(Number);
  const state = {
    mode: 'day', year: ly, month: lm, day: ld, layer: 'tmax', terrainChoice: 'auto',
    place: cities[getSelected()] ? {name: cities[getSelected()][0], lat: cities[getSelected()][1], lon: cities[getSelected()][2], custom: false} : null,
    data: null, grid: null, error: '', loading: false, stations: null, showStations: true, showAirports: true,
  };
  let started = false, map, cellLayer, stationLayer, stationRenderer, pointMarker, pointController, gridController, gridTimer;

  // ---------- skeleton ----------
  const select = (id, aria) => el('select', {id, 'aria-label': aria, class: 'min-h-[40px] rounded-xl border border-slate-600 bg-slate-900 px-2 text-sm font-semibold text-white'});
  const yearSel = select('climate-year', 'Year'), monthSel = select('climate-month', 'Month'), daySel = select('climate-day', 'Day');
  const layerSel = select('climate-layer', 'Map layer'), terrainSel = select('climate-terrain', 'Terrain for IMD criteria');
  for (let y = ly; y >= ERA5.first; y--) yearSel.append(new Option(String(y), String(y)));
  for (const [value, text] of [['tmax', 'Maximum temperature'], ['tmin', 'Minimum temperature'], ['tmean', 'Mean temperature'], ['precip', 'Rainfall'], ['hazard', 'Heat / cold screen (day only)']]) layerSel.append(new Option(text, value));
  for (const [value, text] of [['auto', 'Terrain: auto'], ['plains', 'Terrain: plains'], ['hills', 'Terrain: hills'], ['coastal', 'Terrain: coastal']]) terrainSel.append(new Option(text, value));
  const toggle = (id, text, key) => {
    const input = el('input', {type: 'checkbox', id, class: 'h-4 w-4 accent-emerald-400'});
    input.checked = state[key];
    input.addEventListener('change', () => { state[key] = input.checked; drawStations(); });
    return el('label', {class: 'inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm font-semibold text-white'}, input, text);
  };
  const modeBar = el('div', {class: 'flex rounded-xl border border-slate-600 bg-slate-900 p-1', role: 'group', 'aria-label': 'Period'});
  for (const [mode, text] of [['day', 'Day'], ['month', 'Month'], ['year', 'Year']]) {
    const b = el('button', {type: 'button', 'data-mode': mode, text, class: 'min-h-[36px] rounded-lg px-3 text-sm font-bold'});
    b.addEventListener('click', () => { state.mode = mode; if (mode !== 'day' && state.layer === 'hazard') state.layer = 'tmax'; syncControls(); changed(); });
    modeBar.append(b);
  }
  const placeLine = el('p', {class: 'm-0 text-sm text-slate-200'});
  const resetBtn = el('button', {type: 'button', class: 'min-h-[36px] rounded-lg border border-slate-500 bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800', text: 'Use selected city'});
  resetBtn.addEventListener('click', () => { const c = cities[getSelected()]; if (c) { state.place = {name: c[0], lat: c[1], lon: c[2], custom: false}; loadPoint(); syncControls(); } });
  const mapBox = el('div', {id: 'climate-map', class: 'h-[360px] w-full rounded-xl border border-slate-600 sm:h-[440px]', role: 'application', 'aria-label': 'ERA5 climate map of Pakistan'});
  const legend = el('div', {class: 'mt-2 text-xs text-slate-300', 'aria-live': 'polite'});
  const stationNote = el('p', {class: 'm-0 mt-1 text-xs text-slate-300'});
  const mapStatus = el('p', {class: 'm-0 mt-1 text-xs text-slate-300', role: 'status'});
  const detail = el('div', {class: 'rounded-xl border border-slate-600 bg-slate-900 p-4', 'aria-live': 'polite'});
  const cards = el('div', {class: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-5'});
  const forecastBox = el('div', {class: 'overflow-x-auto'});
  const historyBox = el('div', {class: 'grid gap-3 md:grid-cols-2'});
  const indicesBox = el('div', {class: 'overflow-x-auto'});
  const notes = el('div', {class: 'rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-300'});
  const status = el('p', {class: 'm-0 px-4 pt-3 text-sm text-amber-200', role: 'status'});
  const section = (title, sub, body) => el('section', {class: 'px-4 pb-4 pt-2'}, el('div', {class: 'mb-2'}, el('h3', {class: 'm-0 text-base font-bold text-white', text: title}), sub && el('p', {class: 'm-0 text-xs text-slate-300', text: sub})), body);
  const refresh = el('button', {type: 'button', class: 'min-h-[40px] rounded-xl border border-slate-500 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800', text: 'Reload'});
  refresh.addEventListener('click', () => { loadPoint(); loadGrid(); });

  const head = el('header', {class: 'flex flex-wrap items-center justify-between gap-3 border-b border-slate-600 px-4 py-3'},
    el('div', {}, el('p', {class: 'm-0 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300', text: 'ERA5 · IMD criteria · station · ECMWF'}), el('h2', {class: 'm-0 text-xl font-bold text-white', text: 'Climate & hazard risk'}), placeLine),
    el('div', {class: 'flex flex-wrap items-center gap-2'}, resetBtn, refresh));
  const controls = el('div', {class: 'flex flex-wrap items-center gap-2 border-b border-slate-700 px-4 py-3'}, modeBar, yearSel, monthSel, daySel, layerSel, terrainSel, toggle('climate-stations', 'Live stations & rain gauges', 'showStations'), toggle('climate-airports', 'Airports', 'showAirports'));
  const mapRow = el('div', {class: 'grid gap-3 px-4 pb-4 pt-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'}, el('div', {}, mapBox, legend, mapStatus, stationNote), detail);
  root.replaceChildren(el('div', {class: 'overflow-hidden rounded-2xl border border-slate-600 bg-slate-950 text-slate-100 shadow-2xl shadow-black/40'},
    head, controls, status, mapRow,
    section('Hazard screen', 'Past record from ERA5 (1991 onward), the nearest live station, and the next 7 days of ECMWF', cards),
    section('Next 7 days', 'ECMWF forecast against ERA5 daily normals (1991–2020)', forecastBox),
    section('Past record at this place', 'Days per year meeting the criteria (declared after two consecutive days)', historyBox),
    section('Climate indices', 'Annual extremes from ERA5 (ETCCDI definitions)', indicesBox),
    el('div', {class: 'px-4 pb-4'}, notes)));

  // ---------- controls ----------
  function fillMonthDay() {
    const maxMonth = state.year === ly ? lm : 12;
    if (state.month > maxMonth) state.month = maxMonth;
    monthSel.replaceChildren(...MONTHS.slice(0, maxMonth).map((m, i) => new Option(m, String(i + 1))));
    const maxDay = state.year === ly && state.month === lm ? ld : daysInMonth(state.year, state.month);
    if (state.day > maxDay) state.day = maxDay;
    daySel.replaceChildren(...Array.from({length: maxDay}, (_, i) => new Option(String(i + 1), String(i + 1))));
  }
  function syncControls() {
    fillMonthDay();
    yearSel.value = String(state.year); monthSel.value = String(state.month); daySel.value = String(state.day);
    monthSel.hidden = state.mode === 'year'; daySel.hidden = state.mode !== 'day';
    layerSel.value = state.layer; terrainSel.value = state.terrainChoice;
    [...layerSel.options].find(o => o.value === 'hazard').disabled = state.mode !== 'day';
    for (const b of modeBar.children) { const on = b.dataset.mode === state.mode; b.setAttribute('aria-pressed', String(on)); b.className = 'min-h-[36px] rounded-lg px-3 text-sm font-bold ' + (on ? 'bg-emerald-400 text-slate-950' : 'text-white hover:bg-slate-800'); }
    const p = state.place;
    placeLine.textContent = p ? `${p.name} · ${p.lat.toFixed(2)}°N ${p.lon.toFixed(2)}°E${state.data ? ' · ' + state.data.terrain + (state.data.terrainAuto ? ' (auto, ' + Math.round(state.data.elevation ?? 0) + ' m)' : '') : ''}` : 'Choose a place';
    resetBtn.hidden = !p?.custom;
  }
  yearSel.addEventListener('change', () => { state.year = Number(yearSel.value); syncControls(); changed(); });
  monthSel.addEventListener('change', () => { state.month = Number(monthSel.value); syncControls(); changed(); });
  daySel.addEventListener('change', () => { state.day = Number(daySel.value); changed(); });
  layerSel.addEventListener('change', () => { state.layer = layerSel.value; drawGrid(); drawStations(); });
  terrainSel.addEventListener('change', () => { state.terrainChoice = terrainSel.value; analyse(); });
  const changed = () => { clearTimeout(gridTimer); gridTimer = setTimeout(() => { loadGrid(); renderDetail(); }, 350); };

  // ---------- map ----------
  function ensureMap() {
    if (map || !window.L) return;
    map = darkMap('climate-map');
    cellLayer = L.layerGroup().addTo(map);
    map.createPane('climate-stations').style.zIndex = 450;
    stationRenderer = L.canvas({pane: 'climate-stations', padding: 0.3});
    stationLayer = L.layerGroup().addTo(map);
    map.setView([30.2, 69.4], 5);
    map.on('click', e => {
      if (e.originalEvent?.target?.closest?.('.leaflet-interactive')) return;
      pickPoint(e.latlng);
    });
    document.addEventListener('mapchange', () => map.invalidateSize());
  }
  function pickPoint(latlng) {
    const lat = Math.round(latlng.lat * 4) / 4, lon = Math.round(latlng.lng * 4) / 4;
    state.place = {name: 'Map point', lat, lon, custom: true};
    syncControls(); loadPoint();
  }
  function metric() {
    const unit = state.layer === 'precip' ? (state.mode === 'day' ? 'mm' : 'mm total') : '°C';
    return {unit, ramp: state.layer === 'precip' ? RAMPS.precip : RAMPS.temperature};
  }
  const HAZ_COLORS = {heat2: '#b91c1c', heat1: '#f97316', cold2: '#4338ca', cold1: '#38bdf8', none: '#334155', na: '#1e293b'};
  function hazardClass(cell) {
    const a = absoluteScreen(cell);
    if (a.heat === null && a.cold === null) return 'na';
    if (a.heat >= 1) return 'heat' + a.heat;
    if (a.cold >= 1) return 'cold' + a.cold;
    return 'none';
  }
  // Live reports from the same feed as the Live stations map tab. Dots use the same colour scale as the
  // ERA5 cells for the chosen layer, so a hot station on a cool cell stands out. Reports are "now";
  // the grid shows the selected date, which is at least six days back.
  function stationValue(p, airport) {
    if (state.layer === 'precip') return airport ? null : finite(p.rain_daily) ? p.rain_daily : null;
    const t = airport ? p.temp : p.temperature;
    return finite(t) && t > -60 && t < 65 ? t : null;
  }
  function drawStations() {
    if (!map || !stationLayer) return;
    stationLayer.clearLayers();
    const feeds = [[state.stations?.stations, false, state.showStations], [state.stations?.metars, true, state.showAirports]], {ramp} = metric();
    let fresh = 0, total = 0, withValue = 0;
    for (const [feed, airport, on] of feeds) {
      if (!on) continue;
      for (const s of feed?.stations || []) {
        if (!finite(s.lat) || !finite(s.lon)) continue;
        const time = airport ? s.obsTime * 1000 : Date.parse(s.observed_at), old = isStale(time, airport), value = stationValue(s, airport);
        total++; if (!old) fresh++; if (value !== null) withValue++;
        const fill = rampColor(value, ramp);
        L.circleMarker([s.lat, s.lon], {renderer: stationRenderer, radius: airport ? 7 : 5, color: airport ? '#e3eaff' : '#b1e3d2', weight: airport ? 2 : 1, fillColor: fill || '#64748b', fillOpacity: fill ? (old ? 0.45 : 0.95) : 0.25, opacity: old ? 0.6 : 1, dashArray: old ? '2 2' : null, bubblingMouseEvents: false})
          .bindPopup(() => observationPopup(s, airport), {className: 'observation-popup', maxWidth: 335, minWidth: 270}).addTo(stationLayer);
      }
    }
    stationNote.textContent = state.stations ? (total ? `${total} live reports (${fresh} fresh, ${withValue} with a ${state.layer === 'precip' ? 'rain total' : 'temperature'}). Dots are now; cells are the chosen date. Outlined dots: airports. Dashed: older than 3 h (airports 2 h).` : 'No stations switched on.') : 'Station feed unavailable.';
  }
  function drawGrid() {
    if (!map || !cellLayer) return;
    cellLayer.clearLayers();
    legend.replaceChildren();
    if (!state.grid) return;
    const {cells, step} = state.grid, {unit, ramp} = metric(), half = step / 2;
    for (const c of cells) {
      const value = c[state.layer], hz = state.layer === 'hazard' ? hazardClass(c) : null;
      const fill = hz ? HAZ_COLORS[hz] : rampColor(value, ramp);
      const rect = L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]], {stroke: false, fillColor: fill || '#0f172a', fillOpacity: fill ? 0.72 : 0.25, interactive: true});
      const lines = [`${c.lat.toFixed(2)}°N ${c.lon.toFixed(2)}°E · ${Math.round(c.elevation ?? 0)} m`, `Max ${fmt(c.tmax, 1, ' °C')} · Min ${fmt(c.tmin, 1, ' °C')} · Mean ${fmt(c.tmean, 1, ' °C')}`, `Rain ${fmt(c.precip, 1, ' mm')}`];
      if (hz) lines.push('Screen: ' + ({heat2: 'severe heat wave level', heat1: 'heat wave level', cold2: 'severe cold wave level', cold1: 'cold wave level', none: 'below absolute limits', na: 'hills: needs departure from normal'})[hz]);
      const box = el('div', {class: 'text-xs'}, ...lines.map(t => el('div', {text: t})));
      const analyse = el('button', {type: 'button', class: 'mt-2 rounded border border-slate-400 px-2 py-1 text-xs font-bold', text: 'Analyse this point'});
      analyse.addEventListener('click', () => { map.closePopup(); pickPoint(L.latLng(c.lat, c.lon)); });
      rect.bindPopup(el('div', {}, box, analyse), {maxWidth: 260}).addTo(cellLayer);
    }
    if (state.layer === 'hazard') {
      legend.append(el('div', {class: 'flex flex-wrap gap-x-3 gap-y-1'}, ...[['heat2', 'Severe heat level'], ['heat1', 'Heat wave level'], ['cold1', 'Cold wave level'], ['cold2', 'Severe cold level'], ['none', 'Below limits'], ['na', 'Hills (departure needed)']].map(([k, t]) => el('span', {class: 'inline-flex items-center gap-1'}, el('span', {class: 'inline-block h-3 w-3 rounded-sm', style: `background:${HAZ_COLORS[k]}`}), t))),
        el('p', {class: 'm-0 mt-1', text: 'Absolute IMD limits only (Tmax ≥ 45 / 47 °C, Tmin ≤ 4 / 2 °C) on plains; per-cell normals are not downloaded, so departure rules run for the chosen place only.'}));
    } else {
      const stops = ramp, lo = stops[0][0], hi = stops.at(-1)[0];
      const bar = el('div', {class: 'h-3 w-full rounded', style: `background:linear-gradient(90deg,${stops.map(([v, c]) => `rgb(${c.join(',')}) ${((v - lo) / (hi - lo) * 100).toFixed(0)}%`).join(',')})`});
      legend.append(bar, el('div', {class: 'flex justify-between'}, el('span', {text: lo + ' ' + unit}), el('span', {text: hi + (unit === '°C' ? ' °C' : ' mm')})));
    }
    mapStatus.textContent = `${cells.length} ERA5 cells at ${step}° spacing · ${state.grid.start}${state.grid.start === state.grid.end ? '' : ' to ' + state.grid.end}. Click the map or a cell to analyse that place.`;
    drawStations();
    if (pointMarker) pointMarker.remove();
    if (state.place) pointMarker = L.circleMarker([state.place.lat, state.place.lon], {radius: 7, color: '#fff', weight: 2, fillColor: '#10b981', fillOpacity: 1, pane: 'markerPane'}).addTo(map);
  }
  async function loadGrid() {
    if (!started) return;
    ensureMap();
    gridController?.abort(); gridController = new AbortController();
    const signal = gridController.signal;
    mapStatus.textContent = 'Loading ERA5 grid…';
    try {
      state.grid = await fetchGrid(state.mode, state.year, state.month, state.day, signal, (n, total) => { mapStatus.textContent = `Loading ERA5 grid… ${n}/${total} cells`; });
      drawGrid();
    } catch (e) {
      if (signal.aborted) return;
      mapStatus.textContent = 'Map unavailable: ' + e.message;
    }
  }

  // ---------- point analysis ----------
  async function loadPoint() {
    if (!state.place) return;
    pointController?.abort(); pointController = new AbortController();
    const signal = pointController.signal, {lat, lon} = state.place;
    state.loading = true; state.error = ''; status.textContent = 'Loading ERA5 history, station and forecast…';
    const [history, forecast, obs] = await Promise.allSettled([fetchHistory(lat, lon, signal), fetchForecast(lat, lon, signal), fetchObservations(signal)]);
    if (signal.aborted) return;                      // a newer request replaced this one: say nothing
    if (obs.status === 'fulfilled') { state.stations = {stations: obs.value.stations, metars: obs.value.metars}; drawStations(); }
    state.loading = false;
    if (history.status !== 'fulfilled') { state.data = null; state.error = 'ERA5 history unavailable: ' + history.reason.message; status.textContent = state.error; renderAll(); return; }
    state.data = {history: history.value, forecast: forecast.status === 'fulfilled' ? forecast.value : null, forecastError: forecast.status === 'rejected' ? forecast.reason.message : '', obs: obs.status === 'fulfilled' ? obs.value : {}};
    status.textContent = '';
    analyse();
  }
  function analyse() {
    const d = state.data;
    if (!d) return;
    d.normals = buildNormals(d.history);
    d.elevation = d.history.elevation;
    d.terrainAuto = state.terrainChoice === 'auto';
    d.terrain = d.terrainAuto ? autoTerrain(d.elevation) : state.terrainChoice;
    d.rows = evaluateDaily(d.history, d.normals, d.terrain);
    d.years = yearlySummary(d.rows);
    d.forecastRows = d.forecast ? evaluateDaily(d.forecast, d.normals, d.terrain) : [];
    const {stations, metars} = d.obs || {}, place = state.place;
    d.current = null;
    if (stations || metars) {
      const source = chooseCurrentSource(place.lat, place.lon, stations, metars);
      for (const s of [source, ...(source.fallbacks || [])]) {
        const t = currentValue(s, 'temperature_2m', null);
        if (finite(t)) { d.current = {source: s, temperature: t, rain: s.kind === 'station' && finite(s.report?.rain_daily) ? s.report.rain_daily : null}; break; }
      }
    }
    if (d.current) d.current.screen = observedScreen({temperature: d.current.temperature, date: pktDate(), normals: d.normals, terrain: d.terrain});
    syncControls(); renderAll();
  }

  // ---------- rendering ----------
  function renderAll() { renderCards(); renderForecast(); renderHistory(); renderIndices(); renderNotes(); renderDetail(); }

  function pastLine(h) {
    const d = state.data, f = frequency(d.years, h.key);
    if (!f.years) return 'No complete years.';
    const base = periodMean(d.years, h.key, 1991, 2020), recent = periodMean(d.years, h.key, ly - 9, ly), trend = trendPerDecade(d.years, h.key);
    return [`${f.withEvents} of ${f.years} years had ≥1 day · ${fmt(f.mean, 1)} days/yr`, `1991–2020 ${fmt(base, 1)} · last 10 yr ${fmt(recent, 1)}${trend === null ? '' : ' · trend ' + signed(trend, 1) + ' d/decade'}`];
  }
  function nowLine(h) {
    const c = state.data.current;
    if (!c) return ['No fresh station or airport report within range.'];
    const name = `${c.source.name}${finite(c.source.distance) ? ' · ' + c.source.distance.toFixed(0) + ' km' : ''}`;
    if (h.id === 'rain') return finite(c.rain) ? [`${name}: ${fmt(c.rain, 1)} mm today`, 'IMD class so far: ' + rainClass(c.rain).label] : [`${name}: no rain total reported`];
    if (!h.obs) return [`${name}: ${fmt(c.temperature, 1, ' °C')} (no live test for this hazard)`];
    const level = h.obs(c.screen);
    const text = level > 0 ? `${h.words[Math.min(level, 2)]} criterion already met` : 'No criterion reached yet';
    return [`${name}: ${fmt(c.temperature, 1, ' °C')} now`, text + (level > 0 ? '' : ' (the day’s extreme may still be ahead)')];
  }
  function nextLine(h) {
    const d = state.data;
    if (!d.forecast) return {text: 'Forecast unavailable' + (d.forecastError ? ': ' + d.forecastError : ''), level: null};
    const today = pktDate(), rows = d.forecastRows.filter(r => r.date >= today);
    let best = 0, day = null, declared = false;
    for (const r of rows) { const l = h.fc(r), dec = h.fcDeclared ? h.fcDeclared(r) : l; if (finite(l) && l > best) { best = l; day = r.date; declared = !!dec; } }
    if (!best) return {text: 'Not indicated in the next 7 days.', level: 0};
    const when = new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
    return {text: `${h.words[Math.min(best, 2)]} criteria met on ${when}${h.fcDeclared && !declared ? ' (day 1 of 2: not yet declared)' : ''}.`, level: best};
  }
  function renderCards() {
    if (!state.data) { cards.replaceChildren(el('p', {class: 'm-0 text-sm text-slate-300', text: state.loading ? 'Loading…' : state.error || 'Choose a place.'})); return; }
    cards.replaceChildren(...HAZARDS.map(h => {
      const next = nextLine(h), [p1, p2] = [].concat(pastLine(h)), now = nowLine(h);
      const row = (name, ...lines) => el('div', {class: 'border-t border-slate-700 pt-2'}, label(name), ...lines.filter(Boolean).map((t, i) => el('p', {class: 'm-0 text-xs ' + (i ? 'text-slate-300' : 'text-slate-100'), text: t})));
      return el('article', {class: 'flex flex-col gap-2 rounded-xl border border-slate-600 bg-slate-900 p-3'},
        el('div', {class: 'flex items-start justify-between gap-2'}, el('h4', {class: 'm-0 text-sm font-bold text-white', text: h.title}), chip(next.level === null ? 'No forecast' : next.level > 0 ? h.words[Math.min(next.level, 2)] : 'Clear 7 d', kindOf(h.hue, next.level))),
        row('Past · ERA5', p1, p2), row('Now · station', ...now), row('Next 7 days · ECMWF', next.text),
        el('details', {class: 'text-[11px] text-slate-400'}, el('summary', {class: 'cursor-pointer', text: 'Criteria'}), el('p', {class: 'm-0 mt-1', text: h.rule()})));
    }));
  }
  function renderForecast() {
    const d = state.data;
    if (!d?.forecast) { forecastBox.replaceChildren(el('p', {class: 'm-0 text-sm text-slate-300', text: d ? 'Forecast unavailable: ' + d.forecastError : ''})); return; }
    const today = pktDate(), rows = d.forecastRows.filter(r => r.date >= today);
    const th = t => el('th', {scope: 'col', class: 'px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-300', text: t});
    const cell = (...c) => el('td', {class: 'whitespace-nowrap px-2 py-2 align-top text-xs text-slate-100'}, ...c);
    const chipFor = (level, hue, words, declared) => chip(level === null ? '–' : level > 0 ? words[Math.min(level, 2)] + (declared === 0 ? ' · day 1' : '') : 'None', kindOf(hue, level));
    forecastBox.replaceChildren(el('table', {class: 'w-full min-w-[640px] border-collapse'}, el('thead', {}, el('tr', {class: 'border-b border-slate-600'}, ['Day', 'Max °C', 'Min °C', 'Rain', 'Heat', 'Cold', 'Warm night'].map(th))),
      el('tbody', {}, rows.map(r => el('tr', {class: 'border-b border-slate-800'},
        cell(new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'})),
        cell(`${fmt(r.tmax)} `, el('span', {class: 'text-slate-400', text: `(${signed(r.heat.departure)} vs normal)`})),
        cell(`${fmt(r.tmin)} `, el('span', {class: 'text-slate-400', text: `(${signed(r.cold.departure)})`})),
        cell(`${fmt(r.precip, 1)} mm `, el('span', {class: 'text-slate-400', text: r.rain.label})),
        cell(chipFor(r.heatMet, 'heat', HAZARDS[0].words, r.heatDeclared ? 1 : 0)), cell(chipFor(r.coldMet, 'cold', HAZARDS[2].words, r.coldDeclared ? 1 : 0)),
        cell(chipFor(r.warmNight.level === null ? null : r.heatDeclared ? r.warmNight.level : 0, 'heat', HAZARDS[1].words)))))));
  }
  function bars(years, key, title, color) {
    const list = years.filter(y => y.complete), W = 360, H = 120, pad = {l: 28, r: 6, t: 8, b: 18}, max = Math.max(1, ...list.map(y => y[key])), bw = (W - pad.l - pad.r) / Math.max(1, list.length);
    const svg = svgEl('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}, ${list[0]?.year}–${list.at(-1)?.year}`, class: 'w-full'});
    for (const f of [0, 0.5, 1]) { const y = H - pad.b - f * (H - pad.t - pad.b); svg.append(svgEl('line', {x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: '#334155', 'stroke-width': 1})); const t = svgEl('text', {x: pad.l - 4, y: y + 3, 'text-anchor': 'end', fill: '#cbd5e1', 'font-size': 9}); t.textContent = String(Math.round(max * f)); svg.append(t); }
    list.forEach((y, i) => {
      const h = y[key] / max * (H - pad.t - pad.b), selected = y.year === state.year;
      const r = svgEl('rect', {x: pad.l + i * bw + 1, y: H - pad.b - h, width: Math.max(1, bw - 2), height: Math.max(h, y[key] ? 1 : 0), fill: color, opacity: selected ? 1 : 0.75, stroke: selected ? '#fff' : 'none'});
      const tip = svgEl('title'); tip.textContent = `${y.year}: ${y[key]} days`; r.append(tip); svg.append(r);
      if (i % 5 === 0 || i === list.length - 1) { const t = svgEl('text', {x: pad.l + i * bw + bw / 2, y: H - 4, 'text-anchor': 'middle', fill: '#cbd5e1', 'font-size': 9}); t.textContent = String(y.year); svg.append(t); }
    });
    return el('figure', {class: 'm-0 rounded-xl border border-slate-600 bg-slate-900 p-3'}, el('figcaption', {class: 'mb-1 text-xs font-bold text-slate-200', text: title}), svg);
  }
  function renderHistory() {
    const y = state.data?.years;
    historyBox.replaceChildren(...(y ? [bars(y, 'heatDays', 'Heat-wave days per year', '#f97316'), bars(y, 'coldDays', 'Cold-wave days per year', '#38bdf8'), bars(y, 'hotDays', `Days with Tmax ≥ ${ETCCDI.hotDayAtLeast} °C`, '#ef4444'), bars(y, 'heavyRainDays', 'Heavy-rain days (≥ 64.5 mm)', '#818cf8')] : []));
  }
  function renderIndices() {
    const d = state.data;
    if (!d) { indicesBox.replaceChildren(); return; }
    const upto = state.year >= ERA5.historyFrom ? state.year : ly, shown = d.years.filter(y => y.complete && y.year <= upto).slice(-10).reverse();
    const cols = [['Year', 'year', 0], ['Hottest day °C', 'txx', 1], ['Coldest night °C', 'tnn', 1], [`Days ≥ ${ETCCDI.hotDayAtLeast} °C`, 'hotDays', 0], ['Frost days', 'frostDays', 0], [`Nights > ${ETCCDI.tropicalNightAbove} °C`, 'tropicalNights', 0], ['Rain ≥ 20 mm days', 'r20', 0], ['Wettest day mm', 'rx1', 1], ['Longest dry spell d', 'cdd', 0], ['Rain total mm', 'precipTotal', 0]];
    indicesBox.replaceChildren(el('table', {class: 'w-full min-w-[720px] border-collapse'}, el('thead', {}, el('tr', {class: 'border-b border-slate-600'}, cols.map(c => el('th', {scope: 'col', class: 'px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-300', text: c[0]})))),
      el('tbody', {}, shown.map(y => el('tr', {class: 'border-b border-slate-800 ' + (y.year === state.year ? 'bg-emerald-500/10' : '')}, cols.map(([, key, dec]) => el('td', {class: 'px-2 py-2 text-xs tabular-nums text-slate-100', text: key === 'year' ? String(y.year) : fmt(y[key], dec)})))))));
  }
  async function renderDetail() {
    const d = state.data;
    if (!d) { detail.replaceChildren(el('p', {class: 'm-0 text-sm text-slate-300', text: state.loading ? 'Loading…' : state.error || 'Choose a place.'})); return; }
    const token = ++detailToken, [start, end] = periodRange(state.mode, state.year, state.month, state.day), prefix = start.slice(0, state.mode === 'year' ? 4 : 7);
    let rows = d.rows;
    if (state.year < ERA5.historyFrom) {
      detail.replaceChildren(el('p', {class: 'm-0 text-sm text-slate-300', text: 'Loading ERA5 for ' + state.year + '…'}));
      try { rows = evaluateDaily(await fetchRange(state.place.lat, state.place.lon, start, end, pointController?.signal), d.normals, d.terrain); } catch (e) { if (token === detailToken) detail.replaceChildren(el('p', {class: 'm-0 text-sm text-amber-200', text: 'ERA5 unavailable: ' + e.message})); return; }
      if (token !== detailToken) return;
    }
    const title = state.mode === 'day' ? new Date(start + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}) : state.mode === 'month' ? `${MONTHS[state.month - 1]} ${state.year}` : String(state.year);
    const line = (name, value, note) => el('div', {class: 'flex items-baseline justify-between gap-3 border-t border-slate-700 py-1.5 text-sm'}, el('span', {class: 'text-slate-300', text: name}), el('span', {class: 'text-right font-semibold tabular-nums text-white'}, value, note && el('span', {class: 'ml-1 text-xs font-normal text-slate-400', text: note})));
    const body = [label('Selected period at ' + state.place.name), el('h3', {class: 'm-0 mb-1 text-lg font-bold text-white', text: title})];
    if (state.mode === 'day') {
      const r = rows.find(x => x.date === start);
      if (!r) body.push(el('p', {class: 'm-0 text-sm text-slate-300', text: 'No ERA5 value for this day.'}));
      else body.push(line('Maximum', fmt(r.tmax, 1, ' °C'), `${signed(r.heat.departure)} vs normal ${fmt(r.normMax, 1)}`), line('Minimum', fmt(r.tmin, 1, ' °C'), `${signed(r.cold.departure)} vs normal ${fmt(r.normMin, 1)}`), line('Rain', fmt(r.precip, 1, ' mm'), r.rain.label),
        el('div', {class: 'flex flex-wrap gap-2 border-t border-slate-700 pt-2'},
          chip(r.heatDeclared ? HAZARDS[0].words[r.heatDeclared] : r.heatMet ? 'Heat criteria met · day 1' : 'No heat wave', kindOf('heat', r.heatDeclared || r.heatMet)),
          chip(r.coldDeclared ? HAZARDS[2].words[r.coldDeclared] : r.coldMet ? 'Cold criteria met · day 1' : 'No cold wave', kindOf('cold', r.coldDeclared || r.coldMet)),
          r.warmNightDeclared ? chip(HAZARDS[1].words[r.warmNightDeclared], kindOf('heat', r.warmNightDeclared)) : null, r.frost ? chip('Frost', 'cold1') : null, r.rain.level >= 4 ? chip(r.rain.label + ' rain', kindOf('rain', r.rain.level >= 5 ? 2 : 1)) : null));
    } else {
      const s = periodSummary(rows, d.normals, prefix);
      if (!s) body.push(el('p', {class: 'm-0 text-sm text-slate-300', text: 'No ERA5 values for this period.'}));
      else {
        body.push(line('Mean maximum', fmt(s.tmax, 1, ' °C'), `${signed(s.tmax - s.normMax)} vs normal ${fmt(s.normMax, 1)}`), line('Mean minimum', fmt(s.tmin, 1, ' °C'), `${signed(s.tmin - s.normMin)} vs normal ${fmt(s.normMin, 1)}`),
          line('Hottest day / coldest night', `${fmt(s.txx)} / ${fmt(s.tnn)} °C`), line('Rain total', fmt(s.precip, 0, ' mm'), `wettest day ${fmt(s.rx1, 0)} mm`),
          line('Heat-wave days', String(s.heatDays), s.severeHeatDays ? s.severeHeatDays + ' severe' : ''), line('Cold-wave days', String(s.coldDays), s.severeColdDays ? s.severeColdDays + ' severe' : ''),
          line('Warm nights · frost days · heavy-rain days', `${s.warmNights} · ${s.frostDays} · ${s.heavyRainDays}`));
      }
    }
    body.push(el('p', {class: 'm-0 mt-2 text-[11px] text-slate-400', text: 'Normal = ERA5 1991–2020 calendar-day mean, smoothed over 11 days. Terrain: ' + d.terrain + '.'}));
    detail.replaceChildren(...body);
  }
  let detailToken = 0;
  function renderNotes() {
    notes.replaceChildren(
      el('p', {class: 'm-0 mb-2 font-bold text-slate-100', text: 'How to read this'}),
      el('ul', {class: 'm-0 list-disc space-y-1 pl-4'},
        el('li', {text: 'Screening only, not a warning. Criteria are those of the India Meteorological Department (IMD); Pakistan’s official alerts come from the Pakistan Meteorological Department and may differ.'}),
        el('li', {text: 'IMD declares an event when at least two stations in a sub-division meet the criteria on two consecutive days. One place cannot test the station rule, so only the two-day persistence is applied.'}),
        el('li', {text: 'ERA5 is a 0.25° (about 28 km) reanalysis, not a station record. It smooths hills and cities, can run warm or cool locally, and under-states short heavy rain. Its normals approximate, not equal, IMD or PMD station normals.'}),
        el('li', {text: `Terrain changes the thresholds. IMD gives no elevation limit for hills, so auto mode treats places at or above ${HILLS_FROM_ELEVATION_M} m as hills; set it yourself for coastal places.`}),
        el('li', {text: 'Cold-day criteria are not assessed because the official definition could not be confirmed. Frost, hot-day, tropical-night and dry-spell counts follow ETCCDI.'}),
        el('li', {text: `ERA5 reaches about ${ERA5.delayDays} days behind today (latest available: ${latest}). Station values are the nearest fresh report within 50 km (airport METAR within 100 km); a current reading only proves a criterion when it already meets it, because the day’s extreme can still come later.`}),
        el('li', {text: `Data: ERA5 from Copernicus / ECMWF via Open-Meteo (CC BY 4.0), ECMWF IFS forecast, WeatherWalay and airport observations. Map grid: ${GRID_STEP.day}° (day), ${GRID_STEP.month}° (month), ${GRID_STEP.year}° (year).`})));
  }

  // ---------- wiring ----------
  document.addEventListener('forecastlocationchange', e => {
    const c = e.detail || cities[getSelected()];
    if (!c) return;
    state.place = {name: c[0], lat: c[1], lon: c[2], custom: false};
    syncControls();
    if (started) loadPoint();
  });
  const start = () => {
    if (started) return;
    started = true;
    syncControls(); ensureMap(); loadPoint(); loadGrid();
  };
  syncControls(); renderAll();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) { io.disconnect(); start(); } }, {rootMargin: '400px'});
    io.observe(root);
  } else start();
  const reveal = () => { if (location.hash === '#climate') start(); };
  window.addEventListener('hashchange', reveal); reveal();
}
