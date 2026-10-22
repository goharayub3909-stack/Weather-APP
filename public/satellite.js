import{WMS_ENDPOINT,validSatelliteLayer,acquisitionLabel,wmsOptions}from './satellite-core.js';
export function initSatellite(){
 const $=id=>document.getElementById(id),text=(id,value)=>$(id).textContent=value;
 let map,imagery,catalog,times=[],position=0,player,request,timeout,generation=0,loading=false;
 function stop(){clearInterval(player);player=null;text('satellite-play','▶ Play');$('satellite-play').setAttribute('aria-pressed','false');}
 function selected(){return catalog?.layers.find(layer=>layer.name===$('satellite-layer').value);}
 function enabled(active){for(const id of ['satellite-layer','satellite-opacity','satellite-latest'])$(id).disabled=!active;for(const id of ['satellite-play','satellite-timeline'])$(id).disabled=!active||times.length<2;}
 function show(){
  const layer=selected();if(!layer||!map)return;
  const token=++generation;clearTimeout(timeout);loading=true;
  if(imagery){map.removeLayer(imagery);imagery=null;}
  const time=times[position];const stamp=acquisitionLabel(time);text('satellite-time',stamp);text('satellite-map-time',stamp);text('satellite-frame-count',times.length?`${position+1} / ${times.length}`:'Latest');$('satellite-timeline').value=String(position);
  const crs=layer.crs==='EPSG:3857'?L.CRS.EPSG3857:layer.crs==='CRS:84'?L.extend({},L.CRS.EPSG4326,{code:'CRS:84'}):L.CRS.EPSG4326;
  const overlay=L.tileLayer.wms(WMS_ENDPOINT,{...wmsOptions(layer,time),crs,detectRetina:true,opacity:Number($('satellite-opacity').value)/100,maxZoom:10});imagery=overlay;
  let succeeded=0,failed=0;text('satellite-status','Loading EUMETSAT natural-colour satellite tiles…');$('satellite-status').className='radar-status';
  function fail(){if(token!==generation)return;clearTimeout(timeout);loading=false;stop();if(imagery===overlay){map.removeLayer(overlay);imagery=null;}text('satellite-status','Satellite imagery could not be loaded. No satellite layer is being shown. Try another advertised acquisition time or refresh the catalog.');$('satellite-status').className='radar-status radar-warning';}
  overlay.on('tileload',()=>{succeeded++;});overlay.on('tileerror',()=>{failed++;});
  overlay.on('load',()=>{
   if(token!==generation)return;clearTimeout(timeout);loading=false;
   // Let Leaflet finish tile bookkeeping before removing an unavailable layer.
   if(!succeeded){setTimeout(fail,0);return;}
   const old=time&&Date.now()-Date.parse(time)>3*3600000;
   text('satellite-status',failed?'Some EUMETSAT tiles are unavailable. Coverage is incomplete.':old?'Imagery tiles loaded. The selected acquisition is over three hours old; check the displayed time.':'EUMETSAT imagery tiles loaded. Acquisition time is shown on the map. Natural colour needs daylight.');
   $('satellite-status').className='radar-status'+(failed||old?' radar-warning':'');
  });
  timeout=setTimeout(()=>{if(token===generation&&loading)fail();},30000);overlay.addTo(map);
 }
 function chooseLayer(){stop();text('satellite-resolution',selected()?.name==='msg_iodc:rgb_eview'?'HRV RGB uses higher-resolution visible imagery; it differs from natural colour and may contain coverage gaps. Zooming beyond native satellite detail cannot create new information.':'Natural colour is limited by the satellite’s native resolution (typically kilometres per pixel). Try the high-resolution visible RGB option for finer cloud detail.');times=selected()?.times||[];position=Math.max(0,times.length-1);$('satellite-timeline').max=String(position);enabled(true);show();}
 async function load(){
  stop();request?.abort();request=new AbortController();const signal=request.signal;text('satellite-status','Discovering available natural-colour layers…');
  try{const url=new URL('./satellite-data/catalog.json',import.meta.url);url.searchParams.set('refresh',Date.now());const response=await fetch(url,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();const result=await response.json();if(result.endpoint!==WMS_ENDPOINT)throw Error();const layers=(result.layers||[]).filter(validSatelliteLayer);if(!layers.length)throw Error('No discovered natural-colour layers');
   catalog={...result,layers};$('satellite-layer').replaceChildren(...layers.map(layer=>{const option=document.createElement('option');option.value=layer.name;option.textContent=layer.title;return option;}));
   text('satellite-catalog-note',`EUMETView WMS 1.3.0 · Capabilities checked ${result.synced_at?new Date(result.synced_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})+' PKT':'at an unknown time'}.${result.status==='cached'?' Latest discovery failed; retained advertised layers are shown.':''} Acquisition time is separate from catalog retrieval time.`);chooseLayer();
  }catch(error){if(signal.aborted)return;text('satellite-status',catalog?'Catalog refresh failed. Previously discovered layers remain available.':'EUMETView’s natural-colour layers could not be discovered. Please refresh later.');$('satellite-status').className='radar-status radar-warning';if(!catalog)enabled(false);}
 }
 $('load-satellite').addEventListener('click',()=>{
  if(!window.L){text('satellite-status','The map could not be initialized. Refresh this page.');return;}
  if(!map){$('satellite-placeholder').hidden=true;$('satellite-workspace').hidden=false;map=L.map('satellite-map',{scrollWheelZoom:false,trackResize:false}).setView([30.5,69.5],5);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:10,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);map.on('click',()=>map.scrollWheelZoom.enable());text('load-satellite','Refresh satellite catalog ↻');}map.invalidateSize();load();
 });
 $('satellite-layer').addEventListener('change',chooseLayer);$('satellite-timeline').addEventListener('input',()=>{stop();position=Number($('satellite-timeline').value);show();});$('satellite-latest').addEventListener('click',()=>{stop();position=Math.max(0,times.length-1);show();});$('satellite-recenter').addEventListener('click',()=>map?.fitBounds([[23.5,60.5],[37.5,77.5]],{padding:[10,10]}));
 $('satellite-opacity').addEventListener('input',()=>{text('satellite-opacity-value',$('satellite-opacity').value+'%');imagery?.setOpacity(Number($('satellite-opacity').value)/100);});
 $('satellite-play').addEventListener('click',()=>{if(player){stop();return;}if(times.length<2)return;text('satellite-play','❚❚ Pause');$('satellite-play').setAttribute('aria-pressed','true');player=setInterval(()=>{if(loading)return;position=(position+1)%times.length;show();},1800);});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});enabled(false);
 window.addEventListener('resize',()=>{if(!$('satellite').hidden)map?.invalidateSize();});
 document.addEventListener('mapchange',()=>{stop();if(!$('satellite').hidden)setTimeout(()=>map?.invalidateSize(),0);});
}
