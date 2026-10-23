// A whole-report fallback hierarchy. Missing fields in the selected report are
// deliberately NOT filled from a different station, METAR or forecast.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function distanceKm(lat,lon,p){const rad=Math.PI/180,a=Math.sin((p.lat-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(p.lat*rad)*Math.sin((p.lon-lon)*rad/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
export function chooseCurrentSource(lat,lon,stations,metars,now=Date.now()){
 function nearby(rows,kind,limit,maxAge){return (rows||[]).flatMap(p=>{const time=kind==='station'?Date.parse(p.observed_at):p.obsTime*1000,temp=kind==='station'?p.temperature:p.temp;if(!finite(p.lat)||!finite(p.lon)||!finite(temp)||temp< -90||temp>65||!finite(time)||now-time>maxAge||time-now>300000)return [];const distance=distanceKm(lat,lon,p);return distance<=limit?[{kind,report:p,time,distance,name:p.name||p.icaoId||'Weather station'}]:[];}).sort((a,b)=>a.distance-b.distance||b.time-a.time)[0];}
 return nearby(stations?.stations,'station',50,3*3600000)||nearby(metars?.stations,'metar',100,2*3600000)||{kind:'forecast',name:'ECMWF IFS',time:null,distance:null,report:null};
}
export function currentValue(source,key,forecastValue){
 if(source.kind==='forecast')return finite(forecastValue)?forecastValue:null;
 const p=source.report;
 if(source.kind==='station'){
  const keys={temperature_2m:'temperature',relative_humidity_2m:'humidity',dew_point_2m:'dew_point',wind_speed_10m:'wind_speed',wind_direction_10m:'wind_direction',wind_gusts_10m:'wind_gust_10min',shortwave_radiation:'solar_radiation',uv_index:'uv_index',visibility:'visibility',rain_daily:'rain_daily',rain_rate:'rain_rate'};
  return finite(p[keys[key]])?p[keys[key]]:null;
 }
 if(key==='relative_humidity_2m')return finite(p.temp)&&finite(p.dewp)?Math.min(100,Math.max(0,100*Math.exp(17.625*p.dewp/(243.04+p.dewp)-17.625*p.temp/(243.04+p.temp)))):null;
 const keys={temperature_2m:'temp',dew_point_2m:'dewp',wind_speed_10m:'wspd',wind_direction_10m:'wdir',wind_gusts_10m:'wgst',pressure_msl:'altim'},v=p[keys[key]];
 return finite(v)?key==='wind_speed_10m'||key==='wind_gusts_10m'?v*1.852:v:null;
}
export function currentCondition(source,forecastLabel){
 if(source.kind==='forecast')return forecastLabel;
 if(source.kind==='station')return 'Station observation';
 const p=source.report,wx=p.wxString||'';
 if(/TS/.test(wx))return 'Thunderstorm reported';if(/SN|SG/.test(wx))return 'Snow reported';if(/RA|DZ/.test(wx))return 'Rain reported';if(/FG|BR/.test(wx))return 'Fog / mist reported';
 const sky=(p.clouds||[]).map(c=>c.cover);if(sky.includes('OVC'))return 'Overcast reported';if(sky.includes('BKN'))return 'Broken cloud reported';if(sky.includes('SCT')||sky.includes('FEW'))return 'Clouds reported';if(sky.some(c=>['SKC','CLR','CAVOK'].includes(c)))return 'Clear sky reported';return 'Airport observation';
}
