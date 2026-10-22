import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {acquisitionLabel,wmsOptions,validSatelliteLayer} from '../public/satellite-core.js';
const catalog=JSON.parse(await readFile(new URL('../public/satellite-data/catalog.json',import.meta.url)));
test('natural colour layer is discovered for Pakistan and uses explicit WMS times',()=>{
 const first=catalog.layers[0];assert.equal(first.name,'msg_iodc:rgb_natural');assert.ok(validSatelliteLayer(first));assert.ok(first.times.length);assert.equal(wmsOptions(first,first.times.at(-1)).version,'1.3.0');assert.throws(()=>wmsOptions(first,'1900-01-01T00:00:00Z'));
 assert.ok(!catalog.layers.some(l=>l.name.startsWith('backgrounds:')));
});
test('satellite acquisition label separates UTC and Pakistan local time',()=>{
 assert.match(acquisitionLabel('2026-10-22T07:45:00Z'),/07:45 UTC/);assert.match(acquisitionLabel('2026-10-22T07:45:00Z'),/12:45 PKT/);assert.match(acquisitionLabel(null),/unavailable/);
});
test('city photos are local, credited, and restricted to free licenses',async()=>{
 const data=JSON.parse(await readFile(new URL('../public/city-data/catalog.json',import.meta.url)));
 assert.ok(Object.keys(data.images).length>=20);
 for(const item of Object.values(data.images)){assert.match(item.file,/^photos\/[a-z0-9_]+\.(jpg|png|webp)$/);assert.ok(item.artist);assert.match(item.license_url,/^https:\/\/creativecommons\.org\//);assert.match(item.source_url,/^https:\/\/commons\.wikimedia\.org\//);}
});
