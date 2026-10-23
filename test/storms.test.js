import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rainBand,stormScreen,windDifference,dailyCondition} from '../public/storms.js';
test('rain thresholds include 0.2 mm and retain the unspecified 1–2 mm band',()=>{
 assert.equal(rainBand(.19).rain,false);assert.equal(rainBand(.2).label,'Isolated chance');assert.equal(rainBand(1).label,'Isolated chance');assert.equal(rainBand(1.5).label,'Rain possible');assert.equal(rainBand(2).label,'Scattered chance');assert.equal(rainBand(10).label,'Scattered chance');assert.equal(rainBand(null).rain,false);assert.equal(dailyCondition({amount:.2,code:0}).icon,'rain');
});
test('CAPE alone never becomes a hail probability or a hail signal',()=>{
 const result=stormScreen({cape:[3500],weather_code:[2]},0);assert.equal(result.ingredients,false);assert.equal(result.available,false);assert.equal(result.label,'Unavailable');
 const data={cape:[1500],convective_inhibition:[-50],freezing_level_height:[3000],temperature_500hPa:[-15],showers:[.3],weather_code:[95],wind_speed_10m:[10],wind_direction_10m:[90],wind_speed_500hPa:[70],wind_direction_500hPa:[270]};assert.equal(stormScreen(data,0).ingredients,true);data.showers=[0];data.weather_code=[2];assert.equal(stormScreen(data,0).ingredients,false);
 assert.equal(dailyCondition({amount:.2,code:96}).icon,'hail');assert.equal(dailyCondition({amount:5,code:95}).icon,'storm');
});
test('wind-difference calculation uses direction and converts km/h to m/s',()=>{
 assert.ok(Math.abs(windDifference(36,90,36,270)-20)<1e-10);assert.equal(windDifference(null,0,20,0),null);
});

test('daily icons preserve snow, freezing rain and explicit hail instead of generic convection',async()=>{
 const {ecmwfDailyCondition}=await import('../public/storms.js'),h={time:['2026-10-23T12:00'],cape:[1500],showers:[1],weather_code:[73]};assert.equal(ecmwfDailyCondition({amount:3,code:73,hourly:h,date:'2026-10-23'}).icon,'snow');assert.match(ecmwfDailyCondition({amount:3,code:66,hourly:h,date:'2026-10-23'}).label,/Freezing rain/);assert.equal(ecmwfDailyCondition({amount:3,code:96,hourly:h,date:'2026-10-23'}).icon,'hail');assert.equal(ecmwfDailyCondition({amount:.2,code:3,hourly:{},date:'2026-10-23'}).label,'Isolated rain chances');assert.equal(ecmwfDailyCondition({amount:5,code:95,hourly:{},date:'2026-10-23'}).label,'Scattered thunderstorm chances');
});
test('backend K index rejects below-terrain soundings and lightning evidence expires',async()=>{
 const {kIndex,thunderEvidence,ecmwfDailyCondition}=await import('../public/storms.js'),{backendStormDay}=await import('../public/storm-outlook.js');const h={time:['2026-10-23T12:00'],cape:[600],showers:[.5],weather_code:[3],temperature_850hPa:[20],temperature_700hPa:[10],temperature_500hPa:[-12],relative_humidity_850hPa:[80],relative_humidity_700hPa:[80],surface_pressure:[1000]};assert.ok(kIndex(h,0)>30);assert.ok(thunderEvidence(h,'2026-10-23').weatherThunder);h.surface_pressure[0]=750;assert.equal(kIndex(h,0),null);h.showers[0]=0;assert.equal(thunderEvidence(h,'2026-10-23').weatherThunder,false);
 const now=Date.parse('2026-10-23T07:00:00Z'),backend={weatherThunder:false,lightningThunder:true,lightning_valid_until:new Date(now+60000).toISOString(),reason:'Nearby observed lightning and near-term forecast rain'};assert.ok(ecmwfDailyCondition({amount:.5,code:3,hourly:{},date:'2026-10-23',backend,now}).thunder);assert.equal(ecmwfDailyCondition({amount:.5,code:3,hourly:{},date:'2026-10-23',backend,now:now+120000}).thunder,false);
 const d={weather_fetched_at:new Date(now).toISOString(),cities:[{lat:31,lon:73,outlook:[{date:'2026-10-23',...backend}]}]};assert.ok(backendStormDay(d,31,73,'2026-10-23',now));assert.equal(backendStormDay(d,33,73,'2026-10-23',now),null);assert.equal(backendStormDay(d,31,73,'2026-10-23',now+7*3600000),null);
});
