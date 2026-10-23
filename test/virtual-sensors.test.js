import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dewPoint,assessMetric,reportCapabilities} from '../public/virtual-sensors.js';
import {operationWindows} from '../public/field-operations.js';
test('dew point honours saturation, known moisture relationship and missing inputs',()=>{
 assert.ok(Math.abs(dewPoint(20,50)-9.27)<.05);assert.ok(Math.abs(dewPoint(25,100)-25)<1e-9);
 for(const pair of [[20,null],[20,0],[20,101],[NaN,60]])assert.equal(dewPoint(...pair),null);
});
test('nursery targets require explicit context; missing values never mean favourable',()=>{
 assert.equal(assessMetric('vpd',.6).level,'info');assert.equal(assessMetric('vpd',.6,{profile:'nursery-young'}).level,'good');
 assert.equal(assessMetric('vpd',.6,{profile:'nursery-established'}).level,'watch');assert.equal(assessMetric('Delta T',null).level,'unknown');
 assert.equal(assessMetric('delta_t',11).level,'alert');assert.equal(assessMetric('temperature',0).level,'alert');
 assert.equal(assessMetric('ndvi',.1,{stage:'pre-sowing'}).level,'info');assert.equal(assessMetric('ndvi',.1,{stage:'flowering'}).level,'watch');
});
test('rain-only stations cannot create air / soil / wetness metrics; zero rainfall remains valid',()=>{
 const r=reportCapabilities({kind:'station',report:{rain_daily:0,humidity:null,temperature:null}});
 assert.equal(r.kind,'rainfall-only');assert.deepEqual(r.measured,['rainfall']);assert.deepEqual(r.derived,[]);
 const weather=reportCapabilities({kind:'station',report:{temperature:25,humidity:65,solar_radiation:null}});assert.ok(weather.derived.includes('air VPD'));assert.ok(!weather.measured.includes('solar radiation'));
 assert.equal(reportCapabilities({kind:'forecast'}).kind,'unavailable');
 const metar=reportCapabilities({kind:'metar',report:{temp:25,dewp:18,wspd:8}});assert.ok(metar.derived[0].includes('relative humidity'));assert.ok(!metar.measured.includes('rainfall'));
});
test('29°C fails the conservative spraying screen even when moisture and wind qualify',()=>{
 const time=Array.from({length:72},(_,i)=>new Date(Date.parse('2026-10-23T00:00:00Z')+i*3600000).toISOString()),h={time};
 for(const [k,v]of Object.entries({temperature_2m:29,relative_humidity_2m:65,wind_speed_10m:5,wind_gusts_10m:10,precipitation:0,weather_code:3}))h[k]=time.map(()=>v);
 assert.equal(operationWindows(h,Date.parse(time[0])).spray.length,0);h.temperature_2m.fill(25);assert.ok(operationWindows(h,Date.parse(time[0])).spray.length);
});
