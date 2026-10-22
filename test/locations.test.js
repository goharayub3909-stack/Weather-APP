import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,rankLocations} from '../public/locations.js';
import {cleanStrikes} from '../public/lightning.js';
test('place search supports spelling aliases and prioritizes exact names',()=>{
 const rows=[{id:'1',name:'Dinga Colony',population:100000},{id:'2',name:'Dinga',population:1000},{id:'3',name:'Islamabad',aliases:'اسلام آباد'}];
 assert.equal(rankLocations(rows,'Dinga')[0].id,'2');assert.equal(rankLocations(rows,'اسلام آباد')[0].id,'3');assert.equal(normalize('Siālkot'),'sialkot');
});
test('lightning handles both real feed schemas and rejects malformed coordinates or time',()=>{
 const values=cleanStrikes([[29,70,1792660988596],{lat:30,lon:71,timestamp:'2026-10-22T09:00:00Z'},[0,0,1],[30,70,'bad']]);
 assert.equal(values.length,2);assert.equal(values[1].time,Date.parse('2026-10-22T09:00:00Z'));
});
