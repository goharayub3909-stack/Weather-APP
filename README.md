# Badal PK — Pakistan Weather

A responsive, free-to-host weather dashboard with 86 pinned Pakistani cities and a searchable GeoNames index of 156,343 cities, towns, villages and geographic places. Dark/light themes, city search, saved cities and Celsius/Fahrenheit preferences work locally in the browser.

## Run locally

Use Node.js 22+ and run `npm start` in this folder. Open the server on port 3000. `npm run dev` enables server watch mode. Run `npm test` for server, weather, radar, satellite and image-credit tests. Run `python3 -m unittest discover -s test -p "*_test.py"` for radar refresh tests. To refresh radar catalogs locally, run `python3 scripts/sync-radar.py`. Refresh satellite metadata with `python3 scripts/sync-satellite.py`. No package installation, build or API key is required. Alternatively, serve `public/` with any static HTTP server. JavaScript modules require HTTP hosting; double-clicking index.html is not supported.

## Free GitHub Pages hosting

The site fetches its data directly from Open-Meteo; it does not require a paid backend. `.github/workflows/pages.yml` deploys **public/** on a push to **main**. On a public GitHub repository, enable **Settings → Pages → Source → GitHub Actions**. Commit and push this project to main to trigger deployment. Subsequent pushes update the same website. The website is deployed at https://goharayub3909-stack.github.io/Weather-APP/. Main pushes update that address. Free services have terms, availability and usage limits.

## Parameters and sources

- Main weather: Open-Meteo `/v1/forecast` with explicit `models=ecmwf_ifs025`. Seven daily forecasts and the next 24 hourly values. Temperature, feels-like, humidity, dew point, wind speed/direction/gusts, sea-level and surface pressure, precipitation, rain, snow, total/low/mid/high cloud cover, solar radiation, sunrise/sunset and daylight duration.
- Supplemental weather: a separate Open-Meteo automatically selected model request provides seven days of hourly precipitation probability, visibility, UV, WMO weather codes, CAPE, convective inhibition, freezing-level height, 500 hPa temperature/wind and convective showers. Daily probability maxima remain separate from ECMWF amounts. These cards are labeled as supplemental rather than ECMWF. A deterministic ECMWF forecast alone does not provide a rain probability. Unavailable values show a dash.
- Air quality: a separate CAMS model request via Open-Meteo's air-quality API gives US AQI, PM2.5 and PM10. This is not a local sensor observation, and it can fail independently of weather.
- All weather is a model forecast, not a live station reading. Times are Asia/Karachi. Low/high and precipitation totals refer to Pakistan calendar days. Weather codes in the hero refer to the selected model hour. Data is fetched on location change or refresh; no background polling.
- This app consumes browser-friendly ECMWF-derived data rather than parsing raw GRIB files from `data.ecmwf.int/forecasts/` directly.
- Open-Meteo's free hosted service is for non-commercial use under its terms: https://open-meteo.com/en/terms. Review limits before wider or commercial deployment. Weather data and CAMS sources are attributed in the interface.

### Rain, thunderstorms, hail ingredients and 24-hour charts

The seven-day icons treat at least 0.2 mm as a rain signal. User-defined daily amount bands are 0.2–1 mm “Isolated chance”, 2–10 mm “Scattered chance”, and the unspecified 1–2 mm gap is labeled “Rain possible”. These are explicitly amount-based labels, not estimates of geographic coverage or statistical probability. Numeric probability is a separate supplemental-model value.

WMO 95 is a thunderstorm signal; 96/99 explicitly describe thunderstorms with hail. Otherwise `public/storms.js` screens hourly **co-occurring** ingredients: CAPE >=1,000 J/kg, |CIN| <=200 J/kg, surface-to-500 hPa wind difference >=15 m/s, 500 hPa temperature <=−10°C, freezing height <=4,500 m, plus showers or a thunderstorm code. Missing inputs produce unavailable, not a low-risk diagnosis. This heuristic is not a validated hail probability, prediction of occurrence, or an official warning. Surface-to-500 hPa wind difference is not mislabeled as exact 0–6 km shear.

Four 24-hour charts (temperature/rain/wind/humidity) handle constant and all-zero series with visible lines, lone valid points with dots, and missing intervals with gaps. All-missing series retain timestamped cards with an explicit unavailable message. SVG geometry adapts to container width rather than shrinking the plot into a narrow strip. All displayed forecast/observation instants use Asia/Karachi (PKT); original METAR codes are retained unchanged inside their source details.

## Interactive maps

The old Windy embeds and PMD link-card section have been removed. Source attribution remains in the maps and footer. The weather studio uses actual model forecasts; observed radar, satellite, lightning and stations are presented separately. The Weather.com viewer has been removed.

### Windy-style Pakistan weather studio — single HTML file

`public/explorer/index.html` contains all custom HTML, CSS and modular, commented JavaScript in one file. It loads pinned OpenLayers 10.6.1 JS/CSS from jsDelivr using verified SHA-384 integrity attributes, with key-free OpenStreetMap tiles styled in dark colours and required attribution. The main website embeds this same-origin file; it is also available independently at `explorer/`.

- Center: Pakistan, 30.3753°N / 69.3451°E, zoom 5; navigation is constrained around the region.
- Parameters: wind, temperature and relative humidity. Elevations: surface/10 m, 850, 500 and 250 hPa.
- `scripts/sync-studio.py` fetches **actual ECMWF IFS 0.25° forecasts** from Open-Meteo for 304 regular display cells over 60–78°E and 23–38°N. A 1° display mesh keeps the free service affordable; interpolation does not recreate native 0.25° detail. The mesh is a regional rectangle, not a political boundary.
- The shared snapshot `public/studio-data/forecast.json` contains 48 hourly frames of temperature, RH and U/V wind at all four elevations. It is refreshed at most every six hours by the existing scheduled Pages build, rather than making 304 provider queries per visitor. The API does not supply model initialization time; fetched time and valid time are displayed separately in PKT.
- Wind U/V components come from the actual forecast speed/direction, converted to metres per second. Pressure levels below surface pressure are masked; missing values never become zeros or fabricated replacements. Total-column cloud cover is labeled as such, independent of selected pressure level.
- Canvas rasters interpolate actual fields bilinearly. Wind particles follow U/V with accelerated display motion, trails and a pause control. Parameter, elevation and hourly time changes update both raster and anchored picker. Forecast playback, Now, Refresh, valid/fetched time and old-data warnings are provided. Reduced motion, hidden browser tabs and inactive map panels suspend animation.
- No demo dataset or synthetic fallback exists. An initial/expired-data failure leaves the weather layer empty; a failed refresh may retain only a previous actual forecast whose valid times still continue, with an explicit warning.

### Natural-colour satellite — EUMETView WMS

The website uses its own Leaflet wrapper, not a third-party viewer page. `scripts/sync-satellite.py` sends a WMS 1.3.0 GetCapabilities request to `https://view.eumetsat.int/geoserver/wms`, discovers natural/true-colour image layers intersecting Pakistan, inherits geographic bounds/CRS/time dimensions, and writes `public/satellite-data/catalog.json`. It excludes NaturalEarth background layers. Names and acquisition times are advertised values, not guesses.

The preferred verified layer is **`msg_iodc:rgb_natural` (Natural Colour RGB — MSG — Indian Ocean)**, which covers Pakistan. A separately labeled HRV RGB option (`msg_iodc:rgb_eview`) offers higher-resolution visible cloud detail, with possible coverage gaps and different colour interpretation. Retina tile requests improve display density without claiming new native detail. The browser requests standard GetMap tiles with an explicit layer, CRS, WMS version and acquisition `TIME`. Leaflet handles WMS 1.3.0 EPSG:4326 axis order when that CRS is needed; EPSG:3857 is preferred when advertised. Layer selection, timeline/playback, opacity, zoom/pan and Pakistan recenter controls are included. PKT acquisition times are shown on the map and below it; catalog retrieval time is labeled separately. Major-city labels are drawn above the satellite images, with more regional labels at closer zoom. Failed tiles produce a failure/partial-coverage message. Natural colour needs daylight and can appear dark at night.

Capabilities and a representative Pakistan GetMap PNG were fetched live with TLS verification. Browser checks rendered real WMS tile responses through a TLS-verified test relay, exercised controls and image failure, and verified mobile layout. The scheduled Pages workflow refreshes the capabilities catalog at minutes 17 and 47; runs can be delayed. The browser refresh button reloads the deployed catalog, rather than forcing a server-side build.

### Direct observed rain radar

Radar imagery is plotted on **Badal PK's dark OpenStreetMap basemap**, not PMD map images or an iframe. The user-provided HAR supplied public catalog schemas and geographic bounds; PMD's public app source confirmed its relative PNG paths. Live catalogs and PNGs were then retrieved with verified HTTPS and an identified an identified application user agent user agent. No API key, captured cookie or session header is used.

- Stations: Islamabad and Karachi. Products: Surface-R, Accumulated-R (12h), CAPPI-R (01km), with their own supplied bounds and radii.
- Station/product selectors, playback, frame slider, latest available frame, opacity, pan/zoom and recenter controls are included. Station selection is independent of forecast city.
- The map shows the selected/playback frame timestamp. Separate labels show the latest available image timestamp and a running current-time clock in PKT. At the user’s PKT display setting, PMD strings are treated as Pakistan local time without changing their clock values. The map discloses that the source omits a timezone offset; that source-time assumption is not independently verified. Old timestamps are flagged.
- Product legend PNGs are included unchanged and credited. Radar PNGs load directly as transparent image overlays. A failed frame removes the previous overlay and pauses playback.
- The HAR itself is not published. Only public station/frame metadata and official legends are included. Cookies, request headers, session details and unrelated district geometry are excluded.

### Lightning — WeatherWalay public feeds

The selected WeatherWalay dashboard exposes a shared live buffer and a history API. `public/lightning.js` integrates these data feeds directly into Badal PK's own Leaflet map, without embedding or copying the provider dashboard. Positions are filtered to the Pakistan region. The shared buffer is polled every 15 seconds only while the panel is active and the document is visible; no per-visitor upstream stream is opened. Live/history observations are deduplicated by position and timestamp. History supports 1/3/6/12/24-hour windows and 15-minute playback buckets; yellow bolt glyphs are drawn on a shared canvas, capped at the newest 8,000. Three concentric kilometre distance rings follow the selected place/current browser location; an outer-radius selector supports 50/100/200 km. Strike popups show PKT time and distance from that centre. Failures preserve explicit fetch/observation timestamps. Blank areas are not a safety indication.

### Airports and WeatherWalay station observations

`scripts/sync-metar.py` retrieves the free official NOAA Aviation Weather Center METAR API, filters valid Pakistan OP-prefixed airports and keeps the latest report per airport. The same-origin snapshot preserves observation epoch times and raw METARs. Wind is displayed in knots and pressure in hPa. Reports older than three hours are marked as old.

WeatherWalay staff authentication is performed only in GitHub Actions using repository secrets `WEATHERWALAY_USERNAME` and `WEATHERWALAY_PASSWORD`. Session cookies and bootstrap tokens stay in process memory. Never add credentials to public JavaScript or JSON. `scripts/sync-stations.py` authenticates, reads the bootstrap permutation/token, and retrieves the feed using an in-memory cookie jar. It publishes only validated station IDs/names/coordinates, current temperature, RH, wind and provider display times. Pakistan-region records are retained and IMD station records excluded. A timestamp without year/timezone is preserved verbatim and labeled age unverified, never assigned today’s date. Previous sanitized snapshots are retained on failure. The diagnostic workflow records only sanitized station schema/endpoint information. Station integration status is visible in the map panel.

### Compact interface and place search

Maps share an accessible tab panel, with inactive playback paused. The dashboard uses compact weather-specific palettes and original SVG icons. The station panel has colour-by-parameter controls, count summaries and dark instrument-card popups, with explicit observation age. Airport RH is derived from measured temperature/dew point and labeled derived. The first visit requests native browser geolocation; granted permission selects a transient “Your location” forecast, denial leaves city search available, and late results do not override a manual selection. GPS coordinates are not stored locally. The browser shares rounded coordinates with the requested weather/photo providers to retrieve local data. The national GeoNames gazetteer is CC BY 4.0 and credited in the UI. It is fetched and indexed in a module Web Worker on first search focus, keeping parsing and ranking off the main thread. The 86 common cities work immediately; new selections are retained locally. Some village names are duplicated in the source, and coordinates should be checked before relying on a place forecast.

### City backgrounds

Search/selection updates a translucent background illustration for every city. Where verified images are available, the site loads local freely licensed photographs: 27 cities currently have photos. Remaining places retain original city/landmark illustrations. An on-demand gallery discovers up to 24 freely licensed, geotagged Commons photographs within 10 km of the selected place, with source/artist/licence links. These are labeled nearby photographs, and may show surrounding features. Google image results are not scraped. `scripts/prepare-city-images.py` resolves Wikipedia pages, checks their coordinates against the selected city, rejects obvious flags/logos, retrieves Commons licensing metadata, and downloads original thumbnail bytes. The site shows artist, source and license links. `public/city-data/catalog.json` records credits; photos remain unmodified and transparency is CSS-only. Photos are retained in the repository and do not need API access at runtime.

### Automatic radar catalog refresh on free Pages hosting

PMD's captured JSON responses did not advertise cross-origin access. `scripts/sync-radar.py` retrieves and validates both catalogs server-side during GitHub Actions builds, then publishes one same-origin `public/radar-data/catalog.json`. The workflow runs on main pushes, manual dispatch and at minutes 17 and 47 of each hour. Scheduled GitHub runs can be delayed or disabled after repository inactivity; refresh is not guaranteed to be real time.

The refresh script uses standard Python, verified HTTPS and public resources only. If PMD cannot be reached, it keeps previous catalog data and records the failed attempt. The workflow first attempts to retain the latest published catalog, so a transient outage need not revert to the initial capture. Refreshing data in the browser reloads the most recently deployed catalog; it does not force an upstream PMD scrape. Initial checked-in metadata was successfully refreshed from PMD during development. GitHub-hosted radar refresh and Pages delivery were verified during deployment.

Leaflet 1.9.4 is vendored locally with its license; JS and CSS were verified against the official release SRI SHA-256 digests. No API keys are required. PMD link cards and external PMD warning links were removed as requested; source credits remain. The user states that PMD has granted integration permission. Consult PMD for official warnings.

## Validation

Run `npm test` and `python3 -m unittest discover -s test -p "*_test.py"`. Browser checks cover forecast rendering/units/themes/errors, national place search and persistence, responsive layout, one active map panel, radar timelines/products, satellite acquisition times/failed imagery, lightning history/playback, airport popups and key-free basemap rendering. Actual PMD/EUMETSAT imagery, NOAA reports, lightning feeds and OSM tile bytes were exercised through a normal TLS-verified relay because the cloud Chromium instance lacks the proxy certificate trust. TLS verification was not disabled. The studio was exercised with the actual fetched 304-cell ECMWF snapshot, 48 forecast hours, moving particles, all elevations, picker/time updates and empty failure states. Main-chart edge-case fixtures are used only in tests, never in the deployed UI.

The Node server and static Pages paths must both serve all module/worker/data files. No build or dependency install is needed. Free services have availability, attribution and usage limits; scheduled GitHub refresh times are not guaranteed.
