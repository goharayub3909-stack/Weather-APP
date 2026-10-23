// Supplemental-model diagnostics. A physical ingredient screen is not a hail
// probability and does not establish storm occurrence or geographic coverage.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const supplementalFields=['precipitation_probability','visibility','uv_index','weather_code','cape','convective_inhibition','freezing_level_height','temperature_500hPa','wind_speed_500hPa','wind_direction_500hPa','wind_speed_10m','wind_direction_10m','showers'];
export function windDifference(lowSpeed,lowDirection,highSpeed,highDirection){
 if(![lowSpeed,lowDirection,highSpeed,highDirection].every(finite))return null;
 const component=(speed,direction)=>[-speed/3.6*Math.sin(direction*Math.PI/180),-speed/3.6*Math.cos(direction*Math.PI/180)];
 const low=component(lowSpeed,lowDirection),high=component(highSpeed,highDirection);return Math.hypot(high[0]-low[0],high[1]-low[1]);
}
export function stormScreen(hourly,index){
 const at=key=>hourly?.[key]?.[index],code=at('weather_code'),cape=at('cape'),cin=at('convective_inhibition'),freezing=at('freezing_level_height'),cold=at('temperature_500hPa'),showers=at('showers');
 const shear=windDifference(at('wind_speed_10m'),at('wind_direction_10m'),at('wind_speed_500hPa'),at('wind_direction_500hPa'));
 const available=[cape,cin,freezing,cold,shear,showers].every(finite);
 const explicitHail=[96,99].includes(code),thunder=[95,96,99].includes(code);
 const ingredients=available&&cape>=1000&&Math.abs(cin)<=200&&shear>=15&&cold<=-10&&freezing<=4500&&(showers>=.1||thunder);
 return {cape,cin,freezing,cold,shear,explicitHail,thunder,ingredients,available,label:explicitHail?'Model hail signal':ingredients?'Hail ingredients present':available?'No strong hail signal':'Unavailable',note:'Ingredient screen only; no hail probability is calculated. Requires CAPE, inhibition, wind difference, cold mid-level air, freezing height and convection.'};
}
export function dailyStorm(hourly,date){
 const indices=(hourly?.time||[]).flatMap((stamp,i)=>stamp.startsWith(date)?[i]:[]);const results=indices.map(i=>stormScreen(hourly,i));
 return {explicitHail:results.some(r=>r.explicitHail),thunder:results.some(r=>r.thunder),ingredients:results.some(r=>r.ingredients),capeMax:results.some(r=>finite(r.cape))?Math.max(...results.map(r=>finite(r.cape)?r.cape:-Infinity)):null};
}
export function rainBand(amount){
 if(!finite(amount))return {label:'Rain total unavailable',rain:false};
 if(amount<.2)return {label:'Below 0.2 mm',rain:false};
 if(amount<=1)return {label:'Isolated chance',rain:true};
 if(amount<2)return {label:'Rain possible',rain:true};
 if(amount<=10)return {label:'Scattered chance',rain:true};
 return {label:'Rain forecast',rain:true};
}
export function dailyCondition({amount,code,storm={}}){
 const band=rainBand(amount);
 if([96,99].includes(code)||storm.explicitHail)return {icon:'hail',label:'Thunderstorm with hail',band};
 if(storm.ingredients)return {icon:'hail',label:'Hail ingredients · screening',band};
 if(code===95||storm.thunder)return {icon:'storm',label:'Thunderstorm signal',band};
 if([71,73,75,77,85,86].includes(code))return {icon:'snow',label:'Snow',band};
 if(band.rain)return {icon:'rain',label:band.label,band};
 if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return {icon:'rain',label:'Rain signal',band};
 if([45,48].includes(code))return {icon:'fog',label:'Fog',band};
 if(code===0)return {icon:'sun',label:'Clear skies',band};
 if([1,2,3].includes(code))return {icon:code===3?'cloud':'partly',label:code===3?'Overcast':'Partly cloudy',band};
 return {icon:'cloud',label:'Condition unavailable',band};
}

// ECMWF-only qualitative thunder wording. A simultaneous convection screen is
// a possibility signal, never a calibrated thunderstorm probability.
export function ecmwfDailyCondition({amount,code,hourly,date,backend=null,now=Date.now()}){
 const local=thunderEvidence(hourly,date),remote=backend&&(backend.weatherThunder||(backend.lightningThunder&&Number.isFinite(Date.parse(backend.lightning_valid_until))&&Date.parse(backend.lightning_valid_until)>=now)),explicit=[95,96,99].includes(code)||local.explicit;
 const snow=[71,73,75,77,85,86].includes(code);
 if([96,99].includes(code)||local.hail||backend?.hail)return {icon:'hail',label:'Thunderstorms with hail possible',band:rainBand(amount),thunder:true,reason:'Explicit ECMWF hail weather code'};
 if(snow&&!explicit)return {icon:'snow',label:[85,86].includes(code)?'Snow showers':'Snow',band:rainBand(amount),thunder:false,reason:'ECMWF snow weather code'};
 if([56,57,66,67].includes(code)&&!explicit)return {icon:'rain',label:'Freezing rain possible',band:rainBand(amount),thunder:false,reason:'ECMWF freezing precipitation weather code'};
 if(!explicit&&!local.weatherThunder&&!remote){const base=dailyCondition({amount,code});if(base.band.rain)base.label=amount<=1?'Isolated rain chances':amount<=10&&amount>=2?'Scattered rain chances':amount<2?'Rain chances':'Rain expected';return {...base,thunder:false,reason:''};}
 const prefix=finite(amount)&&amount>=.2&&amount<=1?'Isolated ':finite(amount)&&amount>=2&&amount<=10?'Scattered ':'';
 return {icon:'storm',label:prefix+'thunderstorm chances',band:rainBand(amount),thunder:true,reason:remote?'Backend · '+backend.reason:local.reason};
}

// K index uses actual model temperature / humidity at 850, 700 and 500 hPa.
// Below-terrain 850 hPa points cannot contribute a sounding diagnostic.
export function kIndex(hourly,i){
 const get=k=>hourly?.[k]?.[i],t850=get('temperature_850hPa'),t700=get('temperature_700hPa'),t500=get('temperature_500hPa'),rh850=get('relative_humidity_850hPa'),rh700=get('relative_humidity_700hPa'),surface=get('surface_pressure');
 if(![t850,t700,t500,rh850,rh700,surface].every(finite)||surface<850||rh850<=0||rh850>100||rh700<=0||rh700>100)return null;
 const dew=(t,rh)=>{const a=Math.log(rh/100)+17.625*t/(243.04+t);return 243.04*a/(17.625-a);};
 return (t850-t500)+dew(t850,rh850)-(t700-dew(t700,rh700));
}
export function thunderEvidence(hourly,date){
 const rows=(hourly?.time||[]).flatMap((t,i)=>t.startsWith(date)?[i]:[]);
 let explicit=false,hail=false,ingredients=false,maximumK=null,valid=0;
 for(const i of rows){const code=hourly.weather_code?.[i],cape=hourly.cape?.[i],showers=hourly.showers?.[i],k=kIndex(hourly,i);if(finite(code))valid++;if([95,96,99].includes(code))explicit=true;if([96,99].includes(code))hail=true;if(k!==null)maximumK=maximumK===null?k:Math.max(maximumK,k);
  if(finite(cape)&&finite(showers)&&((cape>=500&&showers>=.2&&(k===null||k>=20))||(cape>=200&&showers>=.5&&k!==null&&k>=30)))ingredients=true;
 }
 return {weatherThunder:explicit||ingredients,explicit,hail,ingredients,kIndexMax:maximumK,validHours:valid,reason:explicit?'ECMWF thunderstorm weather code':ingredients?'ECMWF simultaneous CAPE / convective rain, with K-index moisture screening where above terrain':'No supported convective trigger'};
}
