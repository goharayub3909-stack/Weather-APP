# Health, wellness & environmental disease intelligence

`public/health-engine.js` turns station readings (plus a short history) into eleven weather-based health and crop-pest screening indices for Pakistan. Each index has a 0–100 score, a level (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`, or `UNKNOWN` when data is insufficient), English and Urdu warnings, and preventive actions.

**It is a screening tool.** It does not diagnose illness, forecast case numbers or replace NIH, provincial health, PDMA or plant-protection advisories. Every threshold sits in `CONFIG` so it can be calibrated locally.

```js
import {assessHealth, assessOutlook} from './health-engine.js';
const result = assessHealth(currentReading, historyReadings);          // now
const outlook = assessOutlook(currentReading, historyReadings, forecastReadings); // next 72 h, every 3 h
```

Sample input and output: `docs/health-sample-request.json`, `docs/health-sample-response.json` (illustrative scenario, not live data). Response schema: `docs/health-response.schema.json`. Tests: `test/health-engine.test.js`.

## Input

One reading per call, plus earlier readings at any interval (up to 72 h are used). Timestamps must be ISO 8601 with an explicit offset.

| Field | Unit | Needed for |
| --- | --- | --- |
| `timestamp` | ISO 8601 + offset | all (clock rules use Pakistan time, UTC+5) |
| `temp_c`, `rh` | °C, % | dengue, malaria, rust, cotton, arthritis, heat, asthma, flu |
| `pressure_hpa` | hPa | migraine, arthritis (needs history) |
| `wind_speed_ms` | m/s | smog |
| `pm25` (+ optional `pm25_source: 'model'`) | µg/m³ | smog, asthma |
| `soil_moisture` | % volumetric | locust |
| `soil_temp_c` (optional) | °C, 0–10 cm | locust |
| `rain_acc_48h` (optional `rain_acc_72h`) | mm | dengue, locust |
| `vegetation_dry` (optional) | boolean | locust |
| `pm10`, `solar_wm2` (optional) | | accepted, not yet used |

Mapping from the Sheikhupura dashboard: `AirTC`→`temp_c`, `RH`→`rh`, `B_Pressure`→`pressure_hpa`, `WindSpeed`→`wind_speed_ms` (stored in m/s; the dashboard shows km/h), `SoilMoist` and `SoilTemp` at 5 cm→`soil_moisture`, `soil_temp_c`, and `rain_acc_48h` = sum of `Rain_mm_Tot` over the last 48 h. The Davis stations do not measure PM2.5, so supply the CAMS value from the site's air-quality request with `pm25_source: 'model'`.

## Rules as implemented

| Module | Trigger | Needs history |
| --- | --- | --- |
| Dengue / Chikungunya | Temp 25–30 °C, RH ≥ 75 %, rain ≥ 1 mm in 48–72 h. If every hour of the last 48 h is above 28 °C, the level rises one step and is labelled "High Viral Transmission Potential". Flags 06:00–09:00 and 16:30–18:30 PKT. | 48 h (accelerator) |
| Malaria | Lowest temperature 20–28 °C and mean RH ≥ 70 % across the latest 21:00–05:00 PKT night | the night |
| Locust | Soil moisture > 60 %, soil temp 25–35 °C, and rain ≥ 1 mm or vegetation flagged dry | no |
| Wheat yellow rust | More than 6 consecutive night hours (19:00–07:00) at 8–13 °C with RH > 85 %; Nov–Apr only | 24 h |
| Cotton whitefly / pink bollworm | ≥ 6 h above 38 °C in 24 h and a humidity fall of ≥ 20 points within 6 h from ≥ 60 %; Sep–Nov only | 24 h |
| Migraine | Pressure falls > 3.0 hPa within any 3 h window (last 12 h) | 12 h |
| Arthritis | Pressure fall > 2 hPa in 3 h, RH > 80 %, temp < 18 °C | 12 h |
| Heat stress | Estimated WBGT: > 31 °C critical, > 28 °C high, ≥ 25 °C moderate; heat index reported | no |
| Smog | PM2.5 > 150 µg/m³ is HIGH; with wind < 2 m/s it is CRITICAL ("Severe Temperature Inversion Smog…"); 75–150 is MODERATE | no |
| Asthma | Temperature fall > 5 °C within 4 h, plus PM2.5 > 75 µg/m³ or RH > 80 % | 12 h |
| Influenza / RSV | RH < 40 % and temp < 16 °C | no |

**Scoring.** Each criterion earns a closeness of 0–1: 0.75 at the threshold, rising to 1 with margin, and falling to 0 as it gets further away. The score is the mean closeness × 100. The level is `HIGH` when every criterion is met, `MODERATE` when not all are met but the score is at least 50, otherwise `LOW`. `CRITICAL` comes only from explicit escalators (dengue accelerator, WBGT > 31 °C, inversion smog).

## Missing and poor data

- Values outside plausible limits become `null` and are listed in `data_quality.invalid_inputs`; absent values are listed in `missing_inputs`. Nothing is zero-filled.
- A criterion with no input has `met: null`. A module with unknown inputs is `partial`: it cannot reach `HIGH`, and cannot be `LOW` on unknowns alone. With nothing evaluable it is `UNKNOWN`.
- Duration rules need coverage. An observed pressure or temperature fall counts even from sparse data, but "no fall" needs at least half of the look-back window; the 48 h accelerator needs 90 %.
- No soil-temperature sensor: air temperature is used as a proxy and the locust level is capped at `MODERATE` with low confidence.
- A reading older than 3 h makes every module `UNKNOWN`.

## Assumptions to confirm

1. **Soil moisture > 60 %** means near-saturated soil. Locust-breeding sands rarely reach that, so calibrate against local sensor data and the Department of Plant Protection's field records.
2. **Inversion** is inferred from calm surface wind and PM2.5. It is not measured, and the response says so.
3. **WBGT** uses an empirical air-temperature and humidity formula, not a globe thermometer. Direct sun, still air and heavy work make real heat stress higher.
4. **Leaf wetness** for yellow rust is approximated by RH > 85 % at night; no leaf-wetness sensor is used.
5. **Cotton "extended thermal stress" and "humidity drops"** are read as 6 h above 38 °C and a 20-point fall in 6 h. Confirm with an entomologist.
6. **Wetness for dengue** is rain ≥ 1 mm in 48–72 h, which ignores containers filled by people.
7. **Night windows** (malaria 21:00–05:00, rust 19:00–07:00) follow the brief and agronomic convention.
8. **Urdu text** should be reviewed by a native-speaking health communicator before publication, and the actions by a clinician and an agronomist.
9. The thresholds have not been validated against Pakistani case or outbreak data. That is a necessary step before using any index for decisions beyond awareness.

## Next steps for the website

1. A `health-panel.js` that reads the station feed, calls `assessHealth` and `assessOutlook`, and renders cards with a language toggle (English, اردو).
2. A feed adapter for the Sheikhupura dashboard (including the 48 h rainfall sum).
3. A Health tab and its section in `index.html`, styled with the existing card and alert components.
