"""Add the multi-scale topographic features of downscaler/topo.py to a training matrix.

    .venv-terrain/Scripts/python.exe scripts/add_topo_features.py [--matrix downscaler/data/pmd_training_points.parquet] [--out downscaler/data/pmd_training_topo.parquet] [--force]

Static descriptors (tpi_3/9/25, rough_3/9/25, relpos_9/25, valley_depth_25, sky_view) are computed once over the whole 1 km grid and cached in
downscaler/data/topo_1km.npz (the forecast step can read the same file); each station takes the value of its 1 km cell. pot_rad_ratio depends on the
day, so it is computed per row from the station's latitude, its cell slope (slope_x, slope_y of the matrix) and the day of the year.
"""
import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DS = HERE.parent / 'downscaler'
sys.path.insert(0, str(DS))
import terrain  # noqa: E402
import topo  # noqa: E402

DATA = DS / 'data'


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def topo_grid(force=False):
    """{name: 1 km array} for topo.STATIC, from the cache when there is one."""
    cache = DATA / 'topo_1km.npz'
    if cache.exists() and not force:
        z = np.load(cache)
        if set(topo.STATIC) <= set(z.files):
            return {k: z[k] for k in topo.STATIC}
    t0 = time.time()
    dem = np.load(DATA / 'terrain_1km.npz')['elevation']
    feats = topo.static_features(dem)
    np.savez_compressed(cache, **feats)
    log(f'   topographic grid computed in {time.time() - t0:.0f} s -> {cache.name}')
    return feats


def add_topo(df, grid):
    """Copy of df with the static columns taken at each station's 1 km cell and pot_rad_ratio per row. Needs station_id, lat, lon, slope_x, slope_y, date."""
    df = df.copy()
    st = df.drop_duplicates('station_id')[['station_id', 'lat', 'lon']]
    cells = {r.station_id: terrain.cell_of(r.lat, r.lon) for r in st.itertuples()}
    for name in topo.STATIC:
        vals = {s: (float(grid[name][c]) if c else np.nan) for s, c in cells.items()}
        df[name] = df.station_id.map(vals).astype(float)
    df['pot_rad_ratio'] = topo.pot_rad_ratio(df.lat.values, df.slope_x.values, df.slope_y.values, df.date.dt.day_of_year.values)
    return df


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--matrix', default=str(DATA / 'pmd_training_points.parquet'))
    ap.add_argument('--out', default=str(DATA / 'pmd_training_topo.parquet'))
    ap.add_argument('--force', action='store_true', help='recompute the cached 1 km grid')
    a = ap.parse_args()
    t0 = time.time()
    df = pd.read_parquet(a.matrix)
    df['date'] = pd.to_datetime(df.date)
    log(f'matrix {Path(a.matrix).name}: {len(df):,} rows, {df.station_id.nunique()} stations')
    grid = topo_grid(a.force)
    out = add_topo(df, grid)
    out.to_parquet(a.out, index=False)
    cols = topo.STATIC + topo.DAILY
    log(f'wrote {a.out}: {len(out):,} rows; missing values per column: ' + ', '.join(f'{c} {int(out[c].isna().sum())}' for c in cols))
    s = out.drop_duplicates('station_id')
    print('\nStations (one value each), quartiles:')
    print(s[topo.STATIC].describe().loc[['min', '25%', '50%', '75%', 'max']].round(2).to_string(), flush=True)
    log(f'done in {time.time() - t0:.0f} s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
