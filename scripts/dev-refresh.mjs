// Keeps the data of a LOCAL server fresh: started by `node server.js` (npm start), it refreshes everything once at launch and then keeps doing it while the
// server stays open. It runs the same scripts the GitHub workflows run, in three lanes that work side by side (jobs inside a lane run one after another):
//   observations  METAR (sync-metar.py) and the WeatherWalay stations with the PMD page values and the quality control (sync-realtime.mjs): every 10 minutes
//   products      PMD radar, EUMETSAT satellite, thunderstorm guidance, the 0.5 degree fallback grid: every 30 / 30 / 60 / 180 minutes
//   forecast      ECMWF open data (looks for a newer 00Z or 12Z run every 30 minutes; a new run is a 5 GB download), then the 1 km step with the station analysis
//                 (Barnes) and the live bias: at launch, after every new ECMWF run, and at least every 2 hours, always after the station files were refreshed
// Nothing here needs a login except sync-realtime (WEATHERWALAY_USERNAME / _PASSWORD in the git-ignored .env, as before). Switch it off with AUTO_REFRESH=off, the
// products lane with AUTO_REFRESH_PRODUCTS=off, the forecast lane with AUTO_REFRESH_FORECAST=off. Status: GET /api/refresh-status.
// Children are stopped when the server stops; the ECMWF sync caches what it decoded, so a download that was cut short resumes.
import {spawn as nodeSpawn} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const MIN = 60000;
export const TICK_MS = 20000;
export const APPLY_EVERY_MIN = 120;                       // the 1 km step is rebuilt at least this often (it takes about 20 minutes of one CPU)
export const OBSERVATIONS_WAIT_MIN = 10;                  // the first 1 km step waits this long at most for the first station refresh

export function pythonPath(root, platform = process.platform, exists = existsSync) {
  const venv = platform === 'win32' ? path.join(root, '.venv-terrain', 'Scripts', 'python.exe') : path.join(root, '.venv-terrain', 'bin', 'python');
  if (exists(venv)) return {py: venv, venv: true};
  return {py: platform === 'win32' ? 'python' : 'python3', venv: false};      // fine for the scripts that use the standard library only; ECMWF and the 1 km step need the venv
}

// Where the ECMWF sync keeps the decoded fields of a run: <temp>/weatherwalay-ecmwf-cache/<YYYYMMDDHH> (sync-terrain-weather-ecmwf.py, CACHE_ROOT).
export const cacheDirFor = (runIso, tmp = tmpdir()) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(runIso || '');
  return m ? path.join(tmp, 'weatherwalay-ecmwf-cache', m[1] + m[2] + m[3] + m[4]) : null;
};

export function jobTable({root, py, venv, env = {}, exists = existsSync}) {
  const node = process.execPath, script = f => path.join(root, 'scripts', f);
  const jobs = [
    {id: 'metar', lane: 'observations', every: 10, timeoutMin: 3, cmd: py, args: [script('sync-metar.py')]},
    // the PMD pages are read at most every 30 minutes (PMD reports hourly); the other readings come fresh each time
    {id: 'realtime', lane: 'observations', every: 10, timeoutMin: 12, cmd: node, args: [script('sync-realtime.mjs')], env: {PMD_FFD_MAX_AGE_MIN: '30'}},
    {id: 'radar', lane: 'products', every: 30, timeoutMin: 6, cmd: py, args: [script('sync-radar.py')]},
    {id: 'satellite', lane: 'products', every: 30, timeoutMin: 6, cmd: py, args: [script('sync-satellite.py')]},
    {id: 'storms', lane: 'products', every: 60, timeoutMin: 10, cmd: node, args: [script('sync-storms.mjs')]},
    {id: 'fallback-grid', lane: 'products', every: 180, timeoutMin: 15, cmd: node, args: [script('sync-terrain-weather.mjs')]},
    {id: 'ecmwf', lane: 'forecast', every: 30, timeoutMin: 180, cmd: py, args: [script('sync-terrain-weather-ecmwf.py'), '--no-downscale'], needsVenv: true},
    {id: 'apply1km', lane: 'forecast', every: APPLY_EVERY_MIN, timeoutMin: 90, cmd: py, args: [], needsVenv: true, special: 'apply',
      needsFile: path.join(root, 'downscaler', 'models', 'feature_metadata.json')},
  ];
  const off = name => (env['AUTO_REFRESH_' + name] || '').toLowerCase() === 'off';
  return jobs.filter(j => !(j.lane === 'products' && off('PRODUCTS')) && !(j.lane === 'forecast' && off('FORECAST')))
    .map(j => {
      const why = j.needsVenv && !venv ? 'needs .venv-terrain (eccodes, numpy, lightgbm)' : j.needsFile && !exists(j.needsFile) ? 'needs the trained models (downscaler/models, local only)' : null;
      return why ? {...j, skip: why} : j;
    });
}

// Cheap stamps of the files the explorer loads, so an open page can tell that newer data is on disk (modification times, nothing is read).
export function dataStamp(root, stat = statSync) {
  const t = rel => { try { return Math.round(stat(path.join(root, 'public', rel)).mtimeMs); } catch { return null; } };
  return {grid: t('terrain-data/grid-hires.json'), km1: t('terrain-data/grid-1km/manifest.json'), realtime: t('observation-data/realtime.json'), metar: t('observation-data/metar.json')};
}

export function createRefresher({root, env = {}, now = () => Date.now(), spawn = nodeSpawn, exists = existsSync, read = file => readFileSync(file, 'utf8'), stat = statSync,
  platform = process.platform, tmp = tmpdir(), log = () => {}} = {}) {
  const {py, venv} = pythonPath(root, platform, exists);
  const jobs = jobTable({root, py, venv, env, exists}).map(j => ({...j, state: j.skip ? 'skipped' : 'waiting', lastStart: null, lastEnd: null, lastOk: null, lastExit: null, runs: 0, failures: 0, tail: '', due: 0}));
  const lanes = {};
  for (const j of jobs) (lanes[j.lane] ??= {busy: false, jobs: []}).jobs.push(j);
  const children = new Set();
  const started = now();
  let timer = null, stopped = false;
  const flags = {applyPending: true, observationsDone: new Set()};          // the 1 km step runs once at launch (after the stations) and after each new ECMWF run
  const get = id => jobs.find(j => j.id === id);

  function gridRun() {                                                      // the ECMWF run of the grid on disk (read only when the 1 km step is about to run)
    try { return JSON.parse(read(path.join(root, 'public', 'terrain-data', 'grid-hires.json'))).run ?? null; } catch { return null; }
  }
  function run(job, args) {
    return new Promise(resolve => {
      let out = '', done = false;
      const finish = code => { if (done) return; done = true; clearTimeout(kill); children.delete(child); resolve({code, tail: out.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ').slice(-600)}); };
      let child;
      try { child = spawn(job.cmd, args ?? job.args, {cwd: root, env: {...process.env, ...env, ...job.env}, windowsHide: true}); }
      catch (e) { return resolve({code: -1, tail: String(e.message || e)}); }
      children.add(child);
      const kill = setTimeout(() => { out += '\n(stopped after ' + job.timeoutMin + ' min)'; try { child.kill(); } catch { /* gone */ } }, job.timeoutMin * MIN);
      kill.unref?.();
      child.stdout?.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-10000); });
      child.stderr?.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-10000); });
      child.on('error', e => { out += '\n' + e.message; finish(-1); });
      child.on('close', code => finish(code ?? -1));
    });
  }
  const isDue = j => {
    if (j.skip || j.state === 'running') return false;
    if (j.special === 'apply') {
      const obsReady = (flags.observationsDone.size >= lanes.observations?.jobs.filter(o => !o.skip).length) || now() - started > OBSERVATIONS_WAIT_MIN * MIN || !lanes.observations;
      return (flags.applyPending && obsReady) || (j.lastEnd !== null && now() - j.lastEnd >= j.every * MIN);
    }
    return j.lastEnd === null || now() - j.lastEnd >= j.every * MIN;
  };
  async function execute(job) {
    job.state = 'running'; job.lastStart = now(); job.runs++;
    let args = job.args;
    if (job.special === 'apply') {
      const dir = cacheDirFor(gridRun(), tmp);
      if (!dir || !exists(dir)) { job.state = 'failed'; job.lastEnd = now(); job.lastExit = -2; job.failures++; job.tail = 'no ECMWF cache for the grid on disk (it is rebuilt with the next ECMWF run); trying again at the next scheduled time'; flags.applyPending = false; log(`[refresh] ${job.id}: ${job.tail}`); return; }
      args = [path.join(root, 'downscaler', '2_apply_1km_forecast.py'), '--cache', dir];
      flags.applyPending = false;                                           // cleared before the run: a new ECMWF run during it sets it again
    }
    const before = job.id === 'ecmwf' ? dataStamp(root, stat).grid : null;
    log(`[refresh] ${job.id}: start`);
    const r = await run(job, args);
    job.lastEnd = now(); job.lastExit = r.code; job.tail = r.tail; job.state = r.code === 0 ? 'ok' : 'failed';
    if (r.code === 0) job.lastOk = job.lastEnd; else { job.failures++; if (job.special === 'apply') flags.applyPending = false; }
    if (job.lane === 'observations') flags.observationsDone.add(job.id);
    if (job.id === 'ecmwf' && r.code === 0 && dataStamp(root, stat).grid !== before) flags.applyPending = true;      // a new run was published: rebuild the 1 km step on it
    log(`[refresh] ${job.id}: ${job.state} in ${Math.round((job.lastEnd - job.lastStart) / 1000)} s${r.code === 0 ? '' : ' (' + (r.tail || 'exit ' + r.code).slice(-160) + ')'}`);
  }
  function tick() {
    if (stopped) return;
    for (const lane of Object.values(lanes)) {
      if (lane.busy) continue;
      const job = lane.jobs.find(isDue);
      if (!job) continue;
      lane.busy = true;
      execute(job).catch(e => { job.state = 'failed'; job.tail = String(e.message || e); }).finally(() => { lane.busy = false; if (!stopped) tick(); });   // then the next due job of the lane
    }
  }
  return {
    start() { if (!timer) { for (const j of jobs) if (j.skip) log(`[refresh] ${j.id}: skipped, ${j.skip}`); tick(); timer = setInterval(tick, TICK_MS); timer.unref?.(); } return this; },
    stop() { stopped = true; clearInterval(timer); timer = null; for (const c of children) { try { c.kill(); } catch { /* gone */ } } children.clear(); },
    tick, jobs, lanes, flags, started,
    status() {
      return {enabled: true, started_at: new Date(started).toISOString(), now: new Date(now()).toISOString(), apply_pending: flags.applyPending,
        jobs: jobs.map(j => ({id: j.id, lane: j.lane, every_min: j.every, state: j.state, skip: j.skip ?? null, runs: j.runs, failures: j.failures, last_start: j.lastStart && new Date(j.lastStart).toISOString(),
          last_end: j.lastEnd && new Date(j.lastEnd).toISOString(), last_ok: j.lastOk && new Date(j.lastOk).toISOString(), last_exit: j.lastExit, next_due: j.skip || j.state === 'running' || j.lastEnd === null ? null : new Date(j.lastEnd + j.every * MIN).toISOString(), note: j.tail || null})),
        data: dataStamp(root, stat)};
    },
  };
}

// ---- the one refresher of this process (server.js) ----
let active = null;
export function startRefresher(options) {
  if ((options.env?.AUTO_REFRESH || process.env.AUTO_REFRESH || '').toLowerCase() === 'off') return null;
  active = createRefresher({...options, env: {...process.env, ...options.env}}).start();
  const stop = () => active?.stop();
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(0); });
  return active;
}
export function refreshStatus(root, {stat = statSync} = {}) {
  return active ? active.status() : {enabled: false, note: 'AUTO_REFRESH is off or the server was not started with node server.js', jobs: [], data: dataStamp(root, stat)};
}
export const stopRefresher = () => { active?.stop(); active = null; };
