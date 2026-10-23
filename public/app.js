import {addTileHelp} from './tile-help.js';
import {loadBackendStorms,backendStormDay} from './storm-outlook.js';
import {chooseCurrentSource,currentValue,currentCondition,mainReading} from './current-weather.js';
import {pkt} from './map-utils.js';
import {initFarmers} from './farmers.js';
import {supplementalFields,dailyCondition,ecmwfDailyCondition} from './storms.js';
import {icon} from './icons.js';
import {initGeolocation} from './geolocation.js';
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
const farmers=initFarmers();
const store={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
const custom=store.get('monsoon-places',{});for(const [id,p]of Object.entries(custom)){if(Array.isArray(p)&&typeof p[0]==='string'&&Number.isFinite(p[1])&&Number.isFinite(p[2])&&p[1]>=23&&p[1]<=38&&p[2]>=60&&p[2]<=78)cities[id]=p;}
let selectionRevision=0;
let selected=store.get('monsoon-city','islamabad');if(!cities[selected])selected='islamabad';
let unit=store.get('monsoon-unit','C'),saved=store.get('monsoon-favorites',['islamabad','karachi','lahore']);if(!Array.isArray(saved))saved=[];
let backendStorms=null;
let currentLoading=true,supplemental=null,data=null,index=-1,request,chartMetric='temperature_2m',currentReports=[null,null],currentSource={kind:'forecast',report:null,name:'ECMWF IFS'},observationCache=null;
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
 ['precipitation_probability','Rain chance','Not supplied by this source unless available','☂','%'],
 ['visibility','Visibility','From selected current-weather source','◉',' km'],
 ['uv_index','UV index','From selected current-weather source','☀',''],

];
const metricAppearance={apparent_temperature:['warm','temperature'],relative_humidity_2m:['moisture','humidity'],wind_speed_10m:['breeze','wind'],wind_gusts_10m:['mint','gust'],dew_point_2m:['dew','dew'],pressure_msl:['violet','pressure'],surface_pressure:['rose','surface'],cloud_cover:['cloud','cloud'],precipitation:['rain','umbrella'],rain:['shower','rain'],snowfall:['snow','snow'],shortwave_radiation:['solar','sun'],precipitation_probability:['lilac','rain'],visibility:['mist','eye'],uv_index:['sunset','uv'],cape:['solar','storm'],hail_signal:['lilac','hail']};
for(const [key,label,note] of metrics){const [theme,glyph]=metricAppearance[key],article=document.createElement('article');article.className='card metric metric--'+theme;article.innerHTML=`<span class="metric-art" aria-hidden="true">${icon(glyph)}</span><div class="metric-top"><span id="label-${key}">${label}</span><span class="metric-icon">${icon(glyph)}</span></div><strong id="metric-${key}">—</strong><p id="note-${key}">${note}</p>`;addTileHelp(article,key);$('detail-grid').append(article);}
for(const [selector,key]of [['.hero','current'],['.week-card','forecast'],['.hourly-card','hourly'],['.sun-card','sun'],['.air-card','air']]){const card=document.querySelector(selector);if(card)addTileHelp(card,key);}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
Object.entries(cities).sort((a,b)=>a[1][0].localeCompare(b[1][0])).forEach(([id,[name]])=>{const option=document.createElement('option');option.value=id;option.textContent=name;$('city').append(option);const suggestion=document.createElement('option');suggestion.value=name;$('city-list').append(suggestion);});
$('city').value=selected;
function favorites(){
 $('quick-cities').replaceChildren();
 saved.filter(id=>cities[id]).slice(0,5).forEach(id=>{const button=document.createElement('button');button.className='city-chip'+(selected===id?' active':'');button.textContent=cities[id][0];button.addEventListener('click',()=>selectCity(id));$('quick-cities').append(button);});
 const active=saved.includes(selected);text('favorite',active?'★':'☆');$('favorite').setAttribute('aria-pressed',String(active));$('favorite').setAttribute('aria-label',active?'Remove saved city':'Save city');
}
function selectCity(id){selectionRevision++;selected=id;$('city').value=id;$('search').value='';store.set('monsoon-city',id);favorites();load();showCityImage(selected,cities[selected]);setPhotoPlace(cities[selected]);document.dispatchEvent(new CustomEvent('forecastlocationchange',{detail:cities[selected]}));}
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
 currentLoading=true;currentReports=[null,null];currentSource={kind:'forecast',report:null,name:'ECMWF IFS'};text('current-source','Checking fresh station reports within 50 km, then airport reports within 100 km…');
 farmers.update({place:cities[selected],forecast:null,supplemental:null,status:'loading',retrievedAt:null,observation:null});
 data=null;supplemental=null;index=-1;text('location',cities[selected][0]);text('temperature','—°');text('condition','Loading your forecast…');text('feels','Feels like — · High — / Low —');
 for(const id of ['hero-wind','hero-humidity','hero-rain','sunrise','sunset','daylight','aqi','pm25','pm10'])text(id,'—');
 for(const [key,,note] of metrics){text('metric-'+key,'—');text('note-'+key,note);}text('chart-caption','Loading hourly forecast…');
 text('note-wind_speed_10m','At 10 metres above ground');text('note-cloud_cover','Total sky covered by cloud');
 text('aqi-label','Loading…');text('aq-note','Air quality is separate from the ECMWF weather forecast.');
 text('forecast-time','Pakistan Standard Time');text('week','Waiting for forecast data');text('chart','Waiting for forecast data');$('hour-strip').replaceChildren();
}
async function load(){
 request?.abort();request=new AbortController();const signal=request.signal;reset();$('status').className='status';text('status','Fetching ECMWF weather and regional air-quality forecasts…');
 const [,lat,lon]=cities[selected];
 loadCurrent(lat,lon,signal);
 loadAir(lat,lon,signal);
 loadSupplement(lat,lon,signal);
 loadBackendStorms(signal).then(result=>{if(!signal.aborted){backendStorms=result;if(data)renderWeek();}}).catch(()=>{});
 try{
  const response=await fetch(forecastURL(lat,lon),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  const result=await response.json();if(!response.ok)throw Error(result.reason||'Weather provider is unavailable.');
  if(!result.hourly?.time?.length||!result.daily?.time?.length)throw Error('Incomplete forecast response.');
  const i=hourIndex(result.hourly.time);if(i<0)throw Error('The provider has no forecast for the current Pakistan hour.');
  if(signal.aborted)return;data=result;index=i;farmers.update({forecast:result,status:'ready',retrievedAt:new Date()});render();text('status','Forecast sections: ECMWF IFS 0.25° via Open-Meteo · Retrieved '+new Date().toLocaleTimeString('en-PK',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit'})+' PKT');
 }catch(e){if(signal.aborted)return;$('status').className='status error';text('status','Forecast unavailable. Check your internet connection and press Refresh. '+(e.name==='TimeoutError'?'The request timed out.':''));text('condition','Unable to load forecast');text('week','No forecast data available.');text('chart','No forecast data available.');farmers.update({forecast:null,status:'error'});render();}
}
async function loadAir(lat,lon,signal){
 try{const url=new URL('https://air-quality-api.open-meteo.com/v1/air-quality');url.search=new URLSearchParams({latitude:lat,longitude:lon,hourly:'us_aqi,pm2_5,pm10',timezone:'Asia/Karachi',forecast_days:1});const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();const result=await response.json();const i=hourIndex(result.hourly?.time||[]);if(i<0)throw Error();text('aqi',n(result.hourly.us_aqi?.[i]));text('aqi-label',aqiCategory(result.hourly.us_aqi?.[i]));text('pm25',n(result.hourly.pm2_5?.[i],' µg/m³',1));text('pm10',n(result.hourly.pm10?.[i],' µg/m³',1));text('aq-note','CAMS atmospheric model via Open-Meteo · Not a local sensor reading.');}
 catch{if(signal.aborted)return;text('aqi-label','Unavailable');text('aq-note','The separate air-quality provider could not be reached.');}
}
function readingSource(reading){return reading.source?(reading.source.kind==='station'?'Station · ':reading.source.kind==='metar'?'METAR · ':'Forecast · ')+reading.source.name+(reading.fallback?' · fallback':''):'Unavailable from station, METAR and ECMWF';}
function renderSupplement(){
 for(const key of ['precipitation_probability','visibility','uv_index']){const reading=mainReading(currentSource,key,value(key)),v=reading.value;text('metric-'+key,n(key==='visibility'&&isNumber(v)?v/1000:v,key==='visibility'?' km':key==='precipitation_probability'?'%':'',key==='precipitation_probability'?0:1));text('note-'+key,readingSource(reading));}
}
async function loadSupplement(lat,lon,signal){
 try{const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:lat,longitude:lon,hourly:supplementalFields.join(','),daily:'precipitation_probability_max,weather_code',timezone:'Asia/Karachi',forecast_days:7});const r=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});if(!r.ok)throw Error();const result=await r.json();if(!result.hourly?.time?.length)throw Error();if(signal.aborted)return;supplemental=result;farmers.update({supplemental:result});renderSupplement();if(data)renderWeek();}catch{if(!signal.aborted){supplemental=null;farmers.update({supplemental:null});renderSupplement();if(data)renderWeek();}}
}

function value(key){return data?.hourly?.[key]?.[index];}
async function loadCurrent(lat,lon,signal){
 const results=observationCache&&Date.now()-observationCache.time<60000?observationCache.reports:await Promise.allSettled(['stations','metar'].map(async name=>{const r=await fetch(new URL('./observation-data/'+name+'.json',import.meta.url),{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(18000)])});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.stations))throw Error();return d;}));
 if(signal.aborted)return;currentLoading=false;observationCache={time:Date.now(),reports:results};currentReports=results.map(r=>r.status==='fulfilled'?r.value:null);currentSource=chooseCurrentSource(lat,lon,...currentReports);farmers.update({observation:currentSource.kind==='forecast'?null:currentSource});render();
}
function renderCurrent(){
 const observed=currentSource.kind!=='forecast',reading=key=>mainReading(currentSource,key,value(key)),get=key=>reading(key).value;
 const heroSource=reading('temperature_2m').source||currentSource,kind=heroSource.kind==='station'?'WEATHER STATION':heroSource.kind==='metar'?'AIRPORT METAR':'ECMWF FALLBACK';text('current-kind',kind);
 text('current-source',observed?`PRIMARY ${currentSource.kind==='station'?'STATION':'METAR'} · ${currentSource.name} · ${currentSource.distance.toFixed(1)} km away · observed ${pkt(currentSource.time)}. Missing fields fall back to fresh METAR, then ECMWF. Each tile names its source.${currentSource.report.observed_time_basis?' '+currentSource.report.observed_time_basis+'.':''}`:currentLoading?'Checking nearby station and airport reports. Showing the ECMWF report provisionally.':'Fresh station (50 km / 3h) and airport (100 km / 2h) reports unavailable. Current conditions use ECMWF. Forecasts below remain separate.');
 text('temperature',temp(get('temperature_2m')));text('condition',currentCondition(heroSource,data?weather(value('weather_code'))[0]:'Current weather unavailable'));
 text('forecast-time',heroSource.kind!=='forecast'?pkt(heroSource.time):data?clockTime(data.hourly.time[index])+' PKT · MODEL HOUR':'No current data');
 const d=data?.daily,day=d?.time?.indexOf(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'}))??-1;
 text('feels',observed?'Primary: '+currentSource.name+' · missing fields use labelled fallbacks':`Feels like ${temp(get('apparent_temperature'))} · Forecast high ${temp(d?.temperature_2m_max?.[day])} / low ${temp(d?.temperature_2m_min?.[day])}`);
 text('hero-wind',n(get('wind_speed_10m'),' km/h')+' '+direction(get('wind_direction_10m')));text('hero-humidity',n(get('relative_humidity_2m'),'%'));text('hero-wind-label','↗ Wind · '+(reading('wind_speed_10m').source?.kind||'unavailable'));text('hero-humidity-label','◉ Humidity · '+(reading('relative_humidity_2m').source?.kind||'unavailable'));
 const dailyRain=mainReading(currentSource,'rain_daily',d?.precipitation_sum?.[day]);text('hero-rain-label',dailyRain.source?.kind==='forecast'?'☂ Daily precipitation · ECMWF':'☂ Daily rain · station');text('hero-rain',n(dailyRain.value,' mm',1));
 for(const [key,label,note,,suffix]of metrics){
  const item=reading(key),v=item.value;text('metric-'+key,suffix==='temp'?temp(v):n(key==='visibility'&&isNumber(v)?v/1000:v,suffix,['precipitation','rain','snowfall'].includes(key)?1:0));
  text('label-'+key,key==='wind_gusts_10m'&&item.source?.kind==='station'?'10-minute gust':label);
  text('note-'+key,readingSource(item)+(key==='relative_humidity_2m'&&item.source?.kind==='metar'?' · derived from airport temperature / dew point':''));
 }
 if(reading('wind_speed_10m').source?.kind!==reading('wind_direction_10m').source?.kind)text('note-wind_speed_10m',readingSource(reading('wind_speed_10m'))+' · direction from '+(reading('wind_direction_10m').source?.name||'unavailable'));
 if(!observed){text('note-wind_speed_10m',readingSource(reading('wind_speed_10m'))+' · '+direction(value('wind_direction_10m')));text('note-cloud_cover',`ECMWF · Low ${n(value('cloud_cover_low'),'%')} · Mid ${n(value('cloud_cover_mid'),'%')} · High ${n(value('cloud_cover_high'),'%')}`);}
}
function render(){
 renderCurrent();if(!data){renderSupplement();return;}const d=data.daily;
 text('sunrise',clockTime(d.sunrise?.[0]));text('sunset',clockTime(d.sunset?.[0]));const seconds=d.daylight_duration?.[0];text('daylight',isNumber(seconds)?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`:'—');
 renderWeek();renderChart();renderSupplement();
}
function renderWeek(){
 if(!data)return;const d=data.daily;$('week').replaceChildren();
 const lows=d.temperature_2m_min.filter(isNumber),highs=d.temperature_2m_max.filter(isNumber),min=Math.min(...lows),max=Math.max(...highs),range=max-min||1;
 d.time.forEach((time,i)=>{
  const outlook=ecmwfDailyCondition({amount:d.precipitation_sum?.[i],code:d.weather_code?.[i],hourly:data.hourly,date:time,backend:backendStormDay(backendStorms,...cities[selected].slice(1),time)});
  const low=d.temperature_2m_min[i],high=d.temperature_2m_max[i],row=document.createElement('div');row.className='day';
  const day=document.createElement('div');day.className='day-name';const weekday=document.createElement('strong');weekday.textContent=i===0?'Today':new Date(time+'T12:00:00+05:00').toLocaleDateString('en-PK',{weekday:'short',timeZone:'Asia/Karachi'});const condition=document.createElement('small');condition.textContent=outlook.label;day.append(weekday,condition);
  const symbol=document.createElement('span');symbol.className='day-icon outlook-'+outlook.icon;symbol.innerHTML=icon(outlook.icon);symbol.title=outlook.label+(outlook.reason?' · '+outlook.reason:'');symbol.setAttribute('aria-label',outlook.label);
  const temps=document.createElement('div');temps.className='day-range';const lo=document.createElement('span');lo.textContent=temp(low);const bar=document.createElement('span');bar.className='range-track';if(isNumber(low)&&isNumber(high)){const fill=document.createElement('i');fill.style.left=(low-min)/range*100+'%';fill.style.width=Math.max(4,(high-low)/range*100)+'%';bar.append(fill);}const hi=document.createElement('strong');hi.textContent=temp(high);temps.append(lo,bar,hi);
  const rain=document.createElement('div');rain.className='day-rain';const amount=document.createElement('strong');amount.textContent=n(d.precipitation_sum?.[i],' mm',1);const probability=document.createElement('small'),pop=d.precipitation_probability_max?.[i];probability.textContent=isNumber(pop)?n(pop,'%')+(outlook.icon==='snow'?' precip chance':' rain chance'):outlook.thunder?'Thunder signal':outlook.band.rain?'Rain signal':'—';rain.title=outlook.band.label+' · amount-based label; thunder signal is qualitative ECMWF guidance.';rain.append(amount,probability);
  row.append(day,symbol,temps,rain);$('week').append(row);
 });

}
function renderChart(){
 if(!data)return;
 const fields={temperature_2m:{label:'Temperature',unit:'°'+unit,digits:0},precipitation:{label:'Precipitation',unit:' mm',digits:1},wind_speed_10m:{label:'Wind speed',unit:' km/h',digits:0},relative_humidity_2m:{label:'Humidity',unit:'%',digits:0}},metric=fields[chartMetric];
 const times=data.hourly.time.slice(index,index+24),values=times.map((_,i)=>data.hourly[chartMetric]?.[index+i]);
 const converted=values.map(v=>chartMetric==='temperature_2m'&&isNumber(v)&&unit==='F'?v*9/5+32:v),valid=converted.filter(isNumber);
 $('chart').replaceChildren();$('hour-strip').replaceChildren();
 const caption=$('chart-caption');caption.textContent=valid.length?`${metric.label} · ${metric.unit.trim()} · PKT${valid.length<times.length?' · gaps indicate unavailable values':''}${chartMetric==='precipitation'&&valid.every(v=>v===0)?' · No precipitation forecast; zero line shown':''}`:`${metric.label} data is unavailable for this period.`;
 if(valid.length){
  const width=Math.max(300,$('chart').clientWidth||1000),height=165,pad={left:42,right:16,top:22,bottom:32};
  let min=Math.min(...valid),max=Math.max(...valid);if(chartMetric==='precipitation'||chartMetric==='wind_speed_10m')min=0;if(min===max){if(min===0)max=1;else{min-=1;max+=1;}}
  const range=max-min,x=i=>pad.left+i*(width-pad.left-pad.right)/Math.max(1,times.length-1),y=v=>height-pad.bottom-(v-min)/range*(height-pad.top-pad.bottom),ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Next 24 hours: ${chartMetric.replaceAll('_',' ')} in ${metric.unit.trim()}. Missing values are gaps.`);
  const element=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))e.setAttribute(key,value);return e;};
  for(let i=0;i<3;i++){const v=min+range*i/2,py=y(v);svg.append(element('line',{x1:pad.left,x2:width-pad.right,y1:py,y2:py,stroke:'currentColor','stroke-opacity':'.12'}));const label=element('text',{x:pad.left-7,y:py+3,'text-anchor':'end',fill:'currentColor','fill-opacity':'.65','font-size':10});label.textContent=v.toFixed(chartMetric==='precipitation'?1:0);svg.append(label);}
  let segment=[];const flush=()=>{if(segment.length>1)svg.append(element('polyline',{points:segment.join(' '),fill:'none',stroke:'var(--accent)','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));segment=[];};
  converted.forEach((v,i)=>{if(isNumber(v))segment.push(x(i)+','+y(v));else flush();});flush();
  converted.forEach((v,i)=>{if(!isNumber(v))return;const dot=element('circle',{cx:x(i),cy:y(v),r:valid.length===1?4:i%3===0?3:1.7,fill:'var(--accent)'}),title=element('title',{});title.textContent=clockTime(times[i])+' PKT · '+n(v,metric.unit,metric.digits);dot.append(title);svg.append(dot);});
  for(let i=0;i<times.length;i+=Math.max(3,Math.ceil(times.length/(width<500?4:8)))){const label=element('text',{x:x(i),y:height-7,'text-anchor':'middle',fill:'currentColor','fill-opacity':'.7','font-size':9});label.textContent=clockTime(times[i]);svg.append(label);}
  $('chart').append(svg);
 }else{const message=document.createElement('p');message.className='empty';message.textContent='No valid values returned for this parameter. Choose another view or refresh.';$('chart').append(message);}
 times.forEach((time,i)=>{const cell=document.createElement('div');cell.className='hour';const hour=document.createElement('span');hour.textContent=i===0?'Now':clockTime(time);const symbol=document.createElement('span');symbol.className='hour-icon';symbol.innerHTML=icon(dailyCondition({amount:data.hourly.precipitation?.[index+i],code:data.hourly.weather_code?.[index+i]}).icon);const val=document.createElement('strong');val.textContent=n(converted[i],metric.unit,metric.digits);cell.append(hour,symbol,val);$('hour-strip').append(cell);});
}

document.querySelectorAll('[data-chart]').forEach(button=>button.addEventListener('click',()=>{chartMetric=button.dataset.chart;document.querySelectorAll('[data-chart]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});renderChart();}));
$('refresh').addEventListener('click',load);
function tick(){const now=new Date();text('date',now.toLocaleDateString('en-PK',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Karachi'}));text('clock',now.toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Karachi'})+' PKT · UTC+5');if(data)index=hourIndex(data.hourly.time);if(data||currentReports.some(Boolean)){const[,lat,lon]=cities[selected];currentSource=chooseCurrentSource(lat,lon,...currentReports);renderCurrent();renderSupplement();if(location.hash==='#farmers')farmers.update({observation:currentSource.kind==='forecast'?null:currentSource});}}tick();setInterval(tick,60000);setInterval(()=>{if(!document.hidden&&request&&!request.signal.aborted){const[,lat,lon]=cities[selected];loadCurrent(lat,lon,request.signal);}},600000);favorites();load();showCityImage(selected,cities[selected]);setPhotoPlace(cities[selected]);

initRadar();
initSatellite();
initLightning();

initObservations();
initMapTabs();

initPlacePhotos();

initGeolocation({getSelectionRevision:()=>selectionRevision,onLocate({lat,lon}){cities['current-location']=['Your location',lat,lon];if(!$('city').querySelector('option[value="current-location"]'))$('city').append(new Option('Your location','current-location'));selectCity('current-location');}});

let chartWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width!==chartWidth){chartWidth=width;requestAnimationFrame(()=>renderChart());}}).observe($('chart'));
