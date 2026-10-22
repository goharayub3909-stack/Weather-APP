import {darkMap,pkt,popup} from './map-utils.js';
export const BUFFER_URL='https://lightning-alerts.mashhoodiqbal493.workers.dev/buffer';
export const HISTORY_URL='https://lightning-weatherx-pk-api.mashhood-droid.workers.dev/api/strikes';
// The source dashboard uses a shared buffer: never open one upstream stream per visitor.
export function cleanStrikes(rows){return rows.map(row=>Array.isArray(row)?{lat:row[0],lon:row[1],time:row[2]}:{lat:row.lat,lon:row.lon,time:row.timestampMs??Date.parse(row.timestamp)}).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.time)&&p.lat>=23&&p.lat<=38&&p.lon>=60&&p.lon<=78);}
export function initLightning(){
 const $=id=>document.getElementById(id);let map,group,renderer,all=new Map(),timer,player,historyRequest,busy=false,live=true,lastFetch=0;
 const active=()=>!document.hidden&&!$('lightning').hidden;
 const stop=()=>{clearInterval(player);player=null;$('lightning-play').textContent='▶ Play';};
 function merge(rows){for(const p of cleanStrikes(rows))all.set(`${p.lat},${p.lon},${p.time}`,p);const earliest=Date.now()-Number($('lightning-hours').value)*3600000;for(const[key,p]of all)if(p.time<earliest)all.delete(key);}
 function draw(){
  if(!map)return;group.clearLayers();const now=Date.now(),hours=Number($('lightning-hours').value),start=now-hours*3600000;
  const steps=hours*4;$('lightning-timeline').max=steps;if(live)$('lightning-timeline').value=steps;
  const cutoff=live?now:start+Number($('lightning-timeline').value)*900000;
  const strikes=[...all.values()].filter(p=>p.time<=cutoff&&p.time>=(live?start:cutoff-900000)).sort((a,b)=>b.time-a.time);
  for(const p of strikes.slice(0,8000)){const age=Math.max(0,(cutoff-p.time)/60000),color=age<2?'#fffbd0':age<5?'#ffdc54':age<15?'#ff9744':'#b890d6';
   L.circleMarker([p.lat,p.lon],{renderer,radius:age<2?5:3,color,weight:1,fillColor:color,fillOpacity:age<15?.9:.5}).bindPopup(popup('Lightning detection',[pkt(p.time),`${p.lat.toFixed(3)}°N, ${p.lon.toFixed(3)}°E`])).addTo(group);
  }
  $('lightning-time').textContent=(live?'LIVE · ':'PLAYBACK · ')+pkt(cutoff);
  $('lightning-status').textContent=`${strikes.length.toLocaleString()} detections in ${live?hours+'-hour history':'this 15-minute interval'}${strikes.length>8000?' · newest 8,000 plotted':''}. Last successful fetch: ${lastFetch?pkt(lastFetch):'not yet'}.`;
 }
 async function json(url,signal){const r=await fetch(url,{signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});if(!r.ok)throw Error();return r.json();}
 async function history(){historyRequest?.abort();historyRequest=new AbortController();try{const d=await json(HISTORY_URL+'?hours='+$('lightning-hours').value+'&limit=20000',historyRequest.signal);if(!d.success||!Array.isArray(d.data))throw Error();all.clear();merge(d.data);lastFetch=Date.now();draw();if(d.count>d.returned)$('lightning-status').textContent+=' Provider returned a limited history.';}catch(e){if(!historyRequest.signal.aborted)$('lightning-status').textContent='Lightning history unavailable. Live buffer may still be available.';}}
 async function poll(){if(!map||!active()||busy)return;busy=true;try{const d=await json(BUFFER_URL);if(!Array.isArray(d.strikes))throw Error();merge(d.strikes);lastFetch=Date.now();draw();}catch{$('lightning-status').textContent='Live lightning feed unavailable. Previously loaded detections remain timestamped; they may be out of date.';}finally{busy=false;}}
 $('load-lightning').addEventListener('click',()=>{if(!window.L)return;$('lightning-workspace').hidden=false;if(!map){map=darkMap('lightning-map');group=L.layerGroup().addTo(map);renderer=L.canvas();timer=setInterval(poll,15000);}map.invalidateSize();$('load-lightning').textContent='Refresh lightning';history().then(poll);});
 $('lightning-hours').addEventListener('change',()=>{stop();live=true;if(map)history();});
 $('lightning-timeline').addEventListener('input',()=>{stop();live=false;draw();});
 $('lightning-live').addEventListener('click',()=>{stop();live=true;draw();poll();});
 $('lightning-play').addEventListener('click',()=>{if(player){stop();return;}live=false;$('lightning-timeline').value=0;$('lightning-play').textContent='❚❚ Pause';draw();player=setInterval(()=>{const next=Number($('lightning-timeline').value)+1;if(next>Number($('lightning-timeline').max)){stop();return;}$('lightning-timeline').value=next;draw();},700);});
 document.addEventListener('visibilitychange',()=>{if(!active())stop();else poll();});document.addEventListener('mapchange',()=>{if(!active())stop();else{map?.invalidateSize();poll();}});
}
