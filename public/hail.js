// Hail chance from ECMWF fields only. This is our own ingredient index, not a calibrated probability and
// not an official warning. Hail needs (1) a strong updraught (CAPE), (2) organised storms (wind change
// between the surface and about 5.5 km, 500 hPa), (3) cold air aloft so the ice grows (500 hPa
// temperature) and (4) an actual convective trigger. The ramps below are screening conventions chosen
// from the usual severe-storm ingredient ranges (for example Thompson et al. 2003 for shear); ECMWF via
// Open-Meteo has no convective inhibition or freezing level, so those are not used.
import {windDifference} from './storms.js';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const ramp = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
export const HAIL = {
  cape: {lo: 100, hi: 1500, weight: 0.4},          // J/kg
  shear: {lo: 8, hi: 20, weight: 0.3},             // m/s, 10 m to 500 hPa
  cold: {lo: 5, hi: 15, weight: 0.3},              // -T500 in degC
  showersMm: 1,                                    // rain per hour (mm) that counts as a full trigger
  codeFloor: 60,                                   // an explicit ECMWF hail weather code never scores below this
  bands: [[10, 'Very low'], [25, 'Low'], [50, 'Moderate'], [101, 'High']],
};
export const hailLabel = index => finite(index) ? HAIL.bands.find(([limit]) => index < limit)[1] : 'Unavailable';
export const HAIL_FIELDS = ['cape', 'temperature_500hPa', 'wind_speed_500hPa', 'wind_direction_500hPa', 'showers'];

export function hailIndex(hourly, i) {
  const at = k => hourly?.[k]?.[i], code = at('weather_code');
  const cape = at('cape'), t500 = at('temperature_500hPa'), showers = at('showers');
  const shear = windDifference(at('wind_speed_10m'), at('wind_direction_10m'), at('wind_speed_500hPa'), at('wind_direction_500hPa'));
  const explicit = [96, 99].includes(code), thunder = [95, 96, 99].includes(code);
  if (![cape, t500, shear].every(finite)) return {index: explicit ? HAIL.codeFloor : null, explicit, thunder, available: false, cape, shear, t500};
  // ECMWF reports no convective-rain (showers) field and no thunder codes, so any rain in the hour is the trigger.
  const wet = Math.max(finite(showers) ? showers : 0, finite(at('precipitation')) ? at('precipitation') : 0), trigger = thunder ? 1 : Math.min(1, wet / HAIL.showersMm);
  const parts = {cape: ramp(cape, HAIL.cape.lo, HAIL.cape.hi), shear: ramp(shear, HAIL.shear.lo, HAIL.shear.hi), cold: ramp(-t500, HAIL.cold.lo, HAIL.cold.hi)};
  // Weighted geometric mean: one missing ingredient (a zero) removes the hail chance, as in the atmosphere.
  const mean = Object.values(parts).some(v => v === 0) ? 0 : Math.exp(Object.keys(parts).reduce((s, k) => s + HAIL[k].weight * Math.log(parts[k]), 0));
  const index = Math.max(Math.round(100 * mean * trigger), explicit ? HAIL.codeFloor : 0);
  return {index, explicit, thunder, available: true, cape, shear, t500, parts, trigger};
}
// Highest hourly index over a set of hour positions.
export function hailOver(hourly, positions) {
  let best = null;
  for (const i of positions) { const r = hailIndex(hourly, i); if (finite(r.index) && (!best || r.index > best.index)) best = {...r, at: i}; }
  return best ? {...best, label: hailLabel(best.index)} : {index: null, label: 'Unavailable', available: false};
}
