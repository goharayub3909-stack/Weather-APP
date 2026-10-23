// Runner-only verification of real raster responses. No signed URLs are logged.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {indexRecipe,fieldColormap,FIELD_INDICES,zoneExpression} from '../public/farm-indices.js';
mkdirSync('/tmp/field-index-images',{recursive:true});
const path='/tmp/agri-satellite.json',records=JSON.parse(readFileSync(path)),root='https://planetarycomputer.microsoft.com';
for(const record of records){
 if(!record.feature)continue;
 const sensor=record.collection.startsWith('sentinel')?'sentinel':record.collection.startsWith('landsat')?'landsat':'modis';record.field_indices={};
 if(sensor==='sentinel'){
  try{const href=record.feature.assets['product-metadata']?.href;if(!href||!new URL(href).hostname.endsWith('.blob.core.windows.net'))throw Error('No metadata asset');const signed=await(await fetch(root+'/api/sas/v1/sign?href='+encodeURIComponent(href))).json();const response=await fetch(signed.href,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Metadata unavailable');const xml=await response.text();record.reflectance_metadata={boa_offsets:[...new Set([...xml.matchAll(/<BOA_ADD_OFFSET[^>]*>([^<]+)</g)].map(m=>m[1]))],quantification:[...xml.matchAll(/<BOA_QUANTIFICATION_VALUE[^>]*>([^<]+)</g)].map(m=>m[1])};}catch{record.reflectance_metadata={unavailable:true};}
 }
 for(const mode of Object.keys(FIELD_INDICES)){
  try{
   const recipe=indexRecipe(sensor,mode,record.feature);if(!recipe)continue;
   const u=new URL(root+'/api/data/v1/item/tilejson.json');u.search=new URLSearchParams({collection:record.collection,item:record.id,rescale:recipe.range.join(','),unscale:'false',colormap:JSON.stringify(fieldColormap(mode))});recipe.assets.forEach(a=>u.searchParams.append('assets',a));if(recipe.expression){u.searchParams.set('expression',zoneExpression(mode,recipe.expression));u.searchParams.set('rescale','0,255');}else{u.searchParams.delete('colormap');u.searchParams.set('colormap_name','rdylgn');}
   const response=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Metadata HTTP '+response.status);const data=await response.json();const z=11,x=Math.floor((73.08+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(31.42*Math.PI/180))/Math.PI)/2*2**z),url=data.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);const tile=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{Origin:'https://goharayub3909-stack.github.io'}});const bytes=await tile.arrayBuffer();if(tile.ok)writeFileSync('/tmp/field-index-images/'+sensor+'-'+mode+'.png',Buffer.from(bytes));record.field_indices[mode]={status:tile.status,type:tile.headers.get('content-type'),bytes:bytes.byteLength,cors:tile.headers.get('access-control-allow-origin'),resolution:recipe.resolution};
  }catch(e){record.field_indices[mode]={error:e.message};}
 }
}
writeFileSync(path,JSON.stringify(records));
