// Shared exact-city ECMWF diagnostic cache. Public lightning is short-lead
// evidence only; it is never extrapolated into the seven-day forecast.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cities} from '../public/cities.js';
import {thunderEvidence} from '../public/storms.js';
import {cleanStrikes,BUFFER_URL} from '../public/lightning.js';
import {distanceKm} from '../public/current-weather.js';
const folder='public/storm-data',path=folder+'/cities.json',now=new Date(),fields=['cape','showers','precipitation','weather_code','temperature_850hPa','relative_humidity_850hPa','temperature_700hPa','relative_humidity_700hPa','temperature_500hPa','surface_pressure'];
await mkdir(folder,{recursive:true});
const run=promisify(execFile);
// urllib uses the execution environment's verified TLS / HTTPS proxy settings.
const get=async url=>{const {stdout}=await run('python3',['-c',"import sys,urllib.request; r=urllib.request.urlopen(urllib.request.Request(sys.argv[1],headers={'User-Agent':'BadalPK shared public storm diagnostics'}),timeout=35);sys.stdout.write(r.read().decode())",String(url)],{timeout:45000,maxBuffer:16*1024*1024});return JSON.parse(stdout);};
let old=null;
try{old=JSON.parse(await readFile(path));}catch{}
if(process.env.PREVIOUS_STORMS_URL&&new URL(process.env.PREVIOUS_STORMS_URL).hostname==='goharayub3909-stack.github.io'){try{const candidate=await get(process.env.PREVIOUS_STORMS_URL);if(candidate.schema_version===1&&Array.isArray(candidate.cities)&&(!old||candidate.weather_fetched_at>old.weather_fetched_at))old=candidate;}catch{}}
let records=old?.cities||[],fetched=old?.weather_fetched_at||null,status='cached';
if(!old||!records.length||!Number.isFinite(Date.parse(fetched))||now-Date.parse(fetched)>=6*3600000||Date.parse(fetched)-now>300000){
 try{
  const entries=Object.entries(cities),fresh=[];
  for(let offset=0;offset<entries.length;offset+=8){const batch=entries.slice(offset,offset+8),u=new URL('https://api.open-meteo.com/v1/forecast');u.search=new URLSearchParams({latitude:batch.map(([,p])=>p[1]).join(','),longitude:batch.map(([,p])=>p[2]).join(','),models:'ecmwf_ifs025',hourly:fields.join(','),daily:'precipitation_sum,weather_code',timezone:'Asia/Karachi',forecast_days:7});let points=await get(u);if(!Array.isArray(points))points=[points];if(points.length!==batch.length)throw Error('Incomplete city forecast');
   points.forEach((d,i)=>{const [id,p]=batch[i];if(d.utc_offset_seconds!==18000||d.hourly_units?.cape!=='J/kg'||d.hourly_units?.showers!=='mm'||Math.abs(d.latitude-p[1])>.26||Math.abs(d.longitude-p[2])>.26||!d.hourly?.time?.length||!d.daily?.time?.length)throw Error('Invalid ECMWF diagnostic data');fresh.push({id,name:p[0],lat:p[1],lon:p[2],hourly:d.hourly,daily:d.daily});});
   if(offset+8<entries.length)await new Promise(r=>setTimeout(r,2000));
  }
  records=fresh;fetched=now.toISOString();status='updated';
 }catch{console.log('Storm diagnostics: upstream refresh unavailable; only previous actual data may be retained.');}
}
let strikes=[],lightningStatus='unavailable';try{const d=await get(BUFFER_URL);if(Array.isArray(d.strikes)){strikes=cleanStrikes(d.strikes).filter(s=>now-s.time>=-300000&&now-s.time<=3600000);lightningStatus='updated';}}catch{}
const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});
for(const city of records){const nearby=strikes.filter(s=>distanceKm(city.lat,city.lon,s)<=50),recent=nearby.length?Math.max(...nearby.map(s=>s.time)):null;
 city.outlook=city.daily.time.map(date=>{const evidence=thunderEvidence(city.hourly,date),wetSoon=city.hourly.time.some((t,i)=>{const time=Date.parse(t+'+05:00');return time>=now&&time-now<=3*3600000&&city.hourly.precipitation?.[i]>=.2;});const lightningThunder=date===today&&recent!==null&&wetSoon;return {date,...evidence,lightningThunder,lightning_valid_until:lightningThunder?new Date(recent+3600000).toISOString():null,reason:lightningThunder&&!evidence.weatherThunder?'Observed lightning within 50 km / last hour and near-term forecast precipitation':evidence.reason};});
}
const result={schema_version:1,source:'ECMWF IFS 0.25° via Open-Meteo',weather_fetched_at:fetched,generated_at:now.toISOString(),status,lightning_status:lightningStatus,lightning_source:BUFFER_URL,method:'Qualitative thunder screen: explicit ECMWF codes or simultaneous instability and convective precipitation; pressure-level K index where above terrain. No calibrated thunder probability or lightning extrapolation.',cities:records};
await writeFile(path,JSON.stringify(result)+'\n');console.log('Storm diagnostics:',records.length,'exact city forecasts;',lightningStatus,'lightning.');
