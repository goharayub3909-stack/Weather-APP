let cache=null,request=null;
export async function loadBackendStorms(signal){
 if(cache&&Date.now()-cache.loaded<900000)return cache.data;
 if(!request)request=fetch(new URL('./storm-data/cities.json',import.meta.url),{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(d.schema_version!==1||!Array.isArray(d.cities))throw Error();cache={loaded:Date.now(),data:d};return d;}).finally(()=>{request=null;});
 const data=await request;if(signal?.aborted)throw Error('Aborted');return data;
}
export function backendStormDay(data,lat,lon,date,now=Date.now()){
 const age=now-Date.parse(data?.weather_fetched_at);if(!Number.isFinite(age)||age< -300000||age>6*3600000)return null;
 const city=data.cities.find(c=>Math.abs(c.lat-lat)<.005&&Math.abs(c.lon-lon)<.005);return city?.outlook?.find(r=>r.date===date)||null;
}
