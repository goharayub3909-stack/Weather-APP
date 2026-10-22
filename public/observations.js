import {darkMap,pkt,popup} from './map-utils.js';
export function initObservations(){
 const $=id=>document.getElementById(id);let map,airports,stations,renderer;
 const number=(v,suffix='')=>typeof v==='number'&&Number.isFinite(v)?v+suffix:'Unavailable';
 function toggle(){if(!map)return;for(const[id,layer]of [['show-metar',airports],['show-stations',stations]])if($(id).checked)layer.addTo(map);else map.removeLayer(layer);}
 async function load(){
  if(!window.L)return;$('observations-map').hidden=false;
  if(!map){map=darkMap('observations-map');renderer=L.canvas();airports=L.layerGroup();stations=L.layerGroup();toggle();}map.invalidateSize();$('observations-status').textContent='Loading timestamped observations…';
  const results=await Promise.allSettled(['metar','stations'].map(async source=>{const r=await fetch(new URL('./observation-data/'+source+'.json',import.meta.url),{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.stations))throw Error();return d;}));
  const messages=[];
  for(const [i,result]of results.entries()){
   const group=i?stations:airports;group.clearLayers();
   if(result.status!=='fulfilled'){messages.push(i?'WeatherWalay stations unavailable.':'Airport reports unavailable.');continue;}
   let count=0,unknown=0;
   for(const p of result.value.stations){
    if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
    const time=i?Date.parse(p.observed_at):p.obsTime*1000,stale=!Number.isFinite(time)||Date.now()-time>3*3600000;
    if(stale)unknown++;
    const lines=i?[number(p.temperature,' °C'),number(p.humidity,' % RH'),number(p.wind_speed,' km/h')+' · '+number(p.wind_direction,'°'),p.network||'WeatherWalay']:[number(p.temp,' °C'),number(p.wspd,' kt')+' · '+(p.wdir??'Variable')+'°',number(p.altim,' hPa'),p.rawOb||'No raw report'];
    lines.push(Number.isFinite(time)?'Observed: '+pkt(time):p.observed_label?'Provider observation: '+p.observed_label+' (year/timezone unspecified)':'Observation time unavailable');if(stale)lines.push(Number.isFinite(time)?'Older than 3 hours':'Exact observation age unverified');
    L.circleMarker([p.lat,p.lon],{renderer,radius:i?5:7,color:stale?'#8293a8':i?'#89efbb':'#84d8ff',fillOpacity:.8,weight:2}).bindPopup(popup((i?p.name:p.icaoId+' · '+p.name)||'Weather station',lines)).addTo(group);count++;
   }
   messages.push(`${count} ${i?'WeatherWalay stations':'airport reports'} · snapshot retrieved ${result.value.retrieved_at?pkt(result.value.retrieved_at):'at unknown time'}${unknown?' · '+unknown+' reports old or age unverified':''}${result.value.status==='cached'?' · refresh failed, previous snapshot retained':''}.`);
  }
  $('observations-status').textContent=messages.join(' ');$('load-observations').textContent='Refresh observations';
 }
 $('load-observations').addEventListener('click',load);$('show-metar').addEventListener('change',toggle);$('show-stations').addEventListener('change',toggle);document.addEventListener('mapchange',()=>{if(!$('observations').hidden)map?.invalidateSize();});
}
