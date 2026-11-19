"""Shared feature list and the vectorised orographic moisture-flux features (downscaler v2).

FEATURE_COLS is the one list the training (scripts/train_downscaler_v2.py) and the forecast step read, in this order.

Orographic forcing (all NumPy, any array shape):
  terrain gradient   dz/dx, dz/dy of the 1 km GLO-90 DEM after a 3 km Gaussian smoothing (central differences, metres per metre)
  w_oro_850          u850 * dz/dx + v850 * dz/dy (m/s): the vertical motion forced where the 850 hPa wind meets the slope; > 0 upslope
  MF_850             1000 * q850 * w_oro_850 (g/kg x m/s): upslope moisture flux, q in kg/kg
  MF_700             1000 * q700 * (u700 * dz/dx + v700 * dz/dy) where the ground is above 1,500 m, else 0 (the 700 hPa flow matters
                     only over high ground)
"""
import numpy as np
from scipy import ndimage

import terrain
import topo

SMOOTH_KM = 3.0                  # Gaussian sigma of the terrain smoothing before the gradient (as specified for v2)
MF_700_MIN_ELEV_M = 1500.0       # MF_700 is computed only above this height (as specified for v2)

# v1 features (1_prepare_and_train.py) followed by the v2 upper-air and moisture-flux features
V1_COLS = ['elevation', 'delta_z', 'slope_x', 'slope_y', 'tpi', 'aspect_sin', 'aspect_cos', 'coast_dist', 'lat', 'lon',
           'era_tmax', 'era_tmin', 'era_dtr', 'era_precip_m1', 'era_precip', 'era_precip_p1', 'era_ssrd', 'era_u10',
           'era_v10', 'upslope_wind', 'sin_doy', 'cos_doy']
UPPER_COLS = ['cape_max', 'q850', 'r850', 'q700', 'r700', 'w_oro_850', 'MF_850', 'MF_700']
FEATURE_COLS = V1_COLS + UPPER_COLS
# Multi-scale topographic descriptors (topo.py), chosen per target. Design choices, tested by cross-validation (train_downscaler_v2.py --ablation topo), not published
# thresholds: afternoon heating (tmax) answers to the sun on the slope, shading and local convexity; night-time cooling (tmin) to cold-air pooling and drainage.
TOPO_COLS = topo.STATIC + topo.DAILY
TOPO_BY_TARGET = dict(tmax=['pot_rad_ratio', 'sky_view', 'tpi_3', 'tpi_9', 'rough_3', 'rough_9'],
                      tmin=['valley_depth_25', 'relpos_9', 'relpos_25', 'tpi_9', 'tpi_25', 'sky_view', 'rough_25'])


def with_topo(base):
    """Per-model feature lists {'tmax', 'tmin', 'occ', 'amt'}: the base list, plus the target's topographic set for the two temperature models."""
    return dict(tmax=list(base) + TOPO_BY_TARGET['tmax'], tmin=list(base) + TOPO_BY_TARGET['tmin'], occ=list(base), amt=list(base))


STATIC_GRADIENT_COLS = ['dzdx_s3', 'dzdy_s3']      # stored per station / cell, used to build w_oro and MF


def smoothed_gradients(dem, sigma_km=SMOOTH_KM):
    """dz/dx (east) and dz/dy (north), m per m, of the DEM smoothed with a Gaussian of sigma_km (cells are terrain.RES degrees).
    Sea (NaN) counts as 0 m. Central differences; the north-south spacing is constant, the east-west spacing shrinks with latitude."""
    z = np.nan_to_num(np.asarray(dem, np.float64), nan=0.0)
    dy = terrain.RES * terrain.M_PER_DEG
    dx = dy * np.cos(np.radians(terrain.lat_centres()))[:, None]
    sigma_cells = sigma_km * 1000 / dy
    zs = ndimage.gaussian_filter(z, sigma_cells, mode='nearest')
    gj, gi = np.gradient(zs)
    return (gi / dx).astype(np.float32), (-gj / dy).astype(np.float32)


def w_oro(u, v, dzdx, dzdy):
    """Orographic vertical velocity (m/s): the wind's component up the slope."""
    return np.asarray(u) * np.asarray(dzdx) + np.asarray(v) * np.asarray(dzdy)


def moisture_flux(q_kgkg, w):
    """1000 * q * w: g/kg times m/s."""
    return 1000.0 * np.asarray(q_kgkg) * np.asarray(w)


def upper_air_features(cape_max, q850, r850, q700, r700, u850, v850, u700, v700, dzdx, dzdy, elevation):
    """-> dict of the UPPER_COLS arrays (inputs broadcast together)."""
    w850 = w_oro(u850, v850, dzdx, dzdy)
    w700 = w_oro(u700, v700, dzdx, dzdy)
    high = np.nan_to_num(np.asarray(elevation, np.float64), nan=0.0) > MF_700_MIN_ELEV_M
    return dict(cape_max=np.asarray(cape_max, np.float64), q850=np.asarray(q850, np.float64), r850=np.asarray(r850, np.float64),
                q700=np.asarray(q700, np.float64), r700=np.asarray(r700, np.float64), w_oro_850=w850,
                MF_850=moisture_flux(q850, w850), MF_700=np.where(high, moisture_flux(q700, w700), 0.0))
