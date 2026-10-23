import {distanceKm} from './current-weather.js';
import {diseaseWindow} from './disease-risk.js';

// Use one sufficiently complete nearby station archive for the past window.
// Individual missing station hours are never patched with model values.
export async function loadStationHistory(lat,lon,signal,now=Date.now()){
 const r=await fetch(new URL('./station-history/index.json',import.meta.url),{signal,cache:'no-store'});if(!r.ok)throw Error('Archive not available');const manifest=await r.json();
 if(manifest.schema_version!==1||!Array.isArray(manifest.stations))throw Error('Invalid archive');
 const nearby=manifest.stations.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&/^[a-f0-9]{20}\.json$/.test(s.file)).map(s=>({...s,distance:distanceKm(lat,lon,s)})).filter(s=>s.distance<=50).sort((a,b)=>a.distance-b.distance);
 let building=null;
 for(const station of nearby){
  // The manifest count avoids downloading hundreds of incomplete archives.
  if(station.hours<65){building??=station;continue;}
  const response=await fetch(new URL('./station-history/'+station.file,import.meta.url),{signal});if(!response.ok)continue;const data=await response.json();
  if(data.schema_version!==1||data.station?.lat!==station.lat||data.station?.lon!==station.lon)continue;
  const start=Math.floor(now/3600000)*3600000-72*3600000,values=diseaseWindow(data.hourly,start,72),valid=values.temperature_2m.filter((v,i)=>v!==null&&values.relative_humidity_2m[i]!==null).length;
  if(valid<65){building??={...station,hours:valid};continue;}
  return {station,manifest,hourly:data.hourly,basis:data.station.observed_time_basis};
 }
 return {station:null,manifest,building:building||nearby[0]||null};
}
