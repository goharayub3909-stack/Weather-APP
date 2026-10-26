import {addTileHelp} from './tile-help.js';
import {initAgriDSS} from './agri-dss.js';
import {CROPS,ZONES,activity,approximateZone,pakistanMonth,seasonName} from './farm-data.js';
import {analyseFarm,farmTime} from './farm-advice.js';
import {fieldContext} from './field-context.js';
import {icon} from './icons.js';
const $=id=>document.getElementById(id);
const number=(v,unit)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toFixed(1))+' '+unit:'—';
// Provider/location names are always text nodes, never HTML templates.
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function glyph(name){const e=element('span','farm-glyph');e.innerHTML=icon(name);return e;}
export function initFarmers(){
 const dss=initAgriDSS();
 let reference=null;fetch('./agri-reference.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{reference=data;render();}).catch(()=>{});
 let state={place:['Islamabad',33.69,73.05],forecast:null,supplemental:null,status:'loading',retrievedAt:null},showAll=false;
 const preferences={crop:'all',stage:'auto',zone:'auto'};
 try{const saved=JSON.parse(localStorage.getItem('badal-farm-preferences'));if(saved){if(saved.crop==='all'||CROPS.some(c=>c.id===saved.crop))preferences.crop=saved.crop;if(['auto','pre-sowing','sowing','growing','flowering','harvest'].includes(saved.stage))preferences.stage=saved.stage;if(saved.zone==='auto'||ZONES[saved.zone])preferences.zone=saved.zone;}}catch{}
 for(const [key,name]of Object.entries(ZONES))$('farm-zone').append(new Option(name,key));
 for(const crop of CROPS)$('farm-crop').append(new Option(crop.name+' · '+crop.urdu,crop.id));
 for(const key of ['crop','stage','zone']){
  $('farm-'+key).value=preferences[key];$('farm-'+key).addEventListener('change',()=>{preferences[key]=$('farm-'+key).value;$('farm-stage-confirmed').checked=false;try{localStorage.setItem('badal-farm-preferences',JSON.stringify(preferences));}catch{}render();});
 }
 $('farm-stage-confirmed').addEventListener('change',render);
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
  const crop=CROPS.find(c=>c.id===preferences.crop),calendar=crop?activity(crop,zone,month):null,field=fieldContext({crop,zone,place:state.place,selectedStage:preferences.stage,confirmed:$('farm-stage-confirmed').checked,reference,now}),stage=field.stage;
  $('farm-stage-confirmation').hidden=preferences.stage==='auto';$('farm-stage-validation').textContent=(field.conflict?'Stage differs from the seasonal guide. ':'')+field.reason;$('farm-calendar-provenance').textContent=field.basis;$('farm-stage-validation').hidden=!field.conflict&&!field.blocked; $('farm-stage-validation').dataset.tone=field.conflict||field.blocked?'watch':'info';
  $('farm-place').textContent=state.place[0];$('farm-season').textContent=seasonName(month,zone);
  $('farm-zone-note').textContent=(preferences.zone==='auto'?'Approximate area from coordinates: ':'Your chosen guide area: ')+ZONES[zone]+'. Adjust this guide for local altitude and planting dates.';
  $('farm-crop-context').hidden=!crop;$('farm-crop-context').textContent=crop?crop.name+' · '+(preferences.stage==='auto'?field.label:$('farm-stage').selectedOptions[0].textContent)+(calendar.suitable?'':' · using your selected crop despite the regional guide'): 'General field advice for seasonal crops. Select your actual crop and stage for a closer fit.';
  dss.update({...state,crop,stage,zone,field});
  const result=analyseFarm({...state,crop,stage,now}),loaded=state.status==='ready'&&result.available;
  $('farm-data-status').textContent=loaded?`ECMWF IFS 0.25° via Open-Meteo · ${farmTime(result.start)} to ${farmTime(result.end)} · fetched ${state.retrievedAt?farmTime(state.retrievedAt):'time unavailable'}.`:(state.status==='loading'?'Loading this location’s forecast…':state.status==='error'?'Weather forecast unavailable. Press Refresh above to try again.':result.reason);
  $('farm-quality').hidden=!loaded;$('farm-quality').textContent=loaded?(result.complete?'Next 24 hours: complete core fields.':'Some next-24-hour fields are missing; partial values are shown and missing rain never becomes zero.')+` Complete core fields in ${result.complete72}/72 model hours; absent inputs stay unknown.`:'';
  const summary=$('farm-summary');summary.replaceChildren();
  for(const [label,value,glyphName,tone]of [['Next 24h rain',loaded?number(result.summary.rain,'mm'):'—','rain','rain'],['High / low · 24h',loaded?number(result.summary.high,'°C')+' / '+number(result.summary.low,'°C'):'—','temperature','warm'],['Peak gust · 24h',loaded?number(result.summary.gust,'km/h'):'—','wind','breeze'],['Valid weather hours',loaded?result.complete72+'/72':'—','leaf','green']]){
   const card=element('div','farm-stat farm-stat--'+tone),copy=element('div');copy.append(element('span','',label),element('strong','',value));card.append(glyph(glyphName),copy);addTileHelp(card,label);summary.append(card);
  }
  const days=$('farm-days');days.replaceChildren();
  if(loaded)for(const day of result.days){const card=element('article','farm-day'),valid=typeof day.rain==='number'&&typeof day.high==='number'&&typeof day.low==='number';const risk=valid?(day.rain>=20?'Drainage watch':day.low<=2?'Cold watch':day.high>=result.heatLimit?'Heat watch':day.rain>=.2?'Plan around rain':'Check field conditions'):'Incomplete data';card.append(element('strong','',new Date(day.date+'T12:00:00+05:00').toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',weekday:'short',day:'numeric',month:'short'})),glyph(!valid?'cloud':day.rain>=.2?'rain':day.low<=2?'snow':'sun'),element('b','',number(day.low,'°')+' / '+number(day.high,'°')),element('span','',number(day.rain,'mm')),element('small','',risk));addTileHelp(card,'forecast');days.append(card);}
  else days.append(element('p','farm-empty','Seven-day outlook unavailable until the location forecast loads.'));
  const shell=$('farm-calendar-shell'),chosen=preferences.crop&&preferences.crop!=='all'?preferences.crop:'';if(shell&&shell.dataset.crop!==chosen){shell.dataset.crop=chosen;shell.open=!chosen;}const grid=$('farm-crops');grid.replaceChildren();const relevant=CROPS.filter(c=>activity(c,zone,month).active),visible=showAll?CROPS:relevant;
  $('farm-calendar-heading').textContent=showAll?'Major crops of Pakistan':'Relevant in this guide area · '+now.toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',month:'long'});
  $('farm-show-all').textContent=showAll?'Show seasonal crops':'Browse all '+CROPS.length+' crops';$('farm-show-all').setAttribute('aria-pressed',String(showAll));
  if(!visible.length)grid.append(element('p','farm-empty','No broad calendar match for this guide area. Browse all crops and set your actual field stage.'));
  for(const c of visible){const a=activity(c,zone,month),card=element('article','farm-crop-card'+(c.id===preferences.crop?' farm-crop-selected':'')),head=element('div','farm-crop-head'),name=element('div');name.append(element('h3','',c.name));const urdu=element('span','farm-urdu',c.urdu);urdu.lang='ur';urdu.dir='rtl';name.append(urdu);head.append(glyph(c.glyph),name,element('span','farm-crop-group',c.group));card.append(head,element('strong','farm-crop-stage',a.label),element('p','',c.note));const choose=element('button','text-button',c.id===preferences.crop?'Selected crop ✓':'Use this crop ↗');choose.type='button';choose.addEventListener('click',()=>{$('farm-crop').value=c.id;$('farm-crop').dispatchEvent(new Event('change'));$('farm-controls').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});card.append(choose);addTileHelp(card,'calendar',{title:c.name+' · seasonal guide'});grid.append(card);}
 }
 render();return {update(patch){if(patch.place&&patch.place.slice(1).join(',')!==state.place.slice(1).join(','))$('farm-stage-confirmed').checked=false;state={...state,...patch};render();}};
}
