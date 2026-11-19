// The location forecast drawer: weather icons and the table as an HTML string. Pure (no DOM), so every cell can be tested with numbers.
// The numbers come from forecastTable in core.js.
import {temperatureColour} from './core.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// ---- icons: 32 x 32, a handful of shapes combined ----
const CLOUD = (fill = '#eaf0f8') => `<path d="M10 25a6 6 0 0 1-.7-11.95A8 8 0 0 1 24.6 12.4 6.3 6.3 0 0 1 24 25Z" fill="${fill}" stroke="#7d8ea6" stroke-width="1"/>`;
const SUN = (cx, cy, r, rays = true) => `<g stroke="#ffc83d" stroke-width="2" stroke-linecap="round">${rays ? [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
  const x = Math.cos(a * Math.PI / 180), y = Math.sin(a * Math.PI / 180); return `<line x1="${(cx + x * (r + 3)).toFixed(1)}" y1="${(cy + y * (r + 3)).toFixed(1)}" x2="${(cx + x * (r + 6)).toFixed(1)}" y2="${(cy + y * (r + 6)).toFixed(1)}"/>`; }).join('') : ''}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc83d"/>`;
const MOON = (cx, cy, s = 1) => `<path transform="translate(${cx} ${cy}) scale(${s})" d="M4-10A10 10 0 1 0 12 5.5 8 8 0 0 1 4-10Z" fill="#d6deee"/>`;
const DROPS = n => `<g stroke="#4aa0ff" stroke-width="2.2" stroke-linecap="round">${[9, 15, 21, 27].slice(0, n).map((x, i) => `<line x1="${x - 1 + (n === 4 ? 0 : 3)}" y1="${26 + (i % 2)}" x2="${x - 3 + (n === 4 ? 0 : 3)}" y2="${30 + (i % 2)}"/>`).join('')}</g>`;
const FLAKES = `<g fill="#fff" stroke="#9b64f0" stroke-width="1">${[[10, 28], [16, 29.5], [22, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>`;
const BOLT = '<path d="M17 21l-5 7h4l-2 5 7-8h-4l2-4Z" fill="#ffd23d" stroke="#b8860b" stroke-width=".8"/>';
const ICONS = {
  'clear-day': SUN(16, 16, 6), 'clear-night': MOON(14, 17),
  'partly-day': SUN(11, 11, 5) + `<g transform="translate(2 -2)">${CLOUD()}</g>`, 'partly-night': MOON(11, 12, 0.7) + `<g transform="translate(2 -2)">${CLOUD()}</g>`,
  cloudy: `<g transform="translate(-4 -5) scale(.85)">${CLOUD('#b9c4d4')}</g><g transform="translate(2 -1)">${CLOUD()}</g>`, overcast: `<g transform="translate(0 -2)">${CLOUD('#9aa8bb')}</g>`,
  'rain-light': `<g transform="translate(0 -5)">${CLOUD('#c9d3e0')}</g>${DROPS(2)}`, rain: `<g transform="translate(0 -5)">${CLOUD('#b3bfce')}</g>${DROPS(3)}`,
  'rain-heavy': `<g transform="translate(0 -6)">${CLOUD('#8c9bb0')}</g>${DROPS(4)}`, thunder: `<g transform="translate(0 -6)">${CLOUD('#7d8aa0')}</g>${BOLT}`, snow: `<g transform="translate(0 -5)">${CLOUD('#dfe7f2')}</g>${FLAKES}`,
};
export const ICON_LABELS = {'clear-day': 'Clear', 'clear-night': 'Clear night', 'partly-day': 'Partly cloudy', 'partly-night': 'Partly cloudy night', cloudy: 'Cloudy', overcast: 'Overcast',
  'rain-light': 'Light rain', rain: 'Rain', 'rain-heavy': 'Heavy rain', thunder: 'Thunderstorm', snow: 'Snow'};
export const iconSvg = name => `<svg class="ic" viewBox="0 0 32 32" role="img" aria-label="${esc(ICON_LABELS[name] || name)}">${ICONS[name] || ICONS.overcast}</svg>`;
export const ICON_NAMES = Object.keys(ICONS);

// Arrow colour by wind strength class (windClass in core.js): light, moderate, strong, gale, storm.
export const STRENGTH_COLOURS = ['#9fd4ff', '#7be0a8', '#ffd24a', '#ff7a45', '#ff4fa0'];
const textColour = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b1624' : '#ffffff';
export const rainBarPercent = mm => !(mm > 0) ? 0 : Math.min(100, Math.round(Math.sqrt(mm / 12) * 100));   // square-root scale: a drizzle still shows, a downpour does not flatten the rest

// One column's cells. Columns that are not 1 km ('km9') are lighter when the table also has 1 km columns, so the change at +72 h is visible.
export function renderForecast(table, {nowT = null} = {}) {
  const {columns, days, speedUnit} = table;
  if (!columns.length) return '<p class="fc-empty">No forecast for this point.</p>';
  const any1 = columns.some(c => c.km1), cls = (c, ...more) => { const k = [!any1 || c.km1 ? '' : 'km9', ...more].filter(Boolean).join(' '); return k ? ` class="${k}"` : ''; };
  const now = nowT === null ? -1 : columns.findIndex((c, i) => nowT >= c.t && nowT < (columns[i + 1]?.t ?? c.t + 3 * 3600000));
  const td = (c, i, inner, style = '') => `<td${cls(c, i === now ? 'now' : '', c.hour === '00:00' ? 'midnight' : '')} data-t="${c.t}"${style ? ` style="${style}"` : ''}>${inner}</td>`;
  const rowh = t => `<th class="rowh" scope="row">${t}</th>`;
  const head = `<tr class="days"><th class="rowh"></th>${days.map(d => `<th colspan="${d.span}" class="day">${esc(d.label)}</th>`).join('')}</tr>`
    + `<tr class="hours">${rowh('Local time')}${columns.map((c, i) => `<th scope="col"${cls(c, i === now ? 'now' : '', c.hour === '00:00' ? 'midnight' : '')} data-t="${c.t}">${c.hour}</th>`).join('')}</tr>`;
  const icons = `<tr class="icons">${rowh('Weather')}${columns.map((c, i) => td(c, i, iconSvg(c.icon))).join('')}</tr>`;
  const temps = `<tr class="temp">${rowh('Temp °C')}${columns.map((c, i) => {
    if (c.temp === null) return td(c, i, '–');
    const col = temperatureColour(c.temp); return td(c, i, `${Math.round(c.temp)}°`, `background:rgb(${col[0]},${col[1]},${col[2]});color:${textColour(col)}`); }).join('')}</tr>`;
  const rain = `<tr class="rain">${rowh('Rain mm')}${columns.map((c, i) => td(c, i, c.rain === null ? '–' : `<div class="bar" style="height:${rainBarPercent(c.rain)}%"></div><span>${c.rain > 0 ? c.rain : ''}</span>`)).join('')}</tr>`;
  const wind = `<tr class="wind">${rowh(`Wind ${esc(speedUnit)}`)}${columns.map((c, i) => {
    if (c.wind === null) return td(c, i, '–');
    const arrow = c.arrow === null ? '' : `<svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${Math.round(c.arrow)}deg)" role="img" aria-label="wind from ${Math.round(c.dir)} degrees"><path d="M12 2 18.5 21 12 16.5 5.5 21Z" fill="${STRENGTH_COLOURS[c.strength]}" stroke="#0b1624" stroke-width="1.2"/></svg>`;
    const gust = c.hasGust && c.gust > c.wind ? `<small>g ${c.gust}</small>` : '';
    return td(c, i, `${arrow}<b>${c.wind}</b>${gust}`); }).join('')}</tr>`;
  return `<table class="fc-table"><thead>${head}</thead><tbody>${icons}${temps}${rain}${wind}</tbody></table>`;
}
