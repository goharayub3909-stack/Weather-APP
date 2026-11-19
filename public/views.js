// Which top-level view a URL hash opens. Each view is its own page: only one is visible at a time.
export const VIEW_IDS = ['weather-view', 'maps-view', 'health-view', 'climate-view', 'flood-view', 'farmers-view'];
const HASH_TO_VIEW = {
  overview: 'weather-view', hourly: 'weather-view', details: 'weather-view',   // #hourly and #details scroll inside the Weather view
  maps: 'maps-view', health: 'health-view', climate: 'climate-view', flood: 'flood-view', farmers: 'farmers-view',
};
export const viewFor = hash => HASH_TO_VIEW[String(hash || '').replace(/^#/, '')] || 'weather-view';
export const HEADINGS = {
  'weather-view': ['Pakistan, at a glance.', 'YOUR DAILY WEATHER COMPANION'],
  'maps-view': ['Watch the weather move.', 'SEE THE BIGGER PICTURE'],
  'health-view': ['Health & environment.', 'SCREENING, NOT DIAGNOSIS'],
  'climate-view': ['Climate & hazard risk.', 'ERA5 · IMD CRITERIA · STATION · ECMWF'],
  'flood-view': ['Flood risk, simulated.', 'FLOODAI · SCREENING, NOT A WARNING'],
  'farmers-view': ['Weather for your farm.', 'GROW WITH THE FORECAST'],
};
// In-page anchors inside the Weather view; every other hash opens its view at the top.
export const anchorFor = hash => ['hourly', 'details'].includes(String(hash || '').replace(/^#/, '')) ? String(hash).replace(/^#/, '') : null;
