import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {pythonPath, cacheDirFor, jobTable, dataStamp, createRefresher, refreshStatus, MIN, APPLY_EVERY_MIN} from '../scripts/dev-refresh.mjs';
import {createServer} from '../server.js';

const ROOT = path.join(path.sep, 'proj');
const script = f => path.join(ROOT, 'scripts', f);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    const call = {cmd, args, opts, child, name: path.basename(args[0] || ''), finish: (code = 0, out = '') => { if (out) child.stdout.emit('data', out); child.emit('close', code); }};
    calls.push(call); return child;
  };
  return {spawn, calls, find: name => calls.filter(c => c.name === name), running: () => calls.filter(c => !c.child.killed && !c.done)};
}
// every refresher of a test is stopped afterwards, so a failing test cannot leave timers behind
const rigs = [];
afterEach(() => { while (rigs.length) rigs.pop().stop(); });
// a refresher on a fake clock, fake processes and a fake disk
function rig({venv = true, models = true, env = {}} = {}) {
  const clock = {t: Date.parse('2026-11-19T08:00:00Z')}, sp = fakeSpawn(), disk = {gridMtime: 1000, runIso: '2026-11-19T00:00:00Z', cache: true};
  const cacheDir = cacheDirFor(disk.runIso, 'TMP');
  const exists = f => f === path.join(ROOT, '.venv-terrain', 'bin', 'python') ? venv : f === path.join(ROOT, 'downscaler', 'models', 'feature_metadata.json') ? models : f === cacheDir ? disk.cache : true;
  const stat = f => { if (String(f).endsWith('grid-hires.json')) return {mtimeMs: disk.gridMtime}; if (String(f).endsWith('manifest.json')) return {mtimeMs: 2000}; throw Error('ENOENT'); };
  const logs = [];
  const r = createRefresher({root: ROOT, env, now: () => clock.t, spawn: sp.spawn, exists, stat, read: () => JSON.stringify({run: disk.runIso}), platform: 'linux', tmp: 'TMP', log: m => logs.push(m)});
  rigs.push(r);
  return {r, clock, sp, disk, logs, cacheDir, advance: min => { clock.t += min * MIN; }};
}

test('the python of the project is used when it exists, a plain one otherwise', () => {
  assert.deepEqual(pythonPath(ROOT, 'win32', () => true), {py: path.join(ROOT, '.venv-terrain', 'Scripts', 'python.exe'), venv: true});
  assert.deepEqual(pythonPath(ROOT, 'linux', () => true), {py: path.join(ROOT, '.venv-terrain', 'bin', 'python'), venv: true});
  assert.deepEqual(pythonPath(ROOT, 'win32', () => false), {py: 'python', venv: false});
  assert.deepEqual(pythonPath(ROOT, 'linux', () => false), {py: 'python3', venv: false});
});

test('the cache of an ECMWF run is where the sync script keeps it', () => {
  assert.equal(cacheDirFor('2026-11-18T00:00:00Z', 'T'), path.join('T', 'weatherwalay-ecmwf-cache', '2026111800'));
  assert.equal(cacheDirFor('2026-11-19T12:00:00Z', 'T'), path.join('T', 'weatherwalay-ecmwf-cache', '2026111912'));
  assert.equal(cacheDirFor('soon'), null); assert.equal(cacheDirFor(null), null);
});

test('the job table: three lanes, the agreed cadences, and switches', () => {
  const t = jobTable({root: ROOT, py: 'py', venv: true, env: {}, exists: () => true});
  assert.deepEqual(t.map(j => [j.id, j.lane, j.every]), [['metar', 'observations', 10], ['realtime', 'observations', 10], ['radar', 'products', 30], ['satellite', 'products', 30], ['storms', 'products', 60],
    ['fallback-grid', 'products', 180], ['ecmwf', 'forecast', 30], ['apply1km', 'forecast', APPLY_EVERY_MIN]]);
  assert.equal(APPLY_EVERY_MIN, 120);
  assert.equal(t.find(j => j.id === 'realtime').env.PMD_FFD_MAX_AGE_MIN, '30');                      // the PMD pages are read at most every 30 minutes
  assert.deepEqual(t.find(j => j.id === 'ecmwf').args, [script('sync-terrain-weather-ecmwf.py'), '--no-downscale']);      // the 1 km step is its own job, after the station refresh
  assert.ok(t.every(j => !j.skip));
  assert.deepEqual(jobTable({root: ROOT, py: 'py', venv: true, env: {AUTO_REFRESH_PRODUCTS: 'off'}, exists: () => true}).map(j => j.lane), ['observations', 'observations', 'forecast', 'forecast']);
  assert.deepEqual(jobTable({root: ROOT, py: 'py', venv: true, env: {AUTO_REFRESH_FORECAST: 'OFF'}, exists: () => true}).map(j => j.lane).filter(l => l === 'forecast'), []);
  const noVenv = jobTable({root: ROOT, py: 'python3', venv: false, env: {}, exists: () => true});
  assert.match(noVenv.find(j => j.id === 'ecmwf').skip, /venv/); assert.match(noVenv.find(j => j.id === 'apply1km').skip, /venv/);
  assert.equal(noVenv.find(j => j.id === 'metar').skip, undefined);                                   // the standard-library scripts still run
  const noModels = jobTable({root: ROOT, py: 'py', venv: true, env: {}, exists: f => !String(f).includes('feature_metadata')});
  assert.match(noModels.find(j => j.id === 'apply1km').skip, /models/); assert.equal(noModels.find(j => j.id === 'ecmwf').skip, undefined);
});

test('data stamps are modification times, rounded, and null for a missing file', () => {
  const stamps = dataStamp(ROOT, f => { if (String(f).includes('grid-hires')) return {mtimeMs: 1234.7}; if (String(f).includes('manifest.json')) return {mtimeMs: 99}; throw Error('ENOENT'); });
  assert.deepEqual(stamps, {grid: 1235, km1: 99, realtime: null, metar: null});
});

test('at launch each lane starts its first job, and a lane runs its jobs one after another', async () => {
  const {r, sp} = rig();
  r.tick(); await settle();
  assert.deepEqual(sp.calls.map(c => c.name), ['sync-metar.py', 'sync-radar.py', 'sync-terrain-weather-ecmwf.py']);          // one per lane, nothing else yet
  r.tick(); await settle();
  assert.equal(sp.calls.length, 3);                                                                    // running jobs are not started twice, and a lane does not run two at once
  sp.calls[0].finish(0); await settle();
  assert.equal(sp.calls[3].name, 'sync-realtime.mjs');                                                  // the lane goes on with its next job at once
  assert.equal(sp.calls[3].opts.env.PMD_FFD_MAX_AGE_MIN, '30');
  assert.equal(sp.calls[3].opts.cwd, ROOT);
  assert.equal(sp.calls[3].cmd, process.execPath);
  assert.equal(r.jobs.find(j => j.id === 'metar').state, 'ok');
  r.stop();
});

test('the 1 km step waits for the stations and the ECMWF step, then runs once on the run that is on disk', async () => {
  const {r, sp, cacheDir, clock} = rig();
  r.tick(); await settle();
  sp.calls.find(c => c.name === 'sync-terrain-weather-ecmwf.py').finish(0); await settle();           // ECMWF checked: the grid file did not change
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 0, 'no 1 km step before the stations are refreshed');
  sp.find('sync-metar.py')[0].finish(0); await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 0, 'METAR alone is not enough');
  sp.find('sync-realtime.mjs')[0].finish(0); await settle();
  const apply = sp.find('2_apply_1km_forecast.py');
  assert.equal(apply.length, 1);
  assert.deepEqual(apply[0].args, [path.join(ROOT, 'downscaler', '2_apply_1km_forecast.py'), '--cache', cacheDir]);
  assert.equal(r.flags.applyPending, false);
  apply[0].finish(0); await settle();
  clock.t += 5 * MIN; r.tick(); await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 1, 'it does not run again at once');
  r.stop();
});

test('the 1 km step also waits at most 10 minutes for the stations, and runs without them if they never finish', async () => {
  const {r, sp, clock} = rig();
  r.tick(); await settle();
  sp.calls.find(c => c.name === 'sync-terrain-weather-ecmwf.py').finish(0); await settle();
  clock.t += 11 * MIN; r.tick(); await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 1);
  r.stop();
});

test('a new ECMWF grid file sets the 1 km step going again at once; the same file does not', async () => {
  const {r, sp, disk, advance} = rig();
  r.tick(); await settle();
  sp.find('sync-terrain-weather-ecmwf.py')[0].finish(0); await settle();
  sp.find('sync-metar.py')[0].finish(0); await settle(); sp.find('sync-realtime.mjs')[0].finish(0); await settle();
  sp.find('2_apply_1km_forecast.py')[0].finish(0); await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 1, 'the launch round');
  advance(31); r.tick(); await settle();
  sp.find('sync-terrain-weather-ecmwf.py')[1].finish(0); await settle();                                // ECMWF looked again: the grid file is the same
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 1, 'same file: no rebuild (the last one was 31 minutes ago, the limit is 120)');
  advance(31); r.tick(); await settle();
  disk.gridMtime = 7777;                                                                                // this time the sync replaces the grid file while it runs
  sp.find('sync-terrain-weather-ecmwf.py')[2].finish(0); await settle();
  const apply = sp.find('2_apply_1km_forecast.py');
  assert.equal(apply.length, 2, 'a new run: the 1 km step starts right after it');
  assert.equal(r.flags.applyPending, false);                                                            // cleared when it started
});

test('without a new run the 1 km step is still rebuilt every 2 hours, to take in the newer stations', async () => {
  const {r, sp, advance} = rig();
  r.tick(); await settle();
  sp.find('sync-terrain-weather-ecmwf.py')[0].finish(0); await settle();
  sp.find('sync-metar.py')[0].finish(0); await settle(); sp.find('sync-realtime.mjs')[0].finish(0); await settle();
  sp.find('2_apply_1km_forecast.py')[0].finish(0); await settle();
  advance(119); r.tick(); await settle();
  for (const c of sp.calls) if (!c.child.killed && !c.finished) { c.finished = true; c.finish(0); }
  await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 1, '119 minutes: not yet');
  advance(2); r.tick(); await settle();
  for (const c of sp.calls) if (!c.finished) { c.finished = true; c.finish(0); }
  await settle();
  assert.equal(sp.find('2_apply_1km_forecast.py').length, 2, '121 minutes: rebuilt');
});

test('jobs come round again at their own cadence, and a failure is recorded and retried later, not at once', async () => {
  const {r, sp, advance} = rig();
  r.tick(); await settle();
  sp.find('sync-metar.py')[0].finish(3, 'boom: network down'); await settle();
  const metar = r.jobs.find(j => j.id === 'metar');
  assert.equal(metar.state, 'failed'); assert.equal(metar.failures, 1); assert.equal(metar.lastExit, 3); assert.match(metar.tail, /network down/);
  sp.find('sync-realtime.mjs')[0].finish(0); await settle();
  advance(9); r.tick(); await settle();
  assert.equal(sp.find('sync-metar.py').length, 1, 'not yet: every 10 minutes');
  advance(2); r.tick(); await settle();
  assert.equal(sp.find('sync-metar.py').length, 2);                                                     // retried at the next scheduled time
  assert.equal(r.jobs.find(j => j.id === 'metar').state, 'running');
  sp.find('sync-metar.py')[1].finish(0); await settle();
  assert.equal(r.jobs.find(j => j.id === 'metar').state, 'ok'); assert.equal(r.jobs.find(j => j.id === 'metar').runs, 2);
  r.stop();
});

test('skipped jobs are never started, and say why', async () => {
  const {r, sp, logs} = rig({venv: false});
  r.start(); await settle();
  assert.ok(!sp.calls.some(c => /ecmwf|apply/.test(c.name)));
  assert.ok(logs.some(l => /ecmwf: skipped, needs \.venv-terrain/.test(l)));
  assert.match(r.status().jobs.find(j => j.id === 'apply1km').skip, /venv/);
  r.stop();
});

test('stopping the refresher stops the programs it started and starts nothing more', async () => {
  const {r, sp, advance} = rig();
  r.tick(); await settle();
  r.stop(); await settle();
  assert.ok(sp.calls.every(c => c.child.killed));
  const n = sp.calls.length; advance(60); r.tick(); await settle();
  assert.equal(sp.calls.length, n);
});

test('status reports every job and the data stamps, without secrets', async () => {
  const {r, sp, clock} = rig();
  r.tick(); await settle();
  sp.find('sync-metar.py')[0].finish(0, 'Published Pakistan airport reports: 7'); await settle();
  const st = r.status();
  assert.equal(st.enabled, true); assert.equal(st.jobs.length, 8);
  const metar = st.jobs.find(j => j.id === 'metar');
  assert.equal(metar.state, 'ok'); assert.equal(metar.last_ok, new Date(clock.t).toISOString()); assert.equal(metar.next_due, new Date(clock.t + 10 * MIN).toISOString());
  assert.match(metar.note, /7/);
  assert.equal(st.jobs.find(j => j.id === 'realtime').state, 'running'); assert.equal(st.jobs.find(j => j.id === 'realtime').next_due, null);
  assert.deepEqual(st.data, {grid: 1000, km1: 2000, realtime: null, metar: null});
  assert.ok(!JSON.stringify(st).match(/PASSWORD|password/));
  r.stop();
});

test('/api/refresh-status answers with the data stamps even when the refresher is not running', async () => {
  const server = createServer(async () => { throw Error('no network'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/refresh-status`);
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /json/); assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.enabled, false); assert.deepEqual(body.jobs, []);
    assert.deepEqual(Object.keys(body.data), ['grid', 'km1', 'realtime', 'metar']);
    assert.deepEqual(Object.keys(refreshStatus(ROOT)), ['enabled', 'note', 'jobs', 'data']);
  } finally { await new Promise(r => server.close(r)); }
});
