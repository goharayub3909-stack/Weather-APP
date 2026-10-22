# Monsoon — Pakistan Weather

A responsive, free-to-host weather dashboard for 86 Pakistani cities and regional centers. Dark/light themes, city search, saved cities and Celsius/Fahrenheit preferences work locally in the browser.

## Run locally

Use Node.js 22+ and run `npm start` in this folder. Open the server on port 3000. `npm run dev` enables server watch mode. Run `npm test` for server and weather-data tests. No package installation, build or API key is required. Alternatively, serve `public/` with any static HTTP server. JavaScript modules require HTTP hosting; double-clicking index.html is not supported.

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

The official PMD Islamabad interactive radar at `https://radar.weather.gov.pk/jbirds?site=islamabad` is embedded on demand in a dedicated viewer. It remains fixed to Islamabad when forecast cities change. PMD retains its own controls, legend and timestamps. A reload button and persistent external fallback links are included; iframe load events are not treated as evidence that imagery rendered. The user states that PMD has granted permission. The cloud proxy denied access to this new domain during integration, so PMD response headers, framing support and live imagery could not be verified. The domain has been added to the saved environment network draft; applying that setting does not itself prove access. The previous Islamabad FFD rain12 product remains available at https://ffd.pmd.gov.pk/radar?site=islamabad&product=rain12. The official Karachi FFD rain12 link remains in the interface. IMD's official weather portal is linked for India. Public products are linked, not scraped or redistributed. Blank radar areas do not imply no rain. Consult PMD for official warnings.

## Networking and validation

Browser egress: `api.open-meteo.com`, `air-quality-api.open-meteo.com`, optional `embed.windy.com`, `www.windy.com`, `radar.weather.gov.pk`, `fonts.googleapis.com`, `fonts.gstatic.com`, and linked meteorological websites. Fonts have system fallbacks. Initial external requests were denied by network policy. After the saved network settings propagated, TLS-verified live HTTP requests succeeded for the full ECMWF payload (seven days, 168 hours, no entirely missing requested field), supplemental weather and air quality. The cloud Chromium instance lacks the proxy certificate trust, so direct live browser requests remain unverified; browser interactions were tested with controlled provider responses. Map availability and imagery remain unverified. The UI displays explicit failures and never invents weather values.

Automated server/helper tests cover request configuration, 86 city coordinates, Pakistan date rollover, missing values, AQI classification, invalid requests and upstream failure. Chromium browser checks with explicitly mocked providers cover rendered forecasts, hourly charts, city selection, unit/theme switches, small-screen layout and clearing stale forecasts on failure. Mocked checks do not establish live-provider availability.
