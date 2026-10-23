// Browser-only boundary library. Loading a boundary never silently changes the
// weather location, crop or confirmed stage. Those remain explicit choices.
import {validField} from './farm-monitoring.js';
export const FIELD_LIBRARY_KEY='weatherwalay-field-boundaries-v1';
export function readFieldLibrary(raw){
 try{const rows=JSON.parse(raw);if(!Array.isArray(rows))return [];return rows.filter(r=>typeof r.id==='string'&&r.id.length<=100&&typeof r.name==='string'&&r.name.trim()&&r.name.length<=70&&Array.isArray(r.location)&&r.location.length===2&&r.location.every(Number.isFinite)&&Array.isArray(r.vertices)&&r.vertices.length<=500&&validField(r.vertices)).slice(0,50);}catch{return [];}
}
export function sameFieldLocation(record,location){return record.location.every((v,i)=>Math.abs(v-location[i])<.00001);}
export function boundaryGeoJSON(vertices,name='My field'){
 if(!validField(vertices))throw Error('A valid boundary is required');
 return {type:'Feature',properties:{name,boundary_source:'User drawn; not surveyed'},geometry:{type:'Polygon',coordinates:[[...vertices,vertices[0]].map(([lat,lon])=>[lon,lat])]}};
}
export function fieldChangeSummary(rows){
 const valid=rows.filter(r=>Number.isFinite(r.value)).sort((a,b)=>a.time-b.time),latest=valid.at(-1),previous=valid.at(-2);
 if(!latest)return null;
 return {latest,previous,change:previous?latest.value-previous.value:null,days:previous?Math.round((latest.time-previous.time)/86400000):null};
}
