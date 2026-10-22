import {frameURL,imageBounds,productFrames,productOptions,PMD_ORIGIN} from './radar-core.js';
export function initRadar(){
 const $=id=>document.getElementById(id);
 let catalog,map,layer,pendingLayer,marker,coverage,frames=[],position=0,player,request,imageTimeout,sequence=0,initialized=false;
 const label=(id,value)=>$(id).textContent=value;
 function stop(){clearInterval(player);player=null;label('radar-play','▶ Play');$('radar-play').setAttribute('aria-pressed','false');}
 function current(){return catalog?.stations?.[$('radar-station').value];}
 function controls(disabled){for(const id of ['radar-play','radar-latest','radar-timeline','radar-opacity'])$(id).disabled=disabled;}
 function catalogNote(){
  const s=current();if(!s)return;
  let message=s.synced_at?'Catalog retrieved '+new Date(s.synced_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})+' PKT.':'Catalog from the supplied browser capture; live catalog refresh has not succeeded.';
  if(s.status==='cached')message+=' Last refresh failed; previous catalog retained.';
  if(s.site.isMaintenance)message+=' PMD marks this station as under maintenance.';
  label('radar-catalog-note',message+' Radar image time is shown separately; PMD did not specify its timezone.');
 }
 function showFrame(){
  const frame=frames[position];if(!frame||!map)return;
  const token=++sequence;clearTimeout(imageTimeout);
  if(pendingLayer){map.removeLayer(pendingLayer);pendingLayer=null;}
  // Remove the old product immediately, so failed loads cannot masquerade as the selected frame.
  if(layer){map.removeLayer(layer);layer=null;}
  $('radar-timeline').value=String(position);label('radar-frame-count',`${position+1} / ${frames.length}`);
  label('radar-time',frame.datetime+' · PMD time (timezone unspecified)');label('radar-radius',frame.radius+' km');
  label('radar-status','Loading PMD radar image…');$('radar-status').className='radar-status';
  const image=L.imageOverlay(frameURL(frame),imageBounds(current().site,frame.radius),{opacity:Number($('radar-opacity').value)/100,interactive:false,className:'pmd-radar-echo',attribution:'Radar imagery © Pakistan Meteorological Department'});
  pendingLayer=image;
  image.on('load',()=>{
   if(token!==sequence){map.removeLayer(image);return;}clearTimeout(imageTimeout);layer=image;pendingLayer=null;
   const oldDate=frame.datetime.slice(0,10)<new Date().toISOString().slice(0,10);
   label('radar-status',oldDate?'Image loaded. The displayed PMD timestamp predates today (UTC); do not assume current conditions.':'PMD image loaded. Check its timestamp before interpreting conditions.');
   $('radar-status').className='radar-status'+(oldDate?' radar-warning':'');
  });
  const failed=()=>{if(token!==sequence)return;clearTimeout(imageTimeout);map.removeLayer(image);pendingLayer=null;stop();label('radar-status','PMD’s image could not be loaded. The selected radar frame is not being displayed. Try Refresh data or a different product.');$('radar-status').className='radar-status radar-warning';};
  image.on('error',failed);
  imageTimeout=setTimeout(()=>{if(token===sequence&&pendingLayer===image){failed();sequence++;}},20000);
  image.addTo(map);
 }
 function fit(){const frame=frames[position];if(frame&&map)map.fitBounds(imageBounds(current().site,frame.radius),{padding:[15,15]});}
 function updateLegend(){
  const legends={'Surface-R':'Surface-R_legend.png','CAPPI-R (01km)':'CAPPI-R_legend.png','Accumulated-R (12h)':'Accumulated-R_12h_legend.png'};
  const file=legends[$('radar-product').value];$('radar-legend').hidden=!file;
  if(file){$('radar-legend').src=new URL('./radar-data/legends/'+file,import.meta.url).href;$('radar-legend').alt='Official PMD color scale: '+$('radar-product').value;}
 }
 function chooseProduct(){stop();clearTimeout(imageTimeout);sequence++;if(coverage){map.removeLayer(coverage);coverage=null;}frames=productFrames(current(),$('radar-product').value);position=Math.max(0,frames.length-1);$('radar-timeline').max=String(position);controls(!frames.length);if(!frames.length){if(pendingLayer){map.removeLayer(pendingLayer);pendingLayer=null;}if(layer){map.removeLayer(layer);layer=null;}label('radar-status','No frames available for this product.');return;}coverage=L.circle(current().site.center,{radius:Number(frames[position].radius)*1000,color:'#347887',weight:1,fill:false,dashArray:'5 5',interactive:false}).addTo(map);updateLegend();showFrame();fit();catalogNote();}
 function chooseStation(){
  stop();const station=current();if(!station){controls(true);label('radar-status','This station has no available catalog.');return;}
  $('radar-product').replaceChildren(...productOptions(station).map(product=>{const option=document.createElement('option');option.value=product;option.textContent=product;return option;}));
  if(productOptions(station).includes('Surface-R'))$('radar-product').value='Surface-R';
  if(marker)map.removeLayer(marker);marker=L.circleMarker(station.site.center,{radius:5,color:'#fff',weight:2,fillColor:'#173c4c',fillOpacity:1}).addTo(map).bindTooltip(station.site.name+' radar station');
  chooseProduct();
 }
 async function loadCatalog(){
  stop();request?.abort();request=new AbortController();const signal=request.signal;label('radar-status','Loading available radar catalogs…');
  try{
   const url=new URL('./radar-data/catalog.json',import.meta.url);url.searchParams.set('refresh',Date.now());
   const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store'});if(!response.ok)throw Error('Catalog unavailable');const result=await response.json();
   if(!result.stations||result.origin!==PMD_ORIGIN)throw Error('Invalid radar catalog');
   catalog=result;chooseStation();
  }catch(error){if(signal.aborted)return;label('radar-status','Radar catalog refresh failed. '+(catalog?'The previously loaded catalog remains available; check timestamps.':'No radar frames are available.'));$('radar-status').className='radar-status radar-warning';if(!catalog)controls(true);}
 }
 $('load-pmd').addEventListener('click',()=>{
  if(!window.L){label('radar-status','The map library could not be loaded. Refresh this page.');return;}
  if(!initialized){
   initialized=true;$('pmd-placeholder').hidden=true;$('radar-workspace').hidden=false;
   map=L.map('pmd-map',{scrollWheelZoom:false,zoomControl:true}).setView([30.4,69.3],5);
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
   map.on('click',()=>map.scrollWheelZoom.enable());
   label('load-pmd','Refresh data ↻');
  }
  map.invalidateSize();loadCatalog();
 });
 $('radar-station').addEventListener('change',chooseStation);$('radar-product').addEventListener('change',chooseProduct);
 $('radar-timeline').addEventListener('input',()=>{stop();position=Number($('radar-timeline').value);showFrame();});
 $('radar-latest').addEventListener('click',()=>{stop();position=frames.length-1;showFrame();});
 $('radar-recenter').addEventListener('click',fit);
 $('radar-opacity').addEventListener('input',()=>{label('radar-opacity-value',$('radar-opacity').value+'%');(layer||pendingLayer)?.setOpacity(Number($('radar-opacity').value)/100);});
 $('radar-play').addEventListener('click',()=>{if(player){stop();return;}if(frames.length<2)return;label('radar-play','❚❚ Pause');$('radar-play').setAttribute('aria-pressed','true');player=setInterval(()=>{if(pendingLayer)return;position=(position+1)%frames.length;showFrame();},1400);});
 $('radar-legend').addEventListener('error',()=>{$('radar-legend').hidden=true;label('radar-legend-note','Official PMD color scale is unavailable.');});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});controls(true);
}
