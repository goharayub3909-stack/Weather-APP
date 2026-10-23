# Soil sensor integration contract

The module is prepared for future devices. No devices or measurements are simulated. The default `public/sensor-data/soil.json` has an empty `devices` array. Choose a device explicitly under Farmers → Field decisions; location changes detach it. A nearby sensor is not silently assigned to a field.

A vendor bridge should translate HTTP, MQTT or manufacturer-specific messages into JSON with `schema_version: 1` and a `devices` array. Each device has `id` (unique), `field_id` (required explicit field assignment), `name`, `latitude`, `longitude`, and a `reading` object. Reading fields:

| Field | Required interpretation |
| --- | --- |
| `observed_at` | ISO 8601 with explicit UTC / offset; sensor measurement time, not receipt time |
| `quality` | `valid`, `suspect` or `invalid`; only valid readings can populate planning inputs |
| `temperature_c` | Actual measured soil temperature in °C |
| `temperature_depth_cm` | Temperature probe depth below ground in cm |
| `moisture_vwc_percent` | Point volumetric water content in percent; 23 means 23%, not 0.23 |
| `moisture_depth_cm` | Point moisture probe depth in cm |
| `root_zone_moisture_vwc_percent` | Optional representative root-zone average explicitly calculated by the bridge / instrument |
| `root_zone_depth_cm` | Depth represented by that root-zone average |
| `battery_percent` | Optional 0–100 device battery value |

Unknown values must be null / omitted, never zero-filled. A point moisture reading does not automatically qualify as a root-zone average. Temperature older than 12 hours and moisture older than 24 hours are not used for planning. Future timestamps beyond five minutes, unknown timezones and invalid quality are rejected for use. Source timestamps are displayed in PKT. The browser validates coordinates, units encoded in field names, physical limits and device identity; secret / unknown device properties are discarded.

For a static Pages deployment, a trusted server or workflow can write the canonical sanitized JSON to `public/sensor-data/soil.json`. The config file selects only a same-origin feed. Never put vendor passwords, API keys, MQTT credentials or signed private endpoints in public files.

For the included Node server, set `SOIL_SENSOR_FEED_URL` to your HTTPS vendor-bridge endpoint and, if required, `SOIL_SENSOR_API_KEY` as a server environment secret. `/sensor-data/config.json` then selects `/api/soil-sensors`. The server sends the bearer token upstream and publishes only the validated canonical readings; failed connections return a generic error and no invented measurements. HTTP ingestion, hardware drivers, calibration, vendor authentication and durable soil history must be supplied by the future bridge. The separate live-weather-station archive does not claim to contain soil sensors.

Field capacity, wilting point, representative rooting depth, crop Kc and efficiency must be confirmed locally. The irrigation calculation is a transparent planning scenario, not a sensor-controlled irrigation actuator.
