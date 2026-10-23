import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/explorer/index.html',import.meta.url),'utf8');
const core=html.slice(html.indexOf('const KNOTS_PER_MS'),html.indexOf('/* END_PURE_GRID_CORE'));
const actual=JSON.parse(readFileSync(new URL('../public/studio-data/forecast.json',import.meta.url)));
function context(){const box={dataset:structuredClone(actual)};vm.createContext(box);vm.runInContext(core+'\nthis.GridSampler=GridSampler;this.validateForecast=validateForecast;',box);return box;}
test('studio consumes actual ECMWF fields, samples exact nodes and leaves missing cells blank',()=>{
 const box=context();box.validateForecast(box.dataset);const state={time:0},sampler=new box.GridSampler(box.dataset,state),g=actual.grid,node=(30-g.south)*g.columns+(69-g.west),sample=sampler.sample(69,30,'surface');
 assert.equal(sample.rain,actual.rain[0][node]);assert.equal(sample.temperature,actual.levels.surface.temperature[0][node]);assert.equal(sample.u,actual.levels.surface.u[0][node]);assert.ok(Math.abs(sample.windKnots-Math.hypot(sample.u,sample.v)*1.9438444924406)<1e-9);assert.equal(sampler.sample(0,0,'surface'),null);
 box.dataset.levels.surface.u[0][node]=null;assert.equal(sampler.sample(69,30,'surface').windKnots,null);assert.equal(sampler.sample(69.5,30,'surface').windKnots,null);
 state.time=1;assert.equal(sampler.sample(69,30,'surface').temperature,actual.levels.surface.temperature[1][node]);
});
test('forecast schema rejects wrong units, irregular times and non-ECMWF data',()=>{
 const box=context();box.dataset.units.u='km/h';assert.throws(()=>box.validateForecast(box.dataset));box.dataset=structuredClone(actual);box.dataset.times[1]=box.dataset.times[0];assert.throws(()=>box.validateForecast(box.dataset));box.dataset=structuredClone(actual);box.dataset.model='synthetic';assert.throws(()=>box.validateForecast(box.dataset));
});

test('rain remains a surface field at every pressure and missing rain is never zero-filled',()=>{
 const box=context(),state={time:0},sampler=new box.GridSampler(box.dataset,state),g=actual.grid,node=(30-g.south)*g.columns+(69-g.west);
 assert.equal(sampler.sample(69,30,'500').rain,actual.rain[0][node]);
 box.dataset.rain[0][node]=null;assert.equal(sampler.sample(69,30,'surface').rain,null);assert.equal(sampler.sample(69.5,30,'500').rain,null);
 state.time=1;assert.equal(sampler.sample(69,30,'surface').rain,actual.rain[1][node]);
 box.dataset.units.rain='inch';assert.throws(()=>box.validateForecast(box.dataset));
 box.dataset=structuredClone(actual);box.dataset.rain.pop();assert.throws(()=>box.validateForecast(box.dataset));
});

test('terrain-aware interpolation preserves valid slopes without filling provider gaps',()=>{
 const box=context(),sampler=new box.GridSampler(box.dataset,{time:0}),g=box.dataset.grid,a=(30-g.south)*g.columns+(69-g.west),b=a+1;
 box.dataset.surface_pressure[0][a]=800;box.dataset.surface_pressure[0][b]=1000;
 for(const key of ['temperature','humidity','u','v','height']){box.dataset.levels['850'][key][0][a]=null;box.dataset.levels['850'][key][0][b]=10;}
 const slope=sampler.sample(69.5,30,'850');assert.equal(slope.belowTerrain,false);assert.equal(slope.temperature,10);assert.equal(slope.surfacePressure,900);
 const mountain=sampler.sample(69.1,30,'850');assert.equal(mountain.belowTerrain,true);assert.equal(mountain.temperature,null);assert.equal(mountain.windKnots,null);
 box.dataset.surface_pressure[0][a]=1000;assert.equal(sampler.sample(69.5,30,'850').temperature,null,'a genuine provider gap stays missing');
});

test('finer rain grid aligns by actual timestamp and never fills a missing detailed cell',()=>{
 const box=context(),rain=JSON.parse(readFileSync(new URL('../public/studio-data/rain.json',import.meta.url))),t=0;box.dataset.times[t]=rain.times[2];const state={time:t},sampler=new box.GridSampler(box.dataset,state);sampler.setRain(rain);const index=rain.times.indexOf(box.dataset.times[t]),node=(30-rain.grid.south)/.5*rain.grid.columns+(69-rain.grid.west)/.5;assert.equal(sampler.rainAt(69,30),rain.rain[index][node]);assert.equal(sampler.sample(69,30,'500').rain,rain.rain[index][node]);rain.rain[index][node]=null;assert.equal(sampler.rainAt(69,30),null);sampler.setRain(null);assert.equal(sampler.rainAt(69,30),actual.rain[t][(30-actual.grid.south)*actual.grid.columns+69-actual.grid.west]);
});
