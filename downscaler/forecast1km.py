"""1 km forecast building blocks (pure functions, tested in tests/test_forecast1km.py).

Grids:
  * ECMWF 0.1 degree NODES at lon 60.0 + 0.1 i, lat 23.0 + 0.1 j (row 0 = SOUTH), as in grid-hires.json and the ECMWF cache.
  * 1 km CELLS of terrain.py at lon 60.005 + 0.01 i, lat 37.995 - 0.01 j (row 0 = NORTH).
"""
import math

import numpy as np
from scipy import ndimage, sparse

import terrain

NODE_W, NODE_S, NODE_D = 60.0, 23.0, 0.1
NODE_NX, NODE_NY = 181, 151

# ---- encoding of the browser files (RGB PNG, 24 bits per pixel) ----
# temperature + rain: 11 bits of temperature (0.1 degC from -60 degC; 2047 = no value) and 13 bits of rain (0.1 mm/h, up to 819 mm/h)
T_OFFSET, T_SCALE, T_MISSING, R_SCALE, R_MAX = 60.0, 10.0, 2047, 10.0, 8191
# wind: 12 bits each for u and v (0.02 m/s steps from -40.96 to +40.94 m/s; 4095 = no value)
W_SCALE, W_ZERO, W_MISSING = 50.0, 2048, 4095


def _rgb(val):
    val = val.astype(np.uint32)
    return np.stack([(val >> 16) & 255, (val >> 8) & 255, val & 255], axis=-1).astype(np.uint8)


def _val(rgb):
    rgb = rgb.astype(np.uint32)
    return (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]


def pack_temp_rain(t, r):
    tc = np.where(np.isfinite(t), np.clip(np.rint((t + T_OFFSET) * T_SCALE), 0, T_MISSING - 1), T_MISSING).astype(np.uint32)
    rc = np.clip(np.rint(np.nan_to_num(r, nan=0.0) * R_SCALE), 0, R_MAX).astype(np.uint32)
    return _rgb((tc << 13) | rc)


def unpack_temp_rain(rgb):
    v = _val(rgb)
    tc, rc = v >> 13, v & 8191
    return np.where(tc == T_MISSING, np.nan, tc / T_SCALE - T_OFFSET), rc / R_SCALE


def pack_wind(u, v):
    ok = np.isfinite(u) & np.isfinite(v)
    uc = np.where(ok, np.clip(np.rint(np.nan_to_num(u) * W_SCALE) + W_ZERO, 0, W_MISSING - 1), W_MISSING).astype(np.uint32)
    vc = np.where(ok, np.clip(np.rint(np.nan_to_num(v) * W_SCALE) + W_ZERO, 0, W_MISSING - 1), W_MISSING).astype(np.uint32)
    return _rgb((uc << 12) | vc)


def unpack_wind(rgb):
    x = _val(rgb).astype(np.int64)                     # signed: (code - 2048) must not wrap
    uc, vc = x >> 12, x & 4095
    bad = (uc == W_MISSING) | (vc == W_MISSING)
    return np.where(bad, np.nan, (uc - W_ZERO) / W_SCALE), np.where(bad, np.nan, (vc - W_ZERO) / W_SCALE)


# ---- 0.1 degree nodes -> 1 km cells ----
def _interp_matrix(src0, step, n_src, dst):
    """Rows of linear-interpolation weights from n_src nodes (src0 + step k) to the positions dst (clamped at the edges)."""
    f = np.clip((dst - src0) / step, 0, n_src - 1 - 1e-9)
    k = np.floor(f).astype(int)
    w = f - k
    m = np.zeros((len(dst), n_src))
    m[np.arange(len(dst)), k] = 1 - w
    m[np.arange(len(dst)), k + 1] += w
    return m


_WY = _interp_matrix(NODE_S, NODE_D, NODE_NY, terrain.lat_centres())     # (1500, 151)
_WX = _interp_matrix(NODE_W, NODE_D, NODE_NX, terrain.lon_centres())     # (1800, 181)


def to_1km(node_field):
    """Bilinear from the 0.1 degree nodes (row 0 south) to the 1 km cells (row 0 north)."""
    return (_WY @ np.asarray(node_field, dtype=np.float64) @ _WX.T).astype(np.float32)


def node_index():
    """(row, col) of the 0.1 degree node whose cell holds each 1 km cell (cells centred on the nodes, 10 x 10 km)."""
    j = np.floor((terrain.lat_centres() - NODE_S) / NODE_D + 0.5).astype(int)
    i = np.floor((terrain.lon_centres() - NODE_W) / NODE_D + 0.5).astype(int)
    return np.clip(j, 0, NODE_NY - 1), np.clip(i, 0, NODE_NX - 1)


def block_mean(a, nj, ni):
    """Mean of a 1 km field over each 0.1 degree node cell -> (151, 181), row 0 south (NaN for empty cells)."""
    idx = nj[:, None] * NODE_NX + ni[None, :]
    good = np.isfinite(a)
    s = np.bincount(idx[good], weights=a[good].astype(np.float64), minlength=NODE_NX * NODE_NY)
    c = np.bincount(idx[good], minlength=NODE_NX * NODE_NY)
    with np.errstate(invalid='ignore', divide='ignore'):
        return (s / c).reshape(NODE_NY, NODE_NX)


# ---- ECMWF steps -> UTC days ----
def daily_from_steps(times, f):
    """times: step datetimes (UTC); f: dict of per-step node arrays 'mx2t3', 'mn2t3' (K), 'tp', 'ssrd' (accumulated, m and J/m2),
    '10u', '10v' (m/s). Every step after the first closes a 3 h window that belongs to the UTC day of its middle.
    -> list of dict(date, windows, full, tmax, tmin (degC), precip (mm), ssrd (MJ/m2), u10, v10), totals scaled to 24 h when partial."""
    days = {}
    for k in range(1, len(times)):
        d = (times[k] - (times[k] - times[k - 1]) / 2).date()
        days.setdefault(d, []).append(k)
    out = []
    for d, ks in sorted(days.items()):
        hours = sum((times[k] - times[k - 1]).total_seconds() / 3600 for k in ks)
        scale = 24 / hours
        out.append(dict(
            date=d, windows=len(ks), full=hours >= 24 - 1e-6,
            tmax=np.max([f['mx2t3'][k] for k in ks], axis=0) - 273.15,
            tmin=np.min([f['mn2t3'][k] for k in ks], axis=0) - 273.15,
            precip=np.maximum(sum(f['tp'][k] - f['tp'][k - 1] for k in ks), 0) * 1000 * scale,
            ssrd=np.maximum(sum(f['ssrd'][k] - f['ssrd'][k - 1] for k in ks), 0) / 1e6 * scale,
            u10=np.mean([f['10u'][k] for k in ks], axis=0), v10=np.mean([f['10v'][k] for k in ks], axis=0)))
    return out


def anchor_day(days, d):
    """Index of the day whose 1 km anchors a step on date d: that day when it is complete, else the nearest complete day."""
    full = [i for i, x in enumerate(days) if x['full']]
    if not full:
        full = list(range(len(days)))
    return min(full, key=lambda i: (abs((days[i]['date'] - d).days), i))


def diurnal_position(t_ec, tmin_ec, tmax_ec, min_range=0.5):
    """Where the ECMWF temperature of a step sits between its own daily minimum (0) and maximum (1)."""
    return np.clip((t_ec - tmin_ec) / np.maximum(tmax_ec - tmin_ec, min_range), 0, 1)


def diurnal(t_ec, tmin_ec, tmax_ec, tmin_1k, tmax_1k, min_range=0.5):
    """1 km temperature at one step: the ECMWF value moved by the 1 km correction of the day's minimum and maximum, blended by where the
    ECMWF value sits between its own daily minimum (s = 0) and maximum (s = 1). At the ECMWF extremes it returns the 1 km extremes."""
    s = diurnal_position(t_ec, tmin_ec, tmax_ec, min_range)
    return t_ec + (tmin_1k - tmin_ec) + ((tmax_1k - tmax_ec) - (tmin_1k - tmin_ec)) * s


def night_limited(corr):
    """The live elevation bias as it may act at night: only where it ADDS warmth (a negative bias, i.e. the model was too cold) is kept; where it would take warmth away (the
    positive bias of the mountains) it is dropped. The curve is fitted on daytime readings, when the model is too warm in the mountains, and the 1 km model's own minimum is
    close to unbiased there (checked on PMD and GLOF stations, 19 and 23 Nov 2026), so removing the daytime correction at night over-cooled the mountain minima by about 6 degC."""
    return np.minimum(corr, 0)


NIGHT_WINDOW = (0.0, 1.0)     # (s0, s1): the night-limited bias is used below s0, the whole bias above s1, a linear blend between (screening convention; set by the A/B test of 23 Nov 2026)


def warm_weight(s, window=None):
    """How much of the whole bias a step gets: 0 at and below window[0] (the coldest hours: only the night-limited bias), 1 at and above window[1], linear in between."""
    s0, s1 = NIGHT_WINDOW if window is None else window
    return np.clip((np.asarray(s, dtype=float) - s0) / max(s1 - s0, 1e-6), 0, 1)


def step_bias(corr, s, window=None):
    """The live elevation bias to remove at one step: the whole bias at the warm end of the day (so the daily maximum keeps it exactly), its night-limited form at the cold
    end (the daily minimum), and a blend in between (warm_weight). Where the bias is negative or zero (plains and foothills, below about 1,300 m) both are the same: nothing changes."""
    w = warm_weight(s, window)
    return night_limited(corr) * (1 - w) + corr * w


def conserve_rain(rate_1k, weight_1k, rate_nodes, nj, ni):
    """Spread the ECMWF rain of each 0.1 degree cell over its 1 km cells by weight, keeping the cell's mean exactly (water is conserved).
    rate_1k: smooth first guess (bilinear), weight_1k: relative 1 km pattern (>= 0, NaN = 1), rate_nodes: ECMWF value per node."""
    w = np.where(np.isfinite(weight_1k), weight_1k, 1.0)
    p = np.maximum(rate_1k, 0) * w
    m = block_mean(p, nj, ni)
    target = np.maximum(rate_nodes, 0)
    with np.errstate(invalid='ignore', divide='ignore'):
        factor = np.where(m > 0, target / m, 0.0)
    out = p * factor[nj[:, None], ni[None, :]]
    # a node with rain whose first guess is zero everywhere in its cell: even spread
    empty = (m <= 0) & (target > 0)
    if empty.any():
        fill = empty[nj[:, None], ni[None, :]]
        out[fill] = target[nj[:, None], ni[None, :]][fill]
    return out.astype(np.float32)


# ---- mass-consistent 10 m wind ----
WIND = dict(
    lid_smooth_km=25.0,      # the flow layer's top follows the terrain smoothed over this scale ...
    lid_depth_m=1500.0,      # ... this far above it (a typical daytime boundary-layer depth)
    min_depth_m=200.0,       # the layer is never thinner than this
    max_speedup=2.0,         # the adjusted speed is at most this many times the ECMWF speed
    max_speed=40.0,          # and never more than this, m/s
)  # screening conventions, not measured values


def layer_depths(z_1k, z_coarse_1k):
    """(h, h_c): depth of the flow layer over the 1 km terrain and over the terrain ECMWF sees (its 0.1 degree mean, smoothed)."""
    z = np.nan_to_num(z_1k, nan=0.0)
    zc = np.nan_to_num(z_coarse_1k, nan=0.0)
    lid = ndimage.gaussian_filter(z, WIND['lid_smooth_km'], mode='nearest') + WIND['lid_depth_m']
    return np.maximum(lid - z, WIND['min_depth_m']), np.maximum(lid - zc, WIND['min_depth_m'])


def _spacing():
    dy = terrain.RES * terrain.M_PER_DEG
    dx = dy * np.cos(np.radians(terrain.lat_centres()))
    return dx, dy


class MassConsistentWind:
    """Adjusts a first-guess 10 m wind so that the flux through the layer (depth h above the 1 km terrain) has the divergence it has over
    the terrain ECMWF used: div(h u) = div(h_c u0). The least change (weighted by h) is u = u0 + grad(phi) with div(h grad phi) = div((h - h_c) u0),
    phi = 0 on the box edges (flow passes freely). So the adjustment comes only from terrain detail ECMWF does not resolve: flow is
    deflected around peaks and speeds up where the layer thins over ridges. A 2D, single-layer version of the diagnostic mass-consistent
    models (e.g. CALMET, WindNinja); no thermal (valley/slope) winds."""

    def __init__(self, z_1k, z_coarse_1k, tol=1e-6):
        import pyamg
        self.h, self.hc = layer_depths(z_1k, z_coarse_1k)
        self.dx, self.dy = _spacing()
        ny, nx = self.h.shape
        self.shape, self.tol = (ny, nx), tol
        self.hx, self.hy = self.faces(self.h)
        self.hcx, self.hcy = self.faces(self.hc)
        dx2 = (self.dx ** 2)[:, None]
        cx, cy = self.hx / dx2, self.hy / self.dy ** 2                 # face conductances
        n = ny * nx
        idx = np.arange(n).reshape(ny, nx)
        diag = (cx[:, :-1] + cx[:, 1:] + cy[:-1, :] + cy[1:, :]).ravel()
        e = -cx[:, 1:-1].ravel()                                          # cell (j, i) with (j, i + 1)
        nn = -cy[1:-1, :].ravel()                                         # cell (j, i) with (j - 1, i)
        rows = np.concatenate([idx.ravel(), idx[:, :-1].ravel(), idx[:, 1:].ravel(), idx[1:, :].ravel(), idx[:-1, :].ravel()])
        cols = np.concatenate([idx.ravel(), idx[:, 1:].ravel(), idx[:, :-1].ravel(), idx[:-1, :].ravel(), idx[1:, :].ravel()])
        self.A = sparse.csr_matrix((np.concatenate([diag, e, e, nn, nn]), (rows, cols)), shape=(n, n))
        self.ml = pyamg.smoothed_aggregation_solver(self.A, symmetry='symmetric', max_coarse=500)

    @staticmethod
    def faces(c):
        """Cell field -> (x faces (ny, nx + 1): face i is west of cell i; y faces (ny + 1, nx): face j is north of row j).
        Inside: mean of the two cells; on the box edge: the edge cell's value."""
        fx = np.empty((c.shape[0], c.shape[1] + 1)); fx[:, 1:-1] = 0.5 * (c[:, :-1] + c[:, 1:]); fx[:, 0] = c[:, 0]; fx[:, -1] = c[:, -1]
        fy = np.empty((c.shape[0] + 1, c.shape[1])); fy[1:-1, :] = 0.5 * (c[:-1, :] + c[1:, :]); fy[0, :] = c[0, :]; fy[-1, :] = c[-1, :]
        return fx, fy

    def divergence(self, fx, fy):
        """Divergence of face fluxes (east flux on x faces, north flux on y faces) per cell."""
        return (fx[:, 1:] - fx[:, :-1]) / self.dx[:, None] + (fy[:-1, :] - fy[1:, :]) / self.dy

    def adjust(self, u0, v0, return_faces=False):
        u0 = np.nan_to_num(u0).astype(np.float64)
        v0 = np.nan_to_num(v0).astype(np.float64)
        ux0, _ = self.faces(u0)
        _, vy0 = self.faces(v0)
        # div(h (u0 + grad phi)) = div(h_c u0)  <=>  A phi = div((h - h_c) u0), with A = -div(h grad .)
        rhs = self.divergence((self.hx - self.hcx) * ux0, (self.hy - self.hcy) * vy0)
        phi = self.ml.solve(rhs.ravel(), tol=self.tol, accel='cg', maxiter=300).reshape(self.shape)
        pad = np.pad(phi, 1)                                       # phi = 0 outside the box
        ux = (pad[1:-1, 1:] - pad[1:-1, :-1]) / self.dx[:, None]   # east component on x faces
        vy = (pad[:-1, 1:-1] - pad[1:, 1:-1]) / self.dy            # north component on y faces (row - 1 is north)
        if return_faces:
            return ux0 + ux, vy0 + vy
        u = u0 + 0.5 * (ux[:, :-1] + ux[:, 1:])
        v = v0 + 0.5 * (vy[:-1, :] + vy[1:, :])
        s0, s = np.hypot(u0, v0), np.hypot(u, v)
        cap = np.minimum(WIND['max_speedup'] * np.maximum(s0, 0.5), WIND['max_speed'])
        k = np.where(s > cap, cap / np.maximum(s, 1e-9), 1.0)
        return (u * k).astype(np.float32), (v * k).astype(np.float32)


# ---- station analysis (Barnes successive correction, elevation-aware) ----
ANALYSIS = dict(
    passes_km=(40.0, 15.0),   # length scales of the two passes
    height_scale_m=300.0,     # a station 300 m above or below a cell counts e^-1 as much there
    radius=2.5,               # influence radius in length scales
    kappa=0.2,                # regularises the weight sum, so increments fade where stations are few and far
    decay_hours=12.0,         # increments fall linearly to zero this many hours from the analysis time
    gross={'t2m': 8.0, 'u': 15.0, 'v': 15.0, 'rain': 60.0},   # residuals larger than this are rejected (gross-error check)
)  # screening conventions, not measured values


def barnes(obs_lat, obs_lon, obs_z, resid, z_1k, length_km, height_m=None, kappa=None):
    """Increment field on the 1 km grid from residuals at stations. Weight exp(-(d/L)^2) x exp(-(dz/Hz)^2) (dz: station height minus cell
    height; omitted when height_m is None), normalised by sum(w) + kappa."""
    kappa = ANALYSIS['kappa'] if kappa is None else kappa
    lat_c, lon_c = terrain.lat_centres(), terrain.lon_centres()
    num = np.zeros(z_1k.shape); den = np.zeros(z_1k.shape)
    r_cells = int(math.ceil(ANALYSIS['radius'] * length_km / (terrain.RES * 111.32)))
    z = np.nan_to_num(z_1k, nan=0.0)
    for la, lo, zo, r in zip(obs_lat, obs_lon, obs_z, resid):
        c = terrain.cell_of(la, lo)
        if c is None or not np.isfinite(r):
            continue
        j0, j1 = max(0, c[0] - r_cells), min(terrain.NY, c[0] + r_cells + 1)
        cx = int(math.ceil(r_cells / max(math.cos(math.radians(la)), 0.2)))
        i0, i1 = max(0, c[1] - cx), min(terrain.NX, c[1] + cx + 1)
        dy = (lat_c[j0:j1, None] - la) * 111.32
        dx = (lon_c[None, i0:i1] - lo) * 111.32 * math.cos(math.radians(la))
        w = np.exp(-(dx ** 2 + dy ** 2) / length_km ** 2)
        if height_m is not None and np.isfinite(zo):
            w = w * np.exp(-((z[j0:j1, i0:i1] - zo) / height_m) ** 2)
        num[j0:j1, i0:i1] += w * r
        den[j0:j1, i0:i1] += w
    return (num / (den + kappa)).astype(np.float32)


def analyse(field_at_obs, obs, field_name, z_1k, use_height=True):
    """Two-pass successive correction. field_at_obs(inc) -> background (+ increments so far) at the stations.
    obs: dict(lat, lon, z, value) arrays. -> (increment field, number of stations used)."""
    gross = ANALYSIS['gross'][field_name]
    inc = np.zeros(z_1k.shape, np.float32)
    first = obs['value'] - field_at_obs(inc)
    ok = np.isfinite(first) & (np.abs(first) <= gross)
    if not ok.any():
        return inc, 0
    lat, lon, zz = obs['lat'][ok], obs['lon'][ok], obs['z'][ok]
    for L in ANALYSIS['passes_km']:
        r = obs['value'][ok] - field_at_obs(inc)[ok]
        inc = inc + barnes(lat, lon, zz, r, z_1k, L, ANALYSIS['height_scale_m'] if use_height else None)
    return inc, int(ok.sum())


def time_weight(hours_from_analysis):
    return max(0.0, 1.0 - abs(hours_from_analysis) / ANALYSIS['decay_hours'])


# ---- where the trained correction applies, and the live elevation bias ----
ML_RAMP = dict(elevation_m=700.0, delta_z_m=300.0)   # the ML correction fades to the lapse rate over this distance outside the training range
#                                                     (screening convention)


def ml_weight(elev, delta_z, ranges):
    """1 inside the training stations' range of 1 km cell height and delta_z, falling linearly to 0 over ML_RAMP outside it.
    ranges: dict(elevation=[min, max], delta_z=[min, max]) from feature_metadata.json."""
    e_hi = ranges['elevation'][1]; dz_lo, dz_hi = ranges['delta_z']
    w = np.clip(1 - (elev - e_hi) / ML_RAMP['elevation_m'], 0, 1)
    w = w * np.clip(1 - (delta_z - dz_hi) / ML_RAMP['delta_z_m'], 0, 1) * np.clip(1 - (dz_lo - delta_z) / ML_RAMP['delta_z_m'], 0, 1)
    return np.where(np.isfinite(w), w, 0.0).astype(np.float32)


BIAS = dict(
    knots_m=(0.0, 1000.0, 2000.0, 3000.0, 4000.0),   # the curve is linear between these heights and flat beyond (few stations above 4 km)
    shrink=3.0,          # pulls each knot toward 0 as if this many stations said "no bias" (few stations -> small correction)
    smooth=1.0,          # penalises bends between neighbouring knots (stronger bends the plains below zero)
    max_abs_resid=25.0,  # residuals beyond this are rejected (gross errors)
    half_life_days=2.0,  # older residuals count half as much every this many days
    keep_days=7.0,       # residuals kept for the fit
)  # screening conventions, not measured values


def _hat(elev, knots):
    """Linear-interpolation weights of each height on the knots (rows: heights, columns: knots)."""
    k = np.asarray(knots); e = np.clip(np.asarray(elev, float), k[0], k[-1])
    i = np.clip(np.searchsorted(k, e, side='right') - 1, 0, len(k) - 2)
    w = (e - k[i]) / (k[i + 1] - k[i])
    A = np.zeros((len(e), len(k)))
    A[np.arange(len(e)), i] = 1 - w
    A[np.arange(len(e)), i + 1] += w
    return A


def fit_elevation_bias(elev, resid, weights=None):
    """Smooth curve bias(height) through BIAS knots: weighted least squares with shrinkage to 0 and a second-difference smoothness penalty.
    -> dict(knots, values, n)."""
    elev, resid = np.asarray(elev, float), np.asarray(resid, float)
    ok = np.isfinite(elev) & np.isfinite(resid) & (np.abs(resid) <= BIAS['max_abs_resid'])
    w = np.ones(ok.sum()) if weights is None else np.asarray(weights, float)[ok]
    A = _hat(elev[ok], BIAS['knots_m'])
    n = len(BIAS['knots_m'])
    D = np.diff(np.eye(n), 2, axis=0)
    M = A.T @ (A * w[:, None]) + BIAS['shrink'] * np.eye(n) + BIAS['smooth'] * D.T @ D
    values = np.linalg.solve(M, A.T @ (w * resid[ok])) if ok.any() else np.zeros(n)
    return dict(knots=list(BIAS['knots_m']), values=[float(v) for v in values], n=int(ok.sum()))


def elevation_bias(curve, elev):
    return np.interp(np.nan_to_num(np.asarray(elev, float)), curve['knots'], curve['values']).astype(np.float32)


# ---- regime-dependent bias: one height curve for clear calm weather (cold-air pools, inversions), one for windy weather (frontal or gradient flow) ----
REGIME = dict(
    cloud_clear_pct=30.0,   # total cloud cover below this counts as a clear sky
    wind_calm_ms=3.0,       # a 10 m wind below this is calm
    wind_windy_ms=7.0,      # a 10 m wind at or above this is a windy flow, whatever the cloud
    min_readings=150,       # a regime gets its own curve only with this many residuals in the history ...
    min_analyses=3,         # ... from at least this many analysis times
)  # screening conventions, not measured values: the ECMWF fields only say which regime a place is in, the history says what its bias is
REGIME_NAMES = {1: 'inversion', 2: 'windy'}                      # 0 = neither: the pooled curve


def classify_regime(cloud_pct, wind_ms):
    """int8 codes: 1 inversion-prone (clear and calm), 2 windy, 0 otherwise or unknown. Windy wins over clear; a missing input is 0."""
    cloud, wind = np.broadcast_arrays(np.asarray(cloud_pct, np.float64), np.asarray(wind_ms, np.float64))
    known = np.isfinite(cloud) & np.isfinite(wind)
    windy = known & (wind >= REGIME['wind_windy_ms'])
    inversion = known & ~windy & (cloud < REGIME['cloud_clear_pct']) & (wind < REGIME['wind_calm_ms'])
    return np.where(windy, 2, np.where(inversion, 1, 0)).astype(np.int8)


def fit_regime_bias(elev, resid, regime, weights=None, analysis=None):
    """The pooled curve (every residual) and, for each regime with enough history, its own curve.
    regime: code per residual (NaN for residuals written before regimes were recorded: they count for the pooled curve only); analysis: label of the analysis time of each residual.
    -> dict(pooled=curve, curves={code: curve}, counts={name: dict(readings, analyses, curve: bool)})."""
    elev, resid = np.asarray(elev, float), np.asarray(resid, float)
    regime = np.asarray(regime, float)
    analysis = np.zeros(len(elev), int) if analysis is None else np.asarray(analysis)
    w = None if weights is None else np.asarray(weights, float)
    out = dict(pooled=fit_elevation_bias(elev, resid, w), curves={}, counts={})
    for code, name in REGIME_NAMES.items():
        sel = np.isfinite(regime) & (regime == code) & np.isfinite(resid) & (np.abs(resid) <= BIAS['max_abs_resid'])
        n, na = int(sel.sum()), len(set(analysis[sel].tolist()))
        ok = n >= REGIME['min_readings'] and na >= REGIME['min_analyses']
        if ok:
            out['curves'][code] = fit_elevation_bias(elev[sel], resid[sel], None if w is None else w[sel])
        out['counts'][name] = dict(readings=n, analyses=na, curve=ok)
    return out


def regime_bias(fit, elev, regime_field):
    """Bias field (degC): the regime's own curve where there is one, the pooled curve elsewhere (other weather, or a regime without enough history)."""
    out = elevation_bias(fit['pooled'], elev)
    reg = np.asarray(regime_field)
    for code, curve in fit['curves'].items():
        out = np.where(reg == code, elevation_bias(curve, elev), out)
    return out.astype(np.float32)


def json_safe(x):
    """NaN and infinity are not JSON (browsers refuse the whole file): they become null."""
    if isinstance(x, dict):
        return {k: json_safe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [json_safe(v) for v in x]
    if isinstance(x, (float, np.floating)):
        return float(x) if np.isfinite(x) else None
    if isinstance(x, np.integer):
        return int(x)
    return x


def sample_1km(field, lat, lon):
    """Bilinear value of a 1 km field at points (NaN outside or next to missing cells)."""
    fy = (terrain.BOX['north'] - np.asarray(lat)) / terrain.RES - 0.5
    fx = (np.asarray(lon) - terrain.BOX['west']) / terrain.RES - 0.5
    return ndimage.map_coordinates(np.asarray(field, np.float64), [fy, fx], order=1, mode='nearest', cval=np.nan)
