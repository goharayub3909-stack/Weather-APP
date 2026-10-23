export const hourlyFields=['temperature_2m','apparent_temperature','relative_humidity_2m','dew_point_2m','precipitation','rain','snowfall','weather_code','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','pressure_msl','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m','shortwave_radiation','cape','showers','et0_fao_evapotranspiration'];
export const dailyFields=['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','sunrise','sunset','daylight_duration','et0_fao_evapotranspiration'];
export function forecastURL(lat,lon){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<23||lat>38||lon<60||lon>78)throw Error('Choose a location in Pakistan.');
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({latitude:lat,longitude:lon,models:'ecmwf_ifs025',hourly:hourlyFields.join(','),daily:dailyFields.join(','),timezone:'Asia/Karachi',forecast_days:7});
 return url;
}
export function weather(code){
 if(code===null||code===undefined)return ['Unavailable','—'];
 if(code===0)return ['Clear skies','☀'];if(code<=3)return [code===3?'Overcast':'Partly cloudy','☁'];
 if([45,48].includes(code))return ['Fog','≋'];if(code>=51&&code<=67)return ['Rain','☂'];
 if((code>=71&&code<=77)||[85,86].includes(code))return ['Snow','❄'];
 if([96,99].includes(code))return ['Thunderstorm with hail','⛈'];if(code>=80&&code<=82)return ['Rain showers','☂'];if(code>=95)return ['Thunderstorms','ϟ'];return ['Unavailable','—'];
}
export function hourIndex(times,now=new Date()){
 const stamp=now.toLocaleString('sv-SE',{timeZone:'Asia/Karachi'}).slice(0,13).replace(' ','T');
 return times.findIndex(t=>t.startsWith(stamp));
}
export const isNumber=v=>typeof v==='number'&&Number.isFinite(v);
export function aqiCategory(value){if(!isNumber(value))return 'Unavailable';return value<=50?'Good':value<=100?'Moderate':value<=150?'Unhealthy for sensitive groups':value<=200?'Unhealthy':value<=300?'Very unhealthy':'Hazardous';}
export function direction(degrees){return isNumber(degrees)?['N','NE','E','SE','S','SW','W','NW'][Math.round(degrees/45)%8]:'—';}
