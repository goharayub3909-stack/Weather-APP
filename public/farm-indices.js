// Explicit reflectance scaling matters for EVI / SAVI constants and Landsat's
// additive offset. Sentinel baseline >=04.00 introduced a -1000 DN BOA offset.
export const FIELD_INDICES={
 ndvi:{label:'NDVI · vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Vegetation greenness; affected by crop stage, soil and clouds.'},
 ndre:{label:'NDRE · red-edge',range:[-1,1],breaks:[.1,.2,.35],description:'Red-edge vegetation response; a spectral indicator, not a measured nitrogen dose.'},
 evi:{label:'EVI · vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Enhanced vegetation index with blue-band atmospheric and soil adjustments.'},
 savi:{label:'SAVI · soil-adjusted vegetation',range:[-1,1],breaks:[.2,.4,.6],description:'Soil-adjusted vegetation index, using L = 0.5.'},
 ndmi:{label:'NDMI · canopy moisture',range:[-1,1],breaks:[0,.2,.4],description:'Canopy moisture spectral contrast; not measured soil-water content.'},
 ndwi:{label:'NDWI · surface water',range:[-1,1],breaks:[-.2,0,.2],description:'Green/NIR water contrast; a spectral indicator, not a water-depth measurement.'}
};
export const ZONE_COLORS=[[205,60,55,255],[242,153,48,255],[247,215,69,255],[39,139,59,255]];
export function fieldColormap(mode){const index=FIELD_INDICES[mode],result={};if(!index)return result;for(let i=0;i<256;i++){const value=index.range[0]+i/255*(index.range[1]-index.range[0]);result[i]=ZONE_COLORS[index.breaks.filter(c=>value>=c).length];}return result;}
export function indexRecipe(sensor,mode,scene){
 if(!FIELD_INDICES[mode])return null;
 if(sensor==='modis')return mode==='ndvi'?{assets:['250m_16_days_NDVI'],range:[-10000,10000],resolution:'250 m · 16-day composite',expression:null,note:'MOD13Q1 NDVI source scale = 0.0001.'}:null;
 if(sensor==='landsat'&&mode==='ndre')return null;
 const bands=sensor==='sentinel'?{nir:'B08',red:'B04',green:'B03',blue:'B02',swir:'B11',edgeNir:'B8A',edge:'B05'}:{nir:'nir08',red:'red',green:'green',blue:'blue',swir:'swir16'};
 const used=new Set(),physical=name=>{const asset=bands[name];if(!scene.assets?.[asset])throw Error('Required band unavailable: '+asset);used.add(asset);const metadata=scene.assets[asset]['raster:bands']?.[0],baseline=parseFloat(scene.properties?.['s2:processing_baseline']||'0');const scale=Number.isFinite(metadata?.scale)?metadata.scale:sensor==='sentinel'?.0001:.0000275,offset=Number.isFinite(metadata?.offset)?metadata.offset:sensor==='sentinel'?(baseline>=4?-.1:0):-.2;return `(${asset}_b1*${scale}+(${offset}))`;};
 let expression;
 if(mode==='ndre'){const n=physical('edgeNir'),r=physical('edge');expression=`(${n}-${r})/(${n}+${r})`;}
 else if(mode==='ndwi'){const g=physical('green'),n=physical('nir');expression=`(${g}-${n})/(${g}+${n})`;}
 else{const n=physical('nir'),r=physical(mode==='ndmi'?'swir':'red');expression=mode==='evi'?`2.5*(${n}-${r})/(${n}+6*${r}-7.5*${physical('blue')}+1)`:mode==='savi'?`1.5*(${n}-${r})/(${n}+${r}+0.5)`:`(${n}-${r})/(${n}+${r})`;}
 return {assets:[...used],expression,range:FIELD_INDICES[mode].range,resolution:sensor==='landsat'?'30 m':['ndre','ndmi'].includes(mode)?'20 m':'10 m',note:sensor==='sentinel'?'BOA reflectance: Sentinel processing-baseline offset and 0.0001 scale.':'Surface reflectance uses source scale and offset.'};
}
