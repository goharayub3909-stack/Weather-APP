import {test} from 'node:test';
import assert from 'node:assert/strict';
import {thermalMoistureIndex,validField,fieldSamplePoints,pointInField,rasterValue,validPixel,recentSceneDays,historyNarrative} from '../public/farm-monitoring.js';
import {indexRecipe,indexMeaning} from '../public/farm-indices.js';
const polygon=[[31,73],[31,73.01],[31.01,73.01],[31.01,73]];
test('field editing rejects crossed, duplicate and degenerate boundaries and samples only interior points',()=>{assert.ok(validField(polygon));assert.equal(validField([polygon[0],polygon[2],polygon[1],polygon[3]]),false);assert.equal(validField([polygon[0],polygon[1],polygon[0]]),false);assert.equal(validField([[31,73],[31,74],[31,75]]),false);assert.equal(fieldSamplePoints(polygon).length,5);for(const p of fieldSamplePoints(polygon))assert.ok(pointInField(p,polygon));});
test('point values preserve zero and never turn missing pixels into measurements; source QA rejects cloud / snow / fill',()=>{assert.equal(rasterValue({values:[[0]]}),0);assert.equal(rasterValue({values:[[null]]}),null);assert.equal(rasterValue({values:[[1,2]]}),null);assert.ok(validPixel('sentinel',4));assert.equal(validPixel('sentinel',9),false);assert.equal(validPixel('sentinel',11),false);assert.equal(validPixel('landsat',8),false);assert.ok(validPixel('landsat',64));assert.equal(validPixel('modis-lst',1),false);assert.ok(validPixel('modis-lst',0));});
test('LST uses source Kelvin scaling; SMI is unavailable without actual local calibration assumptions',()=>{const s={assets:{lwir11:{'raster:bands':[{scale:.00341802,offset:149}]}}};const r=indexRecipe('landsat','lst',s);assert.match(r.expression,/0.00341802/);assert.match(r.expression,/149/);assert.match(r.expression,/273.15/);assert.equal(indexRecipe('sentinel','lst',s),null);assert.throws(()=>indexRecipe('landsat','smi',s),/endmembers/);assert.throws(()=>indexRecipe('landsat','smi',s,{wet:30,dry:32}),/endmembers/);assert.match(indexRecipe('landsat','smi',s,{wet:20,dry:45}).expression,/where/);assert.match(indexMeaning('ndvi',.1,'pre-sowing'),/not automatically crop damage/);});
test('scene selection keeps actual acquisition dates, deduplicates PKT days and excludes future / older scenes',()=>{const now=Date.parse('2026-10-23T08:00Z'),scene=t=>({properties:{datetime:t}});const result=recentSceneDays([scene('2026-08-01T06:00Z'),scene('2026-08-01T07:00Z'),scene('2026-10-22T06:00Z'),scene('2026-01-01T06:00Z'),scene('2026-10-24T06:00Z')],now);assert.equal(result.length,2);assert.equal(result[0][1].properties.datetime,'2026-08-01T07:00Z');});
test('crop-development narrative requires multiple clear acquisitions and does not confirm sowing or harvest',()=>{assert.match(historyNarrative([{time:0,value:.2}]),/Not enough/);const rise=[.1,.3,.6].map((value,i)=>({time:i*20*86400000,value}));assert.match(historyNarrative(rise),/consistent with emergence/);assert.match(historyNarrative(rise),/cannot confirm sowing, harvest or growth stage/);const fall=[.6,.65,.15].map((value,i)=>({time:i*20*86400000,value}));assert.match(historyNarrative(fall,{},40*86400000),/consistent with harvest or field clearing/);
 const year=[.2,.7,.75,.3,.15,.2,.35].map((value,i)=>({time:i*50*86400000,value}));const yn=historyNarrative(year,{},300*86400000);assert.match(yn,/12-month peak 0.75/);assert.match(yn,/Latest 0.35/);});

test('thermal fill pixels can never become saturated SMI values',()=>{assert.equal(thermalMoistureIndex(-273.15,20,45),null);assert.equal(thermalMoistureIndex(null,20,45),null);assert.equal(thermalMoistureIndex(36,20,45),.36);assert.equal(thermalMoistureIndex(36,null,45),null);});

test('spatial vigour comparisons require clear samples and do not force weak / strong zones in a uniform field',async()=>{
 const {vegetationSamples}=await import('../public/farm-monitoring.js');
 assert.equal(vegetationSamples([{value:null},{value:.4},{value:null}]).ready,false);
 const uniform=vegetationSamples([.5,.51,.49,.5,.5].map(value=>({value})));assert.ok(uniform.samples.every(s=>s.zone==='Similar green-cover signal'));
 const varied=vegetationSamples([.1,.3,.4,.65,.75].map(value=>({value})),{stage:'pre-sowing'});assert.equal(varied.vegetated,4);assert.match(varied.note,/Low cover can fit/);assert.match(varied.note,/not field-area coverage/);assert.equal(varied.samples[4].zone,'Higher relative vigour');
});

test('whole-field statistics: masked mean, clear threshold and QA expressions', async () => {
  const {maskedStatsExpression, maskedFieldMean, QA_CONDITION, HISTORY_DAYS} = await import('../public/farm-satellite.js');
  assert.equal(HISTORY_DAYS, 365);
  const e = maskedStatsExpression('sentinel', '(B08_b1-B04_b1)/(B08_b1+B04_b1)');
  assert.match(e, /^where\(.*SCL_b1==4.*\);where\(.*,1,0\)$/);
  assert.ok(!/&(?!&)\s*\d/.test(QA_CONDITION.landsat), 'no bitwise & in server expressions');
  assert.match(QA_CONDITION.landsat, /% 64/);
  assert.equal(maskedStatsExpression('modis', 'x'), null);
  // 80% clear, masked sum mean 0.32 -> field mean 0.40
  const m = maskedFieldMean({a: {mean: .32, count: 100}, b: {mean: .8, count: 100}});
  assert.ok(Math.abs(m.value - .4) < 1e-9); assert.equal(m.clear, .8); assert.equal(m.pixels, 100);
  assert.equal(maskedFieldMean({a: {mean: .1, count: 100}, b: {mean: .5, count: 100}}).value, null);
  assert.equal(maskedFieldMean({a: {mean: 0, count: 100}, b: {mean: 0, count: 100}}).value, null);
  assert.equal(maskedFieldMean({}).value, null);
});

test('pass thinning keeps the least cloudy pass per 5-day window', async () => {
  const {thinPasses} = await import('../public/farm-satellite.js');
  const sc = (t, c) => [t.slice(0, 10), {properties: {datetime: t, 'eo:cloud_cover': c}}];
  const out = thinPasses([sc('2026-10-01T06:00Z', 40), sc('2026-10-02T06:00Z', 5), sc('2026-10-03T06:00Z', 20), sc('2026-10-20T06:00Z', 50)]);
  assert.equal(out.length, 2);
  assert.ok(out.some(([, s]) => s.properties['eo:cloud_cover'] === 5));
});

test('narrative attributes a pre-sowing decline to the previous crop', async () => {
  const {historyNarrative} = await import('../public/farm-monitoring.js');
  const rows = [.75, .7, .5, .4].map((value, i) => ({time: i * 15 * 86400000, value}));
  const text = historyNarrative(rows, {crop: {name: 'Wheat'}, stage: 'sowing'}, 45 * 86400000);
  assert.match(text, /previous season's crop/);
  assert.doesNotMatch(historyNarrative(rows, {crop: {name: 'Wheat'}, stage: 'flowering'}, 45 * 86400000), /previous season/);
});

test('boundary upload reads GeoJSON and KML polygons and rejects bad input', async () => {
  const {parseBoundaryFile} = await import('../public/farm-satellite.js');
  const gj = JSON.stringify({type: 'FeatureCollection', features: [{type: 'Feature', properties: {name: 'Plot 7'}, geometry: {type: 'Polygon', coordinates: [[[74.056, 31.623], [74.059, 31.623], [74.059, 31.625], [74.056, 31.625], [74.056, 31.623]]]}}]});
  const a = parseBoundaryFile(gj, 'plot.geojson');
  assert.equal(a.vertices.length, 4); assert.deepEqual(a.vertices[0], [31.623, 74.056]); assert.equal(a.name, 'Plot 7');
  const kml = '<kml><Placemark><name>Farm A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>74.056,31.623,0 74.059,31.623,0 74.059,31.625,0 74.056,31.625,0 74.056,31.623,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>';
  const b = parseBoundaryFile(kml, 'farm.kml');
  assert.equal(b.vertices.length, 4); assert.equal(b.name, 'Farm A');
  assert.throws(() => parseBoundaryFile('{"type":"Point","coordinates":[74,31]}', 'x.geojson'), /No polygon/);
  assert.throws(() => parseBoundaryFile('not json', 'x.json'));
});

test('MSAVI and NDWI recipes use the right bands and match the textbook formulas', async () => {
  const {indexRecipe, FIELD_INDICES, indexMeaning} = await import('../public/farm-indices.js');
  const scene = {properties: {'s2:processing_baseline': '05.13'}, assets: Object.fromEntries(['B02', 'B03', 'B04', 'B08', 'B11', 'B05', 'B8A', 'SCL'].map(k => [k, {'raster:bands': [{scale: 0.0001, offset: -0.1}]}]))};
  const dn = {B08: 4200, B04: 1800, B03: 1500}; // raw digital numbers
  const refl = k => dn[k] * 0.0001 - 0.1;
  const run = expr => Function('Math', 'return ' + expr.replace(/sqrt/g, 'Math.sqrt').replace(/(B\d\d)_b1/g, (_, k) => dn[k]))(Math);
  const nir = refl('B08'), red = refl('B04'), green = refl('B03');
  const msavi = indexRecipe('sentinel', 'msavi', scene);
  assert.deepEqual([...msavi.assets].sort(), ['B04', 'B08']);
  assert.ok(Math.abs(run(msavi.expression) - (2 * nir + 1 - Math.sqrt((2 * nir + 1) ** 2 - 8 * (nir - red))) / 2) < 1e-9);
  const ndwi = indexRecipe('sentinel', 'ndwi', scene);
  assert.deepEqual([...ndwi.assets].sort(), ['B03', 'B08']);
  assert.ok(Math.abs(run(ndwi.expression) - (green - nir) / (green + nir)) < 1e-9);
  assert.ok(run(ndwi.expression) < 0, 'vegetation reads negative on NDWI');
  const ls = {properties: {}, assets: Object.fromEntries(['nir08', 'red', 'green', 'blue', 'swir16'].map(k => [k, {'raster:bands': [{scale: 0.0000275, offset: -0.2}]}]))};
  assert.ok(indexRecipe('landsat', 'msavi', ls).expression.includes('sqrt'));
  assert.ok(FIELD_INDICES.msavi && FIELD_INDICES.ndwi);
  assert.match(indexMeaning('msavi', 0.1), /soil/);
});
