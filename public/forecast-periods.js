// Splits the ECMWF hourly forecast into a day half (sunrise to sunset) and a night half (sunset to the next
// sunrise) and describes each one: icon, wording, rain, snow and hail. Pure logic; the wording bands for rain
// reuse storms.js, the snow bands are descriptive conventions (no official standard is claimed).
import {rainBand, thunderEvidence} from './storms.js';
import {hailOver} from './hail.js';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const SNOW = [71, 73, 75, 77, 85, 86], FREEZING = [56, 57, 66, 67];
export const SNOW_BANDS = {lightCm: 1, heavyCm: 5};         // per half-day period, cm of fresh snow
export const HAIL_SHOW = 25;                                  // from "Moderate" up the hail icon replaces rain / storm
const sum = (hourly, key, rows) => rows.reduce((s, i) => s + (finite(hourly[key]?.[i]) ? hourly[key][i] : 0), 0);
const stamp = t => Date.parse(t + '+05:00');

// Hour positions for each half of each forecast day. Night of the last day runs to the end of the data.
export function periodRows(hourly, daily) {
  const times = (hourly?.time || []).map(stamp), out = [];
  (daily?.time || []).forEach((date, d) => {
    const rise = stamp(daily.sunrise?.[d]), set = stamp(daily.sunset?.[d]);
    const nextRise = finite(stamp(daily.sunrise?.[d + 1])) ? stamp(daily.sunrise[d + 1]) : set + 12 * 3600e3;
    const pick = (from, to) => times.flatMap((t, i) => t >= from && t < to ? [i] : []);
    out.push({date, day: finite(rise) && finite(set) ? pick(rise, set) : [], night: finite(set) ? pick(set, nextRise) : []});
  });
  return out;
}
const RANK = c => [99, 96].includes(c) ? 9 : c === 95 ? 8 : SNOW.includes(c) ? 7 : FREEZING.includes(c) ? 6 : c >= 61 && c <= 67 ? 5 : c >= 80 && c <= 82 ? 4 : c >= 51 && c <= 57 ? 3 : [45, 48].includes(c) ? 2 : 0;
const mode = values => { const n = new Map(); for (const v of values) n.set(v, (n.get(v) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]; };

export function describePeriod(hourly, rows, night) {
  if (!rows.length) return {icon: 'cloud', label: 'No data', rainMm: null, snowCm: null, hail: {index: null, label: 'Unavailable'}, thunder: false, rows};
  const codes = rows.map(i => hourly.weather_code?.[i]).filter(finite);
  const rainMm = sum(hourly, 'precipitation', rows), rain = sum(hourly, 'rain', rows), snowCm = sum(hourly, 'snowfall', rows);
  const hail = hailOver(hourly, rows), thunderRows = rows.some(i => [95, 96, 99].includes(hourly.weather_code?.[i]));
  const sliced = {};
  for (const k of Object.keys(hourly)) sliced[k] = rows.map(i => hourly[k]?.[i]);
  const ev = thunderEvidence(sliced, '2');                                                   // all stamps start with the year digit
  const thunder = thunderRows || ev.weatherThunder, band = rainBand(rainMm);
  const strongest = codes.reduce((a, c) => RANK(c) > RANK(a) ? c : a, codes[0]);
  const snowing = snowCm >= 0.1 || (SNOW.includes(strongest) && rainMm >= 0.2);
  const sky = mode(codes.filter(c => c <= 3)) ?? codes[0];
  const clearIcon = night ? 'moon' : 'sun', partlyIcon = night ? 'moonpartly' : 'partly';
  let icon, label;
  if (hail.index >= HAIL_SHOW || hail.explicit) { icon = 'hail'; label = 'Thunderstorms, hail possible'; }
  else if (thunder) { icon = 'storm'; label = (rainMm >= .2 && rainMm <= 1 ? 'Isolated ' : rainMm >= 2 && rainMm <= 10 ? 'Scattered ' : '') + 'thunderstorm chances'; label = label[0].toUpperCase() + label.slice(1); }
  else if (snowing) {
    icon = 'snow';
    const mixed = rain - snowCm * 0.7 >= 0.5 && snowCm > 0;          // water in snow is about 0.7 mm per cm (Open-Meteo convention)
    label = mixed ? 'Rain and snow' : snowCm >= SNOW_BANDS.heavyCm ? 'Heavy snow' : snowCm >= SNOW_BANDS.lightCm || !finite(snowCm) ? 'Snow' : 'Light snow';
  }
  else if (strongest && FREEZING.includes(strongest) && band.rain) { icon = 'rain'; label = 'Freezing rain possible'; }
  else if (band.rain) { icon = 'rain'; label = rainMm <= 1 ? 'Isolated rain chances' : rainMm < 2 ? 'Rain chances' : rainMm <= 10 ? 'Scattered rain chances' : 'Rain expected'; }
  else if (codes.some(c => [45, 48].includes(c)) && codes.filter(c => [45, 48].includes(c)).length >= rows.length / 2) { icon = 'fog'; label = 'Fog'; }
  else if (sky === 0 || sky === 1) { icon = clearIcon; label = night ? 'Clear night' : 'Clear skies'; if (sky === 1) { icon = clearIcon; label = night ? 'Mostly clear' : 'Mostly sunny'; } }
  else if (sky === 2) { icon = partlyIcon; label = 'Partly cloudy'; }
  else if (sky === 3) { icon = 'cloud'; label = 'Overcast'; }
  else { icon = 'cloud'; label = 'Condition unavailable'; }
  return {icon, label, rainMm, snowCm, hail, thunder, band, rows};
}
export function weekPeriods(hourly, daily) {
  return periodRows(hourly, daily).map(p => ({date: p.date, day: describePeriod(hourly, p.day, false), night: describePeriod(hourly, p.night, true)}));
}
