"""Quality control of live station readings, the Python twin of scripts/obs-qc.mjs (same rules file scripts/qc-rules.json, same vectors in
test/fixtures/qc-vectors.json, tested by downscaler/tests/test_obs_qc.py and test/obs-qc.test.js). Pure functions; see obs-qc.mjs for the checks.

A reading is a dict(key, param, value, time (ms since the epoch) or None, lat, lon, z (m) or None). qc_check returns (flags, state, summary):
flags {key: {param: [dict(rule, ...)]}}, state to pass to the next run, summary counts.
"""
import json
import math
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent / 'qc-rules.json').read_text(encoding='utf-8'))
HOUR = 3600000
MAX_GAP_H, RESET_RUNS, KEEP_H = 3, 3, 48


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def haversine_km(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    d_lat, d_lon = (lat2 - lat1) * r, (lon2 - lon1) * r
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin(d_lon / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(a)))


def median(a):
    s = sorted(a)
    n = len(s)
    return s[(n - 1) // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def spatial_expectation(r, neighbours, spec):
    """dict(expected, scale, n, residual) from the other stations' readings brought to this station's height, or None."""
    if not spec or not finite(r.get('z')) or not finite(r.get('time')):
        return None
    vals = []
    for o in neighbours:
        if o['key'] == r['key'] or not finite(o.get('z')) or not finite(o.get('time')):
            continue
        if abs(o['time'] - r['time']) > spec['window_min'] * 60000 or abs(o['z'] - r['z']) > spec['max_dz_m']:
            continue
        if haversine_km(r['lat'], r['lon'], o['lat'], o['lon']) > spec['radius_km']:
            continue
        vals.append(o['value'] + spec['lapse_c_per_km'] * (o['z'] - r['z']) / 1000)
    if len(vals) < spec['min_neighbours']:
        return None
    m = median(vals)
    return dict(expected=m, scale=1.4826 * median([abs(v - m) for v in vals]), n=len(vals), residual=r['value'] - m)


def _r2(x):
    return round(x, 2)


def qc_check(readings, rules=None, state=None):
    rules = rules or RULES
    state = state or {}
    flags = {}

    def add(r, rule, **detail):
        flags.setdefault(r['key'], {}).setdefault(r['param'], []).append(dict(rule=rule, **detail))

    has_flag = lambda r: bool(flags.get(r['key'], {}).get(r['param']))
    live = [r for r in readings if finite(r.get('value')) and r['param'] in rules['params']]

    for r in live:                                                                     # 1 range
        lo, hi = rules['params'][r['param']]['range']
        if r['value'] < lo or r['value'] > hi:
            add(r, 'range', value=r['value'], range=[lo, hi])
    by_key = {}                                                                        # 2 dew point above the air temperature
    for r in live:
        if not has_flag(r):
            by_key.setdefault(r['key'], {})[r['param']] = r
    tol = rules['params'].get('dew_point', {}).get('above_temperature')
    for g in by_key.values():
        if 'dew_point' in g and 'temperature' in g and finite(tol) and g['dew_point']['value'] > g['temperature']['value'] + tol:
            add(g['dew_point'], 'dew_above_temperature', value=g['dew_point']['value'], temperature=g['temperature']['value'])

    spatial = {}                                                                       # 3 neighbourhood consistency
    for param, spec_all in rules['params'].items():
        spec = spec_all.get('spatial')
        if not spec:
            continue
        pool = [r for r in live if r['param'] == param and not has_flag(r)]
        for r in pool:
            e = spatial_expectation(r, pool, spec)
            if not e:
                continue
            spatial[id(r)] = e
            if abs(e['residual']) >= spec['min_residual'] and abs(e['residual']) >= spec['mad_factor'] * e['scale']:
                add(r, 'spatial', value=r['value'], expected=_r2(e['expected']), residual=_r2(e['residual']), neighbours=e['n'])

    nxt = {k: dict(v) for k, v in state.items()}                                       # 4 step and stuck, and the state to carry
    for r in live:
        spec, prev, t = rules['params'][r['param']], state.get(r['key'], {}).get(r['param']), r.get('time')
        entry = dict(prev) if prev else None
        advance = finite(t) and (prev is None or t > prev['t'])
        if prev and advance:
            hours = (t - prev['t']) / HOUR
            if spec.get('step') and hours <= MAX_GAP_H:
                allowed = max(spec['step']['min_change'], spec['step']['per_hour'] * hours)
                change = abs(r['value'] - prev['v'])
                if change > allowed:
                    e, sp = spatial.get(id(r)), spec.get('spatial')
                    unsupported = abs(e['residual']) >= sp['confirm_residual'] if (e and sp) else (e is None and change > spec['step']['hard_factor'] * allowed)
                    if unsupported:
                        add(r, 'spike', value=r['value'], previous=prev['v'], change=_r2(change), allowed=_r2(allowed), hours=_r2(hours))
        if advance:
            same = prev is not None and abs(r['value'] - prev['v']) < 1e-9
            entry = dict(v=r['value'], t=t, same_since=prev['same_since'] if same else t, n_same=prev['n_same'] + 1 if same else 1, run=0)
            stuck = spec.get('stuck')
            if stuck and same and t - entry['same_since'] >= stuck['hours'] * HOUR and entry['n_same'] >= stuck['min_readings']:
                add(r, 'stuck', value=r['value'], hours=round((t - entry['same_since']) / HOUR, 1), readings=entry['n_same'])
            mine = flags.get(r['key'], {}).get(r['param'], [])
            if any(f['rule'] in ('range', 'spike', 'spatial') for f in mine):          # the old good value stays the reference, unless the new one has persisted
                if prev is None:
                    continue
                run = prev.get('run', 0) + 1
                entry = dict(prev, run=run) if (any(f['rule'] == 'range' for f in mine) or run < RESET_RUNS) else dict(entry, run=0)
            nxt.setdefault(r['key'], {})[r['param']] = entry
    times = [r['time'] for r in live if finite(r.get('time'))]
    latest = max(times) if times else -math.inf
    for key in list(nxt):                                                              # forget what is old
        for p in list(nxt[key]):
            if not finite(nxt[key][p].get('t')) or latest - nxt[key][p]['t'] > KEEP_H * HOUR:
                del nxt[key][p]
        if not nxt[key]:
            del nxt[key]
    return flags, nxt, summarise(flags, len(live))


def summarise(flags, checked):
    by_rule, by_param, flagged = {}, {}, 0
    for params in flags.values():
        for p, items in params.items():
            flagged += 1
            by_param[p] = by_param.get(p, 0) + 1
            for f in items:
                by_rule[f['rule']] = by_rule.get(f['rule'], 0) + 1
    return dict(checked=checked, flagged=flagged, by_rule=by_rule, by_param=by_param)


def is_flagged(row, param):
    """True when a station or METAR row (with a `qc` mark written by the sync) has a flag on this parameter."""
    return bool((row.get('qc') or {}).get(param))


# ---- METAR rows and realtime.json neighbours (the twin of obs-qc.mjs's readingsFromRealtime) ----
KT_TO_KMH = 1.852
METAR_FIELDS = (('temperature', 'temp', 1), ('dew_point', 'dewp', 1), ('pressure', 'altim', 1), ('wind_speed', 'wspd', KT_TO_KMH), ('wind_direction', 'wdir', 1))
REALTIME_TEMPERATURE = (5, 24)             # temperature value and its own sync label (public/realtime/core.js PARAMS)
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']


def metar_readings(rows):
    """METAR rows -> readings. obsTime is in seconds, wspd in knots, altim in hPa, elev in metres; a variable wind direction ('VRB') is not a number and is skipped."""
    out = []
    for s in rows:
        key, t, lat, lon = s.get('icaoId'), s.get('obsTime'), s.get('lat'), s.get('lon')
        if not key or not finite(t) or not finite(lat) or not finite(lon):
            continue
        z = s.get('elev')
        for param, field, scale in METAR_FIELDS:
            v = s.get(field)
            if finite(v):
                out.append(dict(key=key, param=param, value=v * scale, time=t * 1000, lat=lat, lon=lon, z=z if finite(z) else None))
    return out


def parse_pkt_label(label, now_ms):
    """'05:20 pm, 17 November' (PKT, no year) -> ms since the epoch, the most recent year that is not more than an hour in the future; None if unreadable."""
    import datetime as dt
    import re
    m = re.match(r'\s*(\d{1,2}):(\d{2})\s*([ap]m)\s*,\s*(\d{1,2})\s+([A-Za-z]+)', str(label or ''), re.I)
    if not m or m.group(5).lower() not in MONTHS:
        return None
    hh = int(m.group(1)) % 12 + (12 if m.group(3).lower() == 'pm' else 0)
    pkt = dt.timezone(dt.timedelta(hours=5))
    year = dt.datetime.fromtimestamp(now_ms / 1000, dt.timezone.utc).year
    for y in (year, year - 1):
        try:
            t = dt.datetime(y, MONTHS.index(m.group(5).lower()) + 1, int(m.group(4)), hh, int(m.group(2)), tzinfo=pkt).timestamp() * 1000
        except ValueError:
            continue
        if t <= now_ms + 3600000:
            return t
    return None


def realtime_temperature_neighbours(data, now_ms):
    """Temperature readings of realtime.json stations that carry no QC flag, keyed 'rt:<key>', to judge METAR temperatures against."""
    out = []
    col, sync = REALTIME_TEMPERATURE
    for s in data.get('stations', []):
        v = s.get('v')
        if not isinstance(v, list) or len(v) <= sync or not finite(v[col]) or is_flagged(s, 'temperature'):
            continue
        lat, lon, z = s.get('map_lat', s.get('lat')), s.get('map_lon', s.get('lon')), s.get('elevation')
        t = parse_pkt_label(v[sync], now_ms)
        if finite(lat) and finite(lon) and finite(z) and t is not None:
            out.append(dict(key='rt:' + str(s.get('key', s.get('id', s.get('name')))), param='temperature', value=v[col], time=t, lat=lat, lon=lon, z=z))
    return out


def qc_metar(rows, state=None, neighbours=None, rules=None):
    """Marks METAR rows in place (`qc`: {parameter: [rule, ...]}, only when flagged; values are kept) and returns (report, state).
    neighbours: extra temperature readings (realtime_temperature_neighbours) used only to judge the METARs; their own state and flags are dropped."""
    readings = metar_readings(rows)
    flags, nxt, summary = qc_check(readings + (neighbours or []), rules=rules, state=state)
    flags = {k: v for k, v in flags.items() if not k.startswith('rt:')}
    nxt = {k: v for k, v in nxt.items() if not k.startswith('rt:')}
    items = []
    for s in rows:
        s.pop('qc', None)
        got = flags.get(s.get('icaoId'))
        if got:
            s['qc'] = {p: [f['rule'] for f in lst] for p, lst in got.items()}
            items.extend(dict(station=s['icaoId'], parameter=p, **f) for p, lst in got.items() for f in lst)
    summary = summarise(flags, sum(1 for r in readings if r['param'] in (rules or RULES)['params']))
    return dict(summary=summary, flags=items), nxt
