"""Ordinary kriging of station residuals (pure NumPy / SciPy, tested in tests/test_kriging.py).

Used by scripts/krige_explore.py to ask one question: once the height dependence of a station bias is removed, is there spatial structure left that kriging can
carry to places without a station? Distances are great-circle kilometres. One exponential variogram model,
    gamma(h) = nugget + psill (1 - exp(-3 h / range))   for h > 0,   gamma(0) = 0
(range = the distance at which about 95 % of the sill is reached). The ordinary kriging system is solved per target point:
    [ Gamma  1 ] [ w  ]   [ gamma0 ]
    [ 1'     0 ] [ mu ] = [ 1      ]          estimate = w . z, variance = w . gamma0 + mu
"""
import numpy as np
from scipy import optimize


def distance_km(lat1, lon1, lat2, lon2):
    """Great-circle distance, broadcasting."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(np.asarray(lon2) - lon1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def pair_distances(lat, lon):
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    return distance_km(lat[:, None], lon[:, None], lat[None, :], lon[None, :])


def model(h, nugget, psill, range_km):
    """Exponential variogram, gamma(0) = 0."""
    h = np.asarray(h, float)
    return np.where(h > 0, nugget + psill * (1.0 - np.exp(-3.0 * h / range_km)), 0.0)


def empirical_variogram(dist, values, edges):
    """Semivariance of the pairs in each distance bin: (mean lag, gamma = mean of 0.5 (zi - zj)^2, number of pairs). Empty bins are dropped."""
    z = np.asarray(values, float)
    iu = np.triu_indices(len(z), 1)
    d, g = dist[iu], 0.5 * (z[:, None] - z[None, :])[iu] ** 2
    lags, gam, cnt = [], [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (d > lo) & (d <= hi)
        if m.sum() >= 1:
            lags.append(d[m].mean()); gam.append(g[m].mean()); cnt.append(int(m.sum()))
    return np.array(lags), np.array(gam), np.array(cnt)


def fit_variogram(lags, gamma, counts, max_range_km=None):
    """Weighted least squares fit of nugget, partial sill and range (weights = pairs per bin / lag, favouring the short lags). -> dict(nugget, psill, range_km)."""
    lags, gamma, counts = (np.asarray(x, float) for x in (lags, gamma, counts))
    top = float(gamma.max()) if len(gamma) else 1.0
    hi = max_range_km or 2.0 * float(lags.max())
    w = np.sqrt(counts / np.maximum(lags, 1e-9))
    best = None
    for r0 in (hi * 0.1, hi * 0.3, hi * 0.6):                                       # a few starts: the range is the awkward parameter
        res = optimize.least_squares(lambda p: w * (model(lags, p[0], p[1], p[2]) - gamma), [0.2 * top, 0.8 * top, r0],
                                     bounds=([0.0, 1e-12, 1.0], [top * 2 + 1e-9, top * 4 + 1e-9, hi]))
        if best is None or res.cost < best.cost:
            best = res
    return dict(nugget=float(best.x[0]), psill=float(best.x[1]), range_km=float(best.x[2]))


def ordinary_kriging(lat, lon, values, tlat, tlon, vg):
    """Estimate and kriging variance at target points from known points. -> (estimate, variance) arrays. A target on a known point gets its value back when the nugget is 0."""
    z = np.asarray(values, float)
    n = len(z)
    G = model(pair_distances(lat, lon), vg['nugget'], vg['psill'], vg['range_km'])
    A = np.ones((n + 1, n + 1)); A[:n, :n] = G; A[n, n] = 0.0
    tlat, tlon = np.atleast_1d(np.asarray(tlat, float)), np.atleast_1d(np.asarray(tlon, float))
    g0 = model(distance_km(np.asarray(lat, float)[:, None], np.asarray(lon, float)[:, None], tlat[None, :], tlon[None, :]), vg['nugget'], vg['psill'], vg['range_km'])
    rhs = np.vstack([g0, np.ones((1, len(tlat)))])
    sol = np.linalg.lstsq(A, rhs, rcond=None)[0]
    w, mu = sol[:n], sol[n]
    return w.T @ z, np.maximum((w * g0).sum(axis=0) + mu, 0.0)


def leave_one_out(lat, lon, values, vg):
    """Estimate at each known point from all the others (no refit of the variogram): array of estimates."""
    lat, lon, z = np.asarray(lat, float), np.asarray(lon, float), np.asarray(values, float)
    out = np.empty(len(z))
    for i in range(len(z)):
        k = np.arange(len(z)) != i
        out[i] = ordinary_kriging(lat[k], lon[k], z[k], lat[i], lon[i], vg)[0][0]
    return out


# ---- leave-one-station-out comparison of ways to carry a station bias to a place without a station ----
METHODS = ('zero', 'mean', 'regression', 'kriging', 'regression+kriging')


def ols_fit_predict(x_train, y_train, x_test):
    """Least squares line (with intercept) on the columns of x; -> (fitted values at the training rows, predictions at the test rows)."""
    A = np.column_stack([np.ones(len(x_train)), x_train])
    beta = np.linalg.lstsq(A, y_train, rcond=None)[0]
    return A @ beta, np.column_stack([np.ones(len(x_test)), x_test]) @ beta


def _krige_or_mean(lat, lon, z, tlat, tlon, edges):
    """Kriged estimate with a variogram fitted to z; the mean of z when no variogram can be fitted (too few or degenerate pairs)."""
    try:
        lags, gam, cnt = empirical_variogram(pair_distances(lat, lon), z, edges)
        if len(lags) < 3 or not np.isfinite(gam).all() or gam.max() <= 0:
            return float(np.mean(z))
        return float(ordinary_kriging(lat, lon, z, tlat, tlon, fit_variogram(lags, gam, cnt))[0][0])
    except (np.linalg.LinAlgError, ValueError):
        return float(np.mean(z))


def loso_compare(lat, lon, x, y, edges=None):
    """Predict each station's bias from all the others (the variogram and the regression are refitted without it):
    zero (no correction), mean (one number for all), regression (on the columns of x, e.g. height), kriging (of the raw biases), regression+kriging
    (the regression, plus kriging of what the regression leaves). -> {method: array of predictions}."""
    lat, lon, y = np.asarray(lat, float), np.asarray(lon, float), np.asarray(y, float)
    x = np.asarray(x, float).reshape(len(y), -1)
    edges = np.linspace(0, 600, 13) if edges is None else edges
    out = {m: np.empty(len(y)) for m in METHODS}
    for i in range(len(y)):
        tr = np.arange(len(y)) != i
        fit_tr, reg_i = ols_fit_predict(x[tr], y[tr], x[i:i + 1])
        out['zero'][i] = 0.0
        out['mean'][i] = y[tr].mean()
        out['regression'][i] = reg_i[0]
        out['kriging'][i] = _krige_or_mean(lat[tr], lon[tr], y[tr], lat[i], lon[i], edges)
        out['regression+kriging'][i] = reg_i[0] + _krige_or_mean(lat[tr], lon[tr], y[tr] - fit_tr, lat[i], lon[i], edges)
    return out
