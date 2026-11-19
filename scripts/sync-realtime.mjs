// Publishes the full WeatherWalay realtime record: public/observation-data/realtime.json (every station, every column, with labels and
// time stamps), stations.json (the compact view of the same data) and station-meta.csv (id, exact name, network, latitude, longitude, elevation). Needs WEATHERWALAY_USERNAME and
// WEATHERWALAY_PASSWORD in the environment, or in a git-ignored .env file. Never prints or stores the login or the page token.
// Run: node scripts/sync-realtime.mjs
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {fetchFeed, realtimeWithElevations, stationsFromRealtime} from './observation-sync.mjs';
import {fetchAll as fetchPmdFfd, applyPmdFfd} from './pmd-ffd.mjs';
import {parseLabel} from '../public/realtime/core.js';
import {qcRealtime} from './obs-qc.mjs';

const OUT = new URL('../public/observation-data/', import.meta.url);
async function envWithFile() {
  const env = {...process.env};
  if (!env.WEATHERWALAY_USERNAME || !env.WEATHERWALAY_PASSWORD) {
    try {
      for (const line of (await readFile(new URL('../.env', import.meta.url), 'utf8')).split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at > 0 && !line.startsWith('#')) env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* no .env */ }
  }
  return env;
}
const cell = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);

try {
  const env = await envWithFile();
  const raw = await fetchFeed({username: env.WEATHERWALAY_USERNAME, password: env.WEATHERWALAY_PASSWORD});
  const data = await realtimeWithElevations(raw);
  if (env.PMD_FFD !== '0') {                                                  // PMD FFD page readings give the PMD rows current values; a failure here never stops the refresh
    try {
      const sum = applyPmdFfd(data, await fetchPmdFfd(), parseLabel);
      console.log(`PMD FFD page: ${sum.updated} PMD stations updated, ${sum.kept_newer} already newer, ${sum.no_observation} without an observation, ${sum.unmatched.length} unmatched`);
    } catch (e) { console.log('PMD FFD page unavailable:', e.message); }
  }
  await mkdir(OUT, {recursive: true});
  // Quality control (scripts/obs-qc.mjs, rules in qc-rules.json): flagged readings stay in the file, marked in each station's `qc`, and are left out of the 1 km
  // live bias and analysis. The report lists every flag; the state (last good value per station and parameter) is carried to the next run. A failure never stops the refresh.
  if (env.OBS_QC !== '0') {
    try {
      const previous = JSON.parse(await readFile(new URL('qc-state-realtime.json', OUT), 'utf8').catch(() => 'null'));
      const {report, state} = qcRealtime(data, {parseLabel, state: previous?.state ?? {}});
      await writeFile(new URL('qc-report-realtime.json', OUT), JSON.stringify(report) + '\n');
      await writeFile(new URL('qc-state-realtime.json', OUT), JSON.stringify({version: 1, saved_at: report.checked_at, state}) + '\n');
      const sm = report.summary;
      console.log(`QC: ${sm.checked} readings checked, ${sm.flagged} flagged (${Object.entries(sm.by_rule).map(([k, v]) => k + ' ' + v).join(', ') || 'none'})`);
    } catch (e) { console.log('QC unavailable:', e.message); }
  }
  const tmp = new URL('realtime.tmp', OUT);
  await writeFile(tmp, JSON.stringify(data) + '\n');
  await rename(tmp, new URL('realtime.json', OUT));
  const meta = [['id', 'name', 'network', 'latitude', 'longitude', 'elevation_m', 'elevation_source'], ...data.stations.map(s => [s.id, s.name, s.network, s.lat, s.lon, s.elevation, s.elevation_source])];
  await writeFile(new URL('station-meta.csv', OUT), meta.map(r => r.map(cell).join(',')).join('\n') + '\n');
  // stations.json (read by the CI archive and older code) is a view of realtime.json, written from the same login, never a second fetch
  await writeFile(new URL('stations.json', OUT), JSON.stringify(stationsFromRealtime(data)) + '\n');
  const withHeight = data.stations.filter(s => s.elevation !== null).length;
  console.log(`realtime: ${data.stations.length} stations, ${data.columns.length} columns, ${withHeight} with an elevation, feed time ${data.last_update}`);
} catch (e) {
  console.log('realtime refresh unavailable:', e.message);          // never print the login or response bodies
  process.exit(1);
}
