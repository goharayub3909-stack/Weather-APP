# Monsoon — Pakistan Weather

A responsive, free-to-host weather dashboard for 86 Pakistani cities and regional centers. Dark/light themes, city search, saved cities and Celsius/Fahrenheit preferences work locally in the browser.

## Run locally

Use Node.js 22+ and run `npm start` in this folder. Open the server on port 3000. `npm run dev` enables server watch mode. Run `npm test` for server, weather and radar tests. Run `python3 -m unittest discover -s test -p "*_test.py"` for radar refresh tests. To refresh radar catalogs locally, run `python3 scripts/sync-radar.py`. No package installation, build or API key is required. Alternatively, serve `public/` with any static HTTP server. JavaScript modules require HTTP hosting; double-clicking index.html is not supported.

## Free GitHub Pages hosting

The site fetches its data directly from Open-Meteo; it does not require a paid backend. `.github/workflows/pages.yml` deploys **public/** on a push to **main**. On a public GitHub repository, enable **Settings → Pages → Source → GitHub Actions**. Commit and push this project to main to trigger deployment. Subsequent pushes update the same website. This configuration has been prepared locally; GitHub Pages has not yet been enabled, deployed or verified. Free services have terms, availability and usage limits.

## Parameters and sources

- Main weather: Open-Meteo `/v1/forecast` with explicit `models=ecmwf_ifs025`. Seven daily forecasts and the next 24 hourly values. Temperature, feels-like, humidity, dew point, wind speed/direction/gusts, sea-level and surface pressure, precipitation, rain, snow, total/low/mid/high cloud cover, solar radiation, sunrise/sunset and daylight duration.
- Supplemental weather: a separate Open-Meteo automatically selected model request provides hourly precipitation probability, visibility and UV index. These cards are labeled as supplemental rather than ECMWF. A deterministic ECMWF forecast alone does not provide a rain probability. Unavailable values show a dash.
- Air quality: a separate CAMS model request via Open-Meteo's air-quality API gives US AQI, PM2.5 and PM10. This is not a local sensor observation, and it can fail independently of weather.
- All weather is a model forecast, not a live station reading. Times are Asia/Karachi. Low/high and precipitation totals refer to Pakistan calendar days. Weather codes in the hero refer to the selected model hour. Data is fetched on location change or refresh; no background polling.
- This app consumes browser-friendly ECMWF-derived data rather than parsing raw GRIB files from `data.ecmwf.int/forecasts/` directly.
- Open-Meteo's free hosted service is for non-commercial use under its terms: https://open-meteo.com/en/terms. Review limits before wider or commercial deployment. Weather data and CAMS sources are attributed in the interface.

## Maps and official radar

Windy embeds are opt-in. Satellite imagery, model cloud forecasts and available radar are separate layers. No guarantee is made about country/station coverage or successful embedding. External full-map links are provided.

PMD radar is plotted **directly on our own Leaflet map**, not in an iframe. The user-provided HAR supplied the public catalog schema and exact image bounds. Inspection of PMD's public application scripts confirmed that image paths resolve below `https://radar.weather.gov.pk/jbirds/`. PMD's catalogs and real PNG frames were subsequently retrieved with TLS verification and an identified `MonsoonWeather/1.0` user agent. No authentication, PMD API key or captured session headers are used.

- Stations: Islamabad and Karachi; products: Surface-R, Accumulated-R (12h), CAPPI-R (01km). Each uses its own PMD-provided geographic bounds and radius.
- Controls: station/product selection, play/pause, frame slider, latest available frame, opacity, pan/zoom and recenter. Station selection is independent of forecast city.
- Official PMD product legend PNGs are included unchanged and credited. Radar PNGs load directly from PMD as image overlays (no canvas pixel extraction and no JSON CORS workaround in the browser). Transparent pixels are preserved. OpenStreetMap provides the attributed basemap; only viewport tiles are requested, without bulk download or prefetch.
- The uploaded HAR itself is **not** published. Only public station/frame metadata and official product legends are included. Cookies, request headers, session information and unrelated district geometry are excluded.
- PMD timestamps have no timezone declaration in the inspected catalogs. The UI displays them as provided and does not silently assume UTC or PKT. A timestamp date before today's UTC date triggers an explicit old-data warning. Catalog fetch time is labeled separately; fetching a catalog successfully does not imply new radar observations. At validation, Islamabad's latest supplied date was October 20, 2026, while Karachi's was October 22, 2026.
- A failed image load removes the previous overlay, pauses playback and shows a failure message. Blank radar coverage does not imply no precipitation.

### Automatic radar catalog refresh on free Pages hosting

PMD's captured JSON responses did not advertise cross-origin access. `scripts/sync-radar.py` retrieves and validates both catalogs server-side during GitHub Actions builds, then publishes one same-origin `public/radar-data/catalog.json`. The workflow runs on main pushes, manual dispatch and at minutes 17 and 47 of each hour. Scheduled GitHub runs can be delayed or disabled after repository inactivity; refresh is not guaranteed to be real time.

The refresh script uses standard Python, verified HTTPS and public resources only. If PMD cannot be reached, it keeps previous catalog data and records the failed attempt. The workflow first attempts to retain the latest published catalog, so a transient outage need not revert to the initial capture. Refreshing data in the browser reloads the most recently deployed catalog; it does not force an upstream PMD scrape. Initial checked-in metadata was successfully refreshed from PMD during development. GitHub-hosted refresh execution still needs verification after deployment.

Leaflet 1.9.4 is vendored locally with its license; JS and CSS were verified against the official release SRI SHA-256 digests. No API keys are required. Official FFD Karachi and IMD links remain available for their separate products. The user states that PMD has granted integration permission. Consult PMD for official warnings.

## Networking and validation

Browser egress: `api.open-meteo.com`, `air-quality-api.open-meteo.com`, optional `embed.windy.com`, `www.windy.com`, `radar.weather.gov.pk`, `tile.openstreetmap.org`, `fonts.googleapis.com`, `fonts.gstatic.com`, and linked meteorological websites. Fonts have system fallbacks. Initial external requests were denied by network policy. After the saved network settings propagated, TLS-verified live HTTP requests succeeded for the full ECMWF payload (seven days, 168 hours, no entirely missing requested field), supplemental weather and air quality. The cloud Chromium instance lacks the proxy certificate trust, so direct live browser requests remain unverified; browser interactions were tested with controlled provider responses. PMD live catalogs and PNGs have now been verified over trusted HTTPS; direct cloud Chromium requests still need the correct proxy trust. Windy imagery remains unverified. The UI displays explicit failures and never invents weather values.

Automated server/helper tests cover request configuration, 86 city coordinates, Pakistan date rollover, missing values, AQI classification, invalid requests and upstream failure. Chromium browser checks with explicitly mocked providers cover rendered forecasts, hourly charts, city selection, unit/theme switches, small-screen layout and clearing stale forecasts on failure. Mocked checks do not establish live-provider availability. Additional Node/Python tests cover actual PMD catalog geometry, safe image paths, product filtering, timestamp ordering and preserving data on refresh failure. The radar browser test serves the app at a repository-prefixed static URL, renders actual PMD PNG bytes through a TLS-verified test relay, and exercises station/product changes, timeline, playback, opacity, old-data warnings and removal of overlays after image failure. OSM tiles are blocked in that test; direct end-to-end GitHub Pages delivery remains to be verified.
