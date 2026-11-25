"""Multi-scale topographic descriptors for the 1 km temperature models (pure NumPy / SciPy, tested in tests/test_topo.py).

All inputs are the 1 km GLO-90 grid of terrain.py (row 0 north, cells of terrain.RES degrees, about 1 km). Window sizes are in cells, so 3, 9 and 25 cells are
about 3, 9 and 25 km. These are descriptors, not published thresholds: which of them matter is decided by the cross-validation, not assumed.

  tpi_W              Topographic Position Index: height minus the mean height of the W x W cells (m); > 0 on ridges and peaks, < 0 in valleys and gorges
  rough_W            local standard deviation of height in the W x W cells (m): how broken the ground is
  relpos_W           (height - lowest) / (highest - lowest) in the W x W cells, 0 at the bottom, 1 at the top, 0.5 on flat ground
  valley_depth_W     highest height in the W x W cells minus the cell's height (m): how far below the surrounding ridges (cold-air pool depth)
  sky_view           1 - mean of sin(horizon angle) over 8 compass directions, horizon searched out to 24 cells (Dozier and Frew 1990 approximation of
                     the sky view factor); 1 on open ground, lower in deep valleys. The 1 km grid cannot resolve a gorge narrower than about 2 km: it
                     sees the valley, not the gorge
  pot_rad_ratio      daily clear-sky potential beam radiation on the slope divided by the same on flat ground (geometry only: solar declination of
                     Cooper 1969, no atmosphere, no shading); > 1 on slopes facing the sun, < 1 on slopes facing away. Varies with the day of the year
"""
import math

import numpy as np
from scipy import ndimage

import terrain

WINDOWS = (3, 9, 25)
SVF_STEPS = (1, 2, 3, 5, 8, 12, 16, 24)                     # cells searched along each direction
DIRECTIONS = ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))   # (row, column) steps: N, NE, E, SE, S, SW, W, NW
TPI_W = (3, 9, 25)
RELPOS_W = (9, 25)
DEPTH_W = 25
STATIC = [f'tpi_{w}' for w in TPI_W] + [f'rough_{w}' for w in WINDOWS] + [f'relpos_{w}' for w in RELPOS_W] + [f'valley_depth_{DEPTH_W}', 'sky_view']
DAILY = ['pot_rad_ratio']


def roughness(z, w):
    """Local standard deviation of height over a w x w window (m)."""
    z = np.asarray(z, np.float64)
    m = ndimage.uniform_filter(z, size=w, mode='nearest')
    return np.sqrt(np.maximum(ndimage.uniform_filter(z * z, size=w, mode='nearest') - m * m, 0.0)).astype(np.float32)


def relative_position(z, w):
    """(z - local minimum) / (local maximum - local minimum) over a w x w window; 0.5 where the window is flat."""
    z = np.asarray(z, np.float64)
    lo, hi = ndimage.minimum_filter(z, size=w, mode='nearest'), ndimage.maximum_filter(z, size=w, mode='nearest')
    span = hi - lo
    return np.where(span > 0, (z - lo) / np.where(span > 0, span, 1.0), 0.5).astype(np.float32)


def valley_depth(z, w):
    """Highest height in the w x w window minus the cell's own height (m)."""
    z = np.asarray(z, np.float64)
    return (ndimage.maximum_filter(z, size=w, mode='nearest') - z).astype(np.float32)


def sky_view_factor(z, lat_deg=None, steps=SVF_STEPS):
    """1 - mean(sin(horizon angle)) over the 8 compass directions; the horizon angle along a direction is the largest elevation angle of the ground
    seen from the cell within the search steps (never below 0). lat_deg: latitude of each row (default terrain.lat_centres()), sets the east-west spacing."""
    z = np.asarray(z, np.float64)
    ny, nx = z.shape
    lat = terrain.lat_centres() if lat_deg is None else np.asarray(lat_deg, np.float64)
    dy = terrain.RES * terrain.M_PER_DEG
    dx = (dy * np.cos(np.radians(lat)))[:, None]
    pad = max(steps)
    zp = np.pad(z, pad, mode='edge')
    total = np.zeros_like(z)
    for dj, di in DIRECTIONS:
        horizon = np.zeros_like(z)
        for d in steps:
            shifted = zp[pad + dj * d: pad + dj * d + ny, pad + di * d: pad + di * d + nx]
            dist = d * np.sqrt((di * dx) ** 2 + (dj * dy) ** 2)
            horizon = np.maximum(horizon, np.arctan2(shifted - z, dist))
        total += np.sin(horizon)
    return (1.0 - total / len(DIRECTIONS)).astype(np.float32)


def static_features(dem, lat_deg=None):
    """{name: array} for STATIC over the DEM (NaN at sea is read as 0 m)."""
    z = np.nan_to_num(dem, nan=0.0)
    out = {f'tpi_{w}': terrain.tpi(z, w) for w in TPI_W}
    out.update({f'rough_{w}': roughness(z, w) for w in WINDOWS})
    out.update({f'relpos_{w}': relative_position(z, w) for w in RELPOS_W})
    out[f'valley_depth_{DEPTH_W}'] = valley_depth(z, DEPTH_W)
    out['sky_view'] = sky_view_factor(z, lat_deg)
    return out


def declination_deg(doy):
    """Solar declination, degrees (Cooper 1969): 23.45 sin(360 (284 + n) / 365)."""
    return 23.45 * np.sin(np.radians(360.0 * (284.0 + np.asarray(doy, np.float64)) / 365.0))


def pot_rad_ratio(lat_deg, slope_x, slope_y, doy, step_minutes=15):
    """Daily clear-sky potential beam radiation on the slope / on flat ground (geometry only). slope_x, slope_y: dz/dx east and dz/dy north (m per m);
    arrays broadcast together. Sun direction in east / north / up components from the hour angle; the surface normal is (-sx, -sy, 1) / norm. 1 where the
    sun does not rise."""
    lat = np.radians(np.asarray(lat_deg, np.float64))
    sx, sy = np.asarray(slope_x, np.float64), np.asarray(slope_y, np.float64)
    dec = np.radians(declination_deg(doy))
    norm = np.sqrt(1.0 + sx * sx + sy * sy)
    slope_sum, flat_sum = 0.0, 0.0
    for minute in range(0, 24 * 60, step_minutes):
        w = math.radians((minute + step_minutes / 2) / 4.0 - 180.0)                  # hour angle, 0 at solar noon, positive in the afternoon
        up = np.sin(lat) * np.sin(dec) + np.cos(lat) * np.cos(dec) * math.cos(w)
        east = -np.cos(dec) * math.sin(w)
        north = np.sin(dec) * np.cos(lat) - np.cos(dec) * np.sin(lat) * math.cos(w)
        flat_sum = flat_sum + np.maximum(up, 0.0)
        slope_sum = slope_sum + np.where(up > 0, np.maximum((-sx * east - sy * north + up) / norm, 0.0), 0.0)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(flat_sum > 0, slope_sum / np.where(flat_sum > 0, flat_sum, 1.0), 1.0)
