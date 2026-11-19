"""Training matrix with cape_max only, for the CAPE ablation of the v2 training (no pressure-level data needed).

Takes downscaler/data/pmd_training.parquet and fills `cape_max` (daily maximum of the 3-hourly ERA5 CAPE, UTC day, 0.25 degree cell nearest the
station) from the single-level downloads downscaler/data/era5_upper/raw/sl_<year>.nc. Writes downscaler/data/pmd_training_cape.parquet; the
original matrix is not touched. Years whose CAPE file has not arrived keep NaN (train_downscaler_v2.py --ablation cape drops those rows).
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pull_era5_upper_air as UA  # noqa: E402

DATA = HERE.parent / 'downscaler' / 'data'


def main():
    df = pd.read_parquet(DATA / 'pmd_training.parquet')
    df['date'] = pd.to_datetime(df.date)
    st = df.drop_duplicates('station_id')[['station_id', 'lat', 'lon']]
    st = st.assign(glat=(st.lat / 0.25).round() * 0.25, glon=(st.lon / 0.25).round() * 0.25)
    parts, years = [], []
    for year in sorted(df.date.dt.year.unique()):
        f = UA.raw_file('sl', int(year))
        if not f.exists():
            continue
        ds = xr.open_dataset(f)
        t = UA._dim(ds, ('valid_time', 'time'))
        times = pd.to_datetime(ds[t].values)
        lat, lon = ds['latitude'].values, ds['longitude'].values
        a = ds['cape'].transpose(t, 'latitude', 'longitude').values
        dates, cape = UA.daily(a, times, 'max')
        ds.close()
        iy = np.abs(lat[None, :] - st.glat.values[:, None]).argmin(1)
        ix = np.abs(lon[None, :] - st.glon.values[:, None]).argmin(1)
        for k, sid in enumerate(st.station_id):
            parts.append(pd.DataFrame({'station_id': sid, 'date': dates, 'cape_new': cape[:, iy[k], ix[k]]}))
        years.append(int(year))
    cape = pd.concat(parts, ignore_index=True)
    df = df.merge(cape, on=['station_id', 'date'], how='left')
    df['cape_max'] = df.pop('cape_new').astype(np.float32)
    df.to_parquet(DATA / 'pmd_training_cape.parquet', index=False)
    have = df.cape_max.notna()
    print(f'cape_max on {have.mean():.0%} of {len(df):,} rows; years {years}; per year: {df[have].groupby(df.date.dt.year).size().to_dict()}')
    print(f'cape_max summary: min {df.cape_max.min():.0f} median {df.cape_max.median():.0f} max {df.cape_max.max():.0f} J/kg')


if __name__ == '__main__':
    main()
