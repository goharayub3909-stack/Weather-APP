# Monsoon — Pakistan Weather

A responsive, free-to-host weather dashboard for 86 Pakistani cities and regional centers. Dark/light themes, city search, saved cities and Celsius/Fahrenheit preferences work locally in the browser.

## Run locally

Use Node.js 22+ and run `npm start` in this folder. Open the server on port 3000. `npm run dev` enables server watch mode. Run `npm test` for server, weather, radar, satellite and image-credit tests. Run `python3 -m unittest discover -s test -p "*_test.py"` for radar refresh tests. To refresh radar catalogs locally, run `python3 scripts/sync-radar.py`. Refresh satellite metadata with `python3 scripts/sync-satellite.py`. No package installation, build or API key is required. Alternatively, serve `public/` with any static HTTP server. JavaScript modules require HTTP hosting; double-clicking index.html is not supported.

## Free GitHub Pages hosting

The site fetches its data directly from Open-Meteo; it does not require a paid backend. `.github/workflows/pages.yml` deploys **public/** on a push to **main**. On a public GitHub repository, enable **Settings → Pages → Source → GitHub Actions**. Commit and push this project to main to trigger deployment. Subsequent pushes update the same website. This configuration has been prepared locally; GitHub Pages has not yet been enabled, deployed or verified. Free services have terms, availability and usage limits.

## Parameters and sources

- Main weather: Open-Meteo `/v1/forecast` with explicit `models=ecmwf_ifs025`. Seven daily forecasts and the next 24 hourly values. Temperature, feels-like, humidity, dew point, wind speed/direction/gusts, sea-level and surface pressure, precipitation, rain, snow, total/low/mid/high cloud cover, solar radiation, sunrise/sunset and daylight duration.
- Supplemental weather: a separate Open-Meteo automatically selected model request provides hourly precipitation probability, visibility and UV index. These cards are labeled as supplemental rather than ECMWF. A deterministic ECMWF forecast alone does not provide a rain probability. Unavailable values show a dash.
- Air quality: a separate CAMS model request via Open-Meteo's air-quality API gives US AQI, PM2.5 and PM10. This is not a local sensor observation, and it can fail independently of weather.
- All weather is a model forecast, not a live station reading. Times are Asia/Karachi. Low/high and precipitation totals refer to Pakistan calendar days. Weather codes in the hero refer to the selected model hour. Data is fetched on location change or refresh; no background polling.
- This app consumes browser-friendly ECMWF-derived data rather than parsing raw GRIB files from `data.ecmwf.int/forecasts/` directly.
- Open-Meteo's free hosted service is for non-commercial use under its terms: https://open-meteo.com/en/terms. Review limits before wider or commercial deployment. Weather data and CAMS sources are attributed in the interface.

## Interactive maps

The old Windy embeds and PMD link-card section have been removed. Source attribution remains in the maps and footer. The live weather forecast dashboard remains separate from the clearly labeled synthetic weather studio.

### Windy-style Pakistan weather studio — single HTML file

`public/explorer/index.html` contains all custom HTML, CSS and modular, commented JavaScript in one file. It loads pinned OpenLayers 10.6.1 JS/CSS from jsDelivr using verified SHA-384 integrity attributes, with CARTO Dark Matter tiles and required attribution. The main website embeds this same-origin file; it is also available independently at `explorer/`.

- Center: Pakistan, 30.3753°N / 69.3451°E, zoom 5; navigation is constrained around the region.
- Parameters: wind, temperature and relative humidity. Elevations: surface/10 m, 850, 500 and 250 hPa.
- A structured, deterministic **mock ECMWF-style grid** stores U/V wind (m/s), temperature, humidity and cloud cover at every elevation. The study grid covers 60–78.5°E and 23–38°N; it is not an authoritative political boundary. Values outside this region are not extrapolated.
- Canvas rasters interpolate grid values bilinearly and use parameter-specific color ramps and legends. Wind particles advect with U/V in geographic space and preserve trails. Panning clears old trails. Reduced-motion preferences and background-tab visibility pause animation.
- An anchored map picker shows temperature, knots and meteorological wind direction, RH and cloud cover; all values update when the elevation/parameter changes. Surface wind is at 10 m; surface temperature/RH are at 2 m.
- Prominent demo badges distinguish this synthetic studio from live ECMWF forecasts and observed radar/satellite data. No studio values should be used for planning.

### Natural-colour satellite — EUMETView WMS

The website uses its own Leaflet wrapper, not a third-party viewer page. `scripts/sync-satellite.py` sends a WMS 1.3.0 GetCapabilities request to `https://view.eumetsat.int/geoserver/wms`, discovers natural/true-colour image layers intersecting Pakistan, inherits geographic bounds/CRS/time dimensions, and writes `public/satellite-data/catalog.json`. It excludes NaturalEarth background layers. Names and acquisition times are advertised values, not guesses.

The preferred verified layer is **`msg_iodc:rgb_natural` (Natural Colour RGB — MSG — Indian Ocean)**, which covers Pakistan. The browser requests standard GetMap tiles with an explicit layer, CRS, WMS version and acquisition `TIME`. Leaflet handles WMS 1.3.0 EPSG:4326 axis order when that CRS is needed; EPSG:3857 is preferred when advertised. Layer selection, timeline/playback, opacity, zoom/pan and Pakistan recenter controls are included. UTC and PKT acquisition times are shown on the map and below it; catalog retrieval time is labeled separately. Failed tiles produce a failure/partial-coverage message. Natural colour needs daylight and can appear dark at night.

Capabilities and a representative Pakistan GetMap PNG were fetched live with TLS verification. Browser checks rendered real WMS tile responses through a TLS-verified test relay, exercised controls and image failure, and verified mobile layout. The scheduled Pages workflow refreshes the capabilities catalog at minutes 17 and 47; runs can be delayed. The browser refresh button reloads the deployed catalog, rather than forcing a server-side build.

### Direct observed rain radar

Radar imagery is plotted on **Monsoon's CARTO Dark Matter/OpenStreetMap basemap**, not PMD map images or an iframe. The user-provided HAR supplied public catalog schemas and geographic bounds; PMD's public app source confirmed its relative PNG paths. Live catalogs and PNGs were then retrieved with verified HTTPS and an identified `MonsoonWeather/1.0` user agent. No API key, captured cookie or session header is used.

- Stations: Islamabad and Karachi. Products: Surface-R, Accumulated-R (12h), CAPPI-R (01km), with their own supplied bounds and radii.
- Station/product selectors, playback, frame slider, latest available frame, opacity, pan/zoom and recenter controls are included. Station selection is independent of forecast city.
- The map shows the selected/playback frame timestamp. Separate labels show the latest available image timestamp and a running current-time clock in PKT. PMD did not specify the frame timestamp timezone, so those values are displayed as supplied; UTC/PKT conversion is not invented. Old timestamps are flagged.
- Product legend PNGs are included unchanged and credited. Radar PNGs load directly as transparent image overlays. A failed frame removes the previous overlay and pauses playback.
- The HAR itself is not published. Only public station/frame metadata and official legends are included. Cookies, request headers, session details and unrelated district geometry are excluded.

### Lightning — WetterOnline only

The only configured lightning source is the user-supplied `https://www.wetteronline.de/blitzradar/pakistan?wrx=32.07,71.51&wrm=7.26`. Its viewer is loaded on demand, with a direct fallback link. No other provider or synthetic lightning data is substituted. WetterOnline returned HTTP 202 with `x-amzn-waf-action: challenge` to cloud inspection, so successful iframe rendering and actual lightning observations remain **unverified**. The app does not treat an iframe load event as proof of lightning availability. Viewer timestamps and legends belong to WetterOnline; they cannot be read across origins.

### City backgrounds

Search/selection updates a translucent background illustration for every city. Where verified images are available, the site loads local freely licensed photographs: 27 cities currently have photos. Remaining cities retain original city/landmark illustrations, not mislabeled photographs. `scripts/prepare-city-images.py` resolves Wikipedia pages, checks their coordinates against the selected city, rejects obvious flags/logos, retrieves Commons licensing metadata, and downloads original thumbnail bytes. The site shows artist, source and license links. `public/city-data/catalog.json` records credits; photos remain unmodified and transparency is CSS-only. Photos are retained in the repository and do not need API access at runtime.

### Automatic radar catalog refresh on free Pages hosting

PMD's captured JSON responses did not advertise cross-origin access. `scripts/sync-radar.py` retrieves and validates both catalogs server-side during GitHub Actions builds, then publishes one same-origin `public/radar-data/catalog.json`. The workflow runs on main pushes, manual dispatch and at minutes 17 and 47 of each hour. Scheduled GitHub runs can be delayed or disabled after repository inactivity; refresh is not guaranteed to be real time.

The refresh script uses standard Python, verified HTTPS and public resources only. If PMD cannot be reached, it keeps previous catalog data and records the failed attempt. The workflow first attempts to retain the latest published catalog, so a transient outage need not revert to the initial capture. Refreshing data in the browser reloads the most recently deployed catalog; it does not force an upstream PMD scrape. Initial checked-in metadata was successfully refreshed from PMD during development. GitHub-hosted refresh execution still needs verification after deployment.

Leaflet 1.9.4 is vendored locally with its license; JS and CSS were verified against the official release SRI SHA-256 digests. No API keys are required. PMD link cards and external PMD warning links were removed as requested; source credits remain. The user states that PMD has granted integration permission. Consult PMD for official warnings.

## Networking and validation

Browser egress: `api.open-meteo.com`, `air-quality-api.open-meteo.com`, `view.eumetsat.int`, `radar.weather.gov.pk`, `basemaps.cartocdn.com`, `tile.openstreetmap.org`, optional `www.wetteronline.de`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com`, and linked meteorological websites. Fonts have system fallbacks. Initial external requests were denied by network policy. After the saved network settings propagated, TLS-verified live HTTP requests succeeded for the full ECMWF payload (seven days, 168 hours, no entirely missing requested field), supplemental weather and air quality. The cloud Chromium instance lacks the proxy certificate trust, so direct live browser requests remain unverified; browser interactions were tested with controlled provider responses. PMD live catalogs and PNGs have now been verified over trusted HTTPS; direct cloud Chromium requests still need the correct proxy trust. WetterOnline viewer imagery remains unverified because its automated response is a WAF challenge. The UI displays explicit failures and never invents weather values.

Automated server/helper tests cover request configuration, 86 city coordinates, Pakistan date rollover, missing values, AQI classification, invalid requests and upstream failure. Chromium browser checks with explicitly mocked providers cover rendered forecasts, hourly charts, city selection, unit/theme switches, small-screen layout and clearing stale forecasts on failure. Mocked checks do not establish live-provider availability. Additional Node/Python tests cover actual PMD catalog geometry, safe image paths, product filtering, timestamp ordering and preserving data on refresh failure. The radar browser test serves the app at a repository-prefixed static URL, renders actual PMD PNG bytes through a TLS-verified test relay, and exercises station/product changes, timeline, playback, opacity, old-data warnings and removal of overlays after image failure. OSM tiles are blocked in that test; direct end-to-end GitHub Pages delivery remains to be verified.
