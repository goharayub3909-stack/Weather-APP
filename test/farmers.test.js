import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CROPS,activity,approximateZone,pakistanMonth,seasonName} from '../public/farm-data.js';
import {analyseFarm,farmInstant} from '../public/farm-advice.js';
const now=new Date('2026-10-22T07:00:00Z'),HOUR=3600000;
function fixture(){
 const hourly={time:Array.from({length:168},(_,i)=>new Date(now.getTime()+i*HOUR+5*HOUR).toISOString().slice(0,16))};
 for(const [key,value]of Object.entries({temperature_2m:20,precipitation:0,wind_speed_10m:10,wind_gusts_10m:15,relative_humidity_2m:50,weather_code:0}))hourly[key]=Array(168).fill(value);
 return {hourly,hourly_units:{temperature_2m:'°C',precipitation:'mm',wind_speed_10m:'km/h',wind_gusts_10m:'km/h'},daily:{time:Array.from({length:7},(_,i)=>new Date(now.getTime()+i*24*HOUR).toISOString().slice(0,10)),temperature_2m_max:Array(7).fill(25),temperature_2m_min:Array(7).fill(10),precipitation_sum:Array(7).fill(0)}};
}
const analyse=(forecast,extra={})=>analyseFarm({forecast,now,...extra});
test('Pakistan crop guide handles seasonal transitions and northern planting differences',()=>{
 assert.equal(CROPS.length,18);assert.equal(new Set(CROPS.map(c=>c.id)).size,18);
 const wheat=CROPS.find(c=>c.id==='wheat');assert.equal(activity(wheat,'plains',10).active,true);assert.match(activity(wheat,'plains',10).label,/preparation/);assert.equal(activity(wheat,'north',10).active,false);assert.equal(activity(wheat,'north',4).active,true);
 assert.equal(approximateZone(35.9,74.3),'north');assert.equal(approximateZone(30.18,66.98),'uplands');assert.equal(approximateZone(24.86,67.01),'south');
 assert.equal(pakistanMonth(new Date('2026-10-31T18:59Z')),10);assert.equal(pakistanMonth(new Date('2026-10-31T19:00Z')),11);assert.match(seasonName(10),/Rabi/);
 assert.match(seasonName(10,'north'),/winter preparation/);assert.equal(activity(CROPS.find(c=>c.id==='cotton'),'north',10).stage,'mixed');
});
test('missing, stale and incompatible-unit forecasts cannot issue farm advice',()=>{
 assert.equal(analyse(null).available,false);const f=fixture();f.hourly.time=f.hourly.time.map(t=>new Date(farmInstant(t)-10*24*HOUR).toISOString());assert.equal(analyse(f).available,false);
 const wrong=fixture();wrong.hourly_units.wind_speed_10m='m/s';assert.equal(analyse(wrong).available,false);
});
test('real zero rain supports dry planning; missing rain never becomes zero or a dry period',()=>{
 const dry=analyse(fixture());assert.equal(dry.summary.rain,0);assert.ok(dry.alerts.some(a=>a.id==='moisture'));assert.ok(dry.windows.length);
 const missing=fixture();missing.hourly.precipitation.fill(null);const unknown=analyse(missing);assert.equal(unknown.summary.rain,null);assert.equal(unknown.complete,false);assert.equal(unknown.windows.length,0);assert.ok(!unknown.alerts.some(a=>a.id==='moisture'));
});
test('heavy rain and trace showers produce different advice without guessing irrigation quantities',()=>{
 const f=fixture();f.hourly.precipitation.fill(1,0,24);const r=analyse(f);assert.ok(r.alerts.some(a=>a.id==='heavy-rain'));assert.equal(r.summary.rain,24);
 const shower=fixture();shower.hourly.precipitation[3]=.2;const s=analyse(shower);assert.ok(s.alerts.some(a=>a.id==='rain'));assert.ok(!s.alerts.some(a=>a.id==='heavy-rain'));assert.match(s.alerts.find(a=>a.id==='rain').action,/may not replace irrigation/);
});
test('crop stage changes heat screening; cold, wind and humidity need their actual inputs',()=>{
 const f=fixture();f.hourly.temperature_2m[5]=31;const wheat=CROPS.find(c=>c.id==='wheat');assert.ok(analyse(f,{crop:wheat,stage:'flowering'}).alerts.some(a=>a.id==='heat'));assert.ok(!analyse(f,{crop:wheat,stage:'sowing'}).alerts.some(a=>a.id==='heat'));
 f.hourly.temperature_2m[36]=-1;f.hourly.wind_gusts_10m[18]=50;f.hourly.relative_humidity_2m.fill(90,8,14);const r=analyse(f);for(const id of ['cold','wind','humidity'])assert.ok(r.alerts.some(a=>a.id===id),id);
 f.hourly.relative_humidity_2m[11]=null;assert.ok(!analyse(f).alerts.some(a=>a.id==='humidity'),'missing hour breaks the humidity run');
});
test('CAPE alone never becomes a hail advisory; supplemental storm codes align by time',()=>{
 const f=fixture(),supplemental={hourly:{time:[f.hourly.time[4]],cape:[2500]}};assert.ok(!analyse(f,{supplemental}).alerts.some(a=>a.id==='hail'));
 supplemental.hourly.weather_code=[96];const r=analyse(f,{supplemental});assert.ok(r.alerts.some(a=>a.id==='hail'));assert.ok(r.alerts.some(a=>a.id==='storm'));assert.match(r.alerts.find(a=>a.id==='hail').source,/Supplemental/);
 supplemental.hourly.time=['2026-10-01T12:00'];assert.ok(!analyse(f,{supplemental}).alerts.some(a=>a.id==='hail'));
});
test('work periods require a rain look-ahead and cannot bridge duplicated/missing forecast hours',()=>{
 const f=fixture();f.hourly.precipitation[5]=1;const r=analyse(f);assert.ok(r.windows.length);assert.ok(r.windows[0].start>=now.getTime()+6*HOUR);
 const duplicate=fixture();duplicate.hourly.time[1]=duplicate.hourly.time[0];const d=analyse(duplicate);assert.equal(d.summary.rain,null);assert.equal(d.complete,false);
 assert.equal(farmInstant('2026-10-22T12:00'),Date.parse('2026-10-22T07:00Z'));assert.equal(farmInstant('2026-10-22T07:00Z'),Date.parse('2026-10-22T07:00Z'));
});
test('selecting an actual crop and stage produces a forecast-linked field plan',()=>{
 const crop=CROPS.find(c=>c.id==='cotton'),forecast=fixture();
 const picking=analyse(forecast,{crop,stage:'harvest'}).alerts.find(a=>a.id==='crop-plan');assert.match(picking.title,/Cotton/);assert.match(picking.action,/dew or rain/);assert.match(picking.evidence,/0 mm/);
 const sowing=analyse(forecast,{crop,stage:'sowing'}).alerts.find(a=>a.id==='crop-plan');assert.match(sowing.action,/seedbed moisture/);assert.notEqual(picking.action,sowing.action);
});
