// Health & environment panel.
// Feeds public/health-engine.js with hourly model data for the selected place and renders
// the eleven screening indices, alerts and a 72-hour outlook in English or Urdu.
//
// Data: Open-Meteo forecast (best-match model, 72 h back + 72 h ahead) and the CAMS
// air-quality model for PM2.5/PM10. These are model values, not station observations.
// The pure functions (healthURLs, buildReadings) run in Node for tests; DOM work only
// happens inside initHealthPanel().

import {assessHealth, assessOutlook, LEVELS} from './health-engine.js';

const HOUR = 3600000;
const PAST_DAYS = 3, FORECAST_DAYS = 4, OUTLOOK_HOURS = 72, STEP_HOURS = 3;
// Crop pests are covered by the Farmers section, so the Health panel shows people-focused indices only.
export const HIDDEN_GROUPS = new Set(['crop_pest']);

const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'surface_pressure', 'wind_speed_10m', 'precipitation', 'soil_moisture_0_to_1cm', 'soil_temperature_0cm'];

/** Request URLs for one place. Wind in m/s because the engine expects it. */
export function healthURLs(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Error('Invalid location.');
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.search = new URLSearchParams({latitude: lat, longitude: lon, hourly: HOURLY.join(','), wind_speed_unit: 'ms', timezone: 'Asia/Karachi', past_days: PAST_DAYS, forecast_days: FORECAST_DAYS});
  const air = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  air.search = new URLSearchParams({latitude: lat, longitude: lon, hourly: 'pm2_5,pm10', timezone: 'Asia/Karachi', past_days: PAST_DAYS, forecast_days: FORECAST_DAYS});
  return {forecast, air};
}

const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const sumWindow = (values, end, hours) => {
  if (end - hours + 1 < 0) return null; // not enough history for a full window
  let total = 0;
  for (let i = end - hours + 1; i <= end; i++) { const v = num(values[i]); if (v === null) return null; total += v; }
  return Math.round(total * 10) / 10;
};

/**
 * Convert Open-Meteo responses into engine readings.
 * @returns {{current, history, forecast, index}} or throws when the current hour is missing.
 */
export function buildReadings(forecastJson, airJson, now = new Date()) {
  const h = forecastJson?.hourly;
  if (!h?.time?.length) throw Error('Incomplete forecast response.');
  // Open-Meteo returns local PKT times without an offset; the engine needs one.
  const stamps = h.time.map(t => t + ':00+05:00');
  const airIndex = new Map((airJson?.hourly?.time || []).map((t, i) => [t, i]));
  const pm = key => t => { const i = airIndex.get(t); return i === undefined ? null : num(airJson.hourly[key]?.[i]); };
  const pm25 = pm('pm2_5'), pm10 = pm('pm10');
  const readings = h.time.map((t, i) => {
    const moisture = num(h.soil_moisture_0_to_1cm?.[i]);
    const r = {
      timestamp: stamps[i],
      temp_c: num(h.temperature_2m?.[i]),
      rh: num(h.relative_humidity_2m?.[i]),
      pressure_hpa: num(h.surface_pressure?.[i]),
      wind_speed_ms: num(h.wind_speed_10m?.[i]),
      soil_moisture: moisture === null ? null : Math.round(moisture * 1000) / 10, // m³/m³ → volumetric %
      soil_temp_c: num(h.soil_temperature_0cm?.[i]),
      rain_acc_48h: sumWindow(h.precipitation || [], i, 48),
      rain_acc_72h: sumWindow(h.precipitation || [], i, 72),
      pm25: pm25(t),
      pm10: pm10(t),
    };
    if (r.pm25 !== null) r.pm25_source = 'model';
    return r;
  });
  const nowMs = now.getTime();
  const index = stamps.findIndex((s, i) => { const t = Date.parse(s); return t <= nowMs && nowMs < t + HOUR; });
  if (index < 0) throw Error('The provider has no data for the current Pakistan hour.');
  const currentMs = Date.parse(stamps[index]);
  return {
    index,
    current: readings[index],
    history: readings.slice(0, index).filter(r => currentMs - Date.parse(r.timestamp) <= OUTLOOK_HOURS * HOUR),
    forecast: readings.slice(index + 1).filter(r => Date.parse(r.timestamp) - currentMs <= OUTLOOK_HOURS * HOUR),
  };
}

/** Run the engine on built readings, keeping only the groups shown on the Health panel. */
export function runHealth(built) {
  return withoutHiddenGroups({
    result: assessHealth(built.current, built.history),
    outlook: assessOutlook(built.current, built.history, built.forecast, {stepHours: STEP_HOURS, horizonHours: OUTLOOK_HOURS}),
  });
}

/** Drop hidden groups from modules, alerts, outlook and the overall level. */
export function withoutHiddenGroups({result, outlook}) {
  const hidden = new Set(Object.entries(result.groups).filter(([g]) => HIDDEN_GROUPS.has(g)).flatMap(([, ids]) => ids));
  const keep = id => !hidden.has(id);
  const modules = Object.fromEntries(Object.entries(result.modules).filter(([id]) => keep(id)));
  const known = Object.values(modules).map(m => m.level).filter(l => l !== 'UNKNOWN');
  const overall = known.length ? LEVELS[Math.max(...known.map(l => LEVELS.indexOf(l)))] : 'UNKNOWN';
  return {
    result: {...result, modules, overall_level: overall,
      groups: Object.fromEntries(Object.entries(result.groups).filter(([g]) => !HIDDEN_GROUPS.has(g))),
      alerts: result.alerts.filter(a => keep(a.module))},
    outlook: {...outlook, steps: outlook.steps.map(s => {
      const levels = Object.fromEntries(Object.entries(s.levels).filter(([id]) => keep(id)));
      const lv = Object.values(levels).map(v => v.level).filter(l => l !== 'UNKNOWN');
      return {...s, levels, overall_level: lv.length ? LEVELS[Math.max(...lv.map(l => LEVELS.indexOf(l)))] : 'UNKNOWN'};
    })},
  };
}

/**
 * Numbers for the ticker tiles, straight from the built readings (no thresholds applied here).
 * Missing values stay null.
 */
export function tickerData(built) {
  const cur = built.current, t0 = Date.parse(cur.timestamp);
  const next24 = [cur, ...built.forecast.filter(r => Date.parse(r.timestamp) - t0 <= 24 * HOUR)];
  const past24 = [...built.history.filter(r => t0 - Date.parse(r.timestamp) < 24 * HOUR), cur];
  const vals = (rows, key) => rows.map(r => num(r[key])).filter(v => v !== null);
  const mean = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10 : null;
  const ago3 = built.history.find(r => Date.parse(r.timestamp) === t0 - 3 * HOUR);
  const p0 = num(cur.pressure_hpa), p3 = num(ago3?.pressure_hpa);
  const temps = vals(next24, 'temp_c'), rh = vals(next24, 'rh'), pm = vals(past24, 'pm25');
  return {
    temp: num(cur.temp_c), tempSeries: next24.map(r => num(r.temp_c)),
    tempHi: temps.length ? Math.max(...temps) : null, tempLo: temps.length ? Math.min(...temps) : null,
    rh: num(cur.rh), rhLo: rh.length ? Math.min(...rh) : null, rhHi: rh.length ? Math.max(...rh) : null,
    pm25: num(cur.pm25), pm25Mean24: mean(pm), pm25Hours: pm.length,
    pressure: p0, pressureChange3h: p0 !== null && p3 !== null ? Math.round((p0 - p3) * 10) / 10 : null,
    windKmh: num(cur.wind_speed_ms) === null ? null : Math.round(cur.wind_speed_ms * 3.6),
  };
}

// ---------------------------------------------------------------- UI text

const UI = {
  en: {
    eyebrow: 'Sehat · weather-based health screening', title: 'Health & environment',
    intro: 'Eight weather-linked health indices for the selected place, from the last 72 hours of model weather and the CAMS air-quality model.',
    overall: 'Overall · now', loading: 'Calculating health indices…', failed: 'Health indices are unavailable. Check your connection and press Refresh.',
    triage: 'Health triage', noAlerts: 'No index is at Moderate or above right now.', active: 'active', low: 'low', needData: 'need data',
    outlook: 'Next 72 hours · every 3 hours', actions: 'What to do', notes: 'Notes', more: 'What to do · notes',
    confidence: 'Confidence', partial: 'some inputs missing', refresh: 'Refresh', source: 'Model data · not station readings',
    asOf: 'Model hour', met: 'met', notMet: 'not met', noData: 'no data', score: 'Closeness to trigger',
    scoreHelp: '0 = far from this index’s trigger, 100 = every condition met with margin. The level comes from which conditions are met.',
    indicesActive: n => `${n} of 8 at Moderate or above`,
    tiles: {temp: 'Temperature · 24 h', heat: 'Heat stress', rh: 'Humidity', pm: 'PM2.5', pressure: 'Pressure · 3 h', wind: 'Wind'},
    wbgt: 'Est. WBGT', heatIndex: 'Heat index', range24: 'next 24 h', mean24: '24 h mean', calm: 'Calm air', model: 'model',
    dataNote: 'Inputs: Open-Meteo best-match model (temperature, humidity, surface pressure, wind, rain) and the CAMS air-quality model (PM2.5). Model values smooth out local extremes, so station readings may differ.',
    groups: {vector_borne: 'Mosquito-borne', biometeorology: 'Weather & the body', respiratory: 'Air & breathing', seasonal_virus: 'Seasonal viruses'},
    levels: {LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical', UNKNOWN: 'Unknown'},
  },
  ur: {
    eyebrow: 'صحت · موسم پر مبنی جائزہ', title: 'صحت اور ماحول',
    intro: 'منتخب جگہ کے لیے موسم سے جڑے صحت کے آٹھ اشاریے، پچھلے 72 گھنٹوں کے ماڈل موسم اور CAMS فضائی معیار ماڈل کی بنیاد پر۔',
    overall: 'مجموعی · ابھی', loading: 'صحت کے اشاریے تیار ہو رہے ہیں…', failed: 'صحت کے اشاریے دستیاب نہیں۔ انٹرنیٹ چیک کر کے ریفریش کریں۔',
    triage: 'صحت کی ترجیحی فہرست', noAlerts: 'اس وقت کوئی اشاریہ "درمیانہ" یا اس سے اوپر نہیں۔', active: 'فعال', low: 'کم', needData: 'ڈیٹا درکار',
    outlook: 'اگلے 72 گھنٹے · ہر 3 گھنٹے', actions: 'کیا کریں', notes: 'نوٹ', more: 'کیا کریں · نوٹ',
    confidence: 'اعتماد', partial: 'کچھ معلومات دستیاب نہیں', refresh: 'ریفریش', source: 'ماڈل ڈیٹا · اسٹیشن ریڈنگ نہیں',
    asOf: 'ماڈل کا وقت', met: 'پوری', notMet: 'پوری نہیں', noData: 'ڈیٹا نہیں', score: 'محرک سے قربت',
    scoreHelp: '0 = محرک سے دور، 100 = تمام شرائط واضح طور پر پوری۔ سطح اس بات سے طے ہوتی ہے کہ کون سی شرائط پوری ہیں۔',
    indicesActive: n => `8 میں سے ${n} درمیانہ یا اس سے اوپر`,
    tiles: {temp: 'درجۂ حرارت · 24 گھنٹے', heat: 'گرمی کا دباؤ', rh: 'نمی', pm: 'PM2.5', pressure: 'فضائی دباؤ · 3 گھنٹے', wind: 'ہوا'},
    wbgt: 'اندازاً WBGT', heatIndex: 'ہیٹ انڈیکس', range24: 'اگلے 24 گھنٹے', mean24: '24 گھنٹے کا اوسط', calm: 'ساکن ہوا', model: 'ماڈل',
    dataNote: 'ماخذ: Open-Meteo ماڈل (درجۂ حرارت، نمی، فضائی دباؤ، ہوا، بارش) اور CAMS فضائی معیار ماڈل (PM2.5)۔ ماڈل مقامی شدت کو ہموار کر دیتا ہے، اس لیے اسٹیشن کی ریڈنگ مختلف ہو سکتی ہے۔',
    groups: {vector_borne: 'مچھر سے پھیلنے والی بیماریاں', biometeorology: 'موسم اور جسم', respiratory: 'ہوا اور سانس', seasonal_virus: 'موسمی وائرس'},
    levels: {LOW: 'کم', MODERATE: 'درمیانہ', HIGH: 'زیادہ', CRITICAL: 'انتہائی', UNKNOWN: 'نامعلوم'},
  },
};

// ---------------------------------------------------------------- DOM helpers
// Styling uses the same Tailwind utilities as the Farmers workspace (scoped to #health, preflight off).

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
// Same colour language as the Farmers triage: amber = watch, orange / red = act, emerald = clear.
const LEVEL_STYLE = {
  LOW: {chip: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/40', bar: 'bg-emerald-400', cell: 'bg-emerald-500/30', edge: 'border-s-emerald-400', text: 'text-emerald-300'},
  MODERATE: {chip: 'bg-amber-300 text-slate-950', bar: 'bg-amber-300', cell: 'bg-amber-300/80', edge: 'border-s-amber-300', text: 'text-amber-300'},
  HIGH: {chip: 'bg-orange-500 text-white', bar: 'bg-orange-400', cell: 'bg-orange-500', edge: 'border-s-orange-400', text: 'text-orange-300'},
  CRITICAL: {chip: 'bg-red-500 text-white', bar: 'bg-red-500', cell: 'bg-red-600', edge: 'border-s-red-500', text: 'text-red-300'},
  UNKNOWN: {chip: 'bg-slate-700 text-slate-200', bar: 'bg-slate-500', cell: 'bg-slate-800', edge: 'border-s-slate-500', text: 'text-slate-300'},
};
const style = level => LEVEL_STYLE[level] || LEVEL_STYLE.UNKNOWN;
const chip = (level, text) => el('span', {class: `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${style(level).chip}`, text});
const label = text => el('span', {class: 'block text-[11px] font-bold uppercase tracking-wider text-slate-300', text});
const fmt = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '–';
const pktTime = stamp => new Date(stamp).toLocaleString('en-PK', {timeZone: 'Asia/Karachi', weekday: 'short', hour: 'numeric', minute: '2-digit'});
const pktHour = stamp => new Date(stamp).toLocaleTimeString('en-PK', {timeZone: 'Asia/Karachi', hour: 'numeric'});
const pktDay = stamp => new Date(stamp).toLocaleDateString('en-PK', {timeZone: 'Asia/Karachi', weekday: 'short'});

// ---------------------------------------------------------------- panel

/**
 * @param {{cities: object, getSelected: () => string}} options
 */
export function initHealthPanel({cities, getSelected}) {
  const root = document.getElementById('health');
  if (!root) return;
  let lang = 'en';
  try { lang = localStorage.getItem('health-lang') === 'ur' ? 'ur' : 'en'; } catch {}
  let place = cities[getSelected()] || null, state = {status: 'idle'}, controller = null, started = false;

  const head = el('header', {class: 'flex flex-wrap items-center justify-between gap-3 border-b border-slate-600 px-4 py-3'});
  const ticker = el('div', {class: 'flex items-stretch gap-2 overflow-x-auto border-b border-slate-700 px-3 py-2', role: 'region'});
  const body = el('div', {'aria-live': 'polite'});
  const langSwitch = el('div', {class: 'flex rounded-xl border border-slate-600 bg-slate-900 p-1', role: 'group', 'aria-label': 'Language'});
  for (const [code, text] of [['en', 'English'], ['ur', 'اردو']]) {
    const b = el('button', {type: 'button', 'data-lang': code, text});
    b.addEventListener('click', () => { lang = code; try { localStorage.setItem('health-lang', code); } catch {} render(); });
    langSwitch.append(b);
  }
  const refresh = el('button', {type: 'button', class: 'min-h-[44px] rounded-xl border border-slate-500 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800'});
  refresh.addEventListener('click', () => load());
  root.replaceChildren(el('div', {class: 'overflow-hidden rounded-2xl border border-slate-600 bg-slate-950 text-slate-100 shadow-2xl shadow-black/40'}, head, ticker, body));

  async function load() {
    if (!place) return;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, [, lat, lon] = place;
    state = {status: 'loading'}; render();
    try {
      const {forecast, air} = healthURLs(lat, lon);
      const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      const [f, a] = await Promise.all([
        fetch(forecast, {signal: timeout()}).then(r => r.ok ? r.json() : Promise.reject(Error('forecast'))),
        // Air quality failing should not block the rest: smog/asthma just become partial.
        fetch(air, {signal: timeout()}).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (signal.aborted) return;
      const built = buildReadings(f, a);
      state = {status: 'ready', ...runHealth(built), ticker: tickerData(built), airMissing: !a, placeName: place[0]};
    } catch (e) {
      if (signal.aborted) return;
      state = {status: 'error'};
    }
    render();
  }

  function render() {
    const t = UI[lang], L = lev => t.levels[lev] || lev;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
    root.classList.toggle('health-urdu', lang === 'ur');
    langSwitch.querySelectorAll('button').forEach(b => {
      const on = b.dataset.lang === lang;
      b.className = `min-h-[36px] rounded-lg border-0 px-3 text-sm font-semibold ${on ? 'bg-emerald-400 text-slate-950' : 'bg-transparent text-slate-200 hover:bg-slate-800'}`;
      b.setAttribute('aria-pressed', String(on));
    });
    refresh.textContent = '↻ ' + t.refresh;
    ticker.setAttribute('aria-label', t.title);
    const ready = state.status === 'ready';
    head.replaceChildren(
      el('div', {class: 'min-w-0'},
        label(t.eyebrow),
        el('h2', {class: `m-0 text-xl font-bold text-white ${lang === 'ur' ? '' : 'font-display'}`, text: t.title}),
        el('p', {class: 'm-0 mt-1 max-w-2xl text-xs text-slate-300', text: ready ? `${state.placeName} · ${t.asOf} ${pktTime(state.result.timestamp)} PKT · ${t.source}` : t.intro})),
      el('div', {class: 'flex items-center gap-2'}, langSwitch, refresh),
    );
    if (!ready) {
      ticker.hidden = true;
      body.replaceChildren(el('p', {class: 'm-0 p-6 text-sm text-slate-300', text: state.status === 'error' ? t.failed : t.loading}));
      return;
    }
    const {result, outlook} = state;
    ticker.hidden = false;
    ticker.replaceChildren(...tickerTiles(result, state.ticker, t, L));
    body.replaceChildren(
      el('div', {class: 'grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]'},
        el('div', {class: 'min-w-0 space-y-5'}, Object.entries(result.groups).map(([gid, ids]) => el('section', {},
          el('h3', {class: 'm-0 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-300', text: t.groups[gid] || gid}),
          el('div', {class: 'grid gap-3 sm:grid-cols-2'}, ids.map(id => moduleCard(result.modules[id], t, L)))))),
        triage(result, t, L)),
      outlookTable(result, outlook, t, L),
      el('div', {class: 'space-y-2 border-t border-slate-700 px-4 py-3 text-xs leading-relaxed text-slate-300'},
        el('p', {class: 'm-0', text: t.dataNote}),
        el('p', {class: 'm-0 text-slate-200', text: result.disclaimer[lang]})));
  }

  function tile(title, ...content) {
    return el('div', {class: 'flex min-w-[8.5rem] shrink-0 flex-col justify-center gap-1 rounded-xl border border-slate-600 bg-slate-900 px-3 py-1.5'}, label(title), ...content);
  }
  const big = (text, cls = 'text-white') => el('span', {class: `text-2xl font-bold leading-none tabular-nums ${cls}`, text});
  const small = (text, cls = 'text-slate-200') => el('span', {class: `text-xs tabular-nums ${cls}`, text});
  function spark(values, color) {
    const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]), lo + 1), n = values.length - 1 || 1;
    const svg = svgEl('svg', {viewBox: '0 0 96 28', class: 'h-7 w-24', 'aria-hidden': 'true'});
    svg.append(svgEl('polyline', {points: pts.map(([i, v]) => `${(i / n * 94 + 1).toFixed(1)},${(26 - (v - lo) / (hi - lo) * 24).toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}));
    return svg;
  }

  function tickerTiles(result, d, t, L) {
    const m = result.modules, active = Object.values(m).filter(x => ['MODERATE', 'HIGH', 'CRITICAL'].includes(x.level)).length;
    const heat = m.heat?.metrics || {}, smog = m.smog?.level || 'UNKNOWN', dp = d.pressureChange3h;
    const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
    return [
      tile(t.overall, el('span', {class: 'flex'}, chip(result.overall_level, L(result.overall_level))), small(t.indicesActive(active))),
      tile(t.tiles.temp, el('span', {class: 'flex items-center gap-3', dir: 'ltr'}, big(fmt(d.temp) + '°C'), spark(d.tempSeries, '#fbbf24'),
        el('span', {class: 'text-xs leading-tight text-slate-200 tabular-nums'}, 'H ' + fmt(d.tempHi) + '°', el('br'), 'L ' + fmt(d.tempLo) + '°'))),
      tile(t.tiles.heat, el('span', {dir: 'ltr'}, big(fmt(heat.wbgt_c, 1) + '°C', style(m.heat?.level).text)), small(`${t.wbgt} · ${t.heatIndex} ${fmt(heat.heat_index_c)}°C`)),
      tile(t.tiles.rh, el('span', {dir: 'ltr'}, big(fmt(d.rh) + '%')), small(`${fmt(d.rhLo)}–${fmt(d.rhHi)}% · ${t.range24}`)),
      tile(t.tiles.pm, el('span', {class: 'flex items-baseline gap-1', dir: 'ltr'}, big(fmt(d.pm25), style(smog).text), small('µg/m³')),
        small(d.pm25 === null ? t.noData : `${t.mean24} ${fmt(d.pm25Mean24)} · ${t.model}`)),
      tile(t.tiles.pressure, el('span', {class: 'flex items-baseline gap-1', dir: 'ltr'}, big(dp === null ? '–' : signed(dp), dp !== null && dp <= -2 ? 'text-amber-300' : 'text-white'), small('hPa')),
        small(`${fmt(d.pressure)} hPa`)),
      tile(t.tiles.wind, el('span', {class: 'flex items-baseline gap-1', dir: 'ltr'}, big(fmt(d.windKmh)), small('km/h')),
        d.windKmh !== null && d.windKmh < 7.2 ? small(t.calm, 'text-amber-300') : null),
    ];
  }

  function moduleCard(m, t, L) {
    if (!m) return null;
    const s = style(m.level), score = Number.isFinite(m.index_score) ? m.index_score : null;
    const criteria = el('ul', {class: 'm-0 list-none space-y-1.5 p-0', dir: 'ltr'}, m.criteria.map(c => {
      const met = c.met === true, unmet = c.met === false, word = met ? t.met : unmet ? t.notMet : t.noData;
      const value = c.value === null || c.value === undefined ? '—' : (typeof c.value === 'number' ? Math.round(c.value * 10) / 10 : c.value) + (c.unit ? ' ' + c.unit : '');
      return el('li', {class: 'flex items-start gap-2 text-xs'},
        el('span', {class: `mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-black ${met ? 'bg-amber-300 text-slate-950' : unmet ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-400 ring-1 ring-inset ring-slate-600'}`, text: met ? '✓' : unmet ? '✕' : '?', title: word}),
        el('span', {class: 'min-w-0 flex-1'},
          el('span', {class: 'block text-slate-100', text: c.label}),
          el('span', {class: 'block text-slate-300'}, el('b', {class: 'font-semibold text-white tabular-nums', text: value}), ` · ${c.rule} · ${word}`)));
    }));
    const more = (m.actions.length || m.notes?.length) ? el('details', {class: 'rounded-lg border border-slate-700 bg-slate-950/60'},
      el('summary', {class: 'flex min-h-[40px] cursor-pointer items-center px-3 text-xs font-semibold text-white', text: t.more}),
      el('div', {class: 'space-y-2 px-3 pb-3 text-xs leading-relaxed'},
        m.actions.length ? el('div', {}, label(t.actions), el('ul', {class: 'm-0 mt-1 space-y-1 ps-4 text-slate-100'}, m.actions.map(a => el('li', {text: a[lang]})))) : null,
        m.notes?.length ? el('div', {dir: 'ltr'}, label(t.notes), el('ul', {class: 'm-0 mt-1 space-y-1 ps-4 text-slate-300'}, m.notes.map(n => el('li', {text: n})))) : null)) : null;
    return el('article', {class: `flex flex-col gap-2.5 rounded-xl border border-s-4 border-slate-600 ${s.edge} bg-slate-900 p-3`},
      el('div', {class: 'flex items-start justify-between gap-2'},
        el('h4', {class: 'm-0 text-sm font-bold leading-snug text-white', text: m.title[lang]}), chip(m.level, L(m.level))),
      el('p', {class: 'm-0 text-sm leading-snug text-slate-100', text: m.headline[lang]}),
      el('div', {class: 'flex items-center gap-2', title: t.scoreHelp},
        el('div', {class: 'h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700', 'aria-hidden': 'true'}, el('div', {class: `h-full rounded-full ${s.bar}`, style: `width:${score ?? 0}%`})),
        el('span', {class: 'text-[11px] tabular-nums text-slate-300', text: `${t.score} ${score ?? '–'}/100`})),
      m.criteria.length ? criteria : null,
      el('p', {class: 'm-0 text-[11px] text-slate-400', text: `${t.confidence}: ${m.confidence}${m.status === 'partial' ? ' · ' + t.partial : ''}`}),
      more);
  }

  function triage(result, t, L) {
    const mods = Object.values(result.modules);
    const open = result.alerts, low = mods.filter(m => m.level === 'LOW'), unknown = mods.filter(m => m.level === 'UNKNOWN');
    return el('aside', {class: 'order-first self-start rounded-2xl border border-slate-600 bg-slate-900/60 p-3 lg:order-none lg:sticky lg:top-4'},
      el('h3', {class: 'm-0 text-base font-bold text-white', text: t.triage}),
      el('p', {class: 'm-0 mb-3 mt-0.5 text-xs text-slate-300', text: `${open.length} ${t.active} · ${low.length} ${t.low} · ${unknown.length} ${t.needData}`}),
      open.length ? el('div', {class: 'space-y-2'}, open.map(a => el('article', {class: `rounded-xl border border-s-4 border-slate-600 ${style(a.level).edge} bg-slate-950/70 p-3`},
        el('p', {class: 'm-0 flex'}, chip(a.level, L(a.level))),
        el('h4', {class: 'm-0 mt-1.5 text-sm font-bold text-white', text: a.title[lang]}),
        el('p', {class: 'm-0 mt-1 text-xs leading-snug text-slate-100', text: a.headline[lang]}),
        a.actions[0] ? el('p', {class: 'm-0 mt-2 text-xs leading-snug text-slate-300', text: a.actions[0][lang]}) : null)))
        : el('p', {class: 'm-0 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-200', text: t.noAlerts}),
      unknown.length ? el('p', {class: 'm-0 mt-3 text-xs text-slate-400', text: `${t.needData}: ${unknown.map(m => m.title[lang]).join(' · ')}`}) : null);
  }

  function outlookTable(result, outlook, t, L) {
    const steps = outlook.steps;
    if (!steps.length) return null;
    const ids = Object.values(result.groups).flat();
    const table = el('table', {class: 'w-full border-separate border-spacing-[3px] text-xs', dir: 'ltr'});
    const headRow = el('tr', {}, el('th', {scope: 'col', class: 'sticky left-0 z-10 bg-slate-950'}));
    let lastDay = '';
    for (const s of steps) {
      const day = pktDay(s.timestamp), showDay = day !== lastDay; lastDay = day;
      headRow.append(el('th', {scope: 'col', class: 'min-w-[2.25rem] px-0.5 text-center font-normal text-slate-300'},
        el('span', {class: 'block h-4 font-bold text-white', text: showDay ? day : ''}), el('span', {class: 'block whitespace-nowrap', text: pktHour(s.timestamp)})));
    }
    const tbody = el('tbody');
    for (const id of ids) {
      const m = result.modules[id]; if (!m) continue;
      const row = el('tr', {}, el('th', {scope: 'row', class: 'sticky left-0 z-10 min-w-[8rem] max-w-[14rem] bg-slate-950 sm:min-w-[11rem] pr-2 text-left font-semibold text-slate-100', text: m.title[lang], dir: lang === 'ur' ? 'rtl' : 'ltr'}));
      for (const s of steps) {
        const v = s.levels[id] || {level: 'UNKNOWN'};
        row.append(el('td', {class: `h-6 rounded ${style(v.level).cell}`, title: `${m.title[lang]} · ${pktTime(s.timestamp)} · ${L(v.level)}${Number.isFinite(v.index_score) ? ' · ' + v.index_score : ''}`, 'aria-label': `${pktTime(s.timestamp)}: ${L(v.level)}`}));
      }
      tbody.append(row);
    }
    table.append(el('thead', {}, headRow), tbody);
    const legend = el('div', {class: 'mt-2 flex flex-wrap gap-3 text-xs text-slate-200'}, [...LEVELS, 'UNKNOWN'].map(l => el('span', {class: 'flex items-center gap-1.5'}, el('i', {class: `inline-block h-3 w-3 rounded ${style(l).cell}`}), L(l))));
    return el('section', {class: 'border-t border-slate-700 px-4 py-4'},
      el('h3', {class: 'm-0 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-300', text: t.outlook}),
      el('div', {class: 'overflow-x-auto'}, table), legend,
      el('p', {class: 'm-0 mt-2 text-xs text-slate-400', text: outlook.note}));
  }

  // Follow the forecast location used by the rest of the page.
  document.addEventListener('forecastlocationchange', e => { place = e.detail || cities[getSelected()]; if (started) load(); });
  document.getElementById('refresh')?.addEventListener('click', () => { if (started) load(); });

  // Fetch only once the panel is near the screen, so the main forecast loads first.
  render();
  const start = () => { if (started) return; started = true; place = cities[getSelected()] || place; load(); };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) { io.disconnect(); start(); } }, {rootMargin: '400px'});
    io.observe(root);
  } else start();
}
