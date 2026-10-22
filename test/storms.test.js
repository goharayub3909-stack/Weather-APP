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
