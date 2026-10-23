import {darkMap,pkt} from './map-utils.js';
import {icon} from './icons.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=(v,suffix='',digits=1)=>finite(v)?v.toFixed(digits)+suffix:'—';
export const RAIN_PARAMETERS={rain_daily:'Daily rain · mm',rain_24h:'Last 24h rain · mm',rain_monthly:'Monthly rain · mm',rain_yearly:'Yearly rain · mm',rain_monsoon:'Monsoon JJAS rain · mm',rain_rate:'Current rain rate · mm/h',rain_rate_instant:'Instantaneous rain rate · mm/h',rain_rate_max:'Maximum rain rate · mm/h'};
export function observationValue(p,airport,parameter){
 if(airport){if(parameter==='temperature')return p.temp;if(parameter==='wind')return finite(p.wspd)?p.wspd*1.852:null;if(parameter==='humidity'&&finite(p.temp)&&finite(p.dewp))return Math.min(100,Math.max(0,100*Math.exp(17.625*p.dewp/(243.04+p.dewp)-17.625*p.temp/(243.04+p.temp))));return null;}
 return p[({temperature:'temperature',humidity:'humidity',wind:'wind_speed'})[parameter]||parameter];
}
function metric(name,value,symbol){const cell=document.createElement('div');cell.className='observation-reading reading-'+symbol;const glyph=document.createElement('span');glyph.className='reading-icon';glyph.innerHTML=icon(symbol);const label=document.createElement('span');label.textContent=name;const strong=document.createElement('strong');strong.textContent=value;cell.append(glyph,label,strong);return cell;}
export function observationPopup(p,airport){
 const root=document.createElement('article');root.className='observation-detail';
 const head=document.createElement('div');head.className='observation-detail-head';const glyph=document.createElement('span');glyph.className='observation-type-icon';glyph.innerHTML=icon(airport?'plane':'station');const title=document.createElement('div'),small=document.createElement('span'),name=document.createElement('h3');small.textContent=airport?'AIRPORT · '+p.icaoId:(p.network||'WeatherWalay')+' · WEATHER STATION';name.textContent=p.name||p.icaoId||'Weather station';title.append(small,name);head.append(glyph,title);
 const derivedRH=airport&&finite(p.temp)&&finite(p.dewp)?Math.min(100,Math.max(0,100*Math.exp(17.625*p.dewp/(243.04+p.dewp)-17.625*p.temp/(243.04+p.temp)))):null;
 const grid=document.createElement('div');grid.className='observation-readings';grid.append(metric('Temperature',number(airport?p.temp:p.temperature,' °C'),'temperature'),metric(airport?'Humidity · derived':'Humidity',number(airport?derivedRH:p.humidity,'%',0),'humidity'),metric(airport?'Wind · knots':'Wind · km/h',number(airport?p.wspd:p.wind_speed,airport?' kt':' km/h'),'wind'),metric(airport?'Sea-level pressure':'Wind direction',airport?number(p.altim,' hPa',0):number(p.wind_direction,'°',0),airport?'pressure':'gust'));
 const time=airport?p.obsTime*1000:Date.parse(p.observed_at),known=Number.isFinite(time),old=known&&Date.now()-time>3*3600000;
 const footer=document.createElement('div');footer.className='observation-detail-time';const stamp=document.createElement('p');stamp.textContent=known?'Observed '+pkt(time):p.observed_label?'Provider local time: '+p.observed_label:'Observation time unavailable';
 const badge=document.createElement('span');badge.className='observation-age '+(old||!known?'age-uncertain':'age-recent');badge.textContent=old?'Report over 3 hours old':known?'Recent report':'Age unverified · provider omits year/offset';footer.append(stamp,badge);root.append(head,grid);
 if(!airport){
  const section=document.createElement('section');section.className='observation-rainfall';const heading=document.createElement('h4');heading.textContent='Rainfall & rain rate';const rain=document.createElement('div');rain.className='observation-readings';
  for(const [key,label]of Object.entries(RAIN_PARAMETERS))rain.append(metric(label.split(' · ')[0],number(p[key],key.startsWith('rain_rate')?' mm/h':' mm'),'rain'));
  const note=document.createElement('p');note.className='observation-rain-note';note.textContent='Daily: '+(p.rain_daily_period||'provider day')+'. Last 24h: '+(p.rain_24h_period||'provider interval')+(p.rain_24h_observed_label?' · reported '+p.rain_24h_observed_label:'')+'. Weekly total: not supplied by the original feed. Monthly / yearly / JJAS totals use provider counters, not rolling periods. Maximum rate time: '+(p.rain_rate_max_label||'unavailable')+'.';
  section.append(heading,rain,note);root.append(section);
  const more=document.createElement('details'),summary=document.createElement('summary'),extra=document.createElement('div');summary.textContent='More station parameters';extra.className='observation-readings';
  for(const [key,label,suffix,glyph]of [['dew_point','Dew point',' °C','dew'],['heat_index','Heat index',' °C','temperature'],['wind_chill','Wind chill',' °C','temperature'],['wind_gust_10min','10-minute gust',' km/h','gust'],['pressure','Pressure · provider',' hPa','pressure'],['solar_radiation','Solar radiation',' W/m²','sun'],['uv_index','UV index','','uv'],['visibility','Visibility',' m','eye']])extra.append(metric(label,number(p[key],suffix),glyph));
  more.append(summary,extra);root.append(more);
 }
 if(p.observed_time_basis){const basis=document.createElement('small');basis.textContent=p.observed_time_basis;footer.append(basis);}root.append(footer);
 if(airport&&p.rawOb){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Original METAR report';pre.textContent=p.rawOb;details.className='raw-metar';details.append(summary,pre);root.append(details);}return root;
}
export function observationColor(value,parameter){
 if(!finite(value))return '#7f8c9e';
 if(parameter.startsWith('rain_')){const cuts=parameter.startsWith('rain_rate')?[.1,1,5,10,30,100]:parameter==='rain_monthly'||parameter==='rain_yearly'||parameter==='rain_monsoon'?[.1,10,50,100,250,500]:[.1,.2,2,10,25,50];return ['#b3d7dd','#6bcfc5','#66cf88','#e6da71','#f6af69','#ef827e','#c594e6'][cuts.findIndex(c=>value<c)<0?6:cuts.findIndex(c=>value<c)];}
 const stops=parameter==='humidity'?[[0,'#d9ba91'],[35,'#a8d797'],[65,'#61d5c6'],[85,'#6496ee'],[101,'#a788ec']]:parameter==='wind'?[[5,'#9fd5ed'],[15,'#5ddac4'],[30,'#c7de77'],[50,'#ffba68'],[501,'#ef7b9a']]:[[0,'#8fb3ff'],[15,'#7bddcb'],[25,'#e1e69c'],[35,'#ffc16e'],[71,'#ff7c81']];
 return (stops.find(([limit])=>value<limit)||stops.at(-1))[1];
}
export function initObservations(){
 const $=id=>document.getElementById(id);for(const [value,label]of Object.entries(RAIN_PARAMETERS))$('observation-parameter').append(new Option(label,value));const weekly=new Option('Weekly rain · not supplied','rain_weekly');weekly.disabled=true;$('observation-parameter').append(weekly);let map,airports,stations,renderer,reports=[null,null],generation=0;
 function toggle(){if(!map)return;for(const[id,layer]of [['show-metar',airports],['show-stations',stations]])if($(id).checked)layer.addTo(map);else map.removeLayer(layer);}
 function plot(){
  if(!map)return;const parameter=$('observation-parameter').value;let counts=[0,0],uncertain=0;const messages=[];
  for(let i=0;i<2;i++){
   const group=i?stations:airports;group.clearLayers();const data=reports[i];if(!data){messages.push(i?'WeatherWalay unavailable.':'Airport reports unavailable.');continue;}
   for(const p of data.stations){
    if(!finite(p.lat)||!finite(p.lon))continue;const time=i?Date.parse(p.observed_at):p.obsTime*1000,stale=!Number.isFinite(time)||Date.now()-time>3*3600000;
    if(stale)uncertain++;
    const value=observationValue(p,!i,parameter);
    const color=observationColor(value,parameter);
    L.circleMarker([p.lat,p.lon],{renderer,radius:i?5.5:7.5,color:i?'#b1e3d2':'#e3eaff',fillColor:color,fillOpacity:finite(value)?.95:.25,opacity:stale?.65:1,weight:i?1:2,dashArray:stale?'2 2':null}).bindPopup(()=>observationPopup(p,!i),{className:'observation-popup',maxWidth:335,minWidth:270}).addTo(group);counts[i]++;
   }
   messages.push(`${counts[i]} ${i?'weather stations':'airports'} · fetched ${data.retrieved_at?pkt(data.retrieved_at):'at unknown time'}${data.status==='cached'?' · retained snapshot after refresh failure':''}.`);
  }
  $('observations-status').textContent=messages.join(' ');$('observation-airport-count').textContent=counts[0];$('observation-station-count').textContent=counts[1];$('observation-age-count').textContent=uncertain;
  const legends={temperature:'Temperature · °C · cold → hot',humidity:'Humidity · % · dry → humid',wind:'Wind · km/h · calm → strong',...RAIN_PARAMETERS};$('observation-map-legend').textContent=legends[parameter]+(parameter.startsWith('rain_')?' · pale blue: zero · green → yellow → purple: increasing · grey: unavailable':'')+' · outlined dots: airports · dotted border: age unverified/old';
 }
 async function load(){
  if(!window.L)return;const token=++generation;$('observations-map').hidden=false;$('observation-map-legend').hidden=false;
  if(!map){map=darkMap('observations-map');renderer=L.canvas();airports=L.layerGroup();stations=L.layerGroup();toggle();}map.invalidateSize();$('observations-status').textContent='Loading timestamped observations…';$('load-observations').disabled=true;
  const results=await Promise.allSettled(['metar','stations'].map(async source=>{const r=await fetch(new URL('./observation-data/'+source+'.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.stations))throw Error();return d;}));if(token!==generation)return;
  reports=results.map(r=>r.status==='fulfilled'?r.value:null);plot();$('load-observations').disabled=false;$('load-observations').innerHTML=icon('refresh')+' Refresh observations';
 }
 $('load-observations').addEventListener('click',load);$('show-metar').addEventListener('change',toggle);$('show-stations').addEventListener('change',toggle);$('observation-parameter').addEventListener('change',plot);document.addEventListener('mapchange',()=>{if(!$('observations').hidden)map?.invalidateSize();});
}
