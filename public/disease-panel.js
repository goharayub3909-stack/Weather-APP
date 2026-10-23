import {diseaseWeatherURL,validateDiseaseWeather,assessDisease,DISEASE_RISK_METHOD} from './disease-risk.js';
import {STAGE_NAMES} from './field-context.js';
import {farmTime} from './farm-advice.js';
import {loadStationHistory} from './station-history.js';
const $=id=>document.getElementById(id);
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
const span=(start,end)=>farmTime(start)+' → '+farmTime(end);

export function initDiseasePanel(){
 let context=null,criteria=null,criteriaFailed=false,active=false,controller=null,weather=null,loading=false,error=false,attempted='',generation=0;
 const cache=new Map();
 fetch(new URL('./pest-criteria.json',import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!Array.isArray(d.rules))throw Error();criteria=d;render();}).catch(()=>{criteriaFailed=true;render();});
 $('agri-risk-method').textContent=DISEASE_RISK_METHOD;
 $('agri-risk-refresh').addEventListener('click',()=>load(true));
 const locationKey=()=>context?context.place.slice(1).join(','):'';
 const hourKey=()=>locationKey()+':'+Math.floor(Date.now()/3600000);
 async function load(force=false){
  if(!active||!context)return;const key=hourKey();
  if(!force&&key===attempted)return;
  attempted=key;controller?.abort();controller=new AbortController();const own=controller,version=++generation,[,lat,lon]=context.place;
  weather=null;error=false;loading=true;render();
  try{
   const saved=cache.get(key);
   if(saved&&!force)weather=saved;
   else{
    const signal=AbortSignal.any([own.signal,AbortSignal.timeout(25000)]);
    const [model,archive]=await Promise.allSettled([
     fetch(diseaseWeatherURL(lat,lon),{signal}).then(async r=>{if(!r.ok)throw Error();const data=await r.json();return validateDiseaseWeather(data,lat,lon);}),
     loadStationHistory(lat,lon,signal)
    ]);
    if(version!==generation||own.signal.aborted)return;
    const hourly=model.status==='fulfilled'?model.value:null,stationArchive=archive.status==='fulfilled'?archive.value:null;
    if(!hourly&&!stationArchive?.station)throw Error();
    weather={hourly,stationArchive,fetched:Date.now()};cache.set(key,weather);if(cache.size>8)cache.delete(cache.keys().next().value);
   }
  }catch{if(version!==generation||own.signal.aborted)return;error=true;}
  finally{if(version===generation&&!own.signal.aborted){loading=false;render();}}
 }
 function render(){
  if(!context)return;const root=$('agri-pests'),status=$('agri-risk-status'),[,lat,lon]=context.place;
  $('agri-risk-place').textContent=context.place[0]+' · '+lat.toFixed(3)+'°N, '+lon.toFixed(3)+'°E';
  $('agri-risk-refresh').disabled=loading;
  let hourly=weather?.hourly,fallback=false;
  if(!hourly&&!loading&&(error||weather)&&context.forecast){try{hourly=validateDiseaseWeather(context.forecast,lat,lon);fallback=true;}catch{}}
  const archive=weather?.stationArchive,station=archive?.station;
  const historySource=station?'Past = archived station observations from '+station.name+' ('+station.distance.toFixed(1)+' km); one latest sample per completed hour. '+(archive.basis||''):weather?.hourly?'Past = ECMWF model history, not station observations.':'Past 72-hour history unavailable.';
  const archiveNote=archive?.building?' Station archive building: '+archive.building.hours+'/72 valid completed hours at '+archive.building.name+'.':!station?' Station archive is not yet sufficiently complete nearby.':'';
  status.textContent=loading?'Loading the rolling past 72 hours and next 168 forecast hours for this location…':weather?historySource+' '+(hourly?'Future = ECMWF forecast.':'Future forecast unavailable.')+archiveNote+' Retrieved '+farmTime(weather.fetched)+'. All times PKT.':fallback?'72-hour history unavailable. Using the main ECMWF forecast for available future hours only; missing hours remain unknown. Retry to load the full window.':error?'Disease weather could not be loaded. No historical or future risk grade is inferred. Retry when the service is available.':'Open this tab to load location-specific history and forecast weather.';
  if(archive?.manifest.archive_url&&/^https:\/\/github\.com\/goharayub3909-stack\/Weather-APP\/releases\/tag\/station-history-\d{4}-\d{2}$/.test(archive.manifest.archive_url))$('station-archive-link').href=archive.manifest.archive_url;
  root.replaceChildren();
  if(!criteria){root.append(node('p','agri-unknown',criteriaFailed?'Crop criteria could not be loaded. Reload this page to retry.':'Loading disease and pest criteria…'));return;}
  const rules=criteria.rules.filter(r=>!context.crop||r.crop===context.crop.id);
  if(!rules.length){root.append(node('p','agri-unknown','No supplied disease / pest criteria for this crop. Choose a supported crop above; no model is invented.'));return;}
  for(const rule of rules){
   const historical=station?archive.hourly:weather?.hourly;
   const result=assessDisease(rule,hourly,Date.now(),historical||null),card=node('article','agri-research-card card');card.dataset.disease=rule.id;card.dataset.risk=result.outlook.level;
   const crop=rule.crop[0].toUpperCase()+rule.crop.slice(1);card.append(node('span','agri-crop-label',crop),node('h3','',rule.name));
   if(rule.image?.src?.startsWith('./disease-images/')&&/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(rule.image.page)){
    const figure=node('figure','disease-photo'),image=node('img');image.src=rule.image.src;image.alt=rule.image.caption;image.loading='lazy';image.width=360;image.height=160;
    const caption=node('figcaption'),credit=node('a','',rule.image.caption+' · '+rule.image.author+' · '+rule.image.license);credit.href=rule.image.page;credit.target='_blank';credit.rel='noopener noreferrer';caption.append(credit);figure.append(image,caption);card.append(figure);
   }else{const art=node('div','disease-art');art.setAttribute('aria-hidden','true');art.textContent=/aphid|borer|fly|worm|bug|hopper|mite|insect/i.test(rule.name)?'⌁':'❧';card.append(art);}
   if(rule.pathogen)card.append(node('p','agri-pathogen',rule.pathogen));
   card.append(node('p','disease-stage-context','Field stage: '+(STAGE_NAMES[context.stage]||'Unknown')+' · Source occurrence stage: '+(rule.raw.stage||'not specified')+'. Stage compatibility must be checked in the field.'));
   const comparisons=node('div','disease-comparisons');
   for(const [heading,screen]of [[station?'Past 72h · station history':'Past 72h · model history',result.past],['Next 7 days · forecast',result.outlook]]){
    const box=node('section','disease-period'),label=node('strong','disease-risk disease-risk--'+screen.level,loading&&screen.assessable?'Loading weather…':screen.label);
    box.append(node('h4','',heading),label,node('small','',span(screen.start,screen.end)),node('p','',`${screen.hits} matching hours · ${screen.available}/${screen.expected} valid hours · longest run ${screen.longest} h`));comparisons.append(box);
   }
   card.append(comparisons);
   const timing=node('details','disease-timing'),timingTitle=node('summary','','Daily risk & timing');timing.append(timingTitle);
   if(result.peak)timing.append(node('p','disease-peak','Peak forecast rolling 72h: '+span(result.peak.start,result.peak.end)+' · '+result.peak.hits+'/'+result.peak.available+' matching hours · '+result.peak.longest+' h longest run.'));
   timing.append(node('h4','disease-days-heading','Seven 24-hour forecast periods · PKT'));
   const days=node('div','disease-days');
   for(const [i,day]of result.days.entries()){
    const cell=node('div','disease-day disease-risk--'+day.level),date=new Date(day.start).toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',day:'numeric',month:'short'});
    cell.title=span(day.start,day.end)+` · ${day.hits} matching hours; ${day.available}/24 valid; longest run ${day.longest} h`;
    cell.append(node('strong','',i===0?'Next 24h':'Day '+(i+1)),node('span','',date),node('b','',loading&&day.assessable?'Loading':day.label.replace(' weather risk','').replace(' weather signal',' signal')),node('small','',day.hits+' match · '+day.available+'/24 h'));days.append(cell);
   }
   timing.append(days);card.append(timing);
   const details=node('details'),summary=node('summary','','Criteria & provenance');details.append(summary);
   for(const [label,value]of Object.entries(rule.raw))details.append(node('p','',label+': '+(value||'Not specified')));
   for(const issue of rule.issues)details.append(node('p','agri-review',issue));
   details.append(node('p','',rule.source.file+' · '+rule.source.location));
   card.append(details);root.append(card);
  }

 }
 return {
  show(){active=true;load();render();},
  update(next){const previous=locationKey();context=next;if(previous!==locationKey()){controller?.abort();generation++;weather=null;loading=false;error=false;attempted='';}if(active)load();render();}
 };
}
