import {CROPS,ZONES,activity,approximateZone,pakistanMonth,seasonName} from './farm-data.js';
import {analyseFarm,farmTime} from './farm-advice.js';
import {icon} from './icons.js';
const $=id=>document.getElementById(id);
const number=(v,unit)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toFixed(1))+' '+unit:'—';
// Provider/location names are always text nodes, never HTML templates.
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function glyph(name){const e=element('span','farm-glyph');e.innerHTML=icon(name);return e;}
export function initFarmers(){
 let state={place:['Islamabad',33.69,73.05],forecast:null,supplemental:null,status:'loading',retrievedAt:null},showAll=false;
 const preferences={crop:'all',stage:'auto',zone:'auto'};
 try{const saved=JSON.parse(localStorage.getItem('badal-farm-preferences'));if(saved){if(saved.crop==='all'||CROPS.some(c=>c.id===saved.crop))preferences.crop=saved.crop;if(['auto','sowing','growing','flowering','harvest'].includes(saved.stage))preferences.stage=saved.stage;if(saved.zone==='auto'||ZONES[saved.zone])preferences.zone=saved.zone;}}catch{}
 for(const [key,name]of Object.entries(ZONES))$('farm-zone').append(new Option(name,key));
 for(const crop of CROPS)$('farm-crop').append(new Option(crop.name+' · '+crop.urdu,crop.id));
 for(const key of ['crop','stage','zone']){
  $('farm-'+key).value=preferences[key];$('farm-'+key).addEventListener('change',()=>{preferences[key]=$('farm-'+key).value;try{localStorage.setItem('badal-farm-preferences',JSON.stringify(preferences));}catch{}render();});
 }
 $('farm-show-all').addEventListener('click',()=>{showAll=!showAll;render();});
 function navigate(){
  const active=location.hash==='#farmers';$('farmers-view').hidden=!active;$('weather-view').hidden=active;
  document.body.classList.toggle('farm-view',active);
  $('main-heading').textContent=active?'Weather for your farm.':'Pakistan, at a glance.';
  $('main-eyebrow').textContent=active?'GROW WITH THE FORECAST':'YOUR DAILY WEATHER COMPANION';
  document.querySelectorAll('.rail-link,.view-switch a').forEach(link=>{const selected=active?link.hash==='#farmers':link.hash===location.hash||(!location.hash&&link.hash==='#overview');link.classList.toggle('rail-active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.dispatchEvent(new CustomEvent('farmviewchange',{detail:active}));
  const frame=$('weather-explorer-frame');frame?.contentWindow?.postMessage({type:'badal-studio-visibility',visible:!active&&!$('weather-explorer').hidden},location.origin);
  window.dispatchEvent(new Event('resize'));
  if(active){render();window.scrollTo({top:0,behavior:'instant'});}
 }
 window.addEventListener('hashchange',navigate);
 $('farm-nav').addEventListener('click',()=>{if(location.hash==='#farmers')navigate();});
 navigate();
 // Map-tab initialization happens later in app.js; reapply the initial route
 // after it so direct #farmers links suspend embedded weather animation too.
 setTimeout(navigate,0);
 function render(){
  const now=new Date(),month=pakistanMonth(now),zone=preferences.zone==='auto'?approximateZone(state.place[1],state.place[2]):preferences.zone;
  const crop=CROPS.find(c=>c.id===preferences.crop),calendar=crop?activity(crop,zone,month):null,stage=preferences.stage==='auto'?calendar?.stage||'mixed':preferences.stage;
  $('farm-place').textContent=state.place[0];$('farm-season').textContent=seasonName(month,zone);
  $('farm-zone-note').textContent=(preferences.zone==='auto'?'Approximate area from coordinates: ':'Your chosen guide area: ')+ZONES[zone]+'. Adjust this guide for local altitude and planting dates.';
  $('farm-crop-context').textContent=crop?crop.name+' · '+(preferences.stage==='auto'?calendar.label:$('farm-stage').selectedOptions[0].textContent)+(calendar.suitable?'':' · using your selected crop despite the regional guide'): 'General field advice for seasonal crops. Select your actual crop and stage for a closer fit.';
  const result=analyseFarm({...state,crop,stage,now}),loaded=state.status==='ready'&&result.available;
  $('farm-data-status').textContent=loaded?`ECMWF IFS 0.25° via Open-Meteo · ${farmTime(result.start)} to ${farmTime(result.end)} · fetched ${state.retrievedAt?farmTime(state.retrievedAt):'time unavailable'}.`:(state.status==='loading'?'Loading this location’s forecast…':state.status==='error'?'Weather forecast unavailable. Press Refresh above to try again.':result.reason);
  $('farm-quality').hidden=!loaded;$('farm-quality').textContent=loaded?(result.complete?'Next 24 hours: complete core fields.':'Some next-24-hour fields are missing; partial values are shown and missing rain never becomes zero.')+` Complete core fields in ${result.complete72}/72 model hours; absent inputs stay unknown.`:'';
  const summary=$('farm-summary');summary.replaceChildren();
  for(const [label,value,glyphName,tone]of [['Next 24h rain',loaded?number(result.summary.rain,'mm'):'—','rain','rain'],['High / low · 24h',loaded?number(result.summary.high,'°C')+' / '+number(result.summary.low,'°C'):'—','temperature','warm'],['Peak gust · 24h',loaded?number(result.summary.gust,'km/h'):'—','wind','breeze'],['Weather cues · 72h',loaded?String(result.alerts.filter(a=>a.level!=='plan').length):'—','leaf','green']]){
   const card=element('div','farm-stat farm-stat--'+tone),copy=element('div');copy.append(element('span','',label),element('strong','',value));card.append(glyph(glyphName),copy);summary.append(card);
  }
  const alerts=$('farm-alerts');alerts.replaceChildren();
  if(!loaded){alerts.append(element('div','farm-empty',state.status==='loading'?'Waiting for forecast data. Crop calendar remains available below.':'No forecast-based recommendations are issued while weather data is unavailable.'));}
  else if(!result.alerts.length){const empty=element('div','farm-empty');empty.append(element('strong','','No planning threshold triggered in the available data.'),element('p','','Continue normal field scouting. This does not establish that conditions are safe or that all hazards are absent.'));alerts.append(empty);}
  else for(const alert of result.alerts){
   const card=element('article','farm-advisory farm-advisory--'+alert.level),head=element('div','farm-advisory-head'),title=element('div');title.append(element('span','farm-label',({alert:'Prepare · stronger signal',watch:'Weather watch',plan:'Planning note'})[alert.level]),element('h3','',alert.title));head.append(glyph(alert.glyph),title);card.append(head,element('p','farm-evidence',alert.evidence),element('p','farm-action',alert.action),element('span','farm-source',alert.source));alerts.append(card);
  }
  const windows=$('farm-windows');windows.replaceChildren();
  if(!loaded)windows.append(element('p','farm-empty','Forecast required to assess possible dry periods.'));
  else if(!result.windows.length)windows.append(element('p','farm-empty','No complete period meets the weather criteria in the next 48 hours. This may be due to rain, wind, temperature or missing data.'));
  else for(const window of result.windows){const row=element('div','farm-window');row.append(glyph('clock'),element('strong','',farmTime(window.start)+' → '+farmTime(window.end)));windows.append(row);}
  const days=$('farm-days');days.replaceChildren();
  if(loaded)for(const day of result.days){const card=element('article','farm-day'),valid=typeof day.rain==='number'&&typeof day.high==='number'&&typeof day.low==='number';const risk=valid?(day.rain>=20?'Drainage watch':day.low<=2?'Cold watch':day.high>=result.heatLimit?'Heat watch':day.rain>=.2?'Plan around rain':'Check field conditions'):'Incomplete data';card.append(element('strong','',new Date(day.date+'T12:00:00+05:00').toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',weekday:'short',day:'numeric',month:'short'})),glyph(!valid?'cloud':day.rain>=.2?'rain':day.low<=2?'snow':'sun'),element('b','',number(day.low,'°')+' / '+number(day.high,'°')),element('span','',number(day.rain,'mm')),element('small','',risk));days.append(card);}
  else days.append(element('p','farm-empty','Seven-day outlook unavailable until the location forecast loads.'));
  const grid=$('farm-crops');grid.replaceChildren();const relevant=CROPS.filter(c=>activity(c,zone,month).active),visible=showAll?CROPS:relevant;
  $('farm-calendar-heading').textContent=showAll?'Major crops of Pakistan':'Relevant in this guide area · '+now.toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',month:'long'});
  $('farm-show-all').textContent=showAll?'Show seasonal crops':'Browse all '+CROPS.length+' crops';$('farm-show-all').setAttribute('aria-pressed',String(showAll));
  if(!visible.length)grid.append(element('p','farm-empty','No broad calendar match for this guide area. Browse all crops and set your actual field stage.'));
  for(const c of visible){const a=activity(c,zone,month),card=element('article','farm-crop-card'+(c.id===preferences.crop?' farm-crop-selected':'')),head=element('div','farm-crop-head'),name=element('div');name.append(element('h3','',c.name));const urdu=element('span','farm-urdu',c.urdu);urdu.lang='ur';urdu.dir='rtl';name.append(urdu);head.append(glyph(c.glyph),name,element('span','farm-crop-group',c.group));card.append(head,element('strong','farm-crop-stage',a.label),element('p','',c.note));const choose=element('button','text-button',c.id===preferences.crop?'Selected crop ✓':'Use this crop ↗');choose.type='button';choose.addEventListener('click',()=>{$('farm-crop').value=c.id;$('farm-crop').dispatchEvent(new Event('change'));$('farm-crop-context').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});card.append(choose);grid.append(card);}
 }
 render();return {update(patch){state={...state,...patch};render();}};
}
