import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isStale,MAX_AGE_HOURS,observationValue,observationColor} from '../public/observations.js';

const H=3600000,now=Date.parse('2026-10-28T10:00:00Z');

test('airport reports go stale after 2 h and stations after 3 h, matching the main page',()=>{
 assert.deepEqual(MAX_AGE_HOURS,{station:3,metar:2});
 assert.equal(isStale(now-1.9*H,true,now),false);assert.equal(isStale(now-2.1*H,true,now),true);
 assert.equal(isStale(now-2.9*H,false,now),false);assert.equal(isStale(now-3.1*H,false,now),true);
 assert.equal(isStale(NaN,true,now),true);
});

test('airport observations convert knots to km/h and derive humidity from temperature and dew point',()=>{
 assert.ok(Math.abs(observationValue({wspd:10},true,'wind')-18.52)<1e-9);
 assert.equal(observationValue({wspd:null},true,'wind'),null);
 // Dew point equals temperature: saturated air.
 assert.ok(Math.abs(observationValue({temp:20,dewp:20},true,'humidity')-100)<1e-6);
 // 30 °C with a 15 °C dew point is about 40 % (Magnus form).
 const rh=observationValue({temp:30,dewp:15},true,'humidity');assert.ok(rh>39&&rh<42,String(rh));
 assert.equal(observationValue({temp:30},true,'humidity'),null);
 assert.equal(observationValue({temp:30},true,'rain_daily'),null);
 assert.equal(observationValue({temperature:31,humidity:40,wind_speed:12},false,'wind'),12);
});

test('station colours: zero rain is its own pale class and missing values are grey',()=>{
 assert.equal(observationColor(0,'rain_daily'),'#b3d7dd');
 assert.equal(observationColor(.1,'rain_daily'),'#6bcfc5');
 assert.equal(observationColor(500,'rain_daily'),'#c594e6');
 assert.equal(observationColor(null,'temperature'),'#7f8c9e');
 assert.equal(observationColor(-5,'temperature'),'#8fb3ff');
 assert.equal(observationColor(40,'temperature'),'#ff7c81');
});
