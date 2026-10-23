const finite=v=>typeof v==='number'&&Number.isFinite(v),number=(v,min,max)=>finite(v)&&v>=min&&v<=max?v:null;
export function validateSoilFeed(payload,now=Date.now()){
 if(payload?.schema_version!==1||!Array.isArray(payload.devices)||payload.devices.length>5000)throw Error('Unsupported soil sensor feed');
 const ids=new Set(),devices=[];
 for(const d of payload.devices){
  if(typeof d.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(d.id)||ids.has(d.id)||typeof d.field_id!=='string'||!d.field_id.trim())continue;
  ids.add(d.id);const r=d.reading||{},time=typeof r.observed_at==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(r.observed_at)?Date.parse(r.observed_at):NaN;
  const quality=['valid','suspect','invalid'].includes(r.quality)?r.quality:'unknown',age=now-time;
  const reading={observed_at:Number.isFinite(time)?new Date(time).toISOString():null,quality,temperature_c:number(r.temperature_c,-30,80),temperature_depth_cm:number(r.temperature_depth_cm,0,300),moisture_vwc_percent:number(r.moisture_vwc_percent,0,70),moisture_depth_cm:number(r.moisture_depth_cm,0,300),root_zone_moisture_vwc_percent:number(r.root_zone_moisture_vwc_percent,0,70),root_zone_depth_cm:number(r.root_zone_depth_cm,1,300),battery_percent:number(r.battery_percent,0,100)};
  devices.push({id:d.id,field_id:d.field_id.slice(0,100),name:String(d.name||d.id).slice(0,120),latitude:number(d.latitude,23,38),longitude:number(d.longitude,60,78),reading,usable:quality==='valid'&&finite(age)&&age>=-300000&&age<=24*3600000,temperatureFresh:quality==='valid'&&finite(age)&&age>=-300000&&age<=12*3600000});
 }
 return {schema_version:1,status:devices.length?'connected':'not_configured',devices};
}
export class SoilSensorClient extends EventTarget{
 constructor(configURL=new URL('./sensor-data/config.json',import.meta.url)){super();this.configURL=new URL(configURL);this.devices=[];this.controller=null;}
 async refresh(){
  this.controller?.abort();this.controller=new AbortController();const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]);
  const response=await fetch(this.configURL,{signal,cache:'no-store'});if(!response.ok)throw Error('Sensor configuration unavailable');const config=await response.json(),url=new URL(config.feed,this.configURL);
  if(url.origin!==this.configURL.origin||!['http:','https:'].includes(url.protocol))throw Error('Sensor feed must be served by this website');
  const r=await fetch(url,{signal,cache:'no-store'});if(!r.ok)throw Error('Sensor feed unavailable');const data=validateSoilFeed(await r.json());this.devices=data.devices;this.dispatchEvent(new CustomEvent('readings',{detail:data}));return data;
 }
 stop(){this.controller?.abort();clearInterval(this.interval);}
 start(){clearInterval(this.interval);this.interval=setInterval(()=>{if(!document.hidden)this.refresh().catch(()=>{});},300000);}
}
export function initSoilSensors(onReading){
 const $=id=>document.getElementById(id),client=new SoilSensorClient();let selected='',attached=false;
 function report(){
  const sensorMode=$('soil-reading-source').value==='sensor',device=client.devices.find(d=>d.id===selected);
  $('soil-device').disabled=!sensorMode;
  if(!sensorMode){$('soil-sensor-status').textContent='Manual instrument readings. Include PKT time and representative depth.';return;}
  if(!device){onReading(null);$('soil-sensor-status').textContent=client.devices.length?'Select the device assigned to this actual field. No device is selected automatically by proximity.':'Sensor module ready; no devices are configured. A future vendor bridge must supply the documented JSON feed.';return;}
  const r=device.reading;
  $('soil-sensor-status').textContent=device.name+' · field '+device.field_id+' · '+(r.observed_at?new Date(r.observed_at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})+' PKT':'observation time missing')+' · quality '+r.quality+'. Temperature '+(r.temperature_c??'—')+'°C at '+(r.temperature_depth_cm??'—')+' cm; point moisture '+(r.moisture_vwc_percent??'—')+'% VWC at '+(r.moisture_depth_cm??'—')+' cm. '+(!device.usable?'Reading stale, invalid or time unverified; not used.':r.root_zone_moisture_vwc_percent===null?'Point moisture, if supplied, is displayed only; no root-zone moisture estimate is inferred.':'Root-zone profile supplied by the sensor bridge.');
  onReading(device);attached=true;
 }
 client.addEventListener('readings',()=>{const menu=$('soil-device');menu.replaceChildren(new Option('Select a configured device',''));for(const d of client.devices)menu.append(new Option(d.name+' · '+d.field_id,d.id));menu.value=client.devices.some(d=>d.id===selected)?selected:'';selected=menu.value;report();});
 $('soil-device').addEventListener('change',()=>{selected=$('soil-device').value;report();});
 $('soil-reading-source').addEventListener('change',()=>{if($('soil-reading-source').value==='sensor'){client.start();client.refresh().catch(()=>{$('soil-sensor-status').textContent='Sensor feed unavailable. No readings are assumed.';onReading(null);});}else{client.stop();if(attached)onReading(null);attached=false;}report();});
 $('soil-sensor-refresh').addEventListener('click',()=>client.refresh().catch(()=>{$('soil-sensor-status').textContent='Sensor feed unavailable. No readings are assumed.';if($('soil-reading-source').value==='sensor')onReading(null);}));
 report();return {reset(){selected='';client.stop();$('soil-reading-source').value='manual';$('soil-device').value='';attached=false;report();}};
}
