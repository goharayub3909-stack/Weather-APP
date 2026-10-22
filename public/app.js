import {initPlacePhotos,setPhotoPlace} from './place-photos.js';
import {initMapTabs} from './maps.js';
import {initObservations} from './observations.js';
import {initLocationSearch} from './locations.js';
import {initRadar} from './radar.js';
import {initSatellite} from './satellite.js';
import {initLightning} from './lightning.js';
import {showCityImage} from './city-images.js';
import {cities} from './cities.js';
import {forecastURL,weather,hourIndex,isNumber,aqiCategory,direction} from './weather.js';
const $=id=>document.getElementById(id);
const store={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
const custom=store.get('monsoon-places',{});for(const [id,p]of Object.entries(custom)){if(Array.isArray(p)&&typeof p[0]==='string'&&Number.isFinite(p[1])&&Number.isFinite(p[2])&&p[1]>=23&&p[1]<=38&&p[2]>=60&&p[2]<=78)cities[id]=p;}
let selected=store.get('monsoon-city','islamabad');if(!cities[selected])selected='islamabad';
let unit=store.get('monsoon-unit','C'),saved=store.get('monsoon-favorites',['islamabad','karachi','lahore']);if(!Array.isArray(saved))saved=[];
let supplemental=null,data=null,index=-1,request,chartMetric='temperature_2m';
const text=(id,value)=>$(id).textContent=value;
const n=(v,suffix='',digits=0)=>isNumber(v)?v.toFixed(digits)+suffix:'—';
const temp=v=>n(isNumber(v)?unit==='F'?v*9/5+32:v:null,'°');
const clockTime=t=>t?new Date(t+'+05:00').toLocaleTimeString('en-PK',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Karachi'}):'—';
const metrics=[
 ['apparent_temperature','Feels like','How the temperature feels','◌','temp'],
 ['relative_humidity_2m','Humidity','Moisture in the air','◉','%'],
 ['wind_speed_10m','Wind','At 10 metres above ground','↗',' km/h'],
 ['wind_gusts_10m','Wind gusts','Forecast peak gust speed','≋',' km/h'],
 ['dew_point_2m','Dew point','Temperature of condensation','♧','temp'],
 ['pressure_msl','Sea-level pressure','Pressure adjusted to sea level','◴',' hPa'],
 ['surface_pressure','Surface pressure','Pressure at local elevation','◫',' hPa'],
 ['cloud_cover','Cloud cover','Total sky covered by cloud','☁','%'],
 ['precipitation','Precipitation','Total during the model hour','☂',' mm'],
 ['rain','Rain','Rain during the model hour','☔',' mm'],
 ['snowfall','Snowfall','Snow during the model hour','❄',' cm'],
 ['shortwave_radiation','Solar radiation','Mean incoming solar energy','☀',' W/m²'],
 ['precipitation_probability','Rain chance','Supplemental model · not ECMWF','☂','%'],
 ['visibility','Visibility','Supplemental model · not ECMWF','◉',' km'],
 ['uv_index','UV index','Supplemental model · not ECMWF','☀','']
];
for(const [key,label,note,icon] of metrics){const article=document.createElement('article');article.className='card metric';article.innerHTML=`<div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><strong id="metric-${key}">—</strong><p id="note-${key}">${note}</p>`;$('detail-grid').append(article);}
Object.entries(cities).sort((a,b)=>a[1][0].localeCompare(b[1][0])).forEach(([id,[name]])=>{const option=document.createElement('option');option.value=id;option.textContent=name;$('city').append(option);const suggestion=document.createElement('option');suggestion.value=name;$('city-list').append(suggestion);});
$('city').value=selected;
function favorites(){
 $('quick-cities').replaceChildren();
 saved.filter(id=>cities[id]).slice(0,5).forEach(id=>{const button=document.createElement('button');button.className='city-chip'+(selected===id?' active':'');button.textContent=cities[id][0];button.addEventListener('click',()=>selectCity(id));$('quick-cities').append(button);});
 const active=saved.includes(selected);text('favorite',active?'★':'☆');$('favorite').setAttribute('aria-pressed',String(active));$('favorite').setAttribute('aria-label',active?'Remove saved city':'Save city');
}
function selectCity(id){selected=id;$('city').value=id;$('search').value='';store.set('monsoon-city',id);favorites();load();showCityImage(selected,cities[selected]);setPhotoPlace(cities[selected]);}
$('city').addEventListener('change',()=>selectCity($('city').value));
initLocationSearch({cities,onSelect(place){
 if(!cities[place.id]){cities[place.id]=[place.name,place.lat,place.lon];custom[place.id]=cities[place.id];store.set('monsoon-places',custom);const option=new Option(place.name,place.id);$('city').append(option);}
 selectCity(place.id);
}});
$('favorite').addEventListener('click',()=>{saved=saved.includes(selected)?saved.filter(id=>id!==selected):[selected,...saved].slice(0,5);store.set('monsoon-favorites',saved);favorites();});
function applyTheme(theme){document.documentElement.dataset.theme=theme;store.set('monsoon-theme',theme);text('theme',theme==='dark'?'☼':'☾');}
applyTheme(store.get('monsoon-theme','dark'));
$('theme').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('unit').addEventListener('click',()=>{unit=unit==='C'?'F':'C';store.set('monsoon-unit',unit);text('unit','°'+unit);render();});text('unit','°'+unit);
function reset(){
 data=null;supplemental=null;index=-1;text('location',cities[selected][0]);text('temperature','—°');text('condition','Loading your forecast…');text('feels','Feels like — · High — / Low —');
 for(const id of ['hero-wind','hero-humidity','hero-rain','sunrise','sunset','daylight','aqi','pm25','pm10'])text(id,'—');
 for(const [key] of metrics)text('metric-'+key,'—');
 text('note-wind_speed_10m','At 10 metres above ground');text('note-cloud_cover','Total sky covered by cloud');
 text('aqi-label','Loading…');text('aq-note','Air quality is separate from the ECMWF weather forecast.');
 text('forecast-time','Pakistan Standard Time');text('week','Waiting for forecast data');text('chart','Waiting for forecast data');$('hour-strip').replaceChildren();
}
async function load(){
 request?.abort();request=new AbortController();const signal=request.signal;reset();$('status').className='status';text('status','Fetching ECMWF weather and regional air-quality forecasts…');
 const [,lat,lon]=cities[selected];
 loadAir(lat,lon,signal);
 loadSupplement(lat,lon,signal);
 try{
  const response=await fetch(forecastURL(lat,lon),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const result=await response.json();if(!response.ok)throw Error(result.reason||'Weather provider is unavailable.');
  if(!result.hourly?.time?.length||!result.daily?.time?.length)throw Error('Incomplete forecast response.');
  const i=hourIndex(result.hourly.time);if(i<0)throw Error('The provider has no forecast for the current Pakistan hour.');
  data=result;index=i;render();text('status','ECMWF IFS 0.25° via Open-Meteo · Forecasts, not station observations · Retrieved '+new Date().toLocaleTimeString('en-PK',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit'})+' PKT');
 }catch(e){if(signal.aborted)return;$('status').className='status error';text('status','Forecast unavailable. Check your internet connection and press Refresh. '+(e.name==='TimeoutError'?'The request timed out.':''));text('condition','Unable to load forecast');text('week','No forecast data available.');text('chart','No forecast data available.');}
}
async function loadAir(lat,lon,signal){
 try{const url=new URL('https://air-quality-api.open-meteo.com/v1/air-quality');url.search=new URLSearchParams({latitude:lat,longitude:lon,hourly:'us_aqi,pm2_5,pm10',timezone:'Asia/Karachi',forecast_days:1});const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();const result=await response.json();const i=hourIndex(result.hourly?.time||[]);if(i<0)throw Error();text('aqi',n(result.hourly.us_aqi?.[i]));text('aqi-label',aqiCategory(result.hourly.us_aqi?.[i]));text('pm25',n(result.hourly.pm2_5?.[i],' µg/m³',1));text('pm10',n(result.hourly.pm10?.[i],' µg/m³',1));text('aq-note','CAMS atmospheric model via Open-Meteo · Not a local sensor reading.');}
 catch{if(signal.aborted)return;text('aqi-label','Unavailable');text('aq-note','The separate air-quality provider could not be reached.');}
}
function renderSupplement(){
 for(const key of ['precipitation_probability','visibility','uv_index']){const value=supplemental?.[key];text('metric-'+key,n(key==='visibility'&&isNumber(value)?value/1000:value,key==='visibility'?' km':key==='precipitation_probability'?'%':'',key==='precipitation_probability'?0:1));}
}
async function loadSupplement(lat,lon,signal){
 try{const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:lat,longitude:lon,hourly:'precipitation_probability,visibility,uv_index',timezone:'Asia/Karachi',forecast_days:1});const r=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!r.ok)throw Error();const result=await r.json();const i=hourIndex(result.hourly?.time||[]);if(i<0)throw Error();supplemental=Object.fromEntries(['precipitation_probability','visibility','uv_index'].map(key=>[key,result.hourly[key]?.[i]]));renderSupplement();}catch{if(!signal.aborted){supplemental=null;renderSupplement();}}
}
function value(key){return data?.hourly?.[key]?.[index];}
function render(){
 if(!data)return;const d=data.daily;
 text('temperature',temp(value('temperature_2m')));text('condition',weather(value('weather_code'))[0]);
 text('forecast-time',clockTime(data.hourly.time[index])+' PKT · MODEL HOUR');
 text('feels',`Feels like ${temp(value('apparent_temperature'))} · High ${temp(d.temperature_2m_max?.[0])} / Low ${temp(d.temperature_2m_min?.[0])}`);
 text('hero-wind',n(value('wind_speed_10m'),' km/h')+' '+direction(value('wind_direction_10m')));text('hero-humidity',n(value('relative_humidity_2m'),'%'));text('hero-rain',n(d.precipitation_sum?.[0],' mm',1));
 for(const [key,,, ,suffix] of metrics)text('metric-'+key,suffix==='temp'?temp(value(key)):n(value(key),suffix,['precipitation','rain','snowfall'].includes(key)?1:0));
 text('note-wind_speed_10m','Direction '+direction(value('wind_direction_10m'))+' · '+n(value('wind_direction_10m'),'°'));
 text('note-cloud_cover',`Low ${n(value('cloud_cover_low'),'%')} · Mid ${n(value('cloud_cover_mid'),'%')} · High ${n(value('cloud_cover_high'),'%')}`);
 text('sunrise',clockTime(d.sunrise?.[0]));text('sunset',clockTime(d.sunset?.[0]));const seconds=d.daylight_duration?.[0];text('daylight',isNumber(seconds)?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`:'—');
 $('week').replaceChildren();
 const lows=d.temperature_2m_min.filter(isNumber),highs=d.temperature_2m_max.filter(isNumber),min=Math.min(...lows),max=Math.max(...highs),range=max-min||1;
 d.time.forEach((time,i)=>{const [label,icon]=weather(d.weather_code?.[i]);const low=d.temperature_2m_min[i],high=d.temperature_2m_max[i];const row=document.createElement('div');row.className='day';const day=document.createElement('strong');day.textContent=i===0?'Today':new Date(time+'T12:00:00+05:00').toLocaleDateString('en-PK',{weekday:'short',timeZone:'Asia/Karachi'});const symbol=document.createElement('span');symbol.className='day-icon';symbol.textContent=icon;symbol.title=label;symbol.setAttribute('aria-label',label);const temps=document.createElement('div');temps.className='day-range';const lo=document.createElement('span');lo.textContent=temp(low);const bar=document.createElement('span');bar.className='range-track';if(isNumber(low)&&isNumber(high)){const fill=document.createElement('i');fill.style.left=(low-min)/range*100+'%';fill.style.width=Math.max(4,(high-low)/range*100)+'%';bar.append(fill);}const hi=document.createElement('strong');hi.textContent=temp(high);temps.append(lo,bar,hi);const rain=document.createElement('span');rain.className='day-rain';rain.textContent=n(d.precipitation_sum?.[i],' mm',1);row.append(day,symbol,temps,rain);$('week').append(row);});renderChart();renderSupplement();
}
function renderChart(){
 if(!data)return;
 const times=data.hourly.time.slice(index,index+24),values=data.hourly[chartMetric]?.slice(index,index+24)||[];
 const converted=values.map(v=>chartMetric==='temperature_2m'&&isNumber(v)&&unit==='F'?v*9/5+32:v);
 const valid=converted.filter(isNumber);$('chart').replaceChildren();$('hour-strip').replaceChildren();if(!valid.length){text('chart','This parameter is unavailable.');return;}
 const width=1050,height=160,pad=22,min=Math.min(...valid),max=Math.max(...valid),range=max-min||1;
 const x=i=>pad+i*(width-2*pad)/Math.max(1,times.length-1),y=v=>height-pad-(v-min)/range*(height-pad*2);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Next 24 hours: ${chartMetric.replaceAll('_',' ')}. Values are in the hourly cards below.`);
 for(let i=0;i<3;i++){const line=document.createElementNS(ns,'line');for(const[k,v]of Object.entries({x1:pad,x2:width-pad,y1:pad+i*58,y2:pad+i*58,stroke:'currentColor','stroke-opacity':'.09'}))line.setAttribute(k,v);svg.append(line);}
 let segment=[];function flush(){if(!segment.length)return;const line=document.createElementNS(ns,'polyline');line.setAttribute('points',segment.join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','var(--accent)');line.setAttribute('stroke-width','3');line.setAttribute('stroke-linejoin','round');svg.append(line);segment=[];}
 converted.forEach((v,i)=>{if(isNumber(v))segment.push(x(i)+','+y(v));else flush();});flush();
 converted.forEach((v,i)=>{if(i%3===0&&isNumber(v)){const label=document.createElementNS(ns,'text');label.setAttribute('x',x(i));label.setAttribute('y',Math.max(13,y(v)-12));label.setAttribute('text-anchor','middle');label.setAttribute('fill','currentColor');label.setAttribute('font-size','12');label.textContent=n(v,chartMetric==='temperature_2m'?'°':chartMetric==='precipitation'?' mm':' km/h');svg.append(label);}});$('chart').append(svg);
 times.forEach((time,i)=>{const cell=document.createElement('div');cell.className='hour';const hour=document.createElement('span');hour.textContent=i===0?'Now':clockTime(time);const icon=document.createElement('span');icon.className='hour-icon';icon.textContent=weather(data.hourly.weather_code?.[index+i])[1];const val=document.createElement('strong');val.textContent=n(converted[i],chartMetric==='temperature_2m'?'°':chartMetric==='precipitation'?' mm':' km/h',chartMetric==='precipitation'?1:0);cell.append(hour,icon,val);$('hour-strip').append(cell);});
}
document.querySelectorAll('[data-chart]').forEach(button=>button.addEventListener('click',()=>{chartMetric=button.dataset.chart;document.querySelectorAll('[data-chart]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});renderChart();}));
$('refresh').addEventListener('click',load);
function tick(){const now=new Date();text('date',now.toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Karachi'}));text('clock',now.toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Karachi'})+' PKT · UTC+5');}tick();setInterval(tick,60000);favorites();load();showCityImage(selected,cities[selected]);setPhotoPlace(cities[selected]);

initRadar();
initSatellite();
initLightning();

initObservations();
initMapTabs();

initPlacePhotos();
