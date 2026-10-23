import {darkMap,pkt} from './map-utils.js';
import {fieldAreaHa} from './agri-models.js';
import {FIELD_INDICES,ZONE_COLORS,fieldColormap,indexRecipe,zoneExpression} from './farm-indices.js';
// A scene is a finite satellite footprint, not a global basemap. Restrict tile
// requests to its bounds and keep edge/no-data errors separate from total failure.
export function initFarmSatellite(){
 const $=id=>document.getElementById(id),base='https://planetarycomputer.microsoft.com';
 const collections={sentinel:{id:'sentinel-2-l2a',resolution:'10 m',assets:['visual'],red:'B04',nir:'B08'},landsat:{id:'landsat-c2-l2',resolution:'30 m',assets:['red','green','blue'],red:'red',nir:'nir08'},modis:{id:'modis-13Q1-061',resolution:'250 m · 16-day composite',assets:['250m_16_days_NDVI']}};
 let map,place=['Islamabad',33.69,73.05],controller,scenes=[],layer,contextLayer,outline,sceneBounds,polygon,vertices=[],drawing=false,marker,drawVersion=0;
 const status=text=>$('agri-satellite-status').textContent=text;
 function clearImagery(){drawVersion++;if(layer)map?.removeLayer(layer);if(outline)map?.removeLayer(outline);if(contextLayer)map?.removeLayer(contextLayer);layer=contextLayer=outline=null;sceneBounds=null;$('agri-index-legend').hidden=true;$('agri-satellite-retry').hidden=true;$('agri-satellite-zoom').disabled=true;}
 function fieldNote(){
  const area=fieldAreaHa(vertices);$('agri-field-area').textContent=vertices.length<3?'No complete field boundary. Add at least three vertices.':area.toLocaleString('en-GB',{maximumFractionDigits:2})+' ha · drawn boundary, not a surveyed area';
  $('agri-field-coverage').textContent=sceneBounds?vertices.some(p=>!sceneBounds.contains(p))?'The boundary extends beyond this scene’s coverage. The dashed rectangle marks the selected scene. Load scenes for the boundary and choose another scene, or zoom to the scene to inspect its imagery.':'Dashed rectangle: selected scene bounds. A single scene may not cover the entire boundary; cloud / no-data pixels are not crop-health measurements.':vertices.length>=3?'Finish the boundary, then load scenes that intersect it. A scene is not a country-wide image.':'';
 }
 function ensureMap(){if(map)return;map=darkMap('agri-satellite-map');map.createPane('farm-imagery');map.getPane('farm-imagery').style.zIndex=300;map.on('click',e=>{if(!drawing)return;vertices.push([e.latlng.lat,e.latlng.lng]);if(polygon)map.removeLayer(polygon);polygon=L.polygon(vertices,{color:'#bbef72',weight:2,fillOpacity:.02}).addTo(map);fieldNote();});}
 async function load(){
  ensureMap();controller?.abort();controller=new AbortController();const signal=controller.signal;clearImagery();scenes=[];$('agri-scene').replaceChildren();const source=collections[$('agri-satellite-source').value];status('Finding public scenes for '+(vertices.length>=3?'the drawn boundary':'this location')+'…');
  try{
   const geometry=vertices.length>=3?{type:'Polygon',coordinates:[[...vertices,vertices[0]].map(([lat,lon])=>[lon,lat])]}:{type:'Point',coordinates:[place[2],place[1]]};
   const u=new URL(base+'/api/stac/v1/search');u.search=new URLSearchParams({collections:source.id,intersects:JSON.stringify(geometry),datetime:new Date(Date.now()-90*86400000).toISOString()+'/'+new Date().toISOString(),limit:'24'});
   const r=await fetch(u,{signal,cache:'no-store'});if(!r.ok)throw Error('Scene service returned '+r.status);const data=await r.json();if(signal.aborted)return;
   scenes=(data.features||[]).filter(f=>(f.properties['eo:cloud_cover']??0)<=60).sort((a,b)=>String(b.properties.datetime||b.properties.start_datetime).localeCompare(String(a.properties.datetime||a.properties.start_datetime)));
   for(const [i,f]of scenes.entries())$('agri-scene').append(new Option(pkt(f.properties.datetime||f.properties.start_datetime)+' · cloud '+(f.properties['eo:cloud_cover']===undefined?'unknown':Number(f.properties['eo:cloud_cover'].toFixed(1))+'%')+' · '+f.id.slice(-12),i));
   if(!scenes.length){status('No intersecting scene with available cloud metadata ≤60% found in the last 90 days.');return;}await draw();
  }catch(e){if(!signal.aborted)status('Satellite unavailable: '+e.message+'. Use Load recent satellite scenes to retry.');}
 }
 async function draw(){
  clearImagery();const version=drawVersion,signal=controller?.signal,source=collections[$('agri-satellite-source').value],scene=scenes[Number($('agri-scene').value)];if(!scene)return;
  const sensor=$('agri-satellite-source').value;
  for(const option of $('agri-satellite-mode').options)option.disabled=sensor==='modis'?option.value!=='ndvi':sensor==='landsat'&&option.value==='ndre';
  if($('agri-satellite-mode').selectedOptions[0].disabled)$('agri-satellite-mode').value='ndvi';
  const mode=$('agri-satellite-mode').value,index=FIELD_INDICES[mode];let recipe;try{recipe=index?indexRecipe(sensor,mode,scene):null;}catch(e){status(e.message);return;}
  $('agri-satellite-palette').options[0].disabled=sensor==='modis';if(sensor==='modis')$('agri-satellite-palette').value='continuous';$('agri-satellite-palette').disabled=!index;$('agri-index-legend').hidden=!index;
  if(index){const legend=$('agri-index-legend');legend.replaceChildren();const title=document.createElement('strong');title.textContent=index.label+' · '+recipe.resolution;legend.append(title);const zones=$('agri-satellite-palette').value==='zones',ranges=[index.range[0],...index.breaks,index.range[1]];for(let i=0;i<(zones?4:0);i++){const label=document.createElement('span');label.textContent=ranges[i]+' to '+ranges[i+1];label.style.setProperty('--zone',`rgb(${ZONE_COLORS[i].slice(0,3).join(',')})`);legend.append(label);}if(!zones){const ramp=document.createElement('span');ramp.className='index-continuous-ramp';ramp.textContent='−1 → 0 → +1';legend.append(ramp);}const note=document.createElement('p');note.textContent=index.description+' '+recipe.note+(zones?' Colours are fixed display zones, not calibrated crop-health classes.':' Continuous red → yellow → green spectral-index gradient; not a calibrated crop-health score.');legend.append(note);}
  const u=new URL(base+'/api/data/v1/item/tilejson.json');u.search=new URLSearchParams({collection:source.id,item:scene.id});
  if(recipe){recipe.assets.forEach(asset=>u.searchParams.append('assets',asset));if(recipe.expression)u.searchParams.set('expression',recipe.expression);u.searchParams.set('unscale','false');u.searchParams.set('rescale',recipe.range.join(','));if($('agri-satellite-palette').value==='zones'){u.searchParams.set('expression',zoneExpression(mode,recipe.expression||'(250m_16_days_NDVI_b1*0.0001)'));u.searchParams.set('rescale','0,255');u.searchParams.set('colormap',JSON.stringify(fieldColormap(mode)));}else u.searchParams.set('colormap_name','rdylgn');}
  else{source.assets.forEach(asset=>u.searchParams.append('assets',asset));if(source.red==='red'){u.searchParams.set('rescale','0,0.3');u.searchParams.set('unscale','true');u.searchParams.set('color_formula','gamma RGB 2.2');}}
  status('Loading '+source.resolution+' satellite tiles…');
  try{
   const r=await fetch(u,{signal,cache:'no-store'});if(!r.ok)throw Error('Tile service returned '+r.status);const data=await r.json();if(version!==drawVersion||signal?.aborted)return;
   const tiles=data.tiles?.[0],bbox=data.bounds||scene.bbox;if(!tiles||new URL(tiles).origin!==base||bbox?.length!==4||!bbox.every(Number.isFinite))throw Error('Unexpected tile source or bounds');
   sceneBounds=L.latLngBounds([[bbox[1],bbox[0]],[bbox[3],bbox[2]]]);outline=L.rectangle(sceneBounds,{color:'#a6dbe2',weight:1,dashArray:'5 5',fill:false,interactive:false}).addTo(map);$('agri-satellite-zoom').disabled=false;fieldNote();
   const metadata=(index?index.label:'Natural colour')+' · '+(recipe?.resolution||source.resolution)+' · acquisition '+pkt(scene.properties.datetime||scene.properties.start_datetime)+(scene.properties.end_datetime?' to '+pkt(scene.properties.end_datetime):'')+'. Scene cloud filtering only; cloud / shadow pixels are not masked. Spectral indices are not a disease or yield diagnosis.';
   let loaded=0,failed=0;
   const current=()=>version===drawVersion;
   // Canvas clipping uses projected field vertices in tile pixel coordinates.
   // No index values or colours are invented on the client: only real image
   // tiles are painted inside the user boundary.
   const MaskedTiles=L.TileLayer.extend({createTile(coords,done){
    const canvas=document.createElement('canvas'),size=this.getTileSize();canvas.width=size.x;canvas.height=size.y;const image=new Image();image.crossOrigin='anonymous';
    image.onload=()=>{if(current()){const ctx=canvas.getContext('2d');ctx.save();ctx.beginPath();vertices.forEach(([lat,lon],i)=>{const p=map.project([lat,lon],coords.z),x=p.x-coords.x*size.x,y=p.y-coords.y*size.y;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,size.x,size.y);ctx.restore();}done(null,canvas);};
    image.onerror=()=>done(new Error('Image tile unavailable'),canvas);image.src=this.getTileUrl(coords);return canvas;
   }});
   const clipped=vertices.length>=3&&$('agri-field-clip').checked;
   const ImageTiles=clipped?MaskedTiles:L.TileLayer;
   layer=new ImageTiles(tiles,{pane:'farm-imagery',zIndex:300,bounds:sceneBounds,noWrap:true,keepBuffer:0,updateWhenIdle:true,updateWhenZooming:false,maxZoom:18,maxNativeZoom:source.id.startsWith('modis')?9:source.red==='red'?13:14,opacity:.95,attribution:'Copernicus / USGS / NASA via Microsoft Planetary Computer'});
   layer.on('loading',()=>{loaded=failed=0;if(current())status(metadata+' Loading scene coverage…');});
   layer.on('tileload',()=>{loaded++;});layer.on('tileerror',()=>{failed++;});
   layer.on('load',()=>{if(!current())return;$('agri-satellite-retry').hidden=!failed||loaded>0;status(metadata+(loaded?' Imagery loaded.'+(failed?' Some edge / no-data tiles are unavailable; the remaining scene is displayed.':''):failed?' No imagery tiles loaded in this view. Retry tiles or choose another scene.':' Zoom to the selected scene to view its coverage.'));});
   layer.addTo(map);status(metadata+(clipped?' Clipped to the drawn boundary.':'')+' Loading scene coverage…');
   if(index&&clipped&&sensor!=='modis'){
    const rgb=new URL(base+'/api/data/v1/item/tilejson.json');rgb.search=new URLSearchParams({collection:source.id,item:scene.id});source.assets.forEach(a=>rgb.searchParams.append('assets',a));if(sensor==='landsat'){rgb.searchParams.set('unscale','true');rgb.searchParams.set('rescale','0,0.3');rgb.searchParams.set('color_formula','gamma RGB 2.2');}
    fetch(rgb,{signal}).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(background=>{if(!current()||!background.tiles?.[0]||new URL(background.tiles[0]).origin!==base)return;contextLayer=L.tileLayer(background.tiles[0],{pane:'farm-imagery',zIndex:200,bounds:sceneBounds,noWrap:true,keepBuffer:0,maxNativeZoom:sensor==='landsat'?13:14,maxZoom:18}).addTo(map);}).catch(()=>{});
   }
  }catch(e){if(version===drawVersion&&!signal?.aborted){status('Satellite unavailable: '+e.message);$('agri-satellite-retry').hidden=false;}}
 }
 $('agri-satellite-load').addEventListener('click',load);$('agri-satellite-source').addEventListener('change',load);$('agri-satellite-mode').addEventListener('change',draw);$('agri-scene').addEventListener('change',draw);$('agri-satellite-retry').addEventListener('click',draw);$('agri-satellite-palette').addEventListener('change',draw);$('agri-field-clip').addEventListener('change',draw);
 $('agri-satellite-zoom').addEventListener('click',()=>{if(sceneBounds)map.fitBounds(sceneBounds,{padding:[18,18],maxZoom:12});});
 $('agri-field-draw').addEventListener('click',()=>{ensureMap();drawing=!drawing;$('agri-field-draw').textContent=drawing?'Finish boundary':'Draw field boundary';if(!drawing&&vertices.length>=3){$('agri-satellite-load').textContent='Load scenes for boundary';if(scenes.length)draw();}fieldNote();});
 $('agri-field-clear').addEventListener('click',()=>{vertices=[];drawing=false;if(polygon)map?.removeLayer(polygon);polygon=null;$('agri-field-draw').textContent='Draw field boundary';$('agri-satellite-load').textContent='Load recent satellite scenes';fieldNote();if(scenes.length)draw();});
 return {show(){ensureMap();map.invalidateSize();if(!layer)map.setView([place[1],place[2]],11);},setLocation(next){controller?.abort();place=next;scenes=[];clearImagery();$('agri-field-clear').click();if(map){map.setView([place[1],place[2]],11);if(marker)map.removeLayer(marker);marker=L.circleMarker([place[1],place[2]],{radius:5,color:'#fff'}).addTo(map);}status('Choose a sensor and load recent scenes for '+place[0]+'. Acquisition times are PKT; imagery is not live.');}};
}
