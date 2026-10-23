import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vaporPressureDeficit,deltaT,growingDegreeDay,chillHours,irrigationPlan,researchScreen,fieldAreaHa} from '../public/agri-models.js';
import {chooseCurrentSource,currentValue} from '../public/current-weather.js';
import {ecmwfDailyCondition} from '../public/storms.js';
test('current weather uses one fresh nearest station report without mixing absent fields',()=>{
 const now=Date.parse('2026-10-23T06:00:00Z'),s={stations:[{name:'Station',lat:31.1,lon:73,temperature:27,humidity:null,observed_at:new Date(now-3600000).toISOString()}]},m={stations:[{name:'Airport',lat:31,lon:73,temp:26,dewp:20,obsTime:now/1000-100,wspd:10}]};let chosen=chooseCurrentSource(31,73,s,m,now);assert.equal(chosen.kind,'station');assert.equal(currentValue(chosen,'relative_humidity_2m',80),null);assert.equal(currentValue(chosen,'temperature_2m',30),27);
 s.stations[0].observed_at=new Date(now-4*3600000).toISOString();chosen=chooseCurrentSource(31,73,s,m,now);assert.equal(chosen.kind,'metar');assert.equal(currentValue(chosen,'wind_speed_10m',99),18.52);assert.equal(currentValue(chosen,'cloud_cover',99),null);m.stations[0].obsTime-=3*3600;assert.equal(chooseCurrentSource(31,73,s,m,now).kind,'forecast');s.stations[0].observed_at=null;assert.equal(chooseCurrentSource(31,73,s,m,now).kind,'forecast');
});
test('agri indices preserve physical limits and distinguish unavailable inputs',()=>{
 assert.ok(Math.abs(vaporPressureDeficit(30,50)-2.122)<.005);assert.equal(vaporPressureDeficit(30,100),0);assert.equal(vaporPressureDeficit(30,null),null);assert.equal(deltaT(25,50,20).value,5);assert.equal(deltaT(25,100).value,0);assert.equal(deltaT(55,40).value,null);assert.ok(deltaT(30,50).value>7);assert.equal(growingDegreeDay(5,25,10),7.5);assert.equal(growingDegreeDay(null,25,10),null);assert.deepEqual(chillHours([0,7.2,8,-1,null]),{hours:2,coverage:4,total:5});assert.ok(fieldAreaHa([[31,73],[31.001,73],[31.001,73.001],[31,73.001]])>.9);
});
test('water balance requires field inputs and missing weather invalidates following doses',()=>{
 assert.equal(irrigationPlan([{et0:5,rain:0}],{kc:1,reserve:null,deficit:10,efficiency:80}),null);const p=irrigationPlan([{et0:5,rain:0},{et0:null,rain:0},{et0:5,rain:0}],{kc:1,reserve:100,deficit:45,efficiency:80});assert.equal(p[0].gross,62.5);assert.equal(p[1].unknown,true);assert.equal(p[2].unknown,true);
});
test('research criteria never bridge missing hours or activate ambiguous rules',()=>{
 const h={time:['2026-10-23T10:00','2026-10-23T11:00','2026-10-23T13:00'],temperature_2m:[25,25,25],relative_humidity_2m:[90,90,90]},r={temperature:[20,30],humidity:[85,100]};assert.equal(researchScreen(r,h).hits,3);assert.equal(researchScreen(r,h).longest,2);assert.equal(researchScreen({...r,temperature:null},h).assessable,false);
 const catalog=JSON.parse(readFileSync(new URL('../public/pest-criteria.json',import.meta.url)));assert.equal(catalog.rules.length,36);assert.ok(catalog.rules.some(r=>r.issues.length&&!r.temperature));assert.ok(catalog.rules.every(r=>r.source.file&&r.source.location));const refs=readFileSync(new URL('../public/agri-reference.json',import.meta.url),'utf8');assert.ok(!/\"(?:phone|contact|poc)\"\s*:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(refs));
});
test('ECMWF thunder screen needs simultaneous convection, amount labels retain user bands',()=>{
 const h={time:['2026-10-23T10:00','2026-10-23T11:00'],cape:[800,0],showers:[0,.5],weather_code:[3,3]};assert.equal(ecmwfDailyCondition({amount:.5,code:3,hourly:h,date:'2026-10-23'}).thunder,false);h.showers[0]=.2;assert.match(ecmwfDailyCondition({amount:.5,code:3,hourly:h,date:'2026-10-23'}).label,/Isolated thunderstorm/);assert.match(ecmwfDailyCondition({amount:5,code:95,hourly:h,date:'2026-10-23'}).label,/Scattered thunderstorm/);
});
