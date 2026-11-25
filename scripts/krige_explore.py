"""Does kriging the station bias of ERA5-Land add anything once the height dependence is removed? (leave-one-station-out, downscaler/kriging.py)

    .venv-terrain/Scripts/python.exe scripts/krige_explore.py [--matrix downscaler/data/pmd_training_topo.parquet] [--min-days 365]

One number per station and target: the mean of (observed - ERA5-Land) daily maximum / minimum temperature, the correction an offline reanalysis grid for the high
mountains would have to carry. Each station is predicted from all the others (zero, the mean, a regression on height and the height difference to the ERA5-Land cell,
ordinary kriging of the raw biases, and regression plus kriging of what the regression leaves); the variogram and the regression are refitted without the station.
This is about the RAW reanalysis bias, not the residual of the 1 km models (their out-of-fold predictions are not saved). Screening only.
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
import kriging as K  # noqa: E402

BANDS = [('plains < 500 m', -1e9, 500), ('foothills 500-1500 m', 500, 1500), ('mountains > 1500 m', 1500, 1e9)]


def station_table(df, min_days):
    """One row per station: position, heights and the mean observed minus ERA5-Land bias of tmax and tmin (stations with at least min_days days of both)."""
    rows = []
    for sid, g in df.groupby('station_id'):
        ok = {t: g[t].notna() & g[f'era_{t}'].notna() for t in ('tmax', 'tmin')}
        if min(int(ok['tmax'].sum()), int(ok['tmin'].sum())) < min_days:
            continue
        rows.append(dict(station_id=sid, name=g.station_name.iloc[0], lat=g.lat.iloc[0], lon=g.lon.iloc[0], elev=g.station_elev.iloc[0], delta_z=g.delta_z.iloc[0],
                         n=int(min(ok['tmax'].sum(), ok['tmin'].sum())), **{f'bias_{t}': float((g.loc[ok[t], t] - g.loc[ok[t], f'era_{t}']).mean()) for t in ('tmax', 'tmin')}))
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--matrix', default=str(DS / 'data' / 'pmd_training_topo.parquet'))
    ap.add_argument('--min-days', type=int, default=365)
    a = ap.parse_args()
    t0 = time.time()
    df = pd.read_parquet(a.matrix, columns=['station_id', 'station_name', 'lat', 'lon', 'station_elev', 'delta_z', 'tmax', 'tmin', 'era_tmax', 'era_tmin'])
    tab = station_table(df, a.min_days)
    print(f'{len(tab)} stations with at least {a.min_days} days; mean bias tmax {tab.bias_tmax.mean():+.2f} degC (sd {tab.bias_tmax.std():.2f}), tmin {tab.bias_tmin.mean():+.2f} (sd {tab.bias_tmin.std():.2f})')
    X = tab[['elev', 'delta_z']].values
    for t in ('tmax', 'tmin'):
        y = tab[f'bias_{t}'].values
        p = K.loso_compare(tab.lat.values, tab.lon.values, X, y)
        print(f'\n{t}: leave-one-station-out RMSE of the predicted bias (degC); the bias itself has an rms of {np.sqrt(np.mean(y ** 2)):.2f}')
        header = f'  {"":24}{"n":>4}' + ''.join(f'{m:>20}' for m in K.METHODS)
        print(header)
        for name, lo, hi in [('all stations', -1e9, 1e9)] + BANDS:
            m = ((tab.elev >= lo) & (tab.elev < hi)).values
            if m.sum() < 3:
                continue
            print(f'  {name:24}{int(m.sum()):4d}' + ''.join(f'{np.sqrt(np.mean((p[k][m] - y[m]) ** 2)):20.2f}' for k in K.METHODS))
        e = p['regression'] - y
        worst = tab.assign(err=np.abs(p['regression+kriging'] - y)).sort_values('err', ascending=False).head(5)
        print('  largest errors of regression+kriging: ' + '; '.join(f'{r.name_} {r.err:.1f}' for r in worst.rename(columns={'name': 'name_'}).itertuples()))
        lags, gam, cnt = K.empirical_variogram(K.pair_distances(tab.lat.values, tab.lon.values), y - K.ols_fit_predict(X, y, X)[0], np.linspace(0, 600, 13))
        vg = K.fit_variogram(lags, gam, cnt)
        print(f'  variogram of what the regression leaves: nugget {vg["nugget"]:.2f}, partial sill {vg["psill"]:.2f}, range {vg["range_km"]:.0f} km '
              f'(nugget share of the sill {100 * vg["nugget"] / (vg["nugget"] + vg["psill"]):.0f} %)')
    print(f'\ndone in {time.time() - t0:.0f} s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
