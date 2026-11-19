// Quality control of live station readings (pure functions; rules in scripts/qc-rules.json, mirrored by scripts/obs_qc.py and tested against the same
// vectors, test/fixtures/qc-vectors.json). A reading is one value of one parameter of one station. Checks:
//   range     outside the physical limits of the rule file (world records)
//   dew_above_temperature   dew point above the air temperature by more than the tolerance
//   spatial   temperature far from the median of nearby stations once they are brought to this station's height with the lapse rate (needs enough
//             neighbours read around the same time); this catches stuck and solar-heated sensors that still look plausible on their own
//   spike     a jump since the previous reading that is larger than allowed, and not supported by the neighbours (or, with no neighbours, more than
//             hard_factor times the allowed jump)
//   stuck     the same value for hours of readings
// Flagged readings are not removed: callers keep them and mark them (see qcRealtime), and the 1 km downscaler leaves them out of the live bias and analysis.
import {readFileSync} from 'node:fs';

export const RULES = JSON.parse(readFileSync(new URL('./qc-rules.json', import.meta.url), 'utf8'));
const HOUR = 3600000, MAX_GAP_H = 3, RESET_RUNS = 3, KEEP_H = 48;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const finite = v => typeof v === 'number' && Number.isFinite(v);

// Expected value at (lat, lon, z) from the readings of other stations, or null. neighbours: readings of the same parameter that passed the range test.
export function spatialExpectation(r, neighbours, spec) {
  if (!spec || !finite(r.z) || !finite(r.time)) return null;
  const vals = [];
  for (const o of neighbours) {
    if (o.key === r.key || !finite(o.z) || !finite(o.time)) continue;
    if (Math.abs(o.time - r.time) > spec.window_min * 60000 || Math.abs(o.z - r.z) > spec.max_dz_m) continue;
    if (haversineKm(r.lat, r.lon, o.lat, o.lon) > spec.radius_km) continue;
    vals.push(o.value + spec.lapse_c_per_km * (o.z - r.z) / 1000);          // the neighbour's value at this station's height
  }
  if (vals.length < spec.min_neighbours) return null;
  const m = median(vals), scale = 1.4826 * median(vals.map(v => Math.abs(v - m)));
  return {expected: m, scale, n: vals.length, residual: r.value - m};
}

// readings: [{key, param, value, time (ms) or null, lat, lon, z (m) or null}]; state: {key: {param: {v, t, same_since, n_same, run}}} from the previous run.
// Returns {flags: {key: {param: [{rule, ...detail}]}}, state, summary}.
export function qcCheck(readings, {rules = RULES, state = {}} = {}) {
  const flags = {}, add = (r, rule, detail = {}) => { ((flags[r.key] ??= {})[r.param] ??= []).push({rule, ...detail}); };
  const live = readings.filter(r => finite(r.value) && rules.params[r.param]);
  const hasFlag = r => !!flags[r.key]?.[r.param]?.length;

  for (const r of live) {                                                                    // 1 range
    const [lo, hi] = rules.params[r.param].range;
    if (r.value < lo || r.value > hi) add(r, 'range', {value: r.value, range: [lo, hi]});
  }
  const byKey = new Map();                                                                   // 2 dew point above the air temperature
  for (const r of live) { if (!hasFlag(r)) (byKey.get(r.key) ?? byKey.set(r.key, {}).get(r.key))[r.param] = r; }
  const tol = rules.params.dew_point?.above_temperature;
  for (const g of byKey.values()) if (g.dew_point && g.temperature && finite(tol) && g.dew_point.value > g.temperature.value + tol)
    add(g.dew_point, 'dew_above_temperature', {value: g.dew_point.value, temperature: g.temperature.value});

  const spatial = new Map();                                                                 // 3 neighbourhood consistency (parameters with a spatial rule)
  for (const param of Object.keys(rules.params)) {
    const spec = rules.params[param].spatial;
    if (!spec) continue;
    const pool = live.filter(r => r.param === param && !hasFlag(r));
    for (const r of pool) {
      const e = spatialExpectation(r, pool, spec);
      if (!e) continue;
      spatial.set(r, e);
      if (Math.abs(e.residual) >= spec.min_residual && Math.abs(e.residual) >= spec.mad_factor * e.scale)
        add(r, 'spatial', {value: r.value, expected: +e.expected.toFixed(2), residual: +e.residual.toFixed(2), neighbours: e.n});
    }
  }

  const next = {};                                                                           // 4 step and stuck, and the state to carry
  for (const [key, params] of Object.entries(state)) next[key] = {...params};
  for (const r of live) {
    const spec = rules.params[r.param], prev = state[r.key]?.[r.param], t = r.time;
    let entry = prev ? {...prev} : null, advance = finite(t) && (!prev || t > prev.t);
    if (prev && advance) {
      const hours = (t - prev.t) / HOUR;
      if (spec.step && hours <= MAX_GAP_H) {
        const allowed = Math.max(spec.step.min_change, spec.step.per_hour * hours), change = Math.abs(r.value - prev.v);
        if (change > allowed) {
          const e = spatial.get(r), sp = spec.spatial;
          const unsupported = e && sp ? Math.abs(e.residual) >= sp.confirm_residual : !e && change > spec.step.hard_factor * allowed;
          if (unsupported) add(r, 'spike', {value: r.value, previous: prev.v, change: +change.toFixed(2), allowed: +allowed.toFixed(2), hours: +hours.toFixed(2)});
        }
      }
    }
    if (advance) {
      const same = prev && Math.abs(r.value - prev.v) < 1e-9;
      entry = {v: r.value, t, same_since: same ? prev.same_since : t, n_same: same ? prev.n_same + 1 : 1, run: 0};
      if (spec.stuck && same && t - entry.same_since >= spec.stuck.hours * HOUR && entry.n_same >= spec.stuck.min_readings)
        add(r, 'stuck', {value: r.value, hours: +((t - entry.same_since) / HOUR).toFixed(1), readings: entry.n_same});
      const blocking = (flags[r.key]?.[r.param] || []).some(f => f.rule === 'range' || f.rule === 'spike' || f.rule === 'spatial');
      if (blocking) {                                                                        // the old good value stays the reference, unless the new one has persisted
        const run = (prev?.run ?? 0) + 1, range = flags[r.key][r.param].some(f => f.rule === 'range');
        if (!prev) continue;                                                                 // nothing good to compare with yet
        entry = range || run < RESET_RUNS ? {...prev, run} : {...entry, run: 0};
      }
      (next[r.key] ??= {})[r.param] = entry;
    }
  }
  const latest = live.reduce((m, r) => finite(r.time) && r.time > m ? r.time : m, -Infinity);
  for (const [key, params] of Object.entries(next)) {                                        // forget what is old
    for (const [p, e] of Object.entries(params)) if (!finite(e.t) || latest - e.t > KEEP_H * HOUR) delete params[p];
    if (!Object.keys(params).length) delete next[key];
  }
  return {flags, state: next, summary: summarise(flags, live.length)};
}

export function summarise(flags, checked) {
  const byRule = {}, byParam = {};
  let flagged = 0;
  for (const params of Object.values(flags)) for (const [p, list] of Object.entries(params)) {
    flagged++; byParam[p] = (byParam[p] || 0) + 1;
    for (const f of list) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  }
  return {checked, flagged, by_rule: byRule, by_param: byParam};
}
export const isFlagged = (flags, key, param) => !!flags?.[key]?.[param]?.length;

// ---- realtime.json: columns of each parameter's value and of its own sync label (public/realtime/core.js PARAMS) ----
export const REALTIME_COLUMNS = {
  temperature: [5, 24], dew_point: [25, 32], humidity: [73, 80], pressure: [127, 162],
  wind_speed: [91, 161], wind_direction: [92, 161], rain_rate: [121, 161], rain_24h: [105, 161],
};
export function readingsFromRealtime(data, parseLabel, now) {
  const out = [];
  for (const s of data.stations || []) {
    if (!Array.isArray(s.v)) continue;
    const key = String(s.key ?? s.id ?? s.name), lat = s.map_lat ?? s.lat, lon = s.map_lon ?? s.lon;
    if (!finite(lat) || !finite(lon)) continue;
    for (const [param, [col, sync]] of Object.entries(REALTIME_COLUMNS)) {
      const value = s.v[col];
      if (!finite(value)) continue;
      const time = parseLabel(s.v[sync], now);
      out.push({key, param, value, time: finite(time) ? time : null, lat, lon, z: finite(s.elevation) ? s.elevation : null});
    }
  }
  return out;
}
// Runs the checks on a realtime.json document: marks each flagged station (`qc`: {parameter: [rule, ...]}), adds `data.qc` (summary) and returns
// {report, state}: report lists every flag with its details (the log that is kept), state is to be passed to the next run.
export function qcRealtime(data, {parseLabel, state = {}, now = Date.now(), rules = RULES} = {}) {
  const readings = readingsFromRealtime(data, parseLabel, now), res = qcCheck(readings, {rules, state});
  const byKey = new Map((data.stations || []).map(s => [String(s.key ?? s.id ?? s.name), s]));
  for (const s of data.stations || []) delete s.qc;
  const items = [];
  for (const [key, params] of Object.entries(res.flags)) {
    const s = byKey.get(key);
    s.qc = Object.fromEntries(Object.entries(params).map(([p, list]) => [p, list.map(f => f.rule)]));
    for (const [p, list] of Object.entries(params)) for (const f of list) items.push({station: s.name, key, network: s.network, parameter: p, ...f});
  }
  data.qc = {checked_at: new Date(now).toISOString(), rules_version: rules.version, ...res.summary};
  return {report: {checked_at: data.qc.checked_at, summary: res.summary, flags: items}, state: res.state};
}
