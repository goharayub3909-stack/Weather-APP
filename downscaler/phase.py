"""Rain / snow phase split for the 1 km precipitation (pure functions, tested in tests/test_phase.py).

Method: Ding, B., Yang, K., Qin, J., Wang, L., Chen, Y. and He, X. (2014), "The dependence of precipitation types on surface elevation and
meteorological conditions and its parameterization", Journal of Hydrology 513, 154-163, doi:10.1016/j.jhydrol.2014.03.038. Equations as
printed in the accepted manuscript (Eq. numbers in brackets). Inputs: wet-bulb temperature Tw (degC), relative humidity RH (0..1) and station elevation Z (km).

    dT = 0.215 - 0.099 RH + 1.018 RH^2                                             (7)
    dS = 2.374 - 1.634 RH                                                          (8)
    T0 = -5.87 - 0.1042 Z + 0.0885 Z^2 + 16.06 RH - 9.614 RH^2                     (9)
    if dT / dS > ln 2:  Tmin = T0 - dS ln[exp(dT/dS) - 2 exp(-dT/dS)],  Tmax = 2 T0 - Tmin      (13, 14)
    else:               Tmin = Tmax = T0
    snow if Tw <= Tmin;  sleet if Tmin < Tw < Tmax;  rain if Tw >= Tmax                         (10)
    Tw = Ta - esat(Ta) (1 - RH) / (0.000643 ps + d esat / d Ta)      ps in hPa                   (A.2)
    esat(Ta) = 6.1078 exp(17.27 Ta / (Ta + 237.3))  hPa (Tetens, Murray 1967)                    (A.3)

The paper's own limits, which apply here: it was fitted to DAILY MEAN temperature, humidity and pressure at 609 Chinese stations (validated on 100 more,
about 88 % accuracy for air temperature between -10 and 10 degC, slightly better on the Tibetan Plateau, the closest analogue to the Karakoram and Himalaya);
it was not evaluated outside China; and its authors expect the thresholds for hourly precipitation to be LOWER than the scheme gives. Here it is applied to
3-hourly values, which is outside what it was fitted on.

Conventions that are ours, not the paper's:
  * Sleet (a mixture of rain and snow, the paper's middle class) is split half and half: SLEET_SNOW_SHARE = 0.5.
  * RH comes from ECMWF's own 2 m temperature and dew point at 0.1 degree and is held constant inside each 0.1 degree cell; the 1 km temperature (lapse
    corrected, bias corrected, station nudged) alone moves Tw. No dew point lapse rate is assumed.
  * Station pressure ps is the ICAO standard-atmosphere pressure at the 1 km cell's height, not the forecast pressure (the weather part of ps changes Tw by
    well under 0.1 degC).
  * Z is the 1 km cell's height.

Cross-check, not used for the split: Jennings, Winchell, Livneh and Molotch (2018), Nature Communications 9:1148, doi:10.1038/s41467-018-03629-7, bivariate
logistic p_snow = 1 / (1 + exp(-10.04 + 1.41 Ta + 0.09 RH)) (Ta degC, RH per cent; snow when p_snow >= 0.5), coefficients as printed for "RegBi" in
HESS 23, 3765 (2019), not checked against the original text. The manifest reports how often the two schemes call the same phase.

Limits: there is no solid-precipitation observation to check the split against. Unheated tipping-bucket gauges (every Davis station, Shimshal included) do
not record snow when it falls, so station rain at cold sites is a lower bound and is no truth for this layer. Screening only.
"""
import math

import numpy as np

DING = dict(
    source='Ding et al. 2014, Journal of Hydrology 513, 154-163, doi:10.1016/j.jhydrol.2014.03.038',
    t0=(-5.87, -0.1042, 0.0885, 16.06, -9.614),        # Eq. 9: intercept, Z, Z^2, RH, RH^2 (Z in km, RH 0..1)
    dt=(0.215, -0.099, 1.018),                         # Eq. 7: intercept, RH, RH^2
    ds=(2.374, -1.634),                                # Eq. 8: intercept, RH
    psychrometer=0.000643,                             # A.2: cp / (eps Lv), per hPa of station pressure
    tetens=(6.1078, 17.27, 237.3))                     # A.3: hPa, dimensionless, degC
SLEET_SNOW_SHARE = 0.5                                 # ours: sleet is half snow, half rain
SHARE_CODES = 255                                      # browser file: red = round(255 x snow share of the water)
JENNINGS = dict(intercept=-10.04, ta=1.41, rh=0.09, snow_at=0.5,
                source='Jennings et al. 2018, Nature Communications 9:1148, doi:10.1038/s41467-018-03629-7 (bivariate logistic, air temperature and relative humidity)')


def saturation_vapour_pressure(t_c):
    """hPa over water, Tetens (A.3)."""
    a, b, c = DING['tetens']
    t = np.asarray(t_c, np.float64)
    return a * np.exp(b * t / (t + c))


def saturation_slope(t_c):
    """d esat / d Ta in hPa per degC."""
    a, b, c = DING['tetens']
    t = np.asarray(t_c, np.float64)
    return saturation_vapour_pressure(t) * b * c / (t + c) ** 2


def relative_humidity(t_c, dew_c):
    """0..1 from air and dew point temperature (degC); a dew point above the air temperature is read as saturation."""
    with np.errstate(invalid='ignore'):
        return np.clip(saturation_vapour_pressure(dew_c) / saturation_vapour_pressure(t_c), 0.0, 1.0)


def station_pressure(z_m):
    """hPa from height in metres, ICAO standard atmosphere (troposphere): 1013.25 (1 - 2.25577e-5 z) ^ 5.25588."""
    return 1013.25 * (1.0 - 2.25577e-5 * np.asarray(z_m, np.float64)) ** 5.25588


def wet_bulb(t_c, rh, p_hpa):
    """Wet-bulb temperature, degC (A.2): Ta - esat(Ta) (1 - RH) / (0.000643 ps + d esat / d Ta)."""
    t, rh, p = (np.asarray(x, np.float64) for x in (t_c, rh, p_hpa))
    return t - saturation_vapour_pressure(t) * (1.0 - rh) / (DING['psychrometer'] * p + saturation_slope(t))


def ding_parameters(rh, z_km):
    """(T0, dT, dS) of Eq. 9, 7 and 8."""
    rh, z = np.asarray(rh, np.float64), np.asarray(z_km, np.float64)
    a = DING['t0']
    t0 = a[0] + a[1] * z + a[2] * z ** 2 + a[3] * rh + a[4] * rh ** 2
    d = DING['dt']
    s = DING['ds']
    return t0, d[0] + d[1] * rh + d[2] * rh ** 2, s[0] + s[1] * rh


def ding_thresholds(rh, z_km):
    """(Tmin, Tmax) of Eq. 13 and 14. Equal to T0 (no sleet) when dT / dS <= ln 2, which is where RH is about 78 per cent or less."""
    t0, dt, ds = ding_parameters(rh, z_km)
    ratio = dt / ds
    dual = ratio > math.log(2.0)
    with np.errstate(invalid='ignore', divide='ignore'):
        inner = np.exp(ratio) - 2.0 * np.exp(-ratio)
        tmin = np.where(dual, t0 - ds * np.log(np.where(inner > 0, inner, np.nan)), t0)
    tmax = np.where(dual, 2.0 * t0 - tmin, t0)
    return tmin, tmax


def snow_share(t_c, rh, z_m):
    """Share (0..1) of the precipitation water that falls as snow: 1 where Tw <= Tmin, 0 where Tw >= Tmax, SLEET_SNOW_SHARE between (Eq. 10).
    NaN where an input is missing."""
    t, rh = np.asarray(t_c, np.float64), np.asarray(rh, np.float64)
    z = np.asarray(z_m, np.float64)
    tw = wet_bulb(t, rh, station_pressure(z))
    tmin, tmax = ding_thresholds(rh, z / 1000.0)
    share = np.where(tw <= tmin, 1.0, np.where(tw >= tmax, 0.0, SLEET_SNOW_SHARE))
    return np.where(np.isfinite(tw) & np.isfinite(tmin), share, np.nan)


def split(precip, share):
    """(rain, snow water) of a precipitation amount. Water is conserved; a missing share leaves the whole amount as rain (callers should not draw a phase there)."""
    snow = np.where(np.isfinite(share), precip * np.clip(share, 0.0, 1.0), 0.0)
    return precip - snow, snow


def pack_phase(share):
    """RGB uint8 image: red = round(255 x snow share), green = blue = 0 (a missing share is 0 = rain)."""
    r = np.clip(np.rint(np.nan_to_num(share, nan=0.0) * SHARE_CODES), 0, SHARE_CODES).astype(np.uint8)
    out = np.zeros(r.shape + (3,), np.uint8)
    out[..., 0] = r
    return out


def unpack_phase(rgb):
    return rgb[..., 0].astype(np.float64) / SHARE_CODES


# ---- cross-check against Jennings et al. (2018) and against ECMWF's own snowfall ----
def jennings_probability(t_c, rh):
    """p_snow of the Jennings et al. (2018) bivariate model; rh is 0..1 here (the paper's RH is per cent)."""
    t, rh = np.asarray(t_c, np.float64), np.asarray(rh, np.float64)
    return 1.0 / (1.0 + np.exp(JENNINGS['intercept'] + JENNINGS['ta'] * t + JENNINGS['rh'] * 100.0 * rh))


def phase_class(share):
    """Diagnostic classes only: 0 rain (share < 0.25), 1 mixed, 2 snow (share > 0.75)."""
    return np.where(share < 0.25, 0, np.where(share > 0.75, 2, 1))


def agreement_counts(precip, share, ecmwf_share, jennings_p=None, min_rate=0.1):
    """Sums over the wet cells (precip >= min_rate mm/h) of one step, for comparing this split with ECMWF's own snowfall share (0..1) and, when given,
    with Jennings' p_snow: cells, cells in the same class as ECMWF, cells where Jennings calls snow (p >= 0.5) exactly when this split is at least half snow,
    and the water falling as snow by this split and by ECMWF."""
    wet = np.isfinite(precip) & (precip >= min_rate) & np.isfinite(share) & np.isfinite(ecmwf_share)
    w = precip[wet].astype(np.float64)
    out = dict(wet=int(wet.sum()), agree=int((phase_class(share[wet]) == phase_class(ecmwf_share[wet])).sum()), ours=float((w * share[wet]).sum()),
               ecmwf=float((w * ecmwf_share[wet]).sum()), water=float(w.sum()), jennings_agree=0)
    if jennings_p is not None:
        out['jennings_agree'] = int(((jennings_p[wet] >= JENNINGS['snow_at']) == (share[wet] >= 0.5)).sum())
    return out


def summary(counts, compared, with_jennings=False):
    """The manifest's agreement block from the pooled counts of agreement_counts."""
    if not compared or counts['wet'] == 0:
        return dict(compared=False, wet_cells=int(counts['wet']))
    out = dict(compared=True, wet_cells=int(counts['wet']), class_agreement=counts['agree'] / counts['wet'],
               snow_water_share=counts['ours'] / counts['water'], ecmwf_snow_water_share=counts['ecmwf'] / counts['water'])
    if with_jennings:
        out['jennings_agreement'] = counts['jennings_agree'] / counts['wet']
    return out
