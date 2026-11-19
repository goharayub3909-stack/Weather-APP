"""1 km terrain predictors over Pakistan from the Copernicus GLO-90 DEM.

DEM: Copernicus DEM GLO-90 (ESA / Airbus, free for any use with attribution: "produced using Copernicus WorldDEM-90
(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
ESA"), read as Cloud Optimized GeoTIFF tiles from the AWS open-data bucket copernicus-dem-90m. Each 1 x 1 degree tile is
averaged to 0.01 degree cells (about 1.1 km north-south, 0.9-1.0 km east-west here). Tiles that do not exist are open sea.

Grid: BOX 60-78 E, 23-38 N, cell centres at 60.005 + 0.01 i (lon) and 37.995 - 0.01 j (lat), row 0 at the north.
"""
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy import ndimage

BOX = dict(west=60.0, east=78.0, south=23.0, north=38.0)
RES = 0.01
PER_DEG = round(1 / RES)                       # cells per degree
NX = round((BOX['east'] - BOX['west']) / RES)  # 1800
NY = round((BOX['north'] - BOX['south']) / RES)  # 1500
ERA_RES = 0.1                                   # ERA5-Land grid: points on multiples of 0.1 degree
M_PER_DEG = 111_320.0                           # metres per degree of latitude (spherical Earth, R = 6378.137 km)
TPI_WINDOW = 5                                  # 5 x 5 cells: the "5 km" Topographic Position Index
FEATURES = ['elevation', 'delta_z', 'slope_x', 'slope_y', 'tpi', 'aspect', 'coast_dist']

TILE_URL = ('https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/'
            'Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif')
# CPL_VSIL_CURL_NON_CACHED: GDAL otherwise remembers a failed request for the life of the process, so a retry could never succeed
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_MAX_RETRY='4',
                GDAL_HTTP_RETRY_DELAY='2', CPL_VSIL_CURL_NON_CACHED='/vsicurl/https://copernicus-dem-90m.s3.amazonaws.com/')


def tile_url(lat, lon):
    return TILE_URL.format(ns='N' if lat >= 0 else 'S', lat=abs(lat), ew='E' if lon >= 0 else 'W', lon=abs(lon))


def tile_of(lat, lon):
    """South-west corner of the GLO-90 tile to read a point from. Tile N35 spans 34.9996-35.9996 N (pixel-is-point), so a
    point at exactly 36.0 N belongs to N35, not N36."""
    return math.ceil(lat) - 1, math.floor(lon)


def lon_centres():
    return BOX['west'] + RES * (np.arange(NX) + 0.5)


def lat_centres():
    return BOX['north'] - RES * (np.arange(NY) + 0.5)


def cell_of(lat, lon):
    """(row, col) of the 1 km cell holding a point, or None outside the box."""
    j = int(math.floor((BOX['north'] - lat) / RES))
    i = int(math.floor((lon - BOX['west']) / RES))
    return (j, i) if 0 <= j < NY and 0 <= i < NX else None


_EXISTS = {}


def tile_exists(lat, lon, tries=5):
    """True when the GLO-90 tile exists, False when the bucket says it does not (open sea). Any other failure is retried and
    then raised: a network error must never turn a land tile into sea."""
    import urllib.error
    import urllib.request
    key = (lat, lon)
    if key not in _EXISTS:
        for k in range(tries):
            try:
                urllib.request.urlopen(urllib.request.Request(tile_url(lat, lon), method='HEAD'), timeout=60)
                _EXISTS[key] = True
                break
            except urllib.error.HTTPError as e:
                if e.code in (403, 404):
                    _EXISTS[key] = False
                    break
                if k == tries - 1:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if k == tries - 1:
                    raise
            time.sleep(2 * (k + 1))
    return _EXISTS[key]


def _with_tile(lat, lon, fn, tries=6):
    """fn(open dataset) for an existing tile, retried on read errors; None when the tile does not exist."""
    import rasterio
    if not tile_exists(lat, lon):
        return None
    for k in range(tries):
        try:
            with rasterio.Env(**GDAL_ENV), rasterio.open('/vsicurl/' + tile_url(lat, lon)) as src:
                return fn(src)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def _read_tile(lat, lon):
    from rasterio.enums import Resampling
    return _with_tile(lat, lon, lambda src: src.read(1, out_shape=(PER_DEG, PER_DEG), resampling=Resampling.average)
                      .astype(np.float32))


def build_dem(workers=16, log=print):
    """Mosaic of 1 km mean heights (m), NaN over open sea."""
    dem = np.full((NY, NX), np.nan, np.float32)
    jobs = [(lat, lon) for lat in range(int(BOX['south']), int(BOX['north'])) for lon in range(int(BOX['west']), int(BOX['east']))]
    with ThreadPoolExecutor(workers) as ex:
        for n, ((lat, lon), a) in enumerate(zip(jobs, ex.map(lambda t: _read_tile(*t), jobs)), 1):
            if a is not None:
                j0 = round((BOX['north'] - (lat + 1)) / RES)
                i0 = round((lon - BOX['west']) / RES)
                dem[j0:j0 + PER_DEG, i0:i0 + PER_DEG] = a
            if n % 40 == 0:
                log(f'  DEM tiles {n}/{len(jobs)}')
    return dem


def sample_points(points, workers=16):
    """Native 90 m GLO-90 height at each (lat, lon), NaN where there is no tile. A point on a whole degree of latitude is read
    from the tile south of it (tile_of), whose top row lies on that degree."""
    def one(p):
        lat, lon = p
        v = _with_tile(*tile_of(lat, lon), lambda src: float(next(src.sample([(lon, lat)]))[0]))
        return float('nan') if v is None else v
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, points))


def coarse_elevation(dem):
    """Mean height of each ERA5-Land 0.1 degree cell (centred on multiples of 0.1 degree), spread back to the 1 km cells it
    covers. The coarse model sees one height per cell; delta_z = elevation - this. Sea cells count as 0 m."""
    z = np.nan_to_num(dem, nan=0.0).astype(np.float64)
    ei = np.floor((lon_centres() - BOX['west']) / ERA_RES + 0.5).astype(int)     # ERA5-Land column of each 1 km column
    ej = np.floor((BOX['north'] - lat_centres()) / ERA_RES + 0.5).astype(int)    # ERA5-Land row of each 1 km row
    nI, nJ = ei.max() + 1, ej.max() + 1
    idx = ej[:, None] * nI + ei[None, :]
    sums = np.bincount(idx.ravel(), weights=z.ravel(), minlength=nI * nJ)
    cnts = np.bincount(idx.ravel(), minlength=nI * nJ)
    return (sums / np.maximum(cnts, 1))[idx].astype(np.float32)


def slopes(z):
    """dz/dx (east) and dz/dy (north) in m per m. Rows run north to south, so the row gradient is negated."""
    dy = RES * M_PER_DEG
    dx = dy * np.cos(np.radians(lat_centres()))[:, None]
    gj, gi = np.gradient(z.astype(np.float64))
    return (gi / dx).astype(np.float32), (-gj / dy).astype(np.float32)


def aspect_deg(sx, sy):
    """Direction the slope faces (downhill), degrees clockwise from north; 0 where the ground is exactly flat."""
    a = np.degrees(np.arctan2(-sx, -sy)) % 360
    return np.where((sx == 0) & (sy == 0), 0.0, a).astype(np.float32)


def tpi(z, window=TPI_WINDOW):
    """Height above the mean of the surrounding window x window cells (m): positive on ridges, negative in valleys."""
    return (z - ndimage.uniform_filter(z.astype(np.float64), size=window, mode='nearest')).astype(np.float32)


def sea_mask(dem):
    """Open sea: cells with no tile or height <= 0 that are connected to the southern edge of the box (Arabian Sea).
    Inland cells at or below 0 m are not sea."""
    low = np.isnan(dem) | (dem <= 0)
    lab, _ = ndimage.label(low)
    keep = np.unique(lab[-1][lab[-1] > 0])
    return np.isin(lab, keep)


def coast_distance_km(sea):
    """Great-circle distance (km) from each cell to the nearest sea cell (0 at sea). The nearest cell is found on the grid
    with east-west spacing scaled by cos(latitude) at 27 N, then the distance to it is computed exactly (haversine)."""
    dy = RES * M_PER_DEG / 1000
    _, (jj, ii) = ndimage.distance_transform_edt(~sea, sampling=(dy, dy * math.cos(math.radians(27))), return_indices=True)
    lat = lat_centres()[:, None]
    lon = lon_centres()[None, :]
    return haversine_km(lat, lon, lat_centres()[jj], lon_centres()[ii]).astype(np.float32)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def features(dem):
    """{name: 1 km array} for FEATURES (elevation in m, NaN at sea; slopes m/m; tpi m; aspect degrees; coast_dist km)."""
    z = np.nan_to_num(dem, nan=0.0)
    sx, sy = slopes(z)
    sea = sea_mask(dem)
    return dict(elevation=dem.astype(np.float32), delta_z=(z - coarse_elevation(dem)).astype(np.float32), slope_x=sx,
                slope_y=sy, tpi=tpi(z), aspect=aspect_deg(sx, sy), coast_dist=coast_distance_km(sea))


def at_points(feats, points):
    """Feature values in the 1 km cell of each (lat, lon) -> {name: list}."""
    cells = [cell_of(lat, lon) for lat, lon in points]
    return {k: [float(v[c]) if c else float('nan') for c in cells] for k, v in feats.items()}
