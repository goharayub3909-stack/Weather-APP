"""Non-PMD stations added to the training set: 1-minute WeatherWalay (Davis WeatherLink) exports turned into PMD-style daily values.

Daily values follow the PMD conventions the models are trained on:
  tmax(D): highest 'High Temp' over the PKT calendar day D
  tmin(D): lowest 'Low Temp' over the 24 h ending 08:00 PKT on D (when PMD reads its minimum thermometer)
  rain(D): 'Rain - mm' summed over the same 24 h ending 08:00 PKT
Logger gaps are frequent but short (median 42 min). A day counts when its 24 h window has at least half its minutes AND the hours when the
extreme happens are covered: at least 80% of the minutes and no gap over an hour in 10:00-18:00 PKT for the maximum and 02:00-08:00 PKT for
the minimum. Rain needs 90% of its window. Rain is left out on days whose window went below 0 degC: an
unheated tipping bucket does not measure snow when it falls (Shimshal logged 46.5 mm in a year that was mostly snow). A station with
use_rain=False gives no rain at all (Shimshal: the gauge was probably blocked at times, so its rain is not used).
"""
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

DESKTOP = Path(r'C:\Users\Dell-5580\Desktop')
MIN_DAY = 0.5               # share of a 24 h window's minutes that must be present
MIN_CRITICAL = 0.8          # share of the critical hours' minutes that must be present
MAX_GAP_MIN = 60            # longest gap allowed inside the critical hours
TMAX_HOURS, TMIN_HOURS = (10, 18), (2, 8)   # PKT hours when the daily maximum and minimum happen at the station
MIN_RAIN = 0.9              # share of the rain window's minutes that must be present
# (screening conventions)
FT = 0.3048

# files: name patterns on the Desktop (.zip or .csv WeatherLink exports). Positions are the ones WeatherWalay gave; the height is the 90 m
# GLO-90 terrain at that position (as WeatherWalay asked), filled in by 1_prepare_and_train.py. The height in an export's title
# ('(10150 ft)') is kept as title_elev, only as a check.
STATIONS = [
    dict(station_id='WW-SHIMSHAL', station_name='Shimshal Valley (WeatherWalay)', lat=36.43869, lon=75.32036, elev=None,
         network='WeatherWalay', use_rain=False, files=['Shimshal_Valley*.zip', 'Shimshal_Valley*.csv']),
    dict(station_id='WW-MURREE', station_name='Murree (WeatherWalay)', lat=33.91464, lon=73.40499, elev=None,
         network='WeatherWalay', use_rain=True, files=['*Murree*.zip', '*Murree*.csv']),
    dict(station_id='WW-NATHIAGALI', station_name='Nathia Gali (WeatherWalay)', lat=34.07024, lon=73.39324, elev=None,
         network='WeatherWalay', use_rain=True, files=['*Nathi*.zip', '*Nathi*.csv']),
    dict(station_id='WW-CHILAS', station_name='Chilas City (WeatherWalay)', lat=35.40947, lon=74.1046, elev=None,
         network='WeatherWalay', use_rain=True, files=['*Chilas*.zip', '*Chilas*.csv']),
]


def _open_csv(path):
    path = Path(path)
    if path.suffix.lower() == '.zip':
        z = zipfile.ZipFile(path)
        return z.open(next(n for n in z.namelist() if n.lower().endswith('.csv')))
    return open(path, 'rb')


def export_height_m(path):
    """Station height from a WeatherLink export's first line ('Shimshal Valley, GB (10150 ft)'), in metres, or None."""
    with _open_csv(path) as f:
        m = re.search(r'\((\d[\d,.]*)\s*(ft|m)\)', f.readline().decode('latin-1'))
    if not m:
        return None
    v = float(m.group(1).replace(',', ''))
    return v * FT if m.group(2) == 'ft' else v


TIME_FORMATS = ('%d-%m-%y %H:%M', '%d/%m/%y %I:%M %p')    # both seen in WeatherLink exports; day first ('17/11/26 11:07 AM')
MAX_RECORD_MIN = 30          # a record counts for at most this many minutes when coverage is measured


def _parse_times(s):
    for fmt in TIME_FORMATS:
        t = pd.to_datetime(s, format=fmt, errors='coerce')
        if t.notna().mean() > 0.99:
            return t
    raise ValueError(f'unknown WeatherLink time format, e.g. {s.iloc[0]!r}')


def read_davis(path):
    """A WeatherLink export (.csv, or a .zip holding one) -> records: time (PKT, naive, end of the archive interval), temp, thigh, tlow, rain.
    Archive intervals vary (1 min at Shimshal, 15 min at Murree); High / Low Temp hold the extremes inside each interval."""
    with _open_csv(path) as f:
        d = pd.read_csv(f, skiprows=5, encoding='latin-1', na_values=['--'], low_memory=False)
    col = lambda start: next(c for c in d.columns if c.startswith(start))
    out = pd.DataFrame(dict(time=_parse_times(d['Date & Time']),
                            temp=pd.to_numeric(d[col('Temp - ')], errors='coerce'),
                            thigh=pd.to_numeric(d[col('High Temp - ')], errors='coerce'),
                            tlow=pd.to_numeric(d[col('Low Temp - ')], errors='coerce'),
                            rain=pd.to_numeric(d[col('Rain - mm')], errors='coerce')))
    return out.dropna(subset=['time'])


def _covered(m, start, end, share=MIN_CRITICAL, gap=True):
    """Is [start, end) covered: the records' intervals (column 'dur', minutes) add up to at least share of it and (gap) no gap is longer
    than MAX_GAP_MIN (edges included)?"""
    sel = (m.index >= start) & (m.index < end)
    span = (end - start).total_seconds() / 60
    if m.dur.values[sel].sum() < share * span:
        return False
    if not gap:
        return True
    t = m.index[sel]
    sec = lambda x: np.asarray(x, dtype='datetime64[s]').astype(np.int64)      # explicit unit: pandas may store us or ns
    edges = np.concatenate([sec([start.to_datetime64()]), sec(t.values), sec([end.to_datetime64()])])
    return bool(np.diff(edges).max() / 60 <= MAX_GAP_MIN + 1)


def daily_from_minutes(m):
    """Minutes (several files may overlap: later rows win) -> date, tmax, tmin, rain with the PMD windows and coverage rules above."""
    m = m.sort_values('time').drop_duplicates('time', keep='last').set_index('time')
    step = m.index.to_series().diff().dt.total_seconds().div(60)
    m['dur'] = step.fillna(step.median()).clip(upper=MAX_RECORD_MIN).values   # minutes each record stands for
    idx = m.index
    rows = []
    H = pd.Timedelta(hours=1)
    for d in pd.date_range(idx.min().normalize() + pd.Timedelta(days=1), idx.max().normalize(), freq='D'):
        day = m[(idx >= d) & (idx < d + 24 * H)]                                  # PKT calendar day (maximum)
        win = m[(idx >= d - 16 * H) & (idx < d + 8 * H)]                           # 08:00 D-1 .. 08:00 D (minimum, rain)
        tmax = (day.thigh.max() if _covered(day, d, d + 24 * H, MIN_DAY, False) and _covered(day, d + TMAX_HOURS[0] * H, d + TMAX_HOURS[1] * H)
                else np.nan)
        tmin = (win.tlow.min() if _covered(win, d - 16 * H, d + 8 * H, MIN_DAY, False) and _covered(win, d + TMIN_HOURS[0] * H, d + TMIN_HOURS[1] * H)
                else np.nan)
        rain = win.rain.sum() if _covered(win, d - 16 * H, d + 8 * H, MIN_RAIN, False) and win.tlow.min() > 0 else np.nan
        if np.isfinite([tmax, tmin, rain]).any():
            rows.append(dict(date=d, tmax=tmax, tmin=tmin, rain=rain))
    return pd.DataFrame(rows, columns=['date', 'tmax', 'tmin', 'rain'])


def load_daily(desktop=DESKTOP):
    """-> (daily table station_id, station_name, date, tmax, tmin, rain; station list) for every station whose files exist."""
    frames, found = [], []
    for s in STATIONS:
        files = sorted({p for pat in s['files'] for p in desktop.glob(pat)})
        if not files:
            continue
        s = dict(s, files=[str(f) for f in files])
        s['title_elev'] = next((h for h in map(export_height_m, files) if h), None)
        s['elev_source'] = 'given' if s['elev'] is not None else 'GLO-90 at the given position'
        d = daily_from_minutes(pd.concat([read_davis(f) for f in files], ignore_index=True))
        if not s.get('use_rain', True):
            d['rain'] = np.nan
            d = d.dropna(subset=['tmax', 'tmin'], how='all')
        d.insert(0, 'station_name', s['station_name']); d.insert(0, 'station_id', s['station_id'])
        frames.append(d); found.append(s)
    return (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=['station_id', 'station_name', 'date', 'tmax', 'tmin', 'rain'])), found
