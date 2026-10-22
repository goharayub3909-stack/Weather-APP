import {stormScreen} from './storms.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const HOUR=3600000;
// Open-Meteo timestamps without an offset are explicitly requested in PKT.
export function farmInstant(stamp){if(typeof stamp!=='string')return NaN;return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(stamp)?stamp:stamp+'+05:00');}
export function farmTime(stamp){return new Date(stamp).toLocaleString('en-GB',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' PKT';}
const max=values=>values.some(finite)?Math.max(...values.filter(finite)):null;
const min=values=>values.some(finite)?Math.min(...values.filter(finite)):null;
const sum=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):null;
const fmt=(v,unit)=>finite(v)?Number(v.toFixed(1))+' '+unit:'Unavailable';
const range=(v,lo,hi)=>finite(v)&&v>=lo&&v<=hi?v:null;
const thunder=code=>[95,96,99].includes(code);
const stampDate=now=>now.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});

/** Transparent planning rules, not calibrated crop-loss probabilities or
 * official PMD warnings. Only actual forecast values trigger recommendations.
 * Missing hours remain in the axis as null and can never create a dry window.
 */
export function analyseFarm({forecast,supplemental=null,crop=null,stage='mixed',now=new Date()}){
 const h=forecast?.hourly,base=Math.floor(now.getTime()/HOUR)*HOUR;
 if(!h?.time?.length)return {available:false,reason:'Load the location forecast to get field recommendations.',alerts:[],windows:[],days:[]};
 const units=forecast.hourly_units;
 if(units&&['temperature_2m','precipitation','wind_speed_10m','wind_gusts_10m'].some(k=>units[k]!==({temperature_2m:'°C',precipitation:'mm',wind_speed_10m:'km/h',wind_gusts_10m:'km/h'})[k]))return {available:false,reason:'Forecast units could not be verified for farm advice.',alerts:[],windows:[],days:[]};
 const axis=new Map();h.time.forEach((t,i)=>{const time=farmInstant(t);if(finite(time)){if(axis.has(time))axis.set(time,-1);else axis.set(time,i);}});
 const sh=supplemental?.hourly,sa=new Map((sh?.time||[]).map((t,i)=>[farmInstant(t),i]));
 const records=Array.from({length:72},(_,n)=>{
  const time=base+n*HOUR,i=axis.get(time),si=sa.get(time),at=key=>i>=0?h[key]?.[i]:null;
  return {time,temp:range(at('temperature_2m'),-90,65),rain:range(at('precipitation'),0,500),wind:range(at('wind_speed_10m'),0,400),gust:range(at('wind_gusts_10m'),0,500),rh:range(at('relative_humidity_2m'),0,100),code:range(at('weather_code'),0,99),supp:si>=0?stormScreen(sh,si):null};
 });
 const covered=records.slice(0,24).filter(r=>[r.temp,r.rain,r.wind,r.gust].some(finite)).length;
 if(!covered)return {available:false,reason:'No current forecast hours are available for this location. Refresh the weather forecast.',alerts:[],windows:[],days:[]};
 const first=records.slice(0,24),summary={rain:sum(first.map(r=>r.rain)),high:max(first.map(r=>r.temp)),low:min(first.map(r=>r.temp)),gust:max(first.map(r=>r.gust))};
 const complete=first.every(r=>[r.temp,r.rain,r.wind,r.gust].every(finite));
 const complete72=records.filter(r=>[r.temp,r.rain,r.wind,r.gust].every(finite)).length;
 const alerts=[],add=(id,level,title,evidence,action,glyph='leaf',source='ECMWF forecast')=>alerts.push({id,level,title,evidence,action,glyph,source});
 const cropName=crop?.name||'your crop',isHarvest=stage==='harvest',isSowing=stage==='sowing',isOrchard=crop?.group==='Orchard';
 const rolling=[];for(let i=0;i<=48;i++){const value=sum(records.slice(i,i+24).map(r=>r.rain));if(finite(value))rolling.push({value,time:records[i].time});}
 const wet=rolling.sort((a,b)=>b.value-a.value)[0],peak=records.filter(r=>finite(r.rain)).sort((a,b)=>b.rain-a.rain)[0];
 if((wet?.value>=20)||(peak?.rain>=10))add('heavy-rain',(wet?.value>=40||peak?.rain>=20)?'alert':'watch','Prepare for heavier rain',wet?.value>=20?`${fmt(wet.value,'mm')} in 24 forecast hours from ${farmTime(wet.time)}.`:`${fmt(peak.rain,'mm')} in the hour ending ${farmTime(peak.time)}.`,crop?.id==='rice'?'Check bunds, drains and field inlets. Protect harvested paddy and seed; avoid unnecessary irrigation before rain.':`Clear drains and protect seed, fertiliser and harvested ${cropName.toLowerCase()}. ${isSowing?'Avoid sowing into waterlogged soil.':isHarvest?'Consider an earlier dry picking window if the crop is mature.':'Check field drainage before the rain arrives.'}`,'rain');
 else if(peak?.rain>=.2)add('rain','plan','Plan around forecast showers',`${fmt(peak.rain,'mm')} in the hour ending ${farmTime(peak.time)}. Next 24-hour total: ${fmt(summary.rain,'mm')}.`,`${isHarvest?'Keep picked produce covered and wait for crop surfaces to dry before harvesting.':'Protect seed and inputs; reconsider field operations near the rain period.'} Small amounts of rain may not replace irrigation; check root-zone moisture.`,'rain');
 const cold=records.filter(r=>finite(r.temp)).sort((a,b)=>a.temp-b.temp)[0];
 if(cold?.temp<=2)add('cold',cold.temp<=0?'alert':'watch',cold.temp<=0?'Freezing air forecast':'Watch for frost conditions',`${fmt(cold.temp,'°C')} at 2 m around ${farmTime(cold.time)}. Ground-level conditions may differ.`,`${isOrchard?'Check orchard frost protection arrangements, especially around blossom and young fruit.':'Protect tender seedlings and exposed vegetables with suitable covers; check covers and tunnels before nightfall.'} Delay unnecessary transplanting during the coldest period.`,'snow');
 const heatLimit=crop?.cool&&stage==='flowering'?30:35,hot=records.filter(r=>finite(r.temp)).sort((a,b)=>b.temp-a.temp)[0];
 if(hot?.temp>=heatLimit)add('heat',hot.temp>=40?'alert':'watch',heatLimit===30?'Heat during flowering / grain filling':'Heat watch for crops and workers',`${fmt(hot.temp,'°C')} around ${farmTime(hot.time)}; planning trigger ${heatLimit}°C.`,`${crop?.cool?'Monitor cool-season crops for stress. ':''}Inspect root-zone moisture before adjusting irrigation; avoid waterlogging. Move strenuous fieldwork to cooler hours and provide drinking water and shade.`,'sun');
 const windy=records.filter(r=>finite(r.gust)||finite(r.wind)).sort((a,b)=>(b.gust??b.wind)-(a.gust??a.wind))[0];
 if(windy&&(windy.gust>=35||windy.wind>=25))add('wind',windy.gust>=60?'alert':'watch','Secure crops, covers and equipment',`${fmt(windy.gust,'km/h gusts')} · ${fmt(windy.wind,'km/h wind')} around ${farmTime(windy.time)}.`,`${crop?.id==='maize'||crop?.id==='sugarcane'?'Inspect tall crops for lodging risk. ':''}Secure tunnel covers, young-tree supports and loose equipment. Postpone spraying in gusty conditions; follow the product label and measured on-field wind.`,'wind');
 const storm=records.find(r=>thunder(r.code)||r.supp?.thunder);
 if(storm)add('storm','watch','Thunderstorm signal: plan field shelter',`Model thunderstorm code near ${farmTime(storm.time)}.`, 'Move workers and livestock to substantial shelter when thunder is heard. Avoid exposed fields, isolated trees and electrical irrigation equipment during a storm.','storm',thunder(storm.code)?'ECMWF weather code':'Supplemental weather model');
 const hail=records.find(r=>[96,99].includes(r.code)||r.supp?.explicitHail||r.supp?.ingredients);
 if(hail){const explicit=[96,99].includes(hail.code)||hail.supp?.explicitHail;add('hail','watch',explicit?'Model hail signal':'Hail ingredients: monitor updates',`${explicit?'Hail weather code':'Combined instability, wind, freezing-height and convection screen'} near ${farmTime(hail.time)}.`, 'Check protection for nurseries, tunnels and valuable fruit where practical. Follow updated local forecasts; this signal does not establish hail occurrence or a hail probability.','hail',[96,99].includes(hail.code)?'ECMWF weather code':'Supplemental model · screening');}
 let humidRun=[],humid=null;for(const r of records){if(r.rh>=85&&finite(r.rh)&&r.temp>=10&&r.temp<=30&&finite(r.temp)){humidRun.push(r);if(humidRun.length===6&&!humid)humid=humidRun[0];}else humidRun=[];}
 if(humid)add('humidity','watch','Scout crops after humid periods',`At least 6 consecutive hours with RH ≥85% and 10–30°C from ${farmTime(humid.time)}.`, 'Inspect leaves and fruit for early symptoms and improve tunnel or storage ventilation. Humidity is a scouting cue, not a disease diagnosis; do not apply fungicide from this indicator alone.','humidity');
 const rain72=sum(records.map(r=>r.rain));
 if(finite(rain72)&&rain72<2)add('moisture','plan','Check moisture before irrigating',`${fmt(rain72,'mm')} precipitation across the next 72 forecast hours.`,`${isSowing?'Check seedbed moisture before sowing. ':''}${isOrchard?'Inspect the active root zone and irrigation emitters. ':''}Use soil moisture, crop stage and your irrigation schedule to decide whether watering is needed. A dry forecast is not a drought diagnosis; no irrigation quantity is estimated.`,'humidity');
 if(crop){
  const timing=isHarvest?'Check maturity before picking and use a suitable dry period; let dew or rain on the crop dry first.':isSowing?'Check seedbed moisture and drainage before planting; use local variety and sowing-date guidance.':stage==='flowering'?'Inspect flowering and grain-filling crops for water or temperature stress; adjust irrigation only after checking soil moisture.':'Match field checks and irrigation to your actual growth stage and root-zone conditions.';
  add('crop-plan','plan',crop.name+' · field plan',`Selected crop / stage · next 24 model hours: ${fmt(summary.rain,'mm')} precipitation, ${fmt(summary.low,'°C')} low.`,crop.note+' '+timing,crop.glyph,'Your selected crop / stage + ECMWF');
 }
 // Candidate dry fieldwork periods need every hour plus a short rain/storm
 // look-ahead. This never establishes soil trafficability or a safe spray slot.
 const candidates=[];
 for(let i=0;i<=42;i++){
  const work=records.slice(i,i+3),buffer=records.slice(i,i+6),daytime=work.every(r=>{const hour=Number(new Date(r.time).toLocaleTimeString('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',hourCycle:'h23'}));return hour>=6&&hour<18;});
  if(daytime&&work.every(r=>finite(r.temp)&&r.temp>=5&&r.temp<=35&&finite(r.wind)&&r.wind<=20&&finite(r.gust)&&r.gust<=30)&&buffer.every(r=>finite(r.rain)&&r.rain<.2&&finite(r.code)&&!thunder(r.code)&&!r.supp?.thunder&&!r.supp?.explicitHail&&!r.supp?.ingredients))candidates.push({start:work[0].time,end:work[2].time+HOUR});
 }
 const windows=[];for(const w of candidates){const last=windows.at(-1);if(last&&w.start<=last.end)last.end=Math.max(last.end,w.end);else windows.push({...w});}
 const d=forecast.daily||{},today=stampDate(now),days=(d.time||[]).flatMap((date,i)=>date>=today?[{date,high:range(d.temperature_2m_max?.[i],-90,65),low:range(d.temperature_2m_min?.[i],-90,65),rain:range(d.precipitation_sum?.[i],0,2000)}]:[]).slice(0,7);
 alerts.sort((a,b)=>({alert:0,watch:1,plan:2}[a.level]-{alert:0,watch:1,plan:2}[b.level]));
 return {available:true,summary,complete,complete72,covered,alerts,windows:windows.slice(0,3),days,start:base,end:base+71*HOUR,heatLimit};
}
