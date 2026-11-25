// Prefer the most complete fresh station within 50 km; distance breaks ties.
// currentValue reads one report (used by observed agri indices); mainReading
// implements the main-page per-field station → METAR → ECMWF fallback.
import {representative} from './terrain-source.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const STATION_MSL_RANGE=[960,1060];
export function distanceKm(lat,lon,p){const rad=Math.PI/180,a=Math.sin((p.lat-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(p.lat*rad)*Math.sin((p.lon-lon)*rad/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
export function stationCompleteness(report){
 const usable=(k,min,max)=>finite(report[k])&&report[k]>=min&&report[k]<=max;
 return [usable('temperature',-90,65),usable('humidity',0,100),usable('wind_speed',0,400),usable('rain_daily',0,3000)||usable('rain_rate',0,1000),usable('pressure',300,1100),usable('solar_radiation',0,1800),usable('dew_point',-100,65),usable('visibility',0,200000),usable('uv_index',0,30)].filter(Boolean).length;
}
// `terrain` ({profile, elevationOf}) makes the choice height-aware: in hills a report must be close in height as
// well as distance, otherwise the chain skips it (Murree is not served from Islamabad) and falls to ECMWF.
export function chooseCurrentSource(lat,lon,stations,metars,now=Date.now(),terrain=null){
 function nearby(rows,kind,limit,maxAge){return (rows||[]).flatMap(p=>{const time=kind==='station'?Date.parse(p.observed_at):p.obsTime*1000,fields=kind==='station'?['temperature','humidity','dew_point','wind_speed','wind_direction','wind_gust_10min','solar_radiation','uv_index','visibility','pressure','rain_daily','rain_rate']:['temp','dewp','wspd','wdir','wgst','altim'];if(!finite(p.lat)||!finite(p.lon)||!fields.some(key=>finite(p[key]))||!finite(time)||now-time>maxAge||time-now>300000)return [];const distance=distanceKm(lat,lon,p),fits=terrain?.profile?representative(terrain.profile,kind,distance,terrain.elevationOf?.(p)):distance<=limit;return fits?[{kind,report:p,time,distance,name:p.name||p.icaoId||'Weather station',completeness:kind==='station'?stationCompleteness(p):0}]:[];}).sort((a,b)=>b.completeness-a.completeness||a.distance-b.distance||b.time-a.time)[0];}
 const station=nearby(stations?.stations,'station',50,3*3600000),metar=nearby(metars?.stations,'metar',100,2*3600000),forecast={kind:'forecast',name:'ECMWF IFS',time:null,distance:null,report:null,terrain:terrain?.profile||null};
 const chain=[station,metar,forecast].filter(Boolean);return {...chain[0],fallbacks:chain.slice(1)};
}
export function currentValue(source,key,forecastValue){
 if(source.kind==='forecast')return finite(forecastValue)?forecastValue:null;
 const p=source.report;
 if(source.kind==='station'){
  const keys={temperature_2m:'temperature',relative_humidity_2m:'humidity',dew_point_2m:'dew_point',wind_speed_10m:'wind_speed',wind_direction_10m:'wind_direction',wind_gusts_10m:'wind_gust_10min',shortwave_radiation:'solar_radiation',uv_index:'uv_index',visibility:'visibility',rain_daily:'rain_daily',rain_rate:'rain_rate',pressure_msl:'pressure',precipitation:'rain_rate',rain:'rain_rate'},v=p[keys[key]];
  // The feed's pressure is a sea-level value (about 1018 hPa at Islamabad, where station level is about 959),
  // so it feeds the sea-level tile only; an implausible value falls through to METAR.
  if(key==='pressure_msl')return finite(v)&&v>=STATION_MSL_RANGE[0]&&v<=STATION_MSL_RANGE[1]?v:null;
  return finite(v)?v:null;
 }
 if(key==='relative_humidity_2m')return finite(p.temp)&&finite(p.dewp)?Math.min(100,Math.max(0,100*Math.exp(17.625*p.dewp/(243.04+p.dewp)-17.625*p.temp/(243.04+p.temp)))):null;
 const keys={temperature_2m:'temp',dew_point_2m:'dewp',wind_speed_10m:'wspd',wind_direction_10m:'wdir',wind_gusts_10m:'wgst',pressure_msl:'altim',visibility:'visib'},v=p[keys[key]];
 // METAR wind is in knots and visibility in statute miles; the page uses km/h and metres.
 return finite(v)?key==='wind_speed_10m'||key==='wind_gusts_10m'?v*1.852:key==='visibility'?v*1609.344:v:null;
}
export function currentCondition(source,forecastLabel){
 if(source.kind==='forecast')return forecastLabel;
 if(source.kind==='station')return 'Station observation';
 const p=source.report,wx=p.wxString||'';
 if(/TS/.test(wx))return 'Thunderstorm reported';if(/SN|SG/.test(wx))return 'Snow reported';if(/RA|DZ/.test(wx))return 'Rain reported';if(/FG|BR/.test(wx))return 'Fog / mist reported';
 const sky=(p.clouds||[]).map(c=>c.cover);if(sky.includes('OVC'))return 'Overcast reported';if(sky.includes('BKN'))return 'Broken cloud reported';if(sky.includes('SCT')||sky.includes('FEW'))return 'Clouds reported';if(sky.some(c=>['SKC','CLR','CAVOK'].includes(c)))return 'Clear sky reported';return 'Airport observation';
}

// A zero reading is valid. Derived METAR RH always uses that airport's own
// temperature / dew point; observations are never used to synthesize a model.
export function mainReading(primary,key,forecastValue){
 for(const source of [primary,...(primary.fallbacks||[])]){
  const value=currentValue(source,key,forecastValue);
  if(finite(value))return {value,source,fallback:source.kind!==primary.kind};
 }
 return {value:null,source:null,fallback:false};
}
