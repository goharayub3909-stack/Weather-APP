// WeatherWalay realtime stations: every station from the feed on a map and in a table, with the parameter and category picker of the
// portal, a full detail panel (all parameters, every time stamp, all raw columns) and CSV export. Pure logic is in core.js.
import {PARAMS, GROUPS, NETWORKS, parseLabel, stationFeatures, stationReadings, stationsCsv, fmtValue, compass} from './core.js';
import {fetchFeed} from '../observation-feed.js';

const $ = id => document.getElementById(id);
const state = {param: 'temperature', cat: 'Current', networks: new Set(NETWORKS), active: true, inactive: true, query: '', view: 'map', sort: {key: 'sync', dir: -1}, data: null, byRow: new Map(), features: []};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmtTime = ms => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false}).format(ms) + ' PKT';

// ---- parameter picker (as in the portal: parameter, then category) ----
function buildParams() {
  const box = $('params'); box.innerHTML = '';
  for (const [g, gl] of GROUPS) {
    const h = document.createElement('div'); h.className = 'dim'; h.style.cssText = 'font-size:11px;margin:8px 0 3px'; h.textContent = gl; box.appendChild(h);
    for (const [key, p] of Object.entries(PARAMS)) {
      if (p.group !== g) continue;
      const el = document.createElement('div'); el.className = 'param' + (key === state.param ? ' open' : ''); el.dataset.param = key;
      el.innerHTML = `<button type="button" aria-expanded="${key === state.param}"><span>${esc(p.label)}</span><span>${p.unit ? esc(p.unit) : ''}</span></button><div class="cats">${Object.keys(p.cats).map(c => `<button type="button" class="cat" data-cat="${esc(c)}" aria-pressed="${key === state.param && c === state.cat}">${esc(c)}</button>`).join('')}</div>`;
      el.querySelector(':scope > button').addEventListener('click', () => {
        const first = Object.keys(p.cats)[0];
        select(key, state.param === key ? state.cat : first);
      });
      el.querySelectorAll('.cat').forEach(b => b.addEventListener('click', () => select(key, b.dataset.cat)));
      box.appendChild(el);
    }
  }
}
function select(param, cat) {
  state.param = param; state.cat = cat;
  document.querySelectorAll('.param').forEach(el => {
    const on = el.dataset.param === param; el.classList.toggle('open', on); el.querySelector(':scope > button').setAttribute('aria-expanded', String(on));
    el.querySelectorAll('.cat').forEach(b => b.setAttribute('aria-pressed', String(on && b.dataset.cat === cat)));
  });
  refresh();
}

// ---- data ----
async function load(silent) {
  try {
    const d = await fetchFeed('realtime');
    if (state.data && d.retrieved_at === state.data.retrieved_at) return;
    state.data = d; state.byRow = new Map(d.stations.map(s => [s.v, s]));
    buildNetworks(); refresh(); $('status').hidden = true;
  } catch (e) {
    if (!state.data) { $('status').hidden = false; $('status').textContent = 'The realtime station feed is unavailable right now: ' + e.message; }
  }
}
function buildNetworks() {
  const counts = {}; for (const s of state.data.stations) counts[s.network] = (counts[s.network] || 0) + 1;
  const names = [...NETWORKS, ...Object.keys(counts).filter(n => !NETWORKS.includes(n))].filter(n => counts[n]);
  for (const n of names) if (!NETWORKS.includes(n)) state.networks.add(n);
  $('nets').innerHTML = names.map(n => `<div class="net"><label><input type="checkbox" data-net="${esc(n)}" ${state.networks.has(n) ? 'checked' : ''}> ${esc(n)}</label><span>${counts[n]}</span></div>`).join('');
  $('nets').querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? state.networks.add(i.dataset.net) : state.networks.delete(i.dataset.net); refresh(); }));
}
function compute() {
  if (!state.data) return [];
  const q = state.query.trim().toLowerCase();
  let f = stationFeatures(state.data.stations.map(s => s.v), state.param, state.cat, {networks: state.networks, active: state.active, inactive: state.inactive});
  f = f.map(x => { const s = state.byRow.get(x.row); return {...x, station: s, mlat: s.map_lat, mlon: s.map_lon}; });
  if (q) f = f.filter(x => x.name.toLowerCase().includes(q));
  return f;
}
function refresh() {
  state.features = compute();
  const all = state.data?.stations.length ?? 0, on = state.features.filter(f => f.active).length, d = state.data;
  const upd = d?.last_update ? Date.parse(d.last_update) : null;
  $('meta').textContent = d ? `${PARAMS[state.param].label} · ${state.cat} — ${state.features.length} of ${all} stations shown, ${on} active. Feed time ${upd ? fmtTime(upd) : 'unknown'}, fetched ${fmtTime(Date.parse(d.retrieved_at))}.` : 'Loading…';
  state.view === 'map' ? drawLabels() : renderTable();
}

// ---- map ----
const OSM = {type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors'};
const SAT = {type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics'};
const map = new maplibregl.Map({container: 'map', style: {version: 8, sources: {osm: OSM, sat: SAT}, layers: [{id: 'osm', type: 'raster', source: 'osm'}, {id: 'sat', type: 'raster', source: 'sat', layout: {visibility: 'none'}}]},
  center: [69.35, 30.4], zoom: 4.8, minZoom: 3, attributionControl: {compact: true}});
map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-left');
$('base').addEventListener('change', e => { map.setLayoutProperty('osm', 'visibility', e.target.value === 'osm' ? 'visible' : 'none'); map.setLayoutProperty('sat', 'visibility', e.target.value === 'sat' ? 'visible' : 'none'); drawLabels(); });
const cv = $('labels'), ctx = cv.getContext('2d');
let placed = [];
function drawLabels() {
  const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); placed = [];
  if (state.view !== 'map') return;
  const zoom = map.getZoom(), size = Math.max(11, Math.min(18, 9 + zoom * 1.1)), grid = new Map(), cell = 40;
  ctx.font = `700 ${size}px system-ui,Segoe UI,sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  const halo = '#0d0d0d';
  // active stations first so a live reading is never hidden by an old one
  const order = [...state.features].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  for (const f of order) {
    const p = map.project([f.mlon, f.mlat]);
    if (p.x < -30 || p.y < -20 || p.x > w + 30 || p.y > h + 20) continue;
    const text = fmtValue(f.value, state.param), tw = ctx.measureText(text).width, box = {x: p.x - tw / 2 - 2, y: p.y - size / 2 - 1, w: tw + 4, h: size + 2, f};
    let clash = false;
    for (let gx = Math.floor(box.x / cell); gx <= Math.floor((box.x + box.w) / cell) && !clash; gx++) for (let gy = Math.floor(box.y / cell); gy <= Math.floor((box.y + box.h) / cell) && !clash; gy++)
      for (const o of grid.get(gx + ',' + gy) || []) if (box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y) { clash = true; break; }
    if (clash) continue;
    for (let gx = Math.floor(box.x / cell); gx <= Math.floor((box.x + box.w) / cell); gx++) for (let gy = Math.floor(box.y / cell); gy <= Math.floor((box.y + box.h) / cell); gy++) { const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(box); }
    placed.push(box);
    ctx.globalAlpha = f.active ? 1 : 0.55;
    ctx.lineWidth = 3.2; ctx.strokeStyle = halo; ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = f.color === '#FFFFFF' || f.color === '#fff' ? '#888' : f.color; ctx.fillText(text, p.x, p.y);
    if (f.ring) { ctx.beginPath(); ctx.arc(p.x, p.y, tw / 2 + 7, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = f.trend < 0 ? '#d93025' : '#1a73e8'; ctx.stroke(); }
    if (f.raining) { ctx.fillStyle = '#1a73e8'; ctx.beginPath(); ctx.arc(p.x + tw / 2 + 5, p.y - size / 2, 3, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}
map.on('render', () => { if (state.view === 'map') drawLabels(); });
const hit = (x, y) => placed.find(b => x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3)?.f;
const tip = $('tip');
function tipHtml(f) {
  const s = f.station, dirText = f.dir !== null ? ` from ${compass(f.dir)} (${Math.round(f.dir)}°)` : '';
  return `<b>${esc(s.name.trim())}</b><div class="v">${fmtValue(f.value, state.param)} <span style="font-size:12px;font-weight:400">${esc(f.unit)}${esc(dirText)}</span></div>
    ${f.at ? `<small>Recorded ${esc(f.at)} PKT</small>` : ''}<small>Last sync ${esc(f.sync ?? 'unknown')} · ${f.active ? 'active' : 'inactive'}</small>
    <small>${esc(f.network)} · ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} · ${s.elevation !== null ? Math.round(s.elevation) + ' m' : 'no elevation'}</small>${f.info ? `<small>${f.info}</small>` : ''}`;
}
map.getCanvasContainer().addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect(), f = hit(e.clientX - r.left, e.clientY - r.top);
  map.getCanvas().style.cursor = f ? 'pointer' : '';
  if (!f) { tip.hidden = true; return; }
  tip.innerHTML = tipHtml(f); tip.hidden = false;
  const mr = $('map').getBoundingClientRect(); tip.style.left = Math.min(e.clientX - mr.left + 14, mr.width - 310) + 'px'; tip.style.top = Math.max(4, e.clientY - mr.top + 14) + 'px';
});
map.getCanvasContainer().addEventListener('mouseleave', () => { tip.hidden = true; });
map.on('click', e => { const f = hit(e.point.x, e.point.y); if (f) openDetail(f.station); });

// ---- table ----
function renderTable() {
  const cols = [['name', 'Station'], ['network', 'Network'], ['lat', 'Latitude'], ['lon', 'Longitude'], ['elevation', 'Elevation (m)'], ['value', `${PARAMS[state.param].label} · ${state.cat}`], ['at', 'Recorded at'], ['sync', 'Last sync'], ['status', 'Status']];
  const val = (f, k) => k === 'name' ? f.name.trim().toLowerCase() : k === 'network' ? f.network : k === 'lat' ? f.station.lat : k === 'lon' ? f.station.lon : k === 'elevation' ? f.station.elevation : k === 'value' ? f.value : k === 'at' ? parseLabel(f.at) : k === 'sync' ? parseLabel(f.sync) : f.active ? 1 : 0;
  const {key, dir} = state.sort, rows = [...state.features].sort((a, b) => { const x = val(a, key), y = val(b, key); if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * dir; });
  const unit = state.features[0]?.unit ?? '';
  $('table').innerHTML = `<table><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" ${k === key ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}" data-arrow="${dir > 0 ? '▲' : '▼'}"` : ''}>${esc(l)}${k === 'value' && unit ? ` (${esc(unit)})` : ''}</th>`).join('')}</tr></thead><tbody>${rows.map((f, i) => `<tr data-i="${i}" class="${f.active ? '' : 'off'}"><td>${esc(f.station.name)}</td><td>${esc(f.network)}</td><td class="num">${f.station.lat}</td><td class="num">${f.station.lon}</td><td class="num">${f.station.elevation ?? '—'}</td><td class="num"><b>${fmtValue(f.value, state.param)}</b>${f.dir !== null ? ` <span class="dim">${esc(compass(f.dir))}</span>` : ''}</td><td>${esc(f.at ?? '—')}</td><td>${esc(f.sync ?? '—')}</td><td>${f.active ? 'Active' : 'Inactive'}</td></tr>`).join('')}</tbody></table>`;
  $('table').querySelectorAll('th').forEach(th => th.addEventListener('click', () => { state.sort = {key: th.dataset.k, dir: state.sort.key === th.dataset.k ? -state.sort.dir : 1}; renderTable(); }));
  $('table').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openDetail(rows[+tr.dataset.i].station)));
}
function setView(v) {
  state.view = v; $('map').hidden = v !== 'map'; $('labels').hidden = v !== 'map'; $('table').hidden = v !== 'table';
  $('view-map').setAttribute('aria-pressed', String(v === 'map')); $('view-table').setAttribute('aria-pressed', String(v === 'table'));
  if (v === 'map') { map.resize(); drawLabels(); } else renderTable();
}
$('view-map').addEventListener('click', () => setView('map')); $('view-table').addEventListener('click', () => setView('table'));

// ---- station detail: every parameter and category with its time stamps, then all raw columns ----
function openDetail(s) {
  const d = $('detail'), cols = state.data.columns, read = stationReadings(s.v);
  const val = c => c.value === null ? '<span class="dim">—</span>' : `${c.value}${c.unit ? ' ' + esc(c.unit) : ''}${c.direction !== null ? ` · ${esc(compass(c.direction))} (${Math.round(c.direction)}°)` : ''}`;
  d.innerHTML = `<button class="btn close" type="button" aria-label="Close">×</button><h2>${esc(s.name)}</h2><div class="dim">${esc(s.network)} · ${s.id !== null ? 'id ' + esc(s.id) : 'no id in the feed'}</div>
    ${s.position_note ? `<div class="note">${esc(s.position_note)}. The feed gives latitude ${s.lat} and longitude ${s.lon}.</div>` : ''}
    <h3>Station</h3><table><tr><td>Name (exact)</td><td>${esc(s.name)}</td></tr><tr><td>Latitude</td><td>${s.lat}</td></tr><tr><td>Longitude</td><td>${s.lon}</td></tr>
    <tr><td>Elevation</td><td>${s.elevation !== null ? s.elevation + ' m' : '<span class="dim">not available</span>'}</td></tr>${s.elevation_source ? `<tr><td></td><td class="dim">${esc(s.elevation_source)}</td></tr>` : ''}
    <tr><td>Last sync</td><td>${esc(s.v[161] ?? '—')} PKT</td></tr><tr><td>Status</td><td>${state.features.find(f => f.station === s)?.active ? 'Active' : 'Not updated within 30 minutes (or not showing the selected parameter)'}</td></tr></table>
    ${GROUPS.map(([g, gl]) => `<h3>${esc(gl)} parameters</h3>${read.filter(p => p.group === g).map(p => `<details ${p.param === state.param ? 'open' : ''}><summary><b>${esc(p.label)}</b></summary><table><thead><tr><th>Category</th><th>Value</th><th>Recorded at</th><th>Last sync</th></tr></thead><tbody>${p.categories.map(c => `<tr><td>${esc(c.category)}</td><td>${val(c)}</td><td>${esc(c.recordedAt ?? '—')}</td><td>${esc(c.lastSync ?? '—')}</td></tr>`).join('')}</tbody></table></details>`).join('')}`).join('')}
    <h3>All columns as received</h3><details><summary>${cols.length} columns</summary><table><tbody>${cols.map(c => `<tr><td>${c.i}</td><td>${esc(c.label)}</td><td>${s.v[c.i] === null ? '<span class="dim">—</span>' : esc(s.v[c.i])}${c.unit && s.v[c.i] !== null ? ' ' + esc(c.unit) : ''}</td></tr>`).join('')}</tbody></table></details>`;
  d.hidden = false; d.querySelector('.close').addEventListener('click', () => { d.hidden = true; });
}

// ---- controls ----
$('q').addEventListener('input', e => { state.query = e.target.value; refresh(); });
$('f-active').addEventListener('change', e => { state.active = e.target.checked; refresh(); });
$('f-inactive').addEventListener('change', e => { state.inactive = e.target.checked; refresh(); });
$('net-all').addEventListener('click', () => { document.querySelectorAll('#nets input').forEach(i => { i.checked = true; state.networks.add(i.dataset.net); }); refresh(); });
$('net-none').addEventListener('click', () => { document.querySelectorAll('#nets input').forEach(i => { i.checked = false; state.networks.delete(i.dataset.net); }); refresh(); });
$('csv').addEventListener('click', () => {
  if (!state.data) return;
  const blob = new Blob(['﻿' + stationsCsv(state.data.stations, state.data.columns)], {type: 'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `weatherwalay-realtime-${(state.data.last_update || state.data.retrieved_at).slice(0, 16).replace(/[:T]/g, '-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
addEventListener('keydown', e => { if (e.key === 'Escape') $('detail').hidden = true; });
addEventListener('resize', () => { map.resize(); if (state.view === 'map') drawLabels(); });
buildParams();
load();
setInterval(() => { if (!document.hidden) load(true); }, 60000);
