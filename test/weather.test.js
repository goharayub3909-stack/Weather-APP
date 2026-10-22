import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forecastURL,hourIndex,weather,aqiCategory,direction} from '../public/weather.js';
import {cities} from '../public/cities.js';
test('every city builds an ECMWF request with detailed weather parameters',()=>{
 assert.equal(Object.keys(cities).length,86);
 for(const [,lat,lon] of Object.values(cities)){
  const url=forecastURL(lat,lon);assert.equal(url.searchParams.get('models'),'ecmwf_ifs025');assert.match(url.searchParams.get('hourly'),/wind_gusts_10m/);assert.match(url.searchParams.get('hourly'),/dew_point_2m/);
 }
});
test('Pakistan hour selection works across UTC midnight and rejects missing hours',()=>{
 assert.equal(hourIndex(['2026-10-23T00:00','2026-10-23T01:00'],new Date('2026-10-22T19:25:00Z')),0);
 assert.equal(hourIndex(['2026-10-22T12:00'],new Date('2026-10-22T19:25:00Z')),-1);
});
test('missing weather and pollution are not reported as clear or clean',()=>{
 assert.deepEqual(weather(null),['Unavailable','—']);assert.equal(aqiCategory(null),'Unavailable');assert.equal(aqiCategory(175),'Unhealthy');assert.equal(direction(360),'N');assert.equal(direction(null),'—');
});
