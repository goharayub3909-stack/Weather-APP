"""Daily ERA5 / ERA5-Land predictors at station positions.

Two sources, one output table (station_id, date, era_tmax, era_tmin, era_precip, era_ssrd, era_u10, era_v10, era_elev):

* 'gee'  Google Earth Engine ECMWF/ERA5_LAND/DAILY_AGGR (ERA5-Land 0.1 degree, Copernicus licence: free for any use,
         commercial included, with attribution "Contains modified Copernicus Climate Change Service information"). Needs
         `pip install earthengine-api`, `earthengine authenticate` and a Cloud project (EE_PROJECT). Days are UTC days.
         This is the source for models meant for commercial use.

* 'openmeteo'  DEVELOPMENT ONLY. Open-Meteo's archive API: its ERA5-Land feed carries only 2 m temperature, so precipitation,
         radiation and wind come from ERA5 (0.25 degree), and u/v are rebuilt from the daily mean speed and the dominant
         direction. Open-Meteo's free API is for non-commercial use, so models trained on it are not commercially clean;
         re-run with --source gee before using them commercially. Local (PKT) days. elevation=nan turns off Open-Meteo's
         own height correction, so values are the raw grid cell's and era_elev is that cell's height.
"""
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

COLUMNS = ['era_tmax', 'era_tmin', 'era_precip', 'era_ssrd', 'era_u10', 'era_v10']
UNITS = dict(era_tmax='degC', era_tmin='degC', era_precip='mm/day', era_ssrd='MJ/m2/day', era_u10='m/s', era_v10='m/s',
             era_elev='m')

OM_URL = 'https://archive-api.open-meteo.com/v1/archive'
OM_DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'shortwave_radiation_sum',
            'wind_speed_10m_mean', 'wind_direction_10m_dominant']


def wind_uv(speed, direction_deg):
    """Meteorological direction (where the wind comes FROM, clockwise from north) -> (u east, v north) components."""
    r = np.radians(direction_deg)
    return -speed * np.sin(r), -speed * np.cos(r)


# ---- Open-Meteo (development only) ----
def _om_get(params, log, tries=12):
    url = OM_URL + '?' + urllib.parse.urlencode(params, safe=',')
    wait = 20
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')
            if e.code != 429:
                raise RuntimeError(f'Open-Meteo {e.code}: {body[:300]}') from e
            reason = body.lower()
            pause = 3600 if 'daily' in reason else 600 if 'hourly' in reason else wait
            log(f'  Open-Meteo rate limit ({body[:120].strip()}), waiting {pause} s')
            time.sleep(pause)
            wait = min(wait * 2, 300)
        except (urllib.error.URLError, TimeoutError) as e:
            log(f'  Open-Meteo network error {e}, retrying in {wait} s')
            time.sleep(wait)
            wait = min(wait * 2, 300)
    raise RuntimeError('Open-Meteo: too many retries')


def openmeteo_station(station_id, lat, lon, start, end, cache_dir, log=print):
    """One station's daily table (cached as JSON per station and period)."""
    cache = Path(cache_dir) / f'om_{station_id}_{start}_{end}.json'
    if cache.exists():
        d = json.loads(cache.read_text())
    else:
        d = _om_get(dict(latitude=f'{lat:.5f}', longitude=f'{lon:.5f}', start_date=start, end_date=end,
                         daily=','.join(OM_DAILY), models='era5_land,era5', timezone='Asia/Karachi', elevation='nan',
                         wind_speed_unit='ms'), log)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(d))
    day = d['daily']
    f = lambda k: np.array([np.nan if v is None else v for v in day[k]], dtype=float)
    # ERA5-Land 2 m temperature where present, else ERA5 (sea cells have no ERA5-Land value)
    tmax = np.where(np.isnan(f('temperature_2m_max_era5_land')), f('temperature_2m_max_era5'), f('temperature_2m_max_era5_land'))
    tmin = np.where(np.isnan(f('temperature_2m_min_era5_land')), f('temperature_2m_min_era5'), f('temperature_2m_min_era5_land'))
    u, v = wind_uv(f('wind_speed_10m_mean_era5'), f('wind_direction_10m_dominant_era5'))
    return pd.DataFrame(dict(station_id=station_id, date=pd.to_datetime(day['time']), era_tmax=tmax, era_tmin=tmin,
                             era_precip=f('precipitation_sum_era5'), era_ssrd=f('shortwave_radiation_sum_era5'),
                             era_u10=u, era_v10=v, era_elev=float(d.get('elevation', np.nan))))


# ---- Google Earth Engine (commercially clean ERA5-Land) ----
GEE_BANDS = dict(era_tmax='temperature_2m_max', era_tmin='temperature_2m_min', era_precip='total_precipitation_sum',
                 era_ssrd='surface_solar_radiation_downwards_sum', era_u10='u_component_of_wind_10m',
                 era_v10='v_component_of_wind_10m')


# ERA5-Land's native 0.1 degree grid in Earth Engine (cell centres on multiples of 0.1 degree). Sampling on it reads the
# cell that holds the station; getRegion with scale=11132 instead resamples to a grid offset by half a cell.
GEE_GRID = [0.1, 0, -180.05, 0, -0.1, 90.05]


def gee_available():
    try:
        import ee
        ee.Initialize(project=os.environ.get('EE_PROJECT'))
        return True
    except Exception:
        return False


def _gee_year(station_id, lat, lon, year, cache_dir, log):
    """One calendar year of ERA5-Land daily values at a station (the 0.1 degree cell holding it), cached as gee_<station>_<year>.csv.
    A past year is fetched once; the current year again when its file is older than a day (DAILY_AGGR lags real time by about a week)."""
    cache = Path(cache_dir) / f'gee_{station_id}_{year}.csv'
    if cache.exists() and (year < pd.Timestamp.now().year or time.time() - cache.stat().st_mtime < 86400):
        return pd.read_csv(cache, parse_dates=['date'])
    import ee
    pt = ee.Geometry.Point([lon, lat])
    col = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR').filterDate(f'{year}-01-01', f'{year + 1}-01-01')
    for k in range(5):
        try:
            rows = col.select(list(GEE_BANDS.values())).getRegion(pt, None, 'EPSG:4326', GEE_GRID).getInfo()
            break
        except ee.EEException as e:                 # quota / transient: back off and retry
            if k == 4:
                raise
            log(f'  Earth Engine {station_id} {year}: {e}; retrying')
            time.sleep(10 * (k + 1))
    df = pd.DataFrame(rows[1:], columns=rows[0])
    out = pd.DataFrame(dict(station_id=station_id, date=pd.to_datetime(df['time'], unit='ms').dt.normalize()))
    for k, band in GEE_BANDS.items():
        out[k] = pd.to_numeric(df[band].values, errors='coerce')
    out['era_tmax'] -= 273.15
    out['era_tmin'] -= 273.15
    out['era_precip'] *= 1000.0
    out['era_ssrd'] /= 1e6
    out['era_elev'] = np.nan
    cache.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(cache, index=False)
    return out


def gee_station(station_id, lat, lon, start, end, cache_dir, log=print):
    """One station's daily ERA5-Land table from Earth Engine between start and end (inclusive, 'YYYY-MM-DD'), assembled from yearly cache files.
    Units converted: K -> degC, m -> mm, J/m2 -> MJ/m2. era_elev is not in DAILY_AGGR and is left NaN."""
    frames = [_gee_year(station_id, lat, lon, y, cache_dir, log) for y in range(int(start[:4]), int(end[:4]) + 1)]
    out = pd.concat(frames, ignore_index=True)
    return out[(out.date >= pd.Timestamp(start)) & (out.date <= pd.Timestamp(end))].reset_index(drop=True)


def fetch(stations, start, end, source, cache_dir, log=print, workers=8):
    """stations: DataFrame(station_id, lat, lon[, start, end]): a station's own start / end, when given, replace the common ones.
    -> long daily table for all of them, plus the source used.
    Earth Engine requests run `workers` at a time (one per station-year); Open-Meteo ones one at a time (rate limits)."""
    from concurrent.futures import ThreadPoolExecutor
    if source == 'auto':
        source = 'gee' if gee_available() else 'openmeteo'
    one = gee_station if source == 'gee' else openmeteo_station
    rows = list(stations.itertuples(index=False))
    frames = []
    with ThreadPoolExecutor(workers if source == 'gee' else 1) as ex:
        jobs = ex.map(lambda r: one(r.station_id, r.lat, r.lon, getattr(r, 'start', start), getattr(r, 'end', end), cache_dir, log), rows)
        for n, f in enumerate(jobs, 1):
            frames.append(f)
            if n % 10 == 0 or n == len(rows):
                log(f'  ERA5 ({source}) {n}/{len(rows)} stations')
    return pd.concat(frames, ignore_index=True), source
