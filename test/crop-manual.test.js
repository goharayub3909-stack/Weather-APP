import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CROPS} from '../public/farm-data.js';
import {CROP_MANUALS} from '../public/crop-manual-data.js';
import {manualForContext,manualText} from '../public/crop-manual.js';
const context={crop:CROPS.find(c=>c.id==='wheat'),place:['Sialkot',32.5,74.5],stage:'pre-sowing',field:{records:[{dates:'25 Oct–20 Nov'}]}};
test('each selectable crop has seven chronological stages and all five required management points',()=>{
 assert.equal(Object.keys(CROP_MANUALS).length,CROPS.length);
 for(const crop of CROPS){const manual=CROP_MANUALS[crop.id];assert.equal(manual.stages.length,7);assert.match(manual.source.url,/^https:\/\/zarat.kp.gov.pk\/crops\/view_crop\//);for(const [i,s]of manual.stages.entries()){
  assert.equal(s.number,i+1);for(const key of ['name','objective','timing','technical','warning'])assert.ok(typeof s[key]==='string'&&s[key].length>3,crop.id+' '+key);
  assert.ok(s.actions.length>=2);for(const a of s.actions)assert.match(a,/^(Level|Test|Drill|Calibrate|Count|Check|Control|Split|Protect|Avoid|Maintain|Inspect|Harvest|Measure|Select|Match|Transplant|Scout|Coordinate|Dry|Remove|Sow|Thin|Balance|Keep|Pick|Prepare|Place|Identify|Reject|Grade|Use|Cover|Earth|Rotate|Confirm|Record|Apply|Retain|Manage|Distinguish|Plan|Lift|Separate|Cut|Base|Raise|Stake|Prune|Assess|Plant|Pollinate|Review|Choose|Cure|Handle|Monitor|Replace|Store)/);
 }}
});
test('local sowing dates qualify the reference without confirming planting or overriding harvest gating',()=>{
 const manual=manualForContext(context);assert.match(manual.stages[1].timing,/Sialkot: 25 Oct/);assert.equal(context.stage,'pre-sowing');assert.equal(manual.stages[6].group,'harvest');assert.ok(!CROP_MANUALS.wheat.stages[1].timing.includes('Sialkot'));
 assert.equal(manualForContext({...context,crop:null}),null);
});
test('crop physiology is specific: cane growth and potato bulking are not forced into grain flowering',()=>{
 assert.match(CROP_MANUALS.sugarcane.stages[4].name,/Grand growth/);assert.match(CROP_MANUALS.sugarcane.stages[4].timing,/flowering is not required/);assert.match(CROP_MANUALS.potato.stages[4].name,/Tuber bulking/);assert.match(CROP_MANUALS.dates.stages[4].actions[0],/Pollinate/);
});
test('offline manual preserves every five-part stage and source scope',()=>{
 const text=manualText(context);for(const label of ['Objective:','Timing:','Actionable Steps:','Technical Parameters:','Critical Danger/Warning:'])assert.equal(text.split(label).length-1,7);assert.match(text,/variety \/ province references/);assert.match(text,/not a verbatim official package/);
});
