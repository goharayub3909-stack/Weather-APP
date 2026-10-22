import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {frameURL,imageBounds,productFrames,productOptions} from '../public/radar-core.js';
const catalog=JSON.parse(await readFile(new URL('../public/radar-data/catalog.json',import.meta.url)));
test('actual HAR station catalogs preserve provider geometry and three product timelines',()=>{
 for(const id of ['islamabad','karachi']){
  const station=catalog.stations[id];assert.equal(station.site.id,id);assert.equal(productOptions(station).length,3);
  for(const product of productOptions(station)){
   const frames=productFrames(station,product);assert.ok(frames.length>1);
   for(const frame of frames){const bounds=imageBounds(station.site,frame.radius);assert.ok(bounds[0][0]<bounds[1][0]);assert.ok(bounds[0][1]<bounds[1][1]);assert.match(frameURL(frame),new RegExp('^https://radar.weather.gov.pk/jbirds/images/radar/'+id+'/'));}
   assert.deepEqual(frames.map(f=>f.datetime),frames.map(f=>f.datetime).sort());
  }
 }
 assert.deepEqual(imageBounds(catalog.stations.islamabad.site,'450'),[[29.640137229,68.2061338539],[37.724974771,77.9220881461]]);
});
test('unsafe URLs and missing geometry cannot become map layers',()=>{
 for(const url of ['https://other.example/a.png','//other.example/a.png','images/radar/islamabad/../../secret.png','javascript:alert(1)'])assert.throws(()=>frameURL({url}));
 assert.throws(()=>imageBounds({},'450'));
 const station=structuredClone(catalog.stations.islamabad);station.frames.push({...station.frames[0],url:'https://other.example/a.png'});const frames=productFrames(station,station.frames[0].product);assert.equal(new Set(frames.map(f=>f.datetime+'|'+f.radius)).size,frames.length);
});
