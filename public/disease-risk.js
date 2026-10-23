import {farmInstant} from './farm-advice.js';
import {researchScreen,finite} from './agri-models.js';

const HOUR=3600000;
export const DISEASE_RISK_METHOD='Weather screening only: high = at least 50% matching hours and a run of 6 hours; moderate = at least 25% matching hours or a run of 3 hours; low = some matching hours. At least 90% valid coverage is required for a grade. These are transparent screening thresholds, not calibrated infection probabilities. Leaf wetness, pathogen presence and source exposure requirements remain unverified.';

// Request the same explicit model for recent history and future data. A current
// station snapshot cannot stand in for 72 hours of station observations.
export function diseaseWeatherURL(lat,lon){
 if(!finite(lat)||!finite(lon)||lat<23||lat>38||lon<60||lon>78)throw Error('Choose a location in Pakistan.');
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({latitude:lat,longitude:lon,models:'ecmwf_ifs025',hourly:'temperature_2m,relative_humidity_2m',past_hours:72,forecast_hours:168,timezone:'Asia/Karachi'});
 return url;
}

export function validateDiseaseWeather(data,lat,lon){
 const h=data?.hourly;
 if(data?.utc_offset_seconds!==18000||data?.hourly_units?.temperature_2m!=='°C'||data?.hourly_units?.relative_humidity_2m!=='%'||!finite(data.latitude)||!finite(data.longitude)||Math.abs(data.latitude-lat)>.26||Math.abs(data.longitude-lon)>.26)throw Error('Unexpected model location or units');
 if(!Array.isArray(h?.time)||!h.time.length||h.time.length>336||h.temperature_2m?.length!==h.time.length||h.relative_humidity_2m?.length!==h.time.length)throw Error('Incomplete hourly weather');
 let previous=-Infinity;
 for(const stamp of h.time){const time=farmInstant(stamp);if(!finite(time)||time%HOUR||time<=previous)throw Error('Invalid or duplicated model hours');previous=time;}
 return h;
}

// Expand onto the exact requested hour axis. Omitted hours, invalid values and
// duplicate timestamps become missing values, never low-risk / zero readings.
export function diseaseWindow(hourly,start,hours){
 const axis=new Map();
 for(let i=0;i<(hourly?.time?.length||0);i++){
  const stamp=farmInstant(hourly.time[i]);if(!finite(stamp))continue;
  axis.set(stamp,axis.has(stamp)?-1:i);
 }
 const result={time:[],temperature_2m:[],relative_humidity_2m:[]};
 for(let i=0;i<hours;i++){
  const time=start+i*HOUR,index=axis.get(time),t=index>=0?hourly.temperature_2m?.[index]:null,rh=index>=0?hourly.relative_humidity_2m?.[index]:null;
  result.time.push(new Date(time).toISOString());
  result.temperature_2m.push(finite(t)&&t>=-90&&t<=65?t:null);
  result.relative_humidity_2m.push(finite(rh)&&rh>=0&&rh<=100?rh:null);
 }
 return result;
}

function grade(screen,expected){
 if(!screen.assessable)return {level:'review',label:'Criteria need review',rank:-1};
 if(screen.available<Math.ceil(expected*.9))return {level:'unknown',label:'Insufficient data',rank:-1};
 const fraction=screen.hits/screen.available;
 if(fraction>=.5&&screen.longest>=6)return {level:'high',label:'High weather risk',rank:3};
 if(fraction>=.25||screen.longest>=3)return {level:'moderate',label:'Moderate weather risk',rank:2};
 if(screen.hits)return {level:'low',label:'Low weather risk',rank:1};
 return {level:'none',label:'No weather signal',rank:0};
}
function assess(rule,values,start,hours){
 const screen=researchScreen(rule,values);
 return {...screen,...grade(screen,hours),expected:hours,start,end:start+hours*HOUR};
}

export function assessDisease(rule,hourly,now=Date.now(),historyHourly=hourly){
 const anchor=Math.floor(Number(now)/HOUR)*HOUR;
 const historical=diseaseWindow(historyHourly,anchor-72*HOUR,72),predicted=diseaseWindow(hourly,anchor,168);
 const slice=(start,count)=>Object.fromEntries(Object.entries(predicted).map(([key,values])=>[key,values.slice(start,start+count)]));
 const past=assess(rule,historical,anchor-72*HOUR,72);
 const future=assess(rule,predicted,anchor,168);
 const days=Array.from({length:7},(_,i)=>assess(rule,slice(i*24,24),anchor+i*24*HOUR,24));
 // Scan every hourly-ending 72h forecast window, not just fixed calendar days.
 // Only wholly forecast windows enter this peak; past and future never mix.
 let peak=null;
 for(let offset=0;future.assessable&&future.available>=65&&offset<=96;offset++){
  const window=assess(rule,slice(offset,72),anchor+offset*HOUR,72);
  if(window.rank<0)continue;
  if(!peak||window.rank>peak.rank||(window.rank===peak.rank&&(window.hits>peak.hits||(window.hits===peak.hits&&window.longest>peak.longest))))peak=window;
 }
 const outlook={...future,level:future.rank<0?future.level:peak?.level||future.level,label:future.rank<0?future.label:peak?.label||future.label,rank:future.rank<0?future.rank:peak?.rank??future.rank};
 return {past,outlook,days,peak,anchor};
}
