import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, forecastURL } from '../server.js';

test('forecast targets the ECMWF API with Pakistan timezone and seven days',()=>{
 const url=forecastURL(33.69,73.05);assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.pathname,'/v1/forecast');assert.equal(url.searchParams.get('timezone'),'Asia/Karachi');assert.equal(url.searchParams.get('forecast_days'),'7');assert.throws(()=>forecastURL(0,0));assert.throws(()=>forecastURL(NaN,73));
});
test('serves the website, rejects bad locations, forwards forecasts and handles provider failure',async()=>{
 let fails=false;
 const server=createServer(async()=>{if(fails)throw Error('offline');return {ok:true,json:async()=>({daily:{time:['2026-10-22']},hourly:{time:['2026-10-22T00:00']}})};});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/<title>WeatherWalay Kissan & Sehat Hub/);
  for(const module of ['farmers.js','farm-data.js','farm-advice.js']){const asset=await fetch(base+'/'+module);assert.equal(asset.status,200,module);assert.match(asset.headers.get('content-type'),/javascript/);assert.match(await asset.text(),/export /);}
  assert.equal((await fetch(base+'/api/forecast?lat=0&lon=0')).status,400);
  assert.equal((await fetch(base+'/api/forecast')).status,400);
  const weather=await (await fetch(base+'/api/forecast?lat=33.69&lon=73.05')).json();assert.equal(weather.source,'ECMWF via Open-Meteo');assert.ok(weather.fetched_at);
  fails=true;const unavailable=await fetch(base+'/api/forecast?lat=24.86&lon=67.01');assert.equal(unavailable.status,502);assert.match((await unavailable.json()).error,/unavailable/);
  assert.equal((await fetch(base+'/missing')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
