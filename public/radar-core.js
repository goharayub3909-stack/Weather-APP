export const PMD_ORIGIN='https://radar.weather.gov.pk/jbirds/';
export function frameURL(frame){
 if(!frame||!/^images\/radar\/(islamabad|karachi)\/[A-Za-z0-9_./-]+\.png$/.test(frame.url)||frame.url.includes('..'))throw Error('Invalid PMD radar image path');
 return new URL(frame.url,PMD_ORIGIN).href;
}
export function imageBounds(site,radius){
 const corners=site?.imageBounds?.[radius];
 if(!Array.isArray(corners)||corners.length!==2||corners.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error('Missing radar image bounds');
 const [[a,b],[c,d]]=corners;
 if(Math.abs(a)>90||Math.abs(c)>90||Math.abs(b)>180||Math.abs(d)>180)throw Error('Invalid radar coordinates');
 return [[Math.min(a,c),Math.min(b,d)],[Math.max(a,c),Math.max(b,d)]];
}
export function productFrames(station,product){
 const seen=new Set();return (station?.frames||[]).filter(f=>{
  if(f.product!==product||f.radarSiteId!==station.site.id||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(f.datetime))return false;
  try{frameURL(f);imageBounds(station.site,f.radius);}catch{return false;}
  const key=f.datetime+'|'+f.radius;if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>a.datetime.localeCompare(b.datetime));
}
export function productOptions(station){return [...new Set((station?.frames||[]).map(f=>f.product))].filter(p=>typeof p==='string'&&productFrames(station,p).length).sort();}
