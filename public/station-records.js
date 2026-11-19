// One place that turns a WeatherWalay realtime record (all 178 columns, see public/realtime/core.js) into the compact station shape the
// portal's logic uses (current conditions, climate, the airports map, the station archive). realtime.json is the only source of stations,
// sensors and rain gauges; everything else is derived from it here, in the browser and in the sync scripts alike.
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const PKT_MS = 5 * 3600000;
const pktIso = ms => new Date(ms + PKT_MS).toISOString().slice(0, 19) + '+05:00';

// A yearless provider label ("07:20 pm, 17 October") is aligned to the feed's own timestamp only
// within a 48 h window; anything else stays undated so an old report can never look fresh.
export function observationTime(raw, feedTime) {
  if (typeof raw !== 'string') return [null, null];
  if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? [new Date(t).toISOString(), 'Explicit provider timestamp'] : [null, null];
  }
  if (typeof feedTime !== 'string') return [null, null];
  const anchor = Date.parse(feedTime), m = /^(\d{1,2}):(\d{2}) (AM|PM), (\d{1,2}) ([A-Z]+)$/.exec(raw.trim().toUpperCase());
  if (!Number.isFinite(anchor) || !m) return [null, null];
  const hour = Number(m[1]), minute = Number(m[2]), day = Number(m[4]), month = MONTHS.indexOf(m[5]);
  if (month < 0 || hour < 1 || hour > 12 || minute > 59) return [null, null];
  const hour24 = hour % 12 + (m[3] === 'PM' ? 12 : 0), anchorYear = new Date(anchor + PKT_MS).getUTCFullYear();
  for (const year of [anchorYear, anchorYear - 1, anchorYear + 1]) {
    const local = Date.UTC(year, month, day, hour24, minute);
    if (new Date(local).getUTCMonth() !== month) return [null, null];            // 31 February and the like
    const stamp = local - PKT_MS, diff = (anchor - stamp) / 1000;
    if (diff >= -300 && diff <= 48 * 3600) return [pktIso(stamp), 'PKT interpretation; year aligned to feed timestamp'];
  }
  return [null, null];
}

// row: the 178 columns in natural order. pos: {lat, lon} to use instead of columns 2 and 3 (the feed has one pair swapped). Returns null for
// a station that is outside the portal's area, has no usable position or name, or belongs to a neighbouring country's IMD network.
export function slimStation(row, feedTime, pos = null, elevation = null) {
  const lat = num(pos?.lat ?? row[2], 23, 38), lon = num(pos?.lon ?? row[3], 60, 78);
  if (lat === null || lon === null || typeof row[1] !== 'string') return null;
  const source = String(row[4] ?? '').slice(0, 40), pmd = source.toUpperCase() === 'PMD';
  if (source.toUpperCase().includes('IMD')) return null;
  const rawTime = typeof row[161] === 'string' ? row[161] : null, [observedAt, basis] = observationTime(rawTime, feedTime);
  return {
    id: String(row[0] ?? `${row[1]}|${row[2]}|${row[3]}`).slice(0, 120), name: row[1].slice(0, 120), lat, lon, network: source, elevation: Number.isFinite(elevation) ? elevation : null,
    temperature: num(row[5], -90, 65), humidity: num(row[73], 0, 100), wind_speed: num(row[91], 0, 500), wind_direction: num(row[92], 0, 360),
    wind_gust_10min: num(row[95], 0, 500), dew_point: num(row[25], -100, 65), wet_bulb: num(row[33], -90, 65), heat_index: num(row[41], -100, 90),
    wind_chill: num(row[49], -120, 70), solar_radiation: num(row[86], 0, 2000), uv_index: num(row[81], 0, 30),
    visibility: row.length > 164 ? num(row[164], 0, 200000) : null, pressure: num(row[127], 300, 1100),
    rain_24h: num(row[105], 0, 5000), rain_daily: num(row[106], 0, 5000), rain_monthly: num(row[107], 0, 30000), rain_yearly: num(row[108], 0, 100000),
    rain_monsoon: num(row[109], 0, 30000), rain_rate: num(row[121], 0, 3000), rain_rate_instant: num(row[122], 0, 3000), rain_rate_max: num(row[123], 0, 3000),
    rain_rate_max_label: row[124] !== null && row[124] !== undefined ? String(row[124]).slice(0, 100) : null,
    rain_daily_period: pmd ? '02:00–02:00 PKT (provider day)' : '00:00–00:00 PKT (provider day)',
    rain_24h_period: pmd ? '08:00–08:00 PKT' : '24 hours before station sync',
    rain_24h_observed_label: pmd && row[13] !== null && row[13] !== undefined ? String(row[13]).slice(0, 100) : rawTime,
    observed_time_basis: basis, observed_at: observedAt, observed_label: rawTime ? rawTime.slice(0, 100) : null,
  };
}

// The portal's compact feed, derived from a realtime.json document. Same shape the portal has always read, plus each station's elevation.
export function slimFromRealtime(realtime) {
  const stations = [];
  for (const s of realtime?.stations || []) {
    if (!Array.isArray(s.v)) continue;
    const slim = slimStation(s.v, realtime.last_update, {lat: s.map_lat ?? s.lat, lon: s.map_lon ?? s.lon}, s.elevation);
    if (slim) stations.push(slim);
  }
  return {source: 'WeatherWalay realtime', retrieved_at: realtime?.retrieved_at, last_update: realtime?.last_update ?? null, status: 'updated', stations};
}
