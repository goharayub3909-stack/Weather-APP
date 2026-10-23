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
export function ecmwfDailyCondition({amount,code,hourly,date}){
 const rows=(hourly?.time||[]).flatMap((t,i)=>t.startsWith(date)?[i]:[]);
 const explicit=[95,96,99].includes(code)||rows.some(i=>[95,96,99].includes(hourly.weather_code?.[i]));
 const convection=rows.some(i=>finite(hourly.cape?.[i])&&hourly.cape[i]>=500&&finite(hourly.showers?.[i])&&hourly.showers[i]>=.2);
 if(!explicit&&!convection)return {...dailyCondition({amount,code}),thunder:false,reason:''};
 const prefix=finite(amount)&&amount>=.2&&amount<=1?'Isolated ':finite(amount)&&amount>=2&&amount<=10?'Scattered ':'';
 return {icon:'storm',label:prefix+(finite(amount)&&amount>=.2?'thunderstorm / rain chance':'thunderstorm chance'),band:rainBand(amount),thunder:true,reason:explicit?'ECMWF thunderstorm weather code':'ECMWF simultaneous instability and convective-rain screen · possibility only'};
}
