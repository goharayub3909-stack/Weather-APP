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

/** Run the engine on built readings. */
export function runHealth(built) {
  return {
    result: assessHealth(built.current, built.history),
    outlook: assessOutlook(built.current, built.history, built.forecast, {stepHours: STEP_HOURS, horizonHours: OUTLOOK_HOURS}),
  };
}

// ---------------------------------------------------------------- UI text

const UI = {
  en: {
    eyebrow: 'SEHAT · WEATHER-BASED HEALTH SCREENING', title: 'Health & environment',
    intro: 'Eleven weather-linked health and crop-pest indices for the selected place, from the last 72 hours of model weather and the CAMS air-quality model.',
    overall: 'Overall', loading: 'Calculating health indices…', failed: 'Health indices are unavailable. Check your connection and press Refresh.',
    alerts: 'Active alerts', noAlerts: 'No index is at HIGH or CRITICAL right now.', watch: 'Watch (moderate)', outlook: 'Next 72 hours · every 3 hours',
    details: 'Why this level · what to do', criteria: 'Conditions checked', actions: 'What to do', notes: 'Notes',
    confidence: 'Confidence', partial: 'Some inputs missing', refresh: 'Refresh', source: 'Model data · not station readings',
    asOf: 'Model hour', met: 'met', notMet: 'not met', noData: 'no data', now: 'Now',
    dataNote: 'Inputs: Open-Meteo best-match model (temperature, humidity, surface pressure, wind, rain, top-layer soil) and CAMS PM2.5. Model values smooth out local extremes, so station readings may differ.',
    groups: {vector_borne: 'Mosquito-borne', crop_pest: 'Crop pests & disease', biometeorology: 'Weather & the body', respiratory: 'Air & breathing', seasonal_virus: 'Seasonal viruses'},
    levels: {LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical', UNKNOWN: 'Unknown'},
  },
  ur: {
    eyebrow: 'صحت · موسم پر مبنی جائزہ', title: 'صحت اور ماحول',
    intro: 'منتخب جگہ کے لیے موسم سے جڑے صحت اور فصلوں کے کیڑوں کے گیارہ اشاریے، پچھلے 72 گھنٹوں کے ماڈل موسم اور CAMS فضائی معیار ماڈل کی بنیاد پر۔',
    overall: 'مجموعی', loading: 'صحت کے اشاریے تیار ہو رہے ہیں…', failed: 'صحت کے اشاریے دستیاب نہیں۔ انٹرنیٹ چیک کر کے ریفریش کریں۔',
    alerts: 'فعال انتباہات', noAlerts: 'اس وقت کوئی اشاریہ "زیادہ" یا "انتہائی" سطح پر نہیں۔', watch: 'نگرانی (درمیانہ)', outlook: 'اگلے 72 گھنٹے · ہر 3 گھنٹے',
    details: 'یہ سطح کیوں · کیا کریں', criteria: 'جانچی گئی شرائط', actions: 'کیا کریں', notes: 'نوٹ',
    confidence: 'اعتماد', partial: 'کچھ معلومات دستیاب نہیں', refresh: 'ریفریش', source: 'ماڈل ڈیٹا · اسٹیشن ریڈنگ نہیں',
    asOf: 'ماڈل کا وقت', met: 'پوری', notMet: 'پوری نہیں', noData: 'ڈیٹا نہیں', now: 'ابھی',
    dataNote: 'ماخذ: Open-Meteo ماڈل (درجۂ حرارت، نمی، فضائی دباؤ، ہوا، بارش، مٹی کی اوپری تہہ) اور CAMS سے PM2.5۔ ماڈل مقامی شدت کو ہموار کر دیتا ہے، اس لیے اسٹیشن کی ریڈنگ مختلف ہو سکتی ہے۔',
    groups: {vector_borne: 'مچھر سے پھیلنے والی بیماریاں', crop_pest: 'فصلوں کے کیڑے اور بیماریاں', biometeorology: 'موسم اور جسم', respiratory: 'ہوا اور سانس', seasonal_virus: 'موسمی وائرس'},
    levels: {LOW: 'کم', MODERATE: 'درمیانہ', HIGH: 'زیادہ', CRITICAL: 'انتہائی', UNKNOWN: 'نامعلوم'},
  },
};

// ---------------------------------------------------------------- DOM helpers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}
const levelClass = level => 'health-level--' + String(level || 'UNKNOWN').toLowerCase();
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

  const body = el('div', {class: 'health-body', 'aria-live': 'polite'});
  const langSwitch = el('div', {class: 'segmented health-lang', role: 'group', 'aria-label': 'Language'});
  for (const [code, label] of [['en', 'English'], ['ur', 'اردو']]) {
    const b = el('button', {type: 'button', 'data-lang': code, text: label});
    b.addEventListener('click', () => { lang = code; try { localStorage.setItem('health-lang', code); } catch {} render(); });
    langSwitch.append(b);
  }
  const refresh = el('button', {type: 'button', class: 'text-button health-refresh'});
  refresh.addEventListener('click', () => load());
  const head = el('div', {class: 'health-head'});
  root.replaceChildren(head, body);

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
      state = {status: 'ready', ...runHealth(built), airMissing: !a, placeName: place[0]};
    } catch (e) {
      if (signal.aborted) return;
      state = {status: 'error'};
    }
    render();
  }

  function render() {
    const t = UI[lang];
    root.setAttribute('lang', lang);
    root.classList.toggle('health-urdu', lang === 'ur');
    root.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
    langSwitch.querySelectorAll('button').forEach(b => { const on = b.dataset.lang === lang; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
    refresh.textContent = '↻ ' + t.refresh;
    head.replaceChildren(
      el('div', {}, el('span', {class: 'eyebrow', text: t.eyebrow}), el('h2', {text: t.title}), el('p', {class: 'health-intro', text: t.intro})),
      el('div', {class: 'health-tools'}, langSwitch, refresh),
    );
    if (state.status === 'loading' || state.status === 'idle') { body.replaceChildren(el('p', {class: 'empty', text: t.loading})); return; }
    if (state.status === 'error') { body.replaceChildren(el('p', {class: 'empty health-error', text: t.failed})); return; }

    const {result, outlook} = state, L = lev => t.levels[lev] || lev;
    // Summary row
    const summary = el('div', {class: 'health-summary'},
      el('div', {class: 'health-overall ' + levelClass(result.overall_level)},
        el('span', {text: t.overall}), el('strong', {text: L(result.overall_level)})),
      el('div', {class: 'health-meta'},
        el('strong', {text: state.placeName}),
        el('span', {text: `${t.asOf}: ${pktTime(result.timestamp)} PKT`}),
        el('span', {class: 'tag', text: t.source.toUpperCase()})),
    );
    // Alerts
    // Only HIGH and CRITICAL get full alert cards; MODERATE items are listed as a watch line.
    const strong = result.alerts.filter(a => a.level === 'HIGH' || a.level === 'CRITICAL');
    const watch = result.alerts.filter(a => a.level === 'MODERATE');
    const alertList = strong.length
      ? el('div', {class: 'health-alerts'}, strong.map(a => el('article', {class: 'health-alert ' + levelClass(a.level)},
          el('div', {class: 'health-alert-top'}, el('strong', {text: a.title[lang]}), el('span', {class: 'health-chip', text: L(a.level)})),
          el('p', {text: a.headline[lang]}),
          a.actions[0] ? el('p', {class: 'health-alert-action', text: a.actions[0][lang]}) : null)))
      : el('p', {class: 'agri-callout', text: t.noAlerts});
    const watchLine = watch.length
      ? el('p', {class: 'health-watch'}, el('strong', {text: t.watch + ': '}), watch.map(a => a.title[lang]).join(' · '))
      : null;

    // Module cards grouped
    const groups = Object.entries(result.groups).map(([gid, ids]) => el('section', {class: 'health-group'},
      el('h3', {text: t.groups[gid] || gid}),
      el('div', {class: 'health-modules'}, ids.map(id => moduleCard(result.modules[id], t, L)))));

    body.replaceChildren(summary, el('h3', {class: 'health-subhead', text: t.alerts}), alertList, watchLine, ...groups,
      outlookTable(result, outlook, t, L),
      el('p', {class: 'subtle-note', text: t.dataNote}),
      el('p', {class: 'subtle-note health-disclaimer', text: result.disclaimer[lang]}));
  }

  function moduleCard(m, t, L) {
    if (!m) return null;
    const score = Number.isFinite(m.index_score) ? m.index_score : null;
    const criteria = el('ul', {class: 'health-criteria'}, m.criteria.map(c => {
      const state = c.met === true ? t.met : c.met === false ? t.notMet : t.noData;
      const value = c.value === null || c.value === undefined ? '—' : (typeof c.value === 'number' ? Math.round(c.value * 10) / 10 : c.value) + (c.unit ? ' ' + c.unit : '');
      return el('li', {class: c.met === true ? 'met' : c.met === false ? 'unmet' : 'nodata', dir: 'ltr'},
        el('span', {text: c.label}), el('span', {text: `${value} · ${c.rule}`}), el('em', {text: state}));
    }));
    const details = el('details', {class: 'health-details'},
      el('summary', {text: t.details}),
      m.criteria.length ? el('h5', {text: t.criteria}) : null, m.criteria.length ? criteria : null,
      m.actions.length ? el('h5', {text: t.actions}) : null,
      m.actions.length ? el('ul', {class: 'health-actions'}, m.actions.map(a => el('li', {text: a[lang]}))) : null,
      m.notes?.length ? el('h5', {text: t.notes}) : null,
      m.notes?.length ? el('ul', {class: 'health-notes', dir: 'ltr'}, m.notes.map(n => el('li', {text: n}))) : null,
      el('p', {class: 'subtle-note', text: `${t.confidence}: ${m.confidence}${m.status === 'partial' ? ' · ' + t.partial : ''}`}));
    return el('article', {class: 'health-module ' + levelClass(m.level)},
      el('div', {class: 'health-module-top'}, el('h4', {text: m.title[lang]}), el('span', {class: 'health-chip', text: L(m.level) + (score !== null ? ' · ' + score : '')})),
      el('div', {class: 'health-bar', 'aria-hidden': 'true'}, el('i', {style: `width:${score ?? 0}%`})),
      el('p', {class: 'health-headline', text: m.headline[lang]}),
      details);
  }

  function outlookTable(result, outlook, t, L) {
    const steps = outlook.steps;
    if (!steps.length) return null;
    const ids = Object.values(result.groups).flat();
    const table = el('table', {class: 'health-outlook', dir: 'ltr'});
    const headRow = el('tr', {}, el('th', {scope: 'col'}));
    let lastDay = '';
    for (const s of steps) {
      const day = pktDay(s.timestamp), showDay = day !== lastDay; lastDay = day;
      headRow.append(el('th', {scope: 'col', class: showDay ? 'day-start' : null}, showDay ? el('b', {text: day}) : null, el('span', {text: pktHour(s.timestamp)})));
    }
    table.append(el('thead', {}, headRow));
    const tbody = el('tbody');
    for (const id of ids) {
      const m = result.modules[id]; if (!m) continue;
      const row = el('tr', {}, el('th', {scope: 'row', text: m.title[lang], dir: lang === 'ur' ? 'rtl' : 'ltr'}));
      for (const s of steps) {
        const v = s.levels[id] || {level: 'UNKNOWN'};
        row.append(el('td', {class: levelClass(v.level), title: `${m.title.en} · ${pktTime(s.timestamp)} · ${t.levels[v.level] || v.level}${Number.isFinite(v.index_score) ? ' · ' + v.index_score : ''}`, 'aria-label': `${pktTime(s.timestamp)}: ${L(v.level)}`}));
      }
      tbody.append(row);
    }
    table.append(tbody);
    const legend = el('div', {class: 'health-legend'}, [...LEVELS, 'UNKNOWN'].map(l => el('span', {class: levelClass(l)}, el('i'), L(l))));
    return el('section', {class: 'health-group'},
      el('h3', {text: t.outlook}),
      el('div', {class: 'health-outlook-wrap'}, table), legend,
      el('p', {class: 'subtle-note', text: outlook.note}));
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
