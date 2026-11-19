# 1 km downscaler (PMD + ERA5-Land + Copernicus GLO-90)

Local only for now: nothing here is used by the website or any workflow.

```
.venv-terrain/Scripts/python.exe downscaler/1_prepare_and_train.py              # auto source (Earth Engine if authenticated)
.venv-terrain/Scripts/python.exe downscaler/1_prepare_and_train.py --source gee # commercially clean ERA5-Land
.venv-terrain/Scripts/python.exe -m unittest discover -s downscaler/tests
```

Packages (in `.venv-terrain`): openpyxl, pandas, pyarrow, numpy, scipy, rasterio, lightgbm, catboost, scikit-learn, cdsapi.
Earth Engine also needs `pip install earthengine-api`, `earthengine authenticate` and `EE_PROJECT=<cloud project>`.

## Inputs
- PMD FFD workbooks (rain and temperature are separate files): `FFD-Monthly Rainfall Statement (2012..2022).xlsx`
  (one sheet per month, stations x days, 24 h rain to 08:00 PKT) and `FFd Monthly Temperature (2016-2022).xlsx`
  (one sheet per month, a MAXIMUM and a MINIMUM block in either order). Paths are `--rain-xlsx` / `--temp-xlsx`.
- Station positions: PMD stations of `realtime.json` via `public/observation-data/station-meta.csv`. The PMD
  Observatories page is read for surveyed heights (it is a check: its positions are to the arc-minute and have copy errors).
- Copernicus DEM GLO-90 COG tiles (AWS open data), averaged to 0.01 degree.
- ERA5-Land daily: Earth Engine `ECMWF/ERA5_LAND/DAILY_AGGR`. Without Earth Engine the script falls back to Open-Meteo,
  which is DEVELOPMENT ONLY (non-commercial API; ERA5 0.25 degree for rain, wind and radiation; 2021-2022 by default to stay
  inside the free daily quota).

## Outputs (git-ignored)
- `data/pmd_daily.csv|parquet` (station_id, station_name, date, tmax, tmin, rain), `data/pmd_long.parquet` (raw names and
  sheets), `data/pmd_unmatched.csv` (names without a position), `data/pmd_stations.csv`, `data/terrain_1km.npz`,
  `data/pmd_training.parquet`, `data/cv_predictions.parquet`.
- `models/`: LightGBM (`*.txt`) and CatBoost (`*.cbm`) models for tmax, tmin, rain occurrence and rain amount,
  `feature_metadata.json` (features, units, source, period, CV metrics, attribution), `cv_metrics.csv`.

## Method
- Temperatures: target = PMD - ERA5-Land; 1 km value = ERA5-Land + mean(LightGBM, CatBoost).
- Rain: P(wet day >= 1 mm, ETCCDI) x wet-day amount (LightGBM gamma, CatBoost Tweedie 1.9). ERA5 rain of the day before and
  after are predictors because PMD's window is 08:00 to 08:00 PKT; the raw baseline is ERA5 over that window.
- Validation: GroupKFold by station, so every score is for stations the model never saw. RMSE by elevation band
  (plains < 500 m, foothills 500-1500 m, mountains > 1500 m), using the surveyed height where it agrees with the DEM.

## Forecast step (`2_apply_1km_forecast.py`)
Run by `scripts/sync-terrain-weather-ecmwf.py` after it publishes `grid-hires.json` (skip with `--no-downscale`), or by hand with
`--cache <ECMWF cache dir>`. About 10 minutes, mostly model prediction on 2.6 million land cells. Writes `public/terrain-data/grid-1km/`
(generated, about 180 MB: per step a temperature + rain PNG and a wind PNG, daily extremes, 1 x 1 degree tiles for the click forecast;
`manifest.json` describes the 24-bit packing). The Terrain Explorer uses it only when its run matches `grid-hires.json`.
- Temperature: ECMWF daily max/min (`mx2t3`, `mn2t3`) corrected by the models, faded to the plain 6.5 degC/km lapse rate outside the training
  stations' range of height and delta_z; each 3-hourly step follows ECMWF's diurnal shape between the 1 km extremes.
- Live elevation bias: the models learned ERA5-Land's high-valley cold bias (about -17 degC at Gupis/Skardu), which ECMWF IFS has only about
  half of, so they over-correct IFS in the mountains (+8 degC at 62 live mountain stations on 17 Nov 2026). The remaining error at fresh
  stations (all realtime.json networks) is fitted as a smooth curve of height, pooled over 7 days (`data/live_bias_history.csv`), and removed
  at every step. Held-out check (fit on half the stations, score the other half) printed at the end and stored in the manifest.
- Rain: ECMWF rain spread inside each 0.1 degree cell by the 1 km rain pattern; each cell's water is kept exactly.
- Live nudging: elevation-aware Barnes (40 km then 15 km, 300 m height scale) of temperature, 10 m wind and rain at the newest readings,
  fading to nothing 12 h either side.
- Wind: mass-consistent over the 1 km terrain relative to the terrain ECMWF sees (2D, one layer, lid 1500 m above 25 km-smoothed terrain,
  speed-up capped at 2x). No thermal valley or slope winds.

Screening estimate, not an official PMD observation or forecast.

## V2 training pipeline (scripts in `scripts/`, not yet used by the forecast step)
- `pull_era5_upper_air.py`: ERA5 hourly datasets from Copernicus CDS (key in `~/.cdsapirc`, never in the repo), 2010 to present: CAPE/mucape, q, r, u, v at 850 and 700 hPa; quarterly pressure-level requests, yearly single-level; daily means (CAPE daily max) into `data/era5_upper/year=YYYY/month=MM/`. The CDS queue is slow and drops connections; rerun to resume.
- `pull_pardig.py`: PARDIG daily precipitation baseline (`data/precip_baseline/source=pardig`). CHIRPS was pulled and shelved (poor agreement with PMD, alignment not investigated).
- `pull_historical_stations.py`: Pakistan stations 2000 to present from NOAA ISD, IEM METAR and GHCN-Daily into `data/station_history/`. GHCN rain is excluded from training (contaminated), IEM has a few failing station-years.
- `features.py`: 3 km smoothed DEM gradients, `w_oro_850`, `MF_850`, `MF_700` (moisture flux over terrain above 1500 m) and the upper-air columns in `FEATURE_COLS`.
- `merge_training_matrix.py` then `train_downscaler_v2.py` (year-blocked CV holding out 2010 and 2022 plus 20% of northern-mountain stations; reports RMSE and rain CSI before and after, feature importance). V2 models are saved as `v2_*`; the forecast step needs ECMWF q/r at 850/700 hPa and CAPE added before it can use them.
- `pull_era5_upper_points.py` (faster route, used for the first v2 run): CDS point time series `reanalysis-era5-pressure-levels-timeseries`, one request per variable and 0.25 degree station cell (104 cells x q, r, u, v = 416 requests, about 21 h), 6-hourly samples, 850 and 700 hPa kept, daily means need all four samples; CAPE daily max comes from the regional `sl_<year>.nc` files. Output `data/era5_upper_points/` (resumable; `--assemble-only` rebuilds the month partitions). Then `merge_training_matrix.py --upper-dir data/era5_upper_points` writes `pmd_training_points.parquet`, and `train_downscaler_v2.py --matrix` that file. `--ablation cape` trains v1 + `cape_max` only (no models saved).
- First v2 result (18 Nov 2026, 452,971 rows, 121 stations): upper-air features change RMSE by at most about 0.1 degC and rain CSI by 0.01 against v1. MF_850 and MF_700 rank last; r700 and q850 carry the small rain gain. Keep v1 in production unless the rain gain in the mountains is wanted.

## Rain / snow split (`phase.py`)
- Ding et al. (2014), Journal of Hydrology 513, 154-163 (doi:10.1016/j.jhydrol.2014.03.038): snow, sleet or rain from wet-bulb temperature, relative humidity and height; equations are quoted in the module docstring and tested by hand-worked numbers and by their own definitions (Eq. 11 and 12). Sleet counts half snow, half rain (our convention). Cross-check only: the Jennings et al. (2018) logistic.
- Needs `2d` (2 m dew point) from the ECMWF sync; a cache without it gives no phase files (`manifest.phase` is null). Output: `steps/ph-NNN.png`, `tiles/ph_<lat>_<lon>.png` (red = round(255 x snow share)), and `manifest.phase` with the equations, encoding, limits and the agreement with ECMWF snowfall.
- Limits: fitted to daily means at Chinese stations and applied to 3-hourly values; no snow observations to check against; unheated gauges miss snow.

## Live-reading quality control
- `scripts/obs-qc.mjs` and `scripts/obs_qc.py` (one rule file `scripts/qc-rules.json`, shared test vectors `test/fixtures/qc-vectors.json`) mark suspect readings in `realtime.json` and `metar.json` (`qc` per row, `qc-report-*.json`, `qc-state-*.json`). `2_apply_1km_forecast.py` sets flagged temperature, wind and rain to missing, so the live elevation bias and the Barnes analysis do not use them; counts are in `assimilation.qc_excluded` and `live_bias.qc_excluded`.

## Research tools (not in the production models)
- `topo.py` + `scripts/add_topo_features.py`: multi-scale TPI / roughness / relative position / valley depth / sky view factor and daily slope radiation ratio; `train_downscaler_v2.py --ablation topo --hold Murree` is the cross-validated test (per-target feature lists in `features.py`).
- `forecast1km.classify_regime / fit_regime_bias / regime_bias`: regime-dependent live bias, shadow mode unless `2_apply_1km_forecast.py --regime-bias`.
- `kriging.py` + `scripts/krige_explore.py`: leave-one-station-out comparison of regression and kriging of the station bias.
