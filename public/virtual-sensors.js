// Independent implementations of public weather / soil relationships. These
// are not a METOS connection, licensed FieldClimate model or field calibration.
import {finite} from './agri-models.js';
export function dewPoint(t,rh){
 if(!finite(t)||!finite(rh)||t< -40||t>60||rh<=0||rh>100)return null;
 const a=17.27,b=237.3,gamma=Math.log(rh/100)+a*t/(b+t);return b*gamma/(a-gamma);
}
const aliases={'Air temperature':'temperature','Humidity':'humidity','Relative humidity':'humidity','Daily rainfall':'daily_rain','Atmospheric demand':'vpd','VPD':'vpd','Delta T':'delta_t','Dew point':'dew_point','Wet-bulb temperature':'wet_bulb','Growing degree days':'gdd','Chilling hours':'chill','Reference ET₀':'et0','Estimated ETc':'etc','Next 24h rain':'rain24','High / low · 24h':'highlow','Peak gust · 24h':'gust','Valid weather hours':'coverage'};
export function assessMetric(name,value,context={}){
 const key=aliases[name]||name,{stage='mixed',crop,profile='outdoor',temperature,dewpoint,high,low,expected}=context;
 const result=(level,label,reason)=>({level,label,reason});
 if(!finite(value))return result('unknown','Unavailable','No valid value is available. Missing data is never treated as a good or low-risk result.');
 const heat=crop?.cool&&stage==='flowering'?30:35;
 if(key==='temperature')return value<=0?result('alert','Freezing air',value+'°C is at or below freezing; canopy and soil temperatures can differ.'):value<=2?result('watch','Frost watch','Air temperature is within the ≤2°C frost-watch screen; this does not measure actual canopy frost.'):value>=heat?result('alert','Heat watch',value+'°C meets the '+heat+'°C planning trigger for the selected context. Check crop stage and field conditions.'):result('good','No heat / frost trigger','This air reading is between the current frost and heat planning thresholds. It does not establish that every condition is favourable.');
 if(key==='humidity')return value>95?result('watch','Very humid','Air is close to saturation. Check condensation and scouting conditions; actual leaf wetness and disease are not established.'):value>=85?result('watch','High humidity','Humid air may support condensation or disease-favourable periods when other conditions also match.'):value<30?result('watch','Dry air','Low relative humidity can increase drying and droplet evaporation. Check VPD, crop stage and soil moisture.'):result('good','Moderate humidity','The reading is within the app’s broad 30–85% humidity display band. This is not a crop-specific optimum.');
 if(key==='vpd'){
  const ranges={'nursery-young':[.4,.8],'nursery-established':[.8,1.2]},range=ranges[profile];
  if(range)return result(value<range[0]||value>range[1]?'watch':'good',value<range[0]?'Below nursery range':value>range[1]?'Above nursery range':'Within nursery range',value.toFixed(2)+' kPa compared with the selected '+range.join('–')+' kPa METOS nursery reference. These targets are for that nursery context, not all open-field crops.');
  return value<.4?result('watch','Low drying demand','Low air VPD means limited atmospheric demand; condensation can be more likely near saturation. This does not confirm leaf wetness.'):value>=2?result('watch','High drying demand','Higher atmospheric demand can increase water loss. Check the crop and representative soil moisture before changing irrigation. No standing-crop water recommendation is issued before sowing.'):result('info','Moderate drying demand','This is an atmospheric-demand description, not a universal crop optimum. Select an explicit nursery profile only if it applies to your plants.');
 }
 if(key==='delta_t')return value>=2&&value<=8?result('good','Within spray-gap range',value.toFixed(1)+'°C is within the 2–8°C Delta T reference. Wind, gusts, temperature, rain and the product label must also qualify.'):value>10?result('alert','Too high for spray screen','Delta T exceeds 10°C: droplet evaporation is a concern. Review on-site readings and the product label.'):result('watch',value<2?'Gap too low':'Above preferred gap',value<2?'A gap below 2°C can accompany high humidity, dew or long droplet survival. Avoid very humid or inversion conditions.':'A gap above 8°C is outside the preferred 2–8°C range. Recheck conditions before spraying.');
 if(key==='dew_point'){const gap=finite(temperature)?temperature-value:null;return gap!==null&&gap<=2?result('watch','Near condensation','Air is only '+gap.toFixed(1)+'°C above its dew point. Surface cooling may cause condensation, but leaf wetness is not measured.'):result('info','Air above dew point','Dew point describes moisture and possible condensation. It is not independently a good/bad crop score or a thunderstorm forecast.');}
 if(key==='wet_bulb')return value<=0?result('watch','Freezing wet-bulb screen','Evaporative cooling could approach freezing. Check actual surface temperatures and the forecast; this is not a confirmed frost event.'):result('info','Above freezing wet bulb','Wet bulb describes evaporative cooling. A value above 0°C does not by itself rule out overnight ground frost.');
 if(key==='daily_rain'||key==='rain24')return value>=20?result('watch','Heavier rain amount','At least 20 mm is in this reporting / forecast period. Check drainage and field condition; station totals do not measure infiltration.'):value>=.2&&stage==='harvest'?result('watch','Rain during harvest stage','Rain may affect drying or picking. Verify maturity and actual crop wetness before harvesting.'):result('info',value===0?'Dry period':value<.2?'Trace amount':'Rain in period','Interpret the displayed period and source. Rain is not automatically beneficial or harmful, and does not directly determine an irrigation dose.');
 if(key==='gust')return value>=35?result('watch','Strong gust watch','The gust reaches the ≥35 km/h field-planning screen. Secure covers and assess operations.'):result('good','Below gust-watch screen','Below the general gust watch; spraying uses stricter wind and gust limits.');
 if(key==='highlow')return finite(low)&&low<=2?result('watch','Cold period possible','The next-24-hour low reaches the frost-watch air threshold.'):finite(high)&&high>=heat?result('watch','Hot period possible','The next-24-hour high reaches the current heat planning threshold.'):result('good','No heat / frost trigger','No air-temperature planning threshold is triggered in the available next-24-hour values.');
 if(key==='coverage')return result(value===72?'good':'watch',value+'/72 complete hours',value===72?'All core weather fields are present for 72 model hours; completeness is not forecast accuracy.':'Some model-hour core fields are absent. Unknown hours cannot establish a favourable operation window.');
 if(key==='gdd')return result('info','Thermal progress',value+' °C·days is future warmth above the selected base, not a crop-health score or an observed development stage.');
 if(key==='chill')return result('info','Chill accumulation',value+' forecast hours fall in 0–7.2°C. A variety-specific requirement and historical exposure are needed to judge adequacy.');
 if(key==='et0'||key==='etc')return result('info','Water-demand estimate','Higher values mean greater estimated water use / atmospheric demand, not automatically poor crop health or an irrigation dose. Compare rainfall, root-zone moisture, crop stage and Kc.');
 if(key==='ndvi'||key==='evi'||key==='evi2'||key==='savi'||key==='msavi')return value<.2?result(['pre-sowing','sowing'].includes(stage)?'info':'watch','Low green-cover signal','Low vegetation cover may be normal before emergence or after harvest. Check crop stage before interpreting it as a weaker crop.'):result('good',value>=.6?'Strong green-cover signal':value>=.4?'Moderate green-cover signal':'Developing green cover','A vegetation indicator, not a confirmed productivity, disease or yield measurement. Compare clear images and field observations.');
 if(key==='ndre')return result('info',value>=.35?'Stronger red-edge signal':'Lower red-edge signal','Compare crop stages and field zones. This reading cannot diagnose a nutrient deficiency.');
 if(key==='ndmi')return result(value<0?'watch':'info',value<0?'Low moisture contrast':'Positive moisture contrast','Canopy / soil cover affects this spectral contrast. It is not root-zone moisture and cannot set an irrigation dose.');
 if(key==='ndwi')return result('info',value>0?'Water-like response':'No strong water response','A surface spectral signal, not measured water depth or an assessment of soil water available to roots.');
 if(key==='lst')return result(value<=2||value>=40?'watch':'info',value<=2?'Cold surface':value>=40?'Hot surface':'Overpass surface reading','Surface temperature applies to the satellite acquisition time. Compare crop cover and current station conditions at their own observation times.');
 if(key==='smi')return result(value<.25?'watch':'info',value<.25?'Near dry endmember':value>.75?'Near wet endmember':'Between endmembers','Relative to your supplied thermal calibration; not a measured root-zone water content or a crop-specific optimum.');
 return result('info','Context needed','A crop, stage, history or calibrated field reference is needed before calling this value favourable or unfavourable.');
}
export function applyAssessment(card,assessment){
 let badge=card.querySelector(':scope > .metric-state');if(!badge){badge=document.createElement('span');badge.className='metric-state';const value=card.querySelector(':scope > strong');if(value)value.after(badge);else card.append(badge);}
 badge.dataset.level=assessment.level;badge.textContent=assessment.label;badge.title=assessment.reason;badge.setAttribute('aria-label','Interpretation: '+assessment.label);card.dataset.assessmentReason=assessment.reason;
}
// Describe only the selected fresh report. Do not turn rainfall-only devices
// into complete stations or assume that a missing radiation sensor exists.
export function reportCapabilities(source){
 if(!source||source.kind==='forecast')return {kind:'unavailable',measured:[],derived:[],summary:'No fresh observed report selected. Calculated observation indices are unavailable; model forecasts remain separate.'};
 const p=source.report||{},measured=[],derived=[];
 const valid=(key,min,max)=>finite(p[key])&&p[key]>=min&&p[key]<=max;
 const airport=source.kind==='metar',t=valid(airport?'temp':'temperature',-90,65),rh=airport?false:valid('humidity',0,100),dew=valid(airport?'dewp':'dew_point',-100,65),humidity=rh||(airport&&t&&dew);
 if(t)measured.push('air temperature');if(rh)measured.push('relative humidity');if(dew)measured.push('dew point');
 if(valid(airport?'wspd':'wind_speed',0,400))measured.push('wind');
 if(!airport&&(valid('rain_daily',0,3000)||valid('rain_rate',0,1000)))measured.push('rainfall');
 if(!airport&&valid('solar_radiation',0,1800))measured.push('solar radiation');if(!airport&&valid('uv_index',0,30))measured.push('UV index');
 if(airport&&humidity)derived.push('relative humidity from airport temperature / dew point');
 if(t&&humidity)derived.push('air VPD','estimated Delta T');if(t&&humidity&&!dew)derived.push('dew point');
 const kind=measured.length===1&&measured[0]==='rainfall'?'rainfall-only':'weather';
 return {kind,measured,derived,summary:(kind==='rainfall-only'?'Rainfall-only report. ':'Selected report inputs: ')+(measured.join(', ')||'no usable fields')+'. '+(derived.length?'Calculated where formula limits permit: '+derived.join(', ')+'. ':'No temperature / humidity pair for virtual moisture indices. ')+'Soil moisture, soil temperature and leaf wetness require their own field instruments; no readings are inferred from this report.'};
}
