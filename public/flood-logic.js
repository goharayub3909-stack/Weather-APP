// FloodAI pure logic: rainfall losses (SCS curve number), return periods (Gumbel), catchment response
// (Kirpich time of concentration + SCS triangular unit hydrograph), gauge correction and the risk band.
// Every constant states its source. This is a screening tool, not an official flood forecast or warning.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const sum = a => a.reduce((x, y) => x + (finite(y) ? y : 0), 0);

// Curve numbers, AMC II, good condition, hydrologic soil groups A-D.
// Source: USDA NRCS TR-55 (1986), Tables 2-2a (urban), 2-2b (cultivated, pasture, woods, brush), 2-2d (arid and semiarid).
// Manning n: Chow, Open-Channel Hydraulics (1959), Table 5-6 normal values for floodplains / minor streams.
// Rows marked `assumed` have no value in those tables; they are placeholders you can see and change.
export const LAND_COVER = {
  cropland: {label: 'Cropland (row crops)', cn: [67, 78, 85, 89], n: 0.035, nSource: 'Chow 1959: mature row crops'},
  pasture: {label: 'Pasture / grass', cn: [39, 61, 74, 80], n: 0.030, nSource: 'Chow 1959: pasture, short grass'},
  shrub: {label: 'Shrub / brush', cn: [30, 48, 65, 73], n: 0.050, nSource: 'Chow 1959: scattered brush, heavy weeds'},
  woodland: {label: 'Woodland / orchards', cn: [30, 55, 70, 77], n: 0.100, nSource: 'Chow 1959: heavy stand of timber'},
  arid: {label: 'Arid shrubland / desert', cn: [55, 72, 81, 86], n: 0.050, nSource: 'Chow 1959: scattered brush (assumed match)'},
  bare: {label: 'Bare / fallow soil', cn: [77, 86, 91, 94], n: 0.030, nSource: 'Chow 1959: cultivated, no crop'},
  residential: {label: 'Residential (1/4 acre lots)', cn: [61, 75, 83, 87], n: 0.050, nSource: 'assumed (not in Chow)'},
  builtup: {label: 'Dense built-up / commercial', cn: [89, 92, 94, 95], n: 0.050, nSource: 'assumed (not in Chow)'},
  water: {label: 'Open water / wetland', cn: [100, 100, 100, 100], n: 0.030, nSource: 'Chow 1959: clean straight stream (assumed for lakes); TR-55 open water CN 100'},
};
export const SOIL_GROUPS = ['A', 'B', 'C', 'D'];
export const curveNumber = (cover, group) => {
  const row = LAND_COVER[cover], i = SOIL_GROUPS.indexOf(group);
  if (!row || i < 0) throw Error('Unknown land cover or soil group');
  return row.cn[i];
};

// Antecedent moisture. Conversions: Chow, Maidment and Mays, Applied Hydrology (1988) eqs. 5.5.
// Classes by 5-day antecedent rain: TR-55 Table 2-1 (growing season I < 35.6, III > 53.3 mm; dormant I < 12.7, III > 27.9 mm).
export const AMC_LIMITS_MM = {growing: [35.6, 53.3], dormant: [12.7, 27.9]};
export const amcClass = (rain5dMm, growing = true) => {
  if (!finite(rain5dMm)) return 2;
  const [dry, wet] = AMC_LIMITS_MM[growing ? 'growing' : 'dormant'];
  return rain5dMm < dry ? 1 : rain5dMm > wet ? 3 : 2;
};
export const adjustCN = (cn2, amc) => amc === 1 ? 4.2 * cn2 / (10 - 0.058 * cn2) : amc === 3 ? 23 * cn2 / (10 + 0.13 * cn2) : cn2;

// SCS runoff: S = 25400/CN - 254 (mm), Ia = 0.2 S, Q = (P - Ia)^2 / (P - Ia + S). TR-55 eqs. 2-1 to 2-3.
export const IA_RATIO = 0.2;
export function scsRunoff(pMm, cn) {
  if (!finite(pMm) || pMm <= 0 || !finite(cn) || cn <= 0) return 0;
  const s = 25400 / Math.min(100, cn) - 254, ia = IA_RATIO * s;
  return pMm > ia ? (pMm - ia) ** 2 / (pMm - ia + s) : 0;
}
// Hourly effective rain: the increase of the cumulative runoff curve, so the total equals scsRunoff(total).
export function effectiveRain(hourly, cn) {
  let cum = 0, prev = 0;
  return hourly.map(p => { cum += finite(p) ? Math.max(0, p) : 0; const q = scsRunoff(cum, cn), inc = q - prev; prev = q; return inc; });
}

// Gumbel (EV1) fitted by the method of moments to annual maxima. Quantile x_T = mu - beta ln(-ln(1 - 1/T)).
export function annualMaxima(time, precip, minDays = 330) {
  const years = new Map();
  time.forEach((d, i) => {
    const y = d.slice(0, 4), e = years.get(y) || {max: -Infinity, n: 0};
    if (finite(precip[i])) { e.n++; e.max = Math.max(e.max, precip[i]); }
    years.set(y, e);
  });
  return [...years].filter(([, e]) => e.n >= minDays).map(([year, e]) => ({year: Number(year), max: e.max}));
}
export function gumbelFit(values) {
  const v = values.filter(finite);
  if (v.length < 10) return null;
  const mean = sum(v) / v.length, sd = Math.sqrt(sum(v.map(x => (x - mean) ** 2)) / (v.length - 1));
  if (!(sd > 0)) return null;
  const beta = sd * Math.sqrt(6) / Math.PI;
  return {mu: mean - 0.5772156649 * beta, beta, n: v.length};
}
export const gumbelQuantile = (fit, years) => fit.mu - fit.beta * Math.log(-Math.log(1 - 1 / years));
export const gumbelReturnPeriod = (fit, x) => 1 / (1 - Math.exp(-Math.exp(-(x - fit.mu) / fit.beta)));
// Weibull plotting position for the empirical points: T = (n + 1) / rank (rank 1 = largest).
export const weibullPoints = values => [...values].sort((a, b) => b - a).map((x, i, a) => ({x, years: (a.length + 1) / (i + 1)}));

// Return-period bands for a forecast 24 h rainfall. Standard return periods, but the band names are this
// tool's screening convention, not official warning levels.
export const RISK_BANDS = [
  {from: 50, label: 'Very high', level: 3}, {from: 10, label: 'High', level: 2}, {from: 2, label: 'Moderate', level: 1}, {from: 0, label: 'Low', level: 0},
];
export const riskBand = years => finite(years) ? RISK_BANDS.find(b => years >= b.from) : {label: 'Unavailable', level: null};
export function maxRolling(hourly, hours = 24) {
  let best = 0, run = 0;
  hourly.forEach((p, i) => { run += finite(p) ? p : 0; if (i >= hours) run -= finite(hourly[i - hours]) ? hourly[i - hours] : 0; best = Math.max(best, run); });
  return best;
}

// Design storm for a return period: the Gumbel daily depth spread as a centred triangle (assumption).
export function designStorm(totalMm, hours = 24) {
  const w = Array.from({length: hours}, (_, i) => 1 - Math.abs((i + 0.5) - hours / 2) / (hours / 2));
  const s = sum(w);
  return w.map(x => totalMm * x / s);
}

// Rain gauges: scale model rain by observed / modelled totals at the same places over the same 24 h.
// The floor and limits are safeguards against dividing by a near-zero model total, not hydrology.
export const GAUGE = {minModelMm: 5, limits: [0.5, 3], maxKm: 60, maxGauges: 5};
export function gaugeFactor(pairs) {
  const ok = pairs.filter(p => finite(p.gauge) && finite(p.model));
  const model = sum(ok.map(p => p.model)), gauge = sum(ok.map(p => p.gauge));
  if (!ok.length || model < GAUGE.minModelMm) return {factor: 1, applied: false, gauges: ok.length, gauge, model};
  return {factor: Math.min(GAUGE.limits[1], Math.max(GAUGE.limits[0], gauge / model)), applied: true, gauges: ok.length, gauge, model};
}

// Catchment response. Kirpich (1940): Tc[min] = 0.0195 L^0.77 S^-0.385 (L in m, S in m/m).
// SCS triangular unit hydrograph (TR-55 / NEH-4): Tp = D/2 + 0.6 Tc, qp = 0.208 A / Tp (m3/s per mm of runoff, A in km2, Tp in h).
export const kirpichHours = (lengthM, slope) => 0.0195 * lengthM ** 0.77 * Math.max(slope, 1e-4) ** -0.385 / 60;
export function unitHydrograph(areaKm2, tcHours, stepHours = 1) {
  const tp = stepHours / 2 + 0.6 * tcHours, qp = 0.208 * areaKm2 / tp, base = 2.67 * tp, out = [];
  // Average of the triangle over each step so the volume is exact: 1 mm over A km2 = A * 1000 m3.
  const tri = t => t <= 0 || t >= base ? 0 : t <= tp ? qp * t / tp : qp * (base - t) / (base - tp);
  for (let k = 0; k * stepHours < base + stepHours; k++) { let acc = 0; const n = 20; for (let j = 0; j < n; j++) acc += tri(k * stepHours + (j + 0.5) * stepHours / n); out.push(acc / n); }
  return out;
}
export function routeHydrograph(effectiveMm, uh, extra = 6) {
  const out = Array(effectiveMm.length + uh.length + extra).fill(0);
  effectiveMm.forEach((q, i) => { if (q > 0) uh.forEach((u, k) => { out[i + k] += q * u; }); });
  return out;
}
export const hydrographStats = (q, stepHours = 1) => {
  const peak = Math.max(0, ...q), at = q.indexOf(peak);
  return {peak, peakHour: at * stepHours, volumeM3: sum(q) * stepHours * 3600};
};

// Pre-flood tidy-ups for hourly series from the forecast API.
export function hourlySeries(json) {
  const h = json?.hourly;
  if (!h?.time?.length || !Array.isArray(h.precipitation)) throw Error('Rain forecast response had no hourly values.');
  return {time: h.time, precip: h.precipitation.map(v => finite(v) ? Math.max(0, v) : null)};
}
// Split an hourly series into the past (up to `nowIso`, local time strings) and the future.
export function splitAtNow(series, nowLocal) {
  const i = series.time.findIndex(t => t > nowLocal);
  const at = i < 0 ? series.time.length : i;
  return {past: series.precip.slice(0, at), future: series.precip.slice(at), futureTime: series.time.slice(at)};
}

// Parsers for the user's own records. Rows with bad numbers are dropped and counted, never guessed.
export function parseCsv(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/[,;\t]/).map(c => c.trim()));
}
export function parseCrossSection(text) {
  const rows = parseCsv(text), points = [];
  let dropped = 0;
  for (const [d, z] of rows) { const x = Number(d), y = Number(z); if (finite(x) && finite(y) && d !== '' && z !== '' && z !== undefined) points.push([x, y]); else if (points.length || finite(x)) dropped++; }
  points.sort((a, b) => a[0] - b[0]);
  return {points, dropped};
}
export function parseGaugeRecord(text) {
  const rows = parseCsv(text), out = [];
  let dropped = 0;
  for (const [t, v] of rows) { const time = Date.parse(t), value = Number(v); if (Number.isFinite(time) && finite(value) && v !== '' && value >= 0) out.push({time, value}); else if (out.length || Number.isFinite(time)) dropped++; }
  out.sort((a, b) => a.time - b.time);
  return {records: out, dropped};
}
