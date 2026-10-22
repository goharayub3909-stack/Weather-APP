// Parse the national gazetteer off the UI thread, only after search is focused.
import {normalize,rankLocations} from './locations.js';
let places=[];
self.onmessage=({data})=>{
 if(data.type==='query')self.postMessage({type:'results',query:data.query,places:rankLocations(places,data.query)});
};
try{
 const response=await fetch(new URL('./location-data/index.json',import.meta.url));if(!response.ok)throw Error();
 const data=await response.json();
 places=data.places.map(([id,name,lat,lon,region,population,aliases])=>({id,name,lat,lon,region,population,normalizedName:normalize(name),normalizedAliases:normalize(aliases)}));
 self.postMessage({type:'ready',count:places.length});
}catch{self.postMessage({type:'error'});}
