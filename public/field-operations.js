import {addTileHelp} from './tile-help.js';
import {finite,deltaT,irrigationPlan} from './agri-models.js';
import {farmInstant,farmTime} from './farm-advice.js';
import {initSoilSensors} from './soil-sensors.js';
const HOUR=3600000;
// Indicative crop coefficients / minimum soil temperatures. Local variety,
// canopy, method and soil conditions must be confirmed; these are not sensors.
export const CROP_FIELD_GUIDES={wheat:{minimum:5,kc:{sowing:.3,growing:1.15,flowering:1.15,harvest:.4}},rice:{minimum:20,kc:{sowing:1.05,growing:1.2,flowering:1.2,harvest:.75}},maize:{minimum:10,kc:{sowing:.3,growing:1.2,flowering:1.2,harvest:.6}},cotton:{minimum:16,kc:{sowing:.35,growing:1.15,flowering:1.15,harvest:.5}},potato:{minimum:7,kc:{sowing:.5,growing:1.15,flowering:1.15,harvest:.75}},sugarcane:{minimum:20,kc:{sowing:.4,growing:1.25,flowering:1.25,harvest:.75}}};
export function soilWaterState({moisture,capacity,wilting,depth,time},now=Date.now()){
 const stamp=farmInstant(time);
 if(![moisture,capacity,wilting,depth].every(finite)||wilting<0||capacity<=wilting||capacity>70||moisture<0||moisture>70||depth<=0||depth>3||!finite(stamp)||stamp>now+300000||now-stamp>24*HOUR)return null;
 return {reserve:(capacity-wilting)*10*depth,deficit:Math.max(0,Math.min(capacity-moisture,capacity-wilting))*10*depth,stamp,saturated:moisture>=capacity};
}
export function operationWindows(hourly,now=Date.now(),{limit=3}={}){
 const anchor=Math.floor(Number(now)/HOUR)*HOUR,axis=new Map();for(let i=0;i<(hourly?.time.length||0);i++){const t=farmInstant(hourly.time[i]);axis.set(t,axis.has(t)?-1:i);}
 const row=time=>{const i=axis.get(time);if(!(i>=0))return null;const get=key=>hourly[key]?.[i];return {time,t:get('temperature_2m'),rh:get('relative_humidity_2m'),wind:get('wind_speed_10m'),gust:get('wind_gusts_10m'),rain:get('precipitation'),code:get('weather_code')};};
 const future=(time,n)=>Array.from({length:n},(_,i)=>row(time+i*HOUR));
 const noStorm=r=>finite(r?.code)&&![95,96,99].includes(r.code);
 const dry=(r,max)=>r&&finite(r.rain)&&r.rain<max&&noStorm(r);
 const candidates={spray:[],fertilize:[],harvest:[]};
 for(let step=0;step<168;step++){
  const time=anchor+step*HOUR,r=row(time),hour=new Date(time).toLocaleString('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',hourCycle:'h23'});if(!r||hour<6||hour>=18)continue;
  const six=future(time,6),twelve=future(time,12),day=future(time,24),dt=deltaT(r.t,r.rh).value;
  if([r.t,r.rh,r.wind,r.gust,dt].every(finite)&&r.t>=5&&r.t<=28&&r.rh>=40&&r.rh<=95&&r.wind>=3&&r.wind<=15&&r.gust<=20&&dt>=2&&dt<=8&&six.every(x=>dry(x,.2)))candidates.spray.push(time);
  if(finite(r.wind)&&r.wind<=20&&six.every(x=>dry(x,.2))&&day.every(x=>x&&finite(x.rain)&&noStorm(x))){const rain=day.reduce((n,x)=>n+x.rain,0);if(rain>=2&&rain<=10&&day.every(x=>x.rain<5))candidates.fertilize.push(time);}
  if([r.t,r.rh,r.wind,r.gust].every(finite)&&r.t>=5&&r.t<=35&&r.rh<=75&&r.wind<=20&&r.gust<=30&&twelve.every(x=>dry(x,.2)))candidates.harvest.push(time);
 }
 const group=values=>{const result=[];for(const t of values){const last=result.at(-1);if(last&&last.end===t)last.end+=HOUR;else result.push({start:t,end:t+HOUR});}return result.filter(w=>w.end-w.start>=3*HOUR).slice(0,limit);};
 return Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,group(v)]));
}
// A calendar uses every qualifying period, rather than only the three preview
// windows shown in the detailed cards. Dates and clock labels are always PKT.
export function operationCalendar(hourly,now=Date.now()){
 const windows=operationWindows(hourly,now,{limit:Infinity}),today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'}),start=Date.parse(today+'T00:00:00+05:00');
 return Array.from({length:7},(_,i)=>{const stamp=start+i*24*HOUR,date=new Date(stamp).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});return {date,time:stamp,actions:Object.fromEntries(Object.entries(windows).map(([key,rows])=>[key,rows.filter(w=>new Date(w.start).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'})===date)]))};});
}
export function fieldWarnings(hourly,now=Date.now(),heat=35){
 const anchor=Math.floor(Number(now)/HOUR)*HOUR,rows=(hourly?.time||[]).flatMap((t,i)=>{const time=farmInstant(t),value=hourly.temperature_2m?.[i];return time>=anchor&&time<anchor+24*HOUR&&finite(value)?[{time,value}]:[];});
 return {coverage:rows.length,frost:rows.some(r=>r.value<=2),freezing:rows.some(r=>r.value<=0),heat:rows.some(r=>r.value>=heat),minimum:rows.length?Math.min(...rows.map(r=>r.value)):null,maximum:rows.length?Math.max(...rows.map(r=>r.value)):null,heatThreshold:heat};
}
const $=id=>document.getElementById(id),format=(v,s)=>finite(v)?Number(v.toFixed(1))+s:'—';
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
export function initFieldOperations(){
 let context=null,lastCrop='',lastPlace='',notifications=false;try{notifications=localStorage.getItem('badal-field-warnings')==='1'&&'Notification'in window&&Notification.permission==='granted';}catch{}const soilInputs=['soil-temperature','soil-temperature-depth','soil-moisture','soil-depth','soil-time'];const sensors=initSoilSensors(device=>{for(const id of soilInputs)$(id).value='';if(device?.usable){const r=device.reading;const local=new Date(r.observed_at).toLocaleString('sv-SE',{timeZone:'Asia/Karachi'}).replace(' ','T').slice(0,16);$('soil-time').value=local;if(device.temperatureFresh){$('soil-temperature').value=r.temperature_c??'';$('soil-temperature-depth').value=r.temperature_depth_cm??'';}if(r.root_zone_moisture_vwc_percent!==null&&r.root_zone_depth_cm!==null){$('soil-moisture').value=r.root_zone_moisture_vwc_percent;$('soil-depth').value=r.root_zone_depth_cm/100;}}render();});const number=id=>$(id).value.trim()===''?null:Number($(id).value);
 for(const id of ['soil-temperature','soil-temperature-depth','soil-moisture','soil-capacity','soil-wilting','soil-depth','soil-time','soil-sow-min'])$(id).addEventListener('change',render);
 $('field-enable-alerts').addEventListener('click',async()=>{
  if(!('Notification'in window)){$('field-alert-status').textContent='Browser notifications are unavailable here. In-page warnings remain active.';return;}
  try{const permission=await Notification.requestPermission();notifications=permission==='granted';try{localStorage.setItem('badal-field-warnings',notifications?'1':'0');}catch{}$('field-alert-status').textContent=notifications?'Browser field warnings enabled while this app is open. No SMS or closed-app background delivery is configured.':'Browser notifications were not enabled; in-page warnings remain active.';render();}catch{$('field-alert-status').textContent='This browser could not enable notifications. In-page warnings remain active.';}
 });
 async function notify(warning){
  if(!notifications||(!warning.frost&&!warning.heat)||!context)return;
  const key=context.place.slice(1).join(',')+':'+new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'})+':'+warning.frost+':'+warning.heat;
  try{if(localStorage.getItem('badal-field-alert')===key)return;const body=context.place[0]+': '+(warning.frost?'Frost watch, minimum '+format(warning.minimum,'°C')+'. ':'')+(warning.heat?'Heat watch, maximum '+format(warning.maximum,'°C')+'. ':'')+' Forecast guidance; check local conditions.';const registration=await navigator.serviceWorker?.getRegistration();if(registration)await registration.showNotification('WeatherWalay Kissan & Sehat Hub · field weather watch',{body,tag:'badal-field-warning',icon:'./app-icon-192.png'});else new Notification('WeatherWalay Kissan & Sehat Hub · field weather watch',{body});localStorage.setItem('badal-field-alert',key);}catch{$('field-alert-status').textContent='Browser notification delivery failed; check the in-page warnings.';}
 }
 function render(){
  if(!context)return;for(const id of soilInputs)$(id).readOnly=$('soil-reading-source').value==='sensor';const now=Date.now(),{forecast,crop,place,stage}=context,h=forecast?.hourly,guide=CROP_FIELD_GUIDES[crop?.id],fresh=forecast&&context.retrievedAt&&now-new Date(context.retrievedAt).getTime()<=3*HOUR;
  const field=context.field,allowed=field?.operations||{},root=$('field-operation-windows');root.replaceChildren();
  const windows=fresh?operationWindows(h,now):{spray:[],fertilize:[],harvest:[]};
  const actions=[['spray','Spraying'],['fertilize','Fertilizing'],['harvest','Harvesting']].filter(([key])=>allowed[key]),calendar=$('field-calendar');calendar.replaceChildren();calendar.hidden=!actions.length;
  $('field-decision-context').textContent=(crop?.name||'Choose a crop')+' · '+place[0]+' · '+(stage==='pre-sowing'?'Before sowing':stage==='mixed'?'Stage needed':stage.charAt(0).toUpperCase()+stage.slice(1))+' · '+(field?.verified?'Stage confirmed by you':field?.manual?'Stage confirmation needed':'Seasonal estimate')+(fresh?' · forecast planning':' · fresh forecast needed');
  $('field-window-details').open=!actions.length;
  if(actions.length){const table=el('table','operation-calendar-table'),caption=el('caption','','Seven-day work calendar · only operations relevant to this crop stage');table.append(caption);const head=el('thead'),hr=el('tr');hr.append(el('th','','Day'));for(const [,label]of actions)hr.append(el('th','',label));head.append(hr);table.append(head);const body=el('tbody');
   for(const day of operationCalendar(h,now)){const tr=el('tr'),date=el('th','',new Date(day.time).toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',weekday:'short',day:'numeric',month:'short'}));date.scope='row';tr.append(date);for(const [key,label]of actions){const td=el('td'),w=fresh?day.actions[key][0]:null;td.dataset.label=label;td.dataset.state=w?'window':fresh?'none':'unknown';const clock=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit'});td.append(el('strong','',w?clock(w.start)+'–'+clock(w.end):fresh?'No complete window':'Awaiting forecast'));td.append(el('small','',w?'Meets weather screen · PKT':fresh?'Criteria or data gaps prevent a window':'No planning conclusion'));tr.append(td);}body.append(tr);}table.append(body);calendar.append(table,el('p','farm-explainer','Green: a complete weather window meets the screen. Amber: no complete window; conditions or missing data may prevent one. Forecasts do not confirm soil trafficability, crop maturity or pesticide suitability.'));
  }
  for(const [key,title,note]of [['spray','Spraying weather','Delta T 2–8°C; temperature 5–28°C; RH 40–95%; wind 3–15 km/h; gust ≤20 km/h; six dry, non-thundery hours. Check inversion, product label, rainfastness and equipment.'],['fertilize','Granular fertilizer incorporation','Dry application followed by 2–10 mm gentle precipitation in 24h; no hour ≥5 mm. Assumes soil-applied granular fertilizer. Check soil, nutrient test, product, drainage and runoff; no fertilizer rate is inferred.'],['harvest','Harvesting weather','At least three daylight hours; RH ≤75%; wind ≤20 km/h; gust ≤30 km/h; twelve dry, non-thundery hours. Crop maturity, grain moisture and soil trafficability remain unmeasured.']]){
   if(!allowed[key])continue;
   const card=el('article','card field-operation-card');card.dataset.operation=key;card.dataset.tone=!allowed[key]?'inactive':windows[key].length?'good':'watch';card.append(el('span','operation-symbol',({spray:'❧',fertilize:'♧',harvest:'♒'})[key]),el('h3','',title));if(!allowed[key])card.append(el('p','agri-unknown',key==='harvest'?'Not applicable until you select and confirm a mature crop at harvest / picking stage. No harvest dates are recommended.':field?.reason||'Select and confirm the actual crop stage first.'));else if(!fresh)card.append(el('p','agri-unknown','A fresh location forecast is required.'));
   else if(!windows[key].length)card.append(el('p','agri-unknown',key==='fertilize'?'No complete gentle-rain incorporation period found. If using irrigation, confirm soil needs and product incorporation requirements.':'No complete period meets all weather criteria in the next seven days. Missing inputs cannot qualify.'));
   else for(const window of windows[key])card.append(el('p','field-window',farmTime(window.start)+' → '+farmTime(window.end)));
   if(allowed[key])card.append(el('small','',note));addTileHelp(card,key);root.append(card);
  }
  if(!root.children.length){const card=el('article','card field-operation-card');card.append(el('h3','',stage==='pre-sowing'?'Prepare for sowing':'Set the actual crop stage'),el('p','',field?.reason||'Choose your crop and confirm the stage observed in this field.'));addTileHelp(card,'preparation');root.append(card);}
  const measurement={moisture:number('soil-moisture'),capacity:number('soil-capacity'),wilting:number('soil-wilting'),depth:number('soil-depth'),time:$('soil-time').value},soil=soilWaterState(measurement,now),temp=number('soil-temperature'),minimum=number('soil-sow-min'),stamp=farmInstant(measurement.time),temperatureDepth=number('soil-temperature-depth'),validTemp=finite(temperatureDepth)&&temperatureDepth>=0&&temperatureDepth<=300&&finite(temp)&&temp>=-20&&temp<=70&&finite(stamp)&&stamp<=now+300000&&now-stamp<=12*HOUR;
  $('field-sowing').textContent=!validTemp?'Soil-temperature assessment unavailable. The station feed has no soil sensor; enter a recent measured value, depth and PKT measurement time.':!finite(minimum)?'Set a locally confirmed minimum soil-temperature threshold for your crop.':`${crop?.name||'Selected crop'}: measured soil temperature ${temp}°C at ${temperatureDepth} cm depth, ${farmTime(stamp)}. ${temp<minimum?'Below':'Meets'} your ${minimum}°C minimum guide. This is a germination screen; assess frost, seedbed moisture and cultivar before sowing.`;
  const water=$('field-soil-irrigation');water.replaceChildren();
  water.dataset.tone=!soil?'unknown':soil.deficit>=soil.reserve*.5?'alert':'clear';
  if(field?.blocked||stage==='pre-sowing'||stage==='harvest')water.append(el('p','agri-unknown','Standing-crop irrigation scheduling is inactive at this stage. For seedbed preparation or a post-harvest field, check soil moisture and local agronomy separately.'));
  else if(!soil)water.append(el('p','agri-unknown','Automatic soil-based irrigation needs a measured moisture reading within 24h, PKT time, representative root-zone depth, field capacity and wilting point. No sensor measurement is invented.'));
  else if(crop?.id==='rice')water.append(el('p','agri-unknown','Rice: ponded-water management needs a paddy water balance and water-depth readings. The simple root-zone bucket is not used for an automatic paddy dose.'));
  else if(!fresh)water.append(el('p','agri-unknown','Soil readings are available; a fresh forecast is still needed for the irrigation scenario.'));
  else{
   const d=forecast.daily,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'}),days=(d?.time||[]).flatMap((date,i)=>date>=today?[{date,et0:d.et0_fao_evapotranspiration?.[i],rain:d.precipitation_sum?.[i]}]:[]).slice(0,7),plan=irrigationPlan(days,{...soil,kc:Number($('agri-kc').value),efficiency:Number($('agri-efficiency').value)}),next=plan?.find(r=>!r.unknown&&r.gross>0);
   water.append(el('p','',`Measured soil input · available root-zone water ${format(soil.reserve,' mm')}; depletion ${format(soil.deficit,' mm')}. Kc ${$('agri-kc').value}, efficiency ${$('agri-efficiency').value}%.`));
   water.append(el('strong','',next?`Exploratory refill: ${format(next.gross,' mm gross')} on ${next.date}.`:plan?.some(r=>r.unknown)?'Insufficient weather for a complete irrigation schedule.':'No refill trigger in the available model days.'));
   water.append(el('p','farm-explainer','Scenario: 70% effective precipitation, 50% depletion trigger, no runoff or capillary rise. Verify sensor placement, root-zone representation, soil and crop response before application.'));
  }
  const warning=fresh?fieldWarnings(h,now,crop?.cool&&stage==='flowering'?30:35):null;
  $('field-warning').dataset.tone=!warning?'unknown':warning.frost||warning.heat?'alert':warning.coverage<24?'unknown':'clear';
  $('field-sowing').dataset.tone=!validTemp||!finite(minimum)?'unknown':temp<minimum?'alert':'clear';
  $('field-warning').textContent=warning?`${place[0]} · next 24h: ${warning.frost?(warning.freezing?'Freezing air forecast':'Frost watch'):(warning.coverage<24?'Frost status uncertain · incomplete data':'No frost alert · no ≤2°C forecast trigger')}; ${warning.heat?'heat watch':'no ≥'+warning.heatThreshold+'°C heat trigger'}. ${warning.coverage}/24 valid hours. Canopy / soil temperatures may differ.`:'Frost / heat warnings need a fresh forecast. No safety conclusion is made from missing data.';
  if(warning)notify(warning);
  $('field-crop-guide').textContent=guide?`${crop.name} · indicative minimum soil-temperature guide ${guide.minimum}°C. Crop-stage Kc starting values are editable; confirm local agronomy and cultivar. Current stage: ${stage}.`:'Select a crop. Soil thresholds and crop coefficients require local confirmation.';
 }
 return {update(next){context=next;const key=next.place.slice(1).join(',');if(key!==lastPlace){lastPlace=key;sensors.reset();for(const id of [...soilInputs,'soil-capacity','soil-wilting'])$(id).value='';}for(const id of soilInputs)$(id).readOnly=$('soil-reading-source').value==='sensor';if(next.crop?.id!==lastCrop){lastCrop=next.crop?.id||'';$('soil-sow-min').value=CROP_FIELD_GUIDES[lastCrop]?.minimum??'';}render();}};
}
