// Explicit reflectance scaling matters for EVI / SAVI constants and Landsat's
// additive offset. Sentinel baseline >=04.00 introduced a -1000 DN BOA offset.
export const FIELD_INDICES={
 lst:{label:'LST · land surface temperature',range:[-10,60],breaks:[15,30,40],unit:'°C',description:'Satellite surface skin temperature at acquisition time, not 2 m air temperature. Landsat thermal information is natively coarser than its 30 m output grid.'},
 smi:{label:'SMI · relative thermal moisture proxy',range:[0,1],breaks:[.25,.5,.75],unit:'relative',description:'Relative thermal wetness proxy from user-specified dry / wet surface-temperature endmembers. Not measured volumetric soil moisture or an irrigation dose.'},
 ndvi:{label:'NDVI · vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Vegetation greenness; affected by crop stage, soil and clouds.'},
 ndre:{label:'NDRE · red-edge',range:[-1,1],breaks:[.1,.2,.35],description:'Red-edge vegetation response; a spectral indicator, not a measured nitrogen dose.'},
 evi:{label:'EVI · vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Enhanced vegetation index with blue-band atmospheric and soil adjustments.'},
 savi:{label:'SAVI · soil-adjusted vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Soil-adjusted vegetation index, using L = 0.5.'},
 evi2:{label:'EVI2 · 2-band enhanced vegetation',range:[-1,2],display:[0,0.8],breaks:[.2,.4,.6],description:'Two-band EVI (Jiang et al., 2008): EVI without the blue band. Stays sensitive in dense crops where NDVI flattens out and adjusts for soil background.'},
 msavi:{label:'MSAVI · modified soil-adjusted vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Self-adjusting soil-adjusted vegetation index (MSAVI2). Better than NDVI for sparse crops and young stands where bare soil shows through.'},
 nri:{label:'NRI · nitrogen reflectance',range:[-1,1],display:[-0.2,0.4],breaks:[0,.1,.2],description:'Nitrogen Reflectance Index (Filella et al.): (green − red) / (green + red). On a closed canopy it relates to leaf nitrogen status; unreliable on sparse or early-season cover. A spectral indicator, not a fertilizer dose.'},
 ndmi:{label:'NDMI · canopy moisture',range:[-1,1],breaks:[0,.2,.4],description:'Canopy moisture spectral contrast; not measured soil-water content.'},
 ndwi:{label:'NDWI · surface water',range:[-1,1],breaks:[-.2,0,.2],description:'Green/NIR water contrast (McFeeters). Highlights standing or irrigation water and waterlogging; a spectral indicator, not a water-depth measurement. For canopy moisture use NDMI.'}
 ,dswi:{label:'DSWI · disease-water stress',range:[0,10],display:[0.5,2.5],breaks:[.9,1.3,1.8],description:'Disease-Water Stress Index (Galvão et al., 2005): (NIR + green) / (SWIR + red). Lower values than the same crop earlier or elsewhere in the field suggest water or disease stress. Display zones are relative, not calibrated thresholds.'}
};
export const ZONE_COLORS=[[205,60,55,255],[242,153,48,255],[247,215,69,255],[39,139,59,255]];
export function indexColors(mode){return mode==='lst'?[[74,109,208,255],[76,184,148,255],[244,208,70,255],[218,75,49,255]]:mode==='ndwi'?[[176,140,92,255],[151,203,222,255],[66,146,214,255],[22,76,176,255]]:ZONE_COLORS;}
export function fieldColormap(mode){return FIELD_INDICES[mode]?Object.fromEntries(indexColors(mode).map((color,i)=>[i*85,color])):{};}
export function zoneExpression(mode,expression){const [a,b,c]=FIELD_INDICES[mode].breaks;return `where((${expression})<${a},0,where((${expression})<${b},85,where((${expression})<${c},170,255)))`;}
export function indexRecipe(sensor,mode,scene,calibration={}){
 if(!FIELD_INDICES[mode])return null;
 if(['lst','smi'].includes(mode)){
  if(sensor!=='landsat'&&sensor!=='modis-lst')return null;
  const asset=sensor==='landsat'?'lwir11':'LST_Day_1km';if(!scene.assets?.[asset])throw Error('Surface temperature is unavailable in this scene.');
  const metadata=scene.assets[asset]['raster:bands']?.[0],scale=Number.isFinite(metadata?.scale)?metadata.scale:sensor==='landsat'?.00341802:.02,offset=Number.isFinite(metadata?.offset)?metadata.offset:sensor==='landsat'?149:0;
  let expression=`(${asset}_b1*${scale}+(${offset})-273.15)`;
  if(mode==='smi'){const {wet,dry}=calibration;if(!Number.isFinite(wet)||!Number.isFinite(dry)||dry-wet<5||wet< -30||dry>80)throw Error('SMI needs locally calibrated wet and dry LST endmembers with at least 5°C separation.');expression=`where((${expression})<${wet},1,where((${expression})>${dry},0,(${dry}-(${expression}))/(${dry}-${wet})))`;}
  return {assets:[asset],expression,range:FIELD_INDICES[mode].range,resolution:sensor==='landsat'?'30 m output · native thermal 100 m (Landsat 8/9)':'1 km · daily daytime acquisition',note:'Temperature scale and Kelvin offset follow source metadata. '+(mode==='smi'?'SMI endmembers are supplied field assumptions, not a validated moisture retrieval.':'LST depends on surface, cloud, view time and emissivity; it is not canopy or soil-probe temperature.')};
 }
 if(sensor==='modis-lst')return null;
 if(sensor==='modis')return mode==='ndvi'?{assets:['250m_16_days_NDVI'],range:[-10000,10000],resolution:'250 m · 16-day composite',expression:null,note:'MOD13Q1 NDVI source scale = 0.0001.'}:null;
 if(sensor==='landsat'&&mode==='ndre')return null;
 const bands=sensor==='sentinel'?{nir:'B08',red:'B04',green:'B03',blue:'B02',swir:'B11',edgeNir:'B8A',edge:'B05'}:{nir:'nir08',red:'red',green:'green',blue:'blue',swir:'swir16'};
 const used=new Set(),physical=name=>{const asset=bands[name];if(!scene.assets?.[asset])throw Error('Required band unavailable: '+asset);used.add(asset);const metadata=scene.assets[asset]['raster:bands']?.[0],baseline=parseFloat(scene.properties?.['s2:processing_baseline']||'0');const scale=Number.isFinite(metadata?.scale)?metadata.scale:sensor==='sentinel'?.0001:.0000275,offset=Number.isFinite(metadata?.offset)?metadata.offset:sensor==='sentinel'?(baseline>=4?-.1:0):-.2;return `(${asset}_b1*${scale}+(${offset}))`;};
 let expression;
 if(mode==='ndre'){const n=physical('edgeNir'),r=physical('edge');expression=`(${n}-${r})/(${n}+${r})`;}
 else if(mode==='ndwi'){const g=physical('green'),n=physical('nir');expression=`(${g}-${n})/(${g}+${n})`;}
 else if(mode==='evi2'){const n=physical('nir'),r=physical('red');expression=`2.5*(${n}-${r})/(${n}+2.4*${r}+1)`;}
 else if(mode==='nri'){const g=physical('green'),r=physical('red');expression=`(${g}-${r})/(${g}+${r})`;}
 else if(mode==='dswi'){const n=physical('nir'),g=physical('green'),s=physical('swir'),r=physical('red');expression=`(${n}+${g})/(${s}+${r})`;}
 else{const n=physical('nir'),r=physical(mode==='ndmi'?'swir':'red');expression=mode==='evi'?`2.5*(${n}-${r})/(${n}+6*${r}-7.5*${physical('blue')}+1)`:mode==='msavi'?`(2*${n}+1-sqrt((2*${n}+1)*(2*${n}+1)-8*(${n}-${r})))/2`:mode==='savi'?`1.5*(${n}-${r})/(${n}+${r}+0.5)`:`(${n}-${r})/(${n}+${r})`;}
 return {assets:[...used],expression,range:FIELD_INDICES[mode].range,display:FIELD_INDICES[mode].display,resolution:sensor==='landsat'?'30 m':['ndre','ndmi','dswi'].includes(mode)?'20 m':'10 m',note:sensor==='sentinel'?'BOA reflectance: Sentinel processing-baseline offset and 0.0001 scale.':'Surface reflectance uses source scale and offset.'};
}

// False colour (colour infrared): NIR, red and green shown as red, green and blue.
export function falseColourRecipe(sensor,scene){
 const bands=sensor==='sentinel'?['B08','B04','B03']:sensor==='landsat'?['nir08','red','green']:null;
 if(!bands)return null;
 const baseline=parseFloat(scene.properties?.['s2:processing_baseline']||'0');
 const parts=bands.map(asset=>{if(!scene.assets?.[asset])throw Error('Required band unavailable: '+asset);const m=scene.assets[asset]['raster:bands']?.[0],scale=Number.isFinite(m?.scale)?m.scale:sensor==='sentinel'?.0001:.0000275,offset=Number.isFinite(m?.offset)?m.offset:sensor==='sentinel'?(baseline>=4?-.1:0):-.2;return `(${asset}_b1*${scale}+(${offset}))`;});
 return {assets:bands,expression:parts.join(';'),rescale:'0,0.5',colorFormula:'gamma RGB 1.5',resolution:sensor==='landsat'?'30 m':'10 m',note:'Near-infrared, red and green are shown as red, green and blue. Healthy vegetation looks red, bare soil tan and water dark.'};
}
export function indexMeaning(mode,value,stage='mixed'){
 if(!Number.isFinite(value))return 'No valid, quality-checked reading is available.';
 const early=['pre-sowing','sowing'].includes(stage);
 if(mode==='lst')return 'Surface temperature at satellite overpass. '+(value>=40?'A hot surface warrants a crop / soil moisture check; ':value<=2?'Cold surface conditions warrant checking the field; ':'')+'Compare with station air temperature at its own report time; these measure different surfaces and times.';
 if(mode==='smi')return (value<.25?'Near the supplied dry endmember. ':value>.75?'Near the supplied wet endmember. ':'Between the supplied dry and wet endmembers. ')+'This relative proxy does not measure root-zone water.';
 if(mode==='ndmi')return (value<0?'Low canopy-moisture contrast. ':'Positive canopy-moisture contrast. ')+'Crop cover, bare soil, variety and rainfall affect this signal; compare with station VPD and field moisture checks.';
 if(mode==='nri')return (value>.1?'Strong green-over-red response, typical of a leafy canopy. ':value<0?'Red reflects more than green, typical of bare soil or sparse cover. ':'Weak green-over-red response. ')+'On a closed canopy NRI relates to leaf nitrogen, but it cannot set a fertilizer rate and is unreliable on sparse cover.';
 if(mode==='dswi')return 'Lower values suggest water or disease stress compared with the same crop and stage earlier in the season. DSWI cannot separate drought from disease; scout the field to confirm.';
 if(mode==='ndwi')return value>0?'Water-like spectral response; check whether this is irrigation, standing water or another surface.':'No strong water-like response; this does not establish dry soil.';
 if(mode==='msavi')return (value<.2?'Little green vegetation after correcting for soil. ':value<.4?'Sparse or developing cover once soil is accounted for. ':value<.6?'Moderate green cover once soil is accounted for. ':'Dense green cover once soil is accounted for. ')+(early?'Low cover may be expected before emergence. ':'Compare with the same crop stage and previous clear passes. ')+'Disease and yield are not diagnosed from this reading.';
 if(mode==='ndre')return (value>.35?'Stronger red-edge vegetation response. ':'Lower red-edge vegetation response. ')+'Compare similar crop stages; this cannot identify a nitrogen deficiency or set a fertilizer rate.';
 return (value<.2?'Little green vegetation signal. ':value<.4?'Sparse or developing green vegetation. ':value<.6?'Moderate green vegetation signal. ':'Strong green vegetation signal. ')+(early?'Low cover may be expected before emergence; it is not automatically crop damage. ':'Compare with the same crop stage and previous clear acquisitions. ')+'Disease and yield are not diagnosed from this reading.';
}
