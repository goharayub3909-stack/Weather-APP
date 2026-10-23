// All weather screens are source-labelled. No weather-only yield forecast,
// inferred leaf-wetness duration, or insurance payout probability is produced.
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const BASE_TEMPERATURES={wheat:0,rice:10,cotton:15.6,sugarcane:10,maize:10,potato:4.4,chickpea:0,mustard:5,sunflower:6,groundnut:10,barley:0,onion:4,tomato:10,berseem:0,apple:4.4,citrus:12.8,mango:10,dates:10};
export function vaporPressureDeficit(t,rh){return finite(t)&&t>=-40&&t<=60&&finite(rh)&&rh>=0&&rh<=100?.6108*Math.exp(17.27*t/(t+237.3))*(1-rh/100):null;}
export function deltaT(t,rh,wetBulb=null){
 if(!finite(t))return {value:null,basis:'Unavailable'};
 if(finite(wetBulb)&&wetBulb<=t&&wetBulb>=-90)return {value:t-wetBulb,basis:'Dry minus supplied wet-bulb temperature'};
 if(!finite(rh)||rh<0||rh>100)return {value:null,basis:'Unavailable'};
 if(rh===100)return {value:0,basis:'Saturated air: dry and wet bulb coincide'};
 if(t< -20||t>50||rh<5||rh>99)return {value:null,basis:'Outside the Stull approximation range'};
 const tw=t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035;
 return {value:Math.max(0,t-tw),basis:'Estimated wet bulb · Stull approximation, standard-pressure assumption'};
}
export function growingDegreeDay(low,high,base,cap=35){if(![low,high,base,cap].every(finite)||low>high||base>=cap)return null;return Math.max(0,(Math.max(base,Math.min(cap,low))+Math.max(base,Math.min(cap,high)))/2-base);}
export function chillHours(values){const valid=values.filter(finite);return {hours:valid.filter(v=>v>=0&&v<=7.2).length,coverage:valid.length,total:values.length};}
export function total(values){return values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):null;}
export function irrigationPlan(days,{kc,reserve,deficit,efficiency,trigger=.5}){
 if(![kc,reserve,deficit,efficiency].every(finite)||kc<=0||kc>2||reserve<=0||deficit<0||deficit>reserve||efficiency<=0||efficiency>100)return null;
 let balance=deficit,unknown=false;return days.map(d=>{if(!finite(d.et0)||!finite(d.rain)){unknown=true;return {...d,unknown:true};}if(unknown)return {...d,unknown:true};const etc=d.et0*kc,effectiveRain=d.rain*.7;balance=Math.max(0,Math.min(reserve,balance+etc-effectiveRain));const before=balance,net=balance>=reserve*trigger?balance:0,gross=net/(efficiency/100);if(net)balance=0;return {...d,etc,effectiveRain,deficit:before,net,gross,unknown:false};});
}
function match(rule,t,rh){if(!rule.temperature||!rule.humidity||!finite(t)||!finite(rh))return null;const [a,b]=rule.temperature,[c,d]=rule.humidity;return t>=a&&t<=b&&(rule.humidityStrict&&c>0?rh>c:rh>=c)&&(rule.humidityStrict&&d<100?rh<d:rh<=d);}
export function researchScreen(rule,hourly,nowReading=null){
 const n=hourly?.time?.length||0;let hits=0,available=0,longest=0,run=0,previous=null;
 for(let i=0;i<n;i++){const test=match(rule,hourly.temperature_2m?.[i],hourly.relative_humidity_2m?.[i]);if(test!==null)available++;const stamp=Date.parse(hourly.time[i]+(/Z$|[+-]\d\d:\d\d$/.test(hourly.time[i])?'':'+05:00'));if(previous!==null&&stamp-previous!==3600000)run=0;previous=stamp;if(test){hits++;run++;longest=Math.max(longest,run);}else run=0;}
 return {now:nowReading?match(rule,nowReading.temperature,nowReading.humidity):null,hits,available,longest,assessable:Boolean(rule.temperature&&rule.humidity),note:'Temperature / RH favourability only. Leaf wetness, exposure duration, crop stage and pathogen presence remain unverified.'};
}
export function fieldAreaHa(points){if(points.length<3)return null;const rad=Math.PI/180,R=6371008.8;let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=(q[1]-p[1])*rad*(2+Math.sin(p[0]*rad)+Math.sin(q[0]*rad));}return Math.abs(a)*R*R/20000;}
