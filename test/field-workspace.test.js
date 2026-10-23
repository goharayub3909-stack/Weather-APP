import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFieldLibrary,sameFieldLocation,boundaryGeoJSON,fieldChangeSummary} from '../public/field-workspace.js';
import {operationCalendar,operationWindows} from '../public/field-operations.js';
const vertices=[[31,73],[31,73.01],[31.01,73.01],[31.01,73]],field={id:'test',name:'North field',location:[31,73],vertices};
test('boundary library rejects damaged storage, invalid geometry and unrelated weather locations',()=>{
 assert.deepEqual(readFieldLibrary('bad'),[]);assert.deepEqual(readFieldLibrary('{}'),[]);assert.equal(readFieldLibrary(JSON.stringify([field,{...field,id:'crossed',vertices:[vertices[0],vertices[2],vertices[1],vertices[3]]}])).length,1);
 assert.equal(sameFieldLocation(field,[31,73]),true);assert.equal(sameFieldLocation(field,[33,73]),false);assert.equal(readFieldLibrary(JSON.stringify([{...field,name:'x'.repeat(71)}])).length,0);
});
test('GeoJSON export closes the ring in longitude / latitude order without mutating the outline',()=>{
 const out=boundaryGeoJSON(vertices,'Field A');assert.deepEqual(out.geometry.coordinates[0][0],[73,31]);assert.deepEqual(out.geometry.coordinates[0].at(-1),[73,31]);assert.equal(vertices.length,4);assert.equal(out.properties.name,'Field A');assert.throws(()=>boundaryGeoJSON([]));
});
test('growth snapshot compares actual clear acquisition dates, not interpolated days',()=>{
 const r=fieldChangeSummary([{time:0,value:.2},{time:86400000,value:null},{time:10*86400000,value:.5}]);assert.ok(Math.abs(r.change-.3)<1e-10);assert.equal(r.days,10);assert.equal(fieldChangeSummary([{time:0,value:null}]),null);assert.equal(fieldChangeSummary([{time:0,value:0}]).change,null);
});
test('seven-day calendar retains later windows beyond the three preview periods and uses PKT dates',()=>{
 const now=Date.parse('2026-10-22T21:00:00Z'),time=Array.from({length:192},(_,i)=>new Date(now+i*3600000).toISOString()),h={time};
 for(const [k,v]of Object.entries({temperature_2m:20,relative_humidity_2m:65,wind_speed_10m:5,wind_gusts_10m:10,precipitation:0,weather_code:3}))h[k]=time.map(()=>v);
 const rows=operationCalendar(h,now);assert.equal(rows.length,7);assert.equal(rows[0].date,'2026-10-23');assert.equal(rows[6].date,'2026-10-29');assert.ok(rows[6].actions.spray.length);assert.equal(operationWindows(h,now).spray.length,3);
 h.precipitation.fill(null);assert.ok(operationCalendar(h,now).every(r=>r.actions.spray.length===0&&r.actions.harvest.length===0));
});
