import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CROPS} from '../public/farm-data.js';
import {fieldContext} from '../public/field-context.js';
import {chooseCurrentSource} from '../public/current-weather.js';
const reference=JSON.parse(readFileSync(new URL('../public/agri-reference.json',import.meta.url))),crop=CROPS.find(c=>c.id==='wheat'),base={reference,crop,zone:'plains',place:['Sialkot',32.49,74.53],now:new Date('2026-10-23T06:00Z')};
test('Sialkot wheat before district sowing has no spray / harvest operation regardless of favourable weather',()=>{const f=fieldContext(base);assert.equal(f.stage,'pre-sowing');assert.match(f.basis,/25 Oct/);assert.deepEqual(f.operations,{spray:false,fertilize:false,harvest:false});});
test('manual off-season harvest is flagged and blocked until the actual field stage is confirmed',()=>{const f=fieldContext({...base,selectedStage:'harvest'});assert.equal(f.conflict,true);assert.equal(f.operations.harvest,false);assert.equal(fieldContext({...base,selectedStage:'harvest',confirmed:true}).operations.harvest,true);});
test('seasonal harvest is an estimate and cannot establish actual maturity',()=>{const f=fieldContext({...base,now:new Date('2026-04-15T06:00Z')});assert.equal(f.stage,'harvest');assert.equal(f.verified,false);assert.equal(f.operations.harvest,false);});
test('unsupported location / overlapping stages cannot become an automatically confirmed field',()=>{const f=fieldContext({...base,zone:'north',place:['Skardu',35.3,75.6]});assert.equal(f.blocked,true);assert.equal(f.operations.harvest,false);assert.equal(fieldContext({...base,crop:null}).blocked,true);});
test('fresh full stations outrank nearby rain-only gauges, with freshness and distance limits retained',()=>{const now=Date.parse('2026-10-23T06:00Z'),gauge={name:'Rain gauge',lat:32.49,lon:74.53,observed_at:new Date(now).toISOString(),rain_daily:0},full={...gauge,name:'Full weather station',lat:32.6,temperature:25,humidity:65,wind_speed:0,pressure:1010};const pick=stations=>chooseCurrentSource(32.49,74.53,{stations},null,now);assert.equal(pick([gauge,full]).name,'Full weather station');assert.equal(pick([gauge,{...full,lat:35}]).name,'Rain gauge');assert.equal(pick([gauge,{...full,observed_at:new Date(now-4*3600000).toISOString()}]).name,'Rain gauge');assert.equal(pick([{...full,name:'Closer',lat:32.5},full]).name,'Closer');});

test('district sowing dates override broad monthly windows without inferring a planted field',()=>{assert.equal(fieldContext({...base,now:new Date('2026-10-26T06:00Z')}).stage,'sowing');const p=fieldContext({...base,crop:CROPS.find(c=>c.id==='potato')});assert.equal(p.stage,'mixed');assert.equal(p.blocked,true);});
