import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastTable, weatherIcon, CLOUD_OKTAS} from '../public/explorer/core.js';
import {renderForecast, iconSvg, ICON_NAMES, ICON_LABELS, esc, rainBarPercent, STRENGTH_COLOURS} from '../public/explorer/forecast-ui.js';

const T0 = Date.parse('2026-11-17T00:00:00Z');
const rows = (n, f = () => ({})) => Array.from({length: n}, (_, h) => ({t: T0 + h * 3600000, temp: 10 + h * 0.1, precip: 0, snow: 0, wind: 5, dir: 270, gust: null, cape: 0, cloud: 20, km1: true, ...f(h)}));
const count = (html, re) => (html.match(re) || []).length;

test('every icon the weather logic can return has a drawing and a label', () => {
  const seen = new Set();
  for (const day of [true, false]) for (const precip of [0, 0.3, 2, 6]) for (const snow of [0, 3]) for (const cloud of [0, CLOUD_OKTAS.clear, CLOUD_OKTAS.scattered, CLOUD_OKTAS.broken]) for (const cape of [0, 900])
    seen.add(weatherIcon({precip, snow, cloud, cape}, day));
  for (const name of seen) { assert.ok(ICON_NAMES.includes(name), `icon for ${name}`); assert.ok(ICON_LABELS[name]); }
  assert.deepEqual([...seen].sort(), ['clear-day', 'clear-night', 'cloudy', 'overcast', 'partly-day', 'partly-night', 'rain', 'rain-heavy', 'rain-light', 'snow', 'thunder'].sort());
  for (const name of ICON_NAMES) { const svg = iconSvg(name); assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && svg.includes(`aria-label="${ICON_LABELS[name]}"`) && svg.includes('viewBox="0 0 32 32"')); }
  const shapes = new Set(ICON_NAMES.map(n => iconSvg(n))); assert.equal(shapes.size, ICON_NAMES.length, 'every icon looks different');
  assert.ok(iconSvg('no-such-icon').includes('<svg'));                                                     // an unknown key still draws something
});
test('the table has one cell per column in each of its four rows, and the day headers add up to the columns', () => {
  const t = forecastTable(rows(80), {lat: 33.7, lon: 73.1}), html = renderForecast(t);
  const n = t.columns.length;
  assert.ok(n > 20);
  for (const row of ['icons', 'temp', 'rain', 'wind']) { const m = html.match(new RegExp(`<tr class="${row}">(.*?)</tr>`)); assert.equal(count(m[1], /<td/g), n, row); }
  assert.equal(count(html.match(/<tr class="hours">(.*?)<\/tr>/)[1], /<th scope="col"/g), n);
  const spans = [...html.matchAll(/colspan="(\d+)" class="day"/g)].map(m => +m[1]);
  assert.equal(spans.reduce((a, b) => a + b, 0), n);
  assert.ok(html.includes('Tue 17 Nov') && html.includes('Wed 18 Nov'));
  assert.ok(html.includes('Wind km/h') && html.includes('Rain mm') && html.includes('Temp °C'));
  assert.ok(renderForecast(forecastTable(rows(80), {speedUnit: 'kt'})).includes('Wind kt'));
});
test('temperature cells are coloured by temperature with readable text, rain is blank when dry', () => {
  const t = forecastTable(rows(30, h => ({temp: h < 12 ? -8 : 33, precip: h === 4 ? 2 : 0})), {lat: 33.7, lon: 73.1}), html = renderForecast(t);
  const temp = html.match(/<tr class="temp">(.*?)<\/tr>/)[1];
  const cells = [...temp.matchAll(/<td[^>]*style="background:rgb\((\d+),(\d+),(\d+)\);color:(#[0-9a-f]+)">(-?\d+)°<\/td>/g)];
  assert.equal(cells.length, t.columns.length);
  const cold = cells.find(c => c[5] === '-8'), hot = cells.find(c => c[5] === '33');
  assert.ok(+cold[3] > +cold[1], 'cold is blue');
  assert.ok(+hot[1] > +hot[3], 'hot is red');
  for (const c of cells) assert.ok(['#0b1624', '#ffffff'].includes(c[4]));
  const rain = html.match(/<tr class="rain">(.*?)<\/tr>/)[1];
  const wet = [...rain.matchAll(/<td[^>]*><div class="bar" style="height:(\d+)%"><\/div><span>([^<]*)<\/span><\/td>/g)];
  assert.equal(wet.length, t.columns.length);
  assert.equal(wet.filter(c => c[2] !== '').length, 1);                                                    // only the wet period has a number
  assert.equal(wet.filter(c => c[1] === '0').length, t.columns.length - 1);
  assert.equal(wet.find(c => c[2] !== '')[2], '2');                                                        // 2 mm in the hour, in the column that holds that hour
  assert.equal(rainBarPercent(0), 0); assert.equal(rainBarPercent(-1), 0); assert.equal(rainBarPercent(NaN), 0);
  assert.ok(rainBarPercent(0.2) > 10 && rainBarPercent(0.2) < rainBarPercent(3) && rainBarPercent(500) === 100);
});
test('wind arrows point where the wind goes and show gusts only where the model has them', () => {
  const t = forecastTable(rows(120, h => ({wind: 12, dir: 270, gust: h < 60 ? 20 : null})), {lat: 33.7, lon: 73.1}), html = renderForecast(t);
  const wind = html.match(/<tr class="wind">(.*?)<\/tr>/)[1];
  assert.ok(wind.includes('rotate(90deg)'));                                                               // from the west: pointing east
  assert.equal(count(wind, /<small>g 72<\/small>/g), t.columns.filter(c => c.hasGust).length);
  assert.ok(t.columns.some(c => !c.hasGust) && count(wind, /<small>/g) < t.columns.length);
  assert.ok(wind.includes(`fill="${STRENGTH_COLOURS[3]}"`));                                               // a 72 km/h gust is a gale
  assert.ok(wind.includes(`fill="${STRENGTH_COLOURS[2]}"`));                                               // 43 km/h without a gust: strong
  const calm = renderForecast(forecastTable(rows(30, () => ({wind: 1, dir: 10})), {})).match(/<tr class="wind">(.*?)<\/tr>/)[1];
  assert.ok(!calm.includes('<small>') && calm.includes(`fill="${STRENGTH_COLOURS[0]}"`));
  const none = renderForecast(forecastTable(rows(30, () => ({wind: null, dir: null})), {})).match(/<tr class="wind">(.*?)<\/tr>/)[1];
  assert.ok(!none.includes('<svg') && none.includes('–'));
});
test('columns past the 1 km steps are marked, and the column of the hour shown on the map is highlighted', () => {
  const t = forecastTable(rows(120, h => ({km1: h <= 72})), {lat: 33.7, lon: 73.1});
  const html = renderForecast(t, {nowT: T0 + 30 * 3600000});
  assert.ok(html.includes('km9') && t.columns.some(c => c.km1) && t.columns.some(c => !c.km1));
  const first9 = t.columns.findIndex(c => !c.km1);
  assert.ok(t.columns.slice(first9).every(c => !c.km1));
  assert.equal(count(html.match(/<tr class="icons">(.*?)<\/tr>/)[1], /km9/g), t.columns.length - first9);
  assert.equal(count(html, /class="now"|class="[^"]*\bnow\b[^"]*"/g), 5);                                  // the hours header and the four rows
  const nowT = +html.match(/class="[^"]*\bnow\b[^"]*" data-t="(\d+)"/)[1];
  assert.ok(nowT <= T0 + 30 * 3600000 && nowT > T0 + 27 * 3600000);                                       // the column that holds hour 30
  assert.ok(!renderForecast(t).includes('now'), 'no highlight without a time');
  assert.ok(!renderForecast(forecastTable(rows(80), {})).includes('km9'));                                 // no 1 km columns at all: nothing is marked lighter
  assert.ok(renderForecast(forecastTable([], {})).includes('No forecast'));
});
test('text is escaped', () => {
  assert.equal(esc('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  const html = renderForecast({columns: [{t: T0, dayKey: 'd', hour: '00:00', day: false, icon: 'clear-night', temp: 1, rain: 0, wind: 1, dir: 0, arrow: 0, gust: null, strength: 0, hasGust: false, km1: true}],
    days: [{key: 'd', label: '<img src=x>', span: 1}], speedUnit: '<u>'});
  assert.ok(!html.includes('<img') && html.includes('&lt;img src=x&gt;') && !html.includes('<u>'));
});
